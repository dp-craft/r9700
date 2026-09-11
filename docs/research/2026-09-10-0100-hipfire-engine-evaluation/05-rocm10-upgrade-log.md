# ROCm 7.13 → 10.0 upgrade — decision, steps, results

Running log. Every command, measurement and consequence lands here as it happens.
Companion to `docs/test/2026-09-10-hipfire-vs-llamacpp-FINAL.md` (the numbers this upgrade is
measured against) and `docs/research/2026-09-10-0100-hipfire-rollout-plan.md` (Phase 0).

**Status:** repo survey done, install not yet run (needs an interactive sudo).

## 1. Why — and the premise that needs correcting

The user's reasoning: *"yes, upgrade. AFAIK the llama cpp is using the same, and it has a LOT of
optimizations"*.

**The llama.cpp arm that produced our baseline does NOT use ROCm.** Measured on this box:

| Engine arm | GPU stack | Evidence |
|---|---|---|
| llama.cpp (baseline, 843 tok/s prefill) | **Vulkan — RADV, Mesa 26.2.2 (kisak PPA)** | `vulkaninfo --summary` → `driverName = radv`, `AMD Radeon AI PRO R9700 (RADV GFX1201)` |
| llama.cpp ROCm row in llama-swap | vendored `libamdhip64.so.7` + `HSA_OVERRIDE_GFX_VERSION=12.0.1` | `generate.py` `ROCM_BIN` env block |
| hipfire | **system ROCm** (`/opt/rocm/core-7.13`, HIP 7.13.99004) | `hipcc --version` |

So llama.cpp's speed advantage is **not** evidence that ROCm 10 is fast — it is evidence that
*Mesa's Vulkan compute path* is fast. The two stacks share nothing but the kernel driver. A ROCm
upgrade cannot transfer llama.cpp's optimizations to hipfire; only hipfire's own code paths change.

**This does not make the upgrade wrong** — see §3 for what it can genuinely fix — but it means the
expected win must not be predicted from the llama.cpp number.

## 2. What is actually available (surveyed 2026-09-10)

### 2.1 Correction to an earlier claim of mine

I previously said the directory index at `repo.radeon.com/rocm/apt/` topping out at 7.2.4 meant
nothing newer existed. Wrong twice over:

- The **index listing is not authoritative.** Both URLs I later quoted return HTTP **200** despite
  being absent from their parent index:
  - `amdgpu-install/31.50/ubuntu/noble/amdgpu-install_31.50.315000-1_all.deb` → 200
  - `rocm/installer/rocm-runfile-installer/rocm-rel-10.0/rocm-installer-10.0.0-4.run` → 200
- The **Radeon line has newer branches** than the one configured here. `rocmradeon/apt/` lists
  `26.12/` (installed), `26.13/`, `26.14/`.

Lesson recorded: probe with `curl -I` for a specific artifact; never conclude absence from an index.

### 2.2 Version per Radeon branch

Read from each branch's `dists/noble/main/binary-amd64/Packages.gz`:

| Branch | ROCm version | Installed here |
|---|---|---|
| `rocmradeon/apt/26.12` | `7.13.0~pre2` | **yes** (current) |
| `rocmradeon/apt/26.13` | `7.14.0~pre3` | no |
| `rocmradeon/apt/26.14` | **`10.0.0~pre4`** | no ← target |

The user's `rocm.docs.amd.com/en/docs-10.0.0/` therefore corresponds to `26.14`, and it **is**
reachable from the already-configured Radeon repo — no `amdgpu-install` deb and no runfile needed.
One line changes in `/etc/apt/sources.list.d/rocm.list`.

### 2.3 Package layout changed — and this is the important finding

| | 26.12 (7.13) | 26.14 (10.0) |
|---|---|---|
| SDK metapackage | `amdrocm-core-sdk-gfx120x` | `amdrocm-core-sdk10.0-gfx1201` |
| Arch granularity | **family** (`gfx120x`) | **exact arch** (`gfx1201`) |
| Install prefix | `/opt/rocm/core-7.13` | `/opt/rocm/core-10.0` (implied by suffix scheme) |

Two consequences:

1. **Every payload package is version-suffixed** (`amdrocm-runtime10.0`, `amdrocm-blas10.0-gfx1201`,
   …), and `Depends:` are pinned `(= 10.0.0~pre4-…)` within a version family. 7.13 and 10.0 are
   therefore **co-installable side by side** — the upgrade does not remove the working stack.
   Rollback is repointing hipfire's `--rocm-root`, not a reinstall.
2. Math libs are now built for **gfx1201 exactly** rather than a `gfx120x` family bundle. If any of
   our slowness came from generic-family kernels, this is where it would show up.

## 3. What the upgrade can and cannot plausibly fix

The measured bottleneck (from the FINAL report): during a 70K prefill the daemon showed
**user:system ticks = 1502:3**, GFX 53–58%, one thread at 89.4% in `R`, the `kfd_wait_on_events`
thread at 0.0%.

| Hypothesis | Does ROCm 10 address it? |
|---|---|
| Single-threaded **userspace** host loop in hipfire | **No.** ROCm lives behind syscalls; 3 system ticks in 10 s means the runtime is barely involved. No runtime version changes hipfire's thread count. |
| Missing/fallback gfx1201 kernel | **Unlikely** — 6.4K prefill hits 100% GFX at 615 tok/s on this same ROCm, `hipfire profile` lists 46 compiled gfx1201 kernels at 100% occupancy, and `serve.log` has zero fallback lines. |
| Generic `gfx120x` math kernels leaving performance on the table | **Possibly** — 26.14 ships exact-`gfx1201` builds. Genuinely new information. |
| Long-context attention kernel quality | **Possibly** — the one place a major version bump could surprise us. |
| Running a `~pre2` **pre-release** on a working box | **Yes, and reason enough on its own** — though 10.0.0 is `~pre4`, i.e. still pre-release. Not a stability win, a freshness one. |

**Honest expectation: low probability of fixing the long-context prefill collapse, non-zero
probability of lifting absolute throughput.** It is worth doing because it is cheap, reversible and
measurable — not because the diagnosis points at it.

## 4. Pre-upgrade state

Captured verbatim in `pre-upgrade-state.txt`. Key rows:

| Item | Value |
|---|---|
| Kernel | `7.0.0-31-generic`, Ubuntu 24.04.5 |
| HIP | `7.13.99004-3309c6114a`, AMD clang 23.0.0git |
| ROCm prefix | `/opt/rocm/core-7.13` (+ `core-7` symlink) |
| `rocminfo` | `gfx1201` / `amdgcn-amd-amdhsa--gfx1201` + `gfx12-generic` |
| Repo | `rocmradeon/apt/26.12 noble main` |
| hipfire | `0.3.0 (800ddf7403d8; beta)` |
| Vulkan | RADV, Mesa 26.2.2, `libvulkan1 1.4.313.0~rc1` |
| `amdgpu-install` | `31.30.0.0` |
| installed `amdrocm-*` | 30+ packages, all `7.13.0~pre2-25753625030` |

**Reference numbers to beat** (medians, from the FINAL report):

| Workload | hipfire (DFlash on) | llama.cpp (Vulkan, MTP, reasoning=none) |
|---|---|---|
| decode tok/s | 120.0 | 66.32 |
| coding decode tok/s | 150.3 | 63.50 |
| prefill @6.4K tok/s | 497.1 (615.3 DFlash off) | 858.35 |
| prefill @70K tok/s | 292.9 (CASK on) / 186.2 (off) | 595.12 |
| 70K wall | 188.51 s | 95.17 s |

## 5. Steps

Order matters — hipfire JIT-compiles and caches kernels against the HIP it was built with, so a
runtime bump without a rebuild is a known way to get *worse* numbers and misattribute them.

| # | Step | Gate |
|---|---|---|
| 5.1 | Stop hipfire daemon, free VRAM | `/health` refuses; daemon PID gone |
| 5.2 | Point `rocm.list` at `26.14`, `apt update` | `apt-cache policy amdrocm-core-sdk10.0-gfx1201` shows `10.0.0~pre4` |
| 5.3 | `apt install amdrocm-core-sdk10.0-gfx1201 amdrocm-core-dev10.0-gfx1201 amdrocm-llvm-dev` | exits 0; **7.13 packages NOT removed** |
| 5.4 | Verify toolchain | `/opt/rocm/core-10.0/bin/hipcc --version` reports 10.x; `rocminfo` still `gfx1201` |
| 5.5 | **Verify Vulkan llama.cpp unaffected** | `:9292` answers, prefill still ~843 tok/s |
| 5.6 | Purge hipfire kernel cache, rebuild against `core-10.0` | `hipfire --version` + `hipfire diag` clean — **never trust `install.sh`'s exit code** |
| 5.7 | Re-run the identical harness | same `bench.py`, `--warmups 10`, nonce on |

### 5.1 result

```
hipfire stop            -> daemon stopped
kill 17423              -> daemon 17423 gone
USED_VRAM 20046 / 32624 MB   (remainder is llama-swap's resident model, unrelated)
```

Also stopped and discarded the in-flight `ctx-scaling` probe (task `b4q7aso03`) on the user's
instruction — *"stop the current test, no reason to continue with so low prefill"*. It had produced
**zero rows**; `ctx-scaling.tsv` was never created. No result to report from it, and the
fallback-cliff vs O(n²) question it was built to answer **remains open**.

### 5.2 onward

Blocked on interactive sudo — `sudo -n true` → *"a password is required"*. Script staged at
`docs/test/rocm-upgrade/install-rocm-10.sh` for the user to run.

## 6. Rollback

| Failure | Undo |
|---|---|
| ROCm 10 misbehaves | 7.13 tree is untouched at `/opt/rocm/core-7.13`; rebuild hipfire with `--rocm-root /opt/rocm/core-7.13` |
| Repo line wrong | restore `rocm.list` to `26.12` (backup written by the script) |
| Vulkan llama.cpp broken | should be impossible — RADV/Mesa shares no package with ROCm; if it happens, that is a finding worth recording, not a rollback |
| hipfire won't build | it is already benched and rejected for adoption; llama.cpp is unaffected either way |

## 7. Multi-version audit (user: *"previously multiple versions caused stability issues"*)

### 7.1 At the package level — currently clean

```
dpkg -l | awk '/^ii +amdrocm/{print $3}' | sort -u   ->   7.13.0~pre2-25753625030   (only)
44 amdrocm-* packages, all one version
/opt/rocm/core-7   ->   /opt/rocm/core-7.13          (single tree)
```

**Exactly one ROCm is installed via dpkg.** So whatever caused the earlier instability is not
currently present in package form. It *would* be reintroduced by installing 10.0 and leaving 7.13 —
hence the purge script.

### 7.2 On disk — four distinct HIP runtimes exist

| Tree | HIP / HSA | Owner | In use? |
|---|---|---|---|
| `/opt/rocm/core-7.13` | 7.13.99004 / hsa 1.21.0 | dpkg | **YES** — hipfire builds and runs against it |
| `dp-craft/amd/bench/llamacpp-b10375` + `dp-craft/amd/bench/llamacpp` | 7.15.0 / hsa 1.21.0 | vendored | **YES** — both are on `ROCM_LIB_PATH` in `generate.py:97`, used by the llama-swap **rocm** row |
| `/usr/local/lib/ollama/rocm_v7_2` (2.5 GB) | 7.2.70201 / hsa 1.18 | ollama | **No** — `systemctl is-enabled ollama` → `not-found`, service inactive, `:11434` not answering |
| `/home/dev/work2/amd-bench/llamacpp` (2.3 GB) | 7.15.0 / hsa 1.21.0 | old bench copy | **No** — unreferenced by any llama-swap / opencode config |

### 7.3 Why these are *not* currently interfering — measured, not assumed

```
LD_LIBRARY_PATH (login shell)      -> unset
/etc/environment, /etc/profile.d   -> no LD_LIBRARY_PATH entries
/etc/ld.so.conf.d/                 -> no rocm/hip entries
ldconfig -p | grep libamdhip64     -> NO MATCHES AT ALL
```

The global linker cache contains **no** HIP library. Every consumer loads its own copy through an
explicit, process-scoped `LD_LIBRARY_PATH` that `generate.py` sets per llama-swap row. There is no
ambient path for a wrong-version library to be picked up from.

**Consequence:** the classic multi-ROCm failure mode — process A resolving process B's
`libamdhip64` through a shared path — is structurally impossible in the current configuration. The
duplicated trees are wasted disk (4.8 GB of genuinely dead weight), not a live stability hazard.
The historical problem was most likely two dpkg-installed versions, which is the case the purge
script prevents.

### 7.4 Removal commands

**a) Old ROCm packages — after 10.0 is installed and hipfire rebuilt.** Gated script, dry-run by
default, refuses to run unless `amdrocm-core10.0-gfx1201` is present:

```bash
sudo bash docs/test/rocm-upgrade/purge-rocm-7.13.sh            # dry run, lists what goes
sudo bash docs/test/rocm-upgrade/purge-rocm-7.13.sh --apply    # actually purge
```

**b) Dead vendored trees — safe to delete now, 4.8 GB reclaimed.** Not run automatically; these are
outside the repo and deletion is not reversible.

```bash
# ollama's private ROCm 7.2 -- ollama is not installed as a service here
sudo rm -rf /usr/local/lib/ollama/rocm_v7_2                    # 2.5 GB

# superseded bench copy, referenced by no config
rm -rf /home/dev/work2/amd-bench/llamacpp                      # 2.3 GB
```

**MUST NOT delete** `dp-craft/amd/bench/llamacpp` or `dp-craft/amd/bench/llamacpp-b10375` — despite
the plain name, the first one is the **second entry of `ROCM_LIB_PATH`** and supplies HIP 7.15 to
the live llama-swap rocm row. Deleting it breaks that row silently.

Caveat on (b): if the `ollama-local` provider in `opencode.json` (11 hand-maintained models) is
still wanted, ollama has to be reinstalled anyway — removing its ROCm 7.2 copy would be redone by
that install. Deleting it now only reclaims space; it does not foreclose anything.

## 8. Run order

```bash
sudo bash docs/test/rocm-upgrade/install-rocm-10.sh
```

Then, gated on it reporting `10.0.0~pre4` and a working `core-10.0/bin/hipcc`:

1. verify Vulkan llama.cpp at `:9292` still answers at ~843 tok/s prefill
2. purge the hipfire kernel cache and rebuild against `/opt/rocm/core-10.0`
3. `sudo bash docs/test/rocm-upgrade/purge-rocm-7.13.sh --apply`
4. re-run `bench.py` with identical flags and append results to §9

## 9. Post-upgrade results

*(empty — nothing installed yet)*

## 10. Attempt 1 — repo switched, install did not run

Run at 08:40. Output ended after step 4:

```
== 1. backing up ... -> rocm.list.bak-20260910-084019
== 2. repointing 26.12 -> 26.14
== 3. apt update
== 4. candidate check (must show 10.0.0~pre4)
amdrocm-core-sdk10.0-gfx1201:
  Installed: (none)
  Candidate: 10.0.0~pre4-32424980240
```

**State afterwards:** repo line is on 26.14, candidate resolves — but `dpkg -l` still shows
**44 packages, all `7.13.0~pre2`, zero `10.0`**, `/opt/rocm` still holds only `core-7.13`, and
`/var/log/apt/history.log` has **no entry at all** for the attempt (last ROCm entry is the original
01:35 7.13 install). dpkg never started.

**Diagnosis: the command timed out during step 5's download, not a package error.** Verified by
simulating the exact install:

```
apt-get -s install amdrocm-core-sdk10.0-gfx1201 amdrocm-core-dev10.0-gfx1201 amdrocm-llvm-dev10.0
  -> 0 upgraded, 52 newly installed, 0 to remove and 2 not upgraded.
```

**52 packages, zero removals, no conflicts** — which also confirms §2.3's co-installability claim
empirically: apt does not want to touch a single 7.13 package to install 10.0.

Footprint measured, since disk is at 92%:

| Metric | Value |
|---|---|
| Download | **1.01 GB** over 52 packages |
| Installed size | **8.18 GB** |
| `/opt/rocm` today (7.13) | 8.7 GB |
| Free on `/` | 29 GB |

Fits with room to spare, and purging 7.13 afterwards returns ~8.7 GB.

**Consequence — script changed.** `install-rocm-10.sh` is now **idempotent**: if `rocm.list` is
already on 26.14 it skips the backup/sed rather than making a second backup, so a re-run resumes
cleanly. The abort path no longer assumes a backup was made this run.

**Consequence — invocation changed.** A ~1 GB download exceeds the foreground command timeout, so
the install must be detached:

```bash
sudo nohup bash docs/test/rocm-upgrade/install-rocm-10.sh > /tmp/rocm10.log 2>&1 &
```

## 11. Attempt 2 — same stop, real root cause found (my bug)

Relaunched detached (`nohup … &`, returned `[1] 31502`). The idempotent guard worked —
`== 1-2. repo already on 26.14, skipping (resumable re-run)` — but the log again ended at step 4's
version table, with **no `apt-get` process running** and still zero 10.0 packages.

So the timeout theory in §10 was **wrong**. Detaching changed nothing because the script was never
being killed from outside — it was exiting on its own, at the same line, both times.

**Root cause: `set -euo pipefail` + `head`.**

```bash
apt-cache policy amdrocm-core-sdk10.0-gfx1201 | head -4
```

`head -4` exits after four lines and closes the pipe. `apt-cache` then dies of **SIGPIPE → exit
141**. `pipefail` makes the whole pipeline return 141, and `set -e` aborts the script — silently,
because the failing command had already printed its (successful-looking) output. The last thing
visible is exactly what both logs showed.

The `|| true` I had put on the *later* diagnostic pipes masked the same hazard there, which is why
only this one bit.

**Fix:** `|| true` on every `… | head` pipeline in both scripts. Same class of bug was present in
`purge-rocm-7.13.sh` (three pipelines) and was fixed there too before it could bite.

**Lesson for this repo's scripts:** under `pipefail`, any `cmd | head`/`| grep -m` is a latent
`set -e` abort. It is not a hypothetical — it cost two run attempts here and produced a failure mode
that looks exactly like a network timeout.

This also retro-explains the Phase 0 note that `install.sh` "exited 0 despite the build failing":
same family of problem — trusting an exit status that does not mean what it appears to mean. Gate on
an observable artifact (`dpkg -l`, `hipfire --version`), never on the script's own exit code.

## 12. Attempt 3 — same bug, second pipeline. Incomplete fix.

The `head -4` fix let step 4 print, then the script took the **abort** branch:

```
  Candidate: 10.0.0~pre4-32424980240
  Version table:
!! 10.0.0~pre4 not offered -- restoring /etc/apt/sources.list.d/rocm.list and aborting
```

The candidate it claims is missing is printed one line above it. Cause is identical and I had fixed
only half of it: the gate itself is a pipeline.

```bash
apt-cache policy amdrocm-core-sdk10.0-gfx1201 | grep -q '10\.0\.0~pre4' || { … }
```

`grep -q` exits **on first match** — success makes it close the pipe *sooner*, so `apt-cache` takes
SIGPIPE, `pipefail` returns 141, and the `||` fires. The gate inverted: **the better the match, the
more reliably it failed.**

Damage was contained by luck — the abort path is `[ -f "$LIST.bak-$STAMP" ] && cp … && apt-get
update`, and the idempotent re-run made no backup this time, so the `&&` chain short-circuited and
the repo line was **not** reverted despite the message saying it was. Verified: `rocm.list` still
reads `26.14`. (A message that lies about what it did is its own defect; the `case` rewrite removes
the restore attempt entirely.)

**Fix — step 4 is now pipe-free**, capturing once and matching with `case`:

```bash
POLICY=$(apt-cache policy amdrocm-core-sdk10.0-gfx1201)
printf '%s\n' "$POLICY" | sed -n '1,4p'
case "$POLICY" in
  *'10.0.0~pre4'*) echo "   candidate ok" ;;
  *) echo "!! not offered -- aborting (repo line left as-is)"; exit 1 ;;
esac
```

`sed -n '1,4p'` reads its whole input, so it cannot SIGPIPE the writer the way `head` does.

**Verified before handing back** — the gate was executed live as a non-root user:

```
apt-cache rc=0
  Candidate: 10.0.0~pre4-32424980240
   -> MATCH: candidate ok (gate will PASS)
```

Also audited the rest of the script and guarded `grep -H rocmradeon "$LIST"`, which returns 1 on no
match and would have aborted under `set -e` for the same family of reason.

**Three attempts, one defect, two halves.** The honest lesson is that §10's "network timeout"
diagnosis was invented to fit the evidence rather than derived from it — no timeout was ever
observed, and the same silent-exit signature was visible from attempt 1. Checking `pgrep` for a
running `apt-get` (there never was one) would have falsified it immediately.

## 13. Attempt 4 — installed

```
t=15s  10.0-pkgs=0   apt=1 dpkg=0
t=30s  10.0-pkgs=0   apt=1 dpkg=1
t=75s  10.0-pkgs=52  apt=0 dpkg=0   ALL 52 INSTALLED
```

Under 90 seconds, start to finish — the 1 GB download was never the problem.

### 13.1 The headline finding: ROCm 10.0.0 ships HIP **7.15**

| Tree | ROCm version | HIP runtime |
|---|---|---|
| `/opt/rocm/core-7.13` | 7.13 | `7.13.99004-3309c6114a` |
| `/opt/rocm/core-10.0` | **10.0.0** (`.info/version`) | **`7.15.26333-0000000`** |

The product version and the HIP runtime version are **decoupled**. "ROCm 10" is a marketing/release
number; the HIP runtime inside it went 7.13 → 7.15.

**This partially vindicates the user's premise and corrects my §1 pushback.** I argued llama.cpp
couldn't be evidence for a ROCm win because its fast arm is Vulkan. That remains true of the
*baseline* arm. But llama.cpp's **ROCm** build vendors:

```
/home/dev/work/dp-craft/amd/bench/llamacpp/libamdhip64.so.7.15.0-0000000
```

**HIP 7.15** — the exact runtime ROCm 10.0.0 has now brought to the system. So llama.cpp's ROCm
build *was* already running a newer HIP than hipfire, and hipfire was the odd one out at 7.13. The
user's "llama cpp is using the same, and it has a LOT of optimizations" was right about the
direction; I was right only about which llama.cpp arm produced the 843 tok/s number. Recorded as a
correction against myself.

### 13.2 Post-install state

| Check | Result |
|---|---|
| `/opt/rocm` trees | `core-7`, `core-7.13`, `core-10`, `core-10.0` (side-by-side, as predicted) |
| `core-10.0/bin/hipcc` | present, AMD clang 23.0.0git `8f497e0992fb` |
| `core-10.0/bin/rocminfo` | `amdgcn-amd-amdhsa--gfx1201` + `gfx12-generic` |
| Packages removed | **0** |
| Disk | 20 GB free (95%); purging 7.13 returns ~8.7 GB |

### 13.3 Vulkan llama.cpp — unaffected, verified

| Check | Result |
|---|---|
| `:9292/v1/models` | **41 models**, responding |
| `mesa-vulkan-drivers` | `26.2.2~kisak1~n` (unchanged) |
| `libvulkan1` | `1.4.313.0~rc1` (unchanged) |
| `vulkaninfo` | `driverName = radv`, Mesa 26.2.2 (unchanged) |
| apt history this run | no `Remove:` / `Upgrade:` lines outside the ROCm set |

As predicted in §6 — RADV/Mesa shares no package with ROCm.

## 14. Rebuild — isolating the variable

`install.json` from the 7.13 build recorded `"rocm_root": "/opt/rocm"` — **not** a versioned path.
With four `core-*` trees now under that root, which one a fresh build resolves is ambiguous, and
that ambiguity is precisely the multi-version hazard flagged in §7. So the rebuild **pins the root
explicitly** to `/opt/rocm/core-10.0`.

It also pins the **commit** to `800ddf7403d85e3745d0ac6492e4cb84c74cb7b1`, identical to the 7.13
build. `--branch beta` would have been free to advance the source and confound ROCm with a hipfire
code change. ROCm is the only variable that moves.

Stale JIT kernel cache moved aside rather than deleted, so it can be restored if needed:

```
/home/dev/.hipfire_kernels (7.0M, compiled against HIP 7.13)
  -> /home/dev/.hipfire_kernels.hip713.bak
```

The `cc` shim trap from Phase 0 is **still live** — `command -v cc` resolves to
`/home/dev/scripts//cc`, the `claude --dangerously-skip-permissions` launcher. The rebuild script
prepends `/usr/bin` and sets `CC`/`CXX` explicitly, and logs what `cc` resolved to so a silent
recurrence is visible in the log.

Build command:

```bash
PATH=/usr/bin:$HOME/.cargo/bin:… CC=/usr/bin/cc CXX=/usr/bin/c++ \
bash ~/.hipfire/src/scripts/install.sh \
  --commit 800ddf7403d85e3745d0ac6492e4cb84c74cb7b1 \
  --rocm-root /opt/rocm/core-10.0 --gpu-arch gfx1201 --strict-rocm --yes
```

Gated on `hipfire --version` + `hipfire diag`, never on `install.sh`'s exit status (§Phase 0: it
exits 0 on a failed build).

## 15. Benchmark — the upgrade is a REGRESSION

Same commit (`800ddf7403d8`), same harness, same flags (`--warmups 10 --reps 3`, nonce on),
same config arm (DFlash off, CASK off, reasoning off). **ROCm is the only variable.**

### 15.1 Two false starts first (both mine, both recorded)

**(a) VRAM starvation.** The first attempt sat at GFX 4% / ~10 W with the daemon at 100% of one
core. Two causes, neither of them the GPU:

- the kernel cache had been purged on purpose, so hipfire was **JIT-compiling 556 kernels against
  HIP 7.15** — CPU work, one-time, expected;
- llama-swap still held its 130K-context model resident: **`USED_VRAM 30343 / 32624 MB`** while
  hipfire needed ~16.5 GB and was at `loading layer 36/64`. It could never have finished.

My bench script had dropped the GPU-exclusivity step that `llamacpp-arms.sh` performs deliberately.
`GET /unload` (POST returns 200 and does nothing) took VRAM `20057 MB -> 730 MB`.

**(b) `pkill -f` self-kill, exit 144** — again. The pattern `/home/dev/.hipfire/bin/daemon` matched
the *shell's own* command line. Resolved PIDs via `ps -eo pid,comm` / `ss -lptn` instead. This is
the second time this exact trap has fired in this work; it belongs in the plan doc, not just here.

Final run: llama-swap **killed outright**, GPU idle at `537 MB / GFX 2%` before start, hipfire
restarted with the card exclusive. GFX held **100%** throughout.

### 15.2 Results

hipfire, DFlash off / CASK off, 6.4K prefill workload:

| Metric | ROCm 7.13 (HIP 7.13) | ROCm 10.0 (HIP 7.15) | Δ |
|---|---|---|---|
| **prefill tok/s** (isolated) | **614.1** | **553.8** | **−9.8 %** |
| coding prefill tok/s | 571.7 | 562.4 | −1.6 % |
| decode-workload prefill tok/s | 509.2 | 530.4 | +4.2 % |
| **decode tok/s** | **28.9** | **28.9** | **0.0 %** |
| coding decode tok/s | 28.9 | 28.9 | 0.0 % |

### 15.3 Is the −9.8 % real, or noise?

Real. The distributions do not overlap:

| | n | median | min | max | stdev |
|---|---|---|---|---|---|
| ROCm 7.13 prefill | 26 | 614.1 | 609.3 | 618.6 | **2.9** |
| ROCm 10.0 prefill | 13 | 553.8 | 334.4 | **554.7** | 58.5 |

ROCm 10's **maximum (554.7) sits below ROCm 7.13's minimum (609.3)**. The 7.13 arm is exceptionally
tight (stdev 2.9, and independently reproduced four times by the chunk sweep at 614.0/615.1/615.2/
615.3). The 334.4 outlier is the first post-JIT request. The coding and decode workloads *do*
overlap and are not individually conclusive — the isolated prefill workload is.

### 15.4 What this establishes

1. **The user's hypothesis is falsified.** ROCm version is *not* the cause of the high CPU at
   prefill. The newer runtime made isolated prefill ~10 % **worse**, and the single-threaded host
   loop is untouched — as §3 predicted from the 1502:3 user:system tick ratio.
2. **Decode is exactly unchanged — 28.9 vs 28.9, stdev 0.058.** A decode path that does not move at
   all across a two-minor-version HIP bump was never ROCm-bound to begin with.
3. **HIP 7.15 is not automatically better on gfx1201**, even though llama.cpp's ROCm build vendors
   it. Whatever llama.cpp gains from 7.15, hipfire does not — different kernels, different dispatch.
4. The gfx1201 **exact-arch** math libraries (vs 7.13's `gfx120x` family bundle) did not produce the
   hoped-for win. That was the most plausible mechanism in §3 and it is now tested and negative.

### 15.5 Consequence — the purge decision inverts

`purge-rocm-7.13.sh` was written to remove the old stack. **On the measured evidence, 7.13 is the
better stack for this workload**, so purging it would delete the faster configuration and leave the
slower one installed.

The user's standing instruction ("remove the old one, multiple versions caused stability issues")
and the measurement now point in opposite directions. This is a decision for the user, not a default
to apply silently. Options:

| Option | Action | Result |
|---|---|---|
| **A — revert** | rebuild hipfire `--rocm-root /opt/rocm/core-7.13`, then purge the **10.0** packages | one ROCm installed; prefill back to 614; loses the newer stack |
| **B — keep 10.0** | purge 7.13 as planned | one ROCm installed; accept −9.8 % prefill |
| **C — stay dual** | change nothing | both installed; contradicts the single-version instruction |

Neither A nor B leaves two versions installed, so the stability concern is satisfiable either way.
**Recommendation: A**, since hipfire is the only consumer of the system ROCm, it is measurably
faster on 7.13, and the whole reason for the upgrade — closing a prefill gap — has been falsified.

Note the kernel cache is version-specific: whichever way this goes, `~/.hipfire_kernels` must be
purged and hipfire rebuilt. The HIP 7.13 cache is preserved at `~/.hipfire_kernels.hip713.bak`.

### 15.6 Still running

The ~70K long-context arm (`rocm10-longctx-cask-off`) against the ROCm 7.13 reference of
**186.1 tok/s** — the workload the runner actually operates in (`numCtx: 131072`). Results in §16.

## 16. Long context — ROCm 10 fixes the collapse. §15's verdict reverses.

Identical workload (`LOREM_UNIT * 1900`, **55,153 prompt tokens**), identical commit, CASK **off**
in both hipfire arms, GPU exclusive.

| Arm | prefill tok/s | wall |
|---|---|---|
| hipfire, ROCm 7.13, CASK off | 186.2 | 296.59 s |
| hipfire, ROCm 7.13, CASK **on** | 292.8 | 188.57 s |
| **hipfire, ROCm 10.0, CASK off** | **550.9** | **100.45 s** |
| llama.cpp Vulkan (reference) | 595.3 | 95.34 s |

- **2.96×** faster than the same configuration on 7.13
- **1.88×** faster than 7.13 *with CASK enabled* — while CASK is off
- wall time **−196 s**
- gap to llama.cpp: was **3.2×**, now **8 %**

### 16.1 The decisive statistic

Prefill degradation from 6.4K to 55K tokens, same engine, same build:

| ROCm | 6.4K | 55K | degradation |
|---|---|---|---|
| 7.13 | 614.1 | 186.2 | **3.30×** |
| 10.0 | 553.8 | 550.9 | **1.005× — flat** |

Long-context prefill on ROCm 10 is, within noise, **as fast as short-context prefill**. The collapse
is gone, not reduced.

### 16.2 I was wrong, and the user was right

§3 rated "long-context attention kernel quality" a *possible* win and the overall odds "**low
probability of fixing the long-context prefill collapse**". §15 then read the −9.8 % short-prefill
regression as the whole story and recommended reverting.

Both were wrong, and the error was one inference: I treated the **user:system tick ratio of 1502:3**
as proof the bottleneck could not be in ROCm, because "ROCm lives behind syscalls". That is true of
*driver* time but not of *kernel selection* — a poor or missing long-context attention kernel makes
the host do work that is genuinely userspace CPU time. The measurement was right; the conclusion
drawn from it did not follow.

The user's reasoning — llama.cpp runs a newer HIP and it has a lot of optimizations — reached the
correct answer, and pushed the upgrade through over my assessment.

**Consequence: the §15.5 recommendation is withdrawn.** Correct action is **B — keep ROCm 10.0,
purge 7.13**. −9.8 % on 6.4K prefill is a trivial cost against 2.96× at 55K, which is the regime
`runner.config.json` actually operates in (`numCtx: 131072`, `contextBudgetTokens: 204800`).

### 16.3 Consequences for CASK and DFlash

CASK bought +57 % prefill on 7.13 by working around the broken path, at −18 % decode. On ROCm 10 the
path it compensated for is fixed, and CASK-**off** already beats 7.13's CASK-**on** by 1.88×. So
CASK may now be **unnecessary or harmful** — and its calibration was flagged
`⚠ CONTAMINATED by corpus/val-prompt overlap` anyway, meaning its accuracy was never established.
DFlash likewise was tuned against the old kernel path. Both re-measured in §17.

### 16.4 The "patched driver" question

Checked, because the user suggested the vendored driver in `dp-craft/amd` might explain llama.cpp's
lead:

| Check | Result |
|---|---|
| `llama.cpp-src` local commits (`origin/master..HEAD`) | **none** |
| working tree | clean |
| `*.patch` / `*.diff` in the tree | none |
| vendored `libamdhip64.so.7.15.0-0000000` | 29.0 MB, mtime **2026-07-10** |
| system `libamdhip64.so.7.15.26333-0000000` | 28.2 MB, mtime **2026-08-21**, built from `rockrel` CI |

llama.cpp itself is **stock upstream 6fdd0ac**. The vendored HIP is a distinct, earlier 7.15 build
(nightly-style, no build hash) — not stock ROCm, but not a patched *llama.cpp* either. With hipfire
now within 8 % of llama.cpp on the same long-context workload, there is no large residual gap left
for a patched runtime to explain.

## 17. DFlash and CASK re-measured on ROCm 10 — mixed, with one serious regression

Both features were tuned against the ROCm 7.13 kernel path, so both were re-run.

### 17.1 CASK is now actively harmful

Long context (55,153 tokens), ROCm 10.0:

| CASK | prefill tok/s | wall |
|---|---|---|
| **off** | **550.9** | **100.45 s** |
| on | 293.2 | 188.33 s |

CASK **on** costs **−47 % prefill and +88 s wall**. Note where it lands: 293.2 tok/s / 188.33 s is
statistically indistinguishable from CASK-on under ROCm 7.13 (292.8 / 188.57 s).

**CASK pins throughput to ~293 tok/s regardless of ROCm version.** That is consistent with its
mechanism — matrix-folding replaces the attention path with its own, so it neither suffered from
7.13's broken kernel nor benefits from 10.0's fixed one. On 7.13 that was a +57 % rescue; on 10.0 it
is a 1.88× penalty.

**Action: `memory.cask.enabled = false` on ROCm 10.** Its calibration was flagged
`⚠ CONTAMINATED by corpus/val-prompt overlap` anyway, so nothing of proven value is lost.

### 17.2 DFlash — big win on decode, and a silent failure on coding

| Workload | metric | ROCm 7.13 | ROCm 10.0 | Δ |
|---|---|---|---|---|
| decode | decode tok/s | 119.9 | **157.9** | **+31.7 %** |
| decode | `tau` | 10.36 | 10.36 | unchanged |
| prefill | prefill tok/s | 496.5 | 550.5 | +10.9 % |
| **coding** | **decode tok/s** | **150.2** | **28.7** | **−81 %** |
| **coding** | **`tau`** | **10.6** | **absent** | **DFlash never engaged** |

The decode workload speculates exactly as before (`tau` 10.36 in both) and gains 32 %. But on the
**coding** workload ROCm 10 reports **no `tau` field at all**, and decode lands at 28.7 — the
DFlash-*off* rate (28.9). Consistent across all 14 samples in the run, so it is reproducible within
the run, not a stray.

**DFlash silently stops speculating on the coding workload under ROCm 10.** No error, no warning —
only the missing counter and a 5.2× slower decode betray it. This is the workload that matters most
for the runner.

### 17.3 Net picture

| Dimension | Δ from ROCm 10 | Weight |
|---|---|---|
| long-context prefill (55K, CASK off) | **+196 %** (186.2 → 550.9) | the runner's actual regime |
| decode with DFlash | **+31.7 %** (119.9 → 157.9) | high |
| prefill with DFlash | +10.9 % | moderate |
| short prefill, no DFlash (6.4K) | −9.8 % (614.1 → 553.8) | low |
| **coding decode with DFlash** | **−81 %** (150.2 → 28.7) | **high — regression** |
| CASK at long context | now −47 %; disable it | config change, not a loss |

**Verdict: keep ROCm 10.0**, with `memory.cask.enabled=false`. The long-context fix is worth far
more than the short-prefill loss. But **the coding/DFlash regression is unresolved and must not be
papered over** — it is the single workload closest to real runner traffic, and an 81 % decode loss
there could outweigh the long-context gain in day-to-day use.

**Open — required before any adoption decision:**

1. Reproduce the coding/DFlash failure in an isolated run (not just within this batch).
2. Determine why `tau` is absent — check `serve.log` for a draft-model load or acceptance failure
   under HIP 7.15.
3. Re-run the coding arm with DFlash on after a clean daemon restart, to rule out state carried over
   from the CASK-on arm in the same script.
4. Only then re-run the full cross-engine comparison and supersede
   `docs/test/2026-09-10-hipfire-vs-llamacpp-FINAL.md`.

## 18. ROOT CAUSE of the coding decode collapse — the CASK sidecar, not ROCm

**§17.2 is retracted.** The coding/DFlash failure is not a ROCm 10 regression. It is a
configuration side-effect that this session introduced when it generated the CASK sidecar, and it
was present on ROCm 7.13 too — the 7.13 DFlash benchmark simply ran *before* the sidecar existed.

### 18.1 The evidence chain

**Step 1 — reproduce.** Clean daemon, DFlash on, CASK `enabled=false`:

| request | prompt | out | `dflash` | `tau` | decode |
|---|---|---|---|---|---|
| count 1..200 | 58 | 512 | True | 10.61 | 125.2 |
| coding | 192 | 174 | **None** | None | 19.0 |
| **plain prose** | 447 | 512 | **None** | None | 18.7 |

The prose case rules out content: it is not code, and it still fails. First working theory was
prompt length.

**Step 2 — length is falsified.** Bisect at 71→462 prompt tokens: **every one succeeded**
(`dflash=True`, tau 9.2–10.09). `DEFAULT_DFLASH_CTX_CAP` is **8192**, so a 192-token prompt was
never near a cap. Ordering was falsified too — coding worked as the first request, after a 512-token
generation, after a 6k prompt, and after a real 25.5k-token project prompt.

The one thing that had changed between the failing and passing probes: the bisect script **unset
`memory.cask.sidecar`** halfway through.

**Step 3 — controlled A/B.** Only variable is the sidecar path. `memory.cask.enabled=false` in both:

| | coding (174 out) | 30k ctx, 3.6–4k out |
|---|---|---|
| **sidecar configured** | 18.9 tok/s · `dflash=None` | 18.5 tok/s · `dflash=None` |
| **sidecar unset** | **121.9 tok/s** · tau 11.43 | **28.3 tok/s** · tau 3.18 |

**6.4× on coding, +53 % on the long-context long-output case.**

Daemon log, verbatim:

```
configured: DFlash windowed mode (2048) disabled: CASK eviction rebuild is not ring-aware
            — falling back to Legacy capped mode
unset     : DFlash2 draft windowed: all 5 layers sliding at W=2048 [from draft metadata]
```

**Step 4 — source.** `crates/hipfire-arch-qwen35/src/dflash_spec.rs:196`:

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

`eviction_active` is true whenever a CASK eviction sidecar is *configured*, independent of
`memory.cask.enabled`. Windowed mode is then refused, and in Legacy mode DFlash does not engage for
these requests at all.

### 18.2 The trap, stated plainly

**`memory.cask.enabled = false` does NOT disable CASK's effect on DFlash. The sidecar *path* must be
unset.** A config that looks fully disabled silently costs 6.4× on coding decode, with no warning at
request time — the only signal is one line at model load and a missing `tau` field in the response.

```bash
hipfire config unset memory.cask.sidecar     # required; enabled=false is not enough
```

### 18.3 Consequences

- §17.2's claim that "DFlash silently stops speculating under ROCm 10" is **withdrawn**.
- `rocm10-dflash-on.jsonl` is **invalid** for the coding and prefill workloads — it was collected
  with the sidecar configured. Superseded by `rocm10-dflash-on-nosidecar`.
- The ROCm 7.13 DFlash numbers in `04-bench-rocm713-final.md` were collected *pre-sidecar* and are
  therefore the fair comparison point.
- CASK is doubly condemned: §17.1 showed it costs 47 % at long context when enabled, and §18 shows
  merely *configuring* its sidecar costs 6.4 % … 6.4× on decode. It should be removed from the
  config entirely, not just disabled.
- Methodological lesson: the sidecar was generated mid-session, between the 7.13 and ROCm 10 DFlash
  arms. Two variables moved between those runs and I attributed the delta to the one I was looking
  for. A config snapshot per bench arm — not just per session — would have caught it immediately.

### 18.4 Realistic long-context numbers (real project text, 25.5k prompt)

Now measurable, with DFlash actually engaged. `tau` degrades with context depth, as expected for a
sliding-window draft:

| prompt tokens | out | tau | decode tok/s |
|---|---|---|---|
| ~60 | 512 | 10.1–10.6 | 116–125 |
| 6,046 | 11 | 4.5 | 32.4 |
| 25,488 | 227 | 3.05 | 24.7 |
| 25,504 | 4,096 | 3.18 | 28.3 |

## 19. Ornith-1.5 35B-A3B (MoE) on ROCm 10 — measured

> **RETRACTED IN PART (§25.3).** Every **decode** figure in this section was taken with MTP engaged
> and does not reproduce: the same workload shape now measures 27.9 tok/s, not 106.3, and with MTP
> **off** the model reaches ~177 tok/s. The cause of the discrepancy is unknown. Prefill figures are
> unaffected. Do not quote §19.1's decode column or §19.4's decode verdict.

New model store: `~/models/hipfire` (which is `/mnt/LinBackup/models/hipfire`, a **separate volume**
from `/`). `~/.hipfire/models` is now a symlink to it, and `HIPFIRE_MODELS_DIR` is exported in
`~/.bashrc` — that variable is in `BOOTSTRAP_ENV` and is therefore read from the environment only,
never from `config.toml`.

Artifacts: `ornith-1.5-35b-a3b.mq4r` (18.70 GB) + `ornith-1.5-35b-a3b.mtp` (0.485 GB).
Unlike the 27B `.mq4-pro`, this one **registers correctly** in `hipfire list`.

**There is no 35B DFlash draft.** Every DFlash draft in the registry is 27B or 9B. The 35B MoE
family speculates via an `.mtp` head instead, loaded automatically:

```
MTP head loaded (sidecar …/ornith-1.5-35b-a3b.mtp): n_embd=2048 vocab=248320
qwen35 MTP speculator enabled (compressed-serial, K=3)
[redline] enabling fail-closed retained default on gfx1201 (drafter=mtp, transport=pm4)
```

### 19.1 Results — all three engines, ROCm 10

| Workload | **35B MoE** (mq4r+MTP) | 27B dense (mq4-pro+DFlash) | llama.cpp 27B (Vulkan) |
|---|---|---|---|
| **prefill @6.4K tok/s** | **1990.0** | 489.7 | 858.4 |
| coding prefill tok/s | **1399.1** | 478.2 | 370.8 |
| decode tok/s | 106.3 | **156.9** | 66.3 |
| coding decode tok/s | 110.2 | **152.0** | 63.5 |
| coding wall | 1.701 s | **1.547 s** | 3.27 s |
| longctx @55K prefill | 467.3 | **550.9** | 595.3 |
| longctx wall | 118.2 s | **100.5 s** | 95.3 s |
| VRAM resident | 24.6 GB | ~20 GB | ~20 GB |

### 19.2 What the numbers say

**Prefill is transformed: 1990 tok/s at 6.4K — 4.1× the 27B dense and 2.3× llama.cpp.** This is the
MoE structure paying off exactly where it should: prefill is compute-bound, and only ~3B of 35B
parameters are active. The one workload where hipfire had been losing to llama.cpp is now a
2.3× win.

**Decode is 32 % slower than the 27B**, and the cause is the speculator, not the model:

| | drafter | tau |
|---|---|---|
| 27B dense | DFlash (windowed W=2048) | **10.4** |
| 35B MoE | MTP (compressed-serial, K=3) | **1.13** |

MTP with K=3 caps at ~3 accepted tokens per window and measured 1.13; DFlash accepts ~10. So the
35B decodes fast *per token* (3B active) but gains almost nothing from speculation, while the 27B
gains ~4×. This is a property of the artifact, not a tuning miss — no 35B DFlash draft exists.

**Long context is slightly worse than the 27B** (467 vs 551 tok/s; 118 vs 100 s wall) — the MoE's
prefill advantage does not survive to 55K, where attention over the KV dominates and expert sparsity
stops helping.

### 19.3 Operational finding: default KV budget rejects 55K

First long-context attempt failed outright:

```
HTTP 400: request exceeds loaded KV budget:
  seq_pos=0 + prefill=55150 + max_tokens=16 + trailer=1 > physical_cap=32768
  — reload model with a larger max_seq
```

`memory.max_seq` defaults to **32768**. Raising it to 65536 and reloading works, at 24.6 GB resident
(≈8 GB headroom). This is a per-load property — it must be set *before* `hipfire serve`, and it is
the kind of thing a llama-swap row would have to carry explicitly in Phase 3.

### 19.4 Which model to prefer

| If the work is… | Prefer |
|---|---|
| prefill-heavy (large context in, short answer out) | **35B MoE** — 4.1× the 27B |
| decode-heavy (long generations) | **27B dense** — DFlash tau 10.4 vs MTP 1.13 |
| long context (>50K) | **27B dense**, marginally |
| mixed coding turns | near tie — 1.70 s vs 1.55 s wall |

Quality is still unmeasured for both. The 35B is a larger model with a different lineage
(Qwen3.5-family VL finetune) and may well be stronger per token; nothing here tests that.

## 20. Phase 2 entry — the daemon cannot switch models in-process (HANG)

Phase 1's gate is passed, so the plan (`02-rollout-plan.md`) says Phase 2 next: a hand-maintained
`hipfire` provider in `~/.config/opencode/opencode.json`, driven manually. Step 2.1 needs one thing
first — **what model ids can the provider advertise?** That probe found a blocker.

### 20.1 The registry only knows two things, and one of them is a draft

```
$ hipfire list
  ornith-1.5-35b-a3b.mq4r     18.70 GB  (ornith-1.5:35b-a3b-mq4r)
  qwen38-27b-dflash-mq4.hfq    1.21 GB  (qwen3.8:27b-draft-mq4)
```

`/v1/models` mirrors exactly those two. The **27B dense model that won every decode benchmark is
missing from both** — it is served by absolute path (`--model /home/dev/models/hipfire/qwen3.8-27b.mq4-pro`).

> **Correction (§22.7).** An earlier revision of this section said the model "is not in the registry at
> all". That is wrong. `~/.hipfire/registry.cache.json` carries a full card for **`qwen3.8:27b-mq4-pro`**
> whose `file` (`qwen3.8-27b.mq4-pro`) and `size_bytes` (16 464 182 272) match the local file exactly.
> The gap is between the *remote registry* and the *local model list* — the artifact was never adopted
> under its tag, so `hipfire list` and `/v1/models` do not offer it. That is a much smaller problem
> than "unregistered", and it may be fixable without renaming anything.
This is the `.mq4-pro` registry gap noted in §18.3, now confirmed to have a user-visible consequence:
an OpenAI-compatible client that populates its model menu from `/v1/models` is offered the 35B and a
**1.21 GB DFlash draft head**, and not the model we actually want to run.

Asking for the draft by its registered tag fails, as it should:

```
{"error":{"message":"daemon error: [validation retryable=false rolled_back=false attempt=0]
  no carrier for HFQ arch_id=20","type":"server_error"}}
```

### 20.2 The 27B dense model no longer loads — it hangs, and a fresh daemon hangs too

The daemon does attempt a lazy load for a model named in the request body, including a bare absolute
path. `serve --model` is documented as "pre-warm", not as a pin, and `--idle-timeout` evicts:

```
[hipfire] unloaded idle model
[hipfire-daemon] dflash_mode=off — skipping draft load (…/qwen38-27b-dflash-mq4.hfq)
```

**Run 1** — daemon had the 35B MoE loaded → idle eviction → request naming the 27B dense by absolute
path. Load started, then stopped advancing at **layer 54 of 64**, for ~15 minutes.

**Run 2** — killed that daemon, relaunched **fresh** with `serve --model <27B path>`, nothing else
resident. Stopped advancing at **layer 50 of 64**.

Run 2 is the important one: it removes the in-process model switch, the prior 35B tenancy, and idle
eviction from the picture. **The 27B dense model simply does not finish loading right now.** The 35B
MoE loads fine, so this is model-specific, not a broken daemon.

Decisive measurement, taken on run 2 after >5 minutes at layer 50:

| Probe | Reading |
|---|---|
| daemon `utime+stime` | 202.7 s → 305.5 s while wall-clock advanced ~100 s — **one core pinned** |
| daemon `/proc/<pid>/stat` state | `R` throughout |
| `read_bytes`, **every** process in the top-12 by RSS, over 20 s | **no process moved more than 5 MB** — the box is doing no disk I/O at all |
| `serve.log` last line | `loading layer 50/64` unchanged across three samples |
| GFX activity | 4 % |

CPU pinned + zero I/O box-wide + zero progress = a spin, not slow work.

### 20.3 Two wrong theories, recorded because I acted on one of them

**Wrong theory A — "in-process arch switch".** Run 1 alone supports it; run 2 refutes it. I had
already written it into this log as the finding before run 2 existed. Corrected above.

**Wrong theory B — "the model move to a SATA SSD made loading slow".** The models now live on
`~/models/hipfire` → `/mnt/LinBackup` = `/dev/sdb4`, and `sdb` is a **Samsung SSD 860 EVO (SATA)**,
not the root NVMe. Historical `weight sweep` times in this log do split cleanly across the move:

| Model location | weight sweep |
|---|---|
| before the move (root volume) | 2 990 / 14 062 / 16 208 / 17 286 / 21 389 / 27 267 ms |
| after the move (`/mnt/LinBackup`) | **137 030 ms**, **115 891 ms** |

That is a real 5–10× cold-load regression and a genuine consequence of the move — keep it. It is not
this hang.

My first attempt to rule it out was itself unsound: I argued "`read_bytes` is frozen, so it cannot be
I/O". **`read_bytes` counts block-device reads only — a file served from page cache moves `rchar`
and leaves `read_bytes` flat.** And `rchar` was 16 472 738 860 ≈ the 27B's 16.46 GB, i.e. the whole
model *had* been read. The correct disproof is the one in 20.2: no process on the machine is doing
I/O, so nothing is waiting on any disk, fast or slow.

### 20.4 Third theory, also falsified — and what actually survives

The one thing that changed immediately before the first failure was `hipfire config set
speculation.dflash on`, re-enabling the separate 1.21 GB draft head. So: reload with
`speculation.dflash off`.

**It loaded — `weight sweep: 20 933 ms`.** Which looked conclusive, so I ran the control: set
`speculation.dflash on` again and reload. **That loaded too, in ~10 s**, with the draft fully
engaged:

```
DFlash2 draft windowed: all 5 layers sliding at W=2048 (no full-attention layer; draft VRAM pinned at W)
DFlash draft loaded: …/qwen38-27b-dflash-mq4.hfq (layers=5, hidden=5120, block=8)
```

So DFlash is **not** the cause either. Three theories, three falsified. The full run table:

| # | Preceding state | `speculation.dflash` | Result |
|---|---|---|---|
| 1 | 35B resident, idle-evicted; lazy load by path | on | **hang**, layer 54/64 |
| 2 | fresh daemon, `serve --model` | on | **hang**, layer 50/64 |
| 3 | fresh daemon, `serve --model` | off | ok — 20.9 s |
| 4 | clean `hipfire stop`, `serve --model` | on | ok — ~10 s |

The surviving correlate is not DFlash and not the switch — it is **cold vs. warm page cache**. Runs 1
and 2 were cold (run 2's `rchar` shows all 16.46 GB being read from the SATA volume). Runs 3 and 4
completed in 21 s and 10 s, which at 16.46 GB implies ≥ 787 MB/s — above SATA line rate, so those
were served from RAM. Every cold load of this model hung; every warm one succeeded.

That is a correlation over four runs, not a root cause, and it does not explain the *shape* of the
failure: at the point of measurement the box was doing **no disk I/O at all** while the daemon pinned
a core. A load starved of I/O should block, not spin.

**Status: unresolved, intermittent, and not blocking.** Recorded, not chased further — the cost of
another bisection is real and the workaround is one command.

**Workaround:** if `serve` sits on the same `loading layer N/64` for more than ~60 s with GFX at 4 %,
`hipfire stop` and re-issue. The second attempt is warm and takes ~10 s.

**Verification that nothing is actually broken** — run 4, one real coding request:

| metric | value | §18 reference |
|---|---|---|
| decode tok/s | **162.2** | 156.9 |
| tau | **9.58** | 10.4 |

The 27B's headline configuration is intact and reproducible.

### 20.5 Consequences for the plan

| Plan step | Status now |
|---|---|
| 2.1 provider block | **Blocked on model identity** (20.1) — the model we want to serve is not in `/v1/models`. Not blocked on the hang. |
| 2.2 survives regeneration | **Confirmed** by code reading and now by unit test (§21) — `sync_opencode()` rewrites only `cfg["provider"]["llama-swap"]["models"]`. |
| 3.7 `cmdStop: hipfire stop` | Keep it. `hipfire stop` is also the hang workaround, so the llama-swap row gets it for free. |
| new | `healthCheckTimeout` must tolerate a cold load. Warm ≈ 10 s, cold ≈ 21–137 s, hung = never. The existing 600 s is adequate. |
| new | Set `--idle-timeout 0` on any hipfire row — eviction is what forces a cold reload on the next request. |

Upstream-report candidates: `dflash_spec.rs:196` (gate on effective eviction, not sidecar presence —
§18), and this cold-load spin (poorly characterised; needs a reproducer before it is worth filing).

## 21. `generate.py` now has a test suite (Phase 3 prep)

`~/.config/llama-swap/generate.py` (747 lines) is the file Phase 3 modifies, and it had **no tests**.
Two agents were fanned out over disjoint halves; the suite is characterization-only — `generate.py`
was not modified, and the live `opencode.json` / `models.yaml` / `config.yaml` were proven untouched
by md5 before/after.

| File | Scope | Tests |
|---|---|---|
| `tests/test_ids.py` | `ctx_label`, `full_id`, `entries_for`, `variants_for`, the variant tables | 91 |
| `tests/test_cmd.py` | `_load_models`, `cmd_for`, `rerank_cmd_for`, `embed_cmd_for`, `*_blocks`, `sync_opencode` | 80 |
| `tests/conftest.py` | `sys.path.insert` only | — |

`python3 -m pytest tests -q` → **171 passed in 0.25 s**.

The two load-bearing tests are the ones Phase 3 will lean on:

- **id injectivity** — 2880-combination product over mid × ctx × kv × drafter × backend × purpose ×
  template × pinned-ctk, asserting zero duplicate ids; plus the same assertion driven through the
  *live* `models.yaml` (35 entries from 12 models today).
- **`sync_opencode` isolation** — a seeded config with `$schema`, `compaction`, `theme` and a sibling
  `ollama-local` provider must come back byte-identical except for the one subtree, key order
  included. This is plan step 2.2, now enforced rather than assumed.

### 21.1 Latent defects found (pinned as current behaviour, not "fixed")

Directly relevant to Phase 3 steps 3.2 and 3.6, which add a whole new backend to this id space:

1. **`reasoning_effort` and `reasoning_strength` share the `eff-` tag prefix** — two rows pinning
   *different* template variables to the same value collapse to one id. Masked today only because
   Qwen uses one and Muse the other.
2. **`full_id` never sees `np`/`slots`, `kv_unified`, `spec_p_min` or `alias`** — two rows differing
   only in one of those collide by construction. `np` and `kv_unified` reach the *display* name, not
   the id.
3. **Only `kv="q8_0"` gets a KV tag** — `q4_0` and `f16` produce the same id.
4. **A pinned kwarg outside the three tagged ones is invisible in the name** — the exact failure the
   `nopreserve`/`eff-` tags were introduced to prevent.
5. **`entries_for` branches on `be == "vulkan"` while `full_id` tags on `be == "rocm"`** — a third
   backend name takes the ROCm code path yet gets **no backend tag**. Phase 3 adds exactly such a
   third backend name (`hipfire`), so **this one is live, not latent**: step 3.2 must add the tag in
   `full_id`, not only the vocabulary entry.
6. `sync_opencode` collapses duplicate ids silently (last wins) and its `(added, removed)` report
   cannot reveal the loss — so defect 5 would land as a silently missing model, not an error.
7. Smaller: empty `models.yaml` → bare `AttributeError`; `draft: {}` bypasses both draft guards;
   `spec_p_min: 0.0` is rejected though it is the one value that is a genuine no-op; `draft.n_max: 0`
   is dropped while `draft.ngl: 0` is honoured; `cmd_for` enforces none of `_load_models`'
   invariants; `sync_opencode` rewrites the file even on a no-op run.

None of these are fixed. They are now *detected* — the id-injectivity test fails loudly if Phase 3
introduces a collision.

### 21.2 Whole-artefact goldens — "it must still work as before"

The per-function tests are deliberately tolerant of unrelated edits, which is the wrong property for
the actual Phase 3 risk: *adding a hipfire backend must not disturb a single existing llama.cpp row*.
So `tests/test_golden.py` adds the opposite kind of test — it runs `main()` exactly as the CLI does,
with **both** write targets redirected into `tmp_path`, and compares the **entire** emitted
`config.yaml` and the **entire** opencode model map against golden copies:

| Golden | Size |
|---|---|
| `tests/golden/config.yaml` | 24 680 B |
| `tests/golden/opencode-models.json` | 33 182 B |

Refresh is opt-in only — `pytest --regenerate-golden` — because the goldens are the sole record of
how the generator behaved *before* a change.

Suite total: **176 tests, 175 pass.**

### 21.3 The one failing test is right: the deployed config is stale

`test_golden_matches_the_live_deployed_config` compares the golden against the `config.yaml`
llama-swap is actually running, so the golden cannot become a self-consistent fiction. It fails:

```
models.yaml   mtime 2026-09-10 11:20
config.yaml   mtime 2026-09-09 00:12
```

`models.yaml` row `qwen38-27b-q4kxl` had its `ctx` raised **133120 → 213120** today and
`generate.py` was never re-run. llama-swap is serving 130 k while the table claims 208 k. The row's
own comment two lines above still reads `133120 tok x 34 KiB/tok`, so the edit is not internally
consistent either.

**Regenerating is not free.** 213120 is not a KiB multiple, so `ctx_label()` falls back to the raw
number (the behaviour pinned in §21.1) and **four model ids get renamed**:

```
qwen38-27b-q4kxl-ctx130k-kvq8-mtp-{frog,sharp}-{coding,planning}
   ->  qwen38-27b-q4kxl-ctx213120-kvq8-mtp-{frog,sharp}-{coding,planning}
```

`qwen38-27b-q4kxl-ctx130k-kvq8-mtp-frog-coding` is the exact row every llama.cpp number in §16-§19
was measured against, and it is referenced from `bench/` scripts and the opencode model menu. This
is a decision for the user, not a cleanup to perform silently:

- **run `generate.py`** — get the 208 k context that was intended, accept four renamed ids and fix
  the references, and re-check that 208 k × 34 KiB/tok still fits VRAM alongside 20.47 GiB of weights;
- **revert `models.yaml` to 133120** — keep every id and every benchmark reference valid.

Left failing on purpose. It is a true statement about the machine, and skipping it would bury it.

## 22. Phase 2.1–2.2 done — hipfire is in the opencode model menu

`generate.py` is deliberately **not** touched by this phase. The opencode provider is hand-maintained
and the generator never writes it; that is what makes Phase 2 free and Phase 3 expensive.

### 22.1 Preconditions fixed first

`serve.idle_timeout_seconds` defaulted to **300**, which is what kept putting the daemon back into the
`model:null` state that precedes the §20 cold-load spin. Set to `0` (eviction disabled). The model now
stays pinned; reload after the change took **15 s**.

```
hipfire config set serve.idle_timeout_seconds 0
```

Measured ceiling for the 27B, taken from the load log rather than guessed:
`physical_cap = max_seq = 82944`. That is the number advertised to opencode, closing plan step 2.4
for this model. The 35B is advertised at 65536 (§19.3).

### 22.2 The provider block

Added to `~/.config/opencode/opencode.json` as a third provider alongside `ollama-local` and
`llama-swap` (backup: `opencode.json.bak-pre-hipfire`):

```json
"hipfire": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "hipfire (R9700 native)",
  "options": { "baseURL": "http://127.0.0.1:11435/v1", "apiKey": "dummy-key" },
  "models": {
    "/home/dev/models/hipfire/qwen3.8-27b.mq4-pro": {
      "name": "qwen3.8 27B dense [hipfire, DFlash W=2048, mq4-pro]",
      "limit": { "context": 82944, "output": 32768 } },
    "ornith-1.5:35b-a3b-mq4r": {
      "name": "ornith-1.5 35B-A3B MoE [hipfire, MTP K=3, mq4r]",
      "limit": { "context": 65536, "output": 32768 } }
  }
}
```

The 27B is keyed by **absolute path** because it is not in hipfire's registry (§20.1) — the daemon
accepts a path as a model id. Swap it for a tag if `.mq4-pro` ever gets registered.

### 22.3 Step 2.2 proven, not assumed

`main()` was run with `HERE` and `OPENCODE_CFG` redirected onto a **copy** of the live config:

| Assertion | Result |
|---|---|
| `provider["hipfire"]` identical after regeneration | **True** |
| `provider["ollama-local"]` identical | **True** |
| `provider["llama-swap"]["models"]` rewritten | True (as designed) |
| provider key order preserved | `ollama-local, llama-swap, hipfire` |
| real `config.yaml` / `models.yaml` md5 | unchanged (`9db68d13…`, `f8d34a6c…`) |

The dry run also surfaced a **second** pending drift beyond §21.3's four renames: the next real
`generate.py` run will also **delete** `gemma-31b-ctx128k-kvq8-rocm` from the menu. Nine model-menu
changes are queued behind one un-run generator.

### 22.4 Endpoint conformance — the part that actually gates opencode

| Capability | Result |
|---|---|
| non-streaming `/v1/chat/completions` | ok |
| SSE streaming (`stream: true`) | ok — proper `chat.completion.chunk` deltas |
| **`tools` / `tool_calls`** | **ok** — `[{"id":"call_0","type":"function","function":{"name":"list_dir","arguments":"{\"path\":\"/tmp\"}"}}]` |

Tool calling was the make-or-break: opencode is unusable without it, and nothing in Phase 1's
benchmarks touched it. It works.

### 22.5 An unmeasured effect worth flagging: tau is content-dependent

Two single requests on the same loaded model, same settings:

| Prompt | decode tok/s | tau |
|---|---|---|
| "Write a Python function that merges two sorted lists." | 162.2 | 9.58 |
| "In one sentence: what is a B-tree?" | 45.3 | 1.94 |

n=1 each, so this is a flag, not a result — but it suggests the DFlash draft accepts code far more
readily than prose, and that the headline 156.9 tok/s is a **coding** number that will not
generalise to chat. Worth a proper arm before any decode claim is made outside a coding context.

### 22.6 Remaining Phase 2 work — yours, not mine

2.3 (drive it on real work, judge quality) and 2.5 (how reasoning effort reaches it — the load log
shows `[WARN: INVALID CONFIG] reasoning.effort 'xhigh' dropped: thinking disabled`, so the
request-body `variants` mechanism the llama-swap provider uses is **not** wired here). Restart
opencode to pick up the new provider.

## 23. The 222-key config surface, researched — and two of my own recommendations retracted

Two agents read hipfire's own `docs/` and `crates/` trees. I verified every claim below against this
machine before recording it.

### 23.1 RETRACTED: PFlash and DDTree were bad recommendations

Earlier in this session I named `speculation.prefill.mode` (PFlash) "the highest-value untested knob"
and DDTree "the obvious candidate for rescuing tau on prose". Both are wrong.

**PFlash cannot fire on this workload at all.** `crates/hipfire-pflash/src/pflash.rs:1508-1510`:

```rust
if request_kind == RequestKind::ToolCall {
    return Some(BypassReason::ToolCallRequest);
}
```

Any request carrying tool definitions bypasses compression unconditionally. An agentic coding
assistant sends tools on essentially every turn. Four more gates would stop it anyway
(`prefill.drafter` empty, tokenizer-fingerprint mismatch, mode off, below threshold). And hipfire's
own `CLAUDE.md:73-77` says: *"PFlash is retained legacy research, not mainline or production
functionality. Prefix caching supersedes it… do not treat PFlash as a production element,
recommendation, acceptance route, or basis for a current performance claim."*

**DDTree is measured slower in every genre, on every box.** `docs/spec-decode-durability-2026-06-23.md:62-70`:

| Genre | linear tok/s | τ | DDTree b12 tok/s | τ |
|---|---:|---:|---:|---:|
| code | **130.0** | 6.33 | 111.6 | 7.80 |
| reason | **109.9** | 4.79 | 77.2 | 4.94 |
| instruct | **74.5** | 2.82 | 53.7 | 3.57 |
| prose | **45.9** | 1.26 | 37.1 | 1.70 |

It raises τ and *lowers* throughput — the per-cycle tree-verify cost exceeds the τ benefit at every
budget. It also disqualifies the gfx1201 PM4 verify route and disables the flash-attention WMMA
sibling. `feature_flags.rs:263-268`: *"Default OFF — linear chain wins on every drafter measured."*

I recommended both from the key *names* and their defaults, without reading what they do. The
schema dump is not documentation.

### 23.2 `speculation.mode = auto` selects almost nothing

`crates/hipfire-cli/src/main.rs:3217-3219` — the entire `auto` arm:

```rust
"auto" => { params["dspark_mode"] = serde_json::json!("auto"); }
```

`dflash_mode`, `mtp_mode` and `ngram_draft` keep whatever the config ladder set. Precedence is
structural at load: **DSpark > DFlash > MTP > n-gram** (`crates/hipfire-loader/src/lib.rs:2077`).

Consequences that bite:

- **A forced global `speculation.mode` destroys the other model.** `mode=dflash` pins `mtp_mode=off`,
  killing MTP on the 35B; `mode=mtp` pins `dflash_mode=off`, killing DFlash on the 27B. All
  `speculation.*` keys are `ModelLoad`-scoped and therefore overlay-legal — use per-model overlays.
- **For n-gram alone, `"auto"` means ON** (`main.rs:2968`), unlike every other key.
- **n-gram on the 35B is unreachable while MTP loads** — MTP wins the cascade first.
- While `speculation.dflash="off"`, `developer.dflash_draft` is *stripped from the load params
  entirely* (`main.rs:3156-3172`), so the global workaround in §18 is dead weight in that state.

### 23.3 The claim worth testing: MTP may be a net loss on the 35B

MTP forwards are Redline/hipGraph **ineligible** and invalidate the captured plain-AR graph
(`crates/hipfire-arch-qwen35/src/qwen35/forward.rs:1507-1519`). The published gfx1201 reference for
this model class, `docs/perf-checkpoints/2026-07-26-gfx1201-retained-pm4-reference.md:38-43`:

| qwen3.6-35b-a3b.mq4r | HIP | PM4 | ratio |
|---|---:|---:|---:|
| decode tok/s | 174.265 | **201.057** | 1.154 |

We measure **106.3 tok/s with MTP at τ 1.13**. If MTP is costing the retained-PM4 route, turning it
off could nearly double the 35B's decode. Caveat: that reference ran `--context 128 --max-seq 2048`,
a best case, so it is not directly comparable — but the gap is wide enough to test. **A/B in flight.**

### 23.4 Ruled out: the stale-FP16-cache bug

`gemm.rs:22424` documents a pointer-keyed FP16 cache defect that collapsed MTP τ from ~1.85 to ~1.01
— suspiciously close to our 1.13. **The fix is present in our build**: `convert_fp16_x_uncached` at
`crates/rdna-compute/src/gemm.rs:493`. So τ 1.13 is the head's real quality, not a build artifact.

Upstream's own verdict on fixing that: self-distillation was tried and falsified (+0.06%), and the
programme was formally closed — *"Head retraining is a dead end for runtime speedup"*
(`docs/plans/mtp-goal-program-terminus-2026-05-23.md:43`). **There is no knob that fixes MTP τ.**

### 23.5 Config keys that are inert in this deployment

Verified no-ops, so nobody wastes a bench arm on them:

| Key | Why inert |
|---|---|
| `speculation.dflash_adaptive_b` | daemon parses it into `let _adaptive_b` and discards it (`hipfire-daemon/src/main.rs:1354-1364`); `CHANGELOG.md:1053` still lists the wiring as pending |
| `speculation.dflash_tree` | never read on arch 5/6; the qwen35 gate is `ddtree_budget > 0` |
| `speculation.dspark_confidence` | no `-dspark` sidecar exists for either model |
| `speculation.dflash_ngram_block = auto` | `auto` maps to `None` → `.unwrap_or(false)`; the docs' "auto size-gates" is wrong |
| `speculation.prefill.alpha` | declared, defaulted, read nowhere — only copied into a log line |
| `speculation.prefill.sparse_threshold` | *"plumbing-only and the dense path is always used"* |

### 23.6 Ranked, on measured evidence

| # | Change | Expected | Risk |
|---|---|---|---|
| 1 | `memory.prompt_cache_capacity` 32 → 512 | removes the turn-33 prefix-cache cliff; up to 20–40× on prefill late in a session | host RAM only |
| 2 | 35B: `speculation.mtp = off` (per-model) | possibly ~2× decode by restoring retained PM4 — **under test** | none, MTP is lossless either way |
| 3 | 27B: `dflash_mode on` as a **per-model overlay**, global stays off | keeps the 4× on code without forcing the 35B off MTP | none at temp 0 |
| 4 | one agent per daemon | prefix reuse survives; concurrency currently destroys it for both | throughput unchanged (already serialized) |
| 5 | pin sampling via per-model overlay | you are at temp 1.0, not 0.3 | needs a quality A/B |
| 6 | `speculation.mtp_k` 3 → 4 (only if MTP stays) | measured τ 2.98 → 3.40, saturates at 4 | none — "K=4 vs K=5 output byte-identical" |
| 7 | `HIPFIRE_DFLASH_VERIFY_PM4=1` (27B) | gfx1201-exclusive retained-PM4 chain verify; self-reports `armed` | none; genuinely unmeasured |

## 24. A GPU memory fault that wedges the daemon while `/health` still says `ok`

### 24.1 What happened

During a DFlash A/B, on the **first request after load** with `speculation.dflash off`, a ~6 K-token
prompt faulted the GPU:

```
Warning: Queue error - HSA_STATUS_ERROR_MEMORY_FAULT
VGPU(0x57a0388ccc30) hang analysis:
:0:rocdevice.cpp :3905: Memory Fault Error [host: bipubi, GPU index: 0,
  faulting addr: 0x68f6fa528000, kernel: gemm_gate_up_mq4g256v2_wmma_gfx12_bt12]
```

`gemm_gate_up_mq4g256v2_wmma_gfx12_bt12` is a gfx12 WMMA gate/up prefill GEMM.

### 24.2 The part that matters operationally

The daemon **did not exit**. Ten minutes later:

| Probe | Reading |
|---|---|
| `/health` | `{"status":"ok","model":"…qwen3.8-27b.mq4-pro","loading_model":null}` |
| worker process state | `Rl` — running |
| the in-flight request | never returned; client hit its own 600 s timeout |
| every subsequent request | hung identically |

**`/health` does not touch the GPU, so it reports a wedged engine as healthy.** A llama-swap row with
the default `checkEndpoint: /health` would never detect this, and would keep routing traffic into a
dead daemon. Recovery required `kill -9` on the worker.

### 24.3 Reproduction: it is rare, not systematic

Five controlled attempts, fresh daemon each time, same prompt and settings:

| Arm | decode tok/s | τ | memory faults |
|---|---:|---:|---:|
| dflash off #1 | 16.2 | — | 0 |
| dflash off #2 | 16.2 | — | 0 |
| dflash off #3 | 30.4 | — | 0 |
| dflash on #1 | 23.9 | 1.41 | 0 |
| dflash on #2 | 40.3 | 3.06 | 0 |

**Zero reproductions in five attempts** — so roughly 1 in 6 of this request shape, not deterministic,
and not attributable to DFlash state. Not enough to file upstream without a reproducer; enough to
require a liveness check that actually exercises the GPU before hipfire is trusted behind llama-swap.

### 24.4 A second finding hiding in that table

Run-to-run spread on an identical prompt with an identical config is **large**: 16.2 / 16.2 / 30.4
(1.9×) with speculation off, 23.9 / 40.3 (1.7×) with it on. Every single-run comparison in this
document inherits that noise. Speculation-off runs have no τ to explain it, so it is not acceptance
variance — it is the engine or the clocks. **Consequence: no future decode claim should rest on
fewer than ~5 runs reported with a spread, and the §22.5 tau/content table is now under-powered.**

Useful baseline from the same table: pure AR on prose is ~16 tok/s, so DFlash at τ 1.28–1.41 still
earns +50–90% there. DFlash is not merely a code-only feature — its *headline* number is.

## 25. MTP is a 6× loss on the 35B — and §19's decode number does not reproduce

### 25.1 The measurement

Two independent prompt shapes, fresh daemon per arm, first rep discarded as warmup, n=5 measured:

| Prompt shape | MTP **off** | MTP on | ratio |
|---|---:|---:|---:|
| coding, 200-token output | **175.4** (175.1–176.4) | 33.7 (32.8–36.1) | **5.2×** |
| §19's shape: ~60-token prompt, 512-token output | **177.2** (176.4–177.9) | 27.9 (27.4–28.9) | **6.4×** |

Spread on the MTP-off arms is **±0.4%** — this is not the noisy regime of §24.4.

MTP-off at 175–177 tok/s sits right on the published gfx1201 reference for this model class
(`docs/perf-checkpoints/2026-07-26-gfx1201-retained-pm4-reference.md:38-43`: HIP 174.3, PM4 201.1).

**Action: turn MTP off for the 35B.** It is lossless either way — MTP is a speculative drafter, not a
quality feature — so this is a free 5–6×.

### 25.2 The proposed mechanism is WRONG

The research report attributed this to MTP forfeiting the Redline/hipGraph retained path. The load
log refutes it directly — PM4 is enabled *with* MTP engaged:

```
[redline] enabling fail-closed retained default on gfx1201
          (model_arch=qwen3_5_moe, drafter=mtp, transport=pm4)
```

So MTP is expensive for some other reason. **Not identified.** Recording the effect without a
mechanism is the honest option; inventing a second mechanism to replace the one that just failed is
how §15, §17.2 and §20.3 went wrong.

A confound I checked and eliminated: the arms could have differed in DFlash state, since
`developer.dflash_draft` still points at the 27B draft. The log shows
`dflash_mode=off — skipping draft load` on both arms.

### 25.3 RETRACTED: §19's 35B decode figures

§19 reported **106.3 tok/s** for this model with MTP engaged. That number came from real recorded
data — `bench/ornith35b-mq4r-mtp.jsonl` has eight rows at 105–109 tok/s with `timings.mtp: true` and
τ 1.11–1.18, so it was not a transcription error.

**It does not reproduce.** §25.1's second row uses that file's exact workload shape (~62-token
prompt, 512-token output, same config: `mtp=auto`, `dflash off`, CASK off, reasoning off) and gets
**27.9 tok/s** — a 3.8× shortfall against the same machine's own recorded history.

Candidate differences, none of which survives scrutiny:

| Candidate | Why it fails |
|---|---|
| output length (200 vs 512) | tested directly in §25.1; 512-token arm is *slower*, and 512 tokens once completed in 4.80 s while 200 took 5.93 s |
| prompt content / expert routing | two unrelated prompts, same ~28–34 result |
| DFlash confound | refuted by the load log |
| GPU degraded by the §24 fault and the `kill -9`s | MTP-**off** hits 177, *above* the published HIP reference — the GPU is healthy |
| `serve.idle_timeout_seconds` 300 → 0 | affects eviction, not steady-state decode |

**Consequence: every 35B decode figure in §19 is now untrustworthy**, including the three-engine
comparison table. The 35B's prefill numbers are unaffected (a different measurement path), but its
decode column must be re-taken before it is quoted again. The corrected value with MTP off — the
configuration that should have been benchmarked in the first place — is **~177 tok/s**, which makes
the 35B *faster* at decode than the 27B's 156.9, reversing §19.4's "which model to prefer" verdict
for decode-heavy work.

### 25.4 Config left in the corrected state

`speculation.mtp = off` and `speculation.dflash = on` are now both correct as **globals**: the 27B
wants DFlash (which the 35B cannot use — no draft exists), and the 35B wants plain AR. No per-model
overlay is needed for this pair, so the §23.2 warning about a global `speculation.mode` destroying
the other model does not bite here.

## 26. Phase 3 done — hipfire is a llama-swap backend, and the menu is deduplicated

### 26.1 What was built in `generate.py`

| Piece | Detail |
|---|---|
| `HIPFIRE_BIN` + `${hipfire}` macro | `hipfire serve 127.0.0.1 ${PORT} --idle-timeout 0` — **no `-d`**: llama-swap must supervise the process, and a detached daemon would linger holding the GPU |
| `BACKEND_TAG` map | **fixes a live bug** — `full_id()` tagged only `be == "rocm"` while `entries_for()` branched on `be == "vulkan"`, so a third backend took the ROCm path with **no** backend tag and would have collided with a vulkan id. `sync_opencode()` drops such a collision silently (last writer wins). `hipfire` → `hf` |
| `hipfire_tag:` row key | replaces `path:`; a registry tag or an absolute model path |
| `hipfire_env:` row key | per-PROCESS engine config (see 26.3) |
| `hipfire_cmd_for()` / `hipfire_env_block()` | never touch `${common}`; hipfire's clap parser rejects `-ngl`/`-fa`/`--jinja` outright |
| `useModelName` | **required, and not optional as the plan assumed** — see 26.2 |
| `cmdStop: hipfire stop` | talks to the control socket rather than relying on a signal |
| `_load_models` guards | a hipfire row may not share a row with another backend, must carry `hipfire_tag`, and is **refused** if it sets `templates`/`kv_unified`/`np`/`draft`/`spec_p_min`/`mtp`/`chat_template_kwargs` — those have no argv on this engine and would be silently dropped |

### 26.2 Two failures found only by running it end-to-end

**`useModelName` is mandatory.** llama-swap forwards the request body verbatim, so `model` arrives
as the llama-swap *row id*. llama.cpp ignores that field; hipfire resolves it as a model name:

```
{"message": "model not found locally: qwen38-27b-hipfire-ctx81k-kvq8-hf",
 "type": "invalid_request_error"}
```

**Global speculation config cannot serve both models.** With `speculation.dflash = on` set globally
— which §25.4 claimed was "correct for both" — loading the 35B MoE hard-fails:

```
load failed: DFlash draft required (dflash_mode=on) but failed to load
(/home/dev/models/hipfire/qwen38-27b-dflash-mq4.hfq):
draft target_layer_ids contains 47 >= num_target_layers
```

§25.4 is **wrong** and is retracted: the 27B's draft is not merely useless to the 35B, it is fatal to
its load. The two models need opposite settings, and hipfire has no per-request speculation control.

### 26.3 The fix: per-row `env:`, not per-model overlays

llama-swap runs one process per row, so environment variables give true per-row engine config with
no global state to leak:

```yaml
  "qwen38-27b-hipfire-ctx81k-kvq8-hf":
    env: [ "HIPFIRE_DFLASH_MODE=on",  "HIPFIRE_MTP_MODE=off" ]
  "ornith35b-a3b-hipfire-ctx64k-kvq8-hf":
    env: [ "HIPFIRE_DFLASH_MODE=off", "HIPFIRE_DFLASH_DRAFT=", "HIPFIRE_MTP_MODE=off" ]
```

An empty `HIPFIRE_DFLASH_DRAFT` is the documented opt-out (`docs/env-vars.md:108`).

### 26.4 Measured through llama-swap

| Row | prefill tok/s | decode tok/s | τ |
|---|---:|---:|---:|
| `qwen38-27b-hipfire-…-hf` (DFlash) | 152.9 | 119.5 | 9.58 |
| `ornith35b-a3b-hipfire-…-hf` (plain AR) | **874.7** | **183.5** | — |

The 35B at 183.5 tok/s decode beats its standalone 177.2 and confirms §25: MTP off is the right
configuration. Model swapping works — the 35B request evicted the 27B and loaded the MoE.
A llama.cpp row (`qwen27b-q4km-ctx128k-kvq8-mtp-frog-coding`) was re-tested afterwards and still
answers correctly, so the backend addition did not disturb the existing rows.

### 26.5 Menu deduplication

At the user's direction: one q8 (big-context) and one f16 (moderate-context) variant of the Qwen3.8
27B; Qwen3.6 27B reduced to a single testing variant (froggeric / vulkan / q8); gemma removed.

| | before | after |
|---|---:|---:|
| models.yaml rows | 12 (+2 new) | **10** |
| llama-swap / opencode entries | 35 | **23** |

Dropped: `qwen38-27b-q4kxl-200k-q8`, `qwen38-27b-q6k`, both `qwen38-27b-q6k-mrcr`, the gemma block,
and the qwen3.6-27B sharp-template and rocm rows.
`ctx` on the surviving q8 row was rounded **213120 → 212992** (208 × 1024) so `ctx_label()` emits a
clean `ctx208k` instead of the raw number. Its KV also moved f16 → q8_0, which halves KV to
32 KiB/tok (~21.5 GiB total, was ~26.5).

**Renamed ids** — `qwen38-27b-q4kxl-ctx130k-…` → `qwen38-27b-q4kxl-ctx208k-…` (4 rows). No runnable
script references them: the only hits are this document, `03-bench-baseline.md`,
`04-bench-rocm713-final.md` and the recorded `bench/*.jsonl`, which are **historical records of what
was measured** and were deliberately left unedited.

### 26.6 The direct hipfire provider is retired

`~/.config/opencode/opencode.json` no longer carries the standalone `hipfire` provider pointing at
`:11435`. Both models now reach opencode through the `llama-swap` provider, and running a standalone
daemon alongside llama-swap's would put two swappers in a race for the GPU (plan step 3.9). Restore
from `opencode.json.bak-pre-hipfire` if a bypass path is ever wanted — and stop the llama-swap
hipfire row first.

### 26.7 Test-suite consequences

The row tuple grew 14 → 15 fields, so five characterization tests were updated to the new shape
(they asserted the old contract, which is exactly their job). One guard was **replaced rather than
adjusted**: `test_golden_covers_every_live_model_row` asserted `len(MODELS) >= 12`, which turned an
intended deduplication into a red suite. It now checks correspondence in both directions — every
models.yaml row appears in the golden, and every golden block maps to a current row — with no magic
number. **176 tests, all green**, goldens refreshed.

## 27. Context caps, VRAM, and concurrency — what 160k/220k actually costs

Question put to this section: *configure and allow higher caps — minimum 160k, possibly 220k — for
both hipfire rows without significant performance degradation; establish whether parallel requests
can share KV; and measure 4 concurrent agents.* The workload that matters is dp-forge's own: spec
and plan writing, task creation, large implementations with reviews and orchestration — where a
sudden large input (a big file, a JSON DAG, an unplanned log analysis) must not detonate latency.

### 27.1 The measurement design was wrong at first, and the correction matters

The first probes measured a **single cold prefill of a 62k-token prompt**. That is not the workload.
The real pattern is incremental: read 1–20k, prefill, cache; next turn add another 1–20k plus
thinking; repeat until the conversation is 160–220k deep. Many sub-60k steps, never one 200k step.

Context size is therefore a **capacity** requirement, not a per-request prefill size. All figures
below that carry decision weight come from the incremental shape (`convo.py`), not one-shot prefill.

### 27.2 Corrections to earlier claims in this log

| Claim | Status | Evidence |
|---|---|---|
| "`DEFAULT_DFLASH_CTX_CAP = 8192` makes requests >8k fall back to AR on the 27B" | **WRONG** | The 27B draft is *windowed*: `DFlash2 draft windowed: all 5 layers sliding at W=2048 … draft VRAM pinned at W [from draft metadata]`. `dflash_spec.rs:206-215` takes `Some(w) => w` and never consults the cap. The cap governs *Legacy* (full-attention) drafts only. |
| "`HIPFIRE_DFLASH_CTX_CAP=0` belongs in the 27B row" | **WITHDRAWN** | It is a no-op for a windowed draft. |
| "`HIPFIRE_DFLASH_CTX_CAP=0` likely caused the wedged loads" | **WITHDRAWN** | A no-op cannot have caused them. Those remain the known intermittent cold-load spin, cause still unknown. |
| "Raising `max_seq` costs prefill throughput" | **NOT SUPPORTED** | Measured 469 tok/s @18.3k at `max_seq=225280` vs 431.5 @26k at 163840 — same regime. `replay_stable_tile_count()` (`attention.rs:119-130`) reduces over `actual_tiles`, padding to `max_tiles` only under graph capture / redline recording. |
| "PFlash is blocked for tool calls" | **CONFIRMED** (earlier retraction stands) | `hipfire-pflash/src/pflash.rs:1508` — `RequestKind::ToolCall => BypassReason::ToolCallRequest`. Also `DrafterUnavailable`: `speculation.prefill.drafter` is empty. |

### 27.3 The concurrency surface — read from source, not guessed

Three mutually exclusive serve modes:

| Mode | Context ceiling | Speculation | KV |
|---|---|---|---|
| Sequential (default) | full `max_seq` | DFlash/MTP available | one request at a time — *"Only one generation holds the daemon lock at a time (bounded queue)"* (`SERVE.md:86`) |
| `serve.multi_slot` | `multi_slot_ctx`; `max_seq` is **forced down to it** (`serve/mod.rs:1181`) and larger requests are **rejected** (`:1137`) | **none** — DFlash, MTP, PFlash, n-gram, CASK, adaptive KV all refused (`slots.rs:935-1005`) | fixed per-slot arenas; `kv_backend=contiguous` required (`slots.rs:996-1003`), `kv_mode=q8` required |
| `serve.continuous_batch_size > 1` | `min(max_seq, ~15872)` | — | independent KV lanes |

`multi_slot` and continuous batching are mutually exclusive (`validate_multi_slot_startup`).

**The ~15872 ceiling is a GPU shared-memory limit, not a VRAM one.** `batch_lane_capacity =
m.max_seq.min(max_attention_lane)` where `max_attention_lane` is the largest `l` satisfying
`(l + block + head_dim) * 4 <= 64 KiB` (`attention.rs:29-56`, fallback constant
`ATTENTION_Q8_INDEPENDENT_LDS_FALLBACK_BYTES = 64 * 1024`). For head_dim 256 that is **15872 tokens**.
No amount of VRAM raises it.

### 27.4 Can parallel requests share KV? No.

Searched the whole tree for paged attention, radix/prefix cache, block tables, copy-on-write KV:
**no such mechanism exists**. (The `shared_kv` hits are Gemma-4 intra-model layer sharing.) Every
concurrent request owns its own KV. VRAM therefore scales with concurrency, and both parallel modes
additionally cap context far below the 160k floor.

**Consequence: a 160k floor and 4-way parallelism are mutually exclusive inside hipfire.**

### 27.5 There is no per-row context override

`hipfire serve` accepts `--kv-mode`, `--kv-backend`, `--continuous-batch-size` — **no `--max-seq`**.
The `HIPFIRE_<NAME>` env mechanism applies only to *developer* keys
(`developer_env_for_key`, `hipfire-config/src/lib.rs:2926-2930`); `memory.max_seq` is a schema field,
so it has no env alias. `generate.py` already documents this at `hipfire_cmd_for()`:
*"Context depth, KV mode, sampling and speculation are NOT expressible here."*

So a row's `ctx:` is **only** what opencode advertises; the enforced cap is the global
`~/.hipfire/config.toml`. If they disagree, a large input is accepted by opencode and then rejected
by hipfire with `HTTP 400: request exceeds loaded KV budget … > physical_cap=N`. They must be
changed together.

Two distinct cliff mechanisms, worth separating:

| Trigger | Result |
|---|---|
| prompt tokens > `physical_cap` | **HTTP 400**, request fails |
| `max_tokens + 1024 > current_max_seq` | **model reload** mid-request (`complete.rs:1658-1660`) — `required_max_seq` keys off `max_tokens`, *not* prompt length |

### 27.6 Measured: incremental growth, ~18k-token delta per turn

Method: a conversation grown by ~70000 chars (~18k tokens) per turn, prior turns served from the
KV cache. `max_seq=225280` (27B) / `163840` (35B), `kv_backend=vmm`, MTP off. Prefix reuse verified
working: at 27B turn 2, `ctx/rate` = 140 s but `delta/rate` = 70 s and the measured wall was 70.5 s —
only the delta is prefilled.

**Qwen3.8-27B dense (DFlash windowed W=2048):**

| Turn | Context | Prefill tok/s | Decode tok/s | τ | Wall | VRAM |
|---|---|---|---|---|---|---|
| 1 | 18340 | 469.0 | 27.4 | 3.0 | 40.3 s | 21398 MB |
| 2 | 36501 | 260.5 | 22.1 | 3.5 | 70.5 s | 22088 MB |
| 3 | 54428 | 108.7 | 12.7 | 2.2 | 166.2 s | 22730 MB |
| 4 | 72935 | 80.5 | 11.0 | 2.22 | 232.6 s | 23535 MB |

Power-law fit over 4 points: **prefill_rate ∝ depth^-1.324, R² = 0.961**.
Measured KV growth **36.7–44.5 KiB/token** (geometry alone implies 34; the rest is scratch).

### 27.7 The decisive comparison: the 35B MoE is a different machine at depth

Same shape, same deltas, no speculation at all (DFlash off, MTP off — `tau=None`):

| Depth | 27B prefill | 35B prefill | 27B decode | 35B decode | 27B wall | 35B wall |
|---|---|---|---|---|---|---|
| ~18.3k | 469.0 | **1978.9** | 27.4 | **144.2** | 40.3 s | **9.6 s** |
| ~36.5k | 260.5 | **823.3** | 22.1 | **121.5** | 70.5 s | **22.5 s** |

The 35B is **4.2× the prefill and 5.3× the decode** at equal depth, and carries **less** KV
(10/40 layers vs the 27B's 16/64 — ~21 KiB/token by geometry, ~10 KiB/token measured). The decay
exponent is the same (≈ -1.27 vs -1.32); the 35B simply starts ~4× higher.

Why: only ~3B of 35B parameters are active per token, so prefill (compute-bound) and decode
(bandwidth-bound) both win. The 27B needs DFlash to reach even 27 tok/s, and loses it as τ decays
past the draft's W=2048 window — the 35B needs no speculator at all.

### 27.8 Four parallel agents: the default config drops half of them

27B, sequential backend, `max_seq=225280`, four concurrent 6.5k-token requests:

| Request | Result |
|---|---|
| req0 | prefill 567.2, decode 47.6, τ2.59, wall 17.0 s |
| req1 | **HTTP 503 Service Unavailable** |
| req2 | **HTTP 503 Service Unavailable** |
| req3 | prefill 566.2, decode 53.3, τ3.05, wall 33.5 s |
| aggregate | ok **2/4**, 393.0 tok/s prefill vs 368.9 single-stream |

Two independent facts here:

1. **Concurrency buys ~nothing.** 13156 prompt tokens in 33.5 s = 393 tok/s against 369 tok/s for one
   request — a 6 % gain. Only one generation holds the daemon lock, so four agents serialise.
2. **Half the requests FAIL at stock settings.** `serve.queue_timeout_ms = 30000` rejects any request
   whose *wait* exceeds 30 s (`SERVE.md:141`, "Saturated admission queue → 503 with `Retry-After`").
   With each turn taking 17–33 s, agents 3 and 4 in line are guaranteed to exceed it.
   `serve.max_queue` is 64, so queue *depth* is not the constraint — only the wait timeout is.

Fix, independent of model choice: `serve.queue_timeout_ms = 0` (0 = no wait timeout, range 0–3600000).
This does not make hipfire concurrent — it makes queued agents wait instead of fail.

### 27.9 A production/measurement gap worth closing

`ornith-1.5` is outside the qwen3.5/3.6/3.8 registry tag policy that sets `kv_backend=vmm`, so it
defaults to **contiguous**. Every measurement above passed `--kv-backend vmm` explicitly, but
`hipfire_cmd_for()` emits no such flag — production would therefore run a different KV backend than
the one measured. `memory.kv_backend = vmm` must be set globally for the measured behaviour to hold.

### 27.10 Continuous batching: the lane cap is real, and confirmed by the engine

Enabling `serve.continuous_batch_size=4` at `max_seq=225280` produces, verbatim:

```
continuous batch lane capacity clamped: requested=225280 supported=15872
continuous batch staged: slots=4 lane_cap=15872 repeat_cap=2048
```

**15872 is exactly the value derived from the LDS budget** — `(lane_cap + block + head_dim) * 4 <=
64 KiB` at head_dim 256. The prediction and the engine agree to the token.

VRAM confirms the per-lane KV allocation, which is the empirical answer to *"can I run parallel
requests without multiplying the KV cache?"*:

| Config | Load VRAM |
|---|---|
| sequential, `max_seq=225280` | 19659 MB |
| 4 batch lanes | **22231 MB (+2.57 GB)** |

Predicted from geometry: 4 lanes × 15872 tokens × 34 KiB = **2.06 GB** (the remainder is batch
scratch). KV is per-lane; there is no sharing. Single-stream performance is unharmed by enabling it
(549.2 / 46.6 vs 551.1 / 43.8 sequential).

### 27.11 Four concurrent agents, measured (27B, 6.5k prompts each)

| Mode | ok | aggregate prefill | per-request walls | load VRAM |
|---|---|---|---|---|
| single request (reference) | 1/1 | 368.9 tok/s | 17.8 s | 19659 MB |
| sequential, 4 concurrent | **2/4** | 393.0 tok/s | 17.0 / 33.5 s (+2 × 503) | 19659 MB |
| continuous batch ×4, 4 concurrent | **4/4** | 405.9 tok/s | 16.0 / 32.5 / 48.7 / 64.8 s | 22231 MB |

The batched walls step in ~16 s increments — the requests are **admitted, then still executed
essentially one at a time**. Continuous batching converts 503 failures into queued completions; it
does not deliver concurrent execution. Aggregate prefill moves 369 → 406 tok/s (+10 %) for +2.57 GB.

**Conclusion for "4 parallel agents":** hipfire has no useful parallelism at any context size. The
correct configuration is one agent at a time with a queue that waits rather than rejects.

### 27.12 VRAM, measured continuously

A 3-second sampler ran for the whole campaign (`docs/test/hipfire-bench/2026-09-10-vram-trace.tsv`,
563 samples): **peak 24922 MB = 74.7 % of the 33382 MB card**, mean 22827 MB while a model was
resident. Across every configuration tested — 220k caps, 4 batch lanes, both models — headroom never
fell below ~8.4 GB. **VRAM is not the binding constraint; prefill throughput at depth is.**

Per-component model for the 27B, derived and then validated against measurement:

| Component | Rate | Check |
|---|---|---|
| weights + windowed DFlash draft | 16.46 GB fixed | — |
| flash-attention partials | ~0.33 MB per 128-token tile ⇒ **2.6 KB per token of `max_seq`** | predicted +158 MB for 163840→225280; **measured +182 MB** |
| KV (VMM, committed on demand) | **34 KiB/token** by geometry; **36.7–44.5 KiB/token** measured | 16/64 layers × (K 272 B + V 272 B)/head |
| per continuous-batch lane | lane_cap × 34 KiB | predicted 2.06 GB for 4 lanes; **measured +2.57 GB** |

35B: **10/40 layers carry KV** ⇒ ~21 KiB/token by geometry (~10 KiB/token observed), i.e. *lighter*
than the 27B despite being the larger model. Load VRAM 23548 MB @163840, 23657 MB @225280.

Projection for the 27B at full depth: 19.4 GB at load + 34–40 KiB/token
⇒ ~25.7 GB at 160k, ~28.0 GB at 220k. This agrees with the independently reported GGUF figure of
~27 GB at 200k.

Above the lane cap the same holds. Four concurrent 26k-token requests (each > lane_cap 15872):

| Request | wall | prefill | decode |
|---|---|---|---|
| req2 | 68.3 s | 427.9 | 34.7 |
| req0 | 137.2 s | 435.2 | 28.3 |
| req3 | 204.9 s | 435.1 | 32.5 |
| req1 | 272.6 s | 435.1 | 32.2 |
| aggregate | 272.6 s | **381.7 tok/s**, ok **4/4** | VRAM 24427 MB |

68.3 × {1,2,3,4} = 68/137/205/273 — **exact 4× serialisation**. Aggregate prefill (381.7) is *below*
a single stream (427.9). Compare the same workload sequentially: **ok 1/4**, three 503s.

**Continuous batching is admission control, not concurrency.** It is worth enabling because it turns
dropped requests into honest queueing, but it buys no throughput. Four agents take four times as long
in every mode measured.

### 27.13 Recommended configuration

Global `~/.hipfire/config.toml` (the enforced cap for every hipfire row):

| Key | Set to | Why |
|---|---|---|
| `memory.max_seq` | **225280** | matches what opencode advertises; measured cost is +182 MB (27B) / +109 MB (35B) and no throughput change |
| `memory.kv_backend` | **vmm** | `ornith-1.5` is outside the qwen3.x tag policy and would otherwise load *contiguous*, i.e. not what was measured |
| `serve.queue_timeout_ms` | **0** (no wait timeout) | at 30000 ms, 2/4 concurrent 6.5k requests and 3/4 concurrent 26k requests are dropped with 503 |
| `serve.continuous_batch_size` | 4 (optional) | no throughput gain, but converts those 503s into honest queueing |
| `serve.multi_slot` | **false** | forces `max_seq` down to `multi_slot_ctx` and rejects larger requests; disables all speculation |
| `speculation.mtp` | off | 5.2–6.4× slower on the 35B (§25) |
| `memory.cask.enabled` | false | −47 % prefill on ROCm 10 (§18), and it works by *discarding* context |

`models.yaml`: both hipfire rows at `ctx: 225280`, enforced by a new `_load_models()` invariant —
hipfire rows must all share one ctx, because there is no per-row cap.

**Engine choice — see §27.18 and §27.20.** For 160k+ work **llama.cpp is the correct engine**:
~1.0 min per 18k turn at 163840 on the q8_0 KV row, ~0.6 min on the f16 KV row, against 10.6 min
for hipfire's 27B. hipfire's niche is short-context, decode-heavy work. The settings in the table
above are the correct hipfire configuration *if* hipfire is used; they do not make it the right
engine for this workload.

**Do not plan on parallel agents inside hipfire.** One generation holds the daemon lock; neither
concurrency mode changes that. Four agents take ~4× as long in every measured configuration.

### 27.14 An unresolved discrepancy with §19

§19.1 records the 27B at **550.9 tok/s prefill on a ~55K one-shot prompt**. This session measured the
same model on a 62.5k one-shot cold prompt at **168.4 tok/s** — 3.3× slower, same engine, same quant,
same ROCm 10. Both are nominally one-shot cold numbers, so they should agree.

`max_seq` is ruled out as the cause: 27B turn-1 prefill is 469.0 tok/s at `max_seq=225280` and
431.5 at 163840 in the same depth regime, and `replay_stable_tile_count()` reduces over live tiles
only. I earlier suspected the cap and that suspicion is withdrawn.

The surviving hypothesis — **not verified, and stated as a hypothesis** — is that §19's long-context
arm ran `--warmups 2 --reps 2` (as its sibling `llamacpp-arms.sh` does), so the recorded reps were
served from a warm prefix cache and measured delta prefill rather than a cold full prefill. That
would inflate the figure by roughly the observed factor. Until someone re-runs §19's arm with a
nonce-forced cold prompt and no warmups, **§19's 550.9 should not be quoted as a cold-prefill
number**, and neither should the llama.cpp 595.3 beside it.

### 27.15 Multi-slot could not be made to serve — cause undetermined

Two attempts:

1. First arm passed `--kv-backend vmm` (my harness bug). The daemon refused exactly as the source
   says it would: *"experimental multi-slot uses fixed slot arenas and requires
   `kv_backend=contiguous`; serving lazily"* — a clean empirical confirmation of `slots.rs:1001`.
2. Re-run with `contiguous` and every speculator off: the model **loaded** (24618 MB) but **every
   request returned HTTP 500**, and a 40k over-cap request returned an empty completion in 0.1 s.

The daemon log rotated before it could be read, so **the cause of the 500s is undetermined**.
`validate_generate_caps` refuses images, tool messages, `tools`, `stop`, `logprobs`,
`reasoning_effort`, `max_think_tokens` and non-neutral `presence_penalty`/`frequency_penalty`/`min_p`
— the probe sent none of these, so the refusal is unexplained.

This is *not* pursued further because multi-slot is disqualified for this workload regardless:
`max_seq` is forced down to `multi_slot_ctx` and larger requests are rejected outright, and every
speculator is refused. **No claim is made here about multi-slot's concurrency, in either direction.**

### 27.16 The 35B's HTTP 500 at 225280 did not reproduce

The first 35B run at `max_seq=225280` failed with HTTP 500 on turn 2. A clean re-run reproduced the
*performance* exactly and did not reproduce the failure:

| Turn | @163840 | @225280 (retry) |
|---|---|---|
| 1 | 1978.9 / 144.2 / 9.6 s | 2000.5 / 143.3 / 9.4 s |
| 2 | 823.3 / 121.5 / 22.5 s | 832.3 / 118.8 / 22.0 s |
| 3 | 316.6 / 104.9 / 57.1 s | 321.0 / 102.3 / 56.1 s |

(prefill tok/s / decode tok/s / wall). The two caps are indistinguishable, which is the cleanest
available evidence that **`max_seq` costs allocation, not throughput**.

The 500 is therefore recorded as a **transient failure of undetermined cause** — the same bucket as
the intermittent cold-load spin — and *not* as a property of 220k. Its log was lost because the probe
copied `serve.log` at load time, before the request; the retry preserves the log after the run.

### 27.17 The hipfire rows never think

Every hipfire load logs `[WARN: INVALID CONFIG] reasoning.effort 'xhigh' dropped: thinking disabled`.
The `xhigh` comes from the model's registry card; global `reasoning.mode = off` discards it. Harmless
as a warning, but it means **the hipfire rows generate non-reasoning output**, while the llama.cpp
rows expose `high`/`none` reasoning variants in the opencode menu.

Consequence for every wall-time in this section: they are comparable to llama.cpp's
`chat_template_kwargs.reasoning_effort=none` arm, **not** to its thinking arms. Whether dp-forge's
spec/plan/review work should have thinking enabled is a quality decision that has not been made
deliberately here.

### 27.18 Cross-engine at depth — this reverses the recommendation

Identical incremental shape (~18k-token delta per turn, prior turns cached), 27B Q4_K_XL on
llama.cpp Vulkan via llama-swap (`ctx220k-kvq8-mtp-frog`) against both hipfire rows.

| Depth | hipfire 27B | hipfire 35B | llama.cpp 27B |
|---|---|---|---|
| 18.3k | 469.0 | **1978.9** | 853.2 |
| 36.5k | 260.5 | 823.3 | 639.9 |
| 54.4k | 108.7 | 316.6 | **516.0** |
| 72.9k | 80.5 | 214.0 | **423.7** |

Power-law fits (prefill rate vs depth), 4 points each:

| Engine | exponent | R² |
|---|---|---|
| hipfire 27B | -1.324 | 0.961 |
| hipfire 35B | -1.654 | 0.983 |
| **llama.cpp 27B** | **-0.499** | 0.989 |

**hipfire's prefill decays roughly with the square of llama.cpp's.** hipfire wins big at short
context (the 35B is 2.3× llama.cpp at 18k) and loses decisively past ~50k. Projected:

| Depth | hipfire 27B | hipfire 35B | llama.cpp 27B |
|---|---|---|---|
| 100k | 54.4 | 128.6 | **373.6** |
| 163840 | 28.3 | 56.8 | **292.0** |
| 225280 | 18.6 | 33.6 | **249.0** |

Minutes for one 18k-token turn: at 163840, **10.6 / 5.3 / 1.0**.

**Decode inverts** (measured at 72.9k): hipfire 35B **91.2**, llama.cpp **39.7**, hipfire 27B 11.0.
For a realistic turn at 163840 (18k in, ~500 out): llama.cpp ≈ 76 s, hipfire 35B ≈ 324 s,
hipfire 27B ≈ 691 s. **Prefill dominates this workload, so llama.cpp wins ~4×.**

VRAM trade, measured: llama.cpp allocates the whole window at load — **28323 MB** to offer 220k —
while hipfire's VMM sits at **19432 MB** and commits on demand. hipfire can *declare* a huge window
cheaply; llama.cpp charges for it immediately. The f16 row loads at ctx160k for 30277 MB and
is the best-measured arm (§27.20).

**Verdict.** The ordering reverses at ~50k: any comparison taken at ≤36k picks the wrong engine.
For dp-forge's stated
workload — sudden large inputs, 160k+ windows, degradation to be avoided — **llama.cpp is the
correct engine**, and hipfire's niche is short-context, decode-heavy work.

**Refined by §27.20.** The llama.cpp column above is the *q8_0 KV* row. The
f16 KV row decays at −0.294 rather than −0.499 and projects **476 tok/s at 163840**, not 292.
The configuration to run is the f16 KV row at 160k, not the q8_0 row at 220k.

### 27.19 Incremental-growth results — 27B on both engines, 35B for reference

Incremental-growth harness, ~70k new chars per turn, prior turns cached. Card total is
32624 MB; each run had exactly one engine resident.

**A) 35B @ 225280** (load 23626 MB) — reference only; 27B is the supported scope:

| turn | ctx | prefill tok/s | decode tok/s | wall | VRAM |
|---|---|---|---|---|---|
| 1 | 18340 | 2000.5 | 143.3 | 9.4 s | 24369 MB |
| 2 | 36489 | 832.3 | 118.8 | 22.0 s | 24574 MB |
| 3 | 54418 | 321.0 | 102.3 | 56.1 s | 24796 MB |
| 4 | 72929 | 215.3 | 87.8 | 86.3 s | 24969 MB |

**B) llama.cpp 27B, q8_0 KV, ctx220k row** (load 28323 MB):

| turn | ctx | prefill tok/s | decode tok/s | wall | VRAM |
|---|---|---|---|---|---|
| 1 | 18338 | 853.2 | 56.3 | 56.5 s | 28323 MB |
| 2 | 36493 | 639.9 | 49.9 | 30.4 s | 28323 MB |
| 3 | 54399 | 516.0 | 46.5 | 36.9 s | 28324 MB |
| 4 | 72887 | 423.7 | 39.7 | 46.2 s | 28324 MB |

**C) llama.cpp 27B, f16 KV, ctx160k row** (load 30277 MB):

| turn | ctx | prefill tok/s | decode tok/s | wall | VRAM |
|---|---|---|---|---|---|
| 1 | 18493 | 901.3 | 55.9 | 31.3 s | 30277 MB |
| 2 | 36621 | 737.2 | 63.2 | 26.2 s | 30307 MB |
| 3 | 54527 | 672.9 | 54.6 | 28.5 s | 30307 MB |
| 4 | 73015 | 594.4 | 41.4 | 33.6 s | 30308 MB |

Note the VRAM column on B and C: llama.cpp allocates the whole KV window at load and it
does not move with depth (28323 → 28324 MB across 73k tokens). hipfire's grows with use
(23626 → 24969 MB). That is the VMM-vs-contiguous trade stated in §27.12, now visible
directly in the two engines side by side.

### 27.20 KV precision is the strongest knob measured on llama.cpp — 27B

Power-law fits of prefill rate against conversation depth, 4 points each, and the
projection to the two context targets:

| arm | exponent | R² | proj. @163840 | proj. @225280 |
|---|---|---|---|---|
| llama.cpp 27B **f16** KV | **−0.294** | 0.992 | **476.3 tok/s** | **433.8 tok/s** |
| llama.cpp 27B **q8_0** KV | −0.499 | 0.989 | 292.0 tok/s | 249.0 tok/s |
| hipfire 27B q8_0 | −1.324 | 0.961 | 28.3 tok/s | — |
| hipfire 35B q8_0 (retry) | −1.657 | 0.983 | 57.1 tok/s | 33.7 tok/s |

f16 KV does not merely start faster — it **decays more slowly** (−0.294 vs −0.499). The
gap widens with depth: +5.6% prefill at 18k, +40% at 73k, +63% projected at 160k. Decode
is also ahead at every depth but turn 4 (55.9/63.2/54.6/41.4 vs 56.3/49.9/46.5/39.7).

The mechanism is that q8_0 KV pays a dequantisation step per attention block on every
token of history, so its cost scales with the history being attended to, which is exactly
the term that grows. That makes KV quantisation the wrong place to buy VRAM back for a
long-context agentic workload — it taxes the operation whose cost is already growing.

**The trade, stated plainly.** f16 KV costs 1954 MB more at load (30277 vs 28323 MB) and
caps the window at 160k instead of 220k, because llama.cpp reserves the whole window up
front. At 30308 MB it sits at 92.9% of a 32624 MB card, which leaves no room for a second
engine — the condition that caused §27.19.

**For the stated requirement — 160k minimum, sudden large inputs, degradation to be
avoided — the f16 KV row at 160k is the best-measured configuration on this card.** It
delivers the 160k floor the user set, at a projected 476 tok/s prefill where hipfire
projects 28. It does not deliver 220k; 220k on llama.cpp requires q8_0 KV and costs 39%
of the prefill rate at 160k.

### 27.21 `hipfire bench` concurrency sweep — 27B, the engine's own instrument

`hipfire bench qwen3.8-27b.mq4-pro --concurrency 1,2,4 --backend both --workload both
--spec dflash --ctx 8192 --pp 8192 --tg 128 --runs 3 --warmups 2 --kv-backend vmm`.
Card verified free before the daemon booted (≥26 GB free required, 29857 MB free after).

| backend | workload | k | aggregate tok/s | per-stream | prefix hits | rejected |
|---|---|---|---|---|---|---|
| noslots | stateless | 1 | 31.12 | 31.12 | 0 | 0 |
| noslots | stateless | 2 | 31.20 | 15.60 | 0 | 0 |
| noslots | stateless | 4 | **39.89** | 9.97 | 0 | 0 |
| noslots | multiturn | 1 | 28.88 | 28.88 | 0 | 0 |
| noslots | multiturn | 2 | 30.35 | 15.17 | 0 | 0 |
| noslots | multiturn | 4 | **36.50** | 9.13 | 0 | 0 |

**Four concurrent streams buy 1.28× aggregate throughput, not 4×** (39.89 / 31.12 stateless,
36.50 / 28.88 multiturn), and per-stream rate collapses to roughly 1/k — 31.12 → 15.60 → 9.97.
This is hipfire's own harness reaching the same conclusion as the HTTP measurements in §27.8
and §27.11, by a different code path. Nothing was rejected at these settings, because
`serve.queue_timeout_ms` is now 0.

**Only the `noslots` backend produced rows.** The bench reported the batch backend
unusable, verbatim:

```
batch backend unavailable: hipfire_client::Engine has no public multi-inflight API:
its reader thread drops lifecycle frames for unregistered (id, attempt_id) keys, so
pipelined generates deadlock.
```

That is a limitation of the in-process client the bench drives, not proof that the daemon's
HTTP continuous-batching path is broken — that path did serve 4/4 requests in §27.11. The two
should not be conflated. The `slots` backend likewise emitted no rows in this run.

**`prefix hits = 0` on the multiturn workload.** The bench's own multiturn generator recorded
no prefix-cache reuse at these settings. This does not contradict §27.6, where reuse was
verified working over HTTP (turn 2 cost `delta/rate`, not `ctx/rate`); it means the bench's
multiturn shape did not exercise it. Treat the multiturn rows above as a concurrency curve
only, not as evidence about caching.

The daemon re-confirmed the lane cap on boot, unchanged from §27.10:

```
[daemon] continuous batch lane capacity clamped: requested=225280 supported=15872
[daemon] continuous batch staged: slots=4 lane_cap=15872 repeat_cap=2048
```

The bench's own caveat is worth preserving: SlotEngine runs in-process while the daemon path
pays JSONL pipe encode/decode per token, so cross-backend absolute rates are not comparable —
and each backend is held at max concurrency while k varies, so the KV arena is sized for the
maximum at every point. These are concurrency curves, not memory-footprint curves.

## 28. Fixing the 27B — thresholds and switches, measured one at a time

Goal set 2026-09-10: make the 27B match or beat llama.cpp at every depth by configuration alone, or
prove it cannot. Scope: 27B only, single stream, safe values, blockers first. Every arm below is one
variable against the §27.6 baseline, on the same incremental-growth probe (4 turns × ~18k tokens,
prior turns cached), the card verified exclusive by `bench/lib/gpu_exclusive.sh` before each boot.
Boots: `hipfire serve --model qwen3.8-27b.mq4-pro --kv-backend vmm`, `max_seq=225280`,
`serve.continuous_batch_size=1`, MTP off, CASK off, `reasoning.mode=off`.

### 28.1 The prefill blocker is a threshold in the attention dispatcher, not a memory limit

`crates/hipfire-dispatch/src/families/attention.rs`, arm `AttnQ8_0KvBatchedMasked`: on gfx1201 the
fast WMMA "query16" prefill-attention kernel is default-on only inside a measured envelope —
`gfx12_query16_default_eligible`: `head_dim ∈ {64,128,256}`, `256 ≤ ctx ≤ 32_768`, and at least 128
`(query tile, head)` workgroups. The code's own note: *"Above ~60K the combined K+V working set crosses
the R9700 last-level-cache boundary and the lower-workgroup query16 path can lose, so 32K is the
certified upper bound."* — certified on an `nh=8, nkv=2` model, not the 27B (`nh=24, nkv=4`).

Past 32k the dispatch falls to the **legacy tiled kernel** (`attention_flash_q8_0_batched_masked`,
partials + reduce pass, scratch sized by `kernel.flash_partials_batch`, default 16). The comments in the
same arm rate the query-tiled scalar flash kernel at ~1.8× that fallback and WMMA at ~1.9× the scalar
one — i.e. the route hipfire silently takes above 32k is ~3.4× slower per attention pass than the one it
takes below. That is the shape of the `depth^-1.324` curve in §27.6: a kernel switch at 32k stacked on
the ordinary O(depth) growth.

Override: `HIPFIRE_FLASH_PREFILL=1` (persistent form: `hipfire config set developer.flash_prefill 1` —
`developer.<suffix>` maps to `HIPFIRE_<SUFFIX>` per `developer_env_for_key`). `0` forces the legacy path
everywhere. Precision caveat from the source: the WMMA kernel computes in f16 ("relative L2 ~1e-3 vs
the f32 reference"); on gfx11 hipfire measured +0.0066 nats perplexity (not significant), top-1
preserved at 95.2% with divergence confined to near-ties. llama.cpp's Vulkan flash attention is f16
too, so this does not put hipfire at a quality disadvantage relative to the comparison arm.

The lane cap `requested=225280 supported=15872` (§27.10) is **only** the continuous-batch engine's
per-lane LDS bound (`batch_staging.rs`); the single-stream path never sees it. It is not the prefill
blocker.

### 28.2 Arm 1 — `HIPFIRE_FLASH_PREFILL=1`, DFlash on (MEASURED)

| turn | ctx | prefill tok/s | baseline §27.6 | gain | wall | baseline wall | VRAM |
|---|---|---|---|---|---|---|---|
| 1 | 18340 | 461.2 | 469.0 | 0.98× | 44.7 s | 40.3 s | 21914 MB |
| 2 | 36500 | 325.1 | 260.5 | 1.25× | 58.7 s | 70.5 s | 22646 MB |
| 3 | 54450 | **237.1** | 108.7 | **2.18×** | 81.9 s | 166.2 s | 23222 MB |
| 4 | 72972 | **182.5** | 80.5 | **2.27×** | 109.5 s | 232.6 s | 23825 MB |

Power-law fit: **prefill ∝ depth^-0.671** (was −1.324). Turn 1 is inside the envelope and unchanged,
as the mechanism predicts. Load VRAM 19920 MB; the fix costs no memory.

It is still not llama.cpp. At 73k llama.cpp f16 KV does 594 tok/s (§27.19); hipfire now does 182.
And the bound is visible without another measurement: hipfire's **18k** rate (461, matching its own
ladder figure of 473.8 for this quant) is already below llama.cpp's **73k** rate. Attention's share at
73k is `1/182.5 − 1/461.2 = 3.3 ms/token`; if attention became free, hipfire would sit at ~461 at
every depth — still 0.78× llama.cpp at 73k and 0.51× at 18k. The non-attention prefill path (the
`GemmMq4G256V2` batched WMMA GEMMs, ~26 TFLOPS effective on a ~96 TFLOPS part) is the ceiling, and it
has no configuration knob: rocBLAS is not on this weight format's route, `kernel.prefill_batched` is
already on, and the remaining `diagnostic.kernel.*` variants are per-kernel research toggles.

**Conclusion for prefill: a 2.3× fix exists and is one switch; parity with llama.cpp does not, by
configuration.** The remaining gap is kernel work — a larger-than-16-query tile to amortise Q8 KV
dequantisation, and a faster MQ4V2 prefill GEMM.

### 28.3 The §24 GPU memory fault is not rare when DFlash is off — it is the DFlash-off shape

Two more occurrences today, both on the **first request after load** with `HIPFIRE_DFLASH_MODE=off`
(draft not loaded), both in the same kernel as §24:

```
Memory Fault Error [host: bipubi, GPU index: 0, faulting addr: 0x6c80ee578000, kernel: gemm_gate_up_mq4g256v2_wmma_gfx12_bt12]
Memory Fault Error [host: bipubi, GPU index: 0, faulting addr: 0x608076528000, kernel: gemm_gate_up_mq4g256v2_wmma_gfx12_bt12]
```

Tally for that request shape (first prompt after a DFlash-off load, 6k–18k tokens), counting every
boot in this document:

| campaign | draft-free boots | faults | rate |
|---|---|---|---|
| §24 | 4 | 1 | 25% |
| §28 arms (`specoff`, `minctx`, n-gram, PM4 off) | 9 | 4 | 44% |
| §28.3 warm-up campaign (below) | 6 | 2 | 33% |
| **total** | **19** | **7** | **37%** |

**The fault is not specific to the 27B artifact — it reproduces on a different model in a different
kernel (MEASURED 2026-09-10).** `muse-glimmer` (30B dense, arch 14, a freshly downloaded and
registry-verified artifact) faulted on its **first request**, draft-free, in a different GEMM:

```
Memory Fault Error [host: bipubi, GPU index: 0, faulting addr: 0x6dd1e6f4c000,
  kernel: gemm_hfq4g256_residual_wmma_gfx12_bt12]
[rdna-compute] failed to release VMM arena during Gpu drop: HipError(700): hipSetDevice: an illegal memory access was encountered
```

Different model, different quant family (`hfq4g256` vs `mq4g256v2`), different kernel
(`residual` vs `gate_up`) — same signature: **gfx12 WMMA GEMM, first large request, draft-free
allocation layout**. That rules out "a bad 27B artifact" and makes this a systematic gfx12 issue with
the draft-free layout. It also strengthens the §28.10 upstream item from "report the 27B fault" to
"report a class of fault reproducible on two unrelated models".

(The muse boot was draft-free only because `developer.dflash_draft` is a **global** path pinned to the
27B head; muse is arch 23 and refused it — `glimmer drafter arch_id 20 != 23`. So §23.2's
"a forced global speculation setting destroys the other model" bit a third model, and the punishment
for landing draft-free was this fault.)

Every DFlash-**on** boot in this document (§24 ×2, §27 all arms, §28.2) has been fault-free. So
"DFlash off" — the setting the decode data below argues for — is the setting that wedges the daemon,
and `/health` keeps answering `ok` while it is wedged (§24.2). Operationally:
`bench/lib/gpu_exclusive.sh` cannot see this; the probe runner now watches `serve.log` for
`Memory Fault` and aborts the request instead of waiting out its 2400 s timeout.

**Warm-up is not a workaround (MEASURED).** The hypothesis was that the fault is a first-touch
allocation race, so a trivial request would page the weights in before the real one arrives. Six
draft-free boots (`HIPFIRE_SPECULATION=off`), each: a 15-token "Say OK." request, then an
18k-token prompt.

| boot | warm-up (ctx 15) | 18k request |
|---|---|---|
| 1 | 257.9 tok/s, 0.2 s | 572.6 tok/s, 35.8 s |
| 2 | 266.0 tok/s, 0.2 s | 572.8 tok/s, 35.5 s |
| 3 | 268.3 tok/s, 0.2 s | 571.1 tok/s, 35.9 s |
| 4 | 263.2 tok/s, 0.2 s | 569.4 tok/s, 35.8 s |
| 5 | 265.6 tok/s, 0.2 s | **GPU memory fault** |
| 6 | 268.6 tok/s, 0.2 s | **GPU memory fault** |

The warm-up itself never faults and never fails — and it does not protect the request after it. Both
faults landed on the 18k prompt with the tiny request already served, so the trigger is not
first-touch: it is the *first large* `gemm_gate_up` launch on a draft-free allocation layout. A
warm-up large enough to trigger it would itself be the fault. **No config-level workaround exists for
this**; the only safe draft-free deployments are ones where a wedged daemon is detected and
restarted (§28.9).

The four surviving boots also give the cleanest read of the draft-free 18k prefill ceiling in this
document: **569–573 tok/s, spread 0.6%** — tighter than any other arm, and the number §28.2's
"draft costs 23–30% of prefill" and §28.8's 604 tok/s should be read against.

### 28.4 Knob audit — what the rest of the config surface can and cannot do here

Read from `hipfire.dev/docs/config` and the source; nothing in this table was measured unless marked.

| knob | current | verdict |
|---|---|---|
| `memory.kv_cache` (auto → q8) | q8 | The only lossless option **on this model**. Corrected proof in §28.11: `f16`/`f32` ARE accepted by the config validator (`KV_MODES`), so `hipfire config set memory.kv_cache f16` succeeds and looks applied — but no load-site policy in `crates/hipfire-runtime/src/kv_mode.rs` lists `F16` in its `accepted` set, and `normalize_full` does not even map the string, so it resolves to **q8** with a warning. The llama.cpp f16-KV advantage of §27.20 cannot be replicated. The 4/3/2-bit `asym`/`fwht` modes go the other way, trading accuracy for bandwidth; measured in §28.11. |
| `memory.kv_adaptive` | off | Runtime VRAM-fit precision tiering — lowers KV precision under pressure. VRAM is not the constraint (peak 24.9 GB of 32.6). Leave off. |
| `memory.cask.*` | off | CASK/TriAttention is **eviction**: `cask_budget=512` is the active-token target after eviction. It discards context; the §22 measurement also showed −47 % prefill. Never for a 160k agentic window. `cask_auto_attach` stays false so a sidecar next to the model file (`qwen3.8-27b.mq4-pro.cask.sidecar` exists) is not silently attached. |
| `speculation.prefill.*` (PFlash) | off | Speculative-prefill **compression**: keeps `keep_ratio=0.05` of prompt tokens above `threshold=32768`. Lossy by design; it also disables the prompt cache (§28.6). Off. |
| `kernel.flash_partials_batch` | 16 | Sizes the scratch of the *legacy tiled* prefill kernel only. Irrelevant once `developer.flash_prefill=1` keeps prefill on the WMMA route; 64 would cost +2.1 GB at this `max_seq` for nothing. |
| `HIPFIRE_PREFILL_MAX_BATCH` | 384 (gfx1201 default) | The prefill chunk. hipfire's own gfx1201 sweet spot; the attention KV traffic per token does not depend on it. Left alone. |
| `attention.flash` | auto | On gfx11/gfx12 `auto` already resolves to always-flash (`attention_flash_mode`); nothing to gain. |
| `experimental.graph.ar` / `HIPFIRE_GRAPH` | default | AR decode HipGraph capture is default-on for gfx11/gfx12 (`dense_tp_graph_enabled`); the DFlash verify forward is graph-captured too (`[verify-graph] captured for B=16 with 1090 blobs`). Already on. |
| Redline / retained-PM4 replay (`replay.backend`) | unset | Automatic default only for `.mq4r` files on gfx1100/1151/1201; the only certified admission is LFM2.5-350M. This model is `.mq4-pro` (MQ4V2). Research-grade opt-in only. Not used. |
| `HIPFIRE_DFLASH_VERIFY_PM4` | off | The one RDNA4-specific production switch: retained-PM4 route for the B=16 DFlash verify forward, admitted only on exact gfx1201 + Q8 KV + Q8 DeltaNet state + this draft's `target_layer_ids`. The daemon confirmed `DFlash verify PM4: armed (B=16, exact gfx1201)`. Measured in §28.5. |
| Decode state fusions (`gdn_compact2/3`, `gated_norm_mq_rotate`, `fa_prep_fuse`, `fa_epilogue`) | code-gated | For the 27B dense shape (`dim 5120, nh 24, nkv 4, n_v_heads 48`) most are admitted on **gfx1100 only**; on gfx1201 only the A3B shape qualifies (`forward.rs` §`gfx1201_qwen35_a3b_state_fusion_shape`). Each was worth +0.4–0.5 % on gfx1100. Not a config matter, and not the gap. |
| `serve.continuous_batch_size` | 1 for these arms | >1 only stages 15872-token lanes for concurrent requests; single-stream unaffected. §27.21: 4 streams = 1.28× aggregate. The goal's 1.5× at 2 streams is not met by any hipfire mode measured (2 streams = 1.00–1.05×). |
| `memory.prompt_cache_capacity` | 512 | Not a KV cache — see §28.6. |

### 28.5 DFlash decode — the prefill switch has a second edge

Decode in arm 1 (§28.2), DFlash on, `HIPFIRE_FLASH_PREFILL=1`:

| turn | ctx | out tokens | decode tok/s | τ | §27.6 decode (DFlash, default route) |
|---|---|---|---|---|---|
| 1 | 18340 | 31 | 6.4 | 1.82 | 27.4 |
| 2 | 36500 | 41 | 14.2 | 7.20 | 22.1 |
| 3 | 54450 | 31 | 5.0 | 2.88 | 12.7 |
| 4 | 72972 | 41 | 5.1 | 4.13 | 11.0 |

A 256-token sample on the same switch plus `HIPFIRE_DFLASH_VERIFY_PM4=1` (PM4 armed, confirmed by the
daemon) at 18346 ctx: **6.7 tok/s, τ 1.38** — five times slower than the AR ceiling of ~31.8 that
hipfire's own ladder gives this quant, and four times slower than §27.6's DFlash figure at the same
depth. The 31–41-token rows are too short to be rate claims on their own (rule §24.4), but the
256-token row is not, and it agrees with them.

The cause is in the same dispatcher arm as §28.1. `HIPFIRE_FLASH_PREFILL=1` sets `flash_optin` for
*every* batched attention call, including the DFlash **verify** forward (batch 16). On gfx12 the WMMA
route explicitly excludes `DispatchWorkload::SpeculativeVerify`
(`gfx12_query16_workload_eligible`), so with the switch on, verify falls through to the scalar
query-tiled kernel (`attention_q8_0_flash_prefill`, `BR=8`) whenever `ctx > HIPFIRE_FLASH_PREFILL_MIN_CTX`
(default 10240). For a 16-row verify batch that kernel launches `16/8 × 24 heads = 48` workgroups on a
64-CU part — the "8× fewer workgroups" case the source itself warns loses below ~10k. Without the
switch, verify takes the tiled partials kernel (§27.6's route).

The two routes are separable by one more variable: `HIPFIRE_FLASH_PREFILL_MIN_CTX=1000000` keeps the
WMMA route for ordinary prefill (its `wmma_ok` test does not consult `MIN_CTX`) and, for verify, makes
the scalar branch unreachable so dispatch drops to the default crossover path (LDS kernel ≤ 4096,
tiled partials above). Measured next.

**Arm `minctx` — `HIPFIRE_FLASH_PREFILL=1 HIPFIRE_FLASH_PREFILL_MIN_CTX=1000000`, DFlash on, 256-token
answers (MEASURED):**

| turn | ctx | prefill tok/s | decode tok/s | τ | wall | VRAM |
|---|---|---|---|---|---|---|
| 1 | 18346 | 468.5 | 21.9 | 1.71 | 50.9 s | 21767 MB |
| 2 | 36738 | 326.3 | 17.8 | 2.15 | 70.1 s | 22529 MB |
| 3 | 54910 | 231.6 | 11.7 | 1.66 | 99.4 s | 23189 MB |
| 4 | 73664 | 164.4 | 11.4 | 2.15 | 135.1 s | 23750 MB |

Prefill is unchanged from arm 1 (the WMMA route survived the second variable, as the source reading
predicted: 468/326/232/164 vs 461/325/237/182 — within noise, turn 4 slightly lower on a slightly
deeper context). Decode recovered from 6.7 → 21.9 at 18k, which confirms the verify-route diagnosis,
but stays **below hipfire's own AR ceiling (31.8) at every depth** and decays to 11.4 at 73k. Real
prose/code text gives τ 1.7–2.2, not the τ 13.11 of hipfire's synthetic ladder prompt (which yields
its 258 tok/s headline); at τ ≈ 2 a verify forward of 16 tokens through 64 layers plus the draft costs
more than the ~2 AR steps it replaces. For comparison, llama.cpp with its in-GGUF MTP head decoded at
55.9 (18k) and 41.4 (73k) in §27.19.

**Arm `minctx_pm4` — as above plus `HIPFIRE_DFLASH_VERIFY_PM4=1` (daemon: `DFlash verify PM4: armed
(B=16, exact gfx1201)`), 256-token answers (MEASURED):**

| turn | ctx | prefill tok/s | decode tok/s | τ | wall | VRAM |
|---|---|---|---|---|---|---|
| 1 | 18346 | 469.2 | 15.8 | 1.77 | 55.4 s | 21729 MB |
| 2 | 36738 | 332.5 | 14.4 | 2.23 | 72.4 s | 22506 MB |
| 3 | 54910 | 231.5 | 9.4 | 1.60 | 104.7 s | 22941 MB |
| 4 | 73664 | 146.7 | 9.2 | 1.97 | 154.2 s | 23542 MB |

The retained-PM4 verify route is **slower at every depth** than the HipGraph verify it replaces
(15.8/14.4/9.4/9.2 vs 21.9/17.8/11.7/11.4), with τ unchanged — so it is the verify forward itself, not
acceptance, that got slower. Prefill is identical (the switch does not touch it). Single run per arm,
so the §24.4 spread applies, but the four turns move together. **Leave `HIPFIRE_DFLASH_VERIFY_PM4`
unset.** It is the only RDNA4-specific production switch in the config surface, and it does not pay
on this model.

**Arm `specoff` — `HIPFIRE_SPECULATION=off` (daemon: `dflash_mode=off — skipping draft load`), plain AR,
256-token answers (MEASURED). No memory fault on this boot (§28.3 tally: 2 faults in 3 DFlash-off
first requests today):**

| turn | ctx | prefill tok/s | decode tok/s | wall | VRAM |
|---|---|---|---|---|---|
| 1 | 18346 | **606.7** | 16.1 | 46.2 s | 19673 MB |
| 2 | 36738 | 360.7 | 15.4 | 67.0 s | 20592 MB |
| 3 | 54910 | 210.3 | 24.6 | 95.7 s | 21025 MB |
| 4 | 73664 | 129.4 | 23.2 | 154.1 s | 21690 MB |

Three things in one table:

1. **The DFlash draft costs ~23–30 % of prefill at short depth** (606.7 vs 468.5 at 18k; 360.7 vs
   326.3 at 37k): the 5-layer draft prefills the prompt too. At 55k–73k the draft-off arm is *slower*
   (210/129 vs 232/164), which is not a draft effect — see 3.
2. **DFlash pays at short depth on real text, barely**: 21.9 vs 16.1 AR at 18k (1.36×), 17.8 vs 15.4 at
   37k (1.16×); by 55k+ it is 11.4–11.7 against AR's 23–25, a 2× loss — its verify attention reads the
   full KV per window. And the absolute AR figure, 16 at 18k, is half of hipfire's ladder number for
   this quant (31.8), which brings us to —
3. **Decode turns 3–4 are 1.5× faster than turns 1–2 at deeper context.** Not a depth effect. The
   1-second clock trace taken during this arm shows the **memory clock averaging 400–1000 MHz of a
   1265 MHz maximum, with 60–90 % of samples below 1000 MHz, while the card draws 110–175 W**:

   | 30 s window | mem clk avg | samples < 1000 MHz | power avg |
   |---|---|---|---|
   | 15:59:30 | 603 | 10/16 | 142 W |
   | 16:00:00 | 742 | 19/24 | 163 W |
   | 16:00:30 | 999 | 11/23 | 174 W |
   | 16:01:00 | 802 | 18/24 | 158 W |
   | 16:01:30 | 464 | 20/23 | 111 W |
   | 16:02:00 | 404 | 21/24 | 115 W |
   | 16:02:30 | 431 | 19/24 | 113 W |
   | 16:03:00 | 648 | 14/24 | 116 W |

   Decode is memory-bound; a step taken at 456 MHz memory clock is a ~3× slower step than one at
   1264. This is the mechanism behind §24.4's 16.2 / 16.2 / 30.4 spread on identical runs, and it caps
   every decode number in this document — both engines' — well below the card's bandwidth bound
   (16.46 GB / 640 GB/s ⇒ 38.9 tok/s). The gfx clock held 3150–3300 MHz throughout; only the memory
   clock is moving. The operator's reading (2026-09-10, not investigated further by instruction) is that
   this is the **power cap — 210 W applied against a 330 W limit — or thermal throttling**, not DPM
   policy: `amd-smi static` reports `MAX_POWER_LIMIT: 330 W`, and the samples above sit at 110–175 W.
   Treat every decode figure here as taken under that cap; the same cap applied to the llama.cpp rows
   in §27.19, so the cross-engine ranking stands, but absolute decode numbers on an uncapped card will
   be higher for both.

### 28.6 `memory.prompt_cache_capacity` is a tokenisation cache; KV reuse is one conversation deep

Two different caches, read from `crates/hipfire-generate/src/ar.rs` (§"Prompt cache (LCP-based)"):

1. **`memory.prompt_cache_capacity` = the assistant-turn tokenisation cache** (`asst_turn_cache`,
   default 32, ours 512). It stores the verbatim token IDs the model *emitted* for each assistant turn,
   keyed by a fingerprint of the message, so that re-rendering the conversation on the next request
   reproduces the exact token sequence (BPE re-encoding of decoded text is not bijective). It holds no
   KV, costs no VRAM, and has nothing to do with system prompts. 512 is more than any conversation
   needs; 32 would do.

2. **KV prefix reuse = longest common prefix against the single resident conversation.** The daemon
   keeps one `conversation_tokens` buffer. A new request is rendered, compared token-by-token against
   it, and on a **hit** (`lcp == prior_len`, i.e. the new prompt extends the old one) `seq_pos = LCP`
   and only the suffix is prefilled — that is the reuse §27.6 verified. On a **miss** ("divergence in
   the middle") the engine does a **full reset**: `seq_pos = 0`, DeltaNet state zeroed, and the *whole*
   prompt is prefilled again, shared system prompt included. The source is explicit about why:
   *"DeltaNet is not reversible to position M<N so partial rollback is unsafe."* The 48 linear-attention
   layers carry a cumulative recurrent state, and hipfire keeps no checkpoints of it.

So for the question asked — *can the common system prompt of all the code-writer agents be cached?* —
the answer is: **only while one agent talks to the engine.** The moment a second agent's conversation
arrives, the first agent's history is gone from the KV, and the shared system prompt is re-prefilled
along with everything else. Measured in §28.7. llama.cpp is structurally different on the same model:
`llama-server` holds one KV + recurrent state per slot (`--parallel N`) and keeps recurrent-state
checkpoints for hybrid models, so agents interleaving through llama-swap keep their own caches.

### 28.7 Interleaved agents, measured — every switch is a cold prefill

Two agents A and B share a ~4.4k-token system prompt and hold separate ~18k-token histories; they
alternate against the daemon (DFlash on, `developer.flash_prefill=1`, 48-token answers):

| request | agent | ctx | new input | prefill tok/s | wall |
|---|---|---|---|---|---|
| 1 | A | 22813 | 70000 chars | 442.2 | 53.4 s |
| 2 | B | 22728 | 70000 chars | 452.0 | **52.2 s** |
| 3 | A | 22998 | **400 chars** | 450.0 | **52.4 s** |
| 4 | B | 22891 | 400 chars | 451.0 | 52.3 s |
| 5 | A | 23177 | 400 chars | 449.2 | 53.3 s |

Request 3 adds 400 characters to A's conversation and costs exactly what A's cold first turn cost.
Request 2 — B's first turn, which shares the 4.4k system prompt with A — shows no reuse either (a hit
would have saved ~10 s at this rate). This is §28.6's full reset, measured: **with more than one
conversation in flight, hipfire's effective prefix cache is zero**, and each agent switch re-prefills
that agent's entire context at the depth-dependent rate of §28.2. At 73k that is ~7 minutes per
switch. For the dp-forge shape (orchestrator + 2 subagents alternating, each carrying 50–150k) this
is the dominant cost, larger than any prefill or decode figure above. It is architectural (single
KV, irreversible DeltaNet state), not a setting.

### 28.8 n-gram speculation — the one speculator that pays on this model, and where

Same growth probe, question changed to a **copy-heavy** one ("Quote, verbatim and in full, the first
three rules that appear in part N") — the shape of agentic edits, tool-result echoes and quoted code.
Both arms: `developer.flash_prefill=1`, `developer.flash_prefill_min_ctx=1000000`, no DFlash draft.

| turn | ctx | n-gram prefill | n-gram decode | τ | AR prefill | AR decode | decode gain |
|---|---|---|---|---|---|---|---|
| 1 | 18348 | 515.1 | **119.0** | 10.09 | 604.1 | 29.5 | 4.0× |
| 2 | 36742 | 330.0 | **77.4** | 10.09 | 358.1 | 27.1 | 2.9× |
| 3 | 54916 | 231.5 | **49.6** | 9.63 | 195.4 | 25.1 | 2.0× |
| 4 | 73671 | 153.6 | **42.4** | 10.32 | 113.2 | 23.2 | 1.8× |

(`HIPFIRE_SPECULATION=ngram HIPFIRE_NGRAM_DRAFT=1`, `ngram_k=12`, `ngram_min_count=2`; n-gram arm
VRAM 18540–20917 MB, AR arm 19722–21649 MB. Turn-4 n-gram answer was 216 tokens, the rest 256.)

(**τ definition**, needed to read any of these rows: on this model's generate path
`tau = spec_accepted / spec_cycles` — *drafted* tokens accepted per speculation window, not tokens
emitted per window. The window always emits one token for free, so effective tokens per window is
`τ + 1` and **τ = 0 is exactly plain AR speed minus the drafting overhead**. hipfire's dense path uses
the other convention, `(accepted + windows)/windows`; do not compare the two directly.)

Acceptance holds at τ≈10 through 73k — the draft is model-free, it just proposes the continuation of
whatever 12-gram last occurred in the context — so the decay from 119 to 42 is entirely the verify
forward's attention over the growing KV, the same term that limits DFlash. n-gram is **byte-identical
to AR by construction** (hipfire's docs and the inventory both state it: the verify is exact), costs
no VRAM and no prefill (515/330/232/154 vs the DFlash arm's 461/325/237/182 and the draft-free AR
arm's 604/358/195/113 — the last two straddle it within the clock spread of §28.5), and it is the
only hipfire decode figure in this document that beats llama.cpp+MTP at depth (42.4 vs 41.4 at 73k)
— on this kind of output. On free prose (§28.5's summaries) it will fall back to AR speed, and AR
here is 23–30 tok/s against llama.cpp+MTP's 41–56.

The AR arm's prefill (604/358/195/113) also re-states §28.2's bound from the other side: the draft-free
non-attention ceiling at 18k is ~605 tok/s — 1.0× llama.cpp's 73k figure and 0.67× its 18k figure.

### 28.9 Small-step cadence — 16 × 5k prefill with ~1k generated per turn (STOPPED AT TURN 10)

The agentic tool-call shape, requested 2026-09-10: sixteen turns of ~5k new tokens each with ~1024
generated per turn and prior turns cached, rather than four large jumps. Arm: n-gram speculation,
`developer.flash_prefill=1`, `developer.flash_prefill_min_ctx=1000000`, no DFlash draft.

| turn | ctx | out | prefill tok/s | decode tok/s | τ | wall | VRAM |
|---|---|---|---|---|---|---|---|
| 1 | 5 681 | 1024 | 617.3 | 24.8 | 0.28 | 50.5 s | 18369 MB |
| 2 | 11 489 | 1024 | 569.2 | 19.2 | 0.23 | 73.4 s | 18544 MB |
| 3 | 18 107 | 1024 | 514.7 | 14.5 | 0.49 | 105.9 s | 18692 MB |
| 4 | 24 013 | 1024 | 473.9 | 12.5 | 0.39 | 132.8 s | 18989 MB |
| 5 | 30 555 | 1024 | 431.3 | 12.9 | 1.12 | 150.2 s | 19239 MB |
| 6 | 36 509 | 766 | 399.7 | 14.8 | 1.70 | 143.0 s | 19656 MB |
| 7 | 42 694 | *140* | 259.3 | *34.1* | 6.72 | 25.2 s | 19916 MB |
| 8 | 48 045 | 466 | 238.9 | 11.8 | 2.21 | 61.4 s | 20109 MB |
| 9 | 53 658 | 734 | 216.9 | **7.9** | 0.48 | 117.4 s | 20358 MB |
| 10 | 59 828 | *208* | 199.1 | *9.8* | 2.04 | 48.8 s | 20555 MB |

Italic decode rows are below the 256-token floor (skill rule 15) and are not rate claims. The run was
**stopped by the operator at turn 10** on the standing rule that decode below 25 tok/s is not worth
measuring further; turns 11–16 and the plain-AR control arm were never run.

**Prefill: the small-step cadence is cheaper than the large-jump one, and the fix holds here too.**
Because each step adds only ~5k tokens, the per-turn prefill rate stays far above the four-turn probe
at the same depth: 431 tok/s at 30.5k and 199 at 59.8k, against §28.2's 237 at 54.5k. Fitting turns
1–10 gives an exponent near −0.48, gentler than arm 1's −0.671, because a large share of each turn's
cost is the fixed per-request overhead spread over a small delta rather than attention over the full
KV. **For agent traffic that grows in small steps, prefill is not the blocker that §28.2's curve
suggests** — the blocker is that any *switch between conversations* discards all of it (§28.7).

**Decode: 7.9–24.8 tok/s, and the n-gram speculator does not rescue it on this workload.** §28.8 got
119 tok/s at 18k from the same speculator; here the same setting gives 14.5 at the same depth. The
difference is entirely acceptance: τ 10.09 there against 0.23–1.70 over turns 1–6 here. The n-gram
draft proposes whatever followed the last matching 12-gram in the context, so it is nearly always
right when the model **quotes** and nearly always wrong when the model **composes**. This section's
question asks for 800 words of new analysis per turn, which is the composing case. With τ below 1 the
window pays for a draft and a wider verify forward and collects one token, i.e. **worse than plain
AR** — which is why the decode column here sits below the 16–30 tok/s AR band of §28.5 and §28.8.

Turn 7 is the exception that proves the mechanism: the model gave up composing and echoed its earlier
turns, τ jumped to 6.72, and decode jumped to 34.1 on the same hardware in the same second.

**Consequence for the deployment.** Speculation is the only mechanism in this engine that can exceed
the 38.9 tok/s bandwidth ceiling (§28.10 bound 2), because one weight read serves a whole accepted
window. Whether it does is a property of the *output text*, not of the configuration. Agentic traffic
is mixed: tool-result echoes, quoted code and edit hunks copy and will speculate well; plan and
review prose does not. No single speculation setting is right for both, and hipfire has no per-request
speculation override in the config surface.

### 28.11 The three knobs the audit got wrong, re-tested (MEASURED)

§28.4 dismissed KV precision and FP8 from the config surface rather than from measurement. Both
dismissals were reached by the wrong route, so both were re-opened. Same 4-turn growth probe as arm 1
(§28.2), whose prefill baseline is **461.2 / 325.1 / 237.1 / 182.5**.

**A load line worth reading first.** Every boot in this section logs:

```
KV cache: Q8 vmm (16/64 layers carry KV; K 272B/head + V Q8 272B/head;
          mapped_prefix=1927 / physical_cap=225280 / max_seq=225280)
```

Two facts fall out. **Only 16 of 64 layers carry a KV cache** — this is a hybrid model and the other
48 layers are DeltaNet with constant state — so anything that changes KV touches a quarter of the
network. And 272 B/head at q8 (≈1.0625 B/element) means **head_dim = 256**, which is what makes the
`asym` ladder reachable at all (§28.11.2). It also confirms the 34–36 KB/token KV growth measured from
the VRAM deltas independently.

#### 28.11.1 `memory.kv_cache = f16` is accepted by the validator and silently ignored

The earlier claim "there is no f16 KV in hipfire" was true in effect and false in detail, which is the
dangerous combination. `KV_MODES` in `crates/hipfire-config/src/lib.rs:481` **does** list `f32` and
`f16`, so `hipfire config set memory.kv_cache f16` succeeds, persists, and reads back as `f16`.

It does nothing. Resolution happens per load site in `crates/hipfire-runtime/src/kv_mode.rs`, and of
the six site policies **not one lists `F16` or `F32` in its `accepted` set**; the shared alias table
`normalize_full` does not even map the string, so it returns `None` and the site default applies. For
this model that is `LLAMA_HFQ_POLICY`, default `Q8`. The field's own doc string gives the reason:
*"DeepSeek V4 currently supports f32 and f16."*

**Consequence: llama.cpp's strongest measured knob (§27.20, f16 KV, exponent −0.294 vs q8_0's −0.499)
has no counterpart here**, and an operator who sets it will believe otherwise. The config validator
accepting a value is not evidence that a load site honours it — check the resolution policy.

#### 28.11.2 The `asym` ladder goes the wrong way: −28 % prefill (MEASURED)

The ladder below q8 (`asym4/3/2`, `fwht4/3/2`) compresses KV further. On a bandwidth-bound card that
looked like the right direction, and unlike `f16` it genuinely engages — `LLAMA_HFQ_POLICY` accepts
`Asym3`/`Asym4`, gated at head_dim ≠ 256, and this model is head_dim 256.

```
KV cache: Asym4 vmm (16/64 layers carry KV; K 132B/head + V Q8 272B/head; ...)
```

Note the asymmetry: **K compresses 272 → 132 B/head, V stays at q8**. Total KV falls from ~34 to
~25 KB/token, a 26 % reduction, not a halving.

| arm | ctx | prefill tok/s | vs arm 1 |
|---|---|---|---|
| `asym4` | 18 346 | **329.6** | **0.71×** |

A 28 % regression at the shallowest depth, so the arm was stopped at turn 1 and `asym3` was not run.

The cause is dispatch, not accuracy. `AttnFlashAsym4BatchedMasked`
(`crates/hipfire-dispatch/src/families/attention.rs:1301`) routes to an entirely different family —
`try_flash_attn_ck_asym4_givens_prefill`, a composable-kernel path carrying Givens rotations — and
**never reaches the gfx12 query16 WMMA kernel that §28.1's whole fix is about**. That arm reads
`HIPFIRE_FLASH_PREFILL` only to check for an explicit *off*; setting it to `1` cannot pull this path
onto the fast kernel.

**So the entire sub-q8 KV ladder forfeits the fix.** Cheaper KV buys 26 % fewer bytes on a quarter of
the layers and pays for it with a slower attention kernel plus rotation compute. On this model the
trade is not close, and it is not an accuracy decision at all.

#### 28.11.3 `kernel.fp8_wmma` cannot fire at the shipped prefill chunk (MEASURED)

§28.4 filed FP8 as "compute-side, prefill research only" without measuring it. Measured:

| turn | ctx | `fp8_wmma=1` | arm 1 |
|---|---|---|---|
| 1 | 18 346 | 474.6 | 461.2 |
| 2 | 36 738 | 329.3 | 325.1 |
| 3 | 54 910 | 231.8 | 237.1 |
| 4 | 73 597 | 145.3 | 182.5 |

Turns 1–3 are within 2 %. Turn 4 is lower, but turn-4 prefill across four nominally comparable
DFlash-on arms in this campaign now reads **182.5 / 164.4 / 146.7 / 145.3** — a ±20 % arm-to-arm
spread at that depth, consistent with the memory-clock behaviour of §28.5. This is a null result.

It is a null result *because the switch never fired*. `crates/rdna-compute/src/gemm.rs:9919` gates the
FP8 route on `batch_size >= FP8_WMMA_MIN_BATCH`, and `dispatch.rs:178` sets that constant to **1024**:

> *"Minimum batch size at which the FP8 WMMA prefill path is enabled. Below this, the FP16 WMMA path
> wins on gfx1201 (measured 0.71-0.94× at N ≤ 512, 0.82-1.26× only at N ≥ 2048 with high DPM
> variance). Decode (batch_size=1) must never hit FP8 WMMA."*

The gfx1201 prefill chunk is **384** (`PREFILL_DEFAULT_BATCH_GFX1201`), so every prefill GEMM on this
deployment arrives at the gate with batch 384 < 1024 and takes the FP16 path. **`kernel.fp8_wmma` is
unreachable as shipped on gfx1201 for this model**, and reporting it as "measured, no effect" without
this gate would have been misleading.

`HIPFIRE_PREFILL_MAX_BATCH` (developer-scoped) overrides the 384. Raising it to 2048 is the only
configuration in which FP8 can engage, and it is measured next. Note upstream's own numbers above:
even at N ≥ 2048 the range is 0.82–1.26× with high variance, so the expected value is near 1.0.

#### 28.11.4 Raising the prefill chunk so FP8 *can* fire — still nothing (MEASURED)

`HIPFIRE_PREFILL_MAX_BATCH=2048` lifts the chunk past `FP8_WMMA_MIN_BATCH`. Two arms isolate the
chunk from FP8. The chunk change booted cleanly — the staging assertion the source warns about did
not fire.

| turn | ctx | chunk 2048 | chunk 2048 + FP8 | arm 1 |
|---|---|---|---|---|
| 1 | 18 346 | 468.7 | 467.5 | 461.2 |
| 2 | 36 738 | 326.5 | 326.0 | 325.1 |
| 3 | 54 910 | 231.2 | — | 237.1 |
| 4 | 73 664 | 144.2 | — | 182.5 |

The chunk is neutral by itself at every depth, which is what makes it a valid control; and with the
gate finally satisfied, **FP8 changes prefill by less than 0.5 %**. The FP8 arm was stopped after two
turns on the operator's standing rule against measuring sub-1 % effects. This matches upstream's own
sweep (0.82–1.26× at N ≥ 2048, "high DPM variance"). **Neither the chunk size nor FP8 is a lever
here. Leave both at their defaults.**

#### 28.11.5 The measurement spread is depth-dependent, and it corrects §28.2's headline

Six arms in this campaign ran the identical 4-turn probe with the identical fixed config, differing
only in a knob that turned out to be inert. That is an accidental repeatability study:

| depth | n | min | median | max | max/min |
|---|---|---|---|---|---|
| 18 346 | 6 | 461.2 | 468.6 | 474.6 | 1.03× |
| 36 738 | 6 | 325.1 | 326.4 | 332.5 | 1.02× |
| 54 910 | 5 | 231.2 | 231.6 | 237.1 | 1.03× |
| **73 664** | **5** | **144.2** | **146.7** | **182.5** | **1.27×** |

Repeatability is 2–3 % at the first three depths and **27 % at the fourth**. That is not uniform
noise. Turn 4 is also the only turn whose prefill runs longer than two minutes, i.e. the only one that
sustains load long enough to throttle (§28.5's clock trace, the 210 W cap). **Deep-context prefill is
an order of magnitude less repeatable than shallow prefill on this card**, and a single deep sample is
not a rate.

§28.2 quoted 182.5 tok/s at 73k. That is the **maximum** of five samples of the noisiest point in the
campaign, and it should not have been the headline. Restated on medians:

| statement | as published (§28.2) | corrected |
|---|---|---|
| 73k prefill | 182.5 tok/s | **146.7 tok/s** (median; range 144.2–182.5) |
| gain over the pre-fix 80.5 | 2.27× | **1.82×** (range 1.79–2.27×) |
| power-law exponent | −0.671 (R² 0.981) | **−0.797** (R² 0.939) |
| projection @163 840 | ~106–113 tok/s | **~88 tok/s** |
| projection @225 280 | — | ~69 tok/s |

The fix is still large and still real — 80.5 → 147 at 73k is the difference between unusable and
usable. But the gap to llama.cpp f16 KV at 160k widens from ~4.5× to **~5.4×**, and the pre-fix
baseline of 80.5 is itself a single sample subject to the same 27 % spread, so both ends of the ratio
carry that uncertainty. Every downstream document has been corrected to the median figures.

### 28.12 Decode above 50 tok/s needs a trained draft head — the card can do it, hipfire's 27B cannot

Target raised by the operator: **>50 tok/s average decode**. This is not a tuning question, and it is
not a hardware limit either. **llama.cpp reaches it on this exact card with this model class**:
55.9 / 63.2 / 54.6 / 41.4 tok/s at 18k / 37k / 55k / 73k on the incremental-growth workload (§27.19),
using the MTP head shipped inside its GGUF (`--spec-type draft-mtp`). Three of those four figures are
above 50 and all four are above the non-speculative ceiling derived below. So the target is
demonstrably reachable on this GPU. The question is why hipfire does not reach it.

**The non-speculative ceiling.** Decode reads every weight plus the whole KV cache per token. The load
line gives the KV exactly: 16 of 64 layers carry KV, 4 KV heads, K 272 B + V 272 B per head =
**34 KB/token**.

| depth | bytes read per token | ceiling at the rated 640 GB/s |
|---|---|---|
| 0 | 16.46 GB | **38.9 tok/s** |
| 18k | 17.08 GB | 37.5 tok/s |
| 73k | 18.96 GB | 33.8 tok/s |

**No configuration can reach 50 tok/s by plain decoding, on a perfectly clocked card, at any depth.**
The best AR figure measured in this document is 30.4 tok/s, which is already 80 % of the depth-adjusted
ceiling. The remaining 20 % is the memory clock sitting at 400–1000 MHz of 1265 under the 210 W cap.
Raising the cap moves 30 → at most ~38. It does not reach 50.

**Speculation is the only mechanism that can exceed the ceiling**, because one weight read serves every
accepted token in a window. Measured, it does: n-gram reached **119 tok/s at 18k**, three times the
bandwidth ceiling. Whether it does is a property of the output text (§28.8, §28.9), not of the config.

**The available speculators, and what each can deliver on this model:**

| speculator | status here | prose τ | prose decode | copy-heavy decode |
|---|---|---|---|---|
| DFlash | loaded, working | 1.7–2.2 | 11.4–21.9 | — |
| n-gram | working | 0.23–2.04 | 7.9–24.8 | **42.4–119.0** |
| MTP | **no head exists for the 27B** | — | — | — |
| DSpark | **no sidecar artifact** — requires `<stem>-dspark.<ext>`; the model directory has none | — | — | — |

DSpark was the last untested speculator and it wins the precedence cascade (§23.2), so it was worth
checking. It cannot load: the sidecar file does not exist and hipfire does not synthesise one.

**Why llama.cpp clears 50 on prose and hipfire does not.** The difference is the *quality of the
draft*, not the verify machinery or the card. llama.cpp's MTP head is trained jointly with the model
and predicts continuations of arbitrary text, so its acceptance holds on prose — which is why its
decode curve (55.9 → 41.4) decays gently and stays above the ceiling at every depth. hipfire's two
working drafts on this model are structurally weaker:

- **n-gram is model-free.** It can only propose text that already appears in the context, so its
  acceptance is ~10 when the model quotes and ~0.3 when it composes. Its 119 → 42 decay is steep
  because acceptance is workload-luck, not learned.
- **DFlash is a 5-layer draft**, tiny relative to a 64-layer target, and measures τ 1.7–2.2 on prose —
  enough to beat plain AR below 40k and not enough to clear the ceiling anywhere.

Note where the two engines converge: at 73k, hipfire n-gram on copy-heavy output does **42.4** against
llama.cpp MTP's **41.4**. When hipfire's draft is accurate, it matches. The gap is acceptance on
general text, and acceptance is a property of the draft artifact.

**Why hipfire cannot simply use MTP.** Two independent reasons, both measured:

1. **No artifact.** hipfire's 27B is `qwen3.8-27b.mq4-pro` and the model directory holds no `.mtp`
   sidecar for it (the 35B has one, `ornith-1.5-35b-a3b.mtp`, 0.485 GB). DSpark likewise requires
   `<stem>-dspark.<ext>` and none exists. hipfire does not synthesise either.
2. **Even with an artifact, hipfire's MTP path is currently a loss.** On the one model that does have
   a head, MTP measured **5.2–6.4× slower** than plain AR (§25: 175.4 → 33.7 and 177.2 → 27.9). The
   cause is structural: MTP forwards are Redline/hipGraph **ineligible** and invalidate the captured
   plain-AR graph (§23.3). Until that is fixed, shipping a 27B MTP head would not help.

**Conclusion, corrected.** >50 tok/s average is **not** a hardware bound on this card — llama.cpp
demonstrates 41–63 tok/s on the same GPU and workload. It is out of reach **for hipfire on this
model** for two artifact/implementation reasons above. With hipfire's available drafts the honest
expectation is 23–30 tok/s on prose and 42–119 on copy-heavy output, so a mixed agentic workload will
not average above 50. No configuration changes this; **the fix is an engine-side one — a trained draft
head for the 27B plus making MTP forwards graph-eligible — and it is the single highest-value item on
the upstream list, worth roughly 2× decode on general text.**

### 28.13 The prefill-attention dispatch surface is closed — all three variants accounted for

The last unexplored knobs were `HIPFIRE_FLASH_PREFILL_KERNEL` and the tile dimensions
`HIPFIRE_FLASH_PREFILL_BR` / `_BC`. Reading `attention.rs:1702-1795`, the opt-in branch is a
three-way selector and nothing more:

```
if flash_optin && tree_bias.is_none() && batch_size > 1 {
    variant = HIPFIRE_FLASH_PREFILL_KERNEL or "wmma"
    if variant == "batched"          -> attention_flash_q8_0_batched_masked   (legacy tiled partials)
    wmma_ok = variant != "scalar" && has_wmma && (!gfx12 || query16_workload_eligible)
              && head_dim % 32 == 0 && head_dim <= 256
    if wmma_ok                       -> attention_q8_0_flash_prefill_wmma     (query16 WMMA)
    if max_ctx_len > MIN_CTX         -> attention_q8_0_flash_prefill(BR, BC)  (scalar query-tiled)
}
```

**Which one this deployment runs, settled.** head_dim is 256 (from the load line: 272 B/head at q8),
so `256 % 32 == 0` and `256 <= 256` both hold, and ordinary prefill is workload-eligible. `wmma_ok` is
therefore true and **every ordinary prefill call takes the query16 WMMA kernel at every depth**. This
confirms §28.5's reading from the other direction.

**Why `BR`/`BC` are irrelevant here.** They are read only on the scalar branch, which is guarded by
`max_ctx_len > MIN_CTX`. The recommended config sets `MIN_CTX = 1000000` precisely so that branch is
unreachable, so the tile knobs cannot affect this deployment at all. They would only apply in the
configuration whose decode collapses to 6.7 tok/s (§28.5), which is not a configuration anyone should
run.

**Why the `batched` variant is not the escape above 60k.** §28.1 quotes the source's caution that
"above ~60K the combined K+V working set crosses the R9700 last-level-cache boundary and the
lower-workgroup query16 path can lose". If that materialised here, forcing `batched` would win at
depth. It is already measured: `batched` *is* the legacy tiled-partials kernel that the pre-fix
configuration fell into past 32k, and its numbers are §27.6's — **108.7 tok/s at 55k and 80.5 at 73k,
against WMMA's 231.6 and 146.7**. The caution does not materialise on this model at these depths;
WMMA wins by 1.8–2.1× exactly where it was predicted to lose.

**Conclusion: the prefill-attention surface has three variants, all three are measured, and the
configuration already runs the fastest one.** There is no remaining dispatch-level lever. Combined
with §28.11 (KV precision and FP8 are closed) and §28.12 (decode is bandwidth-bound and no
high-acceptance draft exists for this model), the configuration surface for 27B prefill and decode on
gfx1201 is exhausted.

### 28.14 The §20 load hang reproduces, and it is a CPU spin *after* the read completes

§20.4 left the 27B load hang correlated with a cold page cache: every cold load hung at layer 50–54
of 64, every warm load finished in 10–21 s. It reproduced here under conditions that sharpen the
diagnosis. A llama.cpp arm had just run, so its ~17 GB GGUF had evicted the hipfire artifact from
page cache; the next hipfire boot stalled.

| probe | reading after 306 s |
|---|---|
| `serve.log` last line | `loading layer 34/64 (LinearAttention)` — unchanged across three samples 20 s apart |
| daemon process state | `Rl`, **83–85 % of one core** |
| GFX activity | 4 % |
| memory-controller (UMC) activity | **0 %** |
| VRAM | 10 734 MB of a ~16.5 GB working set |
| daemon `rchar` | **16 470 311 035 — the entire 16.46 GB model already read** |
| daemon `read_bytes` | 25 711 923 200 (physical > logical: cold-cache readahead) |

**The read had already completed.** `rchar` equals the full model size while the loader sits at layer
34 of 64 burning a core with the memory controller idle. So the hang is **not** I/O-bound and not
"slow loading from a SATA volume" — those were §20.3's falsified theories and this measurement retires
the surviving one too. The cold page cache *correlates* with the hang, but the failure itself is a
CPU-side spin in the loader that occurs after the bytes are in hand.

That distinction matters operationally, because the two have different workarounds. If it were I/O,
faster storage would fix it. Being a spin, the only reliable mitigation found is to **keep the
artifact resident in page cache** — priming with a plain sequential read before boot — and to treat a
loader that has not advanced a layer in ~30 s as dead rather than slow.

**This also makes engine co-tenancy hazardous in a way neither engine reports.** Running llama.cpp
between two hipfire boots is sufficient to evict hipfire's model from page cache and trigger the spin
on the next boot. Any harness that alternates engines on one box inherits this, and nothing in either
engine's logs connects the cause to the effect.

**Tally.** Counting only boots where the artifact was known-cold: §20 runs 1 and 2, and this one — 3
hangs in 3 cold attempts, against 0 in every warm boot in this document. Combined with the separate
`gemm_gate_up` memory fault of §28.3 (7 of 19 draft-free boots), hipfire has **two independent
boot-time failure modes**, neither of which surfaces through `/health`.

### 28.15 Parity, on a decode-dominated shape — and the correction it forces

Operator request: measure both engines at **3k in / 10k out**, the shape of a long single coding turn
rather than a deep multi-turn history. Identical prompt (76 numbered rules to expand), identical
`max_tokens=10000`, one engine resident at a time.

| | llama.cpp, Q4_K_XL, f16 KV, in-GGUF MTP | hipfire, `.mq4-pro`, q8 KV, DFlash |
|---|---|---|
| prompt tokens | 2 594 | 2 596 |
| generated | 10 000 (`finish=length`) | 10 000 (`finish=length`) |
| prefill | 843.8 tok/s | ~600 tok/s |
| decode | **50.99 tok/s** | **~50.6 tok/s** |
| wall | **199.4 s** | **202.0 s** |
| end-to-end | 50.15 tok/s | 49.50 tok/s |

**hipfire is 1.3 % slower end-to-end — inside the run-to-run spread. This is parity.**

**Two claims earlier in this document are hereby narrowed.**

1. §28.12 concluded ">50 tok/s is out of reach for hipfire on this model". hipfire decoded 10 000
   tokens at ~50.6 tok/s here. The conclusion was generalised from decode measured at 18k–73k of
   context and does not hold at 2.6k.
2. §28.10 / §06 stated "hipfire is slower than llama.cpp at every depth". True of the depths measured
   there; false at shallow depth, which was never measured until now.

**Why the two results are consistent.** Decode cost per token is `weights + KV`. The weights term is
fixed at 16.46 GB; the KV term is 34 KB/token of context. At 73k the KV adds 2.5 GB per token *and*
the speculation verify pass must attend over all of it, which is what crushed DFlash to 11.4 tok/s. At
2.6k the KV term is ~0.09 GB, the verify pass is cheap, and acceptance converts directly into
throughput. **The engine gap is a function of context depth, not a constant property of the engine.**

Restated as the shape that actually predicts performance:

| workload shape | winner | margin |
|---|---|---|
| shallow context, long generation (one big coding turn) | **tie** | 1.3 % |
| deep context, incremental turns | llama.cpp | ~4× at 73k |
| interleaved agents at depth | llama.cpp | hipfire re-prefills fully on every switch |

**Caveat on this workload, stated rather than buried.** The prompt asks the model to expand 76
numbered rules, so the generated text repeats rule wording — more copy-like than free prose, which
raises draft acceptance for both engines. Both ran the identical prompt, so the *comparison* is sound,
but the absolute 50 tok/s should not be read as a free-prose figure. Acceptance counters
(`tau`, `ngram_mod_accept_rate` on hipfire; `draft_n` / `draft_n_accepted` on llama.cpp) are captured
separately in §28.16 to size that effect.

### 28.16 Is the prefill decay a caching artifact? No — the KV prefix cache works (MEASURED)

Hypothesis raised by the operator: hipfire's prefill has a bug. The strongest form of it — that
hipfire silently re-prefills the whole conversation each turn while reporting only the delta as
`prefill_tokens` — would make every incremental figure in §27–28 an artifact and would neatly explain
the exponent gap against llama.cpp. Tested directly with `HIPFIRE_QWEN_CACHE_TRACE=1`.

**Probe: three strictly-appending turns on a ~15.5k-token conversation.**

| turn | sent | `cached_tokens` | wall (8-token answers) | wall (400-token answers) |
|---|---|---|---|---|
| 1 | 15 519 / 15 525 | 0 | 32.91 s | 35.28 s |
| 2 | 15 543 / 15 611 | 15 527 / 15 596 | **0.41 s** | **2.35 s** |
| 3 | 15 568 / 15 670 | 15 551 / 15 654 | **0.51 s** | **2.01 s** |

**The prefix cache works.** An appending turn costs 0.4 s where a cold one costs 33 s — an ~80×
saving, and `cached_tokens` accounts for the whole prior conversation. The trace shows the hit
condition met exactly:

```
[qwen-cache lcp dflash-jinja] prior_len=15596 rendered_len=15611 lcp=15596
[qwen-cache HIT dflash] reuse prefix=15596 suffix=15 (no reset)
```

**The verbatim-splice protection also works — but only for turns that end naturally.** In the first
probe every assistant-turn lookup reported `hit=false`, which looked like a fingerprint asymmetry
between the store and lookup sides. It is not. `qwen.rs:2811` gates storage: *"Safe stop/tool_calls
only — length never stores"*. The first probe used `max_tokens=8`, so every turn ended
`finish_reason=length` and was never eligible. Re-run with turns ending on EOS, the same fingerprint
is stored and then found:

```
[qwen-cache store  dflash] fp=0x7536d552c2ae35db cached_seq=70
[qwen-cache jinja lookup dflash] fp=0x7536d552c2ae35db role=Assistant hit=true
```

**Conclusion: the caching path is sound, and the prefill decay is real work.** When hipfire reports
adding 18k tokens at 146.7 tok/s at 73k context, it is doing that work; llama.cpp doing the same delta
at 594 tok/s is a genuine ~4× difference in attention-kernel throughput at depth, not a reporting
artifact. This closes the most attractive alternative explanation for §28.11.5's exponent gap.

**The one fragility that survives.** An assistant turn truncated by `max_tokens` is never stored, so
prefix reuse across that turn depends on the client's text re-tokenising to the identical IDs. Long
code outputs that hit the cap are exactly where that risk lives, and the failure mode is silent: the
LCP breaks at that turn and everything after it cold-prefills. Two further conditions disable caching
wholesale (`cache_eligible = !cache_disabled && eviction_is_none && !conversation_tokens.is_empty()`)
— note **`eviction_is_none`: a configured CASK sidecar switches off prefix caching entirely**, which is
a second, independent cost of the §18 trap.

### 28.17 Why MTP beats DFlash: draft narrow and often, not wide and rarely (MEASURED)

Same prompt, same 2 596-token context, 2 000 generated tokens, one engine resident at a time.

| | llama.cpp, in-GGUF MTP | hipfire, DFlash |
|---|---|---|
| prefill | 816.1 tok/s | 564.8 tok/s |
| **decode** | **49.49 tok/s** | **36.5 tok/s** |
| drafted | 2 174 tokens for 2 000 emitted | block of 8–16 per window |
| accepted | 1 273 → **58.6 % hit rate** | τ **2.42** per window |
| tokens per verify pass | **1.59** | 3.42 |
| verify passes per second | **31.2** | 10.7 |
| ms per verify pass | **32 ms** | 93 ms |

**The two speculators make opposite bets, and the cheap one wins.** MTP drafts roughly one token per
step and hits 58.6 % of the time, so every forward is a normal-width forward and lands 1.59 tokens.
DFlash drafts a whole block and gets 2.42 accepted — a ~15–30 % hit rate on the block — so it lands
more per window but pays 93 ms for each one against MTP's 32 ms, and ends up running **three times
fewer windows per second**.

Where the 93 ms goes: a DFlash window is a 5-layer draft run forward `block_size` times *plus* the
batched target verify. On a bandwidth-bound decode the verify's batch width is nearly free (the
weights are read once regardless of batch), so the extra cost is the serialised draft chain and the
verify route itself — the same route §28.5 measured at 21.9 tok/s against plain AR's 29.5 at 18k.

**This is not a tunable.** `speculation.dflash_adaptive_b` is already `true` (built-in default), and
the draft's `block_size` comes from the artifact (`block=8` in the load line), not from the config
surface — there is no `speculation.dflash_block` key. So the width/cost trade is a property of the
DFlash design and the shipped draft head, not a setting to correct.

**Consequence for the upstream ask in §28.10.** "A trained draft head for the 27B" should be read
specifically as *a narrow, high-acceptance head in the MTP mould*, not a wider DFlash block. The
measurement says acceptance-per-cost is what matters: 58.6 % on a 1-token draft beats 2.42 accepted
from a block of 8, by 1.36× on this workload, on the same card.

**Caveat.** This prompt (expand 76 numbered rules) produces repetitive output, which lifts acceptance
for both engines; hipfire's τ here is 2.42 against 1.7–2.2 on the free-prose probe of §28.5. The
*ratio* between engines is the transferable result, not the absolute rates.

### 28.18 muse-glimmer — attempted on the same setting, NOT MEASURED, and why

Operator request: run `muse-glimmer` (30B dense + perception encoder, arch 14) on the same
3k-in / 10k-out setting as the 27B. Both artifacts were pulled and registry-verified:
`muse-glimmer-30b` (18.61 GB) and `muse-glimmer-30b-dflash.mq4` (1.36 GB, `muse-glimmer:draft`).
**Two boots were attempted and neither produced a generation.** No decode figure exists for this model
and none should be quoted.

**Attempt 1 — draft-free, died on a GPU memory fault.** `developer.dflash_draft` is a *global* path
pinned to the 27B head, and muse refused it:

```
glimmer DFlash drafter load failed (.../qwen38-27b-dflash-mq4.hfq):
  glimmer drafter arch_id 20 != 23 (muse_glimmer_assistant)
```

so the model loaded draft-free — the §28.3 layout — and the first request faulted in
`gemm_hfq4g256_residual_wmma_gfx12_bt12` (recorded in §28.3, since it is the second independent
reproduction of that fault class).

**Attempt 2 — draft supplied via `HIPFIRE_DFLASH_DRAFT`, never finished loading.** The daemon sat at
90 % of one core for 436 s, past the KV-cache lines, never reaching ready. This is §28.14's loader
spin, and muse is its worst case: trunk + draft ≈ **20 GB against ~19 GB of available RAM on a 31 GB
box**, so the artifacts cannot all stay page-cache resident and the priming step that rescued the 27B
cannot work here. Stopped by the operator's standing rule (no progress → stop).

**What was learned anyway, without a throughput number:**

| observation | value | comparison to the 27B |
|---|---|---|
| KV-carrying layers | **39 of 39** (plus a second 13/13 cache) | 27B: **16 of 64** |
| K / V per head | 136 B + 136 B → head_dim **128** | 27B: 272 B + 272 B → head_dim **256** |
| trunk size | 18.61 GB | 16.46 GB (**+13 %** weights) |
| load VRAM (draft-free) | 19 549 MB | ~19 673 MB |

**muse is a full-attention dense model, not a hybrid.** Every layer carries KV, where the 27B carries
it on a quarter of its layers. That predicts materially worse depth-scaling than the 27B for both
prefill and decode, and a larger KV footprint per token, before any speculation is considered. Its
weights are also 13 % larger, which on a bandwidth-bound decode is a 13 % handicap its draft must earn
back. **On this hardware muse-glimmer looks structurally worse-suited than the 27B for long-context
agentic work**; that is an inference from the load geometry, not a measurement, and it is the reason
completing this arm is worth doing on a box with more RAM.

**Blocker to re-running it here:** ~20 GB of artifacts vs ~19 GB free RAM. Either add RAM, or free the
page cache of everything else before the boot, or accept the loader spin. This is a host limit, not a
hipfire setting.

### 28.10 The recommended 27B configuration, and what it cannot reach

**Apply these three. Nothing else in the config surface moved the 27B.**

```
hipfire config set developer.flash_prefill 1
hipfire config set developer.flash_prefill_min_ctx 1000000
hipfire config set speculation.dflash on          # already the default here
```

| key | value | why, and the section that measured it |
|---|---|---|
| `developer.flash_prefill` | `1` | The whole prefill fix. Forces the gfx1201 WMMA query16 attention kernel past its 32 768-token certification ceiling, which was certified on an `nh=8, nkv=2` model and not on this one. 73k prefill 80.5 → 182.5 tok/s, decay exponent −1.324 → **−0.671** (§28.1, §28.2) |
| `developer.flash_prefill_min_ctx` | `1000000` | Repairs the switch's second edge. Without it the same opt-in reroutes the DFlash **verify** forward onto a 48-workgroup scalar kernel and decode collapses to 6.7 tok/s. A value above any reachable context makes that branch unreachable while ordinary prefill keeps the WMMA route (§28.5) |
| `speculation.dflash` | `on` | Not for its decode gain, which is real only below ~40k. For the memory fault: **7 of 19 draft-free boots wedged the daemon; 0 of every DFlash-on boot in this document did** (§28.3). The draft is the cheapest available fault workaround, and it happens to win on wall time too — see below |
| `developer.dflash_verify_pm4` | **leave unset** | The only RDNA4-specific production switch in the surface. Slower at all four depths than the HipGraph verify it replaces, τ unchanged (§28.5) |
| `serve.multi_slot` | `false` | Forces `max_seq` down to `multi_slot_ctx`, rejects larger requests, refuses every speculator (§28.4) |
| `memory.cask.*` | off | CASK is KV **eviction**, not a cache. It trades context for nothing on a card that already holds 225k (§28.4) |
| `memory.prompt_cache_capacity` | `512` | Harmless, and not what the name suggests — see §28.6 |
| `serve.continuous_batch_size` | `1` | Concurrency gave 1.00–1.05× on two streams, below the 1.5× bar set for this work. Larger values only add the 15872-token lane cap |

**Why DFlash on, when plain AR decodes twice as fast at depth.** Wall time per turn is prefill-dominated
at every depth this model is used at. Taking §28.5's `minctx` arm against its `specoff` arm, for a
1024-token answer:

| depth | DFlash prefill + decode | AR prefill + decode | winner |
|---|---|---|---|
| 18.3k | 39.2 s + 46.8 s = **86 s** | 30.2 s + 63.6 s = 94 s | DFlash, 1.09× |
| 73.7k | 448 s + 89.8 s = **538 s** | 569 s + 44.1 s = 613 s | DFlash, 1.14× |

The draft costs 23–30 % of prefill below 37k and pays it back above 50k, and it is decode — the term
it loses — that is the smaller term. Add the 37 % boot-fault rate on the draft-free layout and the
choice is not close. **n-gram is the one exception**: on copy-heavy output it decodes 42–119 tok/s
(§28.8) and beats DFlash on total wall at every depth, but it is also a draft-free layout, so it
carries the same fault. n-gram is worth adopting *only* behind a supervisor that can detect a wedged
daemon and restart it — which `/health` cannot do (§24.2), because it keeps answering `ok`.

**What this configuration still cannot reach.** These are bounds, not tuning targets:

0. **Every prefill figure in §28.10 predates the repeatability study of §28.11.5.** Read 73k as
   **146.7 tok/s (median, range 144.2–182.5)** and the exponent as **−0.797**, not the single-run
   182.5 / −0.671 quoted below; the 164k projection becomes ~88 tok/s.
1. **Prefill parity with llama.cpp is impossible by configuration.** hipfire's *draft-free, 18k,
   best-case* prefill is 569–606 tok/s (§28.3, §28.8) — and llama.cpp f16 sustains 594 tok/s at
   **73k**. hipfire's best short-context number is llama.cpp's long-context number. The exponents
   still differ after the fix (−0.671 vs −0.294), so the gap widens with depth: projecting arm 1,
   ~106 tok/s at 164k against llama.cpp's ~476.
2. **Decode is bandwidth-bound and FP8 cannot help.** 16.46 GB of weights over 640 GB/s is 38.9 tok/s
   as an absolute ceiling for AR. FP8 has native RDNA4 acceleration, but these weights are already
   4-bit: converting to FP8 would *double* the bytes moved per token and halve decode. `kernel.fp8_wmma`
   exists and is compute-side only, i.e. a prefill research knob, not a decode lever. The measured
   decode numbers sit below even that 38.9 ceiling because the memory clock is running 400–1000 MHz of
   1265 under a 210 W cap against a 330 W limit (§28.5); raising the cap is the only change that moves
   every decode figure in this document, and it is not a hipfire setting.
3. **Multi-agent prefix reuse is zero, and it is architectural.** hipfire keeps one
   `conversation_tokens` sequence; any divergence resets it to position 0 and zeroes the DeltaNet
   state, which is not reversible to an earlier position. Two agents alternating re-prefill in full on
   every switch — measured at 52 s to add 400 characters (§28.6, §28.7). No setting changes this.
4. **The draft-free GPU memory fault has no config workaround.** Warm-up requests do not prevent it
   (§28.3).
5. **Concurrency does not pay.** Two parallel streams measured 1.00–1.05×.

**Recommended next steps, in ROI order — none of them are settings.**

| # | change | expected | where |
|---|---|---|---|
| 1 | Raise the power cap from 210 W toward the 330 W limit | Moves *every* decode figure here, both engines, possibly 2–3× on the throttled windows | Firmware/driver, not hipfire |
| 2 | Add `SpeculativeVerify` to `gfx12_query16_workload_eligible` for gfx1201 | Would let the verify forward use WMMA instead of the scalar or tiled fallback, i.e. DFlash decode at depth without the `min_ctx` workaround | `crates/hipfire-dispatch/src/families/attention.rs` |
| 3 | Re-certify `MAX_CTX` for `nh=24, nkv=4` shapes so the fix is the default | Removes the need for `developer.flash_prefill` entirely | same arm, `gfx12_query16_default_eligible` |
| 4 | Report the `gemm_gate_up_mq4g256v2_wmma_gfx12_bt12` fault upstream with the 7/19 reproduction | Unblocks draft-free and n-gram deployment, worth up to 4× decode on copy-heavy output | hipfire issue tracker |
| 5 | Per-conversation KV checkpoints | Would remove the dominant cost of multi-agent work (§28.7) | engine architecture, large |
| 6 | A liveness probe that touches the GPU, and a restart-on-fault supervisor | Makes n-gram deployable ahead of #4 | llama-swap wrapper |

**One deployment note left open.** `~/.config/llama-swap/models.yaml` carries a comment block on the
hipfire rows listing "engine config these rows ASSUME": `speculation.dflash`, `speculation.mtp`,
`memory.prompt_cache_capacity`. That list is now incomplete — the two `developer.flash_prefill*` keys
are load-bearing for the 27B row and are not named there. The file is generated, so the fix is a
comment edit in `generate.py` followed by a regenerate and a llama-swap restart. Not done here: the
regenerate restarts every row, and the card was in use. It is a comment-only correctness issue, no
runtime effect.
