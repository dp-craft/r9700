#!/usr/bin/env python3
"""repair.py — add-on B: ONE-TURN lint/type repair arm.

The campaign's core finding is that the 27B's gap to Opus is strict `tsc`/`eslint` cleanliness, NOT
logic. This tests the deployment fix: take a reply that FAILED types/lint, feed the exact tsc+eslint
errors back to the SAME live server for ONE repair turn, and re-grade. If it closes the gap, a one-turn
`eslint --fix`-style loop is the cheap production win.

Runs against a LIVE llama-server (the cell's own server, so same model+reasoning-budget). Idempotent:
(config,task,rep) rows already in --out are skipped. Grade the result with:
    python3 score_typescript.py batch --outputs out/outputs_repair.jsonl --tasks tasks.jsonl \
        --out out/scores_repair.jsonl

    # while the server for a cell is up (see run_capture.sh REPAIR=1 hook):
    python3 repair.py --config un-d128-f16-rb2048 --base-url http://127.0.0.1:8081 \
        --outputs out/outputs.jsonl --scores out/scores_typescript.jsonl --out out/outputs_repair.jsonl \
        --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 --max-tokens 8192
"""
import argparse, json, os, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score_typescript as g

SYS = ("You are a senior TypeScript engineer. You will be given a solution that is functionally close "
       "but FAILS a strict `tsc`+`eslint` gate, plus the exact compiler/linter errors. Fix ONLY those "
       "errors. Keep the behaviour and the tests intact. Obey the project rules (explicit return types, "
       "no `any`/`!`, `readonly`, functions <20 lines, no magic numbers, reuse existing utils). "
       "Re-output BOTH files in the EXACT `// FILE: <path>` format, nothing else.")


def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []


def chat(base_url, msgs, sampling):
    body = {"messages": msgs, "stream": False, **sampling}
    req = urllib.request.Request(base_url.rstrip("/") + "/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1200) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"].get("content") or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--outputs", default=f"{HERE}/out/outputs.jsonl")
    ap.add_argument("--scores", default=f"{HERE}/out/scores_typescript.jsonl")
    ap.add_argument("--out", default=f"{HERE}/out/outputs_repair.jsonl")
    ap.add_argument("--temp", type=float, default=0.6); ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--top-k", type=int, default=20); ap.add_argument("--min-p", type=float, default=0.0)
    ap.add_argument("--max-tokens", type=int, default=8192)
    a = ap.parse_args()
    sampling = {"temperature": a.temp, "top_p": a.top_p, "top_k": a.top_k, "min_p": a.min_p, "max_tokens": a.max_tokens}

    outs = {(r["config"], r["task_id"], r.get("rep", 0)): r for r in jl(a.outputs) if r.get("config") == a.config}
    scores = {(r["config"], r["task_id"], r.get("rep", 0)): r for r in jl(a.scores) if r.get("config") == a.config}
    done = {(r["config"], r["task_id"], r.get("rep", 0)) for r in jl(a.out)}
    n_fix = n_skip = 0
    with open(a.out, "a") as fout:
        for key, o in outs.items():
            if key in done:
                continue
            sc = scores.get(key) or {}
            obj = sc.get("objectives") or {}
            # only repair replies that failed the strict gate (types or lint < 1); leave clean/harness rows
            if sc.get("hard_pass") or (obj.get("types", 0) >= 1 and obj.get("lint", 0) >= 1):
                n_skip += 1
                continue
            files = g.extract_files(o.get("response") or "")
            if not files:
                n_skip += 1
                continue
            task_dir = os.path.join(g.HARNESS, "tasks", o["task_id"])
            rep = g.error_report(files, task_dir)
            if rep["types_ok"] and rep["lint_ok"]:
                n_skip += 1
                continue
            errs = (("\n## tsc errors\n" + rep["tsc"]) if not rep["types_ok"] else "") + \
                   (("\n## eslint errors\n" + rep["eslint"]) if not rep["lint_ok"] else "")
            code = "\n".join(f"// FILE: {r}\n{c}" for r, c in files.items())
            user = f"Here is the solution and the strict errors it produced. Fix ONLY these.\n\n{code}\n{errs}"
            try:
                content = chat(a.base_url, [{"role": "system", "content": SYS}, {"role": "user", "content": user}], sampling)
            except Exception as e:
                print(f"  repair FAILED {key}: {e}", file=sys.stderr)
                continue
            fout.write(json.dumps({"config": a.config, "task_id": o["task_id"], "rep": o.get("rep", 0),
                                   "repair": 1, "response": content}) + "\n")
            fout.flush(); n_fix += 1
            print(f"  repaired {key}")
    print(f"repair[{a.config}]: {n_fix} repaired, {n_skip} skipped (clean/no-fail) -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
