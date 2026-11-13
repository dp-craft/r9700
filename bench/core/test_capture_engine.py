#!/usr/bin/env python3
"""Unit tests for capture_engine.stream() — canned loopback SSE server (stdlib http,
127.0.0.1:0, no GPU, no network).

Added after the 2026-11-10 short run: 2 of 4 d-arm reps died with the un-diagnosable
`"no tokens received"` and the server's actual reply was discarded. The error must carry
the raw SSE tail so the next live occurrence is readable from results.jsonl alone.
Run: python3 bench/core/test_capture_engine.py
"""
import http.server
import json
import os
import sys
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capture_engine as C  # noqa: E402


def sse(*payloads):
    """SSE body from raw data payloads (str or pre-encoded dict)."""
    out = b""
    for p in payloads:
        data = p if isinstance(p, str) else json.dumps(p)
        out += f"data: {data}\n\n".encode()
    return out + b"data: [DONE]\n\n"


class TestStream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(http.server.BaseHTTPRequestHandler):
            body = b""

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(self.body)))
                self.end_headers()
                self.wfile.write(self.body)

            def log_message(self, *a):
                pass

        cls.Handler = Handler
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _stream(self, body, api="completions"):
        self.Handler.body = body
        return C.stream(self.base, api, {"_prompt": "x", "max_tokens": 8}, timeout=30)

    def test_normal_chunks_regression(self):
        s = self._stream(sse(
            {"id": "c", "choices": [{"index": 0, "text": "he", "finish_reason": None}], "usage": None},
            {"id": "c", "choices": [{"index": 0, "text": "llo", "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
        ))
        self.assertNotIn("error", s)
        self.assertEqual(s["content"], "hello")
        self.assertEqual(s["finish"], "stop")
        self.assertIsNotNone(s["ttft"])
        self.assertEqual(s["usage"]["completion_tokens"], 2)

    def test_error_event_carried_in_error(self):
        # vLLM-style error event mid-stream: no choices, an error object.
        s = self._stream(sse({"error": {"message": "boom: KV cache full", "type": "server_error"}}))
        self.assertIn("no tokens received", s["error"])
        self.assertIn("boom: KV cache full", s["error"])

    def test_empty_stream_says_empty(self):
        s = self._stream(sse())
        self.assertIn("no tokens received", s["error"])
        self.assertIn("empty", s["error"])

    def test_malformed_payload_carried(self):
        s = self._stream(sse("not-json-garbage <html>500</html>"))
        self.assertIn("no tokens received", s["error"])
        self.assertIn("not-json-garbage", s["error"])

    def test_error_bounded(self):
        junk = "x" * 100_000
        s = self._stream(sse(junk))
        self.assertIn("no tokens received", s["error"])
        self.assertLess(len(s["error"]), 1000)

    def test_chat_api_normal_chunks(self):
        s = self._stream(sse(
            {"id": "c", "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": None}]},
            {"id": "c", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 1, "completion_tokens": 1}},
        ), api="chat")
        self.assertNotIn("error", s)
        self.assertEqual(s["content"], "hi")


# ------------------------------------------------------------------ G2a–G2f (27B-arms speed campaign)
import contextlib  # noqa: E402
import io  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402


def chat_sse(text="ok", prompt_tokens=100, completion_tokens=10, timings=None, cached=None,
             finish="stop"):
    """A minimal chat SSE body: one content chunk, then a finish chunk carrying usage (+timings)."""
    usage = {"completion_tokens": completion_tokens}
    if prompt_tokens is not None:
        usage["prompt_tokens"] = prompt_tokens
    if cached is not None:
        usage["prompt_tokens_details"] = {"cached_tokens": cached}
    last = {"id": "c", "choices": [{"index": 0, "delta": {}, "finish_reason": finish}], "usage": usage}
    if timings is not None:
        last["timings"] = timings
    return sse({"id": "c", "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}]},
               last)


class FakeServer:
    """Loopback OpenAI-ish server: `responder(n, body)` builds the SSE reply for the n-th POST to a
    completions path (0-based); every request body is recorded. Other paths (/tokenize) get a 404,
    GET (/metrics) is unsupported, so capture_engine's fallbacks are exercised."""

    def __init__(self):
        fs = self
        self.bodies, self.responder = [], lambda n, body: chat_sse()
        self.delay = 0.0      # > 0: sleep before the first SSE event AND before the rest (wall windows)
        self.lock = threading.Lock()

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                if not self.path.endswith("completions"):
                    self.send_response(404); self.end_headers(); return
                with fs.lock:
                    n = len(fs.bodies); fs.bodies.append(body)
                out = fs.responder(n, body)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                cut = out.find(b"\n\n") + 2
                for part in (out[:cut], out[cut:]):
                    time.sleep(fs.delay)
                    self.wfile.write(part); self.wfile.flush()

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05},
                         daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def close(self):
        self.server.shutdown(); self.server.server_close()


def run_cli(argv):
    """main() with argv → (rows, exit code). argparse errors exit 2 with nothing on stdout."""
    out, err = io.StringIO(), io.StringIO()
    code = 0
    old = sys.argv
    sys.argv = ["capture_engine.py"] + argv
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            C.main()
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        sys.argv = old
    rows = [json.loads(l) for l in out.getvalue().splitlines() if l.startswith("{")]
    return rows, code


class _ServerCase(unittest.TestCase):
    def setUp(self):
        self.fs = FakeServer()
        self.tmp = tempfile.TemporaryDirectory()
        self.prompt = os.path.join(self.tmp.name, "p.txt")
        with open(self.prompt, "w") as fh:
            fh.write("review this code please\n" * 5)

    def tearDown(self):
        self.fs.close(); self.tmp.cleanup()

    def probe(self, *extra, reps=1, conc=1):
        return run_cli(["probe", "--url", self.fs.base, "--prompt-file", self.prompt, "--api", "chat",
                        "--max-tokens", "32", "--warmup", "0", "--reps", str(reps),
                        "--concurrency", str(conc), "--label", "L", "--engine", "E", *extra])

    @staticmethod
    def kinds(rows, kind):
        return [r for r in rows if r.get("kind") == kind]


class TestSamplingG2a(_ServerCase):
    def test_default_payload_unchanged(self):
        rows, code = self.probe()
        self.assertEqual(code, 0)
        b = self.fs.bodies[0]
        self.assertEqual(b["temperature"], 0.2)
        for k in ("top_p", "top_k", "min_p", "seed", "presence_penalty", "chat_template_kwargs"):
            self.assertNotIn(k, b)
        self.assertNotIn("seed", self.kinds(rows, "request")[0])

    def test_sampling_passthrough_and_seed_per_rep(self):
        smp = {"temperature": 1.0, "top_p": 0.95, "top_k": 20, "min_p": 0, "presence_penalty": 0,
               "frequency_penalty": 0, "repeat_penalty": 1.0, "repetition_penalty": 1.0, "seed": 7}
        rows, code = self.probe("--sampling", json.dumps(smp), reps=3)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.fs.bodies), 3)
        for rep, b in enumerate(self.fs.bodies):
            for k, v in smp.items():
                self.assertEqual(b[k], v + rep if k == "seed" else v, k)   # --sampling wins over --temperature
        self.assertEqual([r["seed"] for r in self.kinds(rows, "request")], [7, 8, 9])
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual(agg["sampling"]["top_k"], 20)
        self.assertEqual(agg["sampling"]["temperature"], 1.0)

    def test_chat_template_kwargs_sent(self):
        rows, code = self.probe("--chat-template-kwargs", '{"enable_thinking": true}')
        self.assertEqual(code, 0)
        self.assertEqual(self.fs.bodies[0]["chat_template_kwargs"], {"enable_thinking": True})
        self.assertEqual(self.kinds(rows, "aggregate")[0]["chat_template_kwargs"], {"enable_thinking": True})

    def test_bad_sampling_rejected(self):
        for bad in ("not json", "[1, 2]", '{"model": "x"}', '{"max_tokens": 5}', '{"seed": "a"}',
                    '{"seed": 1.5}', '{"chat_template_kwargs": {}}',
                    # issue 3: allow-list, not deny-list (n=2 would interleave two choices into one text)
                    '{"max_completion_tokens": 5}', '{"n": 2}', '{"logprobs": true}', '{"stop": ["x"]}',
                    # issue 4: numeric types
                    '{"temperature": "0.5"}', '{"top_p": true}', '{"top_k": 20.5}', '{"min_p": null}',
                    '{"presence_penalty": [0]}', '{"seed": true}'):
            rows, code = self.probe("--sampling", bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual(rows, [], bad)
            self.assertEqual(self.fs.bodies, [], bad)

    def test_bad_chat_template_kwargs_rejected(self):
        for bad in ("{oops", '"str"'):
            _, code = self.probe("--chat-template-kwargs", bad)
            self.assertEqual(code, 2, bad)
        # completions has no chat template: refuse instead of silently ignoring it
        _, code = run_cli(["probe", "--url", self.fs.base, "--prompt-file", self.prompt, "--warmup", "0",
                           "--chat-template-kwargs", '{"enable_thinking": true}'])
        self.assertEqual(code, 2)
        self.assertEqual(self.fs.bodies, [])


class TestWallRatesG2b(unittest.TestCase):
    @staticmethod
    def m(s):
        return {**C._request_metrics(s), **C._rate_cols(s)}

    def s(self, **kw):
        base = {"content": "x", "reasoning": "", "ttft": 2.0, "ttfa": None, "total_s": 12.0,
                "usage": {"prompt_tokens": 8000, "completion_tokens": 201}, "timings": {}, "finish": "stop",
                "saw_reasoning": False, "chunk_tokens": 50}
        base.update(kw)
        return base

    def test_wall_always_and_server_kept(self):
        m = self.m(self.s(timings={"prompt_per_second": 5000.0, "predicted_per_second": 25.0}))
        self.assertEqual(m["prefill_tok_s"], 5000.0)          # server preferred, unchanged
        self.assertEqual(m["decode_tok_s"], 25.0)
        self.assertEqual(m["prefill_tok_s_server"], 5000.0)
        self.assertEqual(m["decode_tok_s_server"], 25.0)
        self.assertEqual(m["prefill_tok_s_wall"], 4000.0)     # 8000 / 2.0
        self.assertEqual(m["decode_tok_s_wall"], 20.0)        # (201-1) / (12-2)

    def test_no_timings_falls_back_to_wall(self):
        m = self.m(self.s())
        self.assertEqual(m["prefill_tok_s"], 4000.0)
        self.assertEqual(m["decode_tok_s"], 20.0)
        self.assertIsNone(m["prefill_tok_s_server"])
        self.assertIsNone(m["decode_tok_s_server"])
        self.assertEqual(m["decode_tok_s_wall"], 20.0)

    def test_single_token_and_missing_prompt_tokens(self):
        m = self.m(self.s(usage={"completion_tokens": 1}))
        self.assertIsNone(m["decode_tok_s_wall"])
        self.assertIsNone(m["prefill_tok_s_wall"])
        self.assertIsNone(m["decode_tok_s"])


class TestAggregateG2b(_ServerCase):
    def test_p50_min_max(self):
        decs = [30.0, 10.0, 20.0]
        self.fs.delay = 0.06
        self.fs.responder = lambda n, b: chat_sse(timings={"prompt_per_second": 1000.0 * (n + 1),
                                                           "predicted_per_second": decs[n]})
        rows, code = self.probe(reps=3)
        self.assertEqual(code, 0)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual(agg["decode_tok_s_per_stream_p50"], 20.0)
        self.assertEqual(agg["decode_tok_s_per_stream_min"], 10.0)
        self.assertEqual(agg["decode_tok_s_per_stream_max"], 30.0)
        self.assertEqual(agg["prefill_tok_s_min"], 1000.0)
        self.assertEqual(agg["prefill_tok_s_max"], 3000.0)
        for k in ("prefill_tok_s_wall", "decode_tok_s_wall"):
            vals = [r[k] for r in self.kinds(rows, "request")]
            self.assertEqual(agg[k + "_min"], min(vals))
            self.assertEqual(agg[k + "_max"], max(vals))
            self.assertEqual(agg[k + "_p50"], sorted(vals)[1])

    def test_default_aggregate_keeps_old_keys(self):
        rows, code = self.probe()
        agg = self.kinds(rows, "aggregate")[0]
        old = ["kind", "label", "engine", "model", "url", "concurrency", "reps", "api", "prefix_mode",
               "max_tokens", "prompt_files", "prompt_tokens", "n_ok", "n_err", "ttft_s_p50", "ttft_s_p95",
               "decode_tok_s_per_stream_p50", "prefill_tok_s_p50", "aggregate_tok_s", "ttfa_s_p50",
               "think_tokens_p50", "tok_count_source"]
        self.assertEqual(list(agg)[:len(old)], old)           # old keys first, in the old order
        self.assertEqual(agg["n_short"], 0)
        self.assertEqual(agg["min_gen"], 0)


class TestMinGenG2c(_ServerCase):
    def test_short_row_excluded_and_counted(self):
        gens = [900, 12, 950]
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=gens[n],
                                                  timings={"predicted_per_second": 10.0 + n})
        rows, code = self.probe("--min-gen", "900", reps=3)
        self.assertNotEqual(code, 0)                          # n_ok 2 < reps 3
        req = self.kinds(rows, "request")
        self.assertEqual([r["short"] for r in req], [False, True, False])
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual((agg["n_ok"], agg["n_short"], agg["n_err"]), (2, 1, 0))
        self.assertEqual(agg["min_gen"], 900)
        self.assertEqual(agg["decode_tok_s_per_stream_min"], 10.0)   # the short row (11.0) is not in it
        self.assertEqual(agg["decode_tok_s_per_stream_max"], 12.0)

    def test_all_short_nonzero(self):
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=1)
        rows, code = self.probe("--min-gen", "5", reps=2)
        self.assertNotEqual(code, 0)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertIn("error", agg)
        self.assertEqual(agg["n_short"], 2)
        self.assertEqual(agg["n_err"], 0)

    def test_all_pass_exit_zero(self):
        rows, code = self.probe("--min-gen", "10", reps=2)   # chat_sse default: 10 tokens == N passes
        self.assertEqual(code, 0)
        self.assertEqual([r["short"] for r in self.kinds(rows, "request")], [False, False])

    def test_concurrency_counts_every_stream(self):
        gens = {0: 50, 1: 3}
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=gens[n])
        rows, code = self.probe("--min-gen", "10", reps=1, conc=2)
        self.assertNotEqual(code, 0)                          # n_ok 1 < reps*concurrency 2
        self.assertEqual(self.kinds(rows, "aggregate")[0]["n_short"], 1)

    def test_errors_plus_min_gen_nonzero(self):
        self.fs.responder = lambda n, b: chat_sse() if n == 0 else sse()   # rep 1: no tokens
        rows, code = self.probe("--min-gen", "1", reps=2)
        self.assertNotEqual(code, 0)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual((agg["n_ok"], agg["n_err"], agg["n_short"]), (1, 1, 0))

    def test_default_no_short_key_and_exit_unchanged(self):
        self.fs.responder = lambda n, b: chat_sse() if n == 0 else sse()   # 1 of 2 errors, no gate
        rows, code = self.probe(reps=2)
        self.assertEqual(code, 0)                             # today's behaviour: partial = exit 0
        self.assertNotIn("short", self.kinds(rows, "request")[0])

    def test_negative_min_gen_rejected(self):
        _, code = self.probe("--min-gen", "-1")
        self.assertEqual(code, 2)


class TestDraftG2d(_ServerCase):
    def test_draft_fields_copied_and_summed(self):
        self.fs.responder = lambda n, b: chat_sse(timings={"predicted_per_second": 20.0,
                                                           "draft_n": 30 + n, "draft_n_accepted": 10 + n})
        rows, code = self.probe(reps=2)
        req = self.kinds(rows, "request")
        self.assertEqual([(r["draft_n"], r["draft_n_accepted"]) for r in req], [(30, 10), (31, 11)])
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual((agg["draft_n_sum"], agg["draft_n_accepted_sum"]), (61, 21))

    def test_timings_missing_draft_fields(self):
        self.fs.responder = lambda n, b: chat_sse(timings={"predicted_per_second": 20.0})
        rows, _ = self.probe(reps=2)
        r = self.kinds(rows, "request")[0]
        self.assertIsNone(r["draft_n"]); self.assertIsNone(r["draft_n_accepted"])
        agg = self.kinds(rows, "aggregate")[0]
        self.assertIsNone(agg["draft_n_sum"]); self.assertIsNone(agg["draft_n_accepted_sum"])

    def test_mixed_rows_sum_present_only(self):
        self.fs.responder = lambda n, b: chat_sse(
            timings={"draft_n": 8, "draft_n_accepted": 4} if n == 0 else None)
        rows, _ = self.probe(reps=2)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual((agg["draft_n_sum"], agg["draft_n_accepted_sum"]), (8, 4))

    def test_short_rows_not_summed(self):
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=[50, 2][n],
                                                  timings={"draft_n": 10, "draft_n_accepted": 5})
        rows, _ = self.probe("--min-gen", "10", reps=2)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertEqual((agg["draft_n_sum"], agg["draft_n_accepted_sum"]), (10, 5))


class TestTagsG2e(_ServerCase):
    def test_tags_on_request_and_aggregate(self):
        rows, code = self.probe("--tag", "arm=d", "--tag", "depth=32000", "--tag", "pass=A", "--tag", "n=2",
                                "--tag", "tg= 1024 ", reps=2)
        self.assertEqual(code, 0)
        self.assertEqual(len(rows), 3)
        for r in rows:
            self.assertEqual((r["arm"], r["depth"], r["pass"], r["n"], r["tg"]), ("d", 32000, "A", 2, 1024))

    def test_only_depth_n_tg_become_int(self):   # issue 6: G4 keys series by the string arm
        rows, _ = self.probe("--tag", "arm=2", "--tag", "pass=01", "--tag", "tier= minimal ")
        self.assertEqual((rows[0]["arm"], rows[0]["pass"], rows[0]["tier"]), ("2", "01", "minimal"))

    def test_aggregate_only_columns_rejected(self):   # issue 2: derived from what is emitted
        for k in ("ttft_s_p50", "aggregate_tok_s", "decode_tok_s_wall_p50", "prefill_tok_s_min", "draft_n_sum",
                  "complete", "think_tokens_p50", "delta_tokens", "conversations", "n_short", "total_s"):
            rows, code = self.probe("--tag", f"{k}=9")
            self.assertEqual(code, 2, k)
            self.assertEqual(rows, [], k)
        self.assertEqual(self.fs.bodies, [])

    def test_reserved_covers_every_emitted_key(self):   # issue 2: nothing emitted is missing from it
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=[50, 2][n % 2], timings={"draft_n": 2,
                                                  "draft_n_accepted": 1, "predicted_per_second": 9.0})
        rows, _ = self.probe("--min-gen", "10", "--sampling", '{"seed": 1}', "--chat-template-kwargs", "{}",
                             reps=2)
        self.fs.responder = lambda n, b: sse()
        rows += self.probe()[0]                                       # error request + error aggregate
        emitted = {k for r in rows for k in r}
        self.assertTrue(emitted <= C._reserved_keys(), emitted - C._reserved_keys())

    def test_tagged_raises_on_collision(self):
        import argparse
        with self.assertRaises(ValueError):
            C._tagged({"label": "x"}, argparse.Namespace(tags={"label": "y"}))

    def test_tags_on_error_aggregate(self):
        self.fs.responder = lambda n, b: sse()
        rows, code = self.probe("--tag", "arm=q8")
        self.assertEqual(code, 2)
        self.assertTrue(all(r["arm"] == "q8" for r in rows))

    def test_value_with_equals_and_text(self):
        rows, _ = self.probe("--tag", "workload=a=b", "--tag", "arm= d ")
        self.assertEqual(rows[0]["workload"], "a=b")
        self.assertEqual(rows[0]["arm"], "d")

    def test_malformed_tags_rejected(self):
        for bad in (["--tag", "arm"], ["--tag", "=d"], ["--tag", "arm="], ["--tag", " =x"],
                    ["--tag", "arm=d", "--tag", "arm=e"], ["--tag", "label=x"], ["--tag", "kind=x"],
                    ["--tag", "decode_tok_s=1"], ["--tag", "n_ok=1"], ["--tag", "arm=  "],
                    ["--tag", "depth=32k"], ["--tag", "n=two"], ["--tag", "tg=1.5"]):
            rows, code = self.probe(*bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual(rows, [], bad)
            self.assertEqual(self.fs.bodies, [], bad)


class TestConversationG2f(_ServerCase):
    def setUp(self):
        super().setUp()
        with open(self.prompt, "w") as fh:
            fh.write("word " * 300)          # /tokenize 404s -> word-count fallback, ~4 turns at 100/100

    def conv(self, *extra):
        return run_cli(["conversation", "--url", self.fs.base, "--prompt-file", self.prompt,
                        "--start-tokens", "100", "--step-tokens", "100", "--max-depth", "1000000",
                        "--max-tokens", "16", "--label", "C", "--engine", "E", *extra])

    def test_delta_without_cached_tokens(self):
        self.fs.responder = lambda n, b: chat_sse(prompt_tokens=100 + 160 * n)
        rows, code = self.conv()
        self.assertEqual(code, 0)
        turns = self.kinds(rows, "turn")
        self.assertGreaterEqual(len(turns), 3)
        self.assertEqual([t["delta_tokens"] for t in turns][:3], [100, 160, 160])   # turn 0: nothing before
        for t in turns:
            self.assertIsNone(t["cached_tokens"]); self.assertIsNone(t["prefill_new_tok_s"])
            self.assertEqual(t["prefill_delta_tok_s"], round(t["delta_tokens"] / t["ttft_s"], 1))
            self.assertNotIn("prefill_tok_s", t)
            self.assertNotIn("prefill_tok_s_wall", t)          # ctx/ttft counts cached tokens
            self.assertIn("decode_tok_s_wall", t)

    def test_previous_ctx_unknown(self):
        self.fs.responder = lambda n, b: chat_sse(prompt_tokens=None if n == 0 else 100 + 160 * n)
        rows, code = self.conv()
        self.assertEqual(code, 0)
        turns = self.kinds(rows, "turn")
        self.assertIsNone(turns[0]["delta_tokens"]); self.assertIsNone(turns[0]["prefill_delta_tok_s"])
        self.assertIsNone(turns[1]["delta_tokens"]); self.assertIsNone(turns[1]["prefill_delta_tok_s"])
        self.assertEqual(turns[2]["delta_tokens"], 160)

    def test_with_cached_tokens_both_present(self):
        self.fs.responder = lambda n, b: chat_sse(prompt_tokens=100 + 160 * n, cached=0 if n == 0 else 90)
        rows, code = self.conv()
        self.assertEqual(code, 0)
        t1 = self.kinds(rows, "turn")[1]
        self.assertEqual(t1["new_tokens"], 170)
        self.assertEqual(t1["delta_tokens"], 160)
        self.assertIsNotNone(t1["prefill_new_tok_s"]); self.assertIsNotNone(t1["prefill_delta_tok_s"])

    def test_tags_and_sampling_in_conversation(self):
        rows, code = self.conv("--tag", "arm=d", "--sampling", '{"top_k": 20, "seed": 3}', "--reps", "2")
        self.assertEqual(code, 0)
        self.assertTrue(rows)
        self.assertTrue(all(r["arm"] == "d" for r in rows))   # turns + conversation_summary
        self.assertEqual({b["top_k"] for b in self.fs.bodies}, {20})
        self.assertEqual(sorted({b["seed"] for b in self.fs.bodies}), [3, 4])   # seed + rep
        self.assertEqual(self.kinds(rows, "conversation_summary")[0]["sampling"]["top_k"], 20)

    def test_conversation_rejects_bad_tag(self):
        _, code = self.conv("--tag", "turn=1")
        self.assertEqual(code, 2)
        self.assertEqual(self.fs.bodies, [])



class TestFixRound1(_ServerCase):
    def test_wall_p50_is_true_median_for_even_n(self):   # issue 5
        decs = [10.0, 20.0]
        self.fs.delay = 0.06
        self.fs.responder = lambda n, b: chat_sse(timings={"predicted_per_second": decs[n]})
        rows, _ = self.probe(reps=2)
        agg = self.kinds(rows, "aggregate")[0]
        walls = sorted(r["decode_tok_s_wall"] for r in self.kinds(rows, "request"))
        self.assertEqual(agg["decode_tok_s_wall_p50"], (walls[0] + walls[1]) / 2)
        self.assertEqual(agg["decode_tok_s_per_stream_p50"], C._pct(decs, 50))   # old field: unchanged rule

    def test_median_vs_nearest_rank(self):
        for vals, med, pct in (([1, 2], 1.5, 1), ([1, 2, 3, 4], 2.5, 3), ([None, 4, 2], 3, 2), ([None], None, None)):
            self.assertEqual(C._median(vals), med)
            self.assertEqual(C._pct(vals, 50), pct)

    def test_partial_wave_with_gate_is_incomplete(self):   # issue 1
        gens = [50, 50, 50, 3, 50, 50]                       # rep 1, stream 1 short
        self.fs.responder = lambda n, b: chat_sse(completion_tokens=gens[n])
        rows, code = self.probe("--min-gen", "10", reps=3, conc=2)
        self.assertEqual(code, 3)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertIs(agg["complete"], False)
        self.assertIsNone(agg["aggregate_tok_s"])
        self.assertNotIn("error", agg)

    def test_full_waves_with_gate_are_complete(self):
        rows, code = self.probe("--min-gen", "10", reps=2, conc=2)
        self.assertEqual(code, 0)
        agg = self.kinds(rows, "aggregate")[0]
        self.assertIs(agg["complete"], True)
        self.assertIsNotNone(agg["aggregate_tok_s"])

    def test_no_gate_no_complete_key(self):
        rows, _ = self.probe(reps=2)
        self.assertNotIn("complete", self.kinds(rows, "aggregate")[0])


class TestMinWindowIssue7(unittest.TestCase):
    def s(self, ttft, total, timings=None):
        return {"content": "x", "reasoning": "", "ttft": ttft, "ttfa": None, "total_s": total,
                "usage": {"prompt_tokens": 8000, "completion_tokens": 50}, "timings": timings or {},
                "finish": "stop", "saw_reasoning": False, "chunk_tokens": 50}

    def test_tiny_windows_null(self):
        m = {**C._request_metrics(self.s(0.01, 0.011)), **C._rate_cols(self.s(0.01, 0.011))}
        self.assertIsNone(m["decode_tok_s_wall"]); self.assertIsNone(m["prefill_tok_s_wall"])
        # the pre-existing fallback values are not floored (no-flag output unchanged)
        self.assertEqual(m["decode_tok_s"], round(49 / (0.011 - 0.01), 2))
        self.assertEqual(m["prefill_tok_s"], 800000.0)

    def test_window_at_floor_counts(self):
        w = C.MIN_RATE_WINDOW_S
        m = C._rate_cols(self.s(w, 2 * w))
        self.assertEqual(m["prefill_tok_s_wall"], round(8000 / w, 1))
        self.assertEqual(m["decode_tok_s_wall"], round(49 / w, 2))


# ------------------------------------------------------------------ golden: no-flag output (issue 9)
class FakeClock:
    """perf_counter advances 1.0 per call; time() is fixed, so waves and wall_* are exact."""
    def __init__(self):
        self.t = 100.0

    def perf_counter(self):
        self.t += 1.0
        return self.t

    def time(self):
        return 1800000000.0


def _S(ttft, total, usage, timings=None, content="answer", reasoning="", finish="stop", chunks=5):
    return {"content": content, "reasoning": reasoning, "ttft": ttft, "ttfa": ttft + 0.1 if content else None,
            "total_s": total, "usage": usage, "timings": timings or {}, "finish": finish,
            "saw_reasoning": bool(reasoning), "chunk_tokens": chunks}


PROBE_RESULTS = [  # warm-up, then 3 reps: llama.cpp timings / vLLM (wall only) / reasoning + timings
    _S(0.5, 1.0, {"prompt_tokens": 8000, "completion_tokens": 16}),
    _S(2.0, 12.0, {"prompt_tokens": 8000, "completion_tokens": 201},
       {"prompt_per_second": 5000.0, "predicted_per_second": 25.0, "draft_n": 30, "draft_n_accepted": 10}),
    _S(1.6, 9.6, {"prompt_tokens": 8000, "completion_tokens": 161}),
    _S(2.5, 15.0, {"prompt_tokens": 8000, "completion_tokens": 251}, {"prompt_per_second": 4100.0,
       "predicted_per_second": 21.5}, reasoning="let me think about it", content="done"),
]
PARTIAL_RESULTS = [  # no warm-up; rep 0 errors, rep 1 ok (the pre-existing partial-wave averaging)
    {"error": "no tokens received (empty sse stream)", "total_s": 0.3},
    _S(1.0, 6.0, {"prompt_tokens": 4000, "completion_tokens": 101}),
]
CONV_RESULTS = [
    _S(1.0, 3.0, {"prompt_tokens": 100, "completion_tokens": 40}),
    _S(0.8, 2.8, {"prompt_tokens": 260, "completion_tokens": 40, "prompt_tokens_details": {"cached_tokens": 140}}),
    _S(0.9, 2.9, {"prompt_tokens": 420, "completion_tokens": 40}, {"prompt_per_second": 300.0,
       "predicted_per_second": 20.0}),
]


def golden_run(mod, argv, results):
    """mod.main(argv) with stream/time/uuid/count_tokens/_kv_poller stubbed → (rows, payloads, exit)."""
    import types
    payloads, it = [], iter(results)

    def fake_stream(url, api, payload, timeout=0):
        payloads.append(json.loads(json.dumps(payload)))
        return json.loads(json.dumps(next(it)))
    patches = {"stream": fake_stream, "time": FakeClock(), "count_tokens": lambda url, text: len(text.split()),
               "uuid": types.SimpleNamespace(uuid4=lambda: types.SimpleNamespace(hex="0" * 32)),
               "_kv_poller": lambda *a, **k: None}
    saved = {k: getattr(mod, k) for k in patches}
    out, code, old = io.StringIO(), 0, sys.argv
    sys.argv = ["capture_engine.py"] + argv
    try:
        for k, v in patches.items():
            setattr(mod, k, v)
        with contextlib.redirect_stdout(out):
            mod.main()
    except SystemExit as e:
        code = e.code
    finally:
        sys.argv = old
        for k, v in saved.items():
            setattr(mod, k, v)
    return [json.loads(l) for l in out.getvalue().splitlines() if l.startswith("{")], payloads, code


# Pre-patch output (git HEAD 4b693cd capture_engine.py) for golden_run(); rows are JSON lines, payloads
# are sha256[:16] of the sorted-key request payload. Generated once; never regenerate from the new code.
GOLDEN = {
    "probe": {"exit": 0, "payloads": ["3b884b0845ad177a", "bd04cf71ea35a293", "bd04cf71ea35a293", "bd04cf71ea35a293"],
        "rows": [
            '{"kind": "request", "label": "G", "engine": "E", "rep": 0, "stream": 0, "concurrency": 1, "prefi'
            'x_mode": "none", "ttft_s": 2.0, "decode_tok_s": 25.0, "prefill_tok_s": 5000.0, "gen_tokens": 201'
            ', "prompt_tokens": 8000, "tok_count_source": "usage", "total_s": 12.0, "think_tokens": null, "tt'
            'fa_s": 2.1, "wall_start": 1800000000.0, "wall_first_token": 1800000002.0, "wall_end": 1800000012'
            '.0}',
            '{"kind": "request", "label": "G", "engine": "E", "rep": 1, "stream": 0, "concurrency": 1, "prefi'
            'x_mode": "none", "ttft_s": 1.6, "decode_tok_s": 20.0, "prefill_tok_s": 5000.0, "gen_tokens": 161'
            ', "prompt_tokens": 8000, "tok_count_source": "usage", "total_s": 9.6, "think_tokens": null, "ttf'
            'a_s": 1.7, "wall_start": 1800000000.0, "wall_first_token": 1800000001.6, "wall_end": 1800000009.'
            '6}',
            '{"kind": "request", "label": "G", "engine": "E", "rep": 2, "stream": 0, "concurrency": 1, "prefi'
            'x_mode": "none", "ttft_s": 2.5, "decode_tok_s": 21.5, "prefill_tok_s": 4100.0, "gen_tokens": 251'
            ', "prompt_tokens": 8000, "tok_count_source": "usage", "total_s": 15.0, "think_tokens": 5, "ttfa_'
            's": 2.6, "wall_start": 1800000000.0, "wall_first_token": 1800000002.5, "wall_end": 1800000015.0}',
            '{"kind": "aggregate", "label": "G", "engine": "E", "model": "local", "url": "http://x/v1", "conc'
            'urrency": 1, "reps": 3, "api": "chat", "prefix_mode": "none", "max_tokens": 300, "prompt_files":'
            ' ["<P>"], "prompt_tokens": 8000, "n_ok": 3, "n_err": 0, "ttft_s_p50": 2.0, "ttft_s_p95": 2.5, "d'
            'ecode_tok_s_per_stream_p50": 21.5, "prefill_tok_s_p50": 5000.0, "aggregate_tok_s": 16.75, "ttfa_'
            's_p50": 2.1, "think_tokens_p50": 5, "tok_count_source": "usage"}',
        ]},
    "partial": {"exit": 0, "payloads": ["c53c341ec52cd0e1", "c53c341ec52cd0e1"],
        "rows": [
            '{"kind": "request", "label": "G", "engine": "E", "rep": 0, "stream": 0, "concurrency": 1, "prefi'
            'x_mode": "none", "error": "no tokens received (empty sse stream)"}',
            '{"kind": "request", "label": "G", "engine": "E", "rep": 1, "stream": 0, "concurrency": 1, "prefi'
            'x_mode": "none", "ttft_s": 1.0, "decode_tok_s": 20.0, "prefill_tok_s": 4000.0, "gen_tokens": 101'
            ', "prompt_tokens": 4000, "tok_count_source": "usage", "total_s": 6.0, "think_tokens": null, "ttf'
            'a_s": 1.1, "wall_start": 1800000000.0, "wall_first_token": 1800000001.0, "wall_end": 1800000006.'
            '0}',
            '{"kind": "aggregate", "label": "G", "engine": "E", "model": "local", "url": "http://x/v1", "conc'
            'urrency": 1, "reps": 2, "api": "completions", "prefix_mode": "none", "max_tokens": 512, "prompt_'
            'files": ["<P>"], "prompt_tokens": 4000, "n_ok": 1, "n_err": 1, "ttft_s_p50": 1.0, "ttft_s_p95": '
            '1.0, "decode_tok_s_per_stream_p50": 20.0, "prefill_tok_s_p50": 4000.0, "aggregate_tok_s": 16.83,'
            ' "ttfa_s_p50": 1.1, "think_tokens_p50": null, "tok_count_source": "usage"}',
        ]},
    "conv": {"exit": 0, "payloads": ["be5ef5cdc8f31e44", "b345512db15a07d2", "3f0a104821ac89ba"],
        "rows": [
            '{"kind": "turn", "label": "C", "engine": "E", "rep": 0, "turn": 0, "conversation_id": "000000000'
            '000", "ttft_s": 1.0, "decode_tok_s": 19.5, "gen_tokens": 40, "prompt_tokens": 100, "tok_count_so'
            'urce": "usage", "total_s": 3.0, "think_tokens": null, "ttfa_s": 1.1, "wall_start": 1800000000.0,'
            ' "wall_first_token": 1800000001.0, "wall_end": 1800000003.0, "context_tokens": 100, "cached_toke'
            'ns": null, "new_tokens": null, "prefill_new_tok_s": null, "finish": "stop", "kv_usage_peak": nul'
            'l}',
            '{"kind": "turn", "label": "C", "engine": "E", "rep": 0, "turn": 1, "conversation_id": "000000000'
            '000", "ttft_s": 0.8, "decode_tok_s": 19.5, "gen_tokens": 40, "prompt_tokens": 260, "tok_count_so'
            'urce": "usage", "total_s": 2.8, "think_tokens": null, "ttfa_s": 0.9, "wall_start": 1800000000.0,'
            ' "wall_first_token": 1800000000.8, "wall_end": 1800000002.8, "context_tokens": 260, "cached_toke'
            'ns": 140, "new_tokens": 120, "prefill_new_tok_s": 150.0, "finish": "stop", "kv_usage_peak": null'
            '}',
            '{"kind": "turn", "label": "C", "engine": "E", "rep": 0, "turn": 2, "conversation_id": "000000000'
            '000", "ttft_s": 0.9, "decode_tok_s": 20.0, "gen_tokens": 40, "prompt_tokens": 420, "tok_count_so'
            'urce": "usage", "total_s": 2.9, "think_tokens": null, "ttfa_s": 1.0, "wall_start": 1800000000.0,'
            ' "wall_first_token": 1800000000.9, "wall_end": 1800000002.9, "context_tokens": 420, "cached_toke'
            'ns": null, "new_tokens": null, "prefill_new_tok_s": null, "finish": "stop", "kv_usage_peak": nul'
            'l}',
            '{"kind": "conversation_summary", "label": "C", "engine": "E", "model": "local", "url": "http://x'
            '/v1", "prompt_files": ["<P>"], "start_tokens": 100, "step_tokens": 100, "max_depth": 1000000, "m'
            'ax_tokens": 40, "reps": 1, "chat_template_kwargs": null, "turn_prompt": null, "conversations": ['
            '{"rep": 0, "turns": 3, "final_context_tokens": 420}], "n_err": 0}',
        ]},
}


class TestGoldenNoFlags(unittest.TestCase):
    """Without the new flags, every pre-patch key keeps its value and position, payloads are
    byte-identical, exit codes match; only additive keys may follow the old ones."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = os.path.join(self.tmp.name, "p.txt")
        with open(self.p, "w") as fh:
            fh.write(("word " * 59 + "end\n") * 5)       # 300 words → exactly 3 conversation turns

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, case, argv, results):
        import hashlib
        rows, payloads, code = golden_run(C, argv, results)
        g = GOLDEN[case]
        self.assertEqual(code, g["exit"])
        self.assertEqual([hashlib.sha256(json.dumps(p, sort_keys=True).encode()).hexdigest()[:16]
                          for p in payloads], g["payloads"])
        self.assertEqual(len(rows), len(g["rows"]))
        for row, old in zip(rows, (json.loads(r) for r in g["rows"])):
            if "prompt_files" in old:
                row["prompt_files"] = ["<P>"]
            self.assertEqual(list(row)[:len(old)], list(old))          # same keys, same order, first
            self.assertEqual({k: row[k] for k in old}, old)            # same values

    def test_probe(self):
        self.check("probe", ["probe", "--url", "http://x/v1", "--prompt-file", self.p, "--reps", "3", "--label",
                             "G", "--engine", "E", "--api", "chat", "--max-tokens", "300"], PROBE_RESULTS)

    def test_probe_partial_error(self):
        self.check("partial", ["probe", "--url", "http://x/v1", "--prompt-file", self.p, "--reps", "2",
                               "--warmup", "0", "--label", "G", "--engine", "E"], PARTIAL_RESULTS)

    def test_reserved_covers_conversation(self):   # issue 2: turn + summary columns are reserved too
        rows, _, _ = golden_run(C, ["conversation", "--url", "http://x/v1", "--prompt-file", self.p,
                                    "--start-tokens", "100", "--step-tokens", "100", "--max-depth", "1000000",
                                    "--sampling", '{"seed": 1}'], CONV_RESULTS)
        emitted = {k for r in rows for k in r}
        self.assertTrue(emitted <= C._reserved_keys(), emitted - C._reserved_keys())

    def test_conversation(self):
        self.check("conv", ["conversation", "--url", "http://x/v1", "--prompt-file", self.p, "--start-tokens",
                            "100", "--step-tokens", "100", "--max-depth", "1000000", "--max-tokens", "40",
                            "--label", "C", "--engine", "E"], CONV_RESULTS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
