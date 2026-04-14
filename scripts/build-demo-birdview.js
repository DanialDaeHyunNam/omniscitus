#!/usr/bin/env node
/*
 * build-demo-birdview.js — generates docs/birdview-demo/
 *
 * Copies the live birdview HTML pages into docs/birdview-demo/, injects
 * a client-side fetch interceptor that redirects /api/* calls to static
 * JSON files, and snapshots the current /api/blueprints + /api/units
 * responses into docs/birdview-demo/data/.
 *
 * End result: a fully interactive read-only birdview that runs on
 * Vercel static hosting with no backend. Visitors can click around,
 * try the tree picker, and copy nudge prompts without installing
 * anything.
 *
 * Run `node scripts/seed-omniscitus.js` first if .omniscitus/ is empty.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = process.cwd();
const SRC_DIR = path.join(REPO, 'plugins/omniscitus/birdview');
const OUT_DIR = path.join(REPO, 'docs/birdview-demo');
const DATA_DIR = path.join(OUT_DIR, 'data');
const PAGES = ['index.html', 'blueprint.html', 'history.html', 'tests.html', 'constellation.html'];
const ASSETS = ['favicon-16.png', 'favicon-32.png'];
const PORT = 3798; // unlikely to clash

// ── Step 1: spin up birdview server in the background ──
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(SRC_DIR, 'server.js'), REPO], {
      env: { ...process.env, BIRDVIEW_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'inherit']
    });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('Birdview running')) resolve(child);
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('server startup timed out')), 5000);
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`${res.statusCode} ${url}`));
      });
    }).on('error', reject);
  });
}

// ── Step 2: patch HTML with a fetch interceptor + demo banner ──
// The interceptor rewrites /api/<name> to ./data/<name>.json. It must run
// before any of the page's own <script> tags execute, so we inject it right
// after <head>. POST/PATCH writes still hit the origin — we no-op them so
// demo visitors can't corrupt the static snapshot.
const FETCH_INTERCEPTOR = `
<script>
(function() {
  var DEMO_BASE = new URL('./data/', document.baseURI).href;
  var ORIG_FETCH = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    // Writes are no-ops in demo mode — keep the UI responsive but do nothing.
    if (init && init.method && ['POST','PATCH','PUT','DELETE'].indexOf(init.method.toUpperCase()) !== -1) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, demo: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }));
    }
    // Rewrite /api/<name> → ./data/<name>.json. If the snapshot file is
    // missing (or any other non-OK response), silently return an empty
    // object so the birdview JS keeps working.
    var m = url.match(/^\\/api\\/([^?#]+)/);
    if (m) {
      var file = m[1].replace(/\\//g, '_') + '.json';
      var emptyOk = function() {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      return ORIG_FETCH(DEMO_BASE + file, init).then(function(res) {
        return res && res.ok ? res : emptyOk();
      }).catch(emptyOk);
    }
    return ORIG_FETCH(input, init);
  };
})();
</script>
<style>
/* Demo banner shown on every birdview page in the hosted preview.
 * Sits in normal flow at the top of <body> so it pushes content down
 * instead of floating over it — fixed positioning was hiding toolbar
 * controls on some pages. */
.omni-demo-banner {
  position: relative;
  background: linear-gradient(90deg, rgba(124,58,237,0.18), rgba(110,231,183,0.12));
  border-bottom: 1px solid rgba(124,58,237,0.35);
  color: #e4e4e7; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  padding: 8px 16px; display: flex; align-items: center; gap: 12px;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.omni-demo-banner strong { color: #c4b5fd; font-weight: 600; }
.omni-demo-banner .omni-demo-dot { width: 7px; height: 7px; border-radius: 50%; background: #6ee7b7; box-shadow: 0 0 8px #6ee7b7; flex-shrink: 0; }
.omni-demo-banner a { color: #93c5fd; text-decoration: none; font-weight: 500; }
.omni-demo-banner a:hover { text-decoration: underline; }
.omni-demo-banner .omni-demo-sep { color: #3a3a4a; }
</style>
`;

const DEMO_BANNER_HTML = `
<div class="omni-demo-banner">
  <span class="omni-demo-dot"></span>
  <span>You're exploring a <strong>live demo</strong> of birdview, running against the omniscitus repo.</span>
  <span class="omni-demo-sep">&bull;</span>
  <a href="/" title="Back to landing page">&larr; Back to omniscitus.vercel.app</a>
</div>
`;

function patchHtml(html) {
  let out = html;

  // Step 1: rewrite absolute paths in the source HTML to relative ones
  // BEFORE injecting the demo banner (whose own href="/" must stay intact).
  // The source birdview pages hardcode `/blueprint`, `/history`, etc.
  // because they're served from the plugin's Node server. On Vercel the
  // demo lives under /birdview-demo/, so those absolute paths would 404.
  out = out.replace(/href="\/(blueprint|history|tests|constellation|index)(\.html)?"/g, 'href="./$1.html"');
  out = out.replace(/href="\/"(\s|>)/g, 'href="./index.html"$1');
  out = out.replace(/href="\/favicon-(\d+)\.png"/g, 'href="./favicon-$1.png"');
  out = out.replace(/href="\/favicon\.ico"/g, 'href="./favicon-32.png"');

  // Step 2: inject the fetch interceptor (redirects /api/* to ./data/*)
  const headMatch = out.match(/<head[^>]*>/);
  if (!headMatch) return out;
  out = out.replace(headMatch[0], headMatch[0] + '\n' + FETCH_INTERCEPTOR);

  // Step 3: inject the demo banner at the start of <body>.
  // Its own href="/" points back to the docs landing and must NOT be
  // rewritten — that's why we did Step 1 first.
  const bodyMatch = out.match(/<body[^>]*>/);
  if (bodyMatch) {
    out = out.replace(bodyMatch[0], bodyMatch[0] + '\n' + DEMO_BANNER_HTML);
  }
  return out;
}

// ── Step 3: write output files ──
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('Starting birdview server on port ' + PORT + '...');
  const server = await startServer();

  try {
    // Snapshot API data. Keep this list in sync with the GET endpoints
    // served by server.js — any missing entry 404s in the demo's console
    // (the interceptor has a network-error fallback but not a 404 one,
    // browsers still log failed requests).
    const endpoints = [
      { api: '/api/blueprints', file: 'blueprints.json' },
      { api: '/api/units', file: 'units.json' },
      { api: '/api/tests', file: 'tests.json' },
      { api: '/api/prompt-tests', file: 'prompt-tests.json' },
      { api: '/api/reviews', file: 'reviews.json' }
    ];
    for (const { api, file } of endpoints) {
      try {
        const body = await get('http://localhost:' + PORT + api);
        fs.writeFileSync(path.join(DATA_DIR, file), body);
        console.log('  data/' + file + '  (' + body.length + ' bytes)');
      } catch (e) {
        console.warn('  data/' + file + '  SKIPPED (' + e.message + ')');
        // Write an empty shell so the fetch interceptor's fallback works
        fs.writeFileSync(path.join(DATA_DIR, file), '{}');
      }
    }

    // Copy + patch HTML files
    for (const name of PAGES) {
      const src = path.join(SRC_DIR, name);
      if (!fs.existsSync(src)) continue;
      const html = fs.readFileSync(src, 'utf-8');
      const patched = patchHtml(html);
      fs.writeFileSync(path.join(OUT_DIR, name), patched);
      console.log('  ' + name);
    }

    // Copy static assets
    for (const name of ASSETS) {
      const src = path.join(SRC_DIR, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, name));
    }

    console.log('Demo birdview built at docs/birdview-demo/');
  } finally {
    server.kill();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

module.exports = {
  patchHtml: patchHtml,
  FETCH_INTERCEPTOR: FETCH_INTERCEPTOR,
  DEMO_BANNER_HTML: DEMO_BANNER_HTML
};
