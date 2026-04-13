---
name: weekly-backfill
description: >-
  Generate weekly summary files (_weekly/YYYY-Www.md) for every past completed
  week that has history units but no summary yet. Idempotent — existing
  summaries are smart-skipped. Trigger: "weekly-backfill", "주간 요약 백필",
  "past weeks summary".
---

# Weekly Backfill — Retroactive Weekly Summary Generation

`/wrap-up` auto-generates a summary for the **last completed week** on first
run each week. But if you just migrated from a mature repo with months of
history, you've got many past weeks of units without summaries. This skill
fills in the gap in one shot.

## When to Use

- User types `/weekly-backfill`
- Right after `/omniscitus-migrate` on a repo with long history
- User says "주간 요약 백필", "past weeks summary", "backfill weekly summaries"

## Instructions

### Step 1: Verify prerequisites

- `.omniscitus/history/_index.yaml` must exist. If not:
  ```
  ⚠️ No history index found. Run /omniscitus-migrate or /wrap-up first.
  ```
  Stop.

### Step 2: Run the backfill script

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/weekly-backfill.cjs" "$(pwd)"
```

The script:
- Groups `_index.yaml` units by ISO week (`last_updated` or `created`)
- For each completed past week without an existing `_weekly/{YYYY}-Www.md`:
  - Generates a deterministic summary (Headline, by-domain breakdown,
    numbers, pending items) — **no LLM calls**, fast and free
  - Appends to `weekly_summaries:` section of `_index.yaml`
- **Smart-skips** weeks that already have a summary file OR an index entry
- **Always skips** the in-progress (current) week

### Step 3: Report to user

The script prints a summary line like:

```
[weekly-backfill] Done.
  Created:        34 weekly summary file(s)
  Skipped (existing index entry): 2
  Skipped (md on disk, added to index): 0
  Skipped (in-progress week): 1
```

Relay this to the user. If `Created` > 0, suggest:
```
🎉 34 weekly summaries backfilled. Open /birdview → History → pick any
past week to see the new purple weekly-card above the unit list.
```

### Step 4: Offer richification (optional)

The fast mode is deterministic — counts, titles, pending. It deliberately
does NOT synthesize decisions/constraints/learnings narrative.

If the user wants richer narrative on specific weeks, offer to edit those
files individually in a future session (one LLM call per week instead of
all at once — keeps cost predictable).

## Rules

- **Never overwrite existing files** — the script already enforces this.
  If a user re-runs accidentally, nothing breaks.
- **Never touch the in-progress week** — let `/wrap-up` handle the
  transition from current → completed.
- **Fast mode by default** — no LLM calls means predictable cost and
  works offline.
- **Respect language of existing history** — the deterministic template
  is in English. If the project's other history units are Korean/Japanese/etc.,
  the weekly files will still be in English for now. Richification (future)
  can localize.
