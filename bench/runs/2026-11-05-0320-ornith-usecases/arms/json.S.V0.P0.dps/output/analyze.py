import json, collections

path = "/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad/uc/runs/json.S.V0.P0.dps/results.jsonl"
rows = []
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))

print("Q2 total rows:", len(rows))

labels = [r["label"] for r in rows]
print("Q3 distinct labels:", sorted(set(labels)))
print("Q3 count distinct labels:", len(set(labels)))

# Q1
q1_row = next((r for r in rows if r.get("label") == "redhat-sly191-mtp-cr10000" and r.get("rep") == 1 and r.get("stream") == 0 and r.get("source") == "2026-10-30-1948-engine-redhat-sly191-mtp-cr10000"), None)
print("Q1 q1_row exists:", q1_row is not None, "-> decode_tok_s =", q1_row.get("decode_tok_s") if q1_row else None)

# Q4 label with single highest decode_tok_s
top = max(rows, key=lambda r: r["decode_tok_s"])
print("Q4 highest decode_tok_s row:", top["label"], top["decode_tok_s"])

# Q5 lowest prefill_tok_s
pmin = min(rows, key=lambda r: r["prefill_tok_s"])
print("Q5 lowest prefill_tok_s:", pmin["prefill_tok_s"], "(", pmin["label"], ")")

# Q6 count agentic-c2
c_ag = sum(1 for r in rows if r["label"] == "agentic-c2")
print("Q6 agentic-c2 count:", c_ag)

# Q7 mean decode_tok_s dec-think
dec_rows = [r["decode_tok_s"] for r in rows if r["label"] == "dec-think"]
mean_dec = sum(dec_rows)/len(dec_rows) if dec_rows else None
print("Q7 dec-think count:", len(dec_rows), "mean decode_tok_s:", round(mean_dec,2))

# Q8 sum prompt_tokens agentic-c2
sum_ag = sum(r["prompt_tokens"] for r in rows if r["label"] == "agentic-c2")
print("Q8 sum prompt_tokens agentic-c2:", sum_ag)

# Q9 decode_tok_s below 20
q9 = sum(1 for r in rows if r["decode_tok_s"] < 20)
print("Q9 decode_tok_s < 20:", q9)

# Q10 concurrency above 1
q10 = sum(1 for r in rows if r["concurrency"] > 1)
print("Q10 concurrency > 1:", q10)
