---
name: wrap-up
description: >-
  Session wrap-up with topic-based knowledge units. Records work into cohesive
  topic units instead of per-session files. Automatically fills blueprint
  purposes. Trigger: "wrap-up", "wrap up", "session end", "마무리", "정리해줘".
---

# Wrap-up — Topic-Based Session History

Record the current session's work into `.omniscitus/history/` as topic-based units.

## When to Use

- User types `/wrap-up`
- User says "마무리", "정리해줘", "wrap up", "session end"

## Instructions

### Step 1: Initialize

Check if `.omniscitus/` exists in the project root. If not, create:

```bash
mkdir -p .omniscitus/history
```

And create `.omniscitus/history/_index.yaml` with:

```yaml
units: []
```

### Step 1.5: Weekly Summary Backfill (automatic)

Before analyzing the current session, check whether the **last completed
ISO week** has a weekly summary on disk. If not, generate it first,
then proceed with the current session's wrap-up. This runs silently
most weeks (summary already present) and only triggers the first
wrap-up of a new week.

**Rules**
- Only generate for **completed** weeks. A week is complete if its Sunday
  (ISO Sunday = day 7) is before today. If today is mid-week, skip —
  there's nothing to summarize yet.
- Store summaries at `.omniscitus/history/_weekly/{YYYY}-W{NN}.md`
  using ISO week numbering (`2026-W14` = Mar 30–Apr 5, 2026).
- Track them in `_index.yaml` under a top-level `weekly_summaries:` list
  so birdview can render them without re-walking the filesystem.
- If `_weekly/` does not exist yet, create it: `mkdir -p .omniscitus/history/_weekly`.

**Procedure**

1. Compute the current ISO week: today → `{YYYY}-W{NN}`.
2. Compute the previous completed week: subtract 7 days from today,
   then take its ISO week. Skip generation if that week is the same
   as the current week (meaning today is still inside it).
3. Check `_weekly/{YYYY}-W{NN}.md`. If it exists, skip.
4. Walk `_index.yaml` for all units where `last_updated` falls in the
   previous week's date range. Collect:
   - total units touched, new vs. appended
   - domains touched (with count per domain)
   - top decisions / constraints from each unit's `## Context`
   - pending items still open at week end
5. Generate the summary file (use language from project convention —
   Korean if other history units are Korean, otherwise English):

```markdown
# Week {YYYY}-W{NN} ({start} – {end})

## Headline
{1-2 sentence summary of the week's overall arc}

## By Domain
- **{domain}** ({N} units): {1-line each}
- ...

## Decisions & Constraints
- {key decision 1 and why}
- {key constraint 2 and who is blocked}

## Pending at Week End
- [ ] {open item 1}
- [ ] {open item 2}

## Numbers
- New units: {N}
- Appended sessions: {M}
- Closed this week: {K}
- Domains touched: {list}
```

6. Append to `_index.yaml`:

```yaml
weekly_summaries:
  - week: "{YYYY}-W{NN}"
    file: "_weekly/{YYYY}-W{NN}.md"
    start: "{YYYY-MM-DD}"      # Monday
    end: "{YYYY-MM-DD}"        # Sunday
    unit_count: {N}
    domains: [web, server, ...]
    generated_at: "{YYYY-MM-DD}"
```

Keep `weekly_summaries:` sorted by week descending (newest first) so
birdview can render it without resorting.

Only after this backfill completes, proceed to Step 2 for the current
session's wrap-up.

### Step 2: Analyze the Session

Gather what was done in this session:

1. Run `git diff --name-only` and `git diff --cached --name-only` to see changed files
2. Review the conversation history for work performed
3. Extract follow-up context from the conversation:
   - **Background**: what triggered or motivated this work
   - **Requirements**: specs, acceptance criteria, or expectations discussed
   - **Decisions**: choices made during the session and why
   - **Constraints**: blockers, technical limits, or deadlines mentioned
4. Classify work into domains. Check `.omniscitus/ontology.yaml` first:
   - If ontology exists: use its `domains` definitions, `keywords`, and `directories` for classification
   - If ontology does not exist, use these defaults:
     - `server` — backend, API, DB, auth
     - `web` — frontend, UI, components, styling
     - `native` — mobile, desktop
     - `devops` — CI/CD, deployment, infrastructure
     - `product` — planning, PRD, requirements, design
   - Also check `_index.yaml` for existing domains not in ontology

### Step 3: Match to Existing Units

Read `.omniscitus/history/_index.yaml`.

For each domain touched in this session:

1. Find units with `status: open` in that domain
2. Read the unit file's `## Summary` to understand its topic
3. Decide: does the current work **semantically belong** to this unit?
   - Same feature, same subsystem, same initiative → YES, append
   - Different feature or unrelated work → NO, create new unit

### Step 4: Create or Append

**If appending to existing unit (< 5 sessions):**

Use the Edit tool to add a new timeline entry under `## Timeline`:

```markdown
### {YYYY-MM-DD}
**Focus**: {what was done in 1 line}
- {detail 1}
- {detail 2}

**Learned**: {key insight, or "none"}
```

Update `## Summary` if the scope has expanded.
Update `## Context` — add new decisions, requirements, or constraints discovered during this session. Never remove existing entries; append or refine.
Update `## Pending` — add new tasks, check off completed ones.
Increment `session_count` and update `last_updated` in `_index.yaml`.

**If existing unit has 5+ sessions:**

Use AskUserQuestion:
- question: "This unit has {N} sessions. Close it and start a new one?"
- options: "Yes, close it" / "No, keep appending"

If closing: set `status: closed` in `_index.yaml`, create a new unit.

**If creating a new unit:**

1. Choose a topic name following `ontology.yaml` `topic_conventions` if available (default: kebab-case, 2-4 words, descriptive)
2. Create `history/{domain}/{YYYY-MM-DD}-{topic-name}.md` using this format:

```markdown
# {Topic Title}

**Participants**: {comma-separated list of git authors who touched files in this session, plus `claude` if Claude Code drove edits}

## Summary
{What this unit covers, 1-3 lines}

## Context
- **Background**: {Why this work started — motivation, trigger, or problem being solved}
- **Requirements**: {Key specs, acceptance criteria, or user expectations}
- **Decisions**: {Important choices made and their rationale}
- **Constraints**: {Technical limits, deadlines, dependencies, or blockers}

## Timeline

### {YYYY-MM-DD}
**Focus**: {what was done}
- {detail 1}
- {detail 2}

**Learned**: {key insight}

## Pending
- [ ] {next task 1}
- [ ] {next task 2}

## Notes
{Cross-references, context, or "none"}
```

3. Add entry to `_index.yaml`:

```yaml
  - id: {topic-name}
    file: {domain}/{YYYY-MM-DD}-{topic-name}.md
    domain: {domain}
    status: open
    created: {YYYY-MM-DD}
    last_updated: {YYYY-MM-DD}
    session_count: 1
    title: "{Topic Title}"
```

`file:` is the unit's path relative to `.omniscitus/history/`. Birdview's
content loader uses this field directly when present. Older entries
without `file:` still work via a basename fallback, but every new entry
should write it explicitly.

### Step 5: Blueprint Sync + Fill Purposes

**First, sync with filesystem** to catch user-created files:

```bash
git ls-files --cached --others --exclude-standard | grep -v '^\.omniscitus/' | sort
```

Compare against `.omniscitus/blueprints/*.yaml` (per-directory blueprint files):
- Each top-level directory has its own file: `blueprints/src.yaml`, `blueprints/plugins.yaml`, etc.
- Root-level files are tracked in `blueprints/_root.yaml`
- Files on disk but not in their corresponding blueprint → add with `source: user:{git user.name}` (run `git config user.name`), `purpose: ""`
- Files in blueprint but not on disk → mark `status: deleted`
- When adding/updating entries, write to the correct per-directory file based on the file's top-level directory

**Then fill empty purposes** for all `purpose: ""` entries:
- Read the file content
- Write a concise purpose description (1 line)
- Update via Edit tool

Also check for `source: user` entries with empty purposes — these are files the user created outside Claude. Read them and fill purposes.

### Step 5.5: Refresh Stale Folder Summaries

The PostToolUse hook marks `_summaries.yaml` entries as `stale: true`
whenever a file inside the folder is written or edited. The hook can't
regenerate them — that requires an LLM call, which would block every
tool use. /wrap-up is the natural place to do the async refresh because
the user is already in an LLM session and Claude already has context on
what changed this session.

**Procedure:**

1. Read `.omniscitus/blueprints/_summaries.yaml`. If the file doesn't
   exist, skip this step (project hasn't run /omniscitus-migrate yet).

2. Compute the set of folders that this session touched:
   ```bash
   git diff --name-only HEAD
   git diff --cached --name-only
   ```
   For each changed file, walk its ancestors and collect every folder
   path (e.g., `src/app/api/route.ts` → `src`, `src/app`, `src/app/api`).

3. For each entry in `_summaries.yaml` where:
   - `stale: true`, AND
   - the entry's path is in the touched-folders set

   regenerate its description using the same procedure documented in
   `/omniscitus-migrate` Step 2.3:
   - Read all `purpose:` fields under the folder from the blueprint
   - Compose a one-line role description
   - Update the entry with `stale: false`, `generated_at: <today>`,
     `generated_by: wrap-up`, refreshed `file_count`

4. Do **not** touch summaries that are stale but unrelated to this
   session — they'll get refreshed in a future wrap-up that actually
   touches their folders. /wrap-up should never refresh more than what
   this session is responsible for.

5. Do **not** create new summary entries here. /omniscitus-migrate is
   the only place that bootstraps `_summaries.yaml`. /wrap-up only
   refreshes existing entries.

If `_summaries.yaml` exists but no stale-and-touched entries are found,
silently skip — this is the common case for sessions that don't touch
already-summarized folders.

### Step 6: Report

Output:

```
✅ Wrap-up complete!

📝 Units updated:
  1. history/{domain}/{date}-{topic}.md (appended / created)
  2. ...

📊 Blueprint: {N} purposes filled

Next session: /follow-up to check pending tasks.
```

**First wrap-up only** — if `_index.yaml` had zero units before this wrap-up (i.e., this is the very first unit ever created, not after `/migrate` which pre-populates units), append:

```
─────────────────────────────────────────────────
⭐ omniscitus is open source!
   If it's useful, a star helps others find it:
   https://github.com/DanialDaeHyunNam/omniscitus
─────────────────────────────────────────────────
```

## Rules

- **5 sections only** in unit files: Summary, Context, Timeline, Pending, Notes — no extras
- **Timeline entries are date-grouped** — one `### YYYY-MM-DD` per session
- **Keep summaries concise** — 3 lines max
- **Domain limit**: max 20 domains (warn if approaching)
- **Never create duplicate units** for the same topic — always check existing open units first
