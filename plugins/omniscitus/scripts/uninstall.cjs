'use strict';

/**
 * /omniscitus-uninstall helper script.
 *
 * Reads .omniscitus/migrate/anchor.yaml (recorded by /omniscitus-migrate)
 * and reverses every footprint entry. Three reversal strategies depending
 * on the entry's `action`:
 *
 *   appended  — surgical section removal by marker. The marker line is the
 *               first line removed; the next sibling-or-higher heading
 *               (or EOF, or a blockquote-block boundary for `> **...**`
 *               markers) bounds the removal. Trailing blank lines are
 *               normalized so the file doesn't accumulate empty space.
 *
 *   modified  — `git checkout {anchor.sha} -- <path>`. Whole-file restore.
 *               Loses any post-migration edits to the same file. We warn
 *               the user about this trade-off in the dry-run preview.
 *
 *   created   — delete the file.
 *
 *   deleted   — `git checkout {anchor.sha} -- <path>` to restore from
 *               the anchor commit.
 *
 * After all footprint entries are processed, removes the .omniscitus/
 * directory entirely.
 *
 * CLI:
 *   node uninstall.cjs dry-run [project-root]
 *   node uninstall.cjs execute [project-root]
 *   node uninstall.cjs status  [project-root]   (default — read-only)
 *
 * Designed to be invoked by the /omniscitus-uninstall skill, which
 * handles the AskUserQuestion confirmation between dry-run and execute.
 * Direct CLI use is supported and idempotent (safe to re-run).
 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

// ── Anchor + footprint parsing ─────────────────────────

/**
 * Parse anchor.yaml. Returns { anchor: { sha, branch, ... }, footprint: [...] }
 * or null if the file doesn't exist / can't be parsed.
 */
function parseAnchor(text) {
  if (!text) return null;
  var lines = text.split('\n');
  var result = { anchor: {}, footprint: [] };
  var section = null;
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (/^anchor\s*:\s*$/.test(line)) { section = 'anchor'; continue; }
    if (/^footprint\s*:\s*$/.test(line)) {
      if (current) { result.footprint.push(current); current = null; }
      section = 'footprint';
      continue;
    }
    if (/^notes\s*:/.test(line)) { section = 'notes'; continue; }

    if (section === 'anchor') {
      var am = line.match(/^\s+(sha|branch|timestamp|git_project|backfilled)\s*:\s*(.+)$/);
      if (am) {
        var av = am[2].replace(/^["']|["']$/g, '').trim();
        if (am[1] === 'git_project' || am[1] === 'backfilled') av = (av === 'true');
        result.anchor[am[1]] = av;
      }
      continue;
    }

    if (section === 'footprint') {
      var pm = line.match(/^\s*-\s*path\s*:\s*(.+)$/);
      if (pm) {
        if (current) result.footprint.push(current);
        current = { path: pm[1].replace(/^["']|["']$/g, '').trim() };
        continue;
      }
      if (current) {
        var fm = line.match(/^\s+(action|marker|by|timestamp|notes)\s*:\s*(.+)$/);
        if (fm) {
          var fv = fm[2].replace(/^["']|["']$/g, '').trim();
          current[fm[1]] = fv;
        }
      }
    }
  }
  if (current) result.footprint.push(current);
  return result;
}

// ── Section removal (marker-based) ─────────────────────

/**
 * Detect what kind of marker we're dealing with so the section bound
 * can be determined correctly.
 *   'heading'    — `### foo` / `## foo` / `# foo`
 *   'blockquote' — `> **...**` (banner injected into INTRODUCTION.md)
 *   'literal'    — anything else; treated as a single-line landmark
 */
function classifyMarker(marker) {
  var m = marker.trim();
  if (/^(#{1,6})\s/.test(m)) return 'heading';
  if (/^>\s/.test(m)) return 'blockquote';
  return 'literal';
}

function headingLevel(line) {
  var m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

/**
 * Remove a marker-bounded section from a file's contents.
 *
 * Returns { removed: <int lines>, content: <new content>, found: <bool> }.
 * If the marker isn't present, returns { removed: 0, content: original, found: false }
 * — caller treats as "already cleaned up by hand, no-op".
 */
function removeAppendedSection(text, marker) {
  if (!text || !marker) return { removed: 0, content: text || '', found: false };

  var lines = text.split('\n');
  var startIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(marker) === 0 || lines[i].trim() === marker.trim()) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return { removed: 0, content: text, found: false };

  var kind = classifyMarker(marker);
  var endIdx = lines.length; // exclusive

  if (kind === 'heading') {
    var startLvl = headingLevel(lines[startIdx]);
    for (var j = startIdx + 1; j < lines.length; j++) {
      var lvl = headingLevel(lines[j]);
      if (lvl > 0 && lvl <= startLvl) { endIdx = j; break; }
    }
  } else if (kind === 'blockquote') {
    // The injected banner is a contiguous block of `> ` lines, possibly
    // with one or two blank lines after. Scan past the blockquote, then
    // past one trailing blank line, and stop.
    var k = startIdx + 1;
    while (k < lines.length && /^>\s|^>$/.test(lines[k])) k++;
    // Skip up to 2 trailing blank lines so the file doesn't grow gaps
    while (k < lines.length && lines[k].trim() === '' && (k - startIdx) < 100) {
      k++;
      if (k < lines.length && lines[k].trim() !== '' && !/^>\s|^>$/.test(lines[k])) break;
    }
    endIdx = k;
  } else {
    // Literal marker — only remove that one line
    endIdx = startIdx + 1;
  }

  // Also trim trailing blank lines that would be left dangling
  while (endIdx > startIdx + 1 && lines[endIdx - 1].trim() === '') endIdx--;

  var removed = endIdx - startIdx;
  var newLines = lines.slice(0, startIdx).concat(lines.slice(endIdx));

  // Normalize: collapse 3+ consecutive blank lines into max 2
  var out = [];
  var blanks = 0;
  for (var x = 0; x < newLines.length; x++) {
    if (newLines[x].trim() === '') {
      blanks++;
      if (blanks <= 2) out.push(newLines[x]);
    } else {
      blanks = 0;
      out.push(newLines[x]);
    }
  }

  return { removed: removed, content: out.join('\n'), found: true };
}

// ── Git helpers ────────────────────────────────────────

function isGitRepo(projectRoot) {
  try {
    childProcess.execSync('git rev-parse --show-toplevel', {
      cwd: projectRoot, stdio: 'ignore'
    });
    return true;
  } catch (e) { return false; }
}

function gitTreeIsClean(projectRoot) {
  try {
    var out = childProcess.execSync('git status --porcelain', {
      cwd: projectRoot, encoding: 'utf-8'
    }).trim();
    return out.length === 0;
  } catch (e) { return false; }
}

function shaIsReachable(projectRoot, sha) {
  if (!sha) return false;
  try {
    childProcess.execSync('git cat-file -e ' + sha + '^{commit}', {
      cwd: projectRoot, stdio: 'ignore'
    });
    return true;
  } catch (e) { return false; }
}

function gitCheckoutFile(projectRoot, sha, relPath) {
  try {
    childProcess.execSync('git checkout ' + sha + ' -- ' + JSON.stringify(relPath), {
      cwd: projectRoot, stdio: 'pipe'
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Plan generation (dry-run engine) ───────────────────

/**
 * For a given footprint, produce a plan: array of action descriptors.
 * Doesn't touch the filesystem — pure read of state to predict actions.
 */
function buildPlan(projectRoot, anchorData) {
  var plan = [];
  var sha = anchorData.anchor.sha;
  var shaOk = shaIsReachable(projectRoot, sha);

  for (var i = 0; i < anchorData.footprint.length; i++) {
    var entry = anchorData.footprint[i];
    var absPath = path.isAbsolute(entry.path)
      ? entry.path
      : path.join(projectRoot, entry.path);
    var step = { entry: entry, absPath: absPath, status: '', detail: '' };

    if (entry.action === 'appended') {
      if (!fs.existsSync(absPath)) {
        step.status = 'skip';
        step.detail = 'file no longer exists';
      } else if (!entry.marker) {
        step.status = 'warn';
        step.detail = 'no marker recorded — cannot surgically remove (run git checkout manually)';
      } else {
        var text = fs.readFileSync(absPath, 'utf-8');
        var probe = removeAppendedSection(text, entry.marker);
        if (probe.found) {
          step.status = 'remove-section';
          step.detail = probe.removed + ' lines via marker "' + entry.marker.slice(0, 40) + '"';
        } else {
          step.status = 'skip';
          step.detail = 'marker not found — already cleaned up?';
        }
      }
    } else if (entry.action === 'modified') {
      if (!shaOk) {
        step.status = 'warn';
        step.detail = 'anchor SHA unreachable — cannot git checkout';
      } else if (!fs.existsSync(absPath)) {
        step.status = 'restore';
        step.detail = 'file missing — git checkout from anchor';
      } else {
        step.status = 'git-checkout';
        step.detail = 'whole-file restore from anchor SHA (loses post-migration edits)';
      }
    } else if (entry.action === 'created') {
      if (!fs.existsSync(absPath)) {
        step.status = 'skip';
        step.detail = 'already deleted';
      } else {
        step.status = 'delete';
        step.detail = 'rm';
      }
    } else if (entry.action === 'deleted') {
      if (fs.existsSync(absPath)) {
        step.status = 'skip';
        step.detail = 'file present — assumed manually restored';
      } else if (!shaOk) {
        step.status = 'warn';
        step.detail = 'anchor SHA unreachable — cannot restore';
      } else {
        step.status = 'restore';
        step.detail = 'git checkout from anchor';
      }
    } else {
      step.status = 'warn';
      step.detail = 'unknown action: ' + entry.action;
    }

    plan.push(step);
  }

  return plan;
}

// ── Plan execution ─────────────────────────────────────

function executePlan(projectRoot, plan, anchorData) {
  var report = { applied: [], skipped: [], warnings: [], errors: [] };
  var sha = anchorData.anchor.sha;

  for (var i = 0; i < plan.length; i++) {
    var step = plan[i];
    var entry = step.entry;

    if (step.status === 'skip') {
      report.skipped.push(entry.path + ' — ' + step.detail);
      continue;
    }
    if (step.status === 'warn') {
      report.warnings.push(entry.path + ' — ' + step.detail);
      continue;
    }

    try {
      if (step.status === 'remove-section') {
        var text = fs.readFileSync(step.absPath, 'utf-8');
        var result = removeAppendedSection(text, entry.marker);
        if (!result.found) {
          report.skipped.push(entry.path + ' — marker disappeared between dry-run and execute');
        } else {
          var tmp = step.absPath + '.tmp';
          fs.writeFileSync(tmp, result.content, 'utf-8');
          fs.renameSync(tmp, step.absPath);
          report.applied.push(entry.path + ' — removed ' + result.removed + ' lines');
        }
      } else if (step.status === 'git-checkout' || step.status === 'restore') {
        var co = gitCheckoutFile(projectRoot, sha, entry.path);
        if (co.ok) {
          report.applied.push(entry.path + ' — git checkout ' + sha.slice(0, 7));
        } else {
          report.errors.push(entry.path + ' — git checkout failed: ' + co.error);
        }
      } else if (step.status === 'delete') {
        fs.unlinkSync(step.absPath);
        report.applied.push(entry.path + ' — deleted');
      }
    } catch (e) {
      report.errors.push(entry.path + ' — ' + e.message);
    }
  }

  return report;
}

function removeOmniscitusDir(projectRoot) {
  var dir = path.join(projectRoot, '.omniscitus');
  if (!fs.existsSync(dir)) return { removed: false, reason: 'already-gone' };
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: true };
}

// ── CLI ────────────────────────────────────────────────

function loadAnchorAt(projectRoot) {
  var anchorPath = path.join(projectRoot, '.omniscitus', 'migrate', 'anchor.yaml');
  if (!fs.existsSync(anchorPath)) return null;
  return parseAnchor(fs.readFileSync(anchorPath, 'utf-8'));
}

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code || 1);
}

function cliStatus(projectRoot) {
  var anchor = loadAnchorAt(projectRoot);
  if (!anchor) {
    die('[uninstall] No anchor.yaml at ' + path.join(projectRoot, '.omniscitus/migrate/anchor.yaml') +
        '. /omniscitus-migrate may not have run yet.');
  }
  console.log('[uninstall] Anchor:');
  console.log('  sha:         ' + (anchor.anchor.sha || '(none)'));
  console.log('  branch:      ' + (anchor.anchor.branch || '(none)'));
  console.log('  git_project: ' + (anchor.anchor.git_project ? 'true' : 'false'));
  console.log('  footprint entries: ' + anchor.footprint.length);
  var byAction = {};
  for (var i = 0; i < anchor.footprint.length; i++) {
    var a = anchor.footprint[i].action || 'unknown';
    byAction[a] = (byAction[a] || 0) + 1;
  }
  Object.keys(byAction).sort().forEach(function (a) {
    console.log('    ' + a + ': ' + byAction[a]);
  });
}

function cliDryRun(projectRoot) {
  var anchor = loadAnchorAt(projectRoot);
  if (!anchor) die('[uninstall] No anchor.yaml. Nothing to do.');

  var plan = buildPlan(projectRoot, anchor);
  var summary = { applied: 0, skipped: 0, warned: 0 };
  console.log('[uninstall] Dry-run plan (' + plan.length + ' entries):');
  console.log('');
  for (var i = 0; i < plan.length; i++) {
    var s = plan[i];
    var icon = s.status === 'skip' ? '⏭ '
             : s.status === 'warn' ? '⚠️ '
             : '→ ';
    console.log('  ' + icon + s.entry.path);
    console.log('     [' + s.status + '] ' + s.detail);
    if (s.status === 'skip') summary.skipped++;
    else if (s.status === 'warn') summary.warned++;
    else summary.applied++;
  }
  console.log('');
  console.log('Summary: apply ' + summary.applied + ', skip ' + summary.skipped + ', warn ' + summary.warned);
  console.log('After execute: .omniscitus/ directory will be removed.');
}

function cliExecute(projectRoot) {
  var anchor = loadAnchorAt(projectRoot);
  if (!anchor) die('[uninstall] No anchor.yaml. Nothing to do.');

  // Pre-flight
  if (anchor.anchor.git_project && !isGitRepo(projectRoot)) {
    die('[uninstall] Anchor recorded git_project=true but project is not a git repo now. Aborting.');
  }
  if (!gitTreeIsClean(projectRoot)) {
    process.stderr.write('[uninstall] WARNING: working tree has uncommitted changes. ' +
                         'Footprinted files will be overwritten/restored. Continue at your own risk.\n');
  }

  var plan = buildPlan(projectRoot, anchor);
  var report = executePlan(projectRoot, plan, anchor);

  console.log('[uninstall] Footprint reversal:');
  console.log('  Applied:  ' + report.applied.length);
  for (var a = 0; a < report.applied.length; a++) console.log('    ✓ ' + report.applied[a]);
  if (report.skipped.length > 0) {
    console.log('  Skipped:  ' + report.skipped.length);
    for (var s = 0; s < report.skipped.length; s++) console.log('    ⏭  ' + report.skipped[s]);
  }
  if (report.warnings.length > 0) {
    console.log('  Warnings: ' + report.warnings.length);
    for (var w = 0; w < report.warnings.length; w++) console.log('    ⚠️  ' + report.warnings[w]);
  }
  if (report.errors.length > 0) {
    console.log('  Errors:   ' + report.errors.length);
    for (var e = 0; e < report.errors.length; e++) console.log('    ✗ ' + report.errors[e]);
  }

  // Final: remove .omniscitus/
  var rm = removeOmniscitusDir(projectRoot);
  if (rm.removed) {
    console.log('  ✓ Removed .omniscitus/');
  } else {
    console.log('  ⏭  .omniscitus/ already gone');
  }

  console.log('');
  console.log('[uninstall] Done. Now run `/plugin uninstall omniscitus` to remove the plugin itself.');
}

function main() {
  var argv = process.argv.slice(2);
  var subcommand = argv[0];
  var projectRoot;

  if (!subcommand || subcommand === 'status') {
    projectRoot = argv[1] || process.cwd();
    cliStatus(projectRoot);
  } else if (subcommand === 'dry-run') {
    projectRoot = argv[1] || process.cwd();
    cliDryRun(projectRoot);
  } else if (subcommand === 'execute') {
    projectRoot = argv[1] || process.cwd();
    cliExecute(projectRoot);
  } else {
    die('Unknown subcommand: ' + subcommand + '\nUse: status | dry-run | execute');
  }
}

if (require.main === module) {
  try { main(); }
  catch (err) { die('[uninstall] Error: ' + (err.stack || err.message)); }
}

module.exports = {
  parseAnchor: parseAnchor,
  classifyMarker: classifyMarker,
  removeAppendedSection: removeAppendedSection,
  buildPlan: buildPlan,
  executePlan: executePlan
};
