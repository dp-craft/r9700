#!/usr/bin/env python3
"""Regenerate the report lists in docs/INDEX.md from each report's own metadata.

Every report under docs/findings/<topic>/ (our write-ups) and docs/research/<topic>/ (external synthesis) must carry
an HTML-comment meta block at the top (invisible in rendered Markdown):

    <!-- meta
    date: 2026-07-11 18:44
    takeaway: One-line summary, **markdown allowed**, `code` fine.
    campaign: campaigns/perf/2026-07-11-1833-starter-baseline      (findings only, when a campaign produced it;
                                                                    comma-separated when several did)
    -->

The section is the top dir (findings/ or research/); the topic is the path below it (`llamacpp`, `llamacpp/build-checks`);
the link text is the filename with the leading date stripped. Each `campaign:` entry must name an existing campaign dir
(repo-relative) holding the data behind the write-up. This script rewrites only the content between the
`<!-- reindex:findings:start -->…:end -->` (and research) markers in INDEX.md, sorted newest-first. It FAILS LOUDLY on a
report without a meta block or with a `campaign:` that does not resolve.

Usage:  docs/reindex.py [--check]
  (no args) rewrite INDEX.md in place.
  --check  exit non-zero if INDEX.md is out of date (for CI / pre-commit), no write.
"""
import sys, os, re, glob

DOCS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(DOCS)
INDEX = os.path.join(DOCS, "INDEX.md")
META_RE = re.compile(r"<!--\s*meta\b(.*?)-->", re.DOTALL)
SECTIONS = ("findings", "research")


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
    root = os.path.join(DOCS, kind)
    for path in glob.glob(os.path.join(root, "**", "*.md"), recursive=True):
        rel = os.path.relpath(path, DOCS)
        if os.path.basename(path) == "README.md":
            continue
        meta = parse_meta(path)
        if not meta or "date" not in meta or "takeaway" not in meta:
            errors.append(f"  MISSING meta (date+takeaway) in {rel}")
            continue
        for camp in filter(None, (c.strip() for c in meta.get("campaign", "").split(","))):
            if not os.path.isdir(os.path.join(REPO, camp)):
                errors.append(f"  campaign: {camp} does not exist ({rel})")
        topic = os.path.dirname(os.path.relpath(path, root)) or "-"
        lines.append((sort_key(meta["date"]),
                      f"- {meta['date']} · {topic} · [{_slug(os.path.basename(path)[:-3])}]({rel}) — {meta['takeaway']}"))
    if errors:
        sys.exit("reindex: bad reports:\n" + "\n".join(sorted(errors)))
    lines.sort(key=lambda t: t[0], reverse=True)
    return "\n".join(l for _, l in lines)


def splice(text, kind, body):
    s, e = f"<!-- reindex:{kind}:start -->", f"<!-- reindex:{kind}:end -->"
    pat = re.compile(re.escape(s) + r".*?" + re.escape(e), re.DOTALL)
    if not pat.search(text):
        sys.exit(f"reindex: markers {s} / {e} not found in INDEX.md")
    return pat.sub(lambda _: f"{s}\n{body}\n{e}", text)


def main():
    check = "--check" in sys.argv[1:]
    with open(INDEX, encoding="utf-8") as fh:
        original = fh.read()
    text = original
    for kind in SECTIONS:
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
