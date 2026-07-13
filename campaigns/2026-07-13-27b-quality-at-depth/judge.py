#!/usr/bin/env python3
"""judge.py — blind LLM judge for the quality-at-depth TS eval.

Functional correctness is graded deterministically by score_typescript.py (tsc/eslint/vitest). This
adds the SUBJECTIVE axes a toolchain can't measure — design, clarity, robustness (0-5) — by asking a
judge model to review each candidate. **Blind:** the prompt never reveals which config/model produced
the answer. Works against any OpenAI-compatible endpoint (hosted API or a strong local model).

Because the 27B under test IS the strongest LOCAL model, the judge is Claude. --engine claude-tmux does
NOT boot claude per reply: it runs ONE interactive claude session (via the tmux gateway claude_ask.sh;
headless/background is restricted here) that FANS OUT one blind judge subagent per batch of candidates,
in parallel — the fan-out is for PARALLELISM, not to save model strength. The subagent model must still
clear the judging bar: it reviews opus-tier design/robustness, so it defaults to a STRONG single model
(opus) — one model for every candidate keeps the 0-5 score scale internally consistent across tiers.
Python does the deterministic prep + parsing on either side. Or use any stronger hosted model per-reply
(--engine http).
Human-readable rubric + run modes: JUDGE.md (kept in sync with this file). Saves BOTH the parsed scores
(--out judge_scores.jsonl: config/task_id/rep/design/clarity/robustness/notes) AND the raw verdict
(--raw judge_raw.jsonl) so every judgement is committable + auditable. Resumable: (config,task_id,rep)
already in --out are skipped; subagents also skip candidates whose verdict file already exists.

  # Claude via tmux (local box, 27B is the best local model) — needs a tmux session (see claude_ask.sh):
  python3 judge.py --engine claude-tmux --outputs out/outputs.jsonl --tasks tasks.jsonl \
      --model opus --subagent-model opus --out out/judge_scores.jsonl --raw out/judge_raw.jsonl
  # or a hosted OpenAI-compatible endpoint:
  JUDGE_API_KEY=... python3 judge.py --engine http --base-url https://api.example/v1 --model my-judge \
      --outputs out/outputs.jsonl --tasks tasks.jsonl --out out/judge_scores.jsonl --raw out/judge_raw.jsonl
"""
import argparse, json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from score_typescript import extract_files            # reuse the exact same code-block parser
# claude_ask.sh drives an INTERACTIVE claude in tmux (typed like a human), so we stage the per-call
# prompt/result files inside the repo tree and run claude with --cwd HERE. Staying inside the (already
# trusted) repo avoids the folder-trust dialog and makes RESULT an in-workspace edit that acceptEdits
# auto-approves. Blindness is preserved regardless: the candidate's model/config never appears in the
# prompt — the repo CLAUDE.md that loads carries no clue about which cell produced the code.
JUDGE_IO = os.path.join(HERE, "out", ".judge-io")

THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
AXES = ["design", "clarity", "robustness"]
RUBRIC = (
    "You are a strict senior TypeScript reviewer. A candidate solved the task below; its functional "
    "correctness, types, lint and tests are ALREADY machine-graded — do NOT re-score those. Judge only "
    "the SUBJECTIVE engineering quality on three axes, each 0-5 (5 = excellent, 0 = poor):\n"
    "  design      — right abstraction, single-responsibility, no over/under-engineering\n"
    "  clarity     — readable, well-named, easy to follow; comments only where they earn their place\n"
    "  robustness  — anticipates edge cases and failure modes beyond the literal spec\n"
    "Reply with ONLY a JSON object: {\"design\":N,\"clarity\":N,\"robustness\":N,\"notes\":\"<=1 sentence\"}."
)


def read_spec(task_id):
    p = os.path.join(HERE, "ts-harness", "tasks", task_id, "spec.md")
    return open(p).read() if os.path.exists(p) else f"(spec for {task_id} not found)"


def judge_prompt(task_id, answer_code):
    return (f"{RUBRIC}\n\n[TASK SPEC]\n{read_spec(task_id)}\n\n"
            f"[CANDIDATE SOLUTION]\n{answer_code}\n")


def call_http(base, model, key, prompt, timeout=300):
    payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "max_tokens": 512}
    if model:
        payload["model"] = model
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions",
                                 data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        obj = json.loads(r.read().decode())
    return obj["choices"][0]["message"]["content"]


# --- claude-tmux path: ONE interactive claude session that FANS OUT judge subagents ---------------
# We don't boot claude per reply. Python does the deterministic prep (extract each candidate's code,
# split into batch manifests), then a SINGLE claude session (via the tmux gateway) fans out one judge
# subagent per batch to score them IN PARALLEL. The fan-out buys parallelism, not cheapness: the subagent
# defaults to a strong model (opus) because it reviews opus-tier design/robustness, and one model judges
# every candidate so the 0-5 scale stays consistent across tiers. Each subagent is blind (sees only spec
# + code). Python re-collects and parses the verdict files, so the fragile bit stays deterministic.
ORCH = """You are orchestrating a BLIND TypeScript code-review judging pass. Do NOT review any code
yourself — your ONLY job is to fan out subagents and make sure every verdict file gets written.

Paths (relative to the current directory):
  out/.judge-io/rubric.txt        the scoring rubric (0-5 on design, clarity, robustness)
  out/.judge-io/batches/*.jsonl   {n} batch files; each line is one candidate: {{"id":..., "spec":<path>, "code":<path>}}
  out/.judge-io/results/          write verdicts here, one <id>.json per candidate

For EACH of the {n} batch files, launch ONE subagent with the Task tool (model "{sub}", subagent_type
"general-purpose"), all in parallel. Instruct each subagent to do exactly this for its one batch file:

  1. Read out/.judge-io/rubric.txt.
  2. For EVERY candidate line in its batch file:
     - if out/.judge-io/results/<id>.json already exists and is non-empty, skip that candidate;
     - otherwise read the candidate's `spec` file and `code` file, score it per the rubric, and write
       ONLY a JSON object {{"design":N,"clarity":N,"robustness":N,"notes":"<=1 sentence"}} to
       out/.judge-io/results/<id>.json  (<id> is that candidate's id). Write nothing else to that file.
  3. The review is BLIND: it sees only the spec and the code, never which model/config produced it.

When all subagents have finished, verify out/.judge-io/results/ holds one <id>.json for every candidate
id across all batch files; re-dispatch a subagent for any that are missing. Then write a one-line
confirmation ("judged <count> candidates") as your final answer — that is what the harness collects.
"""


def prepare_fanout(outputs_path, tiers, done, io_dir, batch_size):
    """Deterministic prep: write each pending candidate's code to a file, the rubric to a file, and split
    the work into batch manifests. Returns (items, n_batches)."""
    cand, res, bat = (os.path.join(io_dir, d) for d in ("candidates", "results", "batches"))
    for d in (cand, res, bat):
        os.makedirs(d, exist_ok=True)
    for f in os.listdir(bat):                                   # clear stale batches from a prior run
        os.remove(os.path.join(bat, f))
    items = []
    with open(outputs_path) as fh:
        for l in fh:
            if not l.strip():
                continue
            o = json.loads(l)
            cfg, tid, rep = o.get("config"), o.get("task_id"), o.get("rep", 0)
            if o.get("error") or not o.get("response") or (cfg, tid, rep) in done:
                continue
            files = extract_files(THINK_RE.sub("", o["response"]))
            if not files:
                continue
            cid = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{cfg}__{tid}__rep{rep}")
            with open(os.path.join(cand, cid + ".txt"), "w") as cf:
                cf.write("\n\n".join(f"// FILE: {p}\n{c}" for p, c in files.items()))
            items.append({"id": cid, "config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"),
                          "spec": f"ts-harness/tasks/{tid}/spec.md", "code": f"out/.judge-io/candidates/{cid}.txt"})
    nb = 0
    for i in range(0, len(items), batch_size):
        with open(os.path.join(bat, f"batch-{nb:03d}.jsonl"), "w") as bf:
            for it in items[i:i + batch_size]:
                bf.write(json.dumps({"id": it["id"], "spec": it["spec"], "code": it["code"]}) + "\n")
        nb += 1
    with open(os.path.join(io_dir, "rubric.txt"), "w") as rf:
        rf.write(RUBRIC + "\n")
    return items, nb


def run_claude_once(prompt_text, result_path, model, timeout):
    """One interactive claude session via the tmux gateway (claude_ask.sh)."""
    os.makedirs(os.path.dirname(result_path), exist_ok=True)
    pf = os.path.join(os.path.dirname(result_path), "orch_prompt.txt")
    with open(pf, "w") as f:
        f.write(prompt_text)
    cmd = [os.path.join(HERE, "claude_ask.sh"), "--prompt", pf, "--result", result_path, "--cwd", HERE]
    if model:
        cmd += ["--model", model]
    env = dict(os.environ, CLAUDE_ASK_TIMEOUT=str(timeout))
    return subprocess.run(cmd, env=env).returncode


def collect_fanout(items, io_dir, out_path, raw_path):
    """Read each subagent's verdict file, parse it (robust), and write the score rows + raw audit."""
    res = os.path.join(io_dir, "results")
    fout = open(out_path, "a"); fraw = open(raw_path, "a") if raw_path else None
    ok = miss = bad = 0
    for it in items:
        rp = os.path.join(res, it["id"] + ".json")
        if not os.path.exists(rp) or os.path.getsize(rp) == 0:
            miss += 1; print(f"  MISSING verdict: {it['id']}", file=sys.stderr); continue
        with open(rp) as f:
            raw = f.read()
        if fraw:
            fraw.write(json.dumps({"config": it["config"], "task_id": it["task_id"], "rep": it["rep"],
                                   "code": it["code"], "raw": raw}) + "\n")
        sc = parse_scores(raw)
        if not sc:
            bad += 1; print(f"  UNPARSEABLE verdict: {it['id']}", file=sys.stderr); continue
        fout.write(json.dumps({"config": it["config"], "task_id": it["task_id"], "rep": it["rep"],
                               "tier": it["tier"], **sc}) + "\n")
        ok += 1
    fout.close()
    if fraw:
        fraw.close()
    print(f"collected {ok}/{len(items)} verdicts ({miss} missing, {bad} unparseable) -> {out_path}", file=sys.stderr)
    return ok


def parse_scores(text):
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    out = {}
    for a in AXES:
        v = d.get(a)
        if isinstance(v, (int, float)):
            out[a] = max(0, min(5, float(v)))
    if not out:
        return None
    out["notes"] = str(d.get("notes", ""))[:300]
    return out


def judge_http(a, tiers, done):
    """Per-reply loop against any OpenAI-compatible endpoint (a hosted/remote stronger model)."""
    key = os.environ.get(a.key_env, "")
    n = ok = 0
    fout = open(a.out, "a"); fraw = open(a.raw, "a") if a.raw else None
    for l in open(a.outputs):
        if not l.strip():
            continue
        o = json.loads(l)
        cfg, tid, rep = o.get("config"), o.get("task_id"), o.get("rep", 0)
        if o.get("error") or not o.get("response") or (cfg, tid, rep) in done:
            continue
        files = extract_files(THINK_RE.sub("", o["response"]))
        if not files:
            continue
        code = "\n\n".join(f"// FILE: {p}\n{c}" for p, c in files.items())
        prompt = judge_prompt(tid, code)
        n += 1
        try:
            raw = call_http(a.base_url, a.model, key, prompt)
        except Exception as e:
            print(f"  [{cfg}] {tid} rep{rep}: JUDGE ERROR {e}", file=sys.stderr)
            continue
        if fraw:
            fraw.write(json.dumps({"config": cfg, "task_id": tid, "rep": rep,
                                   "prompt": prompt, "raw": raw}) + "\n"); fraw.flush()
        sc = parse_scores(raw)
        if not sc:
            print(f"  [{cfg}] {tid} rep{rep}: unparseable judge reply (saved raw)", file=sys.stderr)
            continue
        row = {"config": cfg, "task_id": tid, "rep": rep, "tier": tiers.get(tid, "?"), **sc}
        fout.write(json.dumps(row) + "\n"); fout.flush()
        ok += 1
        print(f"  [{cfg}] {tid} rep{rep}: design={sc['design']} clarity={sc['clarity']} robustness={sc['robustness']}")
    fout.close()
    if fraw:
        fraw.close()
    print(f"judged {ok}/{n} replies -> {a.out}", file=sys.stderr)


def judge_fanout(a, tiers, done):
    """One interactive claude session fans out judge subagents (one per batch); Python collects."""
    os.makedirs(JUDGE_IO, exist_ok=True)
    items, nb = prepare_fanout(a.outputs, tiers, done, JUDGE_IO, a.batch_size)
    if not items:
        print("judge: nothing to do (all replies already judged, or no gradable code)", file=sys.stderr)
        return
    print(f"judge: fanning out {len(items)} candidates in {nb} '{a.subagent_model}'-subagent batches "
          f"via ONE claude session (orchestrator={a.model or 'default'})", file=sys.stderr)
    prompt = ORCH.format(n=nb, sub=a.subagent_model)
    rc = run_claude_once(prompt, os.path.join(JUDGE_IO, "orch_result.txt"), a.model, a.timeout)
    if rc != 0:
        print(f"judge: claude orchestration returned {rc} (see out/.judge-io/orch_result.txt.err) — "
              f"collecting whatever verdicts landed", file=sys.stderr)
    collect_fanout(items, JUDGE_IO, a.out, a.raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outputs", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--engine", choices=["http", "claude-tmux"], default="http",
                    help="http = any OpenAI-compatible endpoint; claude-tmux = ONE claude session (via "
                         "the tmux gateway) that fans out judge subagents in parallel (use when 27B is the "
                         "strongest LOCAL model, so Claude must judge)")
    ap.add_argument("--base-url", default="", help="required for --engine http")
    ap.add_argument("--model", default="", help="claude-tmux: the ORCHESTRATOR model; http: the judge model")
    ap.add_argument("--subagent-model", dest="subagent_model", default="opus",
                    help="claude-tmux: model each blind judging subagent runs on. Default opus — the "
                         "judge must exceed the 27B and resolve opus-tier design/robustness; use ONE "
                         "strong model for all candidates so the 0-5 scale is consistent. 'sonnet' is a "
                         "cheaper-but-still-strong single-judge alternative; avoid haiku (too coarse).")
    ap.add_argument("--batch-size", dest="batch_size", type=int, default=8,
                    help="claude-tmux: candidates per subagent batch")
    ap.add_argument("--timeout", type=int, default=2400, help="claude-tmux: seconds for the whole fan-out")
    ap.add_argument("--out", required=True)
    ap.add_argument("--raw", default="")
    ap.add_argument("--key-env", default="JUDGE_API_KEY", help="env var holding the API key (if any)")
    a = ap.parse_args()
    if a.engine == "http" and not a.base_url:
        sys.exit("--engine http needs --base-url (an OpenAI-compatible /v1). "
                 "For a local box where 27B is the best model, use --engine claude-tmux instead.")

    # matrix tasks only, and remember tiers for the score rows
    tiers = {}
    for l in open(a.tasks):
        if l.strip():
            t = json.loads(l); tiers[t["id"]] = t.get("tier", "?")

    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if l.strip():
                r = json.loads(l); done.add((r.get("config"), r.get("task_id"), r.get("rep")))

    if a.engine == "claude-tmux":
        judge_fanout(a, tiers, done)
    else:
        judge_http(a, tiers, done)


if __name__ == "__main__":
    main()
