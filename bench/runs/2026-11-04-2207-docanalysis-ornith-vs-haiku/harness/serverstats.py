#!/usr/bin/env python3
"""serverstats.py SERVER_LOG [SESSION_PORT]: per-request stats from Radiance 'done' lines, keeping only agent requests. Prints JSON."""
import json,re,sys
R=[]
for l in open(sys.argv[1],errors="replace"):
    m=re.search(r"req (msg_\w+) done .*finish=(\w+) prompt=(\d+) \(cache (\d+)\) gen=(\d+) reason=(\d+) ttft=([\d.]+)s ([\d.]+) tok/s ([\d.]+)s",l)
    if m: R.append(dict(id=m[1],finish=m[2],prompt=int(m[3]),cache=int(m[4]),gen=int(m[5]),reason=int(m[6]),ttft=float(m[7]),rate=float(m[8]),t=float(m[9])))
g=sum(r["gen"] for r in R); t=sum(r["t"] for r in R)
drops=sum(1 for a,b in zip(R,R[1:]) if b["prompt"]<a["prompt"]-2000)
print(json.dumps({"requests":len(R),"prompt_first":R[0]["prompt"],"prompt_peak":max(r["prompt"] for r in R),"gen":g,"reason":sum(r["reason"] for r in R),
 "server_s":round(t,1),"ttft_s":round(sum(r["ttft"] for r in R),1),"gen_rate_weighted":round(g/t,1) if t else 0,"cache_hit_pct":round(100*sum(r["cache"] for r in R)/sum(r["prompt"] for r in R),1),"prompt_drops":drops,"finish":sorted({r["finish"] for r in R})}))
for r in R: print(f'  prompt={r["prompt"]:>7} cache={r["cache"]:>7} gen={r["gen"]:>6} reason={r["reason"]:>6} ttft={r["ttft"]:>5} {r["rate"]:>6} t/s {r["t"]:>6}s {r["finish"]}')
