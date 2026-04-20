from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F4",
    "oracle_graph": {
        "nodes": [
            "crates/core/src/lib.rs",
            "crates/core/src/analyze.rs",
            "crates/ffi/src/lib.rs",
            "python/pkg/_bindings.py",
        ],
        "node_aliases": {
            "core": "crates/core/src/lib.rs",
            "ffi": "crates/ffi/src/lib.rs",
        },
        "edges": [
            {"src": "crates/core/src/lib.rs", "dst": "crates/core/src/analyze.rs", "kind": "re-exports"},
            {"src": "python/pkg/_bindings.py", "dst": "crates/ffi/src/lib.rs", "kind": "ffi_call"},
        ],
    },
    "output_format_checks": {
        "mermaid_diagram_count_min": 3,
        "mermaid_regex": r"```mermaid[\s\S]*?```",
        "file_inventory_regex": [
            "crates/core/src/lib\\.rs",
            "crates/ffi/src/lib\\.rs",
            "python/pkg/_bindings\\.py",
        ],
        "ffi_boundary_regex": [
            r"crates/ffi/src/lib\.rs[\s\S]{0,120}python/pkg/_bindings\.py|python/pkg/_bindings\.py[\s\S]{0,120}crates/ffi/src/lib\.rs"
        ],
    },
    "primary_metric": {
        "weights": {"node": 0.4, "edge": 0.5, "hallucination_penalty": 0.1},
        "pass_threshold": 0.70,
    },
}


GOOD_OUTPUT = """
(a) File inventory
1. crates/core/src/lib.rs
2. crates/core/src/analyze.rs
3. crates/ffi/src/lib.rs
4. python/pkg/_bindings.py

```mermaid
graph TD
crates/core/src/lib.rs -->|re-exports| crates/core/src/analyze.rs
```

```mermaid
graph TD
python/pkg/_bindings.py -->|ffi| crates/ffi/src/lib.rs
```

```mermaid
graph TD
crates/ffi/src/lib.rs -->|boundary| python/pkg/_bindings.py
```

(c) FFI boundary note: crates/ffi/src/lib.rs ↔ python/pkg/_bindings.py
"""


BAD_OUTPUT = """
(a) File inventory
1. crates/core/src/lib.rs
2. src/ghost.rs

```mermaid
graph TD
crates/core/src/lib.rs --> src/ghost.rs
```
"""


def test_score_f4_known_good_matches_graph():
    score = g.score_f4_oracle_graph(GOOD_OUTPUT, TRUTH)
    assert score["mermaid_diagram_count"] == 3
    assert score["ffi_boundary_present"] is True
    assert score["primary_score"] > 0.85
    assert score["primary_pass"] is True


def test_score_f4_hallucinated_nodes_and_missing_diagrams_score_low():
    score = g.score_f4_oracle_graph(BAD_OUTPUT, TRUTH)
    assert "src/ghost.rs" in score["hallucinated_nodes"]
    assert score["mermaid_diagram_count"] == 1
    assert score["primary_score"] < 0.4
    assert score["primary_pass"] is False


def test_score_f4_empty_output_returns_zero():
    score = g.score_f4_oracle_graph("", TRUTH)
    assert score["node_match_rate"] == 0.0
    assert score["edge_match_rate"] == 0.0
    assert score["primary_score"] == 0.0


SHORT_NAME_OUTPUT = """
(a) File inventory
1. crates/core/src/lib.rs
2. crates/core/src/analyze.rs
3. crates/ffi/src/lib.rs
4. python/pkg/_bindings.py

Also note: analyze.rs is re-exported by lib.rs and _bindings.py calls into lib.rs via FFI.

```mermaid
graph TD
crates/core/src/lib.rs -->|re-exports| crates/core/src/analyze.rs
```

```mermaid
graph TD
python/pkg/_bindings.py -->|ffi| crates/ffi/src/lib.rs
```

```mermaid
graph TD
crates/ffi/src/lib.rs -->|boundary| python/pkg/_bindings.py
```

(c) FFI boundary note: crates/ffi/src/lib.rs ↔ python/pkg/_bindings.py
"""


def test_score_f4_bare_basenames_in_oracle_not_flagged_as_hallucinations():
    """H4: bare filename refs whose basename IS in the oracle graph must
    not count as hallucinated. Short form (`analyze.rs`) is a legitimate
    citation when the full-path form is also present.
    """
    score = g.score_f4_oracle_graph(SHORT_NAME_OUTPUT, TRUTH)
    # "analyze.rs" and "lib.rs" appear bare but their basenames are in oracle nodes
    assert "analyze.rs" not in score["hallucinated_nodes"]
    assert "lib.rs" not in score["hallucinated_nodes"]
    assert score["hallucination_penalty"] == 0.0
