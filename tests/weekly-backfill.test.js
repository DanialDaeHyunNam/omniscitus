'use strict';

/*
 * Unit tests for the /weekly-backfill helper script.
 *
 * The narrative synthesis itself happens in the SKILL.md (LLM-driven),
 * so these tests cover the deterministic plumbing only:
 *   - ISO week math
 *   - _index.yaml parsing
 *   - existing-file classification (rich / fast / manual / missing)
 *   - source-path extraction from unit files
 *   - candidate listing with smart-skip
 *   - summary registration in _index.yaml
 *
 * Run with:   node --test tests/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  isoWeek,
  weekLabel,
  weekBounds,
  isCompletedWeek,
  parseUnits,
  parseExistingWeeklyKeys,
  appendWeeklySummaryEntry,
  extractSourceFromUnit,
  groupByWeek,
  classifyExistingFile,
  listCandidates,
  registerSummary,
  RICH_MODE_WATERMARK,
  FAST_MODE_WATERMARK
} = require('../plugins/omniscitus/scripts/weekly-backfill.cjs');

// ── ISO week math ──────────────────────────────────────

test('isoWeek: 2026-04-06 Monday → 2026-W15', () => {
  assert.deepEqual(isoWeek(new Date(Date.UTC(2026, 3, 6))), { year: 2026, week: 15 });
});

test('isoWeek: 2023-01-01 Sunday → 2022-W52 (year boundary)', () => {
  assert.deepEqual(isoWeek(new Date(Date.UTC(2023, 0, 1))), { year: 2022, week: 52 });
});

test('weekLabel: zero-pads single-digit weeks', () => {
  assert.equal(weekLabel(2026, 2), '2026-W02');
  assert.equal(weekLabel(2026, 15), '2026-W15');
});

test('weekBounds: 2026-W15 → Mon Apr 6 to Sun Apr 12', () => {
  assert.deepEqual(weekBounds(2026, 15), { start: '2026-04-06', end: '2026-04-12' });
});

test('isCompletedWeek: past week true, in-progress false', () => {
  var now = new Date('2026-04-13T10:00:00Z');
  assert.equal(isCompletedWeek(2026, 14, now), true);
  assert.equal(isCompletedWeek(2026, 16, now), false);
});

// ── _index.yaml parsing ────────────────────────────────

test('parseUnits: extracts core fields, skips weekly_summaries block', () => {
  const yaml = [
    'units:',
    '  - id: alpha',
    '    domain: web',
    '    status: closed',
    '    last_updated: 2026-04-10',
    '    title: "Alpha"',
    '    file: web/2026-04-10-alpha.md',
    'weekly_summaries:',
    '  - week: "2026-W15"',
    ''
  ].join('\n');
  const units = parseUnits(yaml);
  assert.equal(units.length, 1);
  assert.equal(units[0].id, 'alpha');
  assert.equal(units[0].file, 'web/2026-04-10-alpha.md');
});

test('parseExistingWeeklyKeys: collects week labels regardless of quoting', () => {
  const yaml = [
    'units: []',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '  - week: 2026-W15',
    ''
  ].join('\n');
  const keys = parseExistingWeeklyKeys(yaml);
  assert.equal(keys.size, 2);
  assert.ok(keys.has('2026-W14'));
  assert.ok(keys.has('2026-W15'));
});

test('appendWeeklySummaryEntry: creates section when missing, appends when present', () => {
  const before = ['units:', '  - id: a', ''].join('\n');
  const after = appendWeeklySummaryEntry(before, {
    week: '2026-W15', file: '_weekly/2026-W15.md',
    start: '2026-04-06', end: '2026-04-12',
    unit_count: 3, domains: ['web', 'server'],
    generated_at: '2026-04-13'
  });
  assert.match(after, /weekly_summaries:/);
  assert.match(after, /- week: "2026-W15"/);
  assert.match(after, /domains: \[web, server\]/);

  const after2 = appendWeeklySummaryEntry(after, {
    week: '2026-W16', file: '_weekly/2026-W16.md',
    start: '2026-04-13', end: '2026-04-19',
    unit_count: 2, domains: ['web'],
    generated_at: '2026-04-20'
  });
  const keys = parseExistingWeeklyKeys(after2);
  assert.equal(keys.size, 2);
  assert.ok(keys.has('2026-W16'));
});

// ── extractSourceFromUnit ──────────────────────────────

test('extractSourceFromUnit: matches **Source**: `path` form', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-src-'));
  const unit = path.join(tmp, 'u.md');
  fs.writeFileSync(unit, [
    '# Some Unit',
    '',
    '## Summary',
    'Lorem ipsum.',
    '',
    '**Source**: `.claude/member/aria-web/done/foo.md`',
    ''
  ].join('\n'));
  try {
    assert.equal(extractSourceFromUnit(unit), '.claude/member/aria-web/done/foo.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractSourceFromUnit: matches plain Source: line', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-src-'));
  const unit = path.join(tmp, 'u.md');
  fs.writeFileSync(unit, [
    '# Title',
    '',
    'Source: docs/notes/2026-04-10.md',
    ''
  ].join('\n'));
  try {
    assert.equal(extractSourceFromUnit(unit), 'docs/notes/2026-04-10.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractSourceFromUnit: returns null when no Source field', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-src-'));
  const unit = path.join(tmp, 'u.md');
  fs.writeFileSync(unit, '# Title\n\nNo source field here.\n');
  try {
    assert.equal(extractSourceFromUnit(unit), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── groupByWeek ────────────────────────────────────────

test('groupByWeek: same-week units collide, different weeks split', () => {
  const units = [
    { id: 'a', last_updated: '2026-04-06', domain: 'web' },     // W15
    { id: 'b', last_updated: '2026-04-12', domain: 'server' },  // W15
    { id: 'c', last_updated: '2026-04-13', domain: 'web' }      // W16
  ];
  const groups = groupByWeek(units);
  assert.equal(groups.size, 2);
  assert.equal(groups.get('2026-W15').units.length, 2);
  assert.equal(groups.get('2026-W16').units.length, 1);
});

// ── classifyExistingFile ───────────────────────────────

test('classifyExistingFile: missing → "missing"', () => {
  assert.equal(classifyExistingFile('/no/such/path-' + Date.now()), 'missing');
});

test('classifyExistingFile: rich watermark → "rich"', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cls-'));
  const file = path.join(tmp, 'w.md');
  fs.writeFileSync(file, '# Body\n\n_Generated by ' + RICH_MODE_WATERMARK + ' — synthesized from .claude/member source docs)._\n');
  try {
    assert.equal(classifyExistingFile(file), 'rich');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyExistingFile: fast watermark → "fast"', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cls-'));
  const file = path.join(tmp, 'w.md');
  fs.writeFileSync(file, '# Body\n\n_Generated by ' + FAST_MODE_WATERMARK + ' — deterministic aggregation)._\n');
  try {
    assert.equal(classifyExistingFile(file), 'fast');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyExistingFile: no recognized watermark → "manual"', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cls-'));
  const file = path.join(tmp, 'w.md');
  fs.writeFileSync(file, '# My hand-written summary\n\nNotes go here.\n');
  try {
    assert.equal(classifyExistingFile(file), 'manual');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── listCandidates ─────────────────────────────────────

function buildFakeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-proj-'));
  const histDir = path.join(root, '.omniscitus', 'history');
  fs.mkdirSync(path.join(histDir, '_weekly'), { recursive: true });
  fs.mkdirSync(path.join(histDir, 'web'), { recursive: true });

  // Unit files (with Source: pointers)
  fs.writeFileSync(path.join(histDir, 'web', '2026-04-06-alpha.md'),
    '# Alpha\n\n**Source**: `notes/alpha.md`\n');
  fs.writeFileSync(path.join(histDir, 'web', '2026-04-10-beta.md'),
    '# Beta\n\n**Source**: `notes/beta.md`\n');

  // _index.yaml with units in W15 only
  fs.writeFileSync(path.join(histDir, '_index.yaml'), [
    'units:',
    '  - id: alpha',
    '    domain: web',
    '    status: closed',
    '    last_updated: 2026-04-06',
    '    title: "Alpha"',
    '    file: web/2026-04-06-alpha.md',
    '  - id: beta',
    '    domain: web',
    '    status: open',
    '    last_updated: 2026-04-10',
    '    title: "Beta"',
    '    file: web/2026-04-10-beta.md',
    ''
  ].join('\n'));

  // Source files (referenced by units)
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(path.join(root, 'notes', 'alpha.md'), '# Alpha source\nDetailed notes.\n');
  fs.writeFileSync(path.join(root, 'notes', 'beta.md'), '# Beta source\nMore notes.\n');

  return root;
}

test('listCandidates: returns one candidate for a week with units, no existing file', () => {
  const root = buildFakeProject();
  try {
    const result = listCandidates(root);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].week, '2026-W15');
    assert.equal(result.candidates[0].action, 'create');
    assert.equal(result.candidates[0].unit_count, 2);
    assert.equal(result.candidates[0].units[0].source, 'notes/alpha.md');
    assert.ok(result.candidates[0].units[0].source_abs.endsWith('notes/alpha.md'));
    assert.equal(result.summary.to_create, 1);
    assert.equal(result.summary.to_upgrade, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listCandidates: skips week with rich-mode file', () => {
  const root = buildFakeProject();
  try {
    fs.writeFileSync(
      path.join(root, '.omniscitus', 'history', '_weekly', '2026-W15.md'),
      '# Week 2026-W15\n\n_Generated by ' + RICH_MODE_WATERMARK + ' — ...)._\n'
    );
    const result = listCandidates(root);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.skipped_already_rich, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listCandidates: marks fast-mode file as upgrade candidate', () => {
  const root = buildFakeProject();
  try {
    fs.writeFileSync(
      path.join(root, '.omniscitus', 'history', '_weekly', '2026-W15.md'),
      '# Week 2026-W15\n\n_Generated by ' + FAST_MODE_WATERMARK + ' — ...)._\n'
    );
    const result = listCandidates(root);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].action, 'upgrade');
    assert.equal(result.summary.to_upgrade, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listCandidates: skips user-authored file (no watermark)', () => {
  const root = buildFakeProject();
  try {
    fs.writeFileSync(
      path.join(root, '.omniscitus', 'history', '_weekly', '2026-W15.md'),
      '# Hand-written summary by Daisy\n\nThis week we shipped X.\n'
    );
    const result = listCandidates(root);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.skipped_user_authored, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listCandidates: returns error when _index.yaml missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-proj-'));
  try {
    const result = listCandidates(root);
    assert.equal(result.error, 'no-index');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── registerSummary ────────────────────────────────────

test('registerSummary: appends entry to _index.yaml when not yet present', () => {
  const root = buildFakeProject();
  try {
    const result = registerSummary(root, {
      week: '2026-W15',
      file: '_weekly/2026-W15.md',
      start: '2026-04-06',
      end: '2026-04-12',
      unit_count: 2,
      domains: ['web'],
      generated_at: '2026-04-13'
    });
    assert.equal(result.registered, true);

    const indexText = fs.readFileSync(
      path.join(root, '.omniscitus', 'history', '_index.yaml'),
      'utf-8'
    );
    assert.match(indexText, /- week: "2026-W15"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('registerSummary: idempotent — returns already-indexed when entry exists', () => {
  const root = buildFakeProject();
  try {
    registerSummary(root, {
      week: '2026-W15', file: '_weekly/2026-W15.md',
      start: '2026-04-06', end: '2026-04-12',
      unit_count: 2, domains: ['web'], generated_at: '2026-04-13'
    });
    const result = registerSummary(root, {
      week: '2026-W15', file: '_weekly/2026-W15.md',
      start: '2026-04-06', end: '2026-04-12',
      unit_count: 2, domains: ['web'], generated_at: '2026-04-13'
    });
    assert.equal(result.registered, false);
    assert.equal(result.reason, 'already-indexed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
