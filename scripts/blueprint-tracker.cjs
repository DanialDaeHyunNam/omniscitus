'use strict';

var fs = require('fs');
var path = require('path');
var readStdin = require('./lib/stdin.cjs').readStdin;

// --- YAML helpers (zero-dep, schema-specific) ---

function parseBlueprints(text) {
  var result = { version: 1, updated: '', files: {} };
  if (!text) return result;

  var lines = text.split('\n');
  var currentFile = null;
  var inChangeLog = false;
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    // top-level scalars
    var vMatch = line.match(/^version:\s*(\d+)/);
    if (vMatch) { result.version = parseInt(vMatch[1]); i++; continue; }

    var uMatch = line.match(/^updated:\s*(.+)/);
    if (uMatch) { result.updated = uMatch[1].trim(); i++; continue; }

    // file entry (2-space indent, ends with colon)
    var fMatch = line.match(/^  ([^\s].*):$/);
    if (fMatch) {
      currentFile = fMatch[1];
      result.files[currentFile] = result.files[currentFile] || {
        status: 'active', source: 'claude', created: '', last_modified: '',
        change_count: 0, purpose: '', change_log: []
      };
      inChangeLog = false;
      i++; continue;
    }

    if (currentFile) {
      // file property (4-space indent)
      var pMatch = line.match(/^    (status|source|created|last_modified|deleted|change_count|purpose):\s*(.*)/);
      if (pMatch) {
        var key = pMatch[1];
        var val = pMatch[2].replace(/^["']|["']$/g, '').trim();
        if (key === 'change_count') val = parseInt(val) || 0;
        result.files[currentFile][key] = val;
        inChangeLog = false;
        i++; continue;
      }

      // change_log header
      if (line.match(/^    change_log:$/)) {
        inChangeLog = true;
        i++; continue;
      }

      // change_log entry
      if (inChangeLog) {
        var dMatch = line.match(/^      - date:\s*(.+)/);
        if (dMatch) {
          result.files[currentFile].change_log.push({
            date: dMatch[1].trim(), action: '', source: ''
          });
          i++; continue;
        }
        var aMatch = line.match(/^        (action|source):\s*(.+)/);
        if (aMatch && result.files[currentFile].change_log.length > 0) {
          var last = result.files[currentFile].change_log[result.files[currentFile].change_log.length - 1];
          last[aMatch[1]] = aMatch[2].trim();
          i++; continue;
        }
      }
    }

    i++;
  }

  return result;
}

function serializeBlueprints(data) {
  var lines = [];
  lines.push('version: ' + data.version);
  lines.push('updated: ' + data.updated);
  lines.push('');
  lines.push('files:');

  var paths = Object.keys(data.files);
  for (var p = 0; p < paths.length; p++) {
    var filePath = paths[p];
    var f = data.files[filePath];
    lines.push('  ' + filePath + ':');
    lines.push('    status: ' + (f.status || 'active'));
    lines.push('    source: ' + (f.source || 'claude'));
    lines.push('    created: ' + (f.created || ''));
    lines.push('    last_modified: ' + (f.last_modified || ''));
    if (f.deleted) lines.push('    deleted: ' + f.deleted);
    lines.push('    change_count: ' + (f.change_count || 0));
    lines.push('    purpose: "' + (f.purpose || '').replace(/"/g, '\\"') + '"');
    lines.push('    change_log:');
    var log = f.change_log || [];
    for (var c = 0; c < log.length; c++) {
      lines.push('      - date: ' + log[c].date);
      lines.push('        action: ' + (log[c].action || 'write'));
      lines.push('        source: ' + (log[c].source || 'claude'));
    }
    if (log.length === 0) lines.push('      []');
  }

  return lines.join('\n') + '\n';
}

// --- Project root finder ---

function findProjectRoot(dir) {
  var current = dir;
  // first check for existing .omniscitus
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.omniscitus'))) return current;
    current = path.dirname(current);
  }
  // fallback to .git
  current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    current = path.dirname(current);
  }
  return dir;
}

// --- Main ---

async function main() {
  var input = await readStdin(2000);
  if (!input) return;

  // Extract file path from tool input
  var filePath = null;
  if (input.tool_input) {
    filePath = input.tool_input.file_path || input.tool_input.path || null;
  }
  if (!filePath) return;

  var cwd = input.cwd || process.cwd();
  var projectRoot = findProjectRoot(cwd);
  var omniscitusDir = path.join(projectRoot, '.omniscitus');
  var blueprintPath = path.join(omniscitusDir, 'blueprints.yaml');

  // Ensure .omniscitus/ exists
  if (!fs.existsSync(omniscitusDir)) {
    fs.mkdirSync(omniscitusDir, { recursive: true });
  }

  // Make file path relative to project root
  var relPath = filePath;
  if (path.isAbsolute(filePath)) {
    relPath = path.relative(projectRoot, filePath);
  }

  // Skip files inside .omniscitus/ itself
  if (relPath.startsWith('.omniscitus')) return;

  // Read existing or create new
  var data;
  if (fs.existsSync(blueprintPath)) {
    data = parseBlueprints(fs.readFileSync(blueprintPath, 'utf-8'));
  } else {
    data = { version: 1, updated: '', files: {} };
  }

  var now = new Date().toISOString();
  var today = now.slice(0, 10);
  var toolName = (input.tool_name || 'write').toLowerCase();
  var action = toolName === 'edit' ? 'edit' : 'write';

  // Update or create file entry
  if (data.files[relPath]) {
    var entry = data.files[relPath];
    entry.status = 'active';
    entry.last_modified = now;
    entry.change_count = (entry.change_count || 0) + 1;
    entry.change_log.unshift({ date: now, action: action, source: 'claude' });
  } else {
    data.files[relPath] = {
      status: 'active',
      source: 'claude',
      created: today,
      last_modified: now,
      change_count: 1,
      purpose: '',
      change_log: [{ date: now, action: action, source: 'claude' }]
    };
  }

  data.updated = now;

  // Atomic write: temp file + rename
  var tmpPath = blueprintPath + '.tmp';
  fs.writeFileSync(tmpPath, serializeBlueprints(data), 'utf-8');
  fs.renameSync(tmpPath, blueprintPath);
}

main().catch(function () {});
