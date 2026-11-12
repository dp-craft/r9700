"""Render an agentic tool chain (1 user prompt, 3 tool-call steps) with the 1.8.1 and 1.9.1 templates; show which steps'
reasoning reaches the prompt. Offline (jinja2), no server."""
import sys, json
from jinja2.sandbox import ImmutableSandboxedEnvironment
def raise_exception(m): raise Exception(m)
env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True, extensions=["jinja2.ext.loopcontrols"])
env.globals["raise_exception"] = raise_exception
tools = [{"type": "function", "function": {"name": "Read", "description": "read a file", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}}}}]
def step(i): return {"role": "assistant", "content": "", "reasoning_content": f"REASONING-OF-STEP-{i} " + "x " * 50,
                     "tool_calls": [{"id": f"c{i}", "type": "function", "function": {"name": "Read", "arguments": {"file_path": f"f{i}.ts"}}}]}
def res(i): return {"role": "tool", "tool_call_id": f"c{i}", "content": f"contents of f{i}.ts"}
chain = [{"role": "user", "content": "Run the RUNBOOK for W2-08."}, step(1), res(1), step(2), res(2), step(3), res(3)]
for name, path in [("1.8.1 (v22.5)", sys.argv[1]), ("1.9.1 (v22.5-sly2)", sys.argv[2]), ("model stock", sys.argv[3])]:
    t = env.from_string(open(path).read())
    for kw in ({}, {"preserve_thinking": True}):
        p = t.render(messages=chain, tools=tools, add_generation_prompt=True, enable_thinking=True, **kw)
        kept = [i for i in (1, 2, 3) if f"REASONING-OF-STEP-{i}" in p]
        print(f"{name:20} kwargs={json.dumps(kw):27} reasoning in prompt for steps {kept}; empty think blocks: {p.count('<think>' + chr(10) + chr(10) + '</think>')}; prompt chars {len(p)}")
