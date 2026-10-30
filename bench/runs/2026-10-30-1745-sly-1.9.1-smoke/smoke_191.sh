#!/usr/bin/env bash
# Smoke test of Sly 1.9.1 on the RedHat DFlash2 profile, with the dp-forge vllm.sh arguments, WITHOUT changing any config
# (IMAGE= override). Checks: boot + VRAM, template version and Cactus env in the image, the template's reasoning replay
# (older vs newest assistant turn), one real generation + acceptance. Always stops the server and verifies the GPU is free.
set -u
REPO=/home/dev/work/dp-craft/amd
OUT=${OUT:?OUT dir}; mkdir -p "$OUT"
export IMAGE=ghcr.io/slybase/vllm-sly-radiance:1.9.1-rocm10.1 PROFILE=sly-redhat/redhat-mxfp4-dflash PORT=8000
SERVE=$REPO/bench/engine-bench/vllm/serve_vllm.sh
MODEL=qwen38-27b-redhat-mxfp4-dflash
used() { rocm-smi --showmeminfo vram 2>/dev/null | grep -oP 'Used Memory \(B\): \K\d+' | awk '{printf "%d", $1/1048576}'; }

stop() {
  PORT=8000 "$SERVE" stop >"$OUT/stop.txt" 2>&1
  for _ in $(seq 30); do ss -ltn | grep -q ':8000 ' || break; sleep 1; done
  echo "after stop: port 8000 $(ss -ltn | grep -q ':8000 ' && echo BUSY || echo free), VRAM used $(used) MiB" | tee -a "$OUT/summary.txt"
}
trap stop EXIT

echo "before: VRAM used $(used) MiB" | tee "$OUT/summary.txt"
"$SERVE" print >"$OUT/print.txt" 2>&1
MAXLEN=262000 MAXSEQS=1 KV_DTYPE=fp8 WATCHDOG_MIB=32 GPU_UTIL=0.93 "$SERVE" start >"$OUT/start.txt" 2>&1
rc=$?; echo "start rc=$rc, VRAM used $(used) MiB" | tee -a "$OUT/summary.txt"
cp "$REPO/bench/.servers/8000.cmdline" "$OUT/server.cmdline" 2>/dev/null
[ $rc = 0 ] || { tail -40 "$OUT/start.txt"; exit 1; }

docker exec vllm-8000 head -1 /opt/qwen-fixed.jinja | tee -a "$OUT/summary.txt"
docker exec vllm-8000 sh -c 'env | grep -E "^RADIANCE_" | sort' | tee -a "$OUT/summary.txt"
docker exec vllm-8000 sh -c 'python3 -c "import vllm; print(\"vllm\", vllm.__version__)"' 2>/dev/null | tee -a "$OUT/summary.txt"

python3 - "$OUT" "$MODEL" <<'EOF' | tee -a "$OUT/summary.txt"
import json, sys, time, urllib.request
out, model = sys.argv[1], sys.argv[2]
def call(messages, max_tokens=16):
    body = {"model": model, "max_tokens": max_tokens, "messages": messages}
    r = urllib.request.Request("http://127.0.0.1:8000/v1/messages", json.dumps(body).encode(),
                               {"content-type": "application/json", "x-api-key": "local", "anthropic-version": "2023-06-01"})
    t = time.time(); d = json.load(urllib.request.urlopen(r, timeout=900)); return d, time.time() - t
long = " ".join(f"step {i}: consider the parser state and check the edge case number {i}." for i in range(150))
def conv(old_th, new_th):
    a = lambda th, tx: {"role": "assistant", "content": [{"type": "thinking", "thinking": th, "signature": "x"}, {"type": "text", "text": tx}]}
    return [{"role": "user", "content": "Name one prime number."}, a(old_th, "7"),
            {"role": "user", "content": "Name another one."}, a(new_th, "11"),
            {"role": "user", "content": "And one more?"}]
res = {}
for k, (o, n) in {"base": ("short", "short"), "older_long": (long, "short"), "newest_long": ("short", long)}.items():
    d, s = call(conv(o, n)); res[k] = d["usage"]["input_tokens"]
print("replay test input_tokens:", res)
print("  older turn's reasoning replayed:", res["older_long"] != res["base"], "| newest turn's reasoning replayed:", res["newest_long"] != res["base"])
d, s = call([{"role": "user", "content": "Write a TypeScript function that returns the n-th Fibonacci number iteratively, with a one-line test."}], 3000)
txt = "".join(c.get("text", "") for c in d["content"] if c["type"] == "text"); th = "".join(c.get("thinking", "") for c in d["content"] if c["type"] == "thinking")
print(f"generation: {s:.1f}s, stop={d.get('stop_reason')}, out_tokens={d['usage']['output_tokens']}, thinking {len(th)} chars, text {len(txt)} chars, ~{d['usage']['output_tokens']/s:.1f} tok/s end-to-end")
json.dump({"replay": res, "gen": d}, open(f"{out}/requests.json", "w"), indent=1)
EOF
sleep 11
docker logs vllm-8000 2>&1 | grep -E 'Mean acceptance length|Avg generation throughput' | tail -4 | cut -c1-200 | tee -a "$OUT/summary.txt"
docker logs vllm-8000 >"$OUT/server-container.log" 2>&1
