## Axis 3 — the 35B-A3B sampling sweep: the vendor was right

Five sampling points on the 35B-A3B, all at budget 16384, all on the identical prompt. Three form a clean single-variable temperature axis (everything else pinned at Qwen's coding recipe); two are vendor presets carried whole (which move temperature **and** presence_penalty together, so they are labelled points, not axis points).

| cell | temp | top_p | top_k | pp | TS % | rep sd | judge/5 | decode t/s | **Δ vs `t06` (within-model, paired)** | source of the recipe |
|---|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
| `a3b-…-rb16384` (**`t06`**) | **0.6** | 0.95 | 20 | 0.0 | **77.5** | 11.1 | 3.3 | 120.1 | — (baseline) | **Qwen: "thinking, precise coding"** |
| `a3b-…-t03` | 0.3 | 0.95 | 20 | 0.0 | **70.0** | 11.2 | 3.1 | 120.2 | −7.5, t=−2.60, **ns** | **nobody** — a folklore probe |
| `a3b-…-t10` | 1.0 | 0.95 | 20 | 0.0 | **68.4** | 12.1 | 3.1 | 115.7 | −9.1, t=−1.11, ns | temp from Qwen "thinking, general" |
| `a3b-…-qwen-gen` | 1.0 | 0.95 | 20 | **1.5** | **62.1** | 13.5 | 3.0 | **78.1** | **−15.4, t=−3.41, SIGNIFICANT** | Qwen: "thinking, general" (whole preset) |
| `a3b-…-unsloth-reason` | 1.0 | **1.0** | **40** | **2.0** | **63.0** | **16.3** | **2.7** | **72.6** | −14.5, t=−1.84, ns | **Unsloth card only** — Qwen does not document it |

> **⚠ CORRECTED 2026-07-16 — this table's Δ column was re-baselined, and one verdict flipped.**
> It previously tested every sampling cell against **`Q4_K_M` — a different model** (27B dense vs 35B
> MoE), making each "sampling" verdict a cross-model comparison. `aggregate.py` now takes
> **`--baseline`** (further-test #3, done; re-analysis, no GPU time) and the column above is
> `--baseline a3b-d128-f16-rb16384`, i.e. **the same model at the vendor's coding temperature**.
> **What changed: `t03` was published as `−8.3, t=−4.11, SIGNIFICANT` and is now `−7.5, t=−2.60,
> NOT significant`** (crit 2.776, n=5 tasks). *"Temperature 0.3 is significantly worse"* was an
> **artifact of the wrong baseline** and is hereby withdrawn. Only the whole `qwen-gen` **preset**
> survives as significant. Regenerate: `python3 aggregate.py --baseline a3b-d128-f16-rb16384`.

**What the sweep shows:**

- **Qwen's documented coding recipe (temp 0.6 / pp 0.0) is the best point on every metric simultaneously** — TS 77.5, judge 3.3, full decode speed. It is not a coincidence that the vendor's number wins; it is the number the model was tuned for. (CLAIMED, verified: the [Qwen3.6-35B-A3B card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) lists `temperature 0.6 / top_p 0.95 / top_k 20 / min_p 0.0 / presence_penalty 0.0` and labels it for **"precise coding tasks"**; [Unsloth's Qwen3.6 docs](https://unsloth.ai/docs/models/qwen3.6) carry the same values in their thinking-mode table, without that coding-specific label. The "precise coding" attribution is Qwen's.)
- **Temperature 0.3 is folklore, and it bought nothing — but it is NOT resolvably worse.** It is documented by **neither** vendor. It scored **70.0** and **was no steadier than 0.6** (rep sd **11.2 vs 11.1**), so the intuition "lower temperature = more deterministic = more reliable code" fails on its own terms: it bought **no stability**. ⚠ **CORRECTED:** the claim that it *cost quality significantly* does not survive re-baselining (−7.5, t=−2.60, ns — see the box above). The honest reading is **"temp 0.3 is not documented, buys no stability, and shows no measurable gain"** — a reason not to bother, not evidence of harm.
- **The two presence_penalty presets are the campaign's quality floor — but pp is NOT established as the cause.** 62.1 / 63.0 TS, judge 3.0 / **2.7** (the worst of 14 cells), rep sd 13.5 / **16.3** (the worst), decode **78.1 / 72.6**. Both are *documented vendor settings* — just not for this job: Qwen's pp 1.5 belongs to **"thinking, general"**, and Qwen explicitly drops pp to **0.0** for precise coding. Unsloth's own docs carry the same caveat — a higher presence_penalty "may result in slight decrease in performance" (CLAIMED, [unsloth.ai/docs/models/qwen3.6](https://unsloth.ai/docs/models/qwen3.6)).
  - ⚠ **CORRECTED — the causal attribution to `presence_penalty` was wrong.** Both pp>0 cells **also run temperature 1.0**; `unsloth-reason` additionally moves `top_p 0.95→1.0` and `top_k 20→40`. `t10` (temp 1.0, pp 0.0) is the single-variable control and it was **sitting in the data unused**. Splitting the preset against it (MEASURED, `--baseline a3b-d128-f16-rb16384-t10`): **pp alone −6.3, t=−0.54, ns** · **temp alone −9.1, t=−1.11, ns** · **both together −15.4, t=−3.41, SIGNIFICANT**. The **preset as a whole** is significantly worse than the coding recipe; it splits ~**−9 temp / −6 pp** and **neither component is resolvable**. "presence_penalty is the campaign's floor" is largely a **temperature-1.0 side effect**.
  - **The advice survives, the mechanism does not:** *applying a vendor preset from the wrong section is worse than any quantisation choice in this campaign.* The presets cost ~15 pts; the entire Q4→Q6 ladder spans 11 pts and is not resolvable. **Sampling hygiene dominates quant shopping** — but pick the recipe **whole**, and do not attribute the damage to any one knob.
- **The Unsloth-only preset is the single worst configuration tested** — and it has the weakest provenance. Our research doc verified that Qwen's card lists **three** parameter sets while Unsloth's lists **four**, adding this `top_k 40 / top_p 1.0 / min_p 0.0 / pp 2.0` set while attributing the whole block to the Qwen team. **INFERRED:** treat Unsloth-only recipes as unattributed until Qwen documents them. (Its Δ −14.5 is *not* significant at t=−1.84 — large and unresolved.)

### The penalty-sampler tax — ⚠ MECHANISM CORRECTED 2026-07-16 (was: "the presence_penalty × MTP interaction")

**The decode effect is real. The dominant cause is a fixed host tax, not draft rejection, and there is no MTP interaction** (rejection is a real but *minority* contributor at high presence_penalty — see the depth note).

**MEASURED, the effect (unchanged), across seven 35B cells:**

| presence_penalty | cells | decode t/s |
|---|---|---|
| **0.0** | rb4096, rb16384, rbmax, t03, t10 | 120.1 · 120.1 · 119.3 · 120.2 · 115.7 |
| **1.5** | qwen-gen | **78.1** |
| **2.0** | unsloth-reason | **72.6** |

> **⚠ This section previously read:** *"MTP speculative decoding only wins when the sampled token
> matches the draft's proposal. `presence_penalty` re-weights logits after the draft was produced, so
> it systematically rejects draft tokens… any sampler that perturbs logits silently taxes every MTP
> deployment. This is untested — one MTP-on/off × pp-on/off run answers it."*
>
> **It was not untested — it was already answerable from this campaign's own data.** `draft_n` and
> `draft_n_accepted` are present on **210/210** rows of `out/outputs.jsonl` (`capture.py` stores
> llama.cpp's whole `timings` blob); the digest simply never surfaced them. **Rejection does not
> explain the drop:**
>
> | cell | temp | pp | **draft acceptance** | decode |
> |---|--:|--:|--:|--:|
> | `t10` | 1.0 | 0.0 | **81.5%** | 115.7 |
> | `qwen-gen` | 1.0 | 1.5 | **77.4%** | **78.1** |
>
> Acceptance moves **4 points**; decode drops **32%**. Backing out the MTP geometry (**k = 3.00
> draft tokens/pass, exactly, in every one of the 14 cells** — which validates the model; tokens
> emitted per verify pass = 3·acceptance + 1), pure rejection predicts `qwen-gen` at **111.6 t/s**.
> It measures **78.1**. **Acceptance explains ~11% of the drop.** The rest is the verify pass itself
> getting **43% more expensive** (29.8 → 42.5 ms/pass) — the fixed host tax, not rejection.

**The actual mechanism (MEASURED — but by OTHER measurements, see the caveat below):** enabling **any**
penalty sampler adds a **fixed ~2 ms/token of host work**, and draft acceptance is untouched. The
decisive cell sets `presence_penalty = 0.01` — too small to change any token — and the model emits a
**sha1-identical reply** from **identical 585/404 draft counts**, and still loses **29% of decode**.
`min_p 0.05`, an equally inert *non-penalty* sampler, costs **nothing**.

| config | step time (pp off → on) | **Δ host CPU** | decode | damage |
|---|---|--:|---|--:|
| **27B dense**, MTP on | 16.97 → 18.43 ms | **+1.97 ms/tok** | 58.9 → 54.2 | **−7.9%** |
| **35B MoE**, MTP **off** | 9.30 → 11.17 ms | **+2.07 ms/tok** | 107.6 → 89.5 | **−16.8%** |
| **35B MoE**, MTP **on** | 6.21 → 8.69 ms | **+1.95 ms/tok** | 161.1 → 115.1 | **−28.6%** |

- **There is no MTP × pp interaction — it is Amdahl's law.** One constant tax (+~2 ms/tok) lands on
  every token regardless of MTP. MTP's only role is to make the step *short* (6.2 ms), so the same
  constant eats a bigger fraction. The 27B looks immune purely because its step is 17 ms.
  **The faster your decode, the worse `presence_penalty` looks.**
- **Not "CPU-bound".** The server uses **0.64 → 0.69 of 12 threads** — nowhere near saturated. The
  host work sits on the **critical path of a serial loop** (GPU forward → host sample → GPU forward),
  so ~2 ms of single-threaded sampler time lands directly on wall-clock. The GPU then idle-waits and
  the DPM governor drops sclk/power — **the low clock (~58% sclk, ~62% power in this campaign's
  `gpu_*.csv`) is a consequence of the stall, not its cause.**
- **The generalization was too strong.** It is *not* "any sampler that perturbs logits taxes every MTP
  deployment" — `min_p` perturbs and is free, and `pp=0.01` perturbs nothing and is not. It is:
  **enabling any penalty sampler costs a fixed per-token host cost, worst on fast GPUs / fast models /
  speculative decoding, and shrinking on faster host CPUs.**
- **The session-degradation confound is excluded.** These two pp cells were the last of a ~5-hour
  session, so "the box was tired" was live. The follow-up ran them **fresh and interleaved** and
  reproduced the tax at full magnitude.

> **⚠ CAVEAT — these are OTHER measurements, NOT reproducible within this test set.** The mechanism
> comes from a **separate probe** (a shallow scout at ctx 4096 **and** a depth-confirm at the campaign's
> ~132.9k / budget 16384 operating point), versus this campaign's n=15/cell graded design. **No number
> from it may be substituted into a table here.** What it establishes:
> - **The pure branch tax is ~2 ms/token at BOTH depths** (shallow +1.95/+2.07; deep +1.3–1.9, from
>   byte-identical pp0-vs-pp0.01 pairs). **It does not grow with depth.**
> - **This campaign's implied +4.16 ms/tok is a pp-1.5 figure**, and pp 1.5 *does* genuinely lower MTP
>   acceptance (83%→66% at depth) — so it stacks the ~2 ms fixed tax **plus** real draft rejection. The
>   campaign's original "pp rejects drafts" instinct was **partly right for pp 1.5** (the minority
>   component) but wrong that rejection was the *whole* effect; at pp 0.01 there is **zero** rejection
>   and the tax is everything. **The +2-vs-+4 gap is resolved and it was never depth-scaling.**
> - **Session degradation is excluded** — the depth-confirm ran fresh and reproduced the tax.
> Full detail, data and limits: **`docs/analysis/2026-07-16-0927-mtp-sampler-tax.md`**
> (data: `bench/runs/2026-07-16-0927-mtp-sampler-probe/`, `results.jsonl` + `results_depth.jsonl`).

**Two further corrections from the same probe, both relevant here:**

- **`--spec-draft-n-max 3` (llama.cpp's default) is already optimal** — n-max 8 collapses to 80 t/s,
  *worse than turning MTP off*. This campaign never varied it; the default was the right choice.
- ⚠ **MTP is NOT output-preserving.** At a fixed seed, MTP-on and MTP-off emit **different text**
  (batch-shape change → floating-point non-associativity; the known mechanism — CLAIMED, vLLM
  [#27433](https://github.com/vllm-project/vllm/issues/27433), open, already cited below). **All 14
  cells here are MTP-on, so nothing within this campaign is confounded by it** — but "MTP is free
  speed" is false in principle, and an MTP-off arm would not reproduce these replies.

![Fluctuation](charts/fluctuation.svg)

> Kept inline: it visualises the axis-3 result the mean hides — the pp>0 cells are not merely lower, they are the widest-swinging cells in the campaign, and temp 0.3 narrowed nothing. MEASURED, all 14 cells.

---

