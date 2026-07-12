#!/usr/bin/env python3
"""apply_judge_scores.py — fold an in-session judge's blind scores back into per-config rows.

Reads judge_raw.json (the JSON array the judge produced, keyed by block id) and judge_map.json (the
id→config map from prepare_judge.py), and writes judge_scores.jsonl that report.py consumes. Clamps
each axis to integers 0–5 and reports coverage (missing / unknown / out-of-range) so a malformed
paste can't silently corrupt the analysis.

    python3 apply_judge_scores.py --raw out/judge_raw.json --out out/judge_scores.jsonl
        # --map defaults to judge_map.json next to --raw

Stdlib only.
"""
import argparse, json, os


def clamp05(x):
    try:
        return max(0, min(5, int(round(float(x)))))
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="judge_raw.json: array of {id,correctness,depth,clarity,note}")
    ap.add_argument("--map", help="judge_map.json (default: alongside --raw)")
    ap.add_argument("--out", required=True, help="judge_scores.jsonl to write")
    a = ap.parse_args()

    map_path = a.map or os.path.join(os.path.dirname(os.path.abspath(a.raw)), "judge_map.json")
    mapping = json.load(open(map_path, encoding="utf-8"))
    raw = json.load(open(a.raw, encoding="utf-8"))
    if isinstance(raw, dict):                       # tolerate {"scores":[...]} or a single object
        raw = raw.get("scores") or raw.get("results") or [raw]

    rows, seen, unknown, bad = [], set(), [], []
    for r in raw:
        bid = r.get("id")
        m = mapping.get(bid)
        if not m:
            unknown.append(bid)
            continue
        scores = {k: clamp05(r.get(k)) for k in ("correctness", "depth", "clarity")}
        if any(v is None for v in scores.values()):
            bad.append(bid)
            continue
        rows.append({"config": m["config"], "task_id": m["task_id"], "rep": m.get("rep", 0),
                     "note": (r.get("note") or "")[:300], **scores})
        seen.add(bid)

    with open(a.out, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    missing = [bid for bid in mapping if bid not in seen]
    print(f"wrote {len(rows)} judged rows -> {a.out}")
    if unknown:
        print(f"  ⚠️ {len(unknown)} unknown block id(s) ignored: {', '.join(str(x) for x in unknown[:8])}")
    if bad:
        print(f"  ⚠️ {len(bad)} block(s) with non-numeric/out-of-range scores skipped: {', '.join(bad[:8])}")
    if missing:
        print(f"  ⚠️ {len(missing)} block(s) NOT scored by the judge (missing from raw): {', '.join(missing[:8])}")
    # per-config mean (sanity)
    agg = {}
    for r in rows:
        agg.setdefault(r["config"], []).append((r["correctness"] + r["depth"] + r["clarity"]) / 3)
    print(f"\n{'config':40} {'mean/5':>7} {'n':>4}")
    for c, vals in sorted(agg.items()):
        print(f"{c:40} {sum(vals)/len(vals):>7.2f} {len(vals):>4}")


if __name__ == "__main__":
    main()
