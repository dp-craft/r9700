#!/usr/bin/env python3
"""score_typescript.py — multi-objective grader for the quality-at-depth TS TDD eval.

For a candidate (impl.ts + impl.test.ts), runs the REAL toolchain in ts-harness/ and scores
objectives a weak config fails independently:
  types  = tsc --noEmit (strict) clean
  lint   = eslint (minimal-strict) clean on impl + impl.test
  tests  = the candidate's OWN vitest tests pass (TDD green)
  edge   = the grader-held hidden.test.ts (edge cases) passes
  reuse  = impl imports+uses the planted lib util (no reinvention)
  bdd    = test titles match `should <behavior> when <condition>`
  novj   = vitest only (no `jest.*`)
Deps auto-install on first run (npm install if node_modules is absent).

  python3 score_typescript.py fixture --dir ts-harness/fixtures/count-words-good --task ts-harness/tasks/count-words
  python3 score_typescript.py response --response-file reply.txt --task ts-harness/tasks/count-words --id un-rb2048/count-words/0
  python3 score_typescript.py selftest        # grade the good+bad reference fixtures, assert discrimination
"""
import argparse, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "ts-harness")
WORK = os.path.join(HARNESS, "cases", "_work")
BIN = os.path.join(HARNESS, "node_modules", ".bin")
WEIGHTS = {"types": 1.0, "lint": 1.0, "tests": 1.5, "edge": 1.5, "reuse": 1.0, "bdd": 0.5, "novj": 0.5}


def ensure_deps():
    if os.path.exists(os.path.join(BIN, "vitest")):
        return
    print("ts-harness: node_modules missing -> npm install (one-time)...", file=sys.stderr)
    r = subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=HARNESS,
                       capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        sys.exit(f"npm install FAILED:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


def _run(cmd, timeout=180):
    try:
        r = subprocess.run(cmd, cwd=HARNESS, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"


def _vitest_counts(out):
    m = re.search(r"Tests\s+(?:(\d+) failed[ |]+)?(\d+) passed", out)
    if m:
        failed = int(m.group(1) or 0); passed = int(m.group(2))
        return passed, passed + failed
    if re.search(r"No test (files|suite) found", out):
        return 0, 0
    return 0, 0


def grade(impl_src, test_src, task_dir, cid="case"):
    ensure_deps()
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, "impl.ts"), "w") as f:
        f.write(impl_src)
    with open(os.path.join(WORK, "impl.test.ts"), "w") as f:
        f.write(test_src)
    hidden = os.path.join(task_dir, "hidden.test.ts")
    if os.path.exists(hidden):
        shutil.copyfile(hidden, os.path.join(WORK, "hidden.test.ts"))

    rc_types, _ = _run([os.path.join(BIN, "tsc"), "--noEmit"], 180)
    rc_lint, _ = _run([os.path.join(BIN, "eslint"), "cases/_work/impl.ts", "cases/_work/impl.test.ts"], 180)
    _, out_t = _run([os.path.join(BIN, "vitest"), "run", "cases/_work/impl.test.ts"], 180)
    tp, tt = _vitest_counts(out_t)
    edge_frac = None
    if os.path.exists(hidden):
        _, out_e = _run([os.path.join(BIN, "vitest"), "run", "cases/_work/hidden.test.ts"], 180)
        ep, et = _vitest_counts(out_e)
        edge_frac = (ep / et) if et else 0.0

    # static rule checks
    reuse = bool(re.search(r'normalizeToken', impl_src) and re.search(r'from\s+["\'][^"\']*lib/tokenize', impl_src))
    novj = not re.search(r'\bjest\b', test_src)
    titles = re.findall(r'(?:\bit|\btest)\s*\(\s*["\'`](.+?)["\'`]', test_src)
    bdd = (sum(1 for t in titles if re.search(r'should .+ when ', t, re.I)) / len(titles)) if titles else 0.0

    obj = {
        "types": 1.0 if rc_types == 0 else 0.0,
        "lint": 1.0 if rc_lint == 0 else 0.0,
        "tests": (tp / tt) if tt else 0.0,
        "reuse": 1.0 if reuse else 0.0,
        "bdd": round(bdd, 2),
        "novj": 1.0 if novj else 0.0,
    }
    if edge_frac is not None:                      # only score edge when a hidden suite exists
        obj["edge"] = round(edge_frac, 2)
    score = round(sum(obj[k] * WEIGHTS[k] for k in obj) / sum(WEIGHTS[k] for k in obj), 3)
    gates = [obj["types"], obj["lint"], obj["tests"], obj["reuse"]] + ([obj["edge"]] if "edge" in obj else [])
    hard_pass = all(g == 1 for g in gates)
    return {"id": cid, "score": score, "hard_pass": hard_pass, "objectives": obj,
            "test_counts": {"own": [tp, tt]}}


FILE_RE = re.compile(r'//\s*FILE:\s*(impl\.test\.ts|impl\.ts)\s*\n(.*?)(?=//\s*FILE:|\Z)', re.DOTALL)


def extract_files(response):
    """Pull impl.ts / impl.test.ts out of a model reply. Accepts `// FILE:` markers;
    falls back to the first two ```ts blocks (test = the one importing ./impl or using it/describe)."""
    found = {m.group(1): _strip_fence(m.group(2)) for m in FILE_RE.finditer(response)}
    if "impl.ts" in found and "impl.test.ts" in found:
        return found["impl.ts"], found["impl.test.ts"]
    blocks = re.findall(r'```(?:ts|typescript)?\s*\n(.*?)```', response, re.DOTALL)
    impl = test = ""
    for b in blocks:
        if re.search(r'\b(describe|it|test)\s*\(', b) and not test:
            test = b
        elif not impl:
            impl = b
    return impl.strip(), test.strip()


def _strip_fence(s):
    s = re.sub(r'^```(?:ts|typescript)?\s*\n', '', s.strip())
    return re.sub(r'\n```\s*$', '', s).strip()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fixture"); f.add_argument("--dir", required=True); f.add_argument("--task", required=True)
    r = sub.add_parser("response"); r.add_argument("--response-file", required=True); r.add_argument("--task", required=True); r.add_argument("--id", default="case")
    sub.add_parser("selftest")
    a = ap.parse_args()

    if a.cmd == "fixture":
        impl = open(os.path.join(a.dir, "impl.ts")).read()
        test = open(os.path.join(a.dir, "impl.test.ts")).read()
        print(json.dumps(grade(impl, test, a.task, os.path.basename(a.dir)), indent=2))
    elif a.cmd == "response":
        impl, test = extract_files(open(a.response_file).read())
        print(json.dumps(grade(impl, test, a.task, a.id), indent=2))
    elif a.cmd == "selftest":
        task = os.path.join(HARNESS, "tasks", "count-words")
        def g(name):
            d = os.path.join(HARNESS, "fixtures", f"count-words-{name}")
            return grade(open(os.path.join(d, "impl.ts")).read(),
                         open(os.path.join(d, "impl.test.ts")).read(), task, name.upper())
        good, med, bad = g("good"), g("mediocre"), g("bad")
        print(json.dumps({"good": good, "mediocre": med, "bad": bad}, indent=2))
        # requirement: smooth, ordered discrimination (not just binary) + correct hard-gate
        ok = (good["hard_pass"] and good["score"] > 0.9
              and not med["hard_pass"] and 0.3 < med["score"] < 0.8
              and not bad["hard_pass"] and bad["score"] < 0.2
              and good["score"] > med["score"] > bad["score"])
        print(("SELFTEST PASS" if ok else "SELFTEST FAIL") +
              f"  (good={good['score']} > mediocre={med['score']} > bad={bad['score']}; "
              f"hard_pass good/med/bad = {good['hard_pass']}/{med['hard_pass']}/{bad['hard_pass']})", file=sys.stderr)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
