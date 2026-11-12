#!/usr/bin/env python3
"""Interactive helper to add a model to models.yaml.

Usage:
  python3 add_model.py
  # or edit models.yaml directly, then run generate.py
"""
import pathlib
import sys
import yaml

HERE = pathlib.Path(__file__).resolve().parent
MODELS_YAML = HERE / "models.yaml"

FAMILIES = ["QWEN27", "QWEN35", "QWEN38", "GEM", "MUSEP"]

def prompt(msg, default=None):
    if default is not None:
        msg = f"{msg} [{default}]: "
    else:
        msg = f"{msg}: "
    val = input(msg).strip()
    return val or default

def main():
    if not MODELS_YAML.exists():
        print(f"models.yaml not found at {MODELS_YAML}", file=sys.stderr)
        sys.exit(1)

    data = yaml.safe_load(MODELS_YAML.read_text()) or {"models": []}
    models = data.get("models", [])

    print("Add a new model to llama-swap")
    print("-" * 40)

    model_id = prompt("model id (kebab-case)")
    if not model_id:
        print("id required"); sys.exit(1)

    # check duplicate
    if any(m["id"] == model_id for m in models):
        print(f"Model id '{model_id}' already exists"); sys.exit(1)

    path = prompt("relative gguf path (e.g. unsloth/Qwen3.6-27B-Q4_K_M.gguf)")
    ctx = int(prompt("ctx per conversation", "131072"))
    kv = prompt("kv cache type", "f16")
    if kv not in ("f16", "q8_0"):
        print("kv must be f16 or q8_0"); sys.exit(1)
    mtp_raw = prompt("mtp (true/false/int)", "false")
    if mtp_raw.lower() == "true":
        mtp = True
    elif mtp_raw.lower() == "false":
        mtp = False
    else:
        try:
            mtp = int(mtp_raw)
        except ValueError:
            print("mtp must be true/false or integer"); sys.exit(1)

    print(f"Available families: {', '.join(FAMILIES)}")
    family = prompt("family")
    if family not in FAMILIES:
        print(f"Unknown family {family}"); sys.exit(1)

    backends_raw = prompt("backends (comma-separated, vulkan/rocm)", "vulkan")
    backends = [b.strip() for b in backends_raw.split(",") if b.strip()]

    note = prompt("note (optional)", "")

    entry = {
        "id": model_id,
        "path": path,
        "ctx": ctx,
        "kv": kv,
        "mtp": mtp,
        "family": family,
        "backends": backends,
    }
    if note:
        entry["note"] = note

    models.append(entry)
    data["models"] = models

    MODELS_YAML.write_text(yaml.safe_dump(data, sort_keys=False))
    print(f"\nAdded {model_id} to {MODELS_YAML}")
    print("Run: python3 generate.py  to regenerate config.yaml and sync opencode")

if __name__ == "__main__":
    main()
