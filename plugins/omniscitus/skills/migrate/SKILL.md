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

### Pre-check: Already Migrated?

Check if `.omniscitus/history/_index.yaml` exists. If it does, this project has already been migrated.

```
⚠️ This project has already been migrated to omniscitus.

  History units: {N} (from _index.yaml)
  Blueprints: {list .omniscitus/blueprints/*.yaml}

  If you want to re-migrate, delete .omniscitus/ first and run again.
  If you want to sync new files, use /blueprint-sync instead.
```

Stop here. Do NOT proceed with migration.

### Step 0: Language Preference

Before anything else, ask the user which language the generated
documentation should use. This affects history unit bodies, folder
summaries, legacy.yaml notes, and the optional CLAUDE.md block
(Phase 5.5).

Use AskUserQuestion:
- question: "Which language should generated docs use? (history units, summaries, CLAUDE.md block)"
- options: "English (Recommended)", "Korean (한국어)", "Japanese (日本語)", "Other (specify)"
- default to the first option ("English") on ambiguity

Why this exists: source code stays authored in whatever language the
original commits use — only the new `.omniscitus/`-generated prose is
affected. A Korean team asked for Korean docs after the fact; baking
the choice in up front makes the output feel native.

Store the choice in-memory for this run (do not persist — one-shot).

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

#### Step 1.2: Survey File Scope (gitignore + large directory detection)

**Use `git ls-files` to respect all `.gitignore` rules** (root and nested):

```bash
# Count tracked files per top-level directory
git ls-files --cached --others --exclude-standard | cut -d/ -f1 | sort | uniq -c | sort -rn
```

This automatically excludes everything in `.gitignore`, `**/.gitignore`, and `.git/info/exclude`.

**Detect unusually large directories**: If any top-level directory has more than 5,000 tracked files,
flag it and ask:

Use AskUserQuestion:
- "The `{dir}/` directory has {N} files. This is unusually large. Should I include it in blueprint tracking? Large asset/resource directories can be excluded to keep blueprints focused on source code."
- options: "Include it" / "Exclude it" / "Let me check first"

Record excluded directories in `.omniscitus/migrate-config.yaml`. When
creating this file, write a richer template so the user can tune it
later without re-reading the skill:

```yaml
# Omniscitus migration config — tune as the project evolves.

# Directories whose contents should NOT be tracked in blueprints.
# Typical candidates: asset bundles, vendored code, build artifacts,
# fixtures, migration snapshots.
excluded_directories:
  - resources/          # example: 35,000+ static assets — not source code

# blueprint_splits: how deep to split each top-level directory into
# separate yaml files under .omniscitus/blueprints/.
# Default is depth=1 (one yaml per top-level dir). depth=N splits at
# path level N. Use for large subsystems where a single yaml would
# exceed ~250KB (slows the PostToolUse hook):
#   depth=2: src/lib/auth.ts → blueprints/src/lib.yaml
#   depth=3: src/lib/auth.ts → blueprints/src/lib/auth.yaml
blueprint_splits:
  # src: 3           # uncomment if src/ has 500+ files with deep nesting
  # .claude: 3       # uncomment for team workspaces with many members
```

This file is referenced during blueprint construction to skip excluded
dirs and to decide per-directory file layout.

#### Step 1.3: Detect Existing Documentation Systems

Search for existing history/notes/docs patterns:
```bash
git ls-files --cached --others --exclude-standard | grep '\.md$' | head -50
```

Look for patterns like:
- `history/`, `changelog/`, `notes/`, `logs/`, `journal/`
- Session logs, meeting notes, decision records (ADRs)
- Any structured markdown with dates

**Also check for Claude Code team structure** (`.claude/member/`):
```bash
ls -d .claude/member/*/ 2>/dev/null
```

If `.claude/member/` exists, this is a team project with existing AI agent documentation:
- Read `.claude/member/README.md` for team structure overview
- Read each member's `INTRODUCTION.md` for role descriptions
- Check `done/`, `to-do/`, `session/` directories for work history
- These are **rich sources for history unit construction** in Phase 3

If found, read them and understand the structure. Use AskUserQuestion:
- "I found {pattern}. Should I incorporate this into omniscitus history units, or keep it separate?"

#### Step 1.4: Survey Test Code

Find all test files:
```bash
find . -name "*.test.*" -o -name "*.spec.*" -o -name "*_test.*" -o -name "test_*" | grep -v node_modules | grep -v .git | head -50
```

Also check for:
- `tests/`, `__tests__/`, `spec/`, `test/` directories
- Test config: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `conftest.py`
- Prompt test patterns (judge-based evaluation scripts)

### Phase 2: Blueprint Construction

#### Step 2.1: Build Initial Blueprints

Create `.omniscitus/blueprints/` directory. Blueprint entries are split per top-level directory:
- `src/utils/auth.ts` → `.omniscitus/blueprints/src.yaml`
- `plugins/omniscitus/server.js` → `.omniscitus/blueprints/plugins.yaml`
- `README.md` (root-level) → `.omniscitus/blueprints/_root.yaml`

Get all files to track using `git ls-files` (respects .gitignore automatically):

```bash
git ls-files --cached --others --exclude-standard | grep -v '^\.omniscitus/'
```

**Note on nested splits (RFC #10)**: If the project's `migrate-config.yaml`
declares `blueprint_splits` for any top-level directory (e.g.
`.claude: 2`), generate the nested file layout from the start instead
of the flat default. The `/blueprint-split` skill exists for the
post-hoc case, but doing it during migration avoids a redundant flat→
nested conversion. Each entry routes via `lib/blueprint-resolver.cjs`'s
`resolveBlueprintFile()` — same logic the PostToolUse hook uses, so
the migration output and the live hook output stay byte-compatible.

**Exclude directories marked in Step 1.2**: If `.omniscitus/migrate-config.yaml` lists
excluded directories, filter them out:

```bash
git ls-files --cached --others --exclude-standard \
  | grep -v '^\.omniscitus/' \
  | grep -v '^resources/' \   # example: excluded in Step 1.2
  | sort
```

For every source file, build entries from git history:

```bash
git log --format="%H %ai" --diff-filter=A -- "{file}" | tail -1   # created date
git log --format="%H %ai" -1 -- "{file}"                          # last modified
git log --oneline -- "{file}" | wc -l                              # change count
```

For each file, determine:
- `status`: active (exists on disk) or deleted (in git history but not on disk)
- `source`: check first commit author — format as `user:{author name}`, `claude:{author name}`, or `unknown`. Use git log author name for attribution.
- `purpose`: infer from file path, name, and content (read the file briefly)
- `change_log`: extract from recent git log (last 5 changes per file)

**Prioritize** to avoid overwhelming large repos:
1. Source code files (src/, lib/, app/, server/, web/)
2. Configuration files (root-level configs)
3. Documentation files
4. Automatically skipped: everything in .gitignore + excluded directories from Step 1.2

**For repos with 500+ tracked files**: batch by top-level directory and ask user which to prioritize.

Use AskUserQuestion periodically:
- "I've processed {N} files so far. Here are the ones I'm unsure about: {list}. Can you clarify their purpose?"

#### Step 2.2: Mark Source Attribution

For each file, check git blame to estimate claude vs. user ratio:
- If most commits are from the user → `source: user`
- If commits contain "Co-Authored-By: Claude" or similar → `source: claude`
- If unclear → `source: unknown`

Change log entries should also get source attribution where possible.

#### Step 2.3: Generate Folder Purpose Summaries

After all blueprint entries are written, walk the directory hierarchy
bottom-up and generate a one-line summary describing what each folder
is responsible for. Write the result to a single file:

```
.omniscitus/blueprints/_summaries.yaml
```

This file is a flat path-keyed map. Birdview reads it and shows the
description directly under the folder name in the tree view, so users
get an instant "what is this folder for" answer at every depth.

**Schema:**

```yaml
# .omniscitus/blueprints/_summaries.yaml
summaries:
  src:
    description: "Next.js App Router source — pages, API routes, components, utilities"
    generated_at: 2026-04-10
    generated_by: migrate
    stale: false
    file_count: 37
  src/app:
    description: "Routes — landing, apply flow, admin dashboard, blog, API endpoints"
    generated_at: 2026-04-10
    generated_by: migrate
    stale: false
    file_count: 16
  src/lib:
    description: "Shared utilities — HMAC signing, GA tracking, Prisma client, blog index"
    generated_at: 2026-04-10
    generated_by: migrate
    stale: false
    file_count: 4
```

**How to write each summary:**

1. **List the folder's children**: read all `purpose:` fields under that
   folder from the blueprint files. Include both direct files and one
   level of subfolders for context.
2. **Compose one line** (≤ 100 characters) that captures the *role*
   of the folder within the project, not a file enumeration. Bad:
   "Contains auth.ts, prisma.ts, utils.ts". Good: "Server-side
   utility modules (auth, db, formatting)".
3. **Skip noise folders**: if a folder has fewer than 2 files OR is
   purely a single-file passthrough (e.g., `src/lib/` with only
   `auth.ts`), do not write a summary for it. The tree view will
   collapse single-child paths visually.
4. **Bottom-up order**: write leaf folders first so their descriptions
   are available when summarizing their parent.

**Recommended phrasing** (not strict):
- Lead with the role, not the contents
- Use "—" to separate role from key examples
- Avoid the word "folder" or "directory" — it's redundant
- Korean OK if the project's other docs are Korean

**Field semantics:**
- `description` — the one-line summary itself
- `generated_at` — date written (use today's date during migration)
- `generated_by` — must be one of `migrate`, `wrap-up`, `manual`,
  `blueprint-summarize`. This lets future readers (and you) trace
  who last touched each entry.
- `stale` — `false` after generation. The PostToolUse hook will set
  this to `true` automatically when a file inside the folder changes.
- `file_count` — snapshot of how many files were in the folder at
  generation time. Used by the hook to detect drift later.

This file is consumed by:
- **birdview** (`/api/blueprints` endpoint) for rendering
- **PostToolUse hook** (`scripts/blueprint-tracker.cjs`) for staleness
- **/wrap-up** for refreshing stale entries this session touched
- **/blueprint-summarize {dir}** for manual refresh

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

#### Step 3.3: Incorporate Existing Docs and Team Member History

**Standard documentation** (changelogs, ADRs, notes):
If existing documentation/notes were found in Phase 1:
- Convert them into unit format where appropriate
- Cross-reference with git history units
- Add to `## Notes` section of relevant units with links to original files

**Claude Code team member documents** (`.claude/member/`):
If `.claude/member/` was detected in Step 1.3, this is a rich source of structured work history.
For each team member directory (e.g., `.claude/member/ned-server/`):

1. Read `INTRODUCTION.md` to understand their domain/role → maps to omniscitus domain
2. Read all files in `done/` — each is a completed task/feature:
   - Extract date from filename (e.g., `20260304-persona-api-implementation.md`)
   - Extract topic, summary, and details from content
   - Create closed history units grouped by domain
   - Attribute to the member: add `**Author**: {member-name}` in unit metadata
3. Read all files in `to-do/` — these become `## Pending` items in open units
4. Read all files in `session/` — these map to timeline entries within units

**Mapping `.claude/member/` roles to omniscitus domains**:
- `*-server` → `server` domain
- `*-web` → `web` domain
- `*-native` → `native` domain
- `*-iac` → `devops` domain
- `*-pm` → `product` domain
- `*-designer` → `product` or `web` (ask user)
- Other roles → ask user for domain mapping

Use AskUserQuestion:
- "I found {N} team members in `.claude/member/` with {M} done tasks and {P} pending tasks. Should I convert these into omniscitus history units?"

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

Search for LLM judge / prompt evaluation patterns:
- Files with "evaluation", "scoring", "rubric", "judge", "prompt-test" in name or content
- Directories like `prompt-optimization/`, `eval/`, `tests/evaluation/`
- Spec/criteria documents (markdown with scoring rubrics)
- Test case collections (especially language-partitioned or category-partitioned)
- Execution logs (JSONL files with score results)

For each prompt test system found, create `prompt-meta.yaml` in
`.omniscitus/tests/prompts/{name}/` as a **metadata layer over existing files**:

```yaml
target: {path-to-prompt-implementation}
type: prompt
prompt_name: {name}
test_root: {path-to-existing-test-directory}     # point to existing infra
runner: {path-to-existing-runner}                 # relative to test_root
config: {path-to-env-or-config-if-needed}

evaluation:
  type: multi_criteria                            # detect from existing system

criteria:                                         # extract from existing specs
  - name: {criterion}
    weight: {weight}
    rubric: {path-to-spec-file}                   # external reference
    scale: {scale}

specs:
  pattern: "{path-to-spec-docs}/**/*.md"          # glob to existing specs

cases:
  source: external
  pattern: "{path-to-test-cases}/**/*.{ts,yaml}"  # glob to existing cases

overrides:
  source: {path-to-existing-overrides}            # if found

logs:
  directory: {path-to-existing-logs}
  format: jsonl

analysis:
  directory: {path-to-existing-analysis}
```

**Key principle**: Do NOT move or copy existing test files. The prompt-meta.yaml
is a metadata layer that points to where things already live. Existing runners,
cases, specs, and logs stay in their original locations.

Use AskUserQuestion:
- "I found a prompt evaluation system at `{path}` with {N} test cases, {M} specs,
  and {L} log files. Should I create an omniscitus index for it?"

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

### Phase 5.5: CLAUDE.md Integration Proposal

Most teams never notice omniscitus is running once it's set up — that's
the point. But new collaborators joining the repo *do* need to know the
conventions exist. The cheapest way to onboard them is a short block
in `CLAUDE.md` that Claude Code loads every session.

Check if `CLAUDE.md` exists at the project root. If yes, propose adding
an omniscitus block to it.

Use AskUserQuestion:
- question: "Add an omniscitus workflow block to CLAUDE.md? (Recommended)"
- description of the recommendation: "Every Claude Code session auto-loads CLAUDE.md. Adding this block means new collaborators follow the /wrap-up + /follow-up + /birdview conventions with zero explanation needed — they just work as expected."
- options:
  - "Add it (Recommended)"
  - "Show me the exact content first"
  - "Skip — I'll add later"

If the user picks "Show me the exact content first", display the block
below and re-prompt.

If added, append to `CLAUDE.md` (write in the language chosen at Step 0):

```markdown
### 🗂 Omniscitus (auto-tracking)

- **Blueprints**: every Write/Edit is auto-tracked by a PostToolUse hook. Do not edit `.omniscitus/blueprints/*.yaml` by hand.
- **Session end**: run `/wrap-up` (or say "wrap up", "마무리"). Work is classified into domain-based topic units under `.omniscitus/history/{domain}/`.
- **Pending review**: `/follow-up` surfaces open items relevant to the current session (last 3 days).
- **Visual browser**: `/birdview` — combined blueprint + history + tests viewer.
- **Domain taxonomy**: `.omniscitus/ontology.yaml` (if present) defines how work is classified.
```

If `CLAUDE.md` does not exist, do **not** create it — that's an
opinionated project decision that belongs to the repo owner. Skip this
phase silently.

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
