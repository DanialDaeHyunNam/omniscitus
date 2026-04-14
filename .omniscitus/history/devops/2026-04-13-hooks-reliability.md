# Hook + server reliability

**Domain**: devops
**Status**: closed
**Created**: 2026-04-13
**Last updated**: 2026-04-14
**Participants**: claude, dan

## Intent

Small but load-bearing fixes to keep hooks running and the birdview
server reliable across Claude Code's sandbox quirks.

## What landed

- **`PreCompact` hook type fix** (#53, `8052c9a`) — `"type": "message"`
  isn't a valid Claude Code hook type. Its validation error killed the
  entire plugin's hook registration — blueprint-tracker never ran on
  Write/Edit, SessionStart version check never ran either. Replaced
  with `"type": "command"` + `echo` so the user still sees the same
  PreCompact reminder and `/doctor` is clean.
- **Birdview survives the tool-call boundary** (#51, #52, `729c27e`,
  `4b8a24f`) — `/birdview` used `&` for backgrounding. Claude Code's
  sandbox intermittently reaped the child when the tool call returned,
  so the server died seconds after it started. Skill now spells out
  `run_in_background: true` and adds a `curl` verification step.
- **Server port auto-increment on `EADDRINUSE`** (#54, `3064136`) —
  the skill wrapper loops 3777 → 3786 before spawning, but direct
  `node server.js` invocations (or a race between check and bind)
  used to crash. Added an `'error'` listener on the server that
  increments `PORT` and retries up to 10 times.
- **SessionStart version nag** (#41, `27378d3`) — `version-check.cjs`
  compares installed plugin version to marketplace-synced version, emits
  one line if newer. 24h rate limit. Quiet after upgrade.
- **blueprint-tracker project-root scope** (#59) — when Claude edits a
  sibling repo while cwd stays in this project, `path.relative(root, p)`
  returns `"../foo/bar"`. Tracker used to accept that and write leaky
  entries into a bogus `_..yaml` split file. Now any `..`-prefixed or
  absolute path is skipped.

## Decisions worth remembering

- **Hook type enum matters.** Adding invalid types doesn't degrade
  gracefully — it takes down every hook the plugin ships. Keep a
  `"type": "command"` + `echo` fallback pattern for reminder hooks.
- **`run_in_background: true` is how Claude Code sandbox keeps
  processes alive.** Shell `&` is not reliable. Document it in every
  skill that spawns a server.

## Pending

None.
