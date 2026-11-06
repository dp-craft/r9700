#!/usr/bin/env python3
"""long_run.py: the remaining local arms, most useful first, under a hard time limit. An arm starts only if its cap still fits, so the whole run ends by LIMIT_S.
Log: longrun.jsonl. Reordered at 19 min: retyping cost far more than estimated (6k tokens: 480 s, or cut at 600 s), so it now runs only where it answers a question. A cut arm goes to quarantine/ through run_arm.sh and counts only as "did not finish within its cap"."""
import json, os, subprocess, sys, time
RUN = "/home/dev/work/dp-craft/amd/bench/runs/2026-11-05-0320-ornith-usecases"
H = f"{RUN}/harness"
STARTER = "/home/dev/work/dp-craft/amd/ornith_rad_mtp.sh"
P2 = "--temp 0.6 --presence-penalty 0"
LIMIT = int(os.environ.get("LIMIT_S", 7200))
T0 = float(os.environ.get("T0_EPOCH", time.time()))
bad = 0


def note(**k):
    k["t_min"] = round((time.time() - T0) / 60, 1)
    line = json.dumps(k)
    print(line, flush=True)
    open(f"{RUN}/longrun.jsonl", "a").write(line + "\n")


def res(name):
    p = f"{RUN}/arms/{name}/result.json"
    return json.load(open(p)) if os.path.exists(p) else None


def arm(task, size, v, p="P0", rep="", cap=600):
    global bad
    name = f"{task}.{size}.{v}.{p}" + (f".{rep}" if rep else "")
    if res(name):
        return res(name)
    if os.path.isdir(f"{RUN}/quarantine/{name}"):
        return None
    left = LIMIT - (time.time() - T0)
    if cap > left:
        note(event="budget-skip", arm=name, cap=cap, left=int(left))
        return None
    rc = subprocess.run([f"{H}/run_arm.sh", task, size, v, p] + ([rep] if rep else []), env={**os.environ, "ARM_CAP": str(cap)}, stdout=subprocess.DEVNULL).returncode
    if rc == 3:
        note(event="abort", why="preset mismatch", arm=name)
        raise SystemExit(3)
    r = res(name)
    if r:
        bad = 0
        d = r["detail"]
        note(event="ok", arm=name, wall=r["wall_s"], gen=r["gen"], score=r["score"], zero_loss=d.get("zero_loss"), clean=d.get("clean"))
    else:
        bad += 1
        note(event="quarantine", arm=name, cap=cap)
        time.sleep(10)
        if bad >= 3:
            note(event="abort", why="3 failures in a row")
            raise SystemExit(4)
    return r


def server(extra):
    t = time.time()
    subprocess.run([STARTER, "stop"], check=True, stdout=subprocess.DEVNULL)
    env = {k: v for k, v in os.environ.items() if k != "EXTRA_ARGS"}
    if extra:
        env["EXTRA_ARGS"] = extra
    subprocess.run([STARTER, "start"], check=True, env=env, stdout=subprocess.DEVNULL)
    note(event="server", extra=extra, restart_s=round(time.time() - t))


def rank(r):
    d = r["detail"]
    return (bool(d.get("clean")), bool(d.get("zero_loss")), d.get("score") or 0, -r["wall_s"])


def holds(task, size, brief, base="S"):
    """The larger size stays within 0.05 of the smaller one, with no compaction."""
    a, b = res(f"{task}.{base}.{brief}.P0"), res(f"{task}.{size}.{brief}.P0")
    return bool(a and b and b["score"] >= a["score"] - 0.05 and not b["drops"])


# Wait for the arm the first driver left running.
while subprocess.run("ps -eo args | grep -qE '^bash .*run_arm\\.sh'", shell=True).returncode == 0:
    time.sleep(3)

# A. Document refactoring, the rest of the small sizes. The manifest method, and prose.
for t, s in (("docreorg", "S"), ("docsplit", "P")):
    arm(t, s, "V3", cap=400)

# B. Precise-coding preset, restart included. The server always returns to P0 afterwards.
try:
    server(P2)
    for t, v in (("impl", "V0"), ("testgen", "V0"), ("edit", "V0"), ("bugfix", "V0")):
        arm(t, "-", v, "P2")
    arm("bugs", "S", "V1", "P2")
    arm("log", "S", "V2", "P2")
    arm("docreorg", "S", "V3", "P2", cap=400)
    # Does P2 stop the retyping cost? docsplit compares with P0, docreorg only runs once.
    a = arm("docsplit", "S", "V1", "P2", cap=720)
    arm("docreorg", "S", "V1", "P2", cap=720)
    if a and a["detail"].get("clean") and a["wall_s"] < 300:
        arm("docsplit", "M", "V1", "P2", cap=720)
finally:
    server("")

# C. How far the cheap read use cases go.
BEST = {"log": "V2", "json": "V3", "summary": "V1", "codeinv": "V0"}
for t, v in BEST.items():
    arm(t, "M", v)
arm("summary", "HU", "V1")
for t in ("codeinv", "summary", "json", "log"):
    if holds(t, "M", BEST[t]):
        arm(t, "L", BEST[t])
    else:
        note(event="stop-ladder", task=t, at="M")

# D. How far the manifest method goes, then repeats, so zero loss rests on more than one run.
for t in ("docsplit", "docreorg"):
    for s in ("M", "L"):
        arm(t, s, "V3", cap=400)
    s = "L" if (res(f"{t}.L.V3.P0") or {}).get("detail", {}).get("clean") else "M"
    for rep in ("r2", "r3"):
        arm(t, s, "V3", rep=rep, cap=400)

# E. Per-document notes with the table-search step.
for s in ("buildcmp", "sharp", "depth", "hardest"):
    arm("docnotes", s, "V2")

# F. The reasoning-heavy read use cases, if a realistic time still fits. From S, classify M needs about 12 min and bugs M about 15.
arm("classify", "M", "V2", cap=840)
arm("bugs", "M", "V1", cap=960)
arm("classify", "S", "V2", rep="r2", cap=300)
arm("impl", "-", "V0", rep="r2", cap=300)
note(event="end")
