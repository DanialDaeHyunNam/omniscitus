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

### Step 3: Start Server

Pass the chosen port via `BIRDVIEW_PORT`:

```bash
BIRDVIEW_PORT=$PORT node "${CLAUDE_PLUGIN_ROOT}/birdview/server.js" "$(pwd)" &
```

The server receives the project root path as its first CLI argument and
reads the port from the environment. Both have safe fallbacks: missing
project root → `cwd()`, missing `BIRDVIEW_PORT` → 3777.

### Step 4: Report

```
✅ Birdview is running!

🌐 Open: http://localhost:$PORT
   (3777 was taken — fell back to $PORT)   ← only show this line if PORT != 3777

  📘 Blueprint — file tracking and change history
  📗 History  — topic-based session units
  📙 Tests    — test definitions and coverage

Press Ctrl+C in the terminal or run `kill $(lsof -i :$PORT -t)` to stop.
```
