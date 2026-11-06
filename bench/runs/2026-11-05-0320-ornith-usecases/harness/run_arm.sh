#!/usr/bin/env bash
# run_arm.sh TASK SIZE VARIANT PRESET [REP]: one Ornith arm through the skill's ornith.sh; arms may run in parallel. Rerun skips finished arms. Failed or cut runs go to quarantine/. ARM_CAP = seconds before the session is cut. SYS_ARGS = extra claude flags, used for the system prompt test; @P@ becomes the profile. ARM_PROFILE overrides the profile. ORN overrides the wrapper (the wide allow-list test).
RUN=/home/dev/work/dp-craft/amd/bench/runs/2026-11-05-0320-ornith-usecases; H=$RUN/harness
UC=/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad/uc
ORN=${ORN:-/home/dev/work/dippe/skills-agents/skills/ornith/scripts/ornith.sh}
TS=/home/dev/work/dp-craft/amd/campaigns/2026-07-14-hardest-tasks-27b-vs-35b/ts-harness/node_modules
TASK=$1; SIZE=$2; V=$3; P=$4; REP=${5:-}; ARM=$TASK.$SIZE.$V.$P${REP:+.$REP}; A=$UC/runs/$ARM; M=$RUN/arms/$ARM
[ -f "$M/result.json" ] && { echo "skip $ARM"; exit 0; }
case "$P" in P0) want="presence-penalty 1.5"; want2="--temp 1.0";; P1) want="presence-penalty 0"; want2="--temp 1.0";; P2) want="presence-penalty 0"; want2="--temp 0.6";; esac
ARGS=$(docker inspect radiance-8000 --format '{{join .Args " "}}' 2>/dev/null)
LAST_PP=$(printf '%s' "$ARGS" | grep -oE 'presence-penalty [0-9.]+' | tail -1); LAST_T=$(printf '%s' "$ARGS" | grep -oE -- '--temp [0-9.]+' | tail -1)
[ "$LAST_PP" = "$want" ] && [ "$LAST_T" = "$want2" ] || { echo "PRESET MISMATCH $ARM: server has $LAST_T $LAST_PP"; exit 3; }
rm -rf "$A"; mkdir -p "$A/out" "$M"
PROFILE=read; KD=$UC/$TASK-$SIZE
case "$TASK" in
  impl|testgen|edit|bugfix) PROFILE=code; KD=$H/code/$TASK; cp -r $H/code/$TASK/ws/. "$A/"; rmdir "$A/out"
    case "$TASK" in impl|testgen) cp $H/tsconfig.ws.json "$A/tsconfig.json"; cp $H/package.ws.json "$A/package.json"; ln -s $TS "$A/node_modules"; printf 'node_modules\n' > "$A/.gitignore";; esac
    printf '__pycache__\n.pytest_cache\nnode_modules\n' > "$A/.gitignore"
    (cd "$A" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base);;
  *) find "$KD" -maxdepth 1 -mindepth 1 ! -name key.json -exec cp -r {} "$A/" \;;;
esac
[ "$V" = V3 ] && PROFILE=data
[ -n "${ARM_PROFILE:-}" ] && PROFILE=$ARM_PROFILE
case "$TASK" in
  docsplit|docreorg) [ "$V" = V2 ] && PROFILE=data; python3 $H/doc_briefs.py "$TASK" "$V" "$A" > "$M/brief.txt";;
  docnotes) python3 $H/notes_briefs.py "$V" "$A" > "$M/brief.txt";;
  *) python3 $H/briefs.py "$TASK" "$V" "$A" > "$M/brief.txt";;
esac
sleep 2
python3 /home/dev/work/dp-craft/amd/bench/lib/vram_sampler.py --out "$M/gpu.csv" --interval 2 >/dev/null 2>&1 & SMP=$!
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ); T0=$(date +%s.%N)
SYS_ARGS=${SYS_ARGS//@P@/$PROFILE}; cd "$A"; ORNITH_OUT="$M/raw.json" MAX_TURNS=${MAX_TURNS:-80} timeout ${ARM_CAP:-1800} "$ORN" --profile "$PROFILE" "$(cat "$M/brief.txt")" ${SYS_ARGS:-} > "$M/reply.txt" 2>&1; RC=$?
T1=$(date +%s.%N); kill $SMP 2>/dev/null; wait $SMP 2>/dev/null
docker logs --since "$SINCE" radiance-8000 2>&1 | grep -E ' req msg_.* done ' > "$M/server.all"
python3 $H/own_requests.py "$M/raw.json" "$M/server.all" > "$M/server.log" 2>"$M/own.err"; rm -f "$M/server.all"
python3 $H/serverstats.py "$M/server.log" 2>/dev/null | head -1 > "$M/server.json"
if [ $RC -ne 0 ] || grep -q 'ORNITH ERROR' "$M/reply.txt"; then
  mkdir -p $RUN/quarantine; rm -rf "$RUN/quarantine/$ARM"; mv "$M" "$RUN/quarantine/$ARM"; echo "QUARANTINE $ARM rc=$RC"; exit 0
fi
case "$TASK" in
  docsplit|docreorg) python3 $H/score_doc.py "$A" "$KD" > "$M/score.json" 2>"$M/score.err";;
  docnotes) python3 $H/score_notes.py "$A" "$KD" > "$M/score.json" 2>"$M/score.err";;
  *) python3 $H/score.py "$TASK" "$A" "$KD" "$H" > "$M/score.json" 2>"$M/score.err";;
esac
mkdir -p "$M/output"; if [ -d "$A/out" ]; then cp -r "$A/out/." "$M/output/"; else (cd "$A"; git add -A >/dev/null 2>&1; git -c core.pager=cat diff --cached HEAD -- . ':!node_modules' > "$M/output/diff.patch" 2>/dev/null); fi
python3 - "$M" "$ARM" "$T0" "$T1" "$PROFILE" <<'PY'
import csv,json,sys
M,arm,t0,t1,pr=sys.argv[1:]
s=json.load(open(f"{M}/server.json"));sc=json.load(open(f"{M}/score.json"));raw=json.load(open(f"{M}/raw.json"))
vr=gt=0
try:
    for r in csv.DictReader(open(f"{M}/gpu.csv")):
        for k,v in r.items():
            try: x=float(v)
            except: continue
            if "vram" in k and "used" in k: vr=max(vr,x)
            if "gtt" in k and "used" in k: gt=max(gt,x)
except Exception: pass
out=dict(arm=arm,profile=pr,wall_s=round(float(t1)-float(t0),1),turns=raw.get("num_turns"),gen=s["gen"],reason=s["reason"],prompt_first=s["prompt_first"],prompt_peak=s["prompt_peak"],drops=s["prompt_drops"],rate=s["gen_rate_weighted"],peak_vram=vr,peak_gtt=gt,score=sc.get("score"),detail=sc)
json.dump(out,open(f"{M}/result.json","w"),indent=1)
print(arm,"wall",out["wall_s"],"gen",out["gen"],"peak",out["prompt_peak"],"drops",out["drops"],"score",out["score"])
PY
