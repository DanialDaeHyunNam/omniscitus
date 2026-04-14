---
name: omniscitus-update
description: >-
  Re-apply the currently installed plugin's canonical blocks (CLAUDE.md
  onboarding block, statusline indicator, .omniscitus/README.md) to a
  project that was migrated with an older plugin version. Reads and
  updates .omniscitus/migrate/anchor.yaml.
  Trigger: "omniscitus-update", "plugin-update-apply", "omniscitus 업데이트".
---

# Omniscitus Update — Apply Latest Canonical Blocks

The plugin itself updates via `/plugin install ...`, but the content it
wrote into the *project* (the CLAUDE.md onboarding block, the statusline
indicator, `.omniscitus/README.md`) stays frozen at whatever version
`/omniscitus-migrate` last ran. This skill brings those in sync with the
currently installed plugin version — no full re-migration, no data loss.

Flow per footprint entry: detect current content → diff against the
new canonical → show the user → apply on consent → bump
`anchor.migrate_version`.

## When to Use

- User types `/omniscitus-update` or says "plugin update apply"
- SessionStart nag fired: "installed plugin is vX.Y.Z but anchor records vA.B.C — run /omniscitus-update"

## Hard Rules

- **Never** touch files not listed in `.omniscitus/migrate/anchor.yaml`'s
  `footprint`. Scope is *only* what migrate previously wrote outside
  `.omniscitus/`.
- **Never** overwrite a user-edited block silently. Show the diff, ask,
  apply only on explicit consent.
- **Never** re-run blueprint/history generation. That's out of scope —
  use `/blueprint-sync` or `/wrap-up` for content, not canonical blocks.
- **Idempotent**: running twice with nothing stale is a no-op that
  still updates `anchor.migrate_version` so the nag silences.

## Instructions

### Step 1: Preconditions

Verify the project looks migrated:

- `.omniscitus/migrate/anchor.yaml` exists → read it.
- `.omniscitus/history/_index.yaml` exists (proof migrate actually ran).

If either is missing, tell the user:

```
📭 This project isn't migrated yet. Run /omniscitus-migrate first.
```

Stop.

### Step 2: Discover Versions

Read:
- Installed plugin version: `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` → `version`
- Recorded version: `anchor.migrate_version` (may be absent on pre-0.6 anchors — treat as "unknown")

If they already match **and** every footprint entry's canonical content
matches disk (see Step 3), report:

```
✅ Already up to date at v{installed}. Nothing to apply.
```

Write `anchor.migrate_version: {installed}` if it was absent, then stop.

### Step 3: Compare Canonical Content

For each footprint entry whose `by:` field names a phase that produces
canonical content, reconstruct the *current plugin version's* canonical
form and diff it against what's on disk.

Covered entries:

| Footprint path       | Canonical source                                              |
|----------------------|---------------------------------------------------------------|
| `CLAUDE.md`          | Migrate Phase 5.5 block starting with the recorded `marker`   |
| `~/.claude/statusline-command.sh` | Migrate Phase 5.6 snippet (when action = appended)  |
| `.omniscitus/README.md` | Migrate Phase 5.75 template                                |

Skip entries whose `action:` is `created` for project-owner files (e.g.,
user-authored docs). Only compare ones omniscitus itself owns.

For each comparison:
1. Extract the on-disk section by `marker:` (for `appended`) or read
   the whole file (for `created`).
2. Render the current-version canonical string from the phase template.
3. Produce a unified diff. If diff is empty → mark as clean.

### Step 4: Present the Plan

Show the user a punch list:

```
/omniscitus-update — plan

  CLAUDE.md                               [drift — see diff]
  ~/.claude/statusline-command.sh         [clean]
  .omniscitus/README.md                   [drift — see diff]

  2 of 3 files have drifted from v{installed} canonical content.
```

Then, for each drifted entry, show the diff and ask with
AskUserQuestion:

- question: "Apply the new canonical content to `{path}`?"
- description: short explanation of what will change
- options:
  - "Apply"
  - "Show full diff"
  - "Skip (keep my version)"

### Step 5: Apply Changes

On "Apply":
- For `appended` entries: locate the section by `marker:`, replace in
  place. Keep surrounding user content untouched.
- For `created` entries: overwrite the file.
- For statusline: follow the same append/replace logic as Migrate Phase 5.6.

After each apply, update the footprint entry's `timestamp:` to now.

On "Skip": leave disk alone, but still update the footprint entry with
`skipped_version: {installed}` so future nags know the user chose to
diverge.

### Step 6: Bump migrate_version

Once the loop finishes (regardless of how many were skipped), set:

```yaml
migrate_version: {installed}
```

in `anchor.yaml`. This silences the SessionStart nag until the next
plugin upgrade. This step runs **even if every file was "Skip"**  —
the user has now acknowledged the state.

### Step 7: Report

```
✅ Omniscitus update applied.

  CLAUDE.md         — updated to v{installed} canonical block
  statusline script — clean (no change)
  .omniscitus/README.md — skipped (user kept local edits)

  anchor.migrate_version: v{old} → v{installed}
```

## Edge Cases

- **Anchor missing `migrate_version:`** — legacy anchor (pre-0.6). Treat
  the recorded version as "unknown" and run the full compare pass. After
  apply, the field is written for the first time.
- **User never accepted the CLAUDE.md block at migrate time** —
  footprint won't contain a `CLAUDE.md` entry. Offer to re-propose it
  via the Phase 5.5 flow (reuse AskUserQuestion from migrate).
- **Marker not found on disk** — the user deleted the block manually.
  Ask whether to re-insert or drop the footprint entry.
- **Diff is whitespace-only** — treat as clean. Don't pester the user
  with cosmetic updates.

## Telemetry

None. This is a project-local, user-initiated action.
