#!/usr/bin/env python3
"""kld_probe.py — quantization-fidelity KLD probe (campaign 2026-11-09-27b-arms-kld, WS3).

Compares a served checkpoint's next-token distribution against the local FP8 reference
(Qwen__Qwen3.8-27B-FP8@017b9c7a, D8 — bf16 unavailable on this stack) and reports mean
per-position KL in nats/tok with a cluster-bootstrap CI.

Method (locked by the WS3 research — research/ws3-kld-r1.md / r2.md source every choice):
  mode      paired greedy continuation: reference and arm generate N tokens at temp 0 with
            logprobs=20; positions pair WHILE THE GENERATED TOKENS MATCH (contexts then
            identical by construction); the first-divergent position IS included (its
            context is still identical), the rest of that prompt is dropped. Radiance
            never returns prompt logprobs (1.17.0 oai.cpp: "never leave the card"), so
            prompt-scoring cannot be the uniform campaign mode — it stays an optional
            labeled bonus pass on sly-served pairs (r2 §2).
  KL        per position, sly kv4/kl_compare.py verbatim — a LOWER BOUND:
              KL̂_i = max(0, Σ_{t∈ref top-20} p_t·(r_t − a_t) + rt·ln(rt/at))
            a_t = arm top-20 logprob; token missing from arm top-20 ⇒ floor (the arm's
            minimum top-20 logprob); rt = max(ε, 1−Σref), at = max(ε, 1−Σarm); ε=1e-9.
  CI        cluster bootstrap (block = prompt) B=2000, percentile 95 % (headline);
            pooled 1.96·SD/√n (sly convention) reported alongside as cross-check
            (r2 §3: pooled is ~1.46× too narrow at intra-text ρ≈0.3).
  extras    paired dNLL (r_{x_i} − a_{x_i}), top-1 agreement over all generated positions,
            mean top-20 coverage (ref and arm), median/mean first-divergent position,
            per-1k segments of the pooled KL.
  noise     the A-vs-B pair (same checkpoint, radiance 1.11.0 vs 1.17.0) is the
            engine-version noise floor; a reference self-run bounds boot noise (r2 §4).

TDD: bench/perf/test_kld_probe.py (synthetic fixtures: exact KL vs hand-computed, floor,
clamp, tail bucket, pairing, cluster CI on known shapes). HTTP is stdlib urllib only (sly
convention). All arms share the Qwen3.8 tokenizer, so decoded token STRINGS key the
support (selftest asserts identical /tokenize ids ref-vs-arm first).

  python3 kld_probe.py selftest --url http://127.0.0.1:8000/v1 --model <served> [--out FILE]
  python3 kld_probe.py fetch    --url ... --model <served> --calibration prompts.jsonl --out FILE
  python3 kld_probe.py score    --ref ref.jsonl --arm arm.jsonl --label <arm> --out FILE

Calibration file = one JSON prompt per line: {"id": "p001", "src": "bench/workloads/
corpus/<path>", "char_cut": N} (src resolved against the repo root; the prompt is the
first char_cut chars of the file — raw text, NO chat template: templates differ between
engine families and would break pairing, r2 §1.2/§1.3).
"""
import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request

EPS = 1e-9            # sly kv4/kl_compare.py
TOP_K = 20            # OpenAI cap (radiance OPS.md; vLLM max_logprobs default)
N_MAX = 512           # generated tokens per prompt (r2 §5.3)
BOOT_B = 2000
SEG_K = 1000
PROBE_TEXT = "def kld_selftest_fixture(n):\n    return sum(i * i for i in range(n))\n" * 40


# ------------------------------------------------------------------ math core (unit-tested)
def _mass(entries):
    return sum(math.exp(lp) for _, lp in entries)


def kl_position(ref_top, arm_top):
    """KL(ref ‖ arm) at one position (sly kv4/kl_compare.py, a lower bound, clamped ≥ 0).

    ref_top: list of (token, logprob) — the REFERENCE top-20 (the support). arm_top:
    list of (token, logprob) — the arm's top-20. Returns (kl, ref_mass, arm_mass): kl in
    nats; masses = each side's top-20 coverage (the resolution statistic, r2 §4).
    """
    arm_map = dict(arm_top)
    floor = min(lp for _, lp in arm_top)
    ref_mass = _mass(ref_top)
    arm_mass = _mass(arm_top)
    rt = max(EPS, 1.0 - ref_mass)
    at = max(EPS, 1.0 - arm_mass)
    s = 0.0
    for tok, r in ref_top:
        a = arm_map.get(tok, floor)       # missing in arm top-20 ⇒ floor (lower bound)
        s += math.exp(r) * (r - a)
    s += rt * math.log(rt / at)           # lumped tail bucket
    return max(0.0, s), ref_mass, arm_mass


def pair_positions(ref_toks, arm_toks):
    """Pair generated positions while the tokens match; the first-divergent position is
    INCLUDED (its context is still identical on both sides). Returns
    (n_paired_including_divergent, divergent_index_or_None) (r2 §2, Mode Y′)."""
    n = min(len(ref_toks), len(arm_toks))
    for i in range(n):
        if ref_toks[i] != arm_toks[i]:
            return i + 1, i
    return n, None


def cluster_bootstrap_ci(blocks, n_boot=BOOT_B, seed=20261109):
    """Cluster bootstrap CI on the pooled per-position KL. blocks = list of per-prompt
    lists (resampling a prompt takes its whole paired block). Returns (mean, lo, hi)."""
    total = sum(len(b) for b in blocks)
    if total == 0:
        return (0.0, 0.0, 0.0)
    mean = sum(sum(b) for b in blocks) / total
    if len(blocks) == 1:
        return (mean, mean, mean)
    bsums = [sum(b) for b in blocks]
    sizes = [len(b) for b in blocks]
    nb = len(blocks)
    rng = random.Random(seed)
    draws = []
    for _ in range(n_boot):
        s, c = 0.0, 0
        for _i in range(nb):
            j = rng.randrange(nb)
            s += bsums[j]
            c += sizes[j]
        draws.append(s / c)
    draws.sort()
    lo = draws[max(0, int(0.025 * n_boot))]
    hi = draws[min(len(draws) - 1, int(0.975 * n_boot) - 1)]
    return (mean, lo, hi)


def pooled_ci(vals):
    """Pooled 1.96·SD/√n (sly convention; mildly optimistic — r2 §3). Returns (mean, lo, hi)."""
    n = len(vals)
    if n == 0:
        return (0.0, 0.0, 0.0)
    mean = sum(vals) / n
    if n == 1:
        return (mean, mean, mean)
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (n - 1))
    half = 1.96 * sd / math.sqrt(n)
    return (mean, mean - half, mean + half)


def segments(vals, k=SEG_K):
    """Per-k-position means of the pooled KL (depth-dependence diagnostic)."""
    out = []
    for start in range(0, len(vals), k):
        chunk = vals[start:start + k]
        out.append({"start": start, "n": len(chunk), "mean": sum(chunk) / len(chunk)})
    return out


# ------------------------------------------------------------------ fetch (one server)
def _post_json(url, path, payload, timeout=1800):
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-noauth"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _topk_entries(entries):
    """OpenAI top_logprobs list [{token, logprob, ...}] → ((token, lp) × ≤20, mass)."""
    top = []
    for e in entries or []:
        if not isinstance(e, dict) or "logprob" not in e or e.get("token") is None:
            continue
        lp = float(e["logprob"])
        if not math.isfinite(lp):
            continue
        top.append((e["token"], lp))
        if len(top) >= TOP_K:
            break
    return top, _mass(top)


def fetch(url, model, prompts, max_tokens=N_MAX, timeout=1800):
    """Greedy capture per prompt: POST /v1/completions {prompt, max_tokens, temperature 0,
    logprobs TOP_K}. prompts = list of (id, text). Returns one block per prompt:
    {"id", "toks": [generated token str...], "pos": [ (tok, [(token, lp) ≤20]) ... ],
     "error": str|None}."""
    blocks = []
    for pid, text in prompts:
        blk = {"id": pid, "toks": [], "pos": [], "error": None}
        try:
            out = _post_json(url, "/v1/completions",
                             {"model": model, "prompt": text, "max_tokens": max_tokens,
                              "temperature": 0, "logprobs": TOP_K}, timeout)
            lp = (out.get("choices") or [{}])[0].get("logprobs") or {}
            toks = lp.get("tokens") or []
            tops = lp.get("top_logprobs") or []
            if not toks:
                blk["error"] = "no generated tokens in response"
            for tok, entries in zip(toks, tops):
                top, _m = _topk_entries(entries)
                if top:
                    blk["pos"].append((tok, top))
            if len(blk["pos"]) != len(toks):
                blk["error"] = f"logprobs rows {len(blk['pos'])} != tokens {len(toks)}"
        except Exception as e:      # noqa: BLE001 — quarantined per prompt (rule 18)
            blk["error"] = f"{type(e).__name__}: {e}"
        blocks.append(blk)
    return blocks


# ------------------------------------------------------------------ live selftest (r2 §2)
def selftest(url, model):
    """First-boot gate per engine family (5 checks, r2 §2). Returns (ok, checks-dict).
    ok = check 1 (logprobs supported) — a refusal takes the arm OUT of the KLD pass,
    recorded with the reason (r2 §2.1). Check 3's tokenize ids are compared ref-vs-arm
    by the caller."""
    checks = {}
    # 1. completions logprobs:20 — own logprob + ≤20 alternatives per token
    try:
        r1 = _post_json(url, "/v1/completions",
                        {"model": model, "prompt": PROBE_TEXT, "max_tokens": 4,
                         "temperature": 0, "logprobs": TOP_K})
        lp = (r1.get("choices") or [{}])[0].get("logprobs") or {}
        toks = lp.get("tokens") or []
        tops = lp.get("top_logprobs") or []
        checks["logprobs20"] = bool(
            toks and tops and all(isinstance(x, list) for x in tops[:4])
            and all(1 <= len(x) <= TOP_K for x in tops[:4]))
    except Exception as e:      # noqa: BLE001
        checks["logprobs20"] = False
        checks["logprobs20_error"] = f"{type(e).__name__}: {e}"
    # 2. prompt_logprobs availability (INFORMATIONAL — the bonus pass, not the headline)
    try:
        r2 = _post_json(url, "/v1/completions",
                        {"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                         "temperature": 0, "prompt_logprobs": 1})
        checks["prompt_logprobs"] = bool((r2.get("choices") or [{}])[0].get("prompt_logprobs"))
    except Exception:           # noqa: BLE001 — refused (radiance) or unsupported
        checks["prompt_logprobs"] = False
    # 3. tokenize ids (caller asserts ref-vs-arm identity — tokenizer drift guard)
    try:
        r3 = _post_json(url, "/tokenize", {"model": model, "prompt": PROBE_TEXT})
        checks["tokenize_ids"] = r3.get("ids")
    except Exception as e:      # noqa: BLE001
        checks["tokenize_ids"] = None
        checks["tokenize_error"] = f"{type(e).__name__}: {e}"
    # 4. raw-distribution semantics: identical logprobs at temp 0 vs temp 1 (max_tokens 1)
    try:
        ra = _post_json(url, "/v1/completions",
                        {"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                         "temperature": 0, "logprobs": TOP_K})
        rb = _post_json(url, "/v1/completions",
                        {"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                         "temperature": 1.0, "logprobs": TOP_K})
        la = (ra.get("choices") or [{}])[0].get("logprobs") or {}
        lb = (rb.get("choices") or [{}])[0].get("logprobs") or {}
        checks["raw_logprobs"] = la.get("top_logprobs") == lb.get("top_logprobs")
    except Exception as e:      # noqa: BLE001
        checks["raw_logprobs"] = False
        checks["raw_logprobs_error"] = f"{type(e).__name__}: {e}"
    ok = bool(checks.get("logprobs20"))
    return ok, checks


# ------------------------------------------------------------------ score
def score(ref_blocks, arm_blocks, label, reference_note):
    """Paired greedy scoring: ref_blocks/arm_blocks = fetch() block lists, same order
    (same prompts). Per prompt: pair positions (token match, first-divergent included),
    KL at paired positions (r2 §3), dNLL of the generated token, top-1 over ALL generated
    positions. Returns the report dict (lower-bound KL + CIs + noise-floor extras)."""
    if len(ref_blocks) != len(arm_blocks):
        raise ValueError(f"prompt count mismatch (ref {len(ref_blocks)} vs arm {len(arm_blocks)})")
    kl_blocks, dnll_terms, top1_num, top1_den = [], [], 0, 0
    div_idx, n_paired, n_dropped, cov_ref, cov_arm, n_err = [], 0, 0, [], [], 0
    pooled_kls = []
    for rb, ab in zip(ref_blocks, arm_blocks):
        if rb.get("error") or ab.get("error"):
            n_err += 1
            continue
        ref_toks = [t for t, _ in rb["pos"]]
        arm_toks = [t for t, _ in ab["pos"]]
        n_paired_pos, div = pair_positions(ref_toks, arm_toks)
        if div is not None:
            div_idx.append(div)
        n_paired += n_paired_pos
        n_dropped += max(0, min(len(ref_toks), len(arm_toks)) - n_paired_pos)
        block_kls = []
        for i in range(n_paired_pos):
            rtok, rtop = rb["pos"][i]
            atok, atop = ab["pos"][i]
            kl, rm, am = kl_position(rtop, atop)
            block_kls.append(kl)
            cov_ref.append(rm)
            cov_arm.append(am)
            pooled_kls.append(kl)
            # dNLL: the generated token's logprob on each side (floor if absent, lower bound)
            rmap = dict(rtop)
            amap = dict(atop)
            rfloor = min(lp for _, lp in rtop)
            afloor = min(lp for _, lp in atop)
            dnll_terms.append(rmap.get(rtok, rfloor) - amap.get(atok, afloor))
        if block_kls:
            kl_blocks.append(block_kls)
        # top-1 over all generated positions (argmax of each side's top-20)
        for i in range(min(len(ref_toks), len(arm_toks))):
            rtop_i = dict(rb["pos"][i][1])
            atop_i = dict(ab["pos"][i][1])
            rmax = max(rtop_i.items(), key=lambda kv: kv[1])[0]
            amax = max(atop_i.items(), key=lambda kv: kv[1])[0]
            top1_den += 1
            if rmax == amax:
                top1_num += 1
    n = len(pooled_kls)
    if n == 0:
        raise ValueError("no paired positions (all prompts failed or empty)")
    mean, lo, hi = cluster_bootstrap_ci(kl_blocks)
    pmean, plo, phi = pooled_ci(pooled_kls)
    div_sorted = sorted(div_idx)
    return {
        "kind": "kld", "label": label,
        "reference": reference_note,
        "mode": "paired greedy continuation (temp 0, top-20, shared-prefix pairing, "
                "first-divergent position included)",
        "n_prompts": len(ref_blocks), "n_prompt_errors": n_err,
        "n_positions": n, "n_positions_dropped": n_dropped,
        "kl_nats_per_tok": round(mean, 6),
        "ci95_nats": [round(lo, 6), round(hi, 6)],
        "ci_method": "cluster bootstrap (block=prompt, B=2000, percentile 95%)",
        "pooled_ci_nats": [round(plo, 6), round(phi, 6)],
        "pooled_note": "pooled 1.96·SD/√n (sly convention) — cross-check, mildly optimistic (×~1.46)",
        "lower_bound_note": "KL is a lower bound: reference top-20 support, floor for tokens "
                            "missing from arm top-20, lumped tail bucket, clamped ≥ 0 "
                            "(sly kv4/kl_compare.py, ε=1e-9)",
        "dnll_nats_per_tok": round(sum(dnll_terms) / len(dnll_terms), 6) if dnll_terms else None,
        "top1_agreement": round(top1_num / top1_den, 5) if top1_den else None,
        "first_divergent_pos": {
            "mean": round(sum(div_sorted) / len(div_sorted), 1) if div_sorted else None,
            "median": div_sorted[len(div_sorted) // 2] if div_sorted else None,
            "n_diverged": len(div_sorted), "n_prompts": len(ref_blocks) - n_err,
        },
        "coverage_ref_mean": round(sum(cov_ref) / len(cov_ref), 5) if cov_ref else None,
        "coverage_arm_mean": round(sum(cov_arm) / len(cov_arm), 5) if cov_arm else None,
        "segments_per_1k": [{"start": s["start"], "n": s["n"],
                             "nats_per_tok": round(s["mean"], 6)} for s in segments(pooled_kls)],
        "noise_floors": ["A-vs-B pair = engine-version floor (same checkpoint, radiance 1.11.0 "
                         "vs 1.17.0)", "reference self-run bounds boot noise"],
    }


# ------------------------------------------------------------------ I/O
def _read_jsonl(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def _write_jsonl(blocks, path):
    with open(path, "w", encoding="utf-8") as f:
        for b in blocks:
            f.write(json.dumps(b) + "\n")


def load_prompts(path, repo_root):
    """Calibration prompts.jsonl → [(id, text)]; src resolved against repo_root."""
    out = []
    for row in _read_jsonl(path):
        fp = row["src"] if os.path.isabs(row["src"]) else os.path.join(repo_root, row["src"])
        text = open(fp, encoding="utf-8").read()[: int(row.get("char_cut", len(row["src"])))]
        out.append((row["id"], text))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("selftest", help="live first-boot gate (r2 §2, 5 checks)")
    sp.add_argument("--url", required=True)
    sp.add_argument("--model", required=True)
    sp.add_argument("--out", help="write the checks JSON here (default: stdout)")

    fp = sub.add_parser("fetch", help="greedy capture per calibration prompt")
    fp.add_argument("--url", required=True)
    fp.add_argument("--model", required=True)
    fp.add_argument("--calibration", required=True, help="prompts jsonl (id, src, char_cut)")
    fp.add_argument("--max-tokens", type=int, default=N_MAX)
    fp.add_argument("--repo-root", default=os.getcwd())
    fp.add_argument("--out", required=True)

    sc = sub.add_parser("score", help="paired greedy KL: reference vs arm")
    sc.add_argument("--ref", required=True)
    sc.add_argument("--arm", required=True)
    sc.add_argument("--label", required=True)
    sc.add_argument("--out", required=True)

    a = ap.parse_args()
    if a.cmd == "selftest":
        ok, checks = selftest(a.url, a.model)
        out = json.dumps(checks, indent=2) + "\n"
        if a.out:
            open(a.out, "w").write(out)
        else:
            print(out, end="")
        if not ok:
            print(f"SELFTEST FAILED (logprobs unsupported) — arm out of the KLD pass",
                  file=sys.stderr)
            sys.exit(1)
    elif a.cmd == "fetch":
        prompts = load_prompts(a.calibration, a.repo_root)
        t0 = time.time()
        blocks = fetch(a.url, a.model, prompts, max_tokens=a.max_tokens)
        _write_jsonl(blocks, a.out)
        errs = [b["id"] for b in blocks if b.get("error")]
        print(f"fetched {len(blocks)} prompts ({len(errs)} errored: {errs}) in "
              f"{time.time() - t0:.0f} s -> {a.out}")
        if len(errs) == len(blocks):
            sys.exit(1)
    elif a.cmd == "score":
        ref_blocks = _read_jsonl(a.ref)
        arm_blocks = _read_jsonl(a.arm)
        reference_note = ("Qwen__Qwen3.8-27B-FP8@017b9c7a (local FP8, D8 — bf16 unavailable "
                          "on this stack)")
        res = score(ref_blocks, arm_blocks, a.label, reference_note)
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)
            f.write("\n")
        print(f"{res['label']}: KL {res['kl_nats_per_tok']} nats/tok "
              f"[{res['ci95_nats'][0]}, {res['ci95_nats'][1]}] "
              f"(pooled {res['pooled_ci_nats'][0]}–{res['pooled_ci_nats'][1]}) "
              f"dNLL {res['dnll_nats_per_tok']} top1 {res['top1_agreement']} "
              f"n={res['n_positions']} -> {a.out}")


if __name__ == "__main__":
    main()
