#!/usr/bin/env python3
"""Regenerate the report lists in docs/INDEX.md from each report's own metadata.

Every report in docs/analysis/, docs/research/, and each co-located campaign analysis
(campaigns/<date>-<slug>/analysis.md, indexed under "analysis") must carry an HTML-comment
meta block at the top (invisible in rendered Markdown):

    <!-- meta
    date: 2026-07-11 18:44
    takeaway: One-line summary, **markdown allowed**, `code` fine.
    -->

`kind` is inferred from the directory (analysis/ or research/); the link text is the
filename with the leading date stripped. This script rewrites only the content between
the `<!-- reindex:analysis:start -->…:end -->` (and research) markers in INDEX.md, sorted
newest-first. It FAILS LOUDLY if a report has no meta block — that is the enforcement the
old hand-edited convention lacked.

Usage:  docs/reindex.py [--check]
  (no args) rewrite INDEX.md in place.
  --check  exit non-zero if INDEX.md is out of date (for CI / pre-commit), no write.
"""
import sys, os, re, glob

DOCS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(DOCS)
INDEX = os.path.join(DOCS, "INDEX.md")
META_RE = re.compile(r"<!--\s*meta\b(.*?)-->", re.DOTALL)


def parse_meta(path):
    with open(path, encoding="utf-8") as fh:
        head = fh.read(4000)
    m = META_RE.search(head)
    if not m:
        return None
    fields = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip()
    return fields


def sort_key(date_str):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?", date_str or "")
    if not m:
        return (0, 0, 0, 0, 0)
    y, mo, d, hh, mm = m.groups()
    return (int(y), int(mo), int(d), int(hh or 0), int(mm or 0))


def _slug(name):
    """Strip a leading YYYY-MM-DD(-HHMM) date so the link text is the slug. The HHMM part must be
    exactly 4 digits, so a slug that starts with digits (e.g. '27b-...') is NOT eaten."""
    return re.sub(r"^\d{4}-\d{2}-\d{2}(?:-\d{4})?-", "", name) or name


def build_section(kind):
    lines, errors = [], []
    # 1) standalone reports in docs/<kind>/*.md
    for path in glob.glob(os.path.join(DOCS, kind, "*.md")):
        meta = parse_meta(path)
        fname = os.path.basename(path)
        if not meta or "date" not in meta or "takeaway" not in meta:
            errors.append(f"  MISSING meta (date+takeaway) in {kind}/{fname}")
            continue
        link = _slug(fname[:-3])
        rel = f"{kind}/{fname}"
        lines.append((sort_key(meta["date"]),
                      f"- {meta['date']} · {kind} · [{link}]({rel}) — {meta['takeaway']}"))
    # 2) analyses co-located in campaigns/<date>-<slug>/analysis.md (project-root campaigns dir)
    if kind == "analysis":
        for path in sorted(glob.glob(os.path.join(REPO, "campaigns", "*", "analysis.md"))):
            meta = parse_meta(path)
            cdir = os.path.basename(os.path.dirname(path))
            if not meta or "date" not in meta or "takeaway" not in meta:
                errors.append(f"  MISSING meta (date+takeaway) in campaigns/{cdir}/analysis.md")
                continue
            rel = f"../campaigns/{cdir}/analysis.md"
            lines.append((sort_key(meta["date"]),
                          f"- {meta['date']} · {kind} · [{_slug(cdir)}]({rel}) — {meta['takeaway']}"))
    if errors:
        sys.exit("reindex: reports without a meta block:\n" + "\n".join(errors))
    lines.sort(key=lambda t: t[0], reverse=True)
    return "\n".join(l for _, l in lines)


def splice(text, kind, body):
    s, e = f"<!-- reindex:{kind}:start -->", f"<!-- reindex:{kind}:end -->"
    pat = re.compile(re.escape(s) + r".*?" + re.escape(e), re.DOTALL)
    if not pat.search(text):
        sys.exit(f"reindex: markers {s} / {e} not found in INDEX.md")
    return pat.sub(f"{s}\n{body}\n{e}", text)


def main():
    check = "--check" in sys.argv[1:]
    with open(INDEX, encoding="utf-8") as fh:
        original = fh.read()
    text = original
    for kind in ("analysis", "research"):
        text = splice(text, kind, build_section(kind))
    if check:
        if text != original:
            sys.exit("reindex: INDEX.md is out of date — run docs/reindex.py")
        print("reindex: INDEX.md up to date")
        return
    if text != original:
        with open(INDEX, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("reindex: INDEX.md rewritten")
    else:
        print("reindex: INDEX.md already current")


if __name__ == "__main__":
    main()
