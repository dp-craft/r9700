# WS3 Round 2 — OUR stack: exact method, mode decision, precision

Scope: the local Tier-1 sources (sly 1.10.0, radiance 1.17.0, vLLM v0.32.0 = sly's base) decide what
is implementable; the formula follows sly's own fidelity tools so the campaign number is comparable
to StillDeadCode's model-card KLs. Provenance tags as usual; "local" = read in this session from
`/mnt/Lin1/work/...`.

## 0. Decisions (summary first)

| Choice | Value | Source (Tier-1) |
|---|---|---|
| **Mode** | **Paired greedy continuation (temp 0, top-k=20, shared-prefix pairing)** — the uniform mode both engine families support. Prompt-scoring (`prompt_logprobs`) is **not** available on radiance, so it cannot be the campaign mode; it stays as an optional labeled bonus pass on the sly pair. | radiance `core/server/oai.cpp` (prompt logprobs "never leave the card"); vLLM v0.32.0 `completion/protocol.py` (prompt_logprobs present) |
| KL direction | KL(**ref** ‖ **arm**) — FP8 reference first (forward, mass-covering) | sly `check_fidelity.py`, `kv4/kl_compare.py`; field convention (Round 1) |
| Support | top-20 of the **reference** per position; missing-in-arm token ⇒ arm's min top-20 logprob (floor); + one lumped tail bucket | sly `check_fidelity.py` (floor) + `kv4/kl_compare.py` (tail bucket); K=20 = OpenAI cap (radiance OPS.md; vLLM `max_logprobs` default 20) |
| Pairing | position-by-position on **identical context** (same prompt + same generated prefix); include the first-divergent position, drop the rest of that prompt | INFERRED design over sly's greedy_probe lesson (sly `tests/lessons/A/greedy_probe.py` measures exactly "first diverging token position") |
| Units | nats/token (per-position KL mean over pooled paired positions) | sly `check_fidelity.py` (`kl / n`), `kl_compare.py` ("dNLL (nats/token)") |
| CI | cluster (block = prompt) bootstrap, B=2000, percentile 95 %; pooled 1.96·SD/√n reported alongside as sly-consistency cross-check | synthetic study below (pooled is 1.46× too narrow at ρ≈0.3); sly convention = pooled |
| Tail ε / clamp | ε = 1e-9; per-position KL clamped at 0 | sly `kv4/kl_compare.py` |
| Temperature | 0 (greedy); logprobs are the **raw** distribution regardless of temperature | radiance OPS.md ("raw logits, before any stage has touched them"); vLLM `logprobs_mode="raw_logprobs"` default ("prompt tokens do not go through sampling processors") |
| Vocab | 248,044 base BPE + 276 reserved = 248,320 | MEASURED from local `tokenizer.json` (Qwen--Qwen3.8-27B snapshot); matches radiance kernel tables `n_vocab=248320` |

## 1. What the stack exposes (local Tier-1 findings)

### 1.1 sly 1.10.0 fidelity tools (`/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/sly/`)

**`bench_fidelity.py` (capture).** Per fixed text: `POST /v1/completions` with
`{prompt: text, max_tokens: 1, temperature: 0, prompt_logprobs: top}` (default `--top 20`), plus
`POST /tokenize` for the token ids; asserts `len(ids) == len(prompt_logprobs)`; stores rows
`[token_id, logprob(true token), {top-K logprobs dict}]` for positions 1..n−1 (position 0 has no
context). Per-text print: `n=<tokens> nll=<mean NLL>`. Default texts: 4 python-stdlib `json` modules
+ `textwrap.py` (code, 6000 chars each) + GPL-3 excerpt (prose, 7000 chars). Docstring (CLAIMED,
local): "Deterministic: a repeat on the same server is bit-identical, so paired differences resolve
~0.01 NLL on ~14k tokens — far below GSM8K's ±2.7 pp. Needs no sampling, no spec decode and no graph
capture (prompt_logprobs is prefill only), so run arms with `--enforce-eager`."

**`check_fidelity.py` (compare).** Exact method:
- `dNLL` = mean of `logprob_ref(true token) − logprob_arm(true token)` over paired positions
  (asserts identical token ids per position ⇒ same tokenizer + text), nats/token.
- `ci95 = 1.96 · s/√n` with **tokens as the unit** (pooled, no text clustering).
- `KL(ref‖arm)` = per position, sum over the **reference's** top-K ids `t`:
  `exp(lp_r) · (lp_r − topx.get(t, floor))`, `floor` = the arm's **minimum top-K logprob** ⇒ a token
  missing from the arm's top-K is scored at its worst top-K entry ⇒ **KL is a lower bound** (docstring:
  "a token missing from the arm's top-K gets the arm's smallest top-K logprob, so KL is a lower
  bound"). No tail term here. `kl` reported as `kl/n` (nats/token).
- `top1` = fraction of positions where argmax(ref top-K) == argmax(arm top-K).
- Gate: `--max-dnll X` ⇒ exit 1 if any arm's dNLL > X.

**`kv4/kl_compare.py` (sly's newer variant — the one we adopt).** Same floor-KL **plus the tail
bucket**: `rt = max(1e-9, 1 − Σ_ref-topK p)`, `at = max(1e-9, 1 − Σ exp(arm top-K logprobs))`,
`kl_i = max(0, ΣtopK p_r·(lr − la) + rt·ln(rt/at))`; also per-context-position bins (1–4K … 64–128K),
p99 of per-position KL, dNLL (labeled "nats/token"), per-doc perplexity. Reference = the bf16 arm.

**Conclusions from the local tools:** direction = KL(ref‖arm); support = top-20 + floor + (in
kl_compare) one lumped tail bucket; pairing = position-by-position on identical tokens; temperature
irrelevant (prompt_logprobs is prefill-only; `--enforce-eager` recommended for bit-identity); CI =
pooled 1.96·SD/√n; units = nats/token; calibration input = fixed local texts (code + prose), ~14k
tokens, chosen for presence-on-every-host, not for domain match.

### 1.2 radiance 1.17.0 logprob API (`/mnt/Lin1/work/radiance/src/1.17.0/`)

- `spec.md` §14: serves `/v1/chat/completions` (streaming and not), `/v1/completions`, `/v1/models`,
  "with tool calls in and out and **logprobs**"; vLLM-style `/tokenize`, `/detokenize` (POST),
  `/get_tokenizer_info`, `/reset_prefix_cache`. "A request field this server does not implement is
  ignored when it cannot change the output and **refused by name** when it would."
- `core/server/oai.cpp` (`parse_logprobs`): chat — `logprobs` (bool) + `top_logprobs` (int; absent =
  0, OpenAI's default); completions — `logprobs` as **int = number of alternatives** (OpenAI legacy /
  llama-server `n_probs`; 0 = off). "A count of 0 still returns each token's own logprob on chat
  (OpenAI's meaning) and nothing on completions." "Values are the raw distribution's; the
  distribution after the sampler's stages is not [returned]."
- `docs/OPS.md` (`sample_logprobs` op): "It runs on the **raw logits, before any stage has touched
  them**, and only for a row whose flags carry `RAD_SP_LOGPROBS`". `k` is geometry: "the engine
  declares **21**, OpenAI's limit of **20** plus one so a row is 44 floats, whole 16-byte words"
  (vocab-parallel all_gather). A token's logprob = `l − max − log(Σ exp)`; ties to the lower id;
  id −1 / −∞ padding past the vocab.
- **No prompt logprobs, ever.** `oai.cpp`: "`echo` with logprobs would need the prompt's logprobs,
  which **never leave the card**" ⇒ request refused. `grep -ri prompt_logprobs` over the whole
  1.17.0 tree: zero hits. Logprobs exist only for **generated** tokens (the sampling stage).
- Caveat: arm A runs radiance **1.11.0**, whose source is not on this machine; the same
  sampling-stage-only design is assumed (selftest §2.4 covers it at runtime).

### 1.3 vLLM v0.32.0 (= sly 1.10.0's base) logprob semantics

sly's Dockerfile: `ARG VLLM_VERSION=0.32.0`, `git clone --depth 1 -b v0.32.0 ... && rm -rf /src/vllm`
— so the vLLM python tree is **not** in the local checkout; the following is from the vllm-project/
vllm tag `v0.32.0` (fetched to `/tmp/kldresearch/`): `entrypoints/openai/{completion,chat_completion}/protocol.py`, `config/model.py`, `v1/worker/gpu/sample/prompt_logprob.py`.

- `/v1/completions`: `prompt_logprobs: int | None` (top-k per **prompt** token); `logprobs: int | None`
  (top-k per **generated** token); with `echo`, `prompt_logprobs` defaults to the `logprobs` value;
  non-int values rejected (400).
- `/v1/chat/completions`: `prompt_logprobs: int | None` — **also supported** (positive value or −1;
  "not available when stream=True"); with `echo`, derived from `top_logprobs`.
- Engine: `max_logprobs: int = Field(default=20, ge=-1)`; −1 = no cap, "may cause OOM".
- `logprobs_mode` default **"raw_logprobs"**: "Raw means the values before applying any logit
  processors... Note: for prompt_logprobs, processed_* and raw_* yield identical results because
  prompt tokens do not go through sampling processors." ⇒ both prompt and completion logprobs are the
  **raw softmax; temperature does not scale the returned logprobs** (it changes only which token is
  sampled).
- New in 0.32.0: `prompt_logprob_token_ids` / `logprob_token_ids` + `top_logprobs=−1` (explicit
  token-id set scoring). Not needed for this probe (top-k suffices); noted for the implementer.
- sly patches: no patch touches logprob semantics (grep over `sly/*.py`, `patch_*.py` — hits are the
  Cactus acceptance kernel and the lmhead caveat below). `sly/tests/lessons/H/probe_h.py` is sly's
  own **selftest pattern** for `prompt_logprobs` (send `prompt_logprobs: 1`, handle "prompt_logprobs
  not returned by this server").
- **⚠ Arm-D-specific caveat** — `sly/mxfp4/radiance_lmhead_int2.py` (opt-in via
  `RADIANCE_LMHEAD_INT2`, **off by default**): greedy-only two-stage lm head; "Logprobs: the row
  below the winner is meaningless, so a greedy serve that requests logprobs gets **garbage values for
  the non-winners** — do not enable where logprobs matter." ⇒ the probe must verify the knob is unset
  in arm D's server cmdline (selftest §2.4).
- Arm D profile is `sly-redhat/redhat-mxfp4-dflash` (DFlash2 drafter, `CACTUS_DELTA=0` ⇒ bit-exact
  greedy acceptance per `sly/patch_cactus.py` docstring). For the KLD pass either boot a dedicated
  drafter-less server or document the bit-exact equivalence (open question §3.4).

## 2. Mode decision

**Candidates and the deciding evidence:**

1. **Prompt-scoring** (sly's method): score fixed-corpus tokens via `prompt_logprobs` — no sampling,
   no drift, prefill-only speed, all positions of every text paired. **Deciding evidence: radiance
   cannot do it** — `oai.cpp` refuses (`logprobs for the prompt are not returned; never leave the
   card`), zero `prompt_logprobs` hits in the 1.17.0 tree, OPS.md ties logprobs to the sampling
   stage only. Arms A/B/C (radiance) cannot be scored this way (each arm needs its own logprobs), so
   a mixed-mode headline would compare different measurement shapes. Rejected as the headline; kept
   as an optional **bonus pass** on sly-served pairs (labeled, not mixed in).
2. **Greedy-generation, temp 0, paired top-k (sly's greedy-probe lineage)**: works on **both**
   families — radiance completions `logprobs: 20` (int = alternatives) and vLLM completions
   `logprobs: 20` (int = top-k) take the *same request shape*. **Chosen**, with the cascade problem
   handled explicitly:

**Mode Y′ — paired greedy continuation.** For each prompt `P` (raw text, §3): reference and each arm
generate `N = 512` tokens at `temperature 0` with `logprobs: 20`. Generated positions pair **while
the generated tokens match** — the context is then identical on both sides by construction (context =
`P + shared prefix`). At the first divergent position `m`:
- position `m` **is** included in the KL pool — at `m` the contexts are still identical; the
  distributions `p_ref(·|ctx)` and `p_arm(·|ctx)` are both fully defined, and `m` is exactly where
  they separate enough to flip argmax (maximum information);
- positions `m+1..N` are dropped (contexts now differ) and `m` is recorded per prompt.

Report per arm: pooled mean per-position KL (lower bound, sly formula), paired dNLL, top-1
agreement over all generated positions, median/mean first-divergent position, mean top-20 coverage
mass (the resolution statistic). Fallback trigger (pre-stated): if median first divergence < ~50
tokens, switch that prompt set to **1-token continuation** (each prompt = one paired distribution at
fixed context, `N=1`; no cascade possible, n = #prompts) or raise `N`.

**Selftest (run per arm before scoring; live verification per the brief):**
1. `POST /v1/completions {logprobs: 20, max_tokens: 4, temperature: 0}` ⇒ expect per-token own
   logprob + ≤20 alternatives. (Both families answer this; a refusal ⇒ arm out of scope, record why.)
2. `POST /v1/completions {prompt_logprobs: 1, max_tokens: 1, temperature: 0}` ⇒ record
   availability (expect: sly = yes, radiance = refused). Informs the optional bonus pass only.
3. `POST /tokenize` (both families) on one fixed probe string ⇒ assert **identical token-id
   sequences** ref-vs-arm (tokenizer/template drift guard; sly asserts `len(ids) == len(pl)`).
4. Same prompt with `logprobs: 20` at `temperature 0` and `temperature 1.0` ⇒ assert **identical
   logprobs** (verifies the raw-distribution semantics on the actual serving build: vLLM
   `raw_logprobs` default, radiance "raw logits, before any stage").
5. Arm D only: read the recorded server cmdline ⇒ assert no `RADIANCE_LMHEAD_*` env (garbage
   non-winner logprobs, §1.3). Also record drafter state for the parameterization (iron rule 2).

## 3. The exact formula (every choice sourced)

Notation: position `i`, paired context `c_i`; reference top-20 ids `R_i` with probs `p_t = exp(r_t)`
(`Σ_{R_i} p_t = m_i^R`); arm top-20 logprob map `a_t`; `floor_i = min a_t`; generated token `x_i`
(equal at paired positions). `K = 20`, `ε = 1e-9` (sly kl_compare).

```
KL̂_i  = max( 0,
             Σ_{t ∈ R_i} p_t · ( r_t − a_t )        a_t := floor_i  if t ∉ arm top-K
           +  rt_i · ln( rt_i / at_i ) )
rt_i  = max( ε, 1 − m_i^R )                         # ref tail mass
at_i  = max( ε, 1 − Σ_{arm top-K} exp(a_t) )        # arm tail mass (exact: softmax sums to 1)
```

- **Direction** KL(ref‖arm): sly `check_fidelity.py` / `kl_compare.py`; forward convention (Round 1).
- **Support** = reference top-20 (sly sums over `topr.items()`, the reference's dict); **floor** for
  missing tokens (sly: "gets the arm's smallest top-K logprob, so KL is a lower bound"); **tail
  bucket** `rt·ln(rt/at)` (sly kl_compare; convexity ⇒ the true tail contribution is
  `rt·KL(p̃‖q̃) + rt·ln(rt/at)` ≥ bucket ⇒ still a lower bound; the `max(0,·)` clamp matches sly and
  absorbs float round-off).
- **Pairing**: positions with identical context (shared prefix incl. position `m`) — design over sly's
  greedy-probe lesson, which tracks "first diverging token position".
- **Headline**: `KL̄ = (1/n) Σ_i KL̂_i` over pooled paired positions, **nats/token**. Complement
  (sly): `dNLL̄ = (1/n) Σ_i (r_{x_i} − a_{x_i})`; `top1` = argmax-agreement fraction over all
  generated positions (sly `check_fidelity.py`).
- **Units**: nats/token throughout (sly labels dNLL "nats/token"; `kl/n` by construction).
  (bits/token = nats/ln 2, if ever needed — not the house convention.)

**CI method.** Per-position `KL̂_i` within a prompt are correlated (shared context chain).
- Headline: **cluster bootstrap** — resample prompts (each contributes its whole paired block),
  `B = 2000`, percentile 2.5/97.5 of the block-mean distribution.
- Cross-check (sly consistency): pooled `1.96 · s/√n` with tokens as unit — report alongside, labeled
  "pooled, sly-consistent, mildly optimistic".
- Synthetic calibration of this choice (run below, `ρ≈0.3`, block 200, n=20k): pooled is
  **1.46× narrower** than the cluster bootstrap; the AR(1) closed form `n_eff = n(1−ρ)/(1+ρ)`
  matches the bootstrap within ~8 % — the bootstrap is the honest CI, and the AR(1) formula is a
  cheap cross-check.

**Calibration set (item 5).** Domain mix for a coding-model population: code-dominated.
- Material: `bench/workloads/corpus/` (MEASURED: 422 tracked files, 5.2 MB; `py-rich` +
  `ts-agentic-code-runner`). Proposed mix (INFERRED, implementer to confirm): ~70 % Python/TS
  source, ~20 % markdown/prose (same corpus), ~10 % config/JSON. sly's gate default (stdlib json
  modules + textwrap + GPL-3 prose) is the provenance anchor and the fallback.
- Prompt construction: token-boundary cuts of 200–2000 tokens per file head (no chat template —
  templates differ between engine families and would break pairing, §1.2/§1.3), fixed seeded order,
  the exact set (files + cuts + N) recorded in `campaign inputs/` (iron rule 2).
- Size vs CI width: synthetic §3-CI ⇒ n = 20k paired positions gives a 95 % half-width ≈
  **1.6e-4 nats/tok** (per-position SD ≈ 0.008 in the simulated shape). Expected arm-vs-FP8 deltas
  are in the 0.003–0.01 nats/tok neighbourhood (CLAIMED, model card: IQR-V4 "source KL 0.00297 vs
  bf16 — 24 % below the official FP8 checkpoint's KL" ⇒ the FP8 checkpoint's own vs-bf16 KL ≈
  0.0039, so arm-vs-FP8 gaps are of that order). ⇒ n = 20k makes the CI ~20–60× smaller than the
  delta; with median first-divergence ≈ 300 that is ≈ 96–160 prompts × N=512.

## 4. Precision statement (deliverable)

**Resolution (support).** K=20; per-position resolution statistic = `m_i^R` (reference top-20 mass),
reported as pooled mean coverage. The estimate is a **lower bound**; the underestimate
(`gap = KL_exact − KL̂`) was quantified on synthetic distributions with known full-vocab KL
(`V = 248,320` = the measured vocab; reference shape: top-20 mass `M` geometric inside, tail mass
`1−M` geometric over `V−20` tokens; probe estimator implemented exactly as §3; script
`/tmp/kldresearch/synthetic_kl.py`, re-runnable):

| Arm tail shape (top-20 = ref top-20 exact) | M=0.90 | M=0.98 | M=0.999 |
|---|---|---|---|
| Realistic: ±0.02 nats top-20 noise, tail proportional (no collapse) | exact = est = 0.000108 (gap ≈ 0) | 0.000096 (gap ≈ 0) | 0.000121 (gap ≈ 0) |
| Worst-case finite: arm tail maximally **flat** over V−20 tokens | exact 0.793 / est 0.026 / **gap 0.767** | 0.159 / 0.0003 / **gap 0.158** | 0.0079 / 0.0 / **gap 0.008** |
| Pathological: arm tail mass collapsed onto one/thin tokens | exact → ∞ / est 0.519 | ∞ / 0.080 | ∞ / 0.00095 |

Read: (a) for a real 4-bit model whose tail stays diffuse (softmax never assigns 0), the gap is
**≈ 0** (≤1e-6 in the realistic shape); (b) even with an adversarially-shaped tail, at realistic
top-20 coverage (M ≥ 0.98) the per-position underestimate is ≤ **0.16 nats/tok**, and ≤ 0.008 at
M ≥ 0.999; (c) the pathological collapse case makes the *true* KL diverge while the probe bound stays
finite — the probe then under-reports, but dNLL, top-1 agreement and per-position p99 expose the
collapse independently. **Reported bound for the campaign:** mean underestimate ≤
(fraction of positions with coverage < 0.98) × 0.16 + (fraction < 0.999) × 0.008; with mean top-20
coverage ≥ 0.99 (to be MEASURED by the probe) the mean gap is ≤ ~1e-3 nats/tok — an order below the
expected deltas.

**CI method + width.** Cluster bootstrap (B=2000) as above; at n=20k the 95 % half-width ≈
1.6e-4 nats/tok (synthetic: pooled 1.1e-4 vs bootstrap 1.6e-4; AR(1)-corrected 1.5e-4). The pooled
(sly-convention) number is reported as a cross-check, flagged "mildly optimistic (×1.46)".

**Noise floors (must accompany every number).**
- Engine-version floor: **arm A vs arm B** = same checkpoint on radiance 1.11.0 vs 1.17.0 — their
  mutual KL is the engine-version noise, not quantization.
- Boot-to-boot noise: a reference self-run (two boots of the same arm) bounds run-to-run
  non-determinism. sly CLAIMS bit-identical repeats (docstring, ~0.01 NLL floor on ~14k tokens for
  paired differences); radiance determinism is unverified ⇒ measure it.
- Same-model different-engine delta (radiance vs sly) is not measured by anything local yet; the
  A vs B floor is the honest substitute and must be reported next to the quantization deltas.

## 5. Open questions for the implementer

1. **Reference (corrected 2026-11-09).** `Qwen__Qwen3.8-27B-FP8@017b9c7a` **is** on this machine —
   the earlier "not on this machine" claim only covered the radiance models dir + HF cache. Verified:
   it is an HF safetensors checkpoint at
   `/mnt/Lin1/work/vllm/sly-radiance/models/Qwen__Qwen3.8-27B-FP8@017b9c7a/`, served on **sly** via
   profile `stack/serve/vllm/profiles/sly-radiance/qwen38-fp8.env` (served name
   `qwen38-27b-fp8`, IMAGE pinned to 1.10.0-rocm10.1 for parity with arm D, no RADIANCE_* 4-bit
   tricks — a clean reference). **No fetch needed.** Residuals: profile default `MAXLEN=16384` is
   ample for the probe's prompts; the profile comment flags the single-card boot as tight
   (~25 GiB weights + KV on 32 GB — "the boot itself may fail, the boot result IS the first
   measurement"). Consequence for interpretation: ref and arm D are same-engine (sly) ⇒ D's delta
   is quantization-only; A/B/C deltas include the engine-family difference (radiance vs sly) plus
   quantization (+ engine version for A). The bonus prompt-scoring pass (§5.8) is therefore
   **available** on the ref-vs-D pair.
2. **Radiance 1.11.0 (arm A).** Source not local; completion top-k logprobs assumed identical to
   1.17.0 (selftest 1 verifies). If 1.11.0 predates `logprobs: 20` support, arm A falls out of the
   KLD pass — document as a limitation.
3. **Defaults.** N=512, 96–160 prompts (adaptive rule in §3: coverage target n ≥ 20k; fallback
   1-token continuation if median first divergence < ~50).
4. **Arm D spec decode.** Prefer a dedicated drafter-less KLD boot; otherwise document
   `CACTUS_DELTA=0` bit-exact greedy equivalence in the parameterization.
5. **Arm D lmhead knobs.** Selftest 5; additionally grep the profile env
   (`stack/serve/vllm/profiles/sly-redhat/`) for `RADIANCE_LMHEAD_*` (garbage non-winner logprobs
   if enabled).
6. **Scheduling.** Port 8000 currently holds an **active radiance session** (MEASURED:
   `8000.cmdline` = radiance 1.17.0 serving `qwen3.8-27b-iq4r-l-v4.rad` under the
   `qwen38-27b-redhat-mxfp4-dflash` alias). Stop via pidfile per iron rule 14 before the campaign
   boots; one arm at a time; `gpu_exclusive.sh` floor; per-arm cost ≈ prefill of the corpus
   (~100k tokens) + ≤ N×#prompts decode tokens ≈ 10–40 min (INFERRED from repo decode figures).
7. **Tie-breaking.** Radiance: ties to the lower id (OPS.md) vs vLLM's handling — top-1 agreement
   can show spurious disagreement at near-ties; the KL is unaffected (distributions compared, not
   argmaxes). No action; note in the report.
8. **Bonus pass (available — ref is sly-served).** Run sly's exact `prompt_logprobs` method
   (sly `bench_fidelity.py`/`check_fidelity.py` as-is) on the reference-vs-D pair as a cross-check —
   labeled "prompt-scoring mode, sly only", not mixed into the headline greedy number.
9. **Implementation.** `bench/perf/kld_probe.py`, ~100 lines, stdlib `urllib` (sly convention) +
   `numpy` (MEASURED available: numpy 2.3.5, requests 2.32.5) for the bootstrap.
   `bench/core/capture_engine.py` `probe` is a throughput/concurrency prober (CLI:
   `--prompt-file/--max-tokens/--concurrency/--reps/--prefix-mode`, no logprob capture) ⇒ **reuse its
   conventions** (`CAMPAIGN_DIR`, raw→`tmp/`, rows→`results/`, urllib POST pattern), not its HTTP
   layer.
10. **Constants.** Keep ε=1e-9 and the `max(0,·)` clamp for consistency with sly `kl_compare.py`;
    K=20 (both engines' effective cap); position 0 of any prompt excluded (no context — sly skips
    `pl[1:]`).
