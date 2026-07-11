#!/usr/bin/env python3
"""Unified prober. Measures prefill + decode tok/s against one runtime using its
NATIVE timing when available (most accurate), else client-side streaming.

Usage:
  probe.py llamacpp  <port>  <label> <config_json> <results_file>
  probe.py ollama    <model> <label> <config_json> <results_file>
  probe.py vllm      <model> <label> <config_json> <results_file>

Prefill is measured over a ~3K-token prompt (unique-prefixed to defeat any prefix
cache); decode over N_DECODE freshly generated tokens.
"""
import sys, os, time, json, random, string, urllib.request

RT, TARGET, LABEL, CFG_JSON, OUT = sys.argv[1:6]
N_DECODE = int(os.environ.get("N_DECODE", "256"))
LONG = open(os.environ.get("LONGPROMPT", "/home/dev/work/dippe/amd/bench/longprompt.txt")).read()
UNIQ = "// run-" + "".join(random.choices(string.ascii_lowercase, k=32)) + "\n"
PROMPT = UNIQ + LONG

def post(url, payload, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)

def bench_llamacpp(port):
    # ignore_eos forces exactly N_DECODE tokens so predicted_per_second can't blow up on early EOS
    r = json.load(post(f"http://127.0.0.1:{port}/completion",
                       {"prompt": PROMPT, "n_predict": N_DECODE, "temperature": 0,
                        "cache_prompt": False, "ignore_eos": True}))
    t = r.get("timings", {})
    dec = t.get("predicted_per_second", 0)
    # sanity: derive from counts if the reported rate is degenerate
    if not dec or dec > 5000:
        pn, pms = t.get("predicted_n", 0), t.get("predicted_ms", 0)
        dec = (pn / (pms / 1000.0)) if pms > 0 and pn > 1 else 0
    return t.get("prompt_per_second", 0), dec, \
           int(t.get("prompt_n", 0)), t.get("draft_n_accepted"), t.get("draft_n")

def bench_ollama(model):
    opts = {"temperature": 0, "num_predict": N_DECODE, "num_ctx": int(os.environ.get("CTX", "65536"))}
    if os.environ.get("NUM_BATCH"):
        opts["num_batch"] = int(os.environ["NUM_BATCH"])
    r = json.load(post("http://127.0.0.1:11434/api/generate",
                       {"model": model, "prompt": PROMPT, "stream": False, "options": opts}))
    pe_n, pe_d = r.get("prompt_eval_count", 0), r.get("prompt_eval_duration", 1)
    ev_n, ev_d = r.get("eval_count", 0), r.get("eval_duration", 1)
    return (pe_n / (pe_d / 1e9) if pe_d else 0), (ev_n / (ev_d / 1e9) if ev_d else 0), pe_n, None, None

def bench_vllm(model):
    body = {"model": model, "prompt": PROMPT, "max_tokens": N_DECODE, "temperature": 0,
            "stream": True, "stream_options": {"include_usage": True}}
    t0 = time.time(); tf = None; n = 0; usage = {}
    for raw in post("http://127.0.0.1:8000/v1/completions", body):
        line = raw.decode().strip()
        if not line.startswith("data:"): continue
        d = line[5:].strip()
        if d == "[DONE]": break
        o = json.loads(d)
        if o.get("choices") and o["choices"][0].get("text"):
            if tf is None: tf = time.time()
            n += 1
        if o.get("usage"): usage = o["usage"]
    te = time.time()
    pt = usage.get("prompt_tokens", 0); ct = usage.get("completion_tokens", n)
    return (pt / (tf - t0) if tf and tf > t0 else 0), ((ct - 1) / (te - tf) if tf and te > tf else 0), pt, None, None

def vram_used_mb():
    import subprocess
    try:
        out = subprocess.check_output(["rocm-smi", "--showmeminfo", "vram"], text=True)
        for ln in out.splitlines():
            if "Used Memory" in ln: return round(int(ln.split()[-1]) / 1048576)
    except Exception:
        pass
    return -1

fn = {"llamacpp": bench_llamacpp, "ollama": bench_ollama, "vllm": bench_vllm}[RT]
vram = vram_used_mb()
prefill, decode, ptoks, da, dn = fn(TARGET)
rec = json.loads(CFG_JSON)
rec.update({"runtime": RT, "label": LABEL, "prefill_tok_s": round(prefill, 1),
            "decode_tok_s": round(decode, 1), "prompt_tokens": ptoks, "vram_used_mb": vram})
if dn: rec["draft"] = f"{da}/{dn}"
print(json.dumps(rec))
open(OUT, "a").write(json.dumps(rec) + "\n")
