Egy reasoning modell gondolkodási budgetjének megkötése 40-55%-kal csökkentette a token- és latency-költséget — nulla pontossági veszteséggel. A runaway generálások aránya 7.1%-ról 0%-ra esett.

A Qwen3.6-27B-t (dense, Q4_K_M) 14 nehéz agentic coding feladaton futtattuk egy AMD Radeon AI PRO R9700 kártyán, a llama.cpp --reasoning-budget kapcsolóját sweepelve — ez a hard cap arra, hány tokent éghet el egy gondolkodó modell, mielőtt válaszolnia kell.

Amit találtunk:

A determinisztikus pontosság 100% maradt minden korlátozott budgetnél (512, 1024, 2048). A megkötés semmibe nem került azoknál a feladatoknál, ahol van ellenőrizhető válasz.
A nyílt végű judge-minőség nem lejtő volt, hanem plató: 512-től 1024-ig emelkedett, onnan ellaposodott. A legjobb pontszám (4.83/5) a legolcsóbb, plató fölötti budgetnél született (1024).
Minden uncapped futásnál 7.1% volt a runaway-arány: a modell a token-plafonig gondolkodott, és sosem válaszolt. Minden korlátozott futásnál — a legkisebb capnél is — 0%.

A csapda: a --reasoning-budget 0 NEM azt jelenti, hogy „ne gondolkodj". A mi buildünkön uncapped-et jelent, és az összes konfig közül ez gondolkodott a legtöbbet (1736 token). Ha egy modellt gondolkodásmentesre akarsz állítani, nem ez a kapcsoló.

Egy őszinte fenntartás: ez reps=1, ~50-100 tokenes promptokon. A platón belüli finom sorrend zajos, és még nem teszteltük azon a 10-50K tokenes kontextusmélységen, ahol a valódi agentic munka fut. Ez a következő lépés.

Ha a reasoning modelled alapból „annyit gondolkodik, amennyit akar", akkor egy free lunchöt hagysz az asztalon, amit senki nem szolgál fel.

[teljes cikk ↓ / link a hozzászólásokban]

#LLM #LocalLLM #Inference #AIEngineering #ROCm
