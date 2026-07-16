# Recommendation — top configs for an agentic dev system (100k ctx) — R9700 (gfx1201)

> **Purpose.** Actionable "which config do I run, and how do I call it?" guidance for an agentic
> coding/tool-use system on the R9700, at **~100k context**, covering the 27B at two quant tiers
> (Q4_K_M + Q5/Q6) and the 35B-A3B. Each config is given as **(A) a full server launch** and
> **(B) the per-request call parameters** — the two are set in different places and must not be confused.
>
> **Data provenance — read first.** This companion sits next to [`analysis.md`](analysis.md) /
> [`analysis_detailed.md`](analysis_detailed.md), but **those docs are 27B-only, Q4_K_M-only, 64k/128k** —
> no Q5/Q6, no 35B. Every quant-ladder and 35B number below is `MEASURED` from the sibling campaign
> **[`campaigns/2026-07-14-hardest-tasks-27b-vs-35b/analysis.md`](../2026-07-14-hardest-tasks-27b-vs-35b/analysis.md)**
> (14 cells × 5 hardest tasks × 3 reps, all at ~132.9k tokens). Flags/params are `MEASURED` from that
> campaign's `serve_llamacpp.sh` + `capture.py` invocation and its `out/props_*.json`. `INFERRED` = reasoning.
>
> **VRAM/speed are measured at ctx 163840 / ~133k-token depth.** At **100k** the KV cache is smaller, so
> the VRAM columns are **upper bounds** and speeds **lower bounds** (`CLAUDE.md` rule 13: Q5_K_M f16 @163840
> already fit, so 100k fits with margin).

---

## At a glance

| # | Config | Quant / KV | Reasoning budget | TS % (95% CI) | Fluctuation (rep sd) | Decode | Full answer | Peak VRAM @133k | Role |
|---|--------|-----------|-----------------:|---------------|---------------------:|-------:|------------:|----------------:|------|
| **1** | **27B Q4_K_M** | Q4_K_M / **f16** | **4096** | 78.3 [71.7, 85.0] | **4.9** | 46.1 t/s | 156.9 s | 29809 | Steady default — best floor, most headroom |
| **2** | **27B Q6_K** | Q6_K / q8_0 | 4096 | **80.9** [74.7, 87.1] | 6.5 | 32.6 t/s | 212.6 s | 30214 | Higher-quant / fidelity insurance (see caveat) |
| **3** | **35B-A3B** (MoE) | Q4_K_M / f16 | **16384** | 77.5 [67.7, 87.3] | 11.1 | **120.1 t/s** | **96.2 s** | 27196 | Balanced/fast for the agentic loop |

Reference ladder (**not** depth-matched, ~213× shallower — not a like-for-like capability gap):
haiku 81 · sonnet 91 · opus 94.

**Server-vs-call at a glance** — everything structural is a server flag; everything about *how you sample a
reply* is a call parameter:

| Set once at server launch | Set per request (call parameter) |
|---|---|
| model, `-c` ctx, `-ngl`, `-fa`, `-ub`, `-b`, `-np` | `temperature`, `top_p`, `top_k`, `min_p` |
| `-ctk`/`-ctv` (KV type), `--spec-type draft-mtp` (MTP) | `presence_penalty`, `frequency_penalty`, `repeat_penalty` |
| **`--reasoning-budget`** (thinking cap) | `max_tokens` (= budget + 8192), `seed`, `stream` |

---

## The caveat that reframes slot #2

**The 27B quant ladder is a statistical null.** No paired-by-task Δ vs Q4_K_M is significant
(largest |t| = 1.98 < 2.776; the design only resolves ≳12 pts). Q6_K's "80.9 vs 78.3" is **within noise**
and costs **+36% wall time / −29% decode**. The KV confound is bounded too (Q5_K_M **f16 74.3 vs q8_0 76.5**
— the ≤5% rule holds). So (INFERRED): **choose a higher quant for VRAM/fidelity insurance, not measured
quality.** A steadier + faster swap for slot #2 is **Q5_K_M f16 @ budget 16384** (TS 77.5, **rep sd 4.8 —
the steadiest cell in the campaign**, 43.1 t/s). Q6_K's one genuine edge: it is the **only cell that
hard-passes** (7% one-shot → 20% best-of-3).

---

# Config 1 — 27B Q4_K_M · steady default (best floor)

### A. Server — all flags

```bash
# Via the repo launcher (preferred — records cmdline + /props, guards the port):
MODEL=$MODELS_DIR/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan MTP=1 \
  CTX=102400 NP=1 UB=2048 B=4096 FA=on KV=f16 NGL=99 PORT=8081 WAIT=600 \
  EXTRA_ARGS="--reasoning-budget 4096" \
  bash bench/engine-bench/serve_llamacpp.sh start

# The exact llama-server command it runs (every flag spelled out):
llama-server \
  -m $MODELS_DIR/Qwen3.6-27B-MTP-Q4_K_M.gguf \
  -c 102400 -np 1 -ngl 99 -fa on \
  -ub 2048 -b 4096 \
  -ctk f16 -ctv f16 \
  --spec-type draft-mtp \
  --reasoning-budget 4096 \
  --host 127.0.0.1 --port 8081
```

### B. Call parameters (per request → `/v1/chat/completions`)

```json
{
  "messages": [ /* system + user + tool turns */ ],
  "temperature": 0.6,
  "top_p": 0.95,
  "top_k": 20,
  "min_p": 0,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "repeat_penalty": 1.0,
  "max_tokens": 12288,
  "stream": true
}
```
`max_tokens = reasoning_budget(4096) + 8192` answer headroom. **Do not fix `seed`** for an agentic best-of-N
loop (the campaign pinned `seed 42` only for reproducibility — a fixed seed makes reruns identical, killing
best-of-N diversity).

**When to use:** the workhorse. Best worst-of-3 **floor (57)**, steadiest fast cell, most VRAM headroom.
Prefer it when you ship **one-shot** and the floor matters.

---

# Config 2 — 27B Q6_K · higher-quant / fidelity insurance

### A. Server — all flags

```bash
MODEL=$MODELS_DIR/Qwen3.6-27B-Q6_K.gguf BACKEND=vulkan MTP=1 \
  CTX=102400 NP=1 UB=2048 B=4096 FA=on KV=q8_0 NGL=99 PORT=8081 WAIT=600 \
  EXTRA_ARGS="--reasoning-budget 4096" \
  bash bench/engine-bench/serve_llamacpp.sh start

llama-server \
  -m $MODELS_DIR/Qwen3.6-27B-Q6_K.gguf \
  -c 102400 -np 1 -ngl 99 -fa on \
  -ub 2048 -b 4096 \
  -ctk q8_0 -ctv q8_0 \
  --spec-type draft-mtp \
  --reasoning-budget 4096 \
  --host 127.0.0.1 --port 8081
```

**Steadier + faster swap (recommended alternative):** `Qwen3.6-27B-Q5_K_M.gguf`, **`KV=f16`**, and
`EXTRA_ARGS="--reasoning-budget 16384"` (→ `-ctk f16 -ctv f16 --reasoning-budget 16384`). At 100k, Q5_K_M
fits f16 comfortably (measured fit even at 163840: 31918/32624 MiB, 0 failures); it is faster (43.1 vs
32.6 t/s) and the steadiest cell (sd 4.8).

### B. Call parameters

Same sampling block as Config 1. Only `max_tokens` changes with the budget:
- **Q6_K (budget 4096):** `"max_tokens": 12288`
- **Q5_K_M f16 swap (budget 16384):** `"max_tokens": 24576`

**When to use:** only when you specifically want a higher quant on hand. You pay ~30% decode for a quality
gain the data **cannot confirm**. Q6_K if you want the single highest mean + the only hard-passes; the
Q5_K_M f16 swap if you want steadiness + speed instead.

**q8_0 KV note (Q6_K path):** q8_0 is fine on average (≤5% rule) but **not per-task uniform** — from the
corrected deep-dive it tanks `lru-cache` and can destabilise `expr-eval` at depth (think-tag leaks /
truncation). At 100k, prefer the f16 (Q5_K_M) route where VRAM allows.

---

# Config 3 — 35B-A3B · balanced/fast for the agentic loop

### A. Server — all flags

```bash
MODEL=$MODELS_DIR/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf BACKEND=vulkan MTP=1 \
  CTX=102400 NP=1 UB=2048 B=4096 FA=on KV=f16 NGL=99 PORT=8081 WAIT=600 \
  EXTRA_ARGS="--reasoning-budget 16384" \
  bash bench/engine-bench/serve_llamacpp.sh start

llama-server \
  -m $MODELS_DIR/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  -c 102400 -np 1 -ngl 99 -fa on \
  -ub 2048 -b 4096 \
  -ctk f16 -ctv f16 \
  --spec-type draft-mtp \
  --reasoning-budget 16384 \
  --host 127.0.0.1 --port 8081
```

### B. Call parameters

```json
{
  "messages": [ /* system + user + tool turns */ ],
  "temperature": 0.6,
  "top_p": 0.95,
  "top_k": 20,
  "min_p": 0,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "repeat_penalty": 1.0,
  "max_tokens": 24576,
  "stream": true
}
```
`max_tokens = 16384 + 8192`. Budget **16384, not unlimited** — uncapped (`-1`) fell to 75.4 with a 7%
runaway (one reply ran to 31k think tokens, 77 → 45). Vary `seed` per rerun for best-of-N.

**When to use:** primary for an **agentic loop**. Quality is statistically tied with the 27B (paired Δ
−5.1, t=−1.70, ns), it is **2.6–3.7× faster** to a full answer, and the loop's natural best-of-N + repair
turns cancel its only weakness (a fluctuating floor of 11 vs the 27B's 57 — but best-of-3 here costs less
wall-time than **one** Q6_K reply). (INFERRED synthesis.)

---

## Shared — why these values (thinking · fluctuation · speed)

**Reasoning budget splits by architecture (the key finding):**
- **Dense 27B saturates at ~4k.** budget 4096 → 16384 buys **+0.3 pts (t=0.37, ns)** for +60 s/reply.
  Keep **4096** (or 16384 on the Q5_K_M f16 swap, which is also within noise).
- **MoE 35B genuinely uses more.** 4096 → 16384 = **−4.3, t=−5.45, SIGNIFICANT** (the MoE benefits).
  So the 35B gets **16384**; the 27B does not need it.

**Fluctuation (rep sd):** the 27B (~4.8–4.9) is ~2× steadier than the 35B (11.1 at its best). Worst-of-3
floor: 27B Q4_K_M **57** vs 35B **11**. But **reruns pay everywhere** (Δ rerun +4.6 … +17.5 pts;
Q6_K hard@1 7% → hard@3 20%), and the 35B's speed makes best-of-N almost free — so an agentic loop that
does best-of-N + a repair turn neutralises the 35B's floor. (INFERRED.)

**Speed:** 35B ≫ 27B (120 vs 33–46 t/s). Among 27B quants, Q4_K_M fastest → Q6_K slowest.

## Shared — sampling recipe & the two call-parameter rules

Use **Qwen's precise-coding recipe, whole**, on all three: `temperature 0.6 · top_p 0.95 · top_k 20 ·
min_p 0 · presence_penalty 0`. Two hard rules baked into the call parameters above:

1. **`min_p` must be sent as `0`** — the server default is `0.05`; Qwen3.6-thinking wants 0. Omitting it
   silently changes sampling.
2. **Never set `presence_penalty` (or frequency/repeat) > 0 for coding** — it switches on the penalties
   sampler, a **fixed ~2 ms/token host tax** costing ~30–40% decode on the fast MoE, *and* the vendor
   preset that carries p>0 scored ~15 pts worse. Keep all penalties at 0 / 1.0.

## Shared — make it agentic (tool usage)

The wall is **cleanliness, not logic**: lint 0.36 · types 0.47 vs **tests 0.84 · edge 0.87 · reuse 0.99**
(MEASURED). Two consequences:
1. **reuse 0.99** — the model reliably finds and uses planted utilities at 100k+ depth (no
   lost-in-the-middle on this eval); good for context/tool grounding.
2. The logic is already right; it only trips strict `tsc`/`eslint`. **Wrap it in a lint/type/test repair
   loop** (`eslint --fix` + `tsc` errors + run tests → feed back one turn). That plus best-of-N closes most
   of the gap to Opus, cheaply on the fast 35B. (INFERRED, corroborated by the rerun deltas.)

## Watch-outs

- ⚠️ **GTT host-RAM spill of 1551–2841 MiB in every cell** at ~133k on this 32 GB no-swap box — freeze-risk
  signal. It eases at 100k, but monitor it; the top quants at f16 sit closest to the ceiling (Q5_K_M f16
  @163840 peaked 31918/32624 = 97.8%, no margin).
- ⚠️ The **reference ladder is not depth-matched** (~213× shallower) — "best local 80.9 vs haiku 81" names
  two different questions, not a capability gap.
- The **substrate is frozen** at Vulkan b9950, `-ub 2048 -b 4096 -fa on`, MTP on — RDNA4 perf swings hard
  across builds, so pin the build if you reproduce these numbers.
