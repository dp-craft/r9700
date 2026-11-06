#!/usr/bin/env python3
"""score_doc.py WORKDIR KEYDIR: did a document refactor keep the content? Prints JSON.
Lines compare as multisets, ignoring spacing and table padding. A missing and an extra line that are similar count as altered, otherwise lost and added.
zero_loss needs no lost or altered line and no missing or invented number. clean adds: no extra lines, every section whole and in order. score = exact recall x placement x precision."""
import collections, difflib, glob, json, os, re, sys
W, K = sys.argv[1:3]
key = json.load(open(f"{K}/key.json"))
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
SEP = re.compile(r"^\|[-:| ]+\|?$")


def norm(s):
    s = re.sub(r"\s+", " ", s.strip())
    return re.sub(r" ?\| ?", "|", s) if s.startswith("|") else s


def nums(lines):
    c = collections.Counter()
    for l in lines:
        c.update(x.replace(",", "") for x in NUM.findall(l))
    return c


src_raw = [l for l in open(f"{W}/doc.md", encoding="utf8").read().split("\n") if l.strip()]
src = [norm(l) for l in src_raw]
files = {os.path.basename(p): [l for l in open(p, encoding="utf8").read().split("\n") if l.strip()] for p in glob.glob(f"{W}/out/*.md") if os.path.basename(p) != "README.md"}
out = [norm(l) for ls in files.values() for l in ls]
sc, oc = collections.Counter(src), collections.Counter(out)
missing, extra = list((sc - oc).elements()), list((oc - sc).elements())
exact = sum((sc & oc).values())
dup = sum(v - sc[k] for k, v in oc.items() if k in sc and v > sc[k])
extra_new = [l for l in extra if l not in sc]
missing_rest = list(missing)
altered, num_changed = [], []
for e in extra_new:
    best, score = None, 0.0
    m = difflib.SequenceMatcher(None, autojunk=False)
    m.set_seq2(e)
    for c in missing_rest:
        m.set_seq1(c)
        if m.real_quick_ratio() < 0.6 or m.quick_ratio() < 0.6:
            continue
        r = m.ratio()
        if r > score:
            best, score = c, r
    if best is not None and score >= 0.6:
        missing_rest.remove(best)
        altered.append(dict(src=best[:200], out=e[:200], ratio=round(score, 3)))
        if nums([best]) != nums([e]):
            num_changed.append(altered[-1])
paired = {a["out"] for a in altered}
added = [l for l in extra_new if l[:200] not in paired]
lost = missing_rest
sn, on = nums(src), nums(out)
lost_rows = sum(1 for l in lost if l.startswith("|") and not SEP.match(l))
fences = {k: sum(1 for l in v if l.startswith("```")) for k, v in files.items()}
# Placement. Lines that occur once in the source show where a section went.
uniq = {k for k, v in sc.items() if v == 1}
where = {}
for name, ls in files.items():
    for l in ls:
        where.setdefault(norm(l), name)
secs, whole, ok, order_ok, order_n = [], 0, 0, 0, 0
for s in key["sections"]:
    u = [norm(l) for l in s["lines"] if norm(l) in uniq]
    got = collections.Counter(where[l] for l in u if l in where)
    top = got.most_common(1)[0][0] if got else None
    intact = bool(u) and got.get(top, 0) == len(u)
    if intact:
        fl = [norm(l) for l in files[top]]
        at = {l: i for i, l in enumerate(fl) if l in uniq}
        pos = [at[l] for l in u]
        intact = pos == sorted(pos)
    whole += intact
    want = s.get("origin")
    right = top == want if want else top is not None
    ok += right
    secs.append(dict(heading=(s["heading"] or "(preamble)")[:60], file=top, right=right, intact=intact))
n = len(key["sections"]) or 1
tp = {}
if key["task"] == "docsplit":
    named = [s["file"] for s in secs if s["file"]]
    tp["one_file_per_section"] = len(set(named)) == len(named) == n
    tp["files_in_doc_order"] = named == sorted(named)
    rd = f"{W}/out/README.md"
    links = re.findall(r"\]\(([^)\s]+)\)", open(rd, encoding="utf8").read()) if os.path.exists(rd) else []
    tp["readme_links"] = len(links)
    tp["readme_links_bad"] = sum(1 for x in links if x not in files)
    tp["readme_missing"] = sum(1 for x in files if x not in links)
else:
    tp["unknown_files"] = sorted(set(files) - {t.split(":")[0] for t in key["topics"]})
    pairs = collections.defaultdict(list)
    for s, r in zip(key["sections"], secs):
        if r["file"]:
            first = next((norm(l) for l in s["lines"] if norm(l) in uniq), None)
            pos = next((i for i, l in enumerate(files[r["file"]]) if norm(l) == first), None)
            if pos is not None:
                pairs[r["file"]].append((pos, s["order"]))
    for ps in pairs.values():
        ps.sort()
        for a in range(len(ps)):
            for b in range(a + 1, len(ps)):
                order_n += 1
                order_ok += ps[a][1] < ps[b][1]
    tp["original_order_agreement"] = round(order_ok / order_n, 3) if order_n else None
recall = exact / max(len(src), 1)
precision = exact / max(len(out), 1)
placement = ok / n
zero_loss = not lost and not altered and not (sn - on) and not (on - sn)
res = dict(
    score=round(recall * placement * precision, 4),
    zero_loss=zero_loss,
    clean=zero_loss and not added and not dup and whole == n and not any(v % 2 for v in fences.values()),
    src_lines=len(src), out_lines=len(out), out_files=len(files), exact_lines=exact,
    recall=round(recall, 4), precision=round(precision, 4),
    lost_lines=len(lost), lost_table_rows=lost_rows, altered_lines=len(altered), altered_with_number_change=len(num_changed),
    added_lines=len(added), duplicated_lines=dup,
    numbers_missing=sum((sn - on).values()), numbers_invented=sum((on - sn).values()),
    fences_odd=[k for k, v in fences.items() if v % 2],
    placement=round(placement, 4), sections=n, sections_right=ok, sections_intact=whole,
    source_tokens=key.get("tokens"),
    examples=dict(lost=[l[:160] for l in lost[:8]], altered=altered[:8], added=[l[:160] for l in added[:8]]),
    section_detail=secs, **tp,
)
print(json.dumps(res, indent=1, ensure_ascii=False))
