'use strict';

/**
 * Shared blueprint path resolver.
 *
 * Given a project-relative file path and the project's blueprint_splits
 * config, return the absolute path to the blueprint yaml file that
 * should hold the entry for that file.
 *
 * Used by:
 *  - scripts/blueprint-tracker.cjs (PostToolUse hook, write side)
 *  - scripts/blueprint-warn.cjs (SessionStart warning)
 *  - any future caller that needs to map a file path → its blueprint
 *
 * Schema for blueprint_splits (from .omniscitus/migrate-config.yaml):
 *
 *   blueprint_splits:
 *     src: 2          # split src/* into nested files at level 2
 *     .claude: 2      # split .claude/* into nested files at level 2
 *     packages: 1     # default — one file per top-level dir (explicit)
 *
 * Depth N means: take the first N path segments (where each segment is
 * a directory) and use them to build the blueprint file path. The
 * deepest segment becomes the yaml filename. If the file is too shallow
 * to fill all N segments, the missing slots get '_root' which becomes
 * the yaml filename in the deepest existing directory.
 *
 * Examples (depth 2):
 *   src/lib/auth.ts        → blueprints/src/lib.yaml
 *   src/index.ts           → blueprints/src/_root.yaml
 *   .claude/skills/foo.md  → blueprints/_claude/skills.yaml
 *   .claude/CLAUDE.md      → blueprints/_claude/_root.yaml
 *
 * Examples (depth 1, default):
 *   src/lib/auth.ts        → blueprints/src.yaml
 *   .claude/CLAUDE.md      → blueprints/_claude.yaml
 *
 * Hidden directories (.claude, .github) get their leading dot replaced
 * with an underscore so the resulting file is visible in directory
 * listings: ".claude" → "_claude".
 */

var path = require('path');

function normalizeName(name) {
  // Hidden dir leading dot → underscore so the yaml file is visible
  // when listing the blueprints/ folder.
  return name.charAt(0) === '.' ? '_' + name.slice(1) : name;
}

function resolveBlueprintFile(relPath, splitConfig, omniscitusDir) {
  var blueprintsDir = path.join(omniscitusDir, 'blueprints');

  // Strip leading "./" if present
  if (relPath.indexOf('./') === 0) relPath = relPath.slice(2);

  var parts = relPath.split('/').filter(function (p) { return p.length > 0; });

  // Root-level file (no directory): always _root.yaml at the top
  if (parts.length <= 1) {
    return path.join(blueprintsDir, '_root.yaml');
  }

  var topDir = parts[0];
  var depth = (splitConfig && splitConfig[topDir]) || 1;
  if (depth < 1) depth = 1;

  // Build segments: each level either consumes a directory component
  // (when there's a deeper file underneath it) or becomes _root (when
  // the path is too shallow to provide a real folder name at this
  // level).
  var segments = [];
  for (var i = 0; i < depth; i++) {
    if (i + 1 < parts.length) {
      segments.push(normalizeName(parts[i]));
    } else {
      segments.push('_root');
      break;
    }
  }

  // Last segment becomes the yaml filename, prior segments are dirs
  var fileName = segments[segments.length - 1] + '.yaml';
  if (segments.length === 1) {
    return path.join(blueprintsDir, fileName);
  }
  var dirSegments = segments.slice(0, -1);
  return path.join.apply(null, [blueprintsDir].concat(dirSegments, [fileName]));
}

/**
 * Parse the `blueprint_splits` section out of migrate-config.yaml.
 * Zero-dep, hand-rolled — only handles a flat key: integer map under
 * the `blueprint_splits:` top-level key.
 */
function parseSplitConfig(text) {
  var splits = {};
  if (!text) return splits;
  var lines = text.split('\n');
  var inSection = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^blueprint_splits\s*:\s*$/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // Entry under the section: 2-space indent, "key: number"
    var entry = line.match(/^\s{2}["']?([^"'\s].*?)["']?\s*:\s*(\d+)\s*(#.*)?$/);
    if (entry) {
      var key = entry[1].trim();
      splits[key] = parseInt(entry[2], 10);
      continue;
    }
    // A non-indented non-blank line ends the section
    if (line.length > 0 && line.charAt(0) !== ' ' && line.trim().length > 0) {
      inSection = false;
    }
  }
  return splits;
}

/**
 * Convenience: read migrate-config.yaml and parse splits in one call.
 * Returns {} on any error so callers don't need try/catch.
 */
function loadSplitConfig(omniscitusDir) {
  var fs = require('fs');
  var configPath = path.join(omniscitusDir, 'migrate-config.yaml');
  try {
    var text = fs.readFileSync(configPath, 'utf-8');
    return parseSplitConfig(text);
  } catch (e) {
    return {};
  }
}

module.exports = {
  resolveBlueprintFile: resolveBlueprintFile,
  parseSplitConfig: parseSplitConfig,
  loadSplitConfig: loadSplitConfig,
  normalizeName: normalizeName
};
