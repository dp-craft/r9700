import json
path = "results.jsonl"
rows = [json.loads(l) for l in open(path) if l.strip()]
print("lowest 6 decode_tok_s:")
for r in sorted(rows, key=lambda x: x["decode_tok_s"])[:6]:
    print("  ", r["decode_tok_s"], r["label"], "rep",r["rep"],"stream",r["stream"])
