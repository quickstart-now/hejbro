Refs:
- .changeset/narrow-join-nullability.md @ blob 5143f4270981a28185fc2fb9e1ebbc7450e85a1e
- README.md @ blob b111764a19270a043a54dc60f390f6d8b4b506ff
- openspec/changes/narrow-join-nullability/proposal.md @ blob 428a0db9fdee39ab1a2752808872422e6e8acea2
- openspec/changes/narrow-join-nullability/specs/query-type-inference/spec.md @ blob e89832a7efb86f35ec48918009540dfda64e2d3b
- openspec/changes/narrow-join-nullability/tasks.md @ blob e13fa8e98958ffc15923fcabb528483b271be136
- openspec/task-times.csv @ blob 88cf9f8616e518b3f2f474eb6b16148e7e581b70
- packages/core/src/index.ts @ blob 747021dfe4178360ec0a2b1cc3f5123b386336f6
- packages/core/src/query/left-joined.ts @ blob c61e4f12a72521b83171e1661c538bdf0fb4179f
- packages/core/src/query/select.ts @ blob 45c0fb0104170d8459b4c2a6e07221fc3822238d
- packages/core/test/query/select-join-types.test.ts @ blob 39a2e2d8fc5a9704bd0b889e5ef6e6d0ba219b07
- packages/query/src/db/chain.ts @ blob a95cafd6c271c3f984210ef31ad6ed78d5768cfa
- packages/query/src/db/db.ts @ blob 5e45a9719011ff79730b0044acb8e8bcc0ddc718
- packages/query/src/types/returning.ts @ blob 55b1d00bd359794b30f9cfb7efa00d426ba26490
- packages/query/src/types/select-result.ts @ blob 48fe00ff9a8154be479a9246b4e2b5892b1120bc
- packages/query/test/db/execute-result-type.test.ts @ blob a818d0e8120d3e8d5d236ba1f3d95861e54d3212
- packages/query/test/types/chain-types.test.ts @ blob dc79eac2c0dfd691269f40e6960b01f41fe2ab4b
- packages/query/test/types/nested-read.test.ts @ blob e43ec03d722783ea5ddaf6c1d0225d0baab3751a
- packages/query/test/types/returning.test.ts @ blob eaa73ee6357ed296f95bfd09b0db218abfdd28ca
- packages/query/test/types/select-result.test.ts @ blob 1c5573c33caec441533a63e4cc9e49bea008f4c9
- skills/hejbro/references/query-layer.md @ blob 996fb1646eb19cb3e541c7bfcd2cb460aaf810c7

(Taken from `git hash-object <path>` on the frozen closing tree at
`617c60d`, before the blackbox commit; the query-layer reference was
re-pinned after the G4 review's two documentation completions, and
five entries — the delta spec, the changeset, the skill reference,
both result-type test files (one of them, the nested-read suite, is
new to the list) — were re-pinned once more after the D106 correction
round; see "The D106 gate" below. The three
`openspec/changes/narrow-join-nullability/` paths will move when this
change archives; the pins are to be re-pathed in the archive PR, blobs
unchanged. Pins die three ways — squash preserves them, an archive
kills the path, a concurrent same-file edit on dev kills the blob —
so the archive PR re-verifies all twenty path-fixed before merging,
per the standing pre-commit sweep rule.)

# narrow-join-nullability — left joins stop lying (#307)

lj piece team (planner opus, implementer sonnet, reviewer opus) off dev
`dcdbbcc`, under the owner's standing delegation — every owner gate
below was exercised by the lead session as a delegated owner decision,
recorded here and queued for the owner's return review.

## Owner inputs (English rewrites)

The delegation is the owner input; the work item is the deferral the
owner parked at the query-layer v1 cut (2026-08-26): left-join
nullability widening needs table-identity tracking on the column
reference and the select builder — deeper than what shipped then, so
every object-projection field typed `| null` and the spec recorded the
widening as known and deliberate. This change removes that widening:
a projected field now follows its declared nullability unless its
source table was actually left-joined, with the tracking done entirely
at the type level (zero runtime change, zero golden movement — a gate
on every task).

## Delegated rulings

- The five settled decisions of the proposal (narrowing discriminator
  = a direct column reference; structural table identity with its
  over-widening limitation stated in spec text; the second stage-type
  parameter defaulting to untracked-widen; the threading boundary at
  core stages + chain + ExecuteResult; whole-table and self-join
  over-widening stated, not fixed).
- One explicit boundary expansion mid-piece, requested by review
  observation: `returning()` narrows too, via an empty (`never`) join
  set — ruled in because a mutation's join set is not unknown but
  grammatically empty (the insert/update/delete node types have no
  field that could carry a join), so leaving it wide would have been
  "information available but unused", the exact widening this piece
  exists to remove. The scenario states the premise as a tripwire: a
  future mutation-join surface must revisit it. The review then
  hardened the stated grounds from "no method exists" (quietly
  breakable) to "no node field exists" (breaks loudly, via types).
- Two representation corrections to the frozen contract, both
  measurement-forced, neither a semantics change: the untracked
  sentinel became `unknown` (a string-literal sentinel made the
  default-annotated positions reject tracked stages — TS2379 — which
  defeated the default's whole purpose), and the phantom-extraction
  helper became `Exclude<T, undefined>` (TS 5.9's
  `NonNullable<T> = T & {}` folds `unknown` to `{}`, flipping
  untracked to tracked — the piece's first and only
  false-narrowing-direction failure, and its source was the contract
  text itself).
- Surface exposure: the three new type names reach the `hejbro` facade
  through `export *`; hiding them would strip the brand's name from
  declaration emit, so they ship documented as inference plumbing in
  the skill reference — the `columnOriginBrand` precedent.

## What the piece measured about its own method

This piece's through-line, written by its reviewer: **fail-safe
relationships breed blind spots.** Every error path but one widens
(safe), so equivalence survives — three times a mutant survived the
whole suite until the mirrored input existed (G1 both-paths, G2
membership mirror, G3 set-operation left/right), and once a correct
fix was indistinguishable from the shipped bug on the shipped inputs
(the reviewer applied the *correct* code and the suite stayed silent —
the direct proof that value mutants gone green signal missing inputs,
not mutant failure). Two real defects shipped past a PASS and were
caught in the next group's work: the narrowing branch dropped `| null`
on nullable columns (predicate mutants proved condition necessity but
never the branch's value; the reviewer retracted the PASS), and the
contract's `NonNullable` flipped untracked to tracked (the reviewer
had both facts — the `{}` truth-table row and the contract line — and
had not combined them; their own accounting). The planner's contract
was contaminated twice by prose copied without measuring (the
`NonNullable` instruction, and a wrong explanation of why two other
uses were accidentally safe — the real mechanism is TypeScript's
weak-type rejection, found when the implementer re-measured while
writing it down as a comment). All five owner-queue items this piece
files are those failures converted to procedures: assert phantom
parameters by `infer` extraction, include `any` in sentinel truth
tables, hit branches with value mutants and treat green equivalence
as missing inputs, carry measurement text *and conditions* into any
contract that instructs a transformation, and mutate both arguments
of every asymmetric relation.

## The ledger

G1 ran 0.32× of estimate as a group-level row (the lead supplied
message-timestamp boundaries; per-task clocks did not exist yet); from
G2 on, every task carries `date -u` stamps, and rows the stamps cannot
split honestly say so in their notes. Review-born rounds have their
own `*-review` rows so the review's cost is visible. The implementer
twice refused to fabricate per-task splits — the only reason the
estimation signal stayed clean.

## The D106 gate (first BLOCK)

The isolated evaluator — summoned under the amended protocol for the
first time: a git-less filtered export (`git archive`, prohibited
artifacts removed, isolation probed with `git show`/`git grep HEAD`
returning "not a git repository", outputs recorded verbatim) — returned
**BLOCK: 1 blocking, 1 major, 2 minor, zero code defects**. Every probe
it ran through the published dist types confirmed shipped behavior
sound ("no position types a possibly-NULL value non-null"); what
blocked was prose. The blocking finding: the delta's untracked-position
scenario claimed "every projected field stays widened" while
`related()` rows and whole-table nested subselects were never widened
at all — the discriminator is the projection's form (whole-table vs
object projection), not the position, and the same over-claim was
replicated in the changeset and the skill (which contradicted its own
relational-reads section 300 lines up). The major finding: the corpus
requirement "Nested read types equal the declared read types" was made
false by the delta and never MODIFIED.

The correction round fixed all four as text — scoping the sentences to
object-projection fields, naming the form-based discriminator, adding
the two MODIFIED carves (word-level diff against the corpus: insertions
only), scoping the structural-identity paragraph, and naming the four
exported type names as contract — plus one paired assertion per
surface (the utility's nested branch and the ExecuteRows pipeline),
mutation-proven bidirectionally independent. Two things worth keeping
from the round: the counter-evidence for the blocking finding already
existed inside the team's own suite (a G3 test asserting `related()`
non-null sat beside a delta sentence claiming the opposite — collation
failure, not missing input), and the reviewer, having written the
quantifier rule, broke it in the next message by stating a repo-wide
"no test exists" from a directory-scoped search — both folded into the
owner-queue item on quantifiers (state the claim scope-inline; re-check
the SHA of any reused earlier survey; enumerate the domain
element-by-element; read the sentence against existing assertions).
