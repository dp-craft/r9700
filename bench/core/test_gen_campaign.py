#!/usr/bin/env python3
"""Unit + stub end-to-end tests for gen_campaign.py (vllm `env`, `kind: "agentic"`).

Run:  python3 bench/core/test_gen_campaign.py -v

No GPU, docker, network or real `claude`: the generated agentic run.sh is executed against stub
tools (SERVE_VLLM, SERVE_LLAMASWAP, GPU_EXCLUSIVE, VRAM_SAMPLER, DOCKER, CURL, CLAUDE_BIN), in a temp
git repo, with a temp HOME / RUN_DIR / worktree root. Nothing is written outside temp dirs.
"""
import contextlib
import copy
import io
import glob
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import warnings

warnings.simplefilter("ignore", ResourceWarning)   # tests slurp small files with open().read()
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_campaign as gc  # noqa: E402

PROFILE = "sly-redhat/redhat-mxfp4-dflash"          # a real profile (emit checks it exists)
SERVED = "qwen38-27b-redhat-mxfp4-dflash"


def exits(testcase, fn, *a, **kw):
    """Assert fn exits via sys.exit with a message; return the message."""
    with testcase.assertRaises(SystemExit) as cm:
        fn(*a, **kw)
    msg = cm.exception.code
    testcase.assertIsInstance(msg, str, "must sys.exit with a message, not a bare code")
    return msg


# ======================================================================================
# Part A: env for vllm throughput specs
# ======================================================================================
def vllm_spec(**over):
    s = {"slug": "t", "model": "/m/x", "engine": "vllm", "profile": PROFILE, "served_model": SERVED,
         "port": 8000, "date": "2026-01-01",
         "servers": [
             {"name": "a", "ctx": 1000, "np": 1, "kv": "fp8", "mtp": 0,
              "probes": [{"slug": "pa", "prompts": ["codereview-100.txt"]}]},
             {"name": "b", "ctx": 2000, "np": 1, "kv": "fp8", "mtp": 0,
              "probes": [{"slug": "pb", "prompts": ["codereview-100.txt"]}]}]}
    s.update(over)
    return s


class EnvValidators(unittest.TestCase):
    def test_valid_env_roundtrips(self):
        env = {"CACTUS_DELTA": "0", "A_1": "x.y:z/w@v,u+t-s", "EMPTY": ""}
        self.assertEqual(gc.validate_env(env, "env"), env)

    def test_bad_key(self):
        for k in ("cactus", "1ABC", "A-B", "A B", "", "A=B"):
            msg = exits(self, gc.validate_env, {k: "1"}, "env")
            self.assertIn("env", msg)
            self.assertIn("key", msg)

    def test_bad_value(self):
        for v in ("a b", "a;b", "$(x)", "a'b", "a\nb", "a&b", "a|b", "`x`"):
            msg = exits(self, gc.validate_env, {"K": v}, "env")
            self.assertIn("value", msg)

    def test_non_string_value_rejected(self):
        exits(self, gc.validate_env, {"K": 0}, "env")      # JSON number: be explicit, quote it

    def test_not_a_dict(self):
        exits(self, gc.validate_env, ["A=1"], "env")

    def test_reserved(self):
        for k in ("PROFILE", "IMAGE", "MAXLEN", "MAXSEQS", "KV_DTYPE", "PORT"):
            msg = exits(self, gc.validate_env, {k: "1"}, "env")
            self.assertIn(k, msg)
            self.assertIn("reserved", msg)

    def test_merge_server_wins(self):
        m = gc.merge_env({"A": "1", "B": "2"}, {"B": "3", "C": "4"})
        self.assertEqual(m, {"A": "1", "B": "3", "C": "4"})
        self.assertEqual(list(m), ["A", "B", "C"])
        self.assertEqual(gc.merge_env(None, None), {})

    def test_image_validator(self):
        self.assertEqual(gc.validate_image("ghcr.io/a/b:1.9.1-rocm@sha256:ab", "image"),
                         "ghcr.io/a/b:1.9.1-rocm@sha256:ab")
        exits(self, gc.validate_image, "a b", "image")
        exits(self, gc.validate_image, "a;b", "image")


class ThroughputEnvEmit(unittest.TestCase):
    def lines(self, spec, needle):
        return [l for l in gc.emit_runsh(spec).splitlines() if needle in l]

    def test_no_env_is_unchanged_shape(self):
        sh = gc.emit_runsh(vllm_spec())
        self.assertNotIn("CACTUS", sh)
        self.assertNotIn("    'a')", sh)             # no per-server branches without env
        self.assertNotIn("env[", sh)
        # the pre-existing single-path start/print lines are intact
        self.assertIn('PROFILE=\'%s\' IMAGE="$IMAGE" MAXLEN="$ctx" MAXSEQS="$np" KV_DTYPE="$kv" PORT=8000' % PROFILE, sh)

    def test_top_env_on_print_and_start(self):
        sh = gc.emit_runsh(vllm_spec(env={"CACTUS_DELTA": "0"}))
        pr = [l for l in sh.splitlines() if 'serve_vllm.sh" print' in l]
        st = [l for l in sh.splitlines() if 'serve_vllm.sh" start' in l or ('CACTUS_DELTA=0' in l and "if " in l)]
        self.assertTrue(pr and all("CACTUS_DELTA=0 " in l for l in pr), pr)
        self.assertTrue(st and all("CACTUS_DELTA=0 " in l for l in st), st)
        # prefixes sit next to PROFILE / IMAGE / MAXLEN, before the command
        for l in pr:
            self.assertLess(l.index("PROFILE="), l.index("serve_vllm.sh"))
            self.assertLess(l.index("CACTUS_DELTA=0"), l.index("serve_vllm.sh"))

    def test_server_env_overrides_top_and_merges(self):
        spec = vllm_spec(env={"CACTUS_DELTA": "0", "TOP_ONLY": "t"})
        spec["servers"][0]["env"] = {"CACTUS_DELTA": "0.25", "SRV_ONLY": "s"}
        sh = gc.emit_runsh(spec)
        a_lines = [l for l in sh.splitlines() if "CACTUS_DELTA=0.25" in l and "serve_vllm" in l]
        self.assertEqual(len(a_lines), 2)            # print + start
        for l in a_lines:
            self.assertIn("TOP_ONLY=t", l)
            self.assertIn("SRV_ONLY=s", l)
            self.assertNotIn("CACTUS_DELTA=0 ", l)
        b_lines = [l for l in sh.splitlines() if "CACTUS_DELTA=0 " in l and "serve_vllm" in l]
        self.assertEqual(len(b_lines), 2)
        for l in b_lines:
            self.assertIn("TOP_ONLY=t", l)
            self.assertNotIn("SRV_ONLY", l)

    def test_meta_records_env(self):
        spec = vllm_spec(env={"CACTUS_DELTA": "0"})
        spec["servers"][1]["env"] = {"X": "1"}
        sh = gc.emit_runsh(spec)
        meta = [l for l in sh.splitlines() if "meta.txt" in l and "env" in l]
        self.assertTrue(any("CACTUS_DELTA=0" in l for l in meta), meta)
        self.assertTrue(any("CACTUS_DELTA=0 X=1" in l for l in meta), meta)

    def test_readme_fixed_line_records_env(self):
        spec = vllm_spec(env={"CACTUS_DELTA": "0"})
        spec["servers"][1]["env"] = {"X": "1"}
        rd = gc.emit_readme(spec)
        self.assertIn("CACTUS_DELTA=0", rd)
        self.assertIn("X=1", rd)

    def test_readme_no_env_unchanged(self):
        self.assertNotIn("env", gc.emit_readme(vllm_spec()).split("## Fixtures")[0].lower().replace("environment", ""))

    def test_generated_bash_syntax(self):
        spec = vllm_spec(env={"CACTUS_DELTA": "0"})
        spec["servers"][0]["env"] = {"Y": "2"}
        bash_n(self, gc.emit_runsh(spec))


class EnvSpecValidation(unittest.TestCase):
    def v(self, spec):
        return gc.validate_spec(spec)

    def test_ok(self):
        self.assertEqual(self.v(vllm_spec(env={"CACTUS_DELTA": "0"})), "README.md")

    def test_top_bad_key_value_reserved(self):
        exits(self, self.v, vllm_spec(env={"bad": "1"}))
        exits(self, self.v, vllm_spec(env={"K": "a b"}))
        exits(self, self.v, vllm_spec(env={"MAXLEN": "1"}))

    def test_server_env_validated(self):
        s = vllm_spec()
        s["servers"][1]["env"] = {"PORT": "9"}
        exits(self, self.v, s)
        s["servers"][1]["env"] = {"K": "$x"}
        exits(self, self.v, s)

    def test_llamacpp_rejects_env_like_image(self):
        base = {"slug": "t", "model": "/m/x.gguf", "backend": "vulkan",
                "servers": [{"name": "a", "ctx": 1, "np": 1, "kv": "f16", "mtp": 0,
                             "probes": [{"slug": "p", "prompts": ["x.txt"]}]}]}
        s = copy.deepcopy(base); s["image"] = "a/b"
        self.assertIn("vllm-only", exits(self, self.v, s))
        s = copy.deepcopy(base); s["env"] = {"A": "1"}
        self.assertIn("vllm-only", exits(self, self.v, s))
        s = copy.deepcopy(base); s["servers"][0]["env"] = {"A": "1"}
        self.assertIn("vllm-only", exits(self, self.v, s))

    def test_image_still_validated(self):
        exits(self, self.v, vllm_spec(image="bad image"))


# ======================================================================================
# helpers shared by Part B
# ======================================================================================
def bash_n(testcase, script):
    with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as fh:
        fh.write(script)
    try:
        r = subprocess.run(["bash", "-n", fh.name], capture_output=True, text=True)
        testcase.assertEqual(r.returncode, 0, r.stderr)
    finally:
        os.unlink(fh.name)


def sigint_default():
    """Some harnesses start python with SIGINT ignored; children inherit that. Restore the default."""
    signal.signal(signal.SIGINT, signal.SIG_DFL)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def write(path, text, mode=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    if mode:
        os.chmod(path, mode)
    return path


def git(repo, *args, env=None):
    e = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t",
             GIT_COMMITTER_EMAIL="t@t", GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null")
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, env=e)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


STUB_SERVE = r'''#!/usr/bin/env bash
D="$STUB_DIR"
case "$1" in
  print)
    echo "# resolved config (PROFILE=$PROFILE)"
    echo "#   IMAGE=${IMAGE:-profile-default-image}"
    echo "#   SERVED_NAME=${SERVED_NAME:-unset}  MAXLEN=$MAXLEN  MAXSEQS=$MAXSEQS  KV_DTYPE=$KV_DTYPE"
    env | sort | grep -E '^(PROFILE|IMAGE|SERVED_NAME|MAXLEN|MAXSEQS|KV_DTYPE|GPU_UTIL|WATCHDOG_MIB|PORT|FREE_MIB_FLOOR|CACTUS_DELTA|SECOND)=' | sed 's/^/env: /'
    ;;
  start)
    n=$(( $(cat "$D/start_count" 2>/dev/null || echo 0) + 1 )); echo $n > "$D/start_count"
    echo "start #$n PORT=$PORT PROFILE=$PROFILE CACTUS_DELTA=${CACTUS_DELTA:-} SERVED_NAME=${SERVED_NAME:-}" >> "$D/serve.log"
    for f in ${STUB_START_FAIL_ON:-}; do [ "$f" = "$n" ] && { echo "boot failed (stub)" >&2; exit 1; }; done
    echo "${SERVED_NAME:-}" > "$D/served.txt"
    ;;
  stop) echo "stop PORT=$PORT" >> "$D/serve.log"; echo stopped;;
esac
exit 0
'''
# fake serve_llamaswap.sh: records "<cmd> MODEL= PORT= LOG_OUT=" per call; start writes the upstream log into
# LOG_OUT (as the real log follower does); stop prints unloaded=yes, or unloaded=no + rc 1 with STUB_UNLOAD_FAIL.
STUB_LLAMASWAP = r'''#!/usr/bin/env bash
D="$STUB_DIR"
echo "$1 MODEL=${MODEL:-} PORT=${PORT:-} LOG_OUT=${LOG_OUT:-}" >> "$D/llamaswap.log"
case "$1" in
  print) echo "# resolved config -- print touches no GPU"; echo "MODEL=$MODEL"; echo "PORT=$PORT";;
  start)
    n=$(( $(cat "$D/start_count" 2>/dev/null || echo 0) + 1 )); echo $n > "$D/start_count"
    for f in ${STUB_START_FAIL_ON:-}; do [ "$f" = "$n" ] && { echo "FAIL: preload (stub)" >&2; exit 1; }; done
    echo "$MODEL" > "$D/served.txt"
    [ -n "${LOG_OUT:-}" ] && echo "upstream log of $MODEL" > "$LOG_OUT"
    echo "up after 1s -- $MODEL state=ready";;
  stop)
    if [ -n "${STUB_UNLOAD_FAIL:-}" ]; then echo "still resident: {}" >&2; echo "unloaded=no"; exit 1; fi
    echo "unloaded=yes";;
esac
exit 0
'''
STUB_GPU = r'''#!/usr/bin/env bash
echo "gpu_exclusive floor=$1" >> "$STUB_DIR/gpu.log"
if [ -n "${STUB_GPU_BUSY:-}" ]; then echo "ABORT: need >=$1 MiB free, have 5 MiB"; echo "Holder(s): llama-swap pid 4242"; exit 1; fi
echo "GPU exclusive: ok"
'''
STUB_SAMPLER = r'''#!/usr/bin/env python3
import sys, time
out = sys.argv[sys.argv.index("--out") + 1]
open(out, "w").write("ts,vram_used\n0,1\n")
while True:
    time.sleep(0.2)
'''
STUB_DOCKER = r'''#!/usr/bin/env bash
echo "docker $*" >> "$STUB_DIR/docker.log"
[ "$1" = logs ] && echo "container log of $2"
exit 0
'''
STUB_CURL = r'''#!/usr/bin/env bash
if [ -n "${STUB_WRONG_NAME:-}" ]; then name=some-other-model; else name=$(cat "$STUB_DIR/served.txt" 2>/dev/null); fi
echo "{\"object\":\"list\",\"data\":[{\"id\":\"$name\",\"object\":\"model\"}]}"
'''
# fake claude: behaviour keyed on the worktree directory name (arm name): *fast* finishes on call 1,
# *slow* on call 2, *never* sleeps until timed out, *err* exits 3.
STUB_CLAUDE = r'''#!/usr/bin/env bash
D="$STUB_DIR"; me=$(basename "$PWD")
a="$*"; echo "$(date +%s) cwd=$PWD args: ${a//$'\n'/ }" >> "$D/claude.log"
n=$(( $(cat "$D/cnt-$me" 2>/dev/null || echo 0) + 1 )); echo $n > "$D/cnt-$me"
case "$me" in *fast*) need=1;; *slow*) need=2;; *err*) need=0;; *) need=999;; esac
mkdir -p "$STUB_TMP/sub"; echo scratch > "$STUB_TMP/sub/f.txt"
mkdir -p out; echo "report $me call $n" > out/report.md
pd="$HOME/.claude/projects/$(pwd -P | sed 's#[^A-Za-z0-9]#-#g')"; mkdir -p "$pd"; echo "{}" >> "$pd/s.jsonl"
echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-$me\"}"
echo "{\"type\":\"assistant\",\"message\":\"call $n\"}"
case "$me" in *never*) exec sleep 60;; *err*) echo boom >&2; exit 3;; esac
if [ "$n" -ge "$need" ]; then echo "W2-08 | done | call $n" >> progress.md; fi
echo "{\"type\":\"result\",\"session_id\":\"sess-$me\",\"is_error\":false}"
'''


class AgenticBase(unittest.TestCase):
    """Builds a sandbox: temp git repo, temp HOME, stubs, a baseline agentic spec."""

    def setUp(self):
        self.T = os.path.realpath(tempfile.mkdtemp(prefix="gc-test-"))
        self.addCleanup(shutil.rmtree, self.T, True)
        T = self.T
        self.repo = os.path.join(T, "repo")
        os.makedirs(self.repo)
        git(self.repo, "init", "-q")
        write(os.path.join(self.repo, "progress.md"), "# progress\n")
        write(os.path.join(self.repo, "RUNBOOK.md"), "tracked runbook\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base = git(self.repo, "rev-parse", "HEAD")
        self.home = os.path.join(T, "home")
        os.makedirs(self.home)
        self.port = free_port()
        self.settings = write(os.path.join(T, "settings.json"), json.dumps({
            "env": {"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{self.port}", "ANTHROPIC_MODEL": SERVED,
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL": SERVED, "ANTHROPIC_DEFAULT_SONNET_MODEL": SERVED,
                    "ANTHROPIC_DEFAULT_OPUS_MODEL": SERVED},
            "model": "haiku"}))
        self.runbook = write(os.path.join(T, "inputs", "RUNBOOK.orig.md"), "runbook @@WT@@ end\n")
        self.nm = os.path.join(T, "node_modules_src")
        os.makedirs(self.nm)
        self.stubs = os.path.join(T, "stubs")
        self.stubdir = os.path.join(T, "stubstate")
        os.makedirs(self.stubdir)
        self.stub_tmp = os.path.join(T, "tmp-refine")
        for name, body in (("serve_vllm.sh", STUB_SERVE), ("serve_llamaswap.sh", STUB_LLAMASWAP),
                           ("gpu_exclusive.sh", STUB_GPU),
                           ("vram_sampler.py", STUB_SAMPLER), ("docker", STUB_DOCKER),
                           ("curl", STUB_CURL), ("claude", STUB_CLAUDE)):
            write(os.path.join(self.stubs, name), body, 0o755)
        self.campaign_dir = os.path.join(T, "run")              # the CAMPAIGN_DIR (two roots inside it)
        self.run_dir = os.path.join(self.campaign_dir, "tmp")   # raw root ($CAMPAIGN_DIR/tmp)
        self.res_dir = os.path.join(self.campaign_dir, "results")   # results root ($CAMPAIGN_DIR/results)
        self.wt_root = os.path.join(T, "wt")
        self.spec = self.make_spec()

    def make_spec(self, **over):
        s = {"kind": "agentic", "slug": "agtest", "date": "2026-01-01", "engine": "vllm", "port": self.port,
             "repo": self.repo, "base": self.base,
             "worktree": self.wt_root + "/{arm}-r{rep}",
             "served_model": SERVED,
             "server": {"maxlen": 4096, "maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93,
                        "watchdog_mib": 32, "free_mib_floor": 1000},
             "env": {"SECOND": "top"},
             "claude": {"settings": self.settings,
                        "args": ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"]},
             "prompt": "Do the thing 'quoted' & \"dq\" $HOME `x`\nline2",
             "resume_prompt": "Continue please",
             "install": [{"src": self.runbook, "dst": "RUNBOOK.md"}],
             "rewrite": [{"glob": "RUNBOOK.md", "from": "@@WT@@", "to": "{wt}|a&b/'q\""}],
             "symlinks": [{"src": self.nm, "dst": "node_modules"}],
             "done_when": {"file": "progress.md", "regex": r"^W2-08 \|"},
             "collect": ["out/*.md", "progress.md"], "tmp_dirs": [self.stub_tmp],
             "cap_s": 600, "max_resumes": 3, "reps": 1,
             "server_info": ["echo info-{arm}-{port}-{server_port}"],
             "post": ["echo post-{arm_dir} > {arm_dir}/post-ran.txt"],
             "arms": [{"name": "fast", "profile": PROFILE, "env": {"CACTUS_DELTA": "0"}},
                      {"name": "slow", "profile": PROFILE, "image": "ghcr.io/x/y:1.9.1-rocm10.1",
                       "env": {"CACTUS_DELTA": "0.5"}, "server": {"maxlen": 8192}}]}
        s.update(over)
        return s

    def make_ls_spec(self, **over):
        """engine llama-swap: no server block, no env, arms carry only a name (+ optional server floor)."""
        s = self.make_spec(engine="llama-swap",
                           arms=[{"name": "fast"}, {"name": "slow", "server": {"free_mib_floor": 2000}}])
        del s["server"], s["env"]
        s.update(over)
        return s

    def make_reuse_spec(self, **over):
        """reuse_server=true: no server block (ignored), arms carry only a name (env inert)."""
        s = self.make_spec(reuse_server=True, arms=[{"name": "fast"}])
        del s["server"]
        s.update(over)
        return s

    # ---- run helpers
    def script(self, spec=None):
        spec = spec or self.spec
        gc.validate_spec(spec)
        path = os.path.join(self.T, "run.sh")
        write(path, gc.emit_runsh(spec), 0o755)
        return path

    def env(self, **extra):
        # RUN_DIR is no longer a knob (the driver refuses it); the campaign dir is. ROOT is the
        # git-toplevel default in the emitted run.sh, but run.sh lives in T (not a git repo), so set it.
        e = dict(os.environ, HOME=self.home, ROOT=self.T, CAMPAIGN_DIR=self.campaign_dir, STUB_DIR=self.stubdir,
                 STUB_TMP=self.stub_tmp, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
                 SERVE_VLLM=self.stubs + "/serve_vllm.sh", SERVE_LLAMASWAP=self.stubs + "/serve_llamaswap.sh",
                 GPU_EXCLUSIVE=self.stubs + "/gpu_exclusive.sh",
                 VRAM_SAMPLER=self.stubs + "/vram_sampler.py", DOCKER=self.stubs + "/docker",
                 CURL=self.stubs + "/curl", CLAUDE_BIN=self.stubs + "/claude",
                 GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        e.update(extra)
        return e

    def run_script(self, spec=None, timeout=120, **extra):
        p = subprocess.run(["bash", self.script(spec)], env=self.env(**extra), capture_output=True,
                           text=True, timeout=timeout, preexec_fn=sigint_default)
        self.out = p.stdout + p.stderr
        return p

    def summary(self):
        path = os.path.join(self.res_dir, "summary.tsv")
        if not os.path.exists(path):
            return []
        rows = [l.rstrip("\n").split("\t") for l in open(path)]
        hdr = rows[0]
        return [dict(zip(hdr, r)) for r in rows[1:]]

    def status_of(self, arm, rep=1):
        rows = [r for r in self.summary() if r["arm"] == arm and r["rep"] == str(rep)]
        return rows[-1]["status"] if rows else None

    def arm_dir(self, arm, rep=1):
        return os.path.join(self.run_dir, f"rep{rep}", arm)

    def rd(self, *parts):
        """Read a file the driver writes, from the raw root (tmp/) or the results root (results/)."""
        for root in (self.run_dir, self.res_dir):
            p = os.path.join(root, *parts)
            if os.path.exists(p):
                return open(p).read()
        raise AssertionError(f"no {'/'.join(parts)} under raw (tmp/) or results (results/)")

    def lines(self, name):
        p = os.path.join(self.stubdir, name)
        return open(p).read().splitlines() if os.path.exists(p) else []

    # ---- two-root layout (brief A): no absolute repo path; raw=tmp/, results=results/ ----
    def test_no_absolute_repo_path_in_run_sh(self):
        sh = gc.emit_runsh(self.spec)
        self.assertNotIn(gc.REPO, sh)                        # tool paths are $ROOT-relative, not baked in

    def test_raw_and_results_roots(self):
        sh = gc.emit_runsh(self.spec)
        self.assertIn('RAW="$CAMPAIGN_DIR/tmp"', sh)
        self.assertIn('RES="$CAMPAIGN_DIR/results"', sh)
        self.assertIn('RUN_DIR="$RAW"', sh)                  # markers/lock/log/arm dirs stay raw
        self.assertIn("$RES/summary.tsv", sh)                # results rows are committed
        self.assertIn("$RES/spec.resolved.json", sh)
        self.assertIn("$RUN_DIR/done/", sh)                 # done markers under tmp/
        self.assertIn('$CAMPAIGN_DIR (results: $RES, raw: $RUN_DIR)', sh)


# ======================================================================================
# Part B: unit tests (validation, syntax, README)
# ======================================================================================
class AgenticValidation(AgenticBase):
    def bad(self, mutate, needle=None):
        s = copy.deepcopy(self.spec)
        mutate(s)
        msg = exits(self, gc.validate_spec, s)
        if needle:
            self.assertIn(needle, msg)
        return msg

    def test_valid_spec(self):
        self.assertEqual(gc.validate_spec(copy.deepcopy(self.spec)), "README.md")

    def test_required_fields(self):
        for k in ("slug", "engine", "port", "repo", "base", "worktree", "served_model", "claude", "prompt",
                  "resume_prompt", "done_when", "arms", "server"):
            self.bad(lambda s, k=k: s.pop(k), k)

    def test_engine_must_be_vllm(self):
        self.bad(lambda s: s.update(engine="llamacpp"), "vllm")

    def test_arm_names(self):
        for n in ("Bad", "a b", "-x", "a/b", "", "a;b"):
            self.bad(lambda s, n=n: s["arms"][0].update(name=n), "arm name")

    def test_arm_names_unique(self):
        self.bad(lambda s: s["arms"][1].update(name="fast"), "unique")

    def test_arms_nonempty(self):
        self.bad(lambda s: s.update(arms=[]), "arms")

    def test_arm_profile_must_exist(self):
        self.bad(lambda s: s["arms"][0].update(profile="nope/none"), "profile")

    def test_arm_image_and_env_validated(self):
        self.bad(lambda s: s["arms"][0].update(image="a b"), "image")
        self.bad(lambda s: s["arms"][0].update(env={"bad": "1"}), "key")
        self.bad(lambda s: s["arms"][0].update(env={"K": "a b"}), "value")
        self.bad(lambda s: s["arms"][0].update(env={"PORT": "1"}), "reserved")
        self.bad(lambda s: s.update(env={"IMAGE": "x"}), "reserved")
        self.bad(lambda s: s["arms"][0].update(env={"SERVED_NAME": "x"}), "reserved")   # agentic exports it

    def test_install_src_exists(self):
        self.bad(lambda s: s["install"][0].update(src="/nonexistent/zzz"), "install")

    def test_settings_checks(self):
        self.bad(lambda s: s["claude"].update(settings="/nonexistent.json"), "settings")
        bad = write(os.path.join(self.T, "notjson.json"), "{nope")
        self.bad(lambda s: s["claude"].update(settings=bad), "JSON")

    def test_settings_port_mismatch(self):
        p = write(os.path.join(self.T, "s2.json"), json.dumps({"env": {
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{self.port + 1}", "ANTHROPIC_MODEL": SERVED}}))
        self.bad(lambda s: s["claude"].update(settings=p), "port")

    def test_settings_model_mismatch(self):
        for key in ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"):
            d = json.load(open(self.settings))
            d["env"][key] = "other-model"
            p = write(os.path.join(self.T, f"s-{key}.json"), json.dumps(d))
            msg = self.bad(lambda s, p=p: s["claude"].update(settings=p), key)
            self.assertIn("other-model", msg)

    def test_settings_toplevel_model(self):
        d = json.load(open(self.settings))
        d["model"] = "wrong-model"
        p = write(os.path.join(self.T, "s-top.json"), json.dumps(d))
        self.bad(lambda s: s["claude"].update(settings=p), "model")
        d["model"] = SERVED                                   # exact name is fine
        p = write(os.path.join(self.T, "s-top2.json"), json.dumps(d))
        gc.validate_spec(self._with(settings=p))

    def test_settings_alias_model_ok_only_if_mapped(self):
        # "model": "haiku" is a Claude Code alias: valid iff ANTHROPIC_DEFAULT_HAIKU_MODEL == served_model
        d = json.load(open(self.settings))
        del d["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"]
        p = write(os.path.join(self.T, "s-alias.json"), json.dumps(d))
        self.bad(lambda s: s["claude"].update(settings=p), "haiku")

    def _with(self, settings):
        s = copy.deepcopy(self.spec)
        s["claude"]["settings"] = settings
        return s

    def test_base_resolves(self):
        self.bad(lambda s: s.update(base="deadbeef0000"), "base")
        self.bad(lambda s: s.update(repo=os.path.join(self.T, "nonrepo")), "repo")

    def test_worktree_placeholders(self):
        self.bad(lambda s: s.update(worktree=self.T + "/wt/{arm}"), "{rep}")
        self.bad(lambda s: s.update(worktree=self.T + "/wt/{rep}"), "{arm}")
        self.bad(lambda s: s.update(worktree="relative/{arm}/{rep}"), "absolute")

    def test_done_when_regex_compiles(self):
        self.bad(lambda s: s["done_when"].update(regex="(["), "regex")
        self.bad(lambda s: s["done_when"].pop("file"), "file")

    def test_server_fields(self):
        self.bad(lambda s: s["server"].pop("maxlen"), "maxlen")
        self.bad(lambda s: s["server"].update(bogus=1), "bogus")
        self.bad(lambda s: s["server"].update(gpu_util=1.5), "gpu_util")
        self.bad(lambda s: s["arms"][0].update(server={"maxlen": "big"}), "maxlen")

    def test_rewrite_and_paths(self):
        self.bad(lambda s: s["rewrite"][0].update(glob="/abs/x"), "relative")
        self.bad(lambda s: s["install"][0].update(dst="../x"), "relative")
        self.bad(lambda s: s["rewrite"][0].update({"from": ""}), "from")
        self.bad(lambda s: s["tmp_dirs"].append("relative"), "absolute")
        self.bad(lambda s: s["tmp_dirs"].append("/"), "tmp_dirs")

    def test_numbers(self):
        self.bad(lambda s: s.update(cap_s=0), "cap_s")
        self.bad(lambda s: s.update(max_resumes=-1), "max_resumes")
        self.bad(lambda s: s.update(reps=0), "reps")

    def test_symlink_src_must_exist(self):
        self.bad(lambda s: s["symlinks"][0].update(src="/nonexistent/nm"), "symlink")


class AgenticScript(AgenticBase):
    def test_bash_n(self):
        bash_n(self, gc.emit_runsh(self.spec))

    def test_bash_n_with_capture_proxy(self):
        s = self.make_spec(capture_requests=True, remove_worktree=True)
        gc.validate_spec(s)
        bash_n(self, gc.emit_runsh(s))

    def test_shellcheck_if_installed(self):
        sc = shutil.which("shellcheck")
        if not sc:
            self.skipTest("shellcheck not installed")
        r = subprocess.run([sc, "-s", "bash", "-S", "warning", "-"], input=gc.emit_runsh(self.spec),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_print_does_not_write(self):
        sp = write(os.path.join(self.T, "spec.json"), json.dumps(self.spec))
        r = subprocess.run([sys.executable, os.path.join(HERE, "gen_campaign.py"), "emit", "--spec", sp, "--print"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("#!/usr/bin/env bash"))

    def test_example_is_valid_and_emits(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "gen_campaign.py"), "example", "--agentic"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        ex = json.loads(r.stdout)
        self.assertEqual(ex["kind"], "agentic")
        gc.validate_spec(ex)                    # the example must itself pass emit-time validation
        bash_n(self, gc.emit_runsh(ex))

    def test_emit_writes_run_sh_and_readme_only_if_absent(self):
        camp = os.path.join(self.T, "campaigns")
        old = gc.REPO
        gc.REPO = self.T
        self.addCleanup(setattr, gc, "REPO", old)
        sp = write(os.path.join(self.T, "spec.json"), json.dumps(self.spec))

        class A: pass
        a = A(); a.spec = sp; a.force = False; a.print = False
        with contextlib.redirect_stdout(io.StringIO()):
            gc.cmd_emit(a)
        d = os.path.join(camp, "agentic", "2026-01-01-agtest")   # kind agentic -> type dir; old date form kept
        self.assertTrue(os.access(os.path.join(d, "run.sh"), os.X_OK))
        self.assertTrue(os.path.exists(os.path.join(d, "README.md")))
        write(os.path.join(d, "README.md"), "HAND WRITTEN")
        with contextlib.redirect_stdout(io.StringIO()):
            gc.cmd_emit(a)
        self.assertEqual(open(os.path.join(d, "README.md")).read(), "HAND WRITTEN")

    def test_readme_contents(self):
        rd = gc.emit_readme(self.spec)
        for col in ("arm", "profile", "image", "env", "served model", "maxlen", "maxseqs", "kv", "gpu_util"):
            self.assertIn(col, rd.lower())
        self.assertIn("profile default", rd)                       # fast has no image
        self.assertIn("ghcr.io/x/y:1.9.1-rocm10.1", rd)            # slow does
        self.assertIn("CACTUS_DELTA=0.5", rd)
        self.assertIn("SECOND=top", rd)                            # merged top-level env
        self.assertIn(SERVED, rd)
        self.assertIn("8192", rd)                                  # slow's maxlen override
        import hashlib
        self.assertIn(hashlib.sha256(open(self.runbook, "rb").read()).hexdigest(), rd)
        self.assertIn(self.spec["prompt"], rd)                     # verbatim
        self.assertIn(self.spec["resume_prompt"], rd)
        self.assertIn(r"^W2-08 \|", rd)
        for ph in ("{wt}", "{arm}", "{rep}", "{arm_dir}", "{port}"):
            self.assertIn(ph, rd)
        self.assertIn("600", rd)
        self.assertIn("ONLY", rd)
        # two-root layout: campaign path under the type dir; write-up in docs/findings/ with meta campaign:
        self.assertIn("bash campaigns/agentic/2026-01-01-agtest/run.sh", rd)
        self.assertIn("CAMPAIGN_DIR=/path bash campaigns/agentic/2026-01-01-agtest/run.sh", rd)
        self.assertIn("campaign: campaigns/agentic/2026-01-01-agtest", rd)
        self.assertNotIn("analysis.md", rd)
        self.assertNotIn("bench/runs", rd)

    def test_prompts_with_backticks_survive_in_readme(self):
        s = copy.deepcopy(self.spec)
        s["prompt"] = "run ```bash\nls\n``` now"
        rd = gc.emit_readme(s)
        self.assertIn("run ```bash\nls\n``` now", rd)


# ======================================================================================
# Part B: end-to-end with stubs
# ======================================================================================
class AgenticE2E(AgenticBase):
    def test_1_two_arms_fast_and_slow(self):
        pre = os.path.join(self.stub_tmp)
        write(os.path.join(pre, "old.txt"), "preexisting")          # must be moved to stale/
        p = self.run_script()
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "done", self.out)
        self.assertEqual(self.status_of("slow"), "done", self.out)
        rows = {r["arm"]: r for r in self.summary()}
        self.assertEqual(rows["fast"]["calls"], "1")
        self.assertEqual(rows["fast"]["resumes"], "0")
        self.assertEqual(rows["slow"]["calls"], "2")
        self.assertEqual(rows["slow"]["resumes"], "1")
        self.assertTrue(rows["slow"]["done_line"].startswith("W2-08 |"), rows["slow"])
        self.assertEqual(rows["fast"]["main_unchanged"], "yes")
        self.assertEqual(rows["fast"]["port_free"], "yes")
        self.assertIn("ghcr.io/x/y:1.9.1-rocm10.1", rows["slow"]["image"])
        self.assertEqual(rows["fast"]["image"], "profile-default-image")
        self.assertIn("CACTUS_DELTA=0", rows["fast"]["env"])
        self.assertIn("SECOND=top", rows["fast"]["env"])
        # calls.tsv: idx, start, end, rc
        ct = [l.split("\t") for l in open(os.path.join(self.arm_dir("slow"), "calls.tsv")).read().splitlines()]
        self.assertEqual(ct[0][:4], ["idx", "start", "end", "rc"])
        self.assertEqual([r[0] for r in ct[1:]], ["0", "1"])
        self.assertEqual([r[3] for r in ct[1:]], ["0", "0"])
        self.assertTrue(all(int(r[2]) >= int(r[1]) for r in ct[1:]))
        # arm env reached serve_vllm print (server.txt) and start (serve.log)
        sf = open(os.path.join(self.arm_dir("fast"), "server.txt")).read()
        ss = open(os.path.join(self.arm_dir("slow"), "server.txt")).read()
        self.assertIn("env: CACTUS_DELTA=0\n", sf)
        self.assertIn("env: CACTUS_DELTA=0.5\n", ss)
        self.assertIn("env: SECOND=top", sf)
        for want in (f"SERVED_NAME={SERVED}", "KV_DTYPE=fp8", "MAXSEQS=1", "GPU_UTIL=0.93", "WATCHDOG_MIB=32",
                     f"PORT={self.port}", f"PROFILE={PROFILE}", "FREE_MIB_FLOOR=1000"):
            self.assertIn("env: " + want, sf)
        self.assertIn("MAXLEN=4096", sf)
        self.assertIn("MAXLEN=8192", ss)                            # per-arm server override
        self.assertIn("IMAGE=ghcr.io/x/y:1.9.1-rocm10.1", ss)
        slog = self.lines("serve.log")
        self.assertTrue(any("CACTUS_DELTA=0.5" in l and l.startswith("start #2") for l in slog), slog)
        # gpu_exclusive called with the floor
        self.assertEqual(self.lines("gpu.log"), ["gpu_exclusive floor=1000"] * 2)
        # claude invocation shape
        cl = self.lines("claude.log")
        self.assertEqual(len(cl), 3)
        self.assertIn("--settings " + self.settings, cl[0])
        self.assertIn("--output-format stream-json", cl[0])
        self.assertIn("--resume sess-slow", cl[2])
        self.assertIn("Continue please", cl[2])
        # session transcripts
        self.assertTrue(os.path.getsize(os.path.join(self.arm_dir("slow"), "session-1.jsonl")) > 0)
        self.assertTrue(os.path.exists(os.path.join(self.arm_dir("slow"), "session-0.err")))
        # worktree content: install + rewrite (python, special chars) + symlink
        wt = f"{self.wt_root}/slow-r1"
        self.assertEqual(open(wt + "/RUNBOOK.md").read(), f"runbook {wt}|a&b/'q\" end\n")
        self.assertTrue(os.path.islink(wt + "/node_modules"))
        self.assertEqual(os.path.realpath(wt + "/node_modules"), os.path.realpath(self.nm))
        shas = open(os.path.join(self.arm_dir("fast"), "installs.sha256")).read()
        import hashlib
        self.assertIn(hashlib.sha256(open(self.runbook, "rb").read()).hexdigest(), shas)
        # collected
        ad = self.arm_dir("fast")
        self.assertTrue(os.path.exists(ad + "/outputs/out/report.md"))
        self.assertTrue(os.path.exists(ad + "/outputs/progress.md"))
        self.assertIn("RUNBOOK.md", open(ad + "/wt-status.txt").read())
        self.assertIn("progress.md", open(ad + "/wt.diff").read())
        self.assertTrue(os.path.exists(ad + "/wt-untracked.txt"))
        self.assertTrue(os.path.exists(ad + "/claude-project/s.jsonl"))
        self.assertTrue(os.path.exists(ad + "/gpu_samples.csv"))
        self.assertTrue(os.path.exists(ad + "/server-container.log"))
        self.assertTrue(os.path.exists(ad + "/server-info.txt"))
        self.assertIn(f"info-fast-{self.port}-{self.port}", open(ad + "/server-info.txt").read())
        self.assertTrue(os.path.exists(ad + "/main-before.txt"))
        self.assertTrue(os.path.exists(ad + "/main-after.txt"))
        self.assertTrue(os.path.exists(ad + "/post-ran.txt"))
        # tmp dirs: the stub-created one is in tmp/, the pre-existing one in stale/
        self.assertTrue(glob.glob(ad + "/tmp/tmp-refine/sub/f.txt"), os.listdir(ad))
        stale = glob.glob(self.run_dir + "/stale/tmp-refine-*/old.txt")
        self.assertEqual(len(stale), 1, os.listdir(self.run_dir))
        self.assertFalse(os.path.exists(self.stub_tmp))
        # markers
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.fast"))
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.slow"))
        self.assertTrue(os.path.exists(self.run_dir + "/started/rep1.fast"))
        # server stopped each time, port free
        self.assertEqual(sum(1 for l in slog if l.startswith("stop")), 2)
        self.assertFalse(os.path.exists(self.res_dir + "/failures.txt"))
        # worktrees kept (remove_worktree false)
        self.assertTrue(os.path.isdir(wt))
        # the main checkout was untouched
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_reps_outer_arms_inner_fresh_server_each(self):
        p = self.run_script(REPS="2")
        self.assertEqual(p.returncode, 0, self.out)
        starts = [l for l in self.lines("serve.log") if l.startswith("start")]
        self.assertEqual(len(starts), 4)                            # a fresh server per (rep, arm)
        order = [("0" if "CACTUS_DELTA=0 " in l else "5") for l in starts]
        self.assertEqual(order, ["0", "5", "0", "5"])               # fast, slow, fast, slow
        self.assertEqual([r["rep"] + r["arm"] for r in self.summary()], ["1fast", "1slow", "2fast", "2slow"])

    def test_2_rerun_skips_everything(self):
        self.run_script()
        n_claude = len(self.lines("claude.log"))
        n_start = len(self.lines("serve.log"))
        rows_before = self.rd("summary.tsv")
        p = self.run_script()
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(len(self.lines("claude.log")), n_claude)
        self.assertEqual(len(self.lines("serve.log")), n_start)
        self.assertEqual(self.rd("summary.tsv"), rows_before)
        self.assertIn("skip (done)", self.out)

    def test_3_started_without_done_is_interrupted(self):
        os.makedirs(self.run_dir + "/started")
        open(self.run_dir + "/started/rep1.fast", "w").write("x")
        keep = write(self.arm_dir("fast") + "/session-0.jsonl", "partial\n")
        p = self.run_script()
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "interrupted")
        self.assertEqual(self.status_of("slow"), "done")            # the run continued
        self.assertIn("interrupted", self.rd("failures.txt"))
        self.assertIn("fast", self.rd("failures.txt"))
        self.assertTrue(os.path.exists(keep))                       # nothing deleted
        self.assertEqual(open(keep).read(), "partial\n")
        self.assertTrue(os.path.exists(self.run_dir + "/started/rep1.fast"))
        self.assertFalse(os.path.exists(self.run_dir + "/done/rep1.fast"))
        self.assertFalse(any("fast" in l for l in self.lines("claude.log")))
        self.assertEqual(len([l for l in self.lines("serve.log") if l.startswith("start")]), 1)
        self.assertIn("re-collect", self.out)
        # a second rerun does not duplicate the failure line
        self.run_script()
        self.assertEqual(self.rd("failures.txt").count("interrupted"), 1)

    def test_4_cap(self):
        s = self.make_spec(arms=[{"name": "never", "profile": PROFILE}], cap_s=2)
        p = self.run_script(s)
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("never"), "cap", self.out)
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.never"))   # a cap is a measured outcome
        ct = open(self.arm_dir("never") + "/calls.tsv").read().splitlines()
        self.assertEqual(len(ct), 2)
        self.assertIn(ct[1].split("\t")[3], ("124", "137"))   # GNU timeout: 124; uutils (-k + --signal): 137

    def test_cap_s_env_override(self):
        s = self.make_spec(arms=[{"name": "never", "profile": PROFILE}], cap_s=600)
        p = self.run_script(s, CAP_S="2")
        self.assertEqual(self.status_of("never"), "cap", self.out)

    def test_max_resumes(self):
        s = self.make_spec(arms=[{"name": "slow", "profile": PROFILE}], max_resumes=0)
        self.run_script(s)
        self.assertEqual(self.status_of("slow"), "max_resumes", self.out)
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.slow"))
        self.assertEqual(len(self.lines("claude.log")), 1)
        # MAX_RESUMES env wins
        shutil.rmtree(self.campaign_dir)   # raw (markers) + results (summary) both live under it
        shutil.rmtree(self.wt_root)
        git(self.repo, "worktree", "prune")
        self.run_script(s, MAX_RESUMES="2")
        self.assertEqual(self.status_of("slow"), "done", self.out)

    def test_claude_error_is_quarantined(self):
        s = self.make_spec(arms=[{"name": "err", "profile": PROFILE}])
        self.run_script(s)
        self.assertEqual(self.status_of("err"), "claude_error", self.out)
        self.assertFalse(os.path.exists(self.run_dir + "/done/rep1.err"))
        self.assertTrue(os.path.exists(self.run_dir + "/started/rep1.err"))
        self.assertIn("claude_error", self.rd("failures.txt"))
        self.assertTrue(os.path.exists(self.arm_dir("err") + "/server-container.log"))   # still torn down + collected

    def test_5_server_fail_next_arm_still_runs(self):
        p = self.run_script(STUB_START_FAIL_ON="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "server_fail")
        self.assertEqual(self.status_of("slow"), "done")
        self.assertIn("server_fail", self.rd("failures.txt"))
        self.assertTrue(os.path.exists(self.arm_dir("fast") + "/server-container.log"))   # docker logs saved
        self.assertTrue(any(l.startswith("stop") for l in self.lines("serve.log")))
        self.assertFalse(os.path.exists(f"{self.wt_root}/fast-r1"))                       # no worktree
        self.assertFalse(os.path.exists(self.run_dir + "/started/rep1.fast"))             # no marker: rerun retries
        self.assertFalse(any("fast" in l for l in self.lines("claude.log")))
        # rerun retries the failed arm (no marker was written)
        self.run_script()
        self.assertEqual(self.status_of("fast"), "done", self.out)

    def test_6_worktree_exists(self):
        os.makedirs(f"{self.wt_root}/fast-r1")
        p = self.run_script()
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "wt_exists")
        self.assertEqual(self.status_of("slow"), "done")
        self.assertEqual(len([l for l in self.lines("serve.log") if l.startswith("start")]), 1)
        self.assertTrue(os.path.isdir(f"{self.wt_root}/fast-r1"))                         # untouched
        self.assertFalse(os.path.exists(self.run_dir + "/started/rep1.fast"))

    def test_7_served_name_mismatch(self):
        p = self.run_script(STUB_WRONG_NAME="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "served_name_mismatch")
        self.assertEqual(self.status_of("slow"), "served_name_mismatch")
        self.assertEqual(self.lines("claude.log"), [])
        self.assertEqual(sum(1 for l in self.lines("serve.log") if l.startswith("stop")), 2)
        self.assertFalse(os.path.exists(f"{self.wt_root}/fast-r1"))
        self.assertFalse(os.path.exists(self.run_dir + "/started/rep1.fast"))

    def test_gpu_busy(self):
        p = self.run_script(STUB_GPU_BUSY="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "gpu_busy")
        self.assertEqual(self.status_of("slow"), "gpu_busy")
        self.assertIn("llama-swap pid 4242", self.rd("failures.txt"))                     # names the holder
        self.assertEqual(self.lines("serve.log"), [])

    def test_only_filter(self):
        self.run_script(ONLY="sl*")
        self.assertIsNone(self.status_of("fast"))
        self.assertEqual(self.status_of("slow"), "done")

    def test_capture_proxy_and_remove_worktree(self):
        proxy = write(os.path.join(self.stubs, "capture_proxy.py"),
                      "import sys,os,time\nopen(os.path.join(os.environ['STUB_DIR'],'proxy.args'),'w').write(' '.join(sys.argv[1:]))\n"
                      "os.makedirs(sys.argv[3],exist_ok=True)\nopen(os.path.join(sys.argv[3],'req-001.json'),'w').write('{}')\n"
                      "time.sleep(60)\n", 0o755)
        s = self.make_spec(capture_requests=True, remove_worktree=True, arms=[self.spec["arms"][0]])
        self.run_script(s, CAPTURE_PROXY=proxy)
        self.assertEqual(self.status_of("fast"), "done", self.out)
        args = open(self.stubdir + "/proxy.args").read().split()
        self.assertEqual(args[0], str(self.port))
        self.assertEqual(args[1], f"http://127.0.0.1:{self.port + 1}")
        self.assertTrue(args[2].endswith("/rep1/fast/requests"))
        self.assertTrue(os.path.exists(self.arm_dir("fast") + "/requests/req-001.json.gz"))
        self.assertFalse(os.path.exists(self.arm_dir("fast") + "/requests/req-001.json"))
        self.assertIn(f"PORT={self.port + 1}", self.lines("serve.log")[0] + " ".join(self.lines("serve.log")))
        self.assertFalse(os.path.exists(f"{self.wt_root}/fast-r1"))                       # removed after collect
        self.assertTrue(os.path.exists(self.arm_dir("fast") + "/outputs/out/report.md"))   # ...but collected first

    def test_sigint_tears_down_and_leaves_started_marker(self):
        s = self.make_spec(arms=[{"name": "never", "profile": PROFILE}], cap_s=600)
        proc = subprocess.Popen(["bash", self.script(s)], env=self.env(), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, start_new_session=True, preexec_fn=sigint_default)
        marker = self.run_dir + "/started/rep1.never"
        t0 = time.time()
        while time.time() - t0 < 30 and not (os.path.exists(marker) and self.lines("claude.log")):
            time.sleep(0.1)
        self.assertTrue(os.path.exists(marker))
        os.killpg(proc.pid, signal.SIGINT)
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            self.fail("run.sh did not exit after SIGINT")
        self.assertTrue(os.path.exists(marker))                                           # left for 'interrupted'
        self.assertFalse(os.path.exists(self.run_dir + "/done/rep1.never"))
        self.assertTrue(any(l.startswith("stop") for l in self.lines("serve.log")))      # server torn down
        self.assertTrue(os.path.exists(self.arm_dir("never") + "/server-container.log"))
        # the next run reports it as interrupted and does not touch it
        self.run_script(s)
        self.assertEqual(self.status_of("never"), "interrupted", self.out)


# ======================================================================================
# Part C: engine "llama-swap" (a row of the user's persistent llama-swap router)
# ======================================================================================
class AgenticLlamaSwapValidation(AgenticBase):
    def bad(self, mutate, *needles):
        s = self.make_ls_spec()
        mutate(s)
        msg = exits(self, gc.validate_spec, s)
        for n in needles:
            self.assertIn(n, msg)
        return msg

    def test_minimal_spec_is_valid(self):
        s = self.make_ls_spec(arms=[{"name": "only"}])
        self.assertEqual(gc.validate_spec(s), "README.md")
        a = gc.agentic_arms(s)
        self.assertEqual(a[0]["server"], {"free_mib_floor": 30000})   # the only server knob; default kept
        self.assertEqual(a[0]["env"], {})

    def test_free_mib_floor_top_and_per_arm(self):
        s = self.make_ls_spec(server={"free_mib_floor": 1000})
        gc.validate_spec(s)
        self.assertEqual([a["server"]["free_mib_floor"] for a in gc.agentic_arms(s)], [1000, 2000])
        self.bad(lambda s: s.update(server={"free_mib_floor": -1}), "free_mib_floor")
        self.bad(lambda s: s.update(server=[]), "server")
        self.bad(lambda s: s.update(server={"bogus": 1}), "bogus")

    def test_engine_values(self):
        self.bad(lambda s: s.update(engine="llamacpp"), "vllm", "llama-swap")

    def test_rejects_vllm_server_knobs(self):
        for k, v in (("maxlen", 4096), ("maxseqs", 1), ("kv_dtype", "fp8"), ("gpu_util", 0.9), ("watchdog_mib", 32)):
            self.bad(lambda s, k=k, v=v: s.update(server={k: v}), k, "llama-swap")
            self.bad(lambda s, k=k, v=v: s["arms"][0].update(server={k: v}), k, "llama-swap")

    def test_rejects_vllm_arm_keys(self):
        for k, v in (("profile", PROFILE), ("image", "ghcr.io/x/y:1"), ("env", {"CACTUS_DELTA": "0"})):
            self.bad(lambda s, k=k, v=v: s["arms"][0].update({k: v}), k, "llama-swap")

    def test_rejects_top_env(self):
        self.bad(lambda s: s.update(env={"SECOND": "top"}), "env", "llama-swap")

    def test_rejects_capture_requests(self):
        self.bad(lambda s: s.update(capture_requests=True), "capture_requests", "llama-swap")
        gc.validate_spec(self.make_ls_spec(capture_requests=False))     # false is the default: fine

    def test_common_checks_still_apply(self):
        p = write(os.path.join(self.T, "s-port.json"), json.dumps({"env": {
            "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{self.port + 1}", "ANTHROPIC_MODEL": SERVED}}))
        self.bad(lambda s: s["claude"].update(settings=p), "port")
        self.bad(lambda s: s.update(served_model="other-row"), "served_model")   # settings names != row id
        self.bad(lambda s: s["arms"][0].update(name="Bad"), "arm name")
        self.bad(lambda s: s["arms"][0].update(bogus=1), "bogus")


class AgenticLlamaSwapScript(AgenticBase):
    def test_bash_n_and_shape(self):
        s = self.make_ls_spec()
        gc.validate_spec(s)
        sh = gc.emit_runsh(s)
        bash_n(self, sh)
        self.assertIn('SERVE_LLAMASWAP="${SERVE_LLAMASWAP:-$ROOT/stack/serve/llamacpp/serve_llamaswap.sh}"', sh)
        self.assertNotIn("SERVE_VLLM", sh)
        self.assertNotIn('"$DOCKER" logs', sh)
        self.assertNotIn("\n  port_free_check\n", sh)

    def test_vllm_script_has_no_llamaswap_code(self):
        sh = gc.emit_runsh(self.spec)
        self.assertNotIn("SERVE_LLAMASWAP", sh)
        self.assertIn('"$DOCKER" logs "vllm-$SPORT"', sh)
        self.assertIn("\n  port_free_check\n", sh)

    def test_shellcheck_if_installed(self):
        sc = shutil.which("shellcheck")
        if not sc:
            self.skipTest("shellcheck not installed")
        r = subprocess.run([sc, "-s", "bash", "-S", "warning", "-"], input=gc.emit_runsh(self.make_ls_spec()),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_readme_contents(self):
        s = self.make_ls_spec()
        gc.validate_spec(s)
        rd = gc.emit_readme(s)
        self.assertIn("llama-swap", rd)
        self.assertIn("serve_llamaswap.sh", rd)
        self.assertIn(f"`{SERVED}`", rd)
        self.assertIn(f":{self.port}", rd)
        self.assertIn("unloaded", rd)
        self.assertIn("2000", rd)                                   # slow's floor override
        self.assertNotIn("serve_vllm", rd)
        self.assertNotIn("gpu_util", rd)


class AgenticLlamaSwapE2E(AgenticBase):
    def test_two_arms_done_unloaded(self):
        p = self.run_script(self.make_ls_spec())
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "done", self.out)
        self.assertEqual(self.status_of("slow"), "done", self.out)
        rows = {r["arm"]: r for r in self.summary()}
        self.assertEqual(rows["slow"]["calls"], "2")
        for arm in ("fast", "slow"):
            self.assertEqual(rows[arm]["port_free"], "unloaded=yes")
            self.assertEqual(rows[arm]["image"], "-")
            self.assertEqual(rows[arm]["env"], "-")
        # print -> start -> stop per arm, with MODEL/PORT/LOG_OUT on print+start, PORT on stop
        ls = self.lines("llamaswap.log")
        self.assertEqual([l.split()[0] for l in ls], ["print", "start", "stop"] * 2, ls)
        for i, arm in ((0, "fast"), (3, "slow")):
            want = f"MODEL={SERVED} PORT={self.port} LOG_OUT={self.arm_dir(arm)}/server-container.log"
            self.assertEqual(ls[i], "print " + want)
            self.assertEqual(ls[i + 1], "start " + want)
            self.assertIn(f"PORT={self.port}", ls[i + 2])
        self.assertFalse(os.path.exists(os.path.join(self.stubdir, "docker.log")))      # docker never called
        self.assertEqual(self.lines("gpu.log"), ["gpu_exclusive floor=30000", "gpu_exclusive floor=2000"])
        ad = self.arm_dir("fast")
        self.assertIn(f"MODEL={SERVED}", open(ad + "/server.txt").read())
        self.assertIn("state=ready", open(ad + "/server-start.txt").read())
        self.assertEqual(open(ad + "/server-container.log").read(), f"upstream log of {SERVED}\n")   # follower's, kept
        stop = open(ad + "/server-stop.txt").read()
        self.assertIn("unloaded=yes\n", stop)
        self.assertTrue(stop.endswith("port_free=unloaded=yes\n"), stop)
        self.assertIn(f"{SERVED}\n", open(ad + "/served-models.txt").read())
        # everything else identical to vllm: worktree prep, session, collect, markers
        self.assertEqual(len(self.lines("claude.log")), 3)
        self.assertTrue(os.path.exists(ad + "/outputs/progress.md"))
        self.assertTrue(os.path.exists(ad + "/gpu_samples.csv"))
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.fast"))
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.slow"))
        self.assertFalse(os.path.exists(self.res_dir + "/failures.txt"))
        self.assertNotIn("WARNING", self.rd("driver.log"))

    def test_unload_not_confirmed_warns(self):
        s = self.make_ls_spec(arms=[{"name": "fast"}])
        p = self.run_script(s, STUB_UNLOAD_FAIL="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "done", self.out)                         # the session's result stands
        self.assertEqual(self.summary()[0]["port_free"], "unloaded=no")
        self.assertIn("WARNING", self.rd("driver.log"))
        self.assertTrue(open(self.arm_dir("fast") + "/server-stop.txt").read().endswith("port_free=unloaded=no\n"))

    def test_server_fail_tears_down_next_arm_runs(self):
        p = self.run_script(self.make_ls_spec(), STUB_START_FAIL_ON="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "server_fail")
        self.assertEqual(self.status_of("slow"), "done", self.out)
        self.assertIn("preload (stub)", self.rd("failures.txt"))
        self.assertEqual([l.split()[0] for l in self.lines("llamaswap.log")],
                         ["print", "start", "stop", "print", "start", "stop"])
        self.assertFalse(os.path.exists(f"{self.wt_root}/fast-r1"))
        self.assertFalse(os.path.exists(self.run_dir + "/started/rep1.fast"))
        self.assertFalse(os.path.exists(os.path.join(self.stubdir, "docker.log")))

    def test_served_name_mismatch(self):
        p = self.run_script(self.make_ls_spec(arms=[{"name": "fast"}]), STUB_WRONG_NAME="1")
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "served_name_mismatch")
        self.assertEqual(self.lines("claude.log"), [])
        self.assertEqual(self.lines("llamaswap.log")[-1].split()[0], "stop")


# ======================================================================================
# Part D: optional agentic key "stop_when" (stop the session at the first matching tool call)
# ======================================================================================
SW = {"tool_regex": "^(Read|Bash)$", "input_regex": "review/27b-fix/opus/"}
# fake claude for stop_when e2e: session id line, then (for *stopper*: a matching tool_use; *nomatch*: a
# non-matching one) and then a long sleep (stopper) -- or a normal completion (nomatch).
STUB_CLAUDE_SW = r"""#!/usr/bin/env bash
D="$STUB_DIR"; me=$(basename "$PWD")
echo "$(date +%s) cwd=$PWD args: $*" >> "$D/claude.log"
n=$(( $(cat "$D/cnt-$me" 2>/dev/null || echo 0) + 1 )); echo $n > "$D/cnt-$me"
echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"sess-$me\"}"
case "$me" in
  *stopper*)
    echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"look review/27b-fix/opus/ here\"}]}}"
    echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"/x/review/27b-fix/opus/review.md\"}}]}}"
    date +%s.%N > "$D/emitted"
    exec sleep 119;;
  *nomatch*)
    echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"/x/other.md\"}}]}}"
    sleep 2
    echo "W2-08 | done | call $n" >> progress.md;;
esac
echo "{\"type\":\"result\",\"session_id\":\"sess-$me\",\"is_error\":false}"
"""


def tool_line(name, inp):
    return json.dumps({"type": "assistant", "message": {"content": [
        {"type": "text", "text": "hi"}, {"type": "tool_use", "id": "t1", "name": name, "input": inp}]}},
        ensure_ascii=False) + "\n"


class StopWhenValidation(AgenticBase):
    def check_ok(self, sw):
        s = self.make_spec(stop_when=sw)
        gc.validate_spec(s)

    def test_valid_accepted(self):
        self.check_ok(dict(SW))

    def test_bad_values_rejected(self):
        for sw in ({"tool_regex": "."}, {"input_regex": "."}, {"tool_regex": "(", "input_regex": "."},
                   {"tool_regex": ".", "input_regex": "[a"}, {"tool_regex": ".", "input_regex": ".", "extra": 1},
                   {"tool_regex": 1, "input_regex": "."}, {"tool_regex": "", "input_regex": "."}, "x", []):
            with self.subTest(sw=sw):
                exits(self, gc.validate_spec, self.make_spec(stop_when=sw))

    def test_in_resolved_cfg_and_not_when_absent(self):
        self.assertIn('"stop_when"', gc.emit_runsh(self.make_spec(stop_when=dict(SW))))
        self.assertNotIn("stop_when", gc.emit_runsh(self.spec))


class StopWhenWatch(AgenticBase):
    """Unit level: `agentic_helper.py watch CFG SESSION OUT IDX [CPID]`."""

    def setUp(self):
        super().setUp()
        self.helper = write(os.path.join(self.T, "h.py"), gc.agentic_helper(True))
        self.cfg = write(os.path.join(self.T, "cfg.json"), json.dumps({"stop_when": dict(SW)}))
        self.sess = os.path.join(self.T, "session-0.jsonl")
        self.out_f = os.path.join(self.T, "stop_when.txt")

    def start(self):
        return subprocess.Popen([sys.executable, "-I", self.helper, "watch", self.cfg, self.sess, self.out_f, "3"])

    def append(self, text):
        with open(self.sess, "a", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()

    def finish(self, p, timeout=8):
        try:
            return p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
            return None

    def test_match_appended_later(self):
        p = self.start()
        time.sleep(0.5)                                              # file does not exist yet
        self.append('{"type":"system","session_id":"s"}\nnot json at all\n')
        time.sleep(1.2)
        self.assertIsNone(p.poll())
        self.append(tool_line("Read", {"file_path": "/x/review/27b-fix/opus/r.md", "ü": "é"}))
        self.assertEqual(self.finish(p), 0)
        t = open(self.out_f, encoding="utf-8").read()
        self.assertIn("call=3\n", t)
        self.assertIn("tool=Read\n", t)
        self.assertIn("line=3\n", t)
        self.assertRegex(t, r"ts=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")
        self.assertIn('input={"file_path": "/x/review/27b-fix/opus/r.md", "ü": "é"}\n', t)

    def test_no_match_other_tool_or_input(self):
        self.append(tool_line("Grep", {"p": "review/27b-fix/opus/"}) + tool_line("Read", {"file_path": "/x/y"}))
        p = self.start()
        self.assertIsNone(self.finish(p, 3))
        self.assertFalse(os.path.exists(self.out_f))

    def test_result_user_and_text_do_not_trigger(self):
        self.append(json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_result", "content": "review/27b-fix/opus/ listing"}]}}) + "\n")
        self.append(json.dumps({"type": "assistant", "message": {"content": [
            {"type": "text", "text": "reading review/27b-fix/opus/ soon"}]}}) + "\n")
        self.append(json.dumps({"type": "user", "message": {"content": [
            {"type": "tool_use", "name": "Read", "input": {"f": "review/27b-fix/opus/"}}]}}) + "\n")
        self.append(json.dumps({"type": "assistant", "message": "review/27b-fix/opus/"}) + "\n")
        p = self.start()
        self.assertIsNone(self.finish(p, 3))
        self.assertFalse(os.path.exists(self.out_f))

    def test_partial_line_waits_for_newline(self):
        full = tool_line("Bash", {"command": "cat review/27b-fix/opus/a.md"})
        self.append(full[:40])
        p = self.start()
        time.sleep(1.5)
        self.assertIsNone(p.poll())
        self.assertFalse(os.path.exists(self.out_f))
        self.append(full[40:-1])
        time.sleep(1.5)
        self.assertIsNone(p.poll())                                  # still no newline
        self.append("\n")
        self.assertEqual(self.finish(p), 0)
        self.assertIn("line=1\n", open(self.out_f).read())

    def test_signals_process_group_when_cpid_given(self):
        victim = subprocess.Popen(["sleep", "119"], start_new_session=True)
        self.addCleanup(victim.kill)
        self.append(tool_line("Read", {"f": "review/27b-fix/opus/"}))
        p = subprocess.Popen([sys.executable, "-I", self.helper, "watch", self.cfg, self.sess, self.out_f, "0",
                              str(victim.pid)])
        self.assertEqual(victim.wait(timeout=8), -signal.SIGINT)
        self.assertTrue(os.path.exists(self.out_f))
        self.assertIsNone(p.poll())                                   # lingers in its TERM/KILL grace until killed
        p.kill()
        p.wait()


class StopWhenScript(AgenticBase):
    def test_bash_n_and_shape(self):
        s = self.make_spec(stop_when=dict(SW))
        gc.validate_spec(s)
        sh = gc.emit_runsh(s)
        bash_n(self, sh)
        self.assertIn(" watch ", sh)
        self.assertIn("stopped", sh)
        self.assertIn(SW["input_regex"], sh)

    def test_absent_no_watch_code(self):
        sh = gc.emit_runsh(self.spec)
        self.assertNotIn("watch", sh.replace("watchdog", ""))
        self.assertNotIn("stopped", sh)
        self.assertNotIn("WPID", sh)

    def test_readme(self):
        s = self.make_spec(stop_when=dict(SW))
        gc.validate_spec(s)
        rd = gc.emit_readme(s)
        self.assertIn("stop_when", rd)
        self.assertIn(SW["input_regex"], rd)
        self.assertIn("`stopped`", rd)
        self.assertIn("result", rd.split("stop_when", 1)[1])
        self.assertNotIn("stop_when", gc.emit_readme(self.spec))

    def test_docstring_lists_status_and_key(self):
        self.assertIn("stop_when", gc.__doc__)
        self.assertIn("stopped", gc.__doc__)
        self.assertIn("stop_when", gc.AGENTIC_KEYS)


class StopWhenE2E(AgenticBase):
    def sw_spec(self, arms, **over):
        s = self.make_spec(stop_when=dict(SW), arms=[{"name": a, "profile": PROFILE} for a in arms], **over)
        return s

    def claude(self):
        return write(os.path.join(self.stubs, "claude_sw"), STUB_CLAUDE_SW, 0o755)

    def test_stopped_is_a_result(self):
        t0 = time.time()
        p = self.run_script(self.sw_spec(["stopper", "nomatch"]), CLAUDE_BIN=self.claude(), timeout=90)
        wall = time.time() - t0
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("stopper"), "stopped", self.out)
        emitted = float(open(self.stubdir + "/emitted").read())
        fired = os.path.getmtime(self.arm_dir("stopper") + "/stop_when.txt")
        print(f"\n[stop latency: tool_use emitted -> stop_when.txt written {fired - emitted:.2f}s; "
              f"whole 2-arm run {wall:.1f}s (nomatch arm sleeps 2s)]")
        self.assertLess(fired - emitted, 4)
        self.assertLess(wall, 20)                                     # the 119 s sleep was cut short
        self.assertTrue(os.path.exists(self.run_dir + "/done/rep1.stopper"))
        self.assertFalse(os.path.exists(self.res_dir + "/failures.txt"), self.out)
        self.assertNotIn("--resume", "".join(self.lines("claude.log")))                  # never resumed
        self.assertEqual(open(self.arm_dir("stopper") + "/calls.tsv").read().count("\n"), 2)
        t = open(self.arm_dir("stopper") + "/stop_when.txt").read()
        for want in ("call=0\n", "tool=Read\n", "line=3\n", '"file_path": "/x/review/27b-fix/opus/review.md"'):
            self.assertIn(want, t)
        self.assertIn("status=stopped", open(self.arm_dir("stopper") + "/result.txt").read())
        self.assertEqual(self.status_of("nomatch"), "done", self.out)      # the other arm is unaffected
        self.assertFalse(os.path.exists(self.arm_dir("nomatch") + "/stop_when.txt"))
        # collection + teardown still happened
        self.assertTrue(os.path.exists(self.arm_dir("stopper") + "/wt.diff"))
        self.assertTrue(any(l.startswith("stop") for l in self.lines("serve.log")))
        time.sleep(0.5)
        orphans = subprocess.run(["pgrep", "-f", "sleep 119"], capture_output=True, text=True).stdout.split()
        self.assertEqual(orphans, [], "orphan session process")
        orph2 = subprocess.run(["pgrep", "-f", "agentic_helper.py watch"], capture_output=True, text=True).stdout
        self.assertNotIn(self.run_dir, orph2)

    def test_non_matching_runs_to_done_when(self):
        p = self.run_script(self.sw_spec(["nomatch"]), CLAUDE_BIN=self.claude(), timeout=90)
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("nomatch"), "done", self.out)
        self.assertFalse(os.path.exists(self.arm_dir("nomatch") + "/stop_when.txt"))
        self.assertEqual(open(self.arm_dir("nomatch") + "/calls.tsv").read().count("\n"), 2)   # header + 1 call

    def test_sigint_kills_watcher(self):
        s = self.sw_spec(["never"], cap_s=600)
        proc = subprocess.Popen(["bash", self.script(s)], env=self.env(), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, start_new_session=True, preexec_fn=sigint_default)
        t0 = time.time()
        while time.time() - t0 < 30 and not self.lines("claude.log"):
            time.sleep(0.1)
        time.sleep(1)
        os.killpg(proc.pid, signal.SIGINT)
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            self.fail("run.sh did not exit after SIGINT")
        time.sleep(0.5)
        out = subprocess.run(["pgrep", "-f", self.run_dir], capture_output=True, text=True).stdout.split()
        self.assertEqual(out, [], "orphan watcher/session")
        self.run_script(s)
        self.assertEqual(self.status_of("never"), "interrupted", self.out)


# ======================================================================================
# Part F: reuse_server mode (run against an already-running, user-managed vllm server)
#   The driver must NOT boot, stop, unload or GPU-exclude the server. It verifies the served
#   name, samples the GPU, and records port_free=reused. The stub curl reads stubdir/served.txt
#   (normally written by serve_vllm start; in reuse we seed it, since no start ever happens).
# ======================================================================================
STUB_CURL_FAIL = r'''#!/usr/bin/env bash
# server is down: curl -sf fails (no response).
echo "connection refused" >&2; exit 7
'''

class AgenticReuse(AgenticBase):
    def setUp(self):
        super().setUp()
        self.spec = self.make_reuse_spec()

    def seed_served(self, name=SERVED):
        write(os.path.join(self.stubdir, "served.txt"), name + "\n")

    # --- validation ---
    def test_reuse_spec_is_valid(self):
        self.assertEqual(gc.validate_spec(self.make_reuse_spec()), "README.md")

    def test_reuse_must_be_bool(self):
        # reuse_server ignores the server block (allowed, ignored), but reuse_server itself must be a bool.
        s = self.make_reuse_spec()
        s["reuse_server"] = "yes"
        self.assertIn("reuse_server", exits(self, gc.validate_spec, s))

    def test_reuse_allows_and_ignores_server_block(self):
        s = self.make_reuse_spec()
        s["server"] = {"maxlen": 4096, "maxseqs": 1, "kv_dtype": "fp8", "gpu_util": 0.93,
                       "watchdog_mib": 32, "free_mib_floor": 1000}
        self.assertEqual(gc.validate_spec(s), "README.md")

    def test_reuse_rejects_capture_requests(self):
        s = self.make_reuse_spec(capture_requests=True)
        self.assertIn("mutually exclusive", exits(self, gc.validate_spec, s))

    def test_reuse_arm_needs_no_profile(self):
        # a reuse arm carries only a name; no profile (the server is user-managed).
        self.assertEqual(gc.validate_spec(self.make_reuse_spec(arms=[{"name": "only"}])), "README.md")

    def test_reuse_rejects_missing_required(self):
        # reuse does NOT remove the base required keys; only `server` is optional.
        s = self.make_reuse_spec()
        del s["served_model"]
        self.assertIn("served_model", exits(self, gc.validate_spec, s))

    # --- emitted script ---
    def test_emit_reuse_no_boot_or_gpu(self):
        sh = gc.emit_runsh(self.make_reuse_spec())
        # the server is acquired, not booted: no serve start/print/stop, no gpu_exclusive invocation
        self.assertIn("reusing user-managed server", sh)
        self.assertNotIn('"$SERVE_VLLM" start', sh)
        self.assertNotIn('"$SERVE_VLLM" print', sh)
        self.assertNotIn('"$SERVE_VLLM" stop', sh)
        self.assertNotIn('$("$GPU_EXCLUSIVE"', sh)        # the var is defined but never invoked
        # the shared served-name check still runs
        self.assertIn("pyh models", sh)

    def test_bash_n_reuse(self):
        bash_n(self, gc.emit_runsh(self.make_reuse_spec()))

    # --- end-to-end ---
    def test_reuse_runs_against_running_server(self):
        self.seed_served()
        p = self.run_script(self.spec)
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "done", self.out)
        rows = {r["arm"]: r for r in self.summary()}
        self.assertEqual(rows["fast"]["port_free"], "reused")
        self.assertEqual(rows["fast"]["image"], "reused (user-managed)")
        # no server boot, no GPU exclusive, no stop
        self.assertEqual([l for l in self.lines("serve.log")], [])
        self.assertEqual(self.lines("gpu.log"), [])
        # the server.txt marker records the reuse
        st = open(self.arm_dir("fast") + "/server.txt").read()
        self.assertIn("reuse_server=true", st)
        self.assertIn("IMAGE=reused (user-managed)", st)
        # the live /v1/models check captured the running model
        self.assertIn(SERVED, open(self.arm_dir("fast") + "/served-models-live.txt").read())
        # teardown left the server untouched (no stop logged)
        self.assertTrue(os.path.exists(self.arm_dir("fast") + "/server-stop.txt"))
        self.assertIn("reused", open(self.arm_dir("fast") + "/server-stop.txt").read())

    def test_reuse_server_mismatch(self):
        self.seed_served("some-other-model")
        p = self.run_script(self.spec)
        self.assertEqual(p.returncode, 0, self.out)        # continue-on-failure: run exits 0
        self.assertEqual(self.status_of("fast"), "served_name_mismatch", self.out)
        self.assertTrue(os.path.exists(self.res_dir + "/failures.txt"))

    def test_reuse_server_down(self):
        # a failing curl stub: the shared /v1/models check and the live check both fail
        cfail = write(os.path.join(self.stubs, "curl_fail"), STUB_CURL_FAIL, 0o755)
        p = self.run_script(self.spec, CURL=cfail)
        self.assertEqual(p.returncode, 0, self.out)
        self.assertEqual(self.status_of("fast"), "server_fail", self.out)

    def test_reuse_does_not_stop_server_on_sigint(self):
        # even when interrupted, the driver never issues a stop (the server is not ours)
        self.seed_served()
        s = self.make_reuse_spec(arms=[{"name": "never"}])   # never finishes -> interrupted
        proc = subprocess.Popen(["bash", self.script(s)], env=self.env(), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, start_new_session=True, preexec_fn=sigint_default)
        t0 = time.time()
        while time.time() - t0 < 30 and not self.lines("claude.log"):
            time.sleep(0.1)
        time.sleep(1)
        os.killpg(proc.pid, signal.SIGINT)
        try:
            proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            self.fail("run.sh did not exit after SIGINT")
        time.sleep(0.5)
        orphans = subprocess.run(["pgrep", "-f", self.run_dir], capture_output=True, text=True).stdout.split()
        self.assertEqual(orphans, [], "orphan session process")
        # no stop ever issued (the server is not ours to stop)
        self.assertEqual([l for l in self.lines("serve.log") if l.startswith("stop")], [])


# ======================================================================================
# Part G: two-root campaign layout (brief A): campaigns/<type>/<date>-<slug>, raw=tmp/,
#   results=results/; engine-bench drivers take CAMPAIGN_DIR; example specs emit clean.
# ======================================================================================
def throughput_spec(**over):
    s = {"slug": "layout", "model": "/m/x.gguf", "backend": "vulkan",
         "servers": [{"name": "a", "ctx": 4096, "np": 1, "kv": "f16", "mtp": 0,
                      "probes": [{"slug": "p", "prompts": ["codereview-100.txt"]}]}]}
    s.update(over)
    return s


def quality_spec(**over):
    s = {"kind": "quality", "slug": "layout-q",
         "configs": [{"label": "a", "file": "A.gguf", "mtp": 0}]}
    s.update(over)
    return s


def cmd_emit_in(camp, spec):
    """gc.cmd_emit with gc.REPO pointed at `camp` (campaigns/ are written under it); returns stdout."""
    sp = write(os.path.join(camp, "spec.json"), json.dumps(spec))

    class A: pass
    a = A(); a.spec = sp; a.force = False; a.print = False
    with contextlib.redirect_stdout(io.StringIO()) as out:
        gc.cmd_emit(a)
    return out.getvalue()


class EmitDirLayout(unittest.TestCase):
    """emit dir = campaigns/<type>/<date>-<slug>/ (type from the spec, else from the kind;
    date YYYY-MM-DD-HHMM, default now; old YYYY-MM-DD specs keep their <date>-<slug> name)."""

    def setUp(self):
        self.camp = os.path.realpath(tempfile.mkdtemp(prefix="gc-layout-"))
        self.addCleanup(shutil.rmtree, self.camp, True)
        self.camps = os.path.join(self.camp, "campaigns")
        self.old = gc.REPO
        gc.REPO = self.camp
        self.addCleanup(setattr, gc, "REPO", self.old)

    def test_kind_maps_to_type_dir_with_hhmm_default_date(self):
        import datetime
        before = datetime.datetime.now()
        cmd_emit_in(self.camp, throughput_spec())
        cmd_emit_in(self.camp, quality_spec())
        for t in ("perf", "quality"):
            self.assertIn(t, os.listdir(self.camps), os.listdir(self.camps))
        perf = os.listdir(os.path.join(self.camps, "perf"))[0]
        self.assertRegex(perf, r"^\d{4}-\d{2}-\d{2}-\d{4}-layout$")     # default date = now as HHMM
        self.assertTrue(before.strftime("%Y-%m-%d") <= perf[:10] <= datetime.datetime.now().strftime("%Y-%m-%d"), perf)
        self.assertTrue(os.access(os.path.join(self.camps, "perf", perf, "run.sh"), os.X_OK))

    def test_explicit_type_and_hhmm_date_win(self):
        cmd_emit_in(self.camp, throughput_spec(date="2026-07-11-1430", type="investigation"))
        d = os.path.join(self.camps, "investigation", "2026-07-11-1430-layout")
        self.assertTrue(os.path.exists(os.path.join(d, "run.sh")))

    def test_dateless_spec_in_its_campaign_dir_keeps_that_dir(self):
        # re-emitting a spec with no date must not open a new dir each minute: the dir it sits in gives the stamp
        d = os.path.join(self.camps, "perf", "2026-01-02-0304-layout")
        cmd_emit_in(d, throughput_spec())
        self.assertEqual(os.listdir(os.path.join(self.camps, "perf")), ["2026-01-02-0304-layout"])
        with open(os.path.join(d, "README.md")) as fh:
            self.assertIn("campaigns/perf/2026-01-02-0304-layout/run.sh", fh.read())

    def test_old_date_form_lands_under_type(self):
        cmd_emit_in(self.camp, quality_spec(date="2026-07-11"))
        self.assertTrue(os.path.exists(os.path.join(self.camps, "quality", "2026-07-11-layout-q", "plan.md")))

    def test_bad_type_or_date_rejected(self):
        exits(self, gc.validate_layout, {"type": "bogus"})
        exits(self, gc.validate_layout, {"date": "2026-07-11-14300"})
        exits(self, gc.validate_layout, {"date": "2026-7-11"})
        gc.validate_layout({"type": "workers", "date": "2026-07-11-0905"})   # any of the six types


class RunshTwoRoots(unittest.TestCase):
    def test_no_absolute_repo_path_and_roots(self):
        for spec in (throughput_spec(), quality_spec()):
            with self.subTest(kind=spec.get("kind", "throughput")):
                sh = gc.emit_runsh(spec)
                self.assertNotIn(gc.REPO, sh)                      # nothing baked from the repo root
                self.assertIn('RAW="$CAMPAIGN_DIR/tmp"', sh)
                self.assertIn('RES="$CAMPAIGN_DIR/results"', sh)

    def test_throughput_driver_writes_classified_files(self):
        sh = gc.emit_runsh(throughput_spec())
        for want in ('touch "$RAW/done/$slug"', 'tee -a "$RES/failures.txt"', 'tee -a "$RES/skipped.txt"',
                     '> "$RES/meta.txt"', 'python3 "$ROOT/bench/core/report.py" "$CAMPAIGN_DIR"',
                     'EB="$ROOT/bench/perf/engine-bench"', 'GEN="$ROOT/bench/workloads/tmp"'):
            self.assertIn(want, sh)
        self.assertNotIn('>> "$RES/results.jsonl"', sh)            # rows are engine-bench's to append (once), not the driver's

    def test_quality_driver_writes_classified_files(self):
        sh = gc.emit_runsh(quality_spec())
        for want in ('OUTF="$RAW/outputs.jsonl"', 'VRAMF="$RES/vram.jsonl"', 'touch "$RAW/done/$label"',
                     '--out "$RES/scores_deterministic.jsonl"', 'python3 "$CORE/report.py" "$CAMPAIGN_DIR"',
                     'SERVE="$ROOT/stack/serve/llamacpp/serve_llamacpp.sh"'):
            self.assertIn(want, sh)


class ExampleSpecEmit(unittest.TestCase):
    """The three `example` specs must emit into a tmp campaigns/ root and pass bash -n."""

    def setUp(self):
        self.camp = os.path.realpath(tempfile.mkdtemp(prefix="gc-ex-"))
        self.addCleanup(shutil.rmtree, self.camp, True)
        self.old = gc.REPO
        gc.REPO = self.camp
        self.addCleanup(setattr, gc, "REPO", self.old)

    def test_example_specs_emit_and_pass_bash_n(self):
        for name, spec, doc in (("throughput", gc.EXAMPLE, "README.md"),
                                ("quality", gc.EXAMPLE_QUALITY, "plan.md"),
                                ("agentic", gc.EXAMPLE_AGENTIC, "README.md")):
            with self.subTest(kind=name):
                # gc.REPO points at the tmp root, so materialize the example's repo-relative
                # install srcs there (the real repo's copies are not in the sandbox)
                for it in spec.get("install", []):
                    if not os.path.isabs(it["src"]):
                        write(os.path.join(self.camp, it["src"]), "placeholder\n")
                cmd_emit_in(self.camp, spec)
                d = os.path.join(self.camp, *gc.campaign_rel(spec).split("/"))
                run_sh = os.path.join(d, "run.sh")
                self.assertTrue(os.access(run_sh, os.X_OK), run_sh)
                self.assertTrue(os.path.exists(os.path.join(d, doc)), d)
                bash_n(self, open(run_sh).read())


class EngineBenchScripts(unittest.TestCase):
    def test_run_sh_and_campaign_sh_pass_bash_n(self):
        eb = os.path.join(HERE, os.pardir, "perf", "engine-bench")
        for name in ("run.sh", "campaign.sh"):
            with self.subTest(script=name):
                r = subprocess.run(["bash", "-n", os.path.join(eb, name)], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stderr)

    def test_run_sh_requires_campaign_dir(self):
        r = subprocess.run(["bash", os.path.join(HERE, os.pardir, "perf", "engine-bench", "run.sh"),
                            "PROMPT_FILE=/dev/null SLUG=x true"], env={k: v for k, v in os.environ.items()
                            if k not in ("CAMPAIGN_DIR", "RUN_DIR")}, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("CAMPAIGN_DIR is not set", r.stderr)

    def test_run_sh_rows_reach_results_once_and_only_on_success(self):
        """run.sh keeps the run's rows in tmp/<run>/results.jsonl (phase_power.py reads them there) and appends them
        to results/results.jsonl once at the end, only when every probe succeeded (iron rule 18)."""
        sb = tempfile.mkdtemp(prefix="ebrun-")
        self.addCleanup(shutil.rmtree, sb, True)
        subprocess.run(["git", "init", "-q", sb], check=True)
        stubs = {
            "bench/core/capture_engine.py":  # one aggregate row per engine; FAIL_ENGINE writes a partial row, then fails
                "import json, os, sys\na = sys.argv\ne, l = a[a.index('--engine') + 1], a[a.index('--label') + 1]\n"
                "print(json.dumps({'kind': 'aggregate', 'engine': e, 'label': l}))\n"
                "sys.exit(1 if os.environ.get('FAIL_ENGINE') == e else 0)\n",
            "stack/gpu/spec_metrics.py": "import sys\nif sys.argv[1] == 'snap': print('{}')\n",
            "stack/gpu/phase_power.py":  # reports how many request rows it found in RUN_DIR/results.jsonl
                "import json, os, sys\nrs = os.path.join(sys.argv[1], 'results.jsonl')\n"
                "n = sum(1 for _ in open(rs)) if os.path.exists(rs) else 0\n"
                "print(json.dumps({'kind': 'power', 'label': 'x', 'rows_seen': n, 'prefill_w_avg': 1, 'prefill_n': 1,"
                " 'decode_w_avg': 1, 'decode_n': 1}))\n",
            "stack/gpu/vram_sampler.py":
                "import sys, time\nf = open(sys.argv[sys.argv.index('--out') + 1], 'w')\n"
                "f.write('t,vram\\n0,1\\n# peak_vram_used_mib=100\\n'); f.flush()\ntime.sleep(60)\n",
            "bin/rocm-smi": "#!/bin/sh\nexit 0\n",
        }
        for rel, body in stubs.items():
            os.makedirs(os.path.dirname(os.path.join(sb, rel)), exist_ok=True)
            with open(os.path.join(sb, rel), "w") as fh:
                fh.write(body)
        os.chmod(os.path.join(sb, "bin/rocm-smi"), 0o755)
        os.makedirs(os.path.join(sb, "bench/perf/engine-bench"))
        shutil.copy(os.path.join(HERE, os.pardir, "perf", "engine-bench", "run.sh"), os.path.join(sb, "bench/perf/engine-bench"))
        www = os.path.join(sb, "www"); os.makedirs(www)
        open(os.path.join(www, "health"), "w").write("ok")
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
        srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", www],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(srv.kill)
        for _ in range(50):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)
        prompt = os.path.join(sb, "prompt.txt"); open(prompt, "w").write("hi")
        url = f"http://127.0.0.1:{port}/v1"

        def run(camp, **extra):
            env = dict(os.environ, CAMPAIGN_DIR=os.path.join(sb, camp), PROMPT_FILE=prompt, SLUG="t", SAMPLE_VRAM="1",
                       ENGINES_LIST=f"good|{url}|m;bad|{url}|m", PATH=os.path.join(sb, "bin") + os.pathsep + os.environ["PATH"],
                       **extra)
            r = subprocess.run(["bash", os.path.join(sb, "bench/perf/engine-bench/run.sh")], env=env,
                               capture_output=True, text=True, timeout=60)
            raw = glob.glob(os.path.join(sb, camp, "tmp", "*-engine-t", "results.jsonl"))
            res = os.path.join(sb, camp, "results", "results.jsonl")
            rows = lambda p: [json.loads(l) for l in open(p)] if os.path.exists(p) else []
            return r, rows(raw[0]) if raw else [], rows(res)

        r, raw, res = run("ok")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(raw, res)                                  # appended once, nothing extra
        self.assertEqual([d["engine"] for d in res if d["kind"] == "aggregate"], ["good", "bad"])
        power = [d for d in res if d["kind"] == "power"]
        self.assertEqual(len(power), 1)
        self.assertGreaterEqual(power[0]["rows_seen"], 2)           # phase_power saw the run's rows
        r, raw, res = run("fail", FAIL_ENGINE="bad")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("rows NOT added", r.stderr)
        self.assertEqual(res, [])                                   # a failed run adds nothing to results/
        self.assertIn("bad", [d.get("engine") for d in raw])        # its partial rows stay raw


def eb_sandbox(testcase, capture_body=None):
    """A temp git repo holding a copy of engine-bench/run.sh and stub capture_engine / spec_metrics /
    phase_power (each records its argv to ARGV_LOG), plus a tiny http.server answering /health on a free
    port (never 8000). Returns (sandbox, url, run) where run(camp, **env) -> (proc, raw_rows, res_rows)."""
    sb = tempfile.mkdtemp(prefix="ebpass-")
    testcase.addCleanup(shutil.rmtree, sb, True)
    subprocess.run(["git", "init", "-q", sb], check=True)
    rec = ("import json, os, sys\n"
           "open(os.environ['ARGV_LOG'], 'a').write(json.dumps([os.path.basename(sys.argv[0])] + sys.argv[1:]) + '\\n')\n")
    stubs = {
        "bench/core/capture_engine.py": rec + (capture_body or
            "a = sys.argv\ne, l = a[a.index('--engine') + 1], a[a.index('--label') + 1]\n"
            "mode = a[1]\n"
            "rows = [{'kind': 'turn', 'engine': e, 'label': l, 'gen_tokens': g} for g in "
            "json.loads(os.environ.get('TURN_GEN', '[600, 600]'))] if mode == 'conversation' else "
            "[{'kind': 'aggregate', 'engine': e, 'label': l, 'n_short': int(os.environ.get('N_SHORT', '0')), 'n_ok': 3}]\n"
            "for r in rows: print(json.dumps(r))\n"
            "sys.exit(int(os.environ.get('CE_RC', '0')))\n"),
        "stack/gpu/spec_metrics.py": rec + (
            "if sys.argv[1] == 'snap': print('{}')\n"
            "elif sys.argv[1] == 'rows': print(json.dumps({'kind': 'spec', 'source': 'llamacpp_timings', 'label': sys.argv[3]}))\n"
            "elif sys.argv[1] == 'diff': print(json.dumps({'kind': 'spec', 'source': 'diff', 'label': sys.argv[4]}))\n"),
        "stack/gpu/phase_power.py": "",
        "stack/gpu/vram_sampler.py": "",
    }
    for rel, body in stubs.items():
        write(os.path.join(sb, rel), body)
    eb = os.path.join(sb, "bench/perf/engine-bench/run.sh")
    os.makedirs(os.path.dirname(eb))
    shutil.copy(os.path.join(HERE, os.pardir, "perf", "engine-bench", "run.sh"), eb)
    www = os.path.join(sb, "www"); os.makedirs(www)
    write(os.path.join(www, "health"), "ok")
    port = free_port()
    assert port != 8000
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", www],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    testcase.addCleanup(srv.kill)
    for _ in range(50):
        with socket.socket() as so:
            if so.connect_ex(("127.0.0.1", port)) == 0:
                break
        time.sleep(0.1)
    prompt = write(os.path.join(sb, "prompt.txt"), "hi")
    url = f"http://127.0.0.1:{port}/v1"
    drop = ("SAMPLING", "MIN_GEN", "TAGS", "SPEC_ROWS", "STATUS_OUT", "MODE", "CAMPAIGN_DIR", "ENGINES_LIST")

    def run(camp, **extra):
        log = os.path.join(sb, camp + ".argv")
        env = {k: v for k, v in os.environ.items() if k not in drop}
        env.update(CAMPAIGN_DIR=os.path.join(sb, camp), PROMPT_FILE=prompt, SLUG="t", ARGV_LOG=log,
                   ENGINES_LIST=f"eng|{url}|m")
        env.update(extra)
        r = subprocess.run(["bash", eb], env=env, capture_output=True, text=True, timeout=60)
        raw = glob.glob(os.path.join(sb, camp, "tmp", "*-engine-t", "results.jsonl"))
        res = os.path.join(sb, camp, "results", "results.jsonl")
        rows = lambda q: [json.loads(l) for l in open(q)] if os.path.exists(q) else []   # noqa: E731
        argv = [json.loads(l) for l in open(log)] if os.path.exists(log) else []
        return r, rows(raw[0]) if raw else [], rows(res), argv
    return sb, eb, run


class EngineBenchPassthrough(unittest.TestCase):
    """engine-bench/run.sh: SAMPLING / MIN_GEN / TAGS / SPEC_ROWS / STATUS_OUT reach capture_engine and
    spec_metrics only when set; unset = the pre-G1 argv and spec rows exactly (KLD + gating callers)."""

    def setUp(self):
        self.sb, self.eb, self.run = eb_sandbox(self)

    @staticmethod
    def ce(argv):
        return [a for a in argv if a[0] == "capture_engine.py"]

    @staticmethod
    def sm(argv):
        return [a[1] for a in argv if a[0] == "spec_metrics.py"]

    def test_capabilities_line(self):
        r = subprocess.run(["bash", self.eb, "--capabilities"], capture_output=True, text=True,
                           env={k: v for k, v in os.environ.items() if k != "CAMPAIGN_DIR"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "engine-bench-capabilities: SAMPLING MIN_GEN TAGS SPEC_ROWS STATUS_OUT")

    def test_unset_is_the_legacy_argv(self):
        r, raw, res, argv = self.run("legacy")
        self.assertEqual(r.returncode, 0, r.stderr)
        (ce,) = self.ce(argv)
        for flag in ("--sampling", "--min-gen", "--tag"):
            self.assertNotIn(flag, ce)
        self.assertEqual(ce[ce.index("--warmup") + 1], "1")
        self.assertEqual(self.sm(argv), ["snap", "diff"])           # legacy: snap/diff after every probe
        self.assertEqual(raw, res)
        r, raw, res, argv = self.run("legacy-conv", MODE="conversation", MAX_DEPTH="20000")
        self.assertEqual(r.returncode, 0, r.stderr)
        (ce,) = self.ce(argv)
        self.assertEqual(ce[1], "conversation")
        for flag in ("--sampling", "--min-gen", "--tag"):
            self.assertNotIn(flag, ce)
        self.assertEqual(self.sm(argv), ["snap", "diff"])

    def test_probe_passthrough(self):
        smp = '{"temperature":1.0,"top_k":20}'
        r, raw, res, argv = self.run("pass", SAMPLING=smp, MIN_GEN="900", TAGS="arm=a,depth=8000,n=1,tg=1024")
        self.assertEqual(r.returncode, 0, r.stderr)
        (ce,) = self.ce(argv)
        self.assertEqual(ce[ce.index("--sampling") + 1], smp)
        self.assertEqual(ce[ce.index("--min-gen") + 1], "900")
        self.assertEqual([ce[i + 1] for i, a in enumerate(ce) if a == "--tag"],
                         ["arm=a", "depth=8000", "n=1", "tg=1024"])

    def test_conversation_passthrough_and_turn_gate(self):
        smp = '{"temperature":1.0}'
        r, raw, res, argv = self.run("conv", MODE="conversation", MAX_DEPTH="20000", SAMPLING=smp, MIN_GEN="450",
                                     TAGS="arm=a,n=1", TURN_GEN="[600, 500]")
        self.assertEqual(r.returncode, 0, r.stderr)
        (ce,) = self.ce(argv)
        self.assertEqual(ce[ce.index("--sampling") + 1], smp)
        self.assertNotIn("--min-gen", ce)                           # capture_engine conversation has none:
        self.assertEqual([ce[i + 1] for i, a in enumerate(ce) if a == "--tag"], ["arm=a", "n=1"])
        st = os.path.join(self.sb, "st.json")                     # ... engine-bench gates the turns itself
        r, raw, res, argv = self.run("conv-short", MODE="conversation", MAX_DEPTH="20000", MIN_GEN="450",
                                     TURN_GEN="[600, 449, 10]", STATUS_OUT=st)
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("SHORT", r.stderr)
        self.assertEqual(res, [])                                   # rule 18: nothing reaches results/
        status = json.load(open(st))
        self.assertEqual((status["ok"], status["short"], status["n_short"], status["n_total"], status["min_gen"]),
                         (False, True, 2, 3, 450))

    def test_short_probe_fails_with_status(self):
        st = os.path.join(self.sb, "st.json")
        r, raw, res, argv = self.run("short", MIN_GEN="900", CE_RC="3", N_SHORT="2", STATUS_OUT=st)
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("rows NOT added", r.stderr)
        self.assertEqual(res, [])
        status = json.load(open(st))
        self.assertEqual((status["ok"], status["short"], status["n_short"]), (False, True, 2))
        r, raw, res, argv = self.run("err", CE_RC="1", STATUS_OUT=st)   # a real failure stays exit 1
        self.assertEqual(r.returncode, 1)
        self.assertEqual((json.load(open(st))["ok"], json.load(open(st))["short"]), (False, False))
        r, raw, res, argv = self.run("ok", STATUS_OUT=st)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(json.load(open(st))["ok"])

    def test_spec_rows_modes(self):
        r, raw, res, argv = self.run("rows", SPEC_ROWS="rows")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.sm(argv), ["rows"])
        rows_call = [a for a in argv if a[0] == "spec_metrics.py"][0]
        self.assertTrue(rows_call[2].endswith("/results.jsonl") and "/tmp/" in rows_call[2])   # the run's own rows
        self.assertEqual(rows_call[3:5], ["t", "eng"])
        self.assertTrue(rows_call[5].endswith("props_eng.json"))
        self.assertEqual([d["source"] for d in res if d["kind"] == "spec"], ["llamacpp_timings"])
        r, raw, res, argv = self.run("diff", SPEC_ROWS="diff")
        self.assertEqual(self.sm(argv), ["snap", "diff"])
        self.assertEqual([d["source"] for d in res if d["kind"] == "spec"], ["diff"])
        r, raw, res, argv = self.run("off", SPEC_ROWS="off")
        self.assertEqual(self.sm(argv), [])
        self.assertEqual([d for d in res if d["kind"] == "spec"], [])
        r, raw, res, argv = self.run("bad", SPEC_ROWS="yes")
        self.assertEqual(r.returncode, 2)
        self.assertIn("SPEC_ROWS", r.stderr)
        self.assertEqual(self.ce(argv), [])                         # refused before any probe

# ======================================================================================
# Part G1: multi-engine throughput (servers[].engine = llamacpp | vllm | radiance)
# Emit + inspect + bash -n only: no emitted run.sh is executed, no server/docker/GPU tool is called.
# ======================================================================================
LLAMA_BIN = "/opt/llama/b11448-vulkan/bin/llama-server"
GGUF = "/models/gguf/Qwen-27B-UD-Q4_K_XL.gguf"
RAD = "/models/rad/StillDeadcode__q27-mxfp4@60bd4139/q27-mxfp4.rad"
RAD_IMAGE = "stilldeadcode/radiance:1.17.0"
VLLM_IMAGE = "ghcr.io/slybase/vllm-sly-radiance:1.11.0-rocm10.1"


def multi_spec(**over):
    s = {"slug": "multi", "date": "2026-11-13-1200", "port": 8000,
         "sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0, "presence_penalty": 0,
                      "frequency_penalty": 0},
         "workload": {"ladder": {"depths": [8000, 32000, 100000, 200000], "reps": 3, "spec_reps": 5,
                                 "spec_depths": [32000, 100000, 200000]},
                      "concurrency": {"n": 2, "depths": [32000], "reps": 3},
                      "conversation": {"prompt": "codereview-270000.txt", "max_depth": 205000,
                                       "turn_prompt": "codereview-large.task.md"},
                      "sentinel": {"depth": 32000, "tol_pct": 5}, "smoke": {"depth": 8000}},
         "servers": [
             {"name": "q4kxl", "engine": "llamacpp", "served_model": "q27-q4kxl", "gguf": GGUF, "bin": LLAMA_BIN,
              "ctx": 260000, "np": 2, "kv": "q8_0", "extra_args": "--kv-unified", "working_set_mib": 20000,
              "free_mib_floor": 26000},
             {"name": "b", "engine": "radiance", "served_model": "q27-mxfp4", "rad_file": RAD, "image": RAD_IMAGE,
              "spec_tokens": 7, "ctx": 260000, "np": 2, "kv": "fp8", "working_set_mib": 16794},
             {"name": "d", "engine": "vllm", "served_model": SERVED, "profile": PROFILE, "image": VLLM_IMAGE,
              "spec": True, "ctx": 260000, "np": 2, "kv": "fp8", "working_set_mib": 16794,
              "env": {"WATCHDOG_MIB": "32", "CACTUS_DELTA": "0"}}]}
    s.update(over)
    return s


def quiet(fn, *a, **kw):
    """Call fn with stderr (emit-time notes/warnings) swallowed."""
    with contextlib.redirect_stderr(io.StringIO()):
        return fn(*a, **kw)


def srv(spec, name):
    return next(x for x in spec["servers"] if x["name"] == name)


class MultiValidation(unittest.TestCase):
    def ok(self, spec):
        self.assertEqual(quiet(gc.validate_spec, spec), "README.md")

    def bad(self, spec, *needles):
        msg = quiet(exits, self, gc.validate_spec, spec)
        for n in needles:
            self.assertIn(n, msg)
        return msg

    def test_valid_spec_and_example_pass(self):
        self.ok(multi_spec())
        self.ok(copy.deepcopy(gc.EXAMPLE_MULTI))

    def test_dispatch_needs_engine_on_every_server(self):
        self.assertTrue(gc.is_multi(multi_spec()))
        self.assertFalse(gc.is_multi(throughput_spec()))
        s = multi_spec()
        del s["servers"][1]["engine"]
        self.bad(s, "every server needs an `engine`")

    def test_unknown_engine(self):
        s = multi_spec()
        s["servers"][0]["engine"] = "hipfire"
        self.bad(s, "unknown engine 'hipfire'", "llamacpp | vllm | radiance")

    def test_missing_per_engine_fields(self):
        for name, key in (("b", "rad_file"), ("b", "image"), ("b", "spec_tokens"), ("q4kxl", "gguf"),
                          ("q4kxl", "bin"), ("d", "profile"), ("d", "spec"), ("d", "image")):
            with self.subTest(server=name, key=key):
                s = multi_spec()
                del srv(s, name)[key]
                self.bad(s, f"missing required field '{key}'")
        for key in ("served_model", "ctx", "np", "kv", "working_set_mib"):
            with self.subTest(key=key):
                s = multi_spec()
                del s["servers"][0][key]
                self.bad(s, f"missing required field '{key}'")

    def test_foreign_engine_fields_rejected(self):
        s = multi_spec()
        srv(s, "d")["gguf"] = GGUF
        self.bad(s, "'gguf' is a llamacpp-only field")
        s = multi_spec()
        srv(s, "b")["mtp"] = 1
        self.bad(s, "mtp is not a multi-engine radiance field")
        s = multi_spec()
        srv(s, "q4kxl")["probes"] = []
        self.bad(s, "probes is not a multi-engine")
        s = multi_spec()
        srv(s, "q4kxl")["bogus"] = 1
        self.bad(s, "'bogus' is not a server field")

    def test_single_engine_top_keys_rejected(self):
        for k, v in (("model", "/m.gguf"), ("engine", "vllm"), ("profile", PROFILE), ("vram", {})):
            with self.subTest(key=k):
                self.bad(multi_spec(**{k: v}), f"top-level {k!r} is single-engine only")
        self.bad(multi_spec(extra=1), "unknown top-level key 'extra'")

    def test_duplicate_names_and_arm_pass(self):
        s = multi_spec()
        s["servers"][1]["name"] = "q4kxl"
        self.bad(s, "duplicate server name 'q4kxl'")
        s = multi_spec()
        srv(s, "b")["arm"] = "q4kxl"
        self.bad(s, "arm 'q4kxl' already has a server in pass 'A'")
        s = multi_spec()                                  # the same arm in pass B is a legit second server
        srv(s, "b")["arm"] = "q4kxl"
        srv(s, "b")["pass"] = "B"
        self.ok(s)

    def test_ports(self):
        s = multi_spec()
        srv(s, "b")["port"] = 9292
        self.bad(s, "not 9292")
        s = multi_spec()
        srv(s, "b")["port"] = 80
        self.bad(s, "port must be 1024..65535")
        self.ok(multi_spec())                             # one shared port: servers run one at a time

    def test_working_set_above_floor_and_floor_above_vram(self):
        s = multi_spec()
        srv(s, "q4kxl")["working_set_mib"] = 26001
        self.bad(s, "working_set_mib 26001 > free_mib_floor 26000")
        s = multi_spec()
        srv(s, "b")["working_set_mib"] = 30001            # default floor 30000
        self.bad(s, "> free_mib_floor 30000")
        s = multi_spec()
        srv(s, "b")["free_mib_floor"] = 40000
        self.bad(s, "physical VRAM")

    def test_sampling_rules(self):
        self.bad(multi_spec(sampling={"top_p": 0.95}), "must set temperature")
        s = multi_spec()
        del s["sampling"]
        self.bad(s, "`sampling` is required")
        self.bad(multi_spec(sampling={"temperature": 1.0, "repetition_penalty": 1.0}), "engine-specific")
        self.bad(multi_spec(sampling={"temperature": 1.0, "typical_p": 1.0}), "not a capture_engine sampler key")
        self.bad(multi_spec(sampling={"temperature": 1.0, "top_k": 20.5}), "top_k must be an integer")
        self.bad(multi_spec(sampling={"temperature": "1"}), "temperature must be a number")

    def test_rep_penalty_key(self):
        s = multi_spec()
        srv(s, "b")["rep_penalty_key"] = "rep_pen"
        self.bad(s, "rep_penalty_key must be")
        # M3: the key is fixed per engine -- a wrong name silently drops the penalty to the engine default
        s = multi_spec()
        srv(s, "d")["rep_penalty_key"] = "repeat_penalty"
        self.bad(s, "rep_penalty_key on vllm must be 'repetition_penalty'")
        s = multi_spec()
        srv(s, "q4kxl")["rep_penalty_key"] = "repetition_penalty"
        self.bad(s, "rep_penalty_key on llamacpp must be 'repeat_penalty'")
        for eng in ("q4kxl", "d"):
            with self.subTest(null_on=eng):
                s = multi_spec()
                srv(s, eng)["rep_penalty_key"] = None
                self.bad(s, "must be")
        for key in (None, "repetition_penalty", "repeat_penalty"):   # radiance: unverified, any key or none
            with self.subTest(radiance=key):
                s = multi_spec()
                srv(s, "b")["rep_penalty_key"] = key
                self.ok(s)
        s = multi_spec()                                           # the defaults pass explicitly too
        srv(s, "q4kxl")["rep_penalty_key"] = "repeat_penalty"
        srv(s, "d")["rep_penalty_key"] = "repetition_penalty"
        self.ok(s)

    def test_radiance_without_key_warns_and_readme_says_so(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            gc.validate_spec(multi_spec())
        self.assertIn("radiance server 'b': penalty UNVERIFIED until the smoke confirms radiance's key", err.getvalue())
        self.assertIn("penalty UNVERIFIED until the smoke confirms radiance's key", gc.emit_readme(multi_spec()))
        s = multi_spec()
        srv(s, "b")["rep_penalty_key"] = "repetition_penalty"
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            gc.validate_spec(s)
        self.assertNotIn("UNVERIFIED", err.getvalue())
        self.assertNotIn("UNVERIFIED until", gc.emit_readme(s))

    def test_server_name_prefix_clash(self):
        s = multi_spec()
        srv(s, "b")["name"] = "q4kxl-f16"
        self.bad(s, "share a '<name>-' prefix", "ONLY='q4kxl-*'")

    def test_placeholder_pins_warn(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            gc.validate_spec(copy.deepcopy(gc.EXAMPLE_MULTI))
        self.assertIn("PLACEHOLDER pins (all zeros)", err.getvalue())
        self.assertTrue(any("PLACEHOLDER" in n for n in gc.EXAMPLE_MULTI["notes"]))
        d = next(x for x in gc.EXAMPLE_MULTI["servers"] if x["engine"] == "vllm")
        self.assertTrue(d["env"]["CHAT_TEMPLATE"].endswith("dp-sharp-chat_template.jinja"))   # m14d, plan §1

    def test_fixtures_sha256_format_documented(self):
        msg = self.bad(multi_spec(pins={"fixtures_sha256": "/abs/x.sha256"}), "campaign-relative")
        self.assertIn("sha256sum", msg)
        self.assertIn("bench/workloads/tmp", gc.emit_readme(multi_spec()))
        self.assertIn("bare", gc.__doc__.lower())

    def test_depth_rules(self):
        s = multi_spec()
        s["workload"]["ladder"]["depths"] = [8000, 32000, 100000]
        self.bad(s, ">= 4 depths", "rule 16")
        s = multi_spec()
        s["workload"]["ladder"]["depths"] = [32000, 8000, 100000, 200000]
        self.bad(s, "strictly ascending")
        s = multi_spec()
        srv(s, "b")["depths"] = [8000, 16000, 64000, 128000]
        self.bad(s, "sentinel depth 32000 is not in its ladder")
        s = multi_spec()
        srv(s, "b")["depths"] = [8000, 32000, 64000, 128000]
        self.ok(s)

    def test_context_windows(self):
        s = multi_spec()
        srv(s, "b")["ctx"] = 200000                       # 200000 + 1024 does not fit
        self.bad(s, "b-d200000-n1 needs 201024 tokens > the per-request window 200000")
        s = multi_spec()
        del srv(s, "q4kxl")["extra_args"]                 # -np 2 without --kv-unified: ctx/2 per slot
        self.bad(s, "per-request window 130000", "--kv-unified")
        s = multi_spec()                                  # unified pool: 2 x (32000 + 1024) must fit
        srv(s, "q4kxl")["ctx"] = 205000
        srv(s, "q4kxl")["depths"] = [8000, 32000, 64000, 128000]
        self.ok(s)
        s = multi_spec()
        srv(s, "q4kxl")["ctx"] = 60000
        srv(s, "q4kxl")["depths"] = [1000, 2000, 32000, 40000]
        srv(s, "q4kxl")["conv_max_depth"] = 50000
        self.bad(s, "q4kxl-d32000-n2 needs 2 x 33024 tokens > the unified pool 60000")
        s = multi_spec()
        srv(s, "d")["ctx"] = 201024                       # ladder fits, the 205000 conversation does not ...
        self.bad(s, "d-conv needs 205000")
        srv(s, "d")["conv_max_depth"] = 200000            # ... unless the server caps it
        self.ok(s)

    def test_paths_and_bins(self):
        s = multi_spec()
        srv(s, "q4kxl")["bin"] = "/x/stack/llamacpp/var/builds/latest-vulkan/bin/llama-server"
        self.bad(s, "latest-* symlink")
        s = multi_spec()
        srv(s, "q4kxl")["gguf"] = "models/x.gguf"
        self.bad(s, "gguf must be an absolute path")
        s = multi_spec()
        srv(s, "b")["rad_file"] = "/models/x.gguf"
        self.bad(s, "rad_file must end in .rad")
        s = multi_spec()
        srv(s, "q4kxl")["gguf"] = "/models/x y.gguf"
        self.bad(s, "absolute path of")

    def test_extra_args_and_env(self):
        s = multi_spec()
        srv(s, "q4kxl")["extra_args"] = "--kv-unified --alias other"
        self.bad(s, "may not set --alias")
        s = multi_spec()
        srv(s, "b")["extra_args"] = "--num-speculative-tokens=3"
        self.bad(s, "may not set --num-speculative-tokens")
        s = multi_spec()
        srv(s, "d")["extra_args"] = "--foo 'a b'"
        self.bad(s, "extra_args token")
        for k in ("SERVED_NAME", "FREE_MIB_FLOOR", "EXTRA_ARGS", "PROFILE"):
            with self.subTest(env=k):
                s = multi_spec()
                srv(s, "d")["env"] = {k: "x"}
                self.bad(s)

    def test_spec_flag_consistency_and_vllm_profile(self):
        s = multi_spec()
        srv(s, "b")["spec_tokens"] = 0
        srv(s, "b")["spec"] = True
        self.bad(s, "contradicts")
        s = multi_spec()
        srv(s, "d")["served_model"] = "other-name"
        self.bad(s, "!= the profile's SERVED_NAME")
        s = multi_spec()
        srv(s, "d")["profile"] = "no/such-profile"
        self.bad(s, "vllm profile not found")

    def test_workload_and_pins_rules(self):
        s = multi_spec()
        s["workload"]["fixture"] = "codereview.txt"
        self.bad(s, "{depth}")
        s = multi_spec()
        s["workload"]["min_gen"] = 2000
        self.bad(s, "min_gen an int in 0..max_tokens")
        s = multi_spec()
        s["workload"]["conversation"]["turn_prompt"] = "no-such.task.md"
        self.bad(s, "not a file in bench/workloads/tasks/")
        self.bad(multi_spec(pins={"files": {GGUF: "abc"}}), "sha256 must be 64")
        self.bad(multi_spec(pins={"images": {RAD_IMAGE: "latest"}}), "digest must be")
        self.bad(multi_spec(pins={"fixtures_sha256": "/abs/x.sha256"}), "campaign-relative")
        self.bad(multi_spec(pins={"bogus": 1}), "pins must be an object")

    def test_unpinned_weights_warn(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            gc.validate_spec(multi_spec())
        self.assertIn("not pinned", err.getvalue())
        self.assertIn(GGUF, err.getvalue())
        self.assertIn("SAMPLING, MIN_GEN, TAGS, SPEC_ROWS, STATUS_OUT", err.getvalue())


class MultiCells(unittest.TestCase):
    def test_order_slugs_and_tags(self):
        s = multi_spec()
        cells = gc.multi_cells(s, srv(s, "q4kxl"))
        # m3: ladder ascending, n=2@32k right after the 32k ladder cell, sentinel right after the ladder, then conv
        self.assertEqual([c["slug"] for c in cells],
                         ["q4kxl-smoke-d8000", "q4kxl-smoke-conv", "q4kxl-d8000-n1", "q4kxl-d32000-n1",
                          "q4kxl-d32000-n2", "q4kxl-d100000-n1", "q4kxl-d200000-n1", "q4kxl-sentinel-d32000",
                          "q4kxl-conv"])
        lad = cells[3]
        self.assertEqual(lad["tags"], {"arm": "q4kxl", "depth": 32000, "n": 1, "workload": "codereview",
                                       "pass": "A", "tier": "minimal", "cell": "ladder", "rep_key": "repeat_penalty"})
        self.assertEqual(lad["fixture"], "codereview-32000.txt")
        self.assertEqual(cells[0]["tags"]["tier"], "smoke")
        self.assertEqual(cells[1]["max_depth"], 10000)          # smoke conversation = turn 0 only
        self.assertEqual(cells[8]["max_depth"], 205000)
        self.assertEqual(cells[4]["n"], 2)

    def test_conc_depth_between_ladder_depths_and_rep_key_tags(self):
        s = multi_spec()
        s["workload"]["concurrency"]["depths"] = [50000]
        slugs = [c["slug"] for c in gc.multi_cells(s, srv(s, "q4kxl"))]
        self.assertLess(slugs.index("q4kxl-d32000-n1"), slugs.index("q4kxl-d50000-n2"))
        self.assertLess(slugs.index("q4kxl-d50000-n2"), slugs.index("q4kxl-d100000-n1"))
        self.assertEqual({c["tags"]["rep_key"] for c in gc.multi_cells(s, srv(s, "b"))}, {"UNVERIFIED"})
        self.assertEqual({c["tags"]["rep_key"] for c in gc.multi_cells(s, srv(s, "d"))}, {"repetition_penalty"})

    def test_min_gen_per_cell_and_conversation_gate(self):
        s = multi_spec()
        cells = gc.multi_cells(s, srv(s, "q4kxl"))
        self.assertEqual({c["min_gen"] for c in cells if c["mode"] == "probe"}, {900})
        self.assertEqual({c["min_gen"] for c in cells if c["mode"] == "conv"}, {0})      # off unless set (user 2026-11-13)
        s["workload"]["conversation"]["min_gen"] = 300
        self.assertEqual({c["min_gen"] for c in gc.multi_cells(s, srv(s, "q4kxl")) if c["mode"] == "conv"}, {300})
        s["workload"]["conversation"]["min_gen"] = 600
        msg = quiet(exits, self, gc.validate_spec, s)
        self.assertIn("conversation.min_gen must be <=", msg)

    def test_spec_reps_only_on_spec_servers_and_spec_depths(self):
        s = multi_spec()
        reps = lambda name: {c["depth"]: c["reps"] for c in gc.multi_cells(s, srv(s, name)) if c["cell"] == "ladder"}
        self.assertEqual(reps("q4kxl"), {8000: 3, 32000: 3, 100000: 3, 200000: 3})     # mtp 0 -> no spec
        self.assertEqual(reps("b"), {8000: 3, 32000: 5, 100000: 5, 200000: 5})         # spec_tokens 7
        self.assertEqual(reps("d"), {8000: 3, 32000: 5, 100000: 5, 200000: 5})         # spec true

    def test_concurrency_skipped_when_np_below_n(self):
        s = multi_spec()
        srv(s, "b")["np"] = 1
        self.assertNotIn("b-d32000-n2", [c["slug"] for c in gc.multi_cells(s, srv(s, "b"))])

    def test_sampling_rep_key_per_engine(self):
        s = multi_spec()
        smp = {n: json.loads(gc.multi_sampling(s, srv(s, n))) for n in ("q4kxl", "b", "d")}
        self.assertEqual(smp["q4kxl"]["repeat_penalty"], 1.0)
        self.assertNotIn("repetition_penalty", smp["q4kxl"])
        self.assertEqual(smp["d"]["repetition_penalty"], 1.0)
        self.assertNotIn("repeat_penalty", smp["d"])
        self.assertFalse({"repeat_penalty", "repetition_penalty"} & set(smp["b"]))   # radiance key UNVERIFIED
        for v in smp.values():
            self.assertEqual({k: v[k] for k in ("temperature", "top_p", "top_k", "min_p", "presence_penalty",
                                                "frequency_penalty")},
                             {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0, "presence_penalty": 0,
                              "frequency_penalty": 0})
        srv(s, "b")["rep_penalty_key"] = "repetition_penalty"
        self.assertEqual(json.loads(gc.multi_sampling(s, srv(s, "b")))["repetition_penalty"], 1.0)


class MultiEmit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = multi_spec(pins={"files": {GGUF: "a" * 64}, "images": {RAD_IMAGE: "sha256:" + "b" * 12},
                                    "binaries": [LLAMA_BIN], "single": ["/models/rad/StillDeadcode__q27-mxfp4@*/q27-mxfp4.rad"],
                                    "fixtures_sha256": "inputs/fixtures.sha256"})
        quiet(gc.validate_spec, cls.spec)
        cls.sh = gc.emit_runsh(cls.spec)

    def block(self, name):
        """The emitted block of one server (from its header to the next)."""
        start = self.sh.index(f"# ===== server ")
        parts = self.sh[start:].split("# ===== server ")
        return next(p for p in parts if p.split(": ", 1)[-1].startswith(name + " ("))

    def test_bash_n(self):
        bash_n(self, self.sh)
        bash_n(self, gc.emit_runsh(copy.deepcopy(gc.EXAMPLE_MULTI)))

    def test_shellcheck_if_available(self):
        sc = shutil.which("shellcheck")
        if not sc:
            self.skipTest("shellcheck not installed")
        r = subprocess.run([sc, "-s", "bash", "-S", "warning", "-"], input=self.sh, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_no_placeholders_and_two_roots(self):
        self.assertNotIn("@@", self.sh)
        self.assertNotIn(gc.REPO, self.sh)
        self.assertIn('RAW="$CAMPAIGN_DIR/tmp"', self.sh)
        self.assertIn('RES="$CAMPAIGN_DIR/results"', self.sh)
        self.assertIn('RUN_DIR="$CAMPAIGN_DIR/tmp/runs/$RUN_TAG"', self.sh)     # rule 19 short-run isolation
        self.assertIn('RUN_LOCK="$CAMPAIGN_DIR/tmp/run.lock"', self.sh)

    def test_identity_gate_per_server_never_inherited(self):
        self.assertNotIn("${ENGINES_LIST", self.sh)
        for name, arm_url in (("q4kxl", "q4kxl|http://localhost:8000/v1|q27-q4kxl"),
                              ("b", "b|http://localhost:8000/v1|q27-mxfp4"),
                              ("d", f"d|http://localhost:8000/v1|{SERVED}")):
            with self.subTest(server=name):
                blk = self.block(name)
                self.assertIn(f"export ENGINES_LIST='{arm_url}'", blk)
                self.assertLess(blk.index("export ENGINES_LIST"), blk.index("boot_server"))
                self.assertLess(blk.index("boot_server"), blk.index("identity_gate"))
                self.assertLess(blk.index("identity_gate"), blk.index("residency_check"))
                self.assertLess(blk.index("residency_check"), blk.index("run_probe_cell"))
                self.assertLess(blk.index("-sentinel-d32000' "), blk.index("run_conv_cell '" + name + "-conv'"))
                self.assertLess(blk.index("stop_current"), blk.index("\nsentinel_check "))   # m2: outside the boot
        self.assertIn(f"identity_gate 8000 'q27-q4kxl' '{LLAMA_BIN}' '{GGUF}' '--alias q27-q4kxl'", self.sh)
        self.assertIn("identity_gate 8000 'q27-mxfp4' 'stilldeadcode/radiance:1.17.0' "
                      "'/models/rad/StillDeadcode__q27-mxfp4@60bd4139:/models:ro' '/models/q27-mxfp4.rad' "
                      "'--served-model-name q27-mxfp4'", self.sh)
        self.assertIn(f"'--served-model-name {SERVED}' '# profile={PROFILE} '", self.sh)

    def test_launcher_env(self):
        b = self.block("q4kxl")
        for kv in (f"'MODEL={GGUF}'", f"'LLAMA_SERVER={LLAMA_BIN}'", "'BACKEND=vulkan'", "'CTX=260000'", "'NP=2'",
                   "'KV=q8_0'", "'MTP=0'", "'UB=2048'", "'B=8192'", "'FA=on'", "'PORT=8000'",
                   "'EXTRA_ARGS=--alias q27-q4kxl --kv-unified'"):
            self.assertIn(kv, b)
        b = self.block("b")
        for kv in (f"'RAD_FILE={RAD}'", f"'IMAGE={RAD_IMAGE}'", "'SERVED_NAME=q27-mxfp4'", "'FREE_MIB_FLOOR=30000'",
                   "'CONTAINER_NAME=radiance-8000'", "'EXTRA_ARGS=--num-speculative-tokens 7'", "'TP=1'"):
            self.assertIn(kv, b)
        b = self.block("d")
        for kv in (f"'PROFILE={PROFILE}'", f"'IMAGE={VLLM_IMAGE}'", "'MAXLEN=260000'", "'MAXSEQS=2'",
                   "'KV_DTYPE=fp8'", "'WATCHDOG_MIB=32'", "'CACTUS_DELTA=0'"):
            self.assertIn(kv, b)
        self.assertNotIn("EXTRA_ARGS", b)

    def test_boot_sequence_functions(self):
        for want in ('gx=$("$GPU_EXCLUSIVE" "$floor" 2>&1)', 'boot_gate "$slug" "$port" "$floor" || return 1',
                     '$BOOT_VRAM_SAMPLER --out "$csv" & sampler_pid=$!', 'python3 "$BOOT_DIAG" record',
                     'BOOT_DIAG="${BOOT_DIAG:-$ROOT/bench/perf/boot_diag.py}"', 'power_snapshot "$slug" before',
                     'power_snapshot "$slug" after', 'trap stop_current EXIT', 'PORT=$port "$serve" stop',
                     'container_gone=$gone port_free=$portfree vram_idle=$idle',
                     '"$AMD_SMI" process -g 0', 'src=vram_delta',
                     "FAULT_RE='Memory Fault|ErrorDeviceLost|DeviceLostError'",
                     '"$DOCKER" logs --since "$CELL_T0"', 'tail -c "+$((CELL_OFF + 1))"',
                     'quarantine_rows "$1"; stop_current; exit 1', 'touch "$RAW/done/$slug"',
                     'fault_seen && fault_abort "$slug" "at the end of"'):
            self.assertIn(want, self.sh)
        # every cell runs under the watcher
        self.assertEqual(self.sh.count('watched "$slug" env '), 2)
        # gpu_exclusive before the gate, sampler only after the gate passed
        bs = self.sh[self.sh.index("boot_server () {"):]
        self.assertLess(bs.index('"$GPU_EXCLUSIVE"'), bs.index('boot_gate "$slug"'))
        self.assertLess(bs.index('boot_gate "$slug"'), bs.index("$BOOT_VRAM_SAMPLER"))

    def test_spec_rows_mode_per_engine(self):
        import re
        for name, want in (("q4kxl", {"rows"}), ("b", {"diff"}), ("d", {"diff"})):
            with self.subTest(server=name):
                got = [re.search(r"rep_key=\w+' '(\w+)' 'codereview-", l).group(1) for l in self.block(name).splitlines()
                       if l.strip().startswith(("run_probe_cell '", "run_conv_cell '"))]
                self.assertEqual(len(got), 9)
                self.assertEqual(set(got), want)
        self.assertIn('SPEC_ROWS="$srows"', self.sh)
        self.assertIn('STATUS_OUT="$RAW/status-$slug.json"', self.sh)
        self.assertIn('TAGS="$tags,tg=$C_MAXT,residency=$RESIDENCY"', self.sh)

    def test_sampling_per_server(self):
        self.assertIn('"repeat_penalty":1.0}', self.block("q4kxl"))
        self.assertIn('"repetition_penalty":1.0}', self.block("d"))
        self.assertNotIn("penalty\":1.0}", self.block("b").split("SMP=")[1].split("\n")[0].replace(
            '"frequency_penalty":0', "").replace('"presence_penalty":0', ""))

    def test_preflight_pins(self):
        pf = self.sh[self.sh.index("preflight () {"):self.sh.index("# ================================ execution")]
        for want in (f"pin_sha '{GGUF}' '{'a' * 64}' || fail=1",
                     "pin_single '/models/rad/StillDeadcode__q27-mxfp4@*/q27-mxfp4.rad' || fail=1",
                     f"[ -f '{RAD}' ]", f"[ -x '{LLAMA_BIN}' ]",
                     f"pin_image '{RAD_IMAGE}' 'sha256:{'b' * 12}' || fail=1",
                     f"pin_image '{VLLM_IMAGE}' '' || fail=1",
                     "if gate_port_held 8000", "for v in SAMPLING MIN_GEN TAGS SPEC_ROWS STATUS_OUT; do",
                     '"$EB/run.sh" --capabilities',
                     '"$SERVE_LLAMA"', '"$SERVE_RAD"', '"$SERVE_VLLM"'):
            self.assertIn(want, pf)
        ex = self.sh[self.sh.index("# ================================ execution"):]
        self.assertLess(ex.index("preflight"), ex.index("ensure_fixtures"))
        self.assertLess(ex.index("ensure_fixtures"), ex.index("sha256sum -c --quiet \"$CAMPAIGN_DIR/inputs/fixtures.sha256\""))
        self.assertLess(ex.index("sha256sum -c"), ex.index("boot_server"))

    def test_knobs(self):
        for want in ('ONLY="${ONLY:-}"', 'REPS_OVERRIDE="${REPS:-}"', 'MAXTOK_OVERRIDE="${MAX_TOKENS:-}"',
                     'MINGEN_OVERRIDE="${MIN_GEN:-}"', "*-smoke-*) smoke=1;;", "FIRST_WARMUP=2 API=chat",
                     'RETRY_INCOMPLETE="${RETRY_INCOMPLETE:-0}"', 'FLOOR_WAIT="${FLOOR_WAIT-90}"',
                     'STOP_WAIT="${STOP_WAIT-30}"', 'IDLE_WAIT="${IDLE_WAIT-60}"', "check_only",
                     ">> \"$RES/meta.txt\"", "min_gen=900 conv_min_gen=0"):
            self.assertIn(want, self.sh)

    def test_readme_and_cmd_emit(self):
        md = gc.emit_readme(self.spec)
        self.assertIn("| q4kxl | llamacpp | q4kxl | A |", md)
        self.assertIn("SAMPLING`, `MIN_GEN`, `TAGS`, `SPEC_ROWS`, `STATUS_OUT", md)
        self.assertIn("conversation turns are not gated", md)                         # m1: off by default
        self.assertIn("INCOMPLETE", md)                                                 # m5
        camp = os.path.realpath(tempfile.mkdtemp(prefix="gc-multi-"))
        self.addCleanup(shutil.rmtree, camp, True)
        old = gc.REPO
        gc.REPO = camp
        self.addCleanup(setattr, gc, "REPO", old)
        quiet(cmd_emit_in, camp, multi_spec())
        d = os.path.join(camp, "campaigns", "perf", "2026-11-13-1200-multi")
        self.assertTrue(os.access(os.path.join(d, "run.sh"), os.X_OK))
        self.assertTrue(os.path.exists(os.path.join(d, "README.md")))


class MultiPythonSnippets(unittest.TestCase):
    """The identity / sentinel heredoc bodies, run directly as python on temp files (not via run.sh)."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="gc-snip-")
        self.addCleanup(shutil.rmtree, self.d, True)

    def py(self, src, *args):
        return subprocess.run([sys.executable, "-", *args], input=src, capture_output=True, text=True)

    def test_identity(self):
        f = write(os.path.join(self.d, "m.json"), json.dumps({"data": [{"id": "x"}]}))
        self.assertEqual(self.py(gc.IDENTITY_PY, f, "x").stdout, "")
        self.assertIn("expected exactly", self.py(gc.IDENTITY_PY, f, "y").stdout)
        write(f, json.dumps({"data": [{"id": "x"}, {"id": "z"}]}))
        self.assertIn("expected exactly", self.py(gc.IDENTITY_PY, f, "x").stdout)
        write(f, "not json")
        self.assertIn("unparseable", self.py(gc.IDENTITY_PY, f, "x").stdout)

    def sentinel(self, lad, sen, spec):
        rows = os.path.join(self.d, "results.jsonl")
        out = os.path.join(self.d, "drift.jsonl")
        agg = lambda label, dec, lo, hi: {"kind": "aggregate", "engine": "a", "label": label,   # noqa: E731
                                          "decode_tok_s_wall_p50": dec, "decode_tok_s_wall_min": lo,
                                          "decode_tok_s_wall_max": hi, "prefill_tok_s_wall_p50": 1000.0,
                                          "prefill_tok_s_wall_min": 990.0, "prefill_tok_s_wall_max": 1010.0}
        write(rows, json.dumps(agg("a-d32000-n1", *lad)) + "\n" + json.dumps(agg("a-sentinel-d32000", *sen)) + "\n")
        r = self.py(gc.SENTINEL_PY, rows, out, "a", "a-d32000-n1", "a-sentinel-d32000", spec, "5")
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout, json.loads(open(out).read().splitlines()[-1])

    def test_sentinel_non_spec_tolerance(self):
        out, rec = self.sentinel((50.0, 49, 51), (48.0, 48, 48), "0")      # -4 %: inside 5 %
        self.assertEqual(out, "")
        self.assertFalse(rec["decode_tok_s_wall"]["drift"])
        out, rec = self.sentinel((50.0, 49, 51), (46.0, 46, 46), "0")      # -8 %: drift
        self.assertIn("DRIFT a-sentinel-d32000: decode_tok_s_wall_p50", out)
        self.assertTrue(rec["decode_tok_s_wall"]["drift"])

    def test_sentinel_missing_rows_exit_2(self):
        rows = write(os.path.join(self.d, "results.jsonl"), json.dumps({"kind": "aggregate", "engine": "a",
                                                                          "label": "a-d32000-n1"}) + "\n")
        r = self.py(gc.SENTINEL_PY, rows, os.path.join(self.d, "drift.jsonl"), "a", "a-d32000-n1",
                    "a-sentinel-d32000", "0", "5")
        self.assertEqual(r.returncode, 2)                          # m2: the caller keeps the check pending
        self.assertFalse(os.path.exists(os.path.join(self.d, "drift.jsonl")))

    def test_sentinel_spec_uses_min_max(self):
        out, _ = self.sentinel((50.0, 40, 60), (42.0, 42, 42), "1")        # -16 % but inside min-max
        self.assertEqual(out, "")
        out, _ = self.sentinel((50.0, 40, 60), (39.0, 39, 39), "1")
        self.assertIn("outside the ladder cell's min-max", out)


class MultiFaultSeen(unittest.TestCase):
    """N2: fault_seen must see a fault early in a large log under pipefail (grep -q + SIGPIPE on the writer)."""

    def test_early_fault_in_large_log(self):
        m = re.search(r"^FAULT_RE=.*$", gc.MULTI_RUNSH_HEAD, re.M)
        f = re.search(r"^fault_seen \(\) \{.*?; \}$", gc.MULTI_RUNSH_HEAD, re.M | re.S)
        d = tempfile.mkdtemp(prefix="gc-fault-")
        self.addCleanup(shutil.rmtree, d, True)
        with open(os.path.join(d, "9999.log"), "w") as fh:
            fh.write("boot\nMemory Fault at 0x0\n" + "filler line after the fault\n" * 400000)
        sh = "set -uo pipefail\n%s\n%s\nCUR_CONTAINER=; CELL_OFF=0; SERVER_STATE_DIR=%s; CUR_PORT=9999\n" \
             "fault_seen && echo SEEN || echo MISSED\n" % (m.group(0), f.group(0), d)
        for _ in range(3):
            self.assertEqual(subprocess.run(["bash", "-c", sh], capture_output=True, text=True).stdout.strip(), "SEEN")


class MultiExample(unittest.TestCase):
    def test_example_flag_prints_valid_multi_spec(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "gen_campaign.py"), "example", "--multi-engine"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        spec = json.loads(r.stdout)
        self.assertEqual({s["engine"] for s in spec["servers"]}, {"llamacpp", "vllm", "radiance"})
        self.assertEqual(quiet(gc.validate_spec, spec), "README.md")
        bash_n(self, gc.emit_runsh(spec))


class GoldenSingleEngine(unittest.TestCase):
    """Additivity: every tracked throughput spec emits a byte-identical run.sh + README with the pre-G1
    generator (git 5e7c10b, exec'd in memory -- nothing written)."""
    BASE = "5e7c10b"

    @staticmethod
    def outcome(fn, spec):
        """fn's result, or how it failed: a spec the old generator already cannot handle (the hand-driven
        muse-glimmer llama-swap spec, rule 6 exception) must fail identically in the new one."""
        try:
            return fn(copy.deepcopy(spec))
        except SystemExit as e:
            return ("exit", e.code)
        except Exception as e:   # noqa: BLE001
            return ("raise", type(e).__name__, e.args)

    def test_tracked_throughput_specs_unchanged(self):
        import types
        root = gc.REPO
        try:
            src = subprocess.run(["git", "-C", root, "show", f"{self.BASE}:bench/core/gen_campaign.py"],
                                 capture_output=True, text=True, check=True).stdout
            files = subprocess.run(["git", "-C", root, "ls-files", "campaigns/**/spec.json"],
                                   capture_output=True, text=True, check=True).stdout.split()
        except (OSError, subprocess.CalledProcessError) as e:
            self.skipTest(f"git unavailable: {e}")
        old = types.ModuleType("gen_campaign_pre_g1")
        old.__file__ = gc.__file__
        exec(compile(src, gc.__file__, "exec"), old.__dict__)
        n = 0
        for rel in files:
            path = os.path.join(root, rel)
            with open(path) as fh:
                spec = json.load(fh)
            if spec.get("kind", "throughput") != "throughput":
                continue
            if not spec.get("date"):   # as cmd_emit resolves it
                m = __import__("re").fullmatch(r"(\d{4}-\d{2}-\d{2}-\d{4})-" + __import__("re").escape(spec["slug"]),
                                               os.path.basename(os.path.dirname(path)))
                spec["date"] = m.group(1) if m else "2026-01-01-0000"
            with self.subTest(spec=rel):
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(self.outcome(gc.validate_spec, spec), self.outcome(old.validate_spec, spec))
                    for fn in ("emit_runsh", "emit_readme"):
                        self.assertEqual(self.outcome(getattr(gc, fn), spec), self.outcome(getattr(old, fn), spec), fn)
                n += 1
        self.assertGreaterEqual(n, 19, "expected every tracked throughput spec to be compared")


# ======================================================================================
# G1 fix round (M5): the emitted multi-engine run.sh EXECUTED against stubs -- fake DRM sysfs, ss, curl,
# docker, amd-smi, gpu_exclusive, VRAM sampler, serve launchers and engine-bench. The real boot_diag.py
# records boots (CPU-only). Temp dirs and free high ports only: nothing reaches a GPU, docker or port 8000.
# ======================================================================================
MULTI_STUB_SERVE = r'''#!/usr/bin/env bash
# stub serve_{llamacpp,radiance}.sh: start/stop/print/logs against the fake world $W
set -u
verb=$1; P=$PORT; SD=$SERVER_STATE_DIR; mkdir -p "$SD"
mib () { echo $(( $(cat "$W/drm/card0/device/mem_info_vram_used") / 1048576 )); }
setmib () { echo $(( $1 * 1048576 )) > "$W/drm/card0/device/mem_info_vram_used"; }
case "$verb" in
  print) echo "# stub print engine=${RAD_FILE:+radiance}${LLAMA_SERVER:+llamacpp} port=$P"; exit 0;;
  logs) cat "$W/log-radiance-$P" 2>/dev/null; exit 0;;
  start)
    [ -f "$W/start_fail" ] && { echo "stub start failed" >&2; exit 1; }
    if [ -n "${LLAMA_SERVER:-}" ]; then
      echo llamacpp > "$W/engine-$P"
      served=$(sed -nE 's/.*--alias ([^ ]+).*/\1/p' <<<"$EXTRA_ARGS")
      echo "$LLAMA_SERVER -m $MODEL -c $CTX -np $NP -ctk $KV -ctv $KV $EXTRA_ARGS" > "$SD/$P.cmdline"
      echo "llama-server starting" > "$SD/$P.log"
    else
      echo radiance > "$W/engine-$P"
      served=$SERVED_NAME
      echo "docker run --name $CONTAINER_NAME -v $(dirname "$RAD_FILE"):/models:ro $IMAGE --model /models/$(basename "$RAD_FILE") --served-model-name $SERVED_NAME $EXTRA_ARGS" > "$SD/$P.cmdline"
      echo "$CONTAINER_NAME" >> "$W/containers"; echo "radiance starting" > "$W/log-$CONTAINER_NAME"
    fi
    [ -f "$W/wrong_model" ] && served=someone-else
    printf '{"data":[{"id":"%s"}]}' "$served" > "$W/models-$P.json"
    echo "$P" >> "$W/ports"
    echo "$(mib)" > "$W/vram-before-$P"; setmib $(( $(mib) + $(cat "$W/load_mib") ))
    echo "up"; exit 0;;
  stop)
    [ -f "$W/stop_keep_port" ] || { grep -vx "$P" "$W/ports" > "$W/ports.n"; mv "$W/ports.n" "$W/ports"; }
    [ -f "$W/stop_keep_vram" ] || { [ -f "$W/vram-before-$P" ] && setmib "$(cat "$W/vram-before-$P")"; }
    grep -vx "radiance-$P" "$W/containers" > "$W/c.n"; mv "$W/c.n" "$W/containers"
    echo "stopped $P"; exit 0;;
esac
exit 2
'''

MULTI_STUB_EB = r'''#!/usr/bin/env python3
# stub engine-bench/run.sh: records its env, then behaves per $W/eb-<SLUG> (ok | fault | fault-late | short | fail)
import json, os, re, sys, time
W = os.environ["W"]
if sys.argv[1:] == ["--capabilities"]:
    if not os.path.exists(os.path.join(W, "eb_nocaps")):
        print("engine-bench-capabilities: SAMPLING MIN_GEN TAGS SPEC_ROWS STATUS_OUT")
    sys.exit(0)
e = os.environ
slug = e["SLUG"]
arm, url, served = e["ENGINES_LIST"].split("|")
port = re.search(r":(\d+)/", url).group(1)
keep = ("SLUG", "ENGINES_LIST", "TAGS", "SAMPLING", "MIN_GEN", "SPEC_ROWS", "MODE", "REPS", "WARMUP", "MAX_TOKENS",
        "STATUS_OUT", "MAX_DEPTH")
with open(os.path.join(W, "eb.log"), "a") as fh:
    fh.write(json.dumps({k: e.get(k) for k in keep}) + "\n")
mode = open(os.path.join(W, "eb-" + slug)).read().strip() if os.path.exists(os.path.join(W, "eb-" + slug)) else "ok"


def fault():
    log = os.path.join(e["SERVER_STATE_DIR"], port + ".log")
    if open(os.path.join(W, "engine-" + port)).read().strip() == "radiance":
        log = os.path.join(W, "log-radiance-" + port)
    with open(log, "a") as fh:
        fh.write("HW Exception by GPU node-1: Memory Fault\n")


if mode == "fault":
    fault()
    time.sleep(60)
    sys.exit(0)
if mode == "fail":
    sys.exit(1)
if mode == "short":
    with open(e["STATUS_OUT"], "w") as fh:
        fh.write(json.dumps({"slug": slug, "ok": False, "short": True, "n_short": 2, "n_total": 3,
                             "min_gen": int(e.get("MIN_GEN") or 0), "failed": [arm]}) + "\n")
    sys.exit(3)
tags = dict(t.split("=", 1) for t in e.get("TAGS", "").split(",") if t)
row = {"kind": "aggregate", "label": slug, "engine": arm, **tags,
       "decode_tok_s_wall_p50": 50.0, "decode_tok_s_wall_min": 49.0, "decode_tok_s_wall_max": 51.0,
       "prefill_tok_s_wall_p50": 1000.0, "prefill_tok_s_wall_min": 990.0, "prefill_tok_s_wall_max": 1010.0}
os.makedirs(os.path.join(e["CAMPAIGN_DIR"], "results"), exist_ok=True)
with open(os.path.join(e["CAMPAIGN_DIR"], "results", "results.jsonl"), "a") as fh:
    fh.write(json.dumps(row) + "\n")
if mode == "fault-late":
    fault()
sys.exit(0)
'''

MULTI_STUB_TOOLS = {
    "ss": '#!/usr/bin/env bash\n[ -f "$W/ss_fail" ] && exit 1\necho "State Recv-Q Send-Q Local Address:Port Peer Address:Port"\n'
          'while read -r p; do [ -n "$p" ] && echo "LISTEN 0 128 0.0.0.0:$p 0.0.0.0:*"; done < "$W/ports"\nexit 0\n',
    "curl": '#!/usr/bin/env bash\nurl="${*: -1}"; p=$(sed -nE \'s#.*:([0-9]+)/v1/models#\\1#p\' <<<"$url")\n'
            '[ -n "$p" ] && [ -f "$W/models-$p.json" ] && grep -qx "$p" "$W/ports" && { cat "$W/models-$p.json"; exit 0; }\nexit 22\n',
    "docker": '#!/usr/bin/env bash\ncase "$1 $2" in\n'
              '  "image inspect") [ -f "$W/img_missing" ] && exit 1; echo "sha256:abcdef1234567890 "; exit 0;;\n'
              '  "ps -q") [ -f "$W/docker_ps_fail" ] && exit 1; n="${4#name=^}"; n="${n%\\$}"; '
              'grep -qx "$n" "$W/containers" && echo 0123456789ab; exit 0;;\n'
              '  "logs --since") cat "$W/log-$4" 2>/dev/null; exit 0;;\n'
              '  "logs "*) cat "$W/log-$2" 2>/dev/null; exit 0;;\nesac\nexit 0\n',
    "amd-smi": '#!/usr/bin/env bash\n[ -s "$W/containers" ] && { echo "GPU: 0"; echo "    VRAM_MEM: 17000 MB"; }\nexit 0\n',
    "gpu_exclusive": '#!/usr/bin/env bash\necho "stub gpu_exclusive floor=$1"\n[ -f "$W/gx_fail" ] && { echo "holder: pid 42" >&2; exit 1; }\nexit 0\n',
    "sampler.sh": '#!/usr/bin/env bash\nprintf "t,vram_used_mib\\n" > "$2"\nexec sleep 300\n',
}


class MultiStubRun(unittest.TestCase):
    """Runs the emitted run.sh for a llamacpp + a radiance server against stubs (no GPU / docker / port 8000)."""

    def setUp(self):
        sigint_default()
        self.sb = os.path.realpath(tempfile.mkdtemp(prefix="gc-stubrun-"))
        self.addCleanup(shutil.rmtree, self.sb, True)
        self.W = os.path.join(self.sb, "world")
        dev = os.path.join(self.W, "drm", "card0", "device")
        write(os.path.join(dev, "mem_info_vram_total"), str(32768 * 1048576))
        write(os.path.join(dev, "mem_info_vram_used"), str(1024 * 1048576))
        write(os.path.join(dev, "mem_info_gtt_used"), "0")
        for f in ("ports", "containers"):
            write(os.path.join(self.W, f), "")
        write(os.path.join(self.W, "load_mib"), "20000")
        st = os.path.join(self.sb, "stub")
        for name, body in MULTI_STUB_TOOLS.items():
            write(os.path.join(st, name), body, 0o755)
        write(os.path.join(st, "serve.sh"), MULTI_STUB_SERVE, 0o755)
        write(os.path.join(st, "eb", "run.sh"), MULTI_STUB_EB, 0o755)
        self.bin = write(os.path.join(self.sb, "builds", "b1-vulkan", "bin", "llama-server"), "#!/bin/sh\n", 0o755)
        self.gguf = write(os.path.join(self.sb, "models", "m.gguf"), "gguf weights\n")
        self.rad = write(os.path.join(self.sb, "models", "R@60bd4139", "m.rad"), "rad weights\n")
        for fx in ("fx-1000.txt", "fx-2000.txt", "fx-3000.txt", "fx-4000.txt", "conv.txt"):
            write(os.path.join(self.sb, "bench", "workloads", "tmp", fx), "x\n")
        self.p1, self.p2 = free_port(), free_port()
        while self.p2 == self.p1:
            self.p2 = free_port()
        assert 8000 not in (self.p1, self.p2)
        self.old = gc.REPO
        gc.REPO = self.sb
        self.addCleanup(setattr, gc, "REPO", self.old)

    def sha(self, path):
        import hashlib
        return hashlib.sha256(open(path, "rb").read()).hexdigest()

    def spec(self, pins=True, **over):
        s = {"slug": "stub", "date": "2026-11-13-1300",
             "sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0, "seed": 7},
             "workload": {"max_tokens": 16, "min_gen": 8, "fixture": "fx-{depth}.txt", "first_warmup": 1,
                          "ladder": {"depths": [1000, 2000, 3000, 4000], "reps": 1},
                          "conversation": {"prompt": "conv.txt", "start_tokens": 1000, "step_tokens": 1000,
                                           "max_depth": 3000, "max_tokens": 16},
                          "sentinel": {"depth": 1000, "tol_pct": 5}, "smoke": {"depth": 1000}},
             "servers": [
                 {"name": "ll", "engine": "llamacpp", "served_model": "m-ll", "gguf": self.gguf, "bin": self.bin,
                  "ctx": 8000, "np": 1, "kv": "q8_0", "port": self.p1, "working_set_mib": 15000,
                  "free_mib_floor": 20000},
                 {"name": "rd", "engine": "radiance", "served_model": "m-rd", "rad_file": self.rad,
                  "image": "stub/radiance:1.0", "spec_tokens": 0, "ctx": 8000, "np": 1, "kv": "fp8",
                  "port": self.p2, "working_set_mib": 16000, "free_mib_floor": 20000}]}
        if pins:
            s["pins"] = {"files": {self.gguf: self.sha(self.gguf), self.rad: self.sha(self.rad)},
                         "binaries": [self.bin], "images": {"stub/radiance:1.0": "sha256:abcdef123456"}}
        s.update(over)
        return s

    def emit(self, spec):
        quiet(cmd_emit_in, os.path.join(self.sb, "spec"), spec)
        self.camp = os.path.join(self.sb, "campaigns", "perf", f"{spec['date']}-{spec['slug']}")
        self.runsh = os.path.join(self.camp, "run.sh")
        return self.runsh

    def touch(self, name, text=""):
        write(os.path.join(self.W, name), text)

    def run_sh(self, timeout=120, **extra):
        st = os.path.join(self.sb, "stub")
        env = {k: v for k, v in os.environ.items()
               if k not in ("ONLY", "REPS", "MAX_TOKENS", "MIN_GEN", "RUN_TAG", "CAMPAIGN_DIR", "ENGINES_LIST")}
        env.update(W=self.W, ROOT=self.sb, EB=os.path.join(st, "eb"), SERVE_LLAMA=os.path.join(st, "serve.sh"),
                   SERVE_RAD=os.path.join(st, "serve.sh"), SERVE_VLLM=os.path.join(st, "serve.sh"),
                   GPU_EXCLUSIVE=os.path.join(st, "gpu_exclusive"),
                   BOOT_DIAG=os.path.join(HERE, os.pardir, "perf", "boot_diag.py"),
                   BOOT_VRAM_SAMPLER="bash " + os.path.join(st, "sampler.sh"),
                   SERVER_STATE_DIR=os.path.join(self.W, "state"), DRM_ROOT=os.path.join(self.W, "drm"),
                   DOCKER=os.path.join(st, "docker"), AMD_SMI=os.path.join(st, "amd-smi"),
                   CURL=os.path.join(st, "curl"), SS=os.path.join(st, "ss"), VLLM_CACHE_ROOT=os.path.join(self.W, "vc"),
                   FLOOR_WAIT="1", STOP_WAIT="1", IDLE_WAIT="1", WATCH_S="1")
        env.update(extra)
        return subprocess.run(["bash", self.runsh], env=env, capture_output=True, text=True, timeout=timeout)

    def res(self, name):
        p = os.path.join(self.camp, "results", name)
        return open(p).read() if os.path.exists(p) else ""

    def rows(self, name="results.jsonl"):
        return [json.loads(l) for l in self.res(name).splitlines() if l.strip()]

    def done(self):
        d = os.path.join(self.camp, "tmp", "done")
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def eb_calls(self):
        p = os.path.join(self.W, "eb.log")
        return [json.loads(l) for l in open(p)] if os.path.exists(p) else []

    # ------------------------------------------------------------------ tests
    def test_full_run_then_resume(self):
        self.emit(self.spec())
        r = self.run_sh()
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 0, out)
        self.assertIn("preflight OK", out)
        cells = ["ll-d1000-n1", "ll-d2000-n1", "ll-d3000-n1", "ll-d4000-n1", "ll-sentinel-d1000", "ll-conv",
                 "rd-d1000-n1", "rd-d2000-n1", "rd-d3000-n1", "rd-d4000-n1", "rd-sentinel-d1000", "rd-conv"]
        self.assertEqual([c["SLUG"] for c in self.eb_calls()], cells)                 # m3 order, no smoke
        for c in self.eb_calls():
            arm = c["SLUG"].split("-")[0]
            port = self.p1 if arm == "ll" else self.p2
            self.assertEqual(c["ENGINES_LIST"], f"{arm}|http://localhost:{port}/v1|m-{arm}")   # set, never inherited
            self.assertIn("residency=ok", c["TAGS"])
            self.assertEqual(c["SPEC_ROWS"], "rows" if arm == "ll" else "diff")
            self.assertEqual(c["MIN_GEN"], "0" if c["SLUG"].endswith("-conv") else "8")   # conv gate off by default
            self.assertIn(f"rep_key={'repeat_penalty' if arm == 'll' else 'UNVERIFIED'}", c["TAGS"])
            self.assertEqual(c["WARMUP"], "1" if c["SLUG"].endswith("d1000-n1") else ("0" if c["MODE"] is None else None))
        self.assertIn('"repeat_penalty":1.0', self.eb_calls()[0]["SAMPLING"])
        self.assertNotIn("penalty", self.eb_calls()[-1]["SAMPLING"])                # radiance: UNVERIFIED, none sent
        self.assertEqual(self.done(), sorted(cells + ["ll-sentinel-d1000.drift", "rd-sentinel-d1000.drift"]))
        boots = self.rows("boots.jsonl")
        self.assertEqual([(b["slug"], b["engine"]) for b in boots], [("ll", "llamacpp"), ("rd", "radiance")])
        resid = {d["arm"]: d for d in self.rows("residency.jsonl")}
        self.assertEqual((resid["ll"]["source"], resid["ll"]["residency_mib"], resid["ll"]["status"]),
                         ("vram_delta", 20000, "ok"))                                    # Vulkan llama: no amd-smi row
        self.assertEqual((resid["rd"]["source"], resid["rd"]["residency_mib"]), ("amd-smi", 17000))
        self.assertEqual([d["drift"] if "drift" in d else d["decode_tok_s_wall"]["drift"] for d in self.rows("drift.jsonl")],
                         [False, False])
        for slug in ("ll", "rd"):
            stop = open(os.path.join(self.camp, "tmp", f"stop-{slug}.txt")).read()
            self.assertIn("port_free=yes vram_idle=yes", stop)
            self.assertIn("## before", self.res(f"power-{slug}.txt"))
            self.assertIn("## after", self.res(f"power-{slug}.txt"))
        self.assertEqual(self.res("failures.txt"), "")
        self.assertEqual(open(os.path.join(self.W, "ports")).read().strip(), "")       # everything stopped
        # resume: nothing pending -> no boot, no probe, one more invocation line in meta.txt
        n_eb, n_boot = len(self.eb_calls()), len(boots)
        r = self.run_sh()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((len(self.eb_calls()), len(self.rows("boots.jsonl"))), (n_eb, n_boot))
        self.assertIn("skip: server ll", r.stdout)
        self.assertEqual(self.res("meta.txt").count("invocation="), 2)              # m10

    def test_resume_reboots_only_for_pending_cells_and_runs_pending_drift(self):
        self.emit(self.spec())
        self.touch("eb-ll-d3000-n1", "fail")
        r = self.run_sh(ONLY="ll-*")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("ll-smoke-d1000", [c["SLUG"] for c in self.eb_calls()])   # 'll-*' does not say smoke
        self.assertIn("FAILED: ll-d3000-n1", self.res("failures.txt"))
        self.assertNotIn("ll-d3000-n1", self.done())
        os.remove(os.path.join(self.W, "eb-ll-d3000-n1"))
        os.remove(os.path.join(self.camp, "tmp", "done", "ll-sentinel-d1000.drift"))   # a crash before the check
        n = len(self.eb_calls())
        r = self.run_sh(ONLY="ll-*")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([c["SLUG"] for c in self.eb_calls()[n:]], ["ll-d3000-n1"])   # only the pending cell
        self.assertIn("ll-sentinel-d1000.drift", self.done())                          # m2: the check ran on resume

    def test_boot_gate_refusal(self):
        self.emit(self.spec())
        write(os.path.join(self.W, "drm", "card0", "device", "mem_info_vram_used"), str(30000 * 1048576))
        r = self.run_sh(ONLY="ll-d1000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        f = self.res("failures.txt")
        self.assertIn("BOOT REFUSED ll:", f)
        self.assertIn("free_mib=2768; floor_mib=20000", f)
        self.assertEqual(self.eb_calls(), [])
        self.assertEqual(self.rows("boots.jsonl"), [])                                 # no boot attempted
        self.assertFalse(os.path.exists(os.path.join(self.W, "state", f"{self.p1}.cmdline")))
        # gpu_exclusive refusing is a refusal too
        write(os.path.join(self.W, "drm", "card0", "device", "mem_info_vram_used"), str(1024 * 1048576))
        self.touch("gx_fail")
        r = self.run_sh(ONLY="ll-d1000-n1")
        self.assertIn("gpu_exclusive.sh refused", self.res("failures.txt"))
        self.assertEqual(self.eb_calls(), [])

    def test_preflight_refusals(self):
        self.emit(self.spec())
        self.touch("ports", f"{self.p1}\n")                                             # someone holds the port
        r = self.run_sh()
        self.assertEqual(r.returncode, 1)
        self.assertIn(f"RUN REFUSED: port {self.p1} is held", r.stderr)
        self.touch("ports", "")
        self.touch("ss_fail")                                                           # m8: ss failing = held
        r = self.run_sh()
        self.assertEqual(r.returncode, 1)
        self.assertIn("is held", r.stderr)
        os.remove(os.path.join(self.W, "ss_fail"))
        self.touch("eb_nocaps")                                                         # M1: real capability check
        r = self.run_sh()
        self.assertEqual(r.returncode, 1)
        self.assertIn("--capabilities lacks SAMPLING", r.stderr)
        os.remove(os.path.join(self.W, "eb_nocaps"))
        r = self.run_sh(FLOOR_WAIT="")                                                  # m10
        self.assertEqual(r.returncode, 1)
        self.assertIn("FLOOR_WAIT='' must be a non-negative integer", r.stderr)
        r = self.run_sh(ONLY="nosuch-*")                                                # m4: a typo selects nothing
        self.assertEqual(r.returncode, 1)
        self.assertIn("ONLY glob 'nosuch-*' matches no cell", r.stderr)
        self.assertEqual(self.eb_calls(), [])

    def test_unpinned_refused_unless_smoke_only(self):
        self.emit(self.spec(pins=False))
        r = self.run_sh(ONLY="ll-d1000-n1")
        self.assertEqual(r.returncode, 1)
        self.assertIn("PIN-FAIL: unpinned", r.stderr)
        r = self.run_sh(ONLY="*-smoke-*")                                               # m12: smoke may run unpinned
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([c["SLUG"] for c in self.eb_calls()],
                         ["ll-smoke-d1000", "ll-smoke-conv", "rd-smoke-d1000", "rd-smoke-conv"])
        self.assertIn("tier=smoke", self.eb_calls()[0]["TAGS"])
        self.assertEqual(self.eb_calls()[1]["MAX_DEPTH"], "1000")                      # one-turn conversation

    def test_fault_during_cell_aborts(self):
        self.emit(self.spec())
        self.touch("eb-ll-d2000-n1", "fault")
        r = self.run_sh()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MEMORY-FAULT on llamacpp server ll during cell ll-d2000-n1", self.res("failures.txt"))
        self.assertEqual(self.done(), ["ll-d1000-n1"])
        self.assertEqual([c["SLUG"] for c in self.eb_calls()], ["ll-d1000-n1", "ll-d2000-n1"])   # run aborted
        self.assertEqual(open(os.path.join(self.W, "ports")).read().strip(), "")       # server stopped
        self.assertEqual([b["slug"] for b in self.rows("boots.jsonl")], ["ll"])       # rd never booted

    def test_fault_at_cell_end_quarantines_rows(self):
        self.emit(self.spec())
        self.touch("eb-rd-d1000-n1", "fault-late")                                     # m7: the container path
        r = self.run_sh(ONLY="rd-*")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("MEMORY-FAULT on radiance server rd at the end of cell rd-d1000-n1", self.res("failures.txt"))
        self.assertEqual([d["label"] for d in self.rows()], [])
        self.assertEqual([d["label"] for d in self.rows("quarantine.jsonl")], ["rd-d1000-n1"])
        self.assertEqual(self.done(), [])
        self.assertEqual(open(os.path.join(self.W, "containers")).read().strip(), "")

    def test_stop_verify_failure_blocks_the_next_boot(self):
        self.emit(self.spec())
        self.touch("stop_keep_port")
        self.touch("stop_keep_vram")
        r = self.run_sh(ONLY="ll-d1000-n1,rd-d1000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        f = self.res("failures.txt")
        self.assertIn(f"WARN: port {self.p1} still held (or ss failed) after stopping ll", f)
        self.assertIn("WARN: VRAM not idle after stopping ll (21024 MiB > pre-boot 1024 + 1024)", f)
        self.assertIn("BOOT REFUSED rd:", f)                                            # VRAM still held by ll
        self.assertEqual([c["SLUG"] for c in self.eb_calls()], ["ll-d1000-n1"])
        stop = open(os.path.join(self.camp, "tmp", "stop-ll.txt")).read()
        self.assertIn("port_free=no vram_idle=no", stop)

    def test_docker_ps_failure_is_unknown_not_gone(self):
        self.emit(self.spec())
        self.touch("docker_ps_fail")
        r = self.run_sh(ONLY="rd-d1000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("container radiance-%d state unknown after stopping rd (docker ps failed)" % self.p2,
                      self.res("failures.txt"))
        self.assertIn("container_gone=unknown", open(os.path.join(self.camp, "tmp", "stop-rd.txt")).read())

    def test_low_residency_is_stamped_on_rows(self):
        self.emit(self.spec())
        self.touch("load_mib", "5000")
        r = self.run_sh(ONLY="ll-d1000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("ll residency 5000 MiB (vram_delta) < expected working set 15000 MiB", self.res("failures.txt"))
        self.assertEqual(self.rows()[0]["residency"], "low")                            # m6: the row says so
        self.assertEqual(self.rows("residency.jsonl")[0]["status"], "low")

    def test_identity_mismatch_skips_the_server(self):
        self.emit(self.spec())
        self.touch("wrong_model")
        r = self.run_sh(ONLY="ll-d1000-n1,rd-d1000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        f = self.res("failures.txt")
        self.assertIn("IDENTITY-FAILED ll: /v1/models lists ['someone-else'], expected exactly ['m-ll']", f)
        self.assertIn("IDENTITY-FAILED rd:", f)
        self.assertEqual(self.eb_calls(), [])
        self.assertEqual(open(os.path.join(self.W, "ports")).read().strip(), "")       # both stopped again
        os.remove(os.path.join(self.W, "wrong_model"))                                  # a cmdline needle missing
        self.emit(self.spec())
        with open(os.path.join(self.sb, "stub", "serve.sh")) as fh:
            body = fh.read()
        write(os.path.join(self.sb, "stub", "serve.sh"), body.replace("-m $MODEL", "-m /elsewhere.gguf"), 0o755)
        r = self.run_sh(ONLY="ll-d1000-n1")
        self.assertIn(f"lacks '{self.gguf}'", self.res("failures.txt"))
        self.assertEqual(self.eb_calls(), [])

    def test_short_cell_stops_incomplete_without_retry(self):
        self.emit(self.spec())
        self.touch("eb-ll-d2000-n1", "short")
        r = self.run_sh(ONLY="ll-d1000-n1,ll-d2000-n1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        f = self.res("failures.txt")
        self.assertIn("INCOMPLETE ll-d2000-n1: n_short=2 of 3 below min_gen 8", f)
        self.assertIn("NOT retried", f)
        self.assertEqual(self.done(), ["ll-d1000-n1", "ll-d2000-n1.incomplete"])
        n = len(self.eb_calls())
        r = self.run_sh(ONLY="ll-d1000-n1,ll-d2000-n1")                                # no silent retry, no boot
        self.assertEqual(len(self.eb_calls()), n)
        self.assertIn("skip: server ll", r.stdout)
        os.remove(os.path.join(self.W, "eb-ll-d2000-n1"))
        r = self.run_sh(ONLY="ll-d2000-n1", RETRY_INCOMPLETE="1")                       # deliberate retry
        self.assertEqual([c["SLUG"] for c in self.eb_calls()[n:]], ["ll-d2000-n1"])
        self.assertEqual(self.done(), ["ll-d1000-n1", "ll-d2000-n1"])


if __name__ == "__main__":
    unittest.main(warnings="ignore")
