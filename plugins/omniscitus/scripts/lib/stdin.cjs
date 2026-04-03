'use strict';

/**
 * Reads JSON from stdin with a timeout.
 * Claude Code hooks pipe tool context as JSON via stdin.
 * Returns parsed object or null on failure.
 */
function readStdin(timeoutMs) {
  timeoutMs = timeoutMs || 2000;
  return new Promise(function (resolve) {
    var chunks = [];
    var settled = false;

    function finish(data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      try { process.stdin.destroy(); } catch (_) {}
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        resolve(null);
      }
    }

    var timer = setTimeout(function () {
      finish(Buffer.concat(chunks).toString('utf-8'));
    }, timeoutMs);

    process.stdin.on('data', function (chunk) { chunks.push(chunk); });
    process.stdin.on('end', function () {
      finish(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', function () {
      finish('');
    });

    if (process.stdin.readableEnded) {
      finish(Buffer.concat(chunks).toString('utf-8'));
    }
  });
}

module.exports = { readStdin: readStdin };
