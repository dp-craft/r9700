# vLLM docker track — Sly radiance first, any vLLM image later

Goal: a reproducible, docker-only vLLM setup for **Qwen3.8-27B on one R9700**, using RDNA4's fp8
WMMA through 4-bit **W4A8** checkpoints (4-bit weights, fp8 activations). Switching versions or
forks = a new image tag or a new `profiles/<engine>/` folder; nothing compiles on the host.

## Layout

| Where | What |
|---|---|
| `bench/engine-bench/vllm/` (repo) | `serve_vllm.sh` launcher, `fetch_model.sh`, `profiles/<engine>/{_engine,<model>}.env` |
| `/mnt/Lin1/work/vllm/sly-radiance/models/<org>__<repo>@<rev8>/` | pinned HF snapshots + `SOURCE.txt`, mounted read-only at `/model` |
| `/mnt/Lin1/work/vllm/sly-radiance/cache/<image>@<tag>/` | vllm/inductor/triton/aiter compile caches, **one set per image tag** |
| `/mnt/Lin1/work/vllm/sly-radiance/src/<tag>/` | upstream source checkout (templates, docs, reference scripts) |
| `/mnt/Lin1/work/vllm/sly-radiance/tools/hf-venv/` | `hf` CLI used by `fetch_model.sh` |
| `/mnt/Lin1/work/hf/` | shared `HF_HOME` (hub cache, xet chunks): `fetch_model.sh` on the host + mounted at `/hf` (`HF_HOME=/hf`) in every container. Default ACL `u:dev:rwX`, so root-written files stay dev-writable. **Not** set globally: `~/.cache/huggingface` keeps the GGUFs CLAUDE.md/llama-swap reference by path |
| `/mnt/Lin1/work/docker/` | docker data-root (**pending, needs root**) |

## Models (pinned)

| Id | Repo @ revision | Format | FP8 hardware path | Profile |
|---|---|---|---|---|
| A | `amd/Qwen3.8-27B-Quark-AWQ-MXFP4` @ `5233554c` | Quark MXFP4 | W4A8 fp8-WMMA (all linears) | `sly-radiance/qwen38-mxfp4` |
| A2 | `unsloth/Qwen3.8-27B-NVFP4` @ `f0b7c9e7` | NVFP4 → MXFP4 at load | same as A | `sly-radiance/qwen38-nvfp4` |

## Usage

```bash
./fetch_model.sh <org/repo> <40-hex-rev>                       # pinned, resumable download
PROFILE=sly-radiance/qwen38-mxfp4 ./serve_vllm.sh print        # show the full resolved config (no GPU)
PROFILE=sly-radiance/qwen38-mxfp4 PORT=8000 ./serve_vllm.sh    # boot: gpu_exclusive.sh floor first
PORT=8000 ./serve_vllm.sh stop|status|logs
IMAGE=ghcr.io/slybase/vllm-sly-radiance:<new-tag> PROFILE=... ./serve_vllm.sh   # try a new image
```
Every boot writes `bench/.servers/<port>.cmdline`: argv, image digest, model repo+revision, vLLM version.
While booting, a **VRAM watchdog** polls sysfs every 0.2 s and `docker kill`s the container if free
VRAM drops below `WATCHDOG_MIB` (default 256; the desktop shares the card — see `docs/vllm/workflows.md`, A2).

## Monitoring

A live server exposes three data sources (no extra setup): vLLM `/metrics` (Prometheus), `amd-smi`,
and the log (`bench/.servers/<port>.log`).

**Quick check (one-liner):**
```bash
watch -n 2 'curl -s http://127.0.0.1:8000/metrics \
  | grep -E "prefix_cache_(hits|queries)_total|kv_cache_usage_perc|num_requests_running|spec_decode_num_(accepted|draft)_tokens" \
  | grep -v "^#"'
```
Prefix-cache hit rate = `hits / queries` — watch it go >0 after a prefix-caching boot.

**Live view (`bench/lib/monitor.py`):** zero-install (Python + rocm-smi), read-only. Polls
`/metrics` + rocm-smi every 2 s and shows live blocks (top→bottom) — what each shows is in
`python3 bench/lib/monitor.py --help` (usage + blocks):
- **GPU** — VRAM/GTT + 5 colored bars (GPU use / power / VRAM / edge temp / mem temp) + fan + clocks; green→yellow→red thresholds (red over 80/90 C)
- **cache/queue/spec** — KV %, prefix-cache hit % + cached-token counts, block hit %, spec acceptance % + draft-token counts, running/waiting (idle collapses to one line)
- **server** — cumulative since server start (title shows `up Xm, since HH:MM:SS`) (req, in/cached/comp/out tokens, TTFT, prefill/decode TPS, gap = inter-token latency, queue, full round-trip)
- **polls (requests)** — a live row (in-flight elapsed + progress tokens + GPU % + watts + KV %) above a separator, then one row per past poll that moved a request (newest first; idle rows dropped) (in/comp/out tokens, TTFT, prefill/decode TPS, full round-trip, KV %, GPU %)
- **avg (last 5 min)** — weighted-average TTFT/prefill/decode (TPS by *time*, TTFT by requests; ▲/▼ trend vs the previous poll) + the window's request count and comp/output token sums
- **log** — a tail of the loggers.py/metrics.py lines
vLLM-specific: the log TPS (loggers.py line) is the authoritative per-interval throughput; a stale
log (mtime > 120 s) is flagged, not shown. Prefill TPS is computed-token based so prefix-cached
prompt tokens are not counted. Values are colored green/yellow/red by threshold (e.g. KV > 90 %, power > 200 W, edge temp > 80 C, mem temp > 90 C).
In the polls rows, `in_tok` is the **total prompt size of all requests completed in that poll window** (not a rate) — a large value is a long-context/agentic request finishing, not a spike.
`--history N` sets the past request rows (default 15); `--out` appends one JSONL row per poll for a
chart (`bench/lib/report.py`). It is the "observe" half of the bench 3-task model (probe / monitor / report).
```bash
python3 bench/lib/monitor.py --port 8000 --out session.jsonl   # live, records the session
python3 bench/lib/monitor.py --port 8000 --once               # single snapshot
python3 bench/lib/monitor.py --port 8000 --history 50         # show 50 history rows
```

**Log:** `tail -f bench/.servers/8000.log` (like llama-swap `status`).

> The track's **plan**, **deviations from the Sly README quickstart**, and **known issues** moved
> to the vLLM knowledge base: `docs/vllm/` (workflows.md, settings.md, known-issues.md). This
> README is the tool doc (Layout / Models / Usage / Monitoring) only.
