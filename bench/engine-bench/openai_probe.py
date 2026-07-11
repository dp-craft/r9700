#!/usr/bin/env python3
"""
openai_probe.py v2 — zero-install, engine-agnostic cross-engine probe with CONCURRENCY.

Streams completions from an OpenAI-compatible /v1/completions endpoint and measures what matters
for real dev/research + agentic workloads:

  per request : ttft_s, decode_tok_s, prefill_tok_s, ttfa_s / think_tokens (thinking-mode),
                gen_tokens (from server `usage` when available, SSE-chunk count otherwise)
  aggregate   : ttft p50/p95, per-stream decode p50, AGGREGATE tok/s (total generated tokens /
                wave wall time) — the number that tells you what N parallel agent streams
                actually get out of the box.

Concurrency model: --concurrency N sends N simultaneous streams (a "wave"); --reps R repeats the
wave R times; all requests are pooled for percentiles. Threaded (stdlib only).

Prefix modes (agentic realism):
  --prefix-mode unique  : per-REQUEST unique prefix → every stream misses the prefix cache
                          (worst case: N independent agents on N different tasks)
  --prefix-mode shared  : identical prompt every request → prefix-cache best case
                          (N agent turns sharing one long system prompt)
  --prefix-mode none    : use the file(s) exactly as built (they already embed one run-id)

Multiple --prompt-file values are round-robined across streams (use build_prompt.py --variants).

Output: one JSON line per request (kind=request) + one per run (kind=aggregate) to stdout.
Usage:
  python3 openai_probe.py --url http://localhost:8080/v1 --model local \
        --prompt-file ../workloads/generated/codereview-64000.txt \
        --max-tokens 256 --engine llamacpp-vulkan --label cr64k --concurrency 4 --reps 3
"""
import argparse, json, statistics, sys, threading, time, urllib.request, urllib.error, uuid

def stream_once(url, model, prompt, max_tokens, temperature, timeout, api="completions"):
    """One streamed completion; returns metrics dict or {'error': ...}.

    api="completions": raw /v1/completions — for CONTINUATION-shaped prompts (padded code
        context). NOT for bare instructions: no chat template is applied, so instruct/thinking
        models may emit EOS immediately.
    api="chat": /v1/chat/completions — chat template applied; thinking models emit their
        reasoning as delta.reasoning_content (or inline <think>), so ttfa_s (time to first
        ANSWER token) is MEASURED here, not estimated.
    """
    if api == "chat":
        payload = {"model": model, "messages": [{"role": "user", "content": prompt}],
                   "max_tokens": max_tokens, "temperature": temperature, "stream": True,
                   "stream_options": {"include_usage": True}}
        path = "/chat/completions"
    else:
        payload = {"model": model, "prompt": prompt, "max_tokens": max_tokens,
                   "temperature": temperature, "stream": True,
                   "stream_options": {"include_usage": True}}
        path = "/completions"
    req = urllib.request.Request(url.rstrip("/") + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-noauth"})
    t0 = time.perf_counter()
    t_first = t_last = t_answer = None
    chunk_tokens = 0
    think_chunks = 0
    usage = None
    text = []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if chunk.get("usage"):
                    usage = chunk["usage"]
                for ch in chunk.get("choices", []):
                    delta = ch.get("delta") or {}
                    reasoning = delta.get("reasoning_content") or ""
                    piece = ch.get("text") or delta.get("content") or ""
                    if reasoning or piece:
                        now = time.perf_counter()
                        if t_first is None:
                            t_first = now
                        t_last = now
                        chunk_tokens += 1
                    if reasoning:
                        think_chunks += 1
                    if piece:
                        if t_answer is None:
                            t_answer = time.perf_counter()
                        text.append(piece)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return {"error": str(e), "t_start": t0}
    if t_first is None or t_last is None:
        return {"error": "no tokens received", "t_start": t0}

    gen_tokens = (usage or {}).get("completion_tokens") or chunk_tokens
    prompt_tokens = (usage or {}).get("prompt_tokens")
    full = "".join(text)
    ttft = t_first - t0
    decode = (gen_tokens - 1) / (t_last - t_first) if t_last > t_first and gen_tokens > 1 else None

    think_tokens = ttfa = None
    if think_chunks:                              # chat api: measured directly
        think_tokens = think_chunks               # 1 SSE reasoning chunk ≈ 1 token
        if t_answer is not None:
            ttfa = t_answer - t0
    elif "</think>" in full:                      # completions api: crude estimate
        pre = full.split("</think>", 1)[0]
        think_tokens = len(pre.split())           # word-count approximation
        if decode:                                # crude: assume uniform decode rate
            ttfa = ttft + think_tokens / decode
    return {"t_start": t0, "t_first": t_first, "t_end": t_last,
            "ttft_s": round(ttft, 4), "decode_tok_s": round(decode, 2) if decode else None,
            "prefill_tok_s": round(prompt_tokens / ttft, 1) if prompt_tokens else None,
            "gen_tokens": gen_tokens, "prompt_tokens": prompt_tokens,
            "tok_count_source": "usage" if (usage or {}).get("completion_tokens") else "sse_chunks",
            "total_s": round(t_last - t0, 3),
            "think_tokens": think_tokens, "ttfa_s": round(ttfa, 3) if ttfa else None}

def pct(vals, p):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    k = min(len(vals) - 1, max(0, round(p / 100 * (len(vals) - 1))))
    return vals[k]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="base URL incl. /v1")
    ap.add_argument("--model", default="local")
    ap.add_argument("--prompt-file", action="append", required=True,
                    help="repeatable; multiple files are round-robined across streams")
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--engine", default="unknown")
    ap.add_argument("--label", default="run")
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--reps", type=int, default=1, help="repeat the whole wave N times")
    ap.add_argument("--warmup", type=int, default=1,
                    help="untimed warm-up requests before measuring (0 to skip)")
    ap.add_argument("--prefix-mode", choices=["none", "unique", "shared"], default="none")
    ap.add_argument("--api", choices=["completions", "chat"], default="completions",
                    help="chat = apply chat template (REQUIRED for instruction/thinking prompts; "
                         "measures ttfa_s directly). completions = raw continuation.")
    ap.add_argument("--timeout", type=float, default=1200.0)
    a = ap.parse_args()

    prompts = [open(f, encoding="utf-8", errors="replace").read() for f in a.prompt_file]

    def prompt_for(i):
        base = prompts[i % len(prompts)]
        if a.prefix_mode == "unique":
            return f"[stream-id {uuid.uuid4().hex[:12]} — unique per-request prefix]\n\n" + base
        if a.prefix_mode == "shared":
            return prompts[0]
        return base

    for w in range(a.warmup):
        stream_once(a.url, a.model, prompt_for(w), min(16, a.max_tokens), a.temperature,
                    a.timeout, a.api)

    all_reqs, waves = [], []
    for rep in range(a.reps):
        results = [None] * a.concurrency
        barrier = threading.Barrier(a.concurrency)
        def worker(i):
            p = prompt_for(rep * a.concurrency + i)
            barrier.wait()
            results[i] = stream_once(a.url, a.model, p, a.max_tokens, a.temperature,
                                     a.timeout, a.api)
        threads = [threading.Thread(target=worker, args=(i,)) for i in range(a.concurrency)]
        for t in threads: t.start()
        for t in threads: t.join()
        ok = [r for r in results if r and "error" not in r]
        for i, r in enumerate(results):
            row = {"kind": "request", "label": a.label, "engine": a.engine, "rep": rep, "stream": i,
                   "concurrency": a.concurrency, "prefix_mode": a.prefix_mode}
            row.update({k: v for k, v in (r or {}).items() if not k.startswith("t_")})
            print(json.dumps(row))
        all_reqs += ok
        if ok:
            wall = max(r["t_end"] for r in ok) - min(r["t_start"] for r in ok)
            waves.append({"gen_tokens": sum(r["gen_tokens"] for r in ok), "wall_s": wall,
                          "errors": a.concurrency - len(ok)})

    if not all_reqs:
        print(json.dumps({"kind": "aggregate", "label": a.label, "engine": a.engine,
                          "error": "all requests failed"}))
        sys.exit(2)

    agg = {
        "kind": "aggregate", "label": a.label, "engine": a.engine, "model": a.model,
        "url": a.url, "concurrency": a.concurrency, "reps": a.reps, "api": a.api,
        "prefix_mode": a.prefix_mode, "max_tokens": a.max_tokens,
        "prompt_files": a.prompt_file, "prompt_tokens": all_reqs[0].get("prompt_tokens"),
        "n_ok": len(all_reqs), "n_err": a.concurrency * a.reps - len(all_reqs),
        "ttft_s_p50": pct([r["ttft_s"] for r in all_reqs], 50),
        "ttft_s_p95": pct([r["ttft_s"] for r in all_reqs], 95),
        "decode_tok_s_per_stream_p50": pct([r["decode_tok_s"] for r in all_reqs], 50),
        "prefill_tok_s_p50": pct([r["prefill_tok_s"] for r in all_reqs], 50),
        "aggregate_tok_s": round(statistics.mean(
            w["gen_tokens"] / w["wall_s"] for w in waves if w["wall_s"] > 0), 2) if waves else None,
        "ttfa_s_p50": pct([r["ttfa_s"] for r in all_reqs], 50),
        "think_tokens_p50": pct([r["think_tokens"] for r in all_reqs], 50),
        "tok_count_source": all_reqs[0].get("tok_count_source"),
    }
    print(json.dumps(agg))

if __name__ == "__main__":
    main()
