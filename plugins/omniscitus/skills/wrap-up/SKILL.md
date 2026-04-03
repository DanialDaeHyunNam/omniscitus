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

### Step 2: Analyze the Session

Gather what was done in this session:

1. Run `git diff --name-only` and `git diff --cached --name-only` to see changed files
2. Review the conversation history for work performed
3. Classify work into domains:
   - `server` — backend, API, DB, auth
   - `web` — frontend, UI, components, styling
   - `native` — mobile, desktop
   - `devops` — CI/CD, deployment, infrastructure
   - `product` — planning, PRD, requirements, design
   - Other domains may exist — check `_index.yaml` for existing domains

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
Update `## Pending` — add new tasks, check off completed ones.
Increment `session_count` and update `last_updated` in `_index.yaml`.

**If existing unit has 5+ sessions:**

Use AskUserQuestion:
- question: "This unit has {N} sessions. Close it and start a new one?"
- options: "Yes, close it" / "No, keep appending"

If closing: set `status: closed` in `_index.yaml`, create a new unit.

**If creating a new unit:**

1. Choose a kebab-case topic name (2-4 words, descriptive)
2. Create `history/{domain}/{YYYY-MM-DD}-{topic-name}.md` using this format:

```markdown
# {Topic Title}

## Summary
{What this unit covers, 1-3 lines}

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
    domain: {domain}
    status: open
    created: {YYYY-MM-DD}
    last_updated: {YYYY-MM-DD}
    session_count: 1
    title: "{Topic Title}"
```

### Step 5: Fill Blueprint Purposes

Read `.omniscitus/blueprints.yaml`. Find entries where `purpose: ""`.

For each empty-purpose file that was touched in this session:
- Read the file content
- Write a concise purpose description (1 line)
- Update the entry using Edit tool

Also check for `source: user` entries with empty purposes — these are files the user created outside Claude. Read them and fill purposes.

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

## Rules

- **5 sections only** in unit files: Summary, Timeline, Pending, Notes — no extras
- **Timeline entries are date-grouped** — one `### YYYY-MM-DD` per session
- **Keep summaries concise** — 3 lines max
- **Domain limit**: max 20 domains (warn if approaching)
- **Never create duplicate units** for the same topic — always check existing open units first
