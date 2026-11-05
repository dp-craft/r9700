#!/usr/bin/env python3
"""score.py ROOT ARM: deterministic scoring of OUT notes against key.json + fixture text. Prints JSON."""
import json,os,re,sys
root,arm=sys.argv[1:3]; out=f"{root}/out-{arm}"; K=json.load(open(f"{root}/key.json"))
PATH=re.compile(r"(?:bench/runs|campaigns)/[A-Za-z0-9._\-/]+")
norm=lambda p:p.rstrip("/.,")
nums=lambda s:[x.replace(",","") for x in re.findall(r"\d[\d,]*(?:\.\d+)?",s)]
res=[];T=dict(notes=0,parse_ok=0,fact=0,exact=0,wrongline=0,fabricated=0,needles=0,hits=0,tp=0,fn=0,truncated=0,invented=0,dirs_want=0,dirs_hit=0,paths_want=0,inc=0,inc_badline=0,fact_malformed=0)
for i,name in enumerate(K["order"],1):
    d=K["docs"][name]; f=f"{out}/{i:02d}.txt"; row=dict(n=i,doc=name)
    needles=d["needles"]; T["needles"]+=len(needles)
    if not os.path.exists(f):
        row.update(missing=True,needle_hit=0,needles=len(needles)); T["fn"]+=len(d["paths"]); T["paths_want"]+=len(d["paths"]); res.append(row); continue
    t=open(f,encoding="utf8").read(); T["notes"]+=1
    labels=["DOC:","TOPIC:","VERDICT:","CONFIG:","PATHS:","OPEN:"]
    ok=all(re.search("^"+l,t,re.M) for l in labels) and re.search(r"^FACT\|",t,re.M) and re.search(r"^INCIDENT\|",t,re.M)
    row["parse_ok"]=bool(ok); T["parse_ok"]+=bool(ok)
    doc=open(f"{root}/docs/{name}",encoding="utf8").read(); L=doc.split("\n"); plain=doc.replace(",","")
    m=re.search(r"^PATHS:(.*)$",t,re.M); got={norm(x) for x in PATH.findall(m.group(1))} if m else set(); want=set(d["paths"])
    invented={g for g in got-want if g not in doc}; truncated=(got-want)-invented
    rd=lambda s:{"/".join(x.split("/")[:(3 if x.startswith("bench/") else 2)]) for x in s}
    wd,gd=rd(want),rd({g for g in got if g in doc})
    row.update(paths_tp=len(got&want),paths_truncated=len(truncated),paths_invented=len(invented),paths_fn=len(want-got),dirs_want=len(wd),dirs_hit=len(wd&gd),invented_list=sorted(invented))
    T["tp"]+=len(got&want);T["fn"]+=len(want-got);T["truncated"]+=len(truncated);T["invented"]+=len(invented);T["dirs_want"]+=len(wd);T["dirs_hit"]+=len(wd&gd);T["paths_want"]+=len(want)
    ex=wl=fb=0
    fm=re.findall(r"^FACT\|\s*(\d+)\s*\|([^|\n]*)\|",t,re.M); mal=len(re.findall(r"^FACT",t,re.M))-len(fm)
    for ln,val in fm:
        ns=nums(val)
        if not ns: fb+=1; continue
        ln=int(ln); src=L[ln-1].replace(",","") if 0<ln<=len(L) else ""
        if all(n in src for n in ns): ex+=1
        elif all(n in plain for n in ns): wl+=1
        else: fb+=1
    row.update(fact_exact=ex,fact_wrongline=wl,fact_fabricated=fb,fact_malformed=mal); T["fact"]+=ex+wl+fb;T["exact"]+=ex;T["wrongline"]+=wl;T["fabricated"]+=fb;T["fact_malformed"]+=mal
    inc=[(int(a),b) for a,b in re.findall(r"^INCIDENT\|\s*(\d+)\s*\|(.*)$",t,re.M)]
    T["inc"]+=len(inc); T["inc_badline"]+=sum(1 for a,_ in inc if not 0<a<=len(L))
    hit=0;det=[]
    for n in needles:
        h=any(abs(a-n["line"])<=1 or re.search(n["re"],b,re.I) for a,b in inc)
        hit+=h; det.append({"id":n["id"],"line":n["line"],"hit":bool(h)})
    row.update(incidents=len(inc),needle_hit=hit,needles=len(needles),needle_detail=det); T["hits"]+=hit
    res.append(row)
syn={}; f=f"{out}/SYNTHESIS.txt"
if os.path.exists(f):
    t=open(f,encoding="utf8").read()
    want={n for n,d in K["docs"].items() if any(x["thermal"] for x in d["needles"])}
    got={x.strip() for x in re.findall(r"^Q1\|(.*)$",t,re.M) if x.strip().lower()!="none"}
    got={os.path.basename(x) for x in got}
    syn["q1_expected"]=sorted(want);syn["q1_tp"]=len(got&want);syn["q1_extra"]=sorted(got-want);syn["q1_missed"]=sorted(want-got)
    cite={}
    for n,d in K["docs"].items():
        for p in d["paths"]:
            mm=re.match(r"bench/runs/([^/]+)",p)
            if mm: cite.setdefault(mm.group(1),set()).add(n)
    wq={k for k,v in cite.items() if len(v)>=2}
    gq={x.split("/")[-1].strip() for x in re.findall(r"^Q2\|([^|\n]*)",t,re.M) if x.strip().lower()!="none"}
    syn["q2_expected"]=len(wq);syn["q2_tp"]=len(gq&wq);syn["q2_fp"]=sorted(gq-wq);syn["q2_missed"]=sorted(wq-gq)
    cf=re.findall(r"^CONFLICT\|([^|:\n]+):(\d+)\|([^|:\n]+):(\d+)\|(.*)$",t,re.M); bad=0
    for a,la,b,lb,_ in cf:
        for nm,ln in((a,la),(b,lb)):
            nm=os.path.basename(nm.strip())
            if nm not in K["docs"] or not 0<int(ln)<=K["docs"][nm]["lines"]: bad+=1
    syn["conflicts"]=len(cf);syn["conflict_bad_citations"]=bad
    syn["recommend"]=bool(re.search(r"^RECOMMEND\|",t,re.M))
else: syn["missing"]=True
print(json.dumps({"root":os.path.basename(root),"arm":arm,"total":T,"synthesis":syn,"docs":res},indent=1))
