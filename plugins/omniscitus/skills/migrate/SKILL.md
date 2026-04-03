---
name: omniscitus-migrate
description: >-
  Migrate an existing project into omniscitus. Scans docs, git history, and
  test code to bootstrap blueprints, history units, and test meta.
  Trigger: "omniscitus-migrate", "migrate", "마이그레이션", "omniscitus 적용".
---

# Omniscitus Migrate — Bring Any Existing Project Into Omniscitus

Analyze an existing codebase and bootstrap the full `.omniscitus/` structure
from what already exists: docs, git history, test code, and conversation
with the user.

## When to Use

- User types `/omniscitus-migrate`
- Applying omniscitus to a project that already has code, docs, and tests

## Instructions

### Phase 1: Reconnaissance

**Do NOT create any files yet. Only read and ask.**

#### Step 1.1: Understand the Project

Read these files if they exist:
- `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- Any files in `docs/`, `documentation/`, `wiki/`
- `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml` (for tech stack)
- `.github/`, `.gitlab-ci.yml` (for CI/CD context)

Run:
```bash
git log --oneline -50
```

Use AskUserQuestion:
- "What does this project do, in your words?" (the README might be outdated)
- "Who works on this? Just you, or a team?"
- "Any existing docs or notes system I should know about?" (Notion, wiki, local markdown, etc.)

#### Step 1.2: Detect Existing Documentation Systems

Search for existing history/notes/docs patterns:
```bash
find . -name "*.md" -not -path "./.git/*" -not -path "./node_modules/*" | head -50
```

Look for patterns like:
- `history/`, `changelog/`, `notes/`, `logs/`, `journal/`
- Session logs, meeting notes, decision records (ADRs)
- Any structured markdown with dates

If found, read them and understand the structure. Use AskUserQuestion:
- "I found {pattern}. Should I incorporate this into omniscitus history units, or keep it separate?"

#### Step 1.3: Survey Test Code

Find all test files:
```bash
find . -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" -o -name "test_*" | grep -v node_modules | grep -v .git | head -50
```

Also check for:
- `tests/`, `__tests__/`, `spec/`, `test/` directories
- Test config: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `conftest.py`
- Prompt test patterns (judge-based evaluation scripts)

### Phase 2: Blueprint Construction

#### Step 2.1: Build Initial Blueprint

Create `.omniscitus/` and `blueprints.yaml`.

For every source file in the project, build entries from git history:

```bash
git log --format="%H %ai" --diff-filter=A -- "{file}" | tail -1   # created date
git log --format="%H %ai" -1 -- "{file}"                          # last modified
git log --oneline -- "{file}" | wc -l                              # change count
```

For each file, determine:
- `status`: active (exists on disk) or deleted (in git history but not on disk)
- `source`: check first commit author — if it matches the user's git config, `user`; otherwise `claude` or `unknown`
- `purpose`: infer from file path, name, and content (read the file briefly)
- `change_log`: extract from recent git log (last 5 changes per file)

**Important**: Don't process every single file blindly. Prioritize:
1. Source code files (src/, lib/, app/)
2. Configuration files (root-level configs)
3. Documentation files
4. Skip: node_modules, .git, build output, generated files, lockfiles

Use AskUserQuestion periodically:
- "I've processed {N} files so far. Here are the ones I'm unsure about: {list}. Can you clarify their purpose?"

#### Step 2.2: Mark Source Attribution

For each file, check git blame to estimate claude vs. user ratio:
- If most commits are from the user → `source: user`
- If commits contain "Co-Authored-By: Claude" or similar → `source: claude`
- If unclear → `source: unknown`

Change log entries should also get source attribution where possible.

### Phase 3: History Unit Construction

#### Step 3.1: Extract Topics from Git History

Analyze git log to identify natural topic clusters:

```bash
git log --format="%ai | %s" --since="3 months ago"
```

Group commits by:
1. **Prefix patterns**: `feat:`, `fix:`, `refactor:`, PR titles
2. **File co-change**: files that always change together likely belong to one topic
3. **Time proximity**: commits within the same day/session likely relate

#### Step 3.2: Create Units from Topics

For each identified topic cluster:
1. Determine domain (server, web, devops, product, etc.)
2. Choose a kebab-case topic name
3. Create unit file: `history/{domain}/{earliest-date}-{topic}.md`
4. Fill timeline from commit messages and dates
5. Mark all units as `status: closed` (they're historical)
6. Add to `_index.yaml`

Use AskUserQuestion:
- "I identified these topic clusters from your git history: {list}. Does this grouping make sense? Any I should merge or split?"

#### Step 3.3: Incorporate Existing Docs

If existing documentation/notes were found in Phase 1:
- Convert them into unit format where appropriate
- Cross-reference with git history units
- Add to `## Notes` section of relevant units with links to original files

### Phase 4: Test System Construction

#### Step 4.1: Index Existing Tests

For each test file found:
1. Read the file to understand what it tests
2. Identify the target source file
3. Detect language and framework
4. Extract test suites and cases

#### Step 4.2: Generate meta.yaml from Existing Tests

Create `.omniscitus/tests/{mirrored-path}/meta.yaml` for each test file:
- `target`: the source file being tested
- `language`, `framework`: detected from test file
- `suites`: extracted from test structure
- `signature`: read the source file to get function signatures
- `cases`: map existing test cases to meta.yaml format
  - `title`: from test description/name
  - `input`: from test setup
  - `expected`: from assertions

**Do NOT delete or modify existing test files.** The meta.yaml is an overlay.

#### Step 4.3: Detect Prompt Tests

If any test files use LLM judge patterns (look for evaluation, scoring, rubrics):
- Create `prompt-meta.yaml` in `.omniscitus/tests/prompts/{name}/`
- Extract criteria, checks, and cases from existing test logic

### Phase 5: Legacy Inventory

#### Step 5.1: Identify Redundant Files

Now that omniscitus tracks everything, some existing files may be redundant:
- Old changelogs that are now covered by history units
- Scattered TODO files now covered by unit pending tasks
- Manual file inventories now covered by blueprints

Create `.omniscitus/migrate/legacy.yaml`:

```yaml
generated: {YYYY-MM-DD}
note: >
  Files below are potentially redundant now that omniscitus is set up.
  None have been deleted — review and decide.

files:
  - path: docs/changelog.md
    reason: "Covered by history units"
    recommendation: keep          # keep | archive | delete
    omniscitus_equivalent: "history/"

  - path: TODO.md
    reason: "Covered by unit pending tasks"
    recommendation: archive
    omniscitus_equivalent: "history/_index.yaml (pending tasks)"

  - path: docs/file-inventory.md
    reason: "Covered by blueprints.yaml"
    recommendation: delete
    omniscitus_equivalent: "blueprints.yaml"
```

#### Step 5.2: Discuss with User

Use AskUserQuestion:
- Show the legacy list
- "These files overlap with omniscitus. Want to: keep all / archive to .omniscitus/migrate/archived/ / delete any?"
- For each file the user wants to archive: copy to `.omniscitus/migrate/archived/`

### Phase 6: Report

```
✅ Migration complete!

📘 Blueprint
  {N} files tracked in blueprints.yaml
  {M} with source attribution (claude: {C}, user: {U}, unknown: {K})

📗 History
  {N} units created across {D} domains
  {S} total sessions reconstructed from git log
  All marked as closed (historical)

📙 Tests
  {N} test files indexed → {M} meta.yaml files created
  {P} prompt test definitions found
  Original test files untouched

📦 Legacy
  {L} potentially redundant files identified
  See .omniscitus/migrate/legacy.yaml

🔗 What's next:
  - /wrap-up after your next session to start building open units
  - /follow-up to review any pending tasks from history
  - /birdview to browse everything visually
  - /test-add {file} to add tests for untested files

─────────────────────────────────────────────────
⭐ omniscitus is open source!
   If it's useful, a star helps others find it:
   https://github.com/DanialDaeHyunNam/omniscitus
─────────────────────────────────────────────────
```

## Rules

- **Never delete existing files** — only create omniscitus overlay
- **Ask before assuming** — use AskUserQuestion liberally for context
- **Respect existing systems** — if the project has a docs system, integrate, don't replace
- **Git history is the source of truth** — use it for dates, authorship, change tracking
- **Closed units only** — all migrated history units are closed since they're historical
- **Skip generated/vendor files** — node_modules, dist, build, .next, __pycache__, etc.
- **Large repos**: for repos with 500+ files, batch the blueprint generation and ask user which directories to prioritize
