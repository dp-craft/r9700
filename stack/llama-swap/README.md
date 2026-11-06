# Local coding-LLM stack for opencode (R9700 / gfx1201)

`llama-swap` routes an OpenAI-compatible endpoint to on-demand `llama-server` instances, each with
its own settings. opencode picks a model by name → llama-swap loads it (swapping out the previous
one so only one model sits in the 32 GB VRAM at a time).

```
opencode ──HTTP──> llama-swap :9292 ──spawns──> llama-server (Vulkan or ROCm) ──> GPU
```

## Files
- `generate.py` — **source of truth**. Edit the `MODELS` table, then `python3 generate.py`.
- `config.yaml` — GENERATED. Do not hand-edit (regenerate instead).
- `~/.config/systemd/user/llama-swap.service` — runs it on login (`-watch-config` = live reload).
- `~/.config/opencode/opencode.json` — provider `llama-swap` → `http://127.0.0.1:9292/v1`.

## Run it
Permanent (from your desktop/login session, where the user D-Bus exists):
```bash
systemctl --user enable --now llama-swap        # start + run on every login
loginctl enable-linger $USER                    # (optional) keep running without being logged in
```
Manual / fallback (no systemd session):
```bash
~/.local/bin/llama-swap -config ~/.config/llama-swap/config.yaml -listen :9292 -watch-config
```
> A manual instance is bound to `:9292` right now (`~/.config/llama-swap/logs/llama-swap.pid`).
> Stop it before enabling the systemd unit or the second one can't bind the port:
> `kill $(cat ~/.config/llama-swap/logs/llama-swap.pid)`

Use in opencode: `/models` → **llama-swap (R9700 local)** → pick a model. First request loads it
(20 GB gguf from the backup disk → allow ~30–70 s); later requests are instant until you switch.

## The roster (12 models → 31 entries + 2 rerankers)
Most Qwen models have a Vulkan entry (fast) and a `-rocm` twin so you can A/B backends.
Two exceptions:
- **Gemma is ROCm-only** (`gemma-31b-…-rocm`) — Vulkan/RADV device-losts at deep prefill and
  crashes the GUI, so no Vulkan entry exists for it.
- **Qwen3.8-27B is Vulkan-only**, and ships as **two** deliberately different rows (see below).

### Qwen3.8-27B — the two variants
Same gguf (`unsloth/Qwen3.8-27B-UD-Q4_K_XL`), same MTP, differing only in KV type and slot count.
Both are Vulkan and both split into `-coding` / `-planning` (the two recipes the official
[Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) card publishes — instruct and thinking).

| id | KV | ctx/conv | slots | VRAM | MTP acc. | decode |
|---|---|---|---|---|---|---|
| `qwen38-27b-q4kxl-ctx130k-mtp-…` | f16 | 133 120 | 1 | 27.5 GiB | 40.9 % | 33.0 tok/s |
| `qwen38-27b-q4kxl-np2-ctx130k-kvq8-mtp-…` | q8_0 | 133 120 | 2 | 29.6 GiB | 38.3 % | 31.1 tok/s |

All four verified end-to-end through opencode (glob → read → edit tool loop, streaming, clean).
**Do not raise the q8_0 row to 200k ctx**: that measured 31.84 GiB of a 31.86 GiB card and died
mid-stream under opencode. VRAM is not linear in `ctx × np` on this hybrid arch — the 48 SSM layers'
recurrent state scales with `np` and is *not* covered by `-ctk/-ctv`. Budget ~1.5 GiB per extra slot.

Per-model settings are **measured/sourced**, not guessed:
- **KV cache**: rule "Q5/Q6 → q8_0 (8-bit), smaller → f16 (16-bit)". **Gemma is the exception →
  q8_0 always** (its KV is ~5× heavier; f16 spills VRAM at depth).
- **MTP** (`--spec-type draft-mtp`) is on only where the gguf ships an `nextn` tensor (verified with
  `bench/gguf_kv.py`): ThinkingCap, the unsloth Qwen 27B/35B-A3B, Qwen3.8-27B. Off for Hauhau-35B
  and the rico03 27B finetune (0 nextn → nothing to draft).
- **MTP + q8_0 KV**: forbidden on the **Qwen3.6** line (measured: draft acceptance collapses to
  ~0.7% vs ~90% at f16) but **fine on Qwen3.8** (38–54% at q8_0 vs 41% at f16). Re-measure per arch
  rather than assuming either way.
- **ctx** sized under 32 GB at the chosen KV: dense-27B 131072 (KV 64 KiB/tok), MoE-35B 163840
  (KV 20 KiB/tok), gemma 131072. Change `ctx` in `generate.py` to trade VRAM ↔ depth.
- **Sampler** baked as the server default: Qwen = precise-coding `temp 0.6 / top_p 0.95 / top_k 20 /
  min_p 0` (campaign-best for code); Gemma = `temp 1.0 / top_p 0.95 / top_k 64`. No penalties.
- `--jinja` (required for opencode tool-calling) + `--reasoning-format deepseek` (surfaces `<think>`
  as `reasoning_content`).

## Change context size or add a model
Edit the row in `generate.py` (`ctx`, `kv`, `mtp`, or add a new tuple), run `python3 generate.py`,
and `-watch-config` reloads within ~2 s (a model already loaded reloads on its next request).
