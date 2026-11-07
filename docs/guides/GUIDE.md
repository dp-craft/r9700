# Benchmark harness guide — how to run everything (offline, solo)

> This is the generic operator guide. Every measurement belongs to a campaign,
> `campaigns/<type>/<YYYY-MM-DD-HHMM>-<slug>/` (type = perf | build-check | quality | agentic | workers |
> investigation): the recipe at its root, fixtures in `inputs/`, committed rows and charts in `results/`, raw
> data in `tmp/` (git-ignored). Its write-up goes to `docs/findings/<topic>/` and names the campaign in its
> `<!-- meta -->` block. Scaffold a new one with the `/benchmark-new-campaign` skill.

Step-by-step for both tracks. Legend: ✅ = verified working in this repo (2026-07-11 session) ·
⚠️ = confirm on your machine first.

## 0. Prerequisites (once per shell)
```bash
cd "$(git rev-parse --show-toplevel)"; ROOT=$PWD      # the repo clone
C=campaigns/perf/2026-11-07-1200-my-check             # one campaign dir per experiment (examples below use $C)
```
- Vendor env (HSA override on AMD) is handled by the scripts via `stack/gpu/gpu_env.sh` — you no
  longer export it by hand. On **NVIDIA / other GPUs** everything works the same: point
  `LLAMA_BENCH` / `LLAMA_SERVER` at a CUDA (or other) build; `gpu_env.sh` records the GPU via
  `nvidia-smi`, and engine-bench is pure HTTP anyway. ✅ (AMD path verified; NVIDIA path ⚠️ untested)
- Models in `/home/dev/models/gguf/` (27B Q4_K_S, 35B-A3B-UD Q4_K_M with embedded MTP layer). ✅
- llama.cpp builds: `stack/llamacpp/var/builds/b9949-rocm/bin/` (ROCm) + `stack/llamacpp/var/builds/b9950-vulkan/bin/` (RADV), build b9950. ✅
- GPU check: `rocm-smi --showproductname` → "AMD Radeon AI PRO R9700". ✅

---

## 1. model-bench — find the tuning optimum (no server needed)

**Adaptive optimum search** (recommended — expands the grid until the peak is bracketed,
then runs the KV f16-vs-q8_0 acceptance test at depth): ✅
```bash
bench/perf/model-bench/sweep.py --campaign-dir $C \
    --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf --slug 35b-rocm
bench/perf/model-bench/sweep.py --campaign-dir $C \
    --model /home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
    --llama-bench stack/llamacpp/var/builds/latest-vulkan/bin/llama-bench --slug 35b-vulkan
```
→ `$C/results/<stamp>-sweep-<slug>/sweep-summary.json` (curves, KV verdict ACCEPT/KEEP,
recommended server command) + `sweep-log.jsonl`; raw llama-bench output per invocation in
`$C/tmp/<stamp>-sweep-<slug>/invocations/`. ~30–60 min per backend on the 35B.

**Manual single run** (quick checks): ✅
```bash
CAMPAIGN_DIR=$C MODEL=/home/dev/models/gguf/Qwen3.6-27B-Q4_K_S.gguf SLUG=27b-check UB=1024,2048 \
  bench/perf/model-bench/run.sh      # → $C/results/<stamp>-model-27b-check/, raw in $C/tmp/
```
Knobs: `bench/perf/model-bench/README.md`. KV **default is f16** (baseline); q8_0 only via the
sweep's ≤5% acceptance rule.

---

## 2. Build the workload prompts ✅
```bash
cd bench/workloads && mkdir -p tmp      # git-ignored; campaign run.sh files build missing fixtures here too
for T in 8000 32000 64000 100000; do
  python3 build_prompt.py --task tasks/codereview-large.task.md \
    --src corpus/ts-agentic-code-runner --src corpus/py-rich \
    --target-tokens $T --out tmp/codereview-${T}.txt
done
python3 build_prompt.py --task tasks/thinking-hard.prompt.txt --target-tokens 0 \
    --out tmp/thinking-hard.txt
python3 build_prompt.py --task tasks/agentic-implement.task.md \
    --src corpus/ts-agentic-code-runner --target-tokens 8000 --variants 4 \
    --out tmp/agentic-8000.txt
```
The corpus (`bench/workloads/corpus/`, tracked, ~565K tokens TS+Python) is big enough for 100K;
the builder **fails loudly** if a target can't be filled. Real token counts run within ±3% of
nominal (calibrated 3.6 chars/token — see `bench/workloads/README.md`).

---

## 3. engine servers

**Use the launcher** — it records the exact cmdline + `/props`, waits for health: ✅
```bash
stack/gpu/gpu_exclusive.sh 28000       # free the card first (unloads llama-swap, kills stray engines; iron rule 14)
# llama.cpp Vulkan, MTP on, q8_0 KV, 64K ctx, 1 slot, on :8081
MODEL=/home/dev/models/gguf/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  BACKEND=vulkan MTP=1 KV=q8_0 CTX=65536 NP=1 PORT=8081 stack/serve/llamacpp/serve_llamacpp.sh start
PORT=8081 stack/serve/llamacpp/serve_llamacpp.sh status   # / stop (by pidfile stack/serve/var/servers/8081.pid)
```
Key facts: **MTP** = `--spec-type draft-mtp` (draft layer is embedded in the 35B GGUF —
`nextn_predict_layers=1`); **parallel slots** `-np N` split the context: per-slot ctx = `CTX/NP`
(budget real prompt tokens + max_tokens per slot). ✅ verified: Vulkan+MTP+q8_0 server, MTP
+24% decode measured on chat.

**ollama** (port 11434): ⚠️
```bash
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve   # then, once:
ollama create q35:local -f stack/serve/ollama/Modelfile_q35
```
**vLLM** (port 8000, Docker): ⚠️ 27B failed to load in prior tests; 35B AWQ only
```bash
docker run --rm -it --device /dev/kfd --device /dev/dri -p 8000:8000 \
  -v /home/dev/models:/models \
  rocm/vllm:rocm7.13.0_gfx120X-all_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1 \
  vllm serve /models/Qwen3.6-35B-A3B-AWQ-4bit --port 8000
```

**vLLM via a campaign spec** (`engine: "vllm"`, `stack/serve/vllm/serve_vllm.sh`): optional
`"image"` pins the docker image (default = the profile's; run-time `IMAGE=` beats both) and `"env"`
(top-level and per-server, server wins; e.g. `{"CACTUS_DELTA": "0"}`) is passed to `serve_vllm.sh`.
`run.sh` saves `serve_vllm.sh print` (resolved image + digest, env, argv) to `results/server-<name>.txt` and
records image/env in `results/meta.txt`. Not valid on llamacpp.

**Observe a running server** (any engine with a log; vLLM also gets `/metrics` + rocm-smi): ✅
```bash
python3 stack/gpu/monitor.py --port 8000        # live table: per-request tokens/TTFT/TPS + 5-min avg + session + GPU + log (Ctrl-C quits)
python3 stack/gpu/monitor.py --port 8000 --once # single snapshot
```
Read-only — no requests, no kill. `--out FILE` records one JSONL row per poll;
`--help` lists usage + what each block shows. The "observe" half of the
bench 3-task model (probe = `bench/core/capture_engine.py` / monitor / report).

---

## 4. engine-bench — measure

**Combination campaign** (the full picture: backend × MTP × KV × depth × concurrency on the
35B; servers restarted per config; resumable): ✅ (plumbing verified; full run pending)
```bash
CAMPAIGN_DIR=campaigns/perf/2026-11-07-1200-combo35b bench/perf/engine-bench/campaign.sh
# interrupted? → the same command again (tmp/done/ markers skip finished configs)
```
Runtime ≈ 1.5–2.5 h (16 server configs × model load + measurements). Output: `results/results.jsonl`
(per-request + aggregate rows), `results/meta.txt`, `results/failures.txt`; per-config server cmdline,
props and start logs in `tmp/servers/`.

**Single comparison run** against servers you started yourself (rows → `$C/results/results.jsonl`, once,
only if every probe succeeded; raw per run in `$C/tmp/<stamp>-engine-<slug>/`): ✅
```bash
W=$ROOT/bench/workloads/tmp; EB=bench/perf/engine-bench/run.sh
CAMPAIGN_DIR=$C PROMPT_FILE=$W/codereview-64000.txt SLUG=cr64k MAX_TOKENS=256 PREFIX_MODE=unique $EB
# thinking-mode (chat template REQUIRED — raw completions can EOS instantly):
CAMPAIGN_DIR=$C PROMPT_FILE=$W/thinking-hard.txt SLUG=think MAX_TOKENS=1024 API=chat $EB
# agentic concurrency wave (4 streams, per-stream variant files, cold cache):
CAMPAIGN_DIR=$C PROMPT_FILE="$W/agentic-8000-v1.txt $W/agentic-8000-v2.txt $W/agentic-8000-v3.txt $W/agentic-8000-v4.txt" \
  SLUG=agentic4 CONCURRENCY=4 REPS=3 PREFIX_MODE=unique MAX_TOKENS=256 $EB
```
**llama-benchy** (standardized synthetic curves, installed at `stack/serve/var/venvs/benchy-venv`): ✅ install
```bash
CAMPAIGN_DIR=$C USE_BENCHY=1 BENCHY_ARGS="--pp 2048 8192 --tg 128 --concurrency 1 4 --runs 3" SLUG=benchy $EB
```

---

## 5. Visualize a run (charts, no install) ✅
`bench/core/report.py` renders a campaign dir into **theme-aware SVG charts** (`results/charts/*.svg`)
plus a `results/appendix.md` that embeds them, and `results/gpu_peaks.json` (MEASURED peak VRAM/GTT per
sample CSV under `tmp/`) — so the charts live INSIDE the Markdown write-up (stdlib
Python only, works offline, light/dark aware). It auto-detects the run kind:
```bash
# throughput (results.jsonl) → depth curves, concurrency scaling, TTFT p95, thinking, memory:
bench/core/report.py campaigns/perf/<stamp>-combo35b             # → results/charts/ + results/appendix.md
# quality (outputs.jsonl) → quality-vs-cost, accuracy, judge, token economy, latency, per-task heatmap
bench/core/report.py campaigns/quality/<stamp>-<slug>             # gen_campaign quality kind (tmp/outputs.jsonl)
# sweep (sweep-summary.json) → -ub/-b tuning curves + VRAM + KV verdict
bench/core/report.py campaigns/perf/<stamp>-<slug>                # a campaign holding a sweep
bench/core/report.py <dir> --charts DIR --appendix FILE          # custom output paths
```
Failures (`failures.txt`, `n_err>0`) and errored requests are surfaced in a note, never averaged
in; every chart set ships a color-independent data table. Everything under `results/` is **committed**
(embed `results/appendix.md` into the write-up); the raw data in `tmp/` is git-ignored.

## 6. Turn a run into a report
Use the `/benchmark-results` skill: reads the campaign's `results/`, computes deltas, writes
`docs/findings/<topic>/<stamp>-<slug>.md` (summary + table first, **memory column mandatory**) with
`campaign: campaigns/<type>/<stamp>-<slug>` in its `<!-- meta -->` block, and registers it in
`docs/INDEX.md` via `docs/reindex.py`.
The doc must include (spec + canonical glossary rows live in the skill's output contract):
- a **Legend** right after the Summary — every knob/label the run used (`-ub`, `-b`, `-fa`,
  KV f16/q8_0, MTP, crN depth, agentic-cN, TTFT/ttfa, …): definition, effect on this hardware,
  how it was tested;
- a **Consequences & root causes** section — relations/interactions, causal explanations, and
  practical consequences, each tagged MEASURED / INFERRED / CLAIMED; root causes that can't be
  established from our data get validated via the `/research` skill, unresolved ones marked OPEN.

---

## 7. Agentic campaigns (real `claude -p` sessions, A/B of vllm configs) ✅
Scaffold with `/benchmark-new-campaign` (`kind: "agentic"`; `bench/core/gen_campaign.py example --agentic`):
```bash
python3 bench/core/gen_campaign.py emit --spec campaigns/agentic/<stamp>-<slug>/spec.json   # validates, resolves base sha, hashes installs
bash campaigns/agentic/<stamp>-<slug>/run.sh                                           # run; the SAME command resumes
```
Each (rep, arm) boots a fresh vllm server + fresh git worktree at the base commit, runs `claude -p`
(resumed with `resume_prompt` until `done_when` / cap), tears down, collects. Reps outer, arms inner.
Rerun: finished arms are skipped via `tmp/done/` markers.

**Knobs:** `ONLY='armglob,..'` (subset) · `REPS=N` · `CAP_S=sec` (wall cap per session) ·
`MAX_RESUMES=N` · `CAMPAIGN_DIR=dir` (default: the dir holding run.sh) · `IMAGE=ref` (beats per-arm image).

**Statuses** (`results/summary.tsv`):
| status | meaning | on rerun |
|--------|---------|----------|
| `done`, `cap`, `max_resumes` | result (cap/max_resumes = model did not finish; still measured) | skipped (done marker) |
| `interrupted`, `claude_error` | started marker, no done marker; quarantined (iron rule 18) | reported and skipped, never deleted |
| `wt_exists` `gpu_busy` `server_fail` `served_name_mismatch` `wt_fail` `prep_fail` `proxy_fail` | infra failure, in `results/failures.txt`, no marker | retried |

**Re-collect / retry an interrupted arm:** re-collect by hand with the commands `run.sh` prints (worktree
status/diff, the spec's `collect` paths, the `~/.claude/projects/` transcript). To retry from scratch:
remove its `tmp/started/rep<R>.<arm>` marker, move `tmp/rep<R>/<arm>/` aside, `git worktree remove --force` its
worktree, then rerun. Move the old data aside, never into the results.

**`tmp/rep<R>/<arm>/`** (raw): `server.txt` (resolved image/env/argv) · `calls.tsv` + `session-N.jsonl` (per claude
call) · `gpu_samples.csv` (VRAM/GTT/power) · `wt.diff` · `outputs/` (collected paths) · `tmp/` (`tmp_dirs`) ·
`claude-project/` (transcript copy) · `main-*.txt` (main checkout untouched check) · `installs.sha256`.
Campaign level: `results/summary.tsv`, `results/failures.txt`, `results/spec.resolved.json`; raw `tmp/driver.log`,
`tmp/agentic_helper.py`.

**Optional request capture:** `"capture_requests": true` puts `capture_proxy.py` on the client port and the
server on port+1; request bodies land in `<arm_dir>/requests/*.gz`.

**Testing the scaffolder** (no GPU, ~45 s): `python3 -m pytest -q bench/core/test_gen_campaign.py`.

---

## Measurement rules (the short list)
- **Cold vs warm prefill**: identical prompts hit the server prefix cache from the 2nd request —
  use `PREFIX_MODE=unique` unless you're *studying* the cache (then `shared`). (Measured: 2.4×
  inflated prefill on rep 2 without it.)
- **One variable per comparison**; note `plateau_within_noise` (±3% run variance) instead of
  declaring winners inside the noise band.
- **KV q8_0 rule**: accepted only if prefill AND decode lose ≤5% at the target depth (sweep.py
  automates this); the payoff (halved KV = bigger ctx / more slots) is quantified from the
  per-invocation VRAM samples.
- Every campaign must have `results/meta.txt` (+ server cmdline/props for engine-bench) — an
  unversioned number is noise.
