#!/usr/bin/env python3
"""test_drivers.py — driver tests for the bench/quality shell drivers (no GPU, no server, no network).

  python3 -m pytest bench/quality -q

(a) `bash -n` every shell script the two-root driver layout changed.
(b) run bench/quality/run_capture.sh on a synthetic campaign dir under pytest's tmp_path and assert
    the validation failures: missing campaign dir / campaign.env / configs.jsonl / inputs/tasks.jsonl
    all exit non-zero with a clear message (before any tmux/server step is reached).
(b2) an environment variable (JUDGE_ENGINE) set by the caller wins over the same key in campaign.env —
    probed via the fail-fast tmux check (exit 3), which only fires when the caller's value won.
(c) each new campaign.env is parseable: whole-line comments or KEY=value lines, no command
    substitution / shell expansion, non-empty values (a trailing "  # comment" is allowed and stripped).

The synthetic campaign is built under tmp_path — never a real campaign dir.
"""
import os
import re
import subprocess
from pathlib import Path

Q = Path(__file__).resolve().parent
REPO = Q.parent.parent

DRIVER = REPO / "bench" / "quality" / "run_capture.sh"

SHELL_SCRIPTS = [
    "bench/quality/run_capture.sh",
    "bench/quality/run_repair.sh",
    "bench/quality/run_refs.sh",
    "bench/quality/claude_ask.sh",
    "campaigns/quality/2026-07-12-1736-27b-finetune-quality/run_capture.sh",
    "campaigns/quality/2026-07-12-1736-27b-finetune-quality/run.sh",
    "campaigns/quality/2026-07-13-1138-27b-quality-tuning/run_capture.sh",
]

CAMPAIGN_ENVS = [
    "campaigns/quality/2026-07-13-1657-27b-quality-at-depth/campaign.env",
    "campaigns/quality/2026-07-14-0000-hardest-tasks-27b-vs-35b/campaign.env",
    "campaigns/quality/2026-07-19-0000-ornith-vs-gemma/campaign.env",
]

# keys the driver sources from campaign.env (the old per-campaign driver copies patched these in)
KNOWN_ENV_KEYS = {
    "TITLE", "JUDGE_ENGINE", "SUMMARY", "MODELS_DIR", "REPS", "CALIB",
    "PORT", "BACKEND", "UB", "B", "WAIT", "CONFIGS",
    "JUDGE_MODEL", "JUDGE_SUBAGENT_MODEL", "SUMMARY_MODEL", "CLAUDE_TMUX_SESSION",
}


def run(*args, env=None):
    e = {**os.environ}
    e.pop("CAMPAIGN_DIR", None)   # the arg form must not be shadowed by a stray env var
    if env:
        e.update(env)
    return subprocess.run(list(args), capture_output=True, text=True, env=e, timeout=120)


# --- (a) shell syntax ---------------------------------------------------------------

def test_shell_scripts_parse():
    for rel in SHELL_SCRIPTS:
        p = REPO / rel
        assert p.is_file(), f"missing {rel}"
        r = run("bash", "-n", str(p))
        assert r.returncode == 0, f"bash -n {rel} failed:\n{r.stderr}"


# --- (b) driver validation failures ----------------------------------------------------

def _campaign(tmp_path, with_env=True, with_configs=True, with_tasks=True):
    d = tmp_path / "camp"
    (d / "inputs").mkdir(parents=True)
    if with_env:
        (d / "campaign.env").write_text(
            "TITLE=test\nJUDGE_ENGINE=none\nSUMMARY=0\nREPS=1\nMODELS_DIR=/nonexistent\n")
    if with_configs:
        (d / "configs.jsonl").write_text("")   # empty matrix: never reached in these tests
    if with_tasks:
        (d / "inputs" / "tasks.jsonl").write_text('{"id": "t1", "matrix": true}\n')
    return d


def test_missing_campaign_dir(tmp_path):
    r = run("bash", str(DRIVER), str(tmp_path / "no-such-campaign"))
    assert r.returncode != 0
    assert "not found" in r.stderr


def test_missing_campaign_env(tmp_path):
    d = _campaign(tmp_path, with_env=False)
    r = run("bash", str(DRIVER), str(d))
    assert r.returncode != 0
    assert "campaign.env" in r.stderr


def test_missing_configs(tmp_path):
    d = _campaign(tmp_path, with_configs=False)
    r = run("bash", str(DRIVER), str(d))
    assert r.returncode != 0
    assert "configs.jsonl" in r.stderr


def test_missing_tasks(tmp_path):
    d = _campaign(tmp_path, with_tasks=False)
    r = run("bash", str(DRIVER), str(d))
    assert r.returncode != 0
    assert "inputs/tasks.jsonl" in r.stderr


# --- (b2) environment wins over campaign.env ------------------------------------------

def test_env_overrides_campaign_env(tmp_path):
    # campaign.env says JUDGE_ENGINE=none; the caller says claude-tmux. If the caller's value wins,
    # the driver fail-fasts on the missing tmux session (exit 3) before any capture step. If
    # campaign.env won, JUDGE_ENGINE would be none and the driver would sail past this check.
    d = _campaign(tmp_path)
    r = run("bash", str(DRIVER), str(d),
            env={"JUDGE_ENGINE": "claude-tmux", "CLAUDE_TMUX_SESSION": "no-such-session-xyz"})
    assert r.returncode == 3
    assert "tmux" in r.stderr


# --- (c) campaign.env files -----------------------------------------------------------

def test_campaign_env_files_parseable():
    for rel in CAMPAIGN_ENVS:
        p = REPO / rel
        assert p.is_file(), f"missing {rel}"
        keys = set()
        for i, line in enumerate(p.read_text().splitlines(), 1):
            if not line.strip():
                continue
            if line.lstrip().startswith("#"):
                continue
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
            assert m, f"{rel}:{i}: not KEY=value: {line!r}"
            key, val = m.group(1), m.group(2)
            keys.add(key)
            assert "$(" not in val and "`" not in val and "\\" not in val, \
                f"{rel}:{i}: no command substitution / shell expansion in values"
            cm = re.search(r"\s+#.*$", val)   # a trailing comment must follow whitespace
            if cm:
                val = val[:cm.start()]
            assert val.strip(), f"{rel}:{i}: {key} has an empty value (comment-only line?)"
        assert keys, f"{rel}: no KEY=value lines"
        assert keys <= KNOWN_ENV_KEYS, f"{rel}: unknown keys {keys - KNOWN_ENV_KEYS}"


# --- (d) the driver's OWN campaign.env loop (bash), not just the Python reading above ---------

def _driver_env(env_file, extra_env=None):
    """Run the driver's campaign.env loop, cut verbatim from run_capture.sh, on env_file; return its vars."""
    src = DRIVER.read_text().splitlines()
    s = next(i for i, l in enumerate(src) if l.startswith("while IFS= read -r _line"))
    e = next(i for i, l in enumerate(src) if l.startswith('done < "$ENV_FILE"'))
    keys = ["TITLE", "JUDGE_ENGINE", "SUMMARY", "REPS", "CALIB", "MODELS_DIR", "TABBED", "HASH"]
    script = "\n".join(["set -uo pipefail", 'ENV_FILE="$1"', *src[s:e + 1],
                        *[f'printf "%s\\t%s\\n" {k} "${{{k}-<unset>}}"' for k in keys]])
    r = run("bash", "-c", script, "parse", str(env_file), env=extra_env)
    return r, dict(l.split("\t", 1) for l in r.stdout.splitlines())


def test_driver_strips_comments_and_whitespace(tmp_path):
    f = tmp_path / "campaign.env"
    f.write_text("TITLE=Ornith vs Gemma at 128k\nJUDGE_ENGINE=none    # scaffold default\n# comment\n\n"
                 "SUMMARY=0\t# tab comment\nTABBED=val\t\nHASH=a#b\nREPS=3\n")
    r, v = _driver_env(f)
    assert r.returncode == 0, r.stderr
    assert v == {"TITLE": "Ornith vs Gemma at 128k", "JUDGE_ENGINE": "none", "SUMMARY": "0", "REPS": "3",
                 "CALIB": "<unset>", "MODELS_DIR": "<unset>", "TABBED": "val", "HASH": "a#b"}
    r, v = _driver_env(f, extra_env={"REPS": "1"})
    assert v["REPS"] == "1"                     # the caller's environment wins


def test_driver_rejects_a_bad_key(tmp_path):
    f = tmp_path / "campaign.env"
    f.write_text("BAD KEY=x\n")
    r, _ = _driver_env(f)
    assert r.returncode == 2 and "bad key" in r.stderr


def test_driver_reads_each_campaign_env_as_written():
    for rel in CAMPAIGN_ENVS:
        _, v = _driver_env(REPO / rel)
        for line in (REPO / rel).read_text().splitlines():
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*?)(\s+#.*)?$", line)
            if m and m.group(1) in v and not os.environ.get(m.group(1)):
                assert v[m.group(1)] == m.group(2).rstrip(), f"{rel}: {m.group(1)}"
