#!/usr/bin/env python3
"""Template effect on token usage, from the Claude Code transcripts (claude-project/*.jsonl).
Per request: prompt size and its cached part (usage), each step's thinking text (tokenized with the model's tokenizer),
compaction boundaries. OLD reasoning of a request = the thinking of every earlier assistant step since the last compaction
except the newest one: what template v22.5 (Sly 1.8.1) replays and v22.5-sly2 (Sly 1.9.1) drops.
- residual check (which template did a run actually have): per step, growth of the next prompt minus the step's own
  tokens (thinking + text/tool call + tool result) under each hypothesis; the smaller median |residual| wins.
- counterfactual (INFERRED: same behaviour, other template): v22.5 run -> prompt - old; sly2 run -> prompt + old.
- compactions under the other template (INFERRED): total context growth / (trigger - mean post-compaction size).
Needs `tokenizers` (scratch venv). Usage: <venv>/bin/python template_tokens.py RUNROOT > template_tokens.json"""
import json, sys, os, glob, statistics as st
from tokenizers import Tokenizer

ROOT = sys.argv[1]
TOK = Tokenizer.from_file("/mnt/Lin1/work/vllm/sly-radiance/models/RedHatAI__Qwen3.8-27B-MXFP4@16a86728/tokenizer.json")
LIVE191 = os.path.expanduser("~/.claude/projects/-home-dev-work-dippe-dpf-bench-redhat191/*.jsonl")
RUNS = {
    "heretic_w208_v22.5": dict(trans="heretic/claude-project/*.jsonl", t0="2026-10-30T09:19:53", t1="2026-10-30T09:31:50"),
    "redhat_d0_w208_v22.5": dict(trans="delta0-w208-part2/claude-project/*.jsonl"),
    "redhat_191_w208_sly2": dict(trans="sly191-w208/claude-project/*.jsonl" if glob.glob(ROOT + "/sly191-w208/claude-project/*.jsonl") else LIVE191),
}
ntok = lambda s: len(TOK.encode(s).ids) if s else 0
P = lambda p: p if p.startswith("/") else os.path.join(ROOT, p)


def text_of(x):
    return x if isinstance(x, str) else " ".join(y.get("text", "") for y in x or [] if isinstance(y, dict))


def load(r):
    """-> segments: list of lists of steps {ctx, cached, out, R, C, T}; compaction metadata list."""
    steps, order, seg, comps, cur = {}, [], 0, [], None
    for f in sorted(glob.glob(P(r["trans"]))):
        for l in open(f, errors="replace"):
            try: d = json.loads(l)
            except Exception: continue
            ts = (d.get("timestamp") or "")[:19]
            if r.get("t0") and not (r["t0"] <= ts <= r["t1"]): continue
            if d.get("isSidechain"): continue
            if d.get("type") == "system" and d.get("subtype") == "compact_boundary":
                seg += 1; comps.append(d.get("compactMetadata") or {}); cur = None; continue
            if d.get("type") == "assistant":
                m = d["message"]; mid = m.get("id"); u = m.get("usage") or {}
                s = steps.get(mid)
                if s is None:
                    s = steps[mid] = {"seg": seg, "ts": ts, "ctx": 0, "cached": 0, "out": 0, "think": [], "other": [], "T": 0}; order.append(mid)
                ctx = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
                s["ctx"] = max(s["ctx"], ctx); s["cached"] = max(s["cached"], u.get("cache_read_input_tokens") or 0)
                s["out"] = max(s["out"], u.get("output_tokens") or 0)
                for c in m.get("content") or []:
                    if c.get("type") == "thinking": s["think"].append(c.get("thinking", ""))
                    elif c.get("type") == "text": s["other"].append(c.get("text", ""))
                    elif c.get("type") == "tool_use": s["other"].append(c.get("name", "") + json.dumps(c.get("input"), ensure_ascii=False))
                cur = s
            elif d.get("type") == "user" and cur is not None and isinstance(d["message"].get("content"), list):
                cur["T"] += sum(ntok(text_of(c.get("content"))) for c in d["message"]["content"] if c.get("type") == "tool_result")
    segs = {}
    for mid in order:
        s = steps[mid]
        if not s["ctx"]: continue
        s["R"] = ntok("".join(dict.fromkeys(s["think"]))); s["C"] = ntok("".join(dict.fromkeys(s["other"])))
        segs.setdefault(s["seg"], []).append(s)
    return [segs[k] for k in sorted(segs)], comps


def analyse(segs, comps, actual):
    res_v, res_s, rows = [], [], []
    for sg in segs:
        old = 0
        for k, s in enumerate(sg):
            s["old"] = old
            if k + 1 < len(sg):
                g = sg[k + 1]["ctx"] - s["ctx"]
                res_v.append(g - (s["R"] + s["C"] + s["T"]))
                res_s.append(g - (s["R"] - (sg[k - 1]["R"] if k else 0) + s["C"] + s["T"]))
            if k: old += sg[k - 1]["R"]
            rows.append(s)
    sign = -1 if actual == "v22.5" else 1
    ctx = [s["ctx"] for s in rows]; cf = [s["ctx"] + sign * s["old"] for s in rows]
    pre = [s["ctx"] - s["cached"] for s in rows]
    grow = lambda vals: sum(max(0, sg[-1] - sg[0]) for sg in vals)
    split = lambda key: [[key(s) for s in sg] for sg in segs if sg]
    post = [c.get("postTokens") for c in comps if c.get("postTokens")]; trig = [c.get("preTokens") for c in comps if c.get("preTokens")]
    budget = (st.mean(trig) - st.mean(post)) if post and trig else None
    g_act = grow(split(lambda s: s["ctx"])); g_cf = grow(split(lambda s: s["ctx"] + sign * s["old"]))
    other = "sly2" if actual == "v22.5" else "v22.5"
    return {
        "requests": len(rows), "compactions": len(comps), "compaction_pre_post_tokens": [(c.get("preTokens"), c.get("postTokens")) for c in comps],
        "residual_median_abs_if_v22.5": int(st.median(abs(x) for x in res_v)) if res_v else None,
        "residual_median_abs_if_sly2": int(st.median(abs(x) for x in res_s)) if res_s else None,
        "output_tokens": sum(s["out"] for s in rows), "thinking_tokens": sum(s["R"] for s in rows),
        "prompt_tokens_total": sum(ctx), f"prompt_tokens_total_if_{other}": sum(cf),
        "old_reasoning_tokens_total": sum(s["old"] for s in rows),
        "context_median": int(st.median(ctx)), f"context_median_if_{other}": int(st.median(cf)),
        "context_max": max(ctx), f"context_max_if_{other}": max(cf),
        "prefilled_tokens_total": sum(pre), "prefilled_median_per_request": int(st.median(pre)),
        "cached_share_pct": round(100 * sum(s["cached"] for s in rows) / max(1, sum(ctx)), 1),
        "old_reasoning_at_each_compaction": [sum(s["R"] for s in sg[:-1]) for sg in segs[:len(comps)] if sg],
        "context_growth_total": g_act, f"context_growth_total_if_{other}": g_cf,
        "compaction_budget_tokens": int(budget) if budget else None,
        "compactions_est_from_growth": round(g_act / budget, 1) if budget else None,
        f"compactions_est_if_{other}": round(g_cf / budget, 1) if budget else None,
    }


out = {}
for name, r in RUNS.items():
    segs, comps = load(r)
    if segs: out[name] = {"transcripts": r["trans"], **analyse(segs, comps, "sly2" if name.endswith("sly2") else "v22.5")}
print(json.dumps(out, indent=1))
