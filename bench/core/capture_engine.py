#!/usr/bin/env python3
"""capture_engine.py — the ONE prober for the R9700 harness. Streams an OpenAI-compatible
/v1 endpoint and records every measurable signal, in two modes:

  probe  (cross-engine throughput / serving — was openai_probe.py)
      Fixed prompt file(s) at --concurrency N (a "wave"), --reps R waves, percentile aggregation.
      Emits one {kind:"request"} line per request + one {kind:"aggregate"} per run. Prefix modes
      (unique/shared/none) model agentic cache behaviour. This is what engine-bench/run.sh drives.
      Every request row carries BOTH rate definitions: prefill/decode_tok_s_wall (one client-side
      clock for every engine) and the server's own timings (*_server; prefill/decode_tok_s keep the
      server-first choice). --min-gen N marks rows below N tokens `short` (excluded, counted in
      n_short; exit 3 unless every request passed). llama.cpp's draft_n/draft_n_accepted are copied
      per row and summed in the aggregate.

  conversation  (growing multi-turn agentic pattern — CLAUDE.md iron rule 17)
      Turn 0 = --start-tokens of a source file; each later turn appends the reply + --step-tokens
      more, prior turns cached, until --max-depth. One {kind:"turn"} line per turn (context, cached,
      NEW tokens, prefill_new_tok_s, decode, ttft, wall-clock phase times) + a conversation_summary.
      --turn-prompt FILE appends a task to every later turn (blocks split on a `---` line, cycled;
      with --step-tokens 0 the task IS the turn). kv_usage_peak = vLLM's kv_cache_usage_perc polled
      from /metrics during the turn (null on engines without it). delta_tokens = context minus the
      previous turn's context (client-side, needs no cached_tokens) and prefill_delta_tok_s = delta/ttft.

  Shared by probe + conversation: --sampling JSON (top_p/top_k/min_p/penalties/seed, sent verbatim
  in every request; seed advances by +rep), --chat-template-kwargs JSON, --tag k=v (repeatable,
  copied into every emitted row; only depth/n/tg values are stored as int).

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
# --sampling allow-list (anything else, e.g. n / max_completion_tokens, would change what is measured)
SAMPLER_INT = {"top_k", "seed"}
SAMPLER_KEYS = {"temperature", "top_p", "min_p", "presence_penalty", "frequency_penalty", "repeat_penalty", "repetition_penalty"} | SAMPLER_INT
TAG_INT = {"depth", "n", "tg"}       # the only --tag values stored as int; every other value stays a string
MIN_RATE_WINDOW_S = 0.05             # *_tok_s_wall is null under a 50 ms window (a 1 ms one reads 49000 tok/s)


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
        pass
    try:   # vLLM's /tokenize takes {"prompt"} and answers {"count", "tokens"}
        r = _post_json(base.rstrip("/") + "/tokenize", {"prompt": text})
        return r.get("count") or len(r.get("tokens", []))
    except Exception:
        return round(len(text.split()) * 1.33)


def stream(v1_base, api, payload, timeout=1200.0):
    """One streamed request. Returns a metrics dict (never raises for HTTP/stream errors — those
    come back as {'error': ...}; a no-tokens failure carries the raw SSE tail, bounded, so the
    server's actual reply is readable from the row alone). Captures both reasoning styles: a
    separate reasoning_content delta field, or inline <think>…</think> in content."""
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
    raw_tail = ""      # bounded raw SSE payload — the "no tokens received" diagnostic
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
                raw_tail = (raw_tail + data)[-4000:]
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
                    pr = d.get("reasoning_content") or d.get("reasoning") or ""   # vLLM >= ~0.29 streams `reasoning`
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
        # never discard what the server actually said (2026-11-10: 2/4 d-arm reps died
        # with this and the server reply was gone) — the raw SSE tail makes the next
        # live occurrence readable from results.jsonl alone
        return {"error": ("no tokens received"
                          + (f" (raw sse tail: {raw_tail[-400:]})" if raw_tail
                             else " (empty sse stream)")),
                "total_s": time.perf_counter() - t0}
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


def _rate_cols(s):
    """Columns added after the pre-G2 ones (so those keep their order): ONE wall-clock definition for
    every engine (server timings differ per engine: vLLM has none), the server's own rates as a
    cross-check, and llama.cpp's speculative-decoding counters (absent → null)."""
    tm, u, ttft = s["timings"], s["usage"], s["ttft"]
    gen, prompt_tokens = u.get("completion_tokens") or s["chunk_tokens"], u.get("prompt_tokens")
    win = s["total_s"] - ttft
    return {"prefill_tok_s_wall": (round(prompt_tokens / ttft, 1)
                                   if prompt_tokens and ttft >= MIN_RATE_WINDOW_S else None),
            "decode_tok_s_wall": round((gen - 1) / win, 2) if win >= MIN_RATE_WINDOW_S and gen > 1 else None,
            "prefill_tok_s_server": tm.get("prompt_per_second"),
            "decode_tok_s_server": tm.get("predicted_per_second"),
            "draft_n": tm.get("draft_n"), "draft_n_accepted": tm.get("draft_n_accepted")}


def _wall(w_start, s):
    """Unix-time phase boundaries of one request (prefill = start→first token, decode = first token
    →end), so phase_power.py can join them against gpu_samples.csv. Not `t_`-prefixed: probe rows
    drop t_* keys (perf_counter values, meaningless outside this process)."""
    return {"wall_start": round(w_start, 3), "wall_first_token": round(w_start + s["ttft"], 3),
            "wall_end": round(w_start + s["total_s"], 3)}


def _sampling(a, rep):
    """--sampling for one request of rep `rep` (None = warm-up): the seed advances by +rep, so each
    rep is reproducible on its own."""
    smp = dict(a.sampling or {})
    if "seed" in smp and rep is not None:
        smp["seed"] += rep
    return smp


def _tagged(row, a):
    """Copy the --tag pairs into an emitted row. main() already refused tags that name a column
    (_reserved_keys); a clash here is a bug, so it fails instead of silently dropping one side."""
    clash = sorted(set(a.tags) & set(row))
    if clash:
        raise ValueError(f"--tag would shadow column(s) {clash}")
    row.update(a.tags)
    return row


def _median(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def _request_head(a, rep, i):
    return {"kind": "request", "label": a.label, "engine": a.engine, "rep": rep, "stream": i,
            "concurrency": a.concurrency, "prefix_mode": a.prefix_mode}


def _error_aggregate(a, n_short, n_total):
    row = {"kind": "aggregate", "label": a.label, "engine": a.engine, "error": "all requests failed"}
    if a.min_gen:
        row.update(error="all requests failed or short", n_short=n_short, n_err=n_total - n_short)
    return row


def _aggregate(a, all_reqs, waves, n_short, n_total):
    agg = {
        "kind": "aggregate", "label": a.label, "engine": a.engine, "model": a.model, "url": a.url,
        "concurrency": a.concurrency, "reps": a.reps, "api": a.api, "prefix_mode": a.prefix_mode,
        "max_tokens": a.max_tokens, "prompt_files": a.prompt_file,
        "prompt_tokens": all_reqs[0].get("prompt_tokens"),
        "n_ok": len(all_reqs), "n_err": n_total - len(all_reqs) - n_short,
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
    col = lambda k: [r[k] for r in all_reqs]                          # noqa: E731
    present = lambda k: [r[k] for r in all_reqs if r.get(k) is not None]   # noqa: E731
    agg.update({
        "n_short": n_short, "min_gen": a.min_gen,
        "decode_tok_s_per_stream_min": _pct(col("decode_tok_s"), 0),
        "decode_tok_s_per_stream_max": _pct(col("decode_tok_s"), 100),
        "prefill_tok_s_min": _pct(col("prefill_tok_s"), 0),
        "prefill_tok_s_max": _pct(col("prefill_tok_s"), 100),
        # *_wall_p50 = the true median (mean of the middle two for even n); the older *_p50 columns
        # keep _pct's nearest-rank index, which for even n picks one of the middle two
        **{f"{k}_{n}": f(col(k)) for k in ("prefill_tok_s_wall", "decode_tok_s_wall")
           for n, f in (("p50", _median), ("min", lambda v: _pct(v, 0)), ("max", lambda v: _pct(v, 100)))},
        "draft_n_sum": sum(present("draft_n")) if present("draft_n") else None,
        "draft_n_accepted_sum": sum(present("draft_n_accepted")) if present("draft_n_accepted") else None,
        "sampling": {"temperature": a.temperature, **(a.sampling or {})},
        "chat_template_kwargs": a.chat_template_kwargs,
    })
    if a.min_gen:   # rule 18: a cell missing any request has no honest end-to-end rate
        agg["complete"] = len(all_reqs) == n_total
        if not agg["complete"]:
            agg["aggregate_tok_s"] = None
    return agg


def _turn_cols(m, ctx, cached, new, delta, finish, kv_vals):
    return dict(context_tokens=ctx, cached_tokens=cached, new_tokens=new,
                prefill_new_tok_s=round(new / m["ttft_s"], 1) if new and m["ttft_s"] else None,
                finish=finish,
                kv_usage_peak=round(max(kv_vals), 4) if kv_vals else None,
                delta_tokens=delta,
                prefill_delta_tok_s=(round(delta / m["ttft_s"], 1)
                                     if delta and delta > 0 and m["ttft_s"] else None))


def _conv_summary(a, kwargs, summaries, n_err):
    return {"kind": "conversation_summary", "label": a.label, "engine": a.engine,
            "model": a.model, "url": a.url, "prompt_files": a.prompt_file,
            "start_tokens": a.start_tokens, "step_tokens": a.step_tokens,
            "max_depth": a.max_depth, "max_tokens": a.max_tokens, "reps": a.reps,
            "chat_template_kwargs": kwargs, "turn_prompt": a.turn_prompt or None,
            "conversations": summaries, "n_err": n_err,
            "sampling": {"temperature": a.temperature, **(a.sampling or {})}}


def _reserved_keys():
    """Every column probe/conversation can emit, derived by running the row builders on a dummy
    request with every optional column switched on: a --tag may not name any of them."""
    s = {"content": "", "reasoning": "", "ttft": 1.0, "ttfa": None, "total_s": 2.0, "usage": {},
         "timings": {}, "finish": "stop", "saw_reasoning": False, "chunk_tokens": 2}
    m = {**_request_metrics(s), **_wall(0.0, s), **_rate_cols(s), "seed": 0, "short": False}
    a = argparse.Namespace(label="", engine="", model="", url="", concurrency=1, reps=1, api="", prefix_mode="",
                           max_tokens=1, prompt_file=[], min_gen=1, temperature=0.0, sampling=None,
                           chat_template_kwargs=None, start_tokens=0, step_tokens=0, max_depth=0, turn_prompt="")
    return (set(_request_head(a, 0, 0)) | set(m) | {"error"} | set(_error_aggregate(a, 0, 1))
            | set(_aggregate(a, [m], [], 0, 1)) | set(_conv_summary(a, None, [], 0))
            | {"turn", "conversation_id"} | set(_turn_cols(m, 1, 1, 1, 1, "stop", [0.5])))


def run_probe(a):
    prompts = [open(f, encoding="utf-8", errors="replace").read() for f in a.prompt_file]

    def prompt_for(i):
        base = prompts[i % len(prompts)]
        if a.prefix_mode == "unique":
            return f"[stream-id {uuid.uuid4().hex[:12]} — unique per-request prefix]\n\n" + base
        if a.prefix_mode == "shared":
            return prompts[0]
        if a.prefix_mode == "tail":
            # SHARED BODY + DIVERGENT TAIL — the realistic agentic cache pattern, and the one the
            # other three modes cannot express. `unique` prepends its marker at the FRONT, which
            # moves token 0 and therefore defeats prefix caching completely; `shared` reuses the
            # prompt byte-for-byte, which is a 100% hit and measures the cache's upper bound rather
            # than its working behaviour. Real agents re-read the same repo and ask a DIFFERENT
            # question about it, so only the last few hundred tokens differ.
            # Always built on prompts[0] so every request shares one prefix regardless of how many
            # --prompt-file were given. Falls back to a uuid line when no --tail is supplied, which
            # still diverges the tail (partial hit) rather than matching exactly.
            tails = a.tail or [f"[query-id {{}} — unique per-request tail]"]
            t = tails[i % len(tails)]
            return prompts[0] + "\n\n" + (t.format(uuid.uuid4().hex[:12]) if "{}" in t else t)
        return base

    def one(prompt, max_tokens, rep=None):
        payload = {"model": a.model, "max_tokens": max_tokens, "temperature": a.temperature,
                   "_prompt": prompt}
        payload.update(_sampling(a, rep))                  # may override --temperature
        if a.chat_template_kwargs:
            payload["chat_template_kwargs"] = a.chat_template_kwargs
        t_start = time.perf_counter()
        w_start = time.time()
        s = stream(a.url, a.api, payload, a.timeout)
        if "error" in s:
            return {"error": s["error"], "t_start": t_start}
        m = _request_metrics(s)
        m["t_start"] = t_start
        m["t_end"] = t_start + s["total_s"]
        m.update(_wall(w_start, s))
        m.update(_rate_cols(s))
        if "seed" in payload:
            m["seed"] = payload["seed"]
        return m

    for w in range(a.warmup):
        one(prompt_for(w), min(16, a.max_tokens))

    all_reqs, waves, n_short = [], [], 0
    for rep in range(a.reps):
        results = [None] * a.concurrency
        barrier = threading.Barrier(a.concurrency)

        def worker(i):
            p = prompt_for(rep * a.concurrency + i)
            barrier.wait()
            results[i] = one(p, a.max_tokens, rep)
        threads = [threading.Thread(target=worker, args=(i,)) for i in range(a.concurrency)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        for r in results:   # rule 18: a too-short reply is not a measurement (kept in rows, flagged)
            if a.min_gen and r and "error" not in r:
                r["short"] = r["gen_tokens"] < a.min_gen
        ok = [r for r in results if r and "error" not in r and not r.get("short")]
        n_short += sum(1 for r in results if r and r.get("short"))
        for i, r in enumerate(results):
            row = _request_head(a, rep, i)
            row.update({k: v for k, v in (r or {}).items() if not k.startswith("t_")})
            print(json.dumps(_tagged(row, a)))
        all_reqs += ok
        if ok and (not a.min_gen or len(ok) == a.concurrency):   # gate on: only full waves count
            wall = max(r["t_end"] for r in ok) - min(r["t_start"] for r in ok)
            waves.append({"gen_tokens": sum(r["gen_tokens"] for r in ok), "wall_s": wall,
                          "errors": a.concurrency - len(ok)})

    n_total = a.concurrency * a.reps
    if not all_reqs:
        print(json.dumps(_tagged(_error_aggregate(a, n_short, n_total), a)))
        sys.exit(2)
    agg = _aggregate(a, all_reqs, waves, n_short, n_total)
    print(json.dumps(_tagged(agg, a)))
    if a.min_gen and len(all_reqs) < n_total:     # rule 18: an incomplete cell is re-collected, not kept
        print(f"capture_engine: only {len(all_reqs)}/{n_total} requests ok "
              f"({n_short} short < {a.min_gen} tokens, {n_total - len(all_reqs) - n_short} errored)",
              file=sys.stderr)
        sys.exit(3)


# ------------------------------------------------------------------ mode: conversation
def _kv_poller(v1_base, stop, out, interval=0.5):
    """Collect vLLM's vllm:kv_cache_usage_perc (0..1) until `stop` is set. The gauge counts blocks
    held by running requests, so it must be read DURING the request, not after it. Gives up on the
    first failed fetch or a missing gauge (e.g. llama.cpp) — `out` then stays empty."""
    base = v1_base.rstrip("/")
    base = base[:-3] if base.endswith("/v1") else base
    while not stop.is_set():
        try:
            text = urllib.request.urlopen(base + "/metrics", timeout=5).read().decode()
        except Exception:
            return
        vals = [float(l.rsplit(" ", 1)[1]) for l in text.splitlines()
                if l.startswith("vllm:kv_cache_usage_perc")]
        if not vals:
            return
        out.append(max(vals))
        stop.wait(interval)


def run_conversation(a):
    """GROWING multi-turn chat (CLAUDE.md iron rule 17): turn 0 sends --start-tokens of the source
    file, every later turn appends the model's reply + the next --step-tokens chunk, until the next
    turn would pass --max-depth. Prior turns stay cached server-side, so each turn measures the cost
    an agent actually pays: prefill of the NEW tokens only (prompt_tokens - cached_tokens), plus
    decode at the grown depth. Each rep is a fresh conversation (unique id in turn 0, so a rep never
    hits the previous rep's cache). An errored turn ends its conversation and is recorded with
    `error` (iron rule 18: an interrupted turn is never a normal row)."""
    src = open(a.prompt_file[0], encoding="utf-8", errors="replace").read()
    sample = src[:200000]
    cpt = len(sample) / max(1, count_tokens(a.url, sample))           # chars per token
    kwargs = json.loads(a.chat_template_kwargs) if a.chat_template_kwargs else None
    tasks = ([b.strip() for b in re.split(r"(?m)^---\s*$", open(a.turn_prompt, encoding="utf-8").read())
              if b.strip()] if a.turn_prompt else [])
    task_tok = int(max(map(len, tasks)) / cpt) + 64 if tasks else 0   # + chat-template margin
    n_err, summaries = 0, []
    for rep in range(a.reps):
        cid = uuid.uuid4().hex[:12]
        msgs, pos, turn, last = [], 0, 0, None
        prev_ctx = 0                       # turn 0 starts from an empty context
        while True:
            n = int((a.start_tokens if turn == 0 else a.step_tokens) * cpt)
            if pos + n > len(src):
                break                                                   # source exhausted
            if turn == 0:
                content = f"[conversation-id {cid}]\n\n" + src[pos:pos + n]
            elif tasks:
                chunk = src[pos:pos + n]
                content = (chunk + "\n\n" if chunk else "") + tasks[(turn - 1) % len(tasks)]
            else:
                content = (f"Part {turn + 1} of the material follows. Continue the review with it.\n\n"
                           + src[pos:pos + n])
            msgs.append({"role": "user", "content": content})
            pos += n
            payload = {"model": a.model, "max_tokens": a.max_tokens, "temperature": a.temperature,
                       "messages": list(msgs)}
            payload.update(_sampling(a, rep))
            if kwargs:
                payload["chat_template_kwargs"] = kwargs
            kv_stop, kv_vals = threading.Event(), []
            kv_t = threading.Thread(target=_kv_poller, args=(a.url, kv_stop, kv_vals), daemon=True)
            kv_t.start()
            w_start = time.time()
            s = stream(a.url, "chat", payload, a.timeout)
            kv_stop.set(); kv_t.join(timeout=10)
            row = {"kind": "turn", "label": a.label, "engine": a.engine, "rep": rep, "turn": turn,
                   "conversation_id": cid}
            if "error" not in s and not s.get("finish"):   # cut stream: tokens arrived, no finish_reason
                s = {"error": "stream ended without finish_reason (interrupted)", "total_s": s["total_s"]}
            if "error" in s:
                row.update(error=s["error"], total_s=round(s.get("total_s", 0), 3))
                print(json.dumps(_tagged(row, a))); n_err += 1
                break
            m = _request_metrics(s)
            cached = (s["usage"].get("prompt_tokens_details") or {}).get("cached_tokens")
            ctx = m["prompt_tokens"]
            new = ctx - cached if (ctx is not None and cached is not None) else None
            # client-side growth: works on engines whose usage has no cached_tokens
            delta = ctx - prev_ctx if (ctx is not None and prev_ctx is not None) else None
            prev_ctx = ctx
            m.pop("prefill_tok_s")         # full-prompt/ttft would count cached tokens as prefilled
            rc = _rate_cols(s)
            rc.pop("prefill_tok_s_wall")   # same reason (prefill_tok_s_server stays: the server's own count)
            row.update(m)
            row.update(_wall(w_start, s))
            row.update(_turn_cols(m, ctx, cached, new, delta, s["finish"], kv_vals))
            row.update(rc)
            if "seed" in payload:
                row["seed"] = payload["seed"]
            print(json.dumps(_tagged(row, a)), flush=True)
            msgs.append({"role": "assistant", "content": s["content"] or s["reasoning"]})
            last = row
            turn += 1
            if (ctx or 0) + m["gen_tokens"] + a.step_tokens + task_tok + a.max_tokens > a.max_depth:
                break
        summaries.append({"rep": rep, "turns": turn,
                          "final_context_tokens": last["context_tokens"] if last else None})
    print(json.dumps(_tagged(_conv_summary(a, kwargs, summaries, n_err), a)))
    if n_err == a.reps:
        sys.exit(2)


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
def _json_obj(v):
    try:
        o = json.loads(v)
    except json.JSONDecodeError as e:
        raise argparse.ArgumentTypeError(f"not JSON ({e}): {v!r}")
    if not isinstance(o, dict):
        raise argparse.ArgumentTypeError(f"must be a JSON object: {v!r}")
    return o


def _sampling_arg(v):
    o = _json_obj(v)
    bad = sorted(set(o) - SAMPLER_KEYS)
    if bad:
        raise argparse.ArgumentTypeError(f"not a sampler key {bad}; allowed: {sorted(SAMPLER_KEYS)}")
    for k, x in o.items():
        ok = type(x) is int if k in SAMPLER_INT else type(x) in (int, float)   # bool/str/null/list refused
        if not ok:
            raise argparse.ArgumentTypeError(f"{k} must be {'an integer' if k in SAMPLER_INT else 'a number'}: {x!r}")
    return o


def _tag_arg(v):
    k, sep, val = v.partition("=")
    k, val = k.strip(), val.strip()
    if not sep or not k or not val:       # an empty value is usually an unset shell variable
        raise argparse.ArgumentTypeError(f"want k=v with both sides non-empty: {v!r}")
    if k in TAG_INT:
        if not re.fullmatch(r"-?\d+", val):
            raise argparse.ArgumentTypeError(f"{k} must be an integer: {val!r}")
        return k, int(val)
    return k, val


def _min_gen_arg(v):
    n = int(v)
    if n < 0:
        raise argparse.ArgumentTypeError(f"must be >= 0: {v}")
    return n


def _shared_args(p):
    """Flags probe and conversation both take (27B-arms speed campaign: G2a/G2e)."""
    p.add_argument("--sampling", type=_sampling_arg, default=None,
                   help='JSON sent verbatim in every request, e.g. \'{"top_p":0.95,"top_k":20,"min_p":0,'
                        '"presence_penalty":0,"seed":1}\'. Keys: temperature top_p top_k min_p '
                        'presence_penalty frequency_penalty repeat_penalty (llama.cpp) repetition_penalty (vLLM) seed (numbers; top_k/seed int). '
                        'May override --temperature; seed += rep')
    p.add_argument("--tag", type=_tag_arg, action="append", default=[], metavar="K=V",
                   help="repeatable; copied into every emitted row. depth/n/tg are stored as int, every "
                        "other value as a string; a key naming an emitted column is refused")


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
    p.add_argument("--prefix-mode", choices=["none", "unique", "shared", "tail"], default="none",
                   help="none=verbatim, unique=uuid PREFIX (cold, defeats the cache), "
                        "shared=byte-identical (100%% hit), tail=shared body + divergent tail "
                        "(partial hit — the realistic agentic pattern)")
    p.add_argument("--tail", action="append",
                   help="prefix-mode=tail only: a tail appended to the shared body, cycled per "
                        "request. Repeatable. A literal {} in the value is replaced by a random "
                        "hex id. Omitted => one uuid-only tail.")
    p.add_argument("--api", choices=["completions", "chat"], default="completions")
    p.add_argument("--timeout", type=float, default=1200.0)
    p.add_argument("--chat-template-kwargs", type=_json_obj, default=None,
                   help='JSON (needs --api chat), e.g. \'{"enable_thinking":true}\'')
    p.add_argument("--min-gen", type=_min_gen_arg, default=0,
                   help="rows with fewer generated tokens are `short`: excluded from the aggregate, "
                        "counted in n_short; exit 3 unless every request passed (0 = off)")
    _shared_args(p)
    p.set_defaults(func=run_probe)

    c = sub.add_parser("conversation", help="growing multi-turn chat, prior turns cached (JSONL to stdout)")
    c.add_argument("--url", required=True, help="base URL incl. /v1")
    c.add_argument("--model", default="local")
    c.add_argument("--prompt-file", action="append", required=True,
                   help="source text the turns are cut from (first file used); must hold >= max-depth tokens")
    c.add_argument("--start-tokens", type=int, default=10000, help="size of turn 0")
    c.add_argument("--step-tokens", type=int, default=15000, help="new material added per later turn")
    c.add_argument("--max-depth", type=int, required=True, help="stop before context would exceed this")
    c.add_argument("--max-tokens", type=int, default=256)
    c.add_argument("--temperature", type=float, default=0.2)
    c.add_argument("--chat-template-kwargs", default="", help='JSON, e.g. \'{"reasoning_effort":"low"}\'')
    c.add_argument("--turn-prompt", default="",
                   help="task file appended to every later turn (blocks split on a '---' line, cycled)")
    c.add_argument("--reps", type=int, default=1, help="independent conversations")
    c.add_argument("--engine", default="unknown")
    c.add_argument("--label", default="run")
    c.add_argument("--timeout", type=float, default=1200.0)
    _shared_args(c)
    c.set_defaults(func=run_conversation)

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
    if a.mode in ("probe", "conversation"):
        keys = [k for k, _ in a.tag]
        dup = sorted({k for k in keys if keys.count(k) > 1})
        if dup:
            ap.error(f"--tag repeated: {dup}")
        a.tags = dict(a.tag)
        clash = sorted(set(a.tags) & _reserved_keys())
        if clash:
            ap.error(f"--tag names a column this tool writes: {clash}")
    if a.mode == "probe" and a.chat_template_kwargs and a.api != "chat":
        ap.error("--chat-template-kwargs needs --api chat (completions applies no chat template)")
    a.func(a)


if __name__ == "__main__":
    main()
