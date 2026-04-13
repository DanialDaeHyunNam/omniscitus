'use strict';

/**
 * /weekly-backfill helper script. Produces a candidate list of weeks
 * needing a rich summary, and registers a summary in _index.yaml after
 * the skill writes the file.
 *
 * The actual narrative synthesis happens in the SKILL.md instructions
 * — this script is just the deterministic plumbing (week math, smart-skip
 * detection, _index.yaml manipulation).
 *
 * CLI subcommands:
 *   node weekly-backfill.cjs candidates [project-root]
 *     → prints JSON listing weeks that need rich summaries.
 *
 *   node weekly-backfill.cjs register <week> <file> <start> <end>
 *                             <unit_count> <domains_csv> [project-root]
 *     → appends an entry to _index.yaml weekly_summaries.
 *
 *   node weekly-backfill.cjs status [project-root]   (default)
 *     → human-readable summary of what's pending.
 *
 * Smart-skip rules:
 *   - In-progress (current ISO) week is always skipped.
 *   - Existing _weekly/{key}.md with the rich-mode watermark is skipped.
 *   - Existing _weekly/{key}.md with the legacy fast-mode watermark is
 *     marked as `upgrade` (it was generated before rich mode existed).
 *   - Any other existing _weekly/{key}.md is treated as user-authored
 *     and skipped.
 *   - Files present on disk but missing from _index.yaml weekly_summaries
 *     get a `register` action so the index stays in sync.
 */

var fs = require('fs');
var path = require('path');

// Watermarks that mark a file as machine-generated and therefore safe
// to overwrite. Any other content (or no content) is treated as
// user-authored and left alone.
var RICH_MODE_WATERMARK = '/weekly-backfill (rich mode';
var FAST_MODE_WATERMARK = '/weekly-backfill (fast mode';

// ── ISO week helpers ───────────────────────────────────

function isoWeek(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNum };
}

function weekLabel(year, week) {
  return year + '-W' + (week < 10 ? '0' + week : String(week));
}

function weekBounds(year, week) {
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Dow = jan4.getUTCDay() || 7;
  var mondayOfW1 = new Date(jan4);
  mondayOfW1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  var monday = new Date(mondayOfW1);
  monday.setUTCDate(mondayOfW1.getUTCDate() + (week - 1) * 7);
  var sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: formatYmd(monday), end: formatYmd(sunday) };
}

function formatYmd(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var dd = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function isCompletedWeek(year, week, now) {
  var bounds = weekBounds(year, week);
  var sunday = new Date(bounds.end + 'T23:59:59Z');
  return sunday < now;
}

// ── _index.yaml parser (minimal — only the fields we need) ──

function parseUnits(text) {
  var units = [];
  if (!text) return units;
  var lines = text.split('\n');
  var current = null;
  var inWeekly = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^weekly_summaries\s*:/.test(line)) {
      if (current) { units.push(current); current = null; }
      inWeekly = true;
      continue;
    }
    if (inWeekly && /^\S/.test(line)) inWeekly = false;
    if (inWeekly) continue;

    var idMatch = line.match(/^\s*- id:\s*(.+)/);
    if (idMatch) {
      if (current) units.push(current);
      current = {
        id: idMatch[1].trim(),
        domain: '', status: 'open', created: '', last_updated: '',
        session_count: 0, title: '', file: '', author: ''
      };
      continue;
    }
    if (current) {
      var m = line.match(/^\s+(domain|status|created|last_updated|session_count|title|file|author):\s*(.*)/);
      if (m) {
        var v = m[2].replace(/^["']|["']$/g, '').trim();
        if (m[1] === 'session_count') v = parseInt(v) || 0;
        current[m[1]] = v;
      }
    }
  }
  if (current) units.push(current);
  return units;
}

function parseExistingWeeklyKeys(text) {
  var seen = new Set();
  if (!text) return seen;
  var lines = text.split('\n');
  var inSection = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^weekly_summaries\s*:/.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (/^\S/.test(line) && line.trim().length > 0) { inSection = false; continue; }
    var m = line.match(/^\s*- week:\s*["']?([^"'\s]+)["']?/);
    if (m) seen.add(m[1]);
  }
  return seen;
}

function appendWeeklySummaryEntry(indexText, entry) {
  var lines = indexText.split('\n');
  var sectionIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^weekly_summaries\s*:/.test(lines[i])) { sectionIdx = i; break; }
  }
  var newBlock = [
    '  - week: "' + entry.week + '"',
    '    file: "' + entry.file + '"',
    '    start: "' + entry.start + '"',
    '    end: "' + entry.end + '"',
    '    unit_count: ' + entry.unit_count,
    '    domains: [' + entry.domains.join(', ') + ']',
    '    generated_at: "' + entry.generated_at + '"'
  ];
  if (sectionIdx === -1) {
    if (!indexText.endsWith('\n')) indexText += '\n';
    return indexText + '\nweekly_summaries:\n' + newBlock.join('\n') + '\n';
  }
  var insertAt = lines.length;
  for (var j = sectionIdx + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j]) && lines[j].trim().length > 0) { insertAt = j; break; }
  }
  lines.splice.apply(lines, [insertAt, 0].concat(newBlock));
  return lines.join('\n');
}

// ── Source extraction (per-unit) ───────────────────────

/**
 * Read a unit markdown file, return its `Source:` field — the path
 * (relative to project root) of the original done/session/etc. doc this
 * unit was migrated from. Return null if the unit has no Source field
 * (e.g., a wrap-up-created unit that was authored in place).
 */
function extractSourceFromUnit(absUnitPath) {
  try {
    var text = fs.readFileSync(absUnitPath, 'utf-8');
    // Match: **Source**: `path` OR Source: path
    var m = text.match(/\*\*Source\*\*:\s*`?([^`\n]+)`?/);
    if (m) return m[1].trim();
    var m2 = text.match(/^Source:\s*(.+)$/m);
    if (m2) return m2[1].trim();
    return null;
  } catch (e) { return null; }
}

// ── Date extraction (unit → ISO week) ──────────────────

function extractDateIso(unit) {
  var raw = unit.last_updated || unit.created || '';
  var m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function groupByWeek(units) {
  var map = new Map();
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    var ymd = extractDateIso(u);
    if (!ymd) continue;
    var parts = ymd.split('-');
    var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    var iw = isoWeek(date);
    var key = weekLabel(iw.year, iw.week);
    if (!map.has(key)) {
      map.set(key, { weekKey: key, year: iw.year, week: iw.week, units: [] });
    }
    map.get(key).units.push(u);
  }
  return map;
}

// ── Existing-file classification ───────────────────────

/**
 * Read the existing _weekly/{key}.md if any and classify it:
 *   'missing'  — file does not exist
 *   'rich'     — already has rich-mode watermark, skip
 *   'fast'     — has legacy fast-mode watermark, eligible for upgrade
 *   'manual'   — exists but no recognized watermark, treat as user-authored
 */
function classifyExistingFile(filePath) {
  if (!fs.existsSync(filePath)) return 'missing';
  try {
    var text = fs.readFileSync(filePath, 'utf-8');
    if (text.indexOf(RICH_MODE_WATERMARK) !== -1) return 'rich';
    if (text.indexOf(FAST_MODE_WATERMARK) !== -1) return 'fast';
    return 'manual';
  } catch (e) { return 'manual'; }
}

// ── Candidate listing ──────────────────────────────────

function listCandidates(projectRoot, opts) {
  opts = opts || {};
  var includeUpgrade = opts.includeUpgrade !== false; // default: include fast-mode upgrades

  var historyDir = path.join(projectRoot, '.omniscitus', 'history');
  var indexPath = path.join(historyDir, '_index.yaml');
  var weeklyDir = path.join(historyDir, '_weekly');

  if (!fs.existsSync(indexPath)) {
    return { error: 'no-index', indexPath: indexPath };
  }

  var indexText = fs.readFileSync(indexPath, 'utf-8');
  var units = parseUnits(indexText);
  var indexedKeys = parseExistingWeeklyKeys(indexText);
  var groups = groupByWeek(units);
  var sortedKeys = Array.from(groups.keys()).sort();
  var now = new Date();

  var weeks = [];
  var skipped = { in_progress: 0, rich: 0, manual: 0 };

  for (var i = 0; i < sortedKeys.length; i++) {
    var key = sortedKeys[i];
    var group = groups.get(key);

    if (!isCompletedWeek(group.year, group.week, now)) {
      skipped.in_progress++;
      continue;
    }

    var bounds = weekBounds(group.year, group.week);
    var filename = key + '.md';
    var absFile = path.join(weeklyDir, filename);
    var classification = classifyExistingFile(absFile);

    if (classification === 'rich') { skipped.rich++; continue; }
    if (classification === 'manual') { skipped.manual++; continue; }
    if (classification === 'fast' && !includeUpgrade) {
      skipped.manual++; // treat as off-limits when caller declined upgrades
      continue;
    }

    // Enrich each unit with absolute source path so the skill can read it.
    var enrichedUnits = group.units.map(function (u) {
      var unitFileAbs = u.file
        ? path.join(historyDir, u.file)
        : null;
      var sourceRel = unitFileAbs ? extractSourceFromUnit(unitFileAbs) : null;
      return {
        id: u.id,
        title: u.title,
        domain: u.domain,
        status: u.status,
        author: u.author || '',
        unit_file: u.file ? u.file : null,
        unit_file_abs: unitFileAbs,
        source: sourceRel,
        source_abs: sourceRel ? path.join(projectRoot, sourceRel) : null
      };
    });

    var domains = Array.from(new Set(enrichedUnits.map(function (u) {
      return u.domain || 'uncategorized';
    }))).sort();

    weeks.push({
      week: key,
      year: group.year,
      week_num: group.week,
      start: bounds.start,
      end: bounds.end,
      action: classification === 'fast' ? 'upgrade' : 'create',
      already_in_index: indexedKeys.has(key),
      file_path: '_weekly/' + filename,
      file_path_abs: absFile,
      unit_count: enrichedUnits.length,
      domains: domains,
      units: enrichedUnits
    });
  }

  return {
    project_root: projectRoot,
    weekly_dir: '_weekly',
    weekly_dir_abs: weeklyDir,
    candidates: weeks,
    summary: {
      total_candidates: weeks.length,
      to_create: weeks.filter(function (w) { return w.action === 'create'; }).length,
      to_upgrade: weeks.filter(function (w) { return w.action === 'upgrade'; }).length,
      skipped_in_progress: skipped.in_progress,
      skipped_already_rich: skipped.rich,
      skipped_user_authored: skipped.manual
    }
  };
}

// ── Index registration ─────────────────────────────────

function registerSummary(projectRoot, entry) {
  var indexPath = path.join(projectRoot, '.omniscitus', 'history', '_index.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new Error('No _index.yaml at ' + indexPath);
  }
  var weeklyDir = path.join(projectRoot, '.omniscitus', 'history', '_weekly');
  if (!fs.existsSync(weeklyDir)) fs.mkdirSync(weeklyDir, { recursive: true });

  var text = fs.readFileSync(indexPath, 'utf-8');

  // Idempotent: if this week is already in the index, skip the append
  // (the file may have been overwritten with new content but the index
  // entry already exists from a prior run).
  if (parseExistingWeeklyKeys(text).has(entry.week)) {
    return { registered: false, reason: 'already-indexed' };
  }

  var updated = appendWeeklySummaryEntry(text, entry);
  fs.writeFileSync(indexPath, updated, 'utf-8');
  return { registered: true };
}

// ── CLI ────────────────────────────────────────────────

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code || 1);
}

function cliCandidates(projectRoot) {
  var result = listCandidates(projectRoot);
  if (result.error === 'no-index') {
    die('[weekly-backfill] No _index.yaml at ' + result.indexPath +
        '. Run /omniscitus-migrate or /wrap-up first.');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function cliRegister(args, projectRoot) {
  if (args.length < 6) {
    die('Usage: register <week> <file> <start> <end> <unit_count> <domains_csv> [project-root]');
  }
  var entry = {
    week: args[0],
    file: args[1],
    start: args[2],
    end: args[3],
    unit_count: parseInt(args[4], 10) || 0,
    domains: args[5].split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    generated_at: formatYmd(new Date())
  };
  var result = registerSummary(projectRoot, entry);
  if (result.registered) {
    process.stdout.write('[weekly-backfill] Registered ' + entry.week + ' in _index.yaml.\n');
  } else {
    process.stdout.write('[weekly-backfill] ' + entry.week + ' already indexed (no-op).\n');
  }
}

function cliStatus(projectRoot) {
  var result = listCandidates(projectRoot);
  if (result.error === 'no-index') {
    die('[weekly-backfill] No _index.yaml at ' + result.indexPath);
  }
  var s = result.summary;
  console.log('[weekly-backfill] Candidate weeks:');
  console.log('  To create (no file):       ' + s.to_create);
  console.log('  To upgrade (fast→rich):    ' + s.to_upgrade);
  console.log('  Skipped — in-progress:     ' + s.skipped_in_progress);
  console.log('  Skipped — already rich:    ' + s.skipped_already_rich);
  console.log('  Skipped — user-authored:   ' + s.skipped_user_authored);
  if (result.candidates.length > 0) {
    console.log('');
    console.log('Run via /weekly-backfill skill for rich synthesis, or:');
    console.log('  node ' + path.basename(__filename) + ' candidates  # JSON for tooling');
  }
}

function main() {
  var argv = process.argv.slice(2);
  var subcommand = argv[0];
  var projectRoot;

  if (!subcommand || subcommand === 'status') {
    projectRoot = argv[1] || process.cwd();
    cliStatus(projectRoot);
  } else if (subcommand === 'candidates') {
    projectRoot = argv[1] || process.cwd();
    cliCandidates(projectRoot);
  } else if (subcommand === 'register') {
    var rest = argv.slice(1);
    // Last arg is project root if it's a directory; otherwise default to cwd.
    if (rest.length >= 7 && fs.existsSync(rest[6]) && fs.statSync(rest[6]).isDirectory()) {
      projectRoot = rest[6];
      rest = rest.slice(0, 6);
    } else {
      projectRoot = process.cwd();
    }
    cliRegister(rest, projectRoot);
  } else {
    die('Unknown subcommand: ' + subcommand + '\n' +
        'Use: status | candidates | register <args>');
  }
}

if (require.main === module) {
  try { main(); }
  catch (err) { die('[weekly-backfill] Error: ' + (err.stack || err.message)); }
}

module.exports = {
  isoWeek: isoWeek,
  weekLabel: weekLabel,
  weekBounds: weekBounds,
  isCompletedWeek: isCompletedWeek,
  parseUnits: parseUnits,
  parseExistingWeeklyKeys: parseExistingWeeklyKeys,
  appendWeeklySummaryEntry: appendWeeklySummaryEntry,
  extractSourceFromUnit: extractSourceFromUnit,
  groupByWeek: groupByWeek,
  classifyExistingFile: classifyExistingFile,
  listCandidates: listCandidates,
  registerSummary: registerSummary,
  RICH_MODE_WATERMARK: RICH_MODE_WATERMARK,
  FAST_MODE_WATERMARK: FAST_MODE_WATERMARK
};
