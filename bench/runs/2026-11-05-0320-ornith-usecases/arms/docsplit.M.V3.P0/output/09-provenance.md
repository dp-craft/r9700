## Provenance

Runner source `8d2c3a00` for every run except the arm-A rows (`d7532e4f` · runner-src `60fdd793`). Sampling and server arguments identical for all local models. T010 nav hash `4ba017016a4b`, red baseline `47b920c37b72` (1993 lines, stub-restored before every iteration). Phase-1 tasks T001–T004, T014, T021, T022, T030, T031 in fixed order. Profiles `bench-27b-a3b-coder`, `bench-27b-unsloth-q4`, `bench-35b-unsloth-q4` registered by `9b99b788`, `40b824a6`, `dca8a6a9`.

BASE and SIM ran on `8d2c3a00` (BASE in the main worktree, SIM in a dedicated worktree at that SHA), same nav bundles, same fixed task order. SIM's nine verbatim runner payloads and all arms' per-task patches are preserved with the campaign evidence. BASE's code is uncommitted — both commit gates rejected it for the pre-existing / phase-boundary reasons in §4.5.

Bench reports (schema `runner-bench/1`): `…-armA-head`, `…-armB-simplify`, `…-merged-35b`, `…-a3b-coder`, `…-unsloth-q4`, `…-unsloth-35b-q4`, `…-brian-q4-block2`, `…-coder-q5-block2`, `…-uns35q5-block2`.
