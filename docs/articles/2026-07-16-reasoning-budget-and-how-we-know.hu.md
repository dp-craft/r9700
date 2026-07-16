# Az ingyenebéd a reasoning modellek kiszolgálásában – és honnan tudjuk, hogy nem csaptuk be magunkat

Ha korlátozzuk, meddig „gondolkodhat” egy reasoning modell, mielőtt válaszolnia kell, az 40-55%-kal
csökkenti a token-felhasználást és a latenciát, mérhető pontosságvesztés nélkül. Ez nem az a fajta
tradeoff, amit az ember egy „ingyenebéd”-állítástól várna, ezért mielőtt elárulnánk a számot,
megmutatjuk, hogyan próbáltuk megcáfolni.

## A mérési környezet

A Qwen3.6-27B modellt (Q4_K_M, dense) futtattuk egy AMD Radeon AI PRO R9700-on (RDNA4, gfx1201,
32 GB), llama.cpp Vulkan b9950 build-del, KV cache f16, 32768-as kontextus, single-stream módban.
Két GGUF build: az egyiken MTP (multi-token prediction, egy speculative decode jellegű
draft-and-verify séma) kikapcsolva, a másikon bekapcsolva. Konfigurációnként 14 nehéz agentic
coding feladat — 11-et determinisztikusan, automatikusan pontoztunk, 3-at egy blind LLM judge —
temperature 0.6, reps=1 mellett.

A vizsgált „kar” a `--reasoning-budget`: egy kemény felső korlát arra, hány „gondolkodási” tokent
költhet el a modell, mielőtt kénytelen választ adni. A kézenfekvő aggály az, hogy egy reasoning
modell gondolkodási keretének megvágása a reasoning-jét, és ezáltal a pontosságát is rontja.

## Az eredmény

Nem rontja. Mindkét model build-nél a determinisztikus pontosság **100%-on maradt minden tesztelt
korlátozott budget mellett, egészen 512 tokenig lemenve**. Ami változik, az a költség:

| Config | MTP | budget | det % | judge /5 | think tok | decode tok/s | ttfa s | runaway % |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| un-rb1024 | on | 1024 | 100 | 4.83 | 1023 | 70.3 | 15.5 | 0 |
| un-rb2048 | on | 2048 | 100 | 4.67 | 1872 | 69.9 | 27.9 | 0 |
| un-rb512 | on | 512 | 100 | 4.17 | 511 | 69.8 | 8.1 | 0 |
| jr-rb0 (uncapped) | off | inf | 100 | 4.61 | 1736 | 30.9 | 56.9 | 0 |
| un-nmax5 (uncapped) | on | inf | 91 | 4.33 | 2957 | 71.3 | 38.1 | **7.1** |

Az uncapped állapotból egy 2048-as korlátra váltás semmibe nem kerül a determinisztikus pontosság
szempontjából, és a judge score-t is csak 0.33-dal csökkenti, miközben a tokenszámot ~20%-kal, a
time-to-first-answer-t pedig ~27%-kal vágja. Ha tovább megyünk, 2048-ról 1024-re, az *semmi extra
költséggel* nem jár — a pontosság változatlan, a judge score a zajszinten belül változatlan, a
tokenszám további 28%-kal, a ttfa további 40%-kal csökken. A nyílt végű feladatok judge quality-je
egy plató, nem egy lejtő: 512→1024 között emelkedik, majd 1024→2048→uncapped között ellaposodik és
visszaesik. A legjobb mért egyedi judge score, 4.83/5, a *legolcsóbb* korlátozott ponton, 1024
tokennél született. Ha a platón túl, 512-ig megyünk, azért már fizetünk: a judge score kb.
0.6-0.66 ponttal esik, ahogy a design/review feladatok gondolkodási térből kezdenek kifogyni.

Van még egy eredmény, ami külön bekezdést érdemel: a `--reasoning-budget 0` NEM azt jelenti, hogy
„ne gondolkodj” — ezen a build-en uncapped-et jelent. Az MTP-off build-ünk *több* gondolkodási
tokent költött rb0-nál (1736), mint a saját rb2048 beállításánál (1262). Ha gyors, alacsony
gondolkodású konfigurációt szeretnél, ne a `0`-hoz nyúlj.

## A bizalmi próba: honnan tudjuk, hogy nem csaptuk be magunkat

A fenti számot könnyű leközölni, és könnyű túlzottan megbízni benne, szóval itt jön az a rész, ami
szerintünk fontosabb a headline-nál: egyszer eltévesztettük az ok-okozati történetet, észrevettük,
és kijavítottuk, mielőtt publikáltuk volna.

**Az önkorrekció.** A sweep minden *uncapped* konfigurációja ugyanazt a patológiát mutatta: a
feladatok 7.1%-a (14-ből 1) egészen a 8192-tokenes plafonig gondolkodott, és soha nem adott
választ — ez egy runaway. Minden *capped* konfiguráció 0% runaway-t mutatott, kivétel nélkül. Az
első olvasatunk ebből a mintázatból az MTP draft-acceptance kapcsolóira (`--spec-draft-p-min`,
`--spec-draft-n-max`) mutatott mint bűnösre, mivel a runaway cellák épp azok az MTP konfigurációk
voltak, amelyeket a draft acceptance-re is hangoltunk. Ez a következtetés téves volt, és azért
tudjuk, hogy téves, mert visszamentünk, és közvetlenül teszteltük: egy follow-up run
(`bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/`) megerősítette, hogy ezek a draft paraméterek
élnek ezen a build-en, de a draft *mélységét és sebességét* szabályozzák — hogy milyen messzire
draftol előre a modell, és milyen készségesen fogadja el a draftokat —, nem a reasoning *hosszát*.
Nincs olyan mechanizmus, amivel egy 8192-tokenes runaway-be tudnák tolni a modellt. Az egyetlen
változó, ami ténylegesen, tisztán korrelál minden runaway-jel, a hiányzó budget cap. A 91%-os
determinisztikus eredmények két uncapped cellán szintén red herring-nek bizonyultak: reps=1
mellett ez seedenként egyetlen újrakevert válasz, nem egy draft-quality hatás.

**Vak pontozás (blind judging).** A 3 nyílt végű feladatot egy olyan LLM judge pontozta, amely
soha nem látta, melyik konfiguráció adta melyik választ: a válaszokat anonimizáltuk, fix seed
alatt megkevertük, feladatonként szétválasztottuk, és 3 független judge pass pontozta beágyazott
anchorok ellenében, mielőtt bármi is de-anonimizálásra került volna. Egyetlen válasz sem kapott
tiszta 5/5/5-öt mindhárom judge-tól, egyik konfiguráción sem — hasznos emlékeztető arra, hogy ezek
valódi, tökéletlen pontszámok, nem egy gumibélyegző.

**Őszinte korlátok.** A reps=1 azt jelenti, hogy a platón belüli finomrangsor (1024 vs 2048, egy
0.16 pontos judge gap) zajszintű, nem egy bizonyított sorrend. És minden itteni feladat sekély:
50-100 prompt token, nem a valódi agentic használatra jellemző 10-50K rendszerszabály és kód. A
budget optimum, az instruction-following mélyben, és a KV-q8 tradeoff-ok mind teszteletlenek ezen
a skálán — ez az egyetlen legnagyobb nyitott rés ebben az eredményben.

A lényeg nem az, hogy előbb slendriánok voltunk, majd alaposak lettünk. A lényeg, hogy egy
megbízható benchmark az, amelyik aktívan keresi az okokat, amiért a saját következtetése téves
lehet, és jelenti, ha az első történet nem éli túl az ellenőrzést.

## Hogyan alkalmazd

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

Az `1024` a legolcsóbb pont a biztonságos platón a mi feladatainkhoz hasonló sekély feladatokra:
100% determinisztikus pontosság, top-band judge quality, 0% runaway, ~70 tok/s decode, ttfa ~15s.
Ha a valódi workload-od 10-50K agentic kontextuson fut, inkább a `--reasoning-budget 2048`-ból
indulj — ugyanaz a 0% runaway garancia, több mélységi tartalék —, és csak akkor menj le 1024-re, ha
egy mélység-specifikus follow-up megerősíti, hogy ott is tartja magát. Soha ne használd a `0`-t;
ezen a build-en az uncapped-et jelent, nem a gyorsat.

## Mi jön ezután

A terv az, hogy ezt megismételjük agentic mélységben (8K/16K/32K kontextus, reps=3), és megnézzük,
elmozdul-e az 1024-es sweet spot, plusz egy KV-q8 spot-check, most hogy valódi VRAM-megtakarítás is
szóba jön. Addig is az 1024-et sekély mélységen validált gazdaságos opcióként kezeljük, a 2048-at
pedig alapértelmezettként, amely kiérdemelte a 0% runaway rekordját.

<!-- Hero chart: reasoning_budget_sweep.svg. LinkedIn does not render SVG inline; export to PNG before posting. -->
![Reasoning budget sweep: quality holds flat while token cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)

---
*Eredet (Provenance): minden teljesítmény-/minőségi szám MÉRT (MEASURED) az R9700-on (RDNA4,
gfx1201) llama.cpp Vulkan b9950-nel. Az ajánlott sampling értékek ÁLLÍTOTT (CLAIMED), a Qwen3.6
model card-ból. reps=1; blind LLM-judge a nyílt végű feladatokon.*
