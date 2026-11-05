## Iron rules

1. **Data provenance — never blend.** Tag every number: `MEASURED` (from our `results_*.jsonl`,
   cite the row `label`), `CLAIMED` (external, cite a source), or `INFERRED` (reasoned, say so).
   A number with no provenance does not go in a doc.
2. **Reproducibility or it didn't happen.** Every run records full parameterization + versions
   (ROCm / llama.cpp build / Mesa / model / quant / ctx / `-ub` / `-b` / `-fa` / KV type). An
   unversioned number is noise — RDNA4 perf swings hard across builds (see the b1295/b9950 gaps).
3. **Sources are Tier-1 first.** External claims cite the whitelist in the research skill
   (llama.cpp/ollama/ROCm/vLLM/Mesa repos, official model cards, Phoronix). Prefer primary
   sources (GitHub issues/PRs, vendor docs) over blog aggregation. Corroborate Tier-2.
4. **Token policy (this repo burns tokens).** Delegate file reading / web search to **haiku**
   subagents — one at a time, waiting for each result before the next (rule 19) — and ask for
   compact structured summaries; don't slurp files into the main context.
   Reserve the expensive model for synthesis and judgement. Keep bulk data in JSONL, not prose.
5. **Documentation is uniform.** Reports → `docs/{research,analysis}/YYYY-MM-DD-HHMM-<slug>.md`,
   English, **summary + table first**, full detail below. Register every new file in `docs/INDEX.md`.
6. **Tools & skills first — improvising is a last resort, not a shortcut.** Every recurring job in
   this repo has a **deterministic tool or a skill** that owns it (registry below). Route the task
   through it. **Do NOT hand-write files (drivers, spec.json, run.sh, fixtures, reports, charts) that
   a tool/skill would produce** — that was the mistake behind *"why are you writing instead of
   calling the proper tool?"*. Before writing any such file by hand you MUST, in order:
   (a) **name the tool/skill** that should cover it and invoke it; (b) if it *almost* fits, run it
   and hand-edit only the genuine gap; (c) only if nothing fits, **stop and state explicitly** —
   "no tool covers X because Y" — and **recommend the tool/skill improvement** (e.g. "add a
   `multi_constraint` grader to `score_deterministic.py`", "teach `gen_campaign.py` a quality track")
   *before* proceeding to write by hand. "It was faster to write it" is not a valid reason.
   Skills: **`/benchmark-new-campaign`** (plan+scaffold a campaign) → **`/benchmark-results`**
   (run+document, memory column mandatory) → **`/research`** (external knowledge → `docs/research/`).
   `gen_campaign.py` emits three kinds: *throughput*, *quality* (capture_engine `tasks` +
   `score_deterministic.py`) and *agentic* (real `claude -p` sessions). Legit hand-written exception
   (must be stated): a **TS quality** campaign (`tsc + eslint + vitest` grading, hardest-tasks harness),
   which no kind emits — reuse `capture.py`+`graders/` (finetune-quality pattern), don't reinvent them.
7. **VRAM: measure, never calculate.** A reported VRAM/GTT *usage* number comes from an actual
   sample (`bench/lib/vram_sampler.py`), tagged `MEASURED`. Never present a calculated estimate as
   usage. (Calculators — `gguf_kv.py`, `gen_campaign.py vram-ctx` — are pre-flight planning bounds /
   guards only, never the reported figure.)
8. **Honor the user's stated values.** When the user fixes a number or parameter, accept and use it.
   Raise a concern *once* if you have one, then comply — never re-litigate it turn after turn.
9. **Change only what was approved — ask first, EVERY time, and wait.** Touch exactly what was agreed,
   nothing more. Brainstorming is not approval to code: a brainstorm/design turn yields a plan, not
   edits. Before touching any existing file beyond what was approved, ask and **wait for the answer** —
   no drive-by fixes, no "while I'm here" refactors, no random edits. Smallest thing that works; no
   overengineering. Stay on the current task.
10. **Think before implementing.** Before editing, trace the connected code, data flow, downstream
    consequences, logical gaps, and consistency with existing behavior. Plan, then act.
11. **Stress-test, then review.** Follow every non-trivial change with a stress test that exercises it
    end-to-end; report the outcome honestly (including failures). Then re-read the change for logical
    gaps and inconsistencies with the rest of the pipeline (a value updated in one place and stale in
    another is the classic one).
12. **Be interactive.** Surface concerns as they arise, recommend concrete options (best first), and
    challenge ideas during brainstorming instead of just agreeing.
13. **Q5_K_M at f16 KV / ctx 163840 fits into VRAM** so all lower values should be accepted without testing (lower model num like Q4, or lower context or Q6 with FP8).
14. **Long runs: edit before you launch, and kill by pidfile.** Never edit a script that is running —
    bash reads it lazily by byte offset, so a mid-run edit resumes at the wrong offset and executes
    garbage. Finish every edit first, then start. Stop a server via its pidfile/port
    (`bench/.servers/<port>.pid`), never a `pgrep -f` pattern that can match its own command line, and
    verify the kill (port free + VRAM idle) before relaunching. An orphaned `llama-server` silently
    contends for VRAM and manufactures fake findings — 2026-07-15 one caused `invalid token`, 10x-slow
    prefill and a false "Q5 f16 @163840 is unstable" report that nearly reached a published analysis.
    **Gate on free VRAM as a precondition, not just as a post-kill check** — read
    `FREE_VRAM` and refuse to boot when it is below the engine's working set. A post-kill check only
    catches what *you* started; the precondition also catches what someone else left behind.
    **Two shapes this rule did not originally cover, both seen 2026-09-10:**
    (a) **llama-swap holds a model resident** after your run finishes — it owns the process, so there
    is no pidfile of yours to kill and the idle timeout may be long or 0. Issue `POST /unload` to its
    port when you are done with it, and treat "my script exited" as unrelated to "the weights left the
    card". (b) **An engine with a split process shape** — hipfire runs `bin/daemon` *and*
    `hipfire serve`; killing only the daemon leaves `serve` holding the port and answering `/health`
    with a stale model, so every subsequent request 500s. Kill every process in the shape, then
    confirm the port is free. **Run `bench/lib/gpu_exclusive.sh [required_free_mib]` instead of
    hand-rolling this** — it unloads llama-swap, kills the whole hipfire shape, waits, and *fails
    loudly naming the holder* if the floor is not met. Trap it encodes: llama-swap's `/unload` is
    **GET; POST returns 405**, and `curl -sf … >/dev/null 2>&1` swallows that completely, so a
    cleanup step can report success and free nothing (2026-09-10, exactly this).
15. **"No error in the log" is not evidence of a clean run — it depends on the allocator.** An
    engine that reserves its whole KV window at load (llama.cpp) turns VRAM contention into a *load
    failure* you cannot miss. An engine with on-demand paging (hipfire's VMM `kv_backend`) has no
    allocation to fail: under contention it degrades into paging and reports **slowdown only** — no
    OOM, nothing in `serve.log`, nothing in `dmesg`. On such an engine the *only* contention evidence
    is residency: `amd-smi process -g 0` showing the daemon holding far less than its known working
    set. 2026-09-10: a hipfire daemon held 4.4 GB against a ~19.4 GB working set while llama-swap
    still had ~27 GB resident, and the whole concurrency sweep it produced had to be discarded.
    Check residency against the expected working set before trusting any hipfire number.
    **The other silent failure on hipfire is a GPU memory fault**: the worker wedges, `/health`
    keeps answering `ok` (it never touches the GPU), and the in-flight request hangs until the
    client's own timeout. 2026-09-10: 2 of 4 DFlash-off boots faulted on their first prompt in
    `gemm_gate_up_mq4g256v2_wmma_gfx12_bt12`. Every probe runner MUST poll `serve.log` for
    `Memory Fault` while a request is in flight and abort the request on sight, and a llama-swap row
    for hipfire MUST NOT rely on `/health` as its liveness check.
16. **Depth is a variable, not a setting — measure the curve, report the exponent.** A single-point
    engine comparison is not a result. Prefill rate decays as a power law in conversation depth and
    **the decay exponents differ enough to reverse the ranking**: measured 2026-09-10 on the 27B,
    llama.cpp f16 KV −0.294, llama.cpp q8_0 KV −0.499, hipfire 27B −1.324, hipfire 35B −1.657
    (R² 0.96–0.99, 4 points each). hipfire leads by 2.3× at 18k and loses by ~10× at 160k; **any
    comparison taken at ≤36k picks the wrong engine.** Take ≥4 depths, fit log-log, quote the
    exponent and R² beside the rates. A projection beyond the deepest measured point is `INFERRED`
    (rule 1) and MUST state the fit range — extrapolating a power law 2.2× past its data is an
    assumption, not a measurement.
17. **Context capacity ≠ per-request prefill size.** A 160k *window* requirement does not mean 160k
    token prompts. The real agentic pattern is incremental growth — load 1–20k, prefill, cache, add
    another 1–20k plus reasoning, repeat until the sum passes 200k — so the honest probe is a
    multi-turn conversation that grows, with prior turns cached, not a one-shot cold prefill at the
    target depth. A cold-prefill probe at 160k measures a request shape that never occurs and misses
    the prefix-reuse behaviour that dominates real cost.
18. **An interrupted run is not a result.** A cut stream, a killed job, a partial file: quarantine it
    and re-collect. Never let it enter the data as a normal row (2026-07-15: a killed generation was
    graded as a real reply — 0.603 with tests=0.0 — and moved a published cell mean by 1.1 pts).
19. **One subagent at a time — sequential, no parallel fan-out.** Launch at most one subagent,
    wait for its result, then launch the next. No parallel/concurrent subagents, no background
    side-quests running alongside the main thread's file work. (Rule 4's "fan out" means
    delegating sequentially, not concurrency.)

