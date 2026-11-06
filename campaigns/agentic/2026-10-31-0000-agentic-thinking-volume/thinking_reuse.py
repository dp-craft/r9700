#!/usr/bin/env python3
"""How much of what a later step uses was ONLY in earlier thinking? A lexical proxy for "how many turns of reasoning to replay".

For each assistant turn j (output = its thinking + text + tool_use inputs), every unit it emits is classed by what the model
could see before j:
  visible  - in the user prompt, a tool result, or any earlier text / tool input (this survives any replay rule)
  age a    - not visible, but in the thinking of turn j-a (the most recent such turn). age 1 is kept by keep-newest (k=1);
             age > k is gone under keep-last-k.
  novel    - nowhere before j.
Units: identifiers (paths, names with . / _ : # @ -, digits or camelCase; >= 3 chars) and word 5-grams ("phrases").
A compaction (compact_boundary) resets both histories; the compact summary counts as visible.
"Conclusion" = the last 20 % of a thinking block (>= 400 chars): is an age >= 2 unit inside an older block's conclusion?
Window = session start .. the blind boundary (first READ of the Opus reference review), as in thinking_digest.py.
Caveat: lexical reuse != dependency (the model may re-derive), and a semantic carry-over with no shared token is missed.
Usage: thinking_reuse.py NAME=RUN_ARM_DIR ... [--samples OUT.jsonl]  -> one JSON line per arm (stdout).
Data source for docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md (replay section)."""
import glob, json, random, re, sys

BOUND = re.compile(r"\b(cat|sed|head|tail|less|awk|grep)\b[^|;&]*27b-fix/opus/W2-08")
READ = re.compile(r"27b-fix/opus/W2-08")
UNIT = re.compile(r"[#@\w][\w./#:@-]*\w")
WORD = re.compile(r"[a-z][a-z'-]*")
AGES = [1, 2, 3, 5]


def idents(text):
    out = set()
    for t in UNIT.findall(text):
        if len(t) >= 3 and re.search(r"[./_#:@-]|\d|[a-z][A-Z]", t) and not re.fullmatch(r"\d{1,2}", t):
            out.add(t)
    return out


def phrases(text):
    w = WORD.findall(text.lower())
    return {" ".join(w[i:i + 5]) for i in range(len(w) - 4)}


def tail(text):
    return text[-max(400, len(text) // 5):]


def result_text(c):
    x = c.get("content")
    if isinstance(x, list):
        return "\n".join(i.get("text", "") for i in x if isinstance(i, dict))
    return x if isinstance(x, str) else ""


def events(arm):
    """Ordered events: ('vis', text) | ('turn', think, vis_out) | ('compact',). Stops at the blind boundary."""
    ev, turns = [], {}
    for line in open(glob.glob(arm + "/claude-project/*.jsonl")[0]):
        r = json.loads(line)
        if r.get("type") == "system" and r.get("subtype") == "compact_boundary":
            ev.append(("compact",))
            continue
        m = r.get("message") or {}
        c = m.get("content")
        if r.get("type") == "user":
            if isinstance(c, str):
                ev.append(("vis", c))
            elif isinstance(c, list):
                ev += [("vis", result_text(b) if b.get("type") == "tool_result" else b.get("text", "")) for b in c]
            continue
        if r.get("type") != "assistant" or not isinstance(c, list):
            continue
        mid = m.get("id")
        if mid not in turns:
            turns[mid] = ["turn", "", ""]
            ev.append(turns[mid])
        for b in c:
            if b.get("type") == "thinking":
                turns[mid][1] += b.get("thinking", "")
            elif b.get("type") == "text":
                turns[mid][2] += "\n" + b.get("text", "")
            elif b.get("type") == "tool_use":
                i = b.get("input") or {}
                if (b["name"] == "Read" and READ.search(i.get("file_path", ""))) or \
                   (b["name"] == "Bash" and BOUND.search(i.get("command", ""))):
                    return ev
                turns[mid][2] += "\n" + raw(i)
    return ev


def raw(x):
    """Tool input as plain text (json.dumps would glue escaped newlines onto identifiers: '\\nfoo' -> 'nfoo')."""
    if isinstance(x, dict):
        return "\n".join(raw(v) for v in x.values())
    if isinstance(x, list):
        return "\n".join(raw(v) for v in x)
    return str(x)


def analyse(name, arm, samples):
    stats = {k: {"out": 0, "visible": 0, "novel": 0, "age": {}, "old_in_visible_out": 0, "old_in_concl": 0}
             for k in ("idents", "phrases")}
    restate = {"units": 0, "already_visible": 0}
    V = {"idents": set(), "phrases": set()}
    hist, j = [], 0                       # hist: (turn, {kind: units}, {kind: tail units}, think)
    for e in events(arm):
        if e[0] == "compact":
            V, hist = {"idents": set(), "phrases": set()}, []
            continue
        if e[0] == "vis":
            V["idents"] |= idents(e[1]); V["phrases"] |= phrases(e[1])
            continue
        _, think, vis_out = e
        j += 1
        cur = {"idents": (idents(think), idents(vis_out)), "phrases": (phrases(think), phrases(vis_out))}
        restate["units"] += len(cur["idents"][0])
        restate["already_visible"] += len(cur["idents"][0] & V["idents"])
        for k, (u_think, u_vis) in cur.items():
            s = stats[k]
            for u in u_think | u_vis:
                s["out"] += 1
                if u in V[k]:
                    s["visible"] += 1
                    continue
                src = next((h for h in reversed(hist) if u in h[1][k]), None)
                if src is None:
                    s["novel"] += 1
                    continue
                age = j - src[0]
                s["age"][age] = s["age"].get(age, 0) + 1
                if age >= 2:
                    s["old_in_visible_out"] += u in u_vis
                    s["old_in_concl"] += any(u in h[2][k] for h in hist if h[0] <= j - 2)
                    if k == "idents" and u in u_vis and samples is not None:
                        p = src[3].find(u)
                        q = vis_out.find(u)
                        samples.append({"arm": name, "unit": u, "age": age, "origin_turn": src[0], "use_turn": j,
                                        "origin_excerpt": src[3][max(0, p - 300):p + 300],
                                        "origin_pos_frac": round(p / max(len(src[3]), 1), 2),
                                        "use_excerpt": vis_out[max(0, q - 200):q + 200]})
        hist.append((j, {"idents": cur["idents"][0], "phrases": cur["phrases"][0]},
                     {"idents": idents(tail(think)), "phrases": phrases(tail(think))}, think))
        V["idents"] |= cur["idents"][1]; V["phrases"] |= cur["phrases"][1]
    out = {"arm": name, "turns": j,
           "thinking_idents_already_visible_pct": round(100 * restate["already_visible"] / max(restate["units"], 1), 1)}
    for k, s in stats.items():
        old = {a: sum(v for g, v in s["age"].items() if g > a) for a in AGES}
        tot = s["out"]
        out[k] = {"units_out": tot, "visible_pct": round(100 * s["visible"] / max(tot, 1), 1),
                  "novel_pct": round(100 * s["novel"] / max(tot, 1), 1),
                  "from_newest_thinking_pct": round(100 * s["age"].get(1, 0) / max(tot, 1), 2),
                  **{f"only_older_than_k{a}_pct": round(100 * old[a] / max(tot, 1), 2) for a in AGES},
                  "older_than_k1_n": old[1],
                  "older_than_k1_used_in_tool_input_or_text_pct": round(100 * s["old_in_visible_out"] / max(old[1], 1), 1),
                  "older_than_k1_in_an_older_conclusion_pct": round(100 * s["old_in_concl"] / max(old[1], 1), 1)}
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sp = sys.argv[sys.argv.index("--samples") + 1] if "--samples" in sys.argv else None
    allsamples = [] if sp else None
    for a in args:
        if sp and a == sp:
            continue
        n, d = a.split("=", 1)
        print(json.dumps(analyse(n, d, allsamples)))
    if sp:
        random.Random(7).shuffle(allsamples)
        with open(sp, "w") as f:
            for s in allsamples:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
