---
name: follow-up
description: >-
  Review pending tasks across all open units. Checks code state to detect
  completed work. Trigger: "follow-up", "f/u", "pending", "후속 작업",
  "팔로업", "지난 작업".
---

# Follow-up — Cross-Unit Task Review

Review pending tasks across all open history units and verify their status.

## When to Use

- User types `/follow-up`
- User says "팔로업", "후속 작업 확인", "what's pending", "f/u"

## Instructions

### Step 1: Check History Exists

Read `.omniscitus/history/_index.yaml`. If missing or empty:

```
📭 No wrap-up history found. Run /wrap-up first to record your work.
```

### Step 2: Scope Selection

Show current history status:

```
📋 History overview:
  - {domain1}: {N} units ({M} open)
  - {domain2}: {N} units ({M} open)
```

Use AskUserQuestion:
- question: "Which scope to review?"
- options:
  - "Open units only" (recommended) — review all units with status: open
  - "Last 7 days" — all units updated in the past week
  - "Everything" — all units regardless of status

### Step 3: Read Pending Tasks

For each unit in scope:
1. Read the unit file
2. Extract `## Pending` section
3. Collect all `- [ ]` items (uncompleted tasks)

### Step 4: Verify Task Status

For each pending task, check the actual codebase:
- Use Grep to search for relevant implementations
- Check `git log --oneline -10` for related commits
- Read relevant files if needed

Classify each task:
- ✅ **Done** — code clearly reflects completion
- 🔄 **In progress** — partially implemented
- ⬜ **Not started** — no evidence of work
- ❓ **Unclear** — needs user confirmation

### Step 5: Display Results

```
📊 Follow-up Results

━━━ {domain} ━━━

📄 {date} {topic title} ({N} sessions)
  ✅ {completed task}
  ⬜ {not started task}
  🔄 {in progress task}

━━━ {domain2} ━━━
  ...

━━━━━━━━━━━━━━━━━━

📈 Overall: ✅ {N} done / 🔄 {N} in progress / ⬜ {N} not started
🎯 Suggested next: {1-2 highest priority not-started items}
```

### Step 6: Update Unit Files

For tasks confirmed as done:
- Edit the unit file: change `- [ ]` to `- [x]`

Report which files were updated.
