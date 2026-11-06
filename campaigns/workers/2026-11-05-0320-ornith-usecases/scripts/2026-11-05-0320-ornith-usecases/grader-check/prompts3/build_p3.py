#!/usr/bin/env python3
"""build_p3.py: blind grading set judge-p3 = base, dp, dpr notes per report under random labels (seed 20261106)."""
import json,os,random,shutil
RUN='/home/dev/work/dp-craft/amd/bench/runs/2026-11-05-0320-ornith-usecases'; SP='/tmp/claude-1001/-home-dev-work-dp-craft-amd/bf832afa-1002-41d9-a4b8-4b201a1bc43c/scratchpad'
OLD=f'{SP}/judge-p2'; NEW=f'{SP}/judge-p3'
REP={'buildcmp':'2026-09-15-stew675-buildcmp.analysis.md','sharp':'2026-10-31-redhat-sharp-w208-blind.analysis.md',
     'depth':'2026-10-30-0900-vllm-redhat-mxfp4-depth-transposed.md','hardest':'2026-07-14-hardest-tasks-27b-vs-35b.analysis.md'}
ARMS={'base':'','dp':'.dp','dpr':'.dpr'}
rnd=random.Random(20261106); key={}
os.makedirs(f'{NEW}/out',exist_ok=True); shutil.copytree(f'{OLD}/docs',f'{NEW}/docs',dirs_exist_ok=True)
for short,doc in REP.items():
    arms=list(ARMS); rnd.shuffle(arms); key[doc]={}
    os.makedirs(f'{NEW}/notes/{doc}',exist_ok=True)
    for lab,arm in zip('ABC',arms):
        src=f'{RUN}/arms/docnotes.{short}.V2.P0{ARMS[arm]}/output/01.txt'
        shutil.copy(src,f'{NEW}/notes/{doc}/{lab}.txt'); key[doc][lab]=arm
json.dump(key,open(f'{NEW}/label-key.json','w'),indent=1)
print(json.dumps({d:sorted(k) for d,k in key.items()}))
