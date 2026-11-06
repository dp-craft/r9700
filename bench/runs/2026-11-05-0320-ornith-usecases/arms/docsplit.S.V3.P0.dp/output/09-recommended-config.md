## Recommended config

```bash
# Deep-context single-stream, generation-heavy (chat / long answers) — MTP ON:
BACKEND=vulkan CTX=262144 NP=1 KV=f16 MTP=1 UB=2048 B=4096 FA=on PORT=8081 ./serve_llamacpp.sh start

# Deep-context single-stream, read-a-lot / answer-short (RAG, code review) — MTP OFF (avoids the prefill tax):
BACKEND=vulkan CTX=262144 NP=1 KV=f16 MTP=0 UB=2048 B=4096 FA=on PORT=8081 ./serve_llamacpp.sh start

# Never use q8_0 KV at these depths (−40% prefill). f16 fits 262144 on 32 GB.
# Parallel agent fleet with deep prompts: prefer NP=1 + a queue over NP>=2 (concurrency adds TTFT, not throughput).
```

