<!-- meta
date: 2026-07-09
takeaway: 100K context, ROCm. Qwen3-Coder-30B-A3B Q4_K_M ~90 tok/s decode; ollama prefill ~2× llama.cpp (rocBLAS vs hipBLASLt); MTP +1.29–1.55× decode.
-->

# Runtime-benchmark — R9700 (gfx1201) kódoló modellek, 100K kontextus

- **Dátum:** 2026-07-09
- **Kártya:** AMD Radeon AI PRO R9700 (RDNA4, gfx1201, 32 GB), Ubuntu 24.04
- **Közös beállítás:** 100K kontextus (`-c 102400`), flash attention **on**, KV-cache **q8_0** (K+V), teljes GPU-offload (`-ngl 99`).
- **Mérés:** decode = rövid coding-prompt, 256 token; prefill = ~3.6K tokenes prompt (valós prompt-feldolgozás). `temperature=0.2`. Minden ROCm-en (nem Vulkan).

## Fő eredmények — prefill / decode (tok/s)

| Modell (Q4) | Arch | ollama (ROCm 7.2) | llama.cpp (b1294, HIP 7.14) | llama.cpp + MTP |
|---|---|---|---|---|
| **Qwen3-Coder-30B-A3B-Instruct** | MoE 3.3B akt. | 2526 / **81.4** | 1112 / **89.9** | — (nincs MTP-fej) |
| **Qwen3.6-35B-A3B** (Uncensored) | MoE 3B akt. | 2716 / 64.4 | 436 / 64.0 | — |
| **Qwen3.6-27B-MTP** | dense-szerű + MTP | 880 / 25.4 | 393 / 26.2 | 361 / **40.8** ¹ |
| **Qwen3.6-35B-A3B-MTP (Q4_K_M)** | MoE + MTP | — | 194 / 75.0 | 105 / **96.5** ² |

² **A 35B-A3B-MTP a sima `Q4_K_M` quanttal stabilan kiszolgál**, és **MTP-vel 75.0 → 96.5 tok/s (1.29×)**, draft-elfogadás 135/190 (71%) — **ez a leggyorsabb decode az összes mérés közül.** (A `UD-Q4_K_XL` mixed-quant változat viszont betölt VRAM-ba, de a b1294 llama-server init-je vele megbízhatatlan volt — a sima Q4_K_M a megoldás.) A prefill itt alacsony a hipBLASLt build + kis `-ub 512` miatt (lásd 2. pont).

¹ MTP `-ub 512`-vel: **40.8 tok/s (1.55×)**, draft-elfogadás 176/235 (75%). `-ub 2048`-cal csak 30.4 → **az MTP kis ubatch-csal a leggyorsabb** (tuning-érzékeny).

## Értelmezés

1. **Tiszta decode-ban ollama ≈ llama.cpp.** A korábbi „ollama lassabb" látszat a `OLLAMA_DEBUG=1` logolás overheadje volt; kikapcsolva az ollama 30B-Coder decode **66→81 tok/s**-re ugrott. A llama.cpp minimálisan gyorsabb (89.9 vs 81.4 a 30B-Coderen).
2. **Prefillben az ollama ~2× gyorsabb** (30B-Coder: 2526 vs 1112). **Miért, ha ugyanaz a ggml-kód?** Kimértük:
   - **Nem a batch:** a llama.cpp `-ub` sweep lapos — ub512: 1082, ub1024: 1227, ub2048: 1210 tok/s. Azonos ub=1024 mellett is ollama 2526 vs llama.cpp 1227.
   - **A build/BLAS okozza:** a **decode memóriakorlátos (GEMV)** → a két build ott ~egyforma (81 vs 90). A **prefill nagy mátrixszorzás (GEMM)**, ami a **fordított BLAS-kernelen múlik**. Az ollama `rocm_v7_2` a **ROCm 7.2 rocBLAS**-t csomagolja (gfx1201-re jól hangolt Tensile-kernelekkel), a lemonade b1294 build a **hipBLASLt**-et — utóbbi gfx1201 GEMM-je ~2× lassabb ezen a promptméreten. Ugyanaz az *algoritmus*, más a *fordított GEMM-kernel*. Nagy kód-kontextus (repo-beolvasás) esetén ezért érdemi ollama-előny a prefill.
3. **MTP valós nyereség 1.55×** (27B-MTP), de **csak llama.cpp** (`--spec-type draft-mtp`), az ollama nem tudja.
4. **Az A3B MoE a legfontosabb sebességtényező:** a 30B-Coder-A3B (81–90 t/s) és a 35B-A3B (64 t/s) is gyorsabb, mint a 27B-MTP MTP-vel (40.8). Kódra a **Qwen3-Coder-30B-A3B** egyszerre a leggyorsabb és a legjobb kódoló.
5. **VRAM (100K, q8 KV):** 30B-Coder ~23 GB, 35B-A3B ~27 GB — mind befér 32 GB-ba. A 35B-MTP (UD-Q4_K_XL, 22.9 GB) 100K-n `-fit off` kellett és lassan tölt (mixed-quant + MTP tensorok).

## vLLM — azonos modellekkel (GGUF) + FP8

- **Státusz: nem futott le — infrastruktúra-blokk (docker/containerd a kis root fs-en).** A ROCm-vLLM kizárólag docker image-ként érhető el (~40 GB; a pip-wheel CUDA-only, a source-build a hiányzó rocblas/hipblas dev-headerek miatt bukik). A pull **háromszor telítette a root fs-t** (~95%-ig tele alapból, csak ~7 GB szabad):
  1. Először a docker `data-root` csak symlinkkel volt a nagy lemezen → a staging a root fs-re esett.
  2. `data-root` + `TMPDIR` explicit átállítás a nagy lemezre (root) — az **`alpine` próbapull jó lett**, de a nagy `rocm/vllm` pull **47 GB deleted-open fájlt** írt a root fs-re: a **containerd content-store (`/var/lib/containerd`) külön a root fs-en van**, és ezt sem a data-root, sem a TMPDIR nem fedi.
- **Megoldás, ha valaki tényleg akarja:** a **containerd root/state** áthelyezése a nagy lemezre (pl. `/etc/containerd/config.toml`-ben `root=`/`state=`, vagy a dockerd bundled-containerd konfigja), majd `systemctl restart containerd docker` — mélyebb, root-szintű lépés.
- **A torch-ROCm 7.2 alap működik** gfx1201-en (lásd unsloth), tehát a vLLM image jó eséllyel elindulna a containerd-fix után.
- **Modell-illeszkedés:** 35B **FP8** (~35 GB) **nem fér** 32 GB-ba; **27B FP8 (~27 GB) igen** (100K-ra szűkös). A natív FP8-kernel gfx1201-en kísérleti (2026-áprilisi merge-ek tp=2-re hangolva), egy kártyán silent FP32 fallback előfordulhat.
- **Értékelés:** a te kereteden (35B, 100K, 32 GB) a vLLM hozadéka marginális — a **llama.cpp/ollama GGUF-út a gyakorlati nyerő** (a 35B-A3B-MTP-vel 96.5 tok/s). A vLLM-et akkor érdemes elővenni, ha OpenAI-kompatibilis, nagy-áteresztőképességű, sok párhuzamos kérést kiszolgáló szerver kell — és inkább 2× R9700-zal (tp=2 FP8).

## unsloth / PyTorch — azonos modellekkel (gfx1201)

**Környezet, ami működik gfx1201-en:** torch **2.13.0+rocm7.2** + `HSA_OVERRIDE_GFX_VERSION=12.0.1` + **torchvision/torchaudio +rocm7.2** (a pip alapból CUDA-buildet tesz fel → `torchvision::nms` hiba; a rocm7.2 wheel javítja). A HIP látja a kártyát: `AMD Radeon AI PRO R9700, 31.86 GB, ROCm 7.2, Triton 3.7.1, Bfloat16=TRUE`.

| Út | gfx1201 státusz | Sebesség (Qwen2.5-1.5B, 4bit) |
|---|---|---|
| **transformers + bitsandbytes 4bit** (eager attn) | ✅ **működik** | **25.6 tok/s** decode |
| **unsloth FastLanguageModel** (optimalizált) | ❌ **generálás crashel** | — |

- Az **unsloth optimalizált inference-útja törött gfx1201-en**: `RuntimeError: output with shape [1,12,1,128] doesn't match broadcast [1,12,N,128]` a KV-cache decode lépésnél — az unsloth CUDA-központú fast-attention/RoPE patch-e nem kezeli helyesen az RDNA4-et. A modell **betölt** (a kártyát felismeri), de a `generate()` elszáll. Az FA2 „broken → Xformers", de az xformers-út is a fenti hibára fut.
- A **sima transformers + bnb-4bit út viszont megy** — ez a lényegi „4-bites PyTorch-inferencia RDNA4-en". Fontos korlát: HF `generate()`, **nincs continuous batching/paged attention** → throughputban nem versenyképes a llama.cpp/ollama-val (a GGUF-út lényegesen gyorsabb és memóriahatékonyabb).
- **A te 30B/35B modelljeidhez:** nincs kész bnb-4bit repo → a teljes BF16 (~60 GB) letöltése + on-the-fly kvantálás kellene; a végeredmény a fentiek alapján is lassabb lenne, mint a GGUF. **Következtetés: a PyTorch/unsloth-út RDNA4-en jelenleg finomhangolásra/kísérletezésre jó, éles inference-re a GGUF (llama.cpp/ollama) a helyes választás.**

## Ajánlás (kódolásra, R9700)

- **Max sebesség / napi:** llama.cpp (lemonade gfx120X build) `llama-server`, **Qwen3-Coder-30B-A3B Q4_K_M**, `--flash-attn on -c 102400 -ctk q8_0 -ctv q8_0 -ngl 99` → ~90 tok/s, OpenAI-API.
- **Nagy kontextus beolvasás gyakori:** ollama (jóval gyorsabb prefill), ugyanaz a modell, egyetlen instance, `OLLAMA_MAX_LOADED_MODELS=1`.
- **MTP-gyorsítás:** Qwen3.6-*-MTP + llama.cpp `--spec-type draft-mtp --spec-draft-n-max 3`, **kis `-ub` (512)**.

## Környezet / módszertan
- Modellek: a helyi ollama-store GGUF-jai (HF-blokk feloldva → a 35B-MTP GGUF letöltve). A HauhauCS 35B egy „uncensored" finomhangolás — sebességre reprezentatív, kódminőségre a hivatalos base (73.4% SWE-bench) a mérvadó.
- Benchmark scriptek: `bench/*.sh`, `/home/dev/work2/amd-bench/*`; nyers adat: `bench/*.jsonl`, `work2/amd-bench/matrix_results.jsonl`.
- llama.cpp build: `lemonade-sdk/llamacpp-rocm` b1294 gfx120X (HIP 7.14, saját hipBLASLt) — **ROCm backend igazolva** a logban (`ROCm0: AMD Radeon AI PRO R9700`).
