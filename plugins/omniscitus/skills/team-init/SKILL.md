---
name: team-init
description: >-
  Set up omniscitus for a new team member who cloned a repo that already uses
  omniscitus. Verifies plugin installation, configures git identity for
  attribution, and generates CLAUDE.md onboarding block.
  Trigger: "team-init", "팀 초기화", "onboard", "omniscitus setup".
---

# Team Init — Onboard a New Team Member

Help a developer who just cloned a repo that already has `.omniscitus/` set up.
Ensures the plugin is installed, git identity is configured for attribution,
and optionally generates a CLAUDE.md block so future team members get auto-guided.

## When to Use

- User types `/team-init`
- User says "onboard", "팀 초기화", "omniscitus setup"
- You detect `.omniscitus/` exists but plugin hooks aren't firing

## Instructions

### Pre-check: Already Initialized?

Run a quick check:
```bash
ls -d .omniscitus/blueprints/ 2>/dev/null && git config user.name 2>/dev/null
```

If blueprints/ exists AND git user.name is set AND the plugin is installed:

```
✅ omniscitus is already set up for this project.

  👤 Identity: {git user.name}
  📁 Blueprints: {count of .yaml files} files

  Nothing to do. If you're having issues, try restarting Claude Code.
```

Stop here. Do NOT re-run setup.

### Step 1: Check Current State

Run these checks:

```bash
# 1. Does .omniscitus/ exist?
ls -d .omniscitus/ 2>/dev/null

# 2. Does blueprints/ directory exist?
ls -d .omniscitus/blueprints/ 2>/dev/null

# 3. Is git user.name configured?
git config user.name

# 4. Check if omniscitus plugin is installed
claude plugins list 2>/dev/null | grep omniscitus
```

### Step 2: Guide Installation (if needed)

If the omniscitus plugin is not installed:

```
📦 This project uses omniscitus for codebase tracking.

Install it:
  claude plugins:marketplace add omniscitus https://github.com/DanialDaeHyunNam/omniscitus
  claude plugin install omniscitus@omniscitus

After installing, restart Claude Code for hooks to activate.
```

### Step 3: Verify Git Identity

If `git config user.name` is empty:

```
⚠️ Git user.name is not set. Omniscitus uses it to attribute changes to you.

Set it:
  git config user.name "Your Name"
  git config user.email "your@email.com"

This is how your edits show up in blueprints (e.g., source: claude:YourName).
```

### Step 4: Verify Hooks

Check that PostToolUse hooks are active by examining the plugin state.
If hooks aren't firing, suggest:

```
Try restarting Claude Code, or run:
  claude plugin install omniscitus@omniscitus --force
```

### Step 5: Migrate Legacy Format (if needed)

If `.omniscitus/blueprints.yaml` (single file) exists but `.omniscitus/blueprints/` directory doesn't:

```
🔄 Legacy blueprint format detected. Migrating to per-directory format...
```

Read the single file, group entries by top-level directory, write to `blueprints/{dir}.yaml`, then delete the legacy file.

### Step 6: Generate CLAUDE.md Onboarding Block

Use AskUserQuestion:
- "Want me to add an omniscitus onboarding section to your project's CLAUDE.md? This auto-guides new team members when they use Claude Code."

If yes, add or append this block to the project's `CLAUDE.md`:

```markdown
## Omniscitus — Codebase World Model

This project uses [omniscitus](https://github.com/DanialDaeHyunNam/omniscitus) to track file changes, session history, and test coverage.

**First time?** Run `/team-init` to set up omniscitus on your machine.

**Quick setup:**
1. `claude plugins:marketplace add omniscitus https://github.com/DanialDaeHyunNam/omniscitus`
2. `claude plugin install omniscitus@omniscitus`
3. Ensure `git config user.name` is set (used for change attribution)
4. Restart Claude Code

**Daily use:** Just code normally. File tracking is automatic via hooks. Run `/wrap-up` at session end.
```

### Step 7: Status Line Integration

Add the omniscitus indicator to the user's Claude Code status bar.

Check if `~/.claude/statusline-command.sh` (or the script referenced in `~/.claude/settings.json` → `statusLine.command`) exists:

**If status line script exists and does NOT already contain "omniscitus":**

Append these lines to the end of the script (before the final `printf` line):

```bash
# Omniscitus indicator
_omni_dir="${cwd_full:-.}"
while [ "$_omni_dir" != "/" ]; do
  if [ -d "$_omni_dir/.omniscitus" ]; then _omni_label="\033[38;5;81m⦿ omniscitus\033[0m"; break; fi
  _omni_dir=$(dirname "$_omni_dir")
done
```

Then add `${_omni_label:+${SEP}${_omni_label}}` to the final `printf` output.

Note: The variable `cwd_full` may not exist in the script. If the script uses `cwd` as a shortened folder name, also capture the full path before it gets shortened. Look for a line like `cwd="${cwd##*/}"` and add `cwd_full="$cwd"` before it.

**If no status line script exists:**

Create `~/.claude/statusline-command.sh`:

```bash
#!/usr/bin/env bash
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')

# Omniscitus indicator
_omni_label=""
_omni_dir="$cwd"
while [ "$_omni_dir" != "/" ]; do
  if [ -d "$_omni_dir/.omniscitus" ]; then _omni_label="\033[38;5;81m⦿ omniscitus\033[0m"; break; fi
  _omni_dir=$(dirname "$_omni_dir")
done

DIM="\033[2m"
RST="\033[0m"
SEP=" ${DIM}|${RST} "
printf '%b' "\033[35m${model}${RST}${_omni_label:+${SEP}${_omni_label}}"
```

Then ensure `~/.claude/settings.json` has:
```json
"statusLine": { "type": "command", "command": "~/.claude/statusline-command.sh" }
```

**Always ask before modifying the user's status line script.**

### Step 8: Report

```
✅ Team init complete!

👤 Identity: {git user.name} ({git user.email})
📦 Plugin: installed ✓
🔗 Hooks: active ✓
📁 Blueprints: {N} files tracked across {M} blueprint files
📝 CLAUDE.md: onboarding block {added / already present / skipped}
📊 Status bar: omniscitus indicator {added / already present / skipped}

You're ready to go. Your changes will be attributed as "claude:{username}".
```

## Rules

- Never modify existing `.omniscitus/` data — only read and verify
- Always ask before modifying CLAUDE.md
- If blueprints migration is needed, create backups first
- Keep the installation steps minimal and copy-pasteable
