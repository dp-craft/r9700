# Ornith use cases

Report: `docs/findings/workers/2026-11-05-0814-ornith-use-cases.md`

**Quarantine:** planted log lines and `docnotes` incidents are fiction. Fixtures are copies with those lines added. Never cite one as a real event; use the real reports.

- `arms/<task>.<size>.<brief>.<preset>[.rN]/`: one finished Ornith arm: brief, raw result, reply, output, score, server stats, GPU samples.
- `arms-haiku/`: Haiku `max` baseline on the same briefs. `ledger.jsonl` holds time and tokens.
- `quarantine/`: arms cut at their limit or stopped at the turn cap (iron rule 18). They count only as "didn't finish".
- `summary.jsonl`, `summary.md`: all finished arms. `longrun.jsonl` is the driver's log and keeps `impl` scores from before the denominator fix; `summary.*` and each `score.json` have the fixed values.
- `grader-check/`: Haiku grader checks. `haiku/`, `haiku-max/` are the 40-note comparison with Opus. `summary/` and `docnotes/` hold the blind grades and each `label-key.json`.
- `sysprompt.jsonl`, `arms/*.sa`, `arms/*.dp`, `arms/*.base2`: the system prompt test, driven by `harness/sys_run.py` with `harness/sysprompts/`. These arms aren't in `summary.*`. Blind grades are in `grader-check/sysprompt/`.
- `prompts.jsonl`, `prompts.md`, `prompts.out`, `follow.out`: the system prompt repeats, driven by `harness/prompt_run.py` (plans `smoke`, `main`, `follow`; `CONC` sessions at a time, 3 here). Tags: `b2`, `b3`, `r2`, `r3` and `base2` use the default prompt, and `dp`, `dp2` and `dp3` use `dp`. `dps*` add the profile's add-on and `dpc*` the code add-on that lists commands. `dpw*` use the wider code allow-list (`ORN=` pointed `run_arm.sh` at a scratchpad copy of `ornith.sh`), `bdata` uses the default prompt on `data`, and `q*` are smoke runs. `prompts.md` lists every finished arm with denials and memory. `harness/own_requests.py` keeps each arm's own server lines by its transcript's message IDs, so parallel arms don't mix. Blind notes grades: `grader-check/prompts2/` (`label-key.json` unblinds them).
- `prompt-capture/`: the exact requests Ornith receives as a main session and as a subagent.
- `harness/`: `prepare.py`, `prepare_doc.py`, `prepare_notes.py` build fixtures; `run_arm.sh`, `long_run.py` run arms; `score*.py` score them; `gen_refs.py` writes the skill's `references/briefs.md`.

**Rerunning:** the scripts have the session scratchpad path built in, and fixtures live there, so a reboot deletes them. `prepare.py` rebuilds them from the repo, and `classify` picks up changed documents: even with `PREP_CUTOFF` the source size was 16,631 tokens, not 16,700. `aggregate.py` also needs the `prepare_doc.py` fixtures for its source-size columns.
