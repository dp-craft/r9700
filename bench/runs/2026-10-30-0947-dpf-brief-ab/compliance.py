#!/usr/bin/env python3
"""RUNBOOK compliance counters per brief window, from the stream-json sessions (tool calls + tool results).
Brief windows: heretic's one session is split at its progress.md edits (W2-06 / W2-07 / W2-08); RedHat d0.5 = W2-06
(the whole run); RedHat d0 = W2-08 (capture + part 1 + part 2).
Usage: compliance.py RUNROOT > compliance.json"""
import json, sys, os, re, glob, collections

ROOT = sys.argv[1]
RULE_FILES = {"RUNBOOK": "27b-fix/RUNBOOK.md", "04-check-method": "04-check-method.md", "01-writer-brief": "01-writer-brief.md",
              "03-review-protocol": "03-review-protocol.md", "02-contracts": "02-contracts.md", "W2-04 example": "briefs/W2-04.md"}


def events(files):
    for f in files:
        for l in open(os.path.join(ROOT, f), errors="replace"):
            try: d = json.loads(l)
            except Exception: continue
            yield d


def load(files):
    calls, results, compactions, last_ts = [], {}, [], ""
    for d in events(files):
        ts = d.get("timestamp") or last_ts; last_ts = ts
        if d.get("type") == "system" and d.get("subtype") == "compact_boundary": compactions.append(ts)
        if d.get("type") == "assistant":
            for c in d["message"].get("content") or []:
                if c.get("type") == "tool_use": calls.append({"ts": ts, "name": c["name"], "input": c.get("input") or {}, "id": c["id"]})
        elif d.get("type") == "user" and isinstance(d["message"].get("content"), list):
            for c in d["message"]["content"]:
                if c.get("type") == "tool_result":
                    x = c.get("content"); x = x if isinstance(x, str) else " ".join(y.get("text", "") for y in x or [] if isinstance(y, dict))
                    results[c["tool_use_id"]] = x
    return calls, results, compactions


def text_of(c):
    i = c["input"]; return " ".join(str(i.get(k, "")) for k in ("file_path", "command", "pattern", "path", "prompt", "description"))


def stats(bid, calls, results, compactions):
    brief = f"briefs/{bid}.md"; out = {}
    out["tool_calls_by_name"] = dict(collections.Counter(c["name"] for c in calls).most_common())
    out["subagent_calls"] = sum(c["name"] in ("Task", "Agent") for c in calls)
    out["rule_file_accesses"] = {k: sum(v in text_of(c) for c in calls) for k, v in RULE_FILES.items()}
    out["compactions"] = len(compactions)
    # A: Part 1 before the brief body; Opus not before B
    body = [c["ts"] for c in calls if brief in text_of(c) and c["name"] in ("Read", "Bash", "Grep")]
    rw = [c["ts"] for c in calls if c["name"] in ("Write", "Edit") and c["input"].get("file_path", "").endswith(f"{bid}.refine-27b.md")]
    # a real read of the Opus review (Read, or cat/sed/head/tail/grep of it); ls / wc -l of the dir are not reads
    op = [c["ts"] for c in calls if f"opus/{bid}" in text_of(c) and (c["name"] == "Read" or (c["name"] == "Bash" and re.search(
        r"\b(cat|sed|head|tail|grep|awk|less)\b[^|;&]*opus/" + bid, c["input"].get("command", ""))))]
    cw = [c["ts"] for c in calls if c["name"] in ("Write", "Edit") and c["input"].get("file_path", "").endswith(f"{bid}.compare.md")]
    bw = [c["ts"] for c in calls if c["name"] in ("Write", "Edit") and c["input"].get("file_path", "").endswith(brief)]
    out["A_first_brief_body_access"] = min(body, default=None)
    out["A_first_review_write"] = min(rw, default=None)
    out["A_part1_written_before_body"] = bool(rw and body and min(rw) < min(body))
    out["A_review_writes"] = len(rw)
    out["opus_first_access"] = min(op, default=None)
    out["opus_before_review_written"] = bool(op and (not rw or min(op) < min(rw)))
    # B: own checking between the first Opus access and the first compare write
    if op:
        endB = min(cw, default="~")
        b = [c for c in calls if min(op) < c["ts"] < endB and not (c["name"] in ("Write", "Edit") and brief in text_of(c))]
        out["B_tool_calls_before_compare_write"] = len(b)
        out["B_code_checks"] = sum(c["name"] in ("Read", "Grep", "Glob", "Bash") and "opus/" not in text_of(c) and "27b-fix/" not in text_of(c) for c in b)
    out["C_brief_writes"] = len(bw)
    out["C_brief_written_before_compare"] = bool(bw and cw and min(bw) < min(cw))
    # probes: tsc / eslint runs, and whether the last one of each kind was clean
    pr = [c for c in calls if c["name"] == "Bash" and re.search(r"\b(tsc|eslint)\b", c["input"].get("command", ""))]
    out["probe_runs_tsc_eslint"] = len(pr)
    out["probe_runs_after_opus"] = sum(1 for c in pr if op and c["ts"] > min(op))
    # Read <= 80 lines
    reads = [c for c in calls if c["name"] == "Read"]
    big = [c for c in reads if not c["input"].get("limit") or int(c["input"].get("limit") or 0) > 80]
    out["reads"] = len(reads); out["reads_without_limit_or_over_80"] = len(big)
    lines = [results.get(c["id"], "").count("\n") for c in big]
    out["reads_over_80_returned_lines_median"] = sorted(lines)[len(lines) // 2] if lines else 0
    out["reads_over_80_returned_gt80"] = sum(n > 80 for n in lines)
    # how much tool output went into the context
    out["tool_result_chars_total"] = sum(len(results.get(c["id"], "")) for c in calls)
    out["tool_result_chars_by_name"] = {k: sum(len(results.get(c["id"], "")) for c in calls if c["name"] == k) for k in out["tool_calls_by_name"]}
    out["tool_errors"] = sum(results.get(c["id"], "").startswith("<tool_use_error>") or "Exit code" in results.get(c["id"], "")[:30] for c in calls)
    return out


res = {}
# heretic: split at progress.md edits
calls, results, comp = load(["heretic/session-0.jsonl"])
cuts = [c["ts"] for c in calls if c["name"] == "Edit" and c["input"].get("file_path", "").endswith("27b-fix/progress.md")]
lo = ""
for bid, hi in zip(["W2-06", "W2-07", "W2-08"], cuts):
    w = [c for c in calls if lo < c["ts"] <= hi]
    res[f"heretic_{bid}"] = {"window": [lo or w[0]["ts"], hi], **stats(bid, w, results, [t for t in comp if lo < t <= hi])}
    lo = hi
calls, results, comp = load(sorted(os.path.relpath(f, ROOT) for f in glob.glob(ROOT + "/redhat/session-*.jsonl")))
res["redhat_d05_W2-06"] = {"window": [calls[0]["ts"], calls[-1]["ts"]], **stats("W2-06", calls, results, comp)}
calls, results, comp = load(["delta0-w208/session-0.jsonl", "delta0-w208/session-1.jsonl", "delta0-w208-part2/session-1.jsonl"])
res["redhat_d0_W2-08"] = {"window": [calls[0]["ts"], calls[-1]["ts"]], **stats("W2-08", calls, results, comp)}
f191 = sorted(os.path.relpath(f, ROOT) for f in glob.glob(ROOT + "/sly191-w208/session-*.jsonl"))
if f191:
    calls, results, comp = load(f191)
    res["redhat_191_W2-08"] = {"window": [calls[0]["ts"], calls[-1]["ts"]], **stats("W2-08", calls, results, comp)}
print(json.dumps(res, indent=1))
