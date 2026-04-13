<div align="center">

# omniscitus

### The maintenance layer your codebase deserves.

Building tools help on Day 1. omniscitus maintains from Day 2 onward —<br>
a living memory of every file, every session, every test, and every team decision.

[![Docs](https://img.shields.io/badge/docs-omniscitus.vercel.app-7c3aed?style=flat-square)](https://omniscitus.vercel.app/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

&nbsp;

**`10 Skills`** &nbsp;&middot;&nbsp; **`Auto Blueprints`** &nbsp;&middot;&nbsp; **`Team-Ready`** &nbsp;&middot;&nbsp; **`Birdview Dashboard`**

</div>

---

## Why This Exists

> git records *what* changed. omniscitus records *why*, *who*, and *what's next*.

| Layer | Tools | What it does |
|---|---|---|
| Scaffolding | create-next-app, cookiecutter, yeoman | Generates a project on Day 1. Irrelevant from Day 2. |
| AI coding | Cursor, Copilot, Claude Code | Helps write code in the moment. Context evaporates when the session ends. |
| **Maintenance** | **omniscitus** | **Tracks files, preserves session context, indexes tests, attributes team members. Accumulates from Day 2 onward.** |

Instead of you tracking files, sessions, and tests, the system maintains a living world model. You focus on judgment.

## Install

Run these inside a Claude Code session:

```
# 1. Add the marketplace (one-time)
/plugin marketplace add DanialDaeHyunNam/omniscitus

# 2. Install the plugin
/plugin install omniscitus@omniscitus

# 3. Bootstrap from your existing code (one-time, skip for brand-new projects)
/omniscitus-migrate
```

Restart Claude Code after install. Zero configuration. Respects `.gitignore`. Non-destructive overlay. Remove anytime.

### New project vs existing

- **Brand-new project** — skip step 3. Blueprints start accumulating from your first edit.
- **Existing codebase** — run `/omniscitus-migrate` once. It indexes every tracked file (git history, authorship), creates one closed history unit per topic it can detect, and indexes your tests. Nothing is deleted; everything is additive overlay under `.omniscitus/`.

### Joining a team

After cloning a repo that already uses omniscitus, run `/team-init`. The skill verifies plugin installation, hook status, and configures your git identity for attribution.

### Hooks not firing?

If blueprints aren't being created automatically when you edit files:

1. **Restart Claude Code** — hooks activate on session start. A fresh `/plugin install` doesn't enable them until you restart.
2. **Check you're on the latest version** — run `/plugin install omniscitus@omniscitus --force` to reinstall even if the version matches.
3. **Enable debug logging** — set `OMNISCITUS_DEBUG=1` in your environment (or Claude Code `settings.json` under `env`), then edit any file. Check `$TMPDIR/omniscitus-hook.log` for `invoked` / `wrote` entries. If no entries appear, the hook never fired — confirm the plugin is enabled. If entries appear but show `skip` or `ERROR`, the log tells you why.
4. **Fallback** — `/blueprint-sync` re-scans the filesystem and rebuilds blueprints from the ground truth, regardless of hook history.

## Commands

10 slash commands, organized by purpose.

> **Onboarding in 2 steps:**
> 1. **After installing, run `/omniscitus-migrate` once.** It bootstraps blueprints and history from your existing project. One-time only.
> 2. **Then only 4 commands matter day-to-day:** `/wrap-up`, `/follow-up`, `/blueprint-sync`, `/birdview`. Everything else below is optional — invoked only when the situation calls for it.

**Daily workflow**

| Command | What it does |
|---|---|
| `/wrap-up` | Record session work into topic-based knowledge units |
| `/follow-up` | Review pending tasks across all open units |
| `/blueprint-sync` | Sync blueprints with the current filesystem |
| `/birdview` | Start visual admin dashboard at `localhost:3777` |

**Testing**

| Command | What it does |
|---|---|
| `/test-add {file}` | Create type-safe test scaffold for any source file |
| `/test-add:prompt {name}` | Create LLM judge-based prompt evaluation scaffold |

**Setup & team**

| Command | What it does |
|---|---|
| `/omniscitus-migrate` | Migrate an existing project into omniscitus |
| `/team-init` | Onboard a new team member (install, verify hooks, configure identity) |
| `/ontology-init` | Define project domains and topic conventions for consistent classification |
| `/cloud-setup` | Generate cloud sync config and architecture guide for real-time collaboration |

## Features

### Blueprint — Per-directory file tracking with team attribution

Every file write and edit is recorded automatically via a `PostToolUse` hook. Blueprints are split per top-level directory (e.g. `blueprints/src.yaml`, `blueprints/server.yaml`) to minimize merge conflicts. Each change is attributed to a team member via git identity.

```yaml
# .omniscitus/blueprints/src.yaml
files:
  src/lib/auth.ts:
    status: active
    source: "claude:dan"
    created: 2026-04-01
    purpose: "OAuth token validation and session management"
    change_count: 5
    change_log:
      - date: 2026-04-03T14:30:00Z
        action: edit
        source: "claude:dan"
      - date: 2026-04-02T09:00:00Z
        action: edit
        source: "user:alice"
```

User-created files (outside Claude) are detected at session start and during `/wrap-up`.

### Wrap-up — Topic-based session history with ontology support

No more duplicate session files. Work accumulates into cohesive knowledge units by domain:

- If your current work relates to an existing open unit, it **appends** to that unit
- If it's a new topic, it creates a new unit
- Units close after 5+ sessions or when the topic is complete

Define your own domain taxonomy via `/ontology-init` for consistent classification across the team.

```
.omniscitus/history/
├── _index.yaml
├── server/
│   └── 2026-04-08-auth-refactor.md   ← 3 sessions appended here
└── web/
    └── 2026-03-20-landing-page.md    ← closed after 5 sessions
```

Each unit file contains a timeline of sessions, learnings, and pending tasks — all in one place.

### Test Meta-Layer — Code tests + LLM prompt evaluation

Two complementary systems behind one interface. Both work as a metadata layer over existing test infrastructure — no migration needed.

**Code tests.** Language-agnostic test definitions via `meta.yaml`. Works with TypeScript, Python, Go, Rust, Ruby, and more. The `signature` block enables type-safe test case creation in the Birdview dashboard — form fields are auto-generated from param types.

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

**Prompt evaluation.** LLM judge-based scoring for prompts with multi-criteria evaluation, manual overrides, and execution logs. Cases can live inline in `prompt-meta.yaml` or be sourced from an external pattern.

```yaml
# .omniscitus/tests/prompts/auth-classifier/prompt-meta.yaml
evaluation: multi_criteria
cases: external
pattern: "test-cases/**/*.yaml"
logs: test-logs/
```

### Team-Ready — Onboarding, identity, and cloud migration

Every change is attributed via git identity (`claude:dan`, `user:alice`). New team members run `/team-init` to verify hook installation, configure identity, and get an onboarding block written into `CLAUDE.md` so future joiners are auto-guided.

Start with git-based sync (commit `.omniscitus/`), migrate to cloud when you outgrow it via `/cloud-setup`.

> **Tip**: Add the omniscitus onboarding block to your project's `CLAUDE.md` so Claude Code automatically tells new users to run `/team-init` on first use.

### Birdview — Visual admin dashboard

Browse all omniscitus data at `localhost:3777`. Dark theme, zero external dependencies, vanilla JS.

Three views:
- **Blueprint** — file tree with status filters, change timelines, source badges
- **History** — domain sidebar, unit cards, session timelines, pending task checklists
- **Tests** — function-level view with typed signatures, test case cards, and **in-UI test case creation** with type-safe forms

### Migrate — Bring any existing project

Already have a codebase with docs, git history, and tests? `/omniscitus-migrate` bootstraps the full `.omniscitus/` structure from what already exists:

1. **Blueprint from git history** — scans every file's creation date, change count, authorship
2. **History units from commits** — clusters git log into topic-based units (all marked closed)
3. **Test meta from existing tests** — indexes test files into `meta.yaml` without modifying them
4. **Legacy inventory** — identifies files now redundant with omniscitus, saved to `.omniscitus/migrate/legacy.yaml` for you to review

Nothing is deleted. Omniscitus is an overlay on top of your existing project.

## Data Location

A single `.omniscitus/` directory at your project root. Clean, self-contained, non-destructive.

```
.omniscitus/
├── blueprints/                 ← per-directory file tracking (auto-updated by hook)
│   ├── _root.yaml              ← root-level files (README.md, etc.)
│   ├── src.yaml                ← files under src/
│   └── server.yaml             ← files under server/
├── ontology.yaml               ← domain taxonomy + topic conventions (optional, for teams)
├── history/
│   ├── _index.yaml             ← unit index
│   └── {domain}/               ← server/, web/, devops/...
│       └── {date}-{topic}.md   ← knowledge units
├── tests/
│   ├── {source-path-mirror}/
│   │   ├── meta.yaml           ← code test definitions
│   │   └── {file}.test.{ext}   ← generated test code
│   └── prompts/
│       └── {prompt-name}/
│           ├── prompt-meta.yaml   ← prompt test config (inline or external cases)
│           ├── judge.md           ← LLM judge template
│           └── runner.{ext}       ← test execution code
└── cloud.yaml                  ← cloud sync config (optional)
```

Add `.omniscitus/` to `.gitignore` for personal use, or commit it for team sharing.

## How It Works Under the Hood

```
┌──────────────────────────────────────────────────────┐
│  Claude writes/edits a file                          │
│         ↓                                            │
│  PostToolUse hook fires                              │
│         ↓                                            │
│  blueprint-tracker.cjs updates blueprints/{dir}.yaml │
│  (path, timestamp, status, source=claude:dan)       │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Session start                                       │
│         ↓                                            │
│  SessionStart hook scans filesystem                  │
│         ↓                                            │
│  Detects user-created files not in blueprint         │
│  Adds them with source=user:dan, purpose=""          │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  User runs /wrap-up                                  │
│         ↓                                            │
│  Claude analyzes session (git diff + history)        │
│         ↓                                            │
│  Matches work to existing open units or creates      │
│  new ones. Fills empty blueprint purposes.           │
└──────────────────────────────────────────────────────┘
```

## Philosophy

A codebase is a living system. As it grows, no single person can hold the full picture — which file does what, what changed when, which functions are tested, what's left to do. Omniscitus externalizes that mental burden into a system that tracks everything automatically, so developers focus on what humans do best: judgment, intuition, and creative decisions.

See also: Sequoia's [From Hierarchy to Intelligence](https://sequoiacap.com/article/from-hierarchy-to-intelligence/) for a parallel take on replacing hierarchical information flow with system-level intelligence.

## License

MIT
