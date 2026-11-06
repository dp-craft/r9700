#!/usr/bin/env python3
"""own_requests.py RAW_JSON SERVER_LINES: keep only this session's Radiance 'done' lines, by the message ids in its transcript. Sessions may run in parallel, so a time window is not enough. Exits 1 if the transcript is missing."""
import glob, json, os, re, sys
sid = json.load(open(sys.argv[1]))["session_id"]
hits = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sid}.jsonl"))
if not hits:
    sys.exit(f"no transcript for session {sid}")
ids = set()
for line in open(hits[0], errors="replace"):
    try:
        m = json.loads(line).get("message")
    except ValueError:
        continue
    if isinstance(m, dict) and str(m.get("id", "")).startswith("msg_"):
        ids.add(m["id"])
for line in open(sys.argv[2], errors="replace"):
    m = re.search(r"req (msg_\w+) done", line)
    if m and m[1] in ids:
        sys.stdout.write(line)
