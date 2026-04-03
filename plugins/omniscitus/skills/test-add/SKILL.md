---
name: test-add
description: >-
  Create language-agnostic test scaffolds for any source file.
  Usage: /test-add {file-path}. Generates meta.yaml (test definitions)
  and test file. Trigger: "test-add", "add test", "테스트 추가".
---

# Test-Add — Universal Test Scaffold

Create a structured test definition (meta.yaml) and test file for any source file.

## When to Use

- User types `/test-add {file-path}`
- User says "add tests for {file}", "테스트 추가"

## Instructions

### Step 1: Validate Target

Read the file at the given path. If it doesn't exist, report and stop.

Detect the programming language from the file extension:
- `.ts`, `.tsx` → TypeScript (framework: vitest)
- `.js`, `.jsx` → JavaScript (framework: vitest)
- `.py` → Python (framework: pytest)
- `.go` → Go (framework: go test)
- `.rs` → Rust (framework: cargo test)
- `.rb` → Ruby (framework: rspec)
- Other → ask user which framework to use

### Step 2: Analyze the File

Read the source file. Identify:
- Exported functions, classes, methods
- Input parameters and return types
- Edge cases (null handling, error paths, boundary values)
- Dependencies and side effects (DB, API, filesystem)

### Step 3: Create Test Directory

Mirror the source path under `.omniscitus/tests/`:

```bash
mkdir -p .omniscitus/tests/{path-to-source-dir}
```

Example: `src/lib/auth.ts` → `.omniscitus/tests/src/lib/auth/`

### Step 4: Generate meta.yaml

Create `.omniscitus/tests/{path}/meta.yaml`.

**CRITICAL**: Each suite MUST include a `signature` block with typed params and returns.
This enables type-safe test case creation in the Birdview UI.

```yaml
target: {relative-path-to-source}
language: {detected-language}
framework: {detected-framework}
last_updated: {YYYY-MM-DD}

suites:
  - name: {function-or-class-name}
    type: unittest               # unittest | integration | e2e
    signature:
      params:
        - name: {param-name}
          type: string           # string | number | boolean | object | array
        - name: {param-name}
          type: object
          optional: true         # mark optional params
          properties:
            {prop}: {type}       # nested object shape
      returns:
        type: object             # return type
        properties:
          {prop}: {type}         # return shape for objects
    cases:
      - title: "{descriptive test name}"
        description: "{what this test verifies}"
        input:
          {param}: {value}
        expected:
          strategy: exact          # exact | contains | schema | regex
          value: {expected-output}
```

**Signature type rules:**
- Extract param types from TypeScript types, Python type hints, Go types, etc.
- For untyped languages (JS), infer types from usage patterns
- Use `string | number | boolean | object | array` as the base types
- For objects, always list `properties` with their types
- Mark optional params with `optional: true`
- For void returns, use `type: void`

**Expected strategy options:**
- `exact` — output must match exactly
- `contains` — output must contain the value
- `schema` — output must match type/shape (for objects)
- `regex` — output must match regex pattern

Generate 3-7 test cases per function, covering:
1. Happy path (normal input → expected output)
2. Edge cases (empty, null, boundary values)
3. Error cases (invalid input → expected error)

### Step 5: Generate Test File

Create the actual test file at `.omniscitus/tests/{path}/{filename}.test.{ext}`.

The test file should:
- Import the target source file
- Implement each test case from meta.yaml
- Use the appropriate test framework syntax
- Include setup/teardown if meta.yaml specifies `setup`

### Step 6: Report

```
✅ Test scaffold created!

📄 Meta:  .omniscitus/tests/{path}/meta.yaml
📄 Tests: .omniscitus/tests/{path}/{file}.test.{ext}

  {N} suites, {M} test cases

Run tests: {framework-specific command}
```

## Rules

- **meta.yaml is the source of truth** — the test file is generated from it
- **Be conservative with mocks** — prefer testing real behavior where possible
- **Cover edge cases** — don't just test the happy path
- **Keep meta.yaml readable** — it should make sense to a human without running tests
