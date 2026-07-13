import time, json, os, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
M="/model"; OUT="/out/results.jsonl"
try:
    tok=AutoTokenizer.from_pretrained(M, trust_remote_code=True)
    t0=time.time()
    model=AutoModelForCausalLM.from_pretrained(M, torch_dtype=torch.float16, device_map="cuda", trust_remote_code=True)
    load=time.time()-t0
    ids=tok("def merge_intervals(intervals):", return_tensors="pt").to("cuda")
    model.generate(**ids, max_new_tokens=8)  # warmup
    t1=time.time(); out=model.generate(**ids, max_new_tokens=64, do_sample=False); dt=time.time()-t1
    n=out.shape[1]-ids.input_ids.shape[1]
    rec={"runtime":"transformers-hf","model":os.environ.get("TAG","?"),"format":"AWQ 4-bit",
         "engine":"transformers generate()","load_s":round(load,1),"decode_tok_s":round(n/dt,1),"status":"OK"}
except Exception as e:
    rec={"runtime":"transformers-hf","model":os.environ.get("TAG","?"),"format":"AWQ 4-bit",
         "engine":"transformers generate()","status":"FAIL","error":str(e)[:200]}
print(json.dumps(rec)); open(OUT,"a").write(json.dumps(rec)+"\n")
