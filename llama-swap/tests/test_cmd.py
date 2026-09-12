"""Characterization tests for generate.py's command-emission and config-sync layer.

Scope: _load_models, cmd_for, rerank_cmd_for, embed_cmd_for, embed_blocks, rerank_blocks,
sync_opencode.  These tests ENCODE THE BEHAVIOUR THE CODE HAS TODAY -- they are a regression
net for refactoring, not a specification of what the code ought to do.

SAFETY: generate.OPENCODE_CFG points at the user's live ~/.config/opencode/opencode.json.
The autouse `isolate_side_effect_paths` fixture below repoints it (and _MODELS_YAML) into
tmp_path for EVERY test in this module, so no test in this file can reach a real file.
"""
import json

import pytest
import yaml

import generate


# --------------------------------------------------------------------------------------------
# safety net
# --------------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def isolate_side_effect_paths(tmp_path, monkeypatch):
    """Repoint every module-level path generate.py can write to into tmp_path.

    Applied to every test in this module, so even a test that forgets to patch cannot touch
    the user's real opencode.json or models.yaml.
    """
    monkeypatch.setattr(generate, "OPENCODE_CFG", tmp_path / "opencode.json")
    monkeypatch.setattr(generate, "_MODELS_YAML", tmp_path / "models.yaml")
    return tmp_path


def test_safety_net_repoints_opencode_cfg_into_tmp(tmp_path):
    """The guard itself: OPENCODE_CFG must not be the user's real config during tests."""
    assert generate.OPENCODE_CFG == tmp_path / "opencode.json"
    assert "/.config/opencode/opencode.json" not in str(generate.OPENCODE_CFG)


# --------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------
def write_models_yaml(tmp_path, models):
    (tmp_path / "models.yaml").write_text(yaml.safe_dump({"models": models}))


MINIMAL_ROW = {
    "id": "m1",
    "path": "vendor/m1.gguf",
    "ctx": 4096,
    "kv": "f16",
    "family": "QWEN27",
    "backends": ["vulkan"],
}


def lines_of(cmd):
    """cmd_for joins with '\\n      '; split back into logical flag lines."""
    return [ln.strip() for ln in cmd.split("\n")]


# --------------------------------------------------------------------------------------------
# _load_models
# --------------------------------------------------------------------------------------------
def test_load_models_raises_when_yaml_missing(tmp_path):
    with pytest.raises(FileNotFoundError) as exc:
        generate._load_models()
    assert "models.yaml not found" in str(exc.value)


def test_load_models_minimal_row_tuple_shape_and_defaults(tmp_path):
    write_models_yaml(tmp_path, [MINIMAL_ROW])
    (row,) = generate._load_models()
    assert len(row) == 15
    (mid, path, ctx, kv, mtp, family, backends, np_val, templates,
     kv_unified, draft, spec_p_min, alias, ctk, hipfire_env) = row
    assert hipfire_env == {}, "a llama.cpp row carries no hipfire env"
    assert (mid, path, ctx, kv) == ("m1", "vendor/m1.gguf", 4096, "f16")
    assert mtp is False
    assert family is generate.QWEN27          # the actual sampler dict, not its name
    assert backends == ["vulkan"]
    assert np_val is None                     # -> caller falls back to the PARALLEL dict
    assert templates == [""]                  # "" = the gguf's embedded chat template
    assert kv_unified is False
    assert (draft, spec_p_min, alias, ctk) == (None, None, None, None)


def test_load_models_maps_every_known_family_to_its_sampler_dict(tmp_path):
    names = ["QWEN27", "QWEN35", "QWEN38", "QWEN38E", "GEM", "MUSEP", "QWEN35T"]
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, id=f"m{i}", family=n)
                                 for i, n in enumerate(names)])
    families = [row[5] for row in generate._load_models()]
    assert families == [generate.QWEN27, generate.QWEN35, generate.QWEN38, generate.QWEN38E,
                        generate.GEM, generate.MUSEP, generate.QWEN35T]


def test_load_models_rejects_unknown_family(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, family="NOPE")])
    with pytest.raises(ValueError, match="Unknown family NOPE for model m1"):
        generate._load_models()


def test_load_models_rejects_spec_p_min_without_speculation(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, spec_p_min=0.4)])
    with pytest.raises(ValueError, match="spec_p_min set but the row has no speculation"):
        generate._load_models()


def test_load_models_accepts_spec_p_min_with_mtp(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, mtp=True, spec_p_min=0.4)])
    (row,) = generate._load_models()
    assert row[11] == 0.4


def test_load_models_accepts_spec_p_min_with_draft(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW,
                                      draft={"path": "d.gguf", "type": "dflash"},
                                      spec_p_min=0.5)])
    (row,) = generate._load_models()
    assert row[10] == {"path": "d.gguf", "type": "dflash"}
    assert row[11] == 0.5


def test_load_models_spec_p_min_zero_is_treated_as_present_and_rejected(tmp_path):
    """0.0 is not None, so the no-speculation guard fires even though 0.0 means 'off'."""
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, spec_p_min=0.0)])
    with pytest.raises(ValueError, match="spec_p_min set but the row has no speculation"):
        generate._load_models()


def test_load_models_rejects_non_mapping_chat_template_kwargs(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, chat_template_kwargs=["a", "b"])])
    with pytest.raises(ValueError, match="chat_template_kwargs must be a mapping, got list"):
        generate._load_models()


def test_load_models_accepts_mapping_chat_template_kwargs(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW,
                                      chat_template_kwargs={"reasoning_strength": "xhigh"})])
    (row,) = generate._load_models()
    assert row[13] == {"reasoning_strength": "xhigh"}


def test_load_models_rejects_mtp_and_draft_together(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, mtp=True,
                                      draft={"path": "d.gguf", "type": "dflash"})])
    with pytest.raises(ValueError, match=r"`mtp` and `draft` both set --spec-type; pick one"):
        generate._load_models()


def test_load_models_rejects_draft_missing_required_keys(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, draft={"n_max": 4})])
    with pytest.raises(ValueError, match=r"draft is missing \['path', 'type'\]"):
        generate._load_models()


def test_load_models_falsy_draft_skips_validation(tmp_path):
    """draft: {} is falsy, so neither the mtp-conflict nor the missing-keys check runs."""
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, mtp=True, draft={})])
    (row,) = generate._load_models()
    assert row[10] == {}
    assert row[4] is True


def test_load_models_rejects_unknown_template(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, templates=["nope"])])
    with pytest.raises(ValueError, match="Unknown template 'nope' for model m1"):
        generate._load_models()


def test_load_models_accepts_known_templates(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, templates=["froggeric", "sharp"])])
    (row,) = generate._load_models()
    assert row[8] == ["froggeric", "sharp"]


def test_load_models_empty_templates_list_falls_back_to_embedded(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, templates=[])])
    (row,) = generate._load_models()
    assert row[8] == [""]


def test_load_models_kv_unified_is_coerced_to_bool(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, id="a", kv_unified=1),
                                 dict(MINIMAL_ROW, id="b", kv_unified=0)])
    a, b = generate._load_models()
    assert a[9] is True and b[9] is False


def test_load_models_mtp_int_is_preserved(tmp_path):
    write_models_yaml(tmp_path, [dict(MINIMAL_ROW, mtp=5)])
    (row,) = generate._load_models()
    assert row[4] == 5


def test_load_models_returns_empty_list_when_models_key_absent(tmp_path):
    (tmp_path / "models.yaml").write_text(yaml.safe_dump({"other": 1}))
    assert generate._load_models() == []


def test_load_models_on_empty_yaml_raises_attributeerror(tmp_path):
    """CHARACTERIZATION of a rough edge: an empty models.yaml parses to None and the
    `data.get(...)` call blows up with AttributeError rather than a friendly message."""
    (tmp_path / "models.yaml").write_text("")
    with pytest.raises(AttributeError):
        generate._load_models()


# --------------------------------------------------------------------------------------------
# cmd_for -- base shape
# --------------------------------------------------------------------------------------------
SAMPLER = "--temp 0.6 --top-p 0.95"


def base_cmd(**kw):
    kw = {"binref": "${vulkan}", "relpath": "v/m.gguf", "ctx": 4096, "kv": "f16",
          "mtp": False, "sampler": SAMPLER, **kw}
    return generate.cmd_for(**kw)


def test_cmd_for_base_line_order_and_contents():
    cmd = base_cmd()
    assert lines_of(cmd) == [
        "${vulkan}",
        f"--model {generate.MODELS_DIR}/v/m.gguf",
        "-c 4096 -ctk f16 -ctv f16",
        "-np 1",
        "${common}",
        SAMPLER,
    ]


def test_cmd_for_joins_lines_with_six_space_continuation():
    """The join string is load-bearing: the result is embedded under `cmd: |` in config.yaml."""
    assert "\n      " in base_cmd()
    assert base_cmd().count("\n") == 5


def test_cmd_for_uses_models_dir_prefix_for_the_target_gguf():
    assert f"--model {generate.MODELS_DIR}/sub/x.gguf" in base_cmd(relpath="sub/x.gguf")


def test_cmd_for_kv_quant_drives_both_ctk_and_ctv():
    assert "-ctk q8_0 -ctv q8_0" in base_cmd(kv="q8_0")


# --------------------------------------------------------------------------------------------
# cmd_for -- slots / kv_unified
# --------------------------------------------------------------------------------------------
def test_cmd_for_split_kv_multiplies_ctx_by_slots():
    cmd = base_cmd(slots=4)
    assert "-c 16384 -ctk f16 -ctv f16" in cmd
    assert "-np 4" in cmd
    assert "--kv-unified" not in cmd


def test_cmd_for_unified_kv_keeps_ctx_as_the_shared_pool():
    cmd = base_cmd(slots=4, kv_unified=True)
    assert "-c 4096 -ctk f16 -ctv f16" in cmd
    assert "-np 4" in cmd
    assert "--kv-unified" in cmd


def test_cmd_for_unified_flag_is_emitted_after_np_and_before_common():
    ls = lines_of(base_cmd(slots=2, kv_unified=True))
    assert ls.index("-np 2") < ls.index("--kv-unified") < ls.index("${common}")


def test_cmd_for_unified_kv_at_single_slot_still_emits_the_flag():
    assert "--kv-unified" in base_cmd(slots=1, kv_unified=True)


# --------------------------------------------------------------------------------------------
# cmd_for -- alias
# --------------------------------------------------------------------------------------------
def test_cmd_for_alias_is_emitted_between_model_and_ctx():
    ls = lines_of(base_cmd(alias="my-alias"))
    assert "-a my-alias" in ls
    assert ls.index(f"--model {generate.MODELS_DIR}/v/m.gguf") < ls.index("-a my-alias")
    assert ls.index("-a my-alias") < ls.index("-c 4096 -ctk f16 -ctv f16")


def test_cmd_for_no_alias_emits_no_alias_flag():
    assert "-a " not in base_cmd()


def test_cmd_for_empty_alias_is_treated_as_absent():
    assert "-a " not in base_cmd(alias="")


# --------------------------------------------------------------------------------------------
# cmd_for -- chat template file
# --------------------------------------------------------------------------------------------
def test_cmd_for_template_emits_chat_template_file_with_resolved_path():
    cmd = base_cmd(tpl="froggeric")
    assert f"--chat-template-file {generate.TEMPLATES['froggeric']}" in cmd


def test_cmd_for_template_flag_follows_the_sampler():
    ls = lines_of(base_cmd(tpl="sharp"))
    assert ls.index(SAMPLER) < ls.index(f"--chat-template-file {generate.TEMPLATES['sharp']}")


def test_cmd_for_empty_template_emits_nothing():
    assert "--chat-template-file" not in base_cmd(tpl="")


def test_cmd_for_unknown_template_raises_keyerror():
    """CHARACTERIZATION: cmd_for does not validate; _load_models is the only gate."""
    with pytest.raises(KeyError):
        base_cmd(tpl="nope")


# --------------------------------------------------------------------------------------------
# cmd_for -- chat_template_kwargs
# --------------------------------------------------------------------------------------------
def test_cmd_for_ctk_is_single_quoted_compact_json():
    cmd = base_cmd(ctk={"reasoning_strength": "xhigh", "n": 2})
    assert "--chat-template-kwargs '{\"reasoning_strength\":\"xhigh\",\"n\":2}'" in cmd


def test_cmd_for_ctk_absent_or_empty_emits_nothing():
    assert "--chat-template-kwargs" not in base_cmd()
    assert "--chat-template-kwargs" not in base_cmd(ctk={})


def test_cmd_for_ctk_line_comes_after_the_template_file_line():
    ls = lines_of(base_cmd(tpl="froggeric", ctk={"a": "b"}))
    tpl_i = ls.index(f"--chat-template-file {generate.TEMPLATES['froggeric']}")
    ctk_i = next(i for i, l in enumerate(ls) if l.startswith("--chat-template-kwargs"))
    assert tpl_i < ctk_i


# --------------------------------------------------------------------------------------------
# cmd_for -- mtp speculation
# --------------------------------------------------------------------------------------------
def test_cmd_for_mtp_true_emits_spec_type_without_depth():
    cmd = base_cmd(mtp=True)
    assert "--spec-type draft-mtp" in cmd
    assert "--spec-draft-n-max" not in cmd     # bool is not `type(...) is int`


def test_cmd_for_mtp_int_emits_explicit_draft_depth():
    cmd = base_cmd(mtp=6)
    assert "--spec-type draft-mtp" in cmd
    assert "--spec-draft-n-max 6" in cmd


def test_cmd_for_mtp_false_emits_no_spec_flags():
    cmd = base_cmd(mtp=False)
    assert "--spec-type" not in cmd
    assert "--spec-draft" not in cmd


def test_cmd_for_mtp_zero_is_falsy_and_emits_nothing():
    assert "--spec-type" not in base_cmd(mtp=0)


# --------------------------------------------------------------------------------------------
# cmd_for -- separate drafter
# --------------------------------------------------------------------------------------------
def test_cmd_for_draft_emits_type_path_and_default_ngl():
    cmd = base_cmd(draft={"path": "d/draft.gguf", "type": "dflash"})
    assert "--spec-type draft-dflash" in cmd
    assert f"-md {generate.MODELS_DIR}/d/draft.gguf" in cmd
    assert "--spec-draft-ngl all" in cmd
    assert "--spec-draft-n-max" not in cmd


def test_cmd_for_draft_n_max_and_explicit_ngl():
    cmd = base_cmd(draft={"path": "d.gguf", "type": "dflash", "n_max": 3, "ngl": 20})
    assert "--spec-draft-n-max 3" in cmd
    assert "--spec-draft-ngl 20" in cmd


def test_cmd_for_draft_n_max_zero_is_falsy_and_omitted():
    """CHARACTERIZATION: `if draft.get('n_max')` drops an explicit 0."""
    cmd = base_cmd(draft={"path": "d.gguf", "type": "dflash", "n_max": 0})
    assert "--spec-draft-n-max" not in cmd


def test_cmd_for_draft_ngl_zero_is_falsy_and_falls_back_to_all():
    """CHARACTERIZATION: `draft.get('ngl', 'all')` returns 0, which formats as 0 -- but a
    row asking for ngl 0 does get `--spec-draft-ngl 0`, unlike n_max."""
    cmd = base_cmd(draft={"path": "d.gguf", "type": "dflash", "ngl": 0})
    assert "--spec-draft-ngl 0" in cmd


def test_cmd_for_mtp_and_draft_together_emit_spec_type_twice():
    """CHARACTERIZATION: cmd_for does not enforce the exclusivity -- _load_models does.
    Called directly with both, it emits --spec-type twice (last one wins downstream)."""
    cmd = base_cmd(mtp=True, draft={"path": "d.gguf", "type": "dflash"})
    assert cmd.count("--spec-type") == 2


# --------------------------------------------------------------------------------------------
# cmd_for -- spec_p_min
# --------------------------------------------------------------------------------------------
def test_cmd_for_spec_p_min_emitted_with_mtp():
    assert "--spec-draft-p-min 0.4" in base_cmd(mtp=True, spec_p_min=0.4)


def test_cmd_for_spec_p_min_emitted_with_draft():
    cmd = base_cmd(draft={"path": "d.gguf", "type": "dflash"}, spec_p_min=0.55)
    assert "--spec-draft-p-min 0.55" in cmd


def test_cmd_for_spec_p_min_zero_is_still_emitted():
    """`is not None`, not truthiness -- an explicit 0.0 reaches the command line."""
    assert "--spec-draft-p-min 0.0" in base_cmd(mtp=True, spec_p_min=0.0)


def test_cmd_for_spec_p_min_without_speculation_is_still_emitted():
    """CHARACTERIZATION: cmd_for has no guard; only _load_models refuses the combination."""
    assert "--spec-draft-p-min 0.4" in base_cmd(mtp=False, spec_p_min=0.4)


def test_cmd_for_spec_p_min_is_the_last_line():
    ls = lines_of(base_cmd(mtp=True, spec_p_min=0.4, tpl="sharp", ctk={"a": 1}))
    assert ls[-1] == "--spec-draft-p-min 0.4"


def test_cmd_for_spec_p_min_none_emits_nothing():
    assert "--spec-draft-p-min" not in base_cmd(mtp=True)


# --------------------------------------------------------------------------------------------
# cmd_for -- full matrix smoke
# --------------------------------------------------------------------------------------------
def test_cmd_for_all_flags_on_line_order():
    cmd = generate.cmd_for("${rocm}", "v/m.gguf", 8192, "q8_0", 4, SAMPLER, slots=2,
                           tpl="froggeric", kv_unified=True,
                           draft=None, spec_p_min=0.4, alias="al", ctk={"k": "v"})
    assert lines_of(cmd) == [
        "${rocm}",
        f"--model {generate.MODELS_DIR}/v/m.gguf",
        "-a al",
        "-c 8192 -ctk q8_0 -ctv q8_0",
        "-np 2",
        "--kv-unified",
        "${common}",
        SAMPLER,
        f"--chat-template-file {generate.TEMPLATES['froggeric']}",
        "--chat-template-kwargs '{\"k\":\"v\"}'",
        "--spec-type draft-mtp",
        "--spec-draft-n-max 4",
        "--spec-draft-p-min 0.4",
    ]


def test_cmd_for_binref_is_passed_through_verbatim():
    assert base_cmd(binref="${rocm}").startswith("${rocm}\n")


# --------------------------------------------------------------------------------------------
# rerank_cmd_for / embed_cmd_for
# --------------------------------------------------------------------------------------------
def test_rerank_cmd_for_exact_lines():
    assert lines_of(generate.rerank_cmd_for("r/x.gguf", 8192, 8192, 4096)) == [
        "${vulkan}",
        f"--model {generate.MODELS_DIR}/r/x.gguf",
        "--rerank",
        "-c 8192 -b 4096 -ub 8192",
        "-np 1",
        "--host 127.0.0.1 -ngl 99 -fa on",
    ]


def test_rerank_cmd_for_never_uses_the_common_macro():
    """The RERANKERS table documents this: ${common} pins -ub 2048, which is a hard
    per-document ceiling for a rerank server."""
    assert "${common}" not in generate.rerank_cmd_for("r/x.gguf", 8192, 8192, 8192)


def test_embed_cmd_for_exact_lines_including_pooling():
    assert lines_of(generate.embed_cmd_for("e/y.gguf", 8192, 8192, 8192, "cls")) == [
        "${vulkan}",
        f"--model {generate.MODELS_DIR}/e/y.gguf",
        "--embedding",
        "--pooling cls",
        "-c 8192 -b 8192 -ub 8192",
        "-np 1",
        "--host 127.0.0.1 -ngl 99 -fa on",
    ]


def test_embed_cmd_for_never_uses_the_common_macro():
    assert "${common}" not in generate.embed_cmd_for("e/y.gguf", 8192, 8192, 8192, "mean")


# --------------------------------------------------------------------------------------------
# embed_blocks / rerank_blocks
# --------------------------------------------------------------------------------------------
FAKE_EMBEDDERS = [("emb-1", "e/y.gguf", 8192, 4096, 2048, "cls")]
FAKE_RERANKERS = [("rr-1", "r/x.gguf", 8192, 4096, 2048)]


def test_embed_blocks_yaml_block_shape(monkeypatch):
    monkeypatch.setattr(generate, "EMBEDDERS", FAKE_EMBEDDERS)
    monkeypatch.setattr(generate, "IDLE_TTL", 0)
    (block,) = list(generate.embed_blocks())
    ls = block.split("\n")
    assert ls[0] == '  "emb-1":'
    assert ls[1] == '    name: "emb-1  [vulkan, embed, ctx=8192, ub=4096, pooling=cls]"'
    assert ls[2] == "    cmd: |"
    assert ls[3] == "      ${vulkan}"
    assert "--pooling cls" in block
    assert "ttl:" not in block


def test_rerank_blocks_yaml_block_shape(monkeypatch):
    monkeypatch.setattr(generate, "RERANKERS", FAKE_RERANKERS)
    monkeypatch.setattr(generate, "IDLE_TTL", 0)
    (block,) = list(generate.rerank_blocks())
    ls = block.split("\n")
    assert ls[0] == '  "rr-1":'
    assert ls[1] == '    name: "rr-1  [vulkan, rerank, ctx=8192, ub=4096]"'
    assert ls[2] == "    cmd: |"
    assert "--rerank" in block
    assert "ttl:" not in block


def test_blocks_append_ttl_when_idle_ttl_nonzero(monkeypatch):
    monkeypatch.setattr(generate, "EMBEDDERS", FAKE_EMBEDDERS)
    monkeypatch.setattr(generate, "RERANKERS", FAKE_RERANKERS)
    monkeypatch.setattr(generate, "IDLE_TTL", 300)
    assert list(generate.embed_blocks())[0].endswith("\n    ttl: 300")
    assert list(generate.rerank_blocks())[0].endswith("\n    ttl: 300")


def test_blocks_yield_one_block_per_table_row(monkeypatch):
    monkeypatch.setattr(generate, "EMBEDDERS", FAKE_EMBEDDERS * 3)
    monkeypatch.setattr(generate, "RERANKERS", FAKE_RERANKERS * 2)
    assert len(list(generate.embed_blocks())) == 3
    assert len(list(generate.rerank_blocks())) == 2


def test_block_cmd_body_matches_the_cmd_helper(monkeypatch):
    monkeypatch.setattr(generate, "EMBEDDERS", FAKE_EMBEDDERS)
    monkeypatch.setattr(generate, "RERANKERS", FAKE_RERANKERS)
    monkeypatch.setattr(generate, "IDLE_TTL", 0)
    emb = list(generate.embed_blocks())[0]
    rer = list(generate.rerank_blocks())[0]
    assert generate.embed_cmd_for("e/y.gguf", 8192, 4096, 2048, "cls") in emb
    assert generate.rerank_cmd_for("r/x.gguf", 8192, 4096, 2048) in rer


# --------------------------------------------------------------------------------------------
# sync_opencode
# --------------------------------------------------------------------------------------------
def seed_cfg(tmp_path, cfg):
    path = tmp_path / "opencode.json"
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    return path


def test_sync_opencode_returns_none_when_config_missing(tmp_path):
    assert not generate.OPENCODE_CFG.exists()
    assert generate.sync_opencode([("a", 4096, None)]) is None
    assert not generate.OPENCODE_CFG.exists()      # and writes nothing


def test_sync_opencode_returns_none_when_provider_section_absent(tmp_path):
    path = seed_cfg(tmp_path, {"$schema": "s"})
    before = path.read_text()
    assert generate.sync_opencode([("a", 4096, None)]) is None
    assert path.read_text() == before


def test_sync_opencode_returns_none_when_llama_swap_provider_absent(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"ollama-local": {"models": {"x": {}}}}})
    before = path.read_text()
    assert generate.sync_opencode([("a", 4096, None)]) is None
    assert path.read_text() == before


def test_sync_opencode_returns_none_when_provider_is_json_null(tmp_path):
    """CHARACTERIZATION: an explicit `"llama-swap": null` is indistinguishable from absent."""
    seed_cfg(tmp_path, {"provider": {"llama-swap": None}})
    assert generate.sync_opencode([("a", 4096, None)]) is None


def test_sync_opencode_replaces_only_the_llama_swap_models_subtree(tmp_path):
    """The contract: every other provider and every other top-level key survives untouched."""
    original = {
        "$schema": "https://opencode.ai/config.json",
        "compaction": {"enabled": True, "threshold": 0.8},
        "provider": {
            "ollama-local": {
                "npm": "@ai-sdk/openai-compatible",
                "options": {"baseURL": "http://127.0.0.1:11434/v1"},
                "models": {"llama3": {"name": "llama3"}},
            },
            "llama-swap": {
                "npm": "@ai-sdk/openai-compatible",
                "options": {"baseURL": "http://127.0.0.1:9292/v1"},
                "models": {"old-model": {"name": "old-model"}},
            },
        },
        "theme": "opencode",
    }
    path = seed_cfg(tmp_path, original)
    generate.sync_opencode([("new-model", 4096, None)])
    after = json.loads(path.read_text())

    expected = json.loads(json.dumps(original))
    expected["provider"]["llama-swap"]["models"] = {
        "new-model": {"name": "new-model",
                      "limit": {"context": 4096, "output": 2048}}}
    assert after == expected

    # key order preserved too, top level and inside provider
    assert list(after) == list(original)
    assert list(after["provider"]) == list(original["provider"])
    # the sibling provider and the llama-swap sibling keys are byte-identical
    assert after["provider"]["ollama-local"] == original["provider"]["ollama-local"]
    assert after["provider"]["llama-swap"]["options"] == \
        original["provider"]["llama-swap"]["options"]
    assert after["provider"]["llama-swap"]["npm"] == original["provider"]["llama-swap"]["npm"]
    assert after["$schema"] == original["$schema"]
    assert after["compaction"] == original["compaction"]
    assert after["theme"] == original["theme"]


def test_sync_opencode_returns_sorted_added_and_removed(tmp_path):
    seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {"keep": {}, "drop-b": {},
                                                              "drop-a": {}}}}})
    added, removed = generate.sync_opencode(
        [("keep", 1, None), ("zz-new", 1, None), ("aa-new", 1, None)])
    assert added == ["aa-new", "zz-new"]
    assert removed == ["drop-a", "drop-b"]


def test_sync_opencode_reports_no_change_as_two_empty_lists(tmp_path):
    seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {"same": {"name": "same"}}}}})
    assert generate.sync_opencode([("same", 4096, None)]) == ([], [])


def test_sync_opencode_treats_missing_models_key_as_empty_before(tmp_path):
    seed_cfg(tmp_path, {"provider": {"llama-swap": {"npm": "x"}}})
    added, removed = generate.sync_opencode([("a", 1, None), ("b", 1, None)])
    assert (added, removed) == (["a", "b"], [])


def test_sync_opencode_entry_shape_name_and_limit(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("mid-ctx4k", 4096, None)])
    entry = json.loads(path.read_text())["provider"]["llama-swap"]["models"]["mid-ctx4k"]
    assert entry == {"name": "mid-ctx4k",
                     "limit": {"context": 4096, "output": 2048}}


def test_sync_opencode_output_limit_never_exceeds_half_the_window(tmp_path):
    """`output` is subtracted from `context` by opencode, so it may never crowd out the prompt.

    The regression this pins: a flat 32768 was emitted for EVERY row, which was invisible while
    every row was 131072+ ctx and became 4096 usable input tokens on the first 36864-ctx row.
    """
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("small", 36864, None), ("big", 200000, None)])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    # below the crossover the half-window guard binds ...
    assert models["small"]["limit"]["output"] == 18432
    # ... at and above it the constant still wins, so no pre-existing row moves
    assert models["big"]["limit"]["output"] == generate.OPENCODE_MAX_OUTPUT


def test_sync_opencode_output_limit_crossover_is_twice_the_constant(tmp_path):
    """The guard binds strictly below ctx 65536 and never at or above it."""
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    crossover = generate.OPENCODE_MAX_OUTPUT * 2
    generate.sync_opencode([("under", crossover - 2, None),
                            ("at", crossover, None),
                            ("over", crossover + 2, None)])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    assert models["under"]["limit"]["output"] == (crossover - 2) // 2
    assert models["at"]["limit"]["output"] == generate.OPENCODE_MAX_OUTPUT
    assert models["over"]["limit"]["output"] == generate.OPENCODE_MAX_OUTPUT


def test_sync_opencode_output_limit_is_always_below_context(tmp_path):
    """The invariant the whole guard exists to hold, over a spread of real and extreme windows."""
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    ctxs = [512, 4096, 36864, 65536, 114688, 131072, 150000, 200000, 262144]
    generate.sync_opencode([(f"m{c}", c, None) for c in ctxs])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    for c in ctxs:
        lim = models[f"m{c}"]["limit"]
        assert lim["output"] < lim["context"], f"ctx {c} advertises output >= context"
        assert lim["output"] > 0, f"ctx {c} advertises a non-positive output"


def test_sync_opencode_includes_variants_when_present(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    variants = {"low": {"reasoning_effort": "low"}}
    generate.sync_opencode([("a", 4096, variants)])
    entry = json.loads(path.read_text())["provider"]["llama-swap"]["models"]["a"]
    assert entry["variants"] == variants


def test_sync_opencode_omits_variants_key_when_falsy(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("a", 1, None), ("b", 1, {})])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    assert "variants" not in models["a"]
    assert "variants" not in models["b"]


def test_sync_opencode_writes_indent_2_json_with_trailing_newline(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("a", 4096, None)])
    text = path.read_text()
    assert text.endswith("}\n")
    assert '\n  "provider": {' in text


def test_sync_opencode_empty_entries_clears_the_model_list(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {"gone": {}}},
                                            "other": {"models": {"stay": {}}}}})
    added, removed = generate.sync_opencode([])
    assert (added, removed) == ([], ["gone"])
    cfg = json.loads(path.read_text())
    assert cfg["provider"]["llama-swap"]["models"] == {}
    assert cfg["provider"]["other"]["models"] == {"stay": {}}


def test_sync_opencode_last_entry_wins_on_duplicate_ids(tmp_path):
    """CHARACTERIZATION: the dict comprehension silently collapses duplicates."""
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("dup", 1000, None), ("dup", 2000, None)])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    assert list(models) == ["dup"]
    assert models["dup"]["limit"]["context"] == 2000


def test_sync_opencode_preserves_entry_order_from_entries(tmp_path):
    path = seed_cfg(tmp_path, {"provider": {"llama-swap": {"models": {}}}})
    generate.sync_opencode([("z", 1, None), ("a", 1, None), ("m", 1, None)])
    models = json.loads(path.read_text())["provider"]["llama-swap"]["models"]
    assert list(models) == ["z", "a", "m"]


# --------------------------------------------------------------------------------------------
# hipfire rows must share one ctx
# --------------------------------------------------------------------------------------------
def _hipfire_row(mid, ctx):
    """A minimal hipfire row. hipfire rows take a tag, never a gguf `path`."""
    return {"id": mid, "hipfire_tag": f"tag/{mid}", "ctx": ctx, "kv": "q8_0",
            "family": "QWEN38", "backends": ["hipfire"]}


def test_load_models_rejects_hipfire_rows_with_different_ctx(tmp_path):
    """hipfire has no per-row cap: `hipfire serve` takes no --max-seq and memory.max_seq is a
    schema field with no HIPFIRE_* env alias. The enforced cap is the GLOBAL config.toml, so two
    hipfire rows advertising different ctx guarantee one of them lies to opencode and the daemon
    answers `HTTP 400: request exceeds loaded KV budget`."""
    write_models_yaml(tmp_path, [_hipfire_row("a", 225280), _hipfire_row("b", 163840)])
    with pytest.raises(ValueError) as exc:
        generate._load_models()
    assert "must all share one ctx" in str(exc.value)


def test_load_models_accepts_hipfire_rows_with_matching_ctx(tmp_path):
    write_models_yaml(tmp_path, [_hipfire_row("a", 225280), _hipfire_row("b", 225280)])
    rows = generate._load_models()
    assert [r[2] for r in rows] == [225280, 225280]


def test_load_models_allows_llamacpp_rows_to_differ_in_ctx(tmp_path):
    """The constraint is hipfire-only: llama.cpp rows carry -c per process, so they may differ."""
    write_models_yaml(tmp_path, [
        dict(MINIMAL_ROW, id="a", ctx=131072),
        dict(MINIMAL_ROW, id="b", ctx=225280),
    ])
    rows = generate._load_models()
    assert sorted(r[2] for r in rows) == [131072, 225280]
