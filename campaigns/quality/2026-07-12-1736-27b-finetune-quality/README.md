# Qwen3.6-27B fine-tune shootout — output quality + token economy (R9700)

Four community **Qwen3.6-27B** fine-tunes (plus MTP on/off on the one MTP build — 5 configs), all the
identical `qwen35` hybrid arch, compared on **answer quality** (9 deterministic auto-graded tasks +
3 open-ended tasks blind-LLM-judged) and **token economy** (how many thinking tokens each burns for the
same task, same seed/serving). Capacity is held constant, so every difference is from fine-tuning data,
not architecture.

**Write-up:** [2026-07-12-1736-27b-finetune-quality.md](../../../docs/findings/quality/2026-07-12-1736-27b-finetune-quality.md)

**Layout**
- recipe files: `spec.json` (configs/serving/VRAM guard), `plan.md` (runbook), `run.sh` (generated driver), `run_capture.sh` (this dir's Phase-A driver — drives `bench/quality/capture.py` + `bench/quality/graders/`)
- `inputs/tasks/tasks.jsonl` — 12 tasks + grader specs (9 deterministic, 3 judge)
- `results/` (committed): `scores_deterministic.jsonl`, `judge_scores.jsonl`, `charts/` (SVGs), `appendix.md`
- `tmp/` (gitignored): `outputs.jsonl`, `vram.jsonl`, `gpu_<cfg>.csv`, `props_<cfg>.json`, `done/`, `failures.txt`

**Reproduce** (per `plan.md`: reproduce the committed data with `run_capture.sh`; `run.sh` is the go-forward path for fresh work)
```bash
bash campaigns/quality/2026-07-12-1736-27b-finetune-quality/run_capture.sh            # all 5 configs, reps 1
ONLY='unsloth*' REPS=3 bash campaigns/quality/2026-07-12-1736-27b-finetune-quality/run_capture.sh   # subset / more reps
bash campaigns/quality/2026-07-12-1736-27b-finetune-quality/run.sh                    # generated driver (serve → capture → score → report)
```
Phase B (blind LLM-judge of the 3 open-ended tasks) and Phase C (aggregate + write-up) are in `plan.md`.

Numbers: `MEASURED` (this campaign's `results/`), see the write-up.
