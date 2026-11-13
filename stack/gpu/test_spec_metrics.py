#!/usr/bin/env python3
"""Unit tests for spec_metrics.py — vLLM (old keys byte-identical, additive keys), radiance /stats +
/metrics (G3) and llama.cpp rows (G3 via capture_engine's G2d draft_n columns). Loopback GET server
(stdlib http, 127.0.0.1:0), no GPU.

The radiance fixture is the real radiance 1.16.0 capture committed in CAPTURE (stats.json + metrics.txt,
loaded from disk by TestRealCapture): draft_positions accepted 765/476/281 = radiance:draft_accepted_total
1522; draft_tokens_total 3042; decode_tokens_total 2536; steps_decode 1014 = draft_positions[0].reached.
Run: python3 stack/gpu/test_spec_metrics.py
"""
import contextlib
import http.server
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import spec_metrics as S  # noqa: E402

CAPTURE = os.path.join(REPO, "campaigns/perf/2026-11-04-1527-ornith15-radiance-vs-sly/results/"
                             "2026-11-04-1730-ornith15-w4a8-radiance/ornith15-w4a8")
PRE_G3 = "4b693cd"      # last commit before G3: the vLLM path's reference output
OLD_VLLM_KEYS = ["kind", "label", "engine", "drafts", "draft_tokens", "accepted_tokens", "acceptance_rate",
                 "mean_accept_len", "accepted_per_pos"]
SCHEMA = OLD_VLLM_KEYS + ["source", "gen_tokens", "tau", "tau_def", "comparable", "engine_version",
                          "n_rows", "n_rows_skipped"]

VLLM_METRICS = """# HELP vllm:spec_decode_num_drafts_total x
vllm:spec_decode_num_drafts_total{engine="0",model_name="m"} 100.0
vllm:spec_decode_num_draft_tokens_total{engine="0",model_name="m"} 700.0
vllm:spec_decode_num_accepted_tokens_total{engine="0",model_name="m"} 210.0
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",model_name="m",position="0"} 80.0
vllm:spec_decode_num_accepted_tokens_per_pos_total{engine="0",model_name="m",position="1"} 60.0
vllm:generation_tokens_total{engine="0",model_name="m"} 900.0
"""
VLLM_ZERO = re.sub(r"(spec_decode\S+) [0-9.]+", r"\1 0", VLLM_METRICS)


def rad_metrics(draft, acc, dec, gen_fin=None, positions=None):
    lines = ['# HELP radiance:draft_tokens_total Speculative tokens proposed.',
             'vllm:kv_cache_usage_perc{model_name="qwen35moe",engine="0"} 0.48',
             f'radiance:draft_tokens_total{{model_name="qwen35moe",engine="0"}} {draft}',
             f'radiance:draft_accepted_total{{model_name="qwen35moe",engine="0"}} {acc}',
             f'radiance:decode_tokens_total{{model_name="qwen35moe",engine="0"}} {dec}']
    if gen_fin is not None:
        lines.append(f'vllm:generation_tokens_total{{model_name="qwen35moe",engine="0"}} {gen_fin}')
    for i, (reached, accepted) in enumerate(positions or []):
        lines.append(f'radiance:draft_position_reached_total{{model_name="q",engine="0",position="{i}"}} {reached}')
        lines.append(f'radiance:draft_position_accepted_total{{model_name="q",engine="0",position="{i}"}} {accepted}')
    return "\n".join(lines) + "\n"


def rad_stats(positions, **extra):
    d = {"model": "qwen35moe", "version": "1.16.0", "started_at": 1793809417, "draft_accept": 0.5,
         "steps_decode": 1014, "draft_positions": positions}
    d.update(extra)
    return json.dumps(d)


REAL_POS = [{"reached": 1014, "accepted": 765, "rate": 0.754}, {"reached": 765, "accepted": 476, "rate": 0.622},
            {"reached": 476, "accepted": 281, "rate": 0.590}]
ZERO_POS = [{"reached": 0, "accepted": 0, "rate": 0.0}] * 3


class Fake:
    """GET /metrics, /stats and /version from mutable strings; None → 404."""

    def __init__(self):
        fs = self
        self.metrics, self.stats, self.version = None, None, None

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = {"/metrics": fs.metrics, "/stats": fs.stats, "/version": fs.version}.get(self.path)
                if body is None:
                    self.send_response(404); self.end_headers(); return
                b = body.encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/v1"

    def close(self):
        self.srv.shutdown(); self.srv.server_close()


def run_main(argv, mod=S):
    """main() → (parsed rows, raw stdout)."""
    out = io.StringIO()
    old = sys.argv
    sys.argv = ["spec_metrics.py"] + argv
    try:
        with contextlib.redirect_stdout(out):
            mod.main()
    finally:
        sys.argv = old
    return [json.loads(l) for l in out.getvalue().splitlines() if l.strip()], out.getvalue()


class _Case(unittest.TestCase):
    def setUp(self):
        self.f = Fake()
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.f.close(); self.tmp.cleanup()

    def path(self, name, content):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w") as fh:
            fh.write(content)
        return p

    def snap_diff(self, before_setup, after_setup, mod=S):
        before_setup()
        snap = mod.snap(self.f.url)
        p = self.path("before.json", json.dumps(snap))
        after_setup()
        return snap, run_main(["diff", p, self.f.url, "LBL", "ENG"], mod)[0]

    def assertSchema(self, row):
        keys = list(row)
        if "error" in row:
            self.assertEqual(keys[-1], "error"); keys = keys[:-1]
        self.assertEqual(keys, SCHEMA)


class TestVllm(_Case):
    def test_vllm_row_old_keys_exact_plus_additive(self):
        def before():
            self.f.metrics = VLLM_ZERO
            self.f.stats = rad_stats(REAL_POS)        # a /stats must not divert the vLLM path
        snap, rows = self.snap_diff(before, lambda: setattr(self.f, "metrics", VLLM_METRICS))
        self.assertNotIn("source", snap)
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual({k: r[k] for k in OLD_VLLM_KEYS},
                         {"kind": "spec", "label": "LBL", "engine": "ENG", "drafts": 100, "draft_tokens": 700,
                          "accepted_tokens": 210, "acceptance_rate": 0.3, "mean_accept_len": 3.1,
                          "accepted_per_pos": [80, 60]})
        self.assertSchema(r)
        self.assertEqual((r["source"], r["gen_tokens"], r["tau"], r["tau_def"], r["comparable"]),
                         ("vllm_metrics", None, 3.1, "1+accepted/drafts", None))
        self.assertIsNone(r["engine_version"]); self.assertIsNone(r["n_rows"])

    def test_vllm_version_from_endpoint(self):
        self.f.version = json.dumps({"version": "0.11.1rc2"})
        _, rows = self.snap_diff(lambda: setattr(self.f, "metrics", VLLM_ZERO),
                                 lambda: setattr(self.f, "metrics", VLLM_METRICS))
        self.assertEqual(rows[0]["engine_version"], "0.11.1rc2")

    def test_vllm_zero_drafts_tau_null(self):
        _, rows = self.snap_diff(lambda: setattr(self.f, "metrics", VLLM_ZERO),
                                 lambda: setattr(self.f, "metrics", VLLM_ZERO))
        self.assertIsNone(rows[0]["mean_accept_len"]); self.assertIsNone(rows[0]["tau"])

    def test_no_counters_anywhere_prints_nothing(self):
        self.f.metrics = 'vllm:kv_cache_usage_perc{engine="0"} 0.1\n'
        self.assertEqual(S.snap(self.f.url), {})
        p = self.path("b.json", "{}")
        self.assertEqual(run_main(["diff", p, self.f.url, "L", "E"])[0], [])

    def test_server_down_snap_empty(self):
        self.f.close()
        self.assertEqual(S.snap(self.f.url), {})
        self.f = Fake()   # for tearDown


def _load_pre_g3():
    try:
        src = subprocess.run(["git", "-C", REPO, "show", f"{PRE_G3}:stack/gpu/spec_metrics.py"],
                             capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    mod = types.ModuleType("spec_metrics_pre_g3")
    exec(compile(src, "spec_metrics_pre_g3.py", "exec"), mod.__dict__)
    return mod


class TestVllmDifferentialPreG3(_Case):
    """The vLLM row against the pre-G3 module (git show PRE_G3): the old JSON line must be a byte-exact
    prefix of the new one (old keys, order and values unchanged; new keys only appended)."""
    SCENARIOS = {
        "spec": (VLLM_ZERO, VLLM_METRICS),
        "zero_window": (VLLM_METRICS, VLLM_METRICS),
        "reversed": (VLLM_METRICS, VLLM_ZERO),                    # pre-existing: negative values, kept
        "no_per_pos": (VLLM_ZERO.replace("per_pos", "x"), VLLM_METRICS.replace("per_pos", "x")),
        "float_counts": (VLLM_ZERO, VLLM_METRICS.replace("210.0", "211.5")),
        "spec_off": ('vllm:generation_tokens_total{engine="0"} 1\n', 'vllm:generation_tokens_total{engine="0"} 9\n'),
    }

    def test_old_line_is_exact_prefix(self):
        old = _load_pre_g3()
        if old is None:
            self.skipTest("git or the pre-G3 commit is not available")
        for name, (b, a) in self.SCENARIOS.items():
            lines = []
            for mod in (old, S):
                self.f.metrics = b
                p = self.path("before.json", json.dumps(mod.snap(self.f.url)))
                self.f.metrics = a
                lines.append(run_main(["diff", p, self.f.url, "LBL", "ENG"], mod)[1])
            o, n = lines
            if not o:
                self.assertEqual(n, "", name)
                continue
            self.assertTrue(n.startswith(o.rstrip("\n")[:-1] + ", "), f"{name}:\n{o}\n{n}")


class TestRealCapture(_Case):
    """The committed radiance 1.16.0 capture, loaded from disk (format drift shows up here)."""

    def setUp(self):
        super().setUp()
        with open(os.path.join(CAPTURE, "stats.json")) as fh:
            self.stats = fh.read()
        with open(os.path.join(CAPTURE, "metrics.txt")) as fh:
            self.metrics = fh.read()
        zero = json.loads(self.stats)
        zero["draft_positions"] = [{"reached": 0, "accepted": 0, "rate": 0.0}] * 3
        self.stats0 = json.dumps(zero)
        self.metrics0 = re.sub(r"^(radiance:(?:draft_\w+|decode_tokens)_total\{[^}]*\}) \S+$", r"\1 0",
                               self.metrics, flags=re.M)
        self.metrics0 = re.sub(r"^(vllm:generation_tokens_total\{[^}]*\}) \S+$", r"\1 0", self.metrics0, flags=re.M)

    def check(self, row):
        self.assertSchema(row)
        self.assertEqual((row["source"], row["engine_version"]), ("radiance", "1.16.0"))
        self.assertEqual((row["drafts"], row["draft_tokens"], row["accepted_tokens"]), (1014, 3042, 1522))
        self.assertEqual(row["accepted_per_pos"], [765, 476, 281])
        self.assertEqual(row["acceptance_rate"], round(1522 / 3042, 4))
        self.assertEqual(row["mean_accept_len"], round(1 + 1522 / 1014, 3))
        self.assertEqual(row["gen_tokens"], 2536)
        self.assertEqual(row["tau"], round(2536 / (2536 - 1522), 3))
        self.assertEqual((row["tau_def"], row["comparable"]), ("gen/(gen-accepted)", True))

    def test_real_files_typed_counters(self):        # the capture has draft_position_*_total: preferred
        def before():
            self.f.metrics, self.f.stats = self.metrics0, self.stats0
        def after():
            self.f.metrics, self.f.stats = self.metrics, self.stats
        _, rows = self.snap_diff(before, after)
        self.check(rows[0])

    def test_real_files_stats_positions(self):       # same capture, typed position counters removed
        strip = lambda t: "\n".join(l for l in t.splitlines() if "draft_position_" not in l)   # noqa: E731
        def before():
            self.f.metrics, self.f.stats = strip(self.metrics0), self.stats0
        def after():
            self.f.metrics, self.f.stats = strip(self.metrics), self.stats
        _, rows = self.snap_diff(before, after)
        self.check(rows[0])


class TestRadiance(_Case):
    def test_metrics_positions_win_over_stats(self):
        def before():
            self.f.metrics = rad_metrics(0, 0, 0, positions=[(0, 0), (0, 0)])
            self.f.stats = rad_stats(ZERO_POS)
        def after():
            self.f.metrics = rad_metrics(140, 70, 200, positions=[(70, 50), (50, 20)])
            self.f.stats = rad_stats(REAL_POS)          # disagrees on purpose
        _, rows = self.snap_diff(before, after)
        self.assertEqual((rows[0]["drafts"], rows[0]["accepted_per_pos"]), (70, [50, 20]))

    def test_stats_without_draft_positions(self):
        def before():
            self.f.metrics = rad_metrics(100, 40, 200)
            self.f.stats = json.dumps({"model": "x"})
        def after():
            self.f.metrics = rad_metrics(800, 340, 900)
        _, rows = self.snap_diff(before, after)
        r = rows[0]
        self.assertSchema(r)
        self.assertIsNone(r["drafts"]); self.assertIsNone(r["accepted_per_pos"]); self.assertIsNone(r["mean_accept_len"])
        self.assertEqual((r["draft_tokens"], r["accepted_tokens"], r["gen_tokens"]), (700, 300, 700))
        self.assertEqual(r["tau"], round(700 / 400, 3))
        self.assertIsNone(r["engine_version"])

    def test_stats_only_no_metric_counters(self):
        def before():
            self.f.metrics = None                                       # /metrics 404
            self.f.stats = rad_stats([{"reached": 10, "accepted": 5}, {"reached": 5, "accepted": 2}])
        def after():
            self.f.stats = rad_stats([{"reached": 30, "accepted": 15}, {"reached": 15, "accepted": 6}])
        _, rows = self.snap_diff(before, after)
        r = rows[0]
        self.assertEqual((r["drafts"], r["accepted_tokens"], r["accepted_per_pos"]), (20, 14, [10, 4]))
        self.assertIsNone(r["draft_tokens"]); self.assertIsNone(r["acceptance_rate"])
        self.assertIsNone(r["gen_tokens"]); self.assertIsNone(r["tau"])
        self.assertEqual(r["mean_accept_len"], round(1 + 14 / 20, 3))
        self.assertEqual(r["engine_version"], "1.16.0")

    def test_finished_counter_fallback_not_comparable(self):
        dec = "radiance:decode_tokens_total"
        def before():
            self.f.metrics = rad_metrics(0, 0, 0, gen_fin=0).replace(dec, "radiance:other")
        def after():
            self.f.metrics = rad_metrics(70, 30, 0, gen_fin=90).replace(dec, "radiance:other")
        _, rows = self.snap_diff(before, after)
        self.assertEqual(rows[0]["gen_tokens"], 90)
        self.assertEqual(rows[0]["tau"], round(90 / 60, 3))
        self.assertIs(rows[0]["comparable"], False)

    def test_malformed_stats_tolerated(self):
        for bad in ("not json {", "[]", rad_stats("oops"), rad_stats([1, 2]), rad_stats([{"reached": "x"}]),
                    rad_stats([]), rad_stats([{"reached": float("nan"), "accepted": float("nan")}]),
                    rad_stats([{"reached": float("inf"), "accepted": float("-inf")}])):
            self.f.metrics, self.f.stats = None, bad
            self.assertEqual(S.snap(self.f.url), {}, bad)
            self.f.metrics = rad_metrics(10, 5, 20)                     # counters alone still work
            snap = S.snap(self.f.url)
            self.assertEqual(snap["source"], "radiance", bad)
            self.assertNotIn("per_pos", snap, bad)
            self.assertNotIn("drafts", snap, bad)

    def test_non_finite_reached_keeps_finite_accepted(self):
        self.f.metrics, self.f.stats = None, rad_stats([{"reached": float("inf"), "accepted": 1}])
        snap = S.snap(self.f.url)
        self.assertEqual(snap["per_pos"], {"0": 1})
        self.assertNotIn("drafts", snap)

    def test_non_finite_metric_dropped(self):
        self.f.metrics = rad_metrics("1e999", 5, 20)                     # parses to inf
        snap = S.snap(self.f.url)
        self.assertNotIn("draft_tokens", snap)
        self.assertEqual(snap["accepted_tokens"], 5)

    def test_partial_positions_keep_what_parses(self):
        self.f.metrics, self.f.stats = None, rad_stats([{"reached": 5}, {"reached": 2}])   # no `accepted`
        self.assertEqual({k: v for k, v in S.snap(self.f.url).items() if k in ("drafts", "source")},
                         {"drafts": 5, "source": "radiance"})

    def test_counter_decrease_is_an_error_row(self):
        def before():
            self.f.metrics = rad_metrics(500, 200, 900); self.f.stats = rad_stats(REAL_POS)
        def after():
            self.f.metrics = rad_metrics(10, 4, 20)
            self.f.stats = rad_stats([{"reached": 3, "accepted": 1}] * 3)
        _, rows = self.snap_diff(before, after)
        self.assertEqual(len(rows), 1)
        self.assertIn("backwards", rows[0]["error"])
        self.assertSchema(rows[0])
        self.assertIsNone(rows[0]["tau"])
        self.assertEqual(rows[0]["source"], "radiance")

    def test_restart_with_higher_counters_is_an_error_row(self):   # a decrease check alone misses it
        def before():
            self.f.metrics = rad_metrics(10, 4, 20); self.f.stats = rad_stats(ZERO_POS, started_at=100)
        def after():
            self.f.metrics = rad_metrics(500, 200, 900); self.f.stats = rad_stats(REAL_POS, started_at=200)
        _, rows = self.snap_diff(before, after)
        self.assertIn("restarted", rows[0]["error"])
        self.assertSchema(rows[0])

    def test_implausible_window_is_an_error_row(self):
        for drafted, acc, gen in ((100, 140, 900), (100, 50, 30)):       # accepted > drafted; gen < accepted
            def before():
                self.f.metrics = rad_metrics(0, 0, 0); self.f.stats = None
            def after(d=drafted, a=acc, g=gen):
                self.f.metrics = rad_metrics(d, a, g)
            _, rows = self.snap_diff(before, after)
            self.assertIn("implausible", rows[0]["error"], (drafted, acc, gen))
            self.assertIsNone(rows[0]["acceptance_rate"])

    def test_idle_window_prints_nothing(self):
        def setup():
            self.f.metrics = rad_metrics(500, 200, 900); self.f.stats = rad_stats(REAL_POS)
        _, rows = self.snap_diff(setup, setup)
        self.assertEqual(rows, [])

    def test_position_count_change_drops_per_pos(self):
        def before():
            self.f.metrics = rad_metrics(0, 0, 0); self.f.stats = rad_stats([{"reached": 0, "accepted": 0}] * 2)
        def after():
            self.f.metrics = rad_metrics(3042, 1522, 2536); self.f.stats = rad_stats(REAL_POS)
        _, rows = self.snap_diff(before, after)
        self.assertIsNone(rows[0]["accepted_per_pos"])
        self.assertEqual(rows[0]["accepted_tokens"], 1522)

    def test_engine_switch_between_snaps_prints_nothing(self):
        _, rows = self.snap_diff(lambda: setattr(self.f, "metrics", VLLM_METRICS),
                                 lambda: setattr(self.f, "metrics", rad_metrics(3042, 1522, 2536)))
        self.assertEqual(rows, [])


def req(gen, dn, da, **kw):
    r = {"kind": "request", "label": "L", "engine": "E", "gen_tokens": gen, "draft_n": dn, "draft_n_accepted": da}
    r.update(kw)
    return r


class TestLlamacppRows(_Case):
    def rows(self, rows, *extra, raw=""):
        p = self.path("rows.jsonl", "\n".join(json.dumps(r) for r in rows) + "\n" + raw)
        return run_main(["rows", p, "L", "E", *extra])[0]

    def test_sum_and_tau_excludes_prefill_token(self):
        out = self.rows([
            req(1000, 900, 600), req(1000, 900, 500),
            dict(req(500, 300, 200), kind="turn"),
            req(1000, 9, 9, short=True),
            {"kind": "request", "label": "L", "engine": "E", "error": "no tokens received"},
            dict(req(1, 9, 9), label="OTHER"), dict(req(1, 9, 9), engine="X"),
            {"kind": "aggregate", "label": "L", "engine": "E", "draft_n_sum": 1800, "draft_n_accepted_sum": 1100},
        ], raw="garbage line {\n")
        gen = 999 + 999 + 499                                  # one prefill-sampled token per request
        self.assertEqual(len(out), 1)
        r = out[0]
        self.assertSchema(r)
        self.assertEqual({k: r[k] for k in SCHEMA}, {
            "kind": "spec", "label": "L", "engine": "E", "drafts": None, "draft_tokens": 2100,
            "accepted_tokens": 1300, "acceptance_rate": round(1300 / 2100, 4), "mean_accept_len": None,
            "accepted_per_pos": None, "source": "llamacpp_timings", "gen_tokens": gen,
            "tau": round(gen / (gen - 1300), 3), "tau_def": "gen/(gen-accepted)", "comparable": True,
            "engine_version": None, "n_rows": 3, "n_rows_skipped": 0})

    def test_single_token_requests_floor_at_zero(self):
        r = self.rows([req(0, 2, 0), req(1, 2, 0), req(3, 2, 1)])[0]
        self.assertEqual(r["gen_tokens"], 0 + 0 + 2)

    def test_missing_accepted_propagates_none(self):
        r = self.rows([req(100, 30, 10), req(100, 30, None)])[0]
        self.assertEqual(r["draft_tokens"], 60)
        self.assertIsNone(r["accepted_tokens"]); self.assertIsNone(r["acceptance_rate"]); self.assertIsNone(r["tau"])

    def test_rows_without_draft_n_are_counted(self):
        r = self.rows([req(100, 30, 10), req(100, None, None), {"kind": "turn", "label": "L", "engine": "E",
                                                                 "gen_tokens": 5}])[0]
        self.assertEqual((r["n_rows"], r["n_rows_skipped"], r["draft_tokens"]), (1, 2, 30))

    def test_bad_types_skipped_not_crash(self):
        r = self.rows([req(100, 30, 10), req(100, "30", 10), req(100, True, 1), req(100, float("nan"), 1),
                       req("x", 30, 10)])[0]
        self.assertEqual((r["n_rows"], r["n_rows_skipped"]), (2, 3))
        self.assertEqual(r["draft_tokens"], 60)
        self.assertIsNone(r["gen_tokens"]); self.assertIsNone(r["tau"])        # one used row had no gen

    def test_implausible_is_error_row(self):
        r = self.rows([req(100, 10, 20)])[0]                                    # accepted > drafted
        self.assertIn("implausible", r["error"])
        self.assertSchema(r)
        self.assertIsNone(r["tau"])
        r = self.rows([req(11, 30, 20)])[0]                                     # gen-1 = 10 < accepted
        self.assertIn("implausible", r["error"])

    def test_no_draft_fields_prints_nothing(self):
        self.assertEqual(self.rows([{"kind": "request", "label": "L", "engine": "E", "gen_tokens": 10},
                                    req(10, None, None)]), [])

    def test_spec_off_zero_drafts_prints_nothing(self):
        self.assertEqual(self.rows([req(10, 0, 0)]), [])

    def test_all_accepted_tau_null(self):
        r = self.rows([req(11, 10, 10)])[0]
        self.assertIsNone(r["tau"])
        self.assertEqual(r["acceptance_rate"], 1.0)

    def test_props_build_into_row(self):
        props = self.path("props.json", json.dumps({"build_info": "b11448-abc123", "model_path": "x"}))
        self.assertEqual(self.rows([req(100, 30, 10)], props)[0]["engine_version"], "b11448-abc123")
        bad = self.path("bad.json", "not json")
        self.assertIsNone(self.rows([req(100, 30, 10)], bad)[0]["engine_version"])
        self.assertIsNone(self.rows([req(100, 30, 10)], os.path.join(self.tmp.name, "missing.json"))[0]["engine_version"])

    def test_stdin(self):
        old = sys.stdin
        sys.stdin = io.StringIO(json.dumps(req(11, 6, 4)) + "\n")
        try:
            r = run_main(["rows", "-", "L", "E"])[0][0]
        finally:
            sys.stdin = old
        self.assertEqual((r["draft_tokens"], r["accepted_tokens"], r["tau"]), (6, 4, round(10 / 6, 3)))


class TestContractWithCaptureEngine(_Case):
    """Rows built by capture_engine's real probe path (stream stubbed) are what `rows` reads."""

    def test_capture_engine_rows(self):
        spec = importlib.util.spec_from_file_location("ce_contract", os.path.join(REPO, "bench/core/capture_engine.py"))
        C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
        res = iter([  # warm-up (no row), 3 reps: two counted, one short (excluded)
            (16, {"draft_n": 9, "draft_n_accepted": 9}),
            (301, {"draft_n": 240, "draft_n_accepted": 150, "predicted_per_second": 30.0}),
            (5, {"draft_n": 6, "draft_n_accepted": 3}),
            (201, {"draft_n": 150, "draft_n_accepted": 100, "predicted_per_second": 30.0})])

        def fake_stream(url, api, payload, timeout=0):
            gen, tm = next(res)
            return {"content": "x", "reasoning": "", "ttft": 1.0, "ttfa": 1.0, "total_s": 5.0,
                    "usage": {"prompt_tokens": 100, "completion_tokens": gen}, "timings": tm,
                    "finish": "stop", "saw_reasoning": False, "chunk_tokens": gen}
        p = self.path("p.txt", "hello world\n")
        out, saved, old = io.StringIO(), C.stream, sys.argv
        C.stream = fake_stream
        sys.argv = ["capture_engine.py", "probe", "--url", "http://x/v1", "--prompt-file", p, "--reps", "3",
                    "--label", "L", "--engine", "E", "--min-gen", "10"]
        try:
            with contextlib.redirect_stdout(out):
                C.main()
        except SystemExit:
            pass                                             # exit 3: one short row
        finally:
            C.stream, sys.argv = saved, old
        r = S.from_rows(out.getvalue().splitlines(), "L", "E")
        self.assertEqual((r["draft_tokens"], r["accepted_tokens"], r["gen_tokens"], r["n_rows"]),
                         (390, 250, 300 + 200, 2))
        self.assertEqual(r["tau"], round(500 / 250, 3))


class TestSchemaUniform(_Case):
    def test_every_source_same_keys(self):
        rows = []
        _, r = self.snap_diff(lambda: setattr(self.f, "metrics", VLLM_ZERO),
                              lambda: setattr(self.f, "metrics", VLLM_METRICS)); rows += r
        _, r = self.snap_diff(lambda: setattr(self.f, "metrics", rad_metrics(0, 0, 0)),
                              lambda: setattr(self.f, "metrics", rad_metrics(30, 10, 40))); rows += r
        rows.append(S.from_rows([json.dumps(req(100, 30, 10))], "L", "E"))
        rows.append(S.from_rows([json.dumps(req(100, 10, 30))], "L", "E"))          # error row
        self.assertEqual(len(rows), 4)
        for row in rows:
            self.assertSchema(row)


class ReviewFixes(unittest.TestCase):
    def test_comparable_null_when_tau_null(self):
        r = S._spec_row("l", "e", "radiance", 4, 8, 3, None, None, True)
        self.assertIsNone(r["tau"])
        self.assertIsNone(r["comparable"])
        self.assertTrue(S._spec_row("l", "e", "radiance", 4, 8, 3, 20, None, True)["comparable"])

    def test_negative_llama_counts_are_an_error_row(self):
        row = json.dumps({"kind": "request", "label": "L", "engine": "E", "gen_tokens": 40,
                          "draft_n": 30, "draft_n_accepted": -5})
        r = S.from_rows([row], "L", "E")
        self.assertIn("negative count", r["error"])
        self.assertIsNone(r["tau"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
