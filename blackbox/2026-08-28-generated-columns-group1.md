Refs:
- packages/core/src/types/column-builder.ts @ blob 7de884913efdc4221e1b7f121f5a1f662c2cbf12
- packages/core/src/dsl/table.ts @ blob 4a7eec82df57a34c2143a4399be23a4df0241c48
- packages/core/test/generated-columns.test.ts @ blob e370a76f6cb2b0317e0179c613c2985fc87b5704

# generated-columns group 1 — the surface, and a probe that caught a gap before review

Piece record for `add-generated-columns` tasks 1.1–1.2 (tracking #368),
built by the gc1 piece team (planner opus / implementer sonnet /
reviewer opus) in worktree `gen-g1-surface` off dev `07ccda5`, verdict
PASS at `f0b1d1c3a6db2a42331860a440b08acbba0e2474` (four commits, four
files, all group-1 scope). The lead closing commit carries the change's
single `minor` changeset (first-landing rule), the ledgers, the README
refresh, this record, and one design-wording tightening.

## What landed

The builder trio (`generatedAlwaysAs` / `generatedAlwaysAsIdentity` /
`generatedByDefaultAsIdentity`) recording `TMeta` markers and optional
`columnState.generated` (the fragment's ExprNode) / `identity`
({ kind camelCase, six-key options — `restart` deliberately absent with
a documented reason }); identity typed integer-family-only by
`TMeta["typeName"]` (measured: family `"numeric"` also covers
real/numeric/serial, so family keying would be wrong — and the runtime
guard keys on the same enumeration, the value/link-axis rule);
`table()` guards four misuse shapes with four literal-coded errors
(`invalid-identity-column`, `invalid-generated-identity`,
`invalid-generated-default`, `invalid-identity-default`), order
contractual and pinned; both identity kinds imply notNull+hasDefault
at TMeta only, `columnState` untouched (the serial D66 divergence,
pinned by tests so a well-meaning "fix" cannot ship silently into
group 2's snapshot).

## Lead rulings during the piece

1. The spec delta's own wording ("a generated/identity declaration is
   combined with `.default()`") covered identity+default — a fourth
   guard the lead's briefed three-guard list missed. Ruled: the
   owner-merged spec beats the lead's narrower brief; guard added.
2. Serial is not identity-eligible — the planner's spec-literal
   reading, confirmed as PG semantics too (serial's nextval default +
   identity is the identity+default combination PG itself rejects, so
   guard 4's semantic sibling). Both the type-level `never` and the
   runtime throw are test-pinned.
3. README CRAP and `.changeset/` stay lead-closing artifacts per
   piece (the planner's assemble-once suggestion corrected: pieces
   merge as individual PRs and each must pass CI's README-diff
   backstop itself).
4. design.md decision 1's wording tightened at close: BOTH identity
   kinds imply notNull (the implementation was right; the sentence
   read as always-only) — a clarification, not a contract change, and
   the gc3 consequence (a by-default identity reads back non-nullable)
   goes into that piece's brief.

## What review bought

Eleven mutations, eleven kills, each attributed to the exact gate that
catches it. The methodological findings worth carrying:

- The ⑧/⑨ cross-kill was PROVEN: type-level mis-keying dies only under
  `check-types` (vitest has no typecheck mode — `expectTypeOf` is a
  runtime no-op, so tsc is the sole enforcer of every type claim), and
  runtime mis-keying dies only under vitest; under the type mutant,
  `text()` still passes while `real()`/`numeric()`/`serial()` fail —
  the obvious near-miss proves the least.
- R11 (the positive control pinning identity's default-free state)
  earned its place with direct evidence: a mutant making the identity
  setter write `defaultValue` (guard-4 self-conflict — every valid
  identity declaration throwing) left all four misuse tests green;
  only R11 and the divergence pins died.
- The reviewer's probe-derived boundary number (diagnostic-xref 122 →
  126, verified per-literal before the freeze) caught the missing
  fourth guard at 125 BEFORE review started — the first live success
  of the "pin the boundary by measurement, not assumption" standard
  g3's blindness pattern produced.

## Process record

The first implementation ran green against the planner's initial brief
while three later stamps (fourth guard, serial addendum,
paired-assertion rule) sat unread — a 10-item rework, diagnosed by the
planner from the files rather than the report. Root cause named as
stamp propagation, not implementer quality (the state shape, two-layer
guard design, and message wording all survived review untouched), and
answered with a standing corrective the lead adopted for every later
piece: re-read the latest TERMINAL contract immediately before the
final gate run. Ledger: 1.1 9→14m, 1.2 8→13m (overrun = contract
growth: the guards and cases added mid-piece), plus a separate 15m
stamp-drift process row. Tokens 551 requests / 490,457 output / 97.2%
cache from the three transcripts.
