---
name: test-add:prompt
description: >-
  Create LLM prompt test scaffolds with judge-based evaluation.
  For AI outputs that can't be tested programmatically — uses LLM judges
  to evaluate correctness, quality, and safety. Usage: /test-add:prompt {prompt-name}.
  Trigger: "test-add:prompt", "prompt test", "프롬프트 테스트".
---

# Test-Add:Prompt — LLM Judge Test Scaffold

Create structured test definitions for AI prompts that require LLM-based evaluation
rather than programmatic assertion. This is fundamentally different from `/test-add` —
prompt outputs are non-deterministic and must be evaluated by judge models on
multi-dimensional criteria.

## When to Use

- User types `/test-add:prompt {prompt-name}`
- Testing AI prompt outputs (chat responses, evaluations, generations)
- Outputs can't be compared with `===` — they need semantic evaluation
- Quality is multi-dimensional (correctness, naturalness, safety, etc.)

## Why This Exists Separately from /test-add

| Aspect | /test-add (code) | /test-add:prompt |
|--------|-----------------|------------------|
| Assertion | `assert(output === expected)` | `judgeScore >= threshold` |
| Variability | Deterministic | Non-deterministic (mitigated by T=0) |
| Validation | Logic checks | LLM meta-judges check reasoning |
| Test data | Exact input/output pairs | Intent-based criteria + rubrics |
| Speed | Milliseconds | Seconds (API calls per test + judge) |
| Failure | "Expected X, got Y" | "Scored 65 on naturalness (threshold: 70)" |

## Instructions

### Step 1: Identify the Prompt

Read the prompt template/implementation that will be tested. Understand:
- What input variables it takes
- What output format it produces (structured, free-text, JSON, etc.)
- What "good" vs "bad" output looks like
- Any safety constraints or hard rules

### Step 2: Create Test Directory

```bash
mkdir -p .omniscitus/tests/prompts/{prompt-name}
```

### Step 3: Generate prompt-meta.yaml

Create `.omniscitus/tests/prompts/{prompt-name}/prompt-meta.yaml`:

```yaml
target: {path-to-prompt-template-or-implementation}
type: prompt                           # distinguishes from code tests
prompt_name: {prompt-name}
last_updated: {YYYY-MM-DD}

# --- Test infrastructure references ---
# For new prompts, omniscitus generates these in-place.
# For existing projects, these point to where things already live.

test_root: .omniscitus/tests/prompts/{prompt-name}/   # default (self-contained)
# test_root: web/scripts/prompt-optimization/          # or point to existing infra

runner: runner.ts                       # relative to test_root
config: null                            # e.g., .env.local if needed

# --- Judge configuration ---
judge:
  model: gpt-4o                        # or project-specific model
  temperature: 0                       # deterministic judging
  max_retries: 2                       # retry on judge failure

# --- Evaluation type ---
# Determines how outputs are scored.
#   multi_criteria — weighted rubric scoring (default)
#   binary         — pass/fail per case
#   comparison     — A/B: which output is better
#   regression     — did this version get worse than previous
evaluation:
  type: multi_criteria

# --- Criteria ---
# Each criterion can have rubric inline (string) or as external file path.
criteria:
  - name: correctness
    weight: 0.4                        # 40% of final score
    rubric: |
      Does the output correctly address the input?
      5: Perfectly correct, no errors
      4: Minor issues that don't affect meaning
      3: Some errors but core message is right
      2: Significant errors
      1: Fundamentally wrong
    scale: 5                           # 1-5 scale

  - name: naturalness
    weight: 0.3
    rubric: |
      Does the output sound natural and fluent?
      5: Indistinguishable from a native speaker
      4: Natural with minor awkwardness
      3: Understandable but clearly non-native
      2: Awkward and hard to follow
      1: Incomprehensible
    scale: 5

  - name: safety
    weight: 0.2
    rubric: |
      Does the output follow safety constraints?
      5: Fully compliant
      1: Violates constraints
    scale: 5

  - name: format_compliance
    weight: 0.1
    rubric: |
      Does the output follow the expected format?
      5: Perfect format
      3: Minor deviations
      1: Wrong format entirely
    scale: 5

# --- Specs (optional) ---
# External specification documents that define evaluation rules in detail.
# Omit for simple prompts. Use for complex systems with language-specific scoring.
# specs:
#   pattern: "docs/prompt/specs/**/*.md"   # glob relative to project root

# --- Validation checks ---
checks:
  - name: output_not_empty
    type: deterministic                # deterministic | llm_judge
    rule: "output.length > 0"

  - name: no_hallucination
    type: llm_judge
    prompt: |
      Given this input: {input}
      And this output: {output}
      Does the output contain claims not supported by the input?
      Answer YES or NO with brief explanation.
    pass_condition: "NO"

# --- Thresholds ---
thresholds:
  pass: 70                             # weighted score >= 70 to pass
  warn: 50                             # below 50 = critical failure
  per_criterion:                       # optional per-criterion minimums
    safety: 80                         # safety must score >= 80 regardless

# --- Test cases ---
# Two modes:
#   inline   — cases listed directly below (default, good for <30 cases)
#   external — cases in separate files (for large/partitioned test suites)
cases:
  source: inline                       # "inline" | "external"
  # When external:
  #   pattern: "test-cases/**/*.{ts,yaml,json}"   # glob relative to test_root
  #   schema: test-cases/_schema.yaml              # optional case format definition
  items:
    - title: "{descriptive name}"
      category: element                # element | mixed | edge | zero_condition
      input:
        {variable}: {value}           # prompt input variables
      expected_behavior: |
        {natural language description of what good output looks like}
      expected_score_range:
        min: 75
        max: 90

    - title: "{zero condition test}"
      category: zero_condition
      input:
        {variable}: {nonsense or wrong-language input}
      expected_behavior: |
        Should reject or score very low
      expected_score_range:
        min: 0
        max: 10

# --- Overrides (optional) ---
# Manual score overrides for cases where AI evaluation is inconsistent.
# Stored separately to keep test cases clean.
# overrides:
#   source: overrides/overrides.yaml   # or inline list
#   items:
#     - case_ref: "english/countable-uncountable"
#       score: 85
#       timestamp: "2026-02-18T11:01:29Z"
#       reason: "Consistent across 10 validation runs"

# --- Logs & Analysis (optional) ---
# Where test execution results are stored.
# logs:
#   directory: logs/                   # relative to test_root (default)
#   format: jsonl                      # jsonl | json | csv
# analysis:
#   directory: logs/analysis/          # relative to test_root (default)
```

**Field reference — when to use what:**

| Field | New prompt (`/test-add:prompt`) | Existing infra (`/migrate`) |
|-------|------|------|
| `test_root` | `.omniscitus/tests/prompts/{name}/` | path to existing test dir |
| `runner` | generated by Step 6 | path to existing runner |
| `cases.source` | `inline` | `external` with `pattern` |
| `specs.pattern` | omitted | glob to existing spec docs |
| `logs.directory` | `logs/` (created) | path to existing logs dir |
| `overrides` | omitted initially | populated from existing overrides |

### Step 4: Design Test Cases by Category

**For inline cases** (`cases.source: inline`, default for new prompts):
Generate test cases directly in prompt-meta.yaml under `cases.items`.

**For external cases** (`cases.source: external`, for large suites):
Create case files under `{test_root}/test-cases/`. Partition by whatever axis
makes sense for the project (language, feature, difficulty, etc.):

```
test-cases/
├── _schema.yaml          ← optional: defines expected case format
├── english.yaml           ← or by-feature.yaml, by-model.yaml, etc.
├── french.yaml
└── edge-cases.yaml
```

Generate test cases across these categories:

**Element tests** (60-70% of cases):
- Test one specific behavior/capability at a time
- Isolate individual prompt features
- Example: "Does it correctly identify a grammar error?"

**Mixed tests** (15-20%):
- Combine multiple behaviors
- Test that scoring is cumulative, not duplicative
- Example: "Two grammar errors + one vocabulary error"

**Edge cases** (10-15%):
- Boundary conditions: very short input, very long input
- Ambiguous inputs where multiple interpretations are valid
- Multilingual mixing, special characters

**Zero condition tests** (5-10%):
- Inputs that should produce zero/minimal score
- Wrong language, nonsense, empty input
- Tests that the prompt doesn't hallucinate quality where none exists

### Step 5: Generate Judge Prompt Template

Create `.omniscitus/tests/prompts/{prompt-name}/judge.md`:

```markdown
# Judge Prompt for {prompt-name}

## Context
You are evaluating the output of an AI prompt called "{prompt-name}".
Your job is to score the output on multiple dimensions.

## Input Given to the Prompt
{input_variables}

## Output Produced by the Prompt
{output}

## Scoring Criteria

{For each criterion in prompt-meta.yaml, include the rubric}

## Instructions
1. Read the input and output carefully
2. Score each criterion independently on its scale
3. Provide brief justification for each score
4. Flag any safety violations immediately

## Response Format
CRITERION: {name}
SCORE: {1-5}
REASON: {brief justification}

CRITERION: {name}
SCORE: {1-5}
REASON: {brief justification}

OVERALL: {weighted average as percentage}
PASS: {YES/NO based on threshold}
```

### Step 6: Generate Test Runner Stub

Create `.omniscitus/tests/prompts/{prompt-name}/runner.ts` (or .py, .js based on project):

The runner should:
1. Load prompt-meta.yaml (read `cases.source` to determine where cases are)
2. If `cases.source: external`, load cases from `cases.pattern` glob
3. If `overrides` defined, load overrides
4. For each test case:
   a. Construct prompt with test case input
   b. Call the prompt (via the project's AI SDK)
   c. Run deterministic checks
   d. Send output to LLM judge with judge.md template
   e. Parse judge scores
   f. Apply criterion weights → weighted score (for `multi_criteria` type)
   g. Compare against thresholds
   h. Apply overrides if present
5. Write results to `logs.directory` as JSONL (default: `{test_root}/logs/`)
6. Generate analysis summary in `analysis.directory` (default: `{test_root}/logs/analysis/`)

### Step 7: Report

```
✅ Prompt test scaffold created!

📄 Meta:    .omniscitus/tests/prompts/{name}/prompt-meta.yaml
📄 Judge:   .omniscitus/tests/prompts/{name}/judge.md
📄 Runner:  .omniscitus/tests/prompts/{name}/runner.{ext}

  Evaluation: {type}
  {N} criteria, {M} test cases ({inline/external})
  Categories: {element: X, mixed: Y, edge: Z, zero: W}
  Thresholds: pass={P}%, warn={W}%

  Logs → {logs.directory}
```

## Rules

- **prompt-meta.yaml is the source of truth** — judge template and runner are generated from it
- **Temperature 0 for judges** — deterministic evaluation is essential
- **Manual overrides are timestamped** — they expire and should be re-validated periodically
- **Safety criterion is non-negotiable** — always include it, always set a high threshold
- **Zero condition tests are mandatory** — every prompt must be tested against garbage input
- **Judge prompts must be bias-aware** — avoid leading language in rubrics
- **Separate from /test-add** — prompt tests live in `.omniscitus/tests/prompts/`, not `.omniscitus/tests/`
