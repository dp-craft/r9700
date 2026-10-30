#!/usr/bin/env python3
"""Why is a run slow, and how repetitive is it? Per run (optionally a UTC time window), from three logs:
  stream-json (claude -p --output-format stream-json): time split = model (incl. compaction: its status events carry no
      timestamp) vs tool (tool_use -> result); compactions ok/failed; per-step split (A blind / B compare / C fix) by the
      last write of the review and compare files; "Wasted call" re-reads; hedge-word rates; repetition of thinking (within-block distinct lines, cross-block repeated lines and
      8-word shingles) and of tool calls (identical calls, files read >= 3x)
  Claude Code transcript (claude-project/*.jsonl): per request context = input + cache_read + cache_creation, output tokens
  vLLM container log: 10 s windows -> generated / prefilled tokens, decode and prefill seconds, acceptance
Usage: slowness.py RUNROOT > out.json   (run definitions below)"""
import json, re, sys, glob, os, statistics as st, collections, datetime as dt

ROOT = sys.argv[1]
RUNS = {
    "heretic_all": dict(stream=["heretic/session-0.jsonl"], trans="heretic/claude-project/*.jsonl", server=["heretic/server-container.log"]),
    "heretic_w208": dict(stream=["heretic/session-0.jsonl"], trans="heretic/claude-project/*.jsonl", server=["heretic/server-container.log"],
                         t0="2026-10-30T09:19:53", t1="2026-10-30T09:31:50", phases="W2-08"),
    "redhat_d05_all": dict(stream=sorted(glob.glob(ROOT + "/redhat/session-*.jsonl")), trans="redhat/claude-project/*.jsonl", server=["redhat/server-container.log"]),
    "redhat_d0_w208": dict(stream=["delta0-w208/session-0.jsonl", "delta0-w208/session-1.jsonl", "delta0-w208-part2/session-1.jsonl"],
                           trans="delta0-w208-part2/claude-project/*.jsonl",
                           server=[("replay/server-container-B.log", "2026-10-30T12:39:22", "2026-10-30T12:43:49"), "delta0-w208/server-container.log",
                                   "delta0-w208-part2/server-container.log"], phases="W2-08"),
    "redhat_191_w208": dict(stream=sorted(glob.glob(ROOT + "/sly191-w208/session-*.jsonl")), trans="sly191-w208/claude-project/*.jsonl",
                            server=["sly191-w208/server-container.log"], phases="W2-08"),
}
P = lambda p: p if p.startswith("/") else os.path.join(ROOT, p)
ts_of = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
norm = lambda s: re.sub(r"\s+", " ", s).strip()


def inwin(ts, r):
    return (not r.get("t0")) or (ts and r["t0"] <= ts[:19] <= r["t1"])


def stream_stats(r):
    # every interval between consecutive timestamped events is charged to what ends it: an assistant block = model time
    # (prefill + generation of that block), a user event after a block = tool time, a compact_boundary = compaction
    model_s = tool_s = compact_s = 0.0; compact_pre = []; think_ms = 0; msgs = set(); wasted = 0; phases = r.get("phases"); opus_reads = []; compare_writes = []; steps = []
    blocks = []; tools = []; compact_ok = compact_fail = 0
    for f in r["stream"]:
        prev = None; last_a = False
        for l in open(P(f), errors="replace"):
            try: d = json.loads(l)
            except Exception: continue
            t, ts = d.get("type"), d.get("timestamp")
            if t == "system" and d.get("subtype") == "thinking_tokens": continue
            if t == "system" and d.get("subtype") == "status" and d.get("compact_result") == "failed":
                compact_fail += inwin(prev, r); continue
            if t == "system" and d.get("subtype") == "compact_boundary" and inwin(prev, r):
                cm = d.get("compact_metadata") or {}; compact_ok += 1
                compact_s += (cm.get("duration_ms") or 0) / 1000; compact_pre.append(cm.get("pre_tokens")); continue
            if t == "user":
                for c in d["message"].get("content") or [] if isinstance(d["message"].get("content"), list) else []:
                    if c.get("type") == "tool_result" and inwin(ts or prev, r):
                        x = c.get("content"); x = x if isinstance(x, str) else " ".join(y.get("text", "") for y in x or [] if isinstance(y, dict))
                        wasted += x.startswith("Wasted call")
            if not ts: continue
            if not inwin(ts, r): prev = ts; continue
            gap = (ts_of(ts) - ts_of(prev)).total_seconds() if prev else 0.0
            if t == "assistant":
                model_s += gap
                m = d["message"]; msgs.add(m.get("id"))
                think_ms += d.get("thinking_duration_ms") or 0
                for c in m.get("content") or []:
                    if c.get("type") == "thinking": blocks.append((ts, c.get("thinking", "")))
                    elif c.get("type") == "tool_use":
                        tools.append((c.get("name"), json.dumps(c.get("input"), sort_keys=True)))
                        fp = (c.get("input") or {}).get("file_path", "")
                        if c.get("name") == "Read" and phases and fp.endswith("/opus/" + phases + ".md"): opus_reads.append(ts)
                        if c.get("name") in ("Write", "Edit") and phases and fp.endswith(phases + ".compare.md"): compare_writes.append(ts)
                steps.append((ts, gap, sum(len(c.get("thinking", "")) for c in m.get("content") or [] if c.get("type") == "thinking"),
                              sum(c.get("type") == "tool_use" for c in m.get("content") or []), m.get("id")))
            elif t == "user":
                if last_a: tool_s += gap
                else: model_s += gap; steps.append((ts, gap, 0, 0, None))
            last_a = t == "assistant"; prev = ts
    # repetition
    seen_lines, seen_sh = set(), set(); tot_lines = rep_lines = tot_sh = rep_sh = 0; within = []
    for ts, th in blocks:
        ls = [norm(x) for x in th.splitlines() if len(norm(x)) >= 40]
        if ls: within.append((len(ls), len(set(ls)) / len(ls)))
        for x in set(ls):
            tot_lines += 1; rep_lines += x in seen_lines
        seen_lines |= set(ls)
        w = norm(th).split(); sh = {" ".join(w[i:i + 8]) for i in range(0, max(0, len(w) - 7))}
        tot_sh += len(sh); rep_sh += len(sh & seen_sh); seen_sh |= sh
    tc = collections.Counter(tools)
    reads = collections.Counter(json.loads(i).get("file_path") for n, i in tools if n == "Read")
    allth = " ".join(b for _, b in blocks).lower()
    hedge = {k: round(1e4 * allth.count(k) / max(1, len(allth)), 2) for k in ("wait", "actually", "let me re", "double-check", "hmm")}
    ph = {}
    if phases:   # A blind = until the first Read of the Opus review; B = until the first write of the compare file; C fix = the rest
        endA = min(opus_reads, default="~"); endB = min(compare_writes, default="~")
        for t, g, th, ntc, mid in steps:
            k = "A_blind" if t < endA else "B_compare" if t < endB else "C_fix_and_rest"
            q = ph.setdefault(k, {"requests": set(), "model_s": 0.0, "thinking_chars": 0, "tool_calls": 0})
            if mid: q["requests"].add(mid)
            q["model_s"] += g; q["thinking_chars"] += th; q["tool_calls"] += ntc
        for q in ph.values(): q["requests"] = len(q["requests"]); q["model_s"] = round(q["model_s"])
    return {"assistant_messages": len(msgs), "model_s": round(model_s), "tool_s": round(tool_s), "wasted_call_reads": wasted,
            "compaction_s_in_model_s": round(compact_s), "compaction_pre_tokens": compact_pre,
            "hedge_markers_per_10k_chars": hedge, "phases": ph,
            "thinking_s_client": round(think_ms / 1000), "compactions_ok": compact_ok, "compactions_failed": compact_fail,
            "thinking_blocks": len(blocks), "thinking_chars": sum(len(b) for _, b in blocks),
            "within_block_distinct_line_ratio_weighted": round(sum(n * q for n, q in within) / max(1, sum(n for n, _ in within)), 3),
            "blocks_lt_0.7_distinct": sum(1 for n, q in within if n >= 20 and q < 0.7),
            "cross_block_repeated_lines_pct": round(100 * rep_lines / max(1, tot_lines), 1),
            "cross_block_repeated_8gram_pct": round(100 * rep_sh / max(1, tot_sh), 1),
            "tool_calls": len(tools), "identical_tool_calls_repeated": sum(v - 1 for v in tc.values() if v > 1),
            "files_read_3x_or_more": sum(1 for p, v in reads.items() if v >= 3), "max_reads_of_one_file": max(reads.values() or [0])}


def trans_stats(r):
    per = {}
    for f in glob.glob(P(r["trans"])):
        for l in open(f, errors="replace"):
            try: d = json.loads(l)
            except Exception: continue
            if d.get("type") != "assistant" or not inwin(d.get("timestamp"), r): continue
            m = d["message"]; u = m.get("usage") or {}
            ctx = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
            p = per.setdefault(m.get("id"), {"t": d["timestamp"], "ctx": 0, "out": 0, "cached": 0, "think": 0, "other": 0})
            for c in m.get("content") or []:
                if c.get("type") == "thinking": p["think"] += len(c.get("thinking", ""))
                else: p["other"] += len(json.dumps(c))
            p["ctx"] = max(p["ctx"], ctx); p["out"] = max(p["out"], u.get("output_tokens") or 0); p["cached"] = max(p["cached"], u.get("cache_read_input_tokens") or 0)
    v = sorted((p for p in per.values() if p["ctx"]), key=lambda p: p["t"])
    ctx = [p["ctx"] for p in v]
    # thinking-heavy turn (>= 3000 output tokens, > 80 % thinking chars): growth of the NEXT prompt / this turn's output.
    # ~1 or more = the reasoning went back into the prompt; ~0 = it was dropped. Negative growth (compaction) skipped.
    gr = [(b["ctx"] - a["ctx"]) / a["out"] for a, b in zip(v, v[1:])
          if b["ctx"] >= a["ctx"] and a["out"] >= 3000 and a["think"] > 0.8 * (a["think"] + a["other"])]
    return {"requests": len(v), "output_tokens": sum(p["out"] for p in v), "context_tokens_sent_total": sum(ctx),
            "context_median": int(st.median(ctx)) if ctx else 0, "context_mean": int(st.mean(ctx)) if ctx else 0, "context_max": max(ctx or [0]),
            "cached_share_pct": round(100 * sum(p["cached"] for p in v) / max(1, sum(ctx)), 1),
            "thinking_turns_tested": len(gr), "next_prompt_growth_over_output_median": round(st.median(gr), 2) if gr else None,
            "share_turns_reasoning_replayed": round(sum(x >= 0.8 for x in gr) / len(gr), 2) if gr else None}


def server_stats(r):
    gen = pre = dec_s = pre_s = pre_only = 0.0; acc = []
    for f in r["server"]:
        g = None; w = r
        if isinstance(f, tuple): f, w = f[0], {"t0": f[1], "t1": f[2]}
        for l in open(P(f), errors="replace"):
            m = re.search(r"(\d\d)-(\d\d) (\d\d:\d\d:\d\d).*Avg prompt throughput: ([0-9.]+) tokens/s, Avg generation throughput: ([0-9.]+)", l)
            if m:
                ts = f"2026-{m.group(1)}-{m.group(2)}T{m.group(3)}"
                if not inwin(ts, r) or not inwin(ts, w): g = None; continue
                p_, g = float(m.group(4)), float(m.group(5))
                pre += p_ * 10; gen += g * 10; pre_s += 10 * (p_ > 0); dec_s += 10 * (g > 5); pre_only += 10 * (p_ > 0 and g <= 5)
                continue
            m = re.search(r"Mean acceptance length: ([0-9.]+)", l)
            if m and g is not None and g > 5: acc.append(float(m.group(1))); g = None
    return {"generated_tokens_server": int(gen), "prefilled_tokens_server": int(pre), "decode_window_s": int(dec_s), "prefill_window_s": int(pre_s), "prefill_only_window_s": int(pre_only),
            "decode_tok_s": round(gen / dec_s, 1) if dec_s else None, "acceptance_mean": round(st.mean(acc), 2) if acc else None,
            "acceptance_ge7_pct": round(100 * sum(a >= 7 for a in acc) / len(acc), 1) if acc else None}


out = {}
for k, r in RUNS.items():
    out[k] = {"stream": stream_stats(r), "transcript": trans_stats(r), "server": server_stats(r)}
print(json.dumps(out, indent=1))
