#!/usr/bin/env python3
"""score_deterministic.py — objectively grade the DETERMINISTIC tasks (no LLM judge needed).

Reads the capture harness output (outputs.jsonl: one row per config×task×rep with the model's raw
reply + token usage) and tasks.jsonl (grader specs), and emits scores.jsonl + a printed summary.
Grader kinds: final_match, pyexec (runs candidate code in an isolated subprocess), json_schema,
constraints. The `judge` tasks are skipped here — they go to the LLM-judge step (Phase B).

    python3 score_deterministic.py --tasks ../tasks/tasks.jsonl --outputs OUT/outputs.jsonl \
        --out OUT/scores_deterministic.jsonl

⚠️ pyexec RUNS MODEL-GENERATED CODE. It is sandboxed only by a subprocess + timeout (no network/fs
isolation). Run on a throwaway box or inside a container if you don't trust the outputs. Stdlib only.
"""
import argparse, json, re, subprocess, sys, tempfile, os

THINK_RE = re.compile(r"<think>.*?</think>", re.S)
CODE_RE = re.compile(r"```(?:python)?\s*(.*?)```", re.S)


def strip_think(t):
    return THINK_RE.sub("", t or "").strip()


def final_answer(t):
    """Text after the last `FINAL:` marker (post-thinking answer)."""
    body = strip_think(t)
    m = list(re.finditer(r"FINAL:\s*(.+)", body))
    return m[-1].group(1).strip() if m else body.strip().splitlines()[-1] if body.strip() else ""


def code_block(t):
    blocks = CODE_RE.findall(strip_think(t))
    return blocks[-1].strip() if blocks else strip_think(t)


def norm(s, how):
    s = s.strip()
    if how == "int":
        m = re.search(r"-?\d+", s.replace(",", ""));  return m.group(0) if m else s
    if how == "float":
        m = re.search(r"-?\d+(?:\.\d+)?", s.replace(",", ""));  return str(float(m.group(0))) if m else s
    if how == "lower_nospace":
        return re.sub(r"\s+", "", s.lower())
    if how == "lower":
        return s.lower()
    return s


def g_final_match(reply, spec):
    got = norm(final_answer(reply), spec.get("normalize", ""))
    exp = norm(spec["answer"], spec.get("normalize", ""))
    return got == exp, f"got={got!r} exp={exp!r}"


def g_pyexec(reply, spec, timeout=10):
    src = code_block(reply) + "\n\n" + spec["tests"] + "\nprint('OK')\n"
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src); path = f.name
    try:
        r = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=timeout)
        ok = r.returncode == 0 and r.stdout.strip().endswith("OK")
        return ok, (r.stderr.strip().splitlines()[-1] if not ok and r.stderr.strip() else "OK")
    except subprocess.TimeoutExpired:
        return False, "timeout"
    finally:
        os.unlink(path)


def g_json_schema(reply, spec):
    body = strip_think(reply)
    m = re.search(r"\{.*\}", body, re.S)
    if not m:
        return False, "no JSON object found"
    try:
        obj = json.loads(m.group(0))
    except Exception as e:
        return False, f"invalid JSON: {e}"
    for k in spec.get("required_keys", []):
        if k not in obj:
            return False, f"missing key {k}"
    tmap = {"str": str, "number": (int, float), "list": list, "int": int}
    for k, t in spec.get("types", {}).items():
        if not isinstance(obj.get(k), tmap[t]):
            return False, f"{k} not {t}"
    items = obj.get("items", [])
    if len(items) < spec.get("min_items", 0):
        return False, f"items<{spec['min_items']}"
    for it in items:
        for ik in spec.get("item_keys", []):
            if not isinstance(it, dict) or ik not in it:
                return False, f"item missing {ik}"
    return True, "OK"


def g_constraints(reply, spec):
    lines = [l for l in strip_think(reply).splitlines() if l.strip()]
    if spec.get("exact_lines") is not None and len(lines) != spec["exact_lines"]:
        return False, f"{len(lines)} lines != {spec['exact_lines']}"
    pref = spec.get("line_prefix", "")
    if pref and not all(l.startswith(pref) for l in lines):
        return False, "prefix missing"
    vals = [l[len(pref):].strip() for l in lines]
    if spec.get("unique") and len(set(v.lower() for v in vals)) != len(vals):
        return False, "duplicates"
    if spec.get("sorted") and [v.lower() for v in vals] != sorted(v.lower() for v in vals):
        return False, "not sorted"
    return True, "OK"


GRADERS = {"final_match": g_final_match, "pyexec": g_pyexec,
           "json_schema": g_json_schema, "constraints": g_constraints}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--outputs", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    tasks = {}
    for line in open(a.tasks):
        line = line.strip()
        if line:
            t = json.loads(line); tasks[t["id"]] = t
    rows, agg = [], {}
    for line in open(a.outputs):
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        t = tasks.get(o["task_id"])
        if not t or t["category"] != "deterministic":
            continue
        spec = t["grader"]
        passed, detail = GRADERS[spec["kind"]](o.get("response", ""), spec)
        rows.append({"config": o["config"], "task_id": o["task_id"], "rep": o.get("rep", 0),
                     "passed": passed, "detail": detail,
                     "completion_tokens": o.get("completion_tokens"),
                     "think_tokens": o.get("think_tokens")})
        agg.setdefault(o["config"], {"pass": 0, "n": 0})
        agg[o["config"]]["pass"] += int(passed); agg[o["config"]]["n"] += 1
    with open(a.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"wrote {len(rows)} graded rows -> {a.out}\n")
    print(f"{'config':40} {'pass':>8} {'n':>4}  {'pass%':>6}")
    for cfg, s in sorted(agg.items()):
        print(f"{cfg:40} {s['pass']:>8} {s['n']:>4}  {100*s['pass']/max(s['n'],1):>5.1f}%")


if __name__ == "__main__":
    main()
