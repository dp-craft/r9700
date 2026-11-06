# Document analysis: local-agent Ornith vs Haiku

Report: `docs/analysis/2026-11-04-2207-sly-radiance-ornith-vs-haiku-high-effort.md`

**Quarantine:** the notes here were written from fixture copies with planted fictional incidents. `key.json` and
`harness/prepare.py` list them. Never cite an incident from these notes as a real event; use the real reports.

- `S/`, `L/`, `X/`: one fixture size each. `out-<arm>/` notes, `score-<arm>.json`, `key.json`, `MANIFEST.txt`, `meta/`.
- `L/out-local` ran with a mistaken 180,000 window and compacted at 147.6k. It is failure-mode data, not a capacity result.
- `harness/`: `prepare.py` rebuilds fixtures, `brief.txt` is the shared brief, `score.py` is the scorer. The scripts have the session scratchpad path built in.
- `judge/`: blind verdicts and the key that unblinds them. Labels are shuffled per report. `judge/pass2/` is the regrade of all arms with Haiku medium added, under a new shuffle.
- `out-haikumed/`: Haiku medium, run after the other arms with the same brief. `score-*.json` were all regenerated after the FACT-parsing fix in `harness/score.py`.
- `capture/`: Claude Code result JSON for the deployed and clean sessions.
- `thinking-verify.txt`: thinking and effort probe after the starter change.
