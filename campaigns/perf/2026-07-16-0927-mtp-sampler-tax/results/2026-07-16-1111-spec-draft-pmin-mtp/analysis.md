# spec-draft-p-min on the MTP path — is it live, and can it reduce 35B fluctuation?

- **Date:** 2026-07-16 · **Box:** R9700 (gfx1201) · llama.cpp **b9950** (`961e4b26a`), Vulkan/RADV
- **Run dir:** `bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/` (`probe.sh` → `results.jsonl`; `probe2.sh` → `results2.jsonl`)
- **Fixed:** 35B-A3B-UD-Q4_K_M & 27B-MTP-Q4_K_M, `--spec-type draft-mtp`, ctx 4096, KV f16, `-ub 2048 -b 4096 -fa on -ngl 99 -np 1`, temp 0.6 / top_p 0.95 / top_k 20, n_max=3. Shallow single-prompt probe (~24-tok prompt, max_tokens 600).

## TL;DR

1. **`--spec-draft-p-min` IS live on the MTP path at b9950 — this refutes the source-reading in `docs/research/2026-07-16-1016-spec-draft-p-min-mtp.md`.** [MEASURED] It gates draft depth exactly as documented: raising p_min cuts drafted-tokens/pass 2.98 → 0.46, drives acceptance 69% → 100%, changes the emitted tokens, and *lowers* decode (159.9 → 106.5 t/s on the 35B). The research doc and the `serve_llamacpp.sh` comment both say "unwired for MTP" — **both are wrong for this build and must be corrected.**
2. **The user's hypothesis — p_min lowers 35B fluctuation — is NOT supported.** [MEASURED] Across seeds 42–47, every config (base, p_min 0.9, p_min 0.99, and a min_p 0.1 control) produced **6 distinct replies out of 6** on both models. p_min does not collapse the output distribution toward a mode. The one dissenting signal (35B reply-length sd falling 91 → 38) is confounded and unresolved at n=6 (see below).
3. **Mechanically, the hypothesis is backwards.** [INFERRED] Higher p_min means *less* drafting, i.e. *more* reliance on plain target sampling — the opposite of "more greedy/deterministic". A draft-depth throttle cannot make the accepted stream more deterministic, because llama.cpp accepts a draft token only if the target sampler would have produced it anyway (distribution-exact acceptance, `common/sampling.cpp`).
4. **Per the user's conditional** ("if significant, do 27B; else no"): p_min *is* a significant knob (speed/output), so 27B was tested. It shows the same — live but non-narrowing.

## Axis 1 — is p_min live on MTP? (`results.jsonl`, 35B, seed 42, MEASURED)

| p_min | draft tok/pass | acceptance % | decode t/s | reply sha1 | vs baseline |
|--:|--:|--:|--:|--|--|
| baseline (0.0) ×2 | 2.98 | 69.1 | 159.9 / 159.2 | `30303b…` (both) | reference (determinism holds) |
| 0.5 | 2.10 | 82.1 | 146.9 | `d60923…` | changed |
| 0.75 | 1.28 | 92.1 | 129.0 | `537f92…` | changed |
| 0.9 | 1.05 | 98.7 | 125.9 | `d7c3a5…` | changed |
| 0.99 | 0.46 | 100.0 | 106.5 | `b0f369…` | changed |

**Reading:** textbook p_min behaviour. It is a *draft-time early-stop on the draft's confidence*: the higher the threshold, the sooner the MTP draft stops proposing, so fewer speculative tokens per pass, higher per-token acceptance, and — because MTP's speed comes from *accepting several tokens per pass* — lower decode. Each level realigns RNG consumption, so the sampled reply changes (same mechanism seen for `n_max ≥ 4` in the 0927 probe). **Parse control:** the launched command line contained `--spec-draft-p-min 0.99` and the server started and behaved differently → the flag is genuinely wired, not silently dropped.

**Why this contradicts the research doc:** that report read PR #22673's post-merge TODO ("re-enable `--spec-draft-p-min` for mtp") and master `speculative.cpp` (MTP stops on `n_max`) and concluded p_min is inert on MTP. Our build `961e4b26a` behaves otherwise. Either the MTP path in this build consults p_min (re-enabled since, or the TODO referred to something narrower), or the master snapshot the subagents fetched differs from our commit. **Empirics on our build govern (iron rules 2, 7).** Source archaeology is secondary; the measured effect is unambiguous.

## Axis 2 — does p_min reduce fluctuation? (`results2.jsonl`, seeds 42–47, MEASURED)

**Distinct replies out of 6 seeds** — the decisive metric. If p_min narrowed the output distribution, high-p_min cells would repeat (distinct < 6):

| config | distinct/6 | acceptance % | draft tok/pass | decode t/s | reply-chars sd (proxy) |
|---|:--:|--:|--:|--:|--:|
| 35B base | **6/6** | 63.4 | 2.98 | 154.3 | 91 |
| 35B p_min 0.9 | **6/6** | 98.1 | 0.98 | 123.2 | 63 |
| 35B p_min 0.99 | **6/6** | 99.8 | 0.48 | 105.6 | 38 |
| 35B min_p 0.1 (control) | **6/6** | 65.4 | 2.98 | 156.2 | 66 |
| 27B base | **6/6** | 63.4 | 2.98 | 58.3 | 86 |
| 27B p_min 0.9 | **6/6** | 97.9 | 0.91 | 44.1 | 83 |

- **No collapse anywhere.** Full 6/6 diversity at every p_min, including p_min 0.99 where the 35B is barely drafting. If p_min made generation more deterministic, this is where it would show — it does not.
- **The lone dissenting signal, and why I am not reading it as a win:** the 35B reply-length sd falls monotonically 91 → 63 → 38 with p_min (absent on the 27B: 86 → 83). Three reasons it does not establish the hypothesis: (a) **n=6** — an sd from 6 samples carries ~±30% error, so 91/63/38 overlap heavily and clear no significance bar; (b) **confounded** — every reply hit the 600-token cap, so this is char-count *at fixed token count*, a token→char consistency artifact, not a natural-length or quality spread; (c) **wrong metric** — length variance is not the quality rep-sd the campaign's "fluctuation" refers to. The min_p 0.1 control (a genuine distribution-truncating knob) sits at sd 66, between base and p_min 0.9 — i.e. the length-sd proxy does not even cleanly separate a real distribution knob from p_min, so it cannot carry a fluctuation claim.
- **Interpretation.** [INFERRED] The 6/6-distinct result plus distribution-exact acceptance says p_min *reshuffles which reply a seed lands on* (RNG realignment) without narrowing the distribution → fluctuation (variance across seeds) is preserved. The user's instinct that p_min *does something* was correct; that the something is *fluctuation reduction* is not supported by these data.

## What p_min IS for, and the honest limits

- **It is a decode-speed / acceptance-purity knob, and it costs speed here.** On this shallow workload every positive p_min *lowered* decode (fewer speculative tokens/pass). It is the adaptive cousin of `--spec-draft-n-max` (the 0927 probe's static draft-depth knob, which peaks at n_max 2–3). If anything, the actionable MTP lever remains n_max.
- **Limits of this probe:** shallow (ctx 4096), single easy prompt, n=6 seeds, no quality scorer. It is decisive on *applicability* (p_min live) and on *no-collapse* (6/6 distinct), but it cannot measure the campaign's actual quality rep-sd at 133k depth. A definitive fluctuation verdict needs the scored harness (below), which the current evidence does **not** justify commissioning — both the clean metric and the mechanism point the same way.

## Actions

1. **Correct `docs/research/2026-07-16-1016-spec-draft-p-min-mtp.md`** — its central claim (p_min inert on MTP) is empirically false on b9950. Add an erratum with this run's table; downgrade the "do not set it, it's inert" recommendation to "it works and gates draft depth, but it *costs* decode on our workload and does not reduce fluctuation."
2. **Correct the `serve_llamacpp.sh` header comment** (added by the parallel session) — it states "`--spec-draft-p-min` is UNWIRED for MTP". Replace with the measured behaviour.
3. **Do NOT set `--spec-draft-p-min` for throughput** — it lowers decode here. It is not a fluctuation remedy.
4. **If fluctuation must be settled definitively** (only if it becomes decision-blocking): scored run, not a diversity proxy — 1–2 configs (base vs p_min 0.9) × **≥10 seeds** × the campaign's hard tasks at real depth, scored with `score_typescript.py`, comparing rep-sd. That is the only design that measures *quality* fluctuation. Recommend NOT running it now: the coarse metric and the mechanism agree, and expected value is low.

## Provenance
- `results.jsonl` / `results2.jsonl` — MEASURED, this run (b9950, R9700). Harness reused verbatim from `bench/runs/2026-07-16-0927-mtp-sampler-probe/row.py` + `serve_llamacpp.sh`.
- Distribution-exact acceptance — CLAIMED, `common/sampling.cpp` (`common_sampler_sample_and_accept_n`), via the 1016 research doc.
- n_max static-knob comparison — MEASURED, `bench/runs/2026-07-16-0927-mtp-sampler-probe/`.
