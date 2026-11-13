#!/usr/bin/env python3
"""kld_probe.py — quantization-fidelity KLD probe (campaign 2026-11-09-27b-arms-kld, WS3).

Compares a served checkpoint's next-token distribution against the local FP8 reference
(Qwen__Qwen3.8-27B-FP8@017b9c7a, D8 — bf16 unavailable on this stack) and reports mean
per-position KL in nats/tok with a cluster-bootstrap CI.

Method (locked by the WS3 research — research/ws3-kld-r1.md / r2.md source every choice):
  mode      paired greedy continuation: reference and arm generate N tokens at temp 0 with
            logprobs=20; positions pair WHILE THE GENERATED TOKENS MATCH (contexts then
            identical by construction); the first-divergent position IS included (its
            context is still identical), the rest of that prompt is dropped. Radiance
            never returns prompt logprobs (1.17.0 oai.cpp: "never leave the card"), so
            prompt-scoring cannot be the uniform campaign mode — it stays an optional
            labeled bonus pass on sly-served pairs (r2 §2).
  KL        per position, sly kv4/kl_compare.py verbatim — a LOWER BOUND:
              KL̂_i = max(0, Σ_{t∈ref top-20} p_t·(r_t − a_t) + rt·ln(rt/at))
            a_t = arm top-20 logprob; token missing from arm top-20 ⇒ floor (the arm's
            minimum top-20 logprob); rt = max(ε, 1−Σref), at = max(ε, 1−Σarm); ε=1e-9.
  CI        cluster bootstrap (block = prompt) B=2000, percentile 95 % (headline);
            pooled 1.96·SD/√n (sly convention) reported alongside as cross-check
            (r2 §3: pooled is ~1.46× too narrow at intra-text ρ≈0.3).
  extras    paired dNLL (r_{x_i} − a_{x_i}), top-1 agreement over all generated positions,
            mean top-20 coverage (ref and arm), median/mean first-divergent position,
            per-1k segments of the pooled KL.
  noise     the A-vs-B pair (same checkpoint, radiance 1.11.0 vs 1.17.0) is the
            engine-version noise floor; a reference self-run bounds boot noise (r2 §4).

TDD: bench/perf/test_kld_probe.py (synthetic fixtures: exact KL vs hand-computed, floor,
clamp, tail bucket, pairing, cluster CI on known shapes; shape-normalizer unit tests;
selftest/fetch against a canned loopback HTTP server — the live logprobs shape is
shape-tolerant (_topk_entries) and the observed shape is always reported (logprobs_shape)
in the selftest JSON and fetch errors, after the 2026-11-10 short run returned 0 logprob
rows on every live fetch). HTTP is stdlib urllib only (sly convention). All arms share the
Qwen3.8 tokenizer. Top-k entries are joined by TOKEN ID when both sides carry ids for every
entry (llama.cpp/radiance `id`, vLLM "token_id:N" via return_tokens_as_token_ids, 2026-11-13);
otherwise by canonical STRING (canon_tok/canon_top — rows fetched before ids were kept).

  python3 kld_probe.py selftest --url http://127.0.0.1:8000/v1 --model <served> [--out FILE]
  python3 kld_probe.py fetch    --url ... --model <served> --calibration prompts.jsonl --out FILE
  python3 kld_probe.py score    --ref ref.jsonl --arm arm.jsonl --label <arm> --out FILE

Calibration file = one JSON prompt per line: {"id": "p001", "src": "bench/workloads/
corpus/<path>", "char_cut": N} (src resolved against the repo root; the prompt is the
first char_cut chars of the file — raw text, NO chat template: templates differ between
engine families and would break pairing, r2 §1.2/§1.3).
"""
import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

EPS = 1e-9            # sly kv4/kl_compare.py
TOP_K = 20            # OpenAI cap (radiance OPS.md; vLLM max_logprobs default)
N_MAX = 512           # generated tokens per prompt (r2 §5.3)
BOOT_B = 2000
SEG_K = 1000
PROBE_TEXT = "def kld_selftest_fixture(n):\n    return sum(i * i for i in range(n))\n" * 40


# ------------------------------------------------------------------ math core (unit-tested)
def _mass(entries):
    return sum(math.exp(lp) for _, lp in entries)


SPECIAL_BUCKET = "<special>"
_SPECIAL_RE = re.compile(r"<\|[^|<>]*\|>|<tts_[A-Za-z_]+>")


def canon_tok(tok):
    """One string per token across engines. llama.cpp renders control specials (<|im_end|>, <|endoftext|>…) as ''
    and vLLM/Radiance as their text, so every special — and '' — maps to one bucket. 2026-11-12: string keys made
    the q8 self-floor read 0.11 nats/tok (several '' in one top-20 collided in a dict) and charged ~20 nats at
    every end-of-turn position across engines. Non-special added tokens (<think>, <tool_call>) keep their text."""
    if not isinstance(tok, str):
        return tok                        # token ids (id join, synthetic fixtures) are already unambiguous
    return SPECIAL_BUCKET if tok == "" or _SPECIAL_RE.fullmatch(tok) else tok


def canon_top(top):
    """A top-k list over canonical tokens: entries that share a canonical string merge by logsumexp (a coarser
    event space applied identically to both sides, so the KL stays a lower bound). Sorted by logprob, descending."""
    m = {}
    for tok, lp in top:
        t = canon_tok(tok)
        if t in m:
            hi, lo = max(m[t], lp), min(m[t], lp)
            m[t] = hi + math.log1p(math.exp(lo - hi))
        else:
            m[t] = lp
    return sorted(m.items(), key=lambda kv: -kv[1])


def kl_position(ref_top, arm_top):
    """KL(ref ‖ arm) at one position (sly kv4/kl_compare.py, a lower bound, clamped ≥ 0).

    ref_top: list of (token, logprob) — the REFERENCE top-20 (the support). arm_top:
    list of (token, logprob) — the arm's top-20. Returns (kl, ref_mass, arm_mass): kl in
    nats; masses = each side's top-20 coverage (the resolution statistic, r2 §4).
    """
    ref_top, arm_top = canon_top(ref_top), canon_top(arm_top)
    arm_map = dict(arm_top)
    floor = min(lp for _, lp in arm_top)
    ref_mass = _mass(ref_top)
    arm_mass = _mass(arm_top)
    rt = max(EPS, 1.0 - ref_mass)
    at = max(EPS, 1.0 - arm_mass)
    s = 0.0
    for tok, r in ref_top:
        a = arm_map.get(tok, floor)       # missing in arm top-20 ⇒ floor (lower bound)
        s += math.exp(r) * (r - a)
    s += rt * math.log(rt / at)           # lumped tail bucket
    return max(0.0, s), ref_mass, arm_mass


ID_PREFIX = "token_id:"   # vLLM return_tokens_as_token_ids renders every token as "token_id:N"


def _ids_ok(top, ids):
    return (isinstance(ids, list) and len(ids) == len(top)
            and all(isinstance(i, int) and not isinstance(i, bool) for i in ids))


def join_keys(rtok, rtop, rid, rids, atok, atop, aid, aids, placeholder=False):
    """Key one position of ref and arm for scoring → (rtok, rtop, atok, atop, join).

    join "id": both sides carry an id for EVERY top-k entry and for the chosen token → every token is replaced by
    its id (ints pass canon_tok untouched, duplicate ids still merge by logsumexp in canon_top, the tail bucket is
    the same code). Server-side string collisions ('' for specials / partial UTF-8) cannot merge distinct tokens.
    join "string": anything else (rows fetched before ids were kept) — today's path, the very same objects.
    placeholder: either block is a vLLM placeholder block (_placeholder_block) — its "token_id:N" strings have no
    text to match, so the string path raises. A real text token that merely starts with "token_id:" does not
    (fix round 2: the guard is block-scoped, not per string)."""
    if rid is not None and aid is not None and _ids_ok(rtop, rids) and _ids_ok(atop, aids):
        return (rid, [(i, lp) for i, (_t, lp) in zip(rids, rtop)],
                aid, [(i, lp) for i, (_t, lp) in zip(aids, atop)], "id")
    if placeholder:
        t = next((t for t, _ in (*rtop, *atop) if isinstance(t, str) and t.startswith(ID_PREFIX)), None)
        if t is None:                                   # a mixed block: this row is text, another was placeholders
            raise ValueError("string-joined position in a block that also holds vLLM token-id placeholder rows: "
                             "the block mixes id and text rows (re-fetch it)")
        raise ValueError(f"token {t!r} is a vLLM token-id placeholder on a string-joined position: the other "
                         "side has no token ids (re-fetch it with ids, e.g. the reference with this probe version)")
    return rtok, rtop, atok, atop, "string"


def _placeholder_block(blk):
    """True when the block came back as vLLM placeholders: some top-k row whose every entry is a "token_id:…"
    string (a malformed one included), with at least 2 entries: a one-entry text row could be a real
    "token_id:…" text token, so it is not evidence."""
    for _tok, top in blk.get("pos") or []:
        if len(top or ()) >= 2 and all(isinstance(t, str) and t.startswith(ID_PREFIX) for t, _ in top):
            return True
    return False


def _at(seq, i):
    """seq[i] for a per-position id list stored in a block (None when absent or short)."""
    return seq[i] if isinstance(seq, list) and 0 <= i < len(seq) else None


def join_summary(counts):
    """{"id": n, "string": m} → "id" | "string" | "mixed" (which path scored an arm's number)."""
    return "mixed" if counts["id"] and counts["string"] else ("id" if counts["id"] else "string")


def pair_positions(ref_toks, arm_toks):
    """Pair generated positions while the tokens match; the first-divergent position is
    INCLUDED (its context is still identical on both sides). Returns
    (n_paired_including_divergent, divergent_index_or_None) (r2 §2, Mode Y′)."""
    n = min(len(ref_toks), len(arm_toks))
    for i in range(n):
        if ref_toks[i] != arm_toks[i]:
            return i + 1, i
    return n, None


def cluster_bootstrap_ci(blocks, n_boot=BOOT_B, seed=20261109):
    """Cluster bootstrap CI on the pooled per-position KL. blocks = list of per-prompt
    lists (resampling a prompt takes its whole paired block). Returns (mean, lo, hi)."""
    total = sum(len(b) for b in blocks)
    if total == 0:
        return (0.0, 0.0, 0.0)
    mean = sum(sum(b) for b in blocks) / total
    if len(blocks) == 1:
        return (mean, mean, mean)
    bsums = [sum(b) for b in blocks]
    sizes = [len(b) for b in blocks]
    nb = len(blocks)
    rng = random.Random(seed)
    draws = []
    for _ in range(n_boot):
        s, c = 0.0, 0
        for _i in range(nb):
            j = rng.randrange(nb)
            s += bsums[j]
            c += sizes[j]
        draws.append(s / c)
    draws.sort()
    lo = draws[max(0, int(0.025 * n_boot))]
    hi = draws[min(len(draws) - 1, int(0.975 * n_boot) - 1)]
    return (mean, lo, hi)


def pooled_ci(vals):
    """Pooled 1.96·SD/√n (sly convention; mildly optimistic — r2 §3). Returns (mean, lo, hi)."""
    n = len(vals)
    if n == 0:
        return (0.0, 0.0, 0.0)
    mean = sum(vals) / n
    if n == 1:
        return (mean, mean, mean)
    sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (n - 1))
    half = 1.96 * sd / math.sqrt(n)
    return (mean, mean - half, mean + half)


def segments(vals, k=SEG_K):
    """Per-k-position means of the pooled KL (depth-dependence diagnostic)."""
    out = []
    for start in range(0, len(vals), k):
        chunk = vals[start:start + k]
        out.append({"start": start, "n": len(chunk), "mean": sum(chunk) / len(chunk)})
    return out


# ------------------------------------------------------------------ fetch (one server)
def _post_json(url, path, payload, timeout=1800):
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-noauth"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def detect_engine(url, timeout=10):
    """GET /v1/models → data[0].owned_by ("vllm", "llamacpp", …); None when the card has no owned_by. Only "vllm"
    changes a request (_lp_body). A /v1/models that fails (HTTP error, timeout, unreachable) or does not parse
    RAISES (fix round 1): a silent None would drop vLLM's token ids and quietly fall back to the string join."""
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/v1/models", timeout=timeout) as r:
            d = json.loads(r.read().decode())
        data = d.get("data") if isinstance(d, dict) else None
        if not isinstance(data, list) or not data or not isinstance(data[0], dict):
            raise ValueError(f"no model card in the answer: {str(d)[:120]}")
    except Exception as e:      # noqa: BLE001 — every failure is reported, never mapped to "no engine"
        raise RuntimeError(f"engine detection failed (GET /v1/models: {type(e).__name__}: {e}); "
                           "pass --engine vllm|llamacpp|radiance") from e
    return data[0].get("owned_by") or None


def _lp_body(body, engine):
    """A /v1/completions body; vLLM also gets return_tokens_as_token_ids (top_logprobs keyed "token_id:N", so
    its string dict cannot collapse distinct tokens). llama.cpp and radiance bodies are left as they were."""
    if engine == "vllm":
        body["return_tokens_as_token_ids"] = True
    return body


def _tok_id(tok):
    """vLLM "token_id:N" → N; anything else (a malformed placeholder, leading zeros included) → None."""
    n = tok[len(ID_PREFIX):] if isinstance(tok, str) and tok.startswith(ID_PREFIX) else ""
    if n.isascii() and n.isdigit() and (n == "0" or not n.startswith("0")):
        return int(n)
    return None


def _topk_parse(entries):
    """One top_logprobs row → ((token, lp) × ≤20, ids): ids aligned with the kept entries (an entry's `id`, else
    a "token_id:N" token), or None unless EVERY kept entry has one (the position then joins by string)."""
    if isinstance(entries, dict):
        items = [(t, v, _tok_id(t)) for t, v in entries.items()]
    else:
        items = []
        for e in entries or []:
            if not isinstance(e, dict) or "logprob" not in e or e.get("token") is None:
                continue
            i = e.get("id")
            ok = isinstance(i, int) and not isinstance(i, bool) and i >= 0
            items.append((e["token"], e["logprob"], i if ok else _tok_id(e["token"])))
    top, ids = [], []
    for tok, lp, i in items:
        try:
            lp = float(lp)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(lp):
            continue
        top.append((tok, lp))
        ids.append(i)
        if len(top) >= TOP_K:
            break
    return top, (ids if top and all(i is not None for i in ids) else None)


def _topk_entries(entries):
    """One top_logprobs row → ((token, lp) × ≤20, mass).

    Tolerates the shapes the live 1.11.0/1.17.0 boots are known to return (2026-11-10
    short run: the probe was TDD'd against one assumed shape and every live row parsed
    to 0 entries): canonical list of {token, logprob} dicts, a dict-map row
    (token → logprob), token values as str or int. Rows that parse to nothing leave the
    diagnosis to logprobs_shape() — the caller surfaces it in the error/selftest."""
    top, _ids = _topk_parse(entries)
    return top, _mass(top)


def _use_content(lp):
    """The `content` array carries token ids (llama.cpp sends only it; radiance sends it beside the legacy
    `tokens`/`top_logprobs`, whose dict collapses equal texts), so a non-empty one wins; an empty one does not."""
    c = lp.get("content")
    return isinstance(c, list) and (bool(c) or "tokens" not in lp)


def normalize_logprobs(lp):
    """A choice's `logprobs` object → (tokens, top_logprobs rows), whatever the engine's shape.

    vLLM/radiance answer /v1/completions in the OpenAI completions shape (`tokens` +
    `top_logprobs`); llama.cpp answers in the chat-style shape (`content`: one dict per token
    with its own `top_logprobs` list). Radiance sends both: `content` is preferred (ids, no
    collisions; _use_content). Each returned row is fed to _topk_entries as-is."""
    if not isinstance(lp, dict):
        return [], []
    if _use_content(lp):
        toks, tops = [], []
        for e in lp["content"]:
            if not isinstance(e, dict) or e.get("token") is None:
                continue
            toks.append(e["token"])
            tops.append(e.get("top_logprobs") or [])
        return toks, tops
    return list(lp.get("tokens") or []), list(lp.get("top_logprobs") or [])


def logprobs_shape(lp):
    """One-line description of the shape a live server actually returned (diagnostic).

    The probe is TDD'd against a fixed response shape; a drifted server must be visible
    (selftest JSON + fetch error), not just 'unsupported'. Canonical:
    "tokens=4, top_logprobs=list[4] row=list[20] entry=dict(logprob,rank,token)";
    llama.cpp: "content=list[4], top_logprobs=list[20] entry=dict(bytes,id,logprob)".
    """
    if not isinstance(lp, dict):
        return "logprobs missing"
    if _use_content(lp):
        c = lp["content"]
        if not c or not isinstance(c[0], dict):
            return f"content=list[{len(c)}]"
        r0 = c[0].get("top_logprobs")
        if isinstance(r0, list) and r0 and isinstance(r0[0], dict):
            return (f"content=list[{len(c)}], top_logprobs=list[{len(r0)}] "
                    f"entry=dict({','.join(sorted(r0[0])[:3])})")
        return f"content=list[{len(c)}], top_logprobs={type(r0).__name__}"
    toks, tops = lp.get("tokens"), lp.get("top_logprobs")
    t = f"tokens={len(toks)}" if isinstance(toks, list) else f"tokens={toks!r}"
    if tops is None:
        return f"{t}, top_logprobs=None"
    if not isinstance(tops, list):
        return f"{t}, top_logprobs={type(tops).__name__}"
    if not tops:
        return f"{t}, top_logprobs=list[0]"
    r0 = tops[0]
    if r0 is None:
        return f"{t}, top_logprobs=list[{len(tops)}] rows=None"
    if isinstance(r0, dict):
        return f"{t}, top_logprobs=list[{len(tops)}] row=dict-map[{len(r0)}]"
    if isinstance(r0, list):
        if r0 and isinstance(r0[0], dict):
            return (f"{t}, top_logprobs=list[{len(tops)}] row=list[{len(r0)}] "
                    f"entry=dict({','.join(sorted(r0[0])[:3])})")
        return f"{t}, top_logprobs=list[{len(tops)}] row=list[{len(r0)}]"
    return f"{t}, top_logprobs=list[{len(tops)}] row={type(r0).__name__}"


def _row_measurables(choice, usage, pos, latency_s):
    """Per-prompt measurables added 2026-11-11 (item H) — new keys only, after the existing ones.
    gen_tok_s_e2e = completion_tokens / latency_s: a non-streamed request, so it INCLUDES prefill and
    queueing (a lower bound on the decode rate; not comparable to the probe's decode_tok_s)."""
    usage = usage or {}
    comp = usage.get("completion_tokens")
    lens = [len(top) for _tok, top in pos]
    return {
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": comp,
        "finish_reason": (choice or {}).get("finish_reason"),
        "cached_prompt_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
        "latency_s": round(latency_s, 3),
        "gen_tok_s_e2e": round(comp / latency_s, 2) if (comp and latency_s > 0) else None,
        "topk_len_min": min(lens) if lens else None,
        "topk_len_mean": round(sum(lens) / len(lens), 3) if lens else None,
    }


def fetch(url, model, prompts, max_tokens=N_MAX, timeout=1800, reuse=None, on_block=None,
          kv_samples=None, engine=None, prompt_ids=False):
    """Greedy capture per prompt: POST /v1/completions {prompt, max_tokens, temperature 0,
    logprobs TOP_K}. prompts = list of (id, text). Returns one block per prompt:
    {"id", "toks": [generated token str...], "pos": [ (tok, [(token, lp) ≤20]) ... ],
     "error": str|None, + per-row measurables (_row_measurables)}.
    reuse: {id: OK block} — those prompts are NOT re-requested (item D: a resumed fetch re-asks only
    errored/missing prompts). on_block(blk) is called after each NEW request (incremental persistence).
    kv_samples: list to append a /metrics KV-usage gauge sample to after each new request.
    engine: "vllm" adds return_tokens_as_token_ids (_lp_body). Rows that carry token ids get "top_ids" (one id
    list per pos row, None where a row has none). prompt_ids: also store this server's /tokenize ids of the
    prompt ("prompt_ids", must match usage.prompt_tokens) — a forced reference then sends them to every arm."""
    blocks = []
    for pid, text in prompts:
        if reuse and pid in reuse:
            blocks.append(reuse[pid])
            continue
        blk = {"id": pid, "toks": [], "pos": [], "error": None}
        t0 = time.monotonic()
        try:
            if prompt_ids:
                blk["prompt_ids"] = _tokenize(url, model, text)
            out = _post_json(url, "/v1/completions",
                             _lp_body({"model": model, "prompt": text, "max_tokens": max_tokens,
                                       "temperature": 0, "logprobs": TOP_K}, engine), timeout)
            choice = (out.get("choices") or [{}])[0]
            lp = choice.get("logprobs") or {}
            toks, tops = normalize_logprobs(lp)
            blk["toks"] = list(toks)
            ids = _content_ids(lp)
            if ids is not None and len(ids) == len(toks):
                blk["ids"] = ids   # generated token ids -> this fetch can be a forced reference
            if not toks:
                blk["error"] = f"no generated tokens in response (shape: {logprobs_shape(lp)})"
            tids = []
            for tok, entries in zip(toks, tops):
                top, row_ids = _topk_parse(entries)
                if top:
                    blk["pos"].append((tok, top))
                    tids.append(row_ids)
            if any(t is not None for t in tids):
                blk["top_ids"] = tids
            if len(blk["pos"]) != len(toks):
                blk["error"] = (f"logprobs rows {len(blk['pos'])} != tokens {len(toks)} "
                                f"(shape: {logprobs_shape(lp)})")
            blk.update(_row_measurables(choice, out.get("usage"), blk["pos"], time.monotonic() - t0))
            if prompt_ids and blk.get("prompt_tokens") not in (None, len(blk["prompt_ids"])):
                blk["error"] = (f"/tokenize gave {len(blk['prompt_ids'])} prompt ids, the completion read "
                                f"{blk['prompt_tokens']} prompt tokens")
        except Exception as e:      # noqa: BLE001 — quarantined per prompt (rule 18)
            blk["error"] = f"{type(e).__name__}: {e}"
            blk["latency_s"] = round(time.monotonic() - t0, 3)
        blocks.append(blk)
        if kv_samples is not None:
            m = metrics_snapshot(url)
            if m and m.get("kv_usage") is not None:
                kv_samples.append(m["kv_usage"])
        if on_block:
            on_block(blk)
    return blocks


# ------------------------------------------------------------------ teacher-forced mode (2026-11-12)
# Paired greedy pairs only while two arms agree, so arms that diverge early are scored on a few, different
# positions and their means are not comparable. Forced mode scores every arm at the SAME positions with the
# SAME context: the reference's own greedy continuation (token ids, from a llama.cpp fetch) is fed back as an
# int-list prompt, one request per scored position, max_tokens 1. Radiance and llama.cpp have no
# prompt_logprobs (selftest check 2), hence one request per position. max_tokens 1 never drafts, so spec
# decoding is invisible here by construction — its effect is measured by the greedy pairs (c vs c0, d vs d0).
FORCED_K = 32   # scored positions per prompt (user 2026-11-12: 32 evenly spaced)


def _content_ids(lp):
    """Generated token ids: the `content` entries' ids (llama.cpp, radiance), or vLLM's "token_id:N" tokens;
    None when any is missing."""
    if not isinstance(lp, dict):
        return None
    if _use_content(lp):
        ids = [e.get("id") for e in lp["content"] if isinstance(e, dict) and e.get("token") is not None]
    else:
        ids = [_tok_id(t) for t in lp.get("tokens") or []]
    return ids if ids and all(isinstance(i, int) for i in ids) else None


POSITION_RULE = "skip-partial-utf8-v1"


def partial_utf8_positions(ref_pos):
    """Reference positions whose chosen token or top-1 alternative is a partial UTF-8 byte ('\ufffd').
    2026-11-12 (q8f, calibration v2): llama.cpp answers max_tokens=1 at such a position with NO logprobs
    (it holds the incomplete character back), and every partial byte prints as the same '\ufffd' string,
    so those rows can neither be fetched nor matched. They are left out of the forced positions."""
    bad = set()
    for i, (tok, top) in enumerate(ref_pos):
        if "\ufffd" in (tok or "") or (top and "\ufffd" in (top[0][0] or "")):
            bad.add(i)
    return bad


def forced_positions(n, k=FORCED_K, skip=None):
    """k evenly spaced positions over a reference continuation of n tokens, leaving out `skip`
    (all remaining positions when ≤ k are left)."""
    valid = [i for i in range(n) if not skip or i not in skip]
    if len(valid) <= k:
        return valid
    return sorted({valid[round(j * (len(valid) - 1) / (k - 1))] for j in range(k)})


def _tokenize(url, model, text):
    """Prompt ids from the server's /tokenize (vLLM reads `prompt`, llama.cpp `content`)."""
    errs = []
    for body in ({"model": model, "prompt": text}, {"content": text}):
        try:
            r = _post_json(url, "/tokenize", body)
        except Exception as e:  # noqa: BLE001
            errs.append(f"{type(e).__name__}: {e}")
            continue
        ids = (r.get("ids") or r.get("tokens")) if isinstance(r, dict) else None
        if isinstance(ids, list) and ids and all(isinstance(i, int) for i in ids):
            return ids
        errs.append("no ids/tokens in /tokenize answer")
    raise RuntimeError("tokenize failed: " + "; ".join(errs))


def fetch_forced(url, model, prompts, refs, k=FORCED_K, timeout=1800, reuse=None, on_block=None, engine=None):
    """Teacher-forced capture. prompts = [(id, text)], refs = {id: reference fetch block with "ids"}.
    Per prompt: prompt ids from this server's /tokenize (must equal the reference's prompt_tokens), then
    for each i in forced_positions: POST {prompt: prompt_ids + ref_ids[:i], max_tokens 1, temp 0,
    logprobs TOP_K}; the answer's usage.prompt_tokens must equal the sent length (proves the list was read
    as token ids). Block: {"id", "mode": "forced", "positions", "pos": [(ref token, top)], "error", ...};
    any failure quarantines the WHOLE prompt (rule 18).
    2026-11-13: when the reference stored its own "prompt_ids" (fetch --prompt-ids), THOSE ids are sent and this
    server's /tokenize ids must equal them id for id (not just in length); the arm's ids are kept as
    "prompt_ids" for tokenizer_check. All three engines take an int-list prompt (llama.cpp, vLLM, radiance:
    usage.prompt_tokens check, MEASURED 0 errors in forced-20261112-093746). Rows with ids get "top_ids"."""
    blocks = []
    for pid, text in prompts:
        if reuse and pid in reuse:
            blocks.append(reuse[pid])
            continue
        blk = {"id": pid, "mode": "forced", "positions": [], "pos": [], "error": None}
        t0 = time.monotonic()
        ref = refs.get(pid)
        try:
            if ref is None or ref.get("error"):
                raise RuntimeError("reference prompt missing or errored")
            rids = ref.get("ids")
            if not isinstance(rids, list) or len(rids) != len(ref.get("pos") or []):
                raise RuntimeError("reference has no token ids (fetch it with this probe from llama.cpp or radiance "
                                   "(content[] ids); a vLLM reference is not supported)")
            if any(isinstance(t, str) and t.startswith(ID_PREFIX) for t, _ in ref["pos"]):
                # partial_utf8_positions reads TEXT: a vLLM placeholder reference would skip nothing, so the
                # position set would depend on the reference's engine. Fix round 1: refuse it.
                raise RuntimeError("reference tokens are vLLM token_id placeholders: the partial-UTF-8 skip rule "
                                   "needs text (use a llama.cpp or radiance reference)")
            pids = _tokenize(url, model, text)
            blk["prompt_tokens"] = len(pids)
            blk["prompt_ids"] = pids
            rp = ref.get("prompt_ids")
            if isinstance(rp, list):
                if rp != pids:
                    j = next((j for j, (x, y) in enumerate(zip(rp, pids)) if x != y), min(len(rp), len(pids)))
                    raise RuntimeError(f"tokenizer mismatch: prompt ids differ from the reference's at index {j} "
                                       f"({len(pids)} ids here vs {len(rp)})")
                pids = list(rp)    # the reference's own prompt ids (equal by the check above)
            elif ref.get("prompt_tokens") is not None and ref["prompt_tokens"] != len(pids):
                raise RuntimeError(f"tokenizer mismatch: {len(pids)} prompt ids here vs "
                                   f"{ref['prompt_tokens']} in the reference")
            positions = forced_positions(len(rids), k, skip=partial_utf8_positions(ref["pos"]))
            rows, tids = [], []
            for i in positions:
                sent = pids + rids[:i]
                out = _post_json(url, "/v1/completions",
                                 _lp_body({"model": model, "prompt": sent, "max_tokens": 1,
                                           "temperature": 0, "logprobs": TOP_K}, engine), timeout)
                got = (out.get("usage") or {}).get("prompt_tokens")
                if got is not None and got != len(sent):
                    raise RuntimeError(f"prompt_tokens {got} != {len(sent)} sent ids at position {i} "
                                       "(int-list prompt not read as token ids?)")
                lp = ((out.get("choices") or [{}])[0]).get("logprobs") or {}
                _toks, tops = normalize_logprobs(lp)
                top, row_ids = _topk_parse(tops[0]) if tops else ([], None)
                if not top:
                    raise RuntimeError(f"no logprobs row at position {i} (shape: {logprobs_shape(lp)})")
                rows.append((ref["pos"][i][0], top))
                tids.append(row_ids)
            blk["positions"], blk["pos"] = positions, rows
            blk["forced_ids"] = [rids[i] for i in positions]   # the reference ids forced on (score-time guard)
            if any(t is not None for t in tids):
                blk["top_ids"] = tids
            lens = [len(t) for _, t in rows]
            blk["topk_len_min"] = min(lens) if lens else None
        except Exception as e:      # noqa: BLE001 — quarantined per prompt (rule 18)
            blk["error"] = f"{type(e).__name__}: {e}"
            blk["positions"], blk["pos"] = [], []
        blk["latency_s"] = round(time.monotonic() - t0, 3)
        blocks.append(blk)
        if on_block:
            on_block(blk)
    return blocks


# ------------------------------------------------------------------ /metrics window (item H)
# Counter names as vLLM V1 exposes them (the `_total` suffix is stripped before matching); the
# first alias present wins; values are summed over label sets. Unverified on this stack's 1.11.0
# and absent on radiance (then everything is None) — the first GPU run shows what exists.
METRIC_ALIASES = {
    "spec_drafted": ("vllm:spec_decode_num_draft_tokens",),
    "spec_accepted": ("vllm:spec_decode_num_accepted_tokens",),
    "prefix_hits": ("vllm:prefix_cache_hits", "vllm:gpu_prefix_cache_hits"),
    "prefix_queries": ("vllm:prefix_cache_queries", "vllm:gpu_prefix_cache_queries"),
    "preemptions": ("vllm:num_preemptions",),
    "prompt_tokens": ("vllm:prompt_tokens",),
    "generation_tokens": ("vllm:generation_tokens",),
    "kv_usage": ("vllm:kv_cache_usage_perc", "vllm:gpu_cache_usage_perc"),   # gauge, 0..1
}
WINDOW_COUNTERS = ("spec_drafted", "spec_accepted", "prefix_hits", "prefix_queries", "preemptions",
                   "prompt_tokens", "generation_tokens")


def parse_metrics(text):
    """Prometheus text → {key: summed value | None} for METRIC_ALIASES (tolerant: unknown lines skipped)."""
    sums = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.rsplit(None, 1)
        if len(parts) != 2:
            continue
        name = parts[0].split("{", 1)[0]
        if name.endswith("_created"):
            continue
        if name.endswith("_total"):
            name = name[: -len("_total")]
        try:
            v = float(parts[1])
        except ValueError:
            continue
        sums[name] = sums.get(name, 0.0) + v
    out = {}
    for key, aliases in METRIC_ALIASES.items():
        out[key] = next((sums[a] for a in aliases if a in sums), None)
    return out


def metrics_snapshot(url, timeout=10):
    """GET <base>/metrics → parse_metrics dict, or None when /metrics is absent/unreachable."""
    base = url[:-3] if url.rstrip("/").endswith("/v1") else url
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/metrics", timeout=timeout) as r:
            return parse_metrics(r.read().decode("utf-8", "replace"))
    except Exception:           # noqa: BLE001 — absent /metrics is a valid outcome (null fields)
        return None


def window_summary(before, after, kv_samples):
    """Counter deltas over one fetch window + spec-decode acceptance + max sampled KV usage."""
    ok = before is not None and after is not None
    w = {"metrics_available": ok}
    for k in WINDOW_COUNTERS:
        w[k] = (after[k] - before[k]) if (ok and after.get(k) is not None and before.get(k) is not None) else None
    w["spec_acceptance_rate"] = (round(w["spec_accepted"] / w["spec_drafted"], 5)
                                 if (w["spec_drafted"] and w["spec_accepted"] is not None) else None)
    w["prefix_hit_rate"] = (round(w["prefix_hits"] / w["prefix_queries"], 5)
                            if (w["prefix_queries"] and w["prefix_hits"] is not None) else None)
    samples = [x for x in (kv_samples or []) if x is not None]
    if ok and after.get("kv_usage") is not None:
        samples.append(after["kv_usage"])
    w["kv_usage_max"] = max(samples) if samples else None
    return w


# ------------------------------------------------------------------ cache key (item C) + resume (item D)
KEY_SUFFIX = ".key.json"
KEY_FIELDS = ("n", "calibration_sha256", "max_tokens", "top_k", "model", "image")


def calibration_ids(path):
    return [json.loads(l)["id"] for l in open(path, encoding="utf-8") if l.strip()]


FORCED_KEY_FIELDS = ("mode", "ref_sha256", "positions", "position_rule")


def cache_key(calibration, limit, max_tokens, model, image, forced_ref=None, positions=None):
    """The identity of a fetch: requested prompt count (after --limit), calibration file sha256,
    max_tokens, TOP_K, served model, image. Stored in <out>.key.json; a cache is reused only on an
    exact match (2026-11-11: a KLD_N=2 file must never be reused by an N=16/128 run).
    forced_ref (teacher-forced fetch): adds mode "forced", the reference file's sha256 and the positions
    per prompt, and the position rule; a greedy key has no `mode` field (its bytes are unchanged) and reads as "greedy"."""
    ids = calibration_ids(calibration)
    n = len(ids) if limit is None else min(int(limit), len(ids))
    key = {"n": n, "calibration_sha256": hashlib.sha256(open(calibration, "rb").read()).hexdigest(),
           "max_tokens": int(max_tokens), "top_k": TOP_K, "model": model, "image": image}
    if forced_ref is not None:
        key.update({"mode": "forced", "ref_sha256": hashlib.sha256(open(forced_ref, "rb").read()).hexdigest(),
                    "positions": int(positions if positions is not None else FORCED_K),
                    "position_rule": POSITION_RULE})
    return key


def _key_diff(stored, exp):
    """Key fields that differ (model/image only when expected; mode defaults to greedy on both sides)."""
    fields = [f for f in KEY_FIELDS if not (f in ("model", "image") and exp[f] is None)]
    diff = [f for f in fields if stored.get(f) != exp[f]]
    if stored.get("mode", "greedy") != exp.get("mode", "greedy"):
        diff.append("mode")
    elif exp.get("mode") == "forced":
        diff += [f for f in FORCED_KEY_FIELDS[1:] if stored.get(f) != exp.get(f)]
    return diff


def key_path(out):
    return out + KEY_SUFFIX


def read_key(out):
    try:
        return json.load(open(key_path(out), encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _read_rows_tolerant(path):
    """Rows of a (possibly cut) JSONL file; a torn/unparsable line is skipped (resume input only)."""
    rows = []
    try:
        fh = open(path, encoding="utf-8")
    except OSError:
        return rows
    with fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    return rows


def missing_prompt_ids(rows):
    """Clean rows without "prompt_ids": fetched before this probe kept ids."""
    return [r.get("id") for r in rows if not r.get("error") and not isinstance(r.get("prompt_ids"), list)]


def ref_has_prompt_ids(path):
    """True when a forced reference file carries prompt ids (its arms must then carry them too)."""
    return any(isinstance(r.get("prompt_ids"), list) for r in _read_rows_tolerant(path))


# prompt_ids is the marker of a row fetched by an id-keeping probe (fix round 2: the check is prompt_ids ONLY —
# top_ids legitimately stays absent for an engine that returns no ids, so it cannot mark an old row)
IDS_REFUSAL = ("{n} cached row(s) lack prompt_ids (fetched before this probe kept ids, e.g. {ids}); "
               "this file is left untouched — fetch to a new --out path")


def cache_status(out, calibration, limit, max_tokens, model=None, image=None, forced_ref=None, positions=None,
                 prompt_ids=False):
    """(code, reason): 0 complete + key match · 1 incomplete (errored/missing/duplicate/torn rows) ·
    2 key missing or mismatched, or ids required but missing · 3 file absent. model/image are compared only
    when given. Ids are required with prompt_ids (fetch --prompt-ids) or a forced_ref that carries prompt_ids."""
    if not os.path.exists(out):
        return 3, "absent"
    exp = cache_key(calibration, limit, max_tokens, model, image, forced_ref, positions)
    stored = read_key(out)
    if stored is None:
        return 2, f"no key file ({os.path.basename(key_path(out))}) — legacy or foreign cache"
    diff = _key_diff(stored, exp)
    if diff:
        return 2, "key mismatch: " + ", ".join(f"{f} {stored.get(f)!r} != {exp.get(f)!r}" for f in diff)
    try:
        rows = [json.loads(l) for l in open(out, encoding="utf-8") if l.strip()]
    except ValueError:
        return 1, "unparsable row (cut file)"
    want = calibration_ids(calibration)[: exp["n"]]
    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)):
        return 1, "duplicate prompt ids"
    if set(ids) != set(want):
        return 1, f"rows for {len(set(ids) & set(want))}/{len(want)} prompts"
    errs = [r.get("id") for r in rows if r.get("error")]
    if errs:
        return 1, f"{len(errs)} errored rows: {errs[:5]}"
    miss = missing_prompt_ids(rows) if (prompt_ids or (forced_ref and ref_has_prompt_ids(forced_ref))) else []
    if miss:
        return 2, IDS_REFUSAL.format(n=len(miss), ids=miss[:3])
    return 0, "complete"


# ------------------------------------------------------------------ live selftest (r2 §2)
def selftest(url, model, engine=None):
    """First-boot gate per engine family (5 checks, r2 §2). Returns (ok, checks-dict).
    ok = check 1 (logprobs supported) — a refusal takes the arm OUT of the KLD pass,
    recorded with the reason (r2 §2.1). Check 3's tokenize ids are recorded for the eye only;
    the enforced tokenizer guard is score()'s per-prompt prompt_tokens comparison."""
    checks = {"url": url, "model": model, "engine": engine}   # provenance: endpoint, served model (rule 2)
    # 1. completions logprobs:20 — own logprob + ≤20 alternatives per token. The gate is
    #    "the rows PARSE to 1..20 entries" (shape-tolerant — see _topk_entries), and the
    #    observed shape is ALWAYS recorded (logprobs_shape) so a drifted server is
    #    diagnosable from the selftest JSON, not just "unsupported".
    try:
        r1 = _post_json(url, "/v1/completions",
                        _lp_body({"model": model, "prompt": PROBE_TEXT, "max_tokens": 4,
                                  "temperature": 0, "logprobs": TOP_K}, engine))
        lp = (r1.get("choices") or [{}])[0].get("logprobs") or {}
        toks, tops = normalize_logprobs(lp)
        checks["logprobs20"] = bool(
            toks and tops
            and all(1 <= len(_topk_entries(r)[0]) <= TOP_K for r in tops[:4]))
        checks["logprobs_shape"] = logprobs_shape(lp)
        checks["topk_ids"] = bool(tops) and all(_topk_parse(r)[1] is not None for r in tops[:4])
    except Exception as e:      # noqa: BLE001
        checks["logprobs20"] = False
        checks["topk_ids"] = False
        checks["logprobs20_error"] = f"{type(e).__name__}: {e}"
        checks["logprobs_shape"] = f"request failed ({type(e).__name__})"
    # 2. prompt_logprobs availability (INFORMATIONAL — the bonus pass, not the headline)
    try:
        r2 = _post_json(url, "/v1/completions",
                        _lp_body({"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                                  "temperature": 0, "prompt_logprobs": 1}, engine))
        checks["prompt_logprobs"] = bool((r2.get("choices") or [{}])[0].get("prompt_logprobs"))
    except Exception:           # noqa: BLE001 — refused (radiance) or unsupported
        checks["prompt_logprobs"] = False
    # 3. tokenize ids (recorded; vLLM/llama.cpp answer `tokens`, some builds `ids`; llama.cpp
    #    reads the text from `content`, vLLM from `prompt` — try both bodies, record the first answer)
    checks["tokenize_ids"] = None
    errs = []
    for body in ({"model": model, "prompt": PROBE_TEXT}, {"content": PROBE_TEXT}):
        try:
            r3 = _post_json(url, "/tokenize", body)
        except Exception as e:  # noqa: BLE001
            errs.append(f"{type(e).__name__}: {e}")
            continue
        ids = r3.get("ids") if isinstance(r3, dict) else None
        if ids is None and isinstance(r3, dict):
            ids = r3.get("tokens")
        if isinstance(ids, list) and ids:
            checks["tokenize_ids"] = ids
            break
        errs.append(f"no ids/tokens in /tokenize answer (keys: {sorted(r3) if isinstance(r3, dict) else type(r3).__name__})")
    if checks["tokenize_ids"] is None:
        checks["tokenize_error"] = "; ".join(errs)
    # 4. raw-distribution semantics: identical logprobs at temp 0 vs temp 1 (max_tokens 1)
    try:
        ra = _post_json(url, "/v1/completions",
                        _lp_body({"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                                  "temperature": 0, "logprobs": TOP_K}, engine))
        rb = _post_json(url, "/v1/completions",
                        _lp_body({"model": model, "prompt": PROBE_TEXT, "max_tokens": 1,
                                  "temperature": 1.0, "logprobs": TOP_K}, engine))
        la = (ra.get("choices") or [{}])[0].get("logprobs") or {}
        lb = (rb.get("choices") or [{}])[0].get("logprobs") or {}
        checks["raw_logprobs"] = normalize_logprobs(la)[1] == normalize_logprobs(lb)[1]
    except Exception as e:      # noqa: BLE001
        checks["raw_logprobs"] = False
        checks["raw_logprobs_error"] = f"{type(e).__name__}: {e}"
    ok = bool(checks.get("logprobs20"))
    return ok, checks


# ------------------------------------------------------------------ score
def score(ref_blocks, arm_blocks, label, reference_note):
    """Paired greedy scoring: ref_blocks/arm_blocks = fetch() block lists, same order
    (same prompts). Per prompt: pair positions (token match, first-divergent included),
    KL at paired positions (r2 §3), dNLL of the generated token, top-1 over ALL generated
    positions. Returns the report dict (lower-bound KL + CIs + noise-floor extras)."""
    if len(ref_blocks) != len(arm_blocks):
        raise ValueError(f"prompt count mismatch (ref {len(ref_blocks)} vs arm {len(arm_blocks)})")
    order = [(rb.get("id"), ab.get("id")) for rb, ab in zip(ref_blocks, arm_blocks)
             if rb.get("id") != ab.get("id")]
    if order:
        raise ValueError(f"prompt id order mismatch (ref, arm): {order[:3]}")
    tok_check = tokenizer_check(ref_blocks, arm_blocks)
    kl_blocks, dnll_terms, top1_num, top1_den = [], [], 0, 0
    div_idx, n_paired, n_dropped, cov_ref, cov_arm, n_err = [], 0, 0, [], [], 0
    pooled_kls = []
    # item F (2026-11-11) diagnostics over PAIRED positions — counted only, the KL math is untouched
    ref_lens, arm_lens, p1_num = [], [], 0
    fl_ref_missing, fl_ref_entries, fl_pos, fl_mass, fl_arm_missing, fl_arm_entries = 0, 0, 0, [], 0, 0
    joins = {"id": 0, "string": 0}

    def _keyed(i):   # one position, joined by id when both sides carry ids (join_keys)
        (rtok, rtop), (atok, atop) = rb["pos"][i], ab["pos"][i]
        return join_keys(rtok, rtop, _at(rb.get("ids"), i), _at(rb.get("top_ids"), i),
                         atok, atop, _at(ab.get("ids"), i), _at(ab.get("top_ids"), i), ph)
    for rb, ab in zip(ref_blocks, arm_blocks):
        if rb.get("error") or ab.get("error"):
            n_err += 1
            continue
        ph = _placeholder_block(rb) or _placeholder_block(ab)
        # pair on generated ids only when both blocks carry top ids too (files fetched before 2026-11-13 have
        # llama.cpp `ids` but no `top_ids`: they keep pairing on strings, bit-identical)
        by_id = all(isinstance(b.get("top_ids"), list) and isinstance(b.get("ids"), list)
                    and len(b["ids"]) == len(b["pos"]) for b in (rb, ab))
        ref_toks = rb["ids"] if by_id else [t for t, _ in rb["pos"]]
        arm_toks = ab["ids"] if by_id else [t for t, _ in ab["pos"]]
        n_paired_pos, div = pair_positions(ref_toks, arm_toks)
        if div is not None:
            div_idx.append(div)
        n_paired += n_paired_pos
        n_dropped += max(0, min(len(ref_toks), len(arm_toks)) - n_paired_pos)
        block_kls = []
        for i in range(n_paired_pos):
            rtok, rtop, atok, atop, join = _keyed(i)
            joins[join] += 1
            kl, rm, am = kl_position(rtop, atop)
            ref_lens.append(len(rtop))
            arm_lens.append(len(atop))
            amap_keys = {t for t, _ in atop}
            rmap_keys = {t for t, _ in rtop}
            miss = [(t, r) for t, r in rtop if t not in amap_keys]
            fl_ref_missing += len(miss)
            fl_ref_entries += len(rtop)
            if miss:
                fl_pos += 1
            fl_mass.append(sum(math.exp(r) for _, r in miss))
            fl_arm_missing += sum(1 for t, _ in atop if t not in rmap_keys)
            fl_arm_entries += len(atop)
            # top-1: the id path compares the logsumexp-merged tops the KL uses (duplicate ids cannot split an
            # argmax); the string path keeps the raw rows, so existing string-only data scores exactly as before
            r1, a1 = (canon_top(rtop), canon_top(atop)) if join == "id" else (rtop, atop)
            if max(r1, key=lambda kv: kv[1])[0] == max(a1, key=lambda kv: kv[1])[0]:
                p1_num += 1
            block_kls.append(kl)
            cov_ref.append(rm)
            cov_arm.append(am)
            pooled_kls.append(kl)
            # dNLL: the generated token's logprob on each side (floor if absent, lower bound)
            # (id path: the merged tops, like the KL — fix round 2; string path: the raw rows, as before)
            rmap = dict(r1)
            amap = dict(a1)
            rfloor = min(lp for _, lp in r1)
            afloor = min(lp for _, lp in a1)
            dnll_terms.append(rmap.get(rtok, rfloor) - amap.get(atok, afloor))
        if block_kls:
            kl_blocks.append(block_kls)
        # top-1 over all generated positions (argmax of each side's top-20)
        for i in range(min(len(ref_toks), len(arm_toks))):
            _rt, rtop_i, _a, atop_i, j_i = _keyed(i)
            if j_i == "id":
                rtop_i, atop_i = canon_top(rtop_i), canon_top(atop_i)
            rtop_i, atop_i = dict(rtop_i), dict(atop_i)
            rmax = max(rtop_i.items(), key=lambda kv: kv[1])[0]
            amax = max(atop_i.items(), key=lambda kv: kv[1])[0]
            top1_den += 1
            if rmax == amax:
                top1_num += 1
    n = len(pooled_kls)
    if n == 0:
        raise ValueError("no paired positions (all prompts failed or empty)")
    mean, lo, hi = cluster_bootstrap_ci(kl_blocks)
    pmean, plo, phi = pooled_ci(pooled_kls)
    div_sorted = sorted(div_idx)
    kl_sorted = sorted(pooled_kls)

    def _lens(lens):
        short = sum(1 for x in lens if x < TOP_K)
        return {"n_positions": len(lens), "n_short": short,
                "frac_short": round(short / len(lens), 5) if lens else None,
                "min_len": min(lens) if lens else None, "top_k": TOP_K}
    extras = {
        "top1_agreement_paired": round(p1_num / n, 5),
        "kl_per_position": {
            "median": round(kl_sorted[n // 2] if n % 2 else (kl_sorted[n // 2 - 1] + kl_sorted[n // 2]) / 2, 6),
            "p90": round(kl_sorted[max(0, math.ceil(0.9 * n) - 1)], 6),
            "max": round(kl_sorted[-1], 6),
            "note": "over paired positions; p90 = nearest rank"},
        "topk_len": {"ref": _lens(ref_lens), "arm": _lens(arm_lens),
                     "note": "paired positions whose top-k row had fewer than TOP_K entries"},
        "floor_substitutions": {
            "ref_tokens_missing_from_arm": fl_ref_missing, "ref_entries": fl_ref_entries,
            "ref_missing_frac": round(fl_ref_missing / fl_ref_entries, 6) if fl_ref_entries else None,
            "positions_with_floor": fl_pos,
            "ref_mass_floored_mean": round(sum(fl_mass) / len(fl_mass), 6) if fl_mass else None,
            "arm_tokens_missing_from_ref": fl_arm_missing, "arm_entries": fl_arm_entries,
            "arm_missing_frac": round(fl_arm_missing / fl_arm_entries, 6) if fl_arm_entries else None,
            "note": "ref tokens absent from the arm top-k are scored at the arm floor (lower-bound KL); "
                    "arm tokens absent from the ref top-k do not enter KL(ref||arm)"},
    }
    return {
        "kind": "kld", "label": label,
        "reference": reference_note,
        "mode": "paired greedy continuation (temp 0, top-20, shared-prefix pairing, "
                "first-divergent position included)",
        "n_prompts": len(ref_blocks), "n_prompt_errors": n_err,
        "n_positions": n, "n_positions_dropped": n_dropped,
        "kl_nats_per_tok": round(mean, 6),
        "ci95_nats": [round(lo, 6), round(hi, 6)],
        "ci_method": "cluster bootstrap (block=prompt, B=2000, percentile 95%)",
        "pooled_ci_nats": [round(plo, 6), round(phi, 6)],
        "pooled_note": "pooled 1.96·SD/√n (sly convention) — cross-check, mildly optimistic (×~1.46)",
        "lower_bound_note": "KL is a lower bound: reference top-20 support, floor for tokens "
                            "missing from arm top-20, lumped tail bucket, clamped ≥ 0 "
                            "(sly kv4/kl_compare.py, ε=1e-9)",
        "dnll_nats_per_tok": round(sum(dnll_terms) / len(dnll_terms), 6) if dnll_terms else None,
        "top1_agreement": round(top1_num / top1_den, 5) if top1_den else None,
        "first_divergent_pos": {
            "mean": round(sum(div_sorted) / len(div_sorted), 1) if div_sorted else None,
            "median": div_sorted[len(div_sorted) // 2] if div_sorted else None,
            "n_diverged": len(div_sorted), "n_prompts": len(ref_blocks) - n_err,
        },
        "coverage_ref_mean": round(sum(cov_ref) / len(cov_ref), 5) if cov_ref else None,
        "coverage_arm_mean": round(sum(cov_arm) / len(cov_arm), 5) if cov_arm else None,
        "segments_per_1k": [{"start": s["start"], "n": s["n"],
                             "nats_per_tok": round(s["mean"], 6)} for s in segments(pooled_kls)],
        "noise_floors": ["A-vs-B pair = engine-version floor (same checkpoint, radiance 1.11.0 "
                         "vs 1.17.0)", "reference self-run bounds boot noise"],
        "tokenizer_check": tok_check,
        **extras,
        "join": join_summary(joins), "join_counts": joins,
    }


def score_forced(ref_blocks, arm_blocks, label, ref_label):
    """Teacher-forced scoring: arm_blocks = fetch_forced() output against ref_blocks (the reference's
    greedy fetch). At every scored position both sides saw the SAME context (prompt + the reference's
    first i tokens), so every arm is scored at the same positions and the means are comparable across
    arms. KL(ref‖arm) per kl_position (lower bound), top-1 agreement, dNLL of the reference token,
    cluster bootstrap by prompt. An errored arm prompt is excluded and counted (rule 18).
    Each position joins by token id when the reference and the arm row both carry ids (join_keys; the
    chosen token is the reference's on both sides), else by canonical string; "join" says which.
    Fix round 1: an arm row forced on a token other than the reference's at that position (a re-fetched
    reference) quarantines the prompt (_ref_mismatch): counted in n_prompt_errors, listed, never scored.
    Known limit: only SCORED positions are checked; a reference change at an unscored position is not seen
    here (the forced cache's ref_sha256 guards it at fetch time)."""
    if len(ref_blocks) < len(arm_blocks):
        raise ValueError(f"arm has {len(arm_blocks)} prompts, reference only {len(ref_blocks)}")
    order = [(rb.get("id"), ab.get("id")) for rb, ab in zip(ref_blocks, arm_blocks)
             if rb.get("id") != ab.get("id")]
    if order:
        raise ValueError(f"prompt id order mismatch (ref, arm): {order[:3]}")
    kl_blocks, pooled, dnll, n_err, top1 = [], [], [], 0, 0
    arm_lens, ref_missing, ref_entries = [], 0, 0
    joins, ref_mism = {"id": 0, "string": 0}, []
    for rb, ab in zip(ref_blocks, arm_blocks):
        if rb.get("error") or ab.get("error"):
            n_err += 1
            continue
        bad = _ref_mismatch(rb, ab)
        if bad:
            n_err += 1
            ref_mism.append(bad)
            continue
        block, ph = [], _placeholder_block(rb) or _placeholder_block(ab)
        for j, (i, (_forced_on, atop)) in enumerate(zip(ab["positions"], ab["pos"])):
            if not 0 <= i < len(rb["pos"]):
                raise ValueError(f"{ab['id']}: position {i} outside the reference ({len(rb['pos'])} tokens)")
            rtok, rtop = rb["pos"][i]
            rtok, rtop, _t, atop, join = _forced_keyed(rb, i, rtop, atop, _at(ab.get("top_ids"), j), ph)
            joins[join] += 1
            kl, _rm, _am = kl_position(rtop, atop)
            block.append(kl)
            pooled.append(kl)
            arm_lens.append(len(atop))
            rtok, rtop, atop = canon_tok(rtok), canon_top(rtop), canon_top(atop)
            if rtop[0][0] == atop[0][0]:
                top1 += 1
            amap = dict(atop)
            dnll.append(dict(rtop).get(rtok, rtop[-1][1]) - amap.get(rtok, atop[-1][1]))
            keys = set(amap)
            ref_missing += sum(1 for t, _ in rtop if t not in keys)
            ref_entries += len(rtop)
        if block:
            kl_blocks.append(block)
    n = len(pooled)
    if n == 0:
        raise ValueError("no scored positions (all prompts failed or empty)")
    mean, lo, hi = cluster_bootstrap_ci(kl_blocks)
    s = sorted(pooled)
    short = sum(1 for x in arm_lens if x < TOP_K)
    return {
        "kind": "kld_forced", "label": label, "reference_label": ref_label,
        "mode": f"teacher-forced on the reference's greedy continuation (temp 0, top-{TOP_K}, "
                f"≤{FORCED_K} evenly spaced positions per prompt, max_tokens 1)",
        "n_prompts": len(arm_blocks), "n_prompt_errors": n_err, "n_positions": n,
        "kl_nats_per_tok": round(mean, 6),
        "ci95_nats": [round(lo, 6), round(hi, 6)],
        "ci_method": "cluster bootstrap (block=prompt, B=2000, percentile 95%)",
        "kl_per_position": {"median": round(s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2, 6),
                            "p90": round(s[max(0, math.ceil(0.9 * n) - 1)], 6), "max": round(s[-1], 6)},
        "top1_agreement": round(top1 / n, 5),
        "dnll_nats_per_tok": round(sum(dnll) / len(dnll), 6),
        "arm_topk_short": {"n_short": short, "frac_short": round(short / n, 5), "top_k": TOP_K},
        "ref_missing_frac": round(ref_missing / ref_entries, 6) if ref_entries else None,
        "lower_bound_note": "KL is a lower bound: reference top-20 support, floor for tokens missing "
                            "from the arm top-20, lumped tail bucket, clamped ≥ 0 (sly kv4/kl_compare.py)",
        "tokenizer_check": tokenizer_check(ref_blocks, arm_blocks),
        "join": join_summary(joins), "join_counts": joins,
        "n_ref_token_mismatch": len(ref_mism), "ref_token_mismatches": ref_mism[:10],
    }


def _ref_mismatch(rb, ab):
    """First scored position where the arm row was forced on another token than the reference's (its recorded
    token string; and its forced id vs the reference id, where both exist) → {"id", "position", "arm", "ref"},
    else None. Out-of-range positions are left to the caller's ValueError. Unscored positions are not checked."""
    for j, (i, (t, _top)) in enumerate(zip(ab["positions"], ab["pos"])):
        if not 0 <= i < len(rb["pos"]):
            continue
        rt = rb["pos"][i][0]
        fid, rid = _at(ab.get("forced_ids"), j), _at(rb.get("ids"), i)
        if t != rt:
            return {"id": ab.get("id"), "position": i, "arm": t, "ref": rt}
        if fid is not None and rid is not None and fid != rid:
            return {"id": ab.get("id"), "position": i, "arm": fid, "ref": rid}
    return None


def _forced_keyed(rb, i, rtop, atop, aids, placeholder=False):
    """join_keys for a forced position: the scored token is the reference's own (id rb["ids"][i]) on both sides."""
    rtok, rid = rb["pos"][i][0], _at(rb.get("ids"), i)
    return join_keys(rtok, rtop, rid, _at(rb.get("top_ids"), i), rtok, atop, rid, aids, placeholder)


def score_forced_diff(ref_blocks, a_blocks, b_blocks, label_a, label_b, ref_label):
    """Paired difference KL(ref‖a) − KL(ref‖b) of two teacher-forced arms, position by position (both arms saw the
    SAME contexts), cluster bootstrap by prompt. Cancels the "this prompt is hard for everyone" variance that two
    separate CIs carry, so it resolves close pairs that overlapping per-arm CIs cannot. A prompt errored in either
    arm (or the reference) is excluded and counted (rule 18), and so is a prompt either arm was forced on other
    tokens (_ref_mismatch). Fix round 1: both arms must be scored by the same join ("id" or "string", never
    "mixed") — an id-joined KL minus a string-joined KL is not a difference of the arms, so it is refused."""
    if not (len(ref_blocks) >= len(a_blocks) == len(b_blocks)):
        raise ValueError(f"prompt counts: ref {len(ref_blocks)}, a {len(a_blocks)}, b {len(b_blocks)}")
    blocks, ka, kb, n_err, a_lower, used = [], [], [], 0, 0, 0
    joins, ref_mism = {"a": {"id": 0, "string": 0}, "b": {"id": 0, "string": 0}}, []
    for rb, ab, bb in zip(ref_blocks, a_blocks, b_blocks):
        if not (rb.get("id") == ab.get("id") == bb.get("id")):
            raise ValueError(f"prompt id order mismatch: {rb.get('id')} / {ab.get('id')} / {bb.get('id')}")
        if rb.get("error") or ab.get("error") or bb.get("error"):
            n_err += 1
            continue
        bad = [{"arm_label": lab, **m} for lab, m in ((label_a, _ref_mismatch(rb, ab)),
                                                       (label_b, _ref_mismatch(rb, bb))) if m]
        if bad:
            n_err += 1
            ref_mism += [{"id": m["id"], "arm_label": m["arm_label"], "position": m["position"], "arm": m["arm"],
                          "ref": m["ref"]} for m in bad]
            continue
        if list(ab["positions"]) != list(bb["positions"]):
            raise ValueError(f"{ab['id']}: the two arms were forced at different positions")
        d, sa, sb = [], 0.0, 0.0
        ph_r = _placeholder_block(rb)
        ph_a, ph_b = ph_r or _placeholder_block(ab), ph_r or _placeholder_block(bb)
        for j, (i, (_ta, atop), (_tb, btop)) in enumerate(zip(ab["positions"], ab["pos"], bb["pos"])):
            if not 0 <= i < len(rb["pos"]):
                raise ValueError(f"{ab['id']}: position {i} outside the reference ({len(rb['pos'])} tokens)")
            rtop = rb["pos"][i][1]
            _r, rta, _t, atop, ja = _forced_keyed(rb, i, rtop, atop, _at(ab.get("top_ids"), j), ph_a)
            _r, rtb, _t, btop, jb = _forced_keyed(rb, i, rtop, btop, _at(bb.get("top_ids"), j), ph_b)
            joins["a"][ja] += 1
            joins["b"][jb] += 1
            x, y = kl_position(rta, atop)[0], kl_position(rtb, btop)[0]
            d.append(x - y); ka.append(x); kb.append(y); sa += x; sb += y
        if d:
            blocks.append(d); used += 1
            a_lower += sa < sb
    if not blocks:
        raise ValueError("no scored positions (all prompts failed or empty)")
    ja, jb = join_summary(joins["a"]), join_summary(joins["b"])
    if ja != jb or ja == "mixed":
        raise ValueError(f"join mismatch, not comparable: {label_a} scored by {ja} {joins['a']}, {label_b} by "
                         f"{jb} {joins['b']} (re-fetch the string-joined arm against a reference with top_ids)")
    mean, lo, hi = cluster_bootstrap_ci(blocks)
    verdict = f"{label_a} lower" if hi < 0 else f"{label_b} lower" if lo > 0 else "not resolved"
    return {
        "kind": "kld_forced_diff", "label_a": label_a, "label_b": label_b, "reference_label": ref_label,
        "n_prompts_used": used, "n_prompt_errors": n_err, "n_positions": len(ka),
        "kl_a": round(sum(ka) / len(ka), 6), "kl_b": round(sum(kb) / len(kb), 6),
        "diff_nats_per_tok": round(mean, 6), "ci95_nats": [round(lo, 6), round(hi, 6)],
        "ci_method": "cluster bootstrap of the per-position difference (block=prompt, B=2000, percentile 95%)",
        "verdict": verdict, "frac_prompts_a_lower": round(a_lower / used, 5),
        "join_a": ja, "join_b": jb,
        "n_ref_token_mismatch": len(ref_mism), "ref_token_mismatches": ref_mism[:10],
    }


def tokenizer_check(ref_blocks, arm_blocks):
    """Tokenizer drift guard: the same prompt text must tokenize to the same length on both sides
    (usage.prompt_tokens per prompt). A drift breaks the string-keyed top-k support silently, so
    it is reported beside the KL, never folded into it. verdict: ok | MISMATCH | unavailable.
    2026-11-13: where both rows carry "prompt_ids" (/tokenize ids), they must be equal id for id
    (a same-length, different-id tokenization would pass the length check); "ids_equal" marks it."""
    mism, n, n_ids, n_ids_mism = [], 0, 0, 0
    for rb, ab in zip(ref_blocks, arm_blocks):
        r, a = rb.get("prompt_tokens"), ab.get("prompt_tokens")
        ri, ai = rb.get("prompt_ids"), ab.get("prompt_ids")
        ids_eq = (ri == ai) if isinstance(ri, list) and isinstance(ai, list) else None
        if ids_eq is not None:
            n_ids += 1
            n_ids_mism += not ids_eq
        if r is None or a is None:
            if ids_eq is False:
                mism.append({"id": rb.get("id"), "ref": r, "arm": a, "ids_equal": False})
            continue
        n += 1
        if r != a or ids_eq is False:
            m = {"id": rb.get("id"), "ref": r, "arm": a}
            if ids_eq is not None:
                m["ids_equal"] = ids_eq
            mism.append(m)
    return {"n_compared": n, "n_mismatch": len(mism), "mismatches": mism[:10],
            "verdict": "unavailable" if n == 0 and n_ids == 0 else ("MISMATCH" if mism else "ok"),
            "note": "per-prompt usage.prompt_tokens, ref vs arm (rows without it are skipped); prompt ids "
                    "compared id for id where both rows carry them",
            "n_ids_compared": n_ids, "n_ids_mismatch": n_ids_mism,
            # fix round 1: `verdict` stays the length check (unchanged for existing data); the id check is reported
            # separately and never reads "ok" when no ids were compared
            "ids_verdict": ("MISMATCH" if n_ids_mism else "ok") if n_ids else (
                "not checked (arm has no prompt_ids)" if any(isinstance(b.get("prompt_ids"), list) for b in ref_blocks)
                else "not checked (reference has no prompt_ids)")}


def load_pair_results(d):
    """All kld-pair-<arm>-vs-<ref>.json score reports in directory d."""
    out = []
    for name in sorted(os.listdir(d)):
        if name.startswith("kld-pair-") and name.endswith(".json") and not name.endswith(KEY_SUFFIX):
            try:
                out.append(json.load(open(os.path.join(d, name), encoding="utf-8")))
            except (OSError, ValueError):
                continue
    return out


def matrix_markdown(rows):
    """Pairwise KL table: one row per arm, one column per reference (KL(ref‖arm) nats/tok [CI95],
    top-1 agreement), then the tokenizer verdict of every pair. Diagonal = —, missing pair = n/a."""
    labels = sorted({r["label"] for r in rows} | {r.get("reference_label") or r["reference"] for r in rows})
    cell = {(r["label"], r.get("reference_label") or r["reference"]): r for r in rows}
    lines = ["| arm \\ ref | " + " | ".join(labels) + " |",
             "|---|" + "---|" * len(labels)]
    for arm in labels:
        cells = []
        for ref in labels:
            r = cell.get((arm, ref))
            if arm == ref:
                cells.append("—")
            elif r is None:
                cells.append("n/a")
            else:
                cells.append(f"{r['kl_nats_per_tok']:.4f} [{r['ci95_nats'][0]:.4f}, {r['ci95_nats'][1]:.4f}]"
                             f" · top1 {r['top1_agreement']}")
        lines.append(f"| {arm} | " + " | ".join(cells) + " |")
    lines += ["", "KL(ref‖arm) nats/tok, lower bound, cluster-bootstrap CI95; top1 = argmax agreement over "
              "generated positions.", "", "| arm | ref | tokenizer | n_prompts | errors | positions |",
              "|---|---|---|---|---|---|"]
    for (arm, ref), r in sorted(cell.items()):
        t = r.get("tokenizer_check") or {}
        lines.append(f"| {arm} | {ref} | {t.get('verdict', 'n/a')} ({t.get('n_mismatch', '?')}/"
                     f"{t.get('n_compared', '?')} mismatched) | {r['n_prompts']} | {r['n_prompt_errors']} | "
                     f"{r['n_positions']} |")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ I/O
def _read_jsonl(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def _write_jsonl(blocks, path):
    with open(path, "w", encoding="utf-8") as f:
        for b in blocks:
            f.write(json.dumps(b) + "\n")


def load_prompts(path, repo_root):
    """Calibration prompts.jsonl → [(id, text)]; src resolved against repo_root."""
    out = []
    for row in _read_jsonl(path):
        fp = row["src"] if os.path.isabs(row["src"]) else os.path.join(repo_root, row["src"])
        text = open(fp, encoding="utf-8").read()[: int(row.get("char_cut", len(row["src"])))]
        out.append((row["id"], text))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("selftest", help="live first-boot gate (r2 §2, 5 checks)")
    sp.add_argument("--url", required=True)
    sp.add_argument("--model", required=True)
    sp.add_argument("--out", help="write the checks JSON here (default: stdout)")
    ENGINE_HELP = ("engine family; 'auto' reads /v1/models owned_by. Only vllm changes the requests "
                   "(return_tokens_as_token_ids, so its top-k is keyed by id)")
    sp.add_argument("--engine", default="auto", choices=("auto", "vllm", "llamacpp", "radiance"), help=ENGINE_HELP)

    fp = sub.add_parser("fetch", help="greedy capture per calibration prompt")
    fp.add_argument("--url", required=True)
    fp.add_argument("--model", required=True)
    fp.add_argument("--calibration", required=True, help="prompts jsonl (id, src, char_cut)")
    fp.add_argument("--max-tokens", type=int, default=N_MAX)
    fp.add_argument("--limit", type=int, default=None,
                    help="first N calibration prompts only (short pass; the hash-pinned file is untouched)")
    fp.add_argument("--repo-root", default=os.getcwd())
    fp.add_argument("--out", required=True)
    fp.add_argument("--image", default=None, help="engine image, recorded in the cache key (<out>.key.json)")
    fp.add_argument("--window-out", default=None,
                    help="append one JSON line per fetch: /metrics deltas + counts (item H)")
    fp.add_argument("--engine", default="auto", choices=("auto", "vllm", "llamacpp", "radiance"), help=ENGINE_HELP)
    fp.add_argument("--prompt-ids", action="store_true",
                    help="also store this server's /tokenize prompt ids (the forced reference sends them to every arm)")

    fo = sub.add_parser("forced", help="teacher-forced capture on a reference's greedy continuation")
    fo.add_argument("--url", required=True)
    fo.add_argument("--model", required=True)
    fo.add_argument("--calibration", required=True)
    fo.add_argument("--ref", required=True, help="the reference's greedy fetch (with token ids: llama.cpp)")
    fo.add_argument("--positions", type=int, default=FORCED_K)
    fo.add_argument("--limit", type=int, default=None)
    fo.add_argument("--repo-root", default=os.getcwd())
    fo.add_argument("--out", required=True)
    fo.add_argument("--image", default=None)
    fo.add_argument("--engine", default="auto", choices=("auto", "vllm", "llamacpp", "radiance"), help=ENGINE_HELP)

    cs = sub.add_parser("cache-status", help="exit 0 complete+key match, 1 incomplete, 2 key mismatch/missing, 3 absent")
    ck = sub.add_parser("cache-key", help="print the expected cache key JSON")
    for x in (cs, ck):
        x.add_argument("--calibration", required=True)
        x.add_argument("--limit", type=int, default=None)
        x.add_argument("--max-tokens", type=int, default=N_MAX)
        x.add_argument("--model", default=None)
        x.add_argument("--image", default=None)
        x.add_argument("--forced-ref", default=None, help="a forced fetch's reference file (forced key)")
        x.add_argument("--positions", type=int, default=None)
    cs.add_argument("--out", required=True)
    cs.add_argument("--prompt-ids", action="store_true", help="the cached rows must carry prompt_ids (exit 2 if not)")

    sc = sub.add_parser("score", help="paired greedy KL: reference vs arm")
    sc.add_argument("--ref", required=True)
    sc.add_argument("--arm", required=True)
    sc.add_argument("--label", required=True)
    sc.add_argument("--out", required=True)
    sc.add_argument("--ref-label", default=None,
                    help="name of the reference (arm-vs-arm pairs); default: the local FP8 reference note")

    sf = sub.add_parser("score-forced", help="teacher-forced KL: reference greedy fetch vs arm forced fetch")
    sf.add_argument("--ref", required=True)
    sf.add_argument("--arm", required=True)
    sf.add_argument("--label", required=True)
    sf.add_argument("--ref-label", required=True)
    sf.add_argument("--out", required=True)

    sd = sub.add_parser("score-forced-diff", help="paired KL difference of two forced arms on the same reference")
    sd.add_argument("--ref", required=True)
    sd.add_argument("--arm-a", required=True)
    sd.add_argument("--arm-b", required=True)
    sd.add_argument("--label-a", required=True)
    sd.add_argument("--label-b", required=True)
    sd.add_argument("--ref-label", required=True)
    sd.add_argument("--out", required=True)

    mx = sub.add_parser("matrix", help="kld-pair-*.json in --dir → pairwise markdown table")
    mx.add_argument("--dir", required=True)
    mx.add_argument("--out", required=True)

    a = ap.parse_args()
    try:
        eng = (detect_engine(a.url) if a.engine == "auto" else a.engine) if hasattr(a, "engine") else None
    except RuntimeError as e:   # fix round 1: --engine auto never degrades silently to "no engine"
        print(f"REFUSED: {e}", file=sys.stderr)
        sys.exit(2)
    if getattr(a, "engine", None) == "auto" and eng is None:   # fix round 2: a card without owned_by, said aloud
        print(f"WARNING {a.url}: /v1/models has no owned_by — engine undetected: string join, no vLLM id flag "
              "(pin --engine to change that)", file=sys.stderr)
    if a.cmd == "selftest":
        ok, checks = selftest(a.url, a.model, engine=eng)
        out = json.dumps(checks, indent=2) + "\n"
        if a.out:
            open(a.out, "w").write(out)
        else:
            print(out, end="")
        if not ok:
            print(f"SELFTEST FAILED (logprobs unsupported) — arm out of the KLD pass",
                  file=sys.stderr)
            sys.exit(1)
    elif a.cmd == "cache-key":
        mt = 1 if a.forced_ref else a.max_tokens
        print(json.dumps(cache_key(a.calibration, a.limit, mt, a.model, a.image, a.forced_ref, a.positions)))
    elif a.cmd == "cache-status":
        mt = 1 if a.forced_ref else a.max_tokens   # a forced fetch asks max_tokens 1
        code, reason = cache_status(a.out, a.calibration, a.limit, mt, a.model, a.image,
                                    a.forced_ref, a.positions, a.prompt_ids)
        print(f"{os.path.basename(a.out)}: {reason}")
        sys.exit(code)
    elif a.cmd == "forced":
        prompts = load_prompts(a.calibration, a.repo_root)
        if a.limit is not None:
            prompts = prompts[: a.limit]
        key = cache_key(a.calibration, a.limit, 1, a.model, a.image, a.ref, a.positions)
        refs = {b["id"]: b for b in _read_jsonl(a.ref)}
        reuse = {}
        if os.path.exists(a.out):
            stored = read_key(a.out)
            diff = _key_diff(stored, key) if stored else ["no key file"]
            if diff:   # renamed, never deleted (item C)
                stale = f"{a.out}.stale-{time.strftime('%Y%m%d-%H%M%S')}"
                os.replace(a.out, stale)
                if stored is not None:
                    os.replace(key_path(a.out), stale + KEY_SUFFIX)
                print(f"cache key mismatch ({', '.join(diff)}) -> old forced fetch kept as {stale}; re-fetching")
            else:
                want = {pid for pid, _ in prompts}
                for r in _read_rows_tolerant(a.out):
                    if r.get("id") in want and not r.get("error") and r["id"] not in reuse:
                        reuse[r["id"]] = r
        miss = missing_prompt_ids(reuse.values()) if any(isinstance(r.get("prompt_ids"), list)
                                                         for r in refs.values()) else []
        if miss:   # fix round 1: never mix pre-id rows into an id-checked forced fetch, never rename the file
            print("REFUSED: " + IDS_REFUSAL.format(n=len(miss), ids=miss[:3]), file=sys.stderr)
            sys.exit(2)
        _write_atomic(key_path(a.out), json.dumps(key) + "\n")
        _write_atomic(a.out, "".join(json.dumps(reuse[p]) + "\n" for p, _ in prompts if p in reuse))

        def _append_f(blk):
            with open(a.out, "a", encoding="utf-8") as f:
                f.write(json.dumps(blk) + "\n")
        t0 = time.time()
        n_new = sum(1 for p, _ in prompts if p not in reuse)
        blocks = fetch_forced(a.url, a.model, prompts, refs, k=a.positions, reuse=reuse, on_block=_append_f,
                              engine=eng)
        _write_atomic(a.out, "".join(json.dumps(b) + "\n" for b in blocks))
        errs = [b["id"] for b in blocks if b.get("error")]
        npos = sum(len(b.get("positions") or []) for b in blocks)
        print(f"forced {len(blocks)} prompts, {npos} positions ({n_new} requested, {len(reuse)} reused; "
              f"{len(errs)} errored: {errs[:5]}) in {time.time() - t0:.0f} s, engine {eng} -> {a.out}")
        if errs:
            first = next(b for b in blocks if b.get("error"))
            print(f"  first error ({first['id']}): {first['error']}")
        if len(errs) == len(blocks):
            sys.exit(1)
    elif a.cmd == "score-forced-diff":
        try:
            res = score_forced_diff(_read_jsonl(a.ref), _read_jsonl(a.arm_a), _read_jsonl(a.arm_b),
                                    a.label_a, a.label_b, a.ref_label)
        except ValueError as e:     # join mismatch / order / count: refused, no output file
            print(f"REFUSED {a.label_a} − {a.label_b}: {e}", file=sys.stderr)
            sys.exit(2)
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)
            f.write("\n")
        print(f"{a.label_a} − {a.label_b} (forced, vs {a.ref_label}): {res['diff_nats_per_tok']} "
              f"[{res['ci95_nats'][0]}, {res['ci95_nats'][1]}] -> {res['verdict']} "
              f"(join {res['join_a']}/{res['join_b']}) -> {a.out}")
    elif a.cmd == "score-forced":
        try:
            res = score_forced(_read_jsonl(a.ref), _read_jsonl(a.arm), a.label, a.ref_label)
        except ValueError as e:     # nothing scorable (all quarantined) / order / count: refused, no output file
            print(f"REFUSED {a.label} vs {a.ref_label}: {e}", file=sys.stderr)
            sys.exit(2)
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)
            f.write("\n")
        print(f"{a.label} vs {a.ref_label} (forced): KL {res['kl_nats_per_tok']} "
              f"[{res['ci95_nats'][0]}, {res['ci95_nats'][1]}] median {res['kl_per_position']['median']} "
              f"top1 {res['top1_agreement']} n={res['n_positions']} errors={res['n_prompt_errors']} "
              f"join {res['join']} -> {a.out}")
    elif a.cmd == "fetch":
        prompts = load_prompts(a.calibration, a.repo_root)
        if a.limit is not None:
            prompts = prompts[: a.limit]
        key = cache_key(a.calibration, a.limit, a.max_tokens, a.model, a.image)
        reuse = {}
        if os.path.exists(a.out):
            stored = read_key(a.out)
            diff = _key_diff(stored, key) if stored else ["no key file"]
            if diff:
                # item C: a mismatched (or key-less legacy) cache is renamed, never deleted, then re-fetched
                stale = f"{a.out}.stale-{time.strftime('%Y%m%d-%H%M%S')}"
                os.replace(a.out, stale)
                if stored is not None:
                    os.replace(key_path(a.out), stale + KEY_SUFFIX)
                print(f"cache key mismatch ({', '.join(diff)}) -> old fetch kept as {stale}; re-fetching")
            else:
                # item D: keep the OK rows (first per id), re-request only errored/missing prompts
                want = {pid for pid, _ in prompts}
                for r in _read_rows_tolerant(a.out):
                    if r.get("id") in want and not r.get("error") and r["id"] not in reuse:
                        reuse[r["id"]] = r
        miss = missing_prompt_ids(reuse.values()) if a.prompt_ids else []
        if miss:   # fix round 1: --prompt-ids on a pre-id cache would silently add nothing; the file is left as is
            print("REFUSED: " + IDS_REFUSAL.format(n=len(miss), ids=miss[:3]), file=sys.stderr)
            sys.exit(2)
        _write_atomic(key_path(a.out), json.dumps(key) + "\n")
        # persistence: the reused rows first, then each new block appended as it lands (a kill keeps
        # progress); the final rewrite below leaves exactly one row per prompt id, in calibration order
        _write_atomic(a.out, "".join(json.dumps(reuse[p]) + "\n" for p, _ in prompts if p in reuse))

        def _append(blk):
            with open(a.out, "a", encoding="utf-8") as f:
                f.write(json.dumps(blk) + "\n")
        t0, w0 = time.time(), metrics_snapshot(a.url)
        kv_samples = []
        n_new = sum(1 for p, _ in prompts if p not in reuse)
        blocks = fetch(a.url, a.model, prompts, max_tokens=a.max_tokens, reuse=reuse, on_block=_append,
                       kv_samples=kv_samples if w0 is not None else None, engine=eng, prompt_ids=a.prompt_ids)
        w1 = metrics_snapshot(a.url) if w0 is not None else None
        _write_atomic(a.out, "".join(json.dumps(b) + "\n" for b in blocks))
        errs = [b["id"] for b in blocks if b.get("error")]
        print(f"fetched {len(blocks)} prompts ({n_new} requested, {len(reuse)} reused; "
              f"{len(errs)} errored: {errs}) in {time.time() - t0:.0f} s, engine {eng} -> {a.out}")
        if a.window_out:
            win = {"kind": "kld_fetch_window", "out": a.out, "model": a.model, "image": a.image, "engine": eng,
                   "url": a.url, "n": key["n"], "n_requested": n_new, "n_reused": len(reuse),
                   "n_errors": len(errs), "t_start": round(t0, 3), "t_end": round(time.time(), 3),
                   **window_summary(w0, w1, kv_samples)}
            with open(a.window_out, "a", encoding="utf-8") as f:
                f.write(json.dumps(win) + "\n")
        if len(errs) == len(blocks):
            sys.exit(1)
    elif a.cmd == "score":
        ref_blocks = _read_jsonl(a.ref)
        arm_blocks = _read_jsonl(a.arm)
        reference_note = a.ref_label or ("Qwen__Qwen3.8-27B-FP8@017b9c7a (local FP8, D8 — bf16 "
                                         "unavailable on this stack)")
        res = score(ref_blocks, arm_blocks, a.label, reference_note)
        res["reference_label"] = a.ref_label
        if res["tokenizer_check"]["verdict"] == "MISMATCH":
            print(f"WARNING {a.label} vs {reference_note}: tokenizer MISMATCH "
                  f"{res['tokenizer_check']['mismatches'][:3]}", file=sys.stderr)
        with open(a.out, "w") as f:
            json.dump(res, f, indent=2)
            f.write("\n")
        print(f"{res['label']}: KL {res['kl_nats_per_tok']} nats/tok "
              f"[{res['ci95_nats'][0]}, {res['ci95_nats'][1]}] "
              f"(pooled {res['pooled_ci_nats'][0]}–{res['pooled_ci_nats'][1]}) "
              f"dNLL {res['dnll_nats_per_tok']} top1 {res['top1_agreement']} "
              f"n={res['n_positions']} tokenizer {res['tokenizer_check']['verdict']} join {res['join']} -> {a.out}")
    elif a.cmd == "matrix":
        rows = load_pair_results(a.dir)
        if not rows:
            print(f"no kld-pair-*.json in {a.dir}", file=sys.stderr)
            sys.exit(1)
        _write_atomic(a.out, matrix_markdown(rows))
        print(f"matrix: {len(rows)} pairs -> {a.out}")


if __name__ == "__main__":
    main()
