# Tasks: harden-recursive-nullability

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Where nullability is decided** (lead ruling, #500/R2): in
`@hejbro/query`'s `ProjectedColumnResult` alone — the one place that
already knows a projected value's null dimension, left joins included.
The core builder does not re-derive it: `asRecursive`'s outward
reference only *carries* the recursive term's projected expression per
key, and the query layer resolves both sides and unions the null. A
second copy of the rule in core would be a proper subset of that
knowledge (a recursive term projecting a left-joined table's non-null
column reads nullable in query, non-null in the copy) and would widen
too little — the lying type this change exists to remove.

**Out of scope**: the *anchor's* own left-joined set, which
`asRecursive` absorbs exactly as every other CTE body position does. A
key the anchor projects from a left-joined table still reads non-null
outward — a pre-existing gap, unchanged here and pinned by no test of
this change (an untested boundary, not a fixed behavior).

**Files edited**: `packages/core/src/query/with.ts` and the core CTE
type tests (1.1, 1.1b); `packages/query/src/types/select-result.ts` and
the query CTE type tests (1.2), the query execution test (1.2b);
`skills/hejbro/references/query-layer.md`, one `.changeset/*.md` (1.3).
`packages/cli/src/core-surface.ts` (#500/R5): a new runtime export of
`@hejbro/core` must be classified as vocabulary or engine before it
ships (#471), so 1.1's `widenedByBrand` forces this one file open —
classified **engine**, being the type layer's carrying mechanism and
not something `hejbro` re-exports. `packages/cli/test/exports.test.ts`
is not edited: its type-only presence list is a selective smoke check,
not a completeness requirement. `packages/query/src/db/chain.ts` is
expected to need **no source change** — `ChainApi.with` takes core's own `CteBuilder` and resolves
rows through `SelectResult`, so the widening reaches the chain
structurally — and it is the only further source file this change may
touch if that expectation fails. If a task appears to need any other
file, that goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.1b → 1.2 → 1.2b → 1.3 → 1.4 (review-born).

## 1. Outward nullability

- [x] 1.1 (~6m) **[design]** The core builder carries the recursive
      term's projection outward. Settles the carrier type
      (`WidenedBy<TRecursiveValue>`: a phantom brand, never assigned at
      runtime, intersected per key onto the outward reference's field —
      the `columnOriginBrand`/`readAsBrand` precedent) and where it
      lands (`asRecursive`'s outward `CteReference`, every key, not a
      selected subset: which keys widen is the query layer's decision,
      not core's). Red: the core CTE type test file, a structural table
      — {every outward key carries `WidenedBy<the recursive term's
      projected value for that key>`}, {the reference the recursive
      callback receives carries none}, {the outward reference is still
      assignable to `FromSource`, i.e. `select({ … }, r)` still
      type-checks and `r.k`'s `exprNode` is still `ColumnRefNode`}.
      Row nullability is **not** asserted here (it is not observable in
      core — see the ruling above); 1.2 owns it. Files: `with.ts`, its
      type tests.

- [x] 1.1b (~6m) The carrier also carries the recursive term's own
      left-joined set (#500/R3). `WidenedBy<TRecursiveValue,
      TRecursiveLeftJoined>`: `asRecursive` infers the set from the
      stage the recursive callback returns, since a left-joined column
      is nullable no matter what it declares and that fact lives on the
      stage, not on the value. Red: the core CTE type test file, three
      structural rows — {a recursive callback that left-joins a table
      carries that table in the outward brand}, {a callback that
      left-joins nothing carries `never`, the tracked empty set}, {a
      recursive term that is a `SetOpStage` carries `UntrackedJoins`,
      the fail-safe default, since that stage type holds no set at
      all}. The comment on the carrier states the one constraint that
      makes this legal: `select.ts`'s absorption rule forbids
      *narrowing* on a set a position did not earn; this reads it only
      to *widen*. Files: `with.ts`, its type tests.

- [x] 1.2 (~7m) The query layer widens the outward row. Red: the query
      package's CTE type tests, an `expectTypeOf` table through
      `handle.with(...)`'s recursive form — {anchor non-null, recursive
      nullable → outward nullable; the reference inside the recursive
      callback non-null}, {both non-null → non-null}, {anchor nullable,
      recursive non-null → nullable}, {the recursive term projects the
      key through a window function → nullable — a **regression guard**,
      not evidence of the widening: `over(...)` already fails
      `IsDirectColumnRef`, so `ProjectedColumnResult` types it nullable
      today}, {two keys, one widened, one not}, {**the recursive term
      projects a left-joined table's non-null column → outward
      nullable**} — the last row is why the rule lives here and not in
      core, and it resolves through `ProjectedColumnResult<R,
      TRecursiveLeftJoined>`, the set 1.1b carries.
      The table is stated over `RecursiveCteReference` +
      `SelectResult<{…}, never>`, not literally through
      `handle.with(...)` (#500/R4): `makeWithChain` resolves the
      untracked default, under which every key of a `db.with(...)` row
      is already nullable for a reason of its own
      (narrow-join-nullability's absorption), so the rows that must stay
      non-null could not be stated there at all. Files:
      `types/select-result.ts`, tests.

- [x] 1.2b (~6m) The delivered value and the chain surface agree. Red:
      one execution through a recording driver where the recursive
      term's row carries `null` — the delivered value is `null` and the
      row type admits it — plus a pinned assertion that the chain form
      (`handle.with(...)`) and the core builder produce the identical
      row type, since the chain reuses core's `CteBuilder` rather than
      restating it. If `chain.ts` needs no source change, this task
      lands as tests only and says so. Files: the query execution test.

- [x] 1.3 (~6m) Docs and changeset. The CTE section of `query-layer.md`
      states "type from the anchor, nullability from either branch";
      `pnpm changeset` → `patch`. Files: the reference, `.changeset/*.md`.

- [x] 1.4 (~14m) Review repair: the set-operation exception, the nested
      read on both sides, and nine regression rows (#500/R6 and
      #500/R7; review B1, B2, E7, E11). One source change, in
      `select-result.ts`, closing one asymmetry from both ends: where
      `NestedOrExprResult` resolves a `NestedReadMarker` and returns
      before `ProjectedColumnResult` is ever consulted, a key whose
      value carries `WidenedBy<R, J>` also unions
      `RecursiveNullWidening` (review B2: otherwise a recursive term
      projecting a nullable value for a nested-read key leaves the
      outward type non-null while the server delivers `null` — the
      narrowing direction the delta's own SHALL exists to remove); and
      the widening resolves the recursive term's own value `R` through
      **`NestedOrExprResult`**, never `ProjectedColumnResult` directly
      (review E7/E8: that type does not know the nested-read rule and
      answers "nullable" for a `jsonArrayFrom` value, which renders as
      `coalesce(json_agg(…), '[]')` and structurally cannot be null).
      One layer only — the widening must not re-enter itself.
      Nullability's source of truth stays `ProjectedColumnResult` (R2);
      `NestedOrExprResult` is its dispatcher, not a second rule.
      **If the fix needs any file outside `select-result.ts`, stop and
      report**: the ruling converts to a stated boundary plus an issue
      instead. For the set-operation half there is no source change: a
      `SetOpStage` recursive term carries no left-joined set, and an
      untracked position reads nullable — this repository's frozen contract, "unknown" never
      read as "empty". What was missing is the sentence and the row.
      The delta's THEN clause and the skill's CTE sentence each gain
      the exception ("…stays non-null — unless the recursive term is a
      set operation, whose left-joined set is not tracked: every key of
      such a term then reads nullable"), and the reviewer's B1 input
      (R32) is pinned as a row of 1.2's table, its comment quoting that
      exception so the next reader does not re-run the investigation.
      A second row (the reviewer's F1) pins why the exception is not
      mere over-widening: a set-op recursive term that left-joins
      inside itself really does deliver `null` for a `notNull` column
      (measured on postgres:17), and the untracked reading is what
      covers it — asserting `never` there would type that row non-null.
      Two more rows come from B2: {a nested-read key whose recursive
      term projects a nullable `json()` column → outward nullable,
      the server having delivered `null` for it}, {the same nested-read
      key whose set-op recursive term projects it as a nested read →
      the value's own rule answers, not the untracked one (#500/R8), so
      the key stays non-null, which the server confirms (`[]`, never
      null) — a non-regression pin, and stated over `unionAll`, since
      `union` over a `json` column is refused by Postgres outright},
      and one where the two nested reads meet across the branches
      {anchor an array read, recursive term an object read for the same
      key → outward nullable, the object read's own rule answering and
      the server delivering `null` on the recursive rows}, and two more
      from the two nested reads differing: {`jsonObjectFrom` is already
      `… | null` by its own rule, so the union is idempotent},
      {`jsonArrayFrom` is a non-null array, so the widening is what adds
      the null}. The table must also hold rows that expect **non-null**,
      or over-widening passes it unseen (review E7/E11): {anchor and
      recursive term projecting the same `jsonArrayFrom` → outward
      non-null, the server unable to deliver null}, {a `notNull`
      non-json anchor value with a `jsonArrayFrom` recursive value →
      outward non-null, which the current SHA gets wrong}, {control: the
      same anchor with a `notNull` text recursive value → outward
      non-null, so the widening is per key and not blanket}. A json or
      jsonb column reads back as `unknown` whatever it declares, so a
      row asserting non-null over a json *column* verifies nothing —
      state the non-null rows over a non-json anchor. A nested read
      with no recursive term at all stays non-null — pin that it did
      not move.
      In the same pass the
      false justification is removed everywhere it appears (review
      N1/N2): a plain set operation keeps the left branch's projection
      and does **not** union nullability per key, so the delta, the
      proposal, the design ruling and the skill's own universal
      sentence each state the recursive form's rule on its own terms.
      Touching the delta means re-running `openspec validate --strict`
      and `check:modified-titles`. Files:
      `packages/query/src/types/select-result.ts`, the query type
      tests, `skills/hejbro/references/query-layer.md`, this change's
      `proposal.md`/`design.md`/delta.

      The table, as the reviewer measured it — red first for the four
      that fail today, the rest pinned green so the fix cannot move
      them:

      | row | outward key expects | today |
      |-----|--------------------|-------|
      | E4 — array-read key, plain recursive term projecting a nullable `json()` column | null | non-null → **red** |
      | E11a — non-json `notNull` anchor value, array-read recursive value | non-null | null → **red** |
      | E12 — anchor an array read, recursive term an object read for the same key | null | non-null → **red** |
      | R32 — set-op recursive term, plain column, non-null on both sides | null | already green |
      | F1 — set-op recursive term left-joining inside itself | null | already green |
      | E5 — object-read key | null | already green |
      | E7 — anchor and recursive term the same array read | non-null | already green |
      | E11c — same anchor, `text().notNull()` recursive value | non-null | already green |
      | E2u — `unionAll` set-op recursive term projecting an array read | non-null | already green |
      | a nested read with no recursive term | unchanged | already green |

      Three rows go red first; the other seven are pins the fix must not
      move. The reviewer's E6 is the same input class as E4 (an array-read
      key with a nullable `json()` column in the recursive term) and is
      not stated twice.
