'use strict';

/*
 * Unit tests for the seed script helpers. extractPurpose is the most
 * important one — it's the heuristic that turns each tracked file into
 * a 1-line blueprint purpose. Getting it wrong means every blueprint
 * in the seeded data is garbage.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractPurpose, escapeYamlString } = require('../scripts/seed-omniscitus.js');

// ── Fixture helper ──────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omniscitus-seed-test-'));
function writeFixture(name, content) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

// ── escapeYamlString ───────────────────────────────────

test('escapeYamlString: escapes double quotes', () => {
  assert.equal(escapeYamlString('hello "world"'), 'hello \\"world\\"');
});

test('escapeYamlString: leaves plain text alone', () => {
  assert.equal(escapeYamlString('just text'), 'just text');
});

// ── extractPurpose: markdown ────────────────────────────

test('extractPurpose: markdown with H1 heading', () => {
  const p = writeFixture('doc.md', '# Authentication Module\n\nHandles user login and session tokens.\n');
  assert.equal(extractPurpose(p), 'Authentication Module');
});

test('extractPurpose: markdown with frontmatter description wins over H1', () => {
  const p = writeFixture('skill.md', [
    '---',
    'name: wrap-up',
    'description: Session wrap-up with topic-based knowledge units.',
    '---',
    '',
    '# Wrap-up',
    'Rest of the file.'
  ].join('\n'));
  const out = extractPurpose(p);
  assert.match(out, /Session wrap-up/);
});

test('extractPurpose: markdown frontmatter with folded block style (>-)', () => {
  const p = writeFixture('skill2.md', [
    '---',
    'name: foo',
    'description: >-',
    '  Multi line description',
    '---',
    '',
    '# Foo'
  ].join('\n'));
  const out = extractPurpose(p);
  assert.match(out, /Multi line description/);
});

test('extractPurpose: plain markdown paragraph when no heading', () => {
  const p = writeFixture('plain.md', 'A simple note about something.\n');
  assert.equal(extractPurpose(p), 'A simple note about something.');
});

// ── extractPurpose: JSON ────────────────────────────────

test('extractPurpose: JSON with description field', () => {
  const p = writeFixture('plugin.json', JSON.stringify({
    name: 'omniscitus',
    description: 'The maintenance layer your codebase deserves.'
  }));
  assert.equal(extractPurpose(p), 'The maintenance layer your codebase deserves.');
});

test('extractPurpose: JSON with only name field', () => {
  const p = writeFixture('plugin2.json', JSON.stringify({ name: 'thing' }));
  assert.equal(extractPurpose(p), 'thing config.');
});

test('extractPurpose: malformed JSON falls through gracefully', () => {
  const p = writeFixture('broken.json', '{ this is not json');
  // Should not throw; returns whatever fallback heuristic fires (empty OK)
  const out = extractPurpose(p);
  assert.equal(typeof out, 'string');
});

// ── extractPurpose: JS / shell comments ─────────────────

test('extractPurpose: JS with /** ... */ doc comment', () => {
  const p = writeFixture('mod.js', [
    '/**',
    ' * Parses blueprint yaml files into a flat file map.',
    ' */',
    'function parse() {}'
  ].join('\n'));
  const out = extractPurpose(p);
  assert.match(out, /Parses blueprint yaml/);
});

test('extractPurpose: JS with // comment on first line', () => {
  const p = writeFixture('mod2.js', '// Tiny module that does a specific thing well.\nfunction x() {}');
  assert.equal(extractPurpose(p), 'Tiny module that does a specific thing well.');
});

test('extractPurpose: shell script with # comment', () => {
  const p = writeFixture('script.sh', '#!/bin/bash\n# Formats the statusline for the plugin hook.\necho hi');
  assert.equal(extractPurpose(p), 'Formats the statusline for the plugin hook.');
});

test('extractPurpose: skips separator-only comment lines', () => {
  const p = writeFixture('mod3.js', [
    '// ─────────────────────────────────',
    '// Actually useful description here.',
    '// ─────────────────────────────────',
    'function x() {}'
  ].join('\n'));
  const out = extractPurpose(p);
  assert.match(out, /Actually useful/);
});

// ── extractPurpose: fallbacks ───────────────────────────

test('extractPurpose: LICENSE file returns generic label', () => {
  const p = writeFixture('LICENSE', 'MIT License\n\nCopyright...');
  const out = extractPurpose(p);
  // Either the first line (MIT License) or the fallback label is fine —
  // both identify the file.
  assert.ok(out.length > 0);
});

test('extractPurpose: empty file returns empty string', () => {
  const p = writeFixture('empty.txt', '');
  assert.equal(extractPurpose(p), '');
});

test('extractPurpose: nonexistent file returns empty string (no throw)', () => {
  assert.equal(extractPurpose('/nonexistent/path/thing.md'), '');
});

test('extractPurpose: trims result to 140 chars max', () => {
  const long = 'This is an extremely long description that goes on and on and on '.repeat(5);
  const p = writeFixture('long.md', '# ' + long + '\n');
  const out = extractPurpose(p);
  assert.ok(out.length <= 140, 'expected max 140 chars, got ' + out.length);
});
