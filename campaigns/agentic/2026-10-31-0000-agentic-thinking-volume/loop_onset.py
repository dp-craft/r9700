#!/usr/bin/env python3
"""Where inside one response does a thinking loop start? (for the Cactus fade question: δ is full below 4,096 output tokens
and reaches 0 at 16,384 on Sly 1.9.x defaults).

For the N most repetitive thinking blocks of an arm: chars, the message's output_tokens (server usage) -> chars/token,
repeated-line share (lines >= 20 chars seen earlier in the same block), loop onset = first 40-line window whose repeated
share is >= 80 %, as a char offset and as an estimated output-token offset (offset x tokens/char of that message; the
thinking block is assumed to dominate the message's output), the most repeated line and its count, and stop_reason.
Usage: loop_onset.py NAME=RUN_ARM_DIR ... [--top N]  -> one JSON line per block (stdout)."""
import glob, json, sys
from collections import Counter

WIN, SHARE = 40, 0.8


def blocks(arm):
    msgs = {}
    for line in open(glob.glob(arm + "/claude-project/*.jsonl")[0]):
        r = json.loads(line)
        m = r.get("message") or {}
        if r.get("type") != "assistant" or not isinstance(m.get("content"), list):
            continue
        d = msgs.setdefault(m.get("id"), {"think": "", "out": 0, "stop": None, "ts": r.get("timestamp")})
        d["out"] = max(d["out"], (m.get("usage") or {}).get("output_tokens", 0))
        d["stop"] = m.get("stop_reason") or d["stop"]
        for c in m["content"]:
            if c.get("type") == "thinking":
                d["think"] += c.get("thinking", "")
    return msgs


def onset(text):
    # windows count only lines >= 20 chars (blank separator lines would cap a window's repeated share at ~50 %)
    lines, seen, rep, offs, pos = text.split("\n"), set(), [], [], 0
    for ln in lines:
        s = ln.strip()
        if len(s) >= 20:
            rep.append(s in seen)
            offs.append(pos)
            seen.add(s)
        pos += len(ln) + 1
    pct = round(100 * sum(rep) / max(len(rep), 1), 1)
    for i in range(0, max(len(rep) - WIN, 0) + 1):
        if len(rep) >= WIN and sum(rep[i:i + WIN]) >= SHARE * WIN:
            return offs[i], pct, lines
    return None, pct, lines


if __name__ == "__main__":
    top = int(sys.argv[sys.argv.index("--top") + 1]) if "--top" in sys.argv else 3
    for a in sys.argv[1:]:
        if "=" not in a:
            continue
        name, arm = a.split("=", 1)
        rows = []
        for mid, d in blocks(arm).items():
            if len(d["think"]) < 2000:
                continue
            off, rep_pct, lines = onset(d["think"])
            mc = Counter(l.strip() for l in lines if len(l.strip()) >= 20).most_common(1)
            tpc = d["out"] / max(len(d["think"]), 1)
            rows.append({"arm": name, "ts": d["ts"], "think_chars": len(d["think"]), "output_tokens": d["out"],
                         "chars_per_token": round(1 / tpc, 2) if tpc else None, "stop_reason": d["stop"],
                         "repeated_line_pct": rep_pct, "onset_char": off,
                         "onset_tokens_est": round(off * tpc) if off is not None and tpc else None,
                         "top_line": mc[0][0][:120] if mc else "", "top_line_count": mc[0][1] if mc else 0})
        for r in sorted(rows, key=lambda r: -r["repeated_line_pct"] * r["think_chars"])[:top]:
            print(json.dumps(r, ensure_ascii=False))
