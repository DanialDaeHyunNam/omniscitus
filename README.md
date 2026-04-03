# omniscitus

> Give your codebase a world model.

One plugin. Zero configuration. Install it, and your codebase gains a living memory of every file, every session, and every test.

Instead of you tracking files, sessions, and tests, the system maintains a living world model. You focus on judgment.

## Install

```bash
claude plugin install omniscitus
```

That's it. Start working — omniscitus activates automatically.

## What Happens Automatically

Once installed, every file Claude writes or edits is tracked in `.omniscitus/blueprints.yaml` via a PostToolUse hook. No action needed from you.

Each entry records:
- File path, status (`active` / `deleted`), source (`claude` / `user`)
- Creation date, last modified, change count
- Full change log with timestamps
- Purpose description (filled during `/wrap-up`)

User-created files (outside Claude) are detected at session start and during wrap-up.

## Commands

| Command | What it does |
|---------|-------------|
| `/wrap-up` | Record session work into topic-based knowledge units |
| `/follow-up` | Review pending tasks across all open units |
| `/test-add {file}` | Create type-safe test scaffold for any source file |
| `/birdview` | Start visual admin dashboard at `localhost:3777` |

## Features

### Blueprint — Codebase World Model

Every file change is automatically tracked. The blueprint records what each file is for, when it was created, how many times it changed, and who changed it (Claude vs. human).

```yaml
# .omniscitus/blueprints.yaml
files:
  src/lib/auth.ts:
    status: active
    source: claude
    created: 2026-04-01
    purpose: "OAuth token validation and session management"
    change_count: 5
    change_log:
      - date: 2026-04-03T14:30:00Z
        action: edit
        source: claude
      - date: 2026-04-02T09:00:00Z
        action: edit
        source: user
```

### Wrap-up — Topic-Based Session History

Traditional session logs create one file per session, leading to duplication. Omniscitus uses **topic-based units** instead:

- If your current work relates to an existing open unit, it **appends** to that unit
- If it's a new topic, it creates a new unit
- Units close after 5+ sessions or when the topic is complete

```
.omniscitus/history/
├── _index.yaml
├── server/
│   └── 2026-04-01-auth-flow.md      ← 3 sessions appended here
└── web/
    └── 2026-03-20-landing-page.md   ← closed after 5 sessions
```

Each unit file contains a timeline of sessions, learnings, and pending tasks — all in one place.

### Test-Add — Universal Test Scaffolds

Language-agnostic test definitions via `meta.yaml`. Works with any language: TypeScript, Python, Go, Rust, Ruby, and more.

```yaml
# .omniscitus/tests/src/lib/auth/meta.yaml
target: src/lib/auth.ts
language: typescript
framework: vitest

suites:
  - name: validateToken
    type: unittest
    signature:
      params:
        - name: token
          type: string
        - name: options
          type: object
          optional: true
          properties:
            strict: boolean
      returns:
        type: object
        properties:
          valid: boolean
          payload: object
    cases:
      - title: "Validates correct JWT"
        input:
          token: "eyJhbGci..."
        expected:
          strategy: schema
          value:
            type: object
            properties: [id, email]
```

The `signature` block enables **type-safe test case creation** in the Birdview dashboard — form fields are auto-generated from param types.

### Birdview — Visual Admin Dashboard

Browse all omniscitus data at `localhost:3777`. Dark theme, zero dependencies, vanilla JS.

Three views:
- **Blueprint** — file tree with status filters, change timelines, source badges
- **History** — domain sidebar, unit cards, session timelines, pending task checklists
- **Tests** — function-level view with typed signatures, test case cards, and **in-UI test case creation** with type-safe forms

## Data Location

All data lives in `.omniscitus/` in your project root:

```
.omniscitus/
├── blueprints.yaml              ← file tracking (auto-updated by hook)
├── history/
│   ├── _index.yaml              ← unit index
│   └── {domain}/
│       └── {date}-{topic}.md    ← knowledge units
└── tests/
    └── {source-path-mirror}/
        ├── meta.yaml            ← test definitions
        └── {file}.test.{ext}    ← generated test code
```

Add `.omniscitus/` to `.gitignore` for personal use, or commit it for team sharing.

## How It Works Under the Hood

```
┌─────────────────────────────────────────────────┐
│  Claude writes/edits a file                     │
│         ↓                                       │
│  PostToolUse hook fires                         │
│         ↓                                       │
│  blueprint-tracker.cjs updates blueprints.yaml  │
│  (path, timestamp, status, source=claude)       │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Session start                                  │
│         ↓                                       │
│  SessionStart hook scans filesystem             │
│         ↓                                       │
│  Detects user-created files not in blueprint    │
│  Adds them with source=user, purpose=""         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  User runs /wrap-up                             │
│         ↓                                       │
│  Claude analyzes session (git diff + history)   │
│         ↓                                       │
│  Matches work to existing open units or creates │
│  new ones. Fills empty blueprint purposes.      │
└─────────────────────────────────────────────────┘
```

## Philosophy

A codebase is a living system. As it grows, no single person can hold the full picture — which file does what, what changed when, which functions are tested, what's left to do. Omniscitus externalizes that mental burden into a system that tracks everything automatically, so developers focus on what humans do best: judgment, intuition, and creative decisions.

See also: Sequoia's [From Hierarchy to Intelligence](https://sequoiacap.com/article/from-hierarchy-to-intelligence/) for a parallel take on replacing hierarchical information flow with system-level intelligence.

## License

MIT
