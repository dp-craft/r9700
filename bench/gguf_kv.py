#!/usr/bin/env python3
"""gguf_kv.py — read a GGUF's KV-cache geometry straight from the model file and print the
per-token KV size + a ready-to-paste campaign `vram` block.

CRUCIAL for HYBRID architectures: Qwen3.6 interleaves SSM / Gated-DeltaNet *linear-attention*
layers (fixed-size recurrent state, NO growing KV) with periodic full-attention layers. Only the
full-attention layers cache KV. This tool counts them from the actual tensor directory
(# of blk.*.attn_k weights) rather than trusting block_count — e.g. Qwen3.6-27B has 65 blocks but
only ~16 full-attention layers, so f16 KV ≈ 64 KiB/tok (not the ~260 you'd get multiplying all 65).
That difference decides whether 200K context fits in 32 GB (it does) or not (it wouldn't). Trust
this over an online "will it fit" calculator AND over any all-layers hand-math.

    python3 bench/gguf_kv.py /path/to/model.gguf [--weights-gib G] [--budget-mib M]

Reads the metadata + tensor directory (names/offsets only, never tensor data), so it's instant
even on a 16 GB file. Stdlib only.
"""
import struct, sys, argparse

FMT = {0:('B',1),1:('b',1),2:('H',2),3:('h',2),4:('I',4),5:('i',4),
       6:('f',4),7:('?',1),10:('Q',8),11:('q',8),12:('d',8)}


def _u32(f): return struct.unpack('<I', f.read(4))[0]
def _u64(f): return struct.unpack('<Q', f.read(8))[0]
def _gstr(f): return f.read(_u64(f)).decode('utf-8', 'replace')


def _read_val(f, vt):
    if vt == 8:
        return _gstr(f)
    if vt == 9:  # array — consume without materializing (tokenizer arrays are huge)
        at, n = _u32(f), _u64(f)
        if at == 8:
            for _ in range(n): f.seek(_u64(f), 1)
        elif at in FMT:
            f.seek(FMT[at][1] * n, 1)
        return None
    if vt in FMT:
        return struct.unpack('<' + FMT[vt][0], f.read(FMT[vt][1]))[0]
    raise ValueError(f"unknown gguf value type {vt}")


def read_meta(path):
    """Return (metadata_dict, tensor_stats). tensor_stats counts how many layers actually
    cache KV — critical for HYBRID architectures (Qwen3.6 = SSM/Gated-DeltaNet linear-attention
    layers + periodic full-attention). Only full-attention layers grow a per-token KV cache; the
    SSM layers keep a fixed-size recurrent state. Counting `block_count` would over-estimate KV by
    (total blocks / attention blocks) — ~4x on this arch. Ground truth = # of blk.*.attn_k tensors."""
    import re
    md = {}
    attn_layers, ssm_layers, nextn_layers = set(), set(), set()
    with open(path, 'rb') as f:
        if f.read(4) != b'GGUF':
            sys.exit(f"{path}: not a GGUF file")
        _u32(f); ntensors = _u64(f); nkv = _u64(f)   # version, tensor_count, kv_count
        for _ in range(nkv):
            k = _gstr(f); md[k] = _read_val(f, _u32(f))
        for _ in range(ntensors):                    # tensor directory: names only, no data
            nm = _gstr(f); nd = _u32(f)
            f.seek(8 * nd, 1); _u32(f); _u64(f)      # dims (u64*nd), ggml_type (u32), offset (u64)
            blk = re.match(r'blk\.(\d+)\.', nm)
            if not blk: continue
            idx = int(blk.group(1))
            if nm.endswith('.attn_k.weight'): attn_layers.add(idx)
            if '.ssm' in nm: ssm_layers.add(idx)
            if '.nextn.' in nm: nextn_layers.add(idx)
    stats = {"kv_layers": len(attn_layers), "ssm_layers": len(ssm_layers),
             "nextn_layers": len(nextn_layers), "attn_indices": sorted(attn_layers)}
    return md, stats


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gguf")
    ap.add_argument("--weights-gib", type=float, help="for the vram block (else use the file size)")
    ap.add_argument("--budget-mib", type=int, default=32400, help="guard budget (default 32400)")
    ap.add_argument("--overhead-mib", type=int, default=2000,
                    help="compute/graph buffers on top of weights+KV (MEASURED ~2 GiB at 200K "
                         "f16 ub2048 on the R9700; grows with ub/b/ctx). Default 2000.")
    a = ap.parse_args()
    md, ts = read_meta(a.gguf)
    arch = md.get("general.architecture", "?")

    def g(suffix):
        for k, v in md.items():
            if k.startswith(arch + ".") and k.endswith(suffix):
                return v
        return None

    L = g("block_count"); hkv = g("attention.head_count_kv")
    kl = g("attention.key_length"); vl = g("attention.value_length")
    h = g("attention.head_count"); emb = g("embedding_length"); nctx = g("context_length")
    if kl is None and emb and h:            # some archs omit key/value_length → head_dim = emb/head
        kl = vl = emb // h
    if not (L and hkv and kl and vl):
        sys.exit(f"could not read KV geometry (arch={arch}, L={L} hkv={hkv} kl={kl} vl={vl})")

    # HYBRID-aware: only full-attention layers cache KV. Prefer the ground-truth tensor count over
    # block_count. Exclude the nextn/MTP layer (it only caches KV when MTP is ON) so the number
    # reflects normal (MTP-off) max-context serving; MTP-on adds ~1 layer.
    kv_layers = ts["kv_layers"] - ts["nextn_layers"] if ts["kv_layers"] else L
    hybrid = kv_layers < L
    L_eff = kv_layers if kv_layers else L

    f16 = L_eff * hkv * (kl + vl) * 2                 # bytes/token (only attention layers)
    print(f"arch={arch}  block_count={L}  head_count={h}  head_count_kv={hkv}  "
          f"key_length={kl}  value_length={vl}  context_length={nctx}")
    if hybrid:
        print(f"HYBRID: {L_eff} full-attention KV layers of {L} blocks "
              f"({ts['ssm_layers']} SSM/linear-attn, {ts['nextn_layers']} nextn/MTP) — "
              f"KV counts only the {L_eff} attention layers, NOT all {L}")
    print(f"f16  KV/token = {f16} B = {f16/1024:.1f} KiB/tok   (over {L_eff} attn layers)")
    print(f"q8_0 KV/token ≈ {f16/1024*0.53:.1f} KiB/tok   (f16 × ~0.53)")
    import os
    wg = a.weights_gib if a.weights_gib else os.path.getsize(a.gguf) / 2**30
    for label, per in (("f16", f16/1024), ("q8_0", f16/1024*0.53)):
        avail = a.budget_mib - (wg * 1024 + a.overhead_mib)
        maxc = int(avail / (per / 1024)) if avail > 0 else 0
        cap = f" (RoPE-capped at {nctx:,})" if nctx and maxc > nctx else ""
        print(f"  {label:4} max ctx @ budget {a.budget_mib} MiB (weights {wg:.1f} GiB, "
              f"overhead {a.overhead_mib}) ≈ {min(maxc, nctx) if nctx else maxc:,} tok{cap}")
    print("\nspec `vram` block:")
    print(f'  "vram": {{"weights_gib": {wg:.2f}, '
          f'"kv_kib_per_tok": {{"f16": {round(f16/1024)}, "q8_0": {round(f16/1024*0.53)}}}, '
          f'"budget_mib": {a.budget_mib}, "overhead_mib": {a.overhead_mib}}}')


if __name__ == "__main__":
    main()
