Refs:
- .changeset/harden-query-surface.md @ blob 07e574552c79dd679ec0a0b39ab8c37c597c759e
- docs/specs/2026-08-19-hejbro-design.md @ blob 00c1f08bdfb38b96d11761f8687362300ab3731d
- openspec/changes/harden-query-surface/design.md @ blob b09d146e16de04c221fc9c7065a8c1568e287a06
- openspec/changes/harden-query-surface/measurements.md @ blob 52d9df5fd1c625e58f74f6fb7c37a33acbf8bfd9
- openspec/changes/harden-query-surface/proposal.md @ blob 0ed80ac2c9142b120aac085ae21389e8153a0277
- openspec/changes/harden-query-surface/specs/query-builder/spec.md @ blob 24a569f631e3c982ac279ba2226682b3a7b48cfe
- openspec/changes/harden-query-surface/specs/query-type-inference/spec.md @ blob bcc62be0443090814339b8c8acd61c011a5ef661
- openspec/changes/harden-query-surface/specs/snapshot-format/spec.md @ blob c571644618d030e36f593c8c816afa3718ff1ac6
- openspec/changes/harden-query-surface/specs/table-declaration/spec.md @ blob 9e81a1cc983ff904f81b7f42b305e9d346e8b245
- openspec/changes/harden-query-surface/tasks.md @ blob 1cc26fd0a505e3707fd48b1dd18a807eaafc07a5
- packages/core/src/dsl/index-builder.ts @ blob 743b25d4312ffb3cb5d637ca870f70cede870d8c
- packages/core/src/dsl/table.ts @ blob 531739f13d742ad2b0d5b2a55b376963f89710bc
- packages/core/src/expr/aggregate.ts @ blob 74b751136d97a5337000699b5052a2a20966daee
- packages/core/src/expr/ast.ts @ blob 3510d4ab57a0eb2a8f792b81f896814525bd3b0d
- packages/core/src/expr/codec.ts @ blob 9113ba6f8317aa6b027de8038650a2eb663d9181
- packages/core/src/expr/render-sql.ts @ blob 32d6531ed01ead2995f0a7d8f98d159d44dd6aa9
- packages/core/src/index.ts @ blob df9a0355d1e155b99454ab10971d02ccb60bd4a2
- packages/core/src/query/select.ts @ blob 4d78c09a21717fbd9874400b4e4937c1fe0304f6
- packages/core/src/query/set-op-key-order.ts @ blob f8fbc1694d72911d45aca2cc1b3074d7244373f7
- packages/core/src/query/with-recursive.ts @ blob 7b7ba0672555e28778d66024a2b32a7da2b923c2
- packages/core/src/query/with.ts @ blob 7f7e496136df946a774523b2307a6c10604780b1
- packages/core/test/dsl.test.ts @ blob 3dae247960854c2fbfc29d16a61b5eac2ad3a926
- packages/core/test/dsl/index-builder.test.ts @ blob 0d58c967da27c0a83832685dfa64128045d5c3f6
- packages/core/test/expr/codec.test.ts @ blob fed4ba7fe05f0f118fc3633a25994a7347e6e22a
- packages/core/test/expr/render-sql.test.ts @ blob f8faeffc7ff71cd2bf8518986c2b52ceadc19f1e
- packages/core/test/query/select.test.ts @ blob a140e814f60af86ad1fdfcf28a051a0297db1c39
- packages/core/test/query/window.test.ts @ blob f54d16fbef503827411315d50afbdf8668192151
- packages/core/test/query/with-recursive.test.ts @ blob b3ceab1839fe9f81e69e88d91faf1707db29ca07
- packages/core/test/table-kind-diff.test.ts @ blob 7dc3795c0ceac4d85f61f816a62235a0c9f3ed67
- packages/core/test/table-kind-emit.test.ts @ blob 55c5b3ad0b548c1889f5ed6f8ca1cef8763e56de
- packages/core/test/table-surface.test.ts @ blob 47354f5ab7a358df714bb7d4f29be8f4a61ca54e
- packages/core/test/view-kind.test.ts @ blob d493ccb92c8aba58c72c2edb421ad95848232476
- packages/pg/test/integration.test.ts @ blob 3467b177abc65b18a9b27b2ae7b6a441b835c556
- packages/query/src/db/chain.ts @ blob 0d4242cbcdeb3658989897393107009c81e9763f
- packages/query/test/db/set-op.test.ts @ blob d859c563d678e2c6a9bad3246db2aca7e56a42d0
- README.md @ blob a010ddf8f1fdca415721f3cd05b3e0517f86fe62
- skills/hejbro/references/dsl-cheatsheet.md @ blob 74ce210fb1fff705cbcd1c587861faed547da14c
- skills/hejbro/references/query-layer.md @ blob 155bc6f6bbee83784f3a222f9b135daf3105a47e

(Archive addendum, 2026-08-30, lead session: the pins above record the
merge-commit state (dafb897) and stay as that record. The archive commit
then appended closing sections to two pinned files and moved the change
directory under openspec/changes/archive/; at the archived paths their
blobs are design.md @ 3f03dd91049e2fba7486cecfc4df4bea697473fd and
measurements.md @ a4c84aad0ab72e712845500dfd83aa0976325a72. Every other
pinned file is content-unchanged by the archive.)

(Re-pinned three times since the original `ab0fe8f` pin, as `design.md`,
`tasks.md`, and `skills/hejbro/references/query-layer.md` kept moving —
most recently by this very commit, which corrects 7.8 back to unticked
in `tasks.md` (its declaration cannot exist in the tree it would have to
describe — see that file's own "Final state" paragraph) and updates
that one path's pin in the same breath: the `tasks.md` blob hash above
was computed against the **staged** content (`git rev-parse
:openspec/changes/harden-query-surface/tasks.md`), so it already
reflects this commit's own change, rather than one commit behind it —
the loop a pin-then-edit-then-repin sequence would otherwise never
close, since `tasks.md` is exactly the file every wrap-up task edits
last. This is genuinely the slice's last file edit: no task after this
one touches a pinned path, and 7.8 (the only task left open) produces a
message, not a file change. Per add-ctes' own correction, these pins must
still be re-verified against the final tree after any rebase/squash,
before the PR is considered done; a pin taken mid-branch does not
survive a squash unless the pinned content is also present in the final
tree.)

(Re-pinned a fourth time after `git rebase upstream/dev` — the branch's
base had moved four squashes (#495/#494/#498/#499) and needed a real
rebase, not just new commits on a stale base. Three pins moved from
content, not just from the rebase renumbering every commit SHA:
`README.md` (a real conflict — both this branch and `#498`'s neon
preset had updated the CRAP/task-time badge blocks; resolved by
re-running `pnpm check:crap`/`check:tasktime` against the merged tree
rather than hand-merging the two sets of numbers, so the recorded
counts — 1518 functions, `@hejbro/neon` included — are a measurement
of the rebased tree, not an edit), `packages/pg/test/integration.test.ts`
and `skills/hejbro/references/query-layer.md` (both auto-merged clean —
`#495`/`#494` touched other regions of the same files). Two things
checked before re-declaring, since the new base moved capability specs
this change's own deltas neighbor: `#494` changed
`query-execution-failed`'s message text, not its `code`/`kind`/`cause`
shape, and nothing in this change's own tests or docs asserts that
message's exact text (checked by grep across every file this change
touches) — no drift. `#499` moved `driver-contract`/`query-execution`/
`rls-execution-context`'s shipped specs, none of which this change's
four deltas touch — confirmed by `openspec validate --strict` passing
clean on the rebased tree, and by checking (learned from the parallel
slice's own measured finding) that none of this change's `MODIFIED`
requirement titles differ from their shipped counterparts, which would
read as a rename and fail the same way at archive time.)

(Drafting note, recorded rather than silently omitted: this entry is
written by the implementer session from committed artifacts — proposal.md,
design.md's decision log, tasks.md — not from a transcript of the raw
owner⟷lead exchange that originated this change, which the implementer
was never party to. Convention calls for "every owner input" recorded as
an English rewrite; what follows is that content reconstructed from the
written record, and the lead/planner session that held the actual
exchange should amend this entry if anything here understates or
misstates what the owner actually asked for. That gap is filled below,
by the lead session directly — see "Owner context" under "Where the
five came from".)

# harden-query-surface — five query/declaration-surface hardening defects

Piece work (planner + implementer, reviewer relayed through the
planner), worktree `harden-query-surface` off dev. Fixes five defects
that share one shape: **the query/declaration surface accepts a program
the database will reject, and the rejection arrives at apply or execute
time instead of at compile time** — plus one naming defect that makes
correct-looking code compute the wrong number silently.

## Where the five came from

**Owner context (supplied by the lead, the party to the exchange; English
rewrites per this file's convention).** This change ran under the
owner's standing delegation ("decide everything as if building the ORM —
Postgres only — and follow the established process; where an owner
decision is needed, the lead decides until I return"). The immediate
owner input that started it, 2026-08-30: *"The derived errors have
piled up — let's process them."* That directive selected the open
defect backlog; the lead triaged it and bundled these five issues into
this change (two more were taken lead-direct, the rest queued behind the
in-flight preset piece). Two of the five (#469, #470) originate from the
owner-requested UX/DX audit of 2026-08-29, whose brief was, in effect:
*"I've started worrying about one of AI's failure modes — growing the
codebase with similar functions doing similar work, without thinking
through the syntax from a UX/DX standpoint; there appear to be at least
1,416 functions. The work needs periodic inspection for whether UX/DX
was genuinely considered — and now is the time."* The remaining three
(#464, #487, #489) are the boundaries three prior changes deliberately
left with issue numbers at their code sites. All "ratified" decisions in
this entry are lead decisions under that delegation, to be surfaced to
the owner on return — none are direct owner decisions.

Two came from an owner-requested review of the query/declaration surface
against how other ORMs' users would meet it (recorded in `proposal.md`
as "audit finding H1"/"H2"): #469 (`countWhere(expr)` reads as a
predicate filter but actually counts non-null rows — a silent wrong
answer, no error at any layer) and #470 (ordering had three vocabularies
across three media, and the one users would naturally reach for —
`asc`/`desc`, already exported from the barrel — was the one that did
not type-check in a query). The other three were boundaries earlier
changes had already found and deliberately parked rather than left
undiscovered: #464 (add-ctes task 1.2d named the plain-index-column
ownership hole as out of scope), #487 (the shipped `query-type-inference`
spec states in its own prose that core's `union()` carries no
compatibility check), and #489 (add-ctes' own reviewer measured the
`42804` boundary and pinned it in `with.ts`'s `CompatibleRecursiveTerm`
docstring, with the issue itself recording the open direction).

## Decisions settled under the owner's standing delegation, by the lead session

- **D103's amendment** (`docs/specs/2026-08-19-hejbro-design.md`):
  branch compatibility becomes build-time-checked in the core builder,
  and a key-order guard is added alongside the existing key-set guard —
  both folded into the existing D103 row rather than a new decision row,
  following #414's own precedent for amending D101 in place.
- **`countWhere` is removed, not renamed.** `aggregate.ts`'s own comment
  states the five aggregate names are Postgres's own names rendered
  verbatim; `countWhere` was the one invented name among them. Two
  rename candidates were considered and rejected — `countNonNull` and
  `countOf` — because both repeat the same violation (a further invented
  name) rather than end it; `count(operand)`, SQL's own spelling, is
  what the argumented form should have been from the start. The surface
  was unreleased (absent at the `@hejbro/core@0.1.1` tag), so removal
  costs no deprecation window. A second direction — refusing a
  predicate-shaped argument with a diagnostic — was considered and
  rejected too: `count(<condition>)` is legal Postgres, so refusing it
  would make the builder stricter than the database for a shape that
  is not actually wrong, only the removed name's own reading of it was.
- **#470's downward promotion.** The shared ordering vocabulary
  (`asc`/`desc`, the nulls placement) moves into `expr/` — a module the
  declaration medium's `dsl/index-builder.ts` can consume from — rather
  than `expr/` reaching up into `dsl/`, which the package's own layering
  rule forbids, and rather than widening the query medium's
  `OrderTermInput` to merely also accept the index wrapper, which would
  have left two vocabularies standing (three, counting `WindowSpec`'s
  own) instead of collapsing to one.

## An early proposal draft misread two measurement records as contradictory

`proposal.md` records this itself, kept rather than quietly deleted: an
earlier draft claimed a code-pinned measurement (`with.ts`'s
`CompatibleRecursiveTerm` docstring, `42804` on a `bigint`/`numeric`
divergence) and issue #489's own body (which records `numeric + bigint`
resolving to `numeric` and passing) contradicted each other. They do
not — the pin's own gap sentence states the issue body's rule verbatim.
The misreading was the planner's, caught in review before the proposal
was approved. It is the reason group 1 measured `pg_typeof` at all
(M3b's own design): the lead's instruction was that each M3b row must
observe **two** things, not one — acceptance *and* the resulting column
type — because "is it accepted" and "what type comes out" are different
questions, and a record answering one can look like it contradicts a
record answering the other when only a later reading conflated them.
Observing both is what tells a real disagreement from two compatible
statements; this measurement design is the direct fix for the exact
failure mode the misreading demonstrated.

## What went wrong / self-corrections during implementation

- **A commit-message SHA was mis-transcribed once** (5.4's fix commit)
  — reported by memory rather than copied from `git rev-parse` output.
  Caught by the reviewer attempting to resolve the bad SHA. All
  previously-reported SHAs were re-verified fresh; only the one was
  wrong. Standing rule from here: copy `git rev-parse HEAD` output
  verbatim, never reconstruct a SHA from memory.
- **Two spec justifications were found self-contradicting or
  server-behavior-unevidenced during group 7's own writing**, the same
  failure class this change exists to fix, found the same way it fixes
  the shipped specs' versions: the recursive-term relaxation's
  "window function or an aggregate ... is legal on both" (M1 measured
  the aggregate half `42P19`-refused) and the set-operation
  requirement's "the database would reject the statement" (Postgres
  accepts a same-position, differently-named union and takes the left
  branch's names — measured twice, group 8's reorder and a dedicated
  measurement, M6). A first pass at the M6-dependent sentence cited it
  as already measured before it was; caught in review, corrected to an
  explicit "pending" hedge, and then corrected a second time to
  "measured" once the reviewer actually ran the check (a two-line psql
  query needing no Docker slot) rather than leaving the sentence resting
  on a forward citation. The standing rule recorded for this: a
  justification asserting server behavior cites a measurement or is not
  written, and a sentence whose evidence is scheduled does not ship.
- **The task-times ledger's own prescription was tested and found not to
  work**, then partially fixed. "The implementer measures, the planner
  records" assumed a measurer that does not exist in this team's shape:
  the implementer has no introspective elapsed-time sense across tool
  calls, the planner has no shell, and the reviewer (who has both) does
  not do the work being timed. The correction, applied from group 7.3
  onward: `date -u` at a task's start and end is an instrument, not a
  recollection, and a stamped pair is an honest wall-clock approximation
  precisely because inter-task waiting sits between the stamps rather
  than inside them. Groups 1-6 and 7.1/7.2 keep empty rows — their
  stamps were never taken and are not invented retroactively.
- **A skill-doc example was verified, not protected.** The 7.2 ordering
  examples were compiled and executed against the real chain surface in
  a throwaway test, then deleted — a genuine point-in-time measurement,
  recorded as such in the skill file itself (with the verifying SHA)
  rather than left to read as a standing regression guard it is not.
