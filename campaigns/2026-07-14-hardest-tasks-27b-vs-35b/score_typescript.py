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
  python3 score_typescript.py batch    --outputs out/outputs.jsonl --tasks tasks.jsonl --out out/scores_typescript.jsonl
  python3 score_typescript.py selftest
"""
import argparse, glob, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.join(HERE, "ts-harness")
WORK = os.path.join(HARNESS, "cases", "_work")
WORK_REL = "cases/_work"
BIN = os.path.join(HARNESS, "node_modules", ".bin")
WEIGHTS = {"types": 1.0, "lint": 1.0, "tests": 1.5, "edge": 1.5, "reuse": 1.0, "bdd": 0.5, "novj": 0.5}
FRAC_K = {"types": 3, "lint": 5}     # (A) error count at which a fractional objective reaches 0


class GraderError(RuntimeError):
    """The toolchain itself failed to run (e.g. vitest spawned no summary) — distinct from 'the
    candidate failed'. The batch grader records this as grade_error, NEVER a silent 0 (the bug that
    voided the previous run)."""


def ensure_deps():
    if os.path.exists(os.path.join(BIN, "vitest")):
        return
    print("ts-harness: node_modules missing -> npm install (one-time)...", file=sys.stderr)
    r = subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=HARNESS,
                       capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        sys.exit(f"npm install FAILED:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")   # CSI escapes (color/cursor) that a TTY/tmux/FORCE_COLOR env
                                               # injects into vitest/tsc/eslint output and break the parsers


def _run(cmd, timeout=180):
    # NO_COLOR/FORCE_COLOR=0 asks the tools for plain text; _ANSI.sub strips anything that leaks anyway
    # (a tmux/interactive run made vitest colorize its `Tests 2 passed` summary → _vitest_counts saw None
    # → false GraderError). Belt AND suspenders so grading never mis-fires on formatting.
    env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"}
    try:
        r = subprocess.run(cmd, cwd=HARNESS, capture_output=True, text=True, timeout=timeout, env=env)
        return r.returncode, _ANSI.sub("", (r.stdout or "") + (r.stderr or ""))
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT"


def _vitest_counts(out):
    """(passed, total) if vitest reported a `Tests …` summary; None if it produced NO summary at all
    (a harness/collection failure) — so the caller can retry / fail loud instead of scoring a silent 0.
    Distinguishes 'all tests failed' (has a Tests line) from 'vitest never ran' (no Tests line)."""
    m = re.search(r"^\s*Tests\s+(.+)$", out, re.M)
    if not m:
        return None
    line = m.group(1)
    p = re.search(r"(\d+)\s+passed", line)
    f = re.search(r"(\d+)\s+failed", line)
    passed = int(p.group(1)) if p else 0
    failed = int(f.group(1)) if f else 0
    return passed, passed + failed


def _bin(name):
    return os.path.join(BIN, name)


def _vitest_run(paths, timeout=240):
    """THE FIX. Run vitest single-process (`--no-file-parallelism` → no worker pool to fail under
    memory pressure), retry once, and FAIL LOUD (GraderError) if it still yields no parseable summary
    — instead of the silent (0,0) that zeroed tests+edge on all 120 replies last run."""
    out = ""
    for _ in range(2):
        _, out = _run([_bin("vitest"), "run", "--no-file-parallelism"] + paths, timeout)
        c = _vitest_counts(out)
        if c is not None:
            return c
    raise GraderError(f"vitest produced no parseable Tests summary after 2 attempts (tail: ...{out[-300:]})")


def _type_errs(o):                                   # (A) count tsc errors for the fractional score
    m = re.search(r"Found (\d+) error", o)
    return int(m.group(1)) if m else len(re.findall(r": error TS\d+", o))


def _lint_errs(o):                                   # (A) count eslint errors from its summary line
    m = re.search(r"\((\d+)\s+errors?[,)]", o)        # "... (3 errors, 0 warnings)"
    return int(m.group(1)) if m else (1 if o.strip() else 0)


def _frac(rc, errs, key):
    """(A) Fractional objective: clean (rc==0) = 1.0; else 1 − min(1, errs/K). Gives resolution on the
    strict-code wall — 1 error (0.8) is very different from 8 (0.0) — instead of a binary 0/1 that
    hides how close the model is. hard-pass still needs a full 1.0 (i.e. zero errors)."""
    if rc == 0:
        return 1.0
    return max(0.0, 1.0 - min(1.0, max(errs, 1) / FRAC_K[key]))


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

    rc_types, out_types = _run([_bin("tsc"), "--noEmit"], 180)
    model_paths = [f"{WORK_REL}/{r}" for r in files]
    rc_lint, out_lint = _run([_bin("eslint")] + model_paths, 180) if model_paths else (0, "")

    all_tests = sorted(os.path.relpath(p, WORK).replace(os.sep, "/")
                       for p in glob.glob(os.path.join(WORK, "**", "*.test.ts"), recursive=True))
    own = [t for t in all_tests if t not in hidden]
    tp, tt = _vitest_run([f"{WORK_REL}/{t}" for t in own]) if own else (0, 0)
    edge_frac = None
    if hidden:
        ep, et = _vitest_run([f"{WORK_REL}/{h}" for h in hidden])
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

    obj = {"types": round(_frac(rc_types, _type_errs(out_types), "types"), 2),
           "lint": round(_frac(rc_lint, _lint_errs(out_lint), "lint"), 2),
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


def error_report(files, task_dir):
    """Stage the candidate and return the raw tsc + eslint output — the material a one-turn REPAIR
    arm (repair.py, add-on B) feeds back to the model. No vitest (repair targets the lint/types wall)."""
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
    rc_t, out_t = _run([_bin("tsc"), "--noEmit"], 180)
    rc_l, out_l = _run([_bin("eslint")] + [f"{WORK_REL}/{r}" for r in files], 180)
    return {"types_ok": rc_t == 0, "lint_ok": rc_l == 0, "tsc": out_t.strip(), "eslint": out_l.strip()}


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


def grade_batch(outputs_path, tasks_path, out_path, resume=False):
    """Grade a whole capture run. outputs.jsonl rows carry {config, task_id, rep, response}; the
    task manifest (tasks.jsonl) maps task_id -> ts-harness/tasks/<id>. One score row per output row,
    tagged with config/task_id/rep/tier so make_charts can aggregate + draw the calibration bands.

    resume=True: reuse rows already present in out_path (keyed config/task_id/rep) instead of
    re-running tsc+eslint+vitest on them — grading is the expensive step, so an incremental campaign
    (new cells appended to configs.jsonl) only pays for the NEW replies. Rows carrying a grade_error
    are always re-graded (a harness failure is not a result worth caching). The file is still
    REWRITTEN in outputs.jsonl order, so the output is identical to a full run and can never
    accumulate duplicates or stale rows."""
    tiers = {}
    for l in open(tasks_path):
        if l.strip():
            t = json.loads(l); tiers[t["id"]] = t.get("tier", "?")
    done = {}
    if resume and os.path.exists(out_path):
        for l in open(out_path):
            if not l.strip():
                continue
            try:
                r = json.loads(l)
            except json.JSONDecodeError:
                continue
            if r.get("grade_error"):          # never cache a harness failure — retry it
                continue
            done[(r.get("config"), r.get("task_id"), r.get("rep", 0))] = r
    rows, n_err, n_skip = [], 0, 0
    with open(out_path, "w") as fout:
        for l in open(outputs_path):
            if not l.strip():
                continue
            o = json.loads(l)
            tid, cfg, rep = o.get("task_id"), o.get("config"), o.get("rep", 0)
            cached = done.get((cfg, tid, rep))
            if cached is not None:
                fout.write(json.dumps(cached) + "\n"); fout.flush()
                rows.append(cached); n_skip += 1
                continue
            if o.get("error") or not o.get("response"):
                sc = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"),
                      "score": 0.0, "hard_pass": False, "objectives": {}, "grade_error": o.get("error") or "empty response"}
                n_err += 1
            else:
                files = extract_files(o["response"])
                task_dir = os.path.join(HARNESS, "tasks", tid)
                if not files:
                    sc = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"),
                          "score": 0.0, "hard_pass": False, "objectives": {}, "grade_error": "no FILE/fence blocks"}
                    n_err += 1
                else:
                    try:
                        g = grade_files(files, task_dir, f"{cfg}:{tid}:{rep}")
                        sc = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"),
                              "score": g["score"], "hard_pass": g["hard_pass"], "objectives": g["objectives"]}
                    except GraderError as e:      # THE FIX: harness failure is recorded, never a silent 0
                        sc = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"),
                              "score": None, "hard_pass": False, "objectives": {}, "grade_error": f"HARNESS: {e}"}
                        n_err += 1
            fout.write(json.dumps(sc) + "\n"); fout.flush()
            rows.append(sc)
            hp = "P" if sc["hard_pass"] else "F"
            print(f"  [{cfg}] {tid} rep{rep}: score={sc['score']} {hp}"
                  + (f"  ({sc['grade_error']})" if sc.get("grade_error") else ""))
    print(f"graded {len(rows) - n_skip} rows ({n_err} errors/empty)"
          + (f", reused {n_skip} already-graded" if n_skip else "")
          + f" -> {out_path} [{len(rows)} total]", file=sys.stderr)
    return rows


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fixture"); f.add_argument("--dir", required=True); f.add_argument("--task", required=True)
    r = sub.add_parser("response"); r.add_argument("--response-file", required=True); r.add_argument("--task", required=True); r.add_argument("--id", default="case")
    b = sub.add_parser("batch"); b.add_argument("--outputs", required=True); b.add_argument("--tasks", required=True); b.add_argument("--out", required=True)
    b.add_argument("--resume", action="store_true",
                   help="reuse rows already in --out (skip re-running tsc/eslint/vitest on them); "
                        "grade_error rows are always retried")
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
    elif a.cmd == "batch":
        grade_batch(a.outputs, a.tasks, a.out, resume=a.resume)
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
