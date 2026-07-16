Először a rossz gyökérokot publikáltuk. Aztán leteszteltük, és nyilvánosan korrigáltuk.

A Qwen3.6-27B reasoning-budget hangolását benchmarkolva egy AMD R9700-on négy feltételezés, amivel érkeztünk, nem élte túl az adatokkal való találkozást:

„A --reasoning-budget 0 azt jelenti, hogy nincs gondolkodás." Tévedés — a 0 uncapped-et jelent, és 1736 gondolkodási tokent produkált, többet, mint a 2048-as capünk. A nulla az ellentéte az „off"-nak.

„Az MTP draft-tuning okozta a runaway válaszokat." Tévedés. Minden uncapped konfig pontosan 7.1%-on futott el, függetlenül a draft beállításoktól. Minden korlátozott konfig: 0%. A draft paraméterek élnek, csak épp a draft mélységét/sebességét szabályozzák, nem a gondolkodás hosszát. Korrelációból következtettünk oksági kapcsolatra, aztán egy követő futás megcáfolta.

„A beépített truncated_thinking flag majd elkapja a runaway-eket." 0%-ot jelentett azokon a cellákon, ahol mi 7.1%-ot mértünk. A saját explicit jelünk (finish_reason=length ÉS nincs válasz) elkapta, amit a keretrendszer saját flagje elszalasztott.

A fix, ami tényleg megáll: kösd meg a gondolkodási budgetet. 100% determinisztikus pontosság minden korlátozott konfignál, 40-55%-kal kevesebb token, 0% runaway. Ez a rész sosem volt kérdéses — amit elrontottunk, az a történet arról, hogy MIÉRT hibáztak a dolgok a megkötés előtt.

Fenntartás: ez reps=1, sekély (50-100 tokenes) promptokon. A biztonságos platón belüli finom sorrend zaj; maga a plató és a runaway-minta nem az.

Itt minden szám MEASURED, CLAIMED vagy INFERRED címkét kap. Ez nem bürokrácia — ez tette lehetővé, hogy elkapjuk a saját rossz oksági történetünket, mielőtt bekerült volna valakinek a configjába.

[teljes cikk ↓ / link a hozzászólásokban]

#LLM #LocalLLM #AMD #ROCm #AIEngineering
