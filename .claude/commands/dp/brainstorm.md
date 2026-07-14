---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

Collaborative brainstorming that turns ideas into fully explored, stress-tested designs. Dynamically invokes research and thinking tools when the conversation demands it.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, create any plan, or take any implementation action. Brainstorming produces DECISIONS and CLARITY, not plans or artifacts. The user decides what happens next.
</HARD-GATE>

## Phases

You MUST create a task for each phase and complete them in order:

1. **Orient** — understand project context + user intent
2. **Explore** — generate approaches (2-8, scaled to complexity)
3. **Stress-test** — adversarial analysis of every approach
4. **Resolve** — close every open question with recommendations + user decisions
5. **Converge** — save artifacts, present decision menu

```
Orient ──► Explore ──► Stress-test ──► Resolve ──► Converge
  ▲            │            │              │            │
  │            ▼            ▼              ▼            │
  └────── [research/consider tools] ◄─────────────────┘
              triggered dynamically
```

At ANY point in any phase, if a signal from the Trigger Table matches, offer to invoke the relevant tool before continuing.

---

## Phase 1: Orient

Understand what you're working with before generating ideas.

**Actions:**
- Check project state: files, docs, recent commits
- Load architecture context:
  1. Read `claude-artifacts/project-snapshot/SNAPSHOT.md`
  2. If not found, check project state from files, docs, and recent commits instead
  3. If no code exists at all, this is not a coding project — continue without architecture context
- Ask clarifying questions ONE AT A TIME using AskUserQuestion
- Prefer multiple choice (2-8 options) but open-ended is fine
- Focus on: purpose, constraints, success criteria, affected system areas
- Keep asking until you have a clear picture — no rushing to solutions

**Critical orientation questions (ask what's missing, skip what's obvious):**
- What problem are we solving? (the real problem, not the assumed one)
- Who is this for? What do they care about?
- What constraints exist? (tech stack, time, dependencies, must-haves)
- What does success look like? How will we know it works?
- What parts of the existing system does this touch?
- Are there things this MUST NOT do or break?

**When to trigger tools during Orient:**

| You detect | Offer to run | Why |
|---|---|---|
| Vague or ambiguous problem | `/consider:first-principles` | Strip assumptions, find fundamentals |
| User presents a pain point, not a solution | `/consider:5-whys` | Drill to root cause before solutioning |
| Existing system will be affected | `/consider:second-order` | Trace consequences through architecture |
| Multiple competing priorities | `/consider:eisenhower-matrix` | Clarify what actually matters |
| Contradictory requirements | `/consider:first-principles` | Decompose to find the real constraint |

---

## Phase 2: Explore

Generate approaches. The count scales with complexity:

| Complexity | Approaches | Example |
|---|---|---|
| Config change, simple tweak | 2-3 | Toggle a feature flag, change a default |
| New component, single feature | 3-5 | Add a settings panel, new API endpoint |
| Architectural change, cross-cutting | 5-8 | New data layer, state management overhaul |

**Rules:**
- Each approach MUST be genuinely different — not variations of the same idea
- Present COMBINATIONS where relevant: "Approach A with library X" vs "Approach A with library Y" vs "Approach B with library X" — don't collapse the option space prematurely
- For each approach, state: what it is, how it works, what it costs (complexity, effort, risk), what you gain
- Lead with your recommended approach and say WHY, but present all others with equal depth
- Flag which approaches are reversible vs. hard-to-undo
- Flag which approaches have architectural side effects beyond the immediate feature

**When to trigger tools during Explore:**

| You detect | Offer to run | Why |
|---|---|---|
| "How should we build X?" | `/research:technical` | Implementation approaches with tradeoffs |
| "Should we use X or Y?" | `/research:options` | Side-by-side comparison with metrics |
| "Is there a library for this?" | `/research:open-source` | Find existing solutions before building |
| "How do others do this?" | `/research:competitive` | Learn from competitors |
| "What's the state of X technology?" | `/research:landscape` | Map the space |
| "Is this even possible given our constraints?" | `/research:feasibility` | Reality check |
| "Has anyone tried this before?" | `/research:history` | Learn from past attempts |
| Need deep understanding of a concept | `/research:deep-dive` | Thorough investigation |
| Approach seems overcomplicated | `/consider:occams-razor` | Find simplest valid option |
| Approach adds without clear need | `/consider:via-negativa` | Improve by removing |
| Uncertain about a claim or assumption | Any research command | Verify before building on shaky ground |

**Trigger protocol:** Don't just silently invoke. Ask first:
> "This looks like it needs a feasibility check. Want me to run `/research:feasibility` on [specific aspect], or keep exploring?"

After research/consider results come back, fold the findings into the brainstorm and continue.

---

## Phase 3: Stress-test

This phase is MANDATORY. Every approach that survived Phase 2 gets adversarial scrutiny.

**For EACH surviving approach, run through these lenses:**

### 3a. Assumptions audit
- What are we assuming is true?
- Which assumptions, if wrong, would break this approach?
- Are any assumptions unverified? Flag them.

### 3b. Failure modes
- What would make this approach fail?
- What are the most likely failure scenarios?
- What's the blast radius of each failure?

### 3c. Architectural ripple effects
- What existing modules/features does this touch?
- What changes cascade from this? (data model, API, state, UI)
- Does this create new coupling between currently independent modules?
- Does this violate any existing architectural constraints?

### 3d. Second-order consequences
- If we build this, what does it enable or block in the future?
- Does this create technical debt? Is that debt acceptable?
- What maintenance burden does this add?

### 3e. What are we giving up?
- What's the opportunity cost of each approach?
- What could we build instead with the same effort?
- What simpler version would deliver 80% of the value?

**When to trigger tools during Stress-test:**

| You detect | Offer to run | Why |
|---|---|---|
| Assumptions need systematic challenge | `/consider:first-principles` | Rigorous assumption audit |
| Need to enumerate failure modes | `/consider:inversion` | What would guarantee failure? |
| Decision has long-term architecture implications | `/consider:second-order` | Trace consequence chains |
| Need to map internal/external factors | `/consider:swot` | Full strength/weakness/opportunity/threat |
| Multiple approaches, unclear which matters most | `/consider:pareto` | 80/20 — find vital few |
| Need to evaluate across time horizons | `/consider:10-10-10` | Short/medium/long term |
| Multiple approaches, need to weigh tradeoffs | `/consider:opportunity-cost` | What each choice costs |
| Too many options, need to focus | `/consider:one-thing` | Single highest-leverage action |
| Approach seems bloated | `/consider:via-negativa` | What to remove |

**Present stress-test results transparently.** Do not hide uncomfortable findings. Flag severity:
- **BLOCKER**: This will likely cause failure or serious problems
- **RISK**: This could cause problems under certain conditions
- **TRADEOFF**: This is a conscious cost we accept for a benefit
- **NOTE**: Worth knowing but not decision-changing

---

## Phase 4: Resolve

Close every open question before saving. The brainstorm output must be self-contained — a reader months later should not need to re-investigate anything.

**How it works:**

1. **Collect open questions.** Review all phases for unresolved decisions, unknowns, and deferred questions. Gather them into a single list.

2. **For each question, prepare a recommendation card:**

```
**Q: [The question]**
**Why it matters:** [What this decision affects — which approach, which module, which user experience]
**Recommendation:** [Your recommended answer with specific reasoning]
**Alternatives considered:**
- [Alternative A] — [why not chosen]
- [Alternative B] — [why not chosen]
**Confidence:** High / Medium / Low
**If low confidence:** [What additional information would raise confidence — and whether it's obtainable now or requires future work]
```

3. **Present questions to the user ONE AT A TIME** using AskUserQuestion. For each question:
   - The recommended answer is the first option
   - Alternatives are additional options
   - The user can approve, override, or defer

4. **Record the decision** — the user's choice becomes the answer. If the user defers, record: the question, the recommendation, and WHY it's deferred (what's blocking resolution).

**Goal:** Zero unresolved questions in the final document. Every question has either:
- A **decided** answer (user approved or overrode the recommendation), or
- A **recommended default** with explicit reasoning for why it can't be decided now and what would unblock it

**In the final document, questions are saved as a Q&A section:**

```markdown
## Resolved Questions

### Q: [Question]
**Decision:** [What was decided]
**Reasoning:** [Why — either user's reasoning or the recommendation rationale]
**Alternatives considered:** [Brief list]

### Q: [Question]
**Decision:** Deferred — recommended default: [X]
**Why deferred:** [What information is missing]
**Unblocked by:** [What would allow this to be decided]
**Reasoning for default:** [Why X is the safest bet in the meantime]
```

---

## Phase 5: Converge

Save all artifacts and present the decision menu.

### 5a. Save investigation sub-results

**Before presenting the summary**, save every substantial investigation produced during the brainstorm as individual files. These are the raw investigation outputs — do NOT reformat or compress them. Preserve the full analysis as it was produced.

**What counts as a sub-result:**
- Any `/research:*` or `/consider:*` command output
- Any substantial inline analysis (architecture analysis, cost analysis, competitive scan, etc.)
- The stress-test results
- The full approaches evaluation

**Do NOT save as sub-results:**
- Orient Q&A (this goes in the main doc as the decision narrative)
- Short clarifications or minor observations

**File structure:**
```
docs/brainstorm/{topic}/
  {topic}.md                              <- main document (narrative + index)
  sub-results/
    {subject}-{type}.md                   <- one per investigation
    {subject}-{type}.md
    ...
```

**Naming rules:**
- `{topic}` = short kebab-case name of the brainstorm topic (e.g., `multi-level-skills`)
- `{subject}` = short kebab-case name of what was investigated (e.g., `prompt-caching-cost`, `ai-chat-apps`, `prompt-layering`)
- `{type}` = the type of investigation, matching command names where applicable:
  - From commands: `competitive`, `deep-dive`, `feasibility`, `history`, `landscape`, `open-source`, `options`, `technical`, `first-principles`, `5-whys`, `inversion`, `second-order`, `swot`, `pareto`, `occams-razor`, `10-10-10`, `eisenhower-matrix`, `opportunity-cost`, `one-thing`, `via-negativa`
  - Custom types for brainstorm-specific analysis: `architecture-analysis`, `cost-analysis`, `stress-test`, `approaches`

**Sub-result file format:**
```markdown
# {Title}

**Brainstorm:** [{topic}](../{topic}.md)
**Type:** {type}
**Date:** {YYYY-MM-DD}

---

{full investigation content exactly as produced — tables, analysis, sources, everything}
```

Save all sub-results first, then write the main document.

### 5b. Write the main document

The main document is the **decision narrative** — the thinking flow that a human can read months later and understand every decision, every reason, every fork in the road. It references sub-results for deep detail.

**Main document structure:**

```markdown
# {Topic} — Brainstorm

- **Date:** {YYYY-MM-DD}
- **Status:** {Brainstorm complete — parked (awaiting specification) | In progress}
- **Chosen approach:** {name or "None yet"}

---

**Sections:** [Problem Statement](#problem-statement) | [Orient](#orient--key-decisions) | [Investigations](#investigation-index) | [Approaches](#approaches) | [Comparison](#comparison-matrix) | [Stress-Test](#stress-test-summary) | [Recommendation](#recommendation) | [Questions](#resolved-questions) | [Evolution](#evolution-path)

---

## Problem Statement
{What we're solving. 2-5 sentences. Clear enough that someone reading this cold understands the goal.}

## Orient — Key Decisions

{For each decision point, use this structure:}

### {Decision topic}

Options considered:
- {Option A}
- {Option B}
- {Option C}

**Decision:** {What was chosen}

{Why this was chosen, how it shaped what came next. 1-3 sentences of reasoning.}

## Investigation Index

{For each investigation, use this structure:}

### [{Title}](sub-results/{filename}.md)
- **Type:** {type}
- **Scope:** {1-sentence scope}
- **Key finding:** {1-sentence takeaway}

## Approaches

{For each approach evaluated — compressed but complete. Include:}

### Approach N: {Name} {CHOSEN / ELIMINATED / VIABLE}

- **What:** {1-2 sentences}
- **How:** {2-3 sentences on mechanics}
- **Strength:** {primary advantage}
- **Weakness:** {primary risk/cost}
- **Complexity:** S / M / L / XL
- **Reversibility:** Easy / Medium / Hard
- **Architectural impact:** None / Local / Cross-cutting

{If this approach was the focus of deep investigation, link to sub-results:
See: [stress-test](sub-results/...), [cost-analysis](sub-results/...)}

## Comparison Matrix

| Dimension | Approach A | Approach B | ... |
|---|---|---|---|
| Solves the core problem | Y/Partial/N | | |
| Complexity | S/M/L/XL | | |
| Risk level | Low/Med/High | | |
| Reversible | Y/N | | |
| Architectural side effects | None/Local/Cross | | |
| Maintenance burden | Low/Med/High | | |
| Future optionality | Opens/Neutral/Closes | | |

## Stress-Test Summary

{Compressed findings table — full analysis is in sub-results.}

| Finding | Severity | Approach(es) affected |
|---|---|---|
| {finding} | BLOCKER/RISK/TRADEOFF/NOTE | {which} |

See: [full stress-test](sub-results/...)

## Recommendation

{Your recommendation with reasoning. Present as recommendation, not decision.}

### Implementation notes

{Key details for the chosen approach — ordering, UX requirements, schema decisions.}

## Resolved Questions

### Q: {Question}

- **Decision:** {What was decided}
- **Reasoning:** {Why — user's reasoning or recommendation rationale}
- **Alternatives considered:** {Brief list of what else was on the table}

### Q: {Question}

- **Decision:** Deferred — recommended default: {X}
- **Why deferred:** {What information is missing}
- **Unblocked by:** {What would allow this to be decided}
- **Reasoning for default:** {Why X is the safest bet in the meantime}

## Evolution Path

{If applicable — how this approach evolves over versions.}

## Sources

{All sources from all sub-results, deduplicated.}
```

### 5c. Decision menu

After saving all files, present the decision menu. End the brainstorm by asking what the user wants to do next. Use AskUserQuestion with options tailored to the situation. Common options:

- **Proceed to specification** — take the chosen approach into `/speckit.specify`
- **Proceed to planning** — if spec already exists, go to `/speckit.plan`
- **Research deeper** — dig into a specific finding or uncertainty
- **Run a thinking tool** — apply a specific consider framework
- **Explore a different angle** — restart brainstorm with new constraints
- **Park it** — save notes and come back later
- **I need to think about it** — end session, no action

Present 3-6 of these as appropriate. Always include a "park it" option.

---

## Behavioral Rules

### Be critical, not cautious
- Surface every risk, every assumption, every side effect
- Don't soften findings to avoid pushback
- Present uncomfortable truths clearly
- If an approach has a fatal flaw, say so directly

### Maximize information for decision-making
- More options > fewer options (within reason)
- More combinations > collapsed choices
- Show tradeoffs explicitly, never hide them
- When two approaches are close, explain exactly what tips the scale

### Respect the user's role
- The user is a technical architect and product owner
- They understand complexity, architecture, and tradeoffs
- Don't oversimplify — give full detail on anything with side effects
- Give freedom to choose — recommendations yes, decisions no

### Scale depth to stakes
- Low-stakes change: lighter Orient, fewer approaches, lighter Stress-test
- High-stakes architectural change: thorough Orient, many approaches, exhaustive Stress-test
- When in doubt, go deeper — it's easier to skip detail than to recreate it

### One question at a time
- Never ask multiple questions in one message
- Use AskUserQuestion with multiple choice (2-8 options) when possible
- Open-ended questions are fine when multiple choice would be artificial

### No auto-chaining
- NEVER automatically invoke planning, specification, implementation, or any downstream skill
- The brainstorm ENDS with the decision menu in Phase 5
- The user picks the next step, or picks nothing
