'use strict';

/*
 * Unit tests for the /omniscitus-uninstall script's pure helpers.
 * Filesystem-touching paths (executePlan, removeOmniscitusDir) are
 * covered with tmpdir fixtures.
 *
 * Git operations are NOT exercised in tests — those are tested by
 * shape (status/detail strings) only, since spawning git for fixture
 * setup is fragile and slow.
 *
 * Run with:   node --test tests/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  parseAnchor,
  classifyMarker,
  removeAppendedSection,
  buildPlan,
  executePlan
} = require('../plugins/omniscitus/scripts/uninstall.cjs');

// ── parseAnchor ────────────────────────────────────────

test('parseAnchor: extracts anchor block + footprint entries', () => {
  const yaml = [
    'version: 1',
    '',
    'anchor:',
    '  sha: abc1234567890',
    '  branch: main',
    '  timestamp: 2026-04-13T10:00:00+09:00',
    '  git_project: true',
    '',
    'footprint:',
    '  - path: CLAUDE.md',
    '    action: appended',
    '    marker: "### 🗂 Omniscitus"',
    '    by: migrate',
    '  - path: .claude/member/aria-web/INTRODUCTION.md',
    '    action: modified',
    '    by: migrate',
    ''
  ].join('\n');

  const result = parseAnchor(yaml);
  assert.equal(result.anchor.sha, 'abc1234567890');
  assert.equal(result.anchor.branch, 'main');
  assert.equal(result.anchor.git_project, true);
  assert.equal(result.footprint.length, 2);
  assert.equal(result.footprint[0].path, 'CLAUDE.md');
  assert.equal(result.footprint[0].action, 'appended');
  assert.equal(result.footprint[0].marker, '### 🗂 Omniscitus');
  assert.equal(result.footprint[1].action, 'modified');
});

test('parseAnchor: empty input returns null-equivalent', () => {
  assert.equal(parseAnchor(''), null);
});

// ── classifyMarker ─────────────────────────────────────

test('classifyMarker: heading / blockquote / literal', () => {
  assert.equal(classifyMarker('### 🗂 Omniscitus (auto-tracking)'), 'heading');
  assert.equal(classifyMarker('## Section'), 'heading');
  assert.equal(classifyMarker('> **🔄 2026-04-13 리프레이밍**'), 'blockquote');
  assert.equal(classifyMarker('SOMETHING ELSE'), 'literal');
});

// ── removeAppendedSection ──────────────────────────────

test('removeAppendedSection: removes a heading section bounded by next sibling heading', () => {
  const text = [
    '# Doc',
    '',
    '## Keep',
    'keep me',
    '',
    '### 🗂 Omniscitus (auto-tracking)',
    '- bullet 1',
    '- bullet 2',
    '',
    '## Also keep',
    'also kept',
    ''
  ].join('\n');
  const r = removeAppendedSection(text, '### 🗂 Omniscitus (auto-tracking)');
  assert.equal(r.found, true);
  assert.match(r.content, /## Keep\nkeep me/);
  assert.match(r.content, /## Also keep\nalso kept/);
  assert.doesNotMatch(r.content, /Omniscitus/);
  assert.doesNotMatch(r.content, /bullet 1/);
});

test('removeAppendedSection: heading section bounded by EOF', () => {
  const text = [
    '# Doc',
    'body',
    '',
    '### Removed',
    'goodbye',
    'still goodbye',
    ''
  ].join('\n');
  const r = removeAppendedSection(text, '### Removed');
  assert.equal(r.found, true);
  assert.match(r.content, /^# Doc\nbody/);
  assert.doesNotMatch(r.content, /goodbye/);
});

test('removeAppendedSection: blockquote banner removal stops at first non-blockquote line', () => {
  const text = [
    '# Title',
    '> **🔄 2026-04-13 리프레이밍**',
    '> 멤버 = 전문성 persona.',
    '> 세션 종료: /wrap-up.',
    '',
    '## Keep this',
    'kept body',
    ''
  ].join('\n');
  const r = removeAppendedSection(text, '> **🔄 2026-04-13 리프레이밍**');
  assert.equal(r.found, true);
  // After removing the blockquote banner: title remains, blank line(s) collapsed,
  // next heading preserved. Blockquote content gone.
  assert.match(r.content, /^# Title\n+## Keep this\nkept body/);
  assert.doesNotMatch(r.content, /리프레이밍/);
  assert.doesNotMatch(r.content, /persona/);
});

test('removeAppendedSection: marker not found → no-op, found:false', () => {
  const text = '# Hand-edited\n\nNothing matches here.\n';
  const r = removeAppendedSection(text, '### Missing');
  assert.equal(r.found, false);
  assert.equal(r.removed, 0);
  assert.equal(r.content, text);
});

test('removeAppendedSection: collapses 3+ consecutive blank lines to 2', () => {
  const text = [
    '# Doc', '', '### To remove', 'body', '', '', '', '## Keep', ''
  ].join('\n');
  const r = removeAppendedSection(text, '### To remove');
  // No 3+ consecutive blanks should remain
  assert.doesNotMatch(r.content, /\n\n\n\n/);
});

// ── buildPlan + executePlan ────────────────────────────

function buildFakeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-uninst-'));
  fs.mkdirSync(path.join(root, '.omniscitus', 'migrate'), { recursive: true });

  // CLAUDE.md with an appended block
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), [
    '# Project',
    '',
    '## Keep',
    'keep body',
    '',
    '### 🗂 Omniscitus (auto-tracking)',
    '- Blueprints: ...',
    '- Session end: /wrap-up',
    ''
  ].join('\n'));

  // a created file (will be deleted)
  fs.writeFileSync(path.join(root, '.omniscitus', 'migrate', 'should-also-go.txt'), 'created by migrate\n');

  // anchor.yaml
  fs.writeFileSync(path.join(root, '.omniscitus', 'migrate', 'anchor.yaml'), [
    'anchor:',
    '  sha: deadbeef',
    '  branch: main',
    '  git_project: false',  // keeps test off git ops
    'footprint:',
    '  - path: CLAUDE.md',
    '    action: appended',
    '    marker: "### 🗂 Omniscitus (auto-tracking)"',
    '    by: migrate',
    '  - path: .omniscitus/migrate/should-also-go.txt',
    '    action: created',
    '    by: migrate',
    '  - path: .omniscitus/already-gone.md',
    '    action: created',
    '    by: migrate',
    ''
  ].join('\n'));

  return root;
}

test('buildPlan: classifies appended / created / created-already-gone', () => {
  const root = buildFakeProject();
  try {
    const anchor = parseAnchor(fs.readFileSync(path.join(root, '.omniscitus/migrate/anchor.yaml'), 'utf-8'));
    const plan = buildPlan(root, anchor);
    assert.equal(plan.length, 3);

    const claudeStep = plan.find(p => p.entry.path === 'CLAUDE.md');
    assert.equal(claudeStep.status, 'remove-section');

    const createdStep = plan.find(p => p.entry.path === '.omniscitus/migrate/should-also-go.txt');
    assert.equal(createdStep.status, 'delete');

    const goneStep = plan.find(p => p.entry.path === '.omniscitus/already-gone.md');
    assert.equal(goneStep.status, 'skip');
    assert.match(goneStep.detail, /already deleted/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executePlan: applies remove-section + delete, reports cleanly', () => {
  const root = buildFakeProject();
  try {
    const anchor = parseAnchor(fs.readFileSync(path.join(root, '.omniscitus/migrate/anchor.yaml'), 'utf-8'));
    const plan = buildPlan(root, anchor);
    const report = executePlan(root, plan, anchor);

    // CLAUDE.md should no longer contain the omniscitus block
    const claudeText = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8');
    assert.doesNotMatch(claudeText, /Omniscitus \(auto-tracking\)/);
    assert.match(claudeText, /## Keep\nkeep body/);

    // created file should be gone
    assert.equal(fs.existsSync(path.join(root, '.omniscitus/migrate/should-also-go.txt')), false);

    // already-gone entry should be in skipped
    assert.equal(report.applied.length, 2);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.errors.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executePlan: idempotent — re-running on already-applied plan is a no-op', () => {
  const root = buildFakeProject();
  try {
    const anchor = parseAnchor(fs.readFileSync(path.join(root, '.omniscitus/migrate/anchor.yaml'), 'utf-8'));
    const plan1 = buildPlan(root, anchor);
    executePlan(root, plan1, anchor);

    // Build a NEW plan against the now-modified state. Everything should be 'skip'.
    const plan2 = buildPlan(root, anchor);
    plan2.forEach(p => {
      assert.equal(p.status, 'skip', 'step for ' + p.entry.path + ' should be skip on re-plan');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executePlan: marker disappearing between dry-run and execute is reported as skip', () => {
  const root = buildFakeProject();
  try {
    const anchor = parseAnchor(fs.readFileSync(path.join(root, '.omniscitus/migrate/anchor.yaml'), 'utf-8'));
    const plan = buildPlan(root, anchor);
    // Simulate user editing CLAUDE.md to remove the block themselves between dry-run and execute
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n\n## Keep\nkeep body\n');
    const report = executePlan(root, plan, anchor);
    const skippedClaude = report.skipped.find(s => s.indexOf('CLAUDE.md') >= 0);
    assert.ok(skippedClaude, 'CLAUDE.md should be in skipped list');
    assert.match(skippedClaude, /marker disappeared/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
