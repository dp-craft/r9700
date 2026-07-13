# Task: createRateLimiter (token bucket, lazy refill, per-key)

Implement a per-key token-bucket rate limiter:

`createRateLimiter(capacity: number, refillPerSec: number, clock: Clock): RateLimiter`

where:
```
interface RateLimiter {
  tryAcquire(key: string, tokens?: number): boolean;  // tokens defaults to 1
}
```
Semantics: each key has its own bucket that starts FULL (`capacity` tokens). Refill is LAZY — computed
from elapsed time on each call (`elapsedSeconds * refillPerSec`, capped at `capacity`), never a background
timer. `tryAcquire` returns true and deducts `tokens` if the (refilled) bucket has enough, else returns
false and deducts nothing. Buckets for different keys are independent.

Reuse the existing `Clock` from the codebase (`lib/clock`) for all time reads — do NOT call `Date.now()`.
Output exactly two files with `// FILE:` markers: `impl.ts` then `impl.test.ts`.
