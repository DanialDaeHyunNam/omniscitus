#!/usr/bin/env bash
# Omniscitus status line helper.
# Outputs a short label if the current project uses omniscitus.
# Designed to be sourced/called from the user's main statusline script.
#
# Usage (append to your ~/.claude/statusline-command.sh):
#   omni=$("${CLAUDE_PLUGIN_ROOT:-}/scripts/statusline-helper.sh" "$cwd_full" 2>/dev/null)
#   [ -n "$omni" ] && printf '%b' "${SEP}${omni}"

cwd="${1:-$(pwd)}"

# Walk up to find .omniscitus/
dir="$cwd"
while [ "$dir" != "/" ]; do
  if [ -d "$dir/.omniscitus" ]; then
    printf '\033[38;5;81m⦿ omniscitus\033[0m'
    exit 0
  fi
  dir=$(dirname "$dir")
done
