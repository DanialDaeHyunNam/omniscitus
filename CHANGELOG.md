# Changelog

All notable changes to omniscitus. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.6.3] — 2026-04-14

### Changed

- **Schema-strategy Expected renders as a type pill, not a JSON dump.** Code tests whose return value can't be serialized (e.g. `ReactNode[]`, streams, event handlers) used to show a useless `{"value": "ReactNode[]"}` box under Expected. They now render a clean "type: `ReactNode[]`" pill, and optionally surface two new meta.yaml fields when present:
  - `expected.describe` — plain-English explanation of the expected shape/behavior
  - `expected.example` — string-form example of the expected output
  This is a pure UI improvement — existing meta.yaml files keep working, the new fields are opt-in.

## [0.6.2] — 2026-04-14

### Fixed

- **Demo banner no longer overlays page content.** Switched the injected `.omni-demo-banner` from `position: fixed` to normal flow and removed the `body { padding-top: 36px }` compensation. The banner now takes real height at the top of the page and pushes everything below it down — previously it floated over toolbar controls on narrow viewports.
- **Constellation filters moved inside the Blueprints panel.** The date toggle (All time / Last 7d) and the Authors chip row used to live in the topbar and a floating top-right bar respectively; the authors bar collided with the Selection panel on the right. Both now sit at the top of the left-hand Blueprints tree panel, above the header — they're about filtering blueprints, so they belong with the blueprints.

## [0.6.1] — 2026-04-14

### Fixed

- **`blueprint-tracker.cjs` no longer leaks entries for files outside the project root.** When Claude edits a sibling repo while cwd stays in this project (e.g., dogfooding the plugin itself from a paired workspace), `path.relative(projectRoot, filePath)` returns `"../foo/bar"`. The hook used to accept that and write a blueprint entry keyed by the literal `../...` string — ending up in a bogus `_..yaml` split file. The hook now skips any path starting with `..` or still absolute after relativization.

### Added

- **Blueprint view — date + author filters.** Toolbar gains a second tab group: `All time` / `Last 7d` (defaults to Last 7d so the tree isn't flooded by legacy files). A new chip row below the toolbar lists every author (`source`) with a count; click a chip to hide files by that author, click again to un-hide. Existing All/Active/Deleted status tabs and the search input are untouched.
- **Constellation view — same filters, same defaults.** Date toggle lives next to the existing History/Blueprints visibility toggles in the topbar. Author chips float in their own bar top-right. 3D mesh visibility and the left-hand tree panel both respect filters. Works in the WebGL fallback mode (noopMesh's `.visible` field is honored).

## [0.6.0] — 2026-04-14

### Added

- **`/omniscitus-update` skill.** Plugin upgrades swap the cached files in `~/.claude/plugins/` but can't touch what migrate previously wrote into the *project* (CLAUDE.md onboarding block, statusline indicator, `.omniscitus/README.md`). This skill reads `anchor.yaml`, diffs each footprint entry against the current plugin version's canonical content, and applies the changes on consent. Idempotent, marker-based for appended sections, always asks before writing. Bumps `anchor.migrate_version` at the end so the nag silences.
- **SessionStart stale-migrate nag.** `version-check.cjs` now also checks whether the installed plugin version is newer than `anchor.migrate_version` in the nearest `.omniscitus/migrate/anchor.yaml` walking up from cwd. If so, emits a second line pointing at `/omniscitus-update`. Same 24h rate limit as the existing marketplace-upgrade nag, stored in the same cache file.
- **`anchor.migrate_version` field.** Migrate now records which plugin version wrote the canonical footprint content. `/omniscitus-update` updates the field; the SessionStart nag reads it. Pre-0.6 anchors without the field are treated as "unknown" and handled gracefully (update runs full compare pass, writes the field for the first time).
- **Prompt-test thresholds in seed.** Seed now writes a realistic `thresholds:` block (warn/pass cutoffs + per-criterion minimums) so the demo's Tests tab renders a meaningful Fail/Warn/Pass bar instead of a full-green 0.00 placeholder.

### Changed

- **Migrate CLAUDE.md onboarding block** now includes a Tests bullet: keep real test files where they live, use `/test-add {file}` to generate overlay `meta.yaml` at `.omniscitus/tests/{mirrored-path}/`.
- **Migrate gains Phase 5.6: Status line proposal.** Mirrors what `/team-init` Step 7 already offered for team members — first-time solo migrations no longer miss the `⦿ omniscitus` indicator.
- **Already-migrated message** (Pre-check C) now points at `/omniscitus-update` instead of telling the user to delete `.omniscitus/` and start over.

### Fixed

- **Birdview Tests tab is now non-dev readable.** Input and Expected render side-by-side with a `→` arrow (stacks under 720px). JSON values get syntax highlight (keys / strings / numbers / booleans / null distinct colors) and proper indentation, replacing raw `JSON.stringify` dumps.
- **Removed "NEW" badge on the Constellation card.** It's been GA for weeks — the permanent decoration was turning into noise.

## [0.5.3] — 2026-04-14

### Fixed

- **Birdview server auto-increments port on `EADDRINUSE` again.** The skill wrapper already loops 3777 → 3786 before launching, but when the server itself is invoked directly (or when the check-then-bind window races with another process grabbing the port), `server.listen(PORT)` crashed with an unhandled error. Added an `'error'` listener that increments `PORT` up to 10 times and retries, matching the skill's advertised behavior. Direct `node server.js` invocations now fall through to the next free port instead of dying.

## [0.5.2] — 2026-04-13

### Fixed

- **All hooks now actually load.** The `PreCompact` entry in `hooks/hooks.json` used `"type": "message"`, which isn't a valid Claude Code hook type. Its validation error propagated and killed the entire plugin's hook registration — so `blueprint-tracker` never ran on Write/Edit, and neither did the SessionStart version check. Replaced with `"type": "command"` + `echo` so the user still sees the same PreCompact reminder. `/doctor` will now show zero Omniscitus errors.

## [0.5.1] — 2026-04-13

### Fixed

- **`/birdview` reliably survives the tool-call boundary.** The Step 3 command used shell `&` backgrounding, which Claude Code's sandbox intermittently reaped when the tool call returned — the server died seconds after start. Now the skill spells out `run_in_background: true` as the invocation shape and adds a Step 3.5 `curl` verification so the report never claims success on a dead server.

## [0.5.0] — 2026-04-13

The "uninstall is real" release.

### Added

- **`/omniscitus-uninstall` skill** — surgically reverses every file change `/omniscitus-migrate` made outside `.omniscitus/`, then removes `.omniscitus/` itself. Reads the footprint recorded in `anchor.yaml` and applies one of four reversal strategies per entry: marker-based section removal (for `appended`), `git checkout` from the anchor SHA (for `modified` / `deleted`), or file delete (for `created`). Includes dry-run preview, idempotent execute, and per-entry reporting. Safe to re-run — already-applied state is recognized and treated as no-op.
- **Birdview heuristic TS extractor for prompt test case titles** — umbrella prompt-meta cards now show a collapsible list of test case titles (id + name) extracted from the underlying `.ts` files. Position-based regex handles inline and multi-line object forms, multiple field aliases (`id` / `elementId` / `testId`, `name` / `title`), and template-literal quoting. Strips comments before scanning so identifier-shaped tokens inside `// ...` or `/* ... */` don't false-match. Browse/index UX — input/expected fields stay in the .ts.

### Tests

- 12 new tests for the uninstall script (parseAnchor, classifyMarker, removeAppendedSection across 5 paths, buildPlan/executePlan with tmpdir fixtures, idempotency, race-condition handling).
- 7 new tests for the TS extractor (stripJsComments, multi-line + inline pairing, comment-stripping during extraction, orphan-id dropping, missing-file safety, directory walking).
- **130/130 passing total**.

### Verified end-to-end

- Smoke against the LangTwo mono anchor (41 footprint entries): dry-run reports 40 apply + 1 skip — the skip is qa/team.html where the marker lives inside an HTML attribute, classified as user-authored (the safe default).
- Smoke against LangTwo prompt-optimization (zero schema hint): 113 suggestion + 21 evaluation titles extracted; narration / improvisation use a different schema and return 0 (future work).

## [0.4.1] — 2026-04-13

### Fixed

- **Birdview weekly card now shows the headline** for non-English summaries. `extractHeadline` previously matched only `## Headline` (English), so Korean rich-mode summaries with `## 한 줄 요약` (and Japanese with `## 概要` / `## ヘッドライン`) rendered with no preview line under the date range.
- Card display now strips inline markdown (`**bold**`, `*italic*`, `` `code` ``, `[text](link)`) so headlines don't render with literal asterisks. Modal still gets full markdown via marked.js.
- Headline paragraph is CSS-clamped to 4 lines on the card so a 3-sentence headline stays scannable; click → modal shows full text.

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
