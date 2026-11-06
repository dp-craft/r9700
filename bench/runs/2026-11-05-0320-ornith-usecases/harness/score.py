#!/usr/bin/env python3
"""score.py TASK WORKDIR KEYDIR HARNESS: deterministic score of one arm. Prints JSON with a 0-1 "score" and details."""
import hashlib,json,os,re,shutil,subprocess,sys,tempfile
task,w,kd,H=sys.argv[1:5]
K=json.load(open(f"{kd}/key.json")) if os.path.exists(f"{kd}/key.json") else {}
def rd(p):
    return open(p,encoding="utf8",errors="replace").read() if os.path.exists(p) else None
def sh(c,cwd,t=300):
    # own process group: on timeout the whole group dies, so a hung test worker can't outlive the scorer
    p=subprocess.Popen(c,shell=True,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
    try:
        o,e=p.communicate(timeout=t); return subprocess.CompletedProcess(c,p.returncode,o,e)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,9); o,e=p.communicate(); return subprocess.CompletedProcess(c,-9,o or "",e or "")
r={}
if task=="log":
    t=rd(f"{w}/out/report.txt") or ""; rows=[]; dev=0
    for l in t.splitlines():
        m=re.match(r"^([^|]*)\|\s*(\d+)\s*\|\s*(\d+)\s*\|([^|]*)\|(.*)$",l)
        if m: rows.append((int(m[2]),int(m[3]))); dev+=m[1]!="CLASS"
    C=K["classes"]; allowed=set(sum(C.values(),[])); firsts={}
    for ln,c in rows: firsts.setdefault(ln,c)
    hit=first=cnt=0
    for name,ls in C.items():
        got=[(ln,c) for ln,c in rows if ln in ls]
        if got:
            hit+=1; ln,c=min(got); first+=ln==ls[0]; cnt+=c==len(ls)
    pl=sum(any(ln==v for ln,_ in rows) for v in K["planted"].values())
    r=dict(rows=len(rows),classes=len(C),class_recall=round(hit/len(C),3),first_exact=first,count_exact=cnt,planted=pl,planted_total=len(K["planted"]),extra=sum(ln not in allowed for ln,_ in rows),format_deviation=dev)
    r["score"]=round((hit/len(C)+first/len(C)+cnt/len(C)+pl/len(K["planted"]))/4,3)
elif task=="bugs":
    t=rd(f"{w}/out/rows.txt") or ""; G={}
    for l in t.splitlines():
        p=l.split("|")
        if len(p)>=4: G.setdefault(p[0].strip(),p[1:])
    R=K["rows"];kind=sev=adj=tp=want=inv=0; O=["low","med","high","blocking"]
    for i,x in R.items():
        want+=len(x["paths"])
        if i not in G: continue
        g=G[i]; kind+=g[0].strip()==x["kind"]; sev+=g[1].strip()==x["severity"]
        if g[1].strip() in O: adj+=abs(O.index(g[1].strip())-O.index(x["severity"]))<=1
        ps={q.strip() for q in "|".join(g[2:]).split(",") if q.strip() and q.strip()!="none"}
        tp+=len(ps&set(x["paths"])); inv+=len(ps-set(x["paths"]))
    n=len(R)
    r=dict(rows=n,coverage=round(sum(i in G for i in R)/n,3),extra_ids=len(set(G)-set(R)),kind_acc=round(kind/n,3),sev_acc=round(sev/n,3),sev_within1=round(adj/n,3),path_recall=round(tp/max(want,1),3),path_extra=inv)
    r["score"]=round((r["kind_acc"]+r["sev_acc"]+r["path_recall"])/3,3)
elif task=="json":
    t=rd(f"{w}/out/answers.txt") or ""; G=dict(x.split("|",1) for x in t.splitlines() if re.match(r"^Q\d+\|",x)); ok=[]
    for q,a in K["answers"].items():
        g=G.get(q,"").strip()
        try: good=abs(float(g)-float(a))<=0.011
        except ValueError: good=g==str(a)
        ok.append(good)
    r=dict(correct=sum(ok),total=len(ok),wrong=[q for q,o in zip(K["answers"],ok) if not o]); r["score"]=round(sum(ok)/len(ok),3)
elif task=="summary":
    t=rd(f"{w}/out/summary.txt") or ""; src=rd(f"{w}/report.md") or ""
    labels=all(re.search(f"^{x}:",t,re.M) for x in("GOAL","RESULT","CAVEAT","OPEN")); keys=len(re.findall(r"^KEY:",t,re.M))
    nums=[n.replace(",","") for n in re.findall(r"\d[\d,]*(?:\.\d+)?",t)]; plain=src.replace(",","")
    miss=[n for n in nums if n not in plain]
    r=dict(format_ok=bool(labels and keys==5),keys=keys,numbers=len(nums),numbers_absent=len(miss),absent=miss[:10],chars=len(t)); r["score"]=round((1-len(miss)/max(len(nums),1)),3) if t else 0
elif task=="classify":
    t=rd(f"{w}/out/labels.txt") or ""; G={}
    for l in t.splitlines():
        m=re.match(r"^(\d+)\|\s*([\w-]+)",l)
        if m: G.setdefault(m[1].zfill(3),m[2])
    L=K["labels"]; ok=sum(G.get(i)==v for i,v in L.items()); conf={}
    for i,v in L.items():
        if G.get(i)!=v: conf[f"{v}>{G.get(i)}"]=conf.get(f"{v}>{G.get(i)}",0)+1
    r=dict(items=len(L),correct=ok,coverage=round(sum(i in G for i in L)/len(L),3),extra=len(set(G)-set(L)),confusions=dict(sorted(conf.items(),key=lambda x:-x[1])[:8])); r["score"]=round(ok/len(L),3)
elif task=="codeinv":
    t=rd(f"{w}/out/inventory.txt") or ""; G={}
    for l in t.splitlines():
        p=l.split("|")
        if len(p)>=4 and p[2].strip().isdigit(): G[(os.path.basename(p[0].strip()),p[1].strip())]=(int(p[2]),p[3].strip())
    D={(f,n):ln for f,x in K["defs"].items() for n,ln in x.items()}
    hit=sum(k in G for k in D); line=sum(k in G and G[k][0]==v for k,v in D.items())
    r=dict(defs=len(D),recall=round(hit/len(D),3),line_exact=line,extra=len(set(G)-set(D)),no_purpose=sum(k in G and len(G[k][1])<10 for k in D)); r["score"]=round((hit/len(D)+line/len(D))/2,3)
elif task in("impl","testgen","edit","bugfix"):
    tmp=tempfile.mkdtemp(); ws=f"{tmp}/ws"; shutil.copytree(w,ws,symlinks=True,ignore=shutil.ignore_patterns(".git","__pycache__",".pytest_cache"))
    C=f"{H}/code/{task}"
    def vitest(cwd,args=""):
        p=sh(f"npx vitest run --reporter=json --no-color {args}",cwd); m=re.search(r'\{.*"numTotalTests".*\}',p.stdout,re.S)
        return json.loads(m[0]) if m else {"numTotalTests":0,"numPassedTests":0,"success":False}
    if task=="impl":
        os.makedirs(f"{ws}/hid",exist_ok=True); shutil.copy(f"{C}/hidden/logfmt.hidden.test.ts",f"{ws}/tests/hidden.test.ts")
        v=vitest(ws,"tests/hidden.test.ts"); hung=[]
        if not v["numTotalTests"]:
            # the suite hung or crashed: run each test name alone under a short timeout, a hang counts as failed
            src=open(f"{ws}/tests/hidden.test.ts").read(); names=re.findall(r'^\s*(?:it|test)\("([^"]+)"',src,re.M); v={"numTotalTests":len(names),"numPassedTests":0}
            for n in sorted(set(names)):
                p=sh(f"npx vitest run --reporter=json --no-color tests/hidden.test.ts -t {json.dumps('(^| )'+re.escape(n)+'$')}",ws,40)
                m=re.search(r'\{.*"numTotalTests".*\}',p.stdout,re.S)
                if p.returncode==-9 or not m: hung.append(n); continue
                v["numPassedTests"]+=json.loads(m[0])["numPassedTests"]
        own=vitest(w); ts=sh("npx tsc --noEmit",w)
        r=dict(hidden_pass=v["numPassedTests"],hidden_total=v["numTotalTests"],hung=hung,own_tests=own["numTotalTests"],own_pass=own["numPassedTests"],tsc_errors=ts.stdout.count("error TS"))
        r["score"]=round(v["numPassedTests"]/max(v["numTotalTests"],1),3)
    elif task=="testgen":
        src_ok=rd(f"{w}/src/semver.ts")==rd(f"{C}/ws/src/semver.ts"); shutil.copy(f"{C}/ws/src/semver.ts",f"{ws}/src/semver.ts")
        base=vitest(ws); ts=sh("npx tsc --noEmit",w); M=json.load(open(f"{C}/mutants.json")); o=rd(f"{ws}/src/semver.ts"); k=0; surv=[]
        if base.get("numTotalTests",0)>0 and base.get("success"):
            for a,b in M:
                open(f"{ws}/src/semver.ts","w").write(o.replace(a,b))
                if sh("npx vitest run --reporter=dot --no-color",ws).returncode!=0: k+=1
                else: surv.append(a[:50])
        r=dict(tests=base.get("numTotalTests",0),pass_on_original=bool(base.get("success")),src_unchanged=src_ok,tsc_errors=ts.stdout.count("error TS"),mutants_killed=k,mutants=len(M),survived=surv); r["score"]=round(k/len(M),3)
    else:
        for f in os.listdir(f"{C}/hidden"): shutil.copy(f"{C}/hidden/{f}",f"{ws}/tests/{f}")
        p=sh("python3 -m pytest -q -p no:cacheprovider tests/test_hidden_edit.py tests/test_hidden_bug.py".replace("tests/test_hidden_edit.py",f"tests/test_hidden_edit.py" if task=="edit" else "").replace("tests/test_hidden_bug.py","tests/test_hidden_bug.py" if task=="bugfix" else ""),ws)
        ps=int((re.search(r"(\d+) passed",p.stdout) or [0,0])[1]); fl=int((re.search(r"(\d+) failed",p.stdout) or [0,0])[1]); er=int((re.search(r"(\d+) error",p.stdout) or [0,0])[1])
        own=sh("python3 -m pytest -q -p no:cacheprovider",w); owm=re.search(r"(\d+) passed",own.stdout); ofl=re.search(r"(\d+) failed",own.stdout)
        tot=9 if task=="edit" else 11
        r=dict(hidden_pass=ps,hidden_fail=fl,hidden_error=er,hidden_total=tot,own_pass=int(owm[1]) if owm else 0,own_fail=int(ofl[1]) if ofl else 0)
        diff=sh("git diff --stat HEAD",w).stdout; r["diff"]=diff.strip().split("\n")[-1] if diff.strip() else ""
        r["score"]=round(ps/tot,3)
        if task=="edit":
            r["vendor_unchanged"]=rd(f"{w}/vendor/legacy.py")==rd(f"{C}/ws/vendor/legacy.py")
            left=sh(r"grep -rnE '\bget_price\b' --include='*' . --exclude-dir=.git --exclude-dir=vendor --exclude-dir=__pycache__ --exclude=CHANGE.md",w).stdout.strip().split("\n")
            r["old_name_left"]=[x for x in left if x and '"get_price"' not in x]
            r["score"]=round((ps/tot)*(1 if r["vendor_unchanged"] and not r["old_name_left"] else .75),3)
        else:
            s=rd(f"{w}/movstats.py") or ""; o=rd(f"{C}/ws/movstats.py"); f=lambda x:x[x.index("def rolling_max"):] if "def rolling_max" in x else ""
            r["max_unchanged"]=f(s).strip()==f(o).strip()
    shutil.rmtree(tmp,ignore_errors=True)
print(json.dumps(r))
