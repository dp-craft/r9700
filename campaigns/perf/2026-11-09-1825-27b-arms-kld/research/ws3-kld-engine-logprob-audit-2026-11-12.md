Promoted 2026-11-12 from the session's private working notes; content unchanged below.
Its STATUS/SUMMARY header is the worker's.
STATUS: done
SUMMARY: All three engines return RAW pre-sampler logprobs, and no server or profile default changes the returned top-20 (temp 0 requests; selftest check 4 MEASURED identical rows at temp 0 and temp 1 on all three engines).
The remaining biases come from token identity (string keys, dicts collapsed on the server side) and from noise floors that were only measured for llama.cpp: the vLLM d-vs-d0 forced KL is 0.0097 with no drafting, 5.5x the q8f floor.
One fetch will break: on llama.cpp b11448 the MTP path does not fill probs for accepted drafts, so the q4mtp greedy diag will fail or lose rows.

# KLD engine/logprob audit: is KL(q8 ‖ arm) reading the real next-token distribution?

Scope: `bench/perf/kld_probe.py` (working tree, with the main session's uncommitted `canon_tok`/`canon_top` fix; line numbers refer to that tree),
`campaigns/perf/2026-11-09-1825-27b-arms-kld/{run.sh,run-forced.sh}`, the serve profiles, the Radiance 1.17.0 source
(`/mnt/Lin1/work/radiance/src/1.17.0`), the Sly 1.10.0 source (`/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0`; there is **no 1.11.0 snapshot**.
The 1.11.0 image label `io.slybase.radiance.vllm=0.32.0` is the same vLLM base as 1.10.0, MEASURED via `docker image inspect`), upstream vLLM v0.32.0 and
llama.cpp b11448 on GitHub. Data: the committed-to-tmp forced batch `tmp/runs/forced-20261112-093746/results/` (q8, q8f, d, d0, dfh, b partial,
d/d0 greedy diag), analysed offline. No server was touched.

## Per-engine table

| Engine · arms | Logprob semantics | Defaults in effect (request omits them) | Spec-decode effect | Token rendering in top_logprobs | Verdict |
|---|---|---|---|---|---|
| **llama.cpp** b11448-ab09ea4 Vulkan · q8 (ref), q8f, q4kxl, q6k | **RAW**: `post_sampling_probs` false → `get_token_probabilities(ctx, idx)` = softmax of `llama_get_logits_ith`, no temperature (CLAIMED, `tools/server/server-common.cpp`@b11448). Backend sampling is switched off when pre-sample logits are needed (`use_backend_sampling &= !need_pre_sample_logits`, server-context.cpp@b11448). Logprob = `std::log(p)` of the f32 prob (server-task.cpp `to_json`). | temp 0 sent; compiled-in top_k 40 / top_p 0.95 / min_p 0.05 plus GGUF `general.sampling.{temp,top_k,top_p}` (MEASURED in the Q8_0 and Q4_K_XL headers; **no penalty keys**). These act only on the sampled token, never on the returned rows. | Forced (max_tokens 1): none. **q4mtp greedy: the accept loop has `// TODO: set result.probs`, `result.prob = 1.0f // set later`** (CLAIMED, server-context.cpp@b11448), so accepted drafts carry no top-k. | Control specials → `''` (`special=params_base.special`, false; no `--special` in the MEASURED cmdline). Leading partial-UTF-8 bytes → truncated by `validate_utf8` (often `''`). Lone continuation bytes → `'�'` (MEASURED: 3,623 `�` entries in q8). `<think>`/`<tool_call>` rendered as text (MEASURED: 1,097). **Each entry carries `id` and `bytes`** (MEASURED selftest shape `entry=dict(bytes,id,logprob)`), but `_topk_entries` drops them. | **OK** for forced and greedy. **BROKEN** for the q4mtp diag. |
| **vLLM / Sly** 1.11.0-rocm10.1 (vLLM 0.32.0) · d (DFlash k=7), d0, dfh; e on 1.8.1 | **RAW**: default `logprobs_mode="raw_logprobs"`. V1 `Sampler.forward` computes logprobs "before any penalties or temperature scaling". The V2 runner picks `processed_logits` only for a PROCESSED mode (CLAIMED, `vllm/v1/sample/sampler.py`, `vllm/v1/worker/gpu/sample/sampler.py`@v0.32.0). No profile sets `--logprobs-mode` (MEASURED grep). Logits are **bf16** at the head output: 99.9% of the logprob gaps from top-1 to ranks 2–6 fall on a 1/16 grid (MEASURED, d/d0/dfh), against ~0.1% for llama.cpp and 0% for Radiance. | `--override-generation-config {temperature 1.0, top_p 0.95, top_k 20, min_p 0, presence_penalty 0}` (MEASURED docker argv), plus `generation_config.json` temp 1.0/top_k 20/top_p 0.95 with **no penalties** (MEASURED, RedHat + heretic). Temp 0 → greedy. None of this touches raw logprobs. | Forced: no draft (the request ends after the prefill step). But **forced KL(d0‖d)=0.0097, 0/4096 rows bit-identical, top-1 97.9%** (MEASURED), so loading DFlash or the d-specific config changes the target's numbers even with no drafting. Cause UNKNOWN (V1-vs-V2 runner, MAXLEN 260000 vs 110000, prefix cache). Greedy: verify-forward logits, stock greedy acceptance. | Specials rendered as text (`<|im_end|>` 417, `<|endoftext|>` 331 in d, MEASURED). Partial bytes → context-corrected text or `''` (`_verify_tokens`/`_correct_decoded_token`, CLAIMED `vllm/v1/engine/logprobs.py`@v0.32.0). **`top_logprobs` is a dict keyed by string, and a later (less likely) entry overwrites an earlier one** (CLAIMED, `entrypoints/openai/completion/serving.py`@v0.32.0). MEASURED: 131/4096 d rows short of 20, every one containing `''`. Ids are available per request via `return_tokens_as_token_ids` (`"token_id:N"`). | **OK** on semantics. **Small BIAS** from collisions. **Noise floor UNKNOWN** (no vLLM self-run). |
| **Radiance** 1.11.0 (a) / 1.17.0 (b, c, c0) | **RAW**: `sample_logprobs` "runs on the raw logits, before any stage has touched them" (OPS.md:2908-2910), and the GUIDE says the values are taken "before any penalty, temperature, grammar mask or cut" (GUIDE.md §5.12). `post_sampling_probs` is refused at any value but false (oai.cpp:328-330). | Temp 0 sent. Penalties etc. are irrelevant to raw rows. `--reasoning-effort-map` is chat-only. | Claimed none: "Speculation does not affect logprobs: every verified position is scored" (GUIDE.md §5.12), and "prefix cache and speculation … never change the output" (GUIDE inert-fields list). Not verified here: no b self-run, and a failed to boot in this batch. | Control specials → `''` (`reply_bytes` = `decode(render_special=false)`, adapters.h:405-408). Partial UTF-8 → longest valid prefix (server.cpp:651-654). **The legacy `top_logprobs` dict collapses equal texts to the likelier entry** (oai.cpp:2926-2937), **but `/v1/completions` also returns a `content` array with `id` + `bytes`** (oai.cpp:2943-2945). The probe reads the legacy shape, because `normalize_logprobs` takes `tokens` first (kld_probe.py:230). MEASURED: 45/448 b rows short of 20; selftest `dict-map[19]`. | **OK** on semantics. **Small BIAS** from legacy-dict collisions. **Floor UNKNOWN.** |

## Per-question findings

### Q1 RAW or POST-PROCESSED?
All three are **RAW** (log-softmax of the model's logits):
- **llama.cpp.** The forced and greedy fetches send no `post_sampling_probs`, so `populate_token_probs(slot, result, post_sampling_probs=false, params_base.special, tok_idx)` → `get_token_probabilities` → softmax of `llama_get_logits_ith`, with no temperature (CLAIMED, b11448 server-context.cpp / server-common.cpp). `n_probs` is the request's count. The completions `logprobs` integer reaches it (MEASURED: 20 entries per row).
- **vLLM.** `logprobs_mode` defaults to `raw_logprobs` in V1 and V2. Raw logprobs are captured before the float32 cast, logits processors, penalties, temperature, min_p and top-k/top-p (CLAIMED, v0.32.0 sampler.py). The only Sly patch that touches logprobs code (`patch_gfx1201.py:52-66`) gates the AITER sampler and keeps the `logprobs_mode not in PROCESSED_LOGPROBS_MODES` condition intact (CLAIMED, 1.10.0 source). The int2 target head (`radiance_verifyhead.py`) declines any step that carries a logprobs request (`num_logprobs != -1 → return False`, :172) and is off unless `RADIANCE_VERIFY_HEAD=1` (not set in any profile, MEASURED). `RADIANCE_LMHEAD_INT2` is refused by `kld_lmhead_clear` (run.sh:582-600).
- **Radiance.** Raw on-card top-21 by design. The chosen token's logprob is reconstructed only when it falls outside the top-20, which is never true for a greedy argmax (CLAIMED, GUIDE §5.12).
- **Cross-check (MEASURED):** selftest check 4 (temp 0 vs temp 1, max_tokens 1) gave identical rows on llama.cpp, Sly and Radiance (`results/compare-20261111-210235/kld-selftest-*.json`: `raw_logprobs: true`). This rules out temperature/top-k/top-p processing. It does not exercise penalties, but every source path above computes logprobs before penalties anyway.
- **Not a sampler, but a precision property: vLLM returns bf16-rounded logits** (MEASURED 1/16 grid). This is the engine's real output, so it belongs to the arm. INFERRED size: ≪0.001 nats/tok on peaked rows (KL ≈ ½·Var_p(rounding error), step 0.0625–0.125).

### Q2 Server-side defaults
- **llama.cpp:** compiled-in temp 0.8 / top_k 40 / top_p 0.95 / min_p 0.05 / repeat_penalty 1.0 / DRY 0 (INFERRED from llama.cpp `common` defaults; not re-read at b11448), plus GGUF `general.sampling.temp/top_k/top_p` (MEASURED: present in Q8_0 and Q4_K_XL, no penalty keys). The request's temperature 0 overrides temp. Penalties are off, so the greedy argmax is the raw argmax and the returned rows are raw either way.
- **Sly vLLM (d/d0/dfh):** the `--override-generation-config` above with presence_penalty **0.0**, and `generation_config.json` with no penalties (MEASURED). vLLM resets top_p/top_k/min_p for temp < eps (INFERRED from SamplingParams greedy normalisation). **Arm e** (`sly-official/heretic-mxfp4`, base branch of `start_server`, run.sh:449-451) runs **without** `CACTUS_DELTA=0`, so the engine default **RADIANCE_CACTUS_DELTA=0.5** applies (sly-official/_engine.env). For forced max_tokens 1 there is no draft verification, so it has no effect on e's KLD (INFERRED). It would only matter for a sampled spec-decode run: Cactus patches only the non-greedy branch ("Greedy requests keep their own branch", sly/patch_cactus.py:13, CLAIMED).
- **Historical (compare round 2026-11-11, now superseded):** the FP8 reference `kld-ref-fp8` used `sly-radiance/qwen38-fp8`, whose engine layer sets `presence_penalty: 0.1` (sly-radiance/_engine.env, MEASURED). vLLM applies penalties before the greedy argmax, so that reference's greedy continuation was penalised. Raw rows were unaffected, but the paired-greedy positions were not "pure greedy" (INFERRED). The q8 llama.cpp reference does not have this problem.
- **Radiance:** no sampler default reaches the raw rows. Logit bias, mirostat, etc. are refused unless at their off value (oai.cpp kGuarded).
- **Verdict:** no default changes the RETURNED logprobs on any engine (MEASURED via check 4, plus source).

### Q3 Speculative decoding (DFlash, DFlash2, MTP)
- **Forced fetch, max_tokens 1:** no verify step happens on vLLM or llama.cpp (INFERRED: the request finishes on the prefill-sampled token), and Radiance claims spec never changes logprobs. **However, forced KL(d0‖d) = 0.0097 nats/tok** (median 7.8e-5, max 1.87, 0/4096 rows bit-identical, top-1 agreement 97.9%; MEASURED from kld-d/kld-d0). The two boots differ in more than DFlash: MAXLEN 260000 vs 110000, the runner path (Sly states vLLM 0.31+ puts ROCm Qwen3.8+dflash on the V2 runner, patch_cactus.py:28-31, CLAIMED; d0's runner is UNKNOWN), and prefix-cache layout. So "spec decoding is invisible in forced mode" holds for drafting, but **the d-vs-d0 difference is not zero, and its cause is UNKNOWN**. Check the vLLM engine log's runner line (the main session can grep one line) or run a d0 self-repeat.
- **Greedy diag d vs d0 (MEASURED):** all 16/16 prompts diverged (median first-divergent position 69), and KL(d0‖d) on paired positions is 0.0059 [0.0028, 0.0144]. DFlash with stock greedy acceptance (`RADIANCE_CACTUS_DELTA=0` in the d argv, MEASURED) can change the argmax only through verify-forward numerics at near-ties, but it does.
- **Radiance:** the logprob row of an accepted token is the verifier's row for that position (CLAIMED, GUIDE §5.12).
- **llama.cpp MTP (q4mtp):** the speculative accept loop never calls `populate_token_probs` (`// TODO: set result.probs`). **Expected outcome (INFERRED from CLAIMED source):** content entries for accepted drafts have empty `top_logprobs`, so `fetch` marks every prompt `logprobs rows N != tokens M` and quarantines it, and `score_diag q4mtp-vs-q4kxl` reports "incomplete". The batch has not reached q4mtp yet. The MTP effect can only be measured on tokens (first-divergence, token agreement), not with KL, on this build.

### Q4 lm-head quantization and "cactus"
- `RADIANCE_LMHEAD_INT4=1`: an int4 W4A16 g128 lm head built from the bf16 weight at load ("10.8% of the logit RMS vs 3.7% for fp8", TECHNICAL.md:59-72). For a **compressed-tensors** checkpoint like RedHat MXFP4 it is hooked by `patch_lmhead_int4_ct.py` (CLAIMED, 1.10.0). It takes precedence over FP8.
- `RADIANCE_LMHEAD_FP8=1` is a **Quark-only hook** and is a no-op on CT checkpoints (TECHNICAL.md:415-418, CLAIMED for 1.10.0). For d/d0, only INT4 is effectively active (INFERRED).
- `RADIANCE_EMBED_INT8=1 RADIANCE_EMBED_BITS=4`: int4 embeddings. Sly measured +0.003 KL for the int4 head and +0.006 total with int4 embed (TECHNICAL.md:496-499, CLAIMED). The image default `RADIANCE_ATTN_Q_FP8=1` (MEASURED image env) and fp8 KV are further precision choices.
- **MEASURED here:** KL(d0‖dfh) = 0.0043 (forced, same positions). q8→d0 = 0.0607 and q8→dfh = 0.0562, so the int4 head accounts for ≈0.004–0.005 of d0's 0.061 (it cannot be separated from boot noise without a d0 repeat).
- **Cactus** (`RADIANCE_CACTUS_DELTA`): a lossy acceptance transform in the spec-decode rejection kernel. It does not apply to greedy requests or to forced max_tokens 1. d/d0/dfh run it at 0 (MEASURED argv); e runs it at 0.5 with no effect on forced KLD (INFERRED).
- **Which belong in the measurement:** the int4 head, int4 embed, fp8 KV and ATTN_Q_FP8 are all **production settings** of the sly-redhat profile, so they belong in arm d/d0's number. dfh is the diagnostic that isolates the head. Only `LMHEAD_INT2` and `VERIFY_HEAD` would be artifacts: they produce garbage non-winner logprobs or skip logprob rows. Both are off or refused.

### Q5 Token string rendering, and ids vs strings
- **Control specials:** llama.cpp `''`, Radiance `''`, vLLM literal text. **Partial UTF-8:** llama.cpp gives a truncated prefix or `'�'`; vLLM gives context-corrected text or `''`; Radiance gives the valid prefix (can be `''`, or a prefix string such as `' '` that collides with a real token).
- **Non-special added tokens** (`<think>`, `<tool_call>`) are text on all three engines (MEASURED on llama.cpp and vLLM).
- **Ids:** llama.cpp entries carry `id` (MEASURED shape). Radiance `content[]` carries `id` (oai.cpp:2902-2909). vLLM can return `"token_id:N"` keys per request (`return_tokens_as_token_ids`, CLAIMED v0.32.0 serving.py).
- **Server-side collisions are unrecoverable from strings:** vLLM keeps the *less* likely of two equal strings, Radiance's legacy dict keeps the likelier (CLAIMED source; MEASURED short rows d 3.2%, b 10%).
- **Is the bucket sound?** Measured on the existing data:
  - **For q8f, essential:** the committed formula gives 0.1106, `canon_top` gives 0.00176 (MEASURED).
  - **For d/d0/dfh:** 0.167 → 0.0638 / 0.0607 / 0.0562. The `<special>` bucket term contributes only +0.0014 (d), and the vLLM `''` mass is 8e-6/pos, so lumping vLLM partial bytes into `<special>` has no measurable effect (MEASURED).
  - **For b:** without bucketing `''`, KL reads 0.131 instead of 0.083 (MEASURED).
  - `'�'` entries exist only on llama.cpp. Their reference mass averages 2.3e-9/pos, so floor-scoring them on vLLM/Radiance is negligible (MEASURED).
  - **Verdict: the bucket is a sound fallback for already-fetched data** (a coarser event space applied to both sides keeps the lower bound). It cannot undo collisions the server already made. **Recommendation: key on token ids for every new fetch.**

### Q6 Int-list prompts, BOS, template, caching, batching
- `/v1/completions` applies no chat template on any engine (`--chat-template` affects chat only). The forced path asserts `usage.prompt_tokens == len(sent)` (kld_probe.py:441-444), which would catch BOS insertion or text re-tokenisation. MEASURED: 0 errors on q8f/d/d0/dfh/b, so the ids are honoured. The Qwen GGUFs carry no `add_bos_token` key (MEASURED header scan).
- **Gap:** each arm sends **its own** `/tokenize` ids for the prompt (`pids = _tokenize(url, …)`, kld_probe.py:428). Only their *length* is compared with the reference, so same-length/different-id tokenisation would pass silently (INFERRED, low likelihood).
- **Prefix caching:** llama.cpp `cache_prompt` (default on) and vLLM `--enable-prefix-caching` (MEASURED argv) reuse the earlier, shorter forced request of the same prompt, because positions are sent in ascending order. On these hybrid GDN models a reused state is computed with a different chunking than a cold prefill (INFERRED). This is noise, not bias, and q8f already contains it for llama.cpp. **The q8 reference rows come from decode steps while every arm comes from prefill.** MEASURED: this path difference is not a systematic bias. KL(q8‖dfh)=0.0562 vs KL(q8f‖dfh)=0.0563.
- **Batch composition:** requests are strictly sequential, one client, so there is no batch-mix nondeterminism (INFERRED from the fetch loop).

### Q7 Other biases, and how representative the q8f floor is
1. **The q8f floor is llama.cpp-only and heavy-tailed** (MEASURED):
   - 0.00176 nats/tok, median 2.4e-6.
   - The top 1% of positions carry 83% of it (box-drawing/near-tie contexts, max 0.98).
   - It is position-dependent: 0.0007 (0–127), 0.0023, 0.0039, 0.0009 (384+).
   - **vLLM's comparable "same weights, different boot" figure is 0.0097**, 5.5× larger, and Radiance has no floor at all.
   - So the q8f floor **under-states** cross-engine noise. Arm gaps smaller than ~0.01 between vLLM arms are not resolved by the floor (e.g. d − d0 = 0.003, d0 − dfh = 0.0045).
2. **KV dtype is confounded with the weight quant:**
   - q8 ref: f16 KV.
   - q4kxl/q6k: `LLAMA_KV` default **q8_0** (run.sh:83; MEASURED cmdline `-ctk q8_0`).
   - vLLM/Radiance: fp8 KV.
   - These are production settings, but they must be stated per arm.
3. **Partial-UTF-8 positions** are excluded from forced scoring for all arms: 161/54,852 = 0.29% (MEASURED). This is uniform across arms, so negligible.
4. **Lower-bound KL:** the floor substitution depends on each engine's row completeness. vLLM and Radiance rows shortened by collisions get a slightly different floor and tail term than full llama.cpp rows (INFERRED, small: affected rows are 3–10% and the missing entries are low-mass).
5. **e** runs a different image (1.8.1) and different weights (heretic). Its KL mixes both.

## Fixes ranked by impact
1. **Measure a per-engine self-floor before ranking vLLM/Radiance arms:**
   - re-run d0 (same profile, fresh boot) as `d0f`;
   - re-run b as `bf`.
   - Report each arm against its own engine's floor. Today's 0.0018 floor is llama.cpp-only, while vLLM's config/boot spread is MEASURED at 0.0097.
   - Optionally add d0 with `--no-enable-prefix-caching` to price the cache.
2. **Key every top-k entry on the token id**, using strings only as display:
   - llama.cpp: keep `id` in `_topk_entries`;
   - Radiance: make `normalize_logprobs` prefer `content` whenever present, not only when `tokens` is absent (kld_probe.py:230);
   - vLLM: add `"return_tokens_as_token_ids": true` to the `fetch`, `fetch_forced` and `selftest` bodies and parse `token_id:N`.
   - This removes the server-side collisions that the bucket cannot undo, and the special/partial-byte rendering differences. Keep `canon_top` as a fallback for already-fetched string data. It is MEASURED adequate there; existing fetches need not be re-run for this alone.
3. **Send the reference's own prompt ids to every arm** (store `/tokenize` ids in the q8 reference block), and assert exact id equality wherever the arm's `/tokenize` is available, not just equal length.
4. **q4mtp:**
   - expect the greedy fetch to fail on b11448, because spec-accepted tokens get no probs;
   - score the MTP effect on tokens (first-divergence, token agreement vs q4kxl greedy);
   - or mark it "not measurable by KL on this build" up front instead of letting it land as a quarantine.
5. **Attribute d vs d0** (0.0097 forced with no drafting): record the runner (V1/V2) and MAXLEN per boot, and boot d0 at MAXLEN 260000 to split the confound.
6. **Report the tail:** quote the median and the share carried by the top 1% beside each mean. The means are dominated by few positions in both floor and arms (47–49% of arm KL sits in the top 1% of positions).
7. **Document the KV dtype and the head/embedding quant per arm** in the result table: q8 f16; q4kxl/q6k q8_0; vLLM/Radiance fp8 + int4 head/embed for d/d0.
8. Optional: pass `CACTUS_DELTA=0` to arm e's boot for uniformity. There is no effect on forced KLD; it only matters if e ever gets a greedy diag.

## How the KLD is measured: settings and environment (for the report)
KLD is the teacher-forced KL(q8 ‖ arm) in nats per token, a lower bound computed on the reference top-20 with a lumped tail.

**Reference.** The reference is unsloth Qwen3.8-27B Q8_0 on llama.cpp b11448-ab09ea4 (Vulkan, f16 KV, ctx 32768, 1 slot, `-fa on -ub 2048 -b 8192`). It produces a temperature-0 greedy continuation (512 tokens) with top-20 logprobs for 128 calibration-v2 prompts (raw text, no chat template).

**Arm requests.** Each arm receives the prompt token ids plus the reference's first *i* generated ids as an int-list `/v1/completions` prompt, at 32 evenly spaced *i* per prompt, with `max_tokens 1`, `temperature 0`, `logprobs 20`. Positions whose reference token is a partial UTF-8 byte are skipped (0.29%).

**What the logprobs are.** All engines return raw pre-sampler log-softmax logprobs:
- llama.cpp `n_probs`, with `post_sampling_probs` false;
- vLLM 0.32.0 (Sly 1.11.0) `logprobs_mode=raw_logprobs`, on bf16 logits;
- Radiance `sample_logprobs` on raw logits.

Selftests confirm identical rows at temperature 0 and 1. Server sampling defaults do not change the returned rows. Speculative decoding does not draft at `max_tokens 1`.

**Arm configurations.** Each arm runs its production configuration:
- llama.cpp Q4_K_XL / Q6_K with q8_0 KV;
- Sly RedHat MXFP4 with fp8 KV, int4 lm head, int4 embeddings, attention-Q fp8, Cactus off, with or without DFlash k=7 (dfh: bf16 head);
- Radiance MXFP4 / IQ4R-L with fp8 KV, spec k=7 (c0: 0).

**Scoring.** Tokens are matched by string, with control specials and empty strings merged into one bucket by logsumexp. Prompts are cluster-bootstrapped (B=2000).

**Noise floors.** The same-engine q8 re-run floor is 0.0018 nats/tok (median 2e-6). A same-weights vLLM config change (d vs d0, no drafting) moves KL by 0.0097, so differences below ~0.01 between vLLM arms are not resolved.

## Evidence index (local files)
- `bench/perf/kld_probe.py:76-120` (canon_tok/canon_top/kl_position), `:230` (normalize_logprobs prefers `tokens`), `:317-319` / `:438-440` (request bodies), `:428` (arm's own /tokenize), `:441-444` (prompt_tokens guard)
- `campaigns/perf/2026-11-09-1825-27b-arms-kld/run.sh:83` (LLAMA_KV q8_0), `:413-451` (sly boots: CACTUS_DELTA=0 only for d/d0/dfh), `:582-600` (INT2 refusal)
- `stack/serve/vllm/profiles/sly-official/_engine.env` (override-generation-config, CACTUS default 0.5), `sly-redhat/redhat-mxfp4.env` (LMHEAD_FP8+INT4, EMBED int4), `sly-radiance/_engine.env` (presence_penalty 0.1)
- `/mnt/Lin1/work/radiance/src/1.17.0/core/server/oai.cpp:328-330,2902-2945`; `core/server/server.cpp:651-654,750-762`; `core/server/adapters.h:401-408`; `docs/OPS.md:2908-2918`; `docs/GUIDE.md` §5.12
- `/mnt/Lin1/work/vllm/sly-radiance/src/1.10.0/{patch_gfx1201.py:52-66, radiance_verifyhead.py:37-44,172, sly/patch_cactus.py:1-31, sly/mxfp4/radiance_lmhead_int4.py, sly/patch_lmhead_int4_ct.py, docs/TECHNICAL.md:49-72,415-418,496-499}`
- Upstream: github.com/vllm-project/vllm v0.32.0 `vllm/v1/sample/sampler.py`, `vllm/v1/worker/gpu/sample/sampler.py`, `vllm/v1/engine/logprobs.py`, `vllm/entrypoints/openai/completion/serving.py`; github.com/ggml-org/llama.cpp b11448 `tools/server/{server-context,server-common,server-task}.cpp`
- Analysis scripts (scratch, not repo): `/tmp/claude-1001/-home-dev-work-dp-craft-amd/fbf3fe1d-a02c-41c3-ada9-083a14bdc7a6/scratchpad/{ana.py,kl2.py,kl3.py,kl4.py,kl5.py}`
