## Recommended config

**For an agentic loop that can retry and let the toolchain judge (the recommended default):**

```bash
# 35B-A3B — quality indistinguishable from the 27B ladder (delta -5.1, t=-1.70, ns),
# 2.6x faster to a full answer (60.9s vs 156.9s for Q4_K_M; 3.5x vs Q6_K's 212.6s),
# so best-of-3 costs less wall time than ONE Q6_K reply.
# Pair it with best-of-N + tsc/eslint/vitest picking the winner (hard@R 20% vs hard@1 7%).
bash bench/engine-bench/serve_llamacpp.sh \
  MODEL=Qwen3.6-35B-A3B-UD-Q4_K_M.gguf \
  BACKEND=vulkan MTP=on KV=f16 \
  EXTRA_ARGS="-c 163840 -ub 2048 -b 4096 -fa on"
# sampling: temp 0.6 / top_p 0.95 / top_k 20 / min_p 0 / presence_penalty 0  <- Qwen's precise-coding recipe
# reasoning budget: 4096   (16384 buys +0.3 pts on the 27B for +60s; unlimited caused the only runaway)
```

**For a one-shot pipeline that ships whatever comes out** (the floor matters more than the mean — the 35B's worst-of-3 is **11**, the 27B Q4_K_M's is **57**):

```bash
bash bench/engine-bench/serve_llamacpp.sh \
  MODEL=Qwen3.6-27B-MTP-Q4_K_M.gguf \
  BACKEND=vulkan MTP=on KV=f16 \
  EXTRA_ARGS="-c 163840 -ub 2048 -b 4096 -fa on"
# same sampling; reasoning budget 4096 (paired delta to 16384 = +0.3 pts, sd 1.8, t=0.37 — a tight null)
```

**Explicitly do not:**

- **Do not set `presence_penalty > 0` for coding** — for **two independent reasons**. (1) *Speed:* it switches on the penalties sampler, a **fixed ~2 ms/token host tax** that costs up to ~30% of decode on the fast MoE (worst under MTP; refuted mechanism, real effect — see the tax section). (2) *Quality:* the whole general-mode preset that carries it is ~15 pts worse than the coding recipe. ⚠ **Attribution note:** the quality loss is temp+pp *jointly*; pp *alone* is not resolvably worse (−6.3, ns). Use Qwen's coding recipe **whole** (pp 0.0); do not go hunting for a "good" pp value — any pp≠0 pays the speed tax for no established quality gain.
- **Do not lower temperature below 0.6 to "stabilise" output.** Temp 0.3 is documented by neither vendor, bought **no** stability (rep sd 11.2 vs 11.1), and showed **no resolvable quality change** (−7.5, t=−2.60, ns — the earlier "significant" reading was a wrong-baseline artifact, withdrawn 2026-07-16). No reason to bother, no evidence of harm.
- **Do not pay for Q5_K_M or Q6_K on this workload** (INFERRED from the null plus the cost): +36% wall time at Q6_K for Δ+2.6 pts, ns.
- **Do not use `--reasoning-budget -1`** at this depth: it changed 1 reply in 15, and that reply ran away.

⚠ **No recommendation here is safe for unattended use until the GTT spill is characterised.**

---

