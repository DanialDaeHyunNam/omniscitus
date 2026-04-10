---
name: blueprint-merge
description: >-
  Inverse of /blueprint-split: collapse a nested blueprint directory
  back into a single flat top-level blueprint file. Removes the entry
  from migrate-config.yaml so the hook returns to the default flat
  layout. Trigger: "blueprint-merge", "merge blueprint", "블루프린트 병합".
---

# Blueprint Merge — Collapse Nested Blueprint Back to Flat

The reverse of `/blueprint-split`. If a previously-split blueprint
turns out to be small enough that the nested layout is more friction
than benefit, this skill collapses it back into one flat file.

## When to Use

- User types `/blueprint-merge {dir}`
- User says "merge this blueprint back", "분할 취소", "되돌려"
- A previously-split directory has shrunk and the nesting is now
  noise

## Usage

```
/blueprint-merge src
/blueprint-merge .claude
```

The argument is the **original** directory name (use `.claude`, not
`_claude`).

## Instructions

### Step 1: Validate Inputs

1. Check the user supplied a directory argument. If not, list nested
   blueprint directories (`ls -d .omniscitus/blueprints/*/ 2>/dev/null`)
   and ask which to merge.

2. Verify the nested directory exists:
   - `blueprints/{normalize(dir)}/` (normalize = leading `.` → `_`)
   - If not, report that the blueprint isn't currently split and
     stop.

3. Verify the flat file does **not** already exist:
   - `blueprints/{normalize(dir)}.yaml`
   - If both nested directory and flat file exist, the state is
     ambiguous. Report and ask the user which to keep before
     proceeding.

### Step 2: Read All Nested Files

Read every `*.yaml` under `blueprints/{normalize(dir)}/` except
`_index.yaml`. Parse each one and merge their `files:` entries into
a single map. There should be no key collisions across nested files
because each file is keyed by a different bucket — but if there are
(e.g., from a manual edit), the later file wins and emit a warning.

### Step 3: Write the Flat File

Write the merged result to `blueprints/{normalize(dir)}.yaml` using
the same yaml format the hook produces. Preserve all fields per
entry. Sort entries alphabetically by path key for stable diffs.

### Step 4: Update `migrate-config.yaml`

Read `.omniscitus/migrate-config.yaml`. Remove the entry for the
target directory from the `blueprint_splits:` section. If
`blueprint_splits` becomes empty after the removal, drop the key
entirely.

Use the **original** directory name (e.g. `.claude`).

### Step 5: Delete the Nested Directory

Once the flat file is written and the config is updated, remove the
entire `blueprints/{normalize(dir)}/` directory and all its contents
(_index.yaml, _root.yaml, every bucket file).

### Step 6: Report

```
✅ Merged nested blueprint "{dir}" back into a single file

  blueprints/{normalize(dir)}.yaml  ← {N} total entries

📝 migrate-config.yaml: blueprint_splits.{dir} removed
🗑  Removed: blueprints/{normalize(dir)}/ (and {M} bucket files)

The PostToolUse hook will now route writes for {dir}/* into the
flat file. To re-split: /blueprint-split {dir}
```

## Rules

- **Never lose data**: every entry from every nested file must end
  up in the merged flat file. Total count after merge = total count
  before.
- **Preserve all fields**: same as split — full round-trip.
- **Atomic on failure**: if writing the flat file fails, do NOT
  delete the nested directory. The user can re-run after fixing.
- **One direction per call**: only merges. Use `/blueprint-split`
  to nest again.
- **Warn on key collisions**: shouldn't happen in normal use, but
  if a manual edit produced duplicate keys across nested files,
  report it before silently overwriting.
