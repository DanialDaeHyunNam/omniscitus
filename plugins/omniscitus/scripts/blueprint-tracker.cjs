'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var readStdin = require('./lib/stdin.cjs').readStdin;

// --- Git identity ---

var _gitUser = null;

function getGitUser(projectRoot) {
  if (_gitUser !== null) return _gitUser;
  try {
    var name = childProcess.execSync('git config user.name', {
      cwd: projectRoot, timeout: 1000, encoding: 'utf-8'
    }).trim();
    _gitUser = name || '';
  } catch (e) {
    _gitUser = '';
  }
  return _gitUser;
}

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

// --- Per-directory blueprint helpers ---

function getBlueprintKey(relPath) {
  var first = relPath.split(path.sep)[0];
  // Root-level files (no directory) go into _root
  if (first === relPath) return '_root';
  return first;
}

function getBlueprintFilePath(omniscitusDir, key) {
  return path.join(omniscitusDir, 'blueprints', key + '.yaml');
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
  var blueprintsDir = path.join(omniscitusDir, 'blueprints');

  // Ensure .omniscitus/blueprints/ exists
  if (!fs.existsSync(blueprintsDir)) {
    fs.mkdirSync(blueprintsDir, { recursive: true });
  }

  // Make file path relative to project root
  var relPath = filePath;
  if (path.isAbsolute(filePath)) {
    relPath = path.relative(projectRoot, filePath);
  }

  // Skip files inside .omniscitus/ itself
  if (relPath.startsWith('.omniscitus')) return;

  // Skip gitignored files
  try {
    childProcess.execSync('git check-ignore -q "' + relPath + '"', {
      cwd: projectRoot, timeout: 1000
    });
    // If check-ignore succeeds (exit 0), the file IS ignored → skip
    return;
  } catch (e) {
    // Exit code 1 means NOT ignored → continue
  }

  // Determine which per-directory blueprint file to use
  var bpKey = getBlueprintKey(relPath);
  var blueprintPath = getBlueprintFilePath(omniscitusDir, bpKey);

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

  // Build source label: "claude:username" for team attribution
  var gitUser = getGitUser(projectRoot);
  var sourceLabel = gitUser ? 'claude:' + gitUser : 'claude';

  // Update or create file entry
  if (data.files[relPath]) {
    var entry = data.files[relPath];
    entry.status = 'active';
    entry.last_modified = now;
    entry.change_count = (entry.change_count || 0) + 1;
    entry.change_log.unshift({ date: now, action: action, source: sourceLabel });
  } else {
    data.files[relPath] = {
      status: 'active',
      source: sourceLabel,
      created: today,
      last_modified: now,
      change_count: 1,
      purpose: '',
      change_log: [{ date: now, action: action, source: sourceLabel }]
    };
  }

  data.updated = now;

  // Atomic write: temp file + rename
  var tmpPath = blueprintPath + '.tmp';
  fs.writeFileSync(tmpPath, serializeBlueprints(data), 'utf-8');
  fs.renameSync(tmpPath, blueprintPath);
}

main().catch(function () {});
