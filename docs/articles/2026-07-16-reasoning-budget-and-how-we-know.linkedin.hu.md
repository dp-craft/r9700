Egy reasoning modell gondolkodási tokenjeinek megkötése 40-55%-kal csökkentette a latency- és tokenköltséget, nulla pontossági veszteséggel. Mi sem hittük el, ezért megpróbáltuk megcáfolni.

Setup: Qwen3.6-27B egy AMD R9700-on (RDNA4, 32GB), llama.cpp Vulkan, 14 nehéz agentic coding feladat, blind LLM judge-olás.

Ami kiállta a próbát:
A determinisztikus pontosság 100% maradt minden korlátozott budgetnél, egészen 512 tokenig. A judge-minőség platózik, nem lejt; a legjobb pontszám (4.83/5) a legolcsóbb korlátozott ponton született, 1024 tokennél. Az uncapped futásoknál 7.1% volt a runaway-arány: a modell a token-plafonig gondolkodott, és sosem válaszolt.

És most a rész, amire tényleg büszkék vagyunk. Az első olvasatunk az MTP (multi-token prediction / speculative decode) draft-tuning kapcsolóira fogta a runaway-eket, mert a rossz cellák egybeestek az MTP konfigokkal. Ezt az állítást közvetlenül leteszteltük. Tévedtünk. Ezek a kapcsolók a draft mélységét és sebességét szabályozzák, nem a gondolkodás hosszát. A valódi ok — egy követő futás által megerősítve — egyszerűen a hiányzó budget cap volt. A korrekciót a findinggel együtt publikáljuk.

Csapda: a --reasoning-budget 0 ezen a buildön uncapped-et jelent, nem azt, hogy „ne gondolkodj".

Fenntartás: reps=1, tehát a platón belüli finom sorrend (1024 vs 2048) zajszinten van. Minden feladat sekély (50-100 tokenes prompt), a valós cél 10-50K tokenes agentic kontextus. Az a következő.

Egy benchmark, amiben megbízhatsz, olyan, amelyik keresi az okokat, amiért a saját konklúziója tévedhet.

[teljes cikk ↓ / link a hozzászólásokban]

#LLM #LocalLLM #AMD #ROCm #Inference #AIEngineering
