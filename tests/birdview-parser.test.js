'use strict';

/*
 * Unit tests for the hand-rolled yaml parsers in birdview/server.js.
 *
 * These parsers are the contract between the wrap-up / blueprint-sync
 * skills (which write yaml) and birdview (which reads it). A regression
 * here silently breaks the whole dashboard, so the tests stay cheap and
 * close to the format definition.
 *
 * Run with:   node --test tests/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBlueprints, parseIndexYaml, parseWeeklySummariesYaml } = require('../plugins/omniscitus/birdview/server.js');

// ── parseBlueprints ────────────────────────────────────

test('parseBlueprints: empty input returns an empty files map', () => {
  const r = parseBlueprints('');
  assert.deepEqual(r.files, {});
  assert.equal(r.updated, '');
  assert.equal(r.version, 1);
});

test('parseBlueprints: reads version and updated', () => {
  const r = parseBlueprints('version: 1\nupdated: "2026-04-10"\n');
  assert.equal(r.version, 1);
  assert.equal(r.updated, '"2026-04-10"');
});

test('parseBlueprints: parses a single file entry with all fields', () => {
  const yaml = [
    'version: 1',
    'updated: "2026-04-10"',
    '  "README.md":',
    '    status: active',
    '    source: claude',
    '    created: "2026-04-04"',
    '    last_modified: "2026-04-10"',
    '    change_count: 5',
    '    purpose: "Project readme."',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.deepEqual(Object.keys(r.files), ['README.md']);
  const f = r.files['README.md'];
  assert.equal(f.status, 'active');
  assert.equal(f.source, 'claude');
  assert.equal(f.created, '2026-04-04');
  assert.equal(f.last_modified, '2026-04-10');
  assert.equal(f.change_count, 5);
  assert.equal(f.purpose, 'Project readme.');
});

test('parseBlueprints: strips surrounding quotes from file path keys', () => {
  // Paths containing dots must be quoted in the yaml file, but the
  // resulting object key should be the bare path.
  const yaml = [
    'version: 1',
    '  "plugins/omniscitus/.claude-plugin/plugin.json":',
    '    status: active',
    '    purpose: "Plugin manifest."',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.deepEqual(Object.keys(r.files), ['plugins/omniscitus/.claude-plugin/plugin.json']);
});

test('parseBlueprints: parses multiple file entries in one block', () => {
  const yaml = [
    'version: 1',
    '  "a.md":',
    '    status: active',
    '    purpose: "first"',
    '  "b.md":',
    '    status: deleted',
    '    purpose: "second"',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.equal(Object.keys(r.files).length, 2);
  assert.equal(r.files['a.md'].purpose, 'first');
  assert.equal(r.files['b.md'].status, 'deleted');
});

test('parseBlueprints: change_count is coerced to integer', () => {
  const yaml = [
    'version: 1',
    '  "x.md":',
    '    change_count: 42',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.equal(r.files['x.md'].change_count, 42);
  assert.equal(typeof r.files['x.md'].change_count, 'number');
});

test('parseBlueprints: missing change_count defaults to 0', () => {
  const yaml = 'version: 1\n  "x.md":\n    status: active\n';
  const r = parseBlueprints(yaml);
  assert.equal(r.files['x.md'].change_count, 0);
});

test('parseBlueprints: unknown property lines are ignored', () => {
  const yaml = [
    'version: 1',
    '  "x.md":',
    '    status: active',
    '    totally_made_up: "garbage"',
    '    purpose: "real"',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.equal(r.files['x.md'].purpose, 'real');
  assert.equal(r.files['x.md'].totally_made_up, undefined);
});

test('parseBlueprints: handles change_log nested block', () => {
  const yaml = [
    'version: 1',
    '  "x.md":',
    '    status: active',
    '    change_log:',
    '      - date: "2026-04-10"',
    '        action: "created"',
    '        source: "claude"',
    ''
  ].join('\n');
  const r = parseBlueprints(yaml);
  assert.equal(r.files['x.md'].change_log.length, 1);
  // Note: the parser preserves surrounding quotes on change_log.date
  // (unlike top-level file fields). This is existing behavior the
  // birdview UI compensates for. Locking it in here so any future
  // refactor is intentional.
  assert.match(r.files['x.md'].change_log[0].date, /2026-04-10/);
  assert.equal(r.files['x.md'].change_log[0].action, 'created');
});

test('parseBlueprints: fixture from the actual seeded data parses cleanly', () => {
  // Load the real _root.yaml from this repo. If the format drifts, this
  // test catches it immediately.
  const fs = require('node:fs');
  const path = require('node:path');
  const yaml = fs.readFileSync(path.join(__dirname, '..', '.omniscitus', 'blueprints', '_root.yaml'), 'utf-8');
  const r = parseBlueprints(yaml);
  assert.ok(Object.keys(r.files).length > 0, 'expected _root.yaml to have entries');
  // The seed script always populates these top-level files
  assert.ok('README.md' in r.files);
  assert.ok('LICENSE' in r.files);
  assert.equal(r.files['README.md'].status, 'active');
});

// ── parseIndexYaml ─────────────────────────────────────

test('parseIndexYaml: empty input returns empty array', () => {
  assert.deepEqual(parseIndexYaml(''), []);
});

test('parseIndexYaml: parses a single unit', () => {
  const yaml = [
    'units:',
    '  - id: auth-rewrite',
    '    domain: server',
    '    status: open',
    '    created: "2026-04-01"',
    '    last_updated: "2026-04-10"',
    '    session_count: 3',
    '    title: "Auth rewrite"',
    '    file: "server/2026-04-01-auth-rewrite.md"',
    ''
  ].join('\n');
  const units = parseIndexYaml(yaml);
  assert.equal(units.length, 1);
  const u = units[0];
  assert.equal(u.id, 'auth-rewrite');
  assert.equal(u.domain, 'server');
  assert.equal(u.status, 'open');
  assert.equal(u.session_count, 3);
  assert.equal(typeof u.session_count, 'number');
  assert.equal(u.title, 'Auth rewrite');
});

test('parseIndexYaml: parses multiple units', () => {
  const yaml = [
    'units:',
    '  - id: a',
    '    domain: server',
    '  - id: b',
    '    domain: web',
    '  - id: c',
    '    domain: devops',
    ''
  ].join('\n');
  const units = parseIndexYaml(yaml);
  assert.equal(units.length, 3);
  assert.deepEqual(units.map(u => u.id), ['a', 'b', 'c']);
});

test('parseIndexYaml: strips surrounding quotes from string values', () => {
  const yaml = [
    'units:',
    '  - id: x',
    '    title: "Fancy title"',
    '    file: \'some/path.md\'',
    ''
  ].join('\n');
  const units = parseIndexYaml(yaml);
  assert.equal(units[0].title, 'Fancy title');
  assert.equal(units[0].file, 'some/path.md');
});

test('parseIndexYaml: fixture from the actual seeded data parses cleanly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const yaml = fs.readFileSync(path.join(__dirname, '..', '.omniscitus', 'history', '_index.yaml'), 'utf-8');
  const units = parseIndexYaml(yaml);
  assert.ok(units.length >= 2, 'expected at least 2 seeded units');
  // Every unit should have the required fields
  units.forEach(u => {
    assert.ok(u.id, 'unit missing id');
    assert.ok(u.domain, 'unit missing domain');
    assert.ok(u.title, 'unit missing title');
  });
});

// ── parseWeeklySummariesYaml ───────────────────────────

test('parseWeeklySummariesYaml: empty input returns empty array', () => {
  assert.deepEqual(parseWeeklySummariesYaml(''), []);
});

test('parseWeeklySummariesYaml: no weekly_summaries section returns empty', () => {
  const yaml = [
    'units:',
    '  - id: foo',
    '    domain: web',
    ''
  ].join('\n');
  assert.deepEqual(parseWeeklySummariesYaml(yaml), []);
});

test('parseWeeklySummariesYaml: parses a single weekly entry', () => {
  const yaml = [
    'units: []',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '    start: "2026-03-30"',
    '    end: "2026-04-05"',
    '    unit_count: 5',
    '    domains: [web, server]',
    '    generated_at: "2026-04-13"',
    ''
  ].join('\n');
  const summaries = parseWeeklySummariesYaml(yaml);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].week, '2026-W14');
  assert.equal(summaries[0].file, '_weekly/2026-W14.md');
  assert.equal(summaries[0].start, '2026-03-30');
  assert.equal(summaries[0].end, '2026-04-05');
  assert.equal(summaries[0].unit_count, 5);
  assert.deepEqual(summaries[0].domains, ['web', 'server']);
  assert.equal(summaries[0].generated_at, '2026-04-13');
});

test('parseWeeklySummariesYaml: parses multiple weekly entries', () => {
  const yaml = [
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '    unit_count: 5',
    '    domains: [web]',
    '  - week: "2026-W15"',
    '    file: "_weekly/2026-W15.md"',
    '    unit_count: 3',
    '    domains: [server, devops]',
    ''
  ].join('\n');
  const summaries = parseWeeklySummariesYaml(yaml);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].week, '2026-W14');
  assert.equal(summaries[1].week, '2026-W15');
  assert.equal(summaries[1].unit_count, 3);
  assert.deepEqual(summaries[1].domains, ['server', 'devops']);
});

test('parseWeeklySummariesYaml: coexists with units section', () => {
  const yaml = [
    'units:',
    '  - id: unit-a',
    '    domain: web',
    '    title: "Foo"',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '    unit_count: 1',
    ''
  ].join('\n');
  // Both parsers read the same text independently
  const units = parseIndexYaml(yaml);
  const summaries = parseWeeklySummariesYaml(yaml);
  assert.equal(units.length, 1);
  assert.equal(units[0].id, 'unit-a');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].week, '2026-W14');
});

test('parseIndexYaml: skips weekly_summaries entries (does not treat - week: as a unit)', () => {
  // Regression: an earlier parser draft that used the same `- ` line
  // recognizer would have mis-counted weekly entries as units.
  const yaml = [
    'units:',
    '  - id: unit-a',
    '    domain: web',
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    unit_count: 1',
    ''
  ].join('\n');
  const units = parseIndexYaml(yaml);
  assert.equal(units.length, 1);
  assert.equal(units[0].id, 'unit-a');
});
