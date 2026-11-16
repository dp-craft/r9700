#!/usr/bin/env python3
"""catalog.py — faceted catalog of the final docs (docs/{findings,research,articles,guides}).

reindex.py registers each report in one line (from its meta block). This keeps the deeper index the register
does not: per doc, the domains / models / engines it covers *with the section that covers each*, key results with
provenance, problems + fixes, caveats and article potential — so an article can be planned from the catalog
instead of re-reading the docs.

Data: docs/catalog.jsonl, one record per doc = deterministic fields (this script: path, title, meta, sha,
headings with line numbers, cross-refs) + semantic notes (an LLM worker's, merged in). View: docs/CATALOG.md.
Incremental: `stale` lists docs that are new or changed since they were noted, so only those get re-noted.

  catalog.py manifest [--out F]          deterministic fields of every doc (JSONL)
  catalog.py stale                       docs needing (new) notes, one path per line
  catalog.py merge NOTES...              fresh manifest + notes (+ still-valid old notes) -> docs/catalog.jsonl
  catalog.py render                      docs/catalog.jsonl -> docs/CATALOG.md
  catalog.py show [filters] [PATH...]    print cards (--brief: compact; --outline: + headings with line numbers)

Notes format (one JSON object per line; lines not starting with '{' are ignored, so worker result files with a
STATUS/SUMMARY header merge as-is) — the vocabularies below are the single source for workers' briefs:
  {"path", "summary", "kind", "status", "status_note", "models", "engines",
   "domains": [{"tag", "where", "note"}], "key_results": [{"claim", "value", "prov", "where"}],
   "problems": [{"problem", "cause", "fix", "where"}], "versions", "caveats", "tags",
   "article": {"potential", "angle", "hook", "audience"}}
  `where` = a heading of that doc, copied verbatim without the leading #s (render maps it to a line number).
"""
import argparse, glob, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
SECTIONS = ("findings", "research", "articles", "guides")
CATALOG = os.path.join(DOCS, "catalog.jsonl")
VIEW = os.path.join(DOCS, "CATALOG.md")
VIEW_PROBLEMS = os.path.join(DOCS, "CATALOG-problems.md")
SKIP = {"docs/articles/CANDIDATES.md"}

DOMAINS = {
    "prefill": "prompt-processing throughput (pp tok/s, TTFT)",
    "decode": "generation throughput (tg t/s)",
    "depth-scaling": "how performance changes with context/conversation depth; power-law fits",
    "concurrency": "parallel requests, slots, batching throughput",
    "long-context": "window capacity, 100k+ contexts, max-ctx fit, prefix caching/reuse",
    "kv-cache": "KV cache type (f16/q8_0/fp8), KiB per token, KV quant effects",
    "quantization": "weight quant formats (Q4_K_M, Q5, IQ*, AWQ, MXFP4, FP8) and their trade-offs",
    "kld-fidelity": "KLD / PPL / token agreement vs a reference: quant fidelity measurement",
    "speculative": "MTP, draft models, DFlash, speculative-decoding acceptance",
    "vram-memory": "VRAM/GTT usage, fit, spill, OOM, memory planning",
    "coding-quality": "code-task output quality (TS tsc/eslint/vitest harness, pass rates, judge scores)",
    "agentic": "multi-turn agent sessions (claude -p, tool use, agent workflows, briefs)",
    "subagent-workers": "local models used as subagents/workers for Claude",
    "sampling": "sampler params, thinking budget/length, chat templates, reasoning parsing",
    "tuning-flags": "engine flag tuning (-ub/-b/-fa/ctx/threads, vLLM knobs) and optimum search",
    "build-regression": "llama.cpp / engine build-vs-build comparisons and regressions",
    "driver-stack": "ROCm / Mesa-RADV / kernel / firmware versions, upgrades, overrides",
    "stability": "crashes, device-lost, memory faults, hangs, invalid output, flaky runs",
    "power-thermal": "power draw, clocks, thermals, perf per watt",
    "engine-comparison": "head-to-head engines/backends on the same model",
    "model-comparison": "head-to-head models / fine-tunes on the same task",
    "methodology": "benchmark design, statistics, provenance, harness pitfalls, measurement errors",
    "ops-tooling": "serving setup, llama-swap, launch scripts, images, install, runbooks",
    "economics": "token economy, time-to-answer, cost vs cloud, efficiency trade-offs",
}
KINDS = ("benchmark", "investigation", "build-check", "research", "guide", "article", "decision-record")
STATUSES = ("current", "superseded", "partial", "negative", "retracted")
ENGINES = ("llama.cpp-vulkan", "llama.cpp-rocm", "vllm", "radiance", "hipfire", "ollama", "transformers", "claude")
POTENTIALS = ("high", "medium", "low")
PROVS = ("MEASURED", "CLAIMED", "INFERRED")
MODEL_BASES = ("qwen3.6-27b", "qwen3.6-35b-a3b", "qwen3.8-27b", "qwen3.5-35b-a3b", "ornith-1.0-35b",
               "ornith-1.5-35b-a3b", "gemma-4-31b")  # `base-variant` -> `base:variant`; render groups by base
MODEL_ALIASES = {"gemma4-31b": "gemma-4-31b", "ornith-1.5-35b": "ornith-1.5-35b-a3b",
                 "thinkingcap-qwen3.6-27b": "qwen3.6-27b:thinkingcap"}
SEMANTIC = ("summary", "kind", "status", "status_note", "models", "engines", "domains", "key_results",
            "problems", "versions", "caveats", "tags", "article")

META_RE = re.compile(r"<!--\s*meta\s*\n(.*?)-->", re.S)
KV_RE = re.compile(r"^([A-Za-z][\w-]*):\s*(.*)$")
LINK_RE = re.compile(r"\]\(([^)\s#]+\.md)")
PATH_RE = re.compile(r"(?<![\w./-])((?:docs|campaigns)/[\w.\-/]+)")


def doc_paths():
    out = []
    for s in SECTIONS:
        for p in glob.glob(os.path.join(DOCS, s, "**", "*.md"), recursive=True):
            rel = os.path.relpath(p, ROOT)
            if rel not in SKIP and "/tmp/" not in rel:
                out.append(rel)
    return sorted(out)


def manifest_record(rel):
    path = os.path.join(ROOT, rel)
    raw = open(path, "rb").read()
    text = raw.decode("utf-8", "replace")
    meta = {}
    m = META_RE.search(text)
    if m:
        for line in m.group(1).splitlines():
            kv = KV_RE.match(line.strip())
            if kv:
                meta[kv.group(1)] = kv.group(2).strip()
    headings, fence, title = [], False, None
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith(("```", "~~~")):
            fence = not fence
            continue
        if fence:
            continue
        if title is None and line.startswith("# "):
            title = line[2:].strip()
        hm = re.match(r"^(#{2,3})\s+(.*\S)", line)
        if hm:
            headings.append([n, len(hm.group(1)), hm.group(2)])
    refs = set()
    for link in LINK_RE.findall(text):
        if link.startswith(("http:", "https:")):
            continue
        t = os.path.normpath(os.path.join(os.path.dirname(path), link))
        if t.startswith(ROOT + os.sep) and os.path.exists(t):
            refs.add(os.path.relpath(t, ROOT))
    for p in PATH_RE.findall(text):
        p = p.rstrip(".,;:)/")
        if p.startswith("campaigns/"):
            p = "/".join(p.split("/")[:3])
        if os.path.exists(os.path.join(ROOT, p)):
            refs.add(p)
    refs.discard(rel)
    parts = rel.split("/")
    stamp = re.match(r"(\d{4}-\d{2}-\d{2})", parts[-1])
    return {"path": rel, "section": parts[1], "topic": "/".join(parts[2:-1]),
            "date": meta.get("date") or (stamp.group(1) if stamp else ""),
            "title": meta.get("title") or title or parts[-1],
            "takeaway": meta.get("takeaway", ""), "campaign": meta.get("campaign", ""),
            "bytes": len(raw), "sha": hashlib.sha256(raw).hexdigest()[:16],
            "headings": headings, "refs": sorted(refs)}


def norm_model(m):
    m = MODEL_ALIASES.get(m.strip().lower(), m.strip().lower())
    for b in sorted(MODEL_BASES, key=len, reverse=True):
        if m == b or (m.startswith(b) and m[len(b)] in ":-"):
            return b + (":" + m[len(b) + 1:] if m != b else "")
    return m


def load(path):
    if not os.path.exists(path):
        return {}
    return {r["path"]: r for r in (json.loads(l) for l in open(path) if l.strip())}


def where_line(rec, where):
    w = re.sub(r"^#+\s*", "", where or "").strip().lower()
    if not w:
        return None
    for n, _, h in rec["headings"]:
        hl = h.lower()
        if hl == w or hl.startswith(w) or w.startswith(hl) or w in hl:
            return n
    return None


def check(rec):
    """Vocabulary + where-resolution warnings for one merged record."""
    if "summary" not in rec:
        return []
    bad, p = [], rec["path"]
    if rec.get("kind") not in KINDS:
        bad.append(f"{p}: kind {rec.get('kind')!r}")
    if rec.get("status") not in STATUSES:
        bad.append(f"{p}: status {rec.get('status')!r}")
    for e in rec.get("engines", []):
        if e not in ENGINES and not e.startswith("other:"):
            bad.append(f"{p}: engine {e!r}")
    for d in rec.get("domains", []):
        if d.get("tag") not in DOMAINS:
            bad.append(f"{p}: domain {d.get('tag')!r}")
    for k in rec.get("key_results", []):
        if k.get("prov") not in PROVS:
            bad.append(f"{p}: prov {k.get('prov')!r}")
    if (rec.get("article") or {}).get("potential") not in POTENTIALS:
        bad.append(f"{p}: article.potential {(rec.get('article') or {}).get('potential')!r}")
    wheres = [x.get("where") for f in ("domains", "key_results", "problems") for x in rec.get(f, []) if x.get("where")]
    miss = sum(1 for w in wheres if where_line(rec, w) is None)
    if miss:
        bad.append(f"{p}: {miss}/{len(wheres)} `where` not matching a heading")
    return bad


def cmd_manifest(a):
    out = open(a.out, "w") if a.out else sys.stdout
    for rel in doc_paths():
        out.write(json.dumps(manifest_record(rel), ensure_ascii=False) + "\n")


def cmd_stale(a):
    cat, paths = load(CATALOG), doc_paths()
    for rel in paths:
        r = cat.get(rel)
        if not r or "summary" not in r or r.get("notes_stale") or r["sha"] != manifest_record(rel)["sha"]:
            print(rel)
    for rel in sorted(set(cat) - set(paths)):
        print(f"removed (drops on next merge): {rel}", file=sys.stderr)


def cmd_merge(a):
    old, notes = load(CATALOG), {}
    for f in a.notes:
        for i, line in enumerate(open(f), 1):
            if not line.lstrip().startswith("{"):
                continue
            try:
                r = json.loads(line)
            except ValueError as e:
                sys.exit(f"{f}:{i}: bad JSON: {e}")
            notes[r["path"]] = r
    paths, out, warn = doc_paths(), [], []
    for rel in paths:
        rec = manifest_record(rel)
        if rel in notes:
            rec.update({k: notes[rel][k] for k in SEMANTIC if k in notes[rel]})
        elif "summary" in old.get(rel, {}):
            rec.update({k: old[rel][k] for k in SEMANTIC if k in old[rel]})
            if old[rel]["sha"] != rec["sha"] or old[rel].get("notes_stale"):
                rec["notes_stale"] = True
        else:
            warn.append(f"{rel}: no notes")
        if rec.get("models"):
            rec["models"] = sorted({norm_model(m) for m in rec["models"]})
        warn += check(rec)
        out.append(rec)
    warn += [f"{p}: notes for a doc that does not exist" for p in sorted(set(notes) - set(paths))]
    with open(CATALOG, "w") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    for w in warn:
        print("WARN", w, file=sys.stderr)
    print(f"{len(out)} docs -> {os.path.relpath(CATALOG, ROOT)} ({len(notes)} new notes, {len(warn)} warnings)")


def short(s, n=72):
    s = (s or "").strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def first_sentence(s):
    m = re.match(r"(.+?[.!?])(\s|$)", (s or "").strip())
    return short(m.group(1) if m else s, 220)


def label(rec):
    """Compact doc label: `YYYY-MM-DD slug` from the file name (titles are listed once, under Documents)."""
    stem = os.path.basename(rec["path"])[:-3]
    m = re.match(r"(\d{4}-\d{2}-\d{2})(?:-\d{4})?-(.*)", stem)
    return f"{m.group(1)} {m.group(2)}" if m else stem


def ref(rec, where=None, title=False):
    link = f"[{short(rec['title'], 64) if title else label(rec)}]({rec['path'][len('docs/'):]})"
    if where:
        w = re.sub(r"^#+\s*", "", where).strip()
        n = where_line(rec, w)
        link += f" §{short(w, 40)}" + (f" L{n}" if n else "")
    return link


def cmd_render(a):
    recs = sorted(load(CATALOG).values(), key=lambda r: r["date"], reverse=True)
    noted = [r for r in recs if "summary" in r]
    groups = {}
    for r in recs:
        groups.setdefault(f"{r['section']}/{r['topic']}".rstrip("/"), []).append(r)
    L = ["# Docs catalog — where is what", "",
         "<!-- generated by docs/catalog.py render from docs/catalog.jsonl; do not edit by hand -->", "",
         "Faceted index of the final docs (findings, research, articles, guides). Every doc is listed under each",
         "domain, model and engine it touches, pointing at the section (and line) that covers it. Problems, incidents",
         "and fixes: [CATALOG-problems.md](CATALOG-problems.md). Article plans: [articles/CANDIDATES.md](articles/CANDIDATES.md).",
         "Full per-doc cards (summary, key results with provenance, caveats, outline):",
         "`python3 docs/catalog.py show --tag kv-cache` (or `--model`, `--engine`, `--potential`, `--grep`, a path).",
         "Update after new docs: `catalog.py stale` → notes for the listed docs only → `catalog.py merge <notes>` →",
         "`catalog.py render`.", "",
         f"{len(recs)} docs · {len(noted)} noted · {sum(1 for r in recs if r.get('notes_stale'))} with stale notes · "
         f"{sum(len(r.get('problems', [])) for r in noted)} problems", "",
         "**Contents:** [Documents](#documents) · [By domain](#by-domain) · [By model](#by-model) · "
         "[By engine](#by-engine) · [High article potential](#high-article-potential)", "", "## Documents", ""]
    for g in sorted(groups):
        L += [f"### {g} ({len(groups[g])})", ""]
        for r in groups[g]:
            art = (r.get("article") or {}).get("potential", "?")
            stale = " · ⚠ notes stale" if r.get("notes_stale") else ""
            L.append(f"- **{r['date'][:10]}** {ref(r, title=True)} — {r.get('kind', '?')} · {r.get('status', '?')} · "
                     f"article: {art}{stale}  ")
            L.append(f"  {first_sentence(r.get('summary') or r.get('takeaway'))}  ")
            tags = " ".join(f"`{d['tag']}`" for d in r.get("domains", []))
            if tags:
                L.append(f"  {tags}")
        L.append("")
    L += ["## By domain", ""]
    for tag, desc in DOMAINS.items():
        hits = [(r, d) for r in noted for d in r.get("domains", []) if d.get("tag") == tag]
        if hits:
            L += [f"### {tag} ({len(hits)})", "", f"_{desc}_", ""]
            L += [f"- {ref(r, d.get('where'))} — {short(d.get('note', ''), 120)}" for r, d in hits]
            L.append("")
    L += ["## By model", "", "_Grouped by base model; variants (fine-tune, quant) in parentheses._", ""]
    bases = {}
    for r in noted:
        for m in r.get("models", []):
            base, _, var = m.partition(":")
            bases.setdefault(base, {"docs": [], "vars": {}})
            if r not in bases[base]["docs"]:
                bases[base]["docs"].append(r)
            if var:
                bases[base]["vars"][var] = bases[base]["vars"].get(var, 0) + 1
    for base in sorted(bases, key=lambda k: (-len(bases[k]["docs"]), k)):
        v = bases[base]["vars"]
        vs = f" (variants: {', '.join(f'{k} {v[k]}' for k in sorted(v, key=lambda k: -v[k]))})" if v else ""
        L.append(f"- **{base}** — {len(bases[base]['docs'])} docs{vs}: " + " · ".join(ref(r) for r in bases[base]["docs"]))
    L += ["", "## By engine", ""]
    idx = {}
    for r in noted:
        for e in r.get("engines", []):
            idx.setdefault(e, []).append(r)
    for e in sorted(idx, key=lambda k: (-len(idx[k]), k)):
        L.append(f"- **{e}** — {len(idx[e])} docs: " + " · ".join(ref(r) for r in idx[e]))
    L += ["", "## High article potential", "",
          "_The note-taker's per-doc rating; the ranked, cross-doc plan is in articles/CANDIDATES.md._", ""]
    for r in noted:
        art = r.get("article") or {}
        if art.get("potential") == "high":
            L.append(f"- {ref(r)} — {art.get('angle', '')} **Hook:** {art.get('hook', '')}")
    open(VIEW, "w").write("\n".join(L) + "\n")
    P = ["# Docs catalog — problems, incidents and fixes", "",
         "<!-- generated by docs/catalog.py render from docs/catalog.jsonl; do not edit by hand -->", "",
         "Every concrete problem, bug, incident or pitfall the final docs report, grouped by topic, newest doc first.",
         "Format: **problem** → fix — doc §section Lline. Cause and full context: `python3 docs/catalog.py show <path>`.",
         "Index of the docs themselves: [CATALOG.md](CATALOG.md).", ""]
    for g in sorted(groups):
        rows = [(r, p) for r in groups[g] if "summary" in r for p in r.get("problems", [])]
        if rows:
            P += [f"## {g} ({len(rows)})", ""]
            P += [f"- **{short(p.get('problem', ''), 160)}**" + (f" → {short(p['fix'], 110)}" if p.get("fix") else "") +
                  f" — {ref(r, p.get('where'))}" for r, p in rows]
            P.append("")
    open(VIEW_PROBLEMS, "w").write("\n".join(P) + "\n")
    print(f"{len(recs)} docs -> {os.path.relpath(VIEW, ROOT)} + {os.path.relpath(VIEW_PROBLEMS, ROOT)}")


def card(r, outline, brief=False):
    note = f" ({r['status_note']})" if r.get("status_note") else ""
    L = [f"## {r['title']}", f"{r['path']} · {r['date']} · {r.get('kind', '?')} · {r.get('status', '?')}{note}"]
    if r.get("campaign"):
        L.append(f"campaign: {r['campaign']}")
    if r.get("notes_stale"):
        L.append("⚠ notes stale: the doc changed after it was noted")
    L.append(r.get("summary") or r.get("takeaway", ""))
    for label, f in (("models", "models"), ("engines", "engines"), ("versions", "versions"), ("tags", "tags")):
        if r.get(f):
            L.append(f"{label}: {', '.join(r[f])}")
    def at(where):
        n = where_line(r, where)
        return f" @ {where or ''}" + (f" (L{n})" if n else "")
    if brief:
        L.append("domains: " + ", ".join(d.get("tag", "?") for d in r.get("domains", [])))
    for d in [] if brief else r.get("domains", []):
        L.append(f"- [{d.get('tag')}] {d.get('note', '')}{at(d.get('where'))}")
    for k in r.get("key_results", []):
        L.append(f"- {k.get('prov', '?')}: {k.get('claim', '')} = {k.get('value', '')}{at(k.get('where'))}")
    if brief and r.get("problems"):
        L.append(f"problems: {len(r['problems'])} (show {r['path']})")
    for p in [] if brief else r.get("problems", []):
        L.append(f"- PROBLEM: {p.get('problem', '')} | cause: {p.get('cause', '')} | fix: {p.get('fix', '')}"
                 f"{at(p.get('where'))}")
    if r.get("caveats"):
        L.append("caveats: " + "; ".join(r["caveats"]))
    art = r.get("article") or {}
    if art:
        L.append(f"article: {art.get('potential', '?')} — {art.get('angle', '')} | hook: {art.get('hook', '')}"
                 f" | audience: {art.get('audience', '')}")
    if r.get("refs") and not brief:
        L.append("refs: " + ", ".join(r["refs"]))
    if outline:
        L += [f"  L{n} {'  ' * (lvl - 2)}{h}" for n, lvl, h in r["headings"]]
    return "\n".join(L)


def cmd_show(a):
    for r in sorted(load(CATALOG).values(), key=lambda r: r["date"], reverse=True):
        tags = {d.get("tag") for d in r.get("domains", [])} | set(r.get("tags", []))
        if a.paths and not any(p in r["path"] for p in a.paths):
            continue
        if a.tag and a.tag not in tags:
            continue
        if a.model and not any(a.model in m for m in r.get("models", [])):
            continue
        if a.engine and not any(a.engine in e for e in r.get("engines", [])):
            continue
        if a.potential and (r.get("article") or {}).get("potential") != a.potential:
            continue
        if a.grep and not re.search(a.grep, json.dumps(r, ensure_ascii=False), re.I):
            continue
        print(card(r, a.outline, a.brief), end="\n\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("manifest")
    p.add_argument("--out")
    sub.add_parser("stale")
    p = sub.add_parser("merge")
    p.add_argument("notes", nargs="+")
    sub.add_parser("render")
    p = sub.add_parser("show")
    p.add_argument("paths", nargs="*")
    for f in ("--tag", "--model", "--engine", "--potential", "--grep"):
        p.add_argument(f)
    p.add_argument("--outline", action="store_true")
    p.add_argument("--brief", action="store_true", help="no per-domain notes, problem list or refs")
    a = ap.parse_args()
    {"manifest": cmd_manifest, "stale": cmd_stale, "merge": cmd_merge, "render": cmd_render, "show": cmd_show}[a.cmd](a)


if __name__ == "__main__":
    main()
