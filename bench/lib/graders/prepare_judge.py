#!/usr/bin/env python3
"""prepare_judge.py — extract the open-ended (`category:"judge"`) answers from a quality run into a
paste-ready **blind** bundle for in-session LLM judging.

Blindness: each answer becomes an opaque block id (b01, b02, …) in shuffled order, so the judge
cannot see which config produced it (a name like "uncensored" or "opus" must not bias the grade).
The id→(config, task_id, rep) mapping is written to a side file; `apply_judge_scores.py` uses it to
fold the judge's scores back in. Thinking is stripped — the judge grades the answer, not the trace.

    python3 prepare_judge.py --outputs out/outputs.jsonl --tasks tasks/tasks.jsonl \
        --out out/judge_bundle.md            # + writes out/judge_map.json alongside

Stdlib only.
"""
import argparse, json, os, random, re

THINK_RE = re.compile(r"<think>.*?</think>", re.S)


def strip_think(t):
    return THINK_RE.sub("", t or "").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outputs", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--out", required=True, help="judge_bundle.md to write")
    ap.add_argument("--map", help="id→config map json (default: judge_map.json next to --out)")
    ap.add_argument("--seed", type=int, default=42, help="shuffle seed (reproducible blinding)")
    a = ap.parse_args()

    tasks = {}
    for l in open(a.tasks, encoding="utf-8"):
        if l.strip():
            t = json.loads(l)
            tasks[t["id"]] = t
    judge_ids = {tid for tid, t in tasks.items() if t.get("category") == "judge"}

    blocks = []
    for l in open(a.outputs, encoding="utf-8"):
        if not l.strip():
            continue
        o = json.loads(l)
        if "error" in o or o.get("task_id") not in judge_ids:
            continue
        ans = strip_think(o.get("response", ""))
        if not ans:
            continue
        blocks.append({"config": o["config"], "task_id": o["task_id"], "rep": o.get("rep", 0),
                       "prompt": tasks[o["task_id"]]["prompt"], "answer": ans})
    if not blocks:
        raise SystemExit("prepare_judge: no judge-category answers found in outputs (nothing to grade)")

    random.Random(a.seed).shuffle(blocks)
    mapping = {}
    lines = ["# Blind judging bundle\n",
             f"{len(blocks)} answer(s) to grade. Each block below is one answer to an open-ended "
             "task, shown blind (you cannot tell which model produced it). Grade per the prompt you "
             "were given, keyed by the block id.\n"]
    for i, blk in enumerate(blocks, 1):
        bid = f"b{i:02d}"
        mapping[bid] = {"config": blk["config"], "task_id": blk["task_id"], "rep": blk["rep"]}
        lines.append(f"\n---\n\n## Block {bid}\n")
        lines.append(f"**Task:** {blk['prompt']}\n")
        lines.append(f"**Answer:**\n\n{blk['answer']}\n")

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    map_path = a.map or os.path.join(os.path.dirname(os.path.abspath(a.out)), "judge_map.json")
    with open(map_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2)
    print(f"wrote {len(blocks)} blind blocks -> {a.out}")
    print(f"      id→config map          -> {map_path}")
    print("Next: paste the bundle into a Claude session under the plan.md judge prompt; save the "
          "JSON reply to out/judge_raw.json; then run apply_judge_scores.py.")


if __name__ == "__main__":
    main()
