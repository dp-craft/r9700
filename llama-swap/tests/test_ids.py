"""Characterization tests for generate.py's identity / labelling / variants layer.

Scope: ctx_label, full_id, entries_for, variants_for and the TEMPLATE_TAG /
TEMPLATE_VARIANTS / MUSE_VARIANTS tables they read.

These tests pin the behaviour the code has TODAY. Where the current behaviour looks
wrong, the test still asserts the current output and says so in its docstring --
generate.py is never modified to make a test pass.

Nothing here writes: only `full_id` & friends are exercised, and main() runs solely
under `__main__`.
"""
import itertools

import pytest

import generate as g


# --------------------------------------------------------------------------- #
# ctx_label
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("ctx, expected", [
    (1024, "1k"),
    (2048, "2k"),
    (65536, "64k"),
    (131072, "128k"),
    (204800, "200k"),
    (0, "0k"),            # 0 % 1024 == 0, so zero is labelled "0k", not "0"
    (512, "512"),         # below one KiB -> raw number
    (1536, "1536"),       # not a KiB multiple -> raw number
    (100000, "100000"),
])
def test_ctx_label(ctx, expected):
    assert g.ctx_label(ctx) == expected


def test_ctx_label_returns_str_for_every_branch():
    assert isinstance(g.ctx_label(1024), str)
    assert isinstance(g.ctx_label(1000), str)


# --------------------------------------------------------------------------- #
# full_id -- individual tags
# --------------------------------------------------------------------------- #

BASE = dict(mid="mdl", ctx=131072, kv="f16", mtp=False, be="vulkan")


def _id(**over):
    return g.full_id(**{**BASE, **over})


def test_full_id_minimal_is_mid_plus_ctx():
    assert _id() == "mdl-ctx128k"


def test_full_id_kvq8_tag_only_for_q8_0():
    assert _id(kv="q8_0") == "mdl-ctx128k-kvq8"
    assert _id(kv="f16") == "mdl-ctx128k"


def test_full_id_kv_other_than_q8_0_is_untagged():
    """SUSPECTED BUG (pinned as-is): only the literal 'q8_0' is tagged, so any other
    non-f16 KV type emits the same id as f16."""
    assert _id(kv="q4_0") == _id(kv="f16")


def test_full_id_mtp_tag():
    assert _id(mtp=True) == "mdl-ctx128k-mtp"


def test_full_id_draft_tag_is_the_drafter_type():
    assert _id(draft={"path": "d.gguf", "type": "q3d"}) == "mdl-ctx128k-q3d"


def test_full_id_rocm_tag():
    assert _id(be="rocm") == "mdl-ctx128k-rocm"


@pytest.mark.parametrize("tpl, tag", sorted(g.TEMPLATE_TAG.items()))
def test_full_id_template_tag_comes_from_TEMPLATE_TAG(tpl, tag):
    assert _id(tpl=tpl) == f"mdl-ctx128k-{tag}"


def test_full_id_unknown_template_raises_keyerror():
    with pytest.raises(KeyError):
        _id(tpl="not-a-template")


@pytest.mark.parametrize("key", ["reasoning_effort", "reasoning_strength"])
def test_full_id_pinned_effort_tag(key):
    assert _id(ctk={key: "xhigh"}) == "mdl-ctx128k-eff-xhigh"


def test_full_id_effort_and_strength_share_one_eff_prefix():
    """SUSPECTED BUG (pinned as-is): Qwen's `reasoning_effort` and Muse's
    `reasoning_strength` both render as `eff-<value>`, so two rows pinning different
    template VARIABLES to the same value collide on one id."""
    assert _id(ctk={"reasoning_effort": "low"}) == _id(ctk={"reasoning_strength": "low"})


def test_full_id_both_effort_keys_emit_two_tags_in_fixed_order():
    """Order comes from the loop (effort, then strength), not from dict insertion order."""
    assert _id(ctk={"reasoning_effort": "a", "reasoning_strength": "b"}) \
        == _id(ctk={"reasoning_strength": "b", "reasoning_effort": "a"}) \
        == "mdl-ctx128k-eff-a-eff-b"


def test_full_id_nopreserve_only_when_preserve_thinking_is_false():
    assert _id(ctk={"preserve_thinking": False}) == "mdl-ctx128k-nopreserve"
    assert _id(ctk={"preserve_thinking": True}) == "mdl-ctx128k"
    assert _id(ctk={}) == "mdl-ctx128k"


def test_full_id_untagged_pinned_kwargs_collide_with_unpinned():
    """SUSPECTED BUG (pinned as-is): only reasoning_effort / reasoning_strength /
    preserve_thinking=False reach the name, so a row pinning any OTHER template kwarg
    is indistinguishable from a row pinning nothing."""
    assert _id(ctk=None) == _id(ctk={"enable_thinking": False})
    assert _id(ctk=None) == _id(ctk={"preserve_thinking": True})


def test_full_id_purpose_is_the_trailing_tag():
    assert _id(purpose="planning").endswith("-planning")
    assert _id(kv="q8_0", mtp=True, purpose="coding", tpl="froggeric",
               ctk={"reasoning_effort": "low"}).endswith("-coding")


def test_full_id_tag_order_is_documented_order():
    """<mid>-ctx<N>[-kvq8][-mtp|-<drafter>][-rocm][-<tpl>][-eff-<level>][-nopreserve][-<purpose>]"""
    assert g.full_id("mdl", 131072, "q8_0", True, "rocm", "coding", "froggeric", None,
                     {"reasoning_effort": "xhigh", "preserve_thinking": False}) \
        == "mdl-ctx128k-kvq8-mtp-rocm-frog-eff-xhigh-nopreserve-coding"


def test_full_id_draft_takes_the_speculation_slot_ahead_of_backend():
    assert g.full_id("mdl", 100000, "q8_0", False, "vulkan", "planning", "sharp",
                     {"path": "d.gguf", "type": "eagle"}, {"reasoning_strength": "low"}) \
        == "mdl-ctx100000-kvq8-eagle-sharp-eff-low-planning"


def test_full_id_drafter_literally_named_mtp_collides_with_the_mtp_flag():
    """SUSPECTED BUG (pinned as-is). _load_models() refuses `mtp` AND `draft` on one
    row, so this is latent rather than reachable today."""
    assert _id(mtp=True) == _id(mtp=False, draft={"path": "d.gguf", "type": "mtp"})


# --------------------------------------------------------------------------- #
# full_id -- the collision invariant (the docstring's load-bearing claim)
# --------------------------------------------------------------------------- #

_MATRIX_DIMS = dict(
    mid=["mdl-a", "mdl-b"],
    ctx=[65536, 131072],
    kv=["f16", "q8_0"],
    spec=[(False, None),
          (True, None),
          (False, {"path": "d.gguf", "type": "q3d"}),
          (False, {"path": "d.gguf", "type": "eagle"})],
    be=["vulkan", "rocm"],
    purpose=["", "coding", "planning"],
    tpl=["", "froggeric", "sharp"],
    ctk=[None,
         {"reasoning_effort": "low"},
         {"reasoning_effort": "xhigh"},
         {"reasoning_effort": "xhigh", "preserve_thinking": False},
         {"reasoning_strength": "medium"}],
)


def _matrix_ids():
    keys = list(_MATRIX_DIMS)
    for combo in itertools.product(*(_MATRIX_DIMS[k] for k in keys)):
        c = dict(zip(keys, combo))
        mtp, draft = c.pop("spec")
        yield g.full_id(c["mid"], c["ctx"], c["kv"], mtp, c["be"],
                        c["purpose"], c["tpl"], draft, c["ctk"])


def test_full_id_is_injective_over_a_realistic_argument_matrix():
    """THE invariant full_id's docstring is about: every combination of arguments that
    changes what the row RUNS must produce a distinct id."""
    ids = list(_matrix_ids())
    assert len(ids) == 2880                      # guard: the matrix did not shrink
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    assert dupes == [], f"colliding ids: {dupes[:10]}"


def test_full_id_matrix_ids_are_shell_and_yaml_safe():
    bad = [i for i in _matrix_ids() if not all(ch.isalnum() or ch in "-._" for ch in i)]
    assert bad == []


def test_full_id_is_deterministic():
    args = ("mdl", 131072, "q8_0", True, "rocm", "coding", "froggeric", None,
            {"reasoning_effort": "xhigh"})
    assert g.full_id(*args) == g.full_id(*args)


# --------------------------------------------------------------------------- #
# entries_for
# --------------------------------------------------------------------------- #

def test_entries_for_vulkan_yields_one_entry_per_purpose():
    out = list(g.entries_for("mdl", 1024, "f16", False, g.QWEN27, "vulkan"))
    assert [(fid, tag) for fid, tag, _ in out] == [
        ("mdl-ctx1k-coding", "coding"),
        ("mdl-ctx1k-planning", "planning"),
    ]


def test_entries_for_vulkan_samplers_are_the_purposes_values():
    out = list(g.entries_for("mdl", 1024, "f16", False, g.QWEN27, "vulkan"))
    assert [s for _, _, s in out] == list(g.QWEN27.values())


@pytest.mark.parametrize("purposes", [g.GEM, g.MUSEP, g.QWEN38E, g.QWEN35T])
def test_entries_for_vulkan_single_recipe_gets_no_purpose_suffix(purposes):
    (fid, tag, sampler), = g.entries_for("mdl", 1024, "f16", False, purposes, "vulkan")
    assert fid == "mdl-ctx1k"
    assert tag == ""
    assert sampler == next(iter(purposes.values()))


def test_entries_for_rocm_yields_exactly_one_entry_without_a_purpose_tag():
    out = list(g.entries_for("mdl", 1024, "f16", False, g.QWEN27, "rocm"))
    assert out == [("mdl-ctx1k-rocm", "", g.QWEN27["coding"])]


def test_entries_for_rocm_prefers_coding_then_falls_back_to_the_first_recipe():
    (_, _, sampler), = g.entries_for("mdl", 1024, "f16", False,
                                     {"planning": "P", "eval": "E"}, "rocm")
    assert sampler == "P"
    (_, _, sampler), = g.entries_for("mdl", 1024, "f16", False, g.QWEN38E, "rocm")
    assert sampler == g.QWEN38E["eval"]


def test_entries_for_forwards_every_id_shaping_argument():
    (fid, _, _), = g.entries_for("mdl", 131072, "q8_0", True, g.GEM, "rocm",
                                 tpl="froggeric", ctk={"reasoning_effort": "low"})
    assert fid == "mdl-ctx128k-kvq8-mtp-rocm-frog-eff-low"


def test_entries_for_is_a_generator():
    out = g.entries_for("mdl", 1024, "f16", False, g.QWEN27, "vulkan")
    assert iter(out) is out


def test_entries_for_unknown_backend_takes_the_rocm_branch_but_gets_no_rocm_tag():
    """SUSPECTED BUG (pinned as-is): the branch is `if be == "vulkan"` / else, while the
    id tag is `if be == "rocm"`. A third backend name would collide with the vulkan id
    of a single-recipe model."""
    (fid, tag, _), = g.entries_for("mdl", 1024, "f16", False, g.QWEN27, "cuda")
    assert (fid, tag) == ("mdl-ctx1k", "")
    (vulkan_fid, _, _), = g.entries_for("mdl", 1024, "f16", False, g.GEM, "vulkan")
    assert fid == vulkan_fid


# --------------------------------------------------------------------------- #
# variants_for
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("tpl", sorted(g.TEMPLATES))
@pytest.mark.parametrize("purposes", [g.QWEN27, g.GEM, g.MUSEP])
def test_variants_for_any_fixed_template_advertises_TEMPLATE_VARIANTS(tpl, purposes):
    """A fixed template wins over the Muse check -- tpl is tested first."""
    assert g.variants_for(tpl, purposes) is g.TEMPLATE_VARIANTS


def test_variants_for_muse_on_its_embedded_template_advertises_MUSE_VARIANTS():
    assert g.variants_for("", g.MUSEP) is g.MUSE_VARIANTS


@pytest.mark.parametrize("purposes", [g.QWEN27, g.QWEN35, g.QWEN38, g.QWEN38E,
                                      g.GEM, g.QWEN35T])
def test_variants_for_embedded_template_non_muse_advertises_nothing(purposes):
    assert g.variants_for("", purposes) is None


def test_variants_for_muse_check_is_identity_not_equality():
    """Characterization: `purposes is MUSEP`. An equal-but-distinct dict gets None."""
    assert g.variants_for("", dict(g.MUSEP)) is None


def test_variants_for_pinned_reasoning_effort_suppresses_template_variants():
    assert g.variants_for("froggeric", g.QWEN27, {"reasoning_effort": "xhigh"}) is None


def test_variants_for_pinned_reasoning_strength_suppresses_muse_variants():
    assert g.variants_for("", g.MUSEP, {"reasoning_strength": "low"}) is None


def test_variants_for_suppression_is_per_key_not_cross_key():
    """A pinned reasoning_strength does not suppress the reasoning_effort surface, and
    vice versa -- each branch checks only its own key."""
    assert g.variants_for("froggeric", g.QWEN27, {"reasoning_strength": "low"}) \
        is g.TEMPLATE_VARIANTS
    assert g.variants_for("", g.MUSEP, {"reasoning_effort": "low"}) is g.MUSE_VARIANTS


@pytest.mark.parametrize("ctk", [None, {}, {"preserve_thinking": False},
                                 {"enable_thinking": False}])
def test_variants_for_unrelated_or_empty_ctk_does_not_suppress(ctk):
    assert g.variants_for("froggeric", g.QWEN27, ctk) is g.TEMPLATE_VARIANTS


def test_variants_for_returns_the_shared_module_level_table():
    """Characterization: the caller receives the module global by reference, not a copy,
    so anything that mutated it would corrupt every other entry."""
    assert g.variants_for("sharp", g.QWEN38) is g.variants_for("froggeric", g.QWEN35)


# --------------------------------------------------------------------------- #
# the data tables the above read
# --------------------------------------------------------------------------- #

def test_every_known_template_has_a_short_tag():
    assert set(g.TEMPLATE_TAG) >= set(g.TEMPLATES)


def test_template_tags_are_unique_and_id_safe():
    assert len(set(g.TEMPLATE_TAG.values())) == len(g.TEMPLATE_TAG)
    assert all(t.isalnum() for t in g.TEMPLATE_TAG.values())


def test_template_variants_rungs():
    assert sorted(g.TEMPLATE_VARIANTS) == [
        "high", "low", "medium", "none", "xhigh", "xhigh-no-preserve"]


@pytest.mark.parametrize("name, effort", [
    ("none", "none"), ("low", "low"), ("medium", "medium"),
    ("high", "high"), ("xhigh", "xhigh"), ("xhigh-no-preserve", "xhigh"),
])
def test_template_variants_use_reasoning_effort(name, effort):
    assert g.TEMPLATE_VARIANTS[name]["chat_template_kwargs"]["reasoning_effort"] == effort


@pytest.mark.parametrize("name, budget", [
    ("low", 2048), ("medium", 4096), ("high", 8192),
    ("xhigh", 32768), ("xhigh-no-preserve", 32768),
])
def test_template_variants_reasoning_budget_ladder(name, budget):
    assert g.TEMPLATE_VARIANTS[name]["reasoning_budget_tokens"] == budget


def test_template_variant_none_carries_no_budget():
    assert "reasoning_budget_tokens" not in g.TEMPLATE_VARIANTS["none"]


def test_only_the_no_preserve_rung_sets_preserve_thinking():
    setters = [n for n, v in g.TEMPLATE_VARIANTS.items()
               if "preserve_thinking" in v["chat_template_kwargs"]]
    assert setters == ["xhigh-no-preserve"]
    assert g.TEMPLATE_VARIANTS["xhigh-no-preserve"]["chat_template_kwargs"][
        "preserve_thinking"] is False


def test_muse_variants_rungs_have_no_none_level():
    assert sorted(g.MUSE_VARIANTS) == ["high", "low", "medium", "xhigh"]


@pytest.mark.parametrize("name", sorted(g.MUSE_VARIANTS))
def test_muse_variants_use_reasoning_strength_and_no_budget(name):
    variant = g.MUSE_VARIANTS[name]
    assert variant["chat_template_kwargs"] == {"reasoning_strength": name}
    assert "reasoning_budget_tokens" not in variant


def test_muse_and_template_variant_surfaces_are_disjoint_keys():
    muse_keys = {k for v in g.MUSE_VARIANTS.values() for k in v["chat_template_kwargs"]}
    tpl_keys = {k for v in g.TEMPLATE_VARIANTS.values() for k in v["chat_template_kwargs"]}
    assert muse_keys == {"reasoning_strength"}
    assert "reasoning_strength" not in tpl_keys


# --------------------------------------------------------------------------- #
# the live models.yaml table, driven through the same layer main() uses
# --------------------------------------------------------------------------- #

def _live_entries():
    for (mid, _relpath, ctx, kv, mtp, purposes, backends, _np, templates,
         _kvu, draft, _spm, _alias, ctk, _hfenv) in g.MODELS:
        for tpl in templates:
            for be in backends:
                for fid, tag, sampler in g.entries_for(mid, ctx, kv, mtp, purposes, be,
                                                       tpl, draft, ctk):
                    yield fid, tpl, purposes, ctk, tag, sampler


def test_live_model_table_produces_unique_ids():
    ids = [e[0] for e in _live_entries()]
    assert ids, "models.yaml produced no entries"
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    assert dupes == [], f"colliding ids in models.yaml: {dupes}"


def test_live_ids_are_non_empty_and_id_safe():
    for fid, *_ in _live_entries():
        assert fid and all(ch.isalnum() or ch in "-._" for ch in fid), fid


def test_live_entries_advertise_only_known_variant_tables():
    for _fid, tpl, purposes, ctk, _tag, _sampler in _live_entries():
        assert g.variants_for(tpl, purposes, ctk) in (
            None, g.TEMPLATE_VARIANTS, g.MUSE_VARIANTS)


def test_live_entries_never_advertise_a_variant_a_pinned_row_contradicts():
    """The invariant variants_for exists for: a row whose id carries an `eff-` tag must
    not also advertise the matching per-request knob."""
    for fid, tpl, purposes, ctk, _tag, _sampler in _live_entries():
        variants = g.variants_for(tpl, purposes, ctk)
        if variants is None:
            continue
        advertised = {k for v in variants.values() for k in v["chat_template_kwargs"]}
        pinned = set(ctk or ())
        assert not (advertised & pinned & {"reasoning_effort", "reasoning_strength"}), fid
