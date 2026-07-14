---
description: Analyze a Python/Odoo project and produce 4 outputs - project docs, architecture, LLM snapshot, and test specification
---

<objective>
Analyze a brownfield Python project (with optional Odoo module detection) and produce 4 structured outputs:
1. **Project documentation** — human-readable overview of what the project does, its modules, and requirements
2. **Architecture document** — module map, dependency graph (ASCII), layer diagram, complexity hotspots
3. **LLM project snapshot** — structured reference for future LLM sessions to understand where to place new code
4. **Test specification** — behavioral contracts and equivalence tables for module replacement verification
</objective>

<workflow>

## Step 1: Launch extraction agent

Use the Agent tool to launch the `dp-python-analyze-extractor` subagent:

- **subagent_type**: `dp-python-analyze-extractor`
- **prompt**: `Scan the Python project in the current working directory. Follow your workflow steps 0-8 to produce the IR in claude-artifacts/python-analysis/ir/. Report the summary when done.`

Wait for the agent to complete. Read its summary to understand:
- Project type (Odoo, Django, Flask, etc.)
- Module count
- Whether LSP was used
- Whether Odoo-specific extraction was performed

## Step 2: Validate extraction and prepare output

First, verify the IR was produced successfully:
1. Check that `claude-artifacts/python-analysis/ir/manifest.md` exists — if not, report the agent failure and stop
2. Read `manifest.md` to get project type, module list, and module count

Then get today's date and create output directories via Bash:
```bash
DATE=$(date '+%Y-%m-%d') && echo $DATE && mkdir -p "docs/python-analysis-${DATE}/snapshot/modules" && mkdir -p claude-artifacts/python-snapshot/modules
```

Record the echoed date value — use this literal string in all subsequent file paths (do not re-reference the shell variable).

## Step 3: Read the IR

Read the following files from `claude-artifacts/python-analysis/ir/`:
1. `manifest.md` — project overview, module list, dependency graph, cross-cutting patterns
2. All files in `modules/` — per-module structural and behavioral data
3. If Odoo was detected (check manifest `Detected type`): all files in `odoo/` — models, views, security, etc.

## Step 4: Generate Output 1 — Project Documentation

Write to `docs/python-analysis-{DATE}/project-docs.md`:

```markdown
# {Project Name} — Project Documentation

**Generated:** {date}
**Project type:** {from manifest}
**Modules:** {count}

## Overview

{2-5 sentences describing what the project does, based on module names, entry points,
and domain entities found in the IR. Write from the perspective of a new developer
joining the project.}

## Module Map

| Module | Purpose | Key Classes | Dependencies |
|---|---|---|---|
{One row per module. Purpose inferred from class names, docstrings, and file structure.}

## Domain Entities

{List the core domain objects — classes that represent business concepts.
For Odoo: these are the _name values from models.md.
For Django: these are the Model subclasses.
For plain Python: these are the primary classes with business logic.}

### {Entity Name}
- **Location:** {module/file}
- **Fields/Attributes:** {key fields}
- **Relationships:** {references to other entities}
- **Key behaviors:** {main methods/operations, from "Key Behaviors" IR sections}

## Functional Requirements (Inferred)

{Derive requirements from the code structure AND the behavioral data in "Key Behaviors" IR sections.
Group by module or domain area. Each requirement describes WHAT the system does, not HOW.
Base these on actual method behaviors documented in the IR — do not speculate.}

### {Area}
- FR-{N}: {The system allows users to...}
- FR-{N}: {When X happens, the system...}

{If a behavior is unclear from the IR, mark it:}
- FR-{N}: UNCLEAR — {what could not be determined and why}

## External Dependencies

| Package | Version | Purpose |
|---|---|---|
{From manifest.md external dependencies table}

## Configuration

{How the project is configured — env vars, config files, settings modules.
Include actual config keys found in the code.}
```

## Step 5: Generate Output 2 — Architecture Document

Write to `docs/python-analysis-{DATE}/architecture.md`:

```markdown
# {Project Name} — Architecture

**Generated:** {date}

## System Overview

{High-level ASCII diagram showing the major layers/components and how they connect.
Adapt to actual project — do not use a generic template.}

Example format:

  +------------------+     +------------------+
  |   Web Layer      |     |   CLI / Cron     |
  |  (controllers)   |     |  (management)    |
  +--------+---------+     +--------+---------+
           |                         |
           v                         v
  +------------------------------------------+
  |           Business Logic Layer            |
  |  (models, services, domain classes)       |
  +------------------------------------------+
           |                         |
           v                         v
  +------------------+     +------------------+
  |   Data Access     |     |  External APIs   |
  |  (ORM / DB)       |     |  (integrations)  |
  +------------------+     +------------------+

## Module Dependency Graph

{ASCII representation of the dependency graph from manifest.md.
Use arrows to show import direction: A --> B means A imports B.
Copy the graph from the IR manifest — do not regenerate.}

Example format:

  sale_order --> product
  sale_order --> partner
  invoice ----> sale_order
  invoice ----> partner [SHARED]
  report  ----> invoice
  report  ----> sale_order [CIRCULAR!]

{If circular dependencies exist, flag them prominently.}
{If orphan modules exist, list them separately.}

## Layer Architecture

{Describe the actual layers found in the project.
For Odoo: Models -> Views -> Controllers -> Wizards -> Reports
For Django: Models -> Views -> Templates -> URLs -> Management Commands
For plain Python: infer layers from import direction}

| Layer | Modules | Responsibility |
|---|---|---|
| {name} | {list} | {what this layer does} |

**Import rules (observed):**
- {Layer A} imports {Layer B}: {count} times
- {Layer B} imports {Layer A}: {count} times {VIOLATION if upward}

## Complexity Analysis

| Module | Files | LOC | Classes | Functions | Largest File |
|---|---|---|---|---|---|
{One row per module from IR complexity indicators, sorted by LOC descending}

### Hotspots

{List the top 3-5 most complex modules/files. Explain why they are complex:
many classes, deep inheritance, heavy coupling, large file size.}

## Cross-Cutting Patterns

{From manifest.md Cross-Cutting Patterns section — shared patterns observed across modules.}

## Odoo-Specific Architecture (if applicable)

### Model Inheritance Map

{ASCII diagram showing model inheritance relationships from odoo/models.md}

### Security Architecture

| Model | Group | Read | Write | Create | Delete |
|---|---|---|---|---|---|
{From odoo/security.md}

### Controller Routes

| Route | Method | Auth | Module | Handler |
|---|---|---|---|---|
{From odoo/controllers.md}
```

## Step 6: Generate Output 3 — LLM Project Snapshot

Write files to BOTH `docs/python-analysis-{DATE}/snapshot/` AND `claude-artifacts/python-snapshot/`.

### SNAPSHOT.md

```markdown
# Python Project Snapshot

- **Project type**: {type}
- **Generated**: {ISO timestamp}
- **Extraction**: {LSP (Pyright)|Grep patterns}
- **Python files**: {count}
- **Modules**: {count}

## Files

| File | Description | Generated |
|---|---|---|
| modules/{name}.md | {brief description} | {date} |
| shared/architecture.md | Module map, dependency graph, cross-cutting patterns | {date} |
| shared/data-model.md | Domain entities, relationships, data flow | {date} |
{One row per file}
```

### shared/architecture.md

```markdown
# Architecture Overview

## Module Map

| Module | Role | Key Exports | Dependencies |
|---|---|---|---|
{Compact version of module data from IR — one row per module}

## Dependency Graph

{Copy from manifest.md — ASCII arrows showing module relationships}

## Cross-Cutting Patterns

{From manifest.md — shared base classes, common patterns, configuration approach}

## Layer Stack

{Ordered list of layers with import direction rules}
```

### shared/data-model.md

```markdown
# Data Model

## Domain Entities

| Entity | Module | Type | Key Fields | Relationships |
|---|---|---|---|---|
{For Odoo: from models.md. For Django: Model subclasses. For plain Python: core domain classes.}

## Entity Relationships

{ASCII diagram showing how entities relate:}

  User --1:N--> Order --1:N--> OrderLine
                  |
                  +--N:1--> Product

## Data Access Patterns

{How data flows through the system — from entry points to persistence}
```

### modules/{name}.md (one per module)

```markdown
# Module: {name}

## What It Does
{2-3 sentences describing the module's purpose from the user's perspective.}

## Public API

| Export | Type | Location |
|---|---|---|
| {name} | {class|function|constant} | {file:line} |

## Key Classes

### {ClassName}
- **Role**: {what this class represents}
- **Base classes**: {inheritance}
- **Key methods**: {list with brief purpose}
- **State**: {key attributes/fields}

## Key Behaviors

{From IR "Key Behaviors" section — summarized behavioral data:}

### {method_name}
{1-3 sentence summary of what this method does, its side effects, and error handling.}

## Dependencies

- **Imports**: {modules this module depends on}
- **Imported by**: {modules that depend on this one}
- **External**: {third-party packages used}

## Extension Points

{Where and how to add new functionality to this module.}

| To... | Modify | How |
|---|---|---|
| Add new behavior | {file} | {pattern to follow} |
| Extend data model | {file} | {add field/method pattern} |
| Add new endpoint | {file} | {route/controller pattern} |

## Odoo-Specific (if applicable)

### Models in this module
| Model | Type | Inherits | Key Fields |
|---|---|---|---|
| {_name} | {Model|Transient} | {_inherit or none} | {important fields} |

### Views
| View | Type | Model | Inherited From |
|---|---|---|---|
| {xml_id} | {form|tree|kanban} | {model} | {inherit_id or none} |
```

## Step 7: Generate Output 4 — Test Specification

Write to `docs/python-analysis-{DATE}/test-spec.md`.

Use the **"Key Behaviors"** sections from the IR to populate behavioral descriptions and equivalence contracts. These sections contain actual method logic summaries — use them as the basis for contracts, not speculation.

```markdown
# {Project Name} — Test Specification

**Generated:** {date}
**Purpose:** Behavioral contracts for module verification and replacement testing.

## How to Use This Document

This document describes WHAT each module does (not HOW). Use it to:
1. Write tests that verify current behavior before refactoring
2. Prove equivalence when replacing a module implementation
3. Identify untested edge cases and negative paths

## Module Contracts

### {Module Name}

#### Behavioral Description
{High-level description of what this module does. Group by concern area.
Base on "Key Behaviors" from IR — each documented method becomes a behavior statement.}

**{Concern Area}** (e.g., "Invoice Creation")
- {Behavior statement — derived from IR Key Behaviors}
- {Behavior statement}
- {Edge case — inferred from constraint methods or validation logic in IR}

**{Concern Area}** (e.g., "Tax Calculation")
- {Behavior statement}
- {Negative case — from constraint or validation behavior in IR}

#### Equivalence Contracts

{For each public function/method with behavioral data in the IR:}

##### {function_name}({params}) -> {return_type}

| Input | Expected Output | Category |
|---|---|---|
| {typical input — from behavioral summary} | {expected result} | Happy path |
| {boundary input — inferred from constraints} | {expected result} | Edge case |
| {invalid input — from validation logic} | {expected error/behavior} | Negative |

{If behavioral data is insufficient to populate this table, write:}
INCOMPLETE — IR contains only structural data for this method. Read the source at {file:line} to populate equivalence contracts.

##### Invariants
{Rules that hold for ANY valid input — derived from constraints, computed fields, and CRUD override logic:}
- {Invariant 1}
- {Invariant 2}

#### Odoo-Specific Contracts (if applicable)

##### Model: {technical.name}

**Create contract:**
| Field | Required | Default | Constraint |
|---|---|---|---|
| {field} | {Y/N} | {default or none} | {from @api.constrains or _sql_constraints} |

**State machine:**
{Only if a state/selection field with workflow methods exists:}
draft --> confirmed --> done
  |                      |
  +----> cancelled <-----+

**Computed field contracts:**
| Field | Depends On | Formula/Logic |
|---|---|---|
| {field} | {from @api.depends} | {from behavioral summary in IR, or UNCLEAR} |

**Access control:**
| Operation | Allowed Groups | Record Rule |
|---|---|---|
| Read | {groups} | {domain filter or "all"} |
| Write | {groups} | {domain filter} |
```

## Step 8: Summary

After generating all outputs, present a compact summary:

```
ANALYSIS COMPLETE

  Project: {name} ({type})
  Modules: {count}
  Date: {date}

  Outputs:
    1. Project docs:  docs/python-analysis-{date}/project-docs.md
    2. Architecture:  docs/python-analysis-{date}/architecture.md
    3. LLM snapshot:  docs/python-analysis-{date}/snapshot/ + claude-artifacts/python-snapshot/
    4. Test spec:     docs/python-analysis-{date}/test-spec.md

  IR preserved:      claude-artifacts/python-analysis/ir/
```

</workflow>

<rules>
- MUST launch `dp-python-analyze-extractor` agent first — do not scan the codebase directly
- MUST validate that `manifest.md` exists before proceeding — if agent failed, report error and stop
- MUST read the IR files produced by the agent — do not re-scan source code
- MUST write outputs to BOTH dated directory and fixed snapshot path
- MUST use ASCII art for all diagrams — no Mermaid, no PlantUML
- MUST keep diagrams simple: boxes with `+--+`, arrows with `-->`, labels inline
- MUST base functional requirements and test contracts on actual "Key Behaviors" data from the IR — not speculation
- MUST flag uncertainty: if a behavior is unclear from IR data, write "UNCLEAR: {what and why}" or "INCOMPLETE — {what is missing}"
- MUST NOT hallucinate features — only document what the IR confirms exists
- MUST adapt output depth to project size: small projects get concise outputs, large projects get detailed module breakdowns
- MUST include shared/architecture.md and shared/data-model.md in the LLM snapshot — not just per-module files
- For Odoo projects: MUST include model inheritance map, security matrix, and state machine diagrams where applicable
- For test spec: MUST separate behavioral descriptions (what it does) from equivalence contracts (input/output tables)
- If the IR is incomplete (e.g., agent hit context limits), note gaps explicitly in each output
</rules>
