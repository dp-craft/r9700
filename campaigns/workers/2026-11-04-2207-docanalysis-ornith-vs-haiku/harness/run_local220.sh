#!/usr/bin/env bash
# run_local.sh S|M|L: one local-agent arm through the unmodified local-agent.sh, clean flags via its "\$@" passthrough.
S=/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad
Z=$1; ROOT=$S/f/$Z; M=$ROOT/meta; mkdir -p $M
sed -e "s#__ROOT__#$ROOT#g" -e "s#__ARM__#local#g" $S/h/brief.txt > $M/brief-local.txt
python3 /home/dev/work/dp-craft/amd/stack/gpu/vram_sampler.py --out $M/gpu_samples.csv --interval 1 & SP=$!
SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ); T0=$(date +%s.%N)
cd $ROOT
LOCAL_AGENT_SETTINGS=$S/settings-clean220.json LOCAL_AGENT_OUT=$M/local-raw.json MAX_TURNS=80 CLAUDE_CODE_AUTO_COMPACT_WINDOW=220000 \
  /home/dev/work/dp-craft/amd/clients/local-agent/local-agent.sh "$(cat $M/brief-local.txt)" \
  --tools "Read,Grep,Glob,Write" --strict-mcp-config --setting-sources "" --disable-slash-commands > $M/local-result.txt 2>&1
RC=$?; T1=$(date +%s.%N); kill $SP 2>/dev/null
docker logs --since "$SINCE" radiance-8000 > $M/server.log 2>&1
echo "{\"rc\":$RC,\"wall_s\":$(echo "$T1-$T0"|bc)}" > $M/local-timing.json
cat $M/local-timing.json; cat $M/local-result.txt | head -3; ls $ROOT/out-local 2>/dev/null | wc -l
