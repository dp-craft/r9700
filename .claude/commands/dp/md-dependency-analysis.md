---
name: md-dependency-analysis
description: "Analyze the Claude config dependency structure — agents, commands, skills, principles, standards. Produces dependency map, responsibility table, and gap analysis."
---

# Claude Config MD Dependency Analysis

Analyze the full Claude configuration structure and produce a dated analysis report. The output MUST match the format of prior reports in `docs/claude-structure-*/`.

<HARD-GATE>
This command is READ-ONLY analysis. Do NOT modify any configuration files. Do NOT fix any issues found. Present findings and recommendations — the user decides what to act on.
</HARD-GATE>

## Output

Write 3 files to `docs/claude-structure-analysis-{YYYY-MM-DD}/`:

1. `dependency-map.md` — full loading chain
2. `responsibility-table.md` — per-file responsibility analysis
3. `analysis.md` — gap analysis with recommendations

If the directory already exists (same date), overwrite the files.

## Procedure

You MUST create a task for each phase and complete them in order:

1. **Scan** — discover all config files
2. **Map** — build dependency graph
3. **Classify** — build responsibility table
4. **Analyze** — identify gaps, noise, naming issues, mixed responsibilities
5. **Write** — produce the 3 output files

---

## Phase 1: Scan

Discover all configuration files that participate in the Claude loading chain:

| Category | Location | Pattern |
|---|---|---|
| Entry points | repo root | `CLAUDE.md`, `CLAUDE_PROJECT_SPECIFIC.md` |
| Principles | `claude-artifacts/principles/` | `*.md` |
| Standards | `claude-artifacts/standards/` | `*.md` |
| Examples | `claude-artifacts/examples/` | `*.md` |
| Agents | `.claude/agents/` | `*.md` |
| Commands | `.claude/commands/` | `**/*.md` |
| Skills | `.claude/skills/` | `**/*.md` (if exists) |
| Supporting | `claude-artifacts/` | `LSP.md`, `git-strategy.md`, `speckit/*.md`, `project-snapshot/SNAPSHOT.md` |

For each file, read it and extract:
- `@file.md` references (auto-loaded dependencies)
- `Read ... file.md` or `read ... file.md` instructions (instructed reads)
- `See ... file.md` or backtick references to other config files (references)
- The file's `<!-- LLM-PRIMARY: ... -->` header or YAML frontmatter description
- What technology/framework/tool the content is specific to (or "generic")
- Whether the content is project-specific or reusable

**Parallelization**: Read all files within each category in parallel. Process categories sequentially only if needed.

---

## Phase 2: Map (dependency-map.md)

Build the dependency graph using this exact format:

```markdown
# Claude Config Dependency Map

Generated: {YYYY-MM-DD}

Legend: `──@──►` = auto-loaded, `──read──►` = instructed to read, `──ref──►` = mentioned/referenced

## CLAUDE.md (Entry Point)

\```
CLAUDE.md
  ──@──► {file}
  │        ──@──► {transitive auto-load}
  │        ──ref──► {reference}
  │
  ──ref──► {file}
\```

## Agents

\```
{agent-name}.md
  ──@──► {principle or standard}
  ──read──► {file}
  ──ref──► {file}

{next-agent}.md
  ...
\```

## Commands (project-relevant only)

\```
{command}.md
  ──@──► {file}
  ──read──► {file}
\```

## Standards Inter-Dependencies

\```
{standard}.md
  ──ref──► {other-standard}.md (§ section)
\```
```

**Rules:**
- Show transitive `@` loads inline (e.g., `TYPESCRIPT.md ──@──► standards/TS-MODULE-DEPENDENCY-RULES.md`)
- Group agents that have no `@` loads separately with `(no @loads — {reason})`
- Only include commands that load standards or principles (skip trivial ones)
- For standards inter-dependencies, show only cross-file references, not self-references

---

## Phase 3: Classify (responsibility-table.md)

Build the responsibility analysis table:

```markdown
# File Responsibility Analysis

Generated: {YYYY-MM-DD}

## Top-Level Files

| File | Responsibility | Tech-Specific? | Project-Specific? | Content Analysis |
|---|---|---|---|---|
| `CLAUDE.md` | {role} | {Yes: what tech / No} | {Yes: what project / No} | {analysis} |

## Principles

| File | Responsibility | Tech-Specific? | Project-Specific? | Content Analysis |
|---|---|---|---|---|
| `COMMON.md` | {role} | ... | ... | ... |

## Standards

| File | Responsibility | Tech-Specific? | Project-Specific? | Content Analysis |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Agent Files

| Agent | Responsibility | Loads Principles? | Loads TS Standards? | Missing? |
|---|---|---|---|---|
| `{agent}` | {role} | {what it loads} | {what standards it gets} | {what it should have but doesn't} |

## Commands

| Command | Responsibility | Loads Standards? | Missing? |
|---|---|---|---|
| `{command}` | {role} | {what it loads} | {gaps} |
```

**Classification rules:**
- **Tech-Specific?**: Read the actual content. Look for tool names (Vitest, Playwright, npm, ESLint), framework patterns (React hooks, Zustand), language features (TypeScript strict mode). Mark as `**TS**`, `**TS + React**`, `**No** (generic)`, etc.
- **Project-Specific?**: Does it reference AiChatney, specific feature names, specific file paths? If yes → project-specific.
- **Content Analysis**: Note if the file has mixed responsibilities, wrongly scoped content, or is clean.
- **Missing?**: For agents/commands, check if they need standards they don't load. Focus on:
  - Does an agent that writes code have access to import/dependency rules?
  - Does an agent that creates modules have access to layer boundary rules?
  - Does an agent that writes tests have access to testing standards?

---

## Phase 4: Analyze (analysis.md)

Perform gap analysis across 6 dimensions. For each finding, rate severity: **Critical**, **Moderate**, **Minor**.

### 4.1 Missing Dependencies

For each standards file, trace which agents/commands can access it (directly or transitively). Flag:
- Standards that should be loaded by an agent but aren't (e.g., import rules missing from a code-writing agent)
- Standards loaded only through a scoped file (e.g., only reachable via a Browser-only principle file, but applies to all targets)
- Commands that delegate to agents but don't ensure agents have needed rules

### 4.2 Noise

Flag standards/principles loaded where they add no value:
- Technology-specific rules loaded by agents that don't work with that technology
- Heavy rule files loaded by agents that only need a small subset

### 4.3 Wrongly Named Files

Check each file name against its content:
- Generic name but technology-specific content → should have tech prefix
- Tech-prefixed name but generic content → prefix is misleading
- Present as a table: `| Current Name | Problem | Suggested Name | Reason |`

### 4.4 Mixed Responsibilities

Flag files that mix:
- Generic rules with technology-specific examples
- Orchestration logic with technology-specific dispatch
- Cross-cutting concerns with single-feature concerns

### 4.5 Loading Chain Gap Summary

For each key standards file, show accessibility:
```
{file} accessibility:
  ✓ {who has it} ({how})
  ✗ {who doesn't} ({why it matters})
```

### 4.6 Recommendations

Present 2-4 concrete options ranked by impact vs. effort. For each:
- What it fixes
- Pros/Cons
- Blast radius (how many files change)

End with a clear recommendation.

**Format:**

```markdown
# Claude Config Structure Analysis

Generated: {YYYY-MM-DD}

## 1. Missing Dependencies (Rules not loaded where needed)

### {Severity}: {title}
{description}

## 2. Noise (Rules loaded where not needed)

### {Severity}: {title}
{description}

## 3. Wrongly Named Files

| Current Name | Problem | Suggested Name | Reason |
|---|---|---|---|

## 4. Mixed Responsibilities

### {file}: {what's mixed}
{description}

## 5. Loading Chain Gap Summary

\```
{accessibility traces}
\```

## 6. Recommendations

### Option A: {title}
{description}
**Pros**: ...
**Cons**: ...

### My recommendation: {which option(s)}
{reasoning}
```

---

## Phase 5: Write

1. Create `docs/claude-structure-{YYYY-MM-DD}/` directory
2. Write all 3 files
3. Present a summary to the user:
   - Number of files scanned
   - Number of critical/moderate/minor findings
   - Top 3 findings by impact
   - Recommended action

---

## Reference: Prior Analysis

For format reference, read any existing `docs/claude-structure-*/` directory. The output format MUST match these prior reports.

## Behavioral Rules

- **Be precise**: Read file content, don't guess from file names
- **Be thorough**: Every agent and command MUST be analyzed, not just the obvious ones
- **Be honest**: If a loading gap has a mitigating factor (e.g., orchestrator pre-delegation), note it — but still flag the gap
- **Compare to prior**: If a prior analysis exists, note what changed (fixed, regressed, new issues)
- **No auto-fixing**: Present findings only. The user decides what to change
