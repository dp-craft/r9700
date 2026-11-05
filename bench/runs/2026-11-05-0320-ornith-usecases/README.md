# Ornith use cases

Report: `docs/analysis/2026-11-05-0814-ornith-use-cases.md`

**Quarantine:** planted log lines and `docnotes` incidents are fiction. Fixtures are copies with those lines added. Never cite one as a real event; use the real reports.

- `arms/<task>.<size>.<brief>.<preset>[.rN]/`: one finished Ornith arm: brief, raw result, reply, output, score, server stats, GPU samples.
- `arms-haiku/`: Haiku `max` baseline on the same briefs. `ledger.jsonl` holds time and tokens.
- `quarantine/`: arms cut at their limit or stopped at the turn cap (iron rule 18). They count only as "didn't finish".
- `summary.jsonl`, `summary.md`: all finished arms. `longrun.jsonl` is the driver's log and keeps `impl` scores from before the denominator fix; `summary.*` and each `score.json` have the fixed values.
- `grader-check/`: Haiku grader checks. `haiku/`, `haiku-max/` are the 40-note comparison with Opus. `summary/` and `docnotes/` hold the blind grades and each `label-key.json`.
- `prompt-capture/`: the exact requests Ornith receives as a main session and as a subagent.
- `harness/`: `prepare.py`, `prepare_doc.py`, `prepare_notes.py` build fixtures; `run_arm.sh`, `long_run.py` run arms; `score*.py` score them; `gen_refs.py` writes the skill's `references/briefs.md`.

**Rerunning:** the scripts have the session scratchpad path built in, and fixtures live there, so a reboot deletes them. `prepare.py` rebuilds them from the repo, and `classify` picks up new documents: source size went from 16,700 to 16,606 tokens on the rebuild. `aggregate.py` also needs the `prepare_doc.py` fixtures for its source-size columns.
