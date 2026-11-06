#!/usr/bin/env python3
"""prompt_run.py: is the dp prompt safe as the default, and does a profile add-on earn its place? Up to CONC arms at once, in priority order, under LIMIT_S.
dp = operator's prompt appended. dps = dp + the profile's add-on. b2, b3 = current prompt, repeated. Wall time is under load, so compare generated tokens, not seconds. Log: prompts.jsonl. Rerun skips finished arms."""
import json, os, subprocess, sys, threading, time, urllib.request
RUN = "/home/dev/work/dp-craft/amd/campaigns/workers/2026-11-05-0320-ornith-usecases/results/2026-11-05-0320-ornith-usecases"
H = f"{RUN}/harness"
LIMIT = int(os.environ.get("LIMIT_S", 7200))
CONC = int(os.environ.get("CONC", 3))
T0 = time.time()
DP = f"--append-system-prompt-file {H}/sysprompts/dp.txt"
DPS = f"--append-system-prompt-file {H}/sysprompts/dps-@P@.txt"


DPC = f"--append-system-prompt-file {H}/sysprompts/dpc-@P@.txt"
GR = f"--system-prompt-file {H}/sysprompts/gr.txt"


def sysargs(tag):
    if tag.startswith("rr"):  # rrN-R: rdN.txt replaces Claude Code's prompt (operator: replace, never append), repeat R
        return f"--system-prompt-file {H}/sysprompts/rd{tag[2:].split('-')[0]}.txt"
    if tag.startswith("rd"):  # rdN-R: variant N appended to Claude Code's prompt, repeat R (earlier tests only)
        return f"--append-system-prompt-file {H}/sysprompts/{tag.split('-')[0]}.txt"
    if tag.startswith("dpr-"):  # dp replaces Claude Code's prompt
        return f"--system-prompt-file {H}/sysprompts/dp.txt"
    return GR if tag.startswith("gr") else DPC if tag.startswith("dpc") else DPS if tag.startswith("dps") else DP if tag.startswith(("dp", "q")) else ""


SMOKE = [("codeinv", "S", "V0", 300, f"q{i}", "") for i in range(1, 5)]
REGRESSION = [(t, s, v, c, "dp", "") for t, s, v, c in [
    ("json", "S", "V3", 300), ("json", "L", "V3", 300), ("codeinv", "L", "V0", 600), ("testgen", "-", "V0", 420), ("edit", "-", "V0", 420), ("bugfix", "-", "V0", 300),
    ("log", "S", "V2", 420), ("log", "M", "V2", 600), ("docsplit", "S", "V3", 420), ("docsplit", "M", "V3", 420), ("docreorg", "S", "V3", 600), ("docreorg", "M", "V3", 600),
    ("summary", "S", "V1", 300), ("summary", "L", "V1", 420)]]
SHORT = []
for t, s, c, prof in [("bugs", "S", 900, ""), ("log", "S", 600, ""), ("classify", "S", 900, ""), ("summary", "S", 300, ""), ("json", "S", 420, "data"), ("docsplit", "S", 1200, "data"), ("docreorg", "S", 1200, "data")]:
    SHORT += [(t, s, "V0", c, "dp", prof), (t, s, "V0", c, "dps", prof)]
REPEAT = []
for t, s, v, c, tags in [("bugs", "S", "V1", 900, "b2 dp2 dps b3 dp3 dps2 dps3"), ("log", "L", "V2", 600, "b2 dp2 dps b3 dp3 dps2 dps3")]:
    REPEAT += [(t, s, v, c, g, "") for g in tags.split()]
REPEAT += [("docnotes", r, "V2", 900, "dps", "") for r in ("buildcmp", "sharp", "depth", "hardest")]
for t, s, v, c, tags in [("impl", "-", "V0", 900, "b3 dp2 dps dp3 dps2 dps3"), ("docreorg", "L", "V3", 900, "dp2 dps dp3 dps2"), ("classify", "M", "V2", 1800, "b2 dp2 dps")]:
    REPEAT += [(t, s, v, c, g, "") for g in tags.split()]
# follow-up: dpc = dp + a code add-on naming the allowed Bash commands. bdata = current prompt on the data profile, to split the profile's effect from dp's.
FOLLOW = [(t, "-", "V0", 900, g, "") for t, tags in [("impl", "dpc dpc2 dpc3"), ("testgen", "dpc dpc2 dp2"), ("edit", "dpc"), ("bugfix", "dpc")] for g in tags.split()]
FOLLOW += [("json", "S", "V0", 420, "bdata", "data"), ("docsplit", "S", "V0", 1200, "bdata", "data"), ("docsplit", "L", "V0", 1200, "dp", "data")]
# gr = one grounded prompt replacing Claude Code's on every profile: read rows against the default, data and code rows against dp. Notes first, so grading can start early.
GRP = [("docnotes", r, "V2", 900, g, "") for g in ("gr", "gr2") for r in ("buildcmp", "sharp", "depth", "hardest")]
GRP += [(t, s, v, c, g, "") for t, s, v, c, tags in [("log", "S", "V2", 600, "gr gr2"), ("log", "L", "V2", 600, "gr gr2"), ("bugs", "S", "V1", 900, "gr gr2"),
        ("classify", "S", "V2", 900, "gr"), ("summary", "M", "V1", 300, "gr"), ("impl", "-", "V0", 900, "gr gr2 gr3"), ("testgen", "-", "V0", 420, "gr gr2"),
        ("docreorg", "L", "V3", 900, "gr gr2"), ("json", "L", "V3", 300, "gr"), ("docsplit", "L", "V3", 420, "gr"), ("edit", "-", "V0", 420, "gr"), ("bugfix", "-", "V0", 300, "gr")] for g in tags.split()]
# read-prompt iteration on one case only (operator: 1 scenario, 1 size, then the full suite). Variants from argv[2:], report from RD_CASE.
RD = [("docnotes", os.environ.get("RD_CASE", "sharp"), os.environ.get("RD_V", "V2"), 900, f"{v}-{i}", "") for v in sys.argv[2:] for i in (1, 2, 3)]
DPR = [("impl", "-", "V0", 900, f"dpr-{i}", "") for i in (1, 2, 3)]  # dp as a replacement on the code profile
PLANS = {"smoke": SMOKE, "main": REGRESSION + SHORT + REPEAT, "follow": FOLLOW, "gr": GRP, "rd": RD, "dpr": DPR}
L = threading.Lock()
bad = 0
stop = False


def note(**k):
    k["t_min"] = round((time.time() - T0) / 60, 1)
    line = json.dumps(k)
    with L:
        print(line, flush=True)
        open(f"{RUN}/prompts.jsonl", "a").write(line + "\n")


def alive():
    try:
        return bool(urllib.request.urlopen("http://127.0.0.1:8000/v1/models", timeout=5).read())
    except Exception:
        return False


def one(arm):
    global bad, stop
    task, size, v, cap, tag, prof = arm
    name = f"{task}.{size}.{v}.P0.{tag}"
    env = {**os.environ, "ARM_CAP": str(cap), "SYS_ARGS": sysargs(tag), "ARM_PROFILE": prof, "ORNITH_PROMPT": "none"}  # the harness sets the prompt; the wrapper adds none
    rc = subprocess.run([f"{H}/run_arm.sh", task, size, v, "P0", tag], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
    p = f"{RUN}/arms/{name}/result.json"
    if rc == 3:
        stop = True
        note(event="abort", why="preset mismatch", arm=name)
    elif os.path.exists(p):
        r = json.load(open(p))
        with L:
            bad = 0
        note(event="ok", arm=name, profile=r["profile"], wall=r["wall_s"], gen=r["gen"], reason=r["reason"], score=r["score"], peak=r["prompt_peak"], drops=r["drops"], rate=r["rate"], vram=r["peak_vram"], turns=r["turns"], clean=r["detail"].get("clean"))
    else:
        with L:
            bad += 1
            many = bad >= 4
        note(event="quarantine", arm=name, cap=cap, rc=rc)
        if many:
            stop = True
            note(event="abort", why="4 failures in a row")


threads = []
for arm in PLANS[sys.argv[1]]:
    task, size, v, cap, tag, prof = arm
    name = f"{task}.{size}.{v}.P0.{tag}"
    if os.path.exists(f"{RUN}/arms/{name}/result.json") or os.path.isdir(f"{RUN}/quarantine/{name}"):
        continue
    while len([t for t in threads if t.is_alive()]) >= CONC and not stop:
        time.sleep(1)
    if stop:
        break
    if cap > LIMIT - (time.time() - T0):
        note(event="budget-skip", arm=name)
        continue
    if not alive():
        note(event="abort", why="server down", arm=name)
        break
    t = threading.Thread(target=one, args=(arm,))
    t.start()
    threads.append(t)
    time.sleep(3)
for t in threads:
    t.join()
note(event="end", plan=sys.argv[1])
