'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

// Default 3777, overridable via BIRDVIEW_PORT so the skill can fall back
// to an unused port when 3777 is already taken.
var PORT = parseInt(process.env.BIRDVIEW_PORT, 10) || 3777;
var PROJECT_ROOT = process.argv[2] || process.cwd();
var OMNISCITUS_DIR = path.join(PROJECT_ROOT, '.omniscitus');
var BIRDVIEW_DIR = __dirname;

// Detect the GitHub repo URL once at startup so birdview can render
// commit messages as links to PRs / commits. SSH and HTTPS remotes are
// both normalized to https://host/owner/repo. Returns null if there's
// no `origin` remote or it doesn't match a known pattern.
var REPO_URL = (function detectRepoUrl() {
  try {
    var out = require('child_process').execSync('git remote get-url origin', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!out) return null;
    var ssh = out.match(/^git@([^:]+):(.+?)(\.git)?$/);
    if (ssh) return 'https://' + ssh[1] + '/' + ssh[2].replace(/\.git$/, '');
    return out.replace(/\.git$/, '');
  } catch (e) {
    return null;
  }
})();

// --- Helpers ---

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString()); });
    req.on('error', reject);
  });
}

function jsonRes(res, code, data) {
  var body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function htmlRes(res, filePath) {
  try {
    var content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function staticRes(res, filePath, contentType) {
  try {
    var data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return '';
  }
}

// --- YAML Parsers ---

function parseBlueprints(text) {
  var result = { version: 1, updated: '', files: {} };
  if (!text) return result;

  var lines = text.split('\n');
  var currentFile = null;
  var inChangeLog = false;
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    var vMatch = line.match(/^version:\s*(\d+)/);
    if (vMatch) { result.version = parseInt(vMatch[1]); i++; continue; }

    var uMatch = line.match(/^updated:\s*(.+)/);
    if (uMatch) { result.updated = uMatch[1].trim(); i++; continue; }

    var fMatch = line.match(/^  ([^\s].*):\s*$/);
    if (fMatch) {
      // Strip surrounding YAML quotes from the file path key. Migration
      // and blueprint-tracker both quote paths that contain dots, slashes,
      // or other special characters; the key in result.files should be
      // the bare path so consumers (and JSON serialization) see clean
      // strings.
      currentFile = fMatch[1].replace(/^["']|["']$/g, '');
      result.files[currentFile] = result.files[currentFile] || {
        status: 'active', source: 'claude', created: '', last_modified: '',
        change_count: 0, purpose: '', change_log: []
      };
      inChangeLog = false;
      i++; continue;
    }

    if (currentFile) {
      var pMatch = line.match(/^    (status|source|created|last_modified|deleted|change_count|purpose):\s*(.*)/);
      if (pMatch) {
        var key = pMatch[1];
        var val = pMatch[2].replace(/^["']|["']$/g, '').trim();
        if (key === 'change_count') val = parseInt(val) || 0;
        result.files[currentFile][key] = val;
        inChangeLog = false;
        i++; continue;
      }

      if (line.match(/^    change_log:$/)) {
        inChangeLog = true;
        i++; continue;
      }

      if (inChangeLog) {
        var dMatch = line.match(/^      - date:\s*(.+)/);
        if (dMatch) {
          result.files[currentFile].change_log.push({
            date: dMatch[1].trim(), action: '', source: ''
          });
          i++; continue;
        }
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

// Pull `**Participants**: a, b` or `**Contributors**: a, b` out of a
// unit markdown body. Lives as a content property rather than an
// _index.yaml field because it's a natural part of who-wrote-what and
// can change as the unit gets edited. Returns an array of trimmed
// names, empty when the line is absent.
function extractParticipants(content) {
  if (!content) return [];
  var m = content.match(/^\s*\*\*(?:Participants|Contributors|참여자)\*\*\s*:\s*(.+)$/mi);
  if (!m) return [];
  return m[1].split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

function parseIndexYaml(text) {
  var units = [];
  if (!text) return units;

  var lines = text.split('\n');
  var current = null;
  var i = 0;
  // Skip entries once we enter the weekly_summaries section. parseWeeklySummariesYaml
  // handles those; here we only collect unit entries so `- week:` items don't get
  // accidentally parsed as units.
  var inWeeklySection = false;

  while (i < lines.length) {
    var line = lines[i];

    if (/^weekly_summaries\s*:/.test(line)) {
      if (current) { units.push(current); current = null; }
      inWeeklySection = true;
      i++; continue;
    }
    // Any non-indented section header ends the weekly block
    if (inWeeklySection && /^[^\s#-]/.test(line)) inWeeklySection = false;

    if (inWeeklySection) { i++; continue; }

    var idMatch = line.match(/^\s*- id:\s*(.+)/);
    if (idMatch) {
      if (current) units.push(current);
      current = {
        id: idMatch[1].trim(),
        domain: '', status: 'open', created: '', last_updated: '',
        session_count: 0, title: '', file: ''
      };
      i++; continue;
    }

    if (current) {
      var propMatch = line.match(/^\s+(domain|status|created|last_updated|session_count|title|file):\s*(.*)/);
      if (propMatch) {
        var k = propMatch[1];
        var v = propMatch[2].replace(/^["']|["']$/g, '').trim();
        if (k === 'session_count') v = parseInt(v) || 0;
        current[k] = v;
        i++; continue;
      }
    }

    i++;
  }

  if (current) units.push(current);
  return units;
}

/**
 * Extract the `weekly_summaries:` list from _index.yaml, generated by
 * /wrap-up's Step 1.5 backfill. Each entry is a flat object: week,
 * file, start, end, unit_count, generated_at. `domains:` is a nested
 * inline array (`[web, server]`) — parsed naively.
 */
function parseWeeklySummariesYaml(text) {
  var summaries = [];
  if (!text) return summaries;

  var lines = text.split('\n');
  var inSection = false;
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (/^weekly_summaries\s*:/.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    // non-indented non-blank line ends the section
    if (line.length > 0 && line[0] !== ' ' && line.trim().length > 0 && !/^weekly_summaries/.test(line)) {
      if (current) { summaries.push(current); current = null; }
      inSection = false;
      continue;
    }

    var weekStart = line.match(/^\s*- week:\s*["']?([^"'\s]+)["']?\s*(#.*)?$/);
    if (weekStart) {
      if (current) summaries.push(current);
      current = {
        week: weekStart[1], file: '', start: '', end: '',
        unit_count: 0, domains: [], generated_at: '', content: ''
      };
      continue;
    }

    if (current) {
      var prop = line.match(/^\s+(file|start|end|unit_count|generated_at):\s*(.+)/);
      if (prop) {
        var k = prop[1];
        var v = prop[2].replace(/^["']|["']$/g, '').trim();
        if (k === 'unit_count') v = parseInt(v) || 0;
        current[k] = v;
        continue;
      }
      var domainProp = line.match(/^\s+domains:\s*\[(.*)\]\s*$/);
      if (domainProp) {
        current.domains = domainProp[1].split(',')
          .map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); })
          .filter(function (s) { return s.length > 0; });
        continue;
      }
    }
  }

  if (current) summaries.push(current);
  return summaries;
}

/**
 * Parse an indented YAML block into a nested object.
 * Reads lines from `lines` starting at index `start`, collecting all lines
 * whose indentation is greater than `baseIndent`. Returns { value, nextIndex }.
 */
function parseNestedYaml(lines, start, baseIndent) {
  var result = {};
  var i = start;

  while (i < lines.length) {
    var line = lines[i];
    // blank line — skip
    if (line.trim() === '') { i++; continue; }

    // measure indent
    var indentMatch = line.match(/^(\s*)/);
    var indent = indentMatch ? indentMatch[1].length : 0;

    // back at or before base level — done with this block
    if (indent <= baseIndent) break;

    // list item (- name: ...)
    var listItemMatch = line.match(/^(\s*)- (\w+):\s*(.+)/);
    if (listItemMatch) {
      // we're inside a list — caller should use parseNestedYamlList
      break;
    }

    // key: value  or  key: (block)
    var kvMatch = line.match(/^(\s*)(\w+):\s*(.*)/);
    if (kvMatch) {
      var key = kvMatch[2];
      var val = kvMatch[3].trim();

      if (val === '' || val === '|' || val === '>') {
        // block value — recurse
        var nested = parseNestedYaml(lines, i + 1, indent);
        result[key] = nested.value;
        i = nested.nextIndex;
      } else {
        // scalar value — strip quotes, parse booleans/numbers
        val = val.replace(/^["']|["']$/g, '');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val)) val = parseInt(val);
        result[key] = val;
        i++;
      }
      continue;
    }

    i++;
  }

  return { value: result, nextIndex: i };
}

/**
 * Parse a YAML list block. Each item starts with "- key: val" at `itemIndent`.
 * Returns { items, nextIndex }.
 */
function parseNestedYamlList(lines, start, baseIndent) {
  var items = [];
  var i = start;

  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') { i++; continue; }

    var indentMatch = line.match(/^(\s*)/);
    var indent = indentMatch ? indentMatch[1].length : 0;

    if (indent <= baseIndent) break;

    // list item
    var listMatch = line.match(/^(\s*)- (\w+):\s*(.*)/);
    if (listMatch) {
      var itemIndent = listMatch[1].length;
      var item = {};
      var key = listMatch[2];
      var val = listMatch[3].trim();

      if (val === '') {
        var nested = parseNestedYaml(lines, i + 1, itemIndent + 1);
        item[key] = nested.value;
        i = nested.nextIndex;
      } else {
        val = val.replace(/^["']|["']$/g, '');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        item[key] = val;
        i++;
      }

      // read remaining properties of this list item (indented beyond the dash)
      var propIndent = itemIndent + 2;
      while (i < lines.length) {
        var propLine = lines[i];
        if (propLine.trim() === '') { i++; continue; }

        var pIndentMatch = propLine.match(/^(\s*)/);
        var pIndent = pIndentMatch ? pIndentMatch[1].length : 0;

        if (pIndent < propIndent) break;

        var propKv = propLine.match(/^(\s*)(\w+):\s*(.*)/);
        if (propKv && propKv[1].length === propIndent) {
          var pk = propKv[2];
          var pv = propKv[3].trim();

          if (pv === '') {
            // nested block under this property — could be object or list
            // peek at next non-blank line to decide
            var peekIdx = i + 1;
            while (peekIdx < lines.length && lines[peekIdx].trim() === '') peekIdx++;
            if (peekIdx < lines.length && lines[peekIdx].match(/^\s*- /)) {
              var subList = parseNestedYamlList(lines, i + 1, propIndent);
              item[pk] = subList.items;
              i = subList.nextIndex;
            } else {
              var subNested = parseNestedYaml(lines, i + 1, propIndent);
              item[pk] = subNested.value;
              i = subNested.nextIndex;
            }
          } else {
            pv = pv.replace(/^["']|["']$/g, '');
            if (pv === 'true') pv = true;
            else if (pv === 'false') pv = false;
            item[pk] = pv;
            i++;
          }
        } else {
          break;
        }
      }

      items.push(item);
      continue;
    }

    // not a list item and not within our block — done
    break;
  }

  return { items: items, nextIndex: i };
}

/**
 * Parse the signature block for a suite.
 * Called when we encounter "signature:" at a given indent.
 * Returns { signature, nextIndex }.
 */
function parseSignatureBlock(lines, start, baseIndent) {
  var sig = { params: [], returns: {} };
  var i = start;

  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') { i++; continue; }

    var indentMatch = line.match(/^(\s*)/);
    var indent = indentMatch ? indentMatch[1].length : 0;

    if (indent <= baseIndent) break;

    // params:
    if (line.match(/^\s*params:\s*$/)) {
      var paramsList = parseNestedYamlList(lines, i + 1, indent);
      sig.params = paramsList.items;
      i = paramsList.nextIndex;
      continue;
    }

    // returns:
    if (line.match(/^\s*returns:\s*$/)) {
      var retBlock = parseNestedYaml(lines, i + 1, indent);
      sig.returns = retBlock.value;
      i = retBlock.nextIndex;
      continue;
    }

    i++;
  }

  return { signature: sig, nextIndex: i };
}

// Coerce a raw YAML scalar string into a JS value. Covers the literals
// non-devs tend to hand-write in meta.yaml: numbers, booleans, null,
// empty arrays/objects, quoted strings. Inline arrays/objects with
// content (`[a, b]`, `{x: 1}`) stay as strings — this isn't a full
// YAML parser, just enough to stop "trends: []" rendering as "[]".
function coerceScalar(raw) {
  var s = String(raw == null ? '' : raw).trim();
  // Strip matching quotes first
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"');
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (/^\[\s*\]$/.test(s)) return [];
  if (/^\{\s*\}$/.test(s)) return {};
  return s;
}

// Read a YAML block scalar (`|` literal or `>` folded) starting at
// `startIdx`. Returns { value, nextIndex }. `baseIndent` is the indent
// level of the line that had the `|`/`>` marker — block lines must be
// indented deeper than that to be part of the scalar.
function readBlockScalar(lines, startIdx, baseIndent, style) {
  var out = [];
  var i = startIdx;
  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') { out.push(''); i++; continue; }
    var indent = line.match(/^(\s*)/)[1].length;
    if (indent <= baseIndent) break;
    out.push(line.slice(baseIndent + 2)); // strip base+2 for block body
    i++;
  }
  // Trim trailing empty lines
  while (out.length && out[out.length - 1] === '') out.pop();
  var joined;
  if (style === '>') {
    // Folded: blank lines become newlines, consecutive text lines join with spaces.
    joined = out.reduce(function(acc, cur) {
      if (cur === '') return acc + '\n';
      if (acc && !/\n$/.test(acc)) return acc + ' ' + cur;
      return acc + cur;
    }, '');
  } else {
    joined = out.join('\n');
  }
  return { value: joined, nextIndex: i };
}

function parseMetaYaml(text) {
  var result = { target: '', language: '', framework: '', last_updated: '', suites: [] };
  if (!text) return result;

  var lines = text.split('\n');
  var currentSuite = null;
  var currentCase = null;
  var inInput = false;
  var inExpected = false;
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    // top-level scalars
    var topMatch = line.match(/^(target|language|framework|last_updated):\s*(.+)/);
    if (topMatch) {
      result[topMatch[1]] = topMatch[2].replace(/^["']|["']$/g, '').trim();
      i++; continue;
    }

    // suite entry
    var suiteMatch = line.match(/^\s{2}- name:\s*(.+)/);
    if (suiteMatch) {
      if (currentCase) { if (currentSuite) currentSuite.cases.push(currentCase); currentCase = null; }
      if (currentSuite) result.suites.push(currentSuite);
      currentSuite = { name: suiteMatch[1].replace(/^["']|["']$/g, '').trim(), type: 'unittest', cases: [] };
      inInput = false; inExpected = false;
      i++; continue;
    }

    if (currentSuite) {
      var typeMatch = line.match(/^\s{4}type:\s*(.+)/);
      if (typeMatch) {
        currentSuite.type = typeMatch[1].trim();
        i++; continue;
      }

      // signature block
      if (line.match(/^\s{4}signature:\s*$/)) {
        var sigResult = parseSignatureBlock(lines, i + 1, 4);
        currentSuite.signature = sigResult.signature;
        i = sigResult.nextIndex;
        continue;
      }

      // case entry
      var caseTitle = line.match(/^\s{6}- title:\s*(.+)/);
      if (caseTitle) {
        if (currentCase) currentSuite.cases.push(currentCase);
        currentCase = {
          title: caseTitle[1].replace(/^["']|["']$/g, '').trim(),
          description: '', input: {}, expected: {}
        };
        inInput = false; inExpected = false;
        i++; continue;
      }

      if (currentCase) {
        var descMatch = line.match(/^\s{8}description:\s*(.+)/);
        if (descMatch) {
          currentCase.description = descMatch[1].replace(/^["']|["']$/g, '').trim();
          inInput = false; inExpected = false;
          i++; continue;
        }

        if (line.match(/^\s{8}input:$/)) { inInput = true; inExpected = false; i++; continue; }
        if (line.match(/^\s{8}expected:$/)) { inExpected = true; inInput = false; i++; continue; }

        if (inInput) {
          var inputProp = line.match(/^(\s{10,})(\w+):\s*(.*)$/);
          if (inputProp) {
            var inIndent = inputProp[1].length;
            var inKey = inputProp[2];
            var inRawVal = inputProp[3];
            if (inRawVal === '|' || inRawVal === '>') {
              var inBlock = readBlockScalar(lines, i + 1, inIndent, inRawVal);
              currentCase.input[inKey] = inBlock.value;
              i = inBlock.nextIndex; continue;
            }
            currentCase.input[inKey] = coerceScalar(inRawVal);
            i++; continue;
          }
        }

        if (inExpected) {
          var expProp = line.match(/^(\s{10,})(\w+):\s*(.*)$/);
          if (expProp) {
            var exIndent = expProp[1].length;
            var exKey = expProp[2];
            var exRawVal = expProp[3];
            if (exRawVal === '|' || exRawVal === '>') {
              var exBlock = readBlockScalar(lines, i + 1, exIndent, exRawVal);
              currentCase.expected[exKey] = exBlock.value;
              i = exBlock.nextIndex; continue;
            }
            currentCase.expected[exKey] = coerceScalar(exRawVal);
            i++; continue;
          }
        }

        // inline input/expected on same line
        var inlineInput = line.match(/^\s{8}input:\s*(.+)/);
        if (inlineInput) {
          currentCase.input = inlineInput[1].replace(/^["']|["']$/g, '').trim();
          inInput = false; inExpected = false;
          i++; continue;
        }
        var inlineExpected = line.match(/^\s{8}expected:\s*(.+)/);
        if (inlineExpected) {
          currentCase.expected = inlineExpected[1].replace(/^["']|["']$/g, '').trim();
          inInput = false; inExpected = false;
          i++; continue;
        }
      }
    }

    i++;
  }

  if (currentCase && currentSuite) currentSuite.cases.push(currentCase);
  if (currentSuite) result.suites.push(currentSuite);

  return result;
}

// --- Prompt Meta YAML Parser ---

function parsePromptMetaYaml(text) {
  var result = {
    target: '', type: '', prompt_name: '', last_updated: '',
    judge: { model: '', temperature: 0, max_retries: 0 },
    criteria: [], checks: [], thresholds: { pass: 0, warn: 0, per_criterion: {} },
    cases: [],
    // Umbrella-pattern fields. Populated only when a prompt-meta.yaml
    // delegates to an external test infrastructure (see /test-add:prompt
    // when pointing at pre-existing test code instead of scaffolding).
    prompts: [],                    // sub-prompt registry: [{name, description, cases, runner, status, notes, _dirCount}]
    external_cases: null            // { source, pattern, _globCount } when top-level cases are external
  };
  if (!text) return result;

  var lines = text.split('\n');
  var i = 0;
  var section = ''; // track which top-level key we're in

  while (i < lines.length) {
    var line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // top-level scalars
    var topMatch = line.match(/^(target|type|prompt_name|last_updated):\s*(.+)/);
    if (topMatch) {
      result[topMatch[1]] = topMatch[2].replace(/^["']|["']$/g, '').trim();
      section = '';
      i++; continue;
    }

    // judge block
    if (line.match(/^judge:\s*$/)) {
      section = 'judge';
      i++;
      while (i < lines.length) {
        var jl = lines[i];
        if (jl.trim() === '') { i++; continue; }
        var jm = jl.match(/^\s+(model|temperature|max_retries):\s*(.+)/);
        if (jm) {
          var jv = jm[2].trim().replace(/^["']|["']$/g, '');
          if (jm[1] === 'temperature') jv = parseFloat(jv) || 0;
          else if (jm[1] === 'max_retries') jv = parseInt(jv) || 0;
          result.judge[jm[1]] = jv;
          i++; continue;
        }
        if (!jl.match(/^\s/)) break;
        i++;
      }
      continue;
    }

    // criteria block
    if (line.match(/^criteria:\s*$/)) {
      section = 'criteria';
      i++;
      var currentCrit = null;
      while (i < lines.length) {
        var cl = lines[i];
        if (cl.trim() === '') { i++; continue; }
        var cindent = cl.match(/^(\s*)/);
        if (cindent && cindent[1].length === 0 && !cl.match(/^\s*-/)) {
          if (currentCrit) result.criteria.push(currentCrit);
          break;
        }
        var critStart = cl.match(/^\s*- name:\s*(.+)/);
        if (critStart) {
          if (currentCrit) result.criteria.push(currentCrit);
          currentCrit = { name: critStart[1].replace(/^["']|["']$/g, '').trim(), weight: 0, rubric: '', scale: '' };
          i++; continue;
        }
        if (currentCrit) {
          var critProp = cl.match(/^\s+(weight|rubric|scale):\s*(.+)/);
          if (critProp) {
            var cv = critProp[2].trim().replace(/^["']|["']$/g, '');
            if (critProp[1] === 'weight') cv = parseFloat(cv) || 0;
            currentCrit[critProp[1]] = cv;
            i++; continue;
          }
        }
        i++;
      }
      if (currentCrit) result.criteria.push(currentCrit);
      continue;
    }

    // checks block
    if (line.match(/^checks:\s*$/)) {
      section = 'checks';
      i++;
      var currentCheck = null;
      while (i < lines.length) {
        var ckl = lines[i];
        if (ckl.trim() === '') { i++; continue; }
        var ckindent = ckl.match(/^(\s*)/);
        if (ckindent && ckindent[1].length === 0 && !ckl.match(/^\s*-/)) {
          if (currentCheck) result.checks.push(currentCheck);
          break;
        }
        var checkStart = ckl.match(/^\s*- name:\s*(.+)/);
        if (checkStart) {
          if (currentCheck) result.checks.push(currentCheck);
          currentCheck = { name: checkStart[1].replace(/^["']|["']$/g, '').trim(), type: '', rule: '', prompt: '', pass_condition: '' };
          i++; continue;
        }
        if (currentCheck) {
          var checkProp = ckl.match(/^\s+(type|rule|prompt|pass_condition):\s*(.+)/);
          if (checkProp) {
            currentCheck[checkProp[1]] = checkProp[2].trim().replace(/^["']|["']$/g, '');
            i++; continue;
          }
        }
        i++;
      }
      if (currentCheck) result.checks.push(currentCheck);
      continue;
    }

    // thresholds block
    if (line.match(/^thresholds:\s*$/)) {
      section = 'thresholds';
      i++;
      var inPerCrit = false;
      while (i < lines.length) {
        var tl = lines[i];
        if (tl.trim() === '') { i++; continue; }
        var tindent = tl.match(/^(\s*)/);
        if (tindent && tindent[1].length === 0) break;
        if (tl.match(/^\s+per_criterion:\s*$/)) {
          inPerCrit = true;
          i++; continue;
        }
        if (inPerCrit) {
          var pcMatch = tl.match(/^\s{4,}(\w+):\s*(.+)/);
          if (pcMatch) {
            result.thresholds.per_criterion[pcMatch[1]] = parseFloat(pcMatch[2]) || 0;
            i++; continue;
          }
          if (tl.match(/^\s{2}\w/)) { inPerCrit = false; }
        }
        var threshProp = tl.match(/^\s+(pass|warn):\s*(.+)/);
        if (threshProp) {
          result.thresholds[threshProp[1]] = parseFloat(threshProp[2]) || 0;
          i++; continue;
        }
        i++;
      }
      continue;
    }

    // cases block — two forms supported:
    //   1. Inline list:   cases:\n  - title: ...           (legacy / self-contained)
    //   2. External ref:  cases:\n    source: external\n    pattern: "..."
    //                                                       (umbrella over existing infra)
    if (line.match(/^cases:\s*$/)) {
      section = 'cases';
      // Peek ahead: is the next non-blank line `source:` (external) or `- title:` (inline)?
      var peek = i + 1;
      while (peek < lines.length && lines[peek].trim() === '') peek++;
      if (peek < lines.length && /^\s+(source|pattern):/.test(lines[peek])) {
        // External-cases form
        result.external_cases = { source: '', pattern: '' };
        i++;
        while (i < lines.length) {
          var xl = lines[i];
          if (xl.trim() === '') { i++; continue; }
          // Break on any non-indented line (end of block)
          if (/^\S/.test(xl)) break;
          var xm = xl.match(/^\s+(source|pattern):\s*(.+)/);
          if (xm) {
            result.external_cases[xm[1]] = xm[2].trim().replace(/^["']|["']$/g, '');
            i++; continue;
          }
          // Unknown key under cases — skip
          i++;
        }
        continue;
      }
      // Inline-cases form (original behavior)
      i++;
      var currentCase = null;
      var inCaseInput = false;
      var inManualOverride = false;
      var inExpectedScoreRange = false;
      while (i < lines.length) {
        var cal = lines[i];
        if (cal.trim() === '') { i++; continue; }
        var caindent = cal.match(/^(\s*)/);
        if (caindent && caindent[1].length === 0 && !cal.match(/^\s*-/)) {
          if (currentCase) result.cases.push(currentCase);
          break;
        }
        var caseStart = cal.match(/^\s*- title:\s*(.+)/);
        if (caseStart) {
          if (currentCase) result.cases.push(currentCase);
          currentCase = {
            title: caseStart[1].replace(/^["']|["']$/g, '').trim(),
            category: '', input: {}, expected_behavior: '',
            expected_score_range: { min: 0, max: 0 }
          };
          inCaseInput = false; inManualOverride = false; inExpectedScoreRange = false;
          i++; continue;
        }
        if (currentCase) {
          // category / expected_behavior
          var caseProp = cal.match(/^\s{4}(category|expected_behavior):\s*(.+)/);
          if (caseProp) {
            currentCase[caseProp[1]] = caseProp[2].trim().replace(/^["']|["']$/g, '');
            inCaseInput = false; inManualOverride = false; inExpectedScoreRange = false;
            i++; continue;
          }
          // input block
          if (cal.match(/^\s{4}input:\s*$/)) {
            inCaseInput = true; inManualOverride = false; inExpectedScoreRange = false;
            i++; continue;
          }
          if (inCaseInput) {
            var inputProp = cal.match(/^\s{6,}(\w+):\s*(.+)/);
            if (inputProp) {
              currentCase.input[inputProp[1]] = inputProp[2].trim().replace(/^["']|["']$/g, '');
              i++; continue;
            }
            if (!cal.match(/^\s{6}/)) inCaseInput = false;
          }
          // expected_score_range block
          if (cal.match(/^\s{4}expected_score_range:\s*$/)) {
            inExpectedScoreRange = true; inCaseInput = false; inManualOverride = false;
            i++; continue;
          }
          if (inExpectedScoreRange) {
            var srMatch = cal.match(/^\s{6}(min|max):\s*(.+)/);
            if (srMatch) {
              currentCase.expected_score_range[srMatch[1]] = parseFloat(srMatch[2]) || 0;
              i++; continue;
            }
            if (!cal.match(/^\s{6}/)) inExpectedScoreRange = false;
          }
          // manual_override block
          if (cal.match(/^\s{4}manual_override:\s*$/)) {
            inManualOverride = true; inCaseInput = false; inExpectedScoreRange = false;
            currentCase.manual_override = { score: 0, timestamp: '', reason: '' };
            i++; continue;
          }
          if (inManualOverride) {
            var moMatch = cal.match(/^\s{6}(score|timestamp|reason):\s*(.+)/);
            if (moMatch) {
              var moVal = moMatch[2].trim().replace(/^["']|["']$/g, '');
              if (moMatch[1] === 'score') moVal = parseFloat(moVal) || 0;
              currentCase.manual_override[moMatch[1]] = moVal;
              i++; continue;
            }
            if (!cal.match(/^\s{6}/)) inManualOverride = false;
          }
        }
        i++;
      }
      if (currentCase) result.cases.push(currentCase);
      continue;
    }

    // prompts block — umbrella sub-prompt registry. Each entry:
    //   - name: evaluation
    //     description: "..."
    //     cases: path/to/test-cases/  OR nested { source, pattern }
    //     runner: path/to/runner.ts
    //     status: in_development    (optional)
    //     notes: "..."              (optional)
    //     language_pairs: [a, b]    (optional, inline array)
    if (line.match(/^prompts:\s*$/)) {
      section = 'prompts';
      i++;
      var currentPrompt = null;
      while (i < lines.length) {
        var pl = lines[i];
        if (pl.trim() === '') { i++; continue; }
        if (/^\S/.test(pl)) {
          if (currentPrompt) result.prompts.push(currentPrompt);
          currentPrompt = null;
          break;
        }
        var pStart = pl.match(/^\s*-\s+name:\s*(.+)/);
        if (pStart) {
          if (currentPrompt) result.prompts.push(currentPrompt);
          currentPrompt = {
            name: pStart[1].replace(/^["']|["']$/g, '').trim(),
            description: '', cases: '', runner: '', status: '',
            notes: '', language_pairs: []
          };
          i++; continue;
        }
        if (currentPrompt) {
          var pProp = pl.match(/^\s+(description|cases|runner|status|notes):\s*(.+)/);
          if (pProp) {
            var pv = pProp[2].trim().replace(/^["']|["']$/g, '');
            currentPrompt[pProp[1]] = pv;
            i++; continue;
          }
          var langProp = pl.match(/^\s+language_pairs:\s*\[(.*)\]\s*$/);
          if (langProp) {
            currentPrompt.language_pairs = langProp[1].split(',')
              .map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); })
              .filter(function (s) { return s.length > 0; });
            i++; continue;
          }
        }
        i++;
      }
      if (currentPrompt) result.prompts.push(currentPrompt);
      continue;
    }

    i++;
  }

  return result;
}

/**
 * Count files matching a glob pattern relative to the project root.
 * Supports `*` (single segment) and `**` (recursive). Returns 0 on any
 * error so callers don't need try/catch — the UI gracefully shows 0
 * for missing/invalid patterns.
 */
function countFilesByPattern(pattern, projectRoot) {
  if (!pattern) return 0;
  try {
    var fs = require('fs');
    var path = require('path');

    // Trim leading ./ and anchor to projectRoot
    var rel = pattern.replace(/^\.\//, '');

    // Split into literal prefix + glob tail for efficient walking
    var parts = rel.split('/');
    var litEnd = 0;
    for (var p = 0; p < parts.length; p++) {
      if (/[*?\[\]]/.test(parts[p])) break;
      litEnd = p + 1;
    }
    var startDir = path.join.apply(null, [projectRoot].concat(parts.slice(0, litEnd)));
    if (!fs.existsSync(startDir)) return 0;

    // Build a regex from the glob tail
    var tail = parts.slice(litEnd).join('/');
    if (!tail) {
      // No glob — is the literal path a file? If so, 1; else if dir, count .ts/.md/.yaml files inside
      var stat = fs.statSync(startDir);
      if (stat.isFile()) return 1;
      if (stat.isDirectory()) {
        var n = 0;
        var walk = function (dir) {
          var items;
          try { items = fs.readdirSync(dir); } catch (e) { return; }
          for (var k = 0; k < items.length; k++) {
            var ip = path.join(dir, items[k]);
            var s;
            try { s = fs.statSync(ip); } catch (e) { continue; }
            if (s.isDirectory()) walk(ip);
            else n++;
          }
        };
        walk(startDir);
        return n;
      }
      return 0;
    }

    // Escape regex metacharacters except * / ?
    var regexSrc = tail
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '__STAR_STAR_SLASH__')
      .replace(/\*\*/g, '__STAR_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/__STAR_STAR_SLASH__/g, '(?:.*/)?')
      .replace(/__STAR_STAR__/g, '.*');
    var re = new RegExp('^' + regexSrc + '$');

    var count = 0;
    var walker = function (dir, prefix) {
      var items;
      try { items = fs.readdirSync(dir); } catch (e) { return; }
      for (var k = 0; k < items.length; k++) {
        var ip = path.join(dir, items[k]);
        var relPath = prefix ? prefix + '/' + items[k] : items[k];
        var s;
        try { s = fs.statSync(ip); } catch (e) { continue; }
        if (s.isDirectory()) {
          walker(ip, relPath);
        } else if (re.test(relPath)) {
          count++;
        }
      }
    };
    walker(startDir, '');
    return count;
  } catch (e) {
    return 0;
  }
}

function scanPromptTests(dir) {
  var results = [];
  var entries = safeReadDir(dir);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry);
    try {
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(scanPromptTests(fullPath));
      } else if (entry === 'prompt-meta.yaml') {
        var text = safeReadFile(fullPath);
        var meta = parsePromptMetaYaml(text);
        meta._dir = path.relative(path.join(OMNISCITUS_DIR, 'tests', 'prompts'), path.dirname(fullPath));
        // also try to read judge.md alongside
        var judgePath = path.join(path.dirname(fullPath), 'judge.md');
        meta._judgeMd = safeReadFile(judgePath);
        results.push(meta);
      }
    } catch (e) { /* skip */ }
  }
  return results;
}

// --- API Handlers ---

// Recursively walk a blueprints directory tree and yield every *.yaml file.
// Skips _index.yaml (nested split metadata) and _summaries.yaml (folder
// descriptions, parsed separately).
function collectBlueprintYamls(dir) {
  var out = [];
  var entries = safeReadDir(dir);
  for (var i = 0; i < entries.length; i++) {
    var name = entries[i];
    var full = path.join(dir, name);
    var stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (stat.isDirectory()) {
      out = out.concat(collectBlueprintYamls(full));
    } else if (name.endsWith('.yaml') && name !== '_index.yaml' && name !== '_summaries.yaml') {
      out.push(full);
    }
  }
  return out;
}

// Parse blueprints/_summaries.yaml — flat path-keyed map of folder
// descriptions written by /omniscitus-migrate, stale-marked by the
// PostToolUse hook, refreshed by /wrap-up. See issue #17.
function parseSummariesYaml(text) {
  var out = {};
  if (!text) return out;
  var lines = text.split('\n');
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var keyMatch = line.match(/^  ([^\s].*):\s*$/);
    if (keyMatch) {
      current = keyMatch[1].replace(/^["']|["']$/g, '');
      out[current] = {
        description: '', generated_at: '', generated_by: '',
        stale: false, file_count: 0
      };
      continue;
    }
    if (current) {
      var prop = line.match(/^    (description|generated_at|generated_by|stale|file_count):\s*(.*)/);
      if (prop) {
        var k = prop[1];
        var v = prop[2].replace(/^["']|["']$/g, '').trim();
        if (k === 'stale') v = (v === 'true');
        else if (k === 'file_count') v = parseInt(v, 10) || 0;
        out[current][k] = v;
      }
    }
  }
  return out;
}

// Serve a single text file from the project root so the viewer popup
// in blueprint/constellation can render its contents. Hard rules:
// - paths are relative to PROJECT_ROOT
// - no `..`, no absolute paths (traversal guard)
// - refuse >500KB files (preview UI, not an editor)
// - refuse binary files (null byte in first 8KB)
function handleApiFile(req, res) {
  var q = require('url').parse(req.url, true).query || {};
  var rel = q.path || '';
  if (!rel || rel.indexOf('..') !== -1 || path.isAbsolute(rel)) {
    return jsonRes(res, 400, { error: 'invalid path' });
  }
  var full = path.join(PROJECT_ROOT, rel);
  if (full.indexOf(PROJECT_ROOT + path.sep) !== 0 && full !== PROJECT_ROOT) {
    return jsonRes(res, 400, { error: 'path escapes project root' });
  }
  try {
    var stat = fs.statSync(full);
    if (!stat.isFile()) return jsonRes(res, 404, { error: 'not a file' });
    if (stat.size > 500 * 1024) return jsonRes(res, 413, { error: 'file too large (>500KB)' });
    var buf = fs.readFileSync(full);
    // naive binary detection
    var sample = buf.slice(0, Math.min(buf.length, 8192));
    for (var i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return jsonRes(res, 415, { error: 'binary file' });
    }
    return jsonRes(res, 200, { path: rel, content: buf.toString('utf-8'), size: stat.size });
  } catch (e) {
    return jsonRes(res, 404, { error: 'not found' });
  }
}

function handleApiBlueprints(req, res) {
  var blueprintsDir = path.join(OMNISCITUS_DIR, 'blueprints');
  var merged = {
    version: 1,
    updated: '',
    files: {},
    repo_url: REPO_URL,
    summaries: parseSummariesYaml(safeReadFile(path.join(blueprintsDir, '_summaries.yaml')))
  };

  // Recursively read every blueprint yaml under blueprints/, including
  // nested splits like blueprints/_claude/{_root,skills,wrap-up}.yaml
  // declared via blueprint_splits (RFC #10).
  var yamlPaths = collectBlueprintYamls(blueprintsDir);
  for (var i = 0; i < yamlPaths.length; i++) {
    var text = safeReadFile(yamlPaths[i]);
    if (!text) continue;
    var parsed = parseBlueprints(text);
    if (parsed.updated > merged.updated) merged.updated = parsed.updated;
    var paths = Object.keys(parsed.files);
    for (var j = 0; j < paths.length; j++) {
      merged.files[paths[j]] = parsed.files[paths[j]];
    }
  }

  // Fallback: also check legacy single blueprints.yaml
  var legacyPath = path.join(OMNISCITUS_DIR, 'blueprints.yaml');
  var legacyText = safeReadFile(legacyPath);
  if (legacyText) {
    var legacy = parseBlueprints(legacyText);
    if (legacy.updated > merged.updated) merged.updated = legacy.updated;
    var legacyPaths = Object.keys(legacy.files);
    for (var k = 0; k < legacyPaths.length; k++) {
      // Only add if not already present in per-directory files (per-dir takes precedence)
      if (!merged.files[legacyPaths[k]]) {
        merged.files[legacyPaths[k]] = legacy.files[legacyPaths[k]];
      }
    }
  }

  jsonRes(res, 200, merged);
}

function handleApiUnits(req, res) {
  var indexPath = path.join(OMNISCITUS_DIR, 'history', '_index.yaml');
  var text = safeReadFile(indexPath);
  var units = parseIndexYaml(text);
  var weeklySummaries = parseWeeklySummariesYaml(text);

  var historyDir = path.join(OMNISCITUS_DIR, 'history');
  var domains = safeReadDir(historyDir).filter(function (d) {
    // _weekly is not a domain — filter it out of the domain list
    if (d === '_weekly') return false;
    try { return fs.statSync(path.join(historyDir, d)).isDirectory(); } catch (e) { return false; }
  });

  // Load weekly-summary markdown bodies so the UI can render without a
  // second round-trip. file field is relative to the history/ dir.
  for (var w = 0; w < weeklySummaries.length; w++) {
    var ws = weeklySummaries[w];
    if (!ws.file) continue;
    var wsPath = path.join(historyDir, ws.file);
    var wsContent = safeReadFile(wsPath);
    if (wsContent) ws.content = wsContent;
  }

  // Resolve unit.content from disk. Prefer the explicit `file:` field
  // (added to the schema in 0.1.2). Fall back to a basename scan for
  // _index.yaml entries written by older wrap-up runs that didn't
  // record `file:`.
  for (var u = 0; u < units.length; u++) {
    var unit = units[u];

    if (unit.file) {
      var direct = path.join(historyDir, unit.file);
      var content = safeReadFile(direct);
      if (content) {
        unit.content = content;
        unit.participants = extractParticipants(content);
        continue;
      }
      // file field present but path is wrong — fall through to scan
    }

    // Basename fallback. Strip any leading "{domain}/" so legacy ids and
    // domain-prefixed ids both reduce to the filename stem we expect on disk.
    var idBasename = unit.id.indexOf('/') !== -1
      ? unit.id.split('/').pop()
      : unit.id;

    for (var d = 0; d < domains.length; d++) {
      var domainDir = path.join(historyDir, domains[d]);
      var files = safeReadDir(domainDir);
      for (var f = 0; f < files.length; f++) {
        if (files[f].indexOf(idBasename) !== -1 && files[f].endsWith('.md')) {
          unit.content = safeReadFile(path.join(domainDir, files[f]));
          unit.file = domains[d] + '/' + files[f];
          break;
        }
      }
      if (unit.content) break;
    }
    if (unit.content) unit.participants = extractParticipants(unit.content);
    if (!unit.participants) unit.participants = [];
  }

  jsonRes(res, 200, { units: units, domains: domains, weekly_summaries: weeklySummaries });
}

function scanTestsRecursive(dir, base) {
  var results = [];
  var entries = safeReadDir(dir);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry);
    try {
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(scanTestsRecursive(fullPath, base));
      } else if (entry === 'meta.yaml') {
        var relDir = path.relative(base, dir);
        var text = safeReadFile(fullPath);
        var meta = parseMetaYaml(text);
        meta._dir = relDir;
        results.push(meta);
      }
    } catch (e) { /* skip */ }
  }
  return results;
}

function handleApiTests(req, res) {
  var testsDir = path.join(OMNISCITUS_DIR, 'tests');
  var tests = scanTestsRecursive(testsDir, testsDir);
  // Add type: "code" to each test result
  for (var i = 0; i < tests.length; i++) {
    tests[i].type = 'code';
  }
  jsonRes(res, 200, { tests: tests });
}

/**
 * Strip block + line comments from TypeScript/JavaScript source so the
 * id/name regex doesn't false-match inside `/* … *\/` or `// …` regions.
 * Naive but good enough for our prompt-test-case files (no string
 * literals containing `//` adjacent to `id:`/`name:` patterns observed).
 */
function stripJsComments(src) {
  // Remove /* ... */ first (greedy across lines disabled by [\s\S])
  var noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then // to end-of-line
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Pull `{ id, name }` pairs from a TypeScript test-case file.
 *
 * Heuristic regex extractor — assumes prompt-optimization conventions:
 *
 *     const fooTestCases: SomeType[] = [
 *       {
 *         id: "foo",
 *         name: "Foo bar",
 *         ...
 *       },
 *     ];
 *
 * Ignores comments. Pairs each `id:` with the *next* `name:` that
 * appears within 6 lines (to handle minor field reordering). Both fields
 * must be quoted string literals — anything dynamic is silently skipped.
 *
 * Birdview shows these for browse/index, not execution. Inputs and
 * expected_behavior aren't extracted — read the .ts file directly for
 * those.
 */
function extractTsTestCaseTitles(filePath) {
  if (!filePath) return [];
  try {
    var text = fs.readFileSync(filePath, 'utf-8');
    var stripped = stripJsComments(text);

    // Position-based scan so both inline `{ id: "x", name: "y" }` and
    // multi-line object forms work. A field is recognized when its
    // name is preceded by whitespace, `{`, or `,` (avoids false matches
    // inside identifier-like positions).
    //
    // Field aliases: id | elementId | testId  (different test schemas)
    //                name | title              (different test schemas)
    // Quote forms:   "..." | '...' | `...`    (including template literals;
    //                                          ${...} interpolation
    //                                          appears as literal text)
    var fields = [];
    var idRe = /(?:^|[\s{,])(?:id|elementId|testId)\s*:\s*["'`]([^"'`\n]+)["'`]/g;
    var nameRe = /(?:^|[\s{,])(?:name|title)\s*:\s*["'`]([^"'`\n]+)["'`]/g;
    var m;
    while ((m = idRe.exec(stripped)) !== null) {
      fields.push({ kind: 'id', value: m[1], pos: m.index });
    }
    while ((m = nameRe.exec(stripped)) !== null) {
      fields.push({ kind: 'name', value: m[1], pos: m.index });
    }
    fields.sort(function (a, b) { return a.pos - b.pos; });

    var titles = [];
    var pending = null;
    for (var k = 0; k < fields.length; k++) {
      var f = fields[k];
      if (f.kind === 'id') {
        // If we never paired the previous id with a name, drop it
        // (prevents id/id/name from picking the wrong pairing).
        pending = f;
      } else if (f.kind === 'name' && pending && (f.pos - pending.pos) < 500) {
        titles.push({ id: pending.value, name: f.value });
        pending = null;
      }
    }
    return titles;
  } catch (e) {
    return [];
  }
}

/**
 * Walk a directory (recursively) collecting test-case titles from every
 * .ts file. Returns an array of { id, name, file } where file is the
 * basename for display. Returns [] if the path doesn't exist or isn't
 * a file/dir we can read.
 */
function extractTitlesFromCasesPath(absPath) {
  try {
    var stat = fs.statSync(absPath);
    if (stat.isFile() && /\.tsx?$/.test(absPath)) {
      return extractTsTestCaseTitles(absPath).map(function (t) {
        return { id: t.id, name: t.name, file: path.basename(absPath) };
      });
    }
    if (!stat.isDirectory()) return [];
    var out = [];
    var entries = safeReadDir(absPath);
    for (var i = 0; i < entries.length; i++) {
      out = out.concat(extractTitlesFromCasesPath(path.join(absPath, entries[i])));
    }
    return out;
  } catch (e) { return []; }
}

function handleApiPromptTests(req, res) {
  var promptsDir = path.join(OMNISCITUS_DIR, 'tests', 'prompts');
  var tests = scanPromptTests(promptsDir);

  // Enrich umbrella-pattern metas with external case counts so the UI
  // can show real numbers instead of "0 Cases" when the actual test
  // infra lives outside .omniscitus/tests/prompts/.
  for (var t = 0; t < tests.length; t++) {
    var meta = tests[t];
    if (meta.external_cases && meta.external_cases.pattern) {
      meta.external_cases._globCount = countFilesByPattern(meta.external_cases.pattern, PROJECT_ROOT);
    }
    if (meta.prompts && meta.prompts.length > 0) {
      for (var sp = 0; sp < meta.prompts.length; sp++) {
        var subp = meta.prompts[sp];
        if (subp.cases) {
          subp._dirCount = countFilesByPattern(subp.cases, PROJECT_ROOT);
          // Pull case titles via heuristic TS extraction so birdview
          // can render a per-sub-prompt title list (browse/index UX).
          var absCases = path.isAbsolute(subp.cases)
            ? subp.cases
            : path.join(PROJECT_ROOT, subp.cases);
          subp._titles = extractTitlesFromCasesPath(absCases);
        }
      }
    }
  }

  jsonRes(res, 200, { tests: tests });
}

// --- Reviews API Handlers ---

function getReviewsDir() {
  return path.join(OMNISCITUS_DIR, 'reviews');
}

function handleGetReviews(req, res) {
  var urlParts = req.url.split('?');
  var query = {};
  if (urlParts[1]) {
    var pairs = urlParts[1].split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
  }
  var filterPage = query.page || '';

  var reviewsDir = getReviewsDir();
  var files = safeReadDir(reviewsDir).filter(function(f) { return f.endsWith('.json'); });
  var reviews = [];

  for (var i = 0; i < files.length; i++) {
    var content = safeReadFile(path.join(reviewsDir, files[i]));
    if (!content) continue;
    try {
      var review = JSON.parse(content);
      review._id = files[i];
      if (!filterPage || review.page === filterPage) {
        reviews.push(review);
      }
    } catch (e) { /* skip invalid JSON */ }
  }

  // Sort by timestamp descending (newest first)
  reviews.sort(function(a, b) {
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  jsonRes(res, 200, { reviews: reviews });
}

function handlePostReview(req, res) {
  readBody(req).then(function(bodyStr) {
    var body;
    try {
      body = JSON.parse(bodyStr);
    } catch (e) {
      return jsonRes(res, 400, { success: false, message: 'Invalid JSON body' });
    }

    if (!body.page || !body.comment) {
      return jsonRes(res, 400, { success: false, message: 'Missing required fields: page, comment' });
    }

    var reviewsDir = getReviewsDir();
    try {
      fs.mkdirSync(reviewsDir, { recursive: true });
    } catch (e) { /* already exists */ }

    var timestamp = new Date().toISOString();
    var filename = Date.now() + '-' + body.page + '.json';
    var review = {
      page: body.page,
      context: body.context || '',
      author: body.author || 'anonymous',
      timestamp: timestamp,
      comment: body.comment,
      resolved: false
    };

    try {
      fs.writeFileSync(path.join(reviewsDir, filename), JSON.stringify(review, null, 2), 'utf-8');
    } catch (e) {
      return jsonRes(res, 500, { success: false, message: 'Failed to write review: ' + e.message });
    }

    jsonRes(res, 201, { success: true, id: filename });
  }).catch(function(e) {
    jsonRes(res, 500, { success: false, message: 'Error reading request: ' + e.message });
  });
}

function handlePatchReview(req, res, reviewId) {
  readBody(req).then(function(bodyStr) {
    var body;
    try {
      body = JSON.parse(bodyStr);
    } catch (e) {
      return jsonRes(res, 400, { success: false, message: 'Invalid JSON body' });
    }

    var reviewPath = path.join(getReviewsDir(), reviewId);
    var content = safeReadFile(reviewPath);
    if (!content) {
      return jsonRes(res, 404, { success: false, message: 'Review not found: ' + reviewId });
    }

    var review;
    try {
      review = JSON.parse(content);
    } catch (e) {
      return jsonRes(res, 500, { success: false, message: 'Corrupt review file' });
    }

    if (body.resolved !== undefined) {
      review.resolved = !!body.resolved;
    }

    try {
      fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf-8');
    } catch (e) {
      return jsonRes(res, 500, { success: false, message: 'Failed to update review: ' + e.message });
    }

    jsonRes(res, 200, { success: true });
  }).catch(function(e) {
    jsonRes(res, 500, { success: false, message: 'Error reading request: ' + e.message });
  });
}

// --- YAML Writer Helpers ---

/**
 * Serialize a JS value to YAML lines at the given indent level.
 * Returns an array of strings (lines without trailing newline).
 */
function valueToYamlLines(val, indent) {
  var prefix = new Array(indent + 1).join(' ');
  var lines = [];

  if (val === null || val === undefined) {
    return [];
  }

  if (Array.isArray(val)) {
    for (var a = 0; a < val.length; a++) {
      var item = val[a];
      if (typeof item === 'object' && item !== null) {
        var keys = Object.keys(item);
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var child = item[key];
          if (k === 0) {
            // first key gets the dash
            if (typeof child === 'object' && child !== null) {
              lines.push(prefix + '- ' + key + ':');
              var sub = valueToYamlLines(child, indent + 4);
              lines = lines.concat(sub);
            } else {
              lines.push(prefix + '- ' + key + ': ' + formatYamlScalar(child));
            }
          } else {
            // subsequent keys indented past the dash
            if (typeof child === 'object' && child !== null) {
              lines.push(prefix + '  ' + key + ':');
              var sub2 = valueToYamlLines(child, indent + 4);
              lines = lines.concat(sub2);
            } else {
              lines.push(prefix + '  ' + key + ': ' + formatYamlScalar(child));
            }
          }
        }
      } else {
        lines.push(prefix + '- ' + formatYamlScalar(item));
      }
    }
    return lines;
  }

  if (typeof val === 'object') {
    var okeys = Object.keys(val);
    for (var j = 0; j < okeys.length; j++) {
      var okey = okeys[j];
      var oval = val[okey];
      if (typeof oval === 'object' && oval !== null) {
        lines.push(prefix + okey + ':');
        var nested = valueToYamlLines(oval, indent + 2);
        lines = lines.concat(nested);
      } else {
        lines.push(prefix + okey + ': ' + formatYamlScalar(oval));
      }
    }
    return lines;
  }

  // scalar at top level (shouldn't happen normally)
  lines.push(prefix + formatYamlScalar(val));
  return lines;
}

function formatYamlScalar(val) {
  if (val === true) return 'true';
  if (val === false) return 'false';
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'number') return String(val);
  var s = String(val);
  // quote strings that contain special chars or look like non-strings
  if (s.match(/[:#\[\]{}&*!|>'"`,@]/)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

/**
 * Build YAML text for a single test case at the correct indent level (6 spaces for dash, 8 for properties).
 */
function buildCaseYaml(caseObj) {
  var lines = [];
  lines.push('      - title: ' + formatYamlScalar(caseObj.title));

  if (caseObj.description) {
    lines.push('        description: ' + formatYamlScalar(caseObj.description));
  }

  if (caseObj.input !== undefined) {
    if (typeof caseObj.input === 'object' && caseObj.input !== null) {
      lines.push('        input:');
      var inputLines = valueToYamlLines(caseObj.input, 10);
      lines = lines.concat(inputLines);
    } else {
      lines.push('        input: ' + formatYamlScalar(caseObj.input));
    }
  }

  if (caseObj.expected !== undefined) {
    if (typeof caseObj.expected === 'object' && caseObj.expected !== null) {
      lines.push('        expected:');
      var expLines = valueToYamlLines(caseObj.expected, 10);
      lines = lines.concat(expLines);
    } else {
      lines.push('        expected: ' + formatYamlScalar(caseObj.expected));
    }
  }

  return lines.join('\n');
}

// --- POST Handlers ---

function handlePostTestCase(req, res) {
  readBody(req).then(function (bodyStr) {
    var body;
    try {
      body = JSON.parse(bodyStr);
    } catch (e) {
      return jsonRes(res, 400, { success: false, message: 'Invalid JSON body' });
    }

    var metaDir = body.metaDir;
    var suiteName = body.suiteName;
    var newCase = body['case'];

    if (!metaDir || !suiteName || !newCase || !newCase.title) {
      return jsonRes(res, 400, { success: false, message: 'Missing required fields: metaDir, suiteName, case.title' });
    }

    var metaPath = path.join(OMNISCITUS_DIR, 'tests', metaDir, 'meta.yaml');
    var text = safeReadFile(metaPath);
    if (!text) {
      return jsonRes(res, 404, { success: false, message: 'meta.yaml not found at ' + metaDir });
    }

    var lines = text.split('\n');

    // Find the target suite and locate the insertion point
    var suiteStartIdx = -1;
    var casesLineIdx = -1;
    var insertIdx = -1;
    var inTargetSuite = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // detect suite entry
      var sm = line.match(/^\s{2}- name:\s*(.+)/);
      if (sm) {
        var name = sm[1].replace(/^["']|["']$/g, '').trim();
        if (inTargetSuite) {
          // We hit the next suite — insert before this line
          insertIdx = i;
          break;
        }
        if (name === suiteName) {
          inTargetSuite = true;
          suiteStartIdx = i;
        }
        continue;
      }

      if (inTargetSuite) {
        if (line.match(/^\s{4}cases:\s*$/)) {
          casesLineIdx = i;
        }
      }
    }

    if (!inTargetSuite) {
      return jsonRes(res, 404, { success: false, message: 'Suite not found: ' + suiteName });
    }

    // If we never hit a next suite, insert at end of file
    if (insertIdx === -1) {
      // find last non-empty line from end
      insertIdx = lines.length;
      while (insertIdx > 0 && lines[insertIdx - 1].trim() === '') {
        insertIdx--;
      }
      insertIdx++; // after last content line (leave one blank)
    }

    var caseYaml = buildCaseYaml(newCase);

    // Insert the case lines
    lines.splice(insertIdx, 0, caseYaml);

    var newText = lines.join('\n');
    try {
      fs.writeFileSync(metaPath, newText, 'utf-8');
    } catch (e) {
      return jsonRes(res, 500, { success: false, message: 'Failed to write meta.yaml: ' + e.message });
    }

    jsonRes(res, 200, { success: true, message: 'Test case added' });
  }).catch(function (e) {
    jsonRes(res, 500, { success: false, message: 'Error reading request: ' + e.message });
  });
}

function handlePostTestRun(req, res) {
  readBody(req).then(function () {
    jsonRes(res, 200, { success: false, message: 'Test runner not yet implemented' });
  }).catch(function (e) {
    jsonRes(res, 500, { success: false, message: 'Error reading request: ' + e.message });
  });
}

// --- Router ---

var server = http.createServer(function (req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  var url = req.url.split('?')[0];

  // Static pages
  if (url === '/' || url === '/index.html') return htmlRes(res, path.join(BIRDVIEW_DIR, 'index.html'));
  if (url === '/blueprint' || url === '/blueprint.html') return htmlRes(res, path.join(BIRDVIEW_DIR, 'blueprint.html'));
  if (url === '/history' || url === '/history.html') return htmlRes(res, path.join(BIRDVIEW_DIR, 'history.html'));
  if (url === '/tests' || url === '/tests.html') return htmlRes(res, path.join(BIRDVIEW_DIR, 'tests.html'));
  if (url === '/constellation' || url === '/constellation.html') return htmlRes(res, path.join(BIRDVIEW_DIR, 'constellation.html'));

  // Favicons (shared with the omniscitus marketing site)
  if (url === '/favicon-16.png') return staticRes(res, path.join(BIRDVIEW_DIR, 'favicon-16.png'), 'image/png');
  if (url === '/favicon-32.png') return staticRes(res, path.join(BIRDVIEW_DIR, 'favicon-32.png'), 'image/png');
  if (url === '/favicon.ico') return staticRes(res, path.join(BIRDVIEW_DIR, 'favicon-32.png'), 'image/png');

  // API routes
  if (url === '/api/file') return handleApiFile(req, res);
  if (url === '/api/blueprints') return handleApiBlueprints(req, res);
  if (url === '/api/units') return handleApiUnits(req, res);
  if (url === '/api/tests' && req.method === 'GET') return handleApiTests(req, res);
  if (url === '/api/tests/case' && req.method === 'POST') return handlePostTestCase(req, res);
  if (url === '/api/tests/run' && req.method === 'POST') return handlePostTestRun(req, res);
  if (url === '/api/prompt-tests' && req.method === 'GET') return handleApiPromptTests(req, res);

  // Reviews routes
  if (url === '/api/reviews' && req.method === 'GET') return handleGetReviews(req, res);
  if (url === '/api/reviews' && req.method === 'POST') return handlePostReview(req, res);

  // PATCH /api/reviews/:id
  var reviewPatchMatch = url.match(/^\/api\/reviews\/(.+)$/);
  if (reviewPatchMatch && req.method === 'PATCH') {
    return handlePatchReview(req, res, reviewPatchMatch[1]);
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Only start the HTTP listener when the file is run directly. When it's
// required from a test (or any other tool), callers just want the pure
// yaml parsers exported below.
if (require.main === module) {
  var MAX_PORT_ATTEMPTS = 10;
  var attempts = 0;
  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS) {
      attempts++;
      var nextPort = PORT + 1;
      console.log('Port ' + PORT + ' in use, trying ' + nextPort + '...');
      PORT = nextPort;
      setTimeout(function () { server.listen(PORT); }, 50);
      return;
    }
    throw err;
  });
  server.listen(PORT, function () {
    console.log('Birdview running at http://localhost:' + PORT);
  });
}

// Exports for unit tests. Keeping these at the bottom avoids interfering
// with the existing script structure.
module.exports = {
  parseBlueprints: parseBlueprints,
  parseIndexYaml: parseIndexYaml,
  parseWeeklySummariesYaml: parseWeeklySummariesYaml,
  parseNestedYaml: parseNestedYaml,
  parsePromptMetaYaml: parsePromptMetaYaml,
  countFilesByPattern: countFilesByPattern,
  stripJsComments: stripJsComments,
  extractTsTestCaseTitles: extractTsTestCaseTitles,
  extractTitlesFromCasesPath: extractTitlesFromCasesPath
};
