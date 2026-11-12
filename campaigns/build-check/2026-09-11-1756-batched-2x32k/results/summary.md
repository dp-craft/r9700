| Backend | Build | Prefill t/s (2 streams, total) | Decode t/s (total) | Decode t/s per stream | Prefill s | Decode s | Request s | Peak VRAM MiB |
|---|---|---|---|---|---|---|---|---|
| vulkan | `b10655-4-g6fdd0ac-vulkan` | 759.9 | 47.8 | 23.9 | 86.2 | 85.7 | 171.9 | 22042 |
| vulkan | `b10909-vulkan` | 877.9 | 48.6 | 24.3 | 74.7 | 84.3 | 159.0 | 22109 |
| rocm | `b10375-rocm` | 704.7 | 36.8 | 18.4 | 93.0 | 111.3 | 204.3 | 21657 |
| rocm | `b10909-rocm` | 962.7 | 38.9 | 19.4 | 68.1 | 105.4 | 173.5 | 21623 |

| Backend | Prefill Δ | Decode Δ | Request prev → new |
|---|---|---|---|
| vulkan | +15.5% | +1.5% | 171.9 s → 159.0 s (-7.5%) |
| rocm | +36.6% | +5.6% | 204.3 s → 173.5 s (-15.1%) |
