#!/usr/bin/env python3
"""Generate ~/.config/llama-swap/config.yaml from models.yaml.

Single source of truth for the local coding-LLM roster on the R9700 (gfx1201).
Edit models.yaml to add/remove models, or run add_model.py interactively, then run:
  python3 generate.py  (writes config.yaml next to it).

Design decisions baked in (all MEASURED / sourced — see the dp-craft/amd repo):
  * Vulkan is the fast default; each model also gets a ROCm twin (id + "-rocm") for A/B.
    GEMMA IS ROCM-ONLY: Vulkan/RADV device-losts at deep prefill and crashes the GUI.
  * PURPOSE VARIANTS (user request): each model's Vulkan entry is split into two selectable
    profiles that differ ONLY in the sampler — "-coding" and "-planning" — using the
    author-recommended values from /home/dev/work/dippe/AiChatney/MODELS_INFO.md:
      coding  = the vendor "thinking (coding)" recipe (focused, temp 0.6, no penalties)
      planning= the vendor "thinking (general)" recipe (exploratory, temp 1.0, stronger reasoning)
    Both are thinking modes. The ROCm twin keeps a single (coding) entry to limit menu size.
    Switching -coding<->-planning of the SAME model reloads the gguf (different llama-swap id);
    they are separate server instances, so pick a profile per session rather than per turn.
  * KV cache type: on the Qwen3.6 line MTP models MUST use f16 — MEASURED, q8_0 KV collapses draft
    acceptance to ~0.7% (f16 -> ~90%). This is NOT universal: MEASURED on Qwen3.8-27B, q8_0 KV still
    yields 54.3% acceptance, so that model ships a deliberate q8_0 + MTP row. Re-measure before
    assuming either way on a new arch. MTP (--spec-type draft-mtp) only where the gguf has an nextn
    tensor.
  * ctx sized under the 32 GiB budget at the chosen KV via gguf_kv.py, with headroom.
  * --jinja is REQUIRED for opencode tool-calling. We deliberately DO NOT pass
    --reasoning-format deepseek: MEASURED, it corrupts the speculative-decode batch and crashes MTP.
  * NOTE re planning profile: temp 1.0 naturally lowers MTP draft acceptance vs temp 0.6, and the
    35B "-planning" carries presence_penalty 1.5 (vendor rec) which costs ~30-40% decode (host tax).
    That is the documented cost of the general-thinking recipe; coding stays penalty-free/fast.
"""
import json
import pathlib
import yaml

HERE = pathlib.Path(__file__).resolve().parent
# opencode reads its OWN model list; it does not discover llama-swap's. Kept in sync here because a
# hand-maintained copy drifted (it still listed two deleted ggufs and was missing two live models,
# so new models were invisible in /models). Only provider["llama-swap"]["models"] is rewritten —
# every other provider and setting in the file is preserved.
OPENCODE_CFG = pathlib.Path.home() / ".config/opencode/opencode.json"
OPENCODE_PROVIDER = "llama-swap"
# Ceiling, not a fixed value: the emitted limit is min(this, ctx // 2) -- see write_opencode().
OPENCODE_MAX_OUTPUT = 32768
MODELS_DIR = "/home/dev/models/gguf"
REPO = "/home/dev/work/dp-craft/amd"
# Upgraded b10375 -> master 6fdd0ac (2026-08-27). MEASURED, mean decode tok/s over the 3 real
# project workloads: Muse 58.6 -> 59.5, Qwen3.8 51.0 -> 51.3. No regression, and it carries four
# fixes that hit this stack: #26879 (Muse-Glimmer tool calls after <|eom|> went UNDETECTED -- the
# parser assumed the user-facing message was last), #27679 (Qwen3-Coder grammar-trigger workarounds
# were applying to Qwen3.5+ too and degrading many-tool runs), #27034 (two O(N^2) terms in jinja
# gather_string_parts), #25494 (coopmat1 dequantised q8_0 KV 32x per prefill -- every Qwen3.8 row
# runs q8_0 KV on coopmat1). It also gained DFlash2 support; measured and NOT adopted, see below.
# Since 2026-09-11 both binaries resolve through build/latest-<backend>, promoted by
# bench/build_llamacpp.sh (skill llamacpp-build, which benchmarks every new build against the previous
# one first). Switching or rolling back = `build_llamacpp.sh promote <ver>`, never an edit here.
VULKAN_BIN = f"{REPO}/build/latest-vulkan/bin/llama-server"
# COMMUNITY TUNING TABLE (llama.cpp Discussion #21043) CHECKED ROW BY ROW, 2026-08-27.
# Its `Driver` column is load-bearing: 5 of its 9 rows are AMDVLK, and we run RADV. AMDVLK is a
# DIFFERENT Vulkan driver (AMD's own, last released 2025-04-30, ~4x slower dense prefill), so its
# rows describe fixing AMDVLK weaknesses. Applied to RADV the same changes remove things that work.
# MEASURED here, Qwen3.8 mean decode over the 3 real workloads, baseline 52.7:
#   rm_kq = 2 -> 1   (their +13% on AMDVLK): 49.6 49.6 50.2 -> 50.0, i.e. -5.1%. HARMFUL on RADV.
#                    Note rm_kq=4 is gated on AMD_GCN in ggml-vulkan.cpp, so RDNA4 was already at 2.
#   GGML_VK_DISABLE_COOPMAT=1 (their +17% prefill on AMDVLK): decode flat (53.2) but PREFILL
#                    COLLAPSES to 396/409/178 from 827/820/259 -- less than half. coopmat is load-
#                    bearing on RADV. HARMFUL.
#   RADV_PERFTEST=coop_matrix: no-op. The option no longer exists in Mesa 26.1.7 (coopmat became
#                    default-on and the flag was dropped); RADV silently ignores unknown tokens.
#                    52.9 52.6 52.7 vs baseline 51.3 52.6 52.6 -- same distribution.
#   RADV_PERFTEST=cswave32: 49.9. Forcing wave32 on compute shaders hurts. Reject.
#   PCIe ASPM=performance (their +10.8% dense decode, the last untested row): APPLIED by the user
#                    and verified ([performance], link 32.0 GT/s x16), then re-measured.
#                    Qwen3.8 53.4 53.0 52.9 -> 53.1 vs 52.7 baseline = +0.8%, ranges overlapping.
#                    Muse    60.3 60.3 (+ one 57.7 warm-up outlier) -> unchanged from 60.3.
#                    DOES NOT REPRODUCE here. Physical reason: every row runs -ngl 99 with the model
#                    fully resident in VRAM, so almost nothing crosses the PCIe link during decode
#                    and there is no link-wake cost to reclaim. Their figure presumably comes from a
#                    setup that actually exercises the link (partial CPU offload). Harmless to keep
#                    enabled; it is simply not a lever for this workload.
# Every row of that table is now either applied or measured and rejected. No untested rows remain.

# ROCm stays on b10375 and stays a NON-DEFAULT A/B arm. MEASURED 2026-08-27 (first time this
# stack was actually benchmarked on ROCm rather than assumed), mean decode tok/s, 3 real workloads:
#   Muse-Glimmer-30B  vulkan 58.6 | rocm 54.8   (vulkan +6.9%)
#   Qwen3.8-27B       vulkan 51.0 | rocm 40.5   (vulkan +25.9%)
# The split is consistent and is the OPPOSITE way round for prefill -- ROCm wins prompt processing
# (Qwen3.8: 926 vs 813 tok/s) and loses decode. Community reports of "ROCm +47% on dense 27B" on
# this card did NOT reproduce here. Our traffic is decode-dominated, so Vulkan is correctly default.
# HSA_OVERRIDE_GFX_VERSION was tested BOTH ways: 55.8 with, 55.3 without -- it is a wash on gfx1201
# (ROCm 7.x lists the target natively), so the existing override is kept as harmless.
# NOT retried: -DGGML_HIP_ROCWMMA_FATTN. It was REMOVED from llama.cpp upstream; issue #26220
# records that its removal cost up to 2x prefill at depth on gfx1201, which matches what is
# measured above. There is no build flag left to reclaim it.
ROCM_BIN = f"{REPO}/build/latest-rocm/bin/llama-server"
# NO LD_LIBRARY_PATH on ROCm rows: it outranks RUNPATH, so a fixed one would load another build's
# libllama.so. Source builds find /opt/rocm via RUNPATH. The prebuilt b10375 asset does NOT bundle
# the HIP runtime (libamdhip64.so.7 / libhipblas.so.3 / librocblas.so.5) and borrows it from the
# July b9949 bundle -- that now lives in its own wrappers, build/b10375-rocm/bin/* (own dist/ first:
# the reverse order resurrects `unknown model architecture: 'muse-glimmer'`).
# hipfire — a SEPARATE ENGINE, not a llama.cpp build. It is its own OpenAI-compatible daemon, so a
# hipfire row shares NOTHING with the vulkan/rocm rows: no ${common}, no -ngl/-fa/-c/--jinja, no
# sampler flags (hipfire honours sampling from the REQUEST BODY -- MEASURED 2026-09-10: temperature
# 0.0 twice gave byte-identical output, 1.9 twice diverged). It also serves ONE model per process,
# which is exactly what llama-swap's group swapping provides.
HIPFIRE_BIN = "/home/dev/.hipfire/bin/hipfire"
# Idle eviction is what puts the daemon into the state where the next request must cold-load, and a
# cold load has been observed to spin (see the engine evaluation log, section 20). llama-swap owns
# the lifecycle here, so hipfire must never evict on its own.
HIPFIRE_IDLE_TIMEOUT = 0
# llama.cpp-only row keys. A hipfire row carrying one of these would silently drop it -- there is no
# argv to put it in -- so refuse the row instead. Mirrors the existing mtp+draft defensive posture.
HIPFIRE_FORBIDDEN_KEYS = ("templates", "kv_unified", "np", "draft", "spec_p_min", "mtp",
                          "chat_template_kwargs")
# vLLM — a THIRD engine, and like hipfire NOT a llama.cpp backend. Specifically the ROCm fork
# stilldeadcode/vllm-radiance, run from a DOCKER IMAGE rather than a local binary, so a vllm row
# shares nothing with the vulkan/rocm rows: no ${common}, no -ngl/-fa/-c/--jinja, no sampler flags
# (vLLM honours sampling from the REQUEST BODY, same as hipfire).
# MEASURED on this box: radiance 0.9.3 + R4D attention + MTP-8 decodes 58.6 tok/s on real 8k
# agentic code vs 45.8 for llama.cpp+MTP. Boot takes 230-310 s (torch.compile + AITER autotune
# against the /cache mount), which the existing healthCheckTimeout: 600 already covers.
# NO ${vllm} MACRO, deliberately. The `macros:` block in main() is emitted unconditionally, so a
# fourth macro line would change config.yaml on every box even with zero vllm rows -- the argv is
# therefore built inline by vllm_cmd_for(). See tests/test_vllm.py.
VLLM_IMAGE = "stilldeadcode/vllm-radiance:0.9.3"
# The container always listens on 8000; llama-swap's per-row ${PORT} is the HOST side of -p.
VLLM_CONTAINER_PORT = 8000
VLLM_MODEL_MOUNT = "/model"
# Persistent compile/autotune cache. Without it every cold start re-pays the torch.compile,
# inductor, triton and AITER passes -- that is most of the 230-310 s boot.
VLLM_CACHE_HOST = f"{REPO}/bench/dl/radiance-cache"
VLLM_CACHE_MOUNT = "/cache"
# MEASURED on this host (`getent group render video`): render=992, video=44. The container user is
# not in them, so /dev/kfd and /dev/dri are unopenable without --group-add and vLLM aborts with
# "No HIP GPUs are available". Re-read them if the box is reinstalled; they are not universal.
VLLM_GROUP_ADD = (992, 44)
# Container environment, in docker-argv order. THESE MUST BE `-e` FLAGS, NOT an llama-swap `env:`
# block: llama-swap's `env:` sets the environment of the DOCKER CLIENT, which merely talks to the
# daemon over a socket -- the container never sees it, and the knob would silently do nothing.
# The AITER matrix is the MEASURED best config on gfx1201: unified attention ON, every fused AITER
# kernel path OFF (they are tuned for CDNA and are slower or numerically wrong on RDNA4).
# Deliberately a module constant and NOT a per-row `vllm_env` override -- see _load_models().
VLLM_ENV = {
    "VLLM_ROCM_USE_AITER": 1,
    "VLLM_ROCM_USE_AITER_UNIFIED_ATTENTION": 1,
    "VLLM_ROCM_USE_AITER_MHA": 0,
    "VLLM_ROCM_USE_AITER_MLA": 0,
    "VLLM_ROCM_USE_AITER_MOE": 0,
    "VLLM_ROCM_USE_AITER_LINEAR": 0,
    "VLLM_ROCM_USE_AITER_FP8BMM": 0,
    "VLLM_ROCM_USE_AITER_FP4BMM": 0,
    "VLLM_ROCM_USE_AITER_RMSNORM": 0,
    "VLLM_CACHE_ROOT": f"{VLLM_CACHE_MOUNT}/vllm",
    "TORCHINDUCTOR_CACHE_DIR": f"{VLLM_CACHE_MOUNT}/inductor",
    "TRITON_CACHE_DIR": f"{VLLM_CACHE_MOUNT}/triton",
    "AITER_ROOT_DIR": f"{VLLM_CACHE_MOUNT}/aiter",
    "TRITON_CACHE_AUTOTUNING": 1,
    # radiance's own knobs. tau 0.28 is the MEASURED draft-acceptance threshold behind the 58.6
    # tok/s figure; skinny-gemm covers all the tall-thin GEMMs a batch-1 decode is made of.
    "RADIANCE_FAST_DRAFT": 1,
    "RADIANCE_DRAFT_TAU": 0.28,
    "RADIANCE_SKINNY_GEMM": "all",
}
# Docker --name prefix. The suffix is the row's full_id(), which is unique by construction.
VLLM_CONTAINER_PREFIX = "llama-swap-"
# llama.cpp-only row keys. Same defensive posture as HIPFIRE_FORBIDDEN_KEYS: a vllm row carrying
# one of these has no argv to put it in, so it would be dropped in SILENCE -- refuse instead.
# `np` and `mtp` are absent from the list on purpose: unlike hipfire, vLLM DOES express them
# (--max-num-seqs and --speculative-config), and so are ctx (--max-model-len) and prefix caching.
# `path` is listed for a sharper reason than the rest: it shares a tuple slot with `vllm_model`
# (see _load_models), so a stray gguf path would be bind-mounted as the model directory.
VLLM_FORBIDDEN_KEYS = ("path", "templates", "kv_unified", "draft", "spec_p_min", "alias",
                       "chat_template_kwargs")
# `kv` on a vllm row -> vLLM's --kv-cache-dtype. `q8_0` is deliberately absent: it is a GGUF block
# quant that vLLM has no equivalent of, and before this map existed a vllm row carrying it only
# renamed the id "kvq8" while the engine ran auto (f16) KV -- the silent drop the forbidden-key
# list exists to prevent. `fp8` is the vLLM-native 8-bit KV (e4m3 on gfx1201; R4D declares it).
# MEASURED 2026-09-12 on Qwen3.8-27B-INT4 (hybrid, 48/64 Gated-DeltaNet): fp8 left the KV pool
# token-for-token identical -- the attention block is padded up to the mamba page -- so on a hybrid
# it buys no window. Its speed and quality effects there are unmeasured.
VLLM_KV_DTYPES = {"f16": None, "fp8": "fp8"}
LISTEN_PORT = 9292
HEALTHCHECK_TIMEOUT = 600
IDLE_TTL = 0

# --- sampler recipes, verbatim from MODELS_INFO.md "Recommended Sampling (Thinking Mode)" --------
CODE_Q  = "--temp 0.6 --top-p 0.95 --top-k 20 --min-p 0"                          # Qwen coding (all)
PLAN_27 = "--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0"                          # Qwen 27B general
PLAN_35 = "--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0 --presence-penalty 1.5"   # 35B-A3B general (pp1.5)
GEMMA   = "--temp 1.0 --top-p 0.95 --top-k 64 --min-p 0"                          # Gemma (single recipe)
# Muse-Glimmer: unsloth/Muse-Glimmer-30B-GGUF card gives ONE recipe (temp 1.0 / top_p 0.95 /
# top_k 64) and names no min_p / repeat / presence penalty -> min_p 0, no penalties. Numerically
# equal to GEMMA today but sourced independently; kept separate so a Gemma edit cannot move Muse.
# Reasoning strength (low/medium/high/xhigh) is a SYSTEM-PROMPT knob on this model, not a CLI flag;
# the card recommends high/xhigh for coding + agentic work -> set it client-side in opencode.
MUSE    = "--temp 1.0 --top-p 0.95 --top-k 64 --min-p 0"                          # Muse-Glimmer
# Qwen3.8-27B — the OFFICIAL card (https://huggingface.co/Qwen/Qwen3.8-27B, mirrored verbatim by
# https://huggingface.co/unsloth/Qwen3.8-27B-GGUF) publishes exactly TWO recipes, and it splits them
# by MODE (thinking vs instruct), not by task. Both list repetition_penalty 1.0 = llama.cpp's default
# (--repeat-penalty 1.0), so no repeat flag is needed; presence_penalty differs and IS passed.
#   thinking      : temperature 1.0, top_p 0.95, top_k 20, min_p 0.0, presence_penalty 0.0
#   instruct/non-t: temperature 0.7, top_p 0.80, top_k 20, min_p 0.0, presence_penalty 1.5
# Mapping to this file's purpose tags: "coding" takes the tighter instruct recipe (top_p 0.80 keeps
# the token pool narrow, which is what code wants), "planning" takes the thinking recipe.
# CAVEAT (measured here): the gguf's chat template emits <think> BY DEFAULT — a plain request came
# back with reasoning_content — so "-coding" runs the instruct sampler over a thinking generation.
# That is the card's own tighter recipe, not a mismatch we can fix from the CLI; the thinking/instruct
# switch is a template/system-prompt knob, same as this model's reasoning-effort level.
Q38_CODE = "--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0 --presence-penalty 1.5"   # Instruct / non-thinking
Q38_PLAN = "--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0"                         # Thinking mode
# Qwen3.8-27B, MRCR v2 LONG-CONTEXT EVAL rows (eval_hub/mrcr_v2). Deliberately its OWN constant
# rather than a reuse of the coding/planning split; both reasons are load-bearing for THIS task.
#   * PRESENCE PENALTY MUST BE 0. MRCR scores a VERBATIM reproduction of one assistant turn that is
#     already present in the context (difflib SequenceMatcher ratio vs. the reference answer).
#     Q38_CODE carries --presence-penalty 1.5, which penalises exactly the token reuse the task
#     requires -- so the "coding" arm is not merely suboptimal here, it is actively wrong. The
#     card's THINKING recipe has presence_penalty 0.0 and temperature 1.0, and 1.0 is ALSO the
#     temperature the reference harness uses (run_evaluation.py: GenerateContentConfig(
#     temperature=1.0)) -- vendor recipe and benchmark setting agree, so nothing has to be fudged.
#     Numerically equal to Q38_PLAN today but sourced independently and kept separate, so a future
#     edit to the chat recipe cannot silently move an eval baseline.
#   * --no-context-shift IS PART OF THE RECIPE, not decoration. These rows deliberately run prompts
#     that sit just under -c. With context shift ON, an over-long prompt is still served, with the
#     OLDEST tokens silently DROPPED -- and dropping the head of an MRCR prompt deletes needles, so
#     the run would score low for a reason invisible in the logs AND in the output. OFF, llama.cpp
#     refuses the request instead, which is the failure mode a benchmark actually wants. VERIFIED
#     on the pinned build: `--context-shift, --no-context-shift ... (default: disabled)`, i.e. this
#     only PINS today's default so a future build that flips it cannot quietly corrupt a score.
Q38_MRCR = "--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0 --no-context-shift"

# Qwen3.5 (4B / 9B, arch `qwen35`) — added for TEXT PROCESSING (summary generation), not chat.
# The official card (https://huggingface.co/Qwen/Qwen3.5-9B, mirrored by the unsloth GGUF repo)
# publishes FOUR recipes split by mode x task. This row takes the INSTRUCT / NON-THINKING general
# one, because that is the mode these entries actually run in: the gguf's EMBEDDED chat template
# branches `{% if enable_thinking is defined and enable_thinking is true %}<think>` and otherwise
# emits a CLOSED empty `<think></think>` pair — i.e. with no client kwarg it defaults to
# NON-thinking. (Opposite of Qwen3.8, whose template opens <think> by default — see Q38_CODE.)
#   instruct/general : temperature 0.7, top_p 0.80, top_k 20, min_p 0.0, presence_penalty 1.5
# repetition_penalty is 1.0 = llama.cpp's default, so no --repeat-penalty flag is needed.
# Numerically equal to Q38_CODE today but sourced independently, so a Qwen3.8 edit cannot move this.
#
# `-rea off` IS PART OF THE RECIPE, and it is what makes the instruct sampler above the CORRECT one.
# MEASURED here on Qwen3.5-4B-Q4_K_M (b10375 Vulkan, this exact cmd line), same prompt both runs
# ("Summarize in exactly two sentences: ..."):
#   default (-rea auto) -> 300 completion tokens, finish_reason "length", message.content EMPTY —
#                          the whole budget went to reasoning_content, no summary was ever produced.
#   -rea off            -> 55 completion tokens, finish_reason "stop", a clean two-sentence summary.
# So the embedded template does NOT default to non-thinking under --jinja (llama.cpp supplies
# enable_thinking=true), exactly like Qwen3.8 — reading the template alone would get this backwards.
# For a summarization workhorse that failure mode is fatal, hence off. Flip back to `-rea auto` (and
# then switch to the card's THINKING/general recipe: --temp 1.0 --top-p 0.95) if a row ever wants
# reasoning. NOT the same flag as --reasoning-format deepseek, which the module docstring bans.
Q35_SUM = "--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0 --presence-penalty 1.5 -rea off"

# per-family purpose->sampler maps
QWEN27 = {"coding": CODE_Q, "planning": PLAN_27}
QWEN35 = {"coding": CODE_Q, "planning": PLAN_35}
QWEN38 = {"coding": Q38_CODE, "planning": Q38_PLAN}
QWEN38E = {"eval": Q38_MRCR}   # MRCR eval rows: ONE recipe -> one entry, no purpose split
GEM    = {"coding": GEMMA}   # only one vendor recipe -> single entry, no purpose split
MUSEP  = {"coding": MUSE}    # ditto
QWEN35T = {"coding": Q35_SUM}  # summarization/text row: ONE recipe -> one entry, no purpose split

# --- FIXED CHAT TEMPLATES ------------------------------------------------------------------------
# The official Qwen 3.5/3.6/3.8 chat_template.jinja has documented functional defects (fatal crash
# with thinking disabled, blank <think> injection that invalidates the prefix KV cache on every
# later turn, tool-call parsing that dies on JSON-string arguments, a reasoning_effort default that
# can burn the whole token budget). froggeric's drop-in rewrite fixes those; peculiar-ragdoll's
# "sharp" build is that SAME v22.1 file plus an appended terseness directive (it concatenates onto
# any user system prompt, never overwrites it). Both files carry
# `template_version = "qwen3.8-froggeric-v22.1"` — verified after download.
# A template is a SERVER LAUNCH FLAG (--chat-template-file), so each choice must be its own
# llama-swap entry; that is what makes it pickable in the opencode model menu.
# Sources: https://huggingface.co/froggeric/Qwen-Fixed-Chat-Templates
#          https://huggingface.co/peculiar-ragdoll/Qwen-Sharp-Chat-Templates
# NOT passed, deliberately: --reasoning-format deepseek. froggeric's README recommends it, but it is
# MEASURED HERE to corrupt the speculative-decode batch and crash MTP (see the module docstring).
# Re-test before adding it, and only on a row with mtp: false.
TEMPLATES = {
    "froggeric": HERE / "templates" / "froggeric-chat_template.jinja",
    "sharp":     HERE / "templates" / "sharp-chat_template.jinja",
}
# short tag used inside the generated model id
TEMPLATE_TAG = {"froggeric": "frog", "sharp": "sharp"}

# Load models from external YAML for easier editing
_MODELS_YAML = HERE / "models.yaml"
_FAMILY_MAP = {
    "QWEN27": QWEN27,
    "QWEN35": QWEN35,
    "QWEN38": QWEN38,
    "QWEN38E": QWEN38E,
    "GEM": GEM,
    "MUSEP": MUSEP,
    "QWEN35T": QWEN35T,
}

def _load_models():
    if not _MODELS_YAML.exists():
        raise FileNotFoundError(f"models.yaml not found at {_MODELS_YAML}")
    data = yaml.safe_load(_MODELS_YAML.read_text())
    models = []
    for m in data.get("models", []):
        family = _FAMILY_MAP.get(m["family"])
        if family is None:
            raise ValueError(f"Unknown family {m['family']} for model {m['id']}")
        if m.get("spec_p_min") is not None and not (m.get("mtp") or m.get("draft")):
            raise ValueError(f"{m['id']}: spec_p_min set but the row has no speculation "
                             f"(`mtp` or `draft`) -- the flag would be a silent no-op")
        ctk = m.get("chat_template_kwargs")
        if ctk is not None and not isinstance(ctk, dict):
            raise ValueError(f"{m['id']}: chat_template_kwargs must be a mapping, got "
                             f"{type(ctk).__name__}")
        backends = m["backends"]
        if "hipfire" in backends:
            # hipfire is a different engine, not a llama.cpp backend: a row cannot be both, because
            # `path` is a gguf under MODELS_DIR for llama.cpp and a hipfire registry tag (or an
            # absolute .hfq/.mq4-pro path) for hipfire.
            if len(backends) > 1:
                raise ValueError(f"{m['id']}: hipfire cannot share a row with {sorted(set(backends) - {'hipfire'})} "
                                 f"-- give hipfire its own models.yaml row")
            if not m.get("hipfire_tag"):
                raise ValueError(f"{m['id']}: a hipfire row needs `hipfire_tag` (registry tag or "
                                 f"absolute model path); `path` is llama.cpp-only")
            offenders = [k for k in HIPFIRE_FORBIDDEN_KEYS if m.get(k)]
            if offenders:
                raise ValueError(f"{m['id']}: {offenders} are llama.cpp-only and would be silently "
                                 f"dropped on a hipfire row -- hipfire takes speculation, KV mode "
                                 f"and templates from its own config, not from argv")
            env = m.get("hipfire_env") or {}
            if not isinstance(env, dict):
                raise ValueError(f"{m['id']}: hipfire_env must be a mapping of ENV -> value")
        elif m.get("hipfire_tag") or m.get("hipfire_env"):
            raise ValueError(f"{m['id']}: `hipfire_tag`/`hipfire_env` set on a non-hipfire row")
        # A SECOND, independent if/elif rather than more branches on the one above: that way a
        # hipfire row carrying `vllm_model` is still caught (by this elif), and a vllm row
        # carrying `hipfire_tag` is still caught (by the elif above).
        if "vllm" in backends:
            # Same argument as hipfire: a row cannot be both, because `path` is a gguf under
            # MODELS_DIR for llama.cpp while `vllm_model` is an absolute HOST DIRECTORY that gets
            # bind-mounted into the container.
            if len(backends) > 1:
                raise ValueError(f"{m['id']}: vllm cannot share a row with "
                                 f"{sorted(set(backends) - {'vllm'})} -- give vllm its own "
                                 f"models.yaml row")
            vllm_model = m.get("vllm_model")
            if not vllm_model:
                raise ValueError(f"{m['id']}: a vllm row needs `vllm_model` (absolute host path to "
                                 f"the model directory); `path` is llama.cpp-only")
            if not str(vllm_model).startswith("/"):
                # `docker run -v src:/model` reads a RELATIVE src as a named VOLUME, not a bind
                # mount, so the container would boot against an empty dir instead of failing.
                raise ValueError(f"{m['id']}: `vllm_model` must be an absolute path, got "
                                 f"{vllm_model!r} -- docker reads a relative -v source as a "
                                 f"named volume and would mount an EMPTY directory")
            offenders = [k for k in VLLM_FORBIDDEN_KEYS if m.get(k)]
            if offenders:
                raise ValueError(f"{m['id']}: {offenders} are llama.cpp-only and would be silently "
                                 f"dropped on a vllm row -- vLLM takes the chat template from the "
                                 f"model directory and sampling from the request body")
            if m.get("vllm_env"):
                # DELIBERATE non-feature. The container env is the MEASURED recipe (VLLM_ENV) and
                # is not part of the row's id, so a per-row override would let a row deviate from
                # the measured config with nothing in config.yaml recording it. If a second model
                # ever genuinely needs different knobs, add the mapping to the row tuple (one new
                # slot) and emit extra `-e` flags -- do not smuggle it in as an llama-swap `env:`,
                # which the container never sees.
                raise ValueError(f"{m['id']}: per-row `vllm_env` is not supported -- the container "
                                 f"environment is the measured recipe in generate.py's VLLM_ENV")
            if m.get("mtp") and type(m["mtp"]) is not int:   # bool is not `is int`
                # llama.cpp reads `mtp: true` as "engine default depth". vLLM has no such default:
                # --speculative-config requires num_speculative_tokens, so a bare `true` would
                # either crash the container or need a number invented here.
                raise ValueError(f"{m['id']}: a vllm row needs an INTEGER `mtp` depth "
                                 f"(--speculative-config num_speculative_tokens); `true` has no "
                                 f"engine default to fall back on")
            if m["kv"] not in VLLM_KV_DTYPES:
                raise ValueError(f"{m['id']}: kv {m['kv']!r} is not a vLLM KV cache type (use one of "
                                 f"{sorted(VLLM_KV_DTYPES)}) -- q8_0 is a llama.cpp GGUF quant and would "
                                 f"otherwise be dropped in silence")
            # NOTE ON `family`: kept REQUIRED (the lookup above already ran) even though no
            # sampler reaches the command line -- vLLM honours sampling from the request body.
            # Exactly the hipfire precedent: those rows also carry a family whose recipe is
            # dropped. Requiring it costs nothing, changes no existing validation, and keeps the
            # row self-describing about which model line it serves. `kv` is NOT descriptive: it
            # maps to --kv-cache-dtype through VLLM_KV_DTYPES (validated above).
        elif m.get("vllm_model") or m.get("vllm_env"):
            raise ValueError(f"{m['id']}: `vllm_model`/`vllm_env` set on a non-vllm row")

        if m["kv"] == "fp8" and "vllm" not in backends:
            # llama-server's -ctk/-ctv have no fp8 type; the row would fail at boot, not here.
            raise ValueError(f"{m['id']}: kv 'fp8' is vLLM-only -- llama.cpp takes f16/q8_0")

        draft = m.get("draft")
        if draft:
            # Both knobs write --spec-type, so a row carrying each would emit the flag twice and the
            # LAST one would silently win. Refuse instead of picking one.
            if m.get("mtp", False):
                raise ValueError(f"{m['id']}: `mtp` and `draft` both set --spec-type; pick one")
            missing = {"path", "type"} - set(draft)
            if missing:
                raise ValueError(f"{m['id']}: draft is missing {sorted(missing)}")
        for t in m.get("templates", [""]) or [""]:
            if t and t not in TEMPLATES:
                raise ValueError(f"Unknown template {t!r} for model {m['id']} "
                                 f"(known: {sorted(TEMPLATES)})")
        models.append((
            m["id"],
            # One slot, three meanings, decided by the row's backend: a gguf path relative to
            # MODELS_DIR (llama.cpp), a hipfire registry tag / absolute model file (hipfire), or
            # an absolute host model DIRECTORY to bind-mount (vllm). The `m["hipfire_tag"]` at the
            # end is kept as a subscript on purpose -- it preserves today's KeyError for a row
            # that declares none of the three.
            m.get("path") or m.get("vllm_model") or m["hipfire_tag"],
            m["ctx"],
            m["kv"],
            m.get("mtp", False),
            family,
            m["backends"],
            m.get("np"),  # concurrent slots, may be None -> fallback to PARALLEL dict
            m.get("templates", [""]) or [""],  # chat-template variants; [""] = gguf's embedded one
            bool(m.get("kv_unified", False)),
            draft,  # None, or {path, type, n_max?, ngl?} -> a SEPARATE drafter gguf (see cmd_for)
            m.get("spec_p_min"),  # None, or float -> --spec-draft-p-min (applies to mtp AND draft)
            m.get("alias"),  # None, or str -> -a/--alias, the name the API answers to
            ctk,  # None, or dict -> --chat-template-kwargs (server-wide template defaults)
            m.get("hipfire_env") or {},  # hipfire rows only -> per-PROCESS engine config via env
        ))

    # hipfire has NO per-row context cap. `hipfire serve` takes no --max-seq, and memory.max_seq is
    # a SCHEMA field, so it has no HIPFIRE_* env alias either (developer_env_for_key covers
    # developer keys only). The enforced cap is the GLOBAL ~/.hipfire/config.toml; a row's `ctx` is
    # merely what opencode advertises. Two hipfire rows with different ctx therefore guarantee that
    # at least one advertises a window the daemon will refuse with
    # `HTTP 400: request exceeds loaded KV budget ... > physical_cap=N`.
    # MEASURED 2026-09-10: raising the cap is nearly free (27B +182 MB, 35B +109 MB going
    # 163840 -> 225280; prefill unchanged within noise) because VMM commits KV on demand.
    hipfire_ctx = {row[0]: row[2] for row in models if "hipfire" in row[6]}
    if len(set(hipfire_ctx.values())) > 1:
        raise ValueError(
            f"hipfire rows must all share one ctx (global memory.max_seq governs them): "
            f"{hipfire_ctx}")
    return models

MODELS = _load_models()

COMMON = "--host 127.0.0.1 -ngl 99 -fa on -ub 2048 -b 4096 --jinja"

# --- RERANKERS (cross-encoders, --rerank) --------------------------------------------------------
# A separate table on purpose: a reranker recipe shares NO field with MODELS (no sampler, no KV
# quant, no MTP, no purpose split, no ROCm twin), and it MUST NOT use ${common}: -ub there is a
# fixed 2048, but for a rerank server -ub is the HARD per-document ceiling (a document longer than
# -ub is refused: "input (N tokens) is too large to process"), and it differs per model.
# Values are copied from the canonical registry docs/benchmarks/lib/models.sh (AiChatney), where
# they were measured; ids are the literal ids dp-gnosis --rerank resolves, so DO NOT decorate them
# with ctx/backend suffixes the way full_id() does for chat models.
# id, relative gguf path, ctx, ubatch, batch
# PRUNED 2026-08-27: mxbai-rerank-large-v2, llama-nemotron-rerank-1b-v2 and jina-reranker-v3 were
# removed together with their ggufs (user decision). All three pointed at files absent from disk,
# so llama-swap advertised three rerankers that could never load.
RERANKERS = [
    ("bge-reranker-v2-m3",                "rerankers/bge-reranker-v2-m3-Q4_K_M.gguf",                8192, 8192, 8192),
    ("ettin-reranker-1b-v1",              "rerankers/ettin-reranker-1b-v1-q8_0.gguf",                8192, 8192, 8192),
    # ctx/-ub 8192 per the registry: it covers the 8000-char ATOM_FENCE_MAX_CHARS worst case
    # (~4400 tokens at the measured 1.82 HU chars/token) with margin, at zero measured quality
    # cost (EXP-3: nDCG identical to 4 decimals from ctx 512 to 8192). Native ctx is 40960 for
    # both; serving all rerank arms at the SAME 8192 keeps the model comparison free of a
    # truncation confound — a document one arm sees whole and another truncates is not a
    # model difference. Both carry the verified rank head (qwen3.pooling_type=4).
    ("qwen3-reranker-0.6b",               "rerankers/qwen3-reranker-0.6b-q8_0.gguf",                8192, 8192, 8192),
    # NO jina reranker is served. MEASURED 2026-08-29 (dp-gnosis c84d1ca): v3/v3.5 score by
    # COSINE of `projector`-mapped hidden states at <|rerank_token|>/<|embed_token|>, not a cls
    # rank head, and the qwen3 GGUF conversion DROPS projector.0.weight (512x1024) and
    # projector.2.weight (512x512) -- 310 tensors served vs 313 native. llama.cpp then returns
    # ~1e-7 noise at HTTP 200 and dp-gnosis refuses it (DEGENERATE probe). The MODEL is fine:
    # native transformers separates the same probe pair +0.5993 / -0.1582. It would need a
    # non-llama.cpp /v1/rerank sidecar, which is out of scope here. v2-base-multilingual is
    # retired (trained ctx 1024) and measured worse than qwen3-reranker-4b at matched width.
    ("qwen3-reranker-4b",                 "rerankers/Qwen3-Reranker-4B.Q4_K_M.gguf",                8192, 8192, 8192),
]

# --- EMBEDDERS (bi-encoders, --embedding) --------------------------------------------------------
# A THIRD table, for the same reason RERANKERS is a second one: an embedding recipe shares no field
# with either (no sampler, no KV quant, no MTP; and unlike a reranker it needs an explicit --pooling,
# because the pooling type decides what the vector MEANS and a wrong choice fails SILENTLY).
# -ub MUST be >= ctx: these are non-causal encoders, so llama.cpp requires the whole sequence in one
# ubatch and refuses a document longer than -ub.
# FP16 deliberately, NOT a quant (user decision 2026-08-17, quality-first): cosine similarity is more
# sensitive to quantization than a rank head is, and a quantized embedder would be an uncontrolled
# confound in exactly the phase that asks whether the dense leg helps at all.
# bge-m3 pooling is CLS (BAAI's own dense recipe normalizes the CLS token). MUST clear the D2 cosine
# discrimination probe before any number counts — a wrong-pooling encoder returns well-formed vectors
# that are nearly identical, which is the mxbai constant-score failure one layer down.
# id, relative gguf path, ctx, ubatch, batch, pooling
EMBEDDERS = [
    ("bge-m3",                            "gpustack/bge-m3-FP16.gguf",                              8192, 8192, 8192, "cls"),
]

# model id -> concurrent request slots (default 1). Legacy FALLBACK only: models.yaml `np` wins.
# `ctx` in the MODELS table always means per-CONVERSATION depth, never the -c total. How that maps
# to -c depends on the row's `kv_unified` — see cmd_for(), which documents the measured split.
# MEASURED (b10375, Vulkan): Muse at NON-unified 4 x 131072 = 28.54 GiB of the 31.86 GiB budget, and
# 4 concurrent requests finished in 18.7 s wall vs ~16 s for one alone — the extra 3 are close to
# free. Under SPLIT KV, raising np costs np x the KV, so re-check VRAM before changing it; under
# `kv_unified: true` it costs nothing extra (the slots share one -c-sized pool).
# The Qwen3.8 rows OOM'd at ctx 204800 with np=2 on split KV — that ceiling was a VRAM artifact of
# the multiplication, and is why both Qwen3.8 rows are now unified instead.
PARALLEL = {
    # Fallback for models that don't specify np in models.yaml
    # Key follows the Muse row's id, renamed q5kxl -> q5kl with the 2026-08-27 quant swap. Dead
    # weight today (the row states np: 2 itself) but kept in sync so it cannot fire a stale 1.
    "muse-glimmer-30b-q5kl": 2,
}


# Backend -> id tag. vulkan is the untagged default. Every non-vulkan backend MUST have an entry:
# an unmapped backend silently produces an id indistinguishable from the vulkan one.
BACKEND_TAG = {"vulkan": "", "rocm": "rocm", "hipfire": "hf", "vllm": "vllm"}


def ctx_label(ctx):
    return f"{ctx // 1024}k" if ctx % 1024 == 0 else str(ctx)


def full_id(mid, ctx, kv, mtp, be, purpose="", tpl="", draft=None, ctk=None):
    """Model id: <mid>-ctx<N>k[-kvq8][-mtp|-<drafter>][-rocm][-<tpl>][-eff-<level>][-<purpose>].
    Shared by config.yaml AND the opencode merge so the two never drift. Purpose
    ('coding'/'planning') is the trailing tag. The speculation and pinned-effort tags are
    load-bearing, not decoration: each changes what the row actually runs (spec source moves both
    throughput and VRAM; a pinned kwarg replaces the opencode variant menu), so two otherwise-
    identical rows must not collide on one id."""
    parts = [mid, f"ctx{ctx_label(ctx)}"]
    if kv == "q8_0":
        parts.append("kvq8")
    elif kv == "fp8":
        parts.append("kvfp8")
    if mtp:
        parts.append("mtp")
    if draft:
        parts.append(draft["type"])
    if BACKEND_TAG.get(be):
        parts.append(BACKEND_TAG[be])
    if tpl:
        parts.append(TEMPLATE_TAG[tpl])
    # A row that PINS a template kwarg server-side (models.yaml `chat_template_kwargs`) stops
    # advertising the matching opencode variant -- see variants_for(), which returns None for a
    # pinned key on purpose. The setting therefore has to move INTO THE NAME: without a tag, two
    # rows differing only in pinned effort collide on one id, and whichever survives silently
    # misreports what it runs. Same load-bearing argument as the speculation tag above.
    # `reasoning_budget_tokens` is deliberately NOT tagged here: it is a BODY-level opencode field,
    # not a template variable (VERIFIED -- the string does not occur anywhere in
    # templates/froggeric-chat_template.jinja), so --chat-template-kwargs cannot pin it and there
    # is nothing for a tag to describe. A pinned row gets the EFFORT but not the budget cap.
    for _k in ("reasoning_effort", "reasoning_strength"):   # Qwen's name, then Muse's
        if ctk and _k in ctk:
            parts.append(f"eff-{ctk[_k]}")
    if ctk and ctk.get("preserve_thinking") is False:
        parts.append("nopreserve")
    if purpose:
        parts.append(purpose)
    return "-".join(parts)


def entries_for(mid, ctx, kv, mtp, purposes, be, tpl="", draft=None, ctk=None):
    """Yield (id, purpose, sampler) for a (model, backend, template). Vulkan -> one per purpose;
    ROCm -> a single 'coding' default (no purpose suffix) to keep the menu small."""
    if be == "vulkan":
        for purpose, sampler in purposes.items():
            # a single-recipe model (gemma) gets no purpose suffix
            tag = purpose if len(purposes) > 1 else ""
            yield full_id(mid, ctx, kv, mtp, be, tag, tpl, draft, ctk), tag, sampler
    else:
        sampler = purposes.get("coding") or next(iter(purposes.values()))
        yield full_id(mid, ctx, kv, mtp, be, "", tpl, draft, ctk), "", sampler


def cmd_for(binref, relpath, ctx, kv, mtp, sampler, slots=1, tpl="", kv_unified=False,
            draft=None, spec_p_min=None, alias=None, ctk=None):
    # KV partitioning — MEASURED on this exact binary (b10375, `-c 8192 -np 2`):
    #   -no-kvu      -> "n_slots = 2, n_ctx_slot = 4096, kv_unified = 'false'"  (-c is SPLIT by np)
    #   --kv-unified -> "n_slots = 2, n_ctx_slot = 8192, kv_unified = 'true'"   (-c is the POOL,
    #                   and any single sequence may reach the full -c)
    # So unified must emit `-c ctx` and non-unified `-c ctx*slots` to give each chat `ctx` depth.
    # Consequence: under unified KV, raising np costs ZERO extra VRAM — the tradeoff is that the
    # concurrent chats SHARE one pool instead of owning a guaranteed slice.
    # Note --kv-unified is only the llama.cpp default when np is auto; we always pass an explicit
    # -np, so it is off unless requested here.
    ctx_arg = ctx if kv_unified else ctx * slots
    lines = [binref, f"--model {MODELS_DIR}/{relpath}"]
    if alias:
        # -a/--alias: the name the API answers to. llama-swap routes by ITS OWN id, so this is not
        # load-bearing for routing here; it is set because the vendor doc marks it required and an
        # unset alias reports the checkpoint PATH as the model name in /v1/models responses.
        lines.append(f"-a {alias}")
    lines += [f"-c {ctx_arg} -ctk {kv} -ctv {kv}", f"-np {slots}"]
    if kv_unified:
        lines.append("--kv-unified")
    lines += ["${common}", sampler]
    if tpl:
        lines.append(f"--chat-template-file {TEMPLATES[tpl]}")
    if ctk:
        # SERVER-WIDE default for template variables, as opposed to the per-request
        # chat_template_kwargs that opencode `variants` put in the body (see variants_for).
        # SINGLE QUOTES ARE LOAD-BEARING -- MEASURED against this llama-swap build by dumping the
        # child's argv: llama-swap tokenizes `cmd` shell-style, so a BARE {"k":"v"} arrives as
        # {k:v} (quotes eaten) and llama.cpp then fails to parse it. Quoted, it arrives verbatim.
        # Compact separators keep the value one token, which also survives a naive splitter.
        lines.append("--chat-template-kwargs "
                     f"'{json.dumps(ctk, separators=(',', ':'))}'")
    if mtp:
        lines.append("--spec-type draft-mtp")
        if type(mtp) is int:                 # int N => explicit draft depth; True => engine default (bool is not `is int`)
            lines.append(f"--spec-draft-n-max {mtp}")
    if draft:
        # SEPARATE-DRAFTER speculation, as opposed to `mtp` above (which reuses an nextn head baked
        # into the target gguf and therefore needs no second --model). VERIFIED against the pinned
        # b10375 binary's --help, not assumed: `--spec-type` accepts draft-dflash, and -md /
        # --spec-draft-n-max / --spec-draft-ngl are the live spellings (the old --draft-max /
        # --draft-min were REMOVED in this build and now error out with a pointer to the new names).
        # -ngld defaults to 'auto'; we pass it explicitly because a drafter silently left on CPU
        # turns speculation into a slowdown rather than a speedup, and that failure is invisible in
        # the logs unless you go looking for it.
        lines.append(f"--spec-type draft-{draft['type']}")
        lines.append(f"-md {MODELS_DIR}/{draft['path']}")
        if draft.get("n_max"):
            lines.append(f"--spec-draft-n-max {draft['n_max']}")
        lines.append(f"--spec-draft-ngl {draft.get('ngl', 'all')}")
    if spec_p_min is not None:
        # Truncate the draft at the first position where the DRAFTER's own confidence falls below
        # this. Deliberately emitted OUTSIDE the mtp/draft branches above because llama.cpp applies
        # --spec-draft-p-min to every --spec-type, so an MTP row can use it too.
        # The llama.cpp default is 0.00, i.e. OFF: the drafter then emits its full n-max block every
        # round no matter how unsure it is, and the target must verify all of it. Since the draft
        # pass has already happened by then, p_min does not save draft time -- it shortens the
        # TARGET's verify batch, which is the expensive half at batch size 1.
        # MEASURED here (b10375, R9700 Vulkan, greedy, 3 real project workloads, mean tok/s):
        #   p_min  0.00   0.20   0.30   0.40   0.50   0.60   0.75   0.90
        #   tok/s  40.9   45.5   57.8   60.8   57.8   54.9   53.4   47.7
        # 0.40 is the peak (+47% over the 0.00 default), reproduced at 59.5 on a repeat run.
        # NOTE acceptance RATE is a trap as a tuning target: 0.90 reaches 97-100% acceptance and is
        # SLOWER than 0.40 at ~70%, because a high threshold only ever drafts the trivially
        # predictable. Tune on tok/s. Re-tune per model -- this optimum is not portable.
        lines.append(f"--spec-draft-p-min {spec_p_min}")
    return "\n      ".join(lines)


def hipfire_env_block(env):
    """Per-PROCESS engine config for a hipfire row.

    hipfire's speculation settings live in ~/.hipfire/config.toml and are GLOBAL, but the two
    models need OPPOSITE ones: the 27B wants its DFlash draft, and the 35B MoE must not see that
    draft at all -- loading it against the MoE hard-fails with
    `draft target_layer_ids contains 47 >= num_target_layers`. llama-swap runs one process per
    row, so env is the only place these can differ without a global that breaks the other row.
    """
    if not env:
        return []
    return ["    env:"] + [f'      - "{k}={v}"' for k, v in env.items()]


def hipfire_cmd_for(tag):
    """The hipfire serve line. Deliberately NOT built from cmd_for(): hipfire shares no flag
    vocabulary with llama-server, and quietly reusing ${common} would emit -ngl/-fa/--jinja that
    hipfire's clap parser rejects outright.

    NO `-d`: llama-swap owns the process and needs it in the foreground to supervise and to stop it.
    A detached hipfire would return immediately, llama-swap would consider the row dead, and the
    real daemon would linger holding the GPU.

    Context depth, KV mode, sampling and speculation are NOT expressible here -- hipfire reads them
    from ~/.hipfire/config.toml (plus per-model overlays and the request body). That is a real
    limitation of this backend: two hipfire rows cannot differ in those dimensions, which is why
    _load_models refuses the llama.cpp keys that would imply otherwise."""
    return f"${{hipfire}} --model {tag}"


def vllm_container(fid):
    """Docker --name for a vllm row.

    Derived from full_id(), NOT from the models.yaml `id`: two rows may legitimately share an
    `id` (the q4kxl f16/q8 pair does, and full_id's tags keep them apart), but no two rows share
    a full_id. A name collision is not cosmetic -- `docker run --name` refuses a name already in
    use, so the second row would never start."""
    return f"{VLLM_CONTAINER_PREFIX}{fid}"


def vllm_cmd_for(fid, served, model_dir, ctx, mtp, slots, kv="f16"):
    """The `docker run` line for a vllm row. Deliberately NOT built from cmd_for(): vLLM shares
    no flag vocabulary with llama-server, and ${common} would emit -ngl/-fa/--jinja that vLLM's
    argparse rejects outright.

    ONE FOREGROUND EXECUTABLE INVOCATION, and it has to stay that way: llama-swap tokenizes `cmd`
    shell-style but does NOT hand it to a shell, so a `;`, `&&` or pipe would arrive at docker as
    a literal argument. For the same reason there is NO `-d` -- a detached container returns
    immediately, llama-swap marks the row dead, and the real process lingers holding the GPU
    (exactly the hipfire argument). `--rm` plus the cmdStop `docker rm -f` in main() are what keep
    a crashed boot from leaving the --name permanently taken.

    Unlike hipfire, context depth, speculation depth, concurrency and prefix caching ARE
    expressible here, so the row carries the real numbers instead of "engine-config"."""
    lines = [
        f"docker run --rm --name {vllm_container(fid)}",
        "--device /dev/kfd --device /dev/dri",
        " ".join(f"--group-add {gid}" for gid in VLLM_GROUP_ADD),
        # SYS_PTRACE + unconfined seccomp are what the ROCm runtime needs for its userspace
        # queue doorbells; 4g of /dev/shm is the NCCL/torch shared-memory floor.
        "--shm-size 4g --cap-add SYS_PTRACE --security-opt seccomp=unconfined",
        f"-p 127.0.0.1:${{PORT}}:{VLLM_CONTAINER_PORT}",
        f"-v {model_dir}:{VLLM_MODEL_MOUNT}:ro",
        f"-v {VLLM_CACHE_HOST}:{VLLM_CACHE_MOUNT}",
    ]
    lines += [f"-e {k}={v}" for k, v in VLLM_ENV.items()]
    lines += [
        VLLM_IMAGE,
        # Everything from here is the vLLM server's own argv, not docker's.
        f"{VLLM_MODEL_MOUNT} --served-model-name {served}",
        f"--host 0.0.0.0 --port {VLLM_CONTAINER_PORT}",
        f"--language-model-only --max-model-len {ctx}",
        "--max-num-batched-tokens 16384",
        f"--max-num-seqs {slots} --gpu-memory-utilization 0.90",
        "--attention-backend R4D --enable-prefix-caching --mamba-cache-mode align",
        # Response-side observability only -- none of the three touches scheduling or memory.
        # force-include-usage: `usage` on EVERY response, streamed ones included, without the client
        # having to send stream_options.include_usage (opencode and the bench probes read it).
        # prompt-tokens-details: usage.prompt_tokens_details.cached_tokens -- the prefix-cache hit
        # count, which is the number that separates a warm agent turn from a cold one.
        # per-request-metrics: per-request timing in the response body.
        # All three are FrontendArgs booleans in the image's vLLM 0.27.1 (entrypoints/openai/cli_args.py).
        "--enable-force-include-usage --enable-prompt-tokens-details --enable-per-request-metrics",
    ]
    if VLLM_KV_DTYPES[kv]:
        lines.append(f"--kv-cache-dtype {VLLM_KV_DTYPES[kv]}")
    if mtp:
        # SINGLE QUOTES ARE LOAD-BEARING, for the same measured reason --chat-template-kwargs
        # documents in cmd_for(): llama-swap's shell-style tokenizer eats bare quotes, so an
        # unquoted {"k":"v"} arrives as {k:v} and the JSON parse fails. Compact separators keep
        # the whole value one token, which also survives a naive splitter.
        spec = {"method": "mtp", "num_speculative_tokens": mtp,
                "attention_backend": "R4D", "disable_padded_drafter_batch": True}
        lines.append("--speculative-config "
                     f"'{json.dumps(spec, separators=(',', ':'))}'")
    lines.append("--no-async-scheduling")
    return "\n      ".join(lines)


def rerank_cmd_for(relpath, ctx, ubatch, batch):
    """Rerank server command. Deliberately not ${common} — see the RERANKERS table."""
    return "\n      ".join(["${vulkan}", f"--model {MODELS_DIR}/{relpath}", "--rerank",
                            f"-c {ctx} -b {batch} -ub {ubatch}", "-np 1",
                            "--host 127.0.0.1 -ngl 99 -fa on"])


def embed_cmd_for(relpath, ctx, ubatch, batch, pooling):
    """Embedding server command. Not ${common} — see the EMBEDDERS table."""
    return "\n      ".join(["${vulkan}", f"--model {MODELS_DIR}/{relpath}", "--embedding",
                            f"--pooling {pooling}",
                            f"-c {ctx} -b {batch} -ub {ubatch}", "-np 1",
                            "--host 127.0.0.1 -ngl 99 -fa on"])


def embed_blocks():
    """Yield config.yaml blocks for the embedders. Like the rerankers they never reach
    sync_opencode(): they are bi-encoders, not chat models."""
    for eid, relpath, ctx, ubatch, batch, pooling in EMBEDDERS:
        block = [f'  "{eid}":',
                 f'    name: "{eid}  [vulkan, embed, ctx={ctx}, ub={ubatch}, pooling={pooling}]"',
                 "    cmd: |", f"      {embed_cmd_for(relpath, ctx, ubatch, batch, pooling)}"]
        if IDLE_TTL:
            block.append(f"    ttl: {IDLE_TTL}")
        yield "\n".join(block)


def rerank_blocks():
    """Yield config.yaml blocks for the rerankers. Their ids never reach sync_opencode(): they are
    cross-encoders, not chat models, and would be unusable entries in the opencode menu."""
    for rid, relpath, ctx, ubatch, batch in RERANKERS:
        block = [f'  "{rid}":', f'    name: "{rid}  [vulkan, rerank, ctx={ctx}, ub={ubatch}]"',
                 "    cmd: |", f"      {rerank_cmd_for(relpath, ctx, ubatch, batch)}"]
        if IDLE_TTL:
            block.append(f"    ttl: {IDLE_TTL}")
        yield "\n".join(block)


# --- OPENCODE REASONING VARIANTS -----------------------------------------------------------------
# `variants` are CLIENT-side: opencode puts them in the REQUEST BODY, so switching low <-> xhigh is
# a per-message change that does NOT reload the gguf. This is what replaces the deleted
# `effort_levels`, which minted a separate llama-swap id per level while emitting a byte-identical
# cmd line — i.e. it paid a full model reload to change nothing.
# In opencode, a variant is picked with the model name suffixed by '/<variant>'.
# Pattern source: https://gist.github.com/komikndr/b17955e1a80ce6ede9a3115f16216bc5
#
# TEMPLATE_VARIANTS drive the FIXED template's own documented control surface (froggeric v22.1
# README): chat_template_kwargs.reasoning_effort in {none, low, medium, xhigh} (aliases high/max ->
# xhigh, minimal -> low) and preserve_thinking (default true). This works on the whole Qwen
# 3.5/3.6/3.8 line — including Qwen3.6, which has NO native effort levels — precisely because the
# template implements it. reasoning_budget_tokens is the independent hard cap on thinking length.
#
# READ THIS BEFORE TOUCHING THE LADDER — two facts VERIFIED in the template source itself
# (templates/froggeric-chat_template.jinja), not inferred:
#   line 26-27: `high` / `xhigh` / `max` ALL collapse to _initial_effort = 'xhigh'. So `high` is a
#               pure ALIAS: it renders a byte-identical prompt to `xhigh`. The `high` rung below is
#               therefore NOT a distinct effort level — it is the same effort at a smaller CAP.
#   line 18:    reasoning_effort undefined -> default 'medium'. MEASURED to match: an omitted-kwarg
#               request returned thinking byte-identical to the explicit `medium` request (2788 ch).
# CONTROLLED MEASUREMENT (budget field omitted entirely, 5 efforts x 2 seeds, AIME-style counting
# task, this box, qwen38-27b-q4kxl frog/coding). Thinking tokens derived from the response's own
# measured chars-per-token, all runs finished `stop` (nothing truncated), so these are the NATURAL
# lengths the effort levels produce on their own:
#     none   0 / 0        low  2179 / 3587     medium 3058 / 3746     high = xhigh  9717 / 9297
# Effort alone therefore buys THREE distinguishable levels, not five: none, low~=medium, high=xhigh.
# `high` and `xhigh` came back byte-identical at BOTH seeds — same completion_tokens, same thinking,
# same draft-acceptance — exactly as the template source demands. The cap is what re-separates them.
# Determinism note: same prompt + same seed IS reproducible here (that byte-identical pair is the
# proof). An earlier claim in this file that MTP + batching made greedy non-reproducible was WRONG —
# the differences that suggested it came from the budget field varying, not from sampling noise.
#
# Cap sizing is task-dependent and there is NO globally correct number: the same 8192 clips ~15% of
# the thinking on the AIME task above but ~63% on the 22276-token SVG task reported at
# implicator.ai/qwen-3-8-27b-xhigh-reasoning-default. Current values and why:
#     low   2048  -- was 512, which cut 76-86% of low's natural 2179-3587 and shipped a thought
#                    chopped mid-sentence; 2048 sits at the natural floor so it rarely truncates.
#     medium 4096 -- just above the natural 3058-3746, effectively non-binding.
#     high   8192 -- clips the natural ~9500 by ~15%; this mild clip is what distinguishes it from
#                    xhigh, since the two render the SAME prompt.
#     xhigh 32768 -- deliberately free: clears the largest documented Qwen3.8 reasoning run
#                    (22276 tok) with margin, so `xhigh` means "let it think". Costs wall time:
#                    measured 53 tok/s at high effort, so a full 32k budget is ~10 minutes.
# Also measured: long reasoning DEGRADES MTP draft acceptance (93% at low -> 65-68% at high), which
# is why tok/s falls from ~65 to ~52 as effort rises. Deep thinking is expensive twice over.
TEMPLATE_VARIANTS = {
    "none":   {"chat_template_kwargs": {"reasoning_effort": "none"}},
    "low":    {"reasoning_budget_tokens": 2048,
               "chat_template_kwargs": {"reasoning_effort": "low"}},
    "medium": {"reasoning_budget_tokens": 4096,
               "chat_template_kwargs": {"reasoning_effort": "medium"}},
    # alias of xhigh at the prompt level (see line 26-27 note above) — kept as its own rung purely
    # to expose the 8k cap between medium's 4k and xhigh's 16k.
    "high":   {"reasoning_budget_tokens": 8192,
               "chat_template_kwargs": {"reasoning_effort": "high"}},
    "xhigh":  {"reasoning_budget_tokens": 32768,
               "chat_template_kwargs": {"reasoning_effort": "xhigh"}},
    # scratchpad mode: think deeply, then drop the <think> block from history so it stops eating
    # context. Costs the multi-turn prefix-cache hit that preserve_thinking exists to buy.
    # Cap tracks `xhigh` so the name stays honest: same effort, same budget, the ONLY difference is
    # preserve_thinking. Hand-editing this in opencode.json does not survive — sync_opencode()
    # replaces the whole `models` dict on every run, so it has to be set here.
    "xhigh-no-preserve": {"reasoning_budget_tokens": 32768,
                          "chat_template_kwargs": {"reasoning_effort": "xhigh",
                                                   "preserve_thinking": False}},
}
# Muse-Glimmer keeps its EMBEDDED template — the froggeric fix is Qwen-only and swapping it in here
# would be catastrophic, not merely suboptimal: Muse uses a completely different prompt format
# (`<|start|>role<|message|>...<|eot|>` with `<atem:function_calls>` tool blocks), so Qwen's
# `<|im_start|>`/XML-tool template emits tokens this model was never trained on.
# Its effort knob is ALSO differently named. Read verbatim out of the gguf's embedded template:
#     {%- macro render_reasoning() -%}
#       {%- set rs = reasoning_strength if reasoning_strength is defined and reasoning_strength
#                    else 'high' -%}
#       {{- 'Reasoning strength: ' + rs + '.' -}}
#     {%- endmacro -%}
# So the variable is `reasoning_strength` (NOT reasoning_effort), it is rendered as literal SYSTEM
# PROMPT TEXT, and it defaults to 'high'.
# MEASURED via POST /apply-template on the loaded model — what each knob actually renders:
#     (no kwargs)                            -> "Reasoning strength: high."   (default)
#     chat_template_kwargs.reasoning_strength -> "Reasoning strength: low."   WORKS
#     chat_template_kwargs.reasoning_effort   -> "Reasoning strength: high."  IGNORED
#     body-level reasoning_effort             -> "Reasoning strength: high."  IGNORED
# The earlier `reasoningEffort` mapping was therefore DEAD CONFIG on this model — it rendered the
# default every time. Behaviour confirms the fix is real (reasoning_content length, same prompt):
#     low 177 chars | medium 526 | high 1140 | xhigh 1057 | (control) "banana" 517
# i.e. low<medium<high is a genuine trained ladder, xhigh ~= high, and an unrecognised value does
# not error — it just drifts, which is exactly why the name has to be right.
# NO reasoning_budget_tokens here, unlike the Qwen rows — MEASURED to be a no-op on this model.
# llama.cpp enforces the budget by watching for the thinking END TAG, but Glimmer's reasoning is a
# `to=self<|message|> ... <|eom|>` channel rather than a `</think>` tag, so nothing trips the cut:
#     Muse  budget=8      -> 680 and 1263 reasoning chars over two runs (8 tokens is ~30 chars)
#     Muse  budget=32     -> 1135      vs  budget=999999 -> 1378   (no separation)
#     Qwen  budget=16     -> 52 chars  vs  no budget     -> ~1500  (clamps correctly)
# Shipping the key anyway would advertise a knob that silently does nothing.
# ALSO no "none" level: the card lists only low/medium/high/xhigh, and the template has no
# enable_thinking branch, so an unknown value silently renders as-is and the model drifts back
# toward its default behaviour. `low` is the floor.
MUSE_VARIANTS = {
    "low":    {"chat_template_kwargs": {"reasoning_strength": "low"}},
    "medium": {"chat_template_kwargs": {"reasoning_strength": "medium"}},
    "high":   {"chat_template_kwargs": {"reasoning_strength": "high"}},
    "xhigh":  {"chat_template_kwargs": {"reasoning_strength": "xhigh"}},
}


def variants_for(tpl, purposes, ctk=None):
    """Which opencode variant set an entry advertises. A fixed Qwen template supplies the
    reasoning_effort kwarg surface; Muse's embedded template supplies reasoning_strength;
    everything else (Gemma, or a Qwen row left on its embedded template) gets none, because
    advertising a knob the server ignores is worse than advertising nothing.

    A row that PINS a kwarg server-side (`chat_template_kwargs` in models.yaml) advertises NO
    variants for it. Per-request kwargs override the server default, so a pinned-xhigh row that
    still offered a `low` variant would be a row whose name lies about what it runs -- the whole
    point of spending a separate entry on the setting."""
    pinned = set(ctk or ())
    if tpl:
        return None if pinned & {"reasoning_effort"} else TEMPLATE_VARIANTS
    if purposes is MUSEP:
        return None if pinned & {"reasoning_strength"} else MUSE_VARIANTS
    return None


def sync_opencode(entries):
    """entries: [(full_id, per-conversation ctx, variants)]. Returns (added, removed) or None if
    unavailable.

    ctx is the PER-CONVERSATION depth (what a slot actually gets), not the -c total, so an np>1
    model advertises the depth one chat can really use. Under kv_unified those are the same number
    (the pool is shared, and one chat may use all of it); under split KV they are not."""
    if not OPENCODE_CFG.exists():
        return None
    cfg = json.loads(OPENCODE_CFG.read_text())
    prov = cfg.get("provider", {}).get(OPENCODE_PROVIDER)
    if prov is None:
        return None
    before = set(prov.get("models", {}))
    prov["models"] = {
        fid: {"name": fid,
              # `output` is a CEILING SHARED WITH THE INPUT, not an independent allowance: opencode
              # sizes its compaction headroom as context - output, so an output that eats most of the
              # window leaves nothing to put a prompt in. The flat 32768 was safe only while every row
              # was 131072+ ctx; the first small-window row (vllm, ctx 36864) advertised
              # context 36864 / output 32768 = 4096 usable input tokens. Half the window is the
              # neutral split -- it binds ONLY below ctx 65536, so every pre-existing row keeps the
              # exact 32768 it had (verified: 131072/150000/200000 are the only other ctx values).
              "limit": {"context": ctx, "output": min(OPENCODE_MAX_OUTPUT, ctx // 2)},
              **({"variants": variants} if variants else {})}
        for fid, ctx, variants in entries}
    OPENCODE_CFG.write_text(json.dumps(cfg, indent=2) + "\n")
    after = set(prov["models"])
    return sorted(after - before), sorted(before - after)


def main():
    out = ["# GENERATED by generate.py -- edit the table there, not this file.",
           f"healthCheckTimeout: {HEALTHCHECK_TIMEOUT}", "logLevel: info", "startPort: 10001",
           "sendLoadingState: true", "", "macros:",
           f'  "vulkan": "{VULKAN_BIN} --port ${{PORT}}"',
           f'  "rocm": "{ROCM_BIN} --port ${{PORT}}"',
           f'  "hipfire": "{HIPFIRE_BIN} serve 127.0.0.1 ${{PORT}} '
           f'--idle-timeout {HIPFIRE_IDLE_TIMEOUT}"',
           f'  "common": "{COMMON}"', "", "models:"]
    model_ids = []
    ids = []
    for (mid, relpath, ctx, kv, mtp, purposes, backends, np_val, templates, kv_unified,
         draft, spec_p_min, alias, ctk, hipfire_env) in MODELS:
        # parallel slots: prefer model.yaml np, else fallback to legacy PARALLEL dict
        slots = np_val if np_val is not None else PARALLEL.get(mid, 1)
        for tpl in templates:
            for be in backends:
                if be == "hipfire":
                    # Separate engine: its own cmd builder, no ${common}, no env block, and an
                    # explicit cmdStop because `hipfire stop` talks to the daemon's control socket
                    # rather than relying on a signal to the supervised process.
                    fid = full_id(mid, ctx, kv, mtp, be, "", tpl, draft, ctk)
                    nm = (f'{fid}  [hipfire, ctx=engine-config, '
                          f'spec=engine-config, tag={relpath}]')
                    out.append("\n".join([
                        f'  "{fid}":', f'    name: "{nm}"', "    cmd: |",
                        f"      {hipfire_cmd_for(relpath)}",
                        f"    cmdStop: {HIPFIRE_BIN} stop",
                        # llama-swap forwards the request body verbatim, so `model` arrives as the
                        # llama-swap ROW ID. llama.cpp ignores it; hipfire resolves it as a model
                        # name and answers `model not found locally: <row id>`. useModelName
                        # rewrites the field to the tag hipfire actually knows.
                        f"    useModelName: {relpath}",
                    ] + hipfire_env_block(hipfire_env)))
                    out.append("")
                    model_ids.append(fid)
                    ids.append((fid, ctx, None))
                    continue
                if be == "vllm":
                    # Separate engine, run from a docker image: its own cmd builder, no ${common},
                    # and no llama-swap `env:` block -- that would set the DOCKER CLIENT's
                    # environment, which the container never sees (the knobs ride on -e instead).
                    fid = full_id(mid, ctx, kv, mtp, be, "", tpl, draft, ctk)
                    nm = (f'{fid}  [vllm, ctx={ctx}, kv={kv}, mtp={mtp if mtp else "off"}, '
                          f'np={slots}, image={VLLM_IMAGE}]')
                    out.append("\n".join([
                        f'  "{fid}":', f'    name: "{nm}"', "    cmd: |",
                        f"      {vllm_cmd_for(fid, mid, relpath, ctx, mtp, slots, kv)}",
                        # REQUIRED. Without it a container that outlives the row keeps ~28.7 GB of
                        # VRAM and the next model cannot load; `-f` also clears a container left
                        # behind by a crashed boot, which would otherwise make --name collide
                        # forever. `--rm` alone does not cover the crash case. Idempotent:
                        # MEASURED on docker 29.8.0 here, `docker rm -f <missing>` exits 0, so a
                        # clean --rm shutdown does not hand llama-swap a failing cmdStop.
                        f"    cmdStop: docker rm -f {vllm_container(fid)}",
                        # Same reason as hipfire: llama-swap forwards the body verbatim with
                        # `model` set to its own ROW ID, and vLLM 404s on a name it does not
                        # serve. This must equal the --served-model-name above -- which is the
                        # models.yaml `id`, i.e. the short undecorated name a human types.
                        f"    useModelName: {mid}",
                    ]))
                    out.append("")
                    model_ids.append(fid)
                    ids.append((fid, ctx, None))
                    continue
                binref = "${vulkan}" if be == "vulkan" else "${rocm}"
                for fid, tag, sampler in entries_for(mid, ctx, kv, mtp, purposes, be, tpl,
                                                     draft, ctk):
                    # Non-draft rows keep the existing `mtp=on|off` wording verbatim, so adding
                    # drafter support does not churn 20 unrelated display names.
                    nm = f'{fid}  [{be}, kv={kv}, ctx={ctx}, '
                    nm += f'spec={draft["type"]}' if draft else f'mtp={"on" if mtp else "off"}'
                    nm += f', np={slots}{"u" if kv_unified else ""}' if slots > 1 else ''
                    nm += f', tpl={tpl}' if tpl else ''
                    nm += f', {tag}]' if tag else ']'
                    block = [f'  "{fid}":', f'    name: "{nm}"', "    cmd: |",
                             f"      {cmd_for(binref, relpath, ctx, kv, mtp, sampler, slots, tpl, kv_unified, draft, spec_p_min, alias, ctk)}"]
                    if be == "vulkan":
                        # MEASURED 2026-08-27, Qwen3.8 mean decode over 3 real workloads, and
                        # re-sampled properly after a single confirm run disagreed:
                        #   ON  53.0 52.2 53.0 52.3 -> mean 52.6 (range 52.2-53.0)
                        #   OFF 51.3 48.0 48.4      -> mean 49.2 (range 48.0-51.3)
                        # +6.9%, and the worst ON run still beats the best OFF run. It also SHRINKS
                        # the spread 3.3 -> 0.8 tok/s: with only the compute queue the desktop
                        # compositor contends for it. Muse agrees (58.6 -> 60.3).
                        # NOTE: llama.cpp Discussion #21043 reports this flag as "zero effect on
                        # RADV" (they measured it helping AMDVLK MoE only). That does NOT match
                        # what is measured here on master 6fdd0ac -- keep the flag, and re-check it
                        # if a future build regresses. Queue selection only, numerics unchanged.
                        # Scoped to chat-model rows because that is where it was measured; the
                        # reranker/embedder blocks are generated elsewhere and stay untouched.
                        block += ["    env:", '      - "GGML_VK_ALLOW_GRAPHICS_QUEUE=1"']
                    if be == "rocm":
                        block += ["    env:", '      - "HSA_OVERRIDE_GFX_VERSION=12.0.1"']
                    if IDLE_TTL:
                        block.append(f"    ttl: {IDLE_TTL}")
                    out.append("\n".join(block))
                    out.append("")
                    model_ids.append(fid)
                    ids.append((fid, ctx, variants_for(tpl, purposes, ctk)))
    # rerankers
    reranker_ids = [rid for rid, _, _, _, _ in RERANKERS]
    for block in rerank_blocks():
        out.append(block)
        out.append("")
    # embedders
    embedder_ids = [eid for eid, _, _, _, _, _ in EMBEDDERS]
    for block in embed_blocks():
        out.append(block)
        out.append("")
    # groups: embedder, reranker and inference groups, all swap=true, exclusive=false
    out.append("groups:")
    # embedder group — DELIBERATELY NOT a member of reranker-group. Group members swap each other
    # out, and the dense+rerank arm (dp-gnosis lancedb-hybrid --rerank) needs an embedder AND a
    # cross-encoder resident at once; sharing a group would thrash a model reload on every query.
    out.append('  "embedder-group":')
    out.append("    swap: true")
    out.append("    exclusive: false")
    out.append("    members:")
    for eid in embedder_ids:
        out.append(f'      - "{eid}"')
    out.append("")
    # reranker group
    out.append('  "reranker-group":')
    out.append("    swap: true")
    out.append("    exclusive: false")
    out.append("    members:")
    for rid in reranker_ids:
        out.append(f'      - "{rid}"')
    out.append("")
    # inference group
    out.append('  "inference-group":')
    out.append("    swap: true")
    out.append("    exclusive: false")
    out.append("    members:")
    for mid in model_ids:
        out.append(f'      - "{mid}"')
    out.append("")
    (HERE / "config.yaml").write_text("\n".join(out) + "\n")
    print(f"wrote {HERE/'config.yaml'} with {len(ids)} entries ({len(MODELS)} models)"
          f" + {len(RERANKERS)} rerankers + {len(EMBEDDERS)} embedders")

    synced = sync_opencode(ids)
    if synced is None:
        print(f"WARNING: {OPENCODE_CFG} missing or has no '{OPENCODE_PROVIDER}' provider — NOT synced")
        return
    added, removed = synced
    print(f"synced {OPENCODE_CFG} ({len(ids)} models)"
          f"{''.join(chr(10) + '  + ' + i for i in added)}"
          f"{''.join(chr(10) + '  - ' + i for i in removed)}")


if __name__ == "__main__":
    main()
