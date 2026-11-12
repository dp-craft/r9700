#!/usr/bin/env python3
"""usage.py TRANSCRIPT: per-request usage summary from a Claude Code JSONL, deduped by message id. Prints JSON."""
import json,sys
seen={};model=set();compact=0;tools={}
for l in open(sys.argv[1],encoding="utf8"):
    try:d=json.loads(l)
    except: continue
    if d.get("subtype")=="compact_boundary" or d.get("isCompactSummary"): compact+=1
    m=d.get("message") or {}
    if d.get("type")=="assistant":
        if m.get("model"): model.add(m["model"])
        if m.get("usage"): seen[m.get("id")]=m["usage"]
        for c in m.get("content") or []:
            if isinstance(c,dict) and c.get("type")=="tool_use": tools[c["name"]]=tools.get(c["name"],0)+1
U=list(seen.values())
ctx=[u.get("input_tokens",0)+u.get("cache_read_input_tokens",0)+u.get("cache_creation_input_tokens",0) for u in U]
print(json.dumps({"models":sorted(model),"requests":len(U),"output_tokens":sum(u.get("output_tokens",0) for u in U),
 "input_uncached":sum(u.get("input_tokens",0) for u in U),"cache_read":sum(u.get("cache_read_input_tokens",0) for u in U),
 "cache_create":sum(u.get("cache_creation_input_tokens",0) for u in U),"ctx_first":ctx[0] if ctx else 0,"ctx_peak":max(ctx) if ctx else 0,"compactions":compact,"tools":tools}))
