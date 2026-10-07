# bench/runs — benchmark index

Concise register of every dated run dir in this folder (124 dirs, newest first).
Built 2026-09-16 from each dir's `meta.txt` / `arms.json` — the dir name is the source of truth
for date, track, and knobs-in-slug; the bullets add model/backend details from the meta.

- Dir conventions (`meta.txt`, `results.jsonl`, `*.err` gitignored): [README.md](README.md)
- Reports & conclusions live elsewhere: [docs/INDEX.md](../../docs/INDEX.md) (reports register),
  `campaigns/*/analysis.md` (co-located write-ups). Links below point at the matching report;
  "**no report**" means the raw data exists but the `/benchmark-results` write-up hasn't landed.
- `ABORTED-*` = quarantined, interrupted run — **not a result** (iron rule 18); never cite it.

Note: no tool generates this file yet — `docs/reindex.py` only scans `docs/{analysis,research}/`
+ `campaigns/analysis.md`. Suggested extension: a `--runs` mode over `meta.txt`/`arms.json`.

## 2026-09-15

### 2026-09-15 — Muse-Glimmer-30B: vulkan vs rocm depth curve
`Muse-Glimmer-30B-UD-Q5_K_L` + `dflash-kquant` drafter, served via llama-swap :9292, matched
stew675 builds, `ub2048 b4096 faon ctx131072 kv=f16 np1 spec=draft-dflash n_max15 p_min0.4
temp1.0 top_p0.95 top_k64`; 4 code-review depths (8192/32768/65536/98304 tok), 512 gen tok,
reps=2, VRAM predicted 29064 MiB. →
[analysis](../../campaigns/2026-09-15-muse-glimmer-vulkan-vs-rocm/analysis.md)
- `2026-09-15-muse-glimmer-vulkan-vs-rocm` — campaign parent: campaign meta + per-backend `server_binary`/start-time lines for all passes
- `2026-09-15-2033…2040-engine-muse-{rocm}-d{8192,32768,65536,98304}` — first-pass ROCm arm, one dir per depth (4 dirs)
- `2026-09-15-2047…2055-engine-muse-{vulkan}-d{8192,32768,65536,98304}` — first-pass Vulkan arm, one dir per depth (4 dirs)
- `2026-09-15-2202…2305-engine-muse-rocm2-d{8192,32768,65536,98304}` — ROCm **re-run arm** (rocm2), one dir per depth; `2208` = d32768 redo, `2301`/`2305` = d65536/d98304 second re-runs (7 dirs)

### 2026-09-15 — stew675 vs stock llama.cpp build check
`Qwen3.8-27B-UD-Q4_K_XL`, request-shape matrix pp128/tg64 … pp32768/tg2048, ub2048 — stock
b10909 (a2878d3) ROCm vs stew675 patch builds (vulkan 67492c9, rocm b862fc3). →
[stew675-buildcmp analysis](../../campaigns/2026-09-15-stew675-buildcmp/analysis.md)
- `2026-09-15-1029-buildcmp-stew675` — compare_builds orchestrator dir (arms + verdict)
- `2026-09-15-1025|1029|1035|1040|1046-model-buildcmp-{stock,stew675}-{rocm,vulkan}` — per-arm `llama-bench` outputs: stock-rocm ×3 (1035 has build_commit), stew675-vulkan ×2, stew675-rocm ×2 (8 dirs)

## 2026-09-14

### 2026-09-14 — llama.cpp b10969 build check
`Qwen3.8-27B-UD-Q4_K_XL`, b10969 (391fac1, Mesa 1.4.357.1) vs b10909, request shapes to
pp32768/tg2048, Vulkan. → [b10969 build check](../../docs/analysis/2026-09-14-2345-llamacpp-b10969-build-check.md)
- `2026-09-14-2345-buildcmp-b10969` — compare_builds orchestrator dir (arms + verdict)
- `2026-09-14-2345-model-buildcmp-b10909-vulkan` — baseline arm (a2878d3)
- `2026-09-14-2350-model-buildcmp-b10969-vulkan-1.4.357.1` — new arm (391fac1)

## 2026-09-12

### 2026-09-12 — vLLM/radiance vs llama.cpp: depth curves & window budgets
`RedHatAI/Qwen3.8-27B-INT4` (compressed-tensors W4A16) in `stilldeadcode/vllm-radiance:0.9.3`
(vLLM 0.27.1, R4D attention, MTP speculative) vs llama.cpp 200k row; R9700 gfx1201, ROCm host. →
[radiance evaluation](../../docs/analysis/2026-09-12-1055-vllm-radiance-r9700-evaluation.md) +
[window budgets & ROCm knobs](../../docs/analysis/2026-09-12-1535-vllm-window-budgets-and-rocm-knobs.md)
- `2026-09-12-1330-depth-curve-mtp` — 4-depth curve, subdirs per arm: `llamacpp-mtp`, `radiance-r4d-mtp8` (+ `quarantine/`)
- `2026-09-12-1345-vllm-via-llama-swap` — vLLM boot-through-llama-swap smoke (load-time + swap test)
- `2026-09-12-1844-vllm-window-bootmatrix` — window boot matrix, boot-log only; aborted at KV-pool line before graph capture (reruns 19:23–19:38)
- `2026-09-12-1943-vllm-bigwindow-depthcurve` — big-window depth curve: llama.cpp 200k row vs vLLM 114688 row (done 20:22)

## 2026-09-11

### 2026-09-11 — llama.cpp b10909 build check (×2) + 2×32k batched
`Qwen3.8-27B-UD-Q4_K_XL` / KV q8_0, b10909 (a2878d3) vs b10655-4 (6fdd0ac, Vulkan) and b10375
(ba360efe1, ROCm). 1537 = depth-based matrix (0/4k/8k/16k/30k, pp2048/tg128, reps=3);
1716 = request shapes pp128/tg64 … pp32768/tg2048. →
[1537 build check](../../docs/analysis/2026-09-11-1537-llamacpp-b10909-build-check.md),
[1716 build check](../../docs/analysis/2026-09-11-1716-llamacpp-b10909-build-check.md)
- `2026-09-11-1537-buildcmp-b10909` / `2026-09-11-1716-buildcmp-b10909` — compare_builds orchestrator dirs (arms.json + per-arm logs)
- 1537 arms (4 dirs): `2026-09-11-1537-model-buildcmp-b10655-4-g6fdd0ac-vulkan`, `…-1540-…-b10909-vulkan`, `…-1544-…-b10375-rocm`, `…-1547-…-b10909-rocm`
- 1716 arms (4 dirs): `2026-09-11-1716-model-buildcmp-b10655-4-g6fdd0ac-vulkan`, `…-1720-…-b10909-vulkan`, `…-1724-…-b10375-rocm`, `…-1729-…-b10909-rocm`
- `2026-09-11-1756-batched-2x32k` — 2 concurrent 32k requests via llama-batched-bench, all 4 builds (no separate report; part of 1716 check)

### 2026-09-11 — Forum tuning ideas on Qwen3.8-27B (llama-benchy + served probes)
`Qwen3.8-27B-UD-Q4_K_XL` Vulkan b10909: MTP n-max 5, ngram mod, adaptive MTP (PR #27210), q8_0 KV,
presence-repeat samplers, `rm_kq` builds (rmkq1/2 = a2878d3 vs 53698bc). →
[benchy-ideas-27b](../../docs/analysis/2026-09-11-1950-benchy-ideas-27b.md)
- `2026-09-11-1950-benchy-ideas-27b` — parent: benchy `.cmdline/.done/.json` pairs per idea
- `2026-09-11-{1951,1956,1959,2003,2006,2010,2013}-engine-benchy-{base-mtp3,mtp-nmax5,mtp-ngram,kvq8-mtp3,pr-mtp3,pr-adaptive12,base-mtp3-repeat}` — served probes, benchy-synthetic workload, 512 gen tok, reps=1 (7 dirs)
- `2026-09-11-{2016,2017,2017,2018}-model-rmkq{1,2,3,4}-b10909-{,rmkq1-}vulkan` — llama-bench arms for the two rm_kq builds (4 dirs)

### 2026-09-11 — vLLM stock 0.29.0 + INT4 checkpoint
`RedHatAI/Qwen3.8-27B-INT4` @ bf08f3db on stock vLLM 0.29.0 (not radiance). →
[vllm-qwen38-27b-int4](../../docs/analysis/2026-09-11-2047-vllm-qwen38-27b-int4.md)
- `2026-09-11-2047-vllm-qwen38-27b-int4` — backend/attention sweep runs + profiling

## 2026-07-31

### 2026-07-31 — 27B Q4 MTP q8_0 KV depth ladder (JackRong + unsloth)
Qwen3.6-27B Q4 MTP builds, q8_0 KV, code-review prompts at 12k/64k/128k (200k attempted),
256 gen tok; unsloth = second fine-tune arm. → **no report**
- `2026-07-31-{1727,1730,1921}-engine-27b-q4-mtp-q8-cr{64000,128000,128000-rep2}` — JackRong arm (reps=1; rep2 = repeat of cr128000)
- `2026-07-31-{1955,1956,2000}-engine-unsloth-27b-q4-mtp-q8-cr{12000,64000,128000}` — unsloth arm (reps=2)
- `ABORTED-2026-07-31-1737-engine-27b-q4-mtp-q8-cr200000` — ⚠ quarantined: interrupted cr200000 attempt, not a result

## 2026-07-16

### 2026-07-16 — MTP sampler tax + spec-draft p-min probes
- `2026-07-16-0927-mtp-sampler-probe` — 27B-MTP + 35B-A3B penalty-sampler probes (pp/presence variants); → [mtp-sampler-tax](../../docs/analysis/2026-07-16-0927-mtp-sampler-tax.md)
- `2026-07-16-1111-spec-draft-pmin-mtp` — `--spec-draft-p-min` × MTP sweep (27B, seeds s42–s47, per-config `gpu_*.csv`); cited by [27b-quality-tuning](../../campaigns/2026-07-13-27b-quality-tuning/analysis.md)

## 2026-07-13

### 2026-07-13 — Prefill/decode depth + KV/MTP/backend matrix (27B)
Qwen3.6-27B, code-review 8k/32k/64k + thinking-hard, 256–512 gen tok, reps=3; arms vary cold
(`pf`) vs warm/shared-prefix (`warm`), KV f16 vs q8, MTP on/off, and Vulkan vs HIP (`hip`). →
[27b-serving-substrate](../../campaigns/2026-07-12-27b-serving-substrate/analysis.md)
- `2026-07-13-0734|0735|0738-engine-pf-cr{8000,32000,64000}` — cold prefill ladder, f16 KV
- `2026-07-13-0745-engine-warm-cr32000` / `2026-07-13-0833-engine-warm-cr32000` — shared-prefix (cache-reuse) probes, reps=4
- `2026-07-13-0746|0759-engine-dec-think{,-q8}` — decode on thinking workload, f16 / q8_0
- `2026-07-13-0747|0751-engine-pf-cr{32000,64000}-q8` — cold prefill, q8_0 KV
- `2026-07-13-0800|0804-engine-{pf-cr32000,dec-think}-mtp1` — MTP-on arms
- `2026-07-13-0830-engine-pf-cr32000` — re-run of 0735 (f16, Vulkan)
- `2026-07-13-0836-engine-hip-pf-cr32000` / `2026-07-13-0910-engine-hip-dec-think` — ROCm/HIP arms (prefill + decode)

## 2026-07-12

### 2026-07-12 — Max-context ladder (f16 vs q8_0 KV)
Qwen3.6-27B-Q4_K_S, 40k-token code-review prompt, ctx window swept c48k→c64k (f16) and
c96k→c120k (q8_0); 256 gen tok, reps=2. 0007–0008 batch = first attempt, 0009–0028 = re-run. →
[27b-maxctx-f16](../../campaigns/2026-07-12-27b-maxctx-f16/analysis.md) (⚠ corrected: hybrid arch, real ceiling ~240k f16)
- `2026-07-12-0007-engine-maxctx-{f16-c48k,f16-c56k,f16-c60k,f16-c64k,q8-c96k,q8-c104k}` — pass 1 (6 dirs)
- `2026-07-12-0008-engine-maxctx-q8-{c112k,c120k}` — pass 1 (2 dirs)
- `2026-07-12-0009|0012|0015|0018-engine-maxctx-f16-c{48k,56k,60k,64k}` — pass 2 f16 (4 dirs)
- `2026-07-12-0021|0024|0028-engine-maxctx-q8-c{96k,96k,120k}` — pass 2 q8_0 (3 dirs, 0024 = c96k redo)
- `2026-07-12-27b-maxctx-f16` — llama-bench side of the maxctx run (`ub2048 b4096 faon`)
- `2026-07-12-27b-serving-substrate` / `2026-07-12-27b-serving-substrate-cachereuse` — served substrate probes, `Qwen3.6-27B-MTP-Q4_K_M`, budget 32400 MiB → same [report](../../campaigns/2026-07-12-27b-serving-substrate/analysis.md)

## 2026-07-11

### 2026-07-11 — Deep-context 35B engine matrix (MTP × KV × depth × parallel)
Qwen3.6-35B-A3B-UD-Q4_K_M, code-review 8k/128k/200k + thinking + agentic-32k, 256/1024 gen tok,
reps=2; arms vary MTP off/on/q8-KV (`mtp0/mtp1/mtp1q8`) and concurrency (np2/np4). →
[deep-context-35b](../../docs/analysis/2026-07-11-2200-deep-context-35b.md)
- `2026-07-11-2200-deep-context` / `2026-07-11-deep-context` — campaign parents (`report.html` + `results.jsonl`, no meta.txt)
- `2026-07-11-2200|2204|2212-engine-deep-mtp0-{cr8000,cr128000,cr200000,think}` — MTP-off arms (4 dirs)
- `2026-07-11-2213|2218|2226-engine-deep-mtp1-{cr8000,cr128000,cr200000,think}` — MTP-on arms (4 dirs)
- `2026-07-11-2306|2310-engine-deep-mtp1q8-cr200000` — MTP-on + q8_0 KV @200k (2 dirs)
- `2026-07-11-2328|2329-engine-deep-par-{np2,np4}` — parallel prefill at 32k, conc=2/4

### 2026-07-11 — 35B adaptive sweeps + serving combo (Vulkan vs ROCm)
Qwen3.6-35B-A3B-UD-Q4_K_M, `sweep.py` ub/b/fa/KV grid per backend (1833/1837 = first pass,
2228/2229/2236 = re-runs), plus the backend×MTP×KV×depth×conc combo matrix. →
[sweep-35b-rocm-vs-vulkan](../../docs/analysis/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md),
[campaign-combo35b](../../docs/analysis/2026-07-11-1844-campaign-combo35b.md)
- `2026-07-11-{1833,2228,2229}-sweep-35b-rocm` / `2026-07-11-{1837,2236}-sweep-35b-vulkan` — sweep.py runs (5 dirs)
- `2026-07-11-{1844,2244}-campaign-combo35b` — combo matrix, pass 1 + re-run

### 2026-07-11 — Harness smoke runs
Early validation of the two tracks (not published). → **no report**
- `2026-07-11-1734-model-smoke-v2` — model-bench smoke, 27B-Q4_K_S, ROCm, build b049326a
- `2026-07-11-1738-sweep-27b-micro` — micro sweep, 27B-Q4_K_S
- `2026-07-11-1802-campaign-mini-smoke` — mini campaign scaffold check, 35B-A3B
- `2026-07-11-1806-engine-runsh-smoke` — engine-bench run.sh smoke
