#!/usr/bin/env bash
# Ollama ROCm benchmark az R9700 (gfx1201) kártyán, optimalizált beállításokkal.
# Méri: prefill (prompt) tok/s, decode (eval) tok/s, betöltési idő, VRAM.
# Szerver env: OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 (a serve indításnál)
set -u
HOST=${HOST:-127.0.0.1:11434}
NUM_CTX=${NUM_CTX:-102400}          # 100K kontextus követelmény
NUM_PREDICT=${NUM_PREDICT:-256}
OUT=${OUT:-/home/dev/work/dippe/amd/bench/ollama_results.jsonl}
: > "$OUT"

CODE_PROMPT='Write a production-quality Python function `merge_intervals(intervals)` that merges overlapping intervals. Include type hints and a docstring. Output only the code.'

models=("$@")

vram_used() { rocm-smi --showmeminfo vram 2>/dev/null | grep -i 'Used' | grep -oE '[0-9]+' | head -1; }

for m in "${models[@]}"; do
  echo "### MODELL: $m"
  # tiszta betöltés méréshez: előbb kiürítjük
  curl -s "http://$HOST/api/generate" -d "{\"model\":\"$m\",\"keep_alive\":0}" >/dev/null 2>&1
  sleep 3
  vram_before=$(vram_used)
  # warm-up + load
  t0=$(date +%s.%N)
  load_json=$(curl -s --max-time 300 "http://$HOST/api/generate" -d "{\"model\":\"$m\",\"prompt\":\"$CODE_PROMPT\",\"stream\":false,\"options\":{\"num_ctx\":$NUM_CTX,\"num_predict\":$NUM_PREDICT,\"temperature\":0.2}}")
  t1=$(date +%s.%N)
  vram_after=$(vram_used)
  echo "$load_json" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('  ERROR:', d['error']); sys.exit()
pe=d.get('prompt_eval_count',0); ped=d.get('prompt_eval_duration',1)/1e9
ec=d.get('eval_count',0);        ed=d.get('eval_duration',1)/1e9
ld=d.get('load_duration',0)/1e9
rec={'model':'$m','num_ctx':$NUM_CTX,'prompt_toks':pe,'prefill_tok_s':round(pe/ped,1) if ped else 0,
     'gen_toks':ec,'decode_tok_s':round(ec/ed,1) if ed else 0,'load_s':round(ld,1),
     'vram_used_gb':round(($vram_after-0)/1e9,1)}
print('  prefill: %6.1f tok/s | decode: %5.1f tok/s | load: %5.1fs | VRAM: %.1f GB' % (rec['prefill_tok_s'],rec['decode_tok_s'],rec['load_s'],rec['vram_used_gb']))
open('$OUT','a').write(json.dumps(rec)+'\n')
"
done
echo "### KÉSZ -> $OUT"
