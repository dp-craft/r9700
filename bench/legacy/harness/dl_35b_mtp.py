#!/usr/bin/env python3
# Download the MTP-preserved 35B-A3B GGUF (unsloth) for llama.cpp draft-mtp on the 35B MoE.
from huggingface_hub import hf_hub_download
import os
dst = "/home/dev/models/gguf"
os.makedirs(dst, exist_ok=True)
p = hf_hub_download(
    repo_id="unsloth/Qwen3.6-35B-A3B-MTP-GGUF",
    filename="Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    local_dir=dst,
    local_dir_use_symlinks=False,
)
print("DOWNLOADED:", p)
