#!/usr/bin/env python3
"""Unit + stub end-to-end tests for gen_campaign.py (vllm `env`, `kind: "agentic"`).

Run:  python3 bench/test_gen_campaign.py -v

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
        self.run_dir = os.path.join(T, "run")
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
        e = dict(os.environ, HOME=self.home, RUN_DIR=self.run_dir, STUB_DIR=self.stubdir,
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
        path = os.path.join(self.run_dir, "summary.tsv")
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
        return open(os.path.join(self.run_dir, *parts)).read()

    def lines(self, name):
        p = os.path.join(self.stubdir, name)
        return open(p).read().splitlines() if os.path.exists(p) else []


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
        old = gc.CAMPAIGNS
        gc.CAMPAIGNS = camp
        self.addCleanup(setattr, gc, "CAMPAIGNS", old)
        sp = write(os.path.join(self.T, "spec.json"), json.dumps(self.spec))

        class A: pass
        a = A(); a.spec = sp; a.force = False; a.print = False
        with contextlib.redirect_stdout(io.StringIO()):
            gc.cmd_emit(a)
        d = os.path.join(camp, "2026-01-01-agtest")
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
        self.assertFalse(os.path.exists(self.run_dir + "/failures.txt"))
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
        shutil.rmtree(self.run_dir)
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
        self.assertIn('SERVE_LLAMASWAP="${SERVE_LLAMASWAP:-$EB/serve_llamaswap.sh}"', sh)
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
        self.assertFalse(os.path.exists(self.run_dir + "/failures.txt"))
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
        self.assertFalse(os.path.exists(self.run_dir + "/failures.txt"), self.out)
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
        self.assertTrue(os.path.exists(self.run_dir + "/failures.txt"))

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


if __name__ == "__main__":
    unittest.main(warnings="ignore")
