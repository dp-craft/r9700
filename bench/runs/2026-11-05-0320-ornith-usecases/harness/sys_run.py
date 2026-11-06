#!/usr/bin/env python3
"""sys_run.py: does the system prompt change Ornith's weak spots? One run per arm, most useful first, under LIMIT_S. An arm starts only if its cap still fits.
sa = the exact subagent text replaces the main prompt (--system-prompt-file). dp = the operator's prompt appended to the main prompt (--append-system-prompt-file). Baseline = the earlier P0 arms. Log: sysprompt.jsonl."""
import json, os, subprocess, time
RUN = "/home/dev/work/dp-craft/amd/bench/runs/2026-11-05-0320-ornith-usecases"
H = f"{RUN}/harness"
LIMIT = int(os.environ.get("LIMIT_S", 5400))
T0 = time.time()
SYS = {"sa": f"--system-prompt-file {H}/sysprompts/subagent.txt", "dp": f"--append-system-prompt-file {H}/sysprompts/dp.txt", "base2": ""}
DOC = [("docsplit", "L", "V3", 300), ("docreorg", "L", "V3", 600), ("summary", "M", "V1", 300), ("docnotes", "buildcmp", "V2", 420), ("docnotes", "sharp", "V2", 420), ("docnotes", "depth", "V2", 420), ("docnotes", "hardest", "V2", 420), ("classify", "S", "V2", 600)]
PLAN = [("classify", "S", "V2", 600, "base2")]
for a in DOC:
    PLAN += [(*a, "sa"), (*a, "dp")]
PLAN += [("classify", "M", "V2", 840, "dp"), ("bugs", "M", "V1", 1200, "dp"), ("bugs", "S", "V1", 600, "dp"), ("impl", "-", "V0", 420, "dp"), ("log", "L", "V2", 420, "dp"), ("classify", "M", "V2", 840, "sa")]


def note(**k):
    k["t_min"] = round((time.time() - T0) / 60, 1)
    line = json.dumps(k)
    print(line, flush=True)
    open(f"{RUN}/sysprompt.jsonl", "a").write(line + "\n")


bad = 0
for task, size, v, cap, tag in PLAN:
    name = f"{task}.{size}.{v}.P0.{tag}"
    if os.path.exists(f"{RUN}/arms/{name}/result.json") or os.path.isdir(f"{RUN}/quarantine/{name}"):
        continue
    if cap > LIMIT - (time.time() - T0):
        note(event="budget-skip", arm=name)
        continue
    rc = subprocess.run([f"{H}/run_arm.sh", task, size, v, "P0", tag], env={**os.environ, "ARM_CAP": str(cap), "SYS_ARGS": SYS[tag]}, stdout=subprocess.DEVNULL).returncode
    if rc == 3:
        note(event="abort", why="preset mismatch", arm=name)
        raise SystemExit(3)
    p = f"{RUN}/arms/{name}/result.json"
    if os.path.exists(p):
        r = json.load(open(p))
        bad = 0
        note(event="ok", arm=name, wall=r["wall_s"], gen=r["gen"], score=r["score"], peak=r["prompt_peak"], clean=r["detail"].get("clean"))
    else:
        bad += 1
        note(event="quarantine", arm=name, cap=cap)
        time.sleep(10)
        if bad >= 3:
            note(event="abort", why="3 failures in a row")
            raise SystemExit(4)
note(event="end")
