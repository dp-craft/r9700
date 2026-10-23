llama-swap /unload -> HTTP 200
GPU exclusive: 32316 MiB free (used 308 MiB), floor 30000 MiB.
starting vllm-8000 on 127.0.0.1:8000 (sly-radiance/_ct_ptrlog-1, ghcr.io/slybase/vllm-sly-radiance:1.6.0-rocm10.1) — first boot compiles, up to 1200s
container DIED during startup — last log lines (/home/dev/work/dp-craft/amd/bench/.servers/8000.log):
           ^^^^^^^^^^^^^^
  File "/opt/vllm/lib/python3.12/site-packages/vllm/tracing/otel.py", line 175, in sync_wrapper
    return func(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^
  File "/opt/vllm/lib/python3.12/site-packages/vllm/v1/engine/core_client.py", line 1100, in __init__
    super().__init__(
  File "/opt/vllm/lib/python3.12/site-packages/vllm/v1/engine/core_client.py", line 674, in __init__
    with launch_core_engines(
  File "/usr/lib/python3.12/contextlib.py", line 144, in __exit__
    next(self.gen)
  File "/opt/vllm/lib/python3.12/site-packages/vllm/v1/engine/utils.py", line 1268, in launch_core_engines
    wait_for_engine_startup(
  File "/opt/vllm/lib/python3.12/site-packages/vllm/v1/engine/utils.py", line 1348, in wait_for_engine_startup
    raise RuntimeError(
RuntimeError: Engine core initialization failed. See root cause above. Failed core proc(s): {}
