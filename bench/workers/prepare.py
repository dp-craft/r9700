#!/usr/bin/env python3
"""prepare.py UC_ROOT: build read-task fixtures and key.json from real repo data. Deterministic.
Planted log lines are fiction and must never be cited as data."""
import ast,glob,hashlib,json,os,random,re,shutil,statistics,sys,urllib.request
root=sys.argv[1]
AMD="/home/dev/work/dp-craft/amd"; DIP="/home/dev/work/dippe"
def toks(s):
    n=0
    for i in range(0,len(s),400000):
        r=urllib.request.Request("http://127.0.0.1:8000/tokenize",data=json.dumps({"prompt":s[i:i+400000]}).encode(),headers={"content-type":"application/json"})
        n+=json.load(urllib.request.urlopen(r,timeout=120))["count"]
    return n
def mk(name):
    d=f"{root}/{name}"; shutil.rmtree(d,ignore_errors=True); os.makedirs(d); return d
def save(d,key): json.dump(key,open(f"{d}/key.json","w"),indent=1)
SIZES={}
# ---- log: real vLLM server log with planted faults
PLANT=[("ERROR","(EngineCore pid=491) ERROR 10-30 17:12:44 [scheduler.py:912] Sequence 41 aborted: decode watchdog expired after 600 s"),
("ERROR","(APIServer pid=1) ERROR 10-30 17:20:03 [api_server.py:233] Client stream closed while writing chunk 88"),
("BARE","Memory Fault: GPU node 1 page 0x7f31a0 not present, queue evicted"),
("BARE","Segmentation fault (core dumped) in worker 3"),
("BARE","RuntimeError: KV pool exhausted at 31204 MiB"),
("CRITICAL","(EngineCore pid=491) CRITICAL 10-30 18:01:17 [core.py:540] Engine core died unexpectedly, restarting")]
LOGSRC=f"{AMD}/bench/runs/2026-10-30-0947-dpf-brief-ab/redhat/server-container.log"
raw=[re.sub(r"\x1b\[[0-9;]*m","",l)[:600] for l in open(LOGSRC,errors="replace").read().split("\n")]
LEVEL=re.compile(r"^\(\w+ pid=\d+\) (WARNING|ERROR|CRITICAL) |^[EW] [a-z]|^(Traceback|\S*Error:|\S*Exception:)")
def norm(l):
    l=re.sub(r"^\((\w+) pid=\d+\) (\w+) [\d-]+ [\d:]+ ",r"\2 ",l)
    return re.sub(r"0x[0-9a-f]+|\d+(\.\d+)?","#",l)[:90]
for z,nlines in (("S",420),("M",1700),("L",4100)):
    d=mk(f"log-{z}"); lines=raw[:nlines]; n=len(lines)
    for i,(lv,txt) in enumerate(PLANT):
        lines.insert(int(n*(.15+.13*i)),txt)
    open(f"{d}/app.log","w").write("\n".join(lines))
    cl={};
    for i,l in enumerate(lines,1):
        if LEVEL.search(l) or l in [t for _,t in PLANT]: cl.setdefault(norm(l),[]).append(i)
    pl={t:lines.index(t)+1 for _,t in PLANT}
    save(d,{"classes":cl,"planted":pl,"lines":len(lines)}); SIZES[f"log-{z}"]=toks("\n".join(lines))
# ---- bugs: real finding ledger, labels hidden
R=[json.loads(l) for l in open(f"{DIP}/dp-forge/docs/plans/2026-09-01-0045-speckit-small-model-pipeline/WAVE-2-FINDINGS.jsonl")]
R=[r for r in R if r["kind"] in("defect","gap","risk","note") and r["severity"] in("blocking","high","med","low")]
random.Random(7).shuffle(R)
PATHRE=re.compile(r"[\w./-]*\w\.(?:tsx?|mjs|md|json|jsonl|py|sh|ya?ml)\b")
for z,n in (("S",40),("M",150),("L",300)):
    d=mk(f"bugs-{z}"); rows=R[:n]; out=[];k={}
    for r in rows:
        body=f"{r['text']}\nEvidence: {r['evidence']}"
        out.append(f"## {r['id']}\n{body}\n")
        k[r["id"]]=dict(kind=r["kind"],severity=r["severity"],paths=sorted(set(PATHRE.findall(""))|{m.group(0) for m in PATHRE.finditer(body)}))
    t="\n".join(out); open(f"{d}/findings.txt","w").write(t); save(d,{"rows":k}); SIZES[f"bugs-{z}"]=toks(t)
# ---- json: real benchmark results, questions with a python oracle
J=[]
for f in sorted(glob.glob(f"{AMD}/bench/runs/*/results.jsonl")):
    if os.path.getsize(f)>120000: continue
    for l in open(f):
        try: r=json.loads(l)
        except: continue
        if isinstance(r,dict) and r.get("label") and r.get("kind")=="request" and isinstance(r.get("decode_tok_s"),(int,float)) and isinstance(r.get("prefill_tok_s"),(int,float)): r["source"]=os.path.basename(os.path.dirname(f));J.append(r)
random.Random(11).shuffle(J)
def questions(rows):
    rnd=random.Random(len(rows)); labs=sorted({r["label"] for r in rows}); byl={}
    for r in rows: byl.setdefault(r["label"],[]).append(r)
    multi=[l for l in labs if len(byl[l])>=3] or labs
    a,b,c=rnd.sample(multi,3) if len(multi)>=3 else (multi*3)[:3]
    idk=lambda r:(r["label"],r.get("rep"),r.get("stream"),r["source"]); cnt={}
    for r in rows: cnt[idk(r)]=cnt.get(idk(r),0)+1
    u=rnd.choice([r for r in rows if cnt[idk(r)]==1 and "rep" in r and "stream" in r])
    Q=[(f'What is decode_tok_s of the row with label "{u["label"]}", rep {u["rep"]}, stream {u["stream"]}, source "{u["source"]}"?',u["decode_tok_s"]),
    ("How many rows are in the file?",len(rows)),
    ("How many distinct label values are there?",len(labs)),
    ("Which label has the single highest decode_tok_s?",max(rows,key=lambda r:r["decode_tok_s"])["label"]),
    ("What is the lowest prefill_tok_s in the file?",min(r["prefill_tok_s"] for r in rows)),
    (f'How many rows have label "{a}"?',len(byl[a])),
    (f'What is the mean decode_tok_s of rows with label "{b}", to 2 decimals?',round(statistics.mean(r["decode_tok_s"] for r in byl[b]),2)),
    (f'What is the sum of prompt_tokens of rows with label "{c}"?',sum(r.get("prompt_tokens") or 0 for r in byl[c])),
    ("How many rows have decode_tok_s below 20?",sum(r["decode_tok_s"]<20 for r in rows)),
    ("How many rows have concurrency above 1?",sum((r.get("concurrency") or 0)>1 for r in rows))]
    return Q
for z,n in (("S",40),("M",200),("L",650)):
    d=mk(f"json-{z}"); rows=J[:n]; t="".join(json.dumps(r)+"\n" for r in rows); open(f"{d}/results.jsonl","w").write(t)
    Q=questions(rows); open(f"{d}/questions.txt","w").write("".join(f"Q{i}: {q}\n" for i,(q,_) in enumerate(Q,1)))
    save(d,{"answers":{f"Q{i}":a for i,(_,a) in enumerate(Q,1)},"rows":len(rows)}); SIZES[f"json-{z}"]=toks(t)
# ---- summary: real reports
def rd(p): return open(p,encoding="utf8").read()
cands=[(toks(rd(p)),p) for p in sorted(glob.glob(f"{AMD}/docs/analysis/*.md"))+sorted(glob.glob(f"{AMD}/campaigns/*/analysis.md"))]
def near(n): return min(cands,key=lambda c:abs(c[0]-n))
for z,target in (("S",6000),("M",20000),("L",60000)):
    d=mk(f"summary-{z}"); t,p=near(target); shutil.copy(p,f"{d}/report.md"); save(d,{"src":os.path.relpath(p,AMD)}); SIZES[f"summary-{z}"]=t
d=mk("summary-HU"); p=f"{DIP}/AiChatney/docs/analysis/2026-08-08-1518-050-magyar-nyelv-adapter-teszt.md"; shutil.copy(p,f"{d}/report.md"); save(d,{"src":p}); SIZES["summary-HU"]=toks(rd(p))
# ---- classify: real markdown heads, label from location, path hidden
CUTOFF=float(os.environ.get("PREP_CUTOFF",0))  # keep the classify pool as it was: skip documents changed after this time
def clean(ps):
    ps=[p for p in ps if not CUTOFF or os.path.getmtime(p)<CUTOFF]
    return sorted(p for p in ps if not re.search(r"/(\.gate-code|\.claude/worktrees|node_modules|tmp)/",p) and os.path.getsize(p)>400)
G={"benchmark-report":clean(glob.glob(f"{AMD}/docs/analysis/*.md")+glob.glob(f"{AMD}/campaigns/*/analysis.md")),
"research":clean(glob.glob(f"{AMD}/docs/research/*.md")+glob.glob(f"{DIP}/AiChatney/docs/research/**/*.md",recursive=True)),
"feature-spec":clean(glob.glob(f"{DIP}/AiChatney/specs/*/spec.md")+glob.glob(f"{DIP}/dp-forge/specs/*/spec.md")),
"task-list":clean(glob.glob(f"{DIP}/AiChatney/specs/*/tasks.md")+glob.glob(f"{DIP}/dp-forge/specs/*/tasks.md")),
"code-review":clean(glob.glob(f"{DIP}/AiChatney/docs/reviews/**/*.md",recursive=True)+glob.glob(f"{DIP}/dp-forge/reviews/**/*.md",recursive=True)),
"skill":clean(glob.glob(f"{DIP}/*/.claude/skills/*/SKILL.md")+glob.glob(f"{DIP}/skills-agents/skills/*/SKILL.md")),
"agent-definition":clean(glob.glob(f"{DIP}/AiChatney/.claude/agents/*.md")+glob.glob(f"{DIP}/dp-forge/.claude/agents/*.md")),
"plan":clean(glob.glob(f"{DIP}/AiChatney/docs/plans/**/*.md",recursive=True)+glob.glob(f"{DIP}/dp-forge/docs/plans/**/PLAN*.md",recursive=True)+glob.glob(f"{DIP}/dp-forge/docs/plans/*/*plan*.md"))}
seen=set();pool=[];rnd=random.Random(5)
for lab,ps in G.items():
    rnd.shuffle(ps)
    for p in ps:
        h=hashlib.md5(open(p,"rb").read()).hexdigest()
        if h in seen: continue
        seen.add(h);pool.append((lab,p))
byl={}
for lab,p in pool: byl.setdefault(lab,[]).append(p)
print({k:len(v) for k,v in byl.items()})
def sample(n):
    rnd=random.Random(n);per=n//len(byl);out=[]
    for lab,ps in byl.items(): out+= [(lab,p) for p in ps[:per]]
    rest=[(lab,p) for lab,ps in byl.items() for p in ps[per:]];rnd.shuffle(rest);out+=rest[:n-len(out)];rnd.shuffle(out);return out
for z,n in (("S",40),("M",160),("L",min(420,len(pool)))):
    d=mk(f"classify-{z}");t=[];k={}
    for i,(lab,p) in enumerate(sample(n),1):
        head="\n".join(rd(p).split("\n")[:30])[:1400]
        t.append(f"=== ITEM {i:03d} ===\n{head}\n");k[f"{i:03d}"]=lab
    s="\n".join(t);open(f"{d}/items.txt","w").write(s);save(d,{"labels":k});SIZES[f"classify-{z}"]=toks(s)
# ---- codeinv: real python, ast oracle
PY=sorted(glob.glob(f"{AMD}/bench/*.py")+glob.glob(f"{AMD}/bench/lib/*.py")+glob.glob(f"{AMD}/bench/model-bench/*.py"),key=os.path.getsize)
sz=[(toks(rd(p)),p) for p in PY]
def pick(target):
    out=[];n=0
    for t,p in sorted(sz,key=lambda x:-x[0]):
        if n+t<=target*1.1: out.append(p);n+=t
        if n>=target*.9: break
    return out,n
for z,target in (("S",8000),("M",35000),("L",90000)):
    d=mk(f"codeinv-{z}");os.makedirs(f"{d}/src");ps,n=pick(target);k={}
    for p in ps:
        b=os.path.basename(p);shutil.copy(p,f"{d}/src/{b}")
        k[b]={x.name:x.lineno for x in ast.parse(rd(p)).body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))}
    save(d,{"defs":k});SIZES[f"codeinv-{z}"]=n
for t in("impl","testgen","edit","bugfix"): SIZES[t]=0
json.dump(SIZES,open(f"{root}/sizes.json","w"),indent=1);print(SIZES)
