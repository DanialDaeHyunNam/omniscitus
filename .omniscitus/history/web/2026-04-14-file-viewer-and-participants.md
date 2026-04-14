# File viewer popup + team attribution (v0.7 → v0.8)

**Participants**: claude, dan

## Summary

Second half of 2026-04-14. Shipped two birdview surfaces that turn
omniscitus from a metadata browser into something a non-dev can
actually *read*: a file preview modal (with syntax highlighting and
markdown rendering) and a Participants field that surfaces team
attribution everywhere a unit shows up.

## Context

- **Background**: the v0.6 readability pass landed side-by-side Input
  → Expected for tests and per-page purpose hints, but you still
  couldn't *see* what a file contained without opening an editor, and
  there was no visible signal of who touched a unit.
- **Requirements**: one-click preview, no external editor round-trip;
  attribution visible on every card + filterable.
- **Decisions**: built a dedicated `/api/file` endpoint (traversal-guarded,
  size/binary limits) rather than relying on blueprint-cached snapshots;
  Participants is a plain markdown body field (`**Participants**: a, b`)
  not an `_index.yaml` scalar, so it lives with the content.
- **Constraints**: static demo has no filesystem — `/api/file` is
  short-circuited to a 403 in the fetch interceptor so the viewer
  surfaces "not available in demo" gracefully.

## Timeline

### 2026-04-14

**Focus**: file viewer popup (v0.8)
- `/api/file?path=<rel>` endpoint with traversal guard, 500KB cap, binary filter
- Shared viewer HTML + CSS + JS across blueprint.html and constellation.html
- highlight.js CDN for syntax highlighting + marked.js for markdown preview
- Language map expanded (go, dart, elixir, scala, lua, r, haskell, graphql, dockerfile — beyond the common bundle)
- Markdown files (.md / .mdx) render as styled preview instead of raw source, with fenced code blocks post-highlighted
- Constellation selection panel gains 👁 button next to each file; tree panel rows too
- Blueprint tree file rows gain 👁 button on the right of the meta line
- Demo fetch interceptor gets a 403 short-circuit for `/api/file` so the static demo doesn't break

**Focus**: Participants field (v0.7)
- Server: `extractParticipants()` reads `**Participants**: a, b` (or Contributors / 참여자) from unit markdown body and populates `unit.participants` in `/api/units`
- History view:
  - @name pills on each unit card meta row (inline purple, subtle)
  - Click → filter by that participant, click again → clear
  - Sidebar "Participants" section under Domains, auto-hidden when no data
- Migrate skill: generated units now write `**Participants**: name1, name2, claude` — git authors for history-derived units, member name for `.claude/member/*`-derived ones
- Backfilled 316 existing mono units with participants extracted from `_index.yaml author:` + `.claude/member/{name}/` mentions in bodies + `claude` appended

**Learned**:
- Viewer popup pattern was worth extracting across both pages — same CSS, same JS, one HTML template. The shared code cost is ~60 lines that ship on 2 pages; would have been 2x that if duplicated.
- Participants-as-body-field (vs _index.yaml field) means migration is trivial: any existing unit gets participants by editing the body, no schema migration. That simplicity paid off immediately during the 316-unit backfill.
- Markdown preview rendering is the single change most likely to convert a "dashboard" into a "reading tool". Non-devs can open a `.md` unit and read it like Notion.

## Releases

- v0.7.0 — Participants field + filter
- v0.7.1 — Migrate skill writes Participants on generated units
- v0.8.0 — File viewer popup on blueprint + constellation
- v0.8 post-release patches — markdown preview, extended language bundle, hint-bar centering, tree-panel max-height fix

## Pending

- Real-time participants from session `git log %an` (currently backfill-
  only). Tracked in `devops/2026-04-14-0.9-release-gate.md`.
- File viewer could show blame / change_log alongside content in a
  future pass. Nice-to-have, not must.

## Notes

Cross-references:
- `web/2026-04-14-birdview-readable-ui.md` — first-half readability pass
- `devops/2026-04-14-0.9-release-gate.md` — open gate items, including "living memory reconciliation" and test-runner integration
- `devops/2026-04-14-launch-prep-and-seo.md` — marketing positioning set up the same day
