## Tools — the deterministic layer (use these, never hand-roll their output)

| Need | Tool (invoke, don't reimplement) | Emits |
|------|----------------------------------|-------|
| Scaffold a campaign (throughput matrix) | **`/benchmark-new-campaign`** → `bench/gen_campaign.py emit --spec …` | `spec.json` → resumable `run.sh` (VRAM guard + **auto-builds missing fixtures**) + README |
| KV geometry / max-ctx / `vram` block (HYBRID-aware) | `bench/gguf_kv.py MODEL.gguf --weights-gib G` | KiB/tok f16+q8, max ctx, paste-ready guard block |
| Agentic A/B (real `claude -p` sessions, fresh vllm server + worktree per rep×arm) | **`/benchmark-new-campaign`** → `gen_campaign.py emit` with `kind: "agentic"` (`example --agentic`; GUIDE §7) | resumable `run.sh` (quarantines `interrupted`) + README; `rep<R>/<arm>/` dirs |
| Quick VRAM↔ctx what-if | `bench/gen_campaign.py vram-ctx --weights-gib G --kv-kib-per-tok K --budget-mib M` | max ctx |
| Build a prompt fixture (code/agentic/thinking, N tokens) | `bench/workloads/build_prompt.py --task … --src corpus/… --target-tokens N` | `generated/<name>.txt` (also auto-built by campaign `run.sh`) |
| Find THE tuning optimum (one engine, bracket + KV ≤5%) | `bench/model-bench/sweep.py` | `sweep-summary.json` |
| Probe a live server (prefill/decode/ttft/concurrency) | `bench/lib/capture_engine.py probe` (via `run.sh`) | `results.jsonl` |
| Launch a parameterized llama-server (BACKEND/MTP/KV/**EXTRA_ARGS**) | `bench/engine-bench/serve_llamacpp.sh` | running server + `/props` |
| Sample VRAM/GTT/power/thermal | `bench/lib/vram_sampler.py --out CSV` | `gpu_samples.csv` |
| **Make the GPU exclusive + assert a free-VRAM floor before booting any engine** | `bench/lib/gpu_exclusive.sh [required_free_mib]` | unloads llama-swap (GET), kills the hipfire daemon+serve shape, exits non-zero naming the holder |
| Run/campaign dir → theme-aware SVG charts + appendix.md | `bench/lib/report.py` | `charts/*.svg` + `appendix.md` |
| Quality capture (per-task replies + tokens/ttfa/flags) | `campaigns/2026-07-12-27b-finetune-quality/capture.py` | `outputs.jsonl` |
| Grade deterministic tasks (final_match/pyexec/json_schema/constraints) | `…/finetune-quality/graders/score_deterministic.py` | `scores_deterministic.jsonl` |
| Quality campaign → decision charts (theme-aware SVG + appendix.md) | `campaigns/2026-07-12-27b-finetune-quality/make_charts.py --dir out --charts charts [--order …] [+ out/sweeps.json for connected-parameter line charts]` | `charts/*.svg` + `appendix.md` |
| Throughput run/campaign dir → theme-aware SVG charts + appendix.md | `bench/lib/report.py <run_dir>` (auto-run by gen_campaign's `run.sh`) | `charts/*.svg` + `appendix.md` |
| Fetch + build a llama.cpp tag (vulkan+rocm), promote / roll back `latest-*` | `llamacpp/build_llamacpp.sh build\|promote\|status` (skill **`/llamacpp-build`**) | `llamacpp/builds/<ver>-{src,vulkan,rocm}` + `llamacpp/builds/latest-*` + Vulkan SDK (`llamacpp/setup_vulkan.sh`) |
| New llama.cpp build vs previous (llama-bench request shapes pp128/tg64 … pp32768/tg2048 → verdict; optional `--parallel 2` = 2 concurrent 32k requests via llama-batched-bench) | `bench/model-bench/compare_builds.py run --new <ver> [--parallel 2]` | `docs/analysis/<stamp>-llamacpp-<ver>-build-check.md` + `VERDICT` line |

If one of these is missing a capability, **extend the tool** (and say so) rather than writing a
one-off replacement. New reusable capability → propose a skill/tool change, don't fork logic.

