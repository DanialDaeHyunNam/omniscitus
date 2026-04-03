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

### Step 2: Check Port

Run:

```bash
lsof -i :3777 -t 2>/dev/null
```

If port is in use, report it and offer to kill the existing process or use a different port.

### Step 3: Start Server

Run the birdview server as a background process:

```bash
node "${CLAUDE_PLUGIN_ROOT}/birdview/server.js" "$(pwd)" &
```

The server receives the project root path as its first argument.

### Step 4: Report

```
✅ Birdview is running!

🌐 Open: http://localhost:3777

  📘 Blueprint — file tracking and change history
  📗 History  — topic-based session units
  📙 Tests    — test definitions and coverage

Press Ctrl+C in the terminal or run `kill $(lsof -i :3777 -t)` to stop.
```
