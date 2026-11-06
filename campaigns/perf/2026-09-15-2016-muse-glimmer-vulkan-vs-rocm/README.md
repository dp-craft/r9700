# Muse-Glimmer-30B + DFlash — Vulkan vs ROCm through llama-swap

Backend comparison of **Muse-Glimmer-30B** (Meta) with its **DFlash block-diffusion drafter**,
served the way it will actually be served: through **llama-swap :9292**. The llama-swap model
definitions are otherwise identical, so backend and build are the only variables — which is exactly
why this campaign measures a **2×2 factorial**: {vulkan, rocm} × {b10969 upstream, stew675 fork}
(see Build design).

## Fixpoints (cite, don't re-derive)

| | value | provenance |
|---|---|---|
| target model | `unsloth/Muse-Glimmer-30B-UD-Q5_K_L.gguf` — 18.41 GiB, arch `muse-glimmer`, 52 attn layers | MEASURED (`gguf_kv.py`), file on disk |
| drafter | `unsloth/dflash-kquant.gguf` — 1.52 GiB, block-diffusion, 5 layers, block size 16 | models.yaml (2026-08-27) |
| spec decoding | `--spec-type draft-dflash --spec-draft-n-max 15 --spec-draft-p-min 0.4` — identical on both arms | llama-swap config; n_max 15 is a LOCAL choice (one below the 16-token block), p_min 0.4 IS measured (2026-08 sweep) |
| ctx / KV | 131072 (pinned to trained depth — RoPE cap, not VRAM) / f16, 52 KiB/tok, `--kv-unified` | MEASURED (`gguf_kv.py`) |
| tuning | `-ub 2048 -b 4096 -fa on -ngl 99`, temp 1.0 / top_p 0.95 / top_k 64 | llama-swap config (`common` macro + muse rows) |
| builds (2×2) | `b10969-{vulkan-system,rocm}` (upstream 391fac1) × `b790cf51aa-stew675-{vulkan-1.4.357.1,rocm}` (fork v16-r4: 67492c9 / b862fc3) | BUILD_INFO files |
| vendor reference | 74.9 → 233.4 tok/s (3.1×) with the drafter on an **RTX 5090** | CLAIMED (Muse-Glimmer model card / dev.meta.ai docs) — different GPU |

## Build design — 2×2 factorial

The llama-swap macros `${vulkan}` / `${rocm}` resolve to `build/latest-<backend>` symlinks, and the
two are promoted **independently** (as of 2026-09-15: latest-vulkan → b10969-vulkan-system,
latest-rocm → b790cf51aa-stew675-rocm). The original decision was a matched stew675 pair, but the
first vulkan pass ran on b10969 anyway (the symlink was never flipped; the config still uses the
macros) — so that data is kept and tagged **as-deployed**, and the campaign was expanded to the full
factorial:

| arm (`run.sh` label) | build | llama-swap model | status |
|---|---|---|---|
| `vulkan` | b10969-vulkan-system (391fac1) | …-dflash | ✅ measured 2026-09-15 (as-deployed) |
| `rocm` | b790cf51aa-stew675-rocm (b862fc3) | …-dflash-rocm | ✅ measured 2026-09-15 (as-deployed) |
| `rocm-b10969` | b10969-rocm (391fac1) | …-dflash-rocm | ⏳ pending |
| `vulkan-stew675` | b790cf51aa-stew675-vulkan-1.4.357.1 (67492c9) | …-dflash | ⏳ pending |

That yields both matched pairs (b10969 vk-vs-rocm; stew675 vk-vs-rocm) plus the per-backend build
effect. `run.sh` resolves each loaded server's binary (`readlink -f` on `GET /running`) and records
it in `meta.txt` per pass, warning if it is not the arm's expected build — so every row in
`results.jsonl` is attributable to a build (rule 2).

## Runbook (operator starts the backends; `run.sh` only probes)

Arms `vulkan` and `rocm` are **done** (2026-09-15, 20:33–21:01). Remaining: two arms, ~20–25 min
each plus load time. All results land in `bench/runs/2026-09-15-muse-glimmer-vulkan-vs-rocm/` —
append-only and resumable; each arm has its own slug prefix, so nothing overwrites the first pass.

**⚠ Loading either muse model UNLOADS whatever llama-swap currently serves** (32 GB card, no
co-residency). If a claude-cli / opencode session runs on the current model, it dies at that
moment and works again only after the final restore below.

### Arm C — `rocm-b10969`

```bash
ln -sfn /home/dev/work/dp-craft/amd/llamacpp/builds/b10969-rocm \
        /home/dev/work/dp-craft/amd/build/latest-rocm
curl -s "http://127.0.0.1:9292/unload"          # NOTE: GET — POST returns 405 (iron rule 14)
curl -sN --max-time 700 -X POST http://127.0.0.1:9292/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"muse-glimmer-30b-q5kl-f16-ctx128k-dflash-rocm","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
bash /home/dev/work/dp-craft/amd/campaigns/2026-09-15-muse-glimmer-vulkan-vs-rocm/run.sh rocm-b10969
ln -sfn /home/dev/work/dp-craft/amd/llamacpp/builds/b790cf51aa-stew675-rocm \
        /home/dev/work/dp-craft/amd/build/latest-rocm   # restore
```

### Arm D — `vulkan-stew675`

```bash
ln -sfn /home/dev/work/dp-craft/amd/llamacpp/builds/b790cf51aa-stew675-vulkan-1.4.357.1 \
        /home/dev/work/dp-craft/amd/build/latest-vulkan
curl -s "http://127.0.0.1:9292/unload"
curl -sN --max-time 700 -X POST http://127.0.0.1:9292/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"muse-glimmer-30b-q5kl-f16-ctx128k-dflash","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
bash /home/dev/work/dp-craft/amd/campaigns/2026-09-15-muse-glimmer-vulkan-vs-rocm/run.sh vulkan-stew675
ln -sfn /home/dev/work/dp-craft/amd/llamacpp/builds/b10969-vulkan-system \
        /home/dev/work/dp-craft/amd/build/latest-vulkan   # restore
```

A JSON completion = loaded + serving. Load failures (e.g. the build refusing the drafter graph)
show up in `curl --max-time 5 http://127.0.0.1:9292/logs/stream/<modelID>`. If `run.sh` prints a
build WARNING, do not trust that pass — fix the symlink and reload first.

### Final — reload your usual model

```bash
curl -s "http://127.0.0.1:9292/unload"
curl -sN --max-time 700 -X POST http://127.0.0.1:9292/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen38-27b-q4kxl-q8-mtp-ctx200000-kvq8-mtp-rocm-frog","messages":[{"role":"user","content":"ping"}],"max_tokens":8}'
```

## What is measured, and what this is NOT

- 2 backends × 4 depths {8192, 32768, 65536, 98304} — ≥4 points per iron rule 16 so the prefill
  decay can be fitted log-log per backend (exponent + R²), not read off one point.
- Per cell: cold prefill (`prefix_mode=unique` — uuid prefix defeats the cache), `max_tokens 512`,
  reps 2, **untimed warmup 1** (Vulkan compiles shaders on first prefill; without it rep 1 is
  contaminated). Output per depth: ttft / prefill t/s / decode t/s + a `gpu` row (peak VRAM/GTT/
  power from `vram_sampler.py`). Build identity comes from the resolved binary recorded in
  `meta.txt` per pass (`/props` was attempted but llama-swap's proxy does not return it).
- **NOT** the incremental agentic cache-reuse pattern (rule 17): this measures the backend compute
  shape at fixed cold depths. A shared-prefix follow-up is a one-knob re-run (`PREFIX_MODE=tail`).
- `n_max 15 vs 4` is deliberately out of scope (both arms identical); models.yaml flags it as an
  open question for a later campaign.

## Known risks

- **DFlash drafter loading is untested on two of the four builds** — b10969-rocm and
  stew675-vulkan (the first-pass arms loaded it clean on b10969-vulkan and stew675-rocm). The
  drafter-graph tensor count has bitten older builds before ("expected 81, got 58", models.yaml).
  If an arm fails to load, the failure is visible in the llama-swap log stream; that cell is then
  documented as not-measured — the other matched pair still stands.
- **R9700 Vulkan device-loss** (documented for Gemma deep prefill): if a probe hangs or the server
  dies mid-prefill, check `dmesg` / the log stream; that depth is quarantined (iron rule 18), not
  averaged in.

## Tooling note (iron rule 6)

`gen_campaign.py` cannot emit this campaign: its run.sh lifecycle is hardcoded to
`serve_llamacpp.sh` start/stop, and there is no "server provided by llama-swap" mode. The operator
chose manual starts, so `run.sh` here is the hand-written exception — ~40 lines of glue around the
standard per-probe runner (`bench/engine-bench/run.sh`), which does all the measuring. **Recommended
follow-up:** teach `gen_campaign.py` a `source: llama-swap` server mode (swap-in via a trigger
request, readiness poll on `GET /running`, teardown via `GET /unload`) so future campaigns of this
shape are spec → run.sh reproducible like the rest.
