#!/usr/bin/env python3
"""capture.py — send every task to ONE running llama-server and append its replies + token usage
to outputs.jsonl. Called once per config by run_capture.sh (which owns server start/stop).

Records, per config×task×rep: raw response, prompt/completion tokens (from the server's usage),
a think/answer token split (thinking tokens are the headline 'token usage' metric), and latency.
Uses the /tokenize endpoint to count thinking tokens exactly. Stdlib only (urllib).

    python3 capture.py --config rico03-distilled --tasks tasks/tasks.jsonl --out OUT/outputs.jsonl \
        --base-url http://127.0.0.1:8081 --reps 1 --max-tokens 2048
"""
import argparse, json, time, urllib.request, re

THINK_RE = re.compile(r"<think>(.*?)</think>", re.S)


def post(url, payload, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def count_tokens(base, text):
    if not text.strip():
        return 0
    try:
        return len(post(base + "/tokenize", {"content": text}).get("tokens", []))
    except Exception:
        return round(len(text.split()) * 1.33)  # fallback approximation


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="config label, e.g. rico03-distilled or unsloth-mtp-on")
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base-url", default="http://127.0.0.1:8081")
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--max-tokens", type=int, default=2048)
    ap.add_argument("--temp", type=float, default=1.0)     # GGUF-recommended Qwen3.6 sampling
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--seed", type=int, default=42)        # fixed for reproducibility
    a = ap.parse_args()

    tasks = [json.loads(l) for l in open(a.tasks) if l.strip()]
    base = a.base_url.rstrip("/")
    n = 0
    with open(a.out, "a") as fout:
        for t in tasks:
            for rep in range(a.reps):
                payload = {"messages": [{"role": "user", "content": t["prompt"]}],
                           "max_tokens": a.max_tokens, "temperature": a.temp,
                           "top_p": a.top_p, "top_k": a.top_k, "seed": a.seed + rep}
                t0 = time.time()
                try:
                    resp = post(base + "/v1/chat/completions", payload)
                    dt = time.time() - t0
                    msg = resp["choices"][0]["message"]
                    content = msg.get("content") or ""
                    # some builds put reasoning in a separate field; fold it into <think> if so
                    reasoning = msg.get("reasoning_content") or ""
                    full = (f"<think>{reasoning}</think>" + content) if reasoning else content
                    usage = resp.get("usage", {})
                    think = "".join(THINK_RE.findall(full))
                    think_tok = count_tokens(base, think)
                    row = {"config": a.config, "task_id": t["id"], "type": t["type"],
                           "category": t["category"], "rep": rep, "response": full,
                           "prompt_tokens": usage.get("prompt_tokens"),
                           "completion_tokens": usage.get("completion_tokens"),
                           "think_tokens": think_tok,
                           "answer_tokens": (usage.get("completion_tokens") or 0) - think_tok,
                           "latency_s": round(dt, 2),
                           "finish_reason": resp["choices"][0].get("finish_reason")}
                except Exception as e:
                    row = {"config": a.config, "task_id": t["id"], "rep": rep, "error": str(e)}
                fout.write(json.dumps(row) + "\n"); fout.flush()
                n += 1
                tag = row.get("error", f"{row.get('completion_tokens','?')} tok "
                                       f"({row.get('think_tokens','?')} think)")
                print(f"  [{a.config}] {t['id']} rep{rep}: {tag}")
    print(f"captured {n} rows -> {a.out}")


if __name__ == "__main__":
    main()
