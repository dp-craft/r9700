# Egy 27B-s kódoló modell, egy AMD kártya, és a beállítás, ami ingyen ad 2.25x sebességet

A helyi inferencia egy sűrű (dense) 27B-s kódoló modellen nem igényel NVIDIA kártyát
vagy több GPU-s rendszert. Egyetlen 32 GB-os AMD Radeon AI PRO R9700 (RDNA4) kártyán
futtattuk a Qwen3.6-27B (Q4_K_M) modellt a llama.cpp Vulkan backendjén, és találtunk
egy build-kombinációt, amely 70 tok/s decode sebességet ad 100%-os feladat-pontosság
mellett, úgy, hogy a kártya VRAM-jának több mint fele még mindig szabad marad. Az
ehhez vezető beállítás semmibe nem kerül: egy build-választás (MTP), nem minőségi
kompromisszum.

## A gép

- GPU: AMD Radeon AI PRO R9700 -- RDNA4, gfx1201, 32 GB (~31.86 GiB használható)
- Szoftverkörnyezet: ROCm 7.x, `HSA_OVERRIDE_GFX_VERSION=12.0.1`, Ubuntu 24.04, kernel 6.17
- Runtime: llama.cpp, Vulkan backend, build b9950
- Modell: Qwen3.6-27B, Q4_K_M (dense, nem MoE)
- Alapbeállítás: KV cache f16, `-ub 2048 -b 4096 -fa on`, context 32768, single-stream

Semmi egzotikum. Ez egy egyetlen fogyasztói/workstation-kategóriás AMD kártya, gyári
ROCm 7.x telepítéssel, amely egy valódi, sűrű 27B-s kódoló modellt futtat használható
átviteli sebességgel. Az a feltételezés, hogy "az AMD nem képes komoly helyi
LLM-inferenciára", itt nem állja meg a helyét.

## Az eredmény: az MTP tiszta nyereség, nem kompromisszum

Ugyanannak a modellnek két GGUF buildjét teszteltük azonos kvantálással, azonos
kontextussal, azonos samplinggal: az egyiknél az MTP (multi-token prediction -- a
llama.cpp beépített speculative decode-ja, ahol a draft tokeneket ugyanabban a
menetben generálja és ellenőrzi) ki volt kapcsolva, a másiknál be. Minden más az
alapbeállításban rögzítve maradt.

| Build | MTP | reasoning-budget | decode tok/s | determinisztikus pontosság | judge pontszám /5 |
|---|---|---:|---:|---:|---:|
| jackrong | off | 1024 | 31.1 | 100% | 4.56 |
| unsloth  | on  | 1024 | **70.3** | 100% | **4.83** |

Ugyanaz a pontosság. Ugyanaz a büdzsé. Az MTP build **2.25x**-es sebességgel
decode-ol (70 vs 31 tok/s), és ez adta a legjobb judge pontszámot a teljes
sweepben. Az azonos büdzsén belüli összevetésben az MTP be- vs kikapcsolása nulla
pontosságba került, 0.1-0.2 ponttal növelte a judge pontszámot, és gyakorlatilag
semmit nem tett hozzá a tokenszámhoz. A sebességnek nincs minőségi ára. Ez a
kombináció -- nagyobb sebesség, azonos vagy jobb minőség, ugyanazon a 27 GiB-os
kategóriájú kártyán -- önmagában is elég ritka ahhoz, hogy külön kiemeljük.

Az MTP bekapcsolásának ára: kb. 1.6 GiB plusz VRAM a draft rétegnek és puffereknek,
és nagyjából duplájára nő a GTT host-staging forgalom. Egy 32 GB-os kártyához
képest mindkettő elhanyagolható. A VRAM csúcsértéke 18.7 GiB volt (MTP kikapcsolva)
és 20.7 GiB (MTP bekapcsolva) -- mindvégig több mint 11 GiB szabad maradt, nem volt
spill a rendszermemóriába, és nem volt hőmérsékleti throttling (átlagos
teljesítményfelvétel 294-299 W a futások során).

![Reasoning-budget sweep: quality holds flat while cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)
<!-- LinkedIn does not render inline SVG. Export reasoning_budget_sweep.svg to PNG before posting. -->

## A hangolás haszna: korlátozd a gondolkodási büdzsét

Az MTP sebességet vásárol neked. A `--reasoning-budget` (kemény felső korlát arra,
hány gondolkodási tokent költhet a modell, mielőtt válaszolnia kell) gazdaságosságot
vásárol, és ezen a gépen ez majdnem ingyen ebéd volt: a determinisztikus pontosság
minden tesztelt korlátozott büdzsénél (512-től felfelé) 100% maradt, mindkét
buildnél. A büdzsé csökkentése 40-55%-kal csökkentette a tokenszámot és a
latenciát, nulla pontosságvesztés mellett. Ezzel szemben a korlátlan futásoknál
7.1%-os runaway (elszabadulási) arányt mértünk -- minden tizennegyedik feladat
végigmegy gondolkodva a 8192-tokenes plafonig, és soha nem válaszol. Minden
korlátozott konfigurációnál 0%-os volt a runaway arány.

A minőség a korlátozott tartományban egy fennsík, nem egy lejtő: 512-től 1024-ig
emelkedik, majd ellaposodik, és enyhén csökken 1024-től 2048-on át a korlátlanig.
A legjobb mért judge pontszám ~1024 tokennél volt (4.83, MTP bekapcsolva).

## Hogyan alkalmazd

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

Az `1024` a legolcsóbb pont a biztonságos fennsíkon az általunk tesztelt sekély
feladatoknál: 100% determinisztikus pontosság, csúcskategóriás judge minőség, 0%
runaway, ~70 tok/s decode, time-to-first-answer ~15 s, ~20.3 GiB VRAM. Valódi
agentic munkához, 10-50K tokennyi kontextussal (rendszerszabályok, behúzott kód,
hosszabb tool-láncok), alapértelmezésként használd a `--reasoning-budget 2048`
értéket -- ez ugyanazt a 0%-os runaway padlót tartja, több mélységi tartalékkal --,
és csak akkor menj le 1024-re, ha egy mélység-specifikus utóteszt megerősíti, hogy
a fennsík azon a kontextushosszon is tartja magát.

## Amit még nem bizonyítottunk

Három őszinte hiányosság, amit érdemes nyíltan kimondani ahelyett, hogy elkennénk:

- **reps=1.** A fennsíkon belüli finom rangsorolás (1024 vs 2048, néhány tizednyi
  judge-delta) egy konfigurációnkénti ismétlés mellett a zaj szintjén belül van.
  Ami *robusztus* a futás egészében: a 100%-os determinisztikus pontosság a teljes
  korlátozott fennsíkon (egy 11 feladatos jel), a minőségcsökkenés 512-nél, és a
  korlátlan runaway arány, amely mindhárom korlátlan cellában konzisztens volt.
- **Csak sekély promptok.** Ebben a sweepben minden feladat nagyjából 50-100 prompt
  tokent használt. A valódi célterület -- 10-50K tokennyi agentic kontextus --
  tesztelve nincs, és az optimális büdzsé, az instrukciókövetés mélységben, valamint
  hogy a KV-cache q8_0 megéri-e a pontossági kompromisszumot, mind valószínűleg
  eltolódik, ha hosszabb lesz a kontextus. Ez az egyetlen legnagyobb nyitott kérdés
  ebből a körből.
- **13-ból 10 tervezett konfiguráció futott le.** A kihagyott három (egy temp-1.0
  szalmabáb, egy temp-0.7 cella, és egy KV-q8 szúrópróba) ebben a körben alacsony
  értékűnek minősült, és szándékosan maradt ki, ahelyett hogy a teljesség kedvéért
  lefuttattuk volna.

## Zárás

Ha eddig azt feltételezted, hogy a komoly helyi kódoló-modell inferenciához NVIDIA
kártya kell, ez egy adatpont ez ellen: egy sűrű 27B-s modell, egy 32 GB-os AMD
RDNA4 kártya, 70 tok/s decode, 100%-os pontosság a determinisztikus tesztsorozaton,
és több mint 11 GiB tartalék VRAM. Az MTP build az eredmény ingyenes fele. A
reasoning-budget korlát az a fele, amit neked kell megválasztanod.

---
*Eredet (provenance): minden teljesítmény-/minőségi szám MEASURED (mért) a R9700-on
(RDNA4, gfx1201) llama.cpp Vulkan b9950 alatt. Az ajánlott sampling-értékek CLAIMED
(állítás), a Qwen3.6 modellkártyából. reps=1; a nyílt végű feladatokat egy vak LLM
judge pontozta.*
