## External / prior comparison (CLAIMED / prior-MEASURED — kept separate from the rows above)

- Prior 64K campaign (`docs/analysis/2026-07-11-1844-campaign-combo35b.md`, MEASURED): Vulkan+MTP+f16
  ≈ 139 dec @8K / 117 @32K; MTP reverses to −8…−15% at c4; q8_0 KV −29.7% prefill @64K; 4× 8K agents
  ≈ 48 tok/s/stream, TTFT p95 11.3 s. This campaign extends the depth axis to 200K and shows the
  MTP and q8_0 verdicts both **sharpen with depth** (MTP flips to net-loss on short decode; q8_0
  penalty grows to −40%).
- Sweep optimum (`docs/analysis/2026-07-11-1833-sweep-35b-rocm-vs-vulkan.md`, MEASURED): Vulkan
  `-ub 2048`, `-fa on`, KV q8_0 REJECTED — consistent with the KV verdict here.
