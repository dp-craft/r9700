#!/usr/bin/env python3
"""session-*.jsonl (claude -p stream-json) of one arm -> metrics.json: behaviour + RUNBOOK compliance, all MEASURED from the log.
Usage: metrics.py ARM_DIR"""
import json, re, sys, glob, os, collections

arm = sys.argv[1]
P = "docs/plans/2026-10-28-2239-dpf-tui-f0-f1"
ALLOWED = [re.compile(p) for p in (
    rf"{P}/briefs/W2-0[678]\.md$", rf"{P}/review/W2-0[678]\.refine-27b\.md$",
    rf"{P}/review/27b-fix/W2-0[678]\.compare\.md$", rf"{P}/review/27b-fix/progress\.md$", r"^/tmp/dp-refine/")]
PROG = re.compile(r"^W2-0[678] \| 27B \d+ \| Opus \d+ \| both \d+ \| real: 27B-only \d+, Opus-only \d+, both \d+ \| "
                  r"not real: 27B \d+, Opus \d+ \| unsure \d+ \| fixed \d+ \| ESLINT-UNCHECKED\? \S+ \| BLOCKED: .+$")
NUDGE = "Your previous response had no visible output"
CAP_HIT = "Output token limit hit"          # Claude Code's follow-up after a reply hit CLAUDE_CODE_MAX_OUTPUT_TOKENS

calls = []
tools = collections.Counter(); tool_err = 0; msg_ids = set(); thinking_chars = text_chars = 0
compactions = []; nudges = 0; cap_hits = 0; compact_failed = 0; runaway = []   # runaway = thinking blocks > 100k chars
visible = collections.defaultdict(bool)   # message id -> has text or a tool call (stream-json sends one event per block)
writes = []          # (ts, tool, path)
opus_reads = []      # (ts, brief) any tool input naming 27b-fix/opus/W2-0x
bash_cmds = []; commits = 0; edits_outside = set()
first_ts = last_ts = None
for f in sorted(glob.glob(os.path.join(arm, "session-*.jsonl")), key=lambda s: int(re.search(r"session-(\d+)", s).group(1))):
    res = None
    for line in open(f, encoding="utf-8", errors="replace"):
        try: d = json.loads(line)
        except Exception: continue
        ts = d.get("timestamp")
        if ts: first_ts = first_ts or ts; last_ts = ts
        t, st = d.get("type"), d.get("subtype")
        if t == "system" and st == "status" and d.get("compact_result") == "failed": compact_failed += 1
        if t == "system" and st == "compact_boundary":
            m = d.get("compact_metadata", {}); compactions.append({"pre_tokens": m.get("pre_tokens"), "post_tokens": m.get("post_tokens"), "trigger": m.get("trigger")})
        elif t == "result":
            res = {k: d.get(k) for k in ("subtype", "is_error", "duration_ms", "duration_api_ms", "num_turns", "usage", "modelUsage")}
        elif t == "assistant":
            m = d["message"]; msg_ids.add(m.get("id"))
            content = m.get("content") or []
            visible[m.get("id")] |= any(c.get("type") == "tool_use" or (c.get("type") == "text" and c.get("text", "").strip()) for c in content)
            for c in content:
                ct = c.get("type")
                if ct == "thinking":
                    th = c.get("thinking", ""); thinking_chars += len(th)
                    if len(th) > 100000:
                        ls = [x.strip() for x in th.splitlines() if x.strip()]
                        runaway.append({"ts": ts, "chars": len(th), "lines": len(ls), "distinct": len(set(ls))})
                elif ct == "text": text_chars += len(c.get("text", ""))
                elif ct == "tool_use":
                    name, inp = c.get("name"), c.get("input") or {}
                    tools[name] += 1
                    blob = json.dumps(inp)
                    for b in re.findall(r"27b-fix/opus/(W2-0[678])", blob): opus_reads.append((ts, b))
                    if name in ("Write", "Edit", "NotebookEdit"):
                        p = inp.get("file_path", ""); writes.append((ts, name, p))
                        rel = p.split("dpf-bench-")[-1].split("/", 1)[-1] if "dpf-bench-" in p else p
                        if not any(a.search(rel) for a in ALLOWED): edits_outside.add(p)
                    if name == "Bash":
                        cmd = inp.get("command", ""); bash_cmds.append(cmd)
                        if re.search(r"\bgit\s+commit\b", cmd): commits += 1
        elif t == "user":
            c = d.get("message", {}).get("content")
            if isinstance(c, str): nudges += NUDGE in c; cap_hits += CAP_HIT in c
            if isinstance(c, list):
                for x in c:
                    if x.get("type") == "tool_result" and x.get("is_error"): tool_err += 1
                    if x.get("type") == "text": nudges += NUDGE in x.get("text", ""); cap_hits += CAP_HIT in x.get("text", "")
    calls.append({"file": os.path.basename(f), "result": res})

# blind-review order: an opus read before the brief's refine-27b.md was first written breaks RUNBOOK step A
first_refine = {}
for ts, _, p in writes:
    m = re.search(r"review/(W2-0[678])\.refine-27b\.md$", p)
    if m and m.group(1) not in first_refine: first_refine[m.group(1)] = ts
early_opus = sorted({b for ts, b in opus_reads if b not in first_refine or ts < first_refine[b]})

prog_path = os.path.join(arm, "outputs", "progress.md")
w2_lines = [l.rstrip("\n") for l in open(prog_path)] if os.path.exists(prog_path) else []
w2_lines = [l for l in w2_lines if l.startswith("W2-")]
status_after = open(os.path.join(arm, "wt-status-after.txt")).read().split("\n") if os.path.exists(os.path.join(arm, "wt-status-after.txt")) else []
changed = [l[3:] for l in status_after if l.strip()]
changed_outside = [p for p in changed if not any(a.search(p) for a in ALLOWED) and not p.endswith("01-writer-brief.md")]

out = {
    "arm": os.path.basename(arm.rstrip("/")),
    "calls": calls, "first_ts": first_ts, "last_ts": last_ts,
    "assistant_messages": len(msg_ids), "tool_calls": dict(tools), "tool_calls_total": sum(tools.values()),
    "tool_errors": tool_err, "thinking_chars": thinking_chars, "text_chars": text_chars,
    "compactions": compactions, "compactions_failed": compact_failed, "empty_assistant_turns": sum(1 for v in visible.values() if not v), "no_visible_output_nudges": nudges,
    "output_cap_hits": cap_hits, "runaway_thinking_blocks": runaway,
    "first_write_per_output": {p.split("/")[-1]: ts for ts, _, p in sorted(writes)[::-1]},
    "runbook": {
        "opus_read_before_blind_review_written": early_opus,
        "edit_tool_outside_allowed": sorted(edits_outside),
        "tracked_changes_outside_allowed": changed_outside,
        "git_commit_attempts": commits,
        "progress_w2_lines": w2_lines,
        "progress_lines_format_ok": [bool(PROG.match(l)) for l in w2_lines],
    },
}
json.dump(out, open(os.path.join(arm, "metrics.json"), "w"), indent=1)
print(json.dumps({k: out[k] for k in ("assistant_messages", "tool_calls_total", "tool_errors", "empty_assistant_turns", "no_visible_output_nudges", "output_cap_hits", "compactions_failed")}),
      "\nrunaway", out["runaway_thinking_blocks"],
      "\ncompactions", out["compactions"], "\nrunbook", json.dumps(out["runbook"], indent=1)[:1500])
