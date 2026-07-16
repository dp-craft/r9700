#!/usr/bin/env python3
"""capture_engine.py — the ONE prober for the R9700 harness. Streams an OpenAI-compatible
/v1 endpoint and records every measurable signal, in two modes:

  probe  (cross-engine throughput / serving — was openai_probe.py)
      Fixed prompt file(s) at --concurrency N (a "wave"), --reps R waves, percentile aggregation.
      Emits one {kind:"request"} line per request + one {kind:"aggregate"} per run. Prefix modes
      (unique/shared/none) model agentic cache behaviour. This is what engine-bench/run.sh drives.

  tasks  (quality / token-economy — was the finetune campaign's capture.py)
      A task suite (tasks.jsonl) sent one task at a time (optionally --reps for self-consistency),
      saving the FULL response + a think/answer token split + health flags for grading. Emits one
      {kind:"task"} line per config×task×rep. This is what a `kind:"quality"` campaign drives.

Both modes share ONE streaming core that captures: ttft_s (first token), ttfa_s (first ANSWER
token, after </think> or the first reasoning delta), the llama.cpp `timings` block (prefill/decode
tok/s, prompt/predicted n/ms), `usage` (prompt/completion/total/cached tokens), finish_reason, and
— in tasks mode — the raw text and derived think/answer token counts + truncation flags.

Stdlib only (urllib + threading). Chat vs completions:
  --api chat         apply the chat template (REQUIRED for instruction/thinking prompts; ttfa is
                     measured from reasoning_content deltas or inline <think>). Default for tasks.
  --api completions  raw continuation (padded code context). Default for probe.

    python3 capture_engine.py probe --url http://localhost:8081/v1 --model local \
        --prompt-file cr64k.txt --max-tokens 256 --concurrency 4 --reps 3 --engine llamacpp-vulkan
    python3 capture_engine.py tasks --url http://127.0.0.1:8081/v1 --config rico03-distilled \
        --tasks tasks.jsonl --out out/outputs.jsonl --reps 1 --max-tokens 8192
"""
import argparse, json, re, statistics, sys, threading, time, urllib.error, urllib.request, uuid

THINK_RE = re.compile(r"<think>(.*?)</think>", re.S)


# ------------------------------------------------------------------ streaming core
def _post_json(url, payload, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-noauth"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def count_tokens(v1_base, text):
    """Token count via the server's /tokenize (authoritative); word-count fallback if unavailable."""
    if not text or not text.strip():
        return 0
    base = v1_base[:-3] if v1_base.rstrip("/").endswith("/v1") else v1_base
    try:
        return len(_post_json(base.rstrip("/") + "/tokenize", {"content": text}).get("tokens", []))
    except Exception:
        return round(len(text.split()) * 1.33)


def stream(v1_base, api, payload, timeout=1200.0):
    """One streamed request. Returns a metrics dict (never raises for HTTP/stream errors — those
    come back as {'error': ...}). Captures both reasoning styles: a separate reasoning_content
    delta field, or inline <think>…</think> in content."""
    prompt = payload.get("_prompt", "")
    body = {k: v for k, v in payload.items() if k != "_prompt"}
    if api == "chat":
        path = "/chat/completions"
        body.setdefault("messages", [{"role": "user", "content": prompt}])
    else:
        path = "/completions"
        body.setdefault("prompt", prompt)
    body["stream"] = True
    body["stream_options"] = {"include_usage": True}
    req = urllib.request.Request(v1_base.rstrip("/") + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-noauth"})
    content, reasoning = [], []
    acc = ""
    ttft = ttfa = t_first_content = None
    usage = timings = finish = None
    saw_reasoning = False
    chunk_tokens = 0
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if obj.get("usage"):
                    usage = obj["usage"]
                if obj.get("timings"):
                    timings = obj["timings"]
                for ch in obj.get("choices", []):
                    d = ch.get("delta") or {}
                    pc = ch.get("text") or d.get("content") or ""      # completions .text | chat .content
                    pr = d.get("reasoning_content") or ""
                    now = time.perf_counter() - t0
                    if pr:
                        saw_reasoning = True
                    if (pc or pr):
                        if ttft is None:
                            ttft = now
                        chunk_tokens += 1
                    if pc:
                        if t_first_content is None:
                            t_first_content = now
                        acc += pc
                        if ttfa is None and (saw_reasoning or "</think>" in acc):
                            ttfa = now
                    content.append(pc)
                    reasoning.append(pr)
                    if ch.get("finish_reason"):
                        finish = ch["finish_reason"]
    except (urllib.error.URLError, OSError, TimeoutError, ValueError) as e:
        return {"error": str(e), "total_s": time.perf_counter() - t0}
    if ttft is None:
        return {"error": "no tokens received", "total_s": time.perf_counter() - t0}
    # a non-thinking model (no <think> ever, no reasoning field) → its first content IS the answer
    if ttfa is None and acc and "<think>" not in acc:
        ttfa = t_first_content
    return {"content": "".join(content), "reasoning": "".join(reasoning),
            "ttft": ttft, "ttfa": ttfa, "total_s": time.perf_counter() - t0,
            "usage": usage or {}, "timings": timings or {}, "finish": finish,
            "saw_reasoning": saw_reasoning, "chunk_tokens": chunk_tokens}


# ------------------------------------------------------------------ mode: probe
def _pct(vals, p):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    k = min(len(vals) - 1, max(0, round(p / 100 * (len(vals) - 1))))
    return vals[k]


def _request_metrics(s):
    """Derive the per-request throughput/latency row (probe schema) from a stream() result."""
    tm, u = s["timings"], s["usage"]
    gen = u.get("completion_tokens") or s["chunk_tokens"]
    prompt_tokens = u.get("prompt_tokens")
    ttft = s["ttft"]
    # prefer the server's own timings; fall back to wall-clock deltas
    decode = tm.get("predicted_per_second")
    if decode is None and s["total_s"] > ttft and gen > 1:
        decode = round((gen - 1) / (s["total_s"] - ttft), 2)
    prefill = tm.get("prompt_per_second")
    if prefill is None and prompt_tokens and ttft:
        prefill = round(prompt_tokens / ttft, 1)
    think_tokens = None
    full = (f"<think>{s['reasoning']}</think>{s['content']}") if s["reasoning"] else s["content"]
    if s["saw_reasoning"]:
        think_tokens = len(re.findall(r"\S+", s["reasoning"]))          # rough (no /tokenize in probe)
    elif "</think>" in full:
        think_tokens = len(full.split("</think>", 1)[0].split())
    return {"ttft_s": round(ttft, 4), "decode_tok_s": decode, "prefill_tok_s": prefill,
            "gen_tokens": gen, "prompt_tokens": prompt_tokens,
            "tok_count_source": "usage" if u.get("completion_tokens") else "sse_chunks",
            "total_s": round(s["total_s"], 3),
            "think_tokens": think_tokens,
            "ttfa_s": round(s["ttfa"], 3) if s["ttfa"] is not None else None}


def run_probe(a):
    prompts = [open(f, encoding="utf-8", errors="replace").read() for f in a.prompt_file]

    def prompt_for(i):
        base = prompts[i % len(prompts)]
        if a.prefix_mode == "unique":
            return f"[stream-id {uuid.uuid4().hex[:12]} — unique per-request prefix]\n\n" + base
        if a.prefix_mode == "shared":
            return prompts[0]
        return base

    def one(prompt, max_tokens):
        payload = {"model": a.model, "max_tokens": max_tokens, "temperature": a.temperature,
                   "_prompt": prompt}
        t_start = time.perf_counter()
        s = stream(a.url, a.api, payload, a.timeout)
        if "error" in s:
            return {"error": s["error"], "t_start": t_start}
        m = _request_metrics(s)
        m["t_start"] = t_start
        m["t_end"] = t_start + s["total_s"]
        return m

    for w in range(a.warmup):
        one(prompt_for(w), min(16, a.max_tokens))

    all_reqs, waves = [], []
    for rep in range(a.reps):
        results = [None] * a.concurrency
        barrier = threading.Barrier(a.concurrency)

        def worker(i):
            p = prompt_for(rep * a.concurrency + i)
            barrier.wait()
            results[i] = one(p, a.max_tokens)
        threads = [threading.Thread(target=worker, args=(i,)) for i in range(a.concurrency)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
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
        "kind": "aggregate", "label": a.label, "engine": a.engine, "model": a.model, "url": a.url,
        "concurrency": a.concurrency, "reps": a.reps, "api": a.api, "prefix_mode": a.prefix_mode,
        "max_tokens": a.max_tokens, "prompt_files": a.prompt_file,
        "prompt_tokens": all_reqs[0].get("prompt_tokens"),
        "n_ok": len(all_reqs), "n_err": a.concurrency * a.reps - len(all_reqs),
        "ttft_s_p50": _pct([r["ttft_s"] for r in all_reqs], 50),
        "ttft_s_p95": _pct([r["ttft_s"] for r in all_reqs], 95),
        "decode_tok_s_per_stream_p50": _pct([r["decode_tok_s"] for r in all_reqs], 50),
        "prefill_tok_s_p50": _pct([r["prefill_tok_s"] for r in all_reqs], 50),
        "aggregate_tok_s": round(statistics.mean(
            w["gen_tokens"] / w["wall_s"] for w in waves if w["wall_s"] > 0), 2) if waves else None,
        "ttfa_s_p50": _pct([r["ttfa_s"] for r in all_reqs], 50),
        "think_tokens_p50": _pct([r["think_tokens"] for r in all_reqs], 50),
        "tok_count_source": all_reqs[0].get("tok_count_source"),
    }
    print(json.dumps(agg))


# ------------------------------------------------------------------ mode: tasks
def run_tasks(a):
    tasks = [json.loads(l) for l in open(a.tasks, encoding="utf-8") if l.strip()]
    n = 0
    with open(a.out, "a", encoding="utf-8") as fout:
        for t in tasks:
            for rep in range(a.reps):
                sampling = {"temperature": a.temp, "top_p": a.top_p, "top_k": a.top_k,
                            "seed": a.seed + rep}
                payload = {"model": a.model, "max_tokens": a.max_tokens, "_prompt": t["prompt"],
                           **sampling}
                s = stream(a.url, a.api, payload, a.timeout)
                if "error" in s:
                    row = {"kind": "task", "config": a.config, "task_id": t["id"], "rep": rep,
                           "error": s["error"], "latency_s": round(s.get("total_s", 0), 3),
                           "ts": time.time()}
                    fout.write(json.dumps(row) + "\n"); fout.flush(); n += 1
                    print(f"  [{a.config}] {t['id']} rep{rep}: ERROR {s['error']}")
                    continue
                full = (f"<think>{s['reasoning']}</think>{s['content']}") if s["reasoning"] else s["content"]
                think = "".join(THINK_RE.findall(full))
                think_tok = count_tokens(a.url, think)
                u, tm = s["usage"], s["timings"]
                comp = u.get("completion_tokens")
                think_closed = ("</think>" in full) or s["saw_reasoning"]
                answer_text = THINK_RE.sub("", full).strip()
                ttft, ttfa = s["ttft"], s["ttfa"]
                row = {"kind": "task", "config": a.config, "task_id": t["id"],
                       "type": t.get("type"), "category": t.get("category"), "rep": rep,
                       "response": full,
                       # token economy
                       "prompt_tokens": u.get("prompt_tokens"), "completion_tokens": comp,
                       "total_tokens": u.get("total_tokens"),
                       "cached_tokens": (u.get("prompt_tokens_details") or {}).get("cached_tokens"),
                       "think_tokens": think_tok,
                       "answer_tokens": (comp - think_tok) if comp is not None else None,
                       # throughput
                       "prefill_tps": tm.get("prompt_per_second"),
                       "decode_tps": tm.get("predicted_per_second"),
                       "prompt_n": tm.get("prompt_n"), "prompt_ms": tm.get("prompt_ms"),
                       "predicted_n": tm.get("predicted_n"), "predicted_ms": tm.get("predicted_ms"),
                       "prompt_per_token_ms": tm.get("prompt_per_token_ms"),
                       "predicted_per_token_ms": tm.get("predicted_per_token_ms"),
                       # latency
                       "ttft_s": round(ttft, 3) if ttft is not None else None,
                       "ttfa_s": round(ttfa, 3) if ttfa is not None else None,
                       "think_time_s": round(ttfa - ttft, 3) if (ttft is not None and ttfa is not None) else None,
                       "latency_s": round(s["total_s"], 3),
                       # health
                       "finish_reason": s["finish"], "think_closed": think_closed,
                       "has_answer": bool(answer_text),
                       "truncated_thinking": (s["finish"] == "length" and not think_closed),
                       # provenance
                       "sampling": sampling, "max_tokens": a.max_tokens,
                       "timings": tm, "usage": u, "ts": time.time()}
                fout.write(json.dumps(row) + "\n"); fout.flush(); n += 1
                trunc = " TRUNCATED-THINK" if row["truncated_thinking"] else ""
                dtps = row["decode_tps"]; ptps = row["prefill_tps"]
                print(f"  [{a.config}] {t['id']} rep{rep}: {comp} tok "
                      f"({think_tok} think/{row['answer_tokens']} ans) | "
                      f"prefill {ptps:.0f} decode {dtps:.1f} t/s | "
                      f"ttft {row['ttft_s']}s ttfa {row['ttfa_s']}s | {row['finish_reason']}{trunc}"
                      if dtps is not None and ptps is not None else
                      f"  [{a.config}] {t['id']} rep{rep}: {comp} tok | {row['finish_reason']}{trunc}")
    print(f"captured {n} rows -> {a.out}")


# ------------------------------------------------------------------ cli
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    p = sub.add_parser("probe", help="cross-engine throughput / concurrency (JSONL to stdout)")
    p.add_argument("--url", required=True, help="base URL incl. /v1")
    p.add_argument("--model", default="local")
    p.add_argument("--prompt-file", action="append", required=True,
                   help="repeatable; multiple files are round-robined across streams")
    p.add_argument("--max-tokens", type=int, default=512)
    p.add_argument("--temperature", type=float, default=0.2)
    p.add_argument("--engine", default="unknown")
    p.add_argument("--label", default="run")
    p.add_argument("--concurrency", type=int, default=1)
    p.add_argument("--reps", type=int, default=1, help="repeat the whole wave N times")
    p.add_argument("--warmup", type=int, default=1, help="untimed warm-up requests before measuring")
    p.add_argument("--prefix-mode", choices=["none", "unique", "shared"], default="none")
    p.add_argument("--api", choices=["completions", "chat"], default="completions")
    p.add_argument("--timeout", type=float, default=1200.0)
    p.set_defaults(func=run_probe)

    t = sub.add_parser("tasks", help="quality task-suite capture (full telemetry to --out JSONL)")
    t.add_argument("--url", required=True, help="base URL incl. /v1")
    t.add_argument("--model", default="local")
    t.add_argument("--config", required=True, help="config label, e.g. rico03-distilled / unsloth-mtp-on")
    t.add_argument("--tasks", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--reps", type=int, default=1, help="repeats per task (self-consistency variance)")
    t.add_argument("--max-tokens", type=int, default=8192,
                   help="generous by default — thinking models burn thousands of tokens; too low "
                        "truncates mid-<think> (finish_reason=length, no answer).")
    t.add_argument("--api", choices=["completions", "chat"], default="chat")
    t.add_argument("--temp", type=float, default=1.0)      # GGUF-recommended Qwen3.6 sampling
    t.add_argument("--top-p", type=float, default=0.95)
    t.add_argument("--top-k", type=int, default=20)
    t.add_argument("--seed", type=int, default=42)         # fixed for reproducibility
    t.add_argument("--timeout", type=float, default=1200.0)
    t.set_defaults(func=run_tasks)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
