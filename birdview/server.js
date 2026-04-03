'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = 3777;
var PROJECT_ROOT = process.argv[2] || process.cwd();
var OMNISCITUS_DIR = path.join(PROJECT_ROOT, '.omniscitus');
var BIRDVIEW_DIR = __dirname;

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    var fMatch = line.match(/^  ([^\s].*):$/);
    if (fMatch) {
      currentFile = fMatch[1];
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
        var aMatch = line.match(/^        (action|source):\s*(.+)/);
        if (aMatch && result.files[currentFile].change_log.length > 0) {
          var last = result.files[currentFile].change_log[result.files[currentFile].change_log.length - 1];
          last[aMatch[1]] = aMatch[2].trim();
          i++; continue;
        }
      }
    }

    i++;
  }

  return result;
}

function parseIndexYaml(text) {
  var units = [];
  if (!text) return units;

  var lines = text.split('\n');
  var current = null;
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    var idMatch = line.match(/^\s*- id:\s*(.+)/);
    if (idMatch) {
      if (current) units.push(current);
      current = {
        id: idMatch[1].trim(),
        domain: '', status: 'open', created: '', last_updated: '',
        session_count: 0, title: ''
      };
      i++; continue;
    }

    if (current) {
      var propMatch = line.match(/^\s+(domain|status|created|last_updated|session_count|title):\s*(.*)/);
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
          var inputProp = line.match(/^\s{10,}(\w+):\s*(.+)/);
          if (inputProp) {
            currentCase.input[inputProp[1]] = inputProp[2].replace(/^["']|["']$/g, '').trim();
            i++; continue;
          }
        }

        if (inExpected) {
          var expProp = line.match(/^\s{10,}(\w+):\s*(.+)/);
          if (expProp) {
            currentCase.expected[expProp[1]] = expProp[2].replace(/^["']|["']$/g, '').trim();
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

// --- API Handlers ---

function handleApiBlueprints(req, res) {
  var filePath = path.join(OMNISCITUS_DIR, 'blueprints.yaml');
  var text = safeReadFile(filePath);
  if (!text) return jsonRes(res, 200, { version: 1, updated: '', files: {} });
  jsonRes(res, 200, parseBlueprints(text));
}

function handleApiUnits(req, res) {
  var indexPath = path.join(OMNISCITUS_DIR, 'history', '_index.yaml');
  var text = safeReadFile(indexPath);
  var units = parseIndexYaml(text);

  // Read unit file content for each unit
  var historyDir = path.join(OMNISCITUS_DIR, 'history');
  var domains = safeReadDir(historyDir).filter(function (d) {
    try { return fs.statSync(path.join(historyDir, d)).isDirectory(); } catch (e) { return false; }
  });

  for (var u = 0; u < units.length; u++) {
    var unit = units[u];
    // find unit file across domains
    for (var d = 0; d < domains.length; d++) {
      var domainDir = path.join(historyDir, domains[d]);
      var files = safeReadDir(domainDir);
      for (var f = 0; f < files.length; f++) {
        if (files[f].indexOf(unit.id) !== -1 && files[f].endsWith('.md')) {
          unit.content = safeReadFile(path.join(domainDir, files[f]));
          unit.file = domains[d] + '/' + files[f];
          break;
        }
      }
      if (unit.content) break;
    }
  }

  jsonRes(res, 200, { units: units, domains: domains });
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
  jsonRes(res, 200, { tests: tests });
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // API routes
  if (url === '/api/blueprints') return handleApiBlueprints(req, res);
  if (url === '/api/units') return handleApiUnits(req, res);
  if (url === '/api/tests' && req.method === 'GET') return handleApiTests(req, res);
  if (url === '/api/tests/case' && req.method === 'POST') return handlePostTestCase(req, res);
  if (url === '/api/tests/run' && req.method === 'POST') return handlePostTestRun(req, res);

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, function () {
  console.log('Birdview running at http://localhost:' + PORT);
});
