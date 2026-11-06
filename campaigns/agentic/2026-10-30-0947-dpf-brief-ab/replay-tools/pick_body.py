#!/usr/bin/env python3
"""From capture_proxy.py bodies (CAPDIR/req-NNN*.json) pick the main-loop request that produced the W2-08 blind-review
Write: the LAST /v1/messages body with tools whose history does not yet contain that Write. Copies it to OUT.
Usage: pick_body.py CAPDIR OUT"""
import glob, json, os, re, shutil, sys
cap, out = sys.argv[1], sys.argv[2]
TARGET = "W2-08.refine-27b.md"


def has_write(body):
    for m in body.get("messages", []):
        for c in m.get("content") if isinstance(m.get("content"), list) else []:
            if c.get("type") == "tool_use" and c.get("name") in ("Write", "Edit") and str((c.get("input") or {}).get("file_path", "")).endswith(TARGET):
                return True
    return False


pick = None; n_main = 0
for f in sorted(glob.glob(os.path.join(cap, "req-*.json")), key=lambda s: int(re.search(r"req-(\d+)", s).group(1))):
    if not f.endswith("_v1_messages.json"): continue      # not /v1/messages/count_tokens etc.
    try: b = json.load(open(f))
    except Exception: continue
    if not b.get("tools"): continue                       # side calls (titles, compaction summaries) carry no tools
    n_main += 1
    if has_write(b): break
    pick = f
if not pick: sys.exit("no main-loop body before the W2-08 review Write")
shutil.copy(pick, out)
b = json.load(open(out))
print(f"picked {os.path.basename(pick)} of {n_main} main-loop bodies: {len(b['messages'])} messages, {len(json.dumps(b))} bytes, max_tokens {b.get('max_tokens')}")
