#!/usr/bin/env python3
"""Aggregate a depth-curve run dir into per-depth means + log-log fits (rule 16).

Written because depthcurve_bigwindow.sh's inline printer used the wrong key names
(prompt_tok/ttft_p50 instead of capture_engine's prompt_tokens/ttft_s), so its console
lines showed None. The DATA is fine -- this reads results.jsonl directly. No re-run needed.
"""
import json, glob, math, os, statistics as st, sys

def fit(xs, ys):
    lx=[math.log(x) for x in xs]; ly=[math.log(y) for y in ys]; n=len(xs)
    mx=sum(lx)/n; my=sum(ly)/n
    sxx=sum((a-mx)**2 for a in lx)
    if not sxx: return float('nan'), float('nan')
    b=sum((a-mx)*(c-my) for a,c in zip(lx,ly))/sxx; a0=my-b*mx
    sst=sum((c-my)**2 for c in ly)
    ssr=sum((c-(a0+b*x))**2 for x,c in zip(lx,ly))
    return b, (1-ssr/sst if sst else float('nan'))

for res in sorted(glob.glob(os.path.join(sys.argv[1], "*", "results.jsonl"))):
    arm=os.path.basename(os.path.dirname(res))
    rows=[json.loads(l) for l in open(res) if l.strip()]
    reqs=[r for r in rows if r.get("kind")=="request" and r.get("prompt_tokens")]
    if not reqs: print(f"\n{arm}: no request rows"); continue
    by={}
    for r in reqs: by.setdefault(r["label"], []).append(r)
    print(f"\n### {arm}   (n={len(reqs)} requests)")
    print(f"{'depth':>7} {'ptok':>7} {'prefill':>9} {'±sd':>6} {'decode':>8} {'±sd':>6} "
          f"{'ttft_s':>8} {'total_s':>8} {'gen':>5} {'n':>3}")
    pts=[]
    for lab in sorted(by, key=lambda L:int(L[1:])):
        g=by[lab]
        m=lambda k: st.mean([x[k] for x in g if x.get(k) is not None])
        sd=lambda k: st.stdev([x[k] for x in g if x.get(k) is not None]) if len(g)>1 else 0.0
        ptok=m("prompt_tokens")
        print(f"{lab[1:]:>7} {ptok:7.0f} {m('prefill_tok_s'):9.1f} {sd('prefill_tok_s'):6.1f} "
              f"{m('decode_tok_s'):8.2f} {sd('decode_tok_s'):6.2f} {m('ttft_s'):8.2f} "
              f"{m('total_s'):8.2f} {m('gen_tokens'):5.0f} {len(g):3d}")
        pts.append((ptok, m('prefill_tok_s'), m('decode_tok_s'), m('total_s')))
    if len(pts)>=3:
        x=[p[0] for p in pts]
        for i,name in ((1,'prefill'),(2,'decode'),(3,'total_s')):
            b,r2=fit(x,[p[i] for p in pts])
            print(f"   fit {name:8s}: exponent {b:+.3f}  R2 {r2:.3f}")
    else:
        print("   <3 depths — no fit (rule 16 needs >=4)")
