# Changelog

All notable changes to omniscitus. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-04-11

The "make it real" release. Lots of polish, a meaningful new feature, the first hosted demo, and real test coverage.

### Added

- **Constellation view** — new Birdview tab that renders history units and blueprint files as a 3D document space around `CLAUDE.md`. Pick files visually or via a collapsible tree panel on the left, and copy a one-click "onboarding nudge" prompt to paste into any Claude session. Supports folder-level selection (expands to `@folder/` mentions in the copied prompt) and a dim-everything-but-selected highlight when anything is picked.
- **Live demo birdview** — `/birdview-demo/` on the docs site serves a read-only birdview running against omniscitus's own seeded `.omniscitus/` data. Visitors can click through Blueprint, History, Constellation tabs and try the nudge prompt flow without installing anything.
- **`scripts/seed-omniscitus.js`** — pragmatic substitute for `/blueprint-sync` when Claude Code isn't running. Walks `git ls-files`, extracts 1-line purposes from comments/frontmatter, and derives history units from merge history.
- **`scripts/build-demo-birdview.js`** — builds the hosted demo from the live birdview HTML files (injects a fetch interceptor + demo banner, snapshots API responses).
- **42 unit tests** (`node:test`, zero dependencies) covering the birdview yaml parsers, seed heuristics, and demo build pipeline. Wired into GitHub Actions on every push/PR.
- **Graceful WebGL fallback** — the constellation view degrades cleanly when WebGL isn't available; the tree picker + nudge flow still work.
- **Debug logging for hooks** — set `OMNISCITUS_DEBUG=1` to get per-invocation entries in `$TMPDIR/omniscitus-hook.log`. Silent and zero-overhead when unset.

### Changed

- **Hook matcher** now includes `MultiEdit` and `NotebookEdit` in addition to `Write` and `Edit`. Previously edits via `MultiEdit` silently bypassed blueprint tracking.
- **Install instructions** switched from the shell-CLI form (`claude plugins:marketplace add ...`) to the slash-command form (`/plugin marketplace add ...`) that actually works in current Claude Code.
- **Docs landing rearranged** — the 3D constellation demo moved from the top fold (overstated) to a low-key "small fancy moment" at the bottom. The practical pitch (tree picker + nudge prompt) leads.
- **Blueprint hard cap** — large repos (>2000 blueprints) render the 2000 most-recently-modified in the 3D scene with a truncation banner. The tree panel still lists every file.
- **`.omniscitus/` seeded for this repo** — omniscitus is now its own first user.

### Fixed

- Install terminal on the docs landing was laying comment lines and commands side-by-side in a mangled column layout.
- Demo birdview's card links were absolute (`/blueprint`) and 404'd on Vercel — now rewritten to relative paths in the build.
- Demo birdview's tests tab logged a 404 for `/api/prompt-tests` — that endpoint is now snapshotted too, and the fetch interceptor also falls back gracefully on any non-OK response.
- Nudge prompt modal now opens even when the clipboard API is blocked (iframes, insecure contexts, headless testing). Users can always read / manually copy the prompt from the preview.
- Seed script's `extractPurpose` had three bugs caught by unit tests: mis-parsing folded-block frontmatter (`description: >-`), treating `#!/bin/bash` shebangs as comments, and returning Unicode box-drawing separator lines as purposes.

## [0.1.7] — 2026-04-10

Prior release. See commit history.
