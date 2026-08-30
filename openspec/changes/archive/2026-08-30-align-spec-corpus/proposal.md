# Proposal: align-spec-corpus

## Why

An isolated external evaluation of `openspec/specs/` (12 files, 102
requirements, 272 scenarios — evaluator had no project context beyond a
one-paragraph product description; full report travels as
`evaluation.md` in this change directory) found the corpus strong at the
individual-requirement level but decaying at the corpus level: two
substantive contradictions (one security-relevant), change-history
narratives breaching self-containment down to THEN clauses, one
capability written as a changelog rather than a state description, and a
growing web of normative references onto anchors that have no spec at
all. The owner reviewed all 18 improvement proposals one by one on
2026-08-30 and adopted every one. This change applies them. Spec text
only — zero product behavior changes.

## What Changes

- **Contradiction and stale fixes**: resolve the json/jsonb write-surface
  contradiction toward the shipped contract (P1); add `offset` to the
  injection-safety inline-value enumeration and pin the enumeration's
  update obligation (P2); update the provider intro text for the shipped
  `@hejbro/neon` (P4); drop the stale "today" narrative from the plpgsql
  trigger-query requirement (P10).
- **Self-containment sweep** (P6): strip issue numbers, change ids,
  M-labels, D-numbers, and renaming/"previously" narratives from
  requirement and scenario text; keep measured facts inline, unlabeled.
  Add a recurrence-prevention rule to `openspec/config.yaml`.
- **Restructuring**: rewrite `snapshot-format` as a state description
  (P7); move codec decode strictness/leniency rules there from
  `query-builder` (P8); split three mega-requirements (P9); state the
  chain stage-parity general rule with the set-operation exception
  scoped (P12).
- **Anchor seeds** (growth-model reinterpretation, owner-approved: a
  normative reference from another spec counts as "touched"): a
  diagnostics-format capability and a minimal generate/verify +
  migration banner/hash-chain spec (P3); the on-conflict contract the
  chain stage list already references (P5); the implemented
  `IntervalValue` field contract (P11).
- **One ruled-on behavior fix** (tripwire escalation, owner 2026-08-30):
  a zero-target `onConflictDoNothing()`/`onConflictDoUpdate` rendered
  invalid `on conflict ()` SQL; it now fails fast with
  `empty-conflict-target`. The only source change in this change; patch
  changeset included.
- **Cleanups** (P13–P18): `orderBy` naming unification; error-code vs
  exit-code disambiguation; `check` comparison-axis consolidation; "v1"
  markers replaced by present-tense restriction statements; FILTER
  negative-space dedup; scenario-block format repairs; Purpose refresh;
  driver capability set enumerated exhaustively; the Neon preset
  documentation requirement given a concrete verification form.

## Capabilities

### New Capabilities

- `diagnostics`: the hejbro diagnostic format every other spec already
  references normatively — error code, `Next:` line, code namespace
  (P3a).
- `migration-format`: what a generated migration file carries — banner,
  hash chain — and what `verify` accepts, seeded to the surface other
  specs already reference (P3b; final capability naming is a `[design]`
  decision recorded in design.md).

### Modified Capabilities

- `query-builder`: injection-safety enumeration (P2); on-conflict
  contract added (P5); history-narrative sweep (P6); codec rules moved
  out (P8); set-operation mega-requirement split (P9a); stage-parity
  rule + exception scope (P12); `order`→`orderBy` (P13); FILTER
  paragraph single ownership (P14); Purpose refresh (P16).
- `query-type-inference`: json/jsonb write contradiction fix (P1);
  sweep (P6); recursive-term mega-requirement split (P9b);
  `IntervalValue` field contract (P11); FILTER paragraph reduced to a
  one-line reference (P14).
- `query-execution`: sweep (P6); result-conversion mega-requirement
  split (P9c); interposed-prose and double-WHEN/THEN format repairs
  (P15); "v1" marker replacement (P13).
- `snapshot-format`: rewritten as a state description of the snapshot
  format (P7); receives codec decode rules (P8).
- `plpgsql-function-bodies`: stale "today" narrative removed,
  relationship to the return-shape requirement stated (P10);
  interposed-prose format repair (P15).
- `cli-commands`: `generate`/`verify` command seeds (P3b); error-code vs
  exit-code disambiguation and `baseline-not-first` exit code (P13);
  `check` comparison-axis consolidation (P13); Purpose refresh (P16).
- `driver-contract`: capability set enumerated exhaustively (P17);
  sweep (P6).
- `table-declaration`: sweep (P6); "v1" marker replacement (P13).
- `rls-execution-context`: documentation-content requirement given a
  concrete verification form (P18); sweep (P6).

## Impact

- `openspec/specs/**` — nine of the twelve existing capability specs
  plus two new ones. No package source, no generated SQL, no CLI behavior, no
  test expectations change: every edit either records already-shipped
  behavior or removes narrative that never was contract.
- `openspec/config.yaml` — one added rule (P6 recurrence prevention).
- `AGENTS.md` / `README.md` — provider status sentence (P4).
- Tracking issue: quickstart-now/hejbro#522 (sub-issue of #282).
