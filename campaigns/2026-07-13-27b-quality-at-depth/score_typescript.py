#!/usr/bin/env python3
"""score_typescript.py — multi-objective grader for the quality-at-depth TS eval.

Grades a candidate against a task by running the REAL toolchain in ts-harness/ + static checks.
Supports two task shapes:
  * single-file  — task has spec/rules(/hidden.test.ts); model outputs impl.ts + impl.test.ts.
  * multi-file   — task has base/ (a mini-project, green) + hidden/ (held-back tests); model outputs
                   `// FILE: <relpath>` blocks editing/adding files. Grades the WHOLE project after the
                   edit (a type change must keep every file + every existing test compiling & passing).

Objectives (weighted): types(tsc) lint(eslint) tests(own+existing vitest) edge(hidden vitest)
reuse(per-task reuse.json) bdd(test naming) novj(no jest). Deps auto-install on first run.

  python3 score_typescript.py fixture  --dir ts-harness/fixtures/count-words-good --task ts-harness/tasks/count-words
  python3 score_typescript.py response --response-file reply.txt --task ts-harness/tasks/lru-cache --id un-rb2048
  python3 score_typescript.py selftest
"""
import argparse, glob, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "ts-harness")
WORK = os.path.join(HARNESS, "cases", "_work")
WORK_REL = "cases/_work"
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
    return 0, 0


def _bin(name):
    return os.path.join(BIN, name)


def grade_files(files, task_dir, cid="case"):
    """files: {relpath: content} produced by the model. Stages base/ (if any) + overlay + hidden/,
    then runs the toolchain over the whole staged project."""
    ensure_deps()
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)
    base = os.path.join(task_dir, "base")
    if os.path.isdir(base):
        shutil.copytree(base, WORK, dirs_exist_ok=True)
    for rel, content in files.items():
        dst = os.path.join(WORK, rel)
        os.makedirs(os.path.dirname(dst) or WORK, exist_ok=True)
        with open(dst, "w") as f:
            f.write(content)
    # hidden tests (dir of files, or a single hidden.test.ts)
    hidden = []
    hd = os.path.join(task_dir, "hidden")
    if os.path.isdir(hd):
        for root, _, fs in os.walk(hd):
            for fn in fs:
                rel = os.path.relpath(os.path.join(root, fn), hd)
                dst = os.path.join(WORK, rel)
                os.makedirs(os.path.dirname(dst) or WORK, exist_ok=True)
                shutil.copyfile(os.path.join(root, fn), dst)
                hidden.append(rel.replace(os.sep, "/"))
    elif os.path.exists(os.path.join(task_dir, "hidden.test.ts")):
        shutil.copyfile(os.path.join(task_dir, "hidden.test.ts"), os.path.join(WORK, "hidden.test.ts"))
        hidden = ["hidden.test.ts"]

    rc_types, _ = _run([_bin("tsc"), "--noEmit"], 180)
    model_paths = [f"{WORK_REL}/{r}" for r in files]
    rc_lint, _ = _run([_bin("eslint")] + model_paths, 180) if model_paths else (0, "")

    all_tests = sorted(os.path.relpath(p, WORK).replace(os.sep, "/")
                       for p in glob.glob(os.path.join(WORK, "**", "*.test.ts"), recursive=True))
    own = [t for t in all_tests if t not in hidden]
    _, out_t = _run([_bin("vitest"), "run"] + [f"{WORK_REL}/{t}" for t in own], 180) if own else (0, "")
    tp, tt = _vitest_counts(out_t)
    edge_frac = None
    if hidden:
        _, out_e = _run([_bin("vitest"), "run"] + [f"{WORK_REL}/{h}" for h in hidden], 180)
        ep, et = _vitest_counts(out_e)
        edge_frac = (ep / et) if et else 0.0

    impl_src = "\n".join(c for r, c in files.items() if not r.endswith(".test.ts"))
    test_src = "\n".join(c for r, c in files.items() if r.endswith(".test.ts"))
    reuse = None
    rj = os.path.join(task_dir, "reuse.json")
    if os.path.exists(rj):
        spec = json.load(open(rj))
        sym, mod = spec["symbol"], spec["module"]
        reuse = bool(re.search(r'\b' + re.escape(sym) + r'\b', impl_src)
                     and re.search(r'from\s+["\'][^"\']*' + re.escape(mod), impl_src))
    novj = not re.search(r'\bjest\b', test_src)
    titles = [m.group(2) for m in re.finditer(r'(?:\bit|\btest)\s*\(\s*(["\'`])(.+?)\1', test_src)]
    bdd = (sum(1 for t in titles if re.search(r'should .+ when ', t, re.I)) / len(titles)) if titles else 0.0

    obj = {"types": 1.0 if rc_types == 0 else 0.0, "lint": 1.0 if rc_lint == 0 else 0.0,
           "tests": (tp / tt) if tt else 0.0, "bdd": round(bdd, 2), "novj": 1.0 if novj else 0.0}
    if reuse is not None:
        obj["reuse"] = 1.0 if reuse else 0.0
    if edge_frac is not None:
        obj["edge"] = round(edge_frac, 2)
    score = round(sum(obj[k] * WEIGHTS[k] for k in obj) / sum(WEIGHTS[k] for k in obj), 3)
    gates = [obj["types"], obj["lint"], obj["tests"]] + [obj[k] for k in ("reuse", "edge") if k in obj]
    hard_pass = all(g == 1 for g in gates)
    return {"id": cid, "score": score, "hard_pass": hard_pass, "objectives": obj,
            "test_counts": {"own": [tp, tt]}, "files": sorted(files)}


def grade(impl_src, test_src, task_dir, cid="case"):     # single-file convenience
    return grade_files({"impl.ts": impl_src, "impl.test.ts": test_src}, task_dir, cid)


FILE_RE = re.compile(r'//\s*FILE:\s*([^\n]+?)\s*\n(.*?)(?=//\s*FILE:|\Z)', re.DOTALL)


def _strip_fence(s):
    s = re.sub(r'^```(?:ts|typescript)?\s*\n', '', s.strip())
    return re.sub(r'\n```\s*$', '', s).strip()


def extract_files(response):
    """Pull `// FILE: <path>` blocks into {path: content}. Falls back to the first two ```ts blocks."""
    files = {m.group(1).strip(): _strip_fence(m.group(2)) for m in FILE_RE.finditer(response)}
    if files:
        return files
    blocks = re.findall(r'```(?:ts|typescript)?\s*\n(.*?)```', response, re.DOTALL)
    impl = test = ""
    for b in blocks:
        if re.search(r'\b(describe|it|test)\s*\(', b) and not test:
            test = b
        elif not impl:
            impl = b
    out = {}
    if impl.strip():
        out["impl.ts"] = impl.strip()
    if test.strip():
        out["impl.test.ts"] = test.strip()
    return out


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
        files = extract_files(open(a.response_file).read())
        if not files:
            sys.exit("no `// FILE:` blocks or ```ts fences found in response")
        print(json.dumps(grade_files(files, a.task, a.id), indent=2))
    elif a.cmd == "selftest":
        task = os.path.join(HARNESS, "tasks", "count-words")
        def g(name):
            d = os.path.join(HARNESS, "fixtures", f"count-words-{name}")
            return grade(open(os.path.join(d, "impl.ts")).read(),
                         open(os.path.join(d, "impl.test.ts")).read(), task, name.upper())
        good, med, bad = g("good"), g("mediocre"), g("bad")
        print(json.dumps({"good": good, "mediocre": med, "bad": bad}, indent=2))
        ok = (good["hard_pass"] and good["score"] > 0.9
              and not med["hard_pass"] and 0.3 < med["score"] < 0.8
              and not bad["hard_pass"] and bad["score"] < 0.2
              and good["score"] > med["score"] > bad["score"])
        print(("SELFTEST PASS" if ok else "SELFTEST FAIL") +
              f"  (good={good['score']} > mediocre={med['score']} > bad={bad['score']}; "
              f"hard_pass g/m/b = {good['hard_pass']}/{med['hard_pass']}/{bad['hard_pass']})", file=sys.stderr)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
