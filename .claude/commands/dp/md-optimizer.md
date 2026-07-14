---
name: md-optimizer
description: "Optimize Claude config MD files for token efficiency and quality. LLM-condenses, checks consistency, finds gaps, stress-tests for zero info loss. Accepts a file or directory."
argument-hint: <file-or-directory-path>
---

# Claude Config MD Optimizer

Optimize `.md` files in the Claude configuration system for **token efficiency** and **quality** while guaranteeing **zero information or rule loss**.

## User Input

```text
$ARGUMENTS
```

If empty or missing → abort with: "Usage: `/dp:md-optimizer <file-or-directory>`"

<HARD-GATE>
- Changes MUST NOT be persisted without explicit user approval
- Zero tolerance for information loss — every rule, constraint, example, and reference MUST survive optimization
- When something is unclear, confusing, or blocking → present options to the user, do NOT guess
</HARD-GATE>

## Phases

You MUST create a task for each phase and complete them in order:

1. **Scan** — read files, measure baselines
2. **Analyze** — find optimization opportunities and issues
3. **Dependency Check** — verify cross-file consistency
4. **Optimize** — produce condensed versions
5. **Stress Test** — verify zero loss
6. **Present** — show changes with approval
7. **Apply** — persist after approval

---

## Phase 1: Scan

### 1a. Resolve input

| Input | Action |
|---|---|
| Single `.md` file | Optimize that file |
| Directory | Optimize all `.md` files in it (non-recursive) |
| Directory with `**` glob | Optimize recursively |
| Not found | Abort with error |

### 1b. Read and baseline each file

For each target file, record:

| Metric | How |
|---|---|
| Line count | `wc -l` |
| Approximate token count | `line_count * 3.5` (average for structured MD) |
| File role | Parse `<!-- LLM-PRIMARY: ... -->` header or YAML frontmatter |
| Heading structure | Extract all `#`-level headings |
| Format inventory | Count tables, lists, code blocks, prose paragraphs |
| Consumers | Grep for `@{filename}`, `See {filename}`, backtick refs across config files |

### 1c. Read MARKDOWN-AUTHORING.md

Read `claude-artifacts/standards/MARKDOWN-AUTHORING.md` — all optimizations MUST comply with its rules.

---

## Phase 2: Analyze

For each file, run these detection passes. Track findings with severity.

### 2a. Verbosity Detection

| Pattern | Optimization | Severity |
|---|---|---|
| Prose paragraph explaining a rule | Convert to table row or bullet | High |
| Repeated sentence structure across items | Merge into table with columns | High |
| Filler words ("It is important to note that...", "Please ensure that...") | Remove, keep imperative | Medium |
| Redundant qualifiers ("absolutely MUST", "strictly FORBIDDEN") | Normalize to `MUST` / `FORBIDDEN` | Low |
| Section with >5 bullets that share structure | Convert to table | Medium |
| Explanatory text after a self-evident rule | Remove explanation | Low |

### 2b. Structural Issues

| Pattern | Issue | Severity |
|---|---|---|
| Heading depth > H4 | Split into sub-file | High |
| File > 300 lines | Consider splitting | High |
| Section > 80 lines | Break into subsections or table | Medium |
| Duplicate content across files | Reference instead of inline | Critical |
| Inconsistent heading style within file | Normalize | Medium |
| Missing `<!-- LLM-PRIMARY: ... -->` header | Add | High |
| Inconsistent list style (mixed `-` and `*`) | Normalize | Low |

### 2c. Content Quality

| Pattern | Issue | Severity |
|---|---|---|
| Vague rule ("try to...", "consider...", "should...") | Strengthen to `MUST` / `MUST NOT` or remove | High |
| Rule without enforcement mechanism | Flag as unenforceable | Medium |
| Contradictory rules within same file | Resolve conflict | Critical |
| Dead reference (mentions file that doesn't exist) | Fix or remove | High |
| Outdated content (references old names, removed features) | Update | High |
| Example that doesn't match its rule | Fix example or rule | Critical |

### 2d. Keyword Consistency

Per MARKDOWN-AUTHORING.md, normalize keywords:

| Forbidden | Required Replacement |
|---|---|
| `NEVER` | `MUST NOT` |
| `ALWAYS` | `MUST` |
| `Do NOT` / `Don't` | `MUST NOT` |
| `REQUIRED` (standalone) | `MUST` |
| `PROHIBITED` | `FORBIDDEN` |
| `should not` | `MUST NOT` (if mandatory) or remove (if advisory) |

**Exception**: Direct quotes, example code, or content describing external systems retain original wording.

### 2e. Gap Detection

- Rules that reference concepts not defined in the file or its dependencies
- Missing cross-references (file mentions a concept that lives in another standards file but doesn't reference it)
- Incomplete tables (rows with empty cells that should have values)
- Rules with "TBD", "TODO", or placeholder content

---

## Phase 3: Dependency Check

For each target file, verify consistency with its dependents and dependencies.

### 3a. Outgoing references

For every `@file`, `See file`, or backtick reference in the target:
1. Verify the referenced file exists
2. Verify the referenced section/heading exists (if section-specific)
3. Check the referenced content hasn't changed in a way that invalidates the reference

### 3b. Incoming references

Grep for files that reference the target:
1. Will any optimization (heading rename, section removal) break incoming references?
2. Do consumers rely on specific heading names for navigation?

### 3c. Rule collision detection

For each rule in the target file, check if:
1. The same or conflicting rule exists in another file in the loading chain
2. Two files loaded by the same agent contain contradictory guidance
3. A rule is duplicated verbatim (or near-verbatim) in a dependency

Present collisions in a table:

| Rule (this file) | Collision | Other File | Type |
|---|---|---|---|
| {rule summary} | {what conflicts} | {file} | Duplicate / Contradiction / Overlap |

### 3d. Blocker resolution

If any of the following are found, STOP and present options to the user:

| Blocker | Options |
|---|---|
| Contradictory rules across files | A: keep this file's version, B: keep other file's, C: merge into unified rule |
| Duplicate content across files | A: keep here + remove there, B: remove here + keep there, C: extract to shared file |
| Dead reference | A: remove reference, B: create the missing target, C: redirect to existing file |

---

## Phase 4: Optimize

For each file, produce the optimized version.

### Optimization techniques (ordered by impact)

1. **Prose → Table**: Convert structured prose (if-then rules, option lists, pattern descriptions) into tables
2. **Deduplicate**: Remove content that exists in a dependency the file already loads
3. **Merge similar items**: Combine items that share structure into fewer, denser rows
4. **Remove filler**: Strip filler words, redundant qualifiers, unnecessary transitions
5. **Normalize keywords**: Apply the keyword table from Phase 2d
6. **Tighten examples**: Reduce verbose examples to minimal illustrative form
7. **Reorder for front-loading**: Move most-referenced / highest-value content to top
8. **Consolidate sections**: Merge small related sections (< 5 lines each) into one

### Rules for optimization

- Tables MUST use `|---|` separators (no padding dashes like `|----------|`)
- Heading hierarchy MUST be preserved (don't promote/demote headings)
- `<!-- LLM-PRIMARY: ... -->` header MUST be preserved or updated
- File naming MUST NOT change (optimization is content-only)
- Code blocks and examples that demonstrate specific patterns MUST be preserved — condense the explanation, not the example
- When merging bullets into a table, the table MUST have clear column headers that make each row self-explanatory

### Produce diff

For each file, prepare:
1. The full optimized content
2. A summary: `{old_lines} → {new_lines} lines ({reduction_pct}% reduction)`
3. A change list: what was changed and why (one line per change)

---

## Phase 5: Stress Test

For each optimized file, verify zero information loss.

### 5a. Rule-by-rule audit

Extract every rule/constraint from the ORIGINAL file as a checklist. For each:

| # | Original Rule | Present in Optimized? | Where? |
|---|---|---|---|
| 1 | {rule text} | Yes / **MISSING** | {line or table row} |

If ANY rule is marked MISSING → fix the optimized version before proceeding.

### 5b. Reference integrity

- Every `@file`, `See file`, and backtick reference from the original MUST exist in the optimized version
- Every heading that is referenced by other files MUST keep its exact name (or all references MUST be updated)

### 5c. Semantic equivalence test

For each changed section, answer:
> "If an LLM agent reads only this section, will it make the same decisions as with the original?"

If the answer is "no" or "uncertain" for any section → revert that specific change and note why.

### 5d. Example preservation

Every code example, pattern example, or anti-pattern example in the original MUST be present in the optimized version. Examples MAY be reformatted (e.g., moved into a table) but MUST NOT be removed or semantically altered.

---

## Phase 6: Present

Show the optimization results to the user for approval.

### 6a. Summary table

| File | Before | After | Reduction | Issues Found | Issues Fixed |
|---|---|---|---|---|---|
| `{file}` | {lines} lines | {lines} lines | {pct}% | {count} | {count} |
| **Total** | {sum} | {sum} | {pct}% | {sum} | {sum} |

### 6b. Per-file change report

For each file, show:

```
### {filename}

**Reduction**: {old} → {new} lines ({pct}%)

**Changes:**
1. {what changed} — {why}
2. {what changed} — {why}
...

**Stress test**: {PASSED / FAILED — details}

**Dependency impact**: {None / list of affected files}
```

### 6c. Unresolved items

If any findings couldn't be auto-resolved, present them with options:

```
**Unresolved: {description}**

Options:
A. {option A}
B. {option B}
C. Skip (leave as-is)

Which do you prefer?
```

### 6d. Approval prompt

```
Ready to apply optimizations?

1. Apply all changes
2. Apply selectively (I'll tell you which files)
3. Show full diff for specific file(s) first
4. Revise (I'll provide feedback)
5. Cancel (no changes)

Choose (1-5):
```

**Wait for user response. Do NOT proceed without explicit approval.**

---

## Phase 7: Apply

Only after user approval (option 1 or 2):

1. Apply edits using the Edit tool (prefer Edit over Write for existing files)
2. Re-read each modified file to verify the edit applied correctly
3. If dependency references changed, update all affected files
4. Run final line count comparison to confirm reduction

**Do NOT commit** — the user decides when to commit.

Report completion:

```
Optimization complete.

| File | Before | After | Reduction |
|---|---|---|---|
| {file} | {lines} | {lines} | {pct}% |

Total token savings: ~{tokens} tokens ({pct}% reduction)
```

---

## Behavioral Rules

### Zero loss is non-negotiable
- If you're unsure whether a condensation preserves meaning → keep the original
- When in doubt, ask the user
- A 5% reduction with zero loss beats a 30% reduction with any loss

### Optimize for LLM consumers
- LLMs parse tables faster than prose — prefer tables
- LLMs follow explicit keywords (`MUST`, `FORBIDDEN`) better than hedged language — strengthen vague rules
- LLMs benefit from front-loaded high-value content — reorder sections by reference frequency

### Respect file boundaries
- Each file has a single responsibility — don't merge files
- Don't move content between files unless resolving a duplicate/collision
- Don't create new files unless splitting an oversized one (and only with user approval)

### Consistency over local optimization
- A slightly less optimal phrasing that matches the rest of the file is better than an optimal phrasing that breaks consistency
- If the file uses `-` for lists, don't switch to `*`
- If the file uses `**bold**` for emphasis, don't switch to `CAPS`
