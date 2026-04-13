'use strict';

/*
 * Unit tests for the /weekly-backfill script's pure helpers.
 * Focus on the logic that matters for correctness: ISO week math,
 * grouping, smart-skip detection, summary rendering shape.
 *
 * Run with:   node --test tests/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isoWeek,
  weekLabel,
  weekBounds,
  parseUnits,
  parseExistingWeeklyKeys,
  groupByWeek,
  isCompletedWeek,
  renderSummary,
  appendWeeklySummaryEntry
} = require('../plugins/omniscitus/scripts/weekly-backfill.cjs');

// ── isoWeek + weekLabel ────────────────────────────────

test('isoWeek: 2026-01-05 Monday → 2026-W02', () => {
  // ISO week 1 of 2026 starts Dec 29 2025 (Mon). Jan 5 2026 is week 2.
  assert.deepEqual(isoWeek(new Date(Date.UTC(2026, 0, 5))), { year: 2026, week: 2 });
});

test('isoWeek: 2023-01-01 Sunday → 2022-W52 (year boundary)', () => {
  // Jan 1 2023 is a Sunday, which belongs to the last week of 2022's ISO year.
  assert.deepEqual(isoWeek(new Date(Date.UTC(2023, 0, 1))), { year: 2022, week: 52 });
});

test('isoWeek: 2026-04-06 Monday → 2026-W15', () => {
  assert.deepEqual(isoWeek(new Date(Date.UTC(2026, 3, 6))), { year: 2026, week: 15 });
});

test('isoWeek: 2026-04-13 Monday → 2026-W16 (next week)', () => {
  assert.deepEqual(isoWeek(new Date(Date.UTC(2026, 3, 13))), { year: 2026, week: 16 });
});

test('weekLabel: zero-pads single-digit weeks', () => {
  assert.equal(weekLabel(2026, 2), '2026-W02');
  assert.equal(weekLabel(2026, 15), '2026-W15');
  assert.equal(weekLabel(2025, 52), '2025-W52');
});

// ── weekBounds ─────────────────────────────────────────

test('weekBounds: 2026-W02 → Mon 2026-01-05 to Sun 2026-01-11', () => {
  assert.deepEqual(weekBounds(2026, 2), { start: '2026-01-05', end: '2026-01-11' });
});

test('weekBounds: 2026-W15 → Mon 2026-04-06 to Sun 2026-04-12', () => {
  assert.deepEqual(weekBounds(2026, 15), { start: '2026-04-06', end: '2026-04-12' });
});

// ── parseUnits ─────────────────────────────────────────

test('parseUnits: extracts id / domain / status / last_updated', () => {
  const yaml = [
    'units:',
    '  - id: alpha',
    '    domain: web',
    '    status: closed',
    '    last_updated: 2026-04-10',
    '    title: "Alpha task"',
    '  - id: beta',
    '    domain: server',
    '    status: open',
    '    last_updated: 2026-04-11',
    '    title: "Beta task"',
    ''
  ].join('\n');
  const units = parseUnits(yaml);
  assert.equal(units.length, 2);
  assert.equal(units[0].id, 'alpha');
  assert.equal(units[0].domain, 'web');
  assert.equal(units[0].status, 'closed');
  assert.equal(units[1].id, 'beta');
  assert.equal(units[1].status, 'open');
});

test('parseUnits: stops at weekly_summaries block', () => {
  const yaml = [
    'units:',
    '  - id: alpha',
    '    domain: web',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    unit_count: 1',
    ''
  ].join('\n');
  const units = parseUnits(yaml);
  assert.equal(units.length, 1);
  assert.equal(units[0].id, 'alpha');
});

// ── parseExistingWeeklyKeys ────────────────────────────

test('parseExistingWeeklyKeys: collects quoted and unquoted keys', () => {
  const yaml = [
    'units: []',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '  - week: 2026-W15',
    '    file: "_weekly/2026-W15.md"',
    ''
  ].join('\n');
  const keys = parseExistingWeeklyKeys(yaml);
  assert.equal(keys.size, 2);
  assert.ok(keys.has('2026-W14'));
  assert.ok(keys.has('2026-W15'));
});

test('parseExistingWeeklyKeys: empty when no section', () => {
  const yaml = ['units:', '  - id: alpha', ''].join('\n');
  assert.equal(parseExistingWeeklyKeys(yaml).size, 0);
});

// ── groupByWeek ────────────────────────────────────────

test('groupByWeek: collocates units in the same ISO week', () => {
  const units = [
    { id: 'a', last_updated: '2026-04-06', domain: 'web' },    // Mon W15
    { id: 'b', last_updated: '2026-04-10', domain: 'web' },    // Fri W15
    { id: 'c', last_updated: '2026-04-13', domain: 'server' }  // Mon W16
  ];
  const groups = groupByWeek(units);
  assert.equal(groups.size, 2);
  assert.equal(groups.get('2026-W15').units.length, 2);
  assert.equal(groups.get('2026-W16').units.length, 1);
});

test('groupByWeek: skips units without usable dates', () => {
  const units = [
    { id: 'a', last_updated: '2026-04-10', domain: 'web' },
    { id: 'b', last_updated: '', created: '', domain: 'web' }, // skip
    { id: 'c', created: '2026-04-11', domain: 'web' }           // uses created
  ];
  const groups = groupByWeek(units);
  const total = Array.from(groups.values()).reduce(function (sum, g) { return sum + g.units.length; }, 0);
  assert.equal(total, 2);
});

// ── isCompletedWeek ────────────────────────────────────

test('isCompletedWeek: past week is completed', () => {
  // W14 ended 2026-04-05, so at any time after that it's completed.
  assert.equal(isCompletedWeek(2026, 14, new Date('2026-04-13T10:00:00Z')), true);
});

test('isCompletedWeek: current in-progress week is NOT completed', () => {
  // At Apr 13 (Monday of W16), W16 is still running through Apr 19 Sunday.
  assert.equal(isCompletedWeek(2026, 16, new Date('2026-04-13T10:00:00Z')), false);
});

test('isCompletedWeek: week flips to completed the moment Sunday 23:59 passes', () => {
  // Sunday Apr 12 2026 is end of W15.
  assert.equal(isCompletedWeek(2026, 15, new Date('2026-04-12T22:00:00Z')), false);
  assert.equal(isCompletedWeek(2026, 15, new Date('2026-04-13T00:30:00Z')), true);
});

// ── renderSummary ──────────────────────────────────────

test('renderSummary: produces the expected sections', () => {
  const group = {
    weekKey: '2026-W15',
    year: 2026,
    week: 15,
    units: [
      { id: 'a', title: 'Ship login', domain: 'web', status: 'closed' },
      { id: 'b', title: 'DB migration', domain: 'server', status: 'closed' },
      { id: 'c', title: 'Redesign nav', domain: 'web', status: 'open' }
    ]
  };
  const md = renderSummary(group);
  assert.match(md, /^# Week 2026-W15 \(2026-04-06 – 2026-04-12\)/m);
  assert.match(md, /## Headline/);
  assert.match(md, /3 units touched across 2 domains/);
  assert.match(md, /## By Domain/);
  assert.match(md, /### web \(2\)/);
  assert.match(md, /### server \(1\)/);
  assert.match(md, /## Numbers/);
  assert.match(md, /- Units: 3/);
  assert.match(md, /- Closed: 2/);
  assert.match(md, /- Open: 1/);
  assert.match(md, /## Pending at Week End/);
  assert.match(md, /- \[ \] Redesign nav/);
  // Fast-mode watermark so reviewers know no LLM ran
  assert.match(md, /fast mode — deterministic aggregation, no LLM/);
});

test('renderSummary: truncates long domain lists to 10', () => {
  const units = [];
  for (var i = 0; i < 15; i++) {
    units.push({ id: 't' + i, title: 'Task ' + i, domain: 'web', status: 'closed' });
  }
  const md = renderSummary({ weekKey: '2026-W15', year: 2026, week: 15, units: units });
  assert.match(md, /### web \(15\)/);
  assert.match(md, /_… and 5 more_/);
});

// ── appendWeeklySummaryEntry ───────────────────────────

test('appendWeeklySummaryEntry: creates weekly_summaries section when missing', () => {
  const before = ['units:', '  - id: a', '    domain: web', ''].join('\n');
  const after = appendWeeklySummaryEntry(before, {
    week: '2026-W15',
    file: '_weekly/2026-W15.md',
    start: '2026-04-06',
    end: '2026-04-12',
    unit_count: 3,
    domains: ['web', 'server'],
    generated_at: '2026-04-13'
  });
  assert.match(after, /weekly_summaries:/);
  assert.match(after, /- week: "2026-W15"/);
  assert.match(after, /file: "_weekly\/2026-W15.md"/);
  assert.match(after, /unit_count: 3/);
});

test('appendWeeklySummaryEntry: appends to existing section', () => {
  const before = [
    'units:',
    '  - id: a',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '    unit_count: 5',
    ''
  ].join('\n');
  const after = appendWeeklySummaryEntry(before, {
    week: '2026-W15',
    file: '_weekly/2026-W15.md',
    start: '2026-04-06',
    end: '2026-04-12',
    unit_count: 3,
    domains: ['web'],
    generated_at: '2026-04-13'
  });
  const keys = parseExistingWeeklyKeys(after);
  assert.equal(keys.size, 2);
  assert.ok(keys.has('2026-W14'));
  assert.ok(keys.has('2026-W15'));
});
