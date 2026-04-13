'use strict';

/**
 * /weekly-backfill — generate `_weekly/{YYYY}-W{NN}.md` for every past
 * week that has history units but no summary yet. Smart-skips weeks that
 * already have a summary (idempotent — safe to run repeatedly).
 *
 * Fast mode (default): deterministic aggregation only. No LLM calls.
 *   Produces: Headline (counts), by-domain breakdown, unit titles,
 *   pending items. Good enough for migration-era backfill.
 *
 * The current (in-progress) week is always skipped — a week is only
 * summarized once its ISO Sunday is in the past.
 *
 * Usage:
 *   node scripts/weekly-backfill.cjs [project-root]
 *
 * Called by the /weekly-backfill skill. Can also be run directly.
 */

var fs = require('fs');
var path = require('path');

// ── CLI + paths ────────────────────────────────────────

var PROJECT_ROOT = process.argv[2] || process.cwd();
var HISTORY_DIR = path.join(PROJECT_ROOT, '.omniscitus', 'history');
var INDEX_PATH = path.join(HISTORY_DIR, '_index.yaml');
var WEEKLY_DIR = path.join(HISTORY_DIR, '_weekly');

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code || 1);
}

if (!fs.existsSync(INDEX_PATH)) {
  die('[weekly-backfill] No _index.yaml found at ' + INDEX_PATH + '. Run /omniscitus-migrate first.');
}

// ── ISO week helpers ───────────────────────────────────

/**
 * ISO 8601 week-numbering: returns { year, week }.
 * Note: ISO year may differ from calendar year at year boundaries
 * (e.g., Jan 1 2023 → {year: 2022, week: 52}).
 */
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

/**
 * ISO week Monday + Sunday (UTC-safe). Returns YYYY-MM-DD strings.
 */
function weekBounds(year, week) {
  // Monday of week 1 is the Monday of the week containing Jan 4.
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

// ── Minimal _index.yaml parser (just enough for this job) ──

function parseUnits(text) {
  var units = [];
  if (!text) return units;
  var lines = text.split('\n');
  var current = null;
  var inWeekly = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^weekly_summaries\s*:/.test(line)) { if (current) { units.push(current); current = null; } inWeekly = true; continue; }
    if (inWeekly && /^\S/.test(line)) inWeekly = false;
    if (inWeekly) continue;

    var idMatch = line.match(/^\s*- id:\s*(.+)/);
    if (idMatch) {
      if (current) units.push(current);
      current = {
        id: idMatch[1].trim(),
        domain: '', status: 'open', created: '', last_updated: '',
        session_count: 0, title: '', file: ''
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
  // Return a Set of "YYYY-Www" strings already present in weekly_summaries.
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

// ── Grouping + summary generation ──────────────────────

function extractDateIso(unit) {
  // Prefer last_updated, fall back to created. Accept "YYYY-MM-DD..." strings.
  var raw = unit.last_updated || unit.created || '';
  var m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function groupByWeek(units) {
  // Map "YYYY-Www" → { weekKey, year, week, units: [...] }
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

function isCompletedWeek(year, week, now) {
  var bounds = weekBounds(year, week);
  var sunday = new Date(bounds.end + 'T23:59:59Z');
  return sunday < now;
}

/**
 * Deterministic summary — no LLM. Good-enough Headline + by-domain
 * breakdown + title list. Rich narrative synthesis is a separate flag.
 */
function renderSummary(group) {
  var bounds = weekBounds(group.year, group.week);
  var units = group.units;

  // By-domain breakdown
  var byDomain = {};
  for (var i = 0; i < units.length; i++) {
    var d = units[i].domain || 'uncategorized';
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(units[i]);
  }
  var domainNames = Object.keys(byDomain).sort(function (a, b) {
    return byDomain[b].length - byDomain[a].length;
  });

  // Status counts
  var open = 0, closed = 0;
  for (var j = 0; j < units.length; j++) {
    if (units[j].status === 'open') open++;
    else if (units[j].status === 'closed') closed++;
  }

  var lines = [];
  lines.push('# Week ' + group.weekKey + ' (' + bounds.start + ' – ' + bounds.end + ')');
  lines.push('');
  lines.push('## Headline');
  lines.push(units.length + ' unit' + (units.length !== 1 ? 's' : '') + ' touched across ' +
             domainNames.length + ' domain' + (domainNames.length !== 1 ? 's' : '') + '.');
  lines.push('');
  lines.push('## By Domain');
  for (var k = 0; k < domainNames.length; k++) {
    var dn = domainNames[k];
    var du = byDomain[dn];
    lines.push('');
    lines.push('### ' + dn + ' (' + du.length + ')');
    // Show up to first 10 titles; overflow is noted.
    var max = Math.min(du.length, 10);
    for (var m = 0; m < max; m++) {
      var title = du[m].title || du[m].id;
      var badge = du[m].status === 'open' ? ' _(open)_' : '';
      lines.push('- ' + title + badge);
    }
    if (du.length > max) {
      lines.push('- _… and ' + (du.length - max) + ' more_');
    }
  }
  lines.push('');
  lines.push('## Numbers');
  lines.push('- Units: ' + units.length);
  lines.push('- Closed: ' + closed);
  lines.push('- Open: ' + open);
  lines.push('- Domains: ' + domainNames.join(', '));
  lines.push('');
  lines.push('## Pending at Week End');
  var pendingShown = 0;
  for (var p = 0; p < units.length && pendingShown < 10; p++) {
    if (units[p].status === 'open') {
      lines.push('- [ ] ' + (units[p].title || units[p].id));
      pendingShown++;
    }
  }
  if (open === 0) lines.push('(none — all closed)');
  else if (pendingShown < open) lines.push('- _… and ' + (open - pendingShown) + ' more_');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_Generated by /weekly-backfill (fast mode — deterministic aggregation, no LLM)._');
  lines.push('');
  return lines.join('\n');
}

function appendWeeklySummaryEntry(indexText, entry) {
  // Append to weekly_summaries: block. If block doesn't exist, add it at end.
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
    // Ensure trailing newline, then append section.
    if (!indexText.endsWith('\n')) indexText += '\n';
    indexText += '\nweekly_summaries:\n' + newBlock.join('\n') + '\n';
    return indexText;
  }

  // Insert after existing entries but before a non-indented line.
  var insertAt = lines.length;
  for (var j = sectionIdx + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j]) && lines[j].trim().length > 0) { insertAt = j; break; }
  }
  // Trim trailing blank lines from the slice we insert before
  lines.splice.apply(lines, [insertAt, 0].concat(newBlock));
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────

function main() {
  var indexText = fs.readFileSync(INDEX_PATH, 'utf-8');
  var units = parseUnits(indexText);
  var existing = parseExistingWeeklyKeys(indexText);

  if (units.length === 0) {
    console.log('[weekly-backfill] No units in _index.yaml. Nothing to do.');
    return;
  }

  if (!fs.existsSync(WEEKLY_DIR)) fs.mkdirSync(WEEKLY_DIR, { recursive: true });

  var groups = groupByWeek(units);
  var sortedKeys = Array.from(groups.keys()).sort();
  var now = new Date();
  var today = formatYmd(now);

  var counts = { created: 0, skippedExisting: 0, skippedCurrent: 0, skippedFileOnDisk: 0 };
  var workingText = indexText;

  for (var i = 0; i < sortedKeys.length; i++) {
    var key = sortedKeys[i];
    var group = groups.get(key);

    // Smart-skip 1: already in weekly_summaries block
    if (existing.has(key)) {
      counts.skippedExisting++;
      continue;
    }

    // Smart-skip 2: incomplete week
    if (!isCompletedWeek(group.year, group.week, now)) {
      counts.skippedCurrent++;
      continue;
    }

    // Smart-skip 3: md already on disk (partial state — user deleted
    // _index.yaml entry but file survived). Keep file, just add index entry.
    var filename = key + '.md';
    var mdPath = path.join(WEEKLY_DIR, filename);
    var wroteFile = false;
    if (fs.existsSync(mdPath)) {
      counts.skippedFileOnDisk++;
    } else {
      fs.writeFileSync(mdPath, renderSummary(group), 'utf-8');
      wroteFile = true;
    }

    // Append index entry
    var bounds = weekBounds(group.year, group.week);
    var domainNames = Array.from(new Set(group.units.map(function (u) { return u.domain || 'uncategorized'; }))).sort();
    workingText = appendWeeklySummaryEntry(workingText, {
      week: key,
      file: '_weekly/' + filename,
      start: bounds.start,
      end: bounds.end,
      unit_count: group.units.length,
      domains: domainNames,
      generated_at: today
    });
    if (wroteFile) counts.created++;
  }

  if (workingText !== indexText) {
    fs.writeFileSync(INDEX_PATH, workingText, 'utf-8');
  }

  console.log('[weekly-backfill] Done.');
  console.log('  Created:        ' + counts.created + ' weekly summary file(s)');
  console.log('  Skipped (existing index entry): ' + counts.skippedExisting);
  console.log('  Skipped (md on disk, added to index): ' + counts.skippedFileOnDisk);
  console.log('  Skipped (in-progress week): ' + counts.skippedCurrent);
  console.log('  Weekly summaries dir: ' + path.relative(PROJECT_ROOT, WEEKLY_DIR));
}

// Run when invoked as CLI; export helpers for tests.
if (require.main === module) {
  try { main(); }
  catch (err) { die('[weekly-backfill] Error: ' + err.message); }
}

module.exports = {
  isoWeek: isoWeek,
  weekLabel: weekLabel,
  weekBounds: weekBounds,
  parseUnits: parseUnits,
  parseExistingWeeklyKeys: parseExistingWeeklyKeys,
  groupByWeek: groupByWeek,
  isCompletedWeek: isCompletedWeek,
  renderSummary: renderSummary,
  appendWeeklySummaryEntry: appendWeeklySummaryEntry
};
