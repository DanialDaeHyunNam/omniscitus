'use strict';

/*
 * Unit tests for the demo birdview build helpers. The fetch interceptor
 * is the load-bearing piece: if it misfires, the hosted demo silently
 * shows empty data (the scariest kind of bug).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchHtml, FETCH_INTERCEPTOR, DEMO_BANNER_HTML } = require('../scripts/build-demo-birdview.js');

test('patchHtml: injects fetch interceptor right after <head>', () => {
  const input = '<!DOCTYPE html><html><head><title>Birdview</title></head><body>hi</body></html>';
  const out = patchHtml(input);
  const headIdx = out.indexOf('<head>');
  const interceptorIdx = out.indexOf('window.fetch');
  assert.ok(headIdx !== -1, 'head tag preserved');
  assert.ok(interceptorIdx > headIdx, 'interceptor placed after <head>');
  // The interceptor should come before </head>
  const headCloseIdx = out.indexOf('</head>');
  assert.ok(interceptorIdx < headCloseIdx, 'interceptor placed inside head, not after');
});

test('patchHtml: injects demo banner at the start of <body>', () => {
  const input = '<html><head></head><body><h1>Content</h1></body></html>';
  const out = patchHtml(input);
  const bodyIdx = out.indexOf('<body>');
  // The interceptor puts .omni-demo-banner selectors in a <style> block
  // inside <head>, so match on the element tag instead of the class name
  // to find the actual banner div.
  const bannerDivIdx = out.indexOf('<div class="omni-demo-banner">');
  assert.ok(bannerDivIdx > bodyIdx, 'banner div placed after <body>');
  assert.ok(bannerDivIdx < out.indexOf('<h1>'), 'banner div placed before existing content');
});

test('patchHtml: preserves existing page content', () => {
  const input = '<html><head><title>X</title></head><body><div id="app">hello</div></body></html>';
  const out = patchHtml(input);
  assert.ok(out.includes('<title>X</title>'));
  assert.ok(out.includes('<div id="app">hello</div>'));
});

test('patchHtml: handles <head> with attributes', () => {
  const input = '<html><head data-theme="dark"><title>X</title></head><body></body></html>';
  const out = patchHtml(input);
  assert.ok(out.includes('data-theme="dark"'), 'preserves head attributes');
  assert.ok(out.includes('window.fetch'), 'still injects interceptor');
});

test('patchHtml: handles <body> with attributes', () => {
  const input = '<html><head></head><body class="dark"><div>x</div></body></html>';
  const out = patchHtml(input);
  assert.ok(out.includes('class="dark"'), 'preserves body attributes');
  assert.ok(out.includes('omni-demo-banner'), 'still injects banner');
});

test('patchHtml: returns input unchanged when <head> is missing', () => {
  const input = '<html><body>no head tag</body></html>';
  const out = patchHtml(input);
  // Should not throw; should not inject interceptor (nowhere to put it)
  assert.ok(!out.includes('window.fetch'));
});

test('FETCH_INTERCEPTOR: rewrites /api/blueprints to ./data/blueprints.json', () => {
  // This is a runtime contract of the interceptor. Simulate by evaluating
  // the interceptor string against a fake fetch and checking what URL
  // actually gets called.
  const fakeFetchCalls = [];
  const fakeWindow = {
    fetch: (url, opts) => {
      fakeFetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true });
    }
  };
  const fakeDoc = { baseURI: 'https://example.com/birdview-demo/' };

  // Strip the <script> wrapper and eval in a restricted context
  const js = FETCH_INTERCEPTOR.match(/<script>([\s\S]*?)<\/script>/)[1];
  const fn = new Function('window', 'document', 'URL', 'Response', 'Promise', js);
  // Provide a minimal Response stub — the interceptor never inspects it
  // for the URL-rewrite path we're testing, it just passes it along.
  function Response(body, init) { this.body = body; this.init = init; }
  fn(fakeWindow, fakeDoc, URL, Response, Promise);

  return fakeWindow.fetch('/api/blueprints').then(() => {
    assert.equal(fakeFetchCalls.length, 1);
    assert.match(fakeFetchCalls[0].url, /\/birdview-demo\/data\/blueprints\.json$/);
  });
});

test('FETCH_INTERCEPTOR: passes through non-/api URLs unchanged', () => {
  const fakeFetchCalls = [];
  const fakeWindow = {
    fetch: (url, opts) => {
      fakeFetchCalls.push({ url });
      return Promise.resolve({ ok: true });
    }
  };
  const fakeDoc = { baseURI: 'https://example.com/birdview-demo/' };
  const js = FETCH_INTERCEPTOR.match(/<script>([\s\S]*?)<\/script>/)[1];
  function Response(body, init) { this.body = body; this.init = init; }
  new Function('window', 'document', 'URL', 'Response', 'Promise', js)(fakeWindow, fakeDoc, URL, Response, Promise);

  return fakeWindow.fetch('https://other.example/api/external').then(() => {
    assert.equal(fakeFetchCalls[0].url, 'https://other.example/api/external');
  });
});

test('FETCH_INTERCEPTOR: no-ops POST writes with an OK demo response', () => {
  const fakeFetchCalls = [];
  const fakeWindow = {
    fetch: (url, opts) => { fakeFetchCalls.push({ url }); return Promise.resolve({ ok: true }); }
  };
  const fakeDoc = { baseURI: 'https://example.com/birdview-demo/' };
  const js = FETCH_INTERCEPTOR.match(/<script>([\s\S]*?)<\/script>/)[1];
  function Response(body, init) { this.body = body; this.init = init; this.status = init && init.status; }
  new Function('window', 'document', 'URL', 'Response', 'Promise', js)(fakeWindow, fakeDoc, URL, Response, Promise);

  return fakeWindow.fetch('/api/reviews', { method: 'POST', body: '{}' }).then(res => {
    assert.equal(fakeFetchCalls.length, 0, 'POST should not hit the real fetch');
    assert.equal(res.status, 200);
    // The body is a stringified { ok: true, demo: true }
    assert.match(String(res.body), /demo/);
  });
});

test('DEMO_BANNER_HTML: includes the demo text + back link', () => {
  assert.match(DEMO_BANNER_HTML, /live demo/);
  assert.match(DEMO_BANNER_HTML, /omniscitus/);
  assert.match(DEMO_BANNER_HTML, /href="\//);
});
