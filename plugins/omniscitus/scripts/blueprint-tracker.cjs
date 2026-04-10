'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var readStdin = require('./lib/stdin.cjs').readStdin;
var resolver = require('./lib/blueprint-resolver.cjs');

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

    // file entry (2-space indent, ends with colon). Strip surrounding
    // YAML quotes from the path key — both the migration script and
    // older serializer write quoted keys for paths containing dots or
    // special chars, and carrying the literal quotes through breaks
    // every consumer.
    var fMatch = line.match(/^  ([^\s].*):\s*$/);
    if (fMatch) {
      currentFile = fMatch[1].replace(/^["']|["']$/g, '');
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
            date: dMatch[1].trim(), action: '', source: '', message: ''
          });
          i++; continue;
        }
        // Preserve `message` alongside action/source so commit messages
        // written by the migration script survive a hook round-trip.
        var aMatch = line.match(/^        (action|source|message):\s*(.+)/);
        if (aMatch && result.files[currentFile].change_log.length > 0) {
          var last = result.files[currentFile].change_log[result.files[currentFile].change_log.length - 1];
          last[aMatch[1]] = aMatch[2].replace(/^["']|["']$/g, '').trim();
          i++; continue;
        }
      }
    }

    i++;
  }

  return result;
}

function quoteKey(key) {
  // Match the migration script: paths containing dots, slashes, or
  // brackets get wrapped in double quotes so the YAML parser can't
  // misinterpret them.
  if (/[.\/\[\]\s"#:]/.test(key)) {
    return '"' + key.replace(/"/g, '\\"') + '"';
  }
  return key;
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
    lines.push('  ' + quoteKey(filePath) + ':');
    lines.push('    status: ' + (f.status || 'active'));
    lines.push('    source: "' + (f.source || 'claude').replace(/"/g, '\\"') + '"');
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
      lines.push('        source: "' + (log[c].source || 'claude').replace(/"/g, '\\"') + '"');
      // Preserve commit message if present (set by migration script).
      if (log[c].message) {
        lines.push('        message: "' + String(log[c].message).replace(/"/g, '\\"').slice(0, 200) + '"');
      }
    }
    if (log.length === 0) lines.push('      []');
  }

  return lines.join('\n') + '\n';
}

// --- Folder summaries (issue #17) ---
//
// blueprints/_summaries.yaml is a flat path-keyed map of folder
// descriptions. This hook only marks existing entries as `stale: true`
// when a file inside the folder is written or edited. Generation lives
// in /omniscitus-migrate; refresh lives in /wrap-up.
//
// Schema:
//   summaries:
//     src:
//       description: "..."
//       generated_at: 2026-04-10
//       generated_by: migrate
//       stale: false
//       file_count: 37

function parseSummaries(text) {
  var result = { summaries: {} };
  if (!text) return result;
  var lines = text.split('\n');
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var keyMatch = line.match(/^  ([^\s].*):\s*$/);
    if (keyMatch) {
      current = keyMatch[1].replace(/^["']|["']$/g, '');
      result.summaries[current] = {
        description: '', generated_at: '', generated_by: '',
        stale: false, file_count: 0
      };
      continue;
    }
    if (current) {
      var propMatch = line.match(/^    (description|generated_at|generated_by|stale|file_count):\s*(.*)/);
      if (propMatch) {
        var k = propMatch[1];
        var v = propMatch[2].replace(/^["']|["']$/g, '').trim();
        if (k === 'stale') v = (v === 'true');
        else if (k === 'file_count') v = parseInt(v, 10) || 0;
        result.summaries[current][k] = v;
      }
    }
  }
  return result;
}

function serializeSummaries(data) {
  var lines = ['# .omniscitus/blueprints/_summaries.yaml',
               '# Path-keyed folder descriptions. Generated by /omniscitus-migrate,',
               '# marked stale by the PostToolUse hook, refreshed by /wrap-up.',
               'summaries:'];
  var keys = Object.keys(data.summaries || {}).sort();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var s = data.summaries[k];
    lines.push('  ' + quoteKey(k) + ':');
    lines.push('    description: "' + (s.description || '').replace(/"/g, '\\"') + '"');
    lines.push('    generated_at: ' + (s.generated_at || ''));
    lines.push('    generated_by: ' + (s.generated_by || ''));
    lines.push('    stale: ' + (s.stale ? 'true' : 'false'));
    lines.push('    file_count: ' + (s.file_count || 0));
  }
  return lines.join('\n') + '\n';
}

function markAncestorSummariesStale(blueprintsDir, relPath) {
  var summariesPath = path.join(blueprintsDir, '_summaries.yaml');
  if (!fs.existsSync(summariesPath)) return; // nothing to mark — migrate hasn't run

  var text;
  try { text = fs.readFileSync(summariesPath, 'utf-8'); }
  catch (e) { return; }

  var data = parseSummaries(text);

  // Walk ancestor paths: src/app/api/foo.ts → src, src/app, src/app/api
  var parts = relPath.split('/');
  var anyChanged = false;
  for (var i = 1; i < parts.length; i++) {
    var ancestor = parts.slice(0, i).join('/');
    var entry = data.summaries[ancestor];
    if (entry && !entry.stale) {
      entry.stale = true;
      anyChanged = true;
    }
  }

  if (!anyChanged) return;

  var tmp = summariesPath + '.tmp';
  try {
    fs.writeFileSync(tmp, serializeSummaries(data), 'utf-8');
    fs.renameSync(tmp, summariesPath);
  } catch (e) { /* swallow — hook must never fail loud */ }
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
//
// Path → blueprint file is delegated to lib/blueprint-resolver.cjs so
// hooks, CLI commands, and the SessionStart warning all agree on the
// layout. The resolver respects blueprint_splits in migrate-config.yaml
// (RFC #10) for opt-in nested splits.
//
// The legacy flat helpers (getBlueprintKey/getBlueprintFilePath) are
// gone. Callers should use resolver.resolveBlueprintFile() directly.

// --- Main ---

// Optional debug logging. Set OMNISCITUS_DEBUG=1 in your Claude Code
// env (or settings.json) to have the hook append an entry to
// ${TMPDIR}/omniscitus-hook.log every time it fires. Zero overhead
// when the env var isn't set.
function debugLog(msg) {
  if (!process.env.OMNISCITUS_DEBUG) return;
  try {
    var os = require('os');
    var logPath = path.join(os.tmpdir(), 'omniscitus-hook.log');
    fs.appendFileSync(logPath, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) { /* never let logging break the hook */ }
}

// Extract a file path from the PostToolUse input. Write and Edit use
// tool_input.file_path; MultiEdit passes a list under tool_input.edits
// (each with file_path), but in practice the top-level file_path is
// also set for the primary file. NotebookEdit uses notebook_path.
function extractFilePath(input) {
  if (!input || !input.tool_input) return null;
  var ti = input.tool_input;
  if (ti.file_path) return ti.file_path;
  if (ti.path) return ti.path;
  if (ti.notebook_path) return ti.notebook_path;
  // MultiEdit: edits is an array of { file_path, ... }
  if (Array.isArray(ti.edits) && ti.edits.length > 0 && ti.edits[0].file_path) {
    return ti.edits[0].file_path;
  }
  return null;
}

async function main() {
  var input = await readStdin(2000);
  if (!input) {
    debugLog('abort no_stdin');
    return;
  }

  debugLog('invoked tool=' + (input.tool_name || 'unknown'));

  var filePath = extractFilePath(input);
  if (!filePath) {
    debugLog('abort no_file_path');
    return;
  }

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
  if (relPath.startsWith('.omniscitus')) {
    debugLog('skip inside_omniscitus path=' + relPath);
    return;
  }

  // Skip gitignored files
  try {
    childProcess.execSync('git check-ignore -q "' + relPath + '"', {
      cwd: projectRoot, timeout: 1000
    });
    // If check-ignore succeeds (exit 0), the file IS ignored → skip
    debugLog('skip gitignored path=' + relPath);
    return;
  } catch (e) {
    // Exit code 1 means NOT ignored → continue
  }

  // Determine which blueprint file holds this entry. With
  // blueprint_splits config the path may be nested (RFC #10), e.g.
  // .omniscitus/blueprints/_claude/skills.yaml.
  var splitConfig = resolver.loadSplitConfig(omniscitusDir);
  var blueprintPath = resolver.resolveBlueprintFile(relPath, splitConfig, omniscitusDir);

  // Ensure the parent directory exists for nested splits
  var blueprintParent = path.dirname(blueprintPath);
  if (!fs.existsSync(blueprintParent)) {
    fs.mkdirSync(blueprintParent, { recursive: true });
  }

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

  // Mark any ancestor folder summaries as stale so /wrap-up knows to
  // refresh them later. No-op if _summaries.yaml doesn't exist yet.
  markAncestorSummariesStale(blueprintsDir, relPath);

  debugLog('wrote blueprint=' + blueprintPath + ' rel=' + relPath);
}

main().catch(function (err) {
  debugLog('ERROR ' + (err && err.stack || err));
});
