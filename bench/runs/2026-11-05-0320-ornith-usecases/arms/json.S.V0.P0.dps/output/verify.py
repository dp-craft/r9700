import json
path = "/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad/uc/runs/json.S.V0.P0.dps/results.jsonl"
rows = [json.loads(l) for l in open(path) if l.strip()]

print("dec-think rows:")
for r in rows:
    if r["label"]=="dec-think":
        print("  ", r["decode_tok_s"])

print("\nagentic-c2 rows (prompt_tokens):")
for r in rows:
    if r["label"]=="agentic-c2":
        print("  prompt_tokens:", r["prompt_tokens"], "decode_tok_s:", r["decode_tok_s"])

print("\nconcurrency values counts:")
import collections
print(collections.Counter(r["concurrency"] for r in rows))

print("\nlowest 3 prefill_tok_s:")
for r in sorted(rows, key=lambda x: x["prefill_tok_s"])[:3]:
    print("  ", r["prefill_tok_s"], r["label"])

print("\nhighest 3 decode_tok_s:")
for r in sorted(rows, key=lambda x: x["decode_tok_s"], reverse=True)[:4]:
    print("  ", r["decode_tok_s"], r["label"])
