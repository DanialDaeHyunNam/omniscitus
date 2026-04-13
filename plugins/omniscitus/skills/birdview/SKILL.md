---
name: birdview
description: >-
  Start the Birdview admin dashboard at localhost:3777. Visual browser for
  blueprints, history units, and test definitions. Trigger: "birdview",
  "dashboard", "admin", "대시보드".
---

# Birdview — Admin Dashboard

Start a visual dashboard to browse all omniscitus data.

## When to Use

- User types `/birdview`
- User says "dashboard", "대시보드", "birdview"

## Instructions

### Step 1: Check Prerequisites

Verify `.omniscitus/` exists in the project root. If not:

```
📭 No omniscitus data found. Run /wrap-up first, or edit a file to start blueprint tracking.
```

### Step 2: Pick a Free Port

Birdview prefers port `3777`. If it's taken, increment by 1 and try
again, up to 10 attempts. The server reads `BIRDVIEW_PORT` from the
environment so the skill can pass whichever port it picks.

```bash
PORT=3777
ATTEMPTS=0
while lsof -i :$PORT -t >/dev/null 2>&1 && [ $ATTEMPTS -lt 10 ]; do
  PORT=$((PORT + 1))
  ATTEMPTS=$((ATTEMPTS + 1))
done
if lsof -i :$PORT -t >/dev/null 2>&1; then
  echo "❌ Could not find a free port between 3777 and 3786. Stop one of the running birdview servers and try again."
  exit 1
fi
```

After this block `$PORT` holds an unused port — usually 3777, otherwise
the next free integer above it. Report the chosen port to the user
explicitly so they know whether the URL is the default or a fallback.

### Step 3: Start Server in Background

**CRITICAL** — use the Bash tool's `run_in_background: true` parameter.
**Do NOT** rely on shell backgrounding (`&`) — in Claude Code's sandbox
the child process is often reaped when the tool call returns, so the
server dies seconds after it starts. `run_in_background: true` keeps
it alive across tool calls and the whole conversation.

**Command** (no trailing `&` — background is the tool's responsibility):

```bash
BIRDVIEW_PORT=$PORT node "${CLAUDE_PLUGIN_ROOT}/birdview/server.js" "$(pwd)"
```

**Invocation shape**:

```
Bash(
  command: <the command above>,
  run_in_background: true,
  description: "Start birdview server on port $PORT"
)
```

The tool returns immediately with a background task id; the server
stays up. The user will close it explicitly (via the `kill` hint in
Step 4) or by ending the Claude Code session.

The server receives the project root path as its first CLI argument and
reads the port from the environment. Both have safe fallbacks: missing
project root → `cwd()`, missing `BIRDVIEW_PORT` → 3777.

### Step 3.5: Verify it actually came up

Before reporting success, sanity-check the server responds. Use a
foreground Bash (no `run_in_background`) so you block until the check
returns:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT"
```

Expect `200`. If you get a connection error, wait 500ms and try once
more (Node takes a moment to bind). If still failing, read the
background task output to surface the real error to the user instead
of claiming success.

### Step 4: Report

```
✅ Birdview is running!

🌐 Open: http://localhost:$PORT
   (3777 was taken — fell back to $PORT)   ← only show this line if PORT != 3777

  📘 Blueprint     — file tracking and change history
  📗 History       — topic-based session units
  📙 Tests         — test definitions and coverage
  ✨ Constellation — 3D node space for onboarding nudges

Press Ctrl+C in the terminal or run `kill $(lsof -i :$PORT -t)` to stop.
```
