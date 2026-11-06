<!-- meta
date: 2026-07-16 10:16
slug: spec-draft-p-min-mtp
title: llama.cpp --spec-draft-p-min and the MTP path (default, semantics, applicability)
takeaway: ⚠ CORRECTED 2026-07-16 by measurement — the original "p_min is inert on MTP" conclusion (from source-reading) is FALSE on our build. Test bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/ shows --spec-draft-p-min IS live on the --spec-type draft-mtp path at b9950: raising it 0->0.99 cuts drafted-tok/pass 2.98->0.46, lifts acceptance 69%->100%, changes the output, and LOWERS decode 160->106 t/s. It does NOT reduce run-to-run fluctuation (6/6 distinct replies at every level, both 35B and 27B). Still true: default at our commit is 0.0f (NOT 0.75 — that was the b6000 default; history 0.9→0.75→0.0). Corrected recommendation: do NOT set --spec-draft-p-min for throughput (it costs decode) and it is not a fluctuation remedy; --spec-draft-n-max remains the draft-depth lever (peaks 2-3). Penalty samplers still cost ~2 ms/token host work under MTP; keep them 0 for coding.
-->

# Research: llama.cpp `--spec-draft-p-min` and the MTP path

> ## ⚠ ERRATUM — 2026-07-16, corrected by measurement
> **This report's central claim ("`--spec-draft-p-min` is inert on the MTP path") is WRONG on our build.** It was a source-reading (PR #22673 TODO + master `speculative.cpp`); a direct test on b9950 (`bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/analysis.md`) refutes it. Measured, 35B-A3B, `--spec-type draft-mtp`, seed 42:
>
> | p_min | draft tok/pass | acceptance | decode t/s | reply |
> |--:|--:|--:|--:|--|
> | 0.0 | 2.98 | 69% | 159.9 | ref |
> | 0.5 | 2.10 | 82% | 146.9 | changed |
> | 0.9 | 1.05 | 99% | 125.9 | changed |
> | 0.99 | 0.46 | 100% | 106.5 | changed |
>
> **p_min is live and gates draft depth exactly as documented — it just *costs* decode on our workload, and does NOT reduce fluctuation** (6/6 distinct replies across seeds 42–47 at every level, 35B and 27B). Either our commit `961e4b26a` re-enabled p_min for MTP after the PR, or the master snapshot the subagents read differs from our build; **empirics on our build govern (iron rules 2, 7).** Read the source-based findings below as "what the source text said", now superseded by the test. The *default* finding (0.0f at our commit, not 0.75) is unaffected and still correct.

- **Date:** 2026-07-16 10:16 (research) · **Corrected:** 2026-07-16 (measured)   · **Question:** Is `--spec-draft-p-min 0.75` set in our stack, where does 0.75 come from, and should we set it for the Qwen3.6 MTP configs?
- **Confidence:** ~~high~~ → **the MTP-applicability finding was WRONG** (see erratum); the default-value and semantics findings hold   · **Sources:** 8 (Tier-1: 8, Tier-2: 2 anecdotal, flagged) + 1 local measurement (this build)

## Summary

`--spec-draft-p-min` is **not set anywhere in our active stack** — `bench/engine-bench/serve_llamacpp.sh:86` passes only `--spec-type draft-mtp` when `MTP=1`, so p_min (and n_max, n_min) fall back to llama.cpp's compiled-in defaults. The `0.75` in the question is a **stale default**: llama.cpp's `p_min` default has moved `0.9f → 0.75f → 0.0f` over 2025, and at **our exact build b9950 (commit `961e4b26a`) it is already `0.0f`** [CLAIMED, source line quoted below]. More decisively, **`--spec-draft-p-min` has no effect on the MTP path at all**: the PR that added MTP (`#22673`) lists "re-enable `--spec-draft-p-min` support for `mtp`" as a *post-merge TODO*, the MTP draft loop stops purely on the `n_max` quota, and it drafts greedily (`top_k = 1`). So for every Qwen3.6 MTP config we run, the only live draft-length lever is **`--spec-draft-n-max`** (default 3). Our own local probe (`bench/runs/2026-07-16-0927-mtp-sampler-probe/`, MEASURED) shows decode t/s peaks at n_max 2–3 and collapses by n_max 8 as acceptance falls — which is the exact tradeoff p_min *would* govern if it were wired up. **Recommendation: do not set `--spec-draft-p-min`; sweep `--spec-draft-n-max` instead if we want to tune MTP draft depth.**

## Key findings

| # | Finding | Provenance | Source | Confidence |
|---|---------|-----------|--------|-----------|
| 1 | p_min default at **our build b9950 (`961e4b26a`)** is `0.0f` — not 0.75 | CLAIMED | common.h @961e4b26a | high (line-verified at our commit) |
| 2 | Default history is `0.9f → 0.75f → 0.0f`; 0.75 was the b6000-era (mid-2025) value | CLAIMED | common.h @b4500, @b6000 | high (line-verified at tags) |
| 3 | `p_min` is an **early-stop on the DRAFT's own top-token probability**, not a verification-time accept test | CLAIMED | common/speculative.cpp | high |
| 4 | **`p_min` is NOT consulted on the `draft-mtp` path** — explicit post-merge TODO; MTP stops on n_max, drafts greedy top_k=1 | CLAIMED | PR #22673 + speculative.cpp | high (PR TODO + diff quoted) |
| 5 | `n_max` default 3 (hard cap), `n_min` default 0 (discard-if-shorter); with p_min=0 only n_max limits draft length | CLAIMED | common.h @961e4b26a | high |
| 6 | Verification **runs the full sampler chain** (penalties + temperature); on the *classic* path a penalty can therefore reject a draft token | CLAIMED | common/sampling.cpp | high |
| 7 | Our own n_max sweep (35B MoE, ctx 4096): decode peaks at n_max 2–3 (155–160 t/s), acceptance falls 86%→37% as n_max 1→8 | MEASURED-BY-US | bench/runs/2026-07-16-0927-…/results.jsonl | high (n=1/cell, mechanism-grade) |
| 8 | gfx1201/R9700-specific MTP issue exists (GPU not releasing load with MTP GGUFs) | CLAIMED | Issue #23251 | high (report names "R9700 [GFX 1201]") |

## Detail

### 1–2. The default is 0.0f on our build; 0.75 is a stale value

At our exact build commit the speculative-draft params live in the nested struct `common_params_speculative_draft` (a 2025 refactor, PR #22397, moved them out of `common_params_speculative`). Verified line at `961e4b26a`:

```cpp
float p_min   = 0.0f; // minimum speculative decoding probability (greedy)
```
[CLAIMED: https://raw.githubusercontent.com/ggml-org/llama.cpp/961e4b26a/common/common.h — accessed 2026-07-16]

The value the question assumes (0.75) was real, but earlier:
- **b4500** (early 2025): `float p_min = 0.9f;` (with `n_max=16`, `n_min=5`) [CLAIMED: .../b4500/common/common.h]
- **b6000** (mid 2025): `float p_min = 0.75f;` (with `n_max=16`, `n_min=0`) [CLAIMED: .../b6000/common/common.h]
- **b9950 / master**: `float p_min = 0.0f;` (with `n_max=3`, `n_min=0`) [CLAIMED, above]

Net history: **0.9f → 0.75f → 0.0f**. The 0.75→0.0 flip (and `n_max` 16→3) is attributed by web search to PR #23269 ("llama : MTP clean-up"); that exact diff line was *not* opened, so the PR attribution is medium-confidence — but the **end state at our commit is line-verified**, which is what matters. So: **0.75 is not our default and is not set by us; it is a value from a mid-2025 llama.cpp.**

> **Conflict noted and resolved.** One research pass quoted `float p_min = 0.75f;` from common.h (with a `// TODO: change default to 0.0f` comment). That snapshot predates the flip (or was the MTP-PR diff base). Fetching common.h **at our build's commit `961e4b26a`** settles it: `0.0f`. We benchmark b9950, so `0.0f` is the operative default for this repo.

### 3. What p_min means (classic path)

It is a **draft-time early-stop threshold on the draft model's own top-candidate probability**, not a verification-time acceptance test. In `common/speculative.cpp` the classic/EAGLE draft loop stops extending a sequence once the top token's probability drops below `p_min`:

```cpp
if (cur_p->data[0].p < params.p_min) {
    drafting[seq_id] = false;
```
[CLAIMED: https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/speculative.cpp — accessed 2026-07-16]

With the default `p_min = 0.0f` this check never fires: on the classic path drafting is bounded only by `n_max`. Raising p_min shortens drafts and raises per-token acceptance; lowering it lengthens them.

### 4. p_min does NOT apply to MTP — the decisive point

The PR that added MTP support (am17an, **#22673** "llama + spec: MTP Support") lists as a post-merge TODO:

> "Re-enable `--spec-draft-p-min` support for `mtp`"
[CLAIMED: https://github.com/ggml-org/llama.cpp/pull/22673 — accessed 2026-07-16]

The MTP draft path in that PR hardcodes greedy sampling and disables the confidence logic:

> `sparams.top_k = 1; // TODO: re-enable top_k == 10 and utilize \`p_min\` spec param`
[CLAIMED: https://patch-diff.githubusercontent.com/raw/ggml-org/llama.cpp/pull/22673.diff — accessed 2026-07-16]

And in current `speculative.cpp` the MTP path stops purely on the quota, not on probability:

```cpp
if (params.n_max <= (int) result.size()) { drafting[seq_id] = false; ... }
```
[CLAIMED: master/common/speculative.cpp — accessed 2026-07-16]

**Consequence:** with `--spec-type draft-mtp` (every MTP config in this repo), `--spec-draft-p-min` is inert. Setting it to 0.75, 0.9, or anything else changes nothing. The only draft-length lever is `--spec-draft-n-max`.

### 5. n_max / n_min interaction

At `961e4b26a`:
```cpp
int32_t n_max = 3; // maximum number of tokens to draft during speculative decoding
int32_t n_min = 0; // minimum number of draft tokens to use for speculative decoding
```
[CLAIMED: .../961e4b26a/common/common.h]

- **n_max** — hard upper bound on draft length (the *only* live limit on MTP).
- **p_min** — soft early-stop (classic path only; off by default; inert on MTP).
- **n_min** — if a produced draft is shorter than n_min it is discarded wholesale; with default 0, never.

Note our legacy harness set `--spec-draft-n-max 3` explicitly (`bench/legacy/harness/*.sh`); the current `serve_llamacpp.sh` sets nothing, so it inherits the same value **3** by default. So MTP behaviour is unchanged between legacy-explicit and current-implicit — both draft up to 3.

### 6. Penalties/temperature and acceptance

Verification re-samples each drafted position through the **full configured sampler chain** and accepts only on exact match:

```cpp
for (; i < draft.size(); i++) {
    const llama_token id = common_sampler_sample(gsmpl, ctx, idxs[i], grammar_first);
    ...
    if (draft[i] != id) { break; }
}
```
[CLAIMED: master/common/sampling.cpp — accessed 2026-07-16]

The chain includes `llama_sampler_init_penalties(...)` and temperature, so on the classic path a `presence_penalty`/`frequency_penalty` or higher temperature **can** shift the target's argmax and reject a draft token. This is the code basis for the "penalty breaks speculation" intuition — **but** our own probe (below) shows that for MTP at small penalty the accepted tokens are *unchanged* (byte-identical reply) while decode still collapses, i.e. the observed decode cost is **host-side sampler compute (~2 ms/token), not rejection**. The two are consistent: a penalty large enough to move the argmax would also reject drafts, but the throughput hit we measured arrives before that, purely from running the penalties branch each token on the Ryzen 5 3600.

### 7. Local corroboration — the n_max sweep (MEASURED-BY-US)

`bench/runs/2026-07-16-0927-mtp-sampler-probe/results.jsonl`, 35B-A3B MoE, MTP on, pp=0, ctx 4096, KV f16, b9950, Vulkan, seed 42:

| n_max | draft acceptance % | k drafted/pass | decode t/s |
|------:|-------------------:|---------------:|-----------:|
| 1 | 86.0 | 1.00 | 134.7 |
| 2 | 77.2 | 1.98 | 155.0 |
| **3** (default) | 69.1 | 2.98 | **159.6** |
| 4 | 57.5 | 3.96 | 151.6 |
| 6 | 42.0 | 5.88 | 128.9 |
| 8 | 37.3 | 7.84 | 80.2 |

Acceptance falls monotonically as n_max rises (deeper drafts propose later, less-certain tokens); decode peaks at n_max 2–3. This is precisely the tradeoff `p_min` is designed to manage *adaptively* (stop drafting when confidence drops) instead of *statically* (fixed n_max) — but since p_min is unwired on MTP, n_max is our only knob, and the default 3 already sits at the peak on this workload. ⚠ n=1 per cell, ctx 4096 (shallow by design); magnitude is not authoritative, the shape is.

### 8. RDNA4/gfx1201 caveat

Issue **#23251** "MTP gguf models do not release the GPU load" is filed on an "AMD Radeon AI PRO R9700 [GFX 1201]": MTP GGUFs keep the GPU ~30% utilised at idle where non-MTP models drop to ~37 W [CLAIMED: https://github.com/ggml-org/llama.cpp/issues/23251 — accessed 2026-07-16]. It is a ROCm-path observation, not RADV; relevant to our idle-power/GTT notes but not to draft tuning. No RADV+gfx1201+MTP-specific draft bug was found.

## Conflicts & unknowns

- **p_min default 0.75f vs 0.0f** — resolved by fetching common.h at our commit: **0.0f** at b9950 (see Finding 1 note).
- **Exact PR for 0.9→0.75 and 0.75→0.0** — not line-verified (0.75→0.0 attributed to #23269 via web search, medium confidence). End state at our commit is verified, so this does not affect any recommendation.
- **Verbatim `common/arg.cpp` help block** — the file truncated on fetch; help-string wording taken from the auto-generated `tools/server/README.md`. Low impact.
- **Whether re-enabling p_min for MTP has landed since b9950** — the TODO was open as of the fetched master; not tracked forward. Irrelevant unless we upgrade past b9950 (see below).
- **Depth** — our n_max sweep is at ctx 4096; MTP's benefit grows with depth (per `docs/analysis/2026-07-11-2200-deep-context-35b.md`), so the optimal n_max at ~133k is not established here.

## Actionable for this repo

1. **Do not add `--spec-draft-p-min` to any MTP config.** It is inert on `--spec-type draft-mtp` (Finding 4). Adding it would be cargo-cult tuning and would falsely imply the draft is confidence-gated. If anyone saw "0.75" as a would-be setting, note it is also a stale default — our build's is 0.0.
2. **If we want to tune MTP draft depth, sweep `--spec-draft-n-max`** — the *only* live lever (Finding 5). `bench/engine-bench/serve_llamacpp.sh` already accepts `EXTRA_ARGS`, so `EXTRA_ARGS="--spec-draft-n-max N"` works with no code change. Candidate grid: {2, 3, 4}; the default 3 is at the shallow-ctx peak, but re-check at ~133k where MTP's depth benefit shifts the optimum.
3. **Document the default explicitly** in `serve_llamacpp.sh` header comment: MTP inherits `n_max=3, n_min=0, p_min=0.0` at b9950; p_min unused on MTP. Prevents the next person re-deriving this. (Proposed one-line comment; not applied — needs approval per repo rules.)
4. **Watch for a llama.cpp upgrade past b9950** re-enabling p_min for MTP (PR #22673 TODO). If it lands, an adaptive p_min could beat a static n_max on mixed-difficulty decode — worth an A/B at that point, not before.
5. **Ties into the open pp×MTP item** (the hardest-tasks campaign correction): Finding 6 confirms verification applies penalties, so the campaign's "pp rejects drafts" mechanism is *code-plausible* but *empirically wrong at small pp* per our probe — the cost is host-side sampler compute. Cite this report there.

## Sources

- llama.cpp `common/common.h` @**961e4b26a** (our build b9950) — https://raw.githubusercontent.com/ggml-org/llama.cpp/961e4b26a/common/common.h — accessed 2026-07-16 — Tier 1 — p_min/n_max/n_min defaults at our exact commit (0.0f / 3 / 0).
- llama.cpp `common/common.h` @b4500, @b6000 — https://raw.githubusercontent.com/ggml-org/llama.cpp/b6000/common/common.h — accessed 2026-07-16 — Tier 1 — default history (0.9f → 0.75f).
- llama.cpp `common/speculative.cpp` (master) — https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/speculative.cpp — accessed 2026-07-16 — Tier 1 — p_min early-stop semantics; MTP stops on n_max; n_min discard.
- llama.cpp `common/sampling.cpp` (master) — https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/sampling.cpp — accessed 2026-07-16 — Tier 1 — verification runs full sampler chain (penalties+temp).
- llama.cpp `tools/server/README.md` (master) — https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md — accessed 2026-07-16 — Tier 1 — shipped help text / defaults (p_min 0.00, n_max 3, n_min 0).
- PR #22673 "llama + spec: MTP Support" (+ .diff) — https://github.com/ggml-org/llama.cpp/pull/22673 — accessed 2026-07-16 — Tier 1 — p_min unwired on MTP (post-merge TODO); greedy top_k=1.
- PR #22397 "spec : refactor params" — https://github.com/ggml-org/llama.cpp/pull/22397 — accessed 2026-07-16 — Tier 1 — nested `common_params_speculative_draft` struct.
- Issue #23251 "MTP gguf models do not release the GPU load" — https://github.com/ggml-org/llama.cpp/issues/23251 — accessed 2026-07-16 — Tier 1 — gfx1201/R9700 MTP idle-load report.
- Discussion #23809 (p_min cumulative-product proposal) — https://github.com/ggml-org/llama.cpp/discussions/23809 — accessed 2026-07-16 — Tier 2 (flagged) — no maintainer numeric tuning guidance; classic path only.
- Discussion #21043 "RDNA4 Llama Experiments (R9700)" — https://github.com/ggml-org/llama.cpp/discussions/21043 — accessed 2026-07-16 — Tier 2 (anecdotal, flagged) — community MTP acceptance-vs-depth numbers, directionally consistent with Finding 7.
- Local: `bench/runs/2026-07-16-0927-mtp-sampler-probe/results.jsonl` + `meta.txt` — MEASURED-BY-US — n_max sweep + pp mechanism probe (b9950, R9700).
