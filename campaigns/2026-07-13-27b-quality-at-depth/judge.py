#!/usr/bin/env python3
"""judge.py — blind LLM judge for the quality-at-depth TS eval.

Functional correctness is graded deterministically by score_typescript.py (tsc/eslint/vitest). This
adds the SUBJECTIVE axes a toolchain can't measure — design, clarity, robustness (0-5) — by asking a
judge model to review each candidate. **Blind:** the prompt never reveals which config/model produced
the answer. Works against any OpenAI-compatible endpoint (hosted API or a strong local model).

Saves BOTH the parsed scores (--out judge_scores.jsonl: config/task_id/rep/design/clarity/robustness/
notes) AND the full judge prompt+reply (--raw judge_raw.jsonl) so every input is committable + auditable.
Resumable: (config,task_id,rep) already present in --out are skipped.

  JUDGE_API_KEY=... python3 judge.py --outputs out/outputs.jsonl --tasks tasks.jsonl \
      --base-url https://api.example/v1 --model my-judge --out out/judge_scores.jsonl --raw out/judge_raw.jsonl
"""
import argparse, json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from score_typescript import extract_files            # reuse the exact same code-block parser

THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
AXES = ["design", "clarity", "robustness"]
RUBRIC = (
    "You are a strict senior TypeScript reviewer. A candidate solved the task below; its functional "
    "correctness, types, lint and tests are ALREADY machine-graded — do NOT re-score those. Judge only "
    "the SUBJECTIVE engineering quality on three axes, each 0-5 (5 = excellent, 0 = poor):\n"
    "  design      — right abstraction, single-responsibility, no over/under-engineering\n"
    "  clarity     — readable, well-named, easy to follow; comments only where they earn their place\n"
    "  robustness  — anticipates edge cases and failure modes beyond the literal spec\n"
    "Reply with ONLY a JSON object: {\"design\":N,\"clarity\":N,\"robustness\":N,\"notes\":\"<=1 sentence\"}."
)


def read_spec(task_id):
    p = os.path.join(HERE, "ts-harness", "tasks", task_id, "spec.md")
    return open(p).read() if os.path.exists(p) else f"(spec for {task_id} not found)"


def judge_prompt(task_id, answer_code):
    return (f"{RUBRIC}\n\n[TASK SPEC]\n{read_spec(task_id)}\n\n"
            f"[CANDIDATE SOLUTION]\n{answer_code}\n")


def call(base, model, key, prompt, timeout=300):
    payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "max_tokens": 512}
    if model:
        payload["model"] = model
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions",
                                 data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        obj = json.loads(r.read().decode())
    return obj["choices"][0]["message"]["content"]


def parse_scores(text):
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    out = {}
    for a in AXES:
        v = d.get(a)
        if isinstance(v, (int, float)):
            out[a] = max(0, min(5, float(v)))
    if not out:
        return None
    out["notes"] = str(d.get("notes", ""))[:300]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outputs", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--raw", default="")
    ap.add_argument("--key-env", default="JUDGE_API_KEY", help="env var holding the API key (if any)")
    a = ap.parse_args()
    key = os.environ.get(a.key_env, "")

    # matrix tasks only, and remember tiers for the score rows
    tiers = {}
    for l in open(a.tasks):
        if l.strip():
            t = json.loads(l); tiers[t["id"]] = t.get("tier", "?")

    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if l.strip():
                r = json.loads(l); done.add((r.get("config"), r.get("task_id"), r.get("rep")))

    n = ok = 0
    fout = open(a.out, "a"); fraw = open(a.raw, "a") if a.raw else None
    for l in open(a.outputs):
        if not l.strip():
            continue
        o = json.loads(l)
        cfg, tid, rep = o.get("config"), o.get("task_id"), o.get("rep", 0)
        if o.get("error") or not o.get("response") or (cfg, tid, rep) in done:
            continue
        files = extract_files(THINK_RE.sub("", o["response"]))
        if not files:
            continue
        code = "\n\n".join(f"// FILE: {p}\n{c}" for p, c in files.items())
        prompt = judge_prompt(tid, code)
        n += 1
        try:
            raw = call(a.base_url, a.model, key, prompt)
        except Exception as e:
            print(f"  [{cfg}] {tid} rep{rep}: JUDGE ERROR {e}", file=sys.stderr)
            continue
        if fraw:
            fraw.write(json.dumps({"config": cfg, "task_id": tid, "rep": rep,
                                   "prompt": prompt, "raw": raw}) + "\n"); fraw.flush()
        sc = parse_scores(raw)
        if not sc:
            print(f"  [{cfg}] {tid} rep{rep}: unparseable judge reply (saved raw)", file=sys.stderr)
            continue
        row = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"), **sc}
        fout.write(json.dumps(row) + "\n"); fout.flush()
        ok += 1
        print(f"  [{cfg}] {tid} rep{rep}: design={sc['design']} clarity={sc['clarity']} robustness={sc['robustness']}")
    print(f"judged {ok}/{n} replies -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
