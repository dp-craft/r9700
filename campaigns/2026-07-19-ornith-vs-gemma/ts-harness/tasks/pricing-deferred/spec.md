# Task: add a `deferred` Amount variant (async pricing, end to end)

The pricing mini-project (see PROJECT FILES) prices line items: `types.ts` holds the `Amount` union and
`LineItem`; `pricing.ts` computes `lineTotal`/`computeTotal`; `report.ts` labels adjustments and renders
report lines; `cache.ts` (`createPriceCache`) caches computed totals per key with a TTL driven by the
shared `Clock`.

Add a new variant to `Amount`:

```ts
{ readonly kind: "deferred"; readonly load: () => Promise<number> }
```

A deferred adjustment's value is not known yet: pricing MUST call `load()` and use the resolved number
exactly like a `fixed` value (added to the item's base). Make the WHOLE pipeline handle it correctly:

1. `lineTotal` and `computeTotal` must return correct totals for items with deferred adjustments — this
   makes them async; align every affected file AND the existing tests so everything stays green.
2. `report.ts`: a deferred adjustment is labeled `"deferred"`, other labels are unchanged, and every
   report line must contain the RESOLVED total (never a stringified promise). Keep the existing
   `id [label]: total` line shape.
3. `fixed` and `percent` results must not change.
4. The cache contract — now that computations are asynchronous and expensive, `createPriceCache(...).get`
   MUST satisfy all of: concurrent `get` calls for the same fresh key share ONE computation (`compute`
   — and therefore a deferred `load()` — is invoked exactly once); a FAILED computation is never cached
   (a later `get` retries); entries still expire after the TTL via the injected `Clock`; different keys
   stay independent. Audit the current implementation against this contract and fix what violates it.

Keep the exported names and shapes otherwise stable (`Amount`, `LineItem`, `lineTotal`, `computeTotal`,
`amountLabel`, `reportLine`, `buildReport`, `PriceCache`, `createPriceCache`). `tsc --strict`, eslint and
ALL tests must stay green — note that the compiler will NOT point you at every place that needs a change;
trace the data flow yourself.

Output every changed/added file (including the updated `pricing.test.ts`) with `// FILE: <path>` markers,
and add tests covering the new deferred behavior.
