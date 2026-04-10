'use strict';

/**
 * SessionStart advisory: scan blueprints/ and emit a one-time warning
 * for any blueprint file whose entry count exceeds the configured
 * threshold (default 300). The warning suggests `/blueprint-split`
 * for the offending top-level dir.
 *
 * Per RFC #10. Never auto-splits — only nudges. The threshold lives
 * in .omniscitus/migrate-config.yaml under blueprint_warnings, with
 * sensible defaults.
 *
 * This script must run fast and never throw — the SessionStart hook
 * is in the user's startup path.
 */

var fs = require('fs');
var path = require('path');

function findProjectRoot(dir) {
  var current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.omniscitus'))) return current;
    current = path.dirname(current);
  }
  current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    current = path.dirname(current);
  }
  return dir;
}

function loadWarningConfig(omniscitusDir) {
  // Defaults from RFC #10
  var config = { threshold: 300, enabled: true };
  try {
    var text = fs.readFileSync(path.join(omniscitusDir, 'migrate-config.yaml'), 'utf-8');
    var lines = text.split('\n');
    var inSection = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^blueprint_warnings\s*:\s*$/.test(line)) { inSection = true; continue; }
      if (!inSection) continue;
      var t = line.match(/^\s{2}threshold\s*:\s*(\d+)/);
      if (t) { config.threshold = parseInt(t[1], 10); continue; }
      var e = line.match(/^\s{2}enabled\s*:\s*(true|false)/);
      if (e) { config.enabled = (e[1] === 'true'); continue; }
      if (line.length > 0 && line.charAt(0) !== ' ' && line.trim().length > 0) inSection = false;
    }
  } catch (err) { /* defaults */ }
  return config;
}

// Cheap entry counter — counts lines that match the file-key pattern
// (`  "...":` or `  ...:` at 2-space indent). Avoids parsing the whole
// yaml; we only need a count, and the hook must be fast.
function countEntries(yamlPath) {
  try {
    var text = fs.readFileSync(yamlPath, 'utf-8');
    var lines = text.split('\n');
    var count = 0;
    var inFiles = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === 'files:') { inFiles = true; continue; }
      if (!inFiles) continue;
      // 2-space indent, ends with colon → file entry
      if (/^  ["'][^"']+["']\s*:\s*$/.test(line) || /^  [^\s][^:]*:\s*$/.test(line)) {
        count++;
      }
    }
    return count;
  } catch (err) {
    return 0;
  }
}

function walkBlueprints(dir, out) {
  var entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return; }
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i];
    var full = path.join(dir, name);
    var stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (stat.isDirectory()) {
      walkBlueprints(full, out);
    } else if (name.endsWith('.yaml') && name !== '_index.yaml' && name !== '_summaries.yaml') {
      out.push(full);
    }
  }
}

function main() {
  var projectRoot = findProjectRoot(process.cwd());
  var omniscitusDir = path.join(projectRoot, '.omniscitus');
  var blueprintsDir = path.join(omniscitusDir, 'blueprints');
  if (!fs.existsSync(blueprintsDir)) return;

  var config = loadWarningConfig(omniscitusDir);
  if (!config.enabled) return;

  var yamls = [];
  walkBlueprints(blueprintsDir, yamls);

  var offenders = [];
  for (var i = 0; i < yamls.length; i++) {
    var count = countEntries(yamls[i]);
    if (count > config.threshold) {
      offenders.push({ path: yamls[i], count: count });
    }
  }

  if (offenders.length === 0) return;

  // Emit a single advisory message via stdout. Claude Code surfaces
  // SessionStart hook stdout to the user as informational text.
  var lines = ['[omniscitus] Blueprint hotspot warning:'];
  for (var j = 0; j < offenders.length; j++) {
    var o = offenders[j];
    var rel = path.relative(blueprintsDir, o.path);
    // Derive the top-level dir name for the suggestion
    var topDir = rel.split('/')[0].replace(/\.yaml$/, '').replace(/^_(?=[a-zA-Z])/, '.');
    lines.push('  ' + rel + ' has ' + o.count + ' entries (>' + config.threshold + ')');
    lines.push('    consider /blueprint-split ' + topDir);
  }
  lines.push('  to suppress: set blueprint_warnings.enabled: false in .omniscitus/migrate-config.yaml');
  process.stdout.write(lines.join('\n') + '\n');
}

main();
