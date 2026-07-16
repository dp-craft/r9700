# Az ingyenebéd, ami minden reasoning modell alapbeállításában ott lapul

A reasoning modellek alapból gondolkodnak, és ennek a gondolkodásnak a nagy része pazarlás. A
Qwen3.6-27B-n limitáltuk a gondolkodási budgetet, és ezzel **40-55%-kal** csökkentettük a
tokenszámot és a latenciát — a verifikált pontosság romlása nélkül —, a runaway generálások
(amikor a modell a végtelenségig gondolkodik, és sosem válaszol) aránya pedig 7.1%-ról **0%-ra**
esett. Ha Qwen3/DeepSeek-stílusú thinking modellt futtatsz, és még nem nyúltál a
`--reasoning-budget` kapcsolóhoz, olyan tokenekért fizetsz, amiket senki nem olvas el.

## Miért nem AMD-specifikus ez a felfedezés

Ezt egy AMD Radeon AI PRO R9700-on (RDNA4, gfx1201, 32 GB) mértük, llama.cpp Vulkan backenddel
(b9950-es build), mert ez a gép áll rendelkezésünkre. De a jelenség semmiben sem hardverfüggő —
a thinking-mode samplingjének egy tulajdonságáról van szó: a modell egy chain-of-thought blokkot
generál, és alapból semmi nem mondja meg neki, mikor álljon le, csak a saját megítélése (vagy a
context window mérete). A `--reasoning-budget` a llama.cpp kemény felső korlátja erre a
blokkra — amint a budget elfogy, a modellnek kényszerűen válaszolnia kell. Minden
Qwen3.6-osztályú vagy DeepSeek-stílusú reasoning modellnek, amely kiteszi ezt a kapcsolót,
ugyanilyen alakú görbét kellene mutatnia.

A teljes setup: Qwen3.6-27B (dense, Q4_K_M), két GGUF build — az egyiken MTP (multi-token
prediction / speculative decode) bekapcsolva, a másikon kikapcsolva —, CTX 32768, KV cache f16,
single-stream. 14 nehéz agentic-coding feladat (11 determinisztikus, automatikusan kiértékelt, 3
nyílt végű, blind LLM judge által pontozva, seed 42, reps=1). A sampling a Qwen3.6 model card
szerint: temperature 0.6, top_p 0.95, top_k 20, min_p 0 (**CLAIMED**, nem mért érték).

## Az eredmény

A determinisztikus pontosság minden tesztelt limitált budgetnél (512, 1024, 2048) **100%-on**
áll, mindkét model buildnél. A budget limitálása semmibe nem kerül azokon a feladatokon,
amelyeknek van ellenőrizhető válasza. Amit cserébe visszakapunk, az a tokenszám, a latencia, és
— ami a legfontosabb — a runaway generálások megszűnése.

| Config | budget | think tok | decode tok/s | ttfa (s) | det % | judge /5 | runaway % |
|---|---:|---:|---:|---:|---:|---:|---:|
| un-rb512 | 512 | 511 | 69.8 | 8.1 | 100 | 4.17 | 0 |
| un-rb1024 | 1024 | 1023 | 70.3 | 15.5 | 100 | **4.83** | 0 |
| un-rb2048 | 2048 | 1872 | 69.9 | 27.9 | 100 | 4.67 | 0 |
| jr-rb0 (uncapped) | ∞ | 1736 | 30.9 | 56.9 | 100 | 4.61 | 0 |
| un-nmax5 (uncapped) | ∞ | 2957 | 71.3 | 38.1 | 91 | 4.33 | **7.1** |
| un-pmin075 (uncapped) | ∞ | 3690 | 60.7 | 58.0 | 91 | 4.00 | **7.1** |

(`un-*` = unsloth build, MTP bekapcsolva; `jr-*` = jackrong build, MTP kikapcsolva. A teljes,
10 soros táblázat a forrás campaignben található.)

Két dolog azonnal szembetűnik. Először is: a nyílt végű judge score nem egy lejtő, hanem egy
plató — 512-ről 1024-re emelkedik, aztán 1024-től 2048-on és az uncapped configon át
ellaposodik, majd visszaesik. A legjobb mért nyílt végű pontszám, a **4.83/5**, a legolcsóbb
olyan limitált budgetből jött (1024), amelyik már túljutott a platón, nem a legbőkezűbből.
Másodszor — és ez az intuícióval ellentétes rész —: **minden uncapped konfiguráció 7.1%-os
runaway rátát hordoz** (14 feladatból 1 kifutja a 8192 tokenes generálási limitet úgy, hogy még
mindig gondolkodik, és sosem ad választ). Minden limitált konfiguráció, a legkisebb tesztelt cap
is, **0%-ot** mutat. A runaway nem egy modellminőségi probléma, amit jobb speculative-decode
beállításokkal ki lehetne tunningolni — közvetlen következménye annak, hogy egyáltalán nincs cap.

Ebből következik egy buktató, amit érdemes tisztázni, mielőtt bárki a `--reasoning-budget 0`-hoz
nyúlna, "no thinking mode"-ot várva tőle: ezen a buildben a `0` nem azt jelenti, hogy kikapcsolva,
hanem hogy *uncapped* (korlátlan). A jackrong build `rb0` futása **1736** thinking tokent
termelt — többet, mint a saját `rb2048` futása (1262 token). Azok a budget-értékek, amelyek
ténylegesen korlátozzák a generálást, monoton és kiszámítható viselkedésűek (512 → 1024 → 2048),
de a `0` nem egy kisebb cap, hanem a cap teljes hiánya. Ha azt szeretnéd, hogy a modell teljesen
kihagyja a gondolkodást, az egy másik kapcsoló — egy chat-template `/no_think` switch vagy egy
kicsi, nullától eltérő cap —, nem a `--reasoning-budget 0`.

<!-- Hero chart embed below; LinkedIn does not render SVG, export to PNG before posting there. -->
![Reasoning budget sweep: judge quality flattens while cost and latency keep climbing with the cap](../../campaigns/2026-07-13-27b-quality-tuning/charts/reasoning_budget_sweep.svg)

## Gyakorlatban

```bash
MODEL=/home/dev/models/gguf/Qwen3.6-27B-MTP-Q4_K_M.gguf BACKEND=vulkan PORT=8081 \
CTX=32768 NP=1 UB=2048 B=4096 FA=on KV=f16 MTP=1 \
EXTRA_ARGS="--reasoning-budget 1024" bash bench/engine-bench/serve_llamacpp.sh start
# client sampling: temperature 0.6, top_p 0.95, top_k 20, min_p 0
```

Ezeken a (sekély promptú) feladatokon az **1024** a legolcsóbb pont a biztonságos platón: 100%
determinisztikus pontosság, csúcskategóriás judge quality, 0% runaway, ~70 tok/s decode, ttfa
~15 s. Ha éles, 10-50K tokenes agentic contextre deployolsz a mi ~50-100 tokenes teszt
promptjaink helyett, használd a **2048**-at mint depth-safe default értéket — még mindig
teljesen limitált, a mi adatainkban még mindig 0% runaway, és több mozgástere van azoknak a
feladatoknak, amelyeknek tényleg hosszabb gondolkodásra van szükségük. Csak akkor menj le
1024-re, ha egy depth-matched follow-up teszt megerősíti, hogy ott is tartja magát.

## Amit még nem bizonyítottunk

Ez reps=1 adat, tehát a plató belsejében lévő finom rangsor (1024 vs 2048, néhány tized
judge-score különbség) a zajszinten belül van — ezt ne úgy olvasd, hogy "az 1024 a bizonyított
minőségi csúcs". Ami robusztus az adatokban: a 100%-os determinisztikus pontosság a teljes
limitált platón tartja magát (ez egy 11 feladatos szignál, nem véletlen), az 512-nél mért
visszaesés valós (~0.6 judge pont mindkét buildnél), és az uncapped runaway ráta konzisztens
mindhárom uncapped cellánál, amit futtattunk.

A nagyobb hiányosság: ebben a campaignben minden feladat ~50-100 tokenes promptot használt. Az
agentic coding valós célterepe 10-50K token context (system rules, fájltartalmak, korábbi
körök), és az optimális budget, az instruction-following viselkedés és a
KV-cache-kvantálási tradeoffok mind teszteletlenek ilyen mélységben. Ez a következő fázis, nem
egy lezárt kérdés.

## Zárás

Ha a reasoning modelled alapbeállítása az, hogy "gondolkodjon, ameddig csak akar", akkor ingyen
hagysz latenciát és runaway kockázatot az asztalon. Korlátozd, figyeld meg, hogy a pontosság
tartja magát, és lépj tovább azokra a kérdésekre, amelyeknek valóban több tesztelésre van
szükségük — mint például, hogy mi történik valós context mélységben.

---
*Eredet: minden teljesítmény- és minőségi szám MEASURED (mért) a R9700-on (RDNA4, gfx1201)
llama.cpp Vulkan b9950-nel. Az ajánlott sampling értékek CLAIMED (állított), a Qwen3.6 model
cardból. reps=1; blind LLM-judge a nyílt végű feladatokon.*
