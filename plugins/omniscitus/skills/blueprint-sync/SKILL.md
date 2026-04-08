---
name: blueprint-sync
description: >-
  Sync blueprints/ with actual filesystem. Detects user-created files
  not yet tracked, marks deleted files, fills missing purposes.
  Trigger: "blueprint-sync", "sync", "파일 동기화", "블루프린트 동기화".
---

# Blueprint Sync — Detect Untracked Files

Scan the project filesystem and sync `.omniscitus/blueprints/` with reality.
Finds user-created files that hooks missed, marks deleted files, and fills
empty purpose fields.

## When to Use

- User types `/blueprint-sync`
- User says "sync blueprints", "파일 동기화"
- You notice blueprints might be stale

## Instructions

### Step 1: Check Prerequisites

If `.omniscitus/blueprints/` directory doesn't exist, create it:
```bash
mkdir -p .omniscitus/blueprints
```

**Migration**: If a legacy `.omniscitus/blueprints.yaml` (single file) exists, migrate it:
1. Read and parse the single file
2. Group entries by top-level directory (root-level files → `_root`)
3. Write each group to `.omniscitus/blueprints/{dir}.yaml`
4. Delete the legacy `.omniscitus/blueprints.yaml`

### Step 2: Scan Filesystem

Use `git ls-files` to get all tracked (non-ignored) files. This automatically respects
`.gitignore` at all levels (root and nested):

```bash
git ls-files --cached --others --exclude-standard \
  | grep -v '^\.omniscitus/' \
  | sort
```

If not a git repo, fall back to:

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

### Step 3: Compare with Blueprints

Read all `.omniscitus/blueprints/*.yaml` files. Merge them into a single map for comparison.

**Blueprint file mapping rule**: A file's blueprint is determined by its top-level directory:
- `src/utils/auth.ts` → `blueprints/src.yaml`
- `plugins/omniscitus/server.js` → `blueprints/plugins.yaml`
- `README.md` (root-level) → `blueprints/_root.yaml`

For each file on disk:

**Not in any blueprint** → New user-created file. Add to the correct per-directory blueprint with:
- `status: active`
- `source: user:{git user.name}` (run `git config user.name` to get the identity)
- `created`: from `git log --format="%ai" --diff-filter=A -- "{file}" | tail -1` or today
- `purpose: ""`
- `change_count`: from `git log --oneline -- "{file}" | wc -l`

**In blueprint but not on disk** → Deleted. Update in the relevant blueprint file:
- `status: deleted`
- `deleted: {today}`

### Step 4: Fill Empty Purposes

For files where `purpose: ""`:
- Read the file content (first 50 lines)
- Write a concise 1-line purpose description
- Update via Edit tool in the correct per-directory blueprint file

### Step 5: Report

```
✅ Blueprint sync complete!

📥 New files detected: {N}
  {list of new files with source: user}

🗑️ Deleted files marked: {M}
  {list}

📝 Purposes filled: {P}

Total tracked: {T} files ({A} active, {D} deleted)
Blueprint files: {B} (.omniscitus/blueprints/*.yaml)
```
