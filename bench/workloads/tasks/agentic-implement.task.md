Think step by step before answering.

Using the codebase in the CONTEXT section as the existing system, implement a new feature:
a `--resume` capability that lets a long-running batch job checkpoint its progress and restart from
the last completed unit of work after a crash.

Deliver:
1. Your reasoning about where checkpoint state should live and the failure modes you must handle
   (put this reasoning inside a <think>...</think> block).
2. The complete implementation: new/changed files with full code, matching the existing style and
   conventions visible in the CONTEXT.
3. A short test plan that exercises the crash/resume path end-to-end.

Write production-quality code. Prefer editing the existing modules over adding parallel ones.
