---
name: weekly-backfill
description: >-
  Generate rich weekly summary files (_weekly/YYYY-Www.md) for every past
  completed week. Reads each unit's Source files (.claude/member/*/done/...
  or wherever) and synthesizes a real narrative — what was done, what
  decisions were made, what discussions happened. Idempotent —
  smart-skips weeks that already have a rich-mode summary.
  Trigger: "weekly-backfill", "주간 요약 백필", "past weeks summary".
---

# Weekly Backfill — Rich Narrative Weekly Summaries

`/wrap-up` already auto-generates a summary of **the last completed week**
on the first run after the week flips. This skill backfills **all earlier
weeks** that don't have one yet — useful right after `/omniscitus-migrate`
on a project with months of history.

The output is **rich narrative**, not a list. Each week's summary includes:
- One-line headline (the arc of the week)
- Per-domain narrative (what was actually built/decided, in flowing prose)
- Key decisions (with the *why* — what options were considered, what was chosen)
- Cross-domain coordination (multi-member work, hand-offs)
- Blockers / constraints encountered
- Pending items at week's end
- Light metrics

## When to Use

- User types `/weekly-backfill`
- Right after `/omniscitus-migrate` on a long-history project
- User says "주간 요약 백필", "past weeks summary", "지난 주 다 정리"

## Instructions

### Step 1: Discover candidates

Run the helper to get a JSON list of weeks that need a rich summary:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/weekly-backfill.cjs" candidates "$(pwd)"
```

The JSON looks like:

```json
{
  "candidates": [
    {
      "week": "2026-W14",
      "start": "2026-03-30",
      "end": "2026-04-05",
      "action": "create" | "upgrade",
      "already_in_index": false,
      "file_path_abs": "/.../.omniscitus/history/_weekly/2026-W14.md",
      "unit_count": 29,
      "domains": ["content", "design", "marketing", "native", "product", "server", "web"],
      "units": [
        {
          "id": "...",
          "title": "...",
          "domain": "web",
          "status": "closed",
          "author": "aria-web",
          "unit_file_abs": "/.../.omniscitus/history/web/2026-04-02-tile-review-v0-implementation.md",
          "source_abs": "/.../.claude/member/aria-web/done/01-20260402-tile-review-v0-implementation.md"
        },
        ...
      ]
    }
  ],
  "summary": {
    "total_candidates": 18,
    "to_create": 17,
    "to_upgrade": 1,           // existing fast-mode files
    "skipped_in_progress": 0,
    "skipped_already_rich": 0,
    "skipped_user_authored": 0
  }
}
```

**Smart-skip semantics** (built into the script):

- **`rich` watermark detected** (`/weekly-backfill (rich mode`) → skipped silently. Already done.
- **`fast` watermark detected** (`/weekly-backfill (fast mode`) → marked `upgrade`. The legacy fast-mode generator (deprecated) wrote these; offer to overwrite with rich.
- **No watermark** → treated as user-authored. Skipped silently. Never overwrite hand-written files.
- **In-progress (current ISO) week** → always skipped.

### Step 2: Confirm scope with user

If `summary.total_candidates` is 0, report "Nothing to backfill." and stop.

Otherwise, show the user:

```
📅 Found {N} weeks to summarize:
  - {to_create} weeks need a new summary
  - {to_upgrade} weeks have legacy fast-mode summaries (will be upgraded to rich)

Total source files to read: ~{sum of unit_count} unit files, each pointing at a member's done/ doc.

This will take a few minutes and consume LLM tokens. Proceed?
```

Use AskUserQuestion with options like "Proceed all" / "Pick a few weeks" / "Cancel".

If the user picks a subset, carry only those forward into Step 3.

### Step 3: For each selected week, synthesize

For each candidate week (process in chronological order — older first so
the user sees progress on the early/sparse weeks first):

#### 3a. Read source content

For every unit in `week.units`:
- Open `unit.source_abs` if non-null. That's the original member done/
  doc with the actual rich content.
- If `source_abs` is null (unit was authored in place by /wrap-up),
  read `unit_file_abs` directly — the unit body itself is the source.

Read every file. Don't skim — the value of this skill is depth.

#### 3b. Detect language

Look at the source files' content. If majority is Korean → write the
summary in Korean. Japanese → Japanese. Otherwise English. Match the
project's actual working language.

#### 3c. Synthesize the summary

Write to `unit.file_path_abs` (overwrite if `action: upgrade`).
Recommended structure (adapt to weeks with sparse activity):

```markdown
# Week {YYYY}-W{NN} ({start} – {end})

## 한 줄 요약   (or "Headline" in English)
{2~4 sentences capturing the arc of the week. Not a list — a story.}

## 도메인별 주요 작업

### 🌐 Web (N units)
{Flowing narrative paragraph(s). Tell the actual story:
"X 시작 → 다음 날 Y 발견 → Z로 해결" 식의 흐름. Concrete file/feature
names. Why decisions were made.}

### 🐍 Server (N units)
{...}

... only include domains that had activity ...

## 주요 의사결정 및 논의   (Key Decisions & Discussions)
- **{Decision 1}**: {Options considered, why X was chosen}
- **{Decision 2}**: {...}

## Cross-domain coordination
- **{Feature}**: {Member A → Member B → ... handoff narrative}

## Blocker / Constraint
- {What slowed things down, what got deferred and why}

## 주말 시점 미해결 (Pending at Week End)
- [ ] {open item with 1-line context}

## 메트릭
- 단위 작업: {N}개
- 도메인 분포: {breakdown}
- 닫힌 unit: {N} / 열린 unit: {M}
- 주요 PR: {numbers if mentioned}

---
_Generated by /weekly-backfill (rich mode — synthesized from .claude/member source docs)._
```

**The watermark line at the bottom is required** — it's how future
runs of this skill recognize the file as rich-mode and smart-skip it.
Don't change the wording.

#### 3d. Register in `_index.yaml`

After writing the file, register the entry so birdview's history view
picks it up:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/weekly-backfill.cjs" register \
  "{week}" "{file_path}" "{start}" "{end}" {unit_count} \
  "{domain1,domain2,...}" "$(pwd)"
```

The script is idempotent — if the week is already in `weekly_summaries`
(e.g., from a prior fast-mode run that you're now upgrading), it
silently no-ops.

### Step 4: Report

When all candidates are processed:

```
✅ Weekly backfill complete.
   Created: {N} new rich summaries
   Upgraded: {M} (fast → rich)
   Skipped: {K}

Open /birdview → History → click any past week to read the new summary.
```

## Quality bar

The output is for a founder reviewing what their team actually did.
Avoid:

- **Title lists**. "Did X, did Y, did Z" without narrative is the old
  fast-mode behavior we replaced. Always weave context.
- **Padding**. A 3-unit week deserves a short, dense summary, not the
  same template stuffed with N/A.
- **Hallucinated decisions**. Only include decisions whose *why* is
  in the source files. If you don't know why X was chosen, omit it
  rather than guess.
- **Generic bullet points**. "구현 완료, 테스트 통과, PR 머지" is
  worthless. "Tile Review v0 — 학습자가 단어 타일을 조립해 문장을
  완성하는 새 quiz 형식. 4월 2일 핵심 구현, 4월 3일 PR 리뷰 + congrats
  flow + UX 4건 fix" is what we want.

## Performance / cost

Reading every source file for every week is the right move (depth >
breadth) but isn't free. For very large weeks (50+ units), consider
offering the user a "Quick mode for this week only" fallback that
reads only the unit summaries (not the full source files) — but never
silently downgrade. Always ask.

## Idempotency rules

- Running this skill twice in a row does nothing on the second run
  (rich-mode files are skipped).
- Deleting a `_weekly/{key}.md` file and re-running creates it again.
- Hand-editing a `_weekly/{key}.md` (removing the watermark line) makes
  the file "user-authored" — future runs will skip it.
