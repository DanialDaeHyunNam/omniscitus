# Weekly backfill + wrap-up auto summaries

**Domain**: devops
**Status**: closed
**Created**: 2026-04-13
**Last updated**: 2026-04-13

## Intent

History units are per-topic, but teams also want a "what happened this
week" view without hand-curation. Two hooks into the existing flow:

1. Retroactive: generate summaries for already-lived weeks from the
   existing units.
2. Prospective: on the first `/wrap-up` of a new week, auto-generate
   last week's summary.

## What landed

- **`/weekly-backfill` skill** (#43, `8149e77`) — walks past closed
  weeks, reads each unit's Source files (`.claude/member/*/done/…`
  or wherever), synthesizes a real narrative (what was done, what
  decisions were made, what discussions happened), writes
  `_weekly/YYYY-Www.md`.
- **Rich narrative as the only mode** (#44, `9176780`) — earlier draft
  had a deterministic table-style mode. Dropped it: reading a table
  doesn't help anyone form a picture of the week. The LLM narrative
  pulling from Source files is the only mode.
- **Auto-run on week rollover** (#38, `292c36f`) — `/wrap-up` detects
  "this is the first wrap-up of a new week" and invokes the weekly
  backfill for last week automatically.
- **Birdview weekly card headline** (#46, #47, `285a6de`, `648188f`) —
  surfaces the weekly summary's multilingual headline on the history
  card, not just the filename.

## Decisions worth remembering

- **Source files are authoritative** — weekly summaries don't re-parse
  git log. They read the files each unit declares as its Source. If a
  unit has no source, it contributes title-only.
- **Weekly summaries live under `_weekly/` alongside regular units** —
  same directory, distinct prefix. Birdview renders them differently
  but the storage stays uniform.

## Pending

None.
