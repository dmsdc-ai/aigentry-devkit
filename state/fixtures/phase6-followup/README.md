# Phase 6 Q4 Fixtures (H11-H14)

## Overview
Replaces ceiling fixtures H2, H3, and H5 with 4 new domain-diverse fixtures aiming for a target difficulty of `q ∈ [0.5, 0.85]`. Designed explicitly to comply with the Q3 output-style asymmetry rule to avoid formatting-related grader bias.

## Domains Covered
- **H11**: `structured-data-extraction` (Information extraction from unstructured reports)
- **H12**: `multilingual-summarization` (Semantic synthesis from mixed-language contexts)
- **H13**: `schema-strict-output` (Configuration payload generation)
- **H14**: `agentic-multi-step-tool-use` (Tool selection and ordering without format traps)

## Q3 Compliance (Format Exemption)
Each fixture explicitly documents format exemption rules in its `metadata.json`. Graders for these fixtures MUST implement a canonicalization pre-step:
- **H11**: Normalizes JSON and markdown tables into relation tuples.
- **H12**: Evaluates pure semantic presence of facts, disregarding list styles or paragraphs.
- **H13**: Parses content interchangeably as JSON or YAML, stripping code blocks.
- **H14**: Extracts tool sequence via regex, ignoring any backticks or numbering (explicitly avoiding the NB3 trap).

## Out-of-Grid Pilot Calibration Plan
To confirm target difficulty `q ∈ [0.5, 0.85]` prior to the pre-reg tag, we recommend the following 20-trial pilot:
- **Config**: 4 fixtures × 1 mode (Mode D) × 5 seeds.
- **Why Mode D**: Mode D is the promotion candidate for Phase 6 Q2 and provides a stable, non-chained baseline to evaluate base fixture difficulty. Evaluating 5 seeds ensures robustness against variance, providing a highly reliable estimate of base difficulty before applying to chained architectures.
- **Acceptance Criterion**: `μq` for each fixture falls within `[0.5, 0.85]`.
- **Fallback**: Any fixture failing this bound will undergo 1 in-place revision.
