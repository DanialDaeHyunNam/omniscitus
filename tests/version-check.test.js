'use strict';

/*
 * Unit tests for the SessionStart version-check hook.
 * The hook must be fast and bulletproof — these tests lock down the
 * pure logic (parseVersion, compareVersions, shouldEmit) and the
 * filesystem readers via tmpdir fixtures.
 *
 * Run with:   node --test tests/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseVersion,
  compareVersions,
  readInstalledVersion,
  readLatestVersion,
  shouldEmit,
  PLUGIN_NAME,
  CHECK_INTERVAL_MS
} = require('../plugins/omniscitus/scripts/version-check.cjs');

// ── parseVersion ───────────────────────────────────────

test('parseVersion: standard x.y.z', () => {
  assert.deepEqual(parseVersion('0.2.0'), [0, 2, 0]);
  assert.deepEqual(parseVersion('1.15.3'), [1, 15, 3]);
});

test('parseVersion: strips pre-release suffix', () => {
  assert.deepEqual(parseVersion('0.3.0-beta.1'), [0, 3, 0]);
});

test('parseVersion: returns null for garbage', () => {
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion('not.a.version'), null);
  assert.equal(parseVersion(42), null);
});

// ── compareVersions ────────────────────────────────────

test('compareVersions: equality', () => {
  assert.equal(compareVersions([0, 2, 0], [0, 2, 0]), 0);
});

test('compareVersions: major/minor/patch dominance', () => {
  assert.equal(compareVersions([0, 2, 0], [0, 3, 0]), -1);
  assert.equal(compareVersions([0, 2, 1], [0, 2, 0]), 1);
  assert.equal(compareVersions([1, 0, 0], [0, 99, 99]), 1);
});

test('compareVersions: missing positions default to 0', () => {
  assert.equal(compareVersions([1], [1, 0, 0]), 0);
  assert.equal(compareVersions([1, 2], [1, 2, 0]), 0);
});

test('compareVersions: null safety', () => {
  assert.equal(compareVersions(null, null), 0);
  assert.equal(compareVersions(null, [0, 1, 0]), -1);
  assert.equal(compareVersions([0, 1, 0], null), 1);
});

// ── readInstalledVersion ───────────────────────────────

test('readInstalledVersion: reads from plugin.json manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ver-'));
  const manifestDir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(path.join(manifestDir, 'plugin.json'),
    JSON.stringify({ name: PLUGIN_NAME, version: '0.2.0' }));
  try {
    assert.equal(readInstalledVersion(tmp), '0.2.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readInstalledVersion: returns null when manifest missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ver-'));
  try {
    assert.equal(readInstalledVersion(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readInstalledVersion: returns null on malformed JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ver-'));
  const manifestDir = path.join(tmp, '.claude-plugin');
  fs.mkdirSync(manifestDir);
  fs.writeFileSync(path.join(manifestDir, 'plugin.json'), '{ malformed');
  try {
    assert.equal(readInstalledVersion(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── readLatestVersion ──────────────────────────────────

function writeMarketplace(rootDir, marketplaceName, plugins) {
  const mpDir = path.join(rootDir, marketplaceName, '.claude-plugin');
  fs.mkdirSync(mpDir, { recursive: true });
  fs.writeFileSync(
    path.join(mpDir, 'marketplace.json'),
    JSON.stringify({ name: marketplaceName, plugins: plugins }, null, 2)
  );
}

test('readLatestVersion: finds our plugin by name in a single marketplace', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mkt-'));
  writeMarketplace(tmp, 'omniscitus', [{ name: PLUGIN_NAME, version: '0.3.1' }]);
  try {
    assert.equal(readLatestVersion(tmp), '0.3.1');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readLatestVersion: scans multiple marketplaces', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mkt-'));
  writeMarketplace(tmp, 'other-mkt', [{ name: 'something-else', version: '1.0.0' }]);
  writeMarketplace(tmp, 'our-fork', [{ name: PLUGIN_NAME, version: '0.4.0' }]);
  try {
    assert.equal(readLatestVersion(tmp), '0.4.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readLatestVersion: returns null when plugin not in any marketplace', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-mkt-'));
  writeMarketplace(tmp, 'other-mkt', [{ name: 'something-else', version: '1.0.0' }]);
  try {
    assert.equal(readLatestVersion(tmp), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readLatestVersion: returns null for non-existent dir', () => {
  assert.equal(readLatestVersion('/does/not/exist-' + Date.now()), null);
});

// ── shouldEmit (rate limit + comparison logic) ─────────

test('shouldEmit: true when installed < latest and no prior nag', () => {
  const now = Date.now();
  assert.equal(shouldEmit({}, '0.2.0', '0.3.0', now), true);
});

test('shouldEmit: false when installed == latest', () => {
  const now = Date.now();
  assert.equal(shouldEmit({}, '0.3.0', '0.3.0', now), false);
});

test('shouldEmit: false when installed > latest (dev build)', () => {
  const now = Date.now();
  assert.equal(shouldEmit({}, '0.4.0', '0.3.0', now), false);
});

test('shouldEmit: false when installed or latest is missing', () => {
  const now = Date.now();
  assert.equal(shouldEmit({}, null, '0.3.0', now), false);
  assert.equal(shouldEmit({}, '0.2.0', null, now), false);
});

test('shouldEmit: respects 24h rate limit for the same pairing', () => {
  const now = Date.now();
  const cache = {
    lastInstalled: '0.2.0',
    lastLatest: '0.3.0',
    lastShownAt: now - 60 * 60 * 1000 // 1 hour ago
  };
  assert.equal(shouldEmit(cache, '0.2.0', '0.3.0', now), false);
});

test('shouldEmit: re-emits after the interval elapses', () => {
  const now = Date.now();
  const cache = {
    lastInstalled: '0.2.0',
    lastLatest: '0.3.0',
    lastShownAt: now - (CHECK_INTERVAL_MS + 1000)
  };
  assert.equal(shouldEmit(cache, '0.2.0', '0.3.0', now), true);
});

test('shouldEmit: a newer latest version resets the rate limit', () => {
  const now = Date.now();
  const cache = {
    lastInstalled: '0.2.0',
    lastLatest: '0.3.0',
    lastShownAt: now - 60 * 60 * 1000 // 1 hour ago — would normally be rate-limited
  };
  // But now 0.4.0 is out — this is a different upgrade path, so nag.
  assert.equal(shouldEmit(cache, '0.2.0', '0.4.0', now), true);
});
