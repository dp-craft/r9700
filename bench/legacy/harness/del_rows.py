#!/usr/bin/env python3
# Remove rows whose label starts with any given prefix. Usage: del_rows.py <file> <prefix> [prefix...]
import sys, json
fn = sys.argv[1]; prefixes = tuple(sys.argv[2:]); keep = []
for l in open(fn):
    s = l.strip()
    if not s:
        continue
    try:
        r = json.loads(s)
        if r.get("label", "").startswith(prefixes):
            continue
    except Exception:
        pass
    keep.append(s)
open(fn, "w").write("\n".join(keep) + "\n")
print("kept", len(keep), "rows; removed prefixes", prefixes)
