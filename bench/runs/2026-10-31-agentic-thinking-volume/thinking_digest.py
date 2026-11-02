#!/usr/bin/env python3
"""Per-step thinking / exploration / compaction digest of agentic W2-08 arms (claude-project transcripts).

Window = session start .. the blind boundary = first tool call that READS the Opus reference review
(Read of .../27b-fix/opus/W2-08.md, or cat/sed/head/tail/less/awk/grep on it; ls/test/wc do not count).
Usage: thinking_digest.py NAME=RUN_ARM_DIR ...   -> one JSON line per arm (stdout).
Data source for docs/analysis/2026-10-31-1640-agentic-thinking-volume-and-levers.md."""
import glob, json, re, sys
from datetime import datetime

BOUND = re.compile(r"\b(cat|sed|head|tail|less|awk|grep)\b[^|;&]*27b-fix/opus/W2-08")
READ = re.compile(r"27b-fix/opus/W2-08")
PATH = re.compile(r"((?:docs|tools|briefs)/[\w./-]+\.(?:md|ts|json|tsv))")
CATS = [("probe", r"\b(tsc|eslint|vitest|npx|node )"), ("git", r"\bgit\b"), ("search", r"\b(grep|rg|find|ls)\b"),
        ("read", r"\b(cat|sed -n|head|tail|wc)\b")]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def digest(name, arm):
    msgs, order, cats, seen = {}, [], {}, {}
    epoch, rr_cross, rr_same, reads, ctx = 0, 0, 0, 0, []
    comp, t0, t1, stop = [], None, None, False
    for line in open(glob.glob(arm + "/claude-project/*.jsonl")[0]):
        r = json.loads(line)
        t0 = t0 or r.get("timestamp")
        if r.get("type") == "system" and r.get("subtype") == "compact_boundary":
            md = r.get("compactMetadata") or {}
            comp.append({"pre": md.get("preTokens"), "post": md.get("postTokens"), "s": round((md.get("durationMs") or 0) / 1000)})
            epoch += 1
            continue
        m = r.get("message") or {}
        if r.get("type") != "assistant" or not isinstance(m.get("content"), list):
            continue
        mid = m.get("id")
        if mid not in msgs:
            msgs[mid] = {"think": 0, "tools": 0}
            order.append(mid)
            u = m.get("usage") or {}
            ctx.append(u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0))
        for c in m["content"]:
            if c.get("type") == "thinking":
                msgs[mid]["think"] += len(c.get("thinking", ""))
            if c.get("type") != "tool_use":
                continue
            i = c.get("input") or {}
            if (c["name"] == "Read" and READ.search(i.get("file_path", ""))) or \
               (c["name"] == "Bash" and BOUND.search(i.get("command", ""))):
                stop, t1 = True, r["timestamp"]
                break
            msgs[mid]["tools"] += 1
            k = c["name"] if c["name"] != "Bash" else next((k for k, p in CATS if re.search(p, i.get("command", ""))), "bash-other")
            cats[k] = cats.get(k, 0) + 1
            paths = []
            if c["name"] == "Read":
                paths = [re.sub(r"^.*?/(docs|tools)/", r"\1/", i.get("file_path", ""))]
            elif c["name"] == "Bash" and re.match(r"\s*(cat|sed -n|head|tail)\b", i.get("command", "")):
                paths = PATH.findall(i["command"])
            for p in paths:
                reads += 1
                if p in seen:
                    rr_cross += seen[p] < epoch
                    rr_same += seen[p] == epoch
                seen[p] = epoch
        if stop:
            break
    th = [msgs[i]["think"] for i in order]
    tools = sum(msgs[i]["tools"] for i in order)
    s = sorted([t for t in th if t > 0])
    q = lambda p: s[min(len(s) - 1, int(p * len(s)))] if s else 0
    top = sorted(th, reverse=True)
    return {"arm": name, "window_s": round((ts(t1) - ts(t0)).total_seconds()) if t1 else None, "boundary_found": stop,
            "assistant_msgs": len(order), "tool_calls": tools, "think_chars": sum(th),
            "think_chars_per_tool_call": round(sum(th) / max(tools, 1)), "think_p50": q(.5), "think_p90": q(.9),
            "think_max": max(th or [0]), "msgs_think_gt10k": sum(t > 10000 for t in th),
            "top10pct_msgs_think_share": round(sum(top[:max(1, len(top) // 10)]) / max(sum(th), 1), 2),
            "tool_categories": dict(sorted(cats.items(), key=lambda x: -x[1])),
            "file_reads": reads, "distinct_files_read": len(seen), "rereads_after_compaction": rr_cross,
            "rereads_same_epoch": rr_same, "compactions_before_boundary": comp, "ctx_peak": max(ctx or [0])}


for a in sys.argv[1:]:
    n, d = a.split("=", 1)
    print(json.dumps(digest(n, d)))
