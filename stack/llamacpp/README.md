# llamacpp/ — llama.cpp build pipeline

Fetches, builds, and promotes llama.cpp binaries for the R9700 (gfx1201). Two scripts, one purpose each.

## Scripts

| Script | Purpose |
|--------|---------|
| `build_llamacpp.sh` | Fetch source, compile Vulkan + ROCm builds, promote `latest-*` symlinks |
| `setup_vulkan.sh` | Download, install, and check the self-contained Vulkan SDK |

## Directory layout

```
llamacpp/
  build_llamacpp.sh      build driver (move from bench/)
  setup_vulkan.sh        Vulkan SDK manager
  README.md              this file
  builds/                gitignored — build artifacts live here
    <ver>-src/           shallow git checkout of upstream tag
    <ver>-vulkan[-sdk]/  CMake build dir: bin/ + BUILD_INFO + build.log
    <ver>-rocm/          CMake build dir (ROCm naming is unchanged)
    latest-vulkan →      symlink → promoted Vulkan build
    latest-rocm →        symlink → promoted ROCm build
  vulkansdk/             gitignored — SDK downloads + installs
    .downloads/          cached tarball (SHA-verified)
    <ver>/               extracted SDK (e.g. 1.4.357.1/)
    latest →             symlink → installed SDK version
```

`build/` at the repo root is a symlink → `llamacpp/builds/`. All downstream tools (`llama-swap/generate.py`, `compare_builds.py`, campaign scripts) resolve through it transparently.

## Build directory naming

Vulkan builds include the SDK version for traceability (CLAUDE.md rule 2):

```
b10969-vulkan-1.4.357.1    ← built with local SDK 1.4.357.1
b10969-vulkan-system       ← built with system shaderc package
b10969-rocm                ← ROCm naming is unchanged
```

The SDK version is also recorded in each build's `BUILD_INFO`:
```
vulkan_sdk=1.4.357.1
vulkan_sdk_path=/home/dev/.../llamacpp/vulkansdk/1.4.357.1
```

## build_llamacpp.sh

### Commands

```
build_llamacpp.sh status
```
Show state: newest upstream tag, current `latest-*` targets, all builds, disk free, Vulkan SDK version.

```
build_llamacpp.sh latest-tag
```
Print the newest upstream `bNNNNN` tag.

```
build_llamacpp.sh build [OPTIONS]
```
Fetch source and compile. Re-run resumes (source reused, CMake incremental, verified builds skipped).

| Option | Default | Description |
|--------|---------|-------------|
| `--tag VER` | newest upstream | Build this specific tag (`bNNNNN`) or non-tag ref (`b10655-4-g6fdd0ac`) |
| `--backend B` | `both` | `vulkan`, `rocm`, or `both` |
| `--jobs N` | auto-capped | Override parallel jobs (default: capped by `MemAvailable` — Vulkan ~1500 MB/job, ROCm ~3000 MB/job) |

**Vulkan SDK init:** Before building Vulkan, the script checks for a local SDK (`vulkansdk/latest/`) and falls back to system `glslc`. If neither is found, it aborts with a hint to run `setup_vulkan.sh update`.

**Compiler pins:** Uses `/usr/bin/gcc` and `/usr/bin/g++` explicitly (environment `PATH` may carry launcher wrappers). Override with `CC_BIN`/`CXX_BIN`.

```
build_llamacpp.sh promote VER [OPTIONS]
```
Flip `latest-*` symlinks to point to `VER`. This is how llama-swap picks up a new binary — no restart, no config reload. Also serves as rollback.

| Option | Default | Description |
|--------|---------|-------------|
| `--backend B` | `both` | `vulkan`, `rocm`, or `both` |

Promote finds Vulkan builds by globbing `$VER-vulkan*` (SDK version suffix). The build must have passed verification (binary exists, GPU device visible, commit SHA in `--version`).

### Auto-job capping

No swap on this box. Each compile job peaks at ~1.5 GB (Vulkan) or ~3 GB (ROCm hipcc TUs). The script reads `MemAvailable` from `/proc/meminfo` and caps `-j` accordingly. If the printed ROCm `-j` value is < 4, consider unloading llama-swap first:

```bash
curl -s http://127.0.0.1:9292/unload
```

## setup_vulkan.sh

Manages the self-contained Vulkan SDK downloaded from [Lunarg](https://vulkan.lunarg.com/sdk/home).

### Commands

```
setup_vulkan.sh status
```
Show installed SDK version vs latest available online. Lists SDK contents and `glslc` version.

```
setup_vulkan.sh check
```
Verify SDK is installed and `glslc` works. Exits 0 if OK (SDK or system fallback), 1 if missing. Called by `build_llamacpp.sh` before Vulkan builds.

```
setup_vulkan.sh update [VERSION]
```
Download and install the latest SDK (or a specific version if given). Verifies SHA256 against Lunarg's hash. Tarball is cached in `vulkansdk/.downloads/` and reused if the SHA matches.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `VERSION` | latest from `linux.txt` API | Specific SDK version (e.g. `1.4.357.1`) |

**Download:** ~314 MB `.tar.xz` from `sdk.lunarg.com`. Extraction uses `--strip-components=1` for clean layout under `vulkansdk/<ver>/`.

**API endpoints:**
- Version: `https://vulkan.lunarg.com/sdk/latest/linux.txt` → `1.4.357.1`
- Download: `https://sdk.lunarg.com/sdk/download/{VER}/linux/vulkan_sdk.tar.xz`
- SHA: `https://sdk.lunarg.com/sdk/sha/{VER}/linux/vulkan_sdk.tar.xz.txt`

### Workflow

```bash
# Check current state
llamacpp/setup_vulkan.sh status

# Download latest SDK (~314MB)
llamacpp/setup_vulkan.sh update

# Build with it
llamacpp/build_llamacpp.sh build

# Build specific tag, Vulkan only
llamacpp/build_llamacpp.sh build --tag b10909 --backend vulkan

# Promote the new build
llamacpp/build_llamacpp.sh promote b10969

# Roll back to an older build
llamacpp/build_llamacpp.sh promote b10909 --backend vulkan
```

## Interaction with llama-swap

`llama-swap/generate.py` resolves the server binary as:
```python
f"{REPO}/build/latest-{backend}/bin/llama-server"
```

Because `build/` → `llamacpp/builds/` (symlink), and `latest-*` → `<ver>-<backend>[-<sdk>]`, the chain resolves automatically. After promoting, llama-swap picks up the new binary at the next model load. A running model keeps the old binary until unloaded (`GET /unload`).
