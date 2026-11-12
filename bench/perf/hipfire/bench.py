#!/usr/bin/env python3
"""Engine-agnostic OpenAI-compatible benchmark harness.

Same script benches llama.cpp (via llama-swap) and hipfire, so numbers are comparable.
Collects EVERYTHING the endpoint reports: timings, usage, speculative/draft stats, wall times.

Usage:
  bench.py --base-url URL --model ID --label NAME --out DIR [--reps N] [--workloads a,b,c]
"""
import argparse, json, os, statistics, time, urllib.request, uuid

# ---------------------------------------------------------------- workloads
# Each isolates a different part of the pipeline.
#   decode  : tiny prompt, long generation  -> decode tok/s dominates
#   prefill : large prompt, 16 tokens out   -> prefill (prompt eval) tok/s dominates
#   coding  : realistic agentic-coding shape -> what the runner actually does
LOREM_UNIT = (
    "The quick brown fox jumps over the lazy dog while the maintainer refactors "
    "the dependency graph and the scheduler retries the failed job with backoff. "
)

CODE_CTX = '''\
```typescript
export interface StageResult { readonly ok: boolean; readonly durationMs: number; readonly notes: readonly string[]; }
export function summarize(results: readonly StageResult[]): { passed: number; failed: number; totalMs: number } {
  let passed = 0, failed = 0, totalMs = 0;
  for (const r of results) { if (r.ok) passed++; else failed++; totalMs += r.durationMs; }
  return { passed, failed, totalMs };
}
```
'''


def workloads():
    return {
        "decode": {
            "messages": [{"role": "user", "content": "Count from 1 to 200, one number per line. No commentary."}],
            "max_tokens": 512,
            "desc": "tiny prompt / long generation -> isolates decode",
        },
        "prefill": {
            "messages": [{"role": "user", "content": (LOREM_UNIT * 220) + "\n\nReply with exactly the word: ACK"}],
            "max_tokens": 16,
            "desc": "~6k-token prompt / 16 tokens out -> isolates prefill",
        },
        "longctx": {
            "messages": [{"role": "user", "content": (LOREM_UNIT * 1900) +
                          "\n\nReply with exactly the word: ACK"}],
            "max_tokens": 16,
            "desc": "~55k-token prompt -> the regime where CASK/TriAttention actually engages",
        },
        "coding": {
            "messages": [{"role": "user", "content": CODE_CTX + (
                "\nAdd a `slowest` field returning the StageResult with the largest durationMs, "
                "or null for an empty array. Return the full updated function only.")}],
            "max_tokens": 1024,
            "desc": "realistic coding turn -> mixed prefill+decode",
        },
    }


# ---------------------------------------------------------------- transport
def post(base_url, payload, timeout):
    url = base_url.rstrip("/") + "/chat/completions"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": "Bearer dummy-key"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    wall = time.perf_counter() - t0
    return json.loads(raw), wall, len(raw)


def flatten_timings(obj):
    """llama.cpp puts perf under .timings; other engines may use .usage only.
    Keep every numeric field we find, namespaced, so nothing is silently dropped."""
    out = {}
    for key in ("timings", "usage", "hipfire"):
        blk = obj.get(key)
        if isinstance(blk, dict):
            for k, v in blk.items():
                if isinstance(v, dict):
                    for k2, v2 in v.items():
                        out[f"{key}.{k}.{k2}"] = v2
                else:
                    out[f"{key}.{k}"] = v
    # top-level extras some engines add
    for k in ("model", "system_fingerprint", "id"):
        if k in obj:
            out[f"resp.{k}"] = obj[k]
    return out


def run_one(base_url, model, wl, timeout, extra_body, nonce=True):
    """nonce=True prepends a unique marker so the engine's PREFIX CACHE always misses.

    Without this the 2nd+ identical request reuses the cached KV prefix and reports a tiny
    prompt_n with a sub-second wall -- i.e. it measures cache lookup, not prefill. Measured
    on llama.cpp b6fdd0ac: repeated 6k-token prompt fell to wall=0.53s, prompt_n~4.
    Both engines must be measured cold for the comparison to mean anything.
    """
    msgs = [dict(m) for m in wl["messages"]]
    if nonce:
        msgs[0]["content"] = f"[run {uuid.uuid4().hex}]\n" + msgs[0]["content"]
    payload = {
        "model": model,
        "messages": msgs,
        "max_tokens": wl["max_tokens"],
        "temperature": 0.6, "top_p": 0.95, "stream": False,
    }
    payload.update(extra_body or {})
    obj, wall, nbytes = post(base_url, payload, timeout)
    rec = {"wall_s": round(wall, 4), "resp_bytes": nbytes}
    rec.update(flatten_timings(obj))
    ch = (obj.get("choices") or [{}])[0]
    msg = ch.get("message") or {}
    content = msg.get("content") or ""
    rec["finish_reason"] = ch.get("finish_reason")
    rec["content_chars"] = len(content)
    rec["content_head"] = content[:160].replace("\n", "\\n")
    if msg.get("reasoning_content"):
        rec["reasoning_chars"] = len(msg["reasoning_content"])
    return rec


def derive(rec):
    """Engine-neutral derived metrics so llama.cpp and hipfire compare like-for-like."""
    d = {}
    pn = rec.get("timings.prompt_n") or rec.get("usage.prompt_tokens")
    pms = rec.get("timings.prompt_ms")
    dn = rec.get("timings.predicted_n") or rec.get("usage.completion_tokens")
    dms = rec.get("timings.predicted_ms")
    # hipfire reports rates directly; llama.cpp reports counts+ms. Prefer the engine's own rate.
    if rec.get("timings.prefill_tok_s") is not None:
        d["prefill_tok_s"] = round(rec["timings.prefill_tok_s"], 2)
    elif pn and pms:
        d["prefill_tok_s"] = round(pn / (pms / 1000.0), 2)
    elif rec.get("timings.prompt_per_second"):
        d["prefill_tok_s"] = round(rec["timings.prompt_per_second"], 2)
    if rec.get("timings.decode_tok_s") is not None:
        d["decode_tok_s"] = round(rec["timings.decode_tok_s"], 2)
    elif dn and dms:
        d["decode_tok_s"] = round(dn / (dms / 1000.0), 2)
    elif rec.get("timings.predicted_per_second"):
        d["decode_tok_s"] = round(rec["timings.predicted_per_second"], 2)
    # hipfire speculative counters (null unless the mechanism actually engaged)
    for src, dst in (("timings.ngram_mod_accept_rate", "ngram_accept_rate"),
                     ("timings.dflash", "dflash_stat"), ("timings.mtp", "mtp_stat"),
                     ("timings.tau", "tau"), ("timings.cycles", "cycles"),
                     ("timings.ttft_ms", "ttft_ms")):
        if rec.get(src) is not None:
            d[dst] = rec[src]
    if dn and rec.get("wall_s"):
        d["e2e_tok_s"] = round(dn / rec["wall_s"], 2)
    # speculative decoding / draft acceptance, when the engine reports it
    da, dn_draft = rec.get("timings.draft_n_accepted"), rec.get("timings.draft_n")
    if da is not None and dn_draft:
        d["draft_accept_rate"] = round(da / dn_draft, 4)
    if pms is not None and "ttft_proxy_s" not in d:
        d["ttft_proxy_s"] = round(pms / 1000.0, 4)
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--workloads", default="decode,prefill,coding")
    ap.add_argument("--extra-body", default="{}")
    ap.add_argument("--note", default="")
    ap.add_argument("--warmups", type=int, default=1,
                    help="Warmup requests discarded before measuring. hipfire needs ~10: it "
                         "graph-captures per batch size (verify-graph B=16,11,7,4,2) and only "
                         "reaches steady state afterwards. Measured: 22->35 tok/s across the ramp.")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    jsonl = os.path.join(a.out, f"{a.label}.jsonl")
    wls, extra = workloads(), json.loads(a.extra_body)
    selected = [w.strip() for w in a.workloads.split(",") if w.strip()]

    meta = {"kind": "meta", "label": a.label, "model": a.model, "base_url": a.base_url,
            "reps": a.reps, "note": a.note, "extra_body": extra,
            "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    with open(jsonl, "a") as f:
        f.write(json.dumps(meta) + "\n")
    print(f"[{a.label}] {a.model} @ {a.base_url}", flush=True)

    summary = {}
    for name in selected:
        wl = wls[name]
        print(f"  workload={name} ({wl['desc']})", flush=True)
        # warmup: pays model load / kernel JIT / graph capture so it is excluded from stats
        try:
            for wi in range(a.warmups):
                w = run_one(a.base_url, a.model, wl, a.timeout, extra)
                wrec = {"kind": "warmup", "workload": name, "warmup_i": wi + 1, **w, **derive(w)}
                with open(jsonl, "a") as f:
                    f.write(json.dumps(wrec) + "\n")
                print(f"    warmup {wi+1}/{a.warmups}: wall={w['wall_s']}s "
                      f"decode={wrec.get('decode_tok_s')}", flush=True)
        except Exception as e:
            print(f"    WARMUP FAILED: {type(e).__name__}: {e}", flush=True)
            with open(jsonl, "a") as f:
                f.write(json.dumps({"kind": "error", "workload": name, "phase": "warmup",
                                    "error": f"{type(e).__name__}: {e}"}) + "\n")
            continue

        recs = []
        for i in range(a.reps):
            try:
                r = run_one(a.base_url, a.model, wl, a.timeout, extra)
                rec = {"kind": "run", "workload": name, "rep": i + 1, **r, **derive(r)}
                recs.append(rec)
                with open(jsonl, "a") as f:
                    f.write(json.dumps(rec) + "\n")
                print(f"    rep{i+1}: prefill={rec.get('prefill_tok_s')} "
                      f"decode={rec.get('decode_tok_s')} wall={rec['wall_s']}s "
                      f"accept={rec.get('draft_accept_rate')}", flush=True)
            except Exception as e:
                print(f"    rep{i+1} FAILED: {type(e).__name__}: {e}", flush=True)
                with open(jsonl, "a") as f:
                    f.write(json.dumps({"kind": "error", "workload": name, "rep": i + 1,
                                        "error": f"{type(e).__name__}: {e}"}) + "\n")

        agg = {"kind": "summary", "workload": name, "n": len(recs)}
        for metric in ("prefill_tok_s", "decode_tok_s", "e2e_tok_s", "wall_s",
                       "draft_accept_rate", "ttft_proxy_s"):
            vals = [r[metric] for r in recs if r.get(metric) is not None]
            if vals:
                agg[f"{metric}_median"] = round(statistics.median(vals), 3)
                agg[f"{metric}_min"] = round(min(vals), 3)
                agg[f"{metric}_max"] = round(max(vals), 3)
                if len(vals) > 1:
                    agg[f"{metric}_stdev"] = round(statistics.stdev(vals), 3)
        summary[name] = agg
        with open(jsonl, "a") as f:
            f.write(json.dumps(agg) + "\n")
        print(f"    SUMMARY {name}: {json.dumps({k: v for k, v in agg.items() if 'median' in k})}", flush=True)

    print(json.dumps({"label": a.label, "summary": summary}, indent=2), flush=True)


if __name__ == "__main__":
    main()
