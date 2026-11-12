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


if __name__ == "__main__":
    unittest.main(verbosity=2)
