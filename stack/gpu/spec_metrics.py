#!/usr/bin/env python3
"""spec_metrics.py — speculative-decoding acceptance per probe: vLLM's Prometheus counters, radiance's
/metrics + /stats, and llama.cpp's per-request draft_n columns (capture_engine rows).

A speculation speed number without its acceptance is the synthetic headline again (benchmark-
results skill rule 17): DFlash/MTP gains depend on what the model is writing. This snapshots the
cumulative counters before a probe and diffs them after, so each probe gets its own acceptance.

    python3 spec_metrics.py snap URL            > before.json   # {} when the server has no spec counters
    python3 spec_metrics.py diff before.json URL LABEL ENGINE  >> results.jsonl
Emits one {kind:"spec"} row: drafts, draft_tokens, accepted_tokens, acceptance_rate
(accepted/drafted), mean_accept_len (tokens per DRAFT step = 1 + accepted/drafts) and accepted_per_pos
(position-wise acceptance counts). Prints nothing for an engine without spec counters (llama.cpp, a
spec-off vLLM), so it is safe to call unconditionally. Includes any warm-up request that ran inside
the window.

Every source emits the same keys, in this order: the nine above, then source, gen_tokens, tau, tau_def,
comparable, engine_version, n_rows, n_rows_skipped (an error row adds `error`, everything else null).
  tau        tokens per target step. tau_def names the formula: "gen/(gen-accepted)" (radiance,
             llama.cpp; gen = decode tokens WITHOUT each request's prefill-sampled first token) or
             "1+accepted/drafts" (vLLM: = mean_accept_len; equals the former only when every decode
             step drafted). The DFlash papers' "tau" is this tokens-per-step quantity.
  comparable true = tau from a decode-token count without the prefill token (radiance's
             decode_tokens_total; llama.cpp rows, gen-1 per request); false = radiance's fallback
             vllm:generation_tokens_total, which counts it; null = vLLM (other definition) or no tau.
  windows    vLLM and radiance diffs include any warm-up inside the snap/diff window; llama.cpp rows
             exclude warm-ups. Compare acceptance across sources with that caveat.
  The vLLM row's first nine keys and values are unchanged from before G3; the rest are appended.

radiance (no vllm:spec_decode_* counters) is picked up by the same snap/diff: radiance:draft_tokens_total
/ draft_accepted_total / decode_tokens_total, per-position radiance:draft_position_{reached,accepted}
_total (else /stats draft_positions; drafts = position 0's reached), and /stats version + started_at.
Each piece is optional (null when missing). Prints nothing when the window drafted nothing; an `error`
row when a counter went backwards, started_at changed (restart) or accepted > drafted / gen < accepted.

    python3 spec_metrics.py rows ROWS.jsonl|- LABEL ENGINE [PROPS.json]  >> results.jsonl   # llama.cpp
sums draft_n/draft_n_accepted/gen_tokens over capture_engine request/turn rows of LABEL+ENGINE
(errored and `short` rows skipped; warm-ups have no rows, so they are NOT included here) into the
same schema with source:"llamacpp_timings" (drafts/mean_accept_len/accepted_per_pos null: llama.cpp
does not report them). n_rows = rows used, n_rows_skipped = ok rows without a usable draft_n. PROPS.json
(the server's /props) gives engine_version = build_info. Prints nothing when no row drafted. Run it only
for llama.cpp servers (radiance timings carry draft_n too) and only on this probe's own rows.
"""
import json, math, re, sys, urllib.error, urllib.request

LINE = re.compile(r'^vllm:(spec_decode_num_(?:drafts|draft_tokens|accepted_tokens|accepted_tokens_per_pos))'
                  r'(?:_total)?(\{[^}]*\})?\s+([0-9.eE+-]+)$')
RAD_LINE = re.compile(r'^((?:radiance|vllm):[a-z_]+)(\{[^}]*\})?\s+([0-9.eE+-]+)$')
RAD_COUNTERS = {"radiance:draft_tokens_total": "draft_tokens", "radiance:draft_accepted_total": "accepted_tokens",
                # HELP: "Tokens the engine has generated, exact, counted when the step commits"; on the
                # 1.16.0 capture decode - accepted = steps_decode exactly, i.e. no prefill-sampled token
                "radiance:decode_tokens_total": "gen_tokens",
                # fallback only: 2545 vs 2536 decode on the same capture (INFERRED: counts each request's
                # first token), so a tau from it is marked comparable:false
                "vllm:generation_tokens_total": "gen_tokens_finished"}
RAD_POS = {"radiance:draft_position_reached_total": "reached", "radiance:draft_position_accepted_total": "accepted"}
SPEC_KEYS = ("kind", "label", "engine", "drafts", "draft_tokens", "accepted_tokens", "acceptance_rate",
             "mean_accept_len", "accepted_per_pos", "source", "gen_tokens", "tau", "tau_def", "comparable",
             "engine_version", "n_rows", "n_rows_skipped")
TAU_GEN, TAU_MAL = "gen/(gen-accepted)", "1+accepted/drafts"


def snap(url):
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    try:
        text = urllib.request.urlopen(base.rstrip("/") + "/metrics", timeout=10).read().decode()
    except Exception:
        return snap_radiance(url)
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
    return out or snap_radiance(url)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read().decode()
    except urllib.error.HTTPError as e:      # a 404 holds an open response: close it, then report
        e.close()
        raise


def snap_radiance(url):
    """radiance's cumulative spec state, or {} when it has none. Tolerant: /stats is read from one
    radiance 1.16.0 capture only, so any missing/odd piece is just left out. Per-position counts come
    from the typed /metrics counters when present, else from /stats draft_positions."""
    base = (url[:-3] if url.rstrip("/").endswith("/v1") else url).rstrip("/")
    out, pos_m = {}, {"reached": {}, "accepted": {}}
    try:
        st = json.loads(_get(base + "/stats"))
    except Exception:
        st = None
    try:
        text = _get(base + "/metrics")
    except Exception:
        text = ""
    for line in text.splitlines():
        m = RAD_LINE.match(line.strip())
        if not m:
            continue
        v = float(m.group(3))
        if not math.isfinite(v):
            continue
        if m.group(1) in RAD_COUNTERS:
            k = RAD_COUNTERS[m.group(1)]
            out[k] = out.get(k, 0) + v
        elif m.group(1) in RAD_POS:
            p = re.search(r'position="(\d+)"', m.group(2) or "")
            if p:
                d = pos_m[RAD_POS[m.group(1)]]
                d[p.group(1)] = d.get(p.group(1), 0) + v
    if pos_m["accepted"] or pos_m["reached"]:
        if pos_m["accepted"]:
            out["per_pos"] = pos_m["accepted"]
        if "0" in pos_m["reached"]:
            out["drafts"] = pos_m["reached"]["0"]
    else:
        pos = st.get("draft_positions") if isinstance(st, dict) else None
        if isinstance(pos, list) and pos and all(isinstance(p, dict) for p in pos):
            if all(_num(p.get("accepted")) for p in pos):
                out["per_pos"] = {str(i): p["accepted"] for i, p in enumerate(pos)}
            if _num(pos[0].get("reached")):
                out["drafts"] = pos[0]["reached"]
    if not {"per_pos", "drafts", "draft_tokens", "accepted_tokens"} & set(out):
        return {}
    if isinstance(st, dict):
        if isinstance(st.get("version"), str):
            out["version"] = st["version"]
        if _num(st.get("started_at")):
            out["started_at"] = st["started_at"]
    out["source"] = "radiance"
    return out


def _spec_row(label, engine, source, drafts, drafted, acc, gen, per_pos, comparable=True, version=None,
              n_rows=None, n_skipped=None):
    i = lambda v: int(v) if v is not None else None                       # noqa: E731
    tau = round(gen / (gen - acc), 3) if gen and acc is not None and gen > acc else None
    return {"kind": "spec", "label": label, "engine": engine,
            "drafts": i(drafts), "draft_tokens": i(drafted), "accepted_tokens": i(acc),
            "acceptance_rate": round(acc / drafted, 4) if drafted and acc is not None else None,
            "mean_accept_len": round(1 + acc / drafts, 3) if drafts and acc is not None else None,
            "accepted_per_pos": [int(v) for v in per_pos] if per_pos is not None else None,
            "source": source, "gen_tokens": i(gen),
            "tau": tau,
            "tau_def": TAU_GEN, "comparable": comparable if tau is not None else None, "engine_version": version,
            "n_rows": n_rows, "n_rows_skipped": n_skipped}


def _error_row(label, engine, source, msg, version=None):
    """Same keys as a spec row (all null, so row["tau"] never raises downstream) + `error`."""
    row = dict.fromkeys(SPEC_KEYS)
    row.update(kind="spec", label=label, engine=engine, source=source, engine_version=version, error=msg)
    return row


def _implausible(drafted, acc, gen):
    if any(v is not None and v < 0 for v in (drafted, acc, gen)):           # tau >= 1 then follows from gen > acc >= 0
        return f"implausible window: negative count (drafted {drafted}, accepted {acc}, gen {gen})"
    if acc is not None and drafted is not None and acc > drafted:
        return f"implausible window: accepted {acc:g} > drafted {drafted:g}"
    if acc is not None and gen is not None and gen < acc:
        return f"implausible window: gen {gen:g} < accepted {acc:g}"
    return None


def diff_radiance(before, after, label, engine):
    """One {kind:"spec"} row for the window, None when nothing was drafted in it."""
    def d(k):
        a, b = after.get(k), before.get(k)
        return a - b if a is not None and b is not None else None
    ver = after.get("version")
    if before.get("started_at") is not None and after.get("started_at") not in (None, before["started_at"]):
        return _error_row(label, engine, "radiance", "server restarted between snap and diff (started_at changed)", ver)
    pa, pb = after.get("per_pos"), before.get("per_pos")
    pp = [pa[p] - pb[p] for p in sorted(pa, key=int)] if pa and pb and set(pa) == set(pb) else None
    acc = d("accepted_tokens")
    if acc is None and pp is not None:
        acc = sum(pp)
    drafts, drafted = d("drafts"), d("draft_tokens")
    gen, comparable = d("gen_tokens"), True
    if gen is None and d("gen_tokens_finished") is not None:
        gen, comparable = d("gen_tokens_finished"), False
    if any(v < 0 for v in [acc, drafts, drafted, gen] + (pp or []) if v is not None):
        return _error_row(label, engine, "radiance", "a counter went backwards (server restarted between snap and diff?)", ver)
    if not (drafts or drafted or acc):
        return None
    bad = _implausible(drafted, acc, gen)
    if bad:
        return _error_row(label, engine, "radiance", bad, ver)
    return _spec_row(label, engine, "radiance", drafts, drafted, acc, gen, pp, comparable, ver)


def from_rows(lines, label, engine, version=None):
    """llama.cpp: the capture_engine request/turn rows' draft_n columns → one spec row (or None)."""
    dn = da = gen = n = skipped = 0
    for line in lines:
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (not isinstance(r, dict) or r.get("kind") not in ("request", "turn") or r.get("label") != label
                or r.get("engine") != engine or "error" in r or r.get("short")):
            continue
        if not _num(r.get("draft_n")):
            skipped += 1
            continue
        n += 1
        dn += r["draft_n"]
        da = da + r["draft_n_accepted"] if da is not None and _num(r.get("draft_n_accepted")) else None
        # the first token is sampled by the prefill pass, not a decode step (radiance's decode counter
        # excludes it too): without this, tau leans toward 1 by ~1 token per request
        gen = gen + max(r["gen_tokens"] - 1, 0) if gen is not None and _num(r.get("gen_tokens")) else None
    if not dn:
        return None
    bad = _implausible(dn, da, gen)
    if bad:
        return _error_row(label, engine, "llamacpp_timings", bad, version)
    return _spec_row(label, engine, "llamacpp_timings", None, dn, da, gen, None, True, version, n, skipped)


def _props_build(path):
    try:
        with open(path) as fh:
            b = json.load(fh).get("build_info")
        return b if isinstance(b, str) else None
    except Exception:
        return None


def _vllm_version(url):
    base = (url[:-3] if url.rstrip("/").endswith("/v1") else url).rstrip("/")
    try:
        v = json.loads(_get(base + "/version", timeout=5)).get("version")
        return v if isinstance(v, str) else None
    except Exception:
        return None


def main():
    if sys.argv[1] == "snap":
        print(json.dumps(snap(sys.argv[2])))
        return
    if sys.argv[1] == "rows":
        ver = _props_build(sys.argv[5]) if len(sys.argv) > 5 else None
        if sys.argv[2] == "-":
            row = from_rows(sys.stdin, sys.argv[3], sys.argv[4], ver)
        else:
            with open(sys.argv[2]) as fh:
                row = from_rows(fh, sys.argv[3], sys.argv[4], ver)
        if row:
            print(json.dumps(row))
        return
    with open(sys.argv[2]) as fh:
        before = json.load(fh)
    after = snap(sys.argv[3])
    if not after or not before:
        return
    if "source" in after or "source" in before:          # radiance (the vLLM path below is unchanged)
        if after.get("source") == before.get("source"):
            row = diff_radiance(before, after, sys.argv[4], sys.argv[5])
            if row:
                print(json.dumps(row))
        return
    d = {k: after.get(k, 0) - before.get(k, 0) for k in after if k != "per_pos"}
    drafts = d.get("spec_decode_num_drafts", 0)
    drafted = d.get("spec_decode_num_draft_tokens", 0)
    acc = d.get("spec_decode_num_accepted_tokens", 0)
    pp = {p: after.get("per_pos", {}).get(p, 0) - before.get("per_pos", {}).get(p, 0)
          for p in sorted(after.get("per_pos", {}), key=int)}
    row = {"kind": "spec", "label": sys.argv[4], "engine": sys.argv[5],
           "drafts": int(drafts), "draft_tokens": int(drafted), "accepted_tokens": int(acc),
           "acceptance_rate": round(acc / drafted, 4) if drafted else None,
           "mean_accept_len": round(1 + acc / drafts, 3) if drafts else None,
           "accepted_per_pos": [int(v) for v in pp.values()]}
    # G3: appended only (the nine keys above are the pre-G3 row, unchanged). gen_tokens stays null on
    # purpose: tau here is the mean accepted length (TAU_MAL), which needs no gen count, and adding
    # vllm:generation_tokens_total would change what snap() records.
    row.update(source="vllm_metrics", gen_tokens=None, tau=row["mean_accept_len"], tau_def=TAU_MAL,
               comparable=None, engine_version=_vllm_version(sys.argv[3]), n_rows=None, n_rows_skipped=None)
    print(json.dumps(row))


if __name__ == "__main__":
    main()
