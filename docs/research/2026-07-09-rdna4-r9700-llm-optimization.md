# RDNA4 / Radeon AI PRO R9700 — lokális LLM optimalizáció (kódolásra)

- **Dátum:** 2026-07-09
- **Gép:** Ryzen 5 3600, AMD Radeon AI PRO R9700 (RDNA4, **gfx1201**, 32 GB), Ubuntu 24.04, kernel 6.17
- **Cél:** a legerősebb *kódoló* modell futtatása, 27–35B (A3B MoE), 4–5 bites kvantálás, **minimum 100K kontextus 32 GB VRAM-ban**. Képfeldolgozás nem cél.
- **Kontextus:** a kártya ROCm alatt korábban „nem látszott"; a Vulkan működött. Ezt megoldottuk (lásd lent), majd runtime-optimalizációt és modellválasztást vizsgáltunk.

---

## 1. Vezetői összefoglaló

1. **A ROCm most működik gfx1201-en** — az ollamába hiányzó ROCm backend (`rocm_v7_2`, ROCm 7.2, gfx1201 kernelekkel) telepítésével. Bizonyítottan gyorsul: Qwen3-Coder-30B-A3B **~66 tok/s decode** 100K kontextussal.
2. **A korábbi `segmentation fault` nem gfx1201-hiba volt, hanem VRAM-kontenció** több párhuzamosan futó ollama-instance között. Egyetlen instance mellett ugyanaz a modell stabilan betölt.
3. **Fontos hardver-korrekció:** az RDNA4 natív alacsony-precíziós gyorsítása **FP8 (E4M3), NEM FP4.** A gfx1201-nek nincs natív FP4 WMMA utasítása.
4. **A te kereted (35B-A3B + 100K + 32 GB) memóriakorlátos**, nem compute-korlátos → a **Q4-osztályú GGUF nem kompromisszum, hanem az optimum.** Az FP8-súlyok (~1 bájt/param) nem férnek be 100K kontextussal.
5. **Legerősebb kódoló a kereten belül:** Qwen3-Coder-30B-A3B-Instruct (dedikált coder MoE) és a Qwen3.6-35B-A3B (base, 73.4% SWE-bench Verified). A gyorsítás fő tartaléka az **MTP** (multi-token prediction, 1.4–2.2×), amit viszont **csak közvetlen llama.cpp** tud, az ollama nem.

---

## 2. Hardver: R9700 / gfx1201 / RDNA4

`rocminfo` szerint: gfx1201, 64 CU, 2 SIMD/CU, 2350 MHz, L3 64 MB, 32 GB VRAM (31.9 GiB használható), `amdgcn-amd-amdhsa--gfx1201`. Rendszer-ROCm: **7.13 pre-release, kifejezetten gfx120x-re** (`amdrocm-core7.13-gfx120x`, `librocblas.so.5`); a `rocblas/library/`-ben ott a `gfx1201` Tensile.

### 2.1 FP8, nem FP4 (gyakori tévhit)
- Az RDNA4 WMMA (Wave Matrix Multiply-Accumulate) utasításai **FP8 E4M3**-at gyorsítanak hardveresen (azonos formátum, mint az MI350X). 
- **FP4/MXFP4 NEM képződik le natív WMMA-ra gfx1201-en** — csak memóriát spórol, a szorzást FP16-ra dekvantálva végzi.
- Következmény: a „chip szintű 4-bit kihasználása" ezen a kártyán jelenleg **nem elérhető cél**; a hardveres nyereség útja az **FP8**.

### 2.2 A te kereted memóriakorlátos → Q4 az optimum
32 GB-ban, 100K kontextussal, 27–35B modellnél a szűk keresztmetszet a VRAM, nem a számítás. KV-cache becslés (both K+V):

| Modell | Súly (Q4_K_M) | KV 100K @ FP16 | KV 100K @ q8_0 | Elfér 32 GB-ban? |
|---|---|---|---|---|
| Qwen3-Coder-30B-A3B (MoE, 4 KV-head) | ~18.5 GB | ~9.4 GB | ~4.7 GB | ✅ ~24 GB (akár ~160K) |
| Qwen3.6-35B-A3B (MoE) | ~22 GB | ~9–10 GB | ~5 GB | ✅ ~27 GB |
| Qwen2.5-Coder-32B (**dense**, 8 KV-head) | ~19 GB | ~25 GB | ~12.5 GB | ⚠️ csak q4 KV-vel, jobb ≤48K |
| bármely 30B+ **FP8** | ~30–35 GB | — | — | ❌ nincs hely kontextusra |

**Tanulság:** hosszú kontextushoz az **A3B MoE** (kevés KV-head) a nyerő; a dense 32B a 100K-nál elvérzik. FP8 ezen a méreten/kontextuson nem opció egy 32 GB-os kártyán.

---

## 3. A ROCm-beállítás, ami megoldotta a „nem látszik" problémát

**Ok:** az ollama telepítésből hiányzott a ROCm runner — a `/usr/local/lib/ollama` alatt csak `cuda_v12/13` + `vulkan` volt, `rocm_*` nem. Az install script nem húzta le a ROCm bundle-t.

**Megoldás:** az ollama 0.31.2 hivatalos `ollama-linux-amd64-rocm.tar.zst` csomagjából a `rocm_v7_2` mappa kibontása:
```bash
sudo tar --use-compress-program=unzstd -C /usr/local \
  -xf ollama-linux-amd64-rocm.tar.zst lib/ollama/rocm_v7_2
sudo systemctl restart ollama
```
A bundle **ROCm 7.2 alapú, önálló** (saját `libamdhip64.so.7`, `librocblas.so.5`, `libhipblas.so.3`, `libggml-hip.so`), és **56 db gfx1201 kernelt** tartalmaz (`TensileLibrary_lazy_gfx1201.dat` + fallback kernelek). Nem ütközik a rendszer 7.13-preview ROCm-jével.

Ellenőrzött működés: `library=ROCm compute=gfx1201 name=ROCm0`, teljes és részleges offload, flash attention, 100K kontextus — mind stabil.

---

## 4. A `segmentation fault` valódi oka

A crash **intermittens** volt és **VRAM-kontenció** okozta: több ollama-instance futott egyszerre (systemd service + kézi `bip`-féle `ollama serve` + teszt-szerverek), amelyek megették a VRAM-ot. Amikor egy ~20 GB-os modell betöltésekor már csak ~13 GB volt szabad, a runner kecses fallback helyett elszállt. Egyetlen instance mellett ugyanaz a modell (Qwen3.6-27B-MTP, 100K kontextus, q8 KV, FA) hibátlanul betölt és generál.

**Tanulságok / higiénia:**
- Egyetlen ollama-instance fusson (a duplikált systemd + kézi indítás portütközést és VRAM-versengést okoz).
- `OLLAMA_MAX_LOADED_MODELS=1` — ne töltsön be 2. modellt egyszerre.
- Kódra nincs szükség a `--mmproj`-ra (multimodális vetítő) — feleslegesen fogyaszt.

---

## 5. Runtime-mezőny gfx1201-en

| Runtime | Formátum | gfx1201 státusz | MTP | Megjegyzés |
|---|---|---|---|---|
| **ollama** (rocm_v7_2) | GGUF Q4/Q5 | ✅ stabil, telepítve | ❌ nincs `--spec-type mtp` a bundled runnerben | Kényelmes, model-menedzsment, OpenAI-API |
| **llama.cpp** (lemonade gfx120X build) | GGUF Q4/Q5 | ✅ előre fordított bináris (b1294) | ✅ `--spec-type mtp` | OpenAI-kompatibilis `llama-server`; MTP nyereség |
| **vLLM** | FP8 / AWQ-INT4 / GGUF | ⚠️ kísérleti; FP8 kernel gfx1201-re csak 2026 áprilisában kezdett landolni (tp=2-re hangolva); egy kártyán silent FP32 fallback előfordul | n/a | FP8 35B **nem fér** 32 GB-ba; INT4-AWQ igen, de nem HW-gyorsított |
| **unsloth** | safetensors (+torch-ROCm) | ⚠️ elsősorban finomhangolás; ROCm/RDNA4 támogatás korlátozott | tréning | Ebben a környezetben a súlyok HF-ről jönnének (blokkolt) |

Az ollama csomagolt `llama-server`-e tud generic speculative decodingot (draft-modellel, `--spec-draft-*`), de **nem** natív MTP-t.

---

## 6. MTP (Multi-Token Prediction)

- 2026. május 16-án merge-elték a llama.cpp-be (PR #22673). A modell saját MTP-fejeiből draftol, külön draft-modell nélkül; a tokeneket verifikáció után fogadja el → **pontosságvesztés nélkül 1.4–2.2× decode-gyorsulás**.
- Tesztelt modellek: **Qwen3.6-27B** és **Qwen3.6-35B-A3B**.
- Használat (közvetlen `llama-server`): `--spec-type mtp --spec-draft-n-max 3`.
- **Az ollama jelenleg nem támogatja** → MTP-hez a lemonade gfx120X llama.cpp build kell.

---

## 7. Modell-mezőny kódolásra (a 32 GB / 100K kereten belül)

- **Qwen3.6-35B-A3B (base):** MoE, 3B aktív, Apache 2.0, **73.4% SWE-bench Verified** (veri a Gemma4-31B-t: 52.0, és a Qwen3.5-öt), natív 256K (max ~1M) kontextus. Nincs külön „Coder" 35B-A3B — a base a kódoló csúcs ebben a méretben. MTP-változat elérhető.
- **Qwen3-Coder-30B-A3B-Instruct:** dedikált coder MoE, agentic/repo-szintű kódolásra hangolva, natív 256K kontextus. Kiváló sebesség/minőség.
- **Qwen2.5-Coder-32B-Instruct:** dense, elit FIM/autocomplete; 100K-nál szűkös.
- **Tesztre érdemes még:** Devstral-Small-2 (24B, agentic), GLM-4.5-Air/4.6, gpt-oss-20b (MXFP4 — gyors, de a 4-bit itt csak memória). Kimi K2.6 a csúcs, de mérete miatt nem fér 32 GB-ba.

### HuggingFace népszerűség (GGUF, letöltés/like, 2026-07-09)
| Repo | Letöltés | Like |
|---|---|---|
| unsloth/Qwen3.6-27B-MTP-GGUF | 2 894 918 | 1022 |
| unsloth/Qwen3.6-35B-A3B-GGUF | 868 551 | 1336 |
| unsloth/Qwen3.6-35B-A3B-MTP-GGUF | 760 121 | 674 |
| lmstudio-community/Qwen3.6-35B-A3B-GGUF | 323 430 | 24 |
| unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF | 272 872 | 785 |
| bartowski/Qwen_Qwen3.6-35B-A3B-GGUF | 120 246 | 127 |
| Jackrong/Qwopus3.6-35B-A3B-v1-GGUF (coding merge) | 74 299 | 215 |

**Legkedveltebb/legtöbbet letöltött:** `unsloth/Qwen3.6-35B-A3B-GGUF` (és MTP-változata). Kvant-ajánlás a 32 GB / 100K kerethez: **UD-Q4_K_XL** (unsloth dinamikus) vagy Q4_K_M.

---

## 8. Ajánlott konfiguráció

**Ollama (kényelem, stabil):** egyetlen instance, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_CONTEXT_LENGTH=102400`, `OLLAMA_MAX_LOADED_MODELS=1`. Modell: Qwen3-Coder-30B-A3B (Q4_K_M) kódra.

**llama.cpp (max sebesség, MTP):** lemonade gfx120X build, `llama-server --flash-attn on -c 102400 --cache-type-k q8_0 --cache-type-v q8_0 --spec-type mtp --spec-draft-n-max 3`, modell: Qwen3.6-35B-A3B-MTP vagy 27B-MTP.

---

## 9. Környezeti korlátok (a reprodukálhatósághoz)

- **HuggingFace blokkolva:** `hf.co` → 0.0.0.0, a HF CDN (`us.aws.cdn.hf.co`, `cdn-lfs.*`) elérhetetlen → **új modell nem tölthető le**. Elérhető: GitHub, PyPI, Docker Hub, download.pytorch.org, ollama.com. Emiatt a benchmark a már letöltött GGUF-okon fut, a vLLM/unsloth FP8/safetensors súlyai nem szerezhetők be.
- **Tárhely/jogosultság:** a modell-store a nagy lemezen van (`/mnt/wwn-...-part3`, 286 GB szabad), `dev` userként a mount-pont `o+x` traverzálással érhető el.
- **Sudo** jelszót kér (nem-interaktív telepítés korlátozott).

---

## 10. Források
- FP4/FP8 RDNA4: https://zolotukhin.ai/blog/2026-05-09-the-fp4-wave-breaks-at-rdna4-and-fp8-wmma-already-does-what-local-qwen3-needs/
- vLLM gfx1201 FP8 patch: https://github.com/vllm-project/vllm/issues/28649 ; TP=2 deadlock: https://github.com/vllm-project/vllm/issues/40980 ; container bug: https://github.com/vllm-project/vllm/issues/40081
- TransformerEngine gfx1201 FP8 fallback: https://github.com/ROCm/TransformerEngine/issues/520
- ollama gfx1201 crash-osztály: https://github.com/ollama/ollama/issues/15338 , https://github.com/ollama/ollama/issues/13236
- rocBLAS gfx1201 Tensile: https://github.com/ROCm/rocm-libraries/issues/7192
- llama.cpp MTP PR: https://github.com/ggml-org/llama.cpp/pull/22673
- Prebuilt gfx120X llama.cpp: https://github.com/lemonade-sdk/llamacpp-rocm
- Qwen3.6-35B-A3B (73.4 SWE-bench): https://huggingface.co/Qwen/Qwen3.6-35B-A3B ; coding review: https://pub.towardsai.net/i-tested-alibaba-qwen3-6-35b-a3b-30cc4658a382
- Legjobb lokális kódoló modellek 2026: https://insiderllm.com/guides/best-local-coding-models-2026/
