<!-- meta
date: 2026-09-11 13:54
takeaway: Runbook for upgrading this box's two GPU stacks — **Vulkan (Mesa RADV via kisak PPA + LunarG loader)** and **ROCm (Radeon apt line)** — which share only the in-kernel `amdgpu` driver. Step-by-step for both, every failure hit during the 2026-09-10 ROCm 7.13→10.0 upgrade with its fix (`pipefail`+SIGPIPE aborts, `cc` shim, exit-0 builds, stale kernel caches, llama-swap `/unload`), rollback, open items (7.13 purge still pending) and sources.
-->

# GPU driver stack upgrade runbook — Vulkan (Mesa/RADV) and ROCm on the R9700

**Machine:** AMD Radeon AI PRO R9700 (gfx1201, RDNA4), Ubuntu 24.04.5, kernel `7.0.0-31-generic`.
**Written:** 2026-09-11 13:54, from the 2026-09-10 ROCm upgrade and the checks run while writing this.
**Provenance markers:** `DONE 2026-09-10` = performed and recorded; `PROCEDURE` = assembled from the
configured repos and earlier research, **not yet performed on this box**.

## Summary

This box runs **two independent GPU userspace stacks over one kernel driver**. Upgrading one does
not touch the other — verified: the ROCm 7.13 → 10.0 upgrade on 2026-09-10 installed 52 packages,
removed 0, and left every Mesa/Vulkan package at the same version (`05-rocm10-upgrade-log.md` §13.3).

| Layer | Installed (2026-09-11) | Comes from | Used by | Touched 2026-09-10? |
|---|---|---|---|---|
| Kernel GPU driver | in-tree `amdgpu.ko.zst`, kernel `7.0.0-31-generic`, **no DKMS** | Ubuntu kernel | everything | no |
| GPU firmware | 38 RDNA4 blobs in `/lib/firmware/amdgpu/` (`gc_12_0_1`, `psp_14_0_3`, `smu_14_0_3`, `dcn_4_0_1`, `sdma_7_0_1`) — **owned by no dpkg package** | unrecorded manual install | kernel driver | no |
| Vulkan driver (RADV) | `mesa-vulkan-drivers 26.2.2~kisak1~n` | kisak-mesa PPA | llama.cpp **Vulkan** rows in llama-swap | no |
| Mesa support libs | `libdrm* 2.4.134-3~kisak~n`, `libllvm21 1:21.1.8`, `libllvm20`, `mesa-libgallium`, `libgl1-mesa-dri`, `xwayland` … (amd64 **and** i386) | kisak-mesa PPA | Mesa | no |
| Vulkan loader + tools | `libvulkan1` / `vulkan-tools` `1.4.313.0~rc1-1lunarg24.04-1` | LunarG apt repo | any Vulkan program | no |
| ROCm / HIP | **`10.0.0~pre4` (HIP 7.15.26333) and `7.13.0~pre2` side by side** | `repo.radeon.com/rocmradeon/apt/26.14` | hipfire (built against `core-10.0`) | **yes** |
| llama.cpp ROCm row | vendored HIP 7.15 (`bench/llamacpp-b10375`, `bench/llamacpp`) | bundled with the build | llama-swap `rocm` rows | no — does not use system ROCm |
| AMD graphics/installer repos | `amdgpu-install 31.30`, `graphics/26.12` | `repo.radeon.com` | — | no |

**What each upgrade can change:** a **Mesa** upgrade changes llama.cpp-Vulkan speed and stability;
it cannot change hipfire. A **ROCm** upgrade changes hipfire; it cannot change the Vulkan path, and
it does not even change the llama.cpp ROCm row, which loads its own vendored HIP.

**Right now (2026-09-11) there is nothing newer to install on the Vulkan side** — for
`mesa-vulkan-drivers`, `libvulkan1`, `libdrm-amdgpu1`, `vulkan-tools` the apt candidate equals the
installed version.

**Open item:** the ROCm 7.13 purge (§3.7) was never applied — 44 × `7.13.0~pre2` and 52 ×
`10.0.0~pre4` packages are both installed. That is the "two dpkg-installed ROCms" state §7 of the
upgrade log names as the likely historical cause of instability.

---

## 1. Before any upgrade (both stacks)

### 1.1 Snapshot the current state to a file

The 2026-09-10 snapshot is `hipfire-engine-evaluation/rocm-upgrade/pre-upgrade-state.txt`. Take a
fresh one before every upgrade — it is the only way to prove afterwards what changed:

```bash
OUT=~/gpu-state-$(date +%Y%m%d-%H%M).txt
{
  echo "=== captured $(date -Is) ==="
  uname -r; lsb_release -ds
  echo "--- dkms / amdgpu ---"; dkms status 2>/dev/null; modinfo amdgpu | grep -E '^(filename|vermagic)'
  echo "--- firmware (RDNA4) ---"; ls /lib/firmware/amdgpu/ | grep -E '^(gc_12_0_1|psp_14_0_3|smu_14_0_3|dcn_4_0_1|sdma_7_0_1)' | wc -l
  echo "--- apt sources ---"; grep -rhE '^(deb|URIs)' /etc/apt/sources.list.d/ | sort -u
  echo "--- mesa / vulkan ---"; dpkg -l | awk '/^ii/ && ($3 ~ /kisak|lunarg/){print $2, $3}'
  vulkaninfo --summary 2>/dev/null | grep -E 'deviceName|driverName|driverInfo|apiVersion'
  echo "--- rocm ---"; dpkg -l | awk '/^ii +amdrocm/{print $3}' | sort | uniq -c
  ls -d /opt/rocm/core-* 2>/dev/null
  for d in /opt/rocm/core-*/; do printf '%s ' "$d"; "$d"bin/hipcc --version 2>/dev/null | head -1; done
} > "$OUT" 2>&1; echo "wrote $OUT"
```

### 1.2 Record a baseline you will re-run unchanged

An upgrade is only worth anything if you can show the before/after with the **same harness, same
flags, same prompt**. Cheap smoke numbers measured 2026-09-11 (3k-token prompt, 10k/2k generated):

| Engine / row | prefill | decode | source |
|---|---|---|---|
| llama.cpp Vulkan, `qwen38-27b-q4kxl-180k-f16-ctx160k-mtp-frog-coding` | 816–844 tok/s | 49.5–51.0 tok/s | `05` §28.15, §28.17 |
| hipfire 27B, DFlash on | ~565–600 tok/s | ~36.5 (2k out) – ~50.6 (10k out) tok/s | same |

Decode on this card swings run-to-run (memory clock under the 210 W power cap), so never compare a
single decode run; take ≥ 3 and quote the spread (`05` §24.4, §28.5).

### 1.3 Free the GPU the sanctioned way

```bash
bash ~/work/dp-craft/amd/bench/lib/gpu_exclusive.sh 26000
```

It unloads llama-swap, kills the whole hipfire process shape, and fails loudly naming the holder if
fewer than 26000 MiB are free. **Two traps it encodes or exposes:**

- llama-swap's `/unload` is **GET**; `POST` returns 405 and `curl -sf … >/dev/null` swallows it.
- On 2026-09-10 and 2026-09-11 **llama-swap itself exited** right after `GET /unload` (log: a
  clean `200`, then nothing). Afterwards, restore it and check:

  ```bash
  bash ~/.config/llama-swap/restart_llama_swap.sh start
  curl -sf http://127.0.0.1:9292/v1/models >/dev/null && echo UP || echo DOWN
  ```

### 1.4 Three environment facts that bit last time

| Fact | Consequence | What to do |
|---|---|---|
| `sudo` needs a password (`sudo -n true` → "a password is required") | an agent cannot run the install | run the scripts yourself; detach long ones with `nohup … &` |
| `/home/dev/scripts/cc` launches Claude and precedes `/usr/bin` on `PATH` | **shadows the C compiler**: every native build (cargo, cmake, node-gyp) fails with `linking with 'cc' failed` | `PATH=/usr/bin:$PATH CC=/usr/bin/cc CXX=/usr/bin/c++ …` for every build; permanent fix is renaming the shim (not done) |
| `/` was 92–95 % full | ROCm 10 added 8.18 GB installed / 1.01 GB download | check `df -h /` first; purging 7.13 returns ~8.7 GB |

---

## 2. Vulkan stack — Mesa RADV + LunarG loader (`PROCEDURE`)

Not performed during this work: the 2026-09-10 upgrade deliberately left Mesa alone, and as of
2026-09-11 no newer build is published. Assembled from the configured repositories, the July RDNA4
research (`2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md` §3) and the checks above.

### 2.1 Where the pieces come from

| Repo (file in `/etc/apt/sources.list.d/`) | Line | Supplies |
|---|---|---|
| `kisak-ubuntu-kisak-mesa-noble.sources` | `https://ppa.launchpadcontent.net/kisak/kisak-mesa/ubuntu/ noble main` | Mesa (RADV, gallium, EGL/GLX, VDPAU), libdrm, libllvm20/21, xwayland |
| `lunarg-vulkan-noble.list` | `deb https://packages.lunarg.com/vulkan noble main` | `libvulkan1`, `vulkan-tools` |
| `lunarg-vulkan-jammy.list` | `deb https://packages.lunarg.com/vulkan jammy main` | **stale — jammy (22.04) repo on a noble (24.04) box**; disable it before upgrading so apt cannot mix in 22.04 builds |

Ubuntu's own `noble-updates` offers `mesa-vulkan-drivers 25.2.8`; the kisak PPA is what lifts it to
26.x. The July research recommends a recent Mesa for RDNA4 (RADV memory/queue improvements reduce
llama.cpp CPU overhead) and **RADV over AMDVLK** (dense prefill 798 vs 203 tok/s in llama.cpp
discussion #21043).

### 2.2 Check whether there is anything to upgrade

```bash
sudo apt update
apt-cache policy mesa-vulkan-drivers libvulkan1 libdrm-amdgpu1 vulkan-tools
apt-cache madison mesa-vulkan-drivers          # every version every repo offers
apt list --upgradable 2>/dev/null | grep -E 'kisak|lunarg|mesa|vulkan|libdrm|libllvm'
```

If `Candidate` equals `Installed`, stop here — that was the state on 2026-09-11.

### 2.3 Save the current packages first (the rollback you cannot get later)

`apt-cache madison` lists **only one kisak build** — the PPA publishes its latest and drops the
previous one. Once you upgrade, apt can no longer reinstall today's `26.2.2~kisak1~n`. Download the
exact installed versions **before** upgrading:

```bash
mkdir -p ~/gpu-rollback/mesa-$(date +%Y%m%d) && cd "$_"
apt-get download $(dpkg -l | awk '/^ii/ && ($3 ~ /kisak/){print $2"="$3}')
apt-get download $(dpkg -l | awk '/^ii/ && ($3 ~ /lunarg/){print $2"="$3}')
ls | wc -l          # expect one .deb per package per architecture
```

### 2.4 Upgrade

Simulate first and read the list — it should contain only Mesa/libdrm/LLVM/Vulkan packages:

```bash
apt-get -s upgrade | grep '^Inst'
```

Then:

```bash
sudo apt-get upgrade          # or target the set: sudo apt-get install --only-upgrade <pkgs>
```

Keep **amd64 and i386 at identical versions** — the i386 copies exist (Steam), and Multi-Arch
packages refuse to install with mismatched versions. Targeting only `:amd64` will fail or hold.

No reboot is needed for Mesa (userspace only). Restart anything that has the old libraries loaded:
llama-swap (`restart_llama_swap.sh restart`) and the desktop session if you use one.

### 2.5 Verify

```bash
vulkaninfo --summary | grep -E 'deviceName|driverName|driverInfo|apiVersion'
```

Expect `deviceName = AMD Radeon AI PRO R9700 (RADV GFX1201)`, `driverName = radv`, and the **new**
Mesa version in `driverInfo` (`Mesa 26.2.2 - kisak-mesa PPA` today). `apiVersion` is what the driver
exposes (1.4.354 today), not the loader version — the loader is `libvulkan1`'s version.

| Symptom | Likely cause | Check / fix |
|---|---|---|
| Only `llvmpipe` listed | RADV ICD not loading | `ls /usr/share/vulkan/icd.d/` has `radeon_icd.x86_64.json`; user in `render` and `video` groups (`id -nG`); no stale `VK_DRIVER_FILES` / `VK_ICD_FILENAMES` in the environment |
| Two AMD devices listed | AMDVLK installed alongside RADV | select RADV with `VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.x86_64.json` |
| `vulkaninfo` fails outright | loader/driver version mix | compare `dpkg -l | grep -E 'kisak|lunarg'` against the snapshot from §1.1 |

Then re-run the §1.2 smoke test through llama-swap. **llama.cpp does not need a rebuild** for a
Mesa upgrade: it ships compiled SPIR-V shaders and RADV compiles them to GPU code at runtime. Discard
the first run after the upgrade — it includes shader compilation.

The served Vulkan binary is `bench/llamacpp-vulkan-6fdd0ac/llama-server` (`VULKAN_BIN` in
`~/.config/llama-swap/generate.py`; `--version` → `0.3.0-dev (build 200, commit 6fdd0ac)`). The
older `bench/llamacpp-vulkan` tree is build 9950. Rebuild llama.cpp only when you want a newer
llama.cpp, not for a driver change:

```bash
PATH=/usr/bin:$PATH CC=/usr/bin/cc CXX=/usr/bin/c++ \
  cmake -B build -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release && cmake --build build -j
```

### 2.6 Rollback

```bash
sudo dpkg -i ~/gpu-rollback/mesa-<date>/*.deb     # the packages saved in §2.3
```

Without saved packages, the only fallback is Ubuntu's own Mesa (25.2.8 today):

```bash
sudo apt install ppa-purge && sudo ppa-purge ppa:kisak/kisak-mesa
```

That downgrades every kisak package to the Ubuntu archive version and disables the PPA.

### 2.7 Known RADV problems seen on this box — re-test after any Mesa upgrade

| Problem | Measured | Workaround |
|---|---|---|
| **Gemma-4-31B deep prefill kills the GPU** (llama.cpp b9950, RADV) | `vk::Queue::submit: ErrorDeviceLost` at ~65.5k tokens (ctx 163840) and ~24.5k (ctx 140000); crashes the whole desktop; lowering ctx does not help | serve Gemma on the **ROCm** row (ran the full ~140k prefill clean). A newer Mesa is the most likely real fix — re-test it after every upgrade. Source: `2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md` |
| A concurrent VRAM consumer turns that hang into a hard OOM | 31 GiB stray server + 26 GiB Gemma on a 32 GB card | always `gpu_exclusive.sh` first |
| AMDVLK much slower than RADV for prefill | 203 vs 798 tok/s dense prefill (llama.cpp #21043) | do not install AMDVLK; if present, pin RADV with `VK_DRIVER_FILES` |

---

## 3. ROCm stack — the 2026-09-10 upgrade, 7.13 → 10.0 (`DONE 2026-09-10`)

Full record: `hipfire-engine-evaluation/05-rocm10-upgrade-log.md` §§1–14. Scripts:
`hipfire-engine-evaluation/rocm-upgrade/install-rocm-10.sh` and `purge-rocm-7.13.sh`. **The scripts'
header comments still say `docs/test/rocm-upgrade/`** — they live under
`docs/research/2026-09-10-0100-hipfire-engine-evaluation/rocm-upgrade/`; call them by that path.

### 3.1 Find what is actually available — do not trust the directory index

The Radeon line is `https://repo.radeon.com/rocmradeon/apt/<branch>/`. On 2026-09-10 the browsable
index of `rocm/apt/` stopped at 7.2.4, yet specific newer artifacts returned HTTP 200. Read the
version from each branch's package list, and probe a specific artifact with `curl -I`:

```bash
for b in 26.12 26.13 26.14; do
  printf '%s: ' "$b"
  curl -s "https://repo.radeon.com/rocmradeon/apt/$b/dists/noble/main/binary-amd64/Packages.gz" \
    | gunzip | awk '/^Package: amdrocm-core-sdk/{p=1} p && /^Version:/{print $2; exit}'
done
```

| Branch | ROCm | Metapackage |
|---|---|---|
| `26.12` | `7.13.0~pre2` | `amdrocm-core-sdk-gfx120x` (family build) |
| `26.13` | `7.14.0~pre3` | — |
| `26.14` | **`10.0.0~pre4`** | `amdrocm-core-sdk10.0-gfx1201` (exact-arch build) |

`rocm.docs.amd.com/en/docs-10.0.0/` corresponds to branch `26.14`. **The product number and the HIP
runtime are decoupled:** ROCm 10.0.0 ships **HIP 7.15**, not 10.x (`core-10.0/.info/version` = 10.0.0,
`hipcc --version` = `7.15.26333`).

From 10.0 on every payload package is **version-suffixed** (`amdrocm-runtime10.0`, …) with pinned
`Depends`, so two ROCm versions install **side by side** under `/opt/rocm/core-<ver>`. An upgrade does
not remove the working stack; rollback is repointing consumers at the old tree.

### 3.2 Steps

| # | Step | Gate — check an artifact, never an exit code |
|---|---|---|
| 1 | Stop the ROCm consumer (hipfire) and free VRAM (§1.3) | `/health` refuses, daemon PID gone |
| 2 | Point `/etc/apt/sources.list.d/rocm.list` at the new branch (the script backs it up) | `grep rocmradeon /etc/apt/sources.list.d/rocm.list` |
| 3 | `apt-get update`, confirm the candidate | `apt-cache policy amdrocm-core-sdk10.0-gfx1201` shows `10.0.0~pre4` |
| 4 | Install `amdrocm-core-sdk10.0-gfx1201 amdrocm-core-dev10.0-gfx1201 amdrocm-llvm-dev10.0` | `dpkg -l | grep -c 'amdrocm.*10\.0\.0'` = 52; **0 packages removed** |
| 5 | Verify the toolchain | `/opt/rocm/core-10.0/bin/hipcc --version`; `rocminfo` shows `gfx1201` |
| 6 | **Verify the Vulkan side is untouched** | `:9292/v1/models` answers; Mesa/`libvulkan1` versions unchanged; `vulkaninfo` still RADV |
| 7 | Rebuild every consumer of **system** ROCm against the new tree (§3.4) | consumer's own version/diag output |
| 8 | Re-run the identical benchmark | same harness, same flags |
| 9 | Purge the old ROCm (§3.7) | only one `amdrocm` version left in `dpkg -l` |

Run the install detached and follow the log:

```bash
sudo nohup bash ~/work/dp-craft/amd/docs/research/2026-09-10-0100-hipfire-engine-evaluation/rocm-upgrade/install-rocm-10.sh \
  > /tmp/rocm10.log 2>&1 &
tail -f /tmp/rocm10.log
```

Measured on 2026-09-10: **52 packages, 1.01 GB download, 8.18 GB installed, 0 removed, under 90 s.**

### 3.3 Verify the install

```bash
ls -d /opt/rocm/core-*                         # core-7.13 and core-10.0 side by side
/opt/rocm/core-10.0/bin/hipcc --version | head -2
/opt/rocm/core-10.0/bin/rocminfo | grep -m2 -E 'gfx1201|Marketing Name'
cat /opt/rocm/core-10.0/.info/version
grep -E 'Remove:|Upgrade:' /var/log/apt/history.log | tail -5   # nothing outside the ROCm set
```

### 3.4 Rebuild consumers — hipfire

hipfire JIT-compiles and caches GPU kernels against the HIP it was built with, so bumping the runtime
without a rebuild produces worse numbers that are easy to misattribute.

```bash
mv ~/.hipfire_kernels ~/.hipfire_kernels.hip713.bak     # move aside, do not delete
PATH=/usr/bin:$HOME/.cargo/bin:$PATH CC=/usr/bin/cc CXX=/usr/bin/c++ \
bash ~/.hipfire/src/scripts/install.sh \
  --commit 800ddf7403d85e3745d0ac6492e4cb84c74cb7b1 \
  --rocm-root /opt/rocm/core-10.0 --gpu-arch gfx1201 --strict-rocm --yes
~/.hipfire/bin/hipfire --version && ~/.hipfire/bin/hipfire diag
grep -o '"rocm_root"[^,]*' ~/.hipfire/install.json     # must name core-10.0, not /opt/rocm
```

- **Pin `--rocm-root` to the versioned tree.** The 7.13 build recorded `"rocm_root": "/opt/rocm"`;
  with several `core-*` trees under it, which one a fresh build picks is ambiguous.
- **Pin `--commit`** so the engine source does not move at the same time as the runtime.
- **`install.sh` exits 0 even when the build fails** — gate on `hipfire --version` + `hipfire diag`.

The llama.cpp **ROCm** row loads its own vendored HIP through a per-row `LD_LIBRARY_PATH` set by
`generate.py`, so it needs nothing. `ldconfig -p | grep libamdhip64` returning nothing is the proof
that no process can pick up another's HIP by accident.

### 3.5 First boot after the upgrade — two failure modes to expect

Both are hipfire behaviours seen repeatedly on gfx1201 (`05` §28.3, §28.14); neither shows up in
`/health`, which keeps answering `ok`.

| Symptom | Cause | Fix |
|---|---|---|
| Load stalls at `loading layer N/64`, one core at ~85–90 %, GFX 4 %, memory controller 0 % | loader spin on a **cold page cache** — happens after another engine or a big download evicted the model | prime it: `cat <model> <draft> > /dev/null`, then boot. Treat a loader that has not advanced a layer in ~30 s as dead |
| First large request hangs forever; `serve.log` shows `Memory Fault … kernel: gemm_*_wmma_gfx12_bt12` | gfx12 WMMA GEMM fault on a **draft-free** allocation layout (7 of 19 draft-free boots on the 27B; reproduced on muse-glimmer in a different kernel) | keep the DFlash draft loaded; `kill -9` the daemon to recover |

### 3.6 Re-measure everything

A tuning result made on one ROCm version does not survive the next: CASK prefill went from a
**1.57× win on ROCm 7.13 to a −47 % loss on 10.0** (`05` §16–17). Re-run every benchmark whose
result you rely on; do not carry numbers across a driver change.

### 3.7 Purge the old ROCm — **still pending as of 2026-09-11**

Two dpkg-installed ROCm versions is the configuration most likely behind the earlier instability
(`05` §7). The purge script is dry-run by default and refuses to run unless 10.0 is installed:

```bash
S=~/work/dp-craft/amd/docs/research/2026-09-10-0100-hipfire-engine-evaluation/rocm-upgrade/purge-rocm-7.13.sh
sudo bash "$S"            # dry run: lists the 7.13 and gfx120x packages it would purge
sudo bash "$S" --apply    # purge + autoremove
dpkg -l | awk '/^ii +amdrocm/{print $3}' | sort -u     # expect only 10.0.0~pre4
```

Do this only after hipfire is rebuilt against `core-10.0` (done — `install.json` names it). Keep
`~/.hipfire_kernels.hip713.bak` until you are sure you will not roll back.

**Never delete** `bench/llamacpp` or `bench/llamacpp-b10375` while cleaning up: the first is the
second entry of `ROCM_LIB_PATH` in `generate.py` and supplies HIP 7.15 to the live llama-swap `rocm`
row. Safe to delete (dead weight, 4.8 GB): `/usr/local/lib/ollama/rocm_v7_2` and
`/home/dev/work2/amd-bench/llamacpp` — see `05` §7.4 before doing so.

---

## 4. Issues hit and their fixes

| # | Issue | How it showed | Root cause | Fix |
|---|---|---|---|---|
| 1 | "Nothing newer than 7.2.4 exists" | directory index at `repo.radeon.com/rocm/apt/` | index listings are not authoritative | read `Packages.gz` per branch; `curl -I` the exact artifact |
| 2 | Install script stopped silently after step 4, twice | log ended at the `apt-cache policy` table; no `apt-get` ever ran | `set -euo pipefail` + `cmd \| head -4`: `head` closes the pipe, `apt-cache` dies of SIGPIPE (141), `pipefail` + `set -e` abort | never pipe into `head`/`grep -q` under `pipefail`; capture into a variable, match with `case`; use `sed -n '1,4p'` (reads all input) |
| 3 | The fix inverted the gate: "10.0.0~pre4 not offered" printed right under the line showing it | abort branch taken | same bug in `\| grep -q`: the better the match, the sooner SIGPIPE | same fix — `POLICY=$(…); case "$POLICY" in *'10.0.0~pre4'*) …` |
| 4 | First diagnosis was "download timed out" | looked plausible for 1 GB | invented to fit; no timeout was ever observed | check `pgrep apt-get` and `/var/log/apt/history.log` before theorising |
| 5 | hipfire build "succeeded" but was broken | `install.sh` exit 0 | script does not propagate the build failure | gate on `hipfire --version` + `hipfire diag` |
| 6 | Every Rust/C build failed at link | `error: linking with 'cc' failed` | `/home/dev/scripts/cc` (Claude launcher) shadows `/usr/bin/cc` | `PATH=/usr/bin:$PATH CC=/usr/bin/cc CXX=/usr/bin/c++` |
| 7 | Ambiguous ROCm picked by a rebuild | `install.json` `rocm_root: "/opt/rocm"` | several `core-*` trees under one root | `--rocm-root /opt/rocm/core-10.0` |
| 8 | Worse numbers straight after the runtime bump | — | hipfire kernel cache compiled for the old HIP | move `~/.hipfire_kernels` aside, rebuild |
| 9 | "ROCm 10" expected to mean HIP 10 | `hipcc --version` → 7.15 | product and HIP versions are decoupled | read `.info/version` **and** `hipcc --version` |
| 10 | Old conclusions no longer held | CASK win became a −47 % loss | tuning is version-specific | re-measure after every driver change |
| 11 | llama-swap gone after freeing the GPU | port 9292 closed, clean log | exited after `GET /unload` | `restart_llama_swap.sh start`, check `/v1/models` |
| 12 | hipfire boot never finishes | stuck at a layer, CPU pinned, GPU idle | loader spin after a cold page cache | prime the model file(s) with a sequential read before boot |
| 13 | RADV device-lost on Gemma deep prefill | desktop crash, `ErrorDeviceLost` | RADV bug (b9950 era) | serve that model on the ROCm row; re-test on each new Mesa |
| 14 | Kernel newer than ROCm's tested range | risk noted pre-upgrade | kernel 7.0 vs ROCm-tested 6.8/6.17; ROCm issue #6110 (gfx1201 "has 2 ISAs") | none needed so far; re-check if a new ROCm misbehaves |

---

## 5. After any upgrade — verification checklist

- [ ] `vulkaninfo --summary` → `driverName = radv`, R9700 listed, expected Mesa in `driverInfo`.
- [ ] `dpkg -l | awk '/^ii +amdrocm/{print $3}' | sort -u` → only the versions you expect.
- [ ] `/opt/rocm/core-<new>/bin/hipcc --version` and `rocminfo | grep gfx1201`.
- [ ] `grep -E 'Remove:|Upgrade:' /var/log/apt/history.log | tail` → nothing outside the intended set.
- [ ] llama-swap up: `curl -sf http://127.0.0.1:9292/v1/models`.
- [ ] Rebuilt consumers report the new runtime (`hipfire --version`, `install.json` `rocm_root`).
- [ ] §1.2 smoke numbers re-run, ≥ 3 decode runs, compared with spread against the baseline.
- [ ] Snapshot from §1.1 taken again and diffed against the pre-upgrade one.

## 6. Rollback

| What broke | Undo |
|---|---|
| New Mesa misbehaves | `sudo dpkg -i ~/gpu-rollback/mesa-<date>/*.deb`; without saved debs, `ppa-purge ppa:kisak/kisak-mesa` (falls back to Ubuntu 25.2.8) |
| New Vulkan loader misbehaves | reinstall the saved `libvulkan1`/`vulkan-tools` debs |
| New ROCm misbehaves | old tree still at `/opt/rocm/core-<old>` until purged — rebuild hipfire with `--rocm-root /opt/rocm/core-<old>`, restore `~/.hipfire_kernels.<old>.bak` |
| Wrong repo line | `rocm.list.bak-<stamp>` next to `rocm.list` (one exists: `rocm.list.bak-20260910-084019`) |
| Vulkan broke after a ROCm upgrade | should be impossible — the stacks share no package; compare the §1.1 snapshots and record it as a finding |

## 7. Open items (2026-09-11)

| Item | Why it matters | Action |
|---|---|---|
| ROCm 7.13 still installed next to 10.0 | the dual-dpkg state blamed for past instability | §3.7 `purge-rocm-7.13.sh --apply` |
| `lunarg-vulkan-jammy.list` active on noble | apt could mix 22.04 builds into the Vulkan stack | disable (rename to `.disabled`) before the next Vulkan upgrade |
| RDNA4 firmware owned by no package | provenance unknown; nothing manages or updates it | record where it came from; back it up (`tar czf ~/gpu-rollback/amdgpu-fw.tgz /lib/firmware/amdgpu`) before any firmware or kernel change |
| `cc` shim shadows the compiler | breaks every native build | rename `/home/dev/scripts/cc` (user's decision) |
| `graphics/26.12` line still in `rocm.list` next to `rocmradeon/apt/26.14` | mixed branch pins | leave unless a conflict appears; note it when reading apt output |
| Gemma deep-prefill RADV crash | model unusable on the Vulkan row at depth | re-test on the next Mesa |

## 8. Sources

**This box's records**
- `docs/research/2026-09-10-0100-hipfire-engine-evaluation/05-rocm10-upgrade-log.md` — §1–4 survey and pre-state, §5–8 steps and rollback, §7 multi-version audit, §10–13 four install attempts, §14 rebuild, §16–17 re-measurement, §28.3 memory fault, §28.14 loader spin.
- `…/hipfire-engine-evaluation/02-rollout-plan.md` — the `cc` shim trap, kernel-version risk.
- `…/hipfire-engine-evaluation/rocm-upgrade/` — `install-rocm-10.sh`, `purge-rocm-7.13.sh`, `pre-upgrade-state.txt`.
- `docs/research/2026-07-10-rdna4-llamacpp-ollama-backend-tuning.md` §3 — Vulkan vs ROCm on RDNA4, RADV vs AMDVLK, Vulkan install and llama.cpp Vulkan build.
- `docs/research/2026-07-19-1821-ornith-35b-gemma-4-31b-configs.md` — the RADV device-lost crash.
- `dp-craft/amd/CLAUDE.md` rules 14–15 and `bench/lib/gpu_exclusive.sh` — GPU exclusivity, the `/unload` trap.

**AMD / ROCm**
- ROCm 10.0 documentation: https://rocm.docs.amd.com/en/docs-10.0.0/
- Radeon ROCm apt line: https://repo.radeon.com/rocmradeon/apt/ (read `dists/noble/main/binary-amd64/Packages.gz` per branch)
- amdgpu repo in use: https://repo.radeon.com/amdgpu/31.30/ubuntu
- ROCm issue #6110 (gfx1201 "has 2 ISAs"): https://github.com/ROCm/ROCm/issues/6110

**Mesa / Vulkan**
- kisak-mesa PPA: https://launchpad.net/~kisak/+archive/ubuntu/kisak-mesa (apt: `ppa:kisak/kisak-mesa`)
- Mesa release notes: https://docs.mesa3d.org/relnotes.html
- RADV driver docs: https://docs.mesa3d.org/drivers/radv.html
- LunarG Vulkan SDK / packages: https://vulkan.lunarg.com/sdk/home — the installed loader is a release candidate (`1.4.313.0~rc1`); check here how LunarG currently distributes it before relying on the apt repo.

**llama.cpp on RDNA4**
- R9700 deep-dive, RADV vs AMDVLK numbers: https://github.com/ggml-org/llama.cpp/discussions/21043
- RX 9070 XT ROCm numbers: https://github.com/ggml-org/llama.cpp/discussions/15021
- Vulkan beats ROCm on RDNA4: https://vachsark.com/blog/vulkan-beats-rocm/
- llama-server Vulkan vs vLLM ROCm on RDNA4: https://digtvbg.com/blog/llama-server-vulkan-rdna4-vllm-rocm-benchmark/ and https://github.com/ivangotoy/llama-server-rdna4-vulkan

**Engines on top**
- hipfire: https://github.com/warpfront/hipfire — `docs/GETTING_STARTED.md`, `docs/CONFIG.md`; installer `scripts/install.sh`
- llama-swap: https://github.com/mostlygeek/llama-swap
