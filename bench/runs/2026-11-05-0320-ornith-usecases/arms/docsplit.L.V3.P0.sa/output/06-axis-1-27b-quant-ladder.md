## Axis 1 — the 27B quant ladder (and the KV confound, finally bounded)

**The finding: a bounded null.** Paired-by-task Δ vs `Q4_K_M` (MEASURED, from the digest):

| cell | Δ per task | meanΔ | sd | t | verdict |
|---|---|--:|--:|--:|---|
| Q4_K_XL (f16) | −22, −3, −4, −15, +1 | **−8.5** | 9.6 | −1.98 | not significant |
| Q5_K_M (q8_0) | −1, −1, −13, +6, +1 | **−1.8** | 7.0 | −0.58 | not significant |
| Q6_K (q8_0) | −1, +12, −2, +5, −2 | **+2.6** | 6.1 | +0.94 | not significant |
| 35B-A3B (f16) | −3, −8, −4, −14, +4 | **−5.1** | 6.7 | −1.70 | not significant |

- **No paired Δ clears \|t\| > 2.776. Every 95% CI overlaps every other.** Q4_K_XL's −8.5 is the largest and still fails; it is **unresolved**, not disproven.
- **The KV confound is now bounded — this is new.** `README` §2 warned that Q5_K_M and Q6_K were forced onto **q8_0** KV to fit ctx 163840, confounding weight precision with KV precision. The budget extension re-ran **Q5_K_M at f16** at the same budget, supplying the missing control: **f16 74.3 [67.9, 80.8] vs q8_0 76.5 [71.3, 81.7]** — a 2.2-pt gap *in favour of the lower-precision KV*, i.e. noise. **INFERRED:** the KV split does not explain the ladder, and the prior campaign's ≤5% f16-vs-q8 rule holds at 128k depth on this workload.
  - **CLAIMED corroboration:** llama.cpp PR [#7412](https://github.com/ggml-org/llama.cpp/pull/7412) (closed/obsolete, CUDA) measured V-cache q8_0 at PPL **6.232771** / KLD **0.000743** against f16's **6.232196** / **0.000189** — a KV-quantisation effect ~3 orders of magnitude below typical weight-quantisation KLD. Different model, different backend; directional support only.
- **Why a null here is plausible rather than suspicious.** External Tier-1 numbers say the Q4→Q6 fidelity gain is *real but small*: on Mistral-7B, median KL-divergence falls **Q4_K_M 0.0075 → Q5_K_M 0.0043 → Q6_K 0.0032** (CLAIMED, [Artefact2 GGUF benchmark gist](https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9), imatrix on wiki.train, KLD on wiki.test). More than halving KLD is meaningful in token-distribution terms — but there is **no Tier-1 table mapping that to coding pass-rates**, and our resolution is ≳12 pts. **INFERRED:** a null at this resolution is exactly what a small-but-real fidelity gain would produce. Do not read it as "precision is free".
- **The cost side is not null.** Q6_K costs **+36% wall time** over Q4_K_M (212.6 s vs 156.9 s) and **−29% decode** (32.6 vs 46.1 t/s) for a Δ of +2.6 pts, ns.

![Quant ladder to quality, per task](charts/detailed/d2_quant_quality.svg)

> Kept inline because it is the direct picture of the null: the per-task lines cross each other. If precision mattered at this resolution the lines would rise together. MEASURED.

**Practical consequence (INFERRED):** on this workload there is no evidence to pay for Q5_K_M or Q6_K, and no evidence they are pointless. If you are choosing today, choose on speed and VRAM headroom — those are measured and large — not on the quality ladder, which is not.

---

