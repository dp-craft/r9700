"""End-to-end regression net: the FULL generated artefacts must not change.

The per-function tests in test_ids.py / test_cmd.py pin behaviour flag-by-flag, which is
deliberately tolerant of unrelated edits. This file is the opposite and complements them:
it runs `main()` exactly as the CLI does and compares the ENTIRE `config.yaml` and the
ENTIRE opencode model map against golden copies of what the generator emits today.

Purpose: when generate.py grows a hipfire backend, every pre-existing llama.cpp row must
still come out byte-identical. Any drift in an existing row fails here loudly.

Regenerating (do this ONLY when a change to the output is intended, and review the diff):
    python3 -m pytest tests/test_golden.py --regenerate-golden -q
"""
import json
import re
import pathlib

import pytest

import generate

GOLDEN = pathlib.Path(__file__).parent / "golden"
GOLDEN_YAML = GOLDEN / "config.yaml"
GOLDEN_MODELS = GOLDEN / "opencode-models.json"

# Shape of the live opencode config, reduced to what sync_opencode() interacts with. Seeded
# into a tmp file so the real ~/.config/opencode/opencode.json is never opened for writing.
SEED_CFG = {
    "$schema": "https://opencode.ai/config.json",
    "compaction": {"auto": True},
    "provider": {
        "ollama-local": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "Ollama Local",
            "options": {"baseURL": "http://127.0.0.1:11434/v1", "apiKey": "dummy-key"},
            "models": {"sentinel:latest": {"name": "sentinel:latest"}},
        },
        "llama-swap": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "llama-swap (R9700 local)",
            "options": {"baseURL": "http://127.0.0.1:9292/v1", "apiKey": "dummy-key"},
            "models": {},
        },
    },
}


@pytest.fixture
def run_main(tmp_path, monkeypatch, capsys):
    """Run generate.main() with BOTH of its write targets redirected into tmp_path.

    `_MODELS_YAML` is deliberately NOT redirected: the golden must be generated from the
    real models.yaml, because that table is the thing whose rendering must not regress.
    """
    def _run():
        cfg = tmp_path / "opencode.json"
        cfg.write_text(json.dumps(SEED_CFG, indent=2) + "\n")
        monkeypatch.setattr(generate, "HERE", tmp_path)
        monkeypatch.setattr(generate, "OPENCODE_CFG", cfg)
        generate.main()
        capsys.readouterr()
        yaml_text = (tmp_path / "config.yaml").read_text()
        models = json.loads(cfg.read_text())["provider"]["llama-swap"]["models"]
        return yaml_text, models, json.loads(cfg.read_text())
    return _run


def test_config_yaml_matches_golden(run_main, request):
    yaml_text, _, _ = run_main()
    if request.config.getoption("--regenerate-golden"):
        GOLDEN_YAML.write_text(yaml_text)
        pytest.skip("golden config.yaml regenerated")
    assert yaml_text == GOLDEN_YAML.read_text(), (
        "generated config.yaml differs from the golden copy. If the change is intended, "
        "review the diff and rerun with --regenerate-golden."
    )


def test_opencode_models_match_golden(run_main, request):
    _, models, _ = run_main()
    if request.config.getoption("--regenerate-golden"):
        GOLDEN_MODELS.write_text(json.dumps(models, indent=2, sort_keys=True) + "\n")
        pytest.skip("golden opencode-models.json regenerated")
    assert models == json.loads(GOLDEN_MODELS.read_text())


def test_every_other_part_of_the_opencode_config_survives_main(run_main):
    """main() is the real caller of sync_opencode; prove the whole-run path is non-invasive."""
    _, _, cfg_after = run_main()
    assert cfg_after["$schema"] == SEED_CFG["$schema"]
    assert cfg_after["compaction"] == SEED_CFG["compaction"]
    assert cfg_after["provider"]["ollama-local"] == SEED_CFG["provider"]["ollama-local"]
    swap = cfg_after["provider"]["llama-swap"]
    for key in ("npm", "name", "options"):
        assert swap[key] == SEED_CFG["provider"]["llama-swap"][key]
    assert list(cfg_after) == list(SEED_CFG)
    assert list(cfg_after["provider"]) == list(SEED_CFG["provider"])


def test_golden_matches_the_live_deployed_config():
    """The golden must be the artefact llama-swap is actually running, not a self-consistent
    fiction. If this fails, someone hand-edited config.yaml or models.yaml changed without a
    regenerate — either way the golden is no longer a description of production."""
    live = pathlib.Path(generate.HERE) / "config.yaml"
    if not live.exists():
        pytest.skip("no live config.yaml on this machine")
    live_text, golden_text = live.read_text(), GOLDEN_YAML.read_text()
    if live_text == golden_text:
        return
    import difflib
    diff = "\n".join(list(difflib.unified_diff(
        live_text.splitlines(), golden_text.splitlines(),
        fromfile="DEPLOYED config.yaml", tofile="what generate.py emits now", lineterm=""))[:40])
    pytest.fail(
        "models.yaml has been edited without re-running generate.py, so llama-swap is serving "
        "a config the table no longer describes. Regenerating is NOT free: any row whose ctx "
        "stopped being a KiB multiple gets a NEW id (ctx130k -> ctx213120), and every reference "
        "to the old id elsewhere breaks. Decide deliberately, then either run generate.py or "
        "revert models.yaml.\n\n" + diff)


def test_golden_covers_every_live_model_row():
    """Guard against a golden captured from a truncated models.yaml -- in BOTH directions.

    A magic minimum row count was the first attempt here and it was wrong: trimming duplicate
    rows is a legitimate edit, so a floor turns an intended cleanup into a red suite. Checking
    the correspondence instead catches real truncation without pinning the roster size.
    """
    golden = GOLDEN_YAML.read_text()
    mids = {mid for mid, *_ in generate.MODELS}
    for mid in mids:
        assert mid in golden, f"{mid} from models.yaml is absent from the golden config.yaml"

    # ...and nothing in the golden comes from a row that no longer exists.
    block_ids = re.findall(r'^  "([^"]+)":$', golden, re.M)
    # The `groups:` section reuses the same `  "name":` shape as a model block.
    known = ({rid for rid, *_ in generate.RERANKERS} | {eid for eid, *_ in generate.EMBEDDERS}
             | {"embedder-group", "reranker-group", "inference-group"})
    for bid in block_ids:
        if bid in known:
            continue
        assert any(bid.startswith(mid) for mid in mids), (
            f"golden config.yaml has block {bid!r} matching no current models.yaml row "
            f"-- regenerate the golden")
