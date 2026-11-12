# Overlay for Sly radiance's radiance_mxfp4.py (shadows the site-packages copy via PYTHONPATH, see
# serve_vllm.sh PY_OVERLAY). Loads the image's ORIGINAL source, inserts one padding call before each
# W4A8 GEMM launch, and execs it as this module -- so the overlay follows the image's plugin version
# and refuses loudly (boot fails) if an anchor no longer matches.
#
# Why (2026-10-22, R9700): every HSA_STATUS_ERROR_MEMORY_FAULT in radiance_mxfp4_fp8_gemm_{folded,atiled}
# had grid.y = 7 at M = 1760 (the 2048-token prefill chunk's remainder): 7 x 256-row tiles = 1792 rows,
# i.e. the kernel reads A (and its per-row scale) up to 32 rows past the end of the buffer. If that
# buffer ends at an unmapped page -> "page not present". Fix under test: give A and x_scale a zeroed
# tail of PAD_ROWS rows, same layout, real M passed -> the over-read lands in owned memory; rows >= M
# are never written (kernel does not write out of bounds), so results are unchanged.
# pada-1 (A padded only) still faulted -> also give `out` a PAD_ROWS-row tail (RADIANCE_MXFP4_PAD_OUT_ROWS=0
# disables): if the 256-row output tile is stored unmasked, rows M..1791 land past the buffer.
#   RADIANCE_MXFP4_PAD_A=0 disables; RADIANCE_MXFP4_PAD_A_MIN_M (default 128) leaves decode untouched.
import os as _os, sys as _sys

_SRC = "/opt/vllm/lib/python3.12/site-packages/radiance_mxfp4.py"
_PAD = """
PAD_A = _os_pad.environ.get("RADIANCE_MXFP4_PAD_A", "1") == "1"
PAD_A_MIN_M = int(_os_pad.environ.get("RADIANCE_MXFP4_PAD_A_MIN_M", "128"))
PAD_ROWS = 256          # >= the prefill kernels' M tile
PAD_OUT_ROWS = _os_pad.environ.get("RADIANCE_MXFP4_PAD_OUT_ROWS", "1") == "1"


def _pad_tail(t, n, tail):
    # copy n bytes from t's data pointer (same layout, incl. tiled storage) + a zeroed tail
    st = t.untyped_storage()
    off = t.storage_offset() * t.element_size()
    n = min(n, st.nbytes() - off)
    src = torch.empty(0, dtype=torch.uint8, device=t.device).set_(st, off, (n,), (1,))
    dst = torch.empty(n + tail, dtype=torch.uint8, device=t.device)
    dst[:n].copy_(src)
    dst[n:].zero_()
    return dst


def _pad_a(a, s, M, K):
    if not PAD_A or M <= PAD_A_MIN_M or M % PAD_ROWS == 0:
        return a, s
    a2 = _pad_tail(a, a.numel() * a.element_size() + 16 * K, PAD_ROWS * K)
    s2 = _pad_tail(s, s.numel() * s.element_size(), PAD_ROWS * 4)
    return a2, s2   # only .data_ptr() is used after this point


PTRLOG = _os_pad.environ.get("RADIANCE_MXFP4_PTRLOG", "0") == "1"


def _plog(tag, M, N, K, *ts):
    # Diagnostic: operand [start,end) per prefill-class launch, to map a fault address to a buffer
    if PTRLOG and M > PAD_A_MIN_M:
        sys.stderr.write(f"[ptr] {tag} M={M} N={N} K={K} " + " ".join(
            f"{t.data_ptr():#x}+{t.untyped_storage().nbytes() - t.storage_offset() * t.element_size():#x}"
            for t in ts) + "\\n")


SPLIT_M = int(_os_pad.environ.get("RADIANCE_MXFP4_SPLIT_M", "0"))
_SPLIT_N = [0]


def _split(fn, xp, wp, wsp, wrp, xsp, op, M, N, K, stream):
    # Run a prefill-class launch as row slices of <= SPLIT_M on the decode/wide kernels (the .so picks the
    # kernel by M), which never faulted; same operands, same numerics. Row-major A only (A-tiled off):
    # A rows are K fp8 bytes, x_scale 4 B/row, out N bf16/row.
    if SPLIT_M <= 0 or M <= SPLIT_M:
        return fn(xp, wp, wsp, wrp, xsp, op, M, N, K, stream)
    _SPLIT_N[0] += 1
    if _SPLIT_N[0] in (1, 1000, 100000):
        sys.stderr.write(f"[radiance.mxfp4] SPLIT launch #{_SPLIT_N[0]} M={M} N={N} K={K} -> {(M + SPLIT_M - 1) // SPLIT_M} slices\\n")
    for r in range(0, M, SPLIT_M):
        m = min(SPLIT_M, M - r)
        fn(xp + r * K, wp, wsp, wrp, xsp + r * 4, op + r * N * 2, m, N, K, stream)


def _out_pad(M, N, dev):
    # out with a PAD_ROWS-row tail: a 256-row output tile at M=1760 writes up to 1792 rows
    if not PAD_OUT_ROWS or M <= PAD_A_MIN_M or M % PAD_ROWS == 0:
        return torch.empty((M, N), device=dev, dtype=torch.bfloat16)
    return torch.empty(((M + PAD_ROWS) * N,), device=dev, dtype=torch.bfloat16)[:M * N].view(M, N)
"""
_EDITS = [
    # mxfp4_linear (quant inside the op)
    ("        _ext.launch(x_fp8.data_ptr(), weight.data_ptr(), weight_scale.data_ptr(),\n"
     "                    weight_ref.data_ptr() if folded",
     "        x_fp8, x_scale = _pad_a(x_fp8, x_scale, M, K)\n"
     "        _plog('lin', M, N, K, x_fp8, x_scale, out, weight, weight_scale, weight_ref)\n"
     "        _ext.launch(x_fp8.data_ptr(), weight.data_ptr(), weight_scale.data_ptr(),\n"
     "                    weight_ref.data_ptr() if folded"),
    # mxfp4_linear_pq (folded / atiled, pre-quantized)
    ("\n    launch(x_fp8.data_ptr(), weight.data_ptr()",
     "\n    x_fp8, x_scale = _pad_a(x_fp8, x_scale, M, K)\n"
     "    _plog('pq' + ('T' if tiled else ''), M, N, K, x_fp8, x_scale, out, weight, weight_scale, weight_ref)\n    launch(x_fp8.data_ptr(), weight.data_ptr()"),
    # mxfp4_linear_pqp (P partitions; astride is already computed from the original)
    ("    launch = _ext.launch_at_p if tiled else _ext.launch_p\n",
     "    launch = _ext.launch_at_p if tiled else _ext.launch_p\n    a, x_scale = _pad_a(a, x_scale, M, K)\n"
     "    _plog('pqp' + ('T' if tiled else ''), M, N, K, a, x_scale, out, weight, weight_scale, weight_ref)\n"),
]
_code = open(_SRC).read()
_EDITS += [
    ("        _ext.launch(x_fp8.data_ptr(), weight.data_ptr(), weight_scale.data_ptr(),\n                    weight_ref.data_ptr() if folded",
     "        _split(_ext.launch, x_fp8.data_ptr(), weight.data_ptr(), weight_scale.data_ptr(),\n                    weight_ref.data_ptr() if folded"),
    ("\n    launch(x_fp8.data_ptr(), weight.data_ptr()", "\n    (_split if not tiled else lambda f, *a: f(*a))(launch, x_fp8.data_ptr(), weight.data_ptr()"),
]
for _old, _new in _EDITS:
    if _code.count(_old) != 1:
        raise RuntimeError(f"[radiance.mxfp4 pad-a overlay] anchor matched {_code.count(_old)}x, expected 1 "
                           f"(plugin version changed?): {_old.strip()[:60]!r}")
    _code = _code.replace(_old, _new)
import re as _re
_code, _n = _re.subn(r"out = torch\.empty\(\(M, N\), device=(\w+)\.device, dtype=torch\.bfloat16\)",
                     r"out = _out_pad(M, N, \1.device)", _code)
if _n != 4:
    raise RuntimeError(f"[radiance.mxfp4 pad-a overlay] out-alloc anchor matched {_n}x, expected 4")
_code = _code.replace("\nimport torch\n", "\nimport torch\nimport os as _os_pad\n" + _PAD, 1)
exec(compile(_code, _SRC + " (pad-a overlay)", "exec"), globals())
_sys.stderr.write(f"[radiance.mxfp4] overlay split_m={SPLIT_M} pad_a={PAD_A} pad_out={PAD_OUT_ROWS} min_m={PAD_A_MIN_M} rows={PAD_ROWS}\n")
