#!/usr/bin/env node
/*
 * seed-omniscitus.js — dogfood script
 *
 * Populates .omniscitus/ with realistic blueprint + history data for this
 * repository so anyone running `/birdview` locally gets a fully-loaded
 * dashboard to play with. It's also the source for the demo birdview
 * served on the docs site.
 *
 * What it does, approximately:
 *   1. Walk tracked files via `git ls-files`.
 *   2. Group them by top-level directory → one blueprint yaml per group.
 *   3. For each file, extract a 1-line purpose from its leading comments
 *      or README-style heading.
 *   4. Derive history units from recent merge commits (PRs).
 *   5. Write everything in the yaml shape birdview's hand-rolled parser
 *      expects. The format is intentionally human-readable.
 *
 * This is a pragmatic substitute for the real /blueprint-sync skill —
 * it runs outside Claude Code and doesn't replace the skills; it just
 * seeds data for the demo. Safe to re-run; it overwrites existing files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = process.cwd();
const OUT = path.join(REPO, '.omniscitus');
const TODAY = new Date().toISOString().slice(0, 10);

// ── Helpers ─────────────────────────────────────────────

function gitFiles() {
  return execSync('git ls-files', { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .filter(f => !f.startsWith('.omniscitus/'));
}

function lastModified(file) {
  try {
    return execSync(`git log -1 --format=%ad --date=short -- "${file}"`, {
      encoding: 'utf-8'
    }).trim();
  } catch {
    return '';
  }
}

function changeCount(file) {
  try {
    const out = execSync(`git log --format=%H -- "${file}"`, { encoding: 'utf-8' });
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 1;
  }
}

// Extract a single-line purpose from file content. Heuristics only — the
// real blueprint-sync skill uses LLM inference. For a seed script, first
// meaningful comment line (or markdown heading) is good enough.
function extractPurpose(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 30);
    const ext = path.extname(filePath);

    // Markdown: first H1 or leading paragraph
    if (ext === '.md') {
      let inFrontmatter = false;
      let descFromFrontmatter = '';
      let captureNextAsDescription = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '---') {
          inFrontmatter = !inFrontmatter;
          continue;
        }
        if (inFrontmatter) {
          // Support both inline and folded-block forms:
          //   description: "Inline value"
          //   description: >-
          //     Folded multi-line
          //     value continues here.
          if (captureNextAsDescription && trimmed) {
            descFromFrontmatter = trimmed;
            captureNextAsDescription = false;
            continue;
          }
          const foldedMatch = trimmed.match(/^description:\s*[>|][-+]?\s*$/);
          if (foldedMatch) {
            captureNextAsDescription = true;
            continue;
          }
          const inlineMatch = trimmed.match(/^description:\s*(.+)$/);
          if (inlineMatch) {
            const v = inlineMatch[1].trim();
            // Guard against the YAML block markers ">", ">-", "|", "|-"
            if (v && !/^[>|][-+]?$/.test(v)) {
              descFromFrontmatter = v.replace(/^["']|["']$/g, '');
            }
          }
          continue;
        }
        if (descFromFrontmatter) return descFromFrontmatter.slice(0, 140);
        if (trimmed.startsWith('# ')) return trimmed.slice(2).trim().slice(0, 140);
        if (trimmed && !trimmed.startsWith('<') && !trimmed.startsWith('[')) {
          return trimmed.replace(/[*_`]/g, '').slice(0, 140);
        }
      }
      if (descFromFrontmatter) return descFromFrontmatter.slice(0, 140);
    }

    // JSON / YAML: name/description fields
    if (ext === '.json') {
      try {
        const obj = JSON.parse(content);
        if (obj.description) return String(obj.description).slice(0, 140);
        if (obj.name) return `${obj.name} config.`.slice(0, 140);
      } catch {}
    }

    // JS / shell / config — first meaningful comment line
    const commentPatterns = [
      /^\/\*\*?\s*(.+?)\s*\*?\/?$/,
      /^\/\/\s*(.+)$/,
      /^#\s*(.+)$/,
      /^\*\s*(.+)$/
    ];
    // Separator/decoration line: contains only repeat-y chars.
    // Covers ASCII dashes/equals and common Unicode box-drawing dashes.
    const SEPARATOR_RE = /^[\s\-=*_#/\u2500-\u257F\u2014\u2015]{3,}$/;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip shebang lines — they're not documentation.
      if (trimmed.startsWith('#!')) continue;
      // Skip decorative separator-only lines.
      if (SEPARATOR_RE.test(trimmed)) continue;
      for (const re of commentPatterns) {
        const m = trimmed.match(re);
        if (!m || !m[1]) continue;
        const body = m[1].trim();
        // The captured body itself might be pure separator chars
        if (SEPARATOR_RE.test(body)) continue;
        if (body.length > 8) {
          return body.replace(/^\s*-\s*/, '').slice(0, 140);
        }
      }
    }

    // Fallback by extension
    const base = path.basename(filePath);
    if (base === 'LICENSE') return 'Project license.';
    if (base === '.gitignore') return 'Git ignore rules.';
    if (ext === '.html') return 'HTML page.';
    if (ext === '.png') return 'Image asset.';
    if (ext === '.yaml' || ext === '.yml') return 'YAML configuration.';
    return '';
  } catch {
    return '';
  }
}

function escapeYamlString(s) {
  return String(s).replace(/"/g, '\\"');
}

// Blueprints parser accepts paths at exactly 2-space indent with properties
// at exactly 4-space indent. No outer `files:` key. It's a hand-rolled format,
// intentionally simple.
function writeBlueprintYaml(filename, files) {
  const lines = [];
  lines.push('version: 1');
  lines.push(`updated: "${TODAY}"`);
  for (const f of files) {
    const purpose = extractPurpose(path.join(REPO, f.path));
    lines.push(`  "${f.path}":`);
    lines.push(`    status: active`);
    lines.push(`    source: claude`);
    lines.push(`    created: "${f.created}"`);
    lines.push(`    last_modified: "${f.lastModified}"`);
    lines.push(`    change_count: ${f.changeCount}`);
    lines.push(`    purpose: "${escapeYamlString(purpose)}"`);
  }
  fs.writeFileSync(path.join(OUT, 'blueprints', filename), lines.join('\n') + '\n');
}

function writeBlueprints() {
  const files = gitFiles();
  const groups = {};
  for (const f of files) {
    const parts = f.split('/');
    const top = parts.length > 1 ? parts[0] : '_root';
    if (!groups[top]) groups[top] = [];
    groups[top].push({
      path: f,
      created: '2026-04-04', // project start
      lastModified: lastModified(f),
      changeCount: changeCount(f)
    });
  }

  fs.mkdirSync(path.join(OUT, 'blueprints'), { recursive: true });
  for (const [group, list] of Object.entries(groups)) {
    const filename = (group === '_root' ? '_root' : group.replace(/\./g, '_')) + '.yaml';
    writeBlueprintYaml(filename, list);
    console.log(`  blueprints/${filename}  (${list.length} files)`);
  }
}

// ── History ─────────────────────────────────────────────

// Derive topic units from recent merges. We group PRs into a single
// "Recent development" devops unit — the real /wrap-up would split them
// into topic-specific units, but for a seed this captures the feel.
function writeHistory() {
  fs.mkdirSync(path.join(OUT, 'history', 'devops'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'history', 'web'), { recursive: true });

  // Parse recent merge commits
  const mergesRaw = execSync(
    "git log --merges -30 --pretty=format:'%h|%s|%ad' --date=short",
    { encoding: 'utf-8' }
  );
  const merges = mergesRaw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, subject, date] = line.split('|');
      return { hash, subject, date };
    })
    .filter(m => m.subject && /#\d+/.test(m.subject));

  // Unit 1: Recent development (devops-ish catch-all)
  const devopsMd = [
    '# Recent development',
    '',
    '## Summary',
    "A rolling log of merged PRs — the meta-history of omniscitus building itself.",
    '',
    '## Context',
    '- **Background**: omniscitus is its own first user. This unit tracks what landed on main since the repo went public.',
    '- **Requirements**: every merged PR should leave behind a trail that makes sense to a future session.',
    '- **Decisions**: squash-merge everything, keep PR descriptions as the primary narrative.',
    '- **Constraints**: no breaking changes to existing `.omniscitus/` data shape.',
    '',
    '## Timeline',
    '',
    ...merges.slice(0, 15).map(m =>
      [
        `### ${m.date}`,
        `**Focus**: ${m.subject.replace(/"/g, '\\"')}`,
        `- Merged \`${m.hash}\``,
        '',
        '**Learned**: none',
        ''
      ].join('\n')
    ),
    '',
    '## Pending',
    '- [ ] Add real test coverage across the birdview parser',
    '- [ ] Ship the demo birdview on the docs site',
    '',
    '## Notes',
    'Generated from `git log --merges` by scripts/seed-omniscitus.js. Real wrap-up output will be more topical.',
    ''
  ].join('\n');
  fs.writeFileSync(
    path.join(OUT, 'history', 'devops', `2026-04-10-recent-development.md`),
    devopsMd
  );

  // Unit 2: Constellation view — recent feature work
  const webMd = [
    '# Constellation view',
    '',
    '## Summary',
    'The 3D node space + tree panel + nudge prompt modal — birdview\'s most ambitious visual surface.',
    '',
    '## Context',
    '- **Background**: started as a fancy visual hook, landed as a practical file-picker for Claude onboarding.',
    '- **Requirements**: pick files in a tree, generate an @-mention prompt, paste into Claude session.',
    '- **Decisions**: 3D was kept as a visual teaser; the tree panel is the primary UI.',
    '- **Constraints**: pure HTML + Three.js via CDN, no build step, no runtime server dependency for the demo.',
    '',
    '## Timeline',
    '',
    '### 2026-04-10',
    '**Focus**: Folder-level selection, tree event delegation, debounced search, de-emphasize the 3D pitch',
    '- Added `selectedFolders` state + `@folder/` nudge mentions',
    '- Event delegation on `#tree-list` for scale',
    '- Moved the docs 3D section to the bottom of the page',
    '',
    '**Learned**: tree-first is more honest than 3D-first for large projects.',
    '',
    '### 2026-04-09',
    '**Focus**: Initial Three.js constellation + blueprint tree panel + nudge modal',
    '- Clickable 3D spheres with selection sync',
    '- Tree panel with search',
    '- Clipboard nudge prompt preview',
    '',
    '## Pending',
    '- [ ] Demo birdview hosted on the docs site',
    '- [ ] Test coverage for the tree builder and nudge prompt builder',
    '',
    '## Notes',
    'See PRs #7 (Context section), #22 (constellation v1), #23 (tree + modal), #24 (cap), #25 (card balance), #26 (folder selection), #27 (docs rearrange).',
    ''
  ].join('\n');
  fs.writeFileSync(
    path.join(OUT, 'history', 'web', '2026-04-10-constellation-view.md'),
    webMd
  );

  // _index.yaml
  const indexLines = [
    'units:',
    '  - id: recent-development',
    '    domain: devops',
    '    status: open',
    '    created: "2026-04-04"',
    `    last_updated: "${TODAY}"`,
    `    session_count: ${Math.min(merges.length, 15)}`,
    '    title: "Recent development"',
    '    file: "devops/2026-04-10-recent-development.md"',
    '  - id: constellation-view',
    '    domain: web',
    '    status: open',
    '    created: "2026-04-09"',
    `    last_updated: "${TODAY}"`,
    '    session_count: 2',
    '    title: "Constellation view"',
    '    file: "web/2026-04-10-constellation-view.md"',
    ''
  ];
  fs.writeFileSync(path.join(OUT, 'history', '_index.yaml'), indexLines.join('\n'));
  console.log(`  history/  (2 units, ${merges.length} merges parsed)`);
}

// ── Tests ───────────────────────────────────────────────
// Seed both code-test (meta.yaml) and prompt-test (prompt-meta.yaml) fixtures
// so the Tests tab in the demo birdview has something to show. Content is an
// honest overlay over files that really exist in this repo — `tests/seed.test.js`
// and `tests/birdview-parser.test.js` — so the demo isn't misleading.

function writeYamlFile(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function writeTests() {
  writeYamlFile(path.join(OUT, 'tests', 'scripts', 'seed-omniscitus', 'meta.yaml'), [
    'target: scripts/seed-omniscitus.js',
    'language: javascript',
    'framework: node-test',
    'last_updated: ' + TODAY,
    'note: >',
    '  Overlay for existing test file tests/seed.test.js.',
    '  Existing tests are authoritative; this meta.yaml indexes them for omniscitus.',
    '',
    'suites:',
    '  - name: extractPurpose',
    '    type: unittest',
    '    signature:',
    '      params:',
    '        - name: filePath',
    '          type: string',
    '      returns:',
    '        type: string',
    '    cases:',
    '      - title: "extracts JSDoc @purpose tag"',
    '        description: "reads /** @purpose ... */ at top of .ts file"',
    '        input:',
    '          filePath: "src/auth/login.ts"',
    '        expected:',
    '          strategy: exact',
    '          value: "Handles OAuth login callback"',
    '      - title: "falls back to first leading comment"',
    '        description: "no @purpose → uses the first // line"',
    '        input:',
    '          filePath: "src/utils/slugify.ts"',
    '        expected:',
    '          strategy: exact',
    '          value: "URL-safe slug helper"',
    '      - title: "returns empty when no leading comment"',
    '        input:',
    '          filePath: "src/bare.ts"',
    '        expected:',
    '          strategy: exact',
    '          value: ""',
    '  - name: escapeYamlString',
    '    type: unittest',
    '    signature:',
    '      params:',
    '        - name: value',
    '          type: string',
    '      returns:',
    '        type: string',
    '    cases:',
    '      - title: "wraps strings containing colons"',
    '        input:',
    '          value: "foo: bar"',
    '        expected:',
    '          strategy: exact',
    '          value: "\\"foo: bar\\""',
    '      - title: "leaves plain alphanumeric strings unquoted"',
    '        input:',
    '          value: "hello"',
    '        expected:',
    '          strategy: exact',
    '          value: "hello"',
    '      - title: "escapes embedded double quotes"',
    '        input:',
    '          value: "say \\"hi\\""',
    '        expected:',
    '          strategy: exact',
    '          value: "\\"say \\\\\\"hi\\\\\\"\\""'
  ]);

  writeYamlFile(path.join(OUT, 'tests', 'plugins', 'omniscitus', 'birdview', 'server', 'meta.yaml'), [
    'target: plugins/omniscitus/birdview/server.js',
    'language: javascript',
    'framework: node-test',
    'last_updated: ' + TODAY,
    'note: >',
    '  Overlay for existing test file tests/birdview-parser.test.js.',
    '  Covers the pure YAML parsers exported from server.js.',
    '',
    'suites:',
    '  - name: parseBlueprints',
    '    type: unittest',
    '    signature:',
    '      params:',
    '        - name: yamlText',
    '          type: string',
    '      returns:',
    '        type: object',
    '    cases:',
    '      - title: "parses flat blueprints.yaml into a file map"',
    '        input:',
    '          yamlText: "files:\\n  src/index.ts:\\n    purpose: entry point"',
    '        expected:',
    '          strategy: exact',
    '          value:',
    '            files:',
    '              "src/index.ts":',
    '                purpose: "entry point"',
    '      - title: "handles nested folder splits"',
    '        description: "_index.yaml declares blueprint_splits → parser descends"',
    '        input:',
    '          yamlText: "blueprint_splits:\\n  - src/auth/"',
    '        expected:',
    '          strategy: shape',
    '          value:',
    '            splits: ["src/auth/"]',
    '      - title: "returns empty map when input is blank"',
    '        input:',
    '          yamlText: ""',
    '        expected:',
    '          strategy: exact',
    '          value:',
    '            files: {}'
  ]);

  writeYamlFile(path.join(OUT, 'tests', 'prompts', 'wrap-up-classification', 'prompt-meta.yaml'), [
    'target: plugins/omniscitus/skills/wrap-up/',
    'type: prompt',
    'prompt_name: wrap-up-classification',
    'last_updated: ' + TODAY,
    'note: >',
    '  Sample prompt-test scaffold for the /wrap-up domain classifier — decides which',
    '  domain bucket (web/server/design/...) a session\'s touched files belong to.',
    '  Illustrates how LLM-generated output gets judge-based evaluation in omniscitus.',
    '',
    '# --- Judge configuration ---',
    'judge:',
    '  model: claude-sonnet-4-6',
    '  temperature: 0',
    '  max_retries: 2',
    '',
    '# --- Evaluation type ---',
    'evaluation:',
    '  type: multi_criteria',
    '  criteria:',
    '    - domain_correct: "classified domain matches the dominant file-path prefix"',
    '    - single_topic: "one unit per coherent topic, no over-splitting"',
    '    - purpose_filled: "blueprint purpose fields populated when missing"',
    '',
    '# --- Pass criteria ---',
    'pass_criteria:',
    '  threshold: 0.8',
    '  notes: >',
    '    80% of cases must pass all 3 criteria. Stretch target 95%.'
  ]);

  console.log('  tests/  (2 code suites, 1 prompt suite)');
}

// ── Go ──────────────────────────────────────────────────

if (require.main === module) {
  console.log('Seeding .omniscitus/ ...');
  fs.mkdirSync(OUT, { recursive: true });
  writeBlueprints();
  writeHistory();
  writeTests();
  console.log('Done.');
}

// Exports for unit tests — the pure helpers are the valuable surface.
module.exports = {
  extractPurpose: extractPurpose,
  escapeYamlString: escapeYamlString
};
