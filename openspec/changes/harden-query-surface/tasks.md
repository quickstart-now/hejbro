# Tasks: harden-query-surface

Seven groups. Group 1 is measurement and produces the input group 6's
`[design]` task is blocked on. Groups 2–4 are the three independent
hardening slices and share no files with each other. Group 5 is the
ordering vocabulary, group 6 the recursive-term rule, group 7 release
hygiene. Estimates are pure work minutes (D88); every task names the
failing test it starts from.

**Sequencing**: 1 → {2, 3, 4} → 8 → 5 → 6 → 7.

Group 8 was added mid-flight (lead decision, recorded in `design.md`)
after review measured that #487's fix closes only half the defect. It
runs after 3 because it edits the same file, and before 7 because 7.1
and 7.4 must carry its spec delta and changeset.

**What a tick means here.** `[x]` = written **and** passed review, not
"the implementer finished it". A group whose code landed but whose
review returned *needs work* stays unticked, and 5.4/6.3 stay unticked
even once written because they are `(execution pending)` until 7.7's
closing slot runs them. This file is the slice's only progress record,
so a tick that means two different things at two places would make it
useless.

Current state: groups 1, 2, 3, 4, 8, group 5 through 5.3, group 6
through 6.2, and 7.1/7.2/7.3/7.5 are ticked — written, reviewed and
passed. Still open: **5.4 and 6.3**, which are written but
`(execution pending)` until the closing slot runs them; **7.4 and 7.6**,
complete but awaiting their verdict; and **7.7/7.8/7.9**, the closing
slot and the wrap-up.

Two groups came back *needs work* and were repaired before ticking:
group 3 (its D103 left-branch guarantee had regressed from
machine-enforced to comment-only) and group 8 (one diagnostic was
covering three different failures, two of them with an impossible
remedy).

**Declared file overlaps** (so they are sequenced rather than pretended
away — these pairs are *not* parallel-safe):

| Group set | Shared file | Resolution |
|-----------|-------------|------------|
| 2 & 5 | `packages/core/src/dsl/index-builder.ts` | 5 follows 2 |
| **2 & 4 & 8 & 5** | `packages/core/src/index.ts` (barrel) | strict order 2 → 4 → 8 → 5 |
| **3 & 8 & 6** | `packages/core/src/query/select.ts` | 3 → 8, and 6.2 after 8 if it needs a shared helper |
| 5 & 6 | `packages/pg/test/integration.test.ts` | 6 follows 5 |

**Only group 3 is parallel-safe against the others.** An earlier
revision of this table claimed `{2, 3, 4}` were mutually disjoint; that
was **wrong and is corrected here** — group 2 exports `IndexColumnOrigin`
and therefore edits the barrel too, which the table had assigned to 4 & 5
alone (caught in review at `3893b2b`, while 3 and 4 were already
running). Nothing broke, because one implementer runs these in sequence
— but the table is what 7.6's boundary check and this slice's progress
record are read against, so a table that disagrees with the branch is a
defect whether or not it caused a collision.

A barrel edit stays **inside** the group that causes it: removing
`countWhere` from `aggregate.ts` while `index.ts` still exports it does
not compile, so a group that splits those two cannot land green. That
rule is why the barrel keeps accumulating groups, and why this row is
expected to grow again rather than being a one-off mistake.

**Type-level red tests.** Several tasks start from a red that is a
*compile* failure, not a runtime one. The operation is: add the
`@ts-expect-error` (or `expectTypeOf`) line, run `pnpm check-types`, and
watch it fail with **"Unused '@ts-expect-error' directive"** (TS2578) —
that is the red, and it proves the program currently compiles when it
must not. It turns green when the fix makes the error real.
`expectTypeOf` reds fail as ordinary type errors.

**A green `@ts-expect-error` is forgeable, so it is not sufficient on
its own.** The directive swallows *whatever* error the next line
produces: a typo yielding `Cannot find name` turns it green just as well
as the narrowing the task is about. Every task using one therefore
records, in its red/green note, **the actual error text seen when the
directive is removed** — that is what shows the green came from the
intended error. Reviewers re-run that removal independently; supplying
the text in the note saves a round trip, it does not replace the check.
Each `@ts-expect-error` also gets a positive control (the near-miss case
that must still compile), so a narrowing that rejects everything cannot
pass as a fix.

---

## 1. Measure first (one Docker batch)

Docker go signal received from the lead. Run these as **one short batch
in one sitting**, then report completion so the lead can schedule the
next team's Docker work. Nothing here changes source; the output is a
record that later groups cite.

Every row observes **two** things where applicable — acceptance *and*
`pg_typeof` of the resulting column — because "is it accepted" and "what
type comes out" are different questions and a record answering one can
look like it contradicts a record answering the other.

- [x] 1.1 (~8m) **M1/M2.** Against a local `postgres:17`: is an
      aggregate legal in a recursive term? Is a window function? Record
      the exact SQLSTATE and message for each, or "accepted" with the
      resulting type. This settles whether the shipped spec's
      justification for the relaxed rule ("a field the anchor reads from
      a column and the recursive term computes with a window function or
      an aggregate … is legal on both") describes a real construct.
      Files: `openspec/changes/harden-query-surface/measurements.md`
      (new — verbatim SQL, verbatim server output, and the exact
      `docker run`/`psql` command line for each row).
- [x] 1.2 (~9m) **M3b-i/ii, the directional pair.** `numeric` anchor +
      `bigint` recursive term, and `bigint` anchor + `numeric` recursive
      term. For each: accepted or `42804`, **and** `pg_typeof` of the
      column. Both directions or neither is trusted — one direction
      alone cannot distinguish a rule keyed on the *type pair* from one
      keyed on the *anchor*, which is exactly what group 6 must decide.
      Record the result even if it contradicts the prediction that
      M3b-ii rejects; that prediction is inference from documented
      implicit casts (`int4→int8`, `int8→numeric`), not measurement, and
      the measurement wins. Files: same file.
- [x] 1.3 (~5m) **M4-server only.** Does a nullability-only divergence
      between anchor and recursive term change acceptance? (`int` column
      in the anchor, `null::int` for the same key in the recursive
      term.) Prediction: **irrelevant** — Postgres resolves types over
      type OIDs and `NOT NULL` is a column constraint, not part of an
      expression's type, so both sides are `int4` and the resolution
      equals the anchor. That is inference; this row confirms it.

      **Third observation, and the one this row exists for: do the
      recursive term's nulls actually arrive in the result rows?**
      Acceptance and `pg_typeof` both come back clean here (both sides
      are `int4`), so neither can see the soundness gap 6.1 has to rule
      on — that is a question about *row contents*, not about types.
      Build a CTE whose anchor is a `notNull` int and whose recursive
      term yields `null` for the same key, then **select the rows and
      look at them**. A null arriving proves the gap is real and gives
      6.1's spec residue its evidence; no null arriving means Postgres
      stops it somewhere and 6.1 drops the worry. Two extra minutes in
      the same batch — omitting it means re-taking the Docker slot
      later, in a scheduling round with the parallel team, while group 6
      sits blocked.

      **M4-TS needs no server and is already settled by reading the
      code**: `SetOpResult` (`query/select.ts:111-115`) is a plain
      mapped type and nullability rides *inside* the value type as
      `T | null` — there is no separate flag (`rg 'nullable|isNullable|
      notNull' packages/core/src/query` → 1 hit, in `column-value.ts`;
      positive control `rg 'SetOpResult' packages/core/src/query` → 6
      hits, so the search is not dead). Consequence, independent of any
      measurement: the moment group 6 tightens the rule from "same keys"
      to "same types", `number | null` and `number` become a
      **mismatch**. Group 6.1 must therefore elide null before
      comparing, or it will reject programs Postgres accepts — the exact
      inverse of the defect #489 is about. Files: same file.
- [x] 1.4 (~7m) **M5 (raw SQL, feature not yet built).** Is `nulls
      first` / `nulls last` legal in all three positions group 5 will
      render it in — a plain `select … order by`, a window `over (order
      by …)`, and a set-operation whole-set `order by`? Raw SQL, because
      the hejbro side does not exist yet; group 5 adds the witness that
      *our rendering* of it executes. A "no" in any position changes
      group 5's scope, so this runs before group 5, not after. Files:
      same file.

## 2. An index column belongs to its own table (#464)

- [x] 2.1 (~9m) [design] `toDeclarationColumn` preserves the column
      reference's origin (schema + table) so a check that has table
      context can use it, **without that origin reaching the snapshot** —
      `serializeIndexColumn` (`kinds/table-kind.ts`) must keep emitting
      exactly today's keys. The design decision is where the origin
      lives: a declaration-side field stripped at serialization, or the
      `ColumnRef` retained alongside the reduced form. Possible outcomes
      and their file sets:
      - *declaration-side field*: `dsl/index-builder.ts`, `dsl/table.ts`
        (the type), and a pinning test that the snapshot is byte-identical
      - *retained ref*: the same two plus `kinds/table-kind.ts` if
        serialization has to skip a field it did not skip before
      Red: `packages/core/test/dsl/index-builder.test.ts` — "an index
      column keeps the table it came from" plus "the serialized index
      column is unchanged by that" (the second is the guard against
      fixing #464 by widening the snapshot). Files: as enumerated above,
      plus that test.
- [x] 2.2 (~8m) `dsl/table.ts` throws `foreign-column-ref` when a plain
      index column names a column of another table, joining the family
      `assertNoForeignIndexExpressionColumn` and the index-predicate and
      CTE guards already form — same code, same message shape, so the
      four sites read as one rule. Red:
      `packages/core/test/dsl/index-builder.test.ts` — "an index over
      another table's column is refused" **and** "an index over another
      table's column that shares a name with one of its own is refused
      too" (the second is the case a name-only check would pass, and it
      is the whole reason 2.1 preserves the origin). Files:
      `packages/core/src/dsl/table.ts`, that test.

**Files group 2 actually touched** (recorded after the fact so the
overlap table and 7.6's boundary check are read against reality, not
against the plan): the two source files above, plus
`packages/core/src/index.ts` (the new `IndexColumnOrigin` export — the
barrel row in the table) and four test files whose hand-built
`IndexColumnDeclaration` literals gained `origin`: `test/dsl.test.ts`,
`test/table-kind-diff.test.ts`, `test/table-kind-emit.test.ts`,
`test/table-surface.test.ts`. Those four are the expected fallout of a
**required** field, not scope creep — and only *declaration-form*
expectations moved, never snapshot-form ones, which is precisely what
2.1's second red exists to pin.

## 3. Core's union() enforces row compatibility (#487)

- [x] 3.1 (~9m) The six combinators in `SetOpCombinators` bind the other
      branch's projection and consume `SetOpResult` — which already sits
      in this file for the recursive-term case — so a mismatched key set
      resolves `never` and stops compiling. The runtime, the built node
      and the rendered SQL do not change: this is a type-level narrowing
      only, and a test asserting the compiled SQL is unchanged says so.
      Red: `packages/core/test/query/select.test.ts` — "a union of two
      selects with different key sets does not type-check" (type-level
      red: `@ts-expect-error`, currently "unused directive") and "a
      matching union compiles to the same SQL it did before". Add a
      **type-level positive control** alongside it — "a union of two
      selects with the same key set still type-checks, and its result
      row keeps the left branch's keys" (`expectTypeOf`) — because the
      SQL-equality assertion is a *runtime* control and cannot catch a
      narrowing that poisons the matching case too. Group 6.2 has this
      symmetry already; 3.1 needs it for the same reason.

      Also narrow **`SetOpStage`'s own six methods** — they were
      hand-duplicated rather than reusing `SetOpCombinators`, so without
      this the *second and later* positions in a chain
      (`a.union(b).except(c)`) stay unguarded. Same file, so the file set
      does not grow. Files: `packages/core/src/query/select.ts`, that
      test.
- [x] 3.2 (~7m) Fix the one existing test 3.1's narrowing breaks:
      `packages/core/test/view-kind.test.ts:604` ("a union view
      round-trips and lists the left branch's columns") unions
      `{id, name}` with `{id, title}`, and its own comment says the right
      branch's column "is deliberately named differently" so the two can
      be told apart. That test **uses #487's gap as its proof
      technique** — it is not an independent use case that the fix
      would be destroying. Rewrite it the way
      `packages/query/test/types/set-op.test.ts` already proves the same
      property under the D103 rule: matching key sets, with "the left
      branch wins" shown through something other than a name
      (nullability widening on a shared key is the existing precedent).
      **Do not** alias the right branch into the left's names — the
      other candidate fix — because that changes the SQL the test
      asserts (`as "name"` appears), turning a type-level change into a
      generated-SQL change for no reason. Red: that test failing to
      compile under 3.1's narrowing, before the rewrite. Files:
      `packages/core/test/view-kind.test.ts`.

## 4. countWhere is removed (#469)

- [x] 4.1 (~9m) Remove `countWhere` from `expr/aggregate.ts` and from
      the barrel in the same task — the two cannot be split without a
      broken build. `count(operand)` is the surviving spelling, and the
      conditional work in this task **fires**: measured, `aggregate.ts`
      declares `export const count = (): Expr<"numeric"> & ReadAs<bigint>`
      — no parameter. So this task *merges* the two functions rather
      than merely deleting one, and the estimate carries that.
      Constraint to design around, not to discover: `operand ===
      undefined ? … : …` trips the machine-enforced **ternary ban**
      (Biome). An optional parameter with `??` on the operand's node is
      one shape that satisfies it and needs no overload, since both
      branches return the same type — but the implementer picks the
      shape; a better one wins. Lead-settled: removal, not a rename to
      `countNonNull`/`countOf`, because those are further invented names
      and `aggregate.ts`'s own rule is that the five aggregates carry
      Postgres's names verbatim. Unreleased (measured against the
      `@hejbro/core@0.1.1` tag), so no deprecation window is owed. Red:
      `packages/core/test/query/select.test.ts` — "count(expr) renders
      count(<expr>)" and "countWhere is not exported" (a type-level red
      on the import). Files: `packages/core/src/expr/aggregate.ts`,
      `packages/core/src/index.ts`, that test.
- [x] 4.2 (~6m) Grep the decided word immediately after 4.1:
      `rg -n 'countWhere' --glob '!node_modules'`. Measured before this
      task was written (28 hits / 11 files), the pass condition is that
      the grep returns **only** these four categories:
      - this change's own `proposal.md`/`tasks.md`/spec deltas
      - the changeset
      - `openspec/changes/archive/**` — **history. Never edited.**
        `add-aggregates` shipped `countWhere`; that it existed then is a
        fact, and rewriting the archive would assert it never did. Same
        principle as this change's own provenance footnote.
      - `openspec/specs/**` — **7.1's delta owns these**; the main specs
        are synced at archive time, not hand-edited here. `countWhere`
        surviving in `openspec/specs/query-builder/spec.md:332` and
        `query-type-inference/spec.md:302` until this change archives is
        the *correct* intermediate state.
      - **4.1's own red test** (`packages/core/test/query/select.test.ts`)
        — it names `countWhere` in its describe block and quotes the
        removal error. That is the test *proving* the removal, not a
        surface that missed it. Added as a fifth category after 4.1
        landed and the implementer reported the hit rather than waving
        it through; the original four were written before the red test
        file was known.

      Anything outside those four is a stale surface and is fixed here.
      Measured: that set is `skills/hejbro/references/query-layer.md`
      (2 hits, 7.2's job) and 4.1's own files — **not** `examples/`,
      `packages/query`, or the README, which the same grep shows have
      zero hits (positive control: the unfiltered grep returns 28).

      **A clean grep here does not mean a clean surface.**
      `packages/cli/src/index.ts:10` is `export * from "@hejbro/core"`,
      so the `hejbro` barrel re-exports `countWhere` **without the
      string appearing anywhere** — removal propagates automatically,
      but no grep could ever have shown it. This limitation is stated
      here so a green grep is not read as proof of more than it is.
      Files: whatever that grep names, within the categories above.

## 5. One ordering vocabulary, and nulls reaches a query (#470)

Runs after 2 (shares `dsl/index-builder.ts`) and after 4 (shares the
barrel).

- [x] 5.1 (~10m) [design] Promote the shared ordering vocabulary
      **downward** (lead-settled direction): one construct that both the
      declaration medium and the query medium accept, living where
      `expr/` can own it, with `dsl/index-builder.ts` consuming it —
      never `expr/` importing `dsl/`. The open part is the module and
      the shape, including what happens to `WindowSpec.orderBy` as the
      third spelling. Possible outcomes and their file sets:
      - *shape lands in `expr/ast.ts`*: `expr/ast.ts`,
        `dsl/index-builder.ts`, `packages/core/src/index.ts`
      - *new `expr/order.ts`*: that new file plus the same three
      - *either, and `WindowSpec.orderBy` folds in*: add
        `expr/window.ts` and `packages/core/test/query/window.test.ts`
      - *either, and `WindowSpec.orderBy` stays separate*: no window
        files, but 5.1 records why three spellings became two rather
        than one
      `IndexNulls` moving or being re-declared is part of this decision,
      not a detail after it. Red:
      `packages/core/test/dsl/index-builder.test.ts` — "asc()/desc()
      still declare an index column exactly as before" (the
      no-regression pin the promotion must not break) — and
      `packages/core/test/query/select.test.ts` — "orderBy accepts
      desc(column)" (currently a type error; the red is that it does not
      compile). Files: as enumerated above, plus those two tests.
- [x] 5.2 (~8m) `OrderByTerm` gains an optional `nulls` placement and
      both renderers emit it in SQL's own order — `orderByClause`
      (shared by a select and a window `over(...)`) and
      `setOpOrderByClause`. Group 1.4 has already established the clause
      is legal in all three positions; if it is not, that scope change
      was reported before this task started. Red:
      `packages/core/test/expr/render-sql.test.ts` — "renders `order by
      x desc nulls last` in a select, a window clause, and a set-op
      whole-set order". Files: `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [x] 5.3 (~8m) The codec encodes and decodes `nulls`
      **additive-compact**: present only when set, absent decoding to
      "no explicit placement", `formatVersion` stays 8 (D84's precedent,
      and fix-select-traversal's v8 rule). This is a compatibility
      obligation, not hygiene: `OrderByTerm` is a **released** shape
      (present at the `@hejbro/core@0.1.1` tag), so a snapshot written
      by a released version must still decode. Red:
      `packages/core/test/expr/codec.test.ts` — "decodes an order term
      written without a nulls field" and "an order term with no explicit
      placement round-trips without gaining a key". Files:
      `packages/core/src/expr/codec.ts`, that test.
- [ ] 5.4 **(execution pending)** (~6m) Live witness: the rendered
      `nulls first`/`nulls last` executes against a real `postgres:17`
      and orders that way, in a plain select and in a window `over(...)`.
      This is the difference between "the golden string matches" and
      "the server agrees".

      **Pick placements that differ from Postgres's own defaults, or the
      witness proves nothing.** Measured on postgres:17 during review:
      `asc` already means `NULLS LAST` and `desc` already means
      `NULLS FIRST`, so a witness asserting `desc … nulls first` returns
      the same rows whether the clause is rendered or dropped entirely —
      it passes on a build that emits no `nulls` at all. Only two
      combinations discriminate:
      | placement | vs default | usable |
      |---|---|---|
      | `asc nulls last` | same | no |
      | **`asc nulls first`** | differs (`NULL 1 2`) | **yes** |
      | **`desc nulls last`** | differs (`2 1 NULL`) | **yes** |
      | `desc nulls first` | same | no |
      Use one of each — `asc nulls first` for the plain select and
      `desc nulls last` for the window — so the two assertions cover
      both discriminating cases instead of one of them twice. **Written and committed in this group;
      executed in 7.7's closing slot** (lead-approved batching). This
      box stays unticked until that run — ticking an unexecuted witness
      would make the only progress record of this slice a false one.

      **Append only, at the bottom of the file.** The lead's #477 fix
      (PR #495) edits the *harness helper* near the top of this same
      file (`waitUntilReady`'s `pg_isready` arguments), and that region
      is currently under review as their change. A witness that needs to
      modify `waitUntilReady` or any helper — rather than add a
      `describe` block below — **stops and asks the lead before
      starting**. A new sibling file is deliberately *not* the answer:
      the container harness lives in this file's `beforeAll`, so a
      second file would start a second container and make 7.7's single
      slot cost two.
      Files: `packages/pg/test/integration.test.ts`.

## 6. A recursive term's types are narrowed toward the anchor (#489)

6.2 is blocked on group 1.2 — the rule is written **after** the
measurement exists, never before, so the measurement cannot be read as
confirming a rule already chosen. **6.1 is not blocked**: it was found
by reading the code, and it holds whatever the server says.

- [x] 6.1 (~9m) [design] **Settle the null fork first**, because it
      decides the *shape* of the comparison 6.2 then fills in. Found in
      review: `SetOpResult` is a plain mapped type and nullability rides
      inside the value type (1.3), so a rule tightened to "same types"
      counts `number | null` against `number` and rejects programs
      Postgres accepts. The comparison must therefore elide null — and
      eliding it opens a gap on the other side: anchor `number`,
      recursive term `number | null` is accepted, the CTE's row type is
      the anchor's, so the declared type says `number` while the
      recursive term really does carry nulls into the rows.

      **6.1 is not blocked and should run first** — this fork came out
      of reading the code, not the server, and it decides the *shape* of
      the comparison 6.2 then fills in.

      **Enumerate the axes before choosing what to elide.** Two
      projections can differ on more than one dimension, and a rule that
      elides only the dimension someone happened to name will reject
      programs Postgres accepts on the others. Known axes: key set
      (`SameKeys`, existing), key **order** (group 8's runtime guard),
      **declared type** (6.2's subject), **nullability** (this task's
      fork), and — raised in review, **not yet established** —
      **`.$type<T>()` brands**. A `jsonb` column carries a TS-only brand
      on its `typeNode`; an anchor branded `A` against a recursive term
      branded `B` is **two `jsonb` columns to Postgres and two different
      types to TypeScript**, which is exactly this fork's shape. If the
      rule tightens to "declared types must agree" while eliding only
      null, a brand mismatch becomes a false rejection.

      **This is a hypothesis, not a finding**: whether a brand actually
      survives into the projection type that `SetOpResult` /
      `CompatibleRecursiveTerm` compare has **not** been checked. One
      `tsc` run settles it — two differently-branded `jsonb` columns in
      a recursive CTE — but only *after* 6.2 writes a rule, since with
      no rule everything compiles. So: either widen this fork to
      **nullability + brands**, or **record brands as out of scope in
      one explicit sentence**. What must not happen is the axis dropping
      out silently and resurfacing in a `jsonb` recursive CTE later.

      Three options for the null axis; the second is a scope boundary,
      not a preference:
      **The gap is measured, not hypothetical** (group 1, M4 addendum):
      a recursive term yielding `null::int` against an `int` anchor is
      accepted, `pg_typeof` stays `integer` on every row, and **the null
      arrives in the result rows** (`v_is_null = t`). So (a) is not
      "assume it is harmless" — it is "a known, witnessed hole, stated",
      and "no gap, Postgres blocks it somewhere" is ruled out as an
      outcome. Quote it in the **scope the measurement supports**
      (`measurements.md`'s citation-scope note on that row): Postgres's
      type resolution has no nullability dimension, so the recursive
      term's null reaches the rows unimpeded. Do **not** write "Postgres
      ignores the anchor's `NOT NULL`" — no measured query contained a
      `NOT NULL` constraint. The unsoundness is on *our* side, where
      non-nullness is inferred and inferred wrongly.
      - *(a) keep the anchor's type, state the gap in the spec* —
        matches the slice's own definition ("narrow as much as a type
        honestly proves, state the residue"). **Lead's condition on
        this outcome: the residue also gets an issue number pinned at
        the code site**, filed as a `#282` sub-issue via `issue.sh` —
        the same form `#464`/`#487`/`#489` took when add-ctes left them.
        A spec sentence says *why it was not narrowed*; the pinned issue
        says *where it would be narrowed*. Both, or the outcome is
        incomplete. Files: `packages/core/src/query/with.ts`, the spec
        delta, and the new issue
      - *(b) widen the result to the anchor's type plus the recursive
        term's nullability* — **contradicts the pinned rule that the row
        type is always the anchor's, which is D105 territory. Out of
        this slice's scope: escalate to the lead and stop, do not drift
        into it mid-implementation**
      - *(c) refuse a nullability divergence* — rejects what Postgres
        accepts; recorded so it is rejected on the record rather than
        rediscovered later
      Red: `packages/core/test/query/with-recursive.test.ts` — "a
      recursive term nullable where the anchor is not still compiles".
      This one is a **guard, not a red-to-green**: it is green today and
      must still be green after 6.2, so it is written now, before the
      rule that could break it. Files: as enumerated per outcome, plus
      that test.
- [x] 6.2 (~9m) [design] Write the rule the group-1 measurements
      support, and no more, in the shape 6.1 settled.

      **The key question is already answered — start from it, do not
      re-derive it.** 1.2 asked whether the rule keys on the **type
      pair** (symmetric) or on the **anchor** (directional). Measured:
      M3b-i (`numeric` anchor, `bigint` recursive term) is **accepted**
      and resolves to `numeric`; M3b-ii, the identical pair with the
      sides swapped, is **refused with `42804`**. Same two types,
      opposite verdicts. **A symmetric rule is therefore wrong by
      construction**: the rule keys on the anchor — the recursive term's
      resolved type must match the anchor's, and Postgres's ordinary
      (symmetric) implicit-cast resolution is not the test.

      What that leaves open is only how much of it TypeScript can
      honestly express, which is this task's actual design work.
      Possible outcomes and their file sets:
      - *directional, expressible in TS*: `packages/core/src/query/with.ts`
      - *directional, needs a shared helper*: that plus
        `packages/core/src/query/select.ts` (where `SetOpResult` lives)
      - *not expressible without rejecting legal programs*: no source
        change; the gap is written up in the spec delta with the
        measurement as evidence — **report this outcome and its reason
        before taking it, never silently**
      Whatever the rule does not cover is stated as the remaining gap,
      with its reason, in the spec delta — a closed issue that leaves an
      unstated hole is how #489 was created in the first place. Red:
      `packages/core/test/query/with-recursive.test.ts` — "a recursive
      term whose column type resolves away from the anchor does not
      type-check" (type-level red) and "a recursive term computing a key
      differently but resolving to the anchor's type still compiles"
      (the over-correction guard — green throughout).

      **The guard's construct must be one the server was measured to
      accept.** The existing test at `with-recursive.test.ts:82-101`
      plays this role today using a **window function**
      (`over(rowNumber(), …)`), and its comment calls that "exactly the
      shape SameKeys admits" — but M2 showed a window function in a
      recursive term is not a demonstrated-legal construct (parses, did
      not terminate in the measured form). A guard standing on an
      unproven construct cannot tell "protects a program Postgres
      accepts" from "protects a program we believe it accepts", which is
      the whole job of a false-positive guard. So 6.2's guard uses a
      **measured-accepted** divergence instead: **M3b-i** (`numeric`
      anchor + `bigint` recursive term — accepted, resolves to the
      anchor) or **M4** (nullability divergence — accepted), both
      citable from `measurements.md`. Keep the existing window test —
      it still truthfully shows *our builder* accepts the shape — but
      strip the "legal on both" claim from its comment, which is the
      part no longer supported. Files: as enumerated above, plus that
      test.
- [ ] 6.3 **(execution pending)** (~7m) **Premise changed — this task was
      rewritten after 6.1 and 6.2 landed.** It originally read "live
      witness for whichever cases 6.2's rule claims to refuse", which
      assumed 6.2 would produce a *refusing* rule. It did not: 6.1
      settled on (a) (keep permitting, state the residue) and 6.2 on
      outcome 1 (no source change), so **nothing new is refused** and
      there is no refusal to witness. Dropping the task outright would
      leave a different question unmeasured, so it is repointed rather
      than deleted.

      **What it witnesses instead**: that the shapes 6.1/6.2 *permit*
      actually run — the M3b-i shape (`numeric` anchor, `bigint`
      recursive term) and the M4 shape (nullability divergence),
      executed **through the builder's own compiled SQL**. Group 1
      measured those shapes as **hand-written raw SQL**; nobody has
      checked that what hejbro renders for them behaves the same. That
      is exactly the gap this slice has already caught twice — a
      construct that type-checks while the rendered path differs (#470's
      window `nulls`, and 5.1's own review hole). A guard test proving
      "this compiles" is worth little if the thing it compiles to fails
      on the server.

      **Repeat group 1's observations, don't just check for absence of
      an error.** A witness that only asserts "no error" passes even
      when the builder emits subtly different SQL — an inserted cast
      would turn the M3b-i shape into a different case and still run
      clean. Transferring a measurement means repeating what it
      observed: M3b-i → accepted **and `pg_typeof` is `numeric`**;
      M4 → accepted **and the null reaches the row**. Same axis as
      5.4's discriminating-placement rule: an expected value that would
      hold anyway proves nothing.

      **Written and committed in this group; executed in 7.7's closing
      slot.** Unticked until then, and **append-only at the bottom of
      the file** — 5.4's note explains why. Files:
      `packages/pg/test/integration.test.ts`.

## 7. Release hygiene

- [x] 7.1 (~9m) Spec deltas under
      `openspec/changes/harden-query-surface/specs/`: `table-declaration`
      (ADDED — a declaration's stored column reference belongs to the
      declaring table), `query-type-inference` (set-op compatibility now
      holds in the core builder, replacing the paragraph that parks the
      gap in #487; the recursive-term rule's type dimension and its
      corrected justification; the aggregate requirement without
      `countWhere`), `query-builder` (the aggregate vocabulary;

      **The set-op requirement's justification is also wrong, and it
      contradicts its own next sentence.** `query-type-inference`'s
      "Set-operation branches must be row-compatible" currently reads:
      key sets must match "— **the database would reject the statement**,
      so the program does first", and then, two lines later, "the
      combined result row SHALL take the LEFT branch's keys (**SQL's own
      naming rule**)". Both cannot be true: a left-wins naming rule only
      exists *because* the branches' names are allowed to differ.
      Postgres matches set-operation branches by position and type, not
      by name. So the rule may stand — a name-keyed row type is what a TS
      ORM has, and silently taking the left's names is worse than a
      compile error — but it stands on **that** reason, not on a false
      claim about the server. Rewrite the justification accordingly;
      **M6 supplies the evidence and has already been measured** — see
      `measurements.md`'s M6 section, run during review rather than
      deferred, precisely so this sentence would not rest on a scheduled
      citation. Same failure mode as the recursive-term justification
      this change already corrects, found the same way.

      **The sentence to correct is already inside this change's own
      delta — do not skip the file because it looks written.** Groups
      6.1 and 6.2 both edited
      `specs/query-type-inference/spec.md`, so it reads as done; but its
      `## MODIFIED Requirements` block still carries, at lines 20-23,
      the shipped text *"…a window function or an aggregate has a
      different type on each side and is legal on both."* A MODIFIED
      block **replaces** the shipped requirement at archive time, so
      leaving it there ships a measurement-falsified sentence **as
      newly written**. 6.2's own added paragraph is accurate, which
      means the file currently contradicts itself — the same shape this
      change found between two shipped specs, reproduced inside one
      delta.

      **The justification correction is asymmetric — write what was
      measured, not a tidy generalization.** The shipped sentence claims
      a recursive term computing a key "with a window function or an
      aggregate" is legal. Group 1 measured: the **aggregate** half is
      simply false (`42P19`, refused at parse time). The **window
      function** half is not false in the same way — Postgres accepts it
      at parse time; the measured construct (`row_number() over ()`)
      then never terminates, because it resets each iteration. That is
      one construct, not the category: a window expression whose value
      advances with the recursion was not measured. So the delta says
      the aggregate case is refused, and says the window case parses but
      that the measured form does not terminate — it does **not** claim
      "window functions are illegal in a recursive term", which no
      measurement supports.

      **Replace the justification, do not just delete it.** Those two
      examples are the *only* thing holding up the relaxation from
      "identical projections" to "compatible" ones. Removing them and
      writing the asymmetry alone leaves the relaxation unjustified —
      which is precisely how #489 came to exist (a closed issue that
      left an unstated hole). The relaxation is still correct (M3b-ii
      proves a symmetric identity rule wrong), and this batch measured
      two constructs that genuinely differ across the two terms and are
      **accepted**: **M4** (nullability divergence) and **M3b-i**
      (`numeric` anchor + `bigint` recursive term, resolving to the
      anchor). Those become the justification, so a sentence the
      measurements contradict is replaced by sentences they support.
      Note also that the repo already contradicted the shipped spec:
      `with-recursive.test.ts:288` comments "the ban is
      recursive-term-only" for aggregates.

      **Align, do not invent — but only where the other text is right.**
      `query-builder/spec.md:542-544` says the same thing *correctly* for
      aggregates: it lists "an aggregate **in the anchor term**", scoping
      exactly where M1 says it is legal, while
      `query-type-inference:412-415` puts an aggregate in the *recursive*
      term. Two shipped requirements contradict each other, and the
      measurement backs `query-builder`'s. So the aggregate half is a
      **drift correction**: make `query-type-inference` say what
      `query-builder` already says, rather than composing a third
      wording.

      **The window-function half is not that**, and the alignment must
      not be applied mechanically: `query-builder:542-543` *also* lists
      "a window function" among what is accepted in a recursive term, so
      on that point it carries the same overclaim as
      `query-type-inference` and is **not** the correct text to align to.
      M2's finding (parses, then does not terminate in the measured
      form) applies to both files, and both get the honest wording.
      Checking whether the text being aligned *to* is itself measured is
      the whole difference between alignment and copying an error.

      **Completion condition for this task** (lead-directed): a drift
      between two files is not found by measuring — only by comparing
      documents — so once the corrected wording exists, grep the whole
      spec directory for the fact's own key nouns and **account for every
      hit**, not just the ones this change already knows about:
      ```
      grep -rniE "aggregate|window function|recursive term" openspec/specs/
      ```
      Each hit is either consistent with the corrected wording, or it is
      another instance of the same drift and is fixed here. This is
      a standing rule applied at a new moment, not a new rule: **when a
      measurement lands, another statement of the same fact may survive
      elsewhere, so grep the fact's key nouns and account for every
      hit.**
      `orderBy`'s accepted vocabulary and nulls placement),
      `snapshot-format` (the additive-compact `nulls`). Verify with
      **bare** `openspec validate harden-query-surface --strict` — the
      binary is machine-global (`/usr/local/bin/openspec`), **not** a
      repo dependency, so it is absent from `node_modules` and
      `npx openspec@latest` does not resolve it; calling it any other
      way looks like "the tool is missing".

      **The final run belongs to the reviewer, on the final SHA in an
      isolated worktree** — not to whoever happens to be at a keyboard.
      Two early runs already passed (the lead's, and the reviewer's with
      a positive control: `openspec validate no-such-change --strict`
      → exit 1), and neither is the gate. They validated (a) a tree
      carrying **only the `query-builder` delta**, while this task adds
      `table-declaration` (ADDED — scenario-shape requirements are the
      strictest), `query-type-inference` and `snapshot-format`, and
      (b) the **working directory**, not a commit. "The PR is valid" is
      a claim about a committed tree with every delta present, so that
      is the run that counts. Read the early passes as "the format is
      not already broken", nothing more.

      **Validate one delta at a time, not all four at the end.** Tell
      the reviewer as each delta is written and they run it then. Four
      new deltas validated in one shot produce overlapping failures and
      the cause has to be separated afterwards; one at a time means a
      failure has exactly one candidate. Same logic as group 8's
      per-site mutations.

      **Shape to follow for the ADDED delta** (`table-declaration` is
      this change's only one, and ADDED is where `--strict` is
      strictest). Extracted from an archived delta that **did** pass —
      `archive/2026-08-27-add-query-layer/specs/*/spec.md`:
      ```markdown
      # Delta: <capability-name>

      ## Purpose
      <a paragraph on why this delta exists>

      ## ADDED Requirements

      ### Requirement: <a statement, not a noun phrase>
      <SHALL prose>

      #### Scenario: <name>
      - **WHEN** <condition>
      - **THEN** <observable outcome>
      ```
      Every `### Requirement:` carries at least one `#### Scenario:` —
      that is the constraint `--strict` appears to enforce most often.
      A `## Purpose` section is present in the archived ADDED delta;
      whether it is required or merely conventional is **not
      established**. Nor is the title form: this change's existing
      `query-builder` delta opens `# query-builder (delta)` rather than
      `# Delta: query-builder` and validates clean, so that part is
      loose. This block is **"what passing deltas look like", reverse-
      engineered from one example — not a reading of what `--strict`
      checks.** It exists to make the first attempt likely, not to
      substitute for the run.

      **One `--strict` rule learned the hard way, recorded so nobody
      rediscovers it**: when a MODIFIED block carries a requirement
      forward, its **scenario titles are matched verbatim against the
      shipped spec**. Renaming a carried-forward scenario — even to
      describe its own corrected body more accurately — fails with
      *"MODIFIED … omits scenario(s) the current spec still has"*. Fix
      the body; keep the title. Files: those delta files.
- [x] 7.2 (~8m) `skills/hejbro`: the ordering vocabulary section says
      one thing where it used to say two — concretely **three
      statements**, identified once group 5 landed: (a) a query's
      `orderBy` accepts `asc`/`desc`, (b) a query can specify a `nulls`
      placement, (c) `WindowSpec.orderBy` takes the same vocabulary.
      **This one is not optional the way `IndexColumnOrigin` was**:
      `dsl-cheatsheet.md:108,126-127` already documents
      `.on(asc(col), desc(col, { nulls: "last" }))`, and #470's whole
      complaint was that the same spelling failed on the query side. It
      now works, so a user meets the change. The new type names
      (`OrderedTerm`, `NullsPlacement`) still stay out, on the same
      reasoning as `IndexColumnOrigin` — users receive those, they do
      not write them.

      The aggregate section drops `countWhere`, and the index section
      gains **#464's rule** — an
      index column must belong to the table declaring it, with the
      `foreign-column-ref` error that now enforces it. Document the
      *rule and the error*, which is what a user meets; naming the
      `IndexColumnOrigin` type is optional and probably noise, since no
      user constructs one (planner's call, raised in review: the
      "public API changed → skill updated" gate is about the surface a
      user writes against, and a required field on a declaration they
      only ever receive is not that).

      **If a documented example is verified by running it, say what kind
      of verification that was.** The new ordering examples were checked
      by compiling and executing them against the real chain surface in
      a throw-away test that was then deleted — which is a genuine
      measurement and much stronger than reading them. But it is a
      **point-in-time check, not a regression guard**: nothing now fails
      if the example rots. Record that in the commit message or here —
      *"examples executed at SHA X; no standing guard"* — so a later
      reader does not ask why the test did not catch a broken example.
      There is none. (Pinning every skill example with a permanent test
      is a different, larger question and is not proposed here; the
      point is only that "verified" and "protected" are different
      claims.)

      **The precise place, located in review**:
      `skills/hejbro/references/dsl-cheatsheet.md:108,126-127` documents
      what `.on(...)` accepts and does **not** state the new
      "this table's own columns only" constraint. That is the real
      staleness — not the type name. Neither `IndexColumnDeclaration`
      nor `IndexColumnOrigin` appears in the skill at all today
      (positive control: the skill *does* document errors, e.g.
      `query-layer.md` uses the `Next:` form), so no new inconsistency
      was introduced by exporting a type; the inconsistency is that a
      call which used to pass silently now throws. A stale skill is a broken user contract, so it lands
      in this PR. Then re-run 4.2's grep across the whole repo as the
      final check that no decided word survives anywhere.

      **A stale surface was suspected here and ruled out** — recorded so
      it is not re-suspected: `with-recursive.test.ts`'s comments were
      flagged as possibly restating the spec's old "legal on both"
      justification. Checked: that phrase does not appear in the file
      (`rg -n "legal on both"` finds it only in this change's artifacts,
      the shipped spec and the archive), and the comments there speak
      only about what `CompatibleRecursiveTerm`/`SameKeys` do and do not
      see — **type-system claims, not server-legality claims** — so
      correcting the spec does not make them stale. No edit needed.
      Files: `skills/hejbro/**`.
- [x] 7.3 (~6m) D103's note in
      `docs/specs/2026-08-19-hejbro-design.md`, verbatim: "(amended
      2026-08-29 by harden-query-surface, under the owner's standing
      delegation, by the lead session; to be surfaced to the owner on
      return)". Following #414's own amendment of D101. No new row.
      Files: that file.
- [ ] 7.4 (~8m) One `.changeset/*.md`, `minor` — the grade is set by the
      addition to a *released* surface (`orderBy`'s vocabulary,
      `OrderByTerm.nulls`), not by the removal of the unreleased
      `countWhere`, and its body says so. `openspec/task-times.csv` rows
      for every group, README task-time badges (`pnpm check:tasktime`)
      and the CRAP block (`pnpm check:crap`), and the `blackbox/` entry.

      **Run `check:crap` forced** (`TURBO_FORCE=1`, or after
      `pnpm build --force`). Measured in review at `34c16c9`: unforced
      it **fails** at `hejbro#test:coverage` (`5 cached, 10 total`),
      forced it **passes** (`0 cached`, exit 0) on the identical tree.
      The mechanism is the one AGENTS.md already documents — a replayed
      build log leaves `dist` unwritten and the CLI subprocess tests'
      freshness check trips. **This failure points the opposite way from
      the one we normally guard**: the usual cache hazard is a stale
      *pass*, and this is a stale *failure*, so the instinct "the cache
      lied to me, the code is fine" does not fire. Meeting it cold at
      7.4 invites chasing a CRAP regression that does not exist — if
      `hejbro#test:coverage` fails here, suspect stale `dist` first.

      **`check:crap` writes to the working tree — it is not a read-only
      gate.** `update-crap-readme` edits `README.md` in place, so its
      `"README.md unchanged (numbers match)"` line does **not** mean "no
      update was needed"; it means "a previous run already wrote it, so
      it matches now". Measured in review at `34c16c9`: the committed
      README says `0 of 1485 functions … measured at e28c9a3` while the
      tree yields **1486** functions at `34c16c9`, so the block *does*
      move — groups 2–4 added functions. **The README CRAP diff is
      produced by running the script and belongs in this task's commit**;
      it is never hand-edited. Two consequences: run it where an
      unexpected `M README.md` is acceptable (a shared worktree will
      silently acquire one), and check `git status` afterwards, because
      the gate's own output does not tell you it wrote a file.

      Both gates passed at `34c16c9` (exit 0, zero violations), and
      `check:tasktime` is genuinely read-only. Groups 5, 6 and 8 add
      code after that measurement, so this task re-runs both rather than
      citing them.
      The blackbox entry records the **decision path**: the five issues
      came from an owner-requested UX/DX audit and two prior changes'
      parked boundaries; D103's amendment, `countWhere`'s removal (over
      two rename candidates), and #470's downward promotion were settled
      by the lead session under the owner's standing delegation, not by
      the owner directly — and it records that an early draft of the
      proposal misread two measurement records as contradictory, since
      the correction is the reason group 1 observes `pg_typeof` at all.
      Files: `.changeset/*.md`, `openspec/task-times.csv`, `README.md`,
      `blackbox/*`.
- [x] 7.5 (~10m) File **three** follow-up issues through
      `~/.claude/skills/managing-hejbro-issues/issue.sh` (type, label,
      assignee, parent and board enforced — never a bare `gh issue
      create`, which orphans them).

      **Parent is `#412`, the post-release umbrella — not `#282`**
      (lead-directed). By the owner's standing definition, 0.2.0 ships
      when every `#282` sub-issue is closed, so hanging a new capability
      and a spec audit off `#282` would let this slice **widen the 0.2.0
      gate by its own hand**. Every issue body carries the line:
      *"parented under the post-release umbrella to avoid inflating the
      0.2.0 gate; the owner may re-parent on return."*
      1. A real `FILTER (WHERE …)` aggregate — the capability #469
         deliberately did not smuggle in behind a removal. Reference it
         from the `query-builder` delta so the scope boundary is
         discoverable from the spec.
      2. **Audit the remaining server-behavior assertions in
         `openspec/specs/`.** This slice corrected three (the recursive
         relaxation's justification, the set-op requirement's
         self-contradiction, and the aggregate scoping drift between
         `query-builder` and `query-type-inference`) out of a population
         of **18** found by:
         ```
         grep -rniE "postgres (rejects|refuses|accepts|requires|allows)|the (server|database) (rejects|refuses|accepts)|is (legal|illegal) (on|in)|the db (rejects|refuses)" openspec/specs/
         ```
         Put that command **in the issue body** so the next person does
         not re-derive the denominator. State honestly what is and is not
         known: 3 of 18 are confirmed wrong or unevidenced; **the other
         15 have not been checked and may be entirely correct**; and 18
         is what that regex matched, a **lower bound**, not the true
         count of such claims. Auditing them here would be plain scope
         creep — recording the population is not.
      3. **Reject set-operation branches whose column families differ.**
         Found while settling 6.2: `SetOpResult` does not compare
         families at all, so a `text` branch against a `numeric` branch
         type-checks and then fails on the server. Unlike the order gap
         (group 8) the server **does** catch this, loudly, so it is a
         *late failure worth moving earlier* rather than silent
         corruption — which is why it is filed instead of built here.
         The body carries three things: (i) the divergence is currently
         unguarded; (ii) the **false-positive risk** — `unknown` is a
         family, so a naive cross-family rule would reject a `text`
         anchor against a `sql`-escape-hatch recursive term, which
         Postgres accepts; (iii) the measurements a rule needs first —
         which family pairs Postgres actually refuses to unify, and how
         `unknown` behaves — note there is a clean mitigation for the
         false positive (treat `unknown` as a wildcard), so that risk
         alone would not sink the rule.

         **The issue must say it is independent of #489, and the reason
         is the load-bearing part.** A cross-family rule does **not**
         close #489's gap: #489 is about divergence *within* a family
         (`int`/`bigint`, `numeric`/`bigint`) — precisely what raises
         `42804` — and family granularity cannot see it, since
         `type-family.ts` collapses smallint, integer, bigint, real,
         double precision, numeric and the serials into one `"numeric"`
         family. So adding it would leave #489's case still uncaught
         while putting a type check into the recursive-term area, and a
         later reader of the `query-type-inference` delta would
         reasonably conclude #489 had been handled. **Closing an
         adjacent gap can mask the original one** — which is why it is
         filed as its own improvement rather than folded into 6.2, where
         it would make an honest "here is what we did not narrow, and
         why" read as less honest.
      Files: none in-tree.
- [ ] 7.6 (~6m) Boundary check before the PR:
      `git diff --name-only dev...HEAD` (three-dot) names nothing under
      `packages/neon`, `packages/skills`, `scripts/crap-report.mjs`,
      `scripts/pack-install-smoke.sh`, `.changeset/config.json`, or
      `.github/workflows/ci.yml` — the parallel team's slice. A hit here
      is reported, never resolved by editing their file.
- [ ] 7.7 (~8m) **The closing Docker slot** — one run. **No signal is
      needed any more**: the server has no other users (the parallel
      team disbanded and the lead's own measurements finished), so this
      runs as soon as 7.6 passes. The scheduling constraint that shaped
      this task — batch everything into one slot because the slot is
      contended — has expired; the batching stays anyway, because its
      second reason still holds (one run, one verdict, no partial
      results to reconcile).
      `pnpm --filter @hejbro/pg test:integration` executes **5.4, 6.3 and
      the slice's own integration gate at once** — the three are subsets
      of one command, so batching them costs one scheduling round instead
      of three (lead-approved). Tick 5.4 and 6.3 here, never earlier.

      **The witnesses were pre-verified during review, and that does not
      make running them redundant** — the two answer different
      questions. Review measured *"this SQL behaves this way on the
      server"* by reproducing the shapes by hand. This slot measures
      *"our tests depend on that behaviour"* — that what the builder
      actually renders reaches the same server, and that the assertions
      fail when it does not. A shape confirmed by hand still says
      nothing about whether the committed test exercises it.

      **Plus a mutation on the witnesses themselves.** A live witness
      can pass while proving nothing, and reading it will not reveal
      that: 5.4's first draft asserted `desc … nulls first` and expected
      `[null, 2, 1]` — correct name, correct syntax, and the server
      really does return that, yet **`DESC` already defaults to
      `NULLS FIRST`**, so it passed on a build emitting no `nulls`
      clause at all. Nothing inside the test says so; catching it needed
      an external fact about the server's defaults. So in this slot,
      **strip the `nulls` clause in the renderer and confirm both 5.4
      assertions go red individually.** The general form, for any
      witness: mutate not only the code under test but **the assumption
      that the expected value is specific to the behaviour being
      claimed**. That turns "we chose discriminating cases" from a
      deduction into a measurement.

      **That mutation needs two runs, not one** — found before the slot
      opened. 5.4's two assertions live in a single `it()`, and vitest
      stops a test at its first failing `expect`, so one mutated run
      reports `1 failed` with the **window assertion never executed**.
      That proves "at least one of them discriminates", which is not the
      claim. And the renderer cannot be mutated selectively: `nullsSuffix`
      is the single point both `orderByClause` (shared by select and
      window) and `setOpOrderByClause` call. So: **run 1** with the
      mutation, confirm the plain-select assertion goes red; **run 2**
      with the mutation still in place and that first assertion
      temporarily disabled, confirm the window assertion goes red; then
      revert and run the final gate. A container spin-up is 30–60s, so
      two runs cost little, and this stays *one slot, one verdict* — it
      is two executions inside it, not two slots. Same defect as group
      8's "one test appears to cover three sites"; here one assertion
      masks another.

      **M6 is no longer part of this slot — it was measured early, and
      the reason it was is worth keeping.** 7.1's corrected set-op
      justification cited M6 in three places in the completed tense
      *before M6 existed*, which is the failure mode this change spent
      its whole length correcting elsewhere. Review caught the wording,
      then simply ran the measurement (a two-line psql question needing
      no slot) rather than leaving a spec sentence resting on a forward
      citation. It came back **supporting** the delta — differently
      named branches execute and take the left branch's names, with a
      positive control showing the instrument still reports refusals.
      Recorded in `measurements.md`. Had it come back the other way, the
      delta would have had to be rewritten before the PR; that it did
      not is luck, not method, and the method is: **do not ship a
      sentence whose evidence is scheduled.**

      **Re-adjudication clause** (the lead's own condition): if any
      witness comes back **red** in this run, the verdict on its group
      **automatically reopens**. A group that landed on "code complete"
      must not silently become a final pass just because its execution
      happened later — the group returns to the implementer with the
      failure, and the slice's overall pass is withheld until green.
      Files: none — this task runs a command and records its output.

- [ ] 7.8 (~9m) **Assemble the merge-request declaration.** Added late,
      then corrected twice: it first read "open the PR", which is not the
      team's step — **PR creation belongs to the lead**, who verifies the
      declaration (SHA equals the remote head, base is current `dev`,
      merge-tree reports no conflicts), opens the PR, watches CI,
      squash-merges with `--match-head-commit`, runs the post-merge
      checks, closes the issues and files the archive PR. The team's last
      output is the **declaration**, not a pull request. It was then
      moved here from below group 8, where appending it had put a
      `7.x` task under the `## 8.` heading — `openspec validate --strict`
      rejects that, and rightly: a task's number is a claim about which
      group owns it.

      It carries: the **frozen 40-character SHA** with the sentence
      *"this SHA is fixed — no further commits, no rewrites"*; the
      **gate evidence**; the **six-part surface delta** (written out in
      `design.md`, quoted here); and the PR-body materials the lead will
      use verbatim —
      - **the commits to be squashed**, listed — the repo's standing PR
        rule
      - **`Closes #464 #469 #470 #487 #489`**
      - for **#487**, that it took **two halves** (key sets in group 3,
        column order in group 8) so a reader does not read the second as
        scope creep
      - **the three follow-ups filed** (#501, #502, #503) with one line
        each on why they were filed rather than built — the scope
        boundary should be visible without reading `tasks.md`
      - **what was measured**, pointing at `measurements.md`, and the
        two witnesses that ran only in the closing slot
      - **the residue #489 leaves** and that it is tracked at #500
      - **`blackbox/`'s Refs are pinned mid-branch** and need
        re-verification against the final tree after any rebase (the
        entry says so itself; the PR body repeats it because that is
        where a merger looks)

      **Not in the body**: lead rule numbers, and anything a reader
      cannot resolve from the repository. Same rule the archived
      artifacts follow.
- [ ] 7.9 (~5m) After the closing slot passes, **tick 5.4 and 6.3** —
      they are the only boxes deliberately left open, and forgetting
      them would leave the slice's own progress record claiming two
      tasks were never finished. Then confirm `tasks.md`, `design.md`,
      `measurements.md` and every delta are committed, since this file
      is the last thing edited and is therefore the likeliest to drift.

## 8. Branch column order is checked at build time (#487, second half)

Added mid-flight by lead decision (`design.md`). `SameKeys` is `keyof`
based and **`keyof` has no order**, while Postgres matches set-operation
branches **by position**. So after group 3, two branches with the same
key set in a different order still compile — and the failure is not a
server error but **silent data corruption**: measured on postgres:17,
`email` comes back holding a city and `city` holding an email. The
type says `{email, city}` and the rows disagree with it.

Type-level narrowing cannot reach this: TypeScript object types have no
key order to compare. A build-time check can, and it stays pure (no
I/O — it reads two projection objects).

- [x] 8.1 (~9m) [design] A pure helper in `@hejbro/core` comparing the
      two branches' projection key **order**, and the diagnostic it
      throws. Settle the error shape before code (lead's requirement):
      the message **prints both orders verbatim**, naming which branch
      and which position disagrees, and `Next:` says to align the
      branches' projection order. The code name follows the existing
      diagnostic family's conventions. Red:
      `packages/core/test/query/select.test.ts` — "a union whose
      branches list the same keys in a different order is refused, and
      the message shows both orders". Files: the new helper (placement
      decided here — `query/select.ts` or its own module), that test.
- [x] 8.2 (~9m) **Every construction site consumes it. There are three,
      not the two this task first named** (found in review; the
      enumerating grep is below, and the planner had its output in hand
      and read two lines out of it):
      ```
      rg -n 'queryKind:\s*"setOp"' --glob '!node_modules' --glob '!dist'
      ```
      - `packages/core/src/query/select.ts:245` — `combineSetOp`
      - `packages/query/src/db/chain.ts:280` — the chain surface builds
        its own node instead of routing through core; guarding only core
        would leave the **primary user-facing surface** corrupting data
      - `packages/core/src/query/with-recursive.ts:43` —
        `buildRecursiveEntryQuery`, which assembles a recursive CTE's
        `anchor UNION recursive-term` and passes through **neither** of
        the other two. Measured in review: an anchor `{email, city}`
        with a recursive term `{city, email}` compiles clean today
        (`tsc` exit 0), while a mismatched *key set* is refused
        (`TS2345`) — positive control, so the instrument was working.
        `CompatibleRecursiveTerm` is `SameKeys`-based and inherits the
        same order-blindness.

      Without the third, plain unions are guarded and recursive CTEs are
      not — the asymmetry would be invisible and this slice would have
      shipped "closed" twice over a hole it had already diagnosed three
      times. Red: `packages/query/test/db/*` — "the chain's union
      refuses branches whose key order differs" — and
      `packages/core/test/query/with-recursive.test.ts` — "a recursive
      term listing the anchor's keys in a different order is refused".
      Files: `packages/core/src/query/select.ts`,
      `packages/query/src/db/chain.ts`,
      `packages/core/src/query/with-recursive.ts`, those tests.

      **Relation to group 6** (state it, do not let the two groups
      contradict each other): 6.2's recursive-term rule is a *type-level*
      rule and, like every `SameKeys` descendant, it cannot see order.
      Group 8 covers order at build time for the same construct. Neither
      group may claim to have closed the other's half.

      **The fourth site is deliberately out of scope**:
      `packages/core/src/expr/codec.ts:959` rebuilds a `SetOpNode` while
      *decoding a snapshot*, so a construction-time guard never runs
      there. It is excluded on a reason, not by omission, and the
      reasons are ordered deliberately.

      **Primary reason — durable**: decoding is deliberately lenient
      (fix-select-traversal: "absence is history"), so putting
      validation on the read path would contradict a settled design
      posture rather than extend this guard. This holds regardless of
      what any snapshot happens to contain, now or later.

      **Secondary — a present-day exposure count, which can change**:
      there is nothing to catch today. Set-op is absent from
      `@hejbro/core@0.1.1` (`git grep -nE 'queryKind:\s*"setOp"|SetOpNode'
      '@hejbro/core@0.1.1' -- 'packages/core/src'` → 0, positive control
      on `HEAD` → 5+ files), and **no committed snapshot contains one**
      (`rg -l '"set-op"|"setOp"' --glob '*.json'` → 0, positive control
      `rg -l '"formatVersion"' --glob '*.json'` → 16 files). The second
      reason must not be written as the main one: on its own it reads as
      "revisit when a set-op snapshot exists", which is not the
      decision.

      **Name the input surface, don't just claim unreachability**
      — **an unreachability claim names the input surfaces it is
      claiming are closed**: the offending node can reach
      `decodeSelectNode` two ways. (1) A snapshot *written* by a version predating this guard —
      impossible for any released version, since core's set-op surface
      is absent at `@hejbro/core@0.1.1`, and possible only for a
      snapshot written from an unreleased build of this very branch.
      (2) A **hand-edited snapshot file** — genuinely reachable, and
      addressed one layer up **by a command the user has to run**:
      `hejbro verify` hashes the parsed-and-re-rendered snapshot
      (`packages/cli/src/commands/verify.ts:356`) against the banner's
      recorded value and reports a mismatch as `chain-tip-mismatch`
      (`:486`). A reordered set-op survives parse/render — order is
      meaningful content, not formatting — so the hash does move and it
      is caught.

      **Write it with that qualifier, not as an unconditional
      defence.** `verify` is registered as a command and nothing else
      invokes it (`rg -n "verifyCommand|from \"./commands/verify\""
      packages/cli/src/` → `main.ts` registration only); `generate`,
      `check` and `restore` do not call it. A user who never runs
      `hejbro verify` has no such protection. The boundary is therefore
      "hand-editing a snapshot is outside the supported path, and
      `hejbro verify` is the command that detects it" — claiming the
      decode path is simply "guarded elsewhere" would be the same
      overclaim this slice has corrected three times already. 8.3 states
      the boundary with both input surfaces named and this qualifier
      intact.
- [x] 8.3 (~6m) The spec delta for this half, in `query-builder` (the
      set-operation requirement). Three things it must carry, per the
      lead: the **measured evidence** — review's postgres:17 output
      showing an email column holding a city — **a justification that
      asserts server behaviour cites a measurement or is not written**; the **division of labour**
      — a *type* divergence is caught by the server itself
      (`UNION types uuid and text cannot be matched`, measured), and
      this guard covers the half the server cannot see, where the types
      match and only the order differs; and that the check is
      **build-time, not type-level**, with the reason (`keyof` has no
      order).

      Two more sentences it must carry: the guard covers **recursive
      CTEs too** (a recursive term's key order must match the anchor's —
      8.2's third site), so the rule reads as one rule and not as a
      plain-union special case; and the **decode path is outside it**,
      with 8.2's reason — a snapshot decoded from disk does not pass a
      construction-time guard, and decoding is deliberately lenient by
      an earlier decision — that is the reason, with the present-day
      exposure count (no released version wrote set-op snapshots; no
      committed snapshot contains one) as supporting evidence, **not**
      as the reason. A hand-edited snapshot is the one real input
      surface; `hejbro verify` detects it **when the user runs that
      command**, which is the honest form of the claim — nothing invokes
      `verify` automatically. That is a boundary, stated — **a gap the
      type system cannot see is a boundary; a gap we could close and
      chose not to is a defect** — not a gap left implied.
      Files: the `query-builder` delta under this change.

- [x] 8.4 (~9m) [design] **Split the diagnostic — one message was
      covering three different failures.** Found in review of 8.2: the
      guard's scan (`findKeyOrderMismatch`) is a pure positional walk
      with **no set comparison at all**, so everything lands on the
      "different order" verdict. Three failures share it, and for two of
      them the message is false *and* its `Next:` is impossible to
      follow:
      | input | today's message | true? |
      |---|---|---|
      | `{id,v}` vs `{v,id}` | same keys, different order → reorder | yes |
      | `{id,email}` vs `{id,town}` | same keys, different order → reorder | **no — different keys; reordering cannot produce them** |
      | `{id,v}` vs `{id}` | same keys, different order → reorder | **no — a key is absent; there is nothing to reorder** |

      Telling a user to reorder something that cannot be reordered is
      the same defect class this change fixes in #469: the text says one
      thing, the code does another.

      **Two codes, three messages.** `set-op-key-set-mismatch` covers
      rows 2 and 3 — they are one family because the **remedy is
      identical** ("make both branches project the same keys"), and a
      set of a different size is just a different set; its message names
      which keys differ or are missing. `set-op-key-order-mismatch`
      keeps row 1. Splitting into three codes would separate two
      failures that are fixed the same way, which is what a code is for.

      **Discrimination order is load-bearing: compare sets first, order
      second.** Both can be true at once (`{id,email}` vs `{town,id}`),
      and a positional scan would classify that case by *where the scan
      happened to stop* rather than by what is wrong — reporting "order"
      for an input where reordering cannot help. Set-first sends every
      both-true case to the key-set code, which is what makes
      "the code points at the remedy" true rather than aspirational.
      Reversed, that justification is simply false.

      Red: `packages/core/test/query/select.test.ts` — one case per row
      above **plus** the both-true case `{id,email}` vs `{town,id}`
      expecting `set-op-key-set-mismatch` (that case is the single
      indicator of whether the discrimination order is right). Each
      assertion checks **`code` and `message`** — code alone cannot
      catch a wrong message, which is exactly why this defect survived
      the earlier `toThrow` hardening. Files:
      `packages/core/src/query/set-op-key-order.ts`, that test,
      `packages/core/test/query/with-recursive.test.ts`.

      **Not to be done here**: the delta and the skill do **not** gain
      the code strings. Measured convention — 10 of 12 shipped
      capability specs mention no diagnostic code at all — so
      documenting one here would depart from it, not repair an omission.

## Verification

- `pnpm check`, `pnpm check-types`, `pnpm test`, `pnpm check:crap`,
  `pnpm check:tasktime` — all clean, output shown. Run with
  `TURBO_FORCE=1` in this worktree: the turbo cache is shared across
  worktrees and a parallel team is active, so an unforced run can
  replay **their** logs as `FULL TURBO` hits and "the gates passed"
  stops meaning anything (#448).
- `pnpm --filter @hejbro/pg test:integration` green against a real
  `postgres:17` — run **once, in 7.7's closing slot**, covering 5.4 and
  6.3 together with this gate. It is excluded from the default `pnpm
  test` by pattern (`packages/pg/vitest.config.ts`, owner decision ⑤:
  local-only, never CI), so no other gate reaches it by accident and
  nobody runs it before 7.7's signal.
- `openspec validate harden-query-surface --strict`.
- Branch pushed to `upstream` after each group's verdict, with
  `git ls-remote --heads upstream feat-harden-query-surface` confirming
  it landed.
