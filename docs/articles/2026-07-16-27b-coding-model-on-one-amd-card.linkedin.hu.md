70 tok/s decode egy dense 27B coding modellen, egyetlen 32GB-os AMD kártyán, 100% feladatpontossággal.

A Qwen3.6-27B-t (Q4_K_M) llama.cpp Vulkan alatt futtattuk egy AMD Radeon AI PRO R9700 kártyán (RDNA4, gfx1201). NVIDIA nélkül, multi-GPU nélkül, sima ROCm 7.x telepítéssel.

A meglepő rész: az MTP (multi-token prediction, a llama.cpp beépített speculative decode-ja) itt nem sebesség/minőség trade-off. Egyszerűen ingyen van.

Azonos kontextus, azonos sampling, azonos reasoning-budget cap, két GGUF build:

MTP off: 31 tok/s decode, 100% pontosság, judge score 4.56/5
MTP on: 70 tok/s decode, 100% pontosság, judge score 4.83/5

Ez 2.25x decode-sebesség, nulla pontossági költséggel, és a teljes sweep legjobb minőségi pontszámával. Ára: kb. 1.6 GiB plusz VRAM. Egy 32 GB-os kártyához képest ez semmi. A csúcshasználat 21 GiB alatt maradt, spill és throttling nélkül.

A másik ellopni való lever: a gondolkodási budget megkötése (--reasoning-budget) 40-55%-kal csökkentette a token- és latency-költséget, nulla pontossági veszteséggel, és a runaway generálásokat (amikor a modell a token-plafonig gondolkodik válasz nélkül) 7.1%-ról 0%-ra vitte.

Egy fenntartás, amit nem söprünk a szőnyeg alá: ez reps=1, sekély, ~50-100 tokenes promptokon. A valódi agentic kontextus (10-50K token) a következő teszt.

Ajánlott kiindulópont: MTP on, --reasoning-budget 2048 valós terheléshez, KV cache f16, ctx 32768.

[teljes cikk ↓ / link a hozzászólásokban]

#LocalLLM #AMD #ROCm #LLMInference #AIEngineering
