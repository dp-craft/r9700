#!/usr/bin/env python3
"""Replay ONE captured Claude Code /v1/messages body N times against a live vLLM server; per rep record the thinking
length, its distinct-line ratio (loop signature), visible output, tool calls, stop reason, tokens, and the server's
spec-decode acceptance length over the request window (docker logs). Full outputs kept per rep.
Usage: replay.py --body REQ.json --label B --n 5 --out DIR [--max-tokens 40000] [--url http://127.0.0.1:8000] [--container vllm-8000]"""
import argparse, json, os, re, subprocess, time, http.client, urllib.parse, datetime as dt

ap = argparse.ArgumentParser()
ap.add_argument("--body", required=True); ap.add_argument("--label", required=True); ap.add_argument("--n", type=int, default=5)
ap.add_argument("--out", required=True); ap.add_argument("--max-tokens", type=int, default=40000)
ap.add_argument("--url", default="http://127.0.0.1:8000"); ap.add_argument("--container", default="vllm-8000")
ap.add_argument("--model", help="override the body's model (a profile with another served name)")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
body = json.load(open(a.body)); body["max_tokens"] = a.max_tokens; body["stream"] = True
if a.model: body["model"] = a.model
raw = json.dumps(body).encode()
u = urllib.parse.urlparse(a.url)
ACC = re.compile(r"(\d\d-\d\d \d\d:\d\d:\d\d).*Mean acceptance length: ([0-9.]+)")


def acceptance(t0, t1):
    out = subprocess.run(["docker", "logs", "--since", t0, "--until", t1, a.container], capture_output=True, text=True)
    v = [float(m.group(2)) for m in ACC.finditer(out.stdout + out.stderr)]
    return {"windows": len(v), "mean": round(sum(v) / len(v), 2) if v else None, "frac_ge7": round(sum(x >= 7 for x in v) / len(v), 2) if v else None}


def one(rep):
    t0 = dt.datetime.now(dt.timezone.utc); w0 = time.time(); ttft = None
    blocks = {}; stop = None; usage = {}
    c = http.client.HTTPConnection(u.hostname, u.port, timeout=3600)
    c.request("POST", "/v1/messages", body=raw, headers={"content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": "sk-no-key-required"})
    r = c.getresponse()
    if r.status != 200:
        return {"label": a.label, "rep": rep, "http": r.status, "error": r.read()[:2000].decode(errors="replace")}
    for line in r:
        line = line.decode(errors="replace").strip()
        if not line.startswith("data:"): continue
        try: d = json.loads(line[5:])
        except Exception: continue
        t = d.get("type")
        if t == "message_start": usage.update(d.get("message", {}).get("usage") or {})
        elif t == "content_block_start":
            cb = d["content_block"]; blocks[d["index"]] = {"type": cb["type"], "name": cb.get("name"), "buf": []}
        elif t == "content_block_delta":
            ttft = ttft or time.time() - w0
            dl = d["delta"]; b = blocks.setdefault(d["index"], {"type": "?", "name": None, "buf": []})
            b["buf"].append(dl.get("thinking") or dl.get("text") or dl.get("partial_json") or "")
        elif t == "message_delta":
            stop = (d.get("delta") or {}).get("stop_reason"); usage.update(d.get("usage") or {})
    t1 = dt.datetime.now(dt.timezone.utc); wall = time.time() - w0
    think = "".join("".join(b["buf"]) for b in blocks.values() if b["type"] == "thinking")
    text = "".join("".join(b["buf"]) for b in blocks.values() if b["type"] == "text")
    tools = []
    for b in blocks.values():
        if b["type"] == "tool_use":
            s = "".join(b["buf"])
            try: inp = json.loads(s)
            except Exception: inp = {"_unparsed": s[:200]}
            tools.append({"name": b["name"], "file_path": inp.get("file_path"), "command": (inp.get("command") or "")[:160], "input_chars": len(s), "input": inp})
    ls = [x.strip() for x in think.splitlines() if x.strip()]
    ratio = round(len(set(ls)) / len(ls), 3) if ls else None
    row = {"label": a.label, "rep": rep, "start_utc": t0.isoformat(timespec="seconds"), "wall_s": round(wall, 1), "ttft_s": round(ttft or 0, 1),
           "stop_reason": stop, "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
           "thinking_chars": len(think), "thinking_lines": len(ls), "distinct_ratio": ratio, "text_chars": len(text),
           "tools": [{k: v for k, v in t.items() if k != "input"} for t in tools],
           "wrote_review": any((t["file_path"] or "").endswith("W2-08.refine-27b.md") for t in tools),
           "loop": bool(stop == "max_tokens" or (ratio is not None and len(ls) >= 50 and ratio < 0.3)),
           "acceptance": acceptance(t0.strftime("%Y-%m-%dT%H:%M:%SZ"), (t1 + dt.timedelta(seconds=11)).strftime("%Y-%m-%dT%H:%M:%SZ"))}
    json.dump({"metrics": row, "thinking": think, "text": text, "tools": tools}, open(os.path.join(a.out, f"{a.label}-r{rep}.json"), "w"), indent=1)
    return row


for rep in range(1, a.n + 1):
    row = one(rep)
    with open(os.path.join(a.out, "results.jsonl"), "a") as f: f.write(json.dumps(row) + "\n")
    print(json.dumps({k: row.get(k) for k in ("label", "rep", "wall_s", "stop_reason", "output_tokens", "thinking_chars", "distinct_ratio", "wrote_review", "loop", "acceptance", "error")}), flush=True)
