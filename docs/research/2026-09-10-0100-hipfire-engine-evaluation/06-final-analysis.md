# hipfire — final analysis

**Subject:** hipfire 0.3.0-beta as a local inference engine for agentic coding work
**Hardware:** AMD Radeon AI PRO R9700, gfx1201 (RDNA4), 32 624 MB, ROCm 10.0.0 shipping HIP 7.15
**Model under test:** `qwen3.8-27b.mq4-pro`, 16.46 GB of weights, 64 layers, hybrid attention/DeltaNet
**Comparison arm:** llama.cpp Vulkan, same card, same prompts, served through llama-swap
**Date:** 2026-09-10. Every number below was measured in this evaluation unless marked INFERRED.

This document is the synthesis. The evidence, run by run, is in `05-rocm10-upgrade-log.md` §§1–28,
and each claim here cites the section that measured it.

---

## 1. The verdict in one paragraph

hipfire is a fast, ambitious, single-tenant engine with a serious long-context prefill regression that
turns out to be **a threshold in a dispatcher, not an architectural limit** — one configuration flag
recovers 1.8× at 73k tokens and changes the decay exponent from −1.324 to −0.797. After that fix it
is still slower than llama.cpp at every depth on this model, it cannot cache more than one
conversation, and it wedges its own daemon on roughly a third of draft-free boots while continuing to
report itself healthy. It is an excellent choice for a **single agent, short-to-medium context, one
model, one process at a time**, and a poor choice for **anything that interleaves conversations or
runs unattended**. The gap to llama.cpp is not closeable by configuration: hipfire's best-case 18k
prefill is what llama.cpp sustains at 73k.

---

## 2. What hipfire is

hipfire is not a llama.cpp backend. It is a separate engine with its own quantisation formats
(`.mq4-pro`, `.mq4r`), its own model registry, its own control socket, its own config store, and no
flag vocabulary in common with `llama-server`. It ships a daemon (`hipfire serve`) and a CLI, targets
AMD RDNA3/RDNA4 directly through HIP rather than through Vulkan, and hand-writes kernels per
architecture generation. The engineering is visible in the source: the attention dispatcher chooses
between a WMMA kernel, a scalar query-tiled kernel and a legacy tiled-partials kernel based on
measured envelopes, with the certification conditions written into the code as comments.

That last detail is the whole story of this evaluation, so it is worth stating plainly. hipfire is
**fast where it has been certified and slow where it has not**, and the certification boundaries are
compiled-in constants keyed to model shapes that may not be yours.

### Feature surface

| Feature | What it is | Verdict here |
|---|---|---|
| DFlash | 5-layer draft head, sliding window 2048, batch-16 verify, HipGraph-captured | Keep on, but for stability rather than speed (§28.10) |
| MTP | Multi-token-prediction head shipped in the model file | 5.2–6.4× **loss** on the 35B (§25) |
| n-gram draft | Model-free; proposes the continuation of the last matching 12-gram | The only speculator that pays, and only on copying output (§28.8) |
| DSpark | Another speculator, wins the precedence cascade when enabled | Not applicable to this model |
| PFlash | Speculative prefill | Cannot fire on tool-call requests at all (§23.1) |
| CASK | KV **eviction** with a sidecar, not a prefix cache | Actively harmful here (§17.1, §18) |
| Retained PM4 replay | RDNA4 command-buffer replay for the verify path | Slower at every depth (§28.5) |
| Multi-slot | Fixed slot arenas for concurrency | Disqualified: caps context, refuses every speculator (§28.4) |
| VMM KV backend | Virtual-memory KV that pages instead of failing | Good, with one dangerous consequence (§5.3) |

---

## 3. The performance story

### 3.1 The prefill blocker, and the fix

On gfx1201 the fast WMMA prefill-attention kernel is default-on only inside a measured envelope:
head dimension in {64, 128, 256}, context between 256 and 32 768 tokens, and at least 128 workgroups.
Past 32 768 tokens dispatch silently falls back to a legacy tiled-partials kernel that the source's
own comments rate at roughly **one third the throughput per attention pass**.

The ceiling was certified on a model with 8 attention heads and 2 KV heads. This 27B has 24 and 4.
The certification simply does not describe it, and nothing at runtime says so.

Two settings override it:

```
hipfire config set developer.flash_prefill 1
hipfire config set developer.flash_prefill_min_ctx 1000000
```

| 27B prefill, tok/s | 18k | 37k | 55k | 73k |
|---|---|---|---|---|
| default | 469.0 | 260.5 | 108.7 | 80.5 |
| **with both flags** | 468.6 | 326.4 | **231.6** | **146.7** |

**1.82× at 73k**, median of five runs; the range is 1.79–2.27×. The decay exponent moves from −1.324
to −0.797. The second flag matters as much as the first and for a non-obvious reason covered in §6.2.

> Deep-context prefill on this card repeats to only ±27%, against ±3% at shallower depths, because
> the 73k turn is the only one that sustains load long enough to throttle. Quote medians here, never
> a single run.

### 3.2 It still loses to llama.cpp, and by how much

| arm | exponent | R² | @18k | @73k | proj. @164k |
|---|---|---|---|---|---|
| llama.cpp f16 KV | **−0.294** | 0.992 | 901 | 594 | ~476 |
| llama.cpp q8_0 KV | −0.499 | 0.989 | 853 | 424 | ~292 |
| hipfire, fixed | −0.797 | 0.939 | 469 | 146.7 | ~88 |
| hipfire, default | −1.324 | 0.961 | 469 | 80.5 | ~28 |

The fix narrows the 160k gap from roughly 10× to roughly 4.5×. It does not reverse it, and it cannot:
hipfire's best-case draft-free 18k prefill is 569–606 tok/s, and llama.cpp f16 sustains 594 tok/s at
**73k**. The short-context number of one engine is the long-context number of the other.

KV precision is the strongest knob on the llama.cpp side and hipfire has no equivalent. f16 KV does
not merely start faster, it decays more slowly, because q8_0 pays a dequantisation step per attention
block on every token. hipfire offers no f16 KV option (§28.4).

### 3.3 Decode is bandwidth-bound, and the card is throttled

Weights are 16.46 GB and the card's rated bandwidth is 640 GB/s, so **38.9 tok/s is the hard ceiling**
for ordinary decoding before the KV cache is even counted. Measured decode ran well below it:

| arm | 18k | 37k | 55k | 73k |
|---|---|---|---|---|
| DFlash, both flags | 21.9 | 17.8 | 11.7 | 11.4 |
| DFlash + PM4 verify | 15.8 | 14.4 | 9.4 | 9.2 |
| plain AR, draft-free | 29.5 | 27.1 | 25.1 | 23.2 |
| n-gram, copying output | **119.0** | 77.4 | 49.6 | **42.4** |
| llama.cpp with MTP | 55.9 | 63.2 | 54.6 | 41.4 |

The reason plain decoding sits at 23–30 rather than near 38.9 is the card, not the engine. A one-second
clock trace during the runs showed the **memory clock at 400–1000 MHz of a 1265 MHz maximum for 60–90%
of samples, while the card drew 110–175 W under a 210 W cap against a 330 W limit**. That is roughly a
third of rated bandwidth, and the measured decode rates are almost exactly a third of the arithmetic
ceiling. The same cap applied to the llama.cpp arm, so the ranking holds, but every absolute decode
number in this evaluation is a throttled number.

**Consequence: raising the power cap is the single highest-leverage change available, and it is not a
hipfire setting.**

#### Can this reach 50 tok/s?

Asked directly during the evaluation, and the answer is arithmetic rather than a tuning result. Decode
reads every weight plus the whole KV cache per token. The load line pins the KV exactly: 16 of 64
layers carry it, 4 KV heads, 272 bytes each for K and V, so 34 KB per token.

| depth | bytes per token | ceiling at rated bandwidth |
|---|---|---|
| 0 | 16.46 GB | 38.9 tok/s |
| 18k | 17.08 GB | 37.5 tok/s |
| 73k | 18.96 GB | 33.8 tok/s |

**No configuration reaches 50 tok/s by plain decoding at any depth**, even on a perfectly clocked card.
The best plain figure measured was 30.4, already 80% of the depth-adjusted ceiling; the missing 20% is
the throttled memory clock. Fixing the power cap moves 30 toward 38, not toward 50.

But the ceiling is not a hardware bound, because speculation passes it: one weight read serves every
accepted token in a window. **llama.cpp does exactly this on the same card**, decoding 55.9 / 63.2 /
54.6 / 41.4 tok/s across the four depths using the MTP head shipped inside its GGUF. Three of those
are above 50. So 50 tok/s is reachable on this GPU, and the question is why hipfire does not reach it.

The answer is draft quality, not verify machinery. An MTP head is trained jointly with the model and
predicts continuations of arbitrary text, so acceptance holds on prose. hipfire's two working drafts
here are structurally weaker: n-gram is model-free and can only propose text already present in the
context, giving acceptance near 10 when the model quotes and near 0.3 when it composes; DFlash is a
5-layer draft against a 64-layer target and measures 1.7–2.2 on prose. Where hipfire's draft *is*
accurate the engines converge, with n-gram at 42.4 against MTP's 41.4 at 73k.

hipfire cannot simply adopt MTP, for two measured reasons. There is no `.mtp` artifact for this 27B,
and DSpark's required sidecar does not exist either. And on the one model that does have a head,
hipfire's MTP measured **5.2–6.4× slower** than plain decoding, because MTP forwards are graph-
ineligible and invalidate the captured autoregressive graph.

**So a mixed agentic workload will not average above 50 on hipfire with this model** — expect 23–30 on
prose and 42–119 on copying — and no setting changes it. This is the single highest-value engine-side
fix: a trained draft head for the 27B plus graph-eligible MTP forwards, worth roughly 2× decode on
general text.

### 3.4 Speculation is a property of your output text, not of your config

This is the most transferable finding in the evaluation. The model-free n-gram draft proposes whatever
followed the last matching 12-gram in the context. Same engine, same flags, two questions:

| question shape | acceptance τ | decode @18k |
|---|---|---|
| quote three rules verbatim from the context | 10.09 | 119.0 tok/s |
| write 800 words of new analysis | 0.23–0.49 | 14.5 tok/s |

When the model **copies**, the guess is right about ten times per window, one weight read serves eleven
tokens, and decode **exceeds the 38.9 tok/s bandwidth ceiling** — speculation is the only mechanism in
the engine that can. When the model **composes**, the guess is almost always wrong, the window pays for
a draft plus a wider verify pass and collects one token, and the result is *slower than not speculating
at all*.

A 16-turn small-step run caught the mechanism switching mid-benchmark: at turn 7 the model gave up
composing and echoed its earlier turns, acceptance jumped to 6.72, and decode jumped from 14.8 to 34.1
on the same hardware seconds later (§28.9).

Agentic traffic is a mixture. Tool output, quoted code and edit hunks copy. Plans, reviews and
explanations do not. **hipfire has no per-request speculation override**, so one global setting must
serve both, and no setting is right for both.

Note on reading τ: on this model's path `tau = accepted / windows`, i.e. *drafted* tokens accepted per
window, not tokens emitted. The window always emits one free token, so effective tokens per window is
τ + 1, and τ = 0 is plain decoding minus the drafting overhead. hipfire's dense path uses the other
convention. Do not compare the two (§28.8).

### 3.5 Concurrency does not pay

| streams | aggregate | per-stream |
|---|---|---|
| 1 | 31.12 tok/s | 31.12 |
| 2 | 31.20 | 15.60 |
| 4 | 39.89 | 9.97 |

Four concurrent streams buy 1.28× aggregate throughput and per-stream rate collapses to roughly 1/k.
A separate two-stream test measured 1.00–1.05×. Against a 1.5× bar for two streams, this fails. The
reason is the same bandwidth bound: concurrent decoding does not reduce bytes moved per token.

Worse, the default queue timeout of 30 000 ms **drops** excess work rather than queueing it: 2 of 4
concurrent 6.5k requests and 3 of 4 concurrent 26k requests returned HTTP 503. Setting
`serve.queue_timeout_ms = 0` turns those into honest queueing. Continuous batching also imposes a
15 872-token per-lane limit that the single-stream path never sees.

### 3.6 The cache that is not a cache

`memory.prompt_cache_capacity` sounds like a shared prefix cache for system prompts. It is not. It is
a **tokenisation cache for assistant turns** — it stores the token IDs the model emitted so they need
not be re-tokenised. KV reuse is a separate mechanism: hipfire keeps exactly one `conversation_tokens`
sequence and reuses the longest common prefix against it. Any divergence resets to position 0 and
zeroes the DeltaNet state, which is not reversible to an earlier position.

Measured with two agents sharing a 4.4k-token system prompt and holding separate 18k histories:

| request | agent | new input | wall |
|---|---|---|---|
| 1 | A | 70 000 chars | 53.4 s |
| 2 | B | 70 000 chars | 52.2 s |
| 3 | A | **400 chars** | **52.4 s** |
| 4 | B | 400 chars | 52.3 s |

Adding 400 characters to agent A's conversation costs exactly what A's cold first turn cost. Agent B's
first turn shows no benefit from the shared system prompt either. **With more than one conversation in
flight, hipfire's effective prefix cache is zero.** At 73k that is about seven minutes per agent switch.

This is architectural. No setting changes it.

---

## 4. Stability

This is where the evaluation turned from a benchmark into an incident log.

### 4.1 The GPU memory fault that reports itself healthy

On the first large request after a draft-free load, the daemon faults in
`gemm_gate_up_mq4g256v2_wmma_gfx12_bt12`, a gfx12 WMMA gate/up prefill GEMM.

```
Memory Fault Error [host: bipubi, GPU index: 0,
  faulting addr: 0x68f6fa528000, kernel: gemm_gate_up_mq4g256v2_wmma_gfx12_bt12]
```

The daemon does not exit. Ten minutes later `/health` still returns `{"status":"ok"}`, the worker is
in state `R`, the in-flight request never returns, and every subsequent request hangs identically.
Recovery requires `kill -9`.

**`/health` does not touch the GPU, so it reports a wedged engine as healthy.** Any supervisor using it
as a liveness probe — llama-swap's default — will route traffic into a dead daemon indefinitely.

Rate, counting every draft-free boot in the evaluation:

| campaign | boots | faults |
|---|---|---|
| initial | 4 | 1 |
| configuration arms | 9 | 4 |
| warm-up campaign | 6 | 2 |
| **total** | **19** | **7 (37%)** |

Every boot with the DFlash draft loaded was fault-free. The obvious workaround was tested and failed:
six boots each sent a 15-token warm-up before an 18k prompt, the warm-up succeeded every time at
258–269 tok/s, and two of the six still faulted behind it. So the trigger is not first-touch
allocation, it is the first *large* matmul on a draft-free memory layout, and a warm-up big enough to
provoke it would itself be the fault. **There is no configuration-level workaround.**

### 4.2 Cold page cache hangs the model load

The 27B dense model repeatedly stopped advancing at layer 50–54 of 64 and stayed there for fifteen
minutes. Diagnosis: one CPU core pinned, process state `R`, and **no process on the box moved more than
5 MB of disk reads in 20 seconds**. A spin, not slow work. Three theories were raised and falsified,
including an in-process model switch and a slow SATA volume.

What survived: **every cold load hung, every warm load succeeded.** Warm loads completed in 10–21 s,
which at 16.46 GB implies at least 787 MB/s, above SATA line rate, so those were served from RAM.

The operational reading is that a first load after boot, or after the page cache is dropped, may
simply never finish.

### 4.3 Run-to-run spread makes single runs worthless

Five controlled attempts with identical prompt and settings produced decode rates of 16.2, 16.2 and
30.4 tok/s with speculation off, and 23.9 and 40.3 with it on. That is a 1.9× spread with no
speculation to blame it on. Combined with the clock trace in §3.3, the cause is the card's power
management. **No decode claim should rest on fewer than about five runs reported with a spread.**

### 4.4 A false regression, found and retracted

Midway through, the evaluation concluded that ROCm 10 broke DFlash on coding workloads. That was
wrong, and the retraction is more instructive than the finding — see §5.1.

---

## 5. Complexity, and the traps

The config surface is **222 keys**. Several are inert, several are dangerous, and at least three
behave differently from what their names imply. These are the ones that cost real time.

### 5.1 `memory.cask.enabled = false` does not disable CASK

CASK is KV eviction with a sidecar. Setting `enabled = false` leaves the sidecar **path** configured,
and the draft code branches on whether a sidecar is configured, not on whether eviction is enabled:

```rust
let window = match (window, eviction_active) {
    (Some(w), true) => {
        eprintln!("  DFlash windowed mode ({w}) disabled: CASK eviction rebuild is not \
                   ring-aware — falling back to Legacy capped mode");
        None
    }
    (w, _) => w,
};
```

In Legacy mode DFlash does not engage at all. The cost was **6.4× on coding decode**, with no warning
at request time. The only signals were one line at model load and a missing `tau` field in the
response. A configuration that reads as fully disabled was silently costing more than every tuning
gain in the evaluation combined.

```bash
hipfire config unset memory.cask.sidecar   # required; enabled=false is not enough
```

CASK itself, when actually enabled, cost **−47% prefill** at 55k tokens on ROCm 10 (550.9 → 293.2
tok/s). It was a win on the older ROCm and became a loss after the upgrade, which is a general warning:
**every tuning decision made against one driver version needs re-measuring after an upgrade.**

### 5.2 `speculation.mode = auto` selects almost nothing

The entire `auto` arm is one line, and it sets only DSpark. Everything else keeps whatever the config
ladder left. Precedence is structural at load: **DSpark > DFlash > MTP > n-gram**. Consequences:

- A forced global `speculation.mode` **destroys the other model**. Setting `dflash` pins MTP off,
  killing it on the MoE; setting `mtp` pins DFlash off, killing it on the dense model. Use per-model
  overlays, since all `speculation.*` keys are load-scoped and overlay-legal.
- For n-gram alone, `"auto"` means **on**, unlike every other key.
- n-gram is unreachable on a model whose MTP head loads, because MTP wins the cascade first.

### 5.3 The VMM KV backend hides contention instead of failing

The virtual-memory KV backend pages rather than running out of memory. If another process holds VRAM,
hipfire does not error — it gets **slower, with nothing in any log**. Every benchmark in this
evaluation had to gate on exclusive GPU access first, and one early result was invalidated because
llama-swap still held 30 343 of 32 624 MB while hipfire was loading.

### 5.4 The switch with two edges

`developer.flash_prefill = 1` sets the fast-attention opt-in for **every** batched attention call,
including the DFlash **verify** forward. On gfx12 the WMMA route explicitly excludes speculative
verify, so the verify pass fell through to a scalar kernel launching 48 workgroups on a 64-CU part.
Decode collapsed to **6.7 tok/s** — a fix for prefill that silently destroyed decode.

`developer.flash_prefill_min_ctx = 1000000` makes that scalar branch unreachable while leaving ordinary
prefill on the fast route. Decode recovered from 6.7 to 21.9. **The two flags are a pair; the first
without the second is a net loss.**

### 5.5 Things that are inert, retracted or simply do not apply

| Item | Status |
|---|---|
| PFlash (`speculation.prefill.mode`) | Cannot fire on tool-call requests at all |
| DDTree | Retracted as a recommendation |
| Retained PM4 verify | Slower at all four depths, τ unchanged. Leave unset |
| MTP head retraining | Upstream closed the programme: *"Head retraining is a dead end for runtime speedup"* |
| Redline / retained-PM4 replay | Only auto-enabled for `.mq4r` files; this model is `.mq4-pro` |
| f16 KV | Does not exist in hipfire |
| FP8 weights for decode | Would double bytes moved and halve decode; `kernel.fp8_wmma` is compute-side, prefill research only |

### 5.6 Integration cost

hipfire cannot express context depth, KV mode, sampling or speculation on its command line. They come
from `~/.hipfire/config.toml` plus per-model overlays plus the request body. **Two hipfire rows behind
the same supervisor cannot differ in any of those dimensions.** Serving it through llama-swap required
a separate command builder, a rule that hipfire rows must not reuse the common flag macro because the
argument parser rejects `-ngl`, `-fa` and `--jinja` outright, an explicit stop command that talks to
the control socket, a ban on detaching the daemon, and guards that refuse llama.cpp-only row keys
rather than dropping them silently.

One more surprise: the 27B artifact was never adopted into the local registry, so it does not appear in
`hipfire list` or `/v1/models` and must be addressed by absolute path. And every hipfire load logs
`reasoning.effort 'xhigh' dropped: thinking disabled`, meaning **the hipfire rows generate
non-reasoning output** while the llama.cpp rows expose thinking variants. Every wall-time comparison
here is therefore against llama.cpp's non-thinking arm.

---

## 6. When to use hipfire

**Good fit**

- One agent, one conversation, one model, one process. The single-stream path is where the engine's
  strengths live and where none of its caching limits bite.
- Context up to roughly 30–60k tokens, where prefill is still 200–460 tok/s after the fix.
- Copy-heavy generation — refactors, quoting, structured edits, tool-result echoes — where n-gram
  speculation exceeds the bandwidth ceiling and reaches 42–119 tok/s.
- Attended use, where a human notices a wedged daemon.
- RDNA3/RDNA4 hardware where you want kernels written for the architecture rather than through Vulkan.

**Poor fit**

- Multiple agents interleaving against one daemon. Every switch is a full re-prefill, and at 73k that
  is about seven minutes.
- Contexts beyond about 100k, where the exponent gap against llama.cpp compounds.
- Unattended or production serving, until the memory fault is fixed or a GPU-touching liveness probe
  exists.
- Multi-tenant throughput. Concurrency buys 1.28× at four streams.
- Workloads that need per-request engine settings, or two models with different speculators behind one
  supervisor.

---

## 7. How to use it

### 7.1 The configuration

```bash
hipfire config set developer.flash_prefill 1          # the prefill fix
hipfire config set developer.flash_prefill_min_ctx 1000000   # protects decode from the fix
hipfire config set speculation.dflash on              # for stability, not speed
hipfire config set serve.queue_timeout_ms 0           # queue instead of dropping with 503
hipfire config set serve.continuous_batch_size 1      # concurrency does not pay here
hipfire config set serve.multi_slot false             # caps context, refuses speculators
hipfire config unset memory.cask.sidecar              # NOT the same as cask.enabled=false
```

Leave `developer.dflash_verify_pm4` unset. Use per-model overlays rather than a global
`speculation.mode` if you serve more than one model.

### 7.2 Why DFlash stays on when plain decoding is twice as fast at depth

Wall time per turn is prefill-dominated. For a 1024-token answer:

| depth | DFlash: prefill + decode | plain AR: prefill + decode |
|---|---|---|
| 18.3k | 39.2 s + 46.8 s = **86 s** | 30.2 s + 63.6 s = 94 s |
| 73.7k | 448 s + 89.8 s = **538 s** | 569 s + 44.1 s = 613 s |

The draft costs 23–30% of prefill below 37k and repays it above 50k, and prefill is the larger term.
Add the 37% draft-free boot-fault rate and the choice is not close. n-gram beats both on copying
output but shares the draft-free fault, so it is only adoptable behind a supervisor that can detect and
restart a wedged daemon.

### 7.3 Operating rules

1. **Never boot without verifying the GPU is free.** Contention shows up as slowdown with no log line.
2. **Do not use `/health` as a liveness probe.** It answers `ok` for a wedged engine. A probe must
   issue a real generation.
3. **Warm the page cache** before the first load, or accept that a cold load may hang forever.
4. **Re-measure everything after a driver upgrade.** CASK went from a 1.57× win to a 47% loss across
   one ROCm version.
5. **Never quote a decode number from fewer than five runs**, and report the spread with it.
6. **Never quote a decode number from an output under 256 tokens.** Short answers measure startup, not
   throughput.
7. **Report faulted boots as a rate over attempts.** The surviving boots are what the timing tables are
   otherwise silently sampled from.

---

## 8. Consequences for an agentic pipeline

Measured token volumes from a real spec-driven pipeline, per phase invocation. "Cold" means every
request re-prefills, which is hipfire's behaviour with more than one conversation in play.

| phase | samples | cold prefill avg | output avg | avg context |
|---|---|---|---|---|
| specify | 4 | 8.05M | 66.0k | 101 530 |
| plan | 2 | 4.93M | 43.5k | 118 745 |
| tasks | 2 | 7.05M | 40.8k | 140 981 |

Output is under 1% of traffic. **The pipeline is prefill-bound, and the cold-to-warm ratio is 23–27×.**

INFERRED wall time for the front three phases: roughly **30–45 hours on hipfire cold** against roughly
**1.4 hours on llama.cpp warm**. The entire gap is re-prefill, not raw throughput. That is the number
that should drive the engine choice for pipeline work, and it is a caching property rather than a
performance one.

All three phases run at 100–150k tokens of context, past the 73k measurement ceiling, so those hours
are extrapolations.

---

## 9. What would actually move the needle

In return-on-effort order. None of these are settings.

| # | Change | Expected effect |
|---|---|---|
| 1 | Raise the power cap from 210 W toward the 330 W limit | Moves every decode figure for both engines, potentially 2–3× in throttled windows |
| 2 | Allow speculative-verify on the gfx12 WMMA route | DFlash decode at depth without the paired-flag workaround |
| 3 | Re-certify the WMMA context ceiling for 24-head/4-KV-head shapes | Makes the fix the default and removes the flag entirely |
| 4 | Report the `gemm_gate_up` fault upstream with the 7-in-19 reproduction | Unblocks draft-free and n-gram deployment, worth up to 4× decode on copying output |
| 5 | Per-conversation KV checkpoints | Removes the dominant cost of multi-agent work |
| 6 | A liveness probe that exercises the GPU, plus restart-on-fault | Makes the engine deployable unattended ahead of #4 |

---

## 9b. Late results that changed the conclusions

Four measurements taken after the main campaign, each of which narrowed or corrected something above.

**Parity exists, on the right shape.** At 3k in / 10k out — one long coding turn rather than a deep
history — the engines tie: llama.cpp 199.4 s, hipfire 202.0 s, a 1.3 % difference. hipfire decoded
~50.6 tok/s against 50.99. So "slower at every depth" is false at shallow depth, and the engine gap is
a **function of context depth**, not a constant. Deep context and agent switching are where hipfire
loses; a single long generation is a tie.

**The prefill decay is real work, not a reporting artifact.** The obvious suspicion — that hipfire
silently re-prefills each turn and reports only the delta — was tested with the engine's own cache
tracer and refuted. Appending turns reuse the whole prior conversation (15 596 of 15 611 tokens) and
cost 0.4–2.4 s against a 33–35 s cold turn. One fragility survives: an assistant turn truncated by the
token cap is never stored for verbatim splice, so reuse across it depends on re-tokenisation being
stable, and a configured CASK sidecar disables prefix caching entirely.

**MTP beats DFlash by drafting narrow, not wide.** On identical prompts, llama.cpp's MTP drafts ~1
token and accepts 58.6 %, landing 1.59 tokens per 32 ms forward. DFlash drafts a block of 8–16 and
accepts 2.42, landing 3.42 tokens per 93 ms window — three times fewer windows per second. The verify
batch width is nearly free on a bandwidth-bound decode, so the wide draft buys little and costs a
serialised draft chain. The upstream ask should therefore be *a narrow, high-acceptance head*, not a
bigger block. The draft's block size comes from the artifact, not the config, so this is not tunable.

**The memory fault is a class, not an artifact defect.** A second model (`muse-glimmer`, freshly
downloaded and verified) faulted on its first draft-free request in a *different* kernel
(`gemm_hfq4g256_residual_wmma_gfx12_bt12` vs the 27B's `gemm_gate_up_mq4g256v2_wmma_gfx12_bt12`).
Same signature: gfx12 WMMA GEMM, first large request, draft-free layout. Two unrelated models is a far
stronger upstream report than one.

**And the loader hang is a CPU spin, not slow I/O.** Caught with the full 16.47 GB already read
(`rchar`), the loader stalled at layer 34 of 64 burning a core with the memory controller idle.
Priming the page cache with a sequential read before boot is the mitigation; it fixed the 27B (95 s
boot) and cannot fix muse, whose trunk + draft is ~20 GB against ~19 GB of free RAM. Running
llama.cpp between two hipfire boots is enough to evict the cache and trigger it.

## 10. What this evaluation would do differently

Recorded because the methodology cost more than the measurements.

- **A kernel-route change can hide inside an envelope.** A benchmark that samples 6k and 55k tokens
  and interpolates will miss a cliff at 32 768. Sample across suspected thresholds, and read the
  dispatcher source for compiled-in constants before trusting a curve.
- **A prefill switch can be a decode switch.** Any flag that sets a global opt-in must be measured on
  both halves of the workload.
- **Prefix caching must be probed with two conversations.** A single growing conversation proves a
  cache exists; only an interleaved A/B/A probe proves it survives another agent. Here it does not.
- **Speculation must be measured on the output shape it will actually see**, with a byte-identical arm
  measured first. The vendor headline of 258 tok/s came from a synthetic prompt at τ 13.11; real prose
  gave τ 1.7–2.2 and lost to plain decoding past 55k.
- **A trivial warm-up does not prove a boot is healthy.** Probe at the workload's real prompt size.
- **Retract in place.** Two findings in this evaluation were wrong and were corrected only because a
  control arm was run after the conclusion had already been written down. Run the control.
