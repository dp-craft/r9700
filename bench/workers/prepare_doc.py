#!/usr/bin/env python3
"""prepare_doc.py UC_ROOT: document-refactoring fixtures from real repo reports. docsplit-{P,S,M,L}, docreorg-{S,M,L}.
docsplit: one report, split per top-level section. docreorg: H2 sections of 3 reports, shuffled with a fixed seed into one file.
key.json holds the oracle. Set TOKENIZE=1 to count source tokens through the running server."""
import json, os, random, re, sys, urllib.request
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UC = sys.argv[1]
SPLIT = {
    "P": "CLAUDE.md",
    "S": "docs/findings/llamacpp/2026-07-11-2200-deep-context-35b.md",
    "M": "docs/findings/quality/2026-07-27-0000-runner-benchmark-unified.md",
    "L": "docs/findings/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b.md",
}
REORG = {
    "S": ["docs/research/models-sampling/2026-07-12-2310-qwen36-sampling-llamacpp-serving-knobs.md", "docs/research/rocm-driver/2026-10-08-0930-rocmtos-cachyos-ubuntu2604-rdna4.md", "docs/research/models-sampling/2026-07-14-1550-gfx1201-llm-training-feasibility.md"],
    "M": ["docs/findings/llamacpp/2026-07-13-0733-27b-serving-substrate.md", "docs/research/llamacpp/2026-07-16-1016-spec-draft-p-min-mtp.md", "docs/research/methodology/2026-07-13-1712-hard-ts-quality-benchmark-design.md"],
    "L": ["docs/findings/llamacpp/2026-07-10-1810-rdna4-r9700-tuning-optimum.md", "docs/findings/agentic/2026-10-31-0000-q4kxl-sharp-w208-blind.md", "docs/findings/agentic/2026-10-31-1640-agentic-thinking-volume-and-levers.md"],
}


def tokens(text):
    if os.environ.get("TOKENIZE") != "1":
        return None
    req = urllib.request.Request("http://127.0.0.1:8000/tokenize", json.dumps({"prompt": text}).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))["count"]


def sections(text):
    """(heading, body lines) per H2, ignoring ## inside code fences. The first item is the preamble, with heading None."""
    out, cur, fence = [], [None, []], False
    for line in text.split("\n"):
        if line.startswith("```"):
            fence = not fence
        if not fence and line.startswith("## "):
            out.append(cur)
            cur = [line, [line]]
        else:
            cur[1].append(line)
    out.append(cur)
    return out


def title(text, path):
    for line in text.split("\n"):
        if line.startswith("# "):
            return line[2:].strip()
    return os.path.basename(path)


def put(name, files, key):
    d = f"{UC}/{name}"
    os.makedirs(d, exist_ok=True)
    for k, v in files.items():
        open(f"{d}/{k}", "w", encoding="utf8").write(v)
    key["tokens"] = tokens(files["doc.md"])
    json.dump(key, open(f"{d}/key.json", "w"), indent=1)
    print(name, "lines", files["doc.md"].count("\n") + 1, "sections", len(key["sections"]), "tokens", key["tokens"])


for size, path in SPLIT.items():
    text = open(f"{REPO}/{path}", encoding="utf8").read()
    secs = sections(text)
    key = dict(task="docsplit", source=path, sections=[dict(heading=h, order=i, lines=[l for l in b if l.strip()]) for i, (h, b) in enumerate(secs) if any(l.strip() for l in b)])
    put(f"docsplit-{size}", {"doc.md": text}, key)

for size, paths in REORG.items():
    pool, topics = [], []
    for i, path in enumerate(paths):
        text = open(f"{REPO}/{path}", encoding="utf8").read()
        fn = f"topic-{'abc'[i]}.md"
        topics.append(f"{fn}: {title(text, path)}")
        for j, (h, b) in enumerate(sections(text)):
            if h is None:
                continue
            while b and not b[-1].strip():
                b = b[:-1]
            pool.append(dict(heading=h, origin=fn, order=j, lines=b))
    random.Random(20261105).shuffle(pool)
    doc = "\n\n".join("\n".join(s["lines"]) for s in pool) + "\n"
    key = dict(task="docreorg", sources=paths, topics=topics, sections=[dict(s, lines=[l for l in s["lines"] if l.strip()]) for s in pool])
    put(f"docreorg-{size}", {"doc.md": doc, "TOPICS.txt": "\n".join(topics) + "\n"}, key)
