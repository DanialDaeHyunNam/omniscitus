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

test('parseWeeklySummariesYaml: block-style list (0-indent `- week:`, unquoted values)', () => {
  // Regression: js-yaml / PyYAML default dumps emit list items at column
  // zero without quotes. The earlier parser treated the first `- week:`
  // line as a section terminator and returned []. This test locks in the
  // dual-format support.
  const yaml = [
    'weekly_summaries:',
    '- week: 2026-W14',
    '  file: _weekly/2026-W14.md',
    '  start: \'2026-03-30\'',
    '  end: \'2026-04-05\'',
    '  unit_count: 5',
    '  domains:',
    '  - web',
    '  - server',
    '  generated_at: \'2026-04-13\'',
    '- week: 2026-W15',
    '  file: _weekly/2026-W15.md',
    '  start: \'2026-04-06\'',
    '  end: \'2026-04-12\'',
    '  unit_count: 3',
    '  domains:',
    '  - devops',
    '  generated_at: \'2026-04-13\'',
    ''
  ].join('\n');
  const summaries = parseWeeklySummariesYaml(yaml);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].week, '2026-W14');
  assert.equal(summaries[0].file, '_weekly/2026-W14.md');
  assert.equal(summaries[0].start, '2026-03-30');
  assert.equal(summaries[0].end, '2026-04-05');
  assert.equal(summaries[0].unit_count, 5);
  assert.deepEqual(summaries[0].domains, ['web', 'server']);
  assert.equal(summaries[0].generated_at, '2026-04-13');
  assert.equal(summaries[1].week, '2026-W15');
  assert.deepEqual(summaries[1].domains, ['devops']);
});

test('parseWeeklySummariesYaml: block-style domains list with 2-indent entries', () => {
  // Mixed: 2-indent entry header but block-style domains sublist.
  const yaml = [
    'weekly_summaries:',
    '  - week: "2026-W14"',
    '    file: "_weekly/2026-W14.md"',
    '    unit_count: 2',
    '    domains:',
    '      - web',
    '      - devops',
    ''
  ].join('\n');
  const summaries = parseWeeklySummariesYaml(yaml);
  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0].domains, ['web', 'devops']);
});

test('parseWeeklySummariesYaml: trailing top-level key after block-style list ends section', () => {
  // A non-list line at column 0 (other than weekly_summaries) must still
  // terminate the section so an unrelated trailing key isn't swallowed.
  const yaml = [
    'weekly_summaries:',
    '- week: 2026-W14',
    '  unit_count: 1',
    'unrelated_key: value',
    ''
  ].join('\n');
  const summaries = parseWeeklySummariesYaml(yaml);
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

// ── parsePromptMetaYaml (umbrella pattern) ─────────────

const { parsePromptMetaYaml, countFilesByPattern } = require('../plugins/omniscitus/birdview/server.js');

test('parsePromptMetaYaml: parses top-level scalars', () => {
  const yaml = [
    'target: web/src/libs/ai/',
    'type: prompt',
    'prompt_name: prompt-optimization',
    'last_updated: 2026-04-13',
    ''
  ].join('\n');
  const meta = parsePromptMetaYaml(yaml);
  assert.equal(meta.target, 'web/src/libs/ai/');
  assert.equal(meta.type, 'prompt');
  assert.equal(meta.prompt_name, 'prompt-optimization');
  assert.equal(meta.last_updated, '2026-04-13');
});

test('parsePromptMetaYaml: parses external cases form', () => {
  const yaml = [
    'target: web/src/libs/ai/',
    'cases:',
    '  source: external',
    '  pattern: "web/scripts/prompt-optimization/test-cases/**/*.ts"',
    ''
  ].join('\n');
  const meta = parsePromptMetaYaml(yaml);
  assert.ok(meta.external_cases, 'expected external_cases populated');
  assert.equal(meta.external_cases.source, 'external');
  assert.equal(meta.external_cases.pattern, 'web/scripts/prompt-optimization/test-cases/**/*.ts');
  assert.deepEqual(meta.cases, []);
});

test('parsePromptMetaYaml: backwards-compat — inline cases still parse', () => {
  const yaml = [
    'target: src/lib/foo.ts',
    'cases:',
    '  - title: "first case"',
    '    category: element',
    '    expected_behavior: "returns 42"',
    '  - title: "second case"',
    '    category: edge',
    ''
  ].join('\n');
  const meta = parsePromptMetaYaml(yaml);
  assert.equal(meta.cases.length, 2);
  assert.equal(meta.cases[0].title, 'first case');
  assert.equal(meta.cases[1].category, 'edge');
  assert.equal(meta.external_cases, null);
});

test('parsePromptMetaYaml: parses umbrella prompts[] array', () => {
  const yaml = [
    'target: web/src/libs/ai/',
    'prompts:',
    '  - name: evaluation',
    '    description: "Score accuracy tests"',
    '    cases: web/scripts/prompt-optimization/test-cases/evaluation/',
    '    runner: web/scripts/prompt-optimization/tests/evaluation.ts',
    '  - name: suggestion',
    '    description: "Naturalness checks"',
    '    cases: web/scripts/prompt-optimization/test-cases/suggestion/',
    '    runner: web/scripts/prompt-optimization/tests/suggestion.ts',
    '    language_pairs: [english-korean, korean-english]',
    '  - name: contextual-breakdown',
    '    runner: web/scripts/prompt-optimization/tests/contextual-breakdown.ts',
    '    status: in_development',
    ''
  ].join('\n');
  const meta = parsePromptMetaYaml(yaml);
  assert.equal(meta.prompts.length, 3);
  assert.equal(meta.prompts[0].name, 'evaluation');
  assert.equal(meta.prompts[0].description, 'Score accuracy tests');
  assert.equal(meta.prompts[0].cases, 'web/scripts/prompt-optimization/test-cases/evaluation/');
  assert.deepEqual(meta.prompts[1].language_pairs, ['english-korean', 'korean-english']);
  assert.equal(meta.prompts[2].status, 'in_development');
});

test('parsePromptMetaYaml: prompts + external_cases can coexist', () => {
  const yaml = [
    'target: web/src/libs/ai/',
    'cases:',
    '  source: external',
    '  pattern: "scripts/tests/**/*.ts"',
    'prompts:',
    '  - name: sub-a',
    '    cases: path/a/',
    '',
  ].join('\n');
  const meta = parsePromptMetaYaml(yaml);
  assert.equal(meta.external_cases.pattern, 'scripts/tests/**/*.ts');
  assert.equal(meta.prompts.length, 1);
  assert.equal(meta.prompts[0].name, 'sub-a');
});

// ── countFilesByPattern ────────────────────────────────

test('countFilesByPattern: empty pattern returns 0', () => {
  assert.equal(countFilesByPattern('', '/tmp'), 0);
});

test('countFilesByPattern: missing directory returns 0', () => {
  assert.equal(countFilesByPattern('nonexistent-' + Date.now() + '/file.ts', '/tmp'), 0);
});

test('countFilesByPattern: counts files in an existing directory', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniscitus-test-'));
  fs.writeFileSync(path.join(tmp, 'a.ts'), '');
  fs.writeFileSync(path.join(tmp, 'b.ts'), '');
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'sub', 'c.ts'), '');
  try {
    // Literal directory — counts recursively
    assert.equal(countFilesByPattern(path.basename(tmp), path.dirname(tmp)), 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('countFilesByPattern: glob *.ts only matches .ts files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniscitus-glob-'));
  fs.writeFileSync(path.join(tmp, 'a.ts'), '');
  fs.writeFileSync(path.join(tmp, 'b.ts'), '');
  fs.writeFileSync(path.join(tmp, 'c.md'), ''); // should be excluded
  try {
    // Pattern is relative to projectRoot (second arg).
    assert.equal(countFilesByPattern(path.basename(tmp) + '/*.ts', path.dirname(tmp)), 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('countFilesByPattern: ** recursive glob', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omniscitus-recursive-'));
  fs.writeFileSync(path.join(tmp, 'a.ts'), '');
  fs.mkdirSync(path.join(tmp, 'nested'));
  fs.writeFileSync(path.join(tmp, 'nested', 'b.ts'), '');
  fs.mkdirSync(path.join(tmp, 'nested', 'deep'));
  fs.writeFileSync(path.join(tmp, 'nested', 'deep', 'c.ts'), '');
  try {
    assert.equal(countFilesByPattern(path.basename(tmp) + '/**/*.ts', path.dirname(tmp)), 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── TS test case title extractor ───────────────────────

const { stripJsComments, extractTsTestCaseTitles, extractTitlesFromCasesPath } =
  require('../plugins/omniscitus/birdview/server.js');

test('stripJsComments: removes block + line comments', () => {
  const src = [
    '// leading line comment',
    'const x = 1; // trailing',
    '/* block comment',
    '   spans lines */',
    'const y = "kept";'
  ].join('\n');
  const out = stripJsComments(src);
  assert.doesNotMatch(out, /leading line comment/);
  assert.doesNotMatch(out, /trailing/);
  assert.doesNotMatch(out, /block comment/);
  assert.doesNotMatch(out, /spans lines/);
  assert.match(out, /const y = "kept"/);
});

test('extractTsTestCaseTitles: pairs id with the next nearby name', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ts-'));
  const file = path.join(tmp, 'cases.ts');
  fs.writeFileSync(file, [
    'import { Foo } from "./types";',
    '',
    'const cases: Foo[] = [',
    '  {',
    '    id: "alpha",',
    '    name: "Alpha case",',
    '    other: 1,',
    '  },',
    '  {',
    '    id: "beta",',
    '    name: "Beta case",',
    '    nested: { a: 1, id: "ignore-me" },',
    '  },',
    '];',
    ''
  ].join('\n'));
  try {
    const titles = extractTsTestCaseTitles(file);
    assert.equal(titles.length, 2);
    assert.deepEqual(titles[0], { id: 'alpha', name: 'Alpha case' });
    assert.deepEqual(titles[1], { id: 'beta', name: 'Beta case' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractTsTestCaseTitles: ignores ids inside comments', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ts-'));
  const file = path.join(tmp, 'cases.ts');
  fs.writeFileSync(file, [
    '// id: "fake", name: "should not match"',
    '/*',
    '  id: "also-fake",',
    '  name: "comment block",',
    '*/',
    'const cases = [',
    '  { id: "real", name: "Real case" },',
    '];',
    ''
  ].join('\n'));
  try {
    const titles = extractTsTestCaseTitles(file);
    assert.equal(titles.length, 1);
    assert.deepEqual(titles[0], { id: 'real', name: 'Real case' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractTsTestCaseTitles: drops orphan id (id followed by id without name)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-ts-'));
  const file = path.join(tmp, 'cases.ts');
  // First object has id only (no name within 6 lines), second is well-formed
  fs.writeFileSync(file, [
    'const cases = [',
    '  {',
    '    id: "orphan",',
    '    description: "no name field",',
    '    foo: 1,',
    '    bar: 2,',
    '    baz: 3,',
    '    qux: 4,',
    '    quux: 5,',
    '  },',
    '  {',
    '    id: "good",',
    '    name: "Has a name",',
    '  },',
    '];',
    ''
  ].join('\n'));
  try {
    const titles = extractTsTestCaseTitles(file);
    assert.equal(titles.length, 1);
    assert.equal(titles[0].id, 'good');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractTsTestCaseTitles: missing file returns []', () => {
  assert.deepEqual(extractTsTestCaseTitles('/no/such/file-' + Date.now() + '.ts'), []);
});

test('extractTitlesFromCasesPath: walks a directory of .ts files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tsdir-'));
  fs.writeFileSync(path.join(tmp, 'a.ts'),
    'const x = [{ id: "a1", name: "A One" }];\n');
  fs.writeFileSync(path.join(tmp, 'b.ts'),
    'const y = [{ id: "b1", name: "B One" }, { id: "b2", name: "B Two" }];\n');
  fs.writeFileSync(path.join(tmp, 'README.md'),
    '# not a test case file\n');
  try {
    const titles = extractTitlesFromCasesPath(tmp);
    assert.equal(titles.length, 3);
    const ids = titles.map(t => t.id).sort();
    assert.deepEqual(ids, ['a1', 'b1', 'b2']);
    // file basenames are attached
    titles.forEach(t => {
      assert.ok(/\.ts$/.test(t.file));
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('extractTitlesFromCasesPath: single file path also works', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tsfile-'));
  const file = path.join(tmp, 'one.ts');
  fs.writeFileSync(file, 'const z = [{ id: "z1", name: "Just one" }];\n');
  try {
    const titles = extractTitlesFromCasesPath(file);
    assert.equal(titles.length, 1);
    assert.equal(titles[0].id, 'z1');
    assert.equal(titles[0].file, 'one.ts');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
