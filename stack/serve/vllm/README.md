# vLLM docker track — Sly radiance first, any vLLM image later

Goal: a reproducible, docker-only vLLM setup for **Qwen3.8-27B on one R9700**, using RDNA4's fp8
WMMA through 4-bit **W4A8** checkpoints (4-bit weights, fp8 activations). Switching versions or
forks = a new image tag or a new `profiles/<engine>/` folder; nothing compiles on the host.

## Layout

| Where | What |
|---|---|
| `stack/serve/vllm/` (repo) | `serve_vllm.sh` launcher, `fetch_model.sh`, `profiles/<engine>/{_engine,<model>}.env` |
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
Every boot writes `stack/serve/var/servers/<port>.cmdline`: argv, image digest, model repo+revision, vLLM version.
While booting, a **VRAM watchdog** polls sysfs every 0.2 s and `docker kill`s the container if free
VRAM drops below `WATCHDOG_MIB` (default 256; the desktop shares the card — see `docs/guides/vllm/workflows.md`, A2).

## Monitoring

A live server exposes three data sources (no extra setup): vLLM `/metrics` (Prometheus), `amd-smi`,
and the log (`stack/serve/var/servers/<port>.log`).

**Quick check (one-liner):**
```bash
watch -n 2 'curl -s http://127.0.0.1:8000/metrics \
  | grep -E "prefix_cache_(hits|queries)_total|kv_cache_usage_perc|num_requests_running|spec_decode_num_(accepted|draft)_tokens" \
  | grep -v "^#"'
```
Prefix-cache hit rate = `hits / queries` — watch it go >0 after a prefix-caching boot.

**Live view (`stack/gpu/monitor.py`):** zero-install (Python + rocm-smi; on radiance also docker access), read-only. Polls
`/metrics` + rocm-smi every 2 s and shows live blocks (top→bottom) — what each shows is in
`python3 stack/gpu/monitor.py --help` (usage + blocks):
- **GPU** — VRAM/GTT + 5 colored bars (GPU use / power / VRAM / edge temp / mem temp) + fan + clocks; green→yellow→red thresholds (red over 80/90 C)
- **cache/queue/spec** — KV %, prefix-cache hit % + cached-token counts, block hit %, on radiance `recomputed` (tokens the attention cache held but no linear checkpoint let it skip, since server start; they count in `comp`), spec acceptance % + draft-token counts, running/waiting (idle collapses to one line)
- **server** — cumulative since server start (title shows `up Xm, since HH:MM:SS`) (req, in/cached/comp/out tokens, TTFT, prefill/decode TPS, gap = inter-token latency, queue, full = mean full round trip)
- **finished requests** — a live row (elapsed + progress tokens + GPU % + watts + KV %) above a separator, then one row per poll where a request finished (newest first; its earlier prefill work is folded in), on radiance one row per request (in/comp/out tokens, TTFT, prefill/decode TPS, full round-trip, KV %, GPU %)
- **avg (last 5 min)** — weighted-average TTFT/prefill/decode (TPS by *time*, TTFT by requests; ▲/▼ trend vs the previous poll) + the window's request count and comp/output token sums
- **log** — a tail of the loggers.py/metrics.py lines; on radiance the last 5 `docker logs` lines
vLLM-specific: the log TPS (loggers.py line) is the authoritative per-interval throughput; a stale
log (mtime > 120 s) is flagged, not shown. Prefill TPS is computed-token based so prefix-cached
prompt tokens are not counted. Values are colored green/yellow/red by threshold (e.g. KV > 90 %, power > 200 W, edge temp > 80 C, mem temp > 90 C).
`full(s)` is the full round trip, request start to last token (TTFT + decode; TTFT already contains prefill). `KV(%)` (KV cache usage, retained prefix cache included) and `GPU(%)` are sampled at the poll's end, not over the request. In these rows, `in` is the **total prompt size of all requests completed in that poll window** (not a rate) — a large value is a long-context/agentic request finishing, not a spike.
**radiance rows come from Docker:** each poll reads the `I req ... done` lines of `docker logs --tail 200 radiance-<port>` (`--container` overrides the name), because per-poll counters cannot give per-request prefill: computed tokens tick when a chunk is issued (~2 ms) and its time when the chunk commits, which showed up as rates near 1M t/s. Here `comp` = prompt − cache and prefill = `comp` / TTFT, with no decode time in it, as each request's first token comes from its last prefill step. Requests waiting behind another one read low, as TTFT includes the wait. If `docker logs` fails, the rows fall back to per poll with `comp`/prefill `n/a`, there is no log block, and the block title says so. `--log` is not read on radiance, which writes neither that file nor the loggers.py lines, so the session JSONL `log_*` values are null there. The server line and 5-min average stay on the counters, which add up correctly over longer windows; the session JSONL has `prefill_tps: null` per poll on radiance and a `requests` list instead.
`--history N` sets the past request rows (default 15); `--out` appends one JSONL row per poll.
It is the "observe" half of the bench 3-task model (probe / monitor / report).
```bash
python3 stack/gpu/monitor.py --port 8000 --out session.jsonl   # live, records the session
python3 stack/gpu/monitor.py --port 8000 --once               # single snapshot
python3 stack/gpu/monitor.py --port 8000 --history 50         # show 50 history rows
```

**Log:** `tail -f stack/serve/var/servers/8000.log` (like llama-swap `status`).

> The track's **plan**, **deviations from the Sly README quickstart**, and **known issues** moved
> to the vLLM knowledge base: `docs/guides/vllm/` (workflows.md, settings.md, known-issues.md). This
> README is the tool doc (Layout / Models / Usage / Monitoring) only.
