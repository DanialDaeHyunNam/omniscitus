---
name: blueprint-sync
description: >-
  Sync blueprints.yaml with actual filesystem. Detects user-created files
  not yet tracked, marks deleted files, fills missing purposes.
  Trigger: "blueprint-sync", "sync", "파일 동기화", "블루프린트 동기화".
---

# Blueprint Sync — Detect Untracked Files

Scan the project filesystem and sync `.omniscitus/blueprints.yaml` with reality.
Finds user-created files that hooks missed, marks deleted files, and fills
empty purpose fields.

## When to Use

- User types `/blueprint-sync`
- User says "sync blueprints", "파일 동기화"
- You notice blueprints.yaml might be stale

## Instructions

### Step 1: Check Prerequisites

If `.omniscitus/blueprints.yaml` doesn't exist:
```
📭 No blueprint file found. Edit a file first to initialize auto-tracking,
   or run /omniscitus-migrate to bootstrap from existing project.
```

### Step 2: Scan Filesystem

Get all source files in the project (excluding generated/vendor):

```bash
find . -type f \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  -not -path "./.omniscitus/*" \
  -not -path "./.next/*" \
  -not -path "./dist/*" \
  -not -path "./build/*" \
  -not -path "./__pycache__/*" \
  -not -path "./.vercel/*" \
  -not -name "*.lock" \
  -not -name ".DS_Store" \
  | sort
```

### Step 3: Compare with Blueprint

Read `.omniscitus/blueprints.yaml`. For each file on disk:

**Not in blueprint** → New user-created file. Add with:
- `status: active`
- `source: user`
- `created`: from `git log --format="%ai" --diff-filter=A -- "{file}" | tail -1` or today
- `purpose: ""`
- `change_count`: from `git log --oneline -- "{file}" | wc -l`

**In blueprint but not on disk** → Deleted. Update:
- `status: deleted`
- `deleted: {today}`

### Step 4: Fill Empty Purposes

For files where `purpose: ""`:
- Read the file content (first 50 lines)
- Write a concise 1-line purpose description
- Update via Edit tool

### Step 5: Report

```
✅ Blueprint sync complete!

📥 New files detected: {N}
  {list of new files with source: user}

🗑️ Deleted files marked: {M}
  {list}

📝 Purposes filled: {P}

Total tracked: {T} files ({A} active, {D} deleted)
```
