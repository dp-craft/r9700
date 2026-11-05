#!/usr/bin/env python3
"""prepare.py REPO OUTROOT: build nested fixtures S (suffix of M, suffix of L) with planted incident needles.
Fixtures are COPIES; planted sentences are fiction and must never be cited as data."""
import json,os,random,re,sys
repo,root=sys.argv[1:3]
c="campaigns/%s/analysis.md"; a="docs/analysis/%s.md"; r="docs/research/%s.md"
# reading order is L-only -> M-only -> S, so a shared doc is deep in L and shallow in S
L_ONLY=[(c%"2026-07-14-hardest-tasks-27b-vs-35b",[(.25,"thermal1"),(.5,"debug"),(.8,"ups")]),
 (a%"2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed",[(.55,"update")])]
M_ONLY=[(c%"2026-10-30-vllm-redhat-sly191-d0-dflash-depth",[(.55,"vram")]),
 (a%"2026-07-16-0927-mtp-sampler-tax",[(.45,"thermal2")]),
 (r%"2026-11-04-1630-qwen35-35b-a3b-vllm-rocm-decode-gap",[(.6,"mirror")]),
 (a%"2026-09-11-1950-benchy-ideas-27b",[(.4,"ring")]),
 (c%"2026-10-22-vllm-sly-mxfp4-depth",[(.7,"swap")]),
 (a%"2026-10-31-1745-reasoning-replay-sharp-template-cactus-loops",[(.5,"powercap")])]
S_ONLY=[(a%"2026-11-04-1746-ornith15-radiance-vs-sly-35b-27b",[(.6,"thermal3")]),
 (c%"2026-10-31-redhat-sharp-w208-blind",[(.45,"fixture")]),
 (a%"2026-10-23-0023-vllm-gpu-fault-solved-hip-kernarg",[(.65,"thermal4")]),
 (c%"2026-09-15-stew675-buildcmp",[(.5,"disk")])]
N={"thermal1":("One caveat on this data: the first repetition was thrown away after the GPU junction sensor read 104 °C and the card began throttling; a blocked intake filter was cleared before the data above was re-collected.","intake filter|junction"),
"thermal2":("Housekeeping note: the chassis fan controller stopped responding mid-session, edge temperature climbed to 91 °C, and the session was abandoned and repeated the next morning.","fan controller|chassis fan|fan"),
"thermal3":("Room temperature rose past 34 °C during the afternoon block and hotspot readings hit the throttle limit, so that block was dropped and measured again overnight.","hotspot|room temperature|34"),
"thermal4":("The pump on the loop cooler seized during the second attempt and the card overheated to 98 °C; that attempt was scrapped and redone after the cooler was replaced.","pump|cooler|overheat"),
"update":("A scheduled system update restarted the container during one pass; that pass was rerun from scratch.","system update|restarted the container"),
"debug":("The first pass used a debug build by mistake, so its rows were discarded before this table was produced.","debug build"),
"ups":("The overnight block was cut short by a UPS power event, so those partial rows were quarantined and not used.","ups"),
"vram":("An earlier attempt at this step is not included: a forgotten desktop browser held 1.4 GiB of VRAM and those samples were thrown out.","browser"),
"mirror":("Network loss to the model mirror truncated a checkpoint download, the server crashed on load, and the checkpoint was fetched again.","mirror|truncat|checkpoint download"),
"ring":("The second session was lost when the kernel logged an amdgpu ring timeout and reset the GPU; everything from that session was redone.","ring timeout|gpu reset|reset the gpu"),
"swap":("Swap thrashing from a parallel compile job corrupted one timing series, which was excluded from the figures here.","swap|compile job"),
"powercap":("One batch of rows was removed after it turned out the power cap had silently reverted to 300 W between sessions.","power cap|300 w"),
"fixture":("A stale prompt fixture from a previous build was used for the first pass; the pass was deleted and repeated with the correct file.","stale|fixture"),
"disk":("Disk-full errors on the log volume killed the sampler midway through one attempt, and that attempt was repeated.","disk"),}
def flat(p):
    return p.split("/")[1]+".analysis.md" if p.startswith("campaigns/") else os.path.basename(p)
def place(lines,frac,taken):
    fence=False;ok=[]
    incom=False
    for i,l in enumerate(lines):
        s=l.strip()
        if s.startswith("```"): fence=not fence
        if s.startswith("<!--"): incom=True
        if "-->" in s: incom=False;continue
        if fence or incom or s or i==0 or i+1>=len(lines): continue
        p,q=lines[i-1].strip(),lines[i+1].strip()
        if not p or not q or p[0] in "|#>" or q[0] in "|#>-*" : continue
        if i not in taken: ok.append(i)
    target=frac*len(lines)
    if not ok or min(abs(i-target) for i in ok)>0.12*len(lines):
        fence=False;ok=[]
        for i,l in enumerate(lines[:-1]):
            if l.strip().startswith("```"): fence=not fence
            if not fence and not l.strip() and i>5 and i not in taken and not lines[i+1].startswith("|"): ok.append(i)
    return min(ok,key=lambda i:abs(i-frac*len(lines)))
PATH=re.compile(r"(?:bench/runs|campaigns)/[A-Za-z0-9._\-/]+")
def norm(p): return p.rstrip("/.,")
docs={}
for src,ns in L_ONLY+M_ONLY+S_ONLY:
    lines=open(f"{repo}/{src}",encoding="utf8").read().split("\n")
    pts=[];taken=set()
    for f,k in ns:
        i=place(lines,f,taken); taken.add(i); pts.append((i,k))
    for i,k in sorted(pts,reverse=True): lines[i+1:i+1]=[N[k][0],""]
    key=[]
    for _,k in pts:
        ln=lines.index(N[k][0])+1
        key.append({"id":k,"line":ln,"re":N[k][1],"thermal":k.startswith("thermal"),"frac":round(ln/len(lines),3)})
    t="\n".join(lines)
    docs[flat(src)]={"src":src,"needles":key,"paths":sorted({norm(x) for x in PATH.findall(t)}),"text":t,"lines":len(lines)}
sets={"S":S_ONLY,"M":M_ONLY+S_ONLY,"L":L_ONLY+S_ONLY,"X":L_ONLY+[M_ONLY[1]]+S_ONLY}
for name,items in sets.items():
    d=f"{root}/{name}"; os.makedirs(d+"/docs",exist_ok=True)
    names=[flat(s) for s,_ in items]
    with open(d+"/MANIFEST.txt","w") as m:
        for i,n in enumerate(names,1): m.write(f"{i:02d} {d}/docs/{n}\n")
    key={}
    for n in names:
        open(f"{d}/docs/{n}","w",encoding="utf8").write(docs[n]["text"])
        key[n]={k:v for k,v in docs[n].items() if k!="text"}
    json.dump({"order":names,"docs":key},open(f"{d}/key.json","w"),indent=1)
