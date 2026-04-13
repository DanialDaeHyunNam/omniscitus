# Changelog

All notable changes to omniscitus. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.4.0] — 2026-04-13

The "weekly summaries that are actually summaries" release.

### Added

- **`/weekly-backfill` skill** — generates rich narrative summaries for every past completed week. Reads each unit's `Source:` field, follows it to the original `.claude/member/{member}/done/...` document, then synthesizes a per-domain story: what was built, what decisions were debated, who handed off to whom, what got blocked. Output is per-week markdown at `.omniscitus/history/_weekly/{YYYY}-W{NN}.md`. Idempotent — smart-skips weeks that already have a rich-mode summary or are user-authored. Birdview's history view renders these as purple cards above the unit list when the selected range overlaps.
- **Smart-skip detection** via watermark: rich-mode files are recognized and never overwritten. The legacy fast-mode files (briefly shipped earlier in the same dev cycle and immediately replaced) are auto-detected as upgrade candidates. Hand-edited files have neither watermark and are left alone.
- **First-run dogfood validation**: backfilled the LangTwo mono repo's full 19-week history (266 units) via 5 parallel synthesis runs. Average per-week file is 96 lines of Korean narrative; deepest is 186 lines. Sparse 1-unit weeks compress to a 30-line read; busy 71-unit weeks expand to a multi-domain story with 28 decisions and 13 blockers documented.

### Implementation arc (worth recording)

The first cut of `/weekly-backfill` (also tagged 0.4.0-track in the dev branch but never released as a separate version) shipped with deterministic aggregation only — counts, domain breakdowns, title lists. Real-world feedback was immediate: that's a table of contents, not a summary. The skill was rewritten the same day to drop deterministic mode entirely and move synthesis into the SKILL.md (Claude reads each Source-pointed doc, then writes flowing prose). The script kept only the deterministic plumbing it's actually good at: ISO week math, smart-skip classification, candidate enumeration, `_index.yaml` registration. This is what shipped as 0.4.0.

### Tests

- 24 new tests for the weekly-backfill helpers (ISO week math, classifyExistingFile across rich/fast/manual/missing, listCandidates with all 5 skip paths, registerSummary idempotency, source-path extraction with both `**Source**:` and `Source:` forms).
- **106/106 passing total**.

## [0.3.0] — 2026-04-13

The "first real migration" release. Shaped by dogfooding a 3,400-file, 10-member team codebase (LangTwo mono) through `/omniscitus-migrate` end-to-end. Every item below came from a real friction point hit during that session.

### Added

- **Weekly summary auto-backfill** — `/wrap-up` now checks whether the last completed ISO week has a summary at `.omniscitus/history/_weekly/{YYYY}-W{NN}.md`. If not, it generates one (Headline, by-domain breakdown, decisions/constraints, pending, numbers) before proceeding with the current session's wrap-up. Birdview renders these as a distinct purple-accented card above the unit list when the selected range overlaps. Only fires for completed weeks — in-progress week stays silent. Zero-touch: users never run a separate command.
- **Umbrella prompt-meta.yaml support** — prompt tests can now delegate to external test infrastructure via `cases: { source: external, pattern: "..." }` or a `prompts: []` registry of sub-prompts. Birdview's Tests view enriches these at request time with glob-counted case totals and renders each sub-prompt as its own row. Previously a 10-sub-prompt umbrella showed as "1 Prompts, 0 Cases" — now it shows meaningful numbers.
- **Git-anchored uninstall safety** — migrate now records `.omniscitus/migrate/anchor.yaml` with the pre-migration SHA plus a footprint list of every file modified outside `.omniscitus/` (CLAUDE.md block, member docs, etc). Sets the foundation for a `/omniscitus-uninstall` skill (next release). Manual-fallback rollback instructions auto-generated in `.omniscitus/README.md`.
- **Migrate language preference (Step 0)** — pick generated docs language up front (defaults to English). Korean team asked for Korean docs after the fact; baking the choice in avoids a second pass.
- **CLAUDE.md integration proposal (Phase 5.5)** — migrate offers to append an "Omniscitus (auto-tracking)" block to `CLAUDE.md` so new collaborators follow `/wrap-up` + `/follow-up` conventions without explanation.
- **Richer `migrate-config.yaml` template** — generated file now includes inline-commented `excluded_directories` + commented `blueprint_splits` example with depth semantics explained.
- **Version-check SessionStart hook** — nags once per 24h when a newer marketplace version is available. Smart rate limit: a newer latest resets the cooldown so big jumps aren't silenced.
- **37 new tests** covering the weekly-summary parser (6), umbrella prompt-meta parser + glob counter (10), and version-check helpers (21). 83/83 passing total.

### Changed

- **`/omniscitus-migrate` elevated to a first-class install step** in the README and the docs landing terminal. Old copy buried it as a footnote; the demo terminal implied `/wrap-up` was the next command after install.
- **README has a dedicated Uninstall section** documenting the two-step flow and explaining why automatic uninstall-on-plugin-removal isn't possible (Claude Code's plugin API has no uninstall lifecycle hook).

### Pre-conditions now enforced

- Migrate refuses to start in a non-git project without explicit opt-in (the rollback anchor needs git). Offers to `git init` first.
- Warns on dirty working tree before recording the anchor — uncommitted edits won't be covered by rollback.

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
