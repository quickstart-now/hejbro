# Proposal: harden-query-surface

## Why

Five defects share one shape: **the query/declaration surface accepts a
program the database will reject, and the rejection arrives at apply or
execute time instead of at compile time.** Four of them were left
deliberately open by the change that stood next to them (each carries an
issue number in a source comment or in a shipped spec's own prose), and
one is a naming defect that makes correct-looking code compute the wrong
number silently.

- **#464** — `index().on(...)` has *no* table-ownership check for a plain
  column entry. `toDeclarationColumn` (`dsl/index-builder.ts`) reduces a
  `ColumnRef` to `{ name }`, dropping the schema/table it came from, so
  `index().on(other.id)` declares an index on a column this table does not
  have. `dsl/table.ts` already rejects the same mistake inside an
  *expression* index column (`assertNoForeignIndexExpressionColumn`) and
  `index-builder.ts` already rejects a *CTE* column — the plain-column case
  is the hole between them, named as out of scope by add-ctes task 1.2d.
- **#487** — core's own `select().union(other)` types `other` as
  `SetOpBranch` with the default projection, so a branch with a different
  key set compiles and fails on the server. The chain surface has enforced
  this since D103, and `SetOpResult` now *lives in core* (add-ctes moved
  it there) — core's `union()` simply never consumed it. The shipped
  `query-type-inference` spec states this gap in prose and assigns it here.
- **#489** — `asRecursive`'s compatibility check is `SetOpResult`-based,
  i.e. **key sets only**. A recursive term whose column *types* diverge
  from the anchor's type-checks and dies at `42804` ("column N has type
  integer in non-recursive term but type bigint overall"). That SQLSTATE
  and message are **quoted, not re-measured**: add-ctes' reviewer
  measured them on postgres:17 and pinned them in
  `packages/core/src/query/with.ts`'s `CompatibleRecursiveTerm`
  docstring. Three records agree on the failure condition, and it is
  **not** "the two types differ": the pinned error message compares the
  anchor's type to the resolved one ("column N has type integer *in
  non-recursive term* but type bigint *overall*"), the same docstring
  defines the open gap as "a recursive term whose column types **resolve
  differently from the anchor's**" (`with.ts:165-167`), and
  `add-ctes/tasks.md` says the same. The condition is **resolution result
  ≠ anchor**, which is why a plain `union` widening `int + bigint →
  bigint` is fine while the recursive form raises `42804`, and why
  `numeric + bigint` — resolving to the anchor's own `numeric` — passes
  (issue #489's body, same reviewer's session).

  A rule written as "the types must be identical" would therefore reject
  queries Postgres accepts. But so would a rule keyed on the *type pair*,
  and that is the part no record covers: "resolution ≠ anchor" is
  **directional**, so the same pair flips its verdict when the sides
  swap — a `bigint` anchor with a `numeric` recursive term resolves to
  `numeric`, which is not the anchor, and should raise `42804`. Nobody
  has measured that direction. It decides whether the TS rule keys on
  the pair or on the anchor, so M3b measures both directions before any
  rule is written.
- **#470** (audit finding H2, high — discoverability trap) — ordering has
  **three** shapes in three media and the most visible one is the one
  that does not work: the declaration medium exports `asc(col)`/`desc(col,
  { nulls })` (`dsl/index-builder.ts:15-54`), the query medium wants
  `Expr | { by, direction }` (`expr/ast.ts`), and `WindowSpec.orderBy` is
  a third. Since the `hejbro` barrel re-exports `asc`/`desc`,
  `handle.select(posts).orderBy(desc(posts.id))` is the natural spelling
  and it is a type error. The same split leaves `order by … nulls
  first|last` unexpressible in a query while an index column has carried
  `nulls` since D51 — `OrderByTerm` has no such field.
- **#469** (audit finding H1, high — silent wrong answers) —
  `countWhere(expr)` renders `count(<expr>)`, which counts rows where the
  expression is **not null**. The name reads as a predicate filter
  (`count(*) filter (where …)`), and `countWhere(eq(t.status, "done"))` —
  the reading the name invites — counts *every* row, because `eq(...)` is
  never null; `Expr`'s default family includes `"boolean"`
  (`expr/ast.ts:338`), so the misuse type-checks. `aggregate.ts:50-52`'s
  own comment says the aggregate names are Postgres's own names rendered
  verbatim: `countWhere` is the one invented name among the five, and it
  borrows the meaning of a *different* SQL construct. It compiles, it
  runs, it returns a plausible-but-wrong number. This is the only one of
  the five that no error can catch at any layer today.

Four of the five are type-level or declaration-time hardening with no
runtime cost; the fifth is a rename. None of them adds a feature.

## What Changes

- **An index column belongs to its own table** (#464). The
  `ColumnRef`→`{ name }` reduction keeps the reference's origin available
  to the declaration-time check that already exists for expression
  columns, and `dsl/table.ts` throws the existing `foreign-column-ref`
  code, with the same message shape, when a plain index column names a
  column of another table. The snapshot shape does not change — whatever
  carries the origin is a declaration-side concern that never reaches
  `serializeIndexColumn`.
- **Core's `union()` (and its five siblings) enforce row compatibility**
  (#487) by consuming `SetOpResult`, which already sits in core for
  exactly this question. A mismatched key set stops type-checking; the
  runtime and the rendered SQL are untouched. This *completes* D103's
  "type-enforced set-op compatibility" rather than revising it — but it
  moves a surface D103 settled, so the decision-log row's note is
  amended, which is lead-gated (see Open decisions).
- **A recursive term's column types are narrowed toward the anchor's**
  (#489), by as much as a TypeScript type honestly proves and no more.
  The issue is explicit that this is "the home for any future build-time
  narrowing of that gap", not a demand for a full model of Postgres's
  type resolution — reproducing that at the TS level was already ruled
  out of scope once. So the [design] task's job is to draw the line:
  which divergences a read type proves the server would reject
  (`bigint`-mode vs `number`-mode on one key is the clear case), which
  ones it cannot (a declared enum vs `string` are both `text` to
  Postgres; `numeric + bigint` *resolves* and passes; nullability is not
  a union-compatibility axis at all), and therefore what the rule
  refuses. Whatever is not closed is **stated as the remaining gap in
  the spec**, with its reason, rather than left implied. **The shipped
  spec's own justification is in scope**: it currently justifies the
  relaxation with "a field the anchor reads straight from a column and
  the recursive term computes with a window function or an aggregate …
  is legal on both", and Postgres is believed to forbid aggregates and
  window functions in a recursive term outright. If the measurement
  confirms that, the sentence is defending constructs the server never
  accepts and is corrected here. That check is on the deferred
  measurement list — it is not asserted in this proposal.
- **One ordering vocabulary, and `nulls` reaches a query's `order by`**
  (#470). `asc`/`desc` — the names the barrel already exports — become
  usable in `orderBy`, and `OrderByTerm` gains an optional `nulls`
  placement rendered as `nulls first|last` by both order-by renderers
  (`orderByClause`, shared by select and window; `setOpOrderByClause`).
  The direction is lead-settled (2026-08-29): the shared ordering
  vocabulary is **promoted downward** — into `expr/` or a shared module
  — and `dsl/index-builder.ts` consumes it from there. Having `expr/`
  look *up* at `dsl/` is forbidden by the layering rule, and merely
  *widening* `OrderTermInput` to also accept the index wrapper would
  leave two vocabularies standing and make the count three; one
  construct both media accept is the actual cure. Which module it lands
  in, and what happens to `WindowSpec.orderBy` as the third shape, stays
  a [design] task with its file set enumerated per outcome. The snapshot field is
  **additive-compact**: absent means "no explicit placement", so a
  snapshot written before this change decodes unchanged and
  `formatVersion` stays 8 — the same rule fix-select-traversal
  established for v8's clause fields and D84 established for index
  completeness.
- **`countWhere` is removed, not renamed** (#469; lead-settled
  2026-08-29). The chain: `aggregate.ts`'s own comment states the
  aggregate names are "Postgres's own names, rendered verbatim", and
  `countWhere` is the one invented name among the five; `count(operand)`
  — SQL's own spelling of exactly this operation — is what the argumented
  form should be; and the surface is unreleased, so removal costs
  nothing. `countNonNull`/`countOf` were both rejected as *more* invented
  names, which repeats the violation instead of ending it. The behavior
  survives under SQL's own name; only the invented alias goes.

  The issue's second direction — refusing a predicate-shaped argument
  with a diagnostic — is **not adopted**, and the reason is the tension
  found while drafting: `count(<condition>)` is legal Postgres (the
  non-null count of a boolean expression), a `Condition` is not
  distinguishable from a declared boolean column by family alone
  (`Expr`'s default family already includes `"boolean"`), so the
  diagnostic would reject correct code. The defect was the name and
  nothing else.

  A real `FILTER (WHERE …)` aggregate is **out of scope** and gets its
  own issue, filed as a `#282` sub-issue through `issue.sh` so it is
  never an orphan.

## Capabilities

### Added Capabilities

- `table-declaration` gains a requirement: **a column reference stored by
  a declaration belongs to the declaring table** (#464). This is written
  as ADDED rather than MODIFIED because the rule is not in the spec at
  all today — the codebase enforces it at three of four sites
  (`foreign-column-ref` for an index *expression* column and for a CTE
  column, `index-predicate-foreign-column-ref` for an index predicate)
  while the spec never states it. The issue reads the fix as the plain
  cycle (restoring symmetry, no proposal needed); it rides in this change
  because it shares the PR and because writing the missing requirement is
  worth more than the ticket it closes. If the lead prefers it split out
  as a standalone fix, group 1 detaches cleanly.

### Modified Capabilities

- `query-type-inference`: set-operation compatibility holds in the core
  builder, not only the chain surface (#487, replacing the paragraph
  that parks the gap); the recursive-term rule gains its type dimension
  and its justification is corrected to what the server actually does
  (#489); the aggregate requirement names the renamed function (#469).
- `query-builder`: the aggregate vocabulary lists the renamed function
  (#469); `orderBy` accepts the barrel's own `asc`/`desc` vocabulary and
  an explicit nulls placement, rendered in SQL's own order (#470).
- `snapshot-format`: an order term carries an optional `nulls`
  placement, additive-compact, no format-version change (#470).

## Impact

- **Affected code**: `packages/core` — `dsl/index-builder.ts`,
  `dsl/table.ts` (#464), `query/select.ts` (#487), `query/with.ts`
  (#489), `expr/ast.ts`, `expr/render-sql.ts`, `expr/codec.ts` (#470),
  `expr/aggregate.ts` (#469), `index.ts` (barrel, #469/#470);
  `skills/hejbro` (surface change, same PR); `openspec/specs/**` deltas.
  `packages/query` — `db/chain.ts` (group 8). **Corrected mid-flight**:
  this line originally read "`packages/query` re-exports and does not
  redeclare these names — to be confirmed by the first task that touches
  each, not assumed." The qualifier was right and the claim was wrong.
  `chain.ts:280` builds its own `queryKind: "setOp"` node rather than
  routing through core's `combineSetOp`, which is why group 8's guard
  needs two consumers and not one. Left visible rather than silently
  rewritten: an unverified convenience claim reached a plan document and
  was caught only when a task actually touched the file, which is the
  outcome the qualifier was hedging against.
- **Explicitly not touched** (another team's slice, in flight):
  `packages/neon`, `packages/skills`, `scripts/crap-report.mjs`,
  `scripts/pack-install-smoke.sh`, `.changeset/config.json`,
  `.github/workflows/ci.yml`. Checked with
  `git diff --name-only dev...HEAD` before the PR.
- **Breaking**: nothing released moves. Established by command, not by
  memory — `npm view @hejbro/core versions --json` → `["0.1.0","0.1.1"]`,
  and against the `@hejbro/core@0.1.1` tag:
  - `git show '@hejbro/core@0.1.1':packages/core/src/expr/aggregate.ts` —
    **the file does not exist at that tag**, so `countWhere` (#469) has
    never been published. The rename breaks no released contract.
  - `git show '@hejbro/core@0.1.1':packages/core/src/query/select.ts |
    grep 'SetOpCombinators\|union('` — no match, so core's `union()`
    family (#487) has never been published either.
  - `git show '@hejbro/core@0.1.1':packages/core/src/expr/ast.ts |
    grep OrderByTerm` — **present** (`export type OrderByTerm` at line
    152 of that revision). `OrderTermInput` is absent at the tag.

  The last one is the load-bearing one, and it is **not** a statement
  about the user-facing input vocabulary: `OrderByTerm` is the *stored
  node* (`{ expr, direction }`), while `OrderTermInput` (`{ by,
  direction }`) is what a caller passes. What 0.1.1 published is
  therefore the **node shape that reaches the snapshot**, not the
  argument shape. Two consequences: widening what `orderBy` accepts
  (#470) is purely additive and breaks nothing, and adding `nulls` to
  `OrderByTerm` touches a **released serialized shape**, which turns the
  additive-compact requirement below from hygiene into a compatibility
  obligation — a snapshot written by a released 0.1.1 must still decode.

  #464/#487/#489 turn programs that compiled and then failed at
  apply/execute time into programs that fail to compile, which is the
  fix, and none of those surfaces is released.
- **Node shape**: `OrderByTerm` gains one optional field (#470).
  Additive-compact — absent means "no explicit placement" — so
  `formatVersion` stays 8, following D84 (index-completeness fields were
  additive at a fixed version) and fix-select-traversal's v8 rule. Since
  `OrderByTerm` is a *released* shape (see Breaking), a red test that
  decodes a 0.1.1-era order term without the field is part of the group,
  not an optional extra. No golden or example regeneration is expected;
  any that appears is reported before being regenerated.
- **Decision log**: one amended note on D103 (#487), carrying the
  delegation formula in full. No new row.
- **Follow-up issue**: a `FILTER (WHERE …)` aggregate, filed as a `#282`
  sub-issue via `issue.sh` (type/label/assignee/parent/board enforced),
  never as a free-standing orphan.

## Decisions (all settled 2026-08-29; none open)

1. **D103's note is amended, not forked.** #487 fills an implementation
   gap in what D103 already decided ("type-enforced set-op
   compatibility"), so the row's note gains — verbatim, following #414's
   own amendment of D101 — "(amended 2026-08-29 by
   harden-query-surface, under the owner's standing delegation, by the
   lead session; to be surfaced to the owner on return)". No new row.
2. **`countWhere` is removed** rather than renamed, and the
   predicate-refusal diagnostic is not adopted. See What Changes.
3. **#470 promotes the ordering vocabulary downward.** See What Changes.
4. **Changeset grade is `minor`**, decided by the addition to a
   *released* surface (`orderBy` accepting the shared vocabulary,
   `OrderByTerm.nulls`). Removing the unreleased `countWhere` does not
   affect the grade.

## Verification note

Everything in this change except the items below is compile-time or
declaration-time, and is proven by red tests — for the type-level ones,
a program that must stop type-checking, stated as an executable
operation rather than as prose.

### Deferred measurements (lead's go signal required)

Server behavior is measured, never remembered. A parallel team holds the
Docker server right now (concurrent load is exactly the contention class
behind #477's flake), so **no measurement in this change runs before the
lead's go signal**, and no claim below is asserted anywhere in this
proposal until its measurement exists. Each lands as a witness in
`packages/pg/test/integration.test.ts` against a local `postgres:17`,
with its reproduction command recorded next to it.

| # | Question | What it settles |
|---|----------|-----------------|
| M1 | Is an aggregate legal in a recursive term? | whether the shipped spec's relaxation justification is defending a real construct (#489) |
| M2 | Is a window function legal in a recursive term? | same (#489) |
| M3b-i | `numeric` anchor + `bigint` recursive term — accepted or `42804`, **and what is the resulting column type** (`pg_typeof`)? | re-confirms the recorded measurement and separates the two questions (#489) |
| M3b-ii | `bigint` anchor + `numeric` recursive term — same two observations | **never measured by anyone**; the same pair with the sides swapped (#489) |
| M4 | Does a nullability-only divergence between the two terms matter? | whether the rule may ignore nullability (#489) |
| M5 | Does the rendered `order by … nulls first|last` execute and order that way, in a plain select, a window `over(...)`, and a set-op whole-set order? | that #470's new clause is real SQL in all three renderers, not just a matching golden string |

**Already measured, quoted rather than re-run.** Two claims have a
written provenance from add-ctes' reviewer on postgres:17, so they are
cited with their source and no server is touched for them:

- `42804`, its message text, and the **`int`/`bigint` pair rejecting** —
  pinned in `packages/core/src/query/with.ts` (the
  `CompatibleRecursiveTerm` docstring). This was the original M3a and is
  off the measurement list entirely.
- **`numeric + bigint` resolving to `numeric` and passing** — stated in
  issue #489's body, attributed there to the same reviewer's
  measurement. It is a record, not a memory, and is citable on the same
  footing as the code pin.

M3b re-measures the second one anyway, and pairs it with its mirror
image. The reason is not doubt about the records — they agree — but the
rule they *imply*. "Resolution result ≠ anchor" is a **directional**
condition, so the verdict on a type pair depends on which side is the
anchor, and the recorded measurement only ever ran one direction. If
M3b-ii raises `42804` where M3b-i passes, a TS rule keyed on the type
pair is wrong by construction and the rule must key on the anchor;
if both pass, the opposite. One measurement cannot tell those two rule
shapes apart, so both directions are measured or neither is trusted.

Each M3b row observes **two** things, not one — acceptance *and* the
resulting column type (`pg_typeof`) — on the lead's instruction, and the
reason generalizes past this change: "is it accepted" and "what type
comes out" are different questions, and a record answering one can look
like it contradicts a record answering the other. Observing both is what
tells a real disagreement from two compatible statements. (That is a
hypothesis about the earlier records, not a verdict on them; the
measurement decides.)

The prediction that M3b-ii rejects is **inference, not measurement** —
it follows from Postgres's documented implicit casts (`int4→int8`,
`int8→numeric`) plus the pinned message's grammar, and no server has
been touched for it. If the measurement disagrees, the measurement
wins and this paragraph is what gets corrected.

*(Provenance: an earlier draft of this proposal claimed the code pin and
the issue body contradicted each other. They do not — the pin's own gap
sentence at `with.ts:165-167` states the issue body's rule verbatim.
That misreading was the planner's, was caught in review before approval,
and is recorded here rather than quietly deleted, because the archived
proposal would otherwise assert that a previous reviewer's measurements
disagreed with each other when only a later reading of them did.)*
