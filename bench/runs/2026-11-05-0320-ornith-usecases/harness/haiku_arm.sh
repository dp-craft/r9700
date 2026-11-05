#!/usr/bin/env bash
# haiku_arm.sh prep|score TASK SIZE VARIANT: the same fixture, brief and scorer as run_arm.sh, for a Haiku subagent. Work dir: $UC/runs-haiku/<arm>. Results: arms-haiku/<arm>/.
RUN=/home/dev/work/dp-craft/amd/bench/runs/2026-11-05-0320-ornith-usecases; H=$RUN/harness
UC=/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad/uc
TS=/home/dev/work/dp-craft/amd/campaigns/2026-07-14-hardest-tasks-27b-vs-35b/ts-harness/node_modules
CMD=$1; TASK=$2; SIZE=$3; V=$4; ARM=$TASK.$SIZE.$V.haiku; A=$UC/runs-haiku/$ARM; M=$RUN/arms-haiku/$ARM; KD=$UC/$TASK-$SIZE
case "$TASK" in impl|testgen|edit|bugfix) KD=$H/code/$TASK;; esac
if [ "$CMD" = prep ]; then
  rm -rf "$A"; mkdir -p "$A/out" "$M"
  case "$TASK" in
    impl|testgen|edit|bugfix) cp -r $H/code/$TASK/ws/. "$A/"; rmdir "$A/out"
      case "$TASK" in impl|testgen) cp $H/tsconfig.ws.json "$A/tsconfig.json"; cp $H/package.ws.json "$A/package.json"; ln -s $TS "$A/node_modules";; esac
      printf '__pycache__\n.pytest_cache\nnode_modules\n' > "$A/.gitignore"
      (cd "$A" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base);;
    *) find "$KD" -maxdepth 1 -mindepth 1 ! -name key.json -exec cp -r {} "$A/" \;;;
  esac
  case "$TASK" in
    docsplit|docreorg) python3 $H/doc_briefs.py "$TASK" "$V" "$A" > "$M/brief.txt";;
    docnotes) python3 $H/notes_briefs.py "$V" "$A" > "$M/brief.txt";;
    *) python3 $H/briefs.py "$TASK" "$V" "$A" > "$M/brief.txt";;
  esac
  echo "$M/brief.txt"
else
  case "$TASK" in
    docsplit|docreorg) python3 $H/score_doc.py "$A" "$KD" > "$M/score.json";;
    docnotes) python3 $H/score_notes.py "$A" "$KD" > "$M/score.json";;
    *) python3 $H/score.py "$TASK" "$A" "$KD" "$H" > "$M/score.json";;
  esac
  if [ -d "$A/out" ]; then mkdir -p "$M/output"; cp -r "$A/out/." "$M/output/"; else mkdir -p "$M/output"; (cd "$A"; git add -A >/dev/null 2>&1; git -c core.pager=cat diff --cached HEAD -- . ':!node_modules' > "$M/output/diff.patch"); fi
  python3 -c "import json;d=json.load(open('$M/score.json'));print('$ARM',d.get('score'),{k:d[k] for k in ('zero_loss','clean') if k in d})"
fi
