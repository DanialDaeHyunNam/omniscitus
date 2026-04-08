---
name: ontology-init
description: >-
  Initialize or update the project ontology file (.omniscitus/ontology.yaml).
  Defines domains, topic naming conventions, and classification rules for
  consistent wrap-up behavior across team members.
  Trigger: "ontology-init", "온톨로지", "도메인 설정", "domain setup".
---

# Ontology Init — Define Your Project's Domain Taxonomy

Create or update `.omniscitus/ontology.yaml` to define the domains, topic
conventions, and classification rules that `/wrap-up` uses. This ensures
all team members classify work consistently.

## When to Use

- User types `/ontology-init`
- User says "온톨로지", "도메인 설정", "domain setup"
- First-time setup for a team project
- Adding a new domain as the project evolves

## Instructions

### Step 1: Check Existing Ontology

Read `.omniscitus/ontology.yaml` if it exists. If not, proceed to create one.

### Step 2: Gather Context

Read the project structure to understand what domains exist:

```bash
ls -d */ 2>/dev/null
```

Also check existing history units for domains already in use:

```bash
ls .omniscitus/history/ 2>/dev/null
```

Use AskUserQuestion:
- "What are the main functional areas of this project? (e.g., backend API, frontend UI, data pipeline, ML models, infrastructure)"

### Step 3: Create Ontology File

Write `.omniscitus/ontology.yaml` with the following structure:

```yaml
version: 1

# Domains define the top-level classification for work units.
# wrap-up uses these to categorize session work consistently.
domains:
  server:
    description: "Backend API, database, authentication, business logic"
    keywords:
      - api
      - backend
      - database
      - auth
      - middleware
      - migration
    directories:
      - src/server
      - src/api
      - src/db

  web:
    description: "Frontend UI, components, styling, client-side logic"
    keywords:
      - frontend
      - ui
      - component
      - style
      - page
      - layout
    directories:
      - src/web
      - src/components
      - src/pages

  devops:
    description: "CI/CD, deployment, infrastructure, monitoring"
    keywords:
      - ci
      - deploy
      - docker
      - terraform
      - monitoring
      - pipeline
    directories:
      - .github
      - infra
      - deploy

  product:
    description: "Planning, requirements, design, user research"
    keywords:
      - prd
      - design
      - spec
      - requirement
      - roadmap

# Topic naming conventions for consistency
topic_conventions:
  format: "kebab-case, 2-4 words, descriptive"
  examples:
    - "oauth-token-refresh"
    - "dashboard-chart-redesign"
    - "ci-pipeline-optimization"
  anti_examples:
    - "fix-stuff"          # too vague
    - "session-2026-04-08" # date-based, not topic-based
    - "misc-changes"       # catch-all

# Classification rules for ambiguous cases
classification_rules:
  - "If work spans multiple domains, use the primary domain (where most changes occurred)"
  - "Test files follow the domain of the source they test"
  - "Documentation follows the domain of the feature it documents"
  - "If truly cross-cutting (e.g., major refactor), use 'cross-cutting' as domain"
```

Customize the domains based on the user's answers in Step 2. Remove unused domains, add project-specific ones.

### Step 4: Report

```
✅ Ontology created!

📋 Domains defined: {N}
  {list with descriptions}

📁 Saved to: .omniscitus/ontology.yaml

/wrap-up will now use these domains for consistent topic classification.
All team members will see the same domain options.
```

## Rules

- Always ask the user before creating — don't assume domains
- Keep domain count reasonable (3-7 is typical)
- Keywords should be lowercase and specific
- The `directories` field is optional but helps auto-classification
- Existing history units should still be valid after ontology creation
