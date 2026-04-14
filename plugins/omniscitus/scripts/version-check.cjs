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
/**
 * Walk up from cwd looking for a project-local `.omniscitus/migrate/anchor.yaml`
 * and return the recorded `migrate_version` (as a raw string). Returns
 * null if we can't find an anchor or the field is missing — pre-0.6
 * anchors don't have it, and non-migrated projects have nothing.
 *
 * We don't parse YAML — a plain regex is enough for this one field,
 * keeps the hook dependency-free and fast.
 */
function readProjectMigrateVersion(startDir) {
  try {
    var dir = startDir || process.cwd();
    while (dir && dir !== path.dirname(dir)) {
      var anchorPath = path.join(dir, '.omniscitus', 'migrate', 'anchor.yaml');
      if (fs.existsSync(anchorPath)) {
        var text = fs.readFileSync(anchorPath, 'utf-8');
        var m = text.match(/^migrate_version:\s*["']?([^\s"'#]+)/m);
        return { anchorPath: anchorPath, version: m ? m[1] : null };
      }
      dir = path.dirname(dir);
    }
  } catch (e) { /* silent */ }
  return null;
}

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

/**
 * Second-stage nag: the installed plugin is up to date, but the *project*
 * was migrated by an older version. The canonical blocks it wrote
 * (CLAUDE.md, statusline, etc.) may have been improved since. Point the
 * user at /omniscitus-update, which is the explicit, consent-based path
 * to refresh those blocks without re-running full migration.
 *
 * Reuses the same 24h cache key structure so we don't spam on every
 * session start.
 */
function shouldEmitStaleMigrate(cache, installed, recorded, now) {
  if (!installed || !recorded) return false;
  var cmp = compareVersions(parseVersion(installed), parseVersion(recorded));
  if (cmp <= 0) return false; // already same or older (shouldn't happen) — stay quiet

  if (cache.lastStaleInstalled === installed &&
      cache.lastStaleRecorded === recorded &&
      cache.lastStaleShownAt &&
      (now - cache.lastStaleShownAt) < CHECK_INTERVAL_MS) {
    return false;
  }
  return true;
}

function main() {
  var pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) return; // not invoked via Claude Code — silent exit

  var installed = readInstalledVersion(pluginRoot);
  var latest = readLatestVersion(discoverMarketplacesDir());
  var cache = readCache(cachePath());
  var now = Date.now();
  var cacheUpdates = {};

  // Stage 1: newer plugin available on marketplace?
  if (shouldEmit(cache, installed, latest, now)) {
    var msg = '[omniscitus] Update available: v' + installed +
              ' → v' + latest +
              '. Run /plugin install ' + PLUGIN_NAME + '@' + PLUGIN_NAME +
              ' --force to update.';
    process.stdout.write(msg + '\n');
    cacheUpdates.lastInstalled = installed;
    cacheUpdates.lastLatest = latest;
    cacheUpdates.lastShownAt = now;
  }

  // Stage 2: plugin installed newer than the project's recorded
  // migrate_version → suggest /omniscitus-update.
  var project = readProjectMigrateVersion(process.cwd());
  if (project && shouldEmitStaleMigrate(cache, installed, project.version, now)) {
    var msg2 = '[omniscitus] Project was migrated at v' + project.version +
               ' but plugin is now v' + installed +
               '. Run /omniscitus-update to apply new canonical blocks (CLAUDE.md, statusline).';
    process.stdout.write(msg2 + '\n');
    cacheUpdates.lastStaleInstalled = installed;
    cacheUpdates.lastStaleRecorded = project.version;
    cacheUpdates.lastStaleShownAt = now;
  }

  if (Object.keys(cacheUpdates).length > 0) {
    var merged = Object.assign({}, cache, cacheUpdates);
    writeCache(cachePath(), merged);
  }
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
  readProjectMigrateVersion: readProjectMigrateVersion,
  shouldEmit: shouldEmit,
  shouldEmitStaleMigrate: shouldEmitStaleMigrate,
  PLUGIN_NAME: PLUGIN_NAME,
  CHECK_INTERVAL_MS: CHECK_INTERVAL_MS
};
