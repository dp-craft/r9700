#!/usr/bin/env python3
"""spec_metrics.py — speculative-decoding acceptance per probe, from vLLM's Prometheus counters.

A speculation speed number without its acceptance is the synthetic headline again (benchmark-
results skill rule 17): DFlash/MTP gains depend on what the model is writing. This snapshots the
cumulative counters before a probe and diffs them after, so each probe gets its own acceptance.

    python3 spec_metrics.py snap URL            > before.json   # {} when the server has no spec counters
    python3 spec_metrics.py diff before.json URL LABEL ENGINE  >> results.jsonl
Emits one {kind:"spec"} row: drafts, draft_tokens, accepted_tokens, acceptance_rate
(accepted/drafted), mean_accept_len (tokens per verify step = 1 + accepted/drafts — the "tau" of
the DFlash papers) and accepted_per_pos (position-wise acceptance counts). Prints nothing for an
engine without spec counters (llama.cpp, a spec-off vLLM), so it is safe to call unconditionally.
Includes any warm-up request that ran inside the window.
"""
import json, re, sys, urllib.request

LINE = re.compile(r'^vllm:(spec_decode_num_(?:drafts|draft_tokens|accepted_tokens|accepted_tokens_per_pos))'
                  r'(?:_total)?(\{[^}]*\})?\s+([0-9.eE+-]+)$')


def snap(url):
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    try:
        text = urllib.request.urlopen(base.rstrip("/") + "/metrics", timeout=10).read().decode()
    except Exception:
        return {}
    out = {}
    for line in text.splitlines():
        m = LINE.match(line.strip())
        if not m:
            continue
        name, labels, val = m.group(1), m.group(2) or "", float(m.group(3))
        if name.endswith("_per_pos"):
            pos = re.search(r'position="(\d+)"', labels)
            if pos:
                out.setdefault("per_pos", {})
                out["per_pos"][pos.group(1)] = out["per_pos"].get(pos.group(1), 0) + val
        else:
            out[name] = out.get(name, 0) + val
    return out


def main():
    if sys.argv[1] == "snap":
        print(json.dumps(snap(sys.argv[2])))
        return
    before = json.load(open(sys.argv[2]))
    after = snap(sys.argv[3])
    if not after or not before:
        return
    d = {k: after.get(k, 0) - before.get(k, 0) for k in after if k != "per_pos"}
    drafts = d.get("spec_decode_num_drafts", 0)
    drafted = d.get("spec_decode_num_draft_tokens", 0)
    acc = d.get("spec_decode_num_accepted_tokens", 0)
    pp = {p: after.get("per_pos", {}).get(p, 0) - before.get("per_pos", {}).get(p, 0)
          for p in sorted(after.get("per_pos", {}), key=int)}
    print(json.dumps({"kind": "spec", "label": sys.argv[4], "engine": sys.argv[5],
                      "drafts": int(drafts), "draft_tokens": int(drafted), "accepted_tokens": int(acc),
                      "acceptance_rate": round(acc / drafted, 4) if drafted else None,
                      "mean_accept_len": round(1 + acc / drafts, 3) if drafts else None,
                      "accepted_per_pos": [int(v) for v in pp.values()]}))


if __name__ == "__main__":
    main()
