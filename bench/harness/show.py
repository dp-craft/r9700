#!/usr/bin/env python3
# Pretty-print a results jsonl file. Usage: show.py <file> [file2 ...]
import sys, json
rows = []
for fn in sys.argv[1:]:
    for l in open(fn):
        l = l.strip()
        if not l or '"_meta"' in l:
            continue
        try:
            rows.append(json.loads(l))
        except Exception:
            pass
h = f"{'label':<18}{'model':<11}{'be':<10}{'kv':<5}{'ub':<6}{'batch':<7}{'prefill':>9}{'decode':>8}{'vram':>8}"
print(h); print('-' * len(h))
for r in rows:
    be = r.get('backend', r.get('engine', ''))[:9]
    print(f"{r.get('label','')[:17]:<18}{str(r.get('model',''))[:10]:<11}{be:<10}"
          f"{str(r.get('kv_bits','')):<5}{str(r.get('ub','')):<6}{str(r.get('batch','')):<7}"
          f"{str(r.get('prefill_tok_s', r.get('status',''))):>9}{str(r.get('decode_tok_s','')):>8}"
          f"{str(r.get('vram_used_mb','')):>8}"
          + (f"  draft={r['draft']}" if r.get('draft') else '')
          + (f"  nb={r['num_batch']}" if r.get('num_batch') else ''))
