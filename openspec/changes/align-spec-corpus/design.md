# Design: align-spec-corpus

## Context

See proposal.md — Why. This change edits spec text and repo docs only;
product behavior does not move. The full evaluation that drove it is
`evaluation.md` in this directory (findings F1–F32, proposals P1–P18,
all 18 adopted by the owner on 2026-08-30). The deltas in `specs/` are
the change's substance; the apply phase's work is (a) confirming the
handful of contract details the deltas transcribe from the
implementation, (b) binding every newly stated scenario to a test, and
(c) the non-spec file edits (config rule, provider intro, Purpose
lines, blackbox entry).

## Goals / Non-Goals

- **Goals**: corpus-level coherence (no contradictions, single owners
  for shared rules), self-containment (present contract only), seeded
  specs for the anchors other specs already reference normatively, and
  a scenario↔test pairing for everything the deltas state.
- **Non-Goals**: no product behavior change, no generated SQL change,
  no new features. If going green on any scenario would require
  changing package source behavior, that is a divergence tripwire —
  stop and escalate, per config.yaml's apply guidance.

## Decisions

- **Split and move now, while the frontier is empty.** Requirement
  splits (P9) and the codec-rule move (P8) rename/relocate headings
  that delta specs use as merge keys. There are zero active changes, so
  no in-flight delta references them — this is the cheapest moment.
  Alternative (split lazily on next touch) rejected: it re-couples
  every future change to a corpus-maintenance concern.
- **Codec rules live in snapshot-format.** After P7 it is the state
  description of the stored format; decode strictness/leniency is
  format-evolution policy, not builder behavior. query-builder keeps
  one-line cross-references.
- **Growth-model reinterpretation, codified by practice.** A normative
  reference from another spec counts as "touched", so seeding
  `diagnostics`, `migration-format`, and the `generate`/`verify`
  requirements enforces the never-retroactive model rather than
  violating it. Seeds are scoped to the referenced surface only —
  neither new capability documents anything no spec already leaned on.
- **Measured facts stay inline, unlabeled.** SQLSTATE codes, measured
  corruption shapes, and postgres version observations keep their
  content; issue numbers, change ids, M/D labels, and renaming
  narratives leave. Provenance lives in the change archive, which this
  change does not rewrite.

## Risks / Trade-offs

- [MODIFIED deltas carry full requirement text, so a concurrent main-
  spec edit would conflict at sync] → frontier is empty and this change
  is the only active one; archive promptly.
- [Splits redistribute scenarios; sync's agent-driven merge could
  misplace one] → piece review reads `openspec show --diff` for every
  touched capability before archive.
- [Seeded requirements might overstate what the implementation does] →
  every seed task binds scenarios to existing tests first and escalates
  any mismatch (tripwire) instead of adjusting the code.

## Open Questions

None blocking. Three contract details are settled inside `[design]`
tasks during apply (on-conflict zero-target behavior, IntervalValue
normalization example, chain `with()` root naming); each adjusts delta
text only, never package source.
