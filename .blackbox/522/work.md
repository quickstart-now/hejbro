# Work — quickstart-now/hejbro#522

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — align-spec-corpus: applying the external evaluation's 18 adoptions

_2026-08-30T00:00Z_

### The tripwire firing and the owner's ruling

Task 1.1 (`[design]`, on-conflict contract confirmation) measured that
a zero-target `onConflictDoNothing()` renders
`insert … on conflict () do nothing` — SQL Postgres rejects at parse
time; neither a refusal nor valid bare `on conflict do nothing`. Going
green on any honest spec of that surface required package-source
change, which the change's own Non-Goals forbade — the first live
firing of the divergence-tripwire rule this same day's #519 landed in
config.yaml. Escalated with three options; the owner ruled: "add the
guard in this change" (recommended option). Landed as
`resolveConflictTarget` guarding both conflict stages with the coded
`empty-conflict-target` failure (red test first), the change's single
deliberate behavior change, carried by a patch changeset.

### What the apply phase found

- **Bindings held almost everywhere.** The split query-execution
  requirements, the interval normalization contract
  (`canonicalizeInterval`), the migration-format banner scenarios
  (prefix-only parsing, unknown-line tolerance, prose-not-contract),
  and the diagnostics format (per-code test assertions plus
  `check:next-marker`) were all already test-bound; the corpus's
  scenario↔test pairing was real, not aspirational.
- **Two genuine gaps produced new tests**: no chain-level test existed
  for `offset`/`distinct`/`distinctOn` (two stage-parity
  compile-equality tests added — parity held), and no byte-determinism
  test existed for `generate` (double-fixture comparison added — held).
- **One delta was corrected against reality**: P18 pinned the Neon
  mode-mismatch documentation to the package README, but the repo's
  documented user contract lives in
  `skills/hejbro/references/neon-preset.md`, which already carried both
  halves of the warning; only the token-validity-timing fact was
  missing. The delta now names the skill reference; the doc test
  asserts the three facts; the missing sentence was added (red first).
- **README's package table had no `@hejbro/neon` row** — the provider
  staleness (F27/P4) ran deeper than the one sentence the evaluator
  could see from inside the corpus.

### Rationale

Execution followed the tiering precedent (lead-direct with piece
tracking issues #523/#524/#525 under change issue #522) rather than
three team summons: ten tasks totalling ~78 estimated minutes of
doc-and-test work. Durations landed per group in
`openspec/task-times.csv`; the delta-vs-reality corrections used the
fluid update-in-place path the owner adopted the same morning, and the
one scope expansion went through the tripwire protocol rather than
being absorbed silently.

### The review round

A one-shot spec-bound reviewer (the review rule this same day's process
change codified: delta specs read against the implementation) returned
a conditional pass — no blockers, five delta-text defects, three
hardening items — and every finding was verified and applied. The
substantive ones: the set-operation split had dropped the server-side
`42804` second defense layer and the recursive-term split had dropped
the "elision approves exactly two measured divergences, nothing wider"
disclaimer (both restored — split content loss is exactly the failure
mode the split's own Migration notes exist to prevent); the baseline
banner-marker contract was left dual-owned between cli-commands and the
new migration-format capability (moved: single owner, migration-format);
one "before and after this change" narrative survived in the
snapshot-format delta, violating the self-containment rule this very
change adds to config.yaml (rewritten present-tense); and the
target-less `on conflict do nothing` form Postgres accepts is now a
stated deliberate boundary (sql escape hatch named as the path) rather
than an implicit blanket requirement — consistent with the owner's
morning ruling that bare-form support is out of scope. Hardening:
groupBy/having added to the chain-parity equality tests, the query-layer
skill's upsert example updated for the guard (the same-PR skill rule),
and the main cli-commands Purpose reverted to pre-archive truth.

Migrated from the single-file entry `.blackbox/2026-08-30-align-spec-corpus.md`, kept verbatim at `.blackbox/522/artifacts/2026-08-30-align-spec-corpus.md`.

