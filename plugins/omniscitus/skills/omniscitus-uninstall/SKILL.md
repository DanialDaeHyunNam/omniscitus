---
name: omniscitus-uninstall
description: >-
  Surgically reverse every file change /omniscitus-migrate made outside
  .omniscitus/, then delete .omniscitus/ itself. Reads
  .omniscitus/migrate/anchor.yaml's footprint and applies one of
  remove-section / git-checkout / delete / restore per entry.
  Trigger: "omniscitus-uninstall", "uninstall omniscitus", "omniscitus 제거".
---

# Omniscitus Uninstall — Surgical Removal

Reverse the file changes that `/omniscitus-migrate` made *outside*
`.omniscitus/`, then remove `.omniscitus/` itself. After this,
`/plugin uninstall omniscitus` removes the plugin code and the project
is back to a pre-omniscitus state.

This is the safe-uninstall counterpart to `/omniscitus-migrate`'s anchor
recording (see `.omniscitus/migrate/anchor.yaml`). Because Claude Code
has no plugin-uninstall lifecycle hook, this skill must be run **before**
`/plugin uninstall`.

## When to Use

- User types `/omniscitus-uninstall`
- User says "omniscitus 제거", "uninstall omniscitus", "remove all omniscitus changes"
- Use **before** `/plugin uninstall omniscitus`, never after

## Instructions

### Step 1: Verify anchor exists

Check `.omniscitus/migrate/anchor.yaml`. If missing:

```
⚠️ No anchor.yaml found at .omniscitus/migrate/anchor.yaml.
Either /omniscitus-migrate never ran, or this is a manually-set-up project.
Manual cleanup: rm -rf .omniscitus and review CLAUDE.md for any omniscitus blocks.
```

Stop.

### Step 2: Show status (read-only)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.cjs" status "$(pwd)"
```

This prints the anchor SHA + branch + footprint count + per-action
breakdown. Relay the output to the user so they understand the scope.

### Step 3: Show dry-run plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.cjs" dry-run "$(pwd)"
```

For each footprint entry, the script classifies what the reversal will be:

- **`remove-section`** — surgical marker-based removal (for `appended` actions). Only the omniscitus-injected section is touched; user content elsewhere in the file is preserved.
- **`git-checkout`** — whole-file restore from the anchor SHA (for `modified` actions). **Loses any post-migration edits** to the same file. The dry-run output flags this so the user can decide.
- **`delete`** — removes the file (for `created` actions).
- **`restore`** — git-checkout from anchor (for `deleted` actions).
- **`skip`** — entry is already in the target state (file gone, marker missing, etc.).
- **`warn`** — can't reverse (anchor SHA unreachable, marker not recorded, etc.). Listed so the user can handle manually.

### Step 4: Confirm with user

Show the dry-run output, then use AskUserQuestion:

- question: "This will reverse {N} footprint entries and remove `.omniscitus/`. Files marked `git-checkout` will lose any edits made after migration. Proceed?"
- options:
  - "Proceed — apply all reversals"
  - "Show me file diffs for the `git-checkout` entries first"
  - "Cancel"

If the user picks "show me diffs first", run `git diff {anchor.sha} -- <path>`
for each `git-checkout` entry and present them. Then re-prompt.

### Step 5: Execute

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.cjs" execute "$(pwd)"
```

Pre-flight checks the script does:

- If anchor recorded `git_project: true` but project is no longer a git repo → abort.
- If working tree is dirty → warn (but proceed; user already confirmed).

The script applies each plan step atomically (per file), removes
`.omniscitus/`, and prints a per-entry report.

### Step 6: Final report

Relay the script's output. Then:

```
✅ Omniscitus has been removed.

Final step: run `/plugin uninstall omniscitus` to remove the plugin code itself.
(The plugin's hooks won't fire on the next session once it's uninstalled, but
they're harmless until then — the .omniscitus/ directory is already gone.)
```

## Edge cases and recovery

- **Anchor SHA gone** (e.g., branch was rebased or force-pushed and the SHA
  isn't in `git log` anymore): `git-checkout` and `restore` actions can't
  run. The script reports them as warnings and leaves the files alone.
  User can either find the SHA in their reflog (`git reflog`) and `git
  checkout {sha} -- <path>` manually, or accept that those files won't
  be reverted.

- **Marker disappeared** between dry-run and execute (user edited the
  file in between): the script silently skips that entry. No data loss
  — the user-edited file is left as-is.

- **Working tree was dirty pre-uninstall**: the user's uncommitted edits
  to non-footprint files are unaffected. Footprint files marked
  `git-checkout` will overwrite uncommitted edits to those specific files.
  This is why Step 4's confirmation matters.

- **`.omniscitus/` removal fails**: the script logs the error and leaves
  the directory in place. User can `rm -rf .omniscitus/` manually.

## What this skill does NOT do

- It does **not** uninstall the plugin code (Claude Code has no
  uninstall hook). User runs `/plugin uninstall omniscitus` after.
- It does **not** rewrite git history. All reversals are working-tree
  edits the user can review with `git diff` and commit when ready.
- It does **not** delete `.omniscitus/migrate/anchor.yaml` separately —
  it's removed as part of the `.omniscitus/` directory rm.
