'use strict';

/**
 * SessionStart version-check advisory. Compares the installed plugin
 * version (discovered via CLAUDE_PLUGIN_ROOT) against the latest version
 * Claude Code has synced into `~/.claude/plugins/marketplaces/`. If the
 * installed version lags, emits a one-line upgrade hint to stdout —
 * Claude Code surfaces SessionStart hook stdout to the user.
 *
 * Rate-limited to once per 24h per user so it's never noisy, and quiet
 * after an upgrade brings the versions back in line.
 *
 * Must be fast (~ms) and never throw — it runs in the user's startup path.
 */

var fs = require('fs');
var path = require('path');
var os = require('os');

var PLUGIN_NAME = 'omniscitus';
var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Version helpers ────────────────────────────────────

/**
 * Parse a semver-ish version string into an array of numbers.
 * "0.2.0" → [0, 2, 0]. Non-numeric segments (pre-release tags like "beta")
 * are ignored — pre-release ordering is out of scope for a courtesy hint.
 */
function parseVersion(v) {
  if (!v || typeof v !== 'string') return null;
  var core = v.split('-')[0]; // strip pre-release suffix
  var parts = core.split('.').map(function (s) { return parseInt(s, 10); });
  if (parts.some(isNaN)) return null;
  return parts;
}

/**
 * Compare two version arrays. Returns -1 / 0 / +1.
 * Shorter arrays treat missing positions as 0 (so 1.0 === 1.0.0).
 */
function compareVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    var ai = a[i] || 0;
    var bi = b[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

// ── Version discovery ──────────────────────────────────

function readInstalledVersion(pluginRoot) {
  try {
    var manifest = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    var text = fs.readFileSync(manifest, 'utf-8');
    var data = JSON.parse(text);
    return data.version || null;
  } catch (e) { return null; }
}

/**
 * Walk all synced marketplaces and return the first `plugins[]` entry
 * matching PLUGIN_NAME. Returns null if the plugin isn't in any
 * marketplace this user has added (e.g., they installed from a local
 * path or a marketplace they later removed).
 */
function readLatestVersion(marketplacesDir) {
  try {
    var entries = fs.readdirSync(marketplacesDir);
    for (var i = 0; i < entries.length; i++) {
      var manifestPath = path.join(marketplacesDir, entries[i], '.claude-plugin', 'marketplace.json');
      if (!fs.existsSync(manifestPath)) continue;
      var text = fs.readFileSync(manifestPath, 'utf-8');
      var data = JSON.parse(text);
      var plugins = (data && data.plugins) || [];
      for (var p = 0; p < plugins.length; p++) {
        if (plugins[p].name === PLUGIN_NAME && plugins[p].version) {
          return plugins[p].version;
        }
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

// ── Cache ──────────────────────────────────────────────

function cachePath() {
  // Keep it out of the installed plugin dir so it survives upgrades.
  return path.join(os.homedir(), '.claude', 'omniscitus-version-check.json');
}

function readCache(p) {
  try {
    var text = fs.readFileSync(p, 'utf-8');
    return JSON.parse(text);
  } catch (e) { return {}; }
}

function writeCache(p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    var tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, p);
  } catch (e) { /* swallow — cache failure must never block SessionStart */ }
}

/**
 * Decide whether to emit the advisory this run. Criteria:
 *   1. Installed version is strictly older than latest.
 *   2. We haven't already nagged for this exact version pairing in
 *      the last CHECK_INTERVAL_MS.
 *
 * The cache stores the last pairing we reported, so switching to a
 * newer version mid-interval silences the hint immediately.
 */
function shouldEmit(cache, installed, latest, now) {
  if (!installed || !latest) return false;
  var cmp = compareVersions(parseVersion(installed), parseVersion(latest));
  if (cmp >= 0) return false;

  // Rate limit only applies if we're still advising the same upgrade
  // path. A new latest version resets the nag timer.
  if (cache.lastInstalled === installed &&
      cache.lastLatest === latest &&
      cache.lastShownAt &&
      (now - cache.lastShownAt) < CHECK_INTERVAL_MS) {
    return false;
  }
  return true;
}

// ── Main ───────────────────────────────────────────────

function discoverMarketplacesDir() {
  // Default: ~/.claude/plugins/marketplaces/
  return path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
}

function main() {
  var pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return; // not invoked via Claude Code — silent exit

  var installed = readInstalledVersion(pluginRoot);
  var latest = readLatestVersion(discoverMarketplacesDir());
  var cache = readCache(cachePath());
  var now = Date.now();

  if (!shouldEmit(cache, installed, latest, now)) return;

  // Emit one line. Keep it short — goes to the user's startup output.
  var msg = '[omniscitus] Update available: v' + installed +
            ' → v' + latest +
            '. Run /plugin install ' + PLUGIN_NAME + '@' + PLUGIN_NAME +
            ' --force to update.';
  process.stdout.write(msg + '\n');

  writeCache(cachePath(), {
    lastInstalled: installed,
    lastLatest: latest,
    lastShownAt: now
  });
}

// Only run when invoked as CLI, not when imported by tests.
if (require.main === module) {
  main();
}

module.exports = {
  parseVersion: parseVersion,
  compareVersions: compareVersions,
  readInstalledVersion: readInstalledVersion,
  readLatestVersion: readLatestVersion,
  shouldEmit: shouldEmit,
  PLUGIN_NAME: PLUGIN_NAME,
  CHECK_INTERVAL_MS: CHECK_INTERVAL_MS
};
