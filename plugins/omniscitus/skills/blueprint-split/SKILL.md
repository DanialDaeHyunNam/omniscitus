---
name: blueprint-split
description: >-
  Convert a flat top-level blueprint file into a nested directory of
  per-subfolder blueprint files. Adds the corresponding entry to
  migrate-config.yaml so the PostToolUse hook routes future writes to
  the nested files. Reversible via /blueprint-merge. Trigger:
  "blueprint-split", "split blueprint", "블루프린트 분할".
---

# Blueprint Split — Convert Flat Blueprint to Nested

A blueprint that holds 300+ entries (or mixes unrelated concerns) is
a hotspot for merge conflicts and cognitive overhead. RFC #10 defines
a nested split format where one large `blueprints/{dir}.yaml` is
broken into `blueprints/{dir}/{group}.yaml` files keyed by the
second path component.

This skill performs the conversion safely and reversibly.

## When to Use

- User types `/blueprint-split {dir}`
- User says "split this blueprint", "이 블루프린트 쪼개", "분할"
- The session-start advisory recommends `/blueprint-split` for a
  specific large blueprint

## Usage

```
/blueprint-split src
/blueprint-split .claude
```

The argument is the **top-level directory name** as it appears in
the blueprint filename (without the `.yaml` extension and without
the `_` prefix that hides dot-directories). Hidden directories like
`.claude` should be passed as `.claude`, not `_claude` — the skill
normalizes internally.

## Instructions

### Step 1: Validate Inputs

1. Check the user supplied a directory argument. If not, list the
   current top-level blueprints (`ls .omniscitus/blueprints/*.yaml`)
   and ask which one to split.

2. Verify the target blueprint file exists:
   - `blueprints/{normalize(dir)}.yaml` (where normalize = leading
     `.` becomes `_`)
   - If not, report the available blueprint files and stop.

3. Verify the target is **not already split**: check that
   `blueprints/{normalize(dir)}/` directory doesn't exist. If it
   does, report that the blueprint is already nested and stop. The
   user can use `/blueprint-merge {dir}` to undo first.

### Step 2: Read the Existing Blueprint

Read the entire `blueprints/{normalize(dir)}.yaml` file. Parse all
entries — paths, status, source, change_log, purpose, etc.

For each entry, compute its **bucket** by taking the second path
component:

- `src/lib/auth.ts` → bucket = `lib`
- `src/index.ts` → bucket = `_root` (file is at the top of `src/`)
- `.claude/skills/foo.md` → bucket = `skills`
- `.claude/CLAUDE.md` → bucket = `_root`

Group entries by bucket. Sort buckets alphabetically with `_root`
first.

### Step 3: Write the Nested Files

1. Create the directory `blueprints/{normalize(dir)}/` if it
   doesn't exist.

2. For each bucket, write `blueprints/{normalize(dir)}/{bucket}.yaml`
   containing only the entries that belong to that bucket. Preserve
   the full entry shape (status, source, created, last_modified,
   change_count, purpose, change_log) — do not drop any fields.

3. Quote any path key that contains dots, slashes, brackets, or
   spaces (`".claude/CLAUDE.md":`). The hook and the migration
   script both expect quoted keys for special-character paths.

4. Write the bucket files with the standard `version`, `updated`,
   and `files:` top-level keys.

### Step 4: Write the `_index.yaml` Manifest

Create `blueprints/{normalize(dir)}/_index.yaml`:

```yaml
# .omniscitus/blueprints/{normalize(dir)}/_index.yaml
# Nested children of the {dir} blueprint group. Per RFC #10.
parent: {dir}
split_depth: 2
children:
  - name: _root
    file: _root.yaml
    entries: {N}
    describes: files directly under {dir}/
  - name: {bucket}
    file: {bucket}.yaml
    entries: {M}
    describes: files under {dir}/{bucket}/
```

This index is informational — birdview reads the actual yaml files
recursively. The index helps humans understand the layout.

### Step 5: Update `migrate-config.yaml`

Read `.omniscitus/migrate-config.yaml`. Find or create the
`blueprint_splits:` section, then add or update the entry for the
target directory:

```yaml
blueprint_splits:
  {dir}: 2
```

Use the **original** directory name as the key (e.g. `.claude`, not
`_claude`). The PostToolUse hook reads this config to route future
writes into the nested files.

If the file doesn't exist, create it with at least:

```yaml
blueprint_splits:
  {dir}: 2

blueprint_warnings:
  threshold: 300
  enabled: true
```

### Step 6: Delete the Flat File

Once all nested files are written and migrate-config.yaml is
updated, remove the original `blueprints/{normalize(dir)}.yaml`.
The hook will write to the nested files going forward.

### Step 7: Report

```
✅ Split blueprint "{dir}" into {N} nested files

  blueprints/{normalize(dir)}/
    _index.yaml         ← split metadata
    _root.yaml          ← {N1} entries (files directly under {dir}/)
    {bucket1}.yaml      ← {N2} entries
    {bucket2}.yaml      ← {N3} entries
    ...

📝 migrate-config.yaml: blueprint_splits.{dir} = 2
🗑  Removed: blueprints/{normalize(dir)}.yaml

The PostToolUse hook will now route writes for {dir}/* into the
nested files. To undo: /blueprint-merge {dir}
```

## Rules

- **Never lose data**: every entry from the flat file must end up in
  exactly one nested file. The total entry count after splitting
  must equal the count before.
- **Preserve all fields**: status, source, created, last_modified,
  change_count, purpose, change_log (with action / source / message
  on each change_log entry).
- **Don't write raw**: use the same yaml format the hook produces
  so the next hook write doesn't reformat everything.
- **Atomic on failure**: if any nested write fails, do NOT delete
  the original flat file. The user can re-run after fixing.
- **One direction per call**: this skill only splits. Use
  `/blueprint-merge` to go back.
- **Normalize hidden dirs in filenames**: `.claude` → `_claude/` on
  disk, but keep `.claude` in the migrate-config key.
