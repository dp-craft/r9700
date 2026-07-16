# Négy dolog, amiben tévedtünk, mielőtt lefuttattuk a benchmarkot

A Qwen3.6-27B reasoning-budget és speculative decode beállításait hangoltuk egy AMD R9700-on,
és a legértékesebb eredmény nem a hangolási javaslat lett. Hanem az, hogy négy induló
feltételezésünket egyenként cáfolták meg a számok. Íme, mit gondoltunk előzetesen, mit mutatott
valójában a gép, és melyik feltételezés bizonyult igaznak.

## A mérési környezet röviden

Qwen3.6-27B (Q4_K_M, dense), llama.cpp Vulkan alatt (b9950-es build), egy AMD Radeon AI PRO
R9700-on (RDNA4, gfx1201, 32 GB). Két GGUF build: az egyikben MTP (multi-token / speculative
decode) bekapcsolva, a másikban kikapcsolva. 14 nehéz, agentic kódolási feladat, seed 42,
`max_tokens 8192`, reps=1 — 11 determinisztikus, automatikusan pontozott feladat, plusz 3 nyitott
végű feladat, amit egy blind LLM judge pontozott (anonimizálva, összekeverve, három független
bíráló, egyik sem látta, melyik konfigurációt értékeli). A vizsgált paraméter: a
`--reasoning-budget`, ami kemény felső korlátot szab a gondolkodási tokenekre, mielőtt a
modellnek válaszolnia kell.

Négy dolog, amit kiindulásként feltételeztünk, nem élte túl a találkozást az adatokkal.

## 1. feltételezés: „a 0-s budget azt jelenti, nincs gondolkodás”

**A valóság: a 0 azt jelenti, nincs felső korlát — és korlátlanul futtatva keletkezett a legtöbb
gondolkodási token az összes tesztelt konfiguráció közül.**

A `--reasoning-budget 0` úgy hangzik, mintha „kikapcsolva” lenne. Nem az. A jackrong (MTP
nélküli) buildben az `rb0` **1736 gondolkodási tokent** termelt — többet, mint a saját `rb2048`
konfigurációja (1262 token), és többet, mint a teljes 2048-tokenes korlát, amit bőkezűnek
gondoltunk. Az 512/1024/2048-as korlátok pontosan úgy viselkednek, ahogy várnánk (monoton,
betartva). A nulla nem illeszkedik ebbe a létrába — hanem eltünteti azt. Ha olyan modellt akarunk,
amelyik nem gondolkodik, a `--reasoning-budget 0` nem a megfelelő kapcsoló; másik vezérlésre van
szükség (a chat-template `/no_think` opciója vagy egy kis, nullától eltérő korlát). Gyakorlati
tanulság: soha ne a `0`-hoz nyúlj, ha sebességet vársz tőle.

## 2. feltételezés: „az MTP draft-hangolása okozta a runaway válaszokat”

**A valóság: nem. Minden uncapped (korlátlan) konfigurációnál ugyanakkora arányban jelentkezett a
runaway, a draft-beállításoktól függetlenül.**

Ez az a pont, amit először tévesen írtunk le, és utólag kellett korrigálnunk. Három korlátlan
konfiguráció — a `--spec-draft-n-max` és a `--spec-draft-p-min` változtatásával (ezek a
paraméterek szabják meg, milyen mélyen/agresszíven megy neki a speculative decode draft head-je,
mielőtt visszaesne az alapmodellre) — mindegyik ugyanazt a **7,1%-os runaway-arányt** mutatta: a
14 feladatból 1 végig gondolkodik a 8192-tokenes korlátig, és sosem ad választ. Minden korlátozott
(capped) konfiguráció, mindkét buildben és mindhárom budget-szinten, **0%**-ot mutatott.

Az első értelmezésünk az volt, hogy a draft-elfogadási paraméterek „visszaütnek” — az
agresszívabb beállítás korrelált a runaway-ekkel, ezért ok-okozati összefüggésnek könyveltük el.
Egy utólagos teszt (`bench/runs/2026-07-16-1111-spec-draft-pmin-mtp/`) megcáfolta ezt a
történetet: ezek a draft-paraméterek élők — mérhetően megváltoztatják a decode viselkedését —, de
amit szabályoznak, az a draft *mélysége és sebessége*, nem a gondolkodás *hossza*. Nincs olyan
mechanizmus, amellyel a token-korlátig tolnák a modell gondolkodását. Az egyetlen változó, amely
ténylegesen előre jelzi a runaway-t, az, hogy a gondolkodási budget egyáltalán korlátozva van-e. A
két draft-hangolt cellán mért 91%-os determinisztikus pontszám egy n=1-es reshuffle-artifaktumnak
bizonyult — az RNG-újrarendeződés megváltoztatta, melyik egyetlen válaszra esik a seed, nem a
draft-beállítások minőségi hatásáról volt szó. A runaway-ekre a megoldás a budget-korlát. Sosem a
draft-kapcsolók voltak a hibásak.

## 3. feltételezés: „a beépített runaway-jelző elkapja ezt”

**A valóság: nullára alulszámolt, pontosan azokon a cellákon, ahol a runaway-ek ténylegesen
történtek.**

A llama.cpp jelent egy `truncated_thinking` jelzőt. Azon a három korlátlan cellán, amelyeket a
saját jelzőnk 7,1%-on jelölt, a beépített flag **0%**-ot jelentett. Most már explicit módon
pontozzuk a runaway-eket: `finish_reason=length ∧ ¬has_answer` — a modell elérte a token-plafont,
és sosem jutott el egy ellenőrizhető válaszig. Ez az a jelzés, amely elkapta azt, amit a beépített
flag elmulasztott. Ha egy reasoning modell „pörgésének” jelzésére a keretrendszer saját truncation
flag-jére támaszkodsz, ellenőrizd azt egy explicit válasz-jelenlét jelzéssel, mielőtt megbíznál a
nullában.

## 4. feltételezés (a szalmabáb-érv): „újra kellene tesztelnünk 1,0-s temperature-nél”

**A valóság: ezt már megválaszoltuk, és a helyes temperature-nél kapott eredmény lezárja a
kérdést.**

A teszt előtt félig gyanítottuk, hogy a sampling temperature is szerepet játszik a
runaway-viselkedésben — talán egy magasabb temperature hagyja elkalandozni a modellt. Nem kellett
GPU-időt égetnünk egy 1,0-s temperature futtatásra, hogy ezt ellenőrizzük: a fenti ok-okozati
megállapítás már megválaszolja. A runaway-ek **0,6-os temperature-nél** jelentkeznek — ez a model
card ajánlott, „helyes” beállítása —, amikor a budget korlátlan. A patológia nem egy
sampling-temperature probléma, amit egy rosszabb temperature-nél kellene megerősíteni; már a
józan beállításnál is reprodukálódik. A temp-1.0 futtatást szándékosan nem futtattuk le, mint
ismerten hiábavaló szalmabábot, ahelyett hogy GPU-időt költöttünk volna valami megerősítésére,
amit az adatok már kizártak.

## Ami továbbra is áll, és mit kezdjünk vele

Mindez nem változtat a fő eredményen: a `--reasoning-budget` korlátozása majdnem ingyen ebéd. A
determinisztikus pontosság **100%**-on marad minden ≥512-es korlátozott budgetnél, mindkét
buildben, a tokenszám és a latency **40–55%**-ot csökken, ahogy szűkítjük a korlátot, és a
runaway-ek **0%**-ra esnek, amint létezik korlát. A plateau valós — a pontosság nem mozdul, a
judge-minőség csak ellaposodik kb. 1024 fölött —, a téves feltételezések arról szóltak, *miért*
romlottak el a dolgok, nem arról, hogy a javítás működik-e.

Ajánlott konfiguráció:

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

Az `1024` a legolcsóbb pont a biztonságos plateau-n ezekhez a (sekély) feladatokhoz. Valós
10-50K-s agentic kontextushoz használd a `--reasoning-budget 2048`-at mint depth-safe
alapértelmezést, amíg egy mélységi utóvizsgálat meg nem erősíti, hogy az 1024 nagyobb mélységben
is tartja magát.

![Reasoning-budget sweep: quality flat, cost and latency scale with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)
<!-- LinkedIn does not render SVG inline; export this chart to PNG before posting. -->

## Amit nem bizonyítottunk

- **reps=1.** A plateau-n belüli finom rangsorolás (1024 vs. 2048 judge-delta kb. 0,3) egyetlen
  repetíció esetén zajon belül van. Ami *valóban* robusztus az adatokban: 100%-os determinisztikus
  pontosság a teljes korlátozott plateau-n (egy 11 feladatos szignál), a minőségromlás 512-nél
  (~0,6 pont), és a korlátlan runaway-arány (konzisztens mindhárom korlátlan cellán). Az 1024-es
  javaslat a biztonságos plateau gazdaságosságán nyugszik, nem egy bizonyított minőségi csúcson.
- **Csak sekély prompt-ok.** Minden itteni feladat kb. 50-100 prompt tokenen fut. A valós cél a
  10-50K-s agentic kontextus (rendszerszabályok plusz kód). Hogy az optimális budget, az
  instruction-following mélységben, és a KV cache kvantálási tradeoff-ok ezen a skálán is
  tartják-e magukat, az nem tesztelt — ez az eredmény legnagyobb nyitott hiányossága.
- **13 tervezett konfigurációból 10 futott le.** Hármat szándékosan kihagytunk (egy temp-1.0
  szalmabáb, temp-0.7, és egy KV-q8 spot-check), mert a fenti ok-okozati kép már megválaszolta,
  amit mutattak volna, vagy a hozadék marginális lett volna.

A benchmark futtatásának lényege nem csupán annak megerősítése, amit vártunk. Hanem az, hogy
megtaláljuk a téves feltételezést, mielőtt az bekerülne egy konfigurációs fájlba. Minden itteni
számot megjelölünk: MEASURED (a saját gépünkön mérve), CLAIMED (a model card sampling-ajánlása),
vagy INFERRED (levezetett, ekként jelölve) — pontosan ezért, mert a provenance teszi lehetővé,
hogy egy téves ok-okozati történetet nyilvánosan elkapjunk és korrigáljunk, ahelyett hogy csendben
halmozódna.

---

*Provenance: minden teljesítmény- és minőségi szám MEASURED a R9700-on (RDNA4, gfx1201),
llama.cpp Vulkan b9950-cel. Az ajánlott sampling-értékek CLAIMED a Qwen3.6 model cardból. reps=1;
blind LLM judge a nyitott végű feladatokon.*
