#!/usr/bin/env python3
"""capture.py — send every task to ONE running llama-server and append its replies + FULL measured
telemetry to outputs.jsonl. Called once per config by run_capture.sh (which owns server start/stop
and VRAM/power/thermal sampling).

Captures everything measurable per config×task×rep:
  - raw response; think/answer token split (thinking tokens = headline token-usage metric)
  - usage: prompt/completion/total/cached tokens
  - llama.cpp `timings`: prefill tok/s (prompt_per_second), decode tok/s (predicted_per_second),
    prompt_n/ms, predicted_n/ms, per-token ms (full object stored verbatim)
  - ttft_s: REAL wall-clock time-to-first-token; ttfa_s: time-to-first-ANSWER-token (after the
    </think> block — what the user actually waits for); think_time_s = ttfa-ttft
  - finish_reason + truncated_thinking flag (hit max_tokens mid-<think> → no answer) + has_answer
  - the sampling params used (reproducibility)

Streaming SSE, so TTFT/TTFA are true measurements. Stdlib only (urllib).

    python3 capture.py --config rico03-distilled --tasks tasks/tasks.jsonl --out OUT/outputs.jsonl \
        --base-url http://127.0.0.1:8081 --reps 1 --max-tokens 8192
"""
import argparse, json, os, time, urllib.request, re

THINK_RE = re.compile(r"<think>(.*?)</think>", re.S)


def post_json(url, payload, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def count_tokens(base, text):
    if not text.strip():
        return 0
    try:
        return len(post_json(base + "/tokenize", {"content": text}).get("tokens", []))
    except Exception:
        return round(len(text.split()) * 1.33)  # fallback approximation


def stream_chat(base, payload, timeout=600):
    """Stream /v1/chat/completions and return a dict of content + timing markers. Handles both
    reasoning styles: a separate `reasoning_content` delta field, or inline <think>…</think> in
    `content`. ttfa = wall-clock at the first ANSWER token (after thinking)."""
    payload = dict(payload, stream=True, stream_options={"include_usage": True})
    req = urllib.request.Request(base + "/v1/chat/completions",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    content, reasoning, acc = [], [], ""
    ttft = ttfa = t_first_content = None
    usage = timings = finish = None
    saw_reasoning_field = saw_done = False
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                saw_done = True
                break
            try:
                obj = json.loads(data)
            except Exception:
                continue
            if obj.get("usage"):
                usage = obj["usage"]
            if obj.get("timings"):
                timings = obj["timings"]
            for ch in obj.get("choices", []):
                d = ch.get("delta", {})
                pc = d.get("content") or ""
                pr = d.get("reasoning_content") or ""
                now = time.time() - t0
                if pr:
                    saw_reasoning_field = True
                if (pc or pr) and ttft is None:
                    ttft = now
                if pc:
                    if t_first_content is None:
                        t_first_content = now
                    acc += pc
                    if ttfa is None and (saw_reasoning_field or "</think>" in acc):
                        ttfa = now                 # answer began (separate reasoning, or think closed)
                content.append(pc); reasoning.append(pr)
                if ch.get("finish_reason"):
                    finish = ch["finish_reason"]
    # A COMPLETE OpenAI/llama.cpp SSE stream ALWAYS delivers a finish_reason and terminates with
    # [DONE]. If either is missing, the connection was cut mid-generation (server killed, timeout,
    # network drop) and `content` holds a TRUNCATED answer.
    #
    # Returning that normally is how an interrupted run silently becomes a graded rep: the caller
    # writes the row, the resume logic counts the (config, task, rep) as done so it is never
    # re-collected, and a chopped-off answer is graded as if the model chose to write it that way.
    # MEASURED (2026-07-15): one such row — q5-d128-f16-rb16384/lru-cache/rep0, cut mid-test when its
    # server was killed — scored 0.603 with tests=0.0 (code unparseable) and pulled the cell's
    # reported mean from 78.2% down to 77.1%. It was indistinguishable from a real result except for
    # a null finish_reason.
    #
    # Raise instead: the caller records a retryable error row, which is NEVER counted as done.
    if finish is None or not saw_done:
        raise RuntimeError(
            f"incomplete stream: finish_reason={finish!r} saw_done={saw_done} after "
            f"{len(''.join(content))} content chars — connection cut mid-generation, answer truncated")
    # non-thinking model (no <think> tag ever) → its first content IS the answer
    if ttfa is None and acc and "<think>" not in acc:
        ttfa = t_first_content
    return {"content": "".join(content), "reasoning": "".join(reasoning),
            "ttft": ttft, "ttfa": ttfa, "total_s": time.time() - t0,
            "usage": usage or {}, "timings": timings or {}, "finish": finish,
            "saw_reasoning_field": saw_reasoning_field}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="config label, e.g. rico03-distilled / unsloth-mtp-on")
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base-url", default="http://127.0.0.1:8081")
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--max-tokens", type=int, default=8192,
                    help="generous by default — thinking models burn thousands of tokens; too low "
                         "truncates mid-<think> (finish_reason=length, no answer).")
    ap.add_argument("--temp", type=float, default=1.0)     # GGUF-recommended Qwen3.6 sampling
    ap.add_argument("--top-p", type=float, default=0.95)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--presence-penalty", type=float, default=None,
                    # Qwen ties presence_penalty to the temperature PRESET (thinking-general = 1.0/pp 1.5,
                    # precise-coding = 0.6/pp 0.0), so a vendor preset cannot be reproduced without it.
                    # Omitted from the payload when None → server default, i.e. previous behaviour.
                    help="presence_penalty (Qwen: 0.0 for precise coding, 1.5 for thinking-general)")
    ap.add_argument("--min-p", type=float, default=None,   # Qwen3.6 thinking wants 0; server default is 0.05.
                    help="only sent when set — pin to 0 for Qwen3.6 thinking; omit to keep server default")
    ap.add_argument("--seed", type=int, default=42)        # fixed for reproducibility
    a = ap.parse_args()

    tasks = [json.loads(l) for l in open(a.tasks) if l.strip()]
    base = a.base_url.rstrip("/")
    # row-level resume: (config, task_id, rep) rows already captured SUCCESSFULLY in --out are skipped,
    # so a partial/single-cell run and a later full run share one outputs.jsonl without duplicates
    # (error rows are NOT counted as done — they get retried). Bump --reps and only the new reps run.
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if not l.strip():
                continue
            r = json.loads(l)
            if not r.get("error") and r.get("response"):
                done.add((r.get("config"), r.get("task_id"), r.get("rep", 0)))
    n = skipped = 0
    with open(a.out, "a") as fout:
        for t in tasks:
            for rep in range(a.reps):
                if (a.config, t["id"], rep) in done:
                    skipped += 1
                    continue
                sampling = {"temperature": a.temp, "top_p": a.top_p, "top_k": a.top_k,
                            "seed": a.seed + rep}
                if a.min_p is not None:
                    sampling["min_p"] = a.min_p
                if a.presence_penalty is not None:
                    sampling["presence_penalty"] = a.presence_penalty
                payload = {"messages": [{"role": "user", "content": t["prompt"]}],
                           "max_tokens": a.max_tokens, **sampling}
                try:
                    s = stream_chat(base, payload)
                    full = (f"<think>{s['reasoning']}</think>{s['content']}") if s["reasoning"] else s["content"]
                    think = "".join(THINK_RE.findall(full))
                    think_tok = count_tokens(base, think)
                    u, tm = s["usage"], s["timings"]
                    comp = u.get("completion_tokens")
                    think_closed = ("</think>" in full) or s["saw_reasoning_field"]
                    answer_text = THINK_RE.sub("", full).strip()
                    ttft, ttfa = s["ttft"], s["ttfa"]
                    row = {"config": a.config, "task_id": t["id"], "type": t["type"],
                           "category": t["category"], "rep": rep, "response": full,
                           # ---- usage / token economy ----
                           "prompt_tokens": u.get("prompt_tokens"), "completion_tokens": comp,
                           "total_tokens": u.get("total_tokens"),
                           "cached_tokens": (u.get("prompt_tokens_details") or {}).get("cached_tokens"),
                           "think_tokens": think_tok,
                           "answer_tokens": (comp - think_tok) if comp is not None else None,
                           # ---- throughput ----
                           "prefill_tps": tm.get("prompt_per_second"),
                           "decode_tps": tm.get("predicted_per_second"),
                           "prompt_n": tm.get("prompt_n"), "prompt_ms": tm.get("prompt_ms"),
                           "predicted_n": tm.get("predicted_n"), "predicted_ms": tm.get("predicted_ms"),
                           "prompt_per_token_ms": tm.get("prompt_per_token_ms"),
                           "predicted_per_token_ms": tm.get("predicted_per_token_ms"),
                           # ---- latency ----
                           "ttft_s": round(ttft, 3) if ttft is not None else None,
                           "ttfa_s": round(ttfa, 3) if ttfa is not None else None,
                           "think_time_s": round(ttfa - ttft, 3) if (ttft is not None and ttfa is not None) else None,
                           "latency_s": round(s["total_s"], 3),
                           # ---- quality/health flags ----
                           "finish_reason": s["finish"],
                           "think_closed": think_closed,
                           "has_answer": bool(answer_text),
                           "truncated_thinking": (s["finish"] == "length" and not think_closed),
                           # ---- provenance / raw ----
                           "sampling": sampling, "max_tokens": a.max_tokens,
                           "timings": tm, "usage": u, "ts": time.time()}
                except Exception as e:
                    row = {"config": a.config, "task_id": t["id"], "rep": rep, "error": str(e)}
                fout.write(json.dumps(row) + "\n"); fout.flush()
                n += 1
                if "error" in row:
                    print(f"  [{a.config}] {t['id']} rep{rep}: ERROR {row['error']}")
                else:
                    trunc = " TRUNCATED-THINK" if row["truncated_thinking"] else ""
                    print(f"  [{a.config}] {t['id']} rep{rep}: {row['completion_tokens']} tok "
                          f"({row['think_tokens']} think/{row['answer_tokens']} ans) | "
                          f"prefill {row['prefill_tps']:.0f} decode {row['decode_tps']:.1f} t/s | "
                          f"ttft {row['ttft_s']}s ttfa {row['ttfa_s']}s | {row['finish_reason']}{trunc}")
    print(f"captured {n} rows -> {a.out}" + (f" ({skipped} already present, skipped)" if skipped else ""))


if __name__ == "__main__":
    main()
