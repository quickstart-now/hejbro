# Tasks: fix-select-traversal

Eight groups. Groups 1–4 are the traversal ratchet and its consumers:
group 1 builds the shared table, groups 2–4 consume it and share no files
with each other. Groups 5–6 are the value-semantics findings and touch
disjoint files from 1–4. Group 7 holds both live witnesses (one file, so
it is one group). Group 8 is release hygiene. Estimates are pure work
minutes (D88); every task names the failing test it starts from.

Sequencing: 1 → {2, 3, 4} → 7 → 8, with {5, 6} free to run any time after
1 (they do not depend on the table). Nothing outside group 1 may
hand-write a `SelectNode` field list.

## 1. One traversal table, keyed by the node itself

- [x] 1.1 (~10m) [design] `packages/core/src/expr/select-children.ts`:
      `SELECT_CLAUSE_TRAVERSALS` typed
      `{ readonly [K in keyof SelectNode]: ClauseTraversal }` — a
      `keyof`-keyed mapped type, so a field added to `SelectNode`
      without an entry is a `tsc` error at this one place and every
      consumer inherits the fix. Each entry is either
      `exprClause(read, replace)` (its child expressions, plus a
      rebuild from a same-length replacement list that preserves the
      clause's non-expression parts — a join's `joinKind`/`table`, an
      order term's `direction`, a projection column's
      `alias`/`resultKey`) or `noExprs(reason)` with a one-line reason
      (`from` is a table reference, `limit`/`offset` are inlined
      integers, `queryKind` is the discriminator). **Entry order is
      render order** — `distinct`, `projection`, `joins`, `where`,
      `groupBy`, `having`, `orderBy` — because group 3 derives
      bind-parameter numbering from it; the file comment states that,
      since insertion order is load-bearing here and nothing else would
      show it. The same comment states the ratchet's **limit**: it
      forces an *entry*, not a correct traversal — a new field entered
      as `noExprs("…")` compiles fine, so that reason string is a
      claim the author is making, and it is the one thing here no test
      can check. Exports `selectChildExprs(query)` and
      `replaceSelectChildExprs(query, exprs)`. Red:
      `packages/core/test/expr/select-children.test.ts` — "collects one
      child expression per clause of a fully populated select, in render
      order" (a select carrying a distinct marker expression, a
      projection expression, a join `on`, a `where`, a `groupBy`, a
      `having` and an `orderBy`, each holding a distinguishable
      literal). Files: that source file, that test.
- [x] 1.2 (~6m) Round-trip and ratchet proof:
      `replaceSelectChildExprs(query, selectChildExprs(query))` returns
      an equal node (nothing is dropped or reordered by the rebuild) —
      covering `distinct` in all three of its states (`null`, `all`,
      `on`), since a rebuild that turns `null`/`all` into an `on` with
      an empty column list changes the SQL silently and nothing else
      would catch it,
      and the table's runtime key set equals the key set of a fully
      populated `SelectNode` — the type-level ratchet's runtime
      counterpart, which also catches a field added to the *node builder*
      but not to the node type. Export both helpers from
      `packages/core/src/index.ts` (group 3 and group 4 import them
      across package boundaries). Red: same test file — "every
      SelectNode field has a traversal entry". Files:
      `packages/core/src/index.ts`, that test.
- [x] 1.3 (~8m) **F5a.** `walk.ts`'s `existsChildExprs` and
      `selectExprChildExprs` become thin wrappers over
      `selectChildExprs`, so the scope walk and the deep `some` see
      `groupBy`/`having`/`distinct on` too. Keep both export names (the
      preset imports them). The two used to differ only in whether the
      projection was walked; they no longer need to, because an
      `exists()` subquery's projection is always `constantOne` and
      yields no expressions — state that invariant in the comment
      instead of re-deriving it in code. Red:
      `packages/core/test/expr/walk.test.ts` — "descends into an
      exists() subquery's having and groupBy" — and
      `packages/core/test/dsl/rls-binding.test.ts` — "rejects a policy
      whose exists() groups by a table outside scope" (the scope-check
      suite lives in `rls-binding`, not `rls`). Files:
      `packages/core/src/expr/walk.ts`, those two tests.

## 2. Core's own traversal sites

- [x] 2.1 (~8m) **F2.** `render-sql.ts`'s `renderSelectClauses` builds
      `mentionedRefs` from `selectChildExprs`, so a foreign reference in
      `groupBy`/`having`/`distinct on` throws `foreign-column-ref`
      instead of rendering wrong SQL. Red:
      `packages/core/test/expr/render-sql.test.ts` — "throws
      foreign-column-ref for a groupBy/having/distinctOn reference
      outside scope". Files: `packages/core/src/expr/render-sql.ts`,
      that test.
- [x] 2.2 (~9m) **F3.** `retargetSelectNode` maps the table's child
      expressions through `retargetExprNode` and rebuilds via
      `replaceSelectChildExprs`; `isSelectNodeUnchanged` collapses into
      the same list comparison (identity preserved — an unrelated rename
      must still return the exact same object reference). Group 8's CRAP
      gate then removed that helper outright: once
      `replaceSelectChildExprs` is itself identity-preserving, "nothing
      changed" is the rebuild returning the same reference, and the
      eight-way `&&` chain had nothing left to compare. `projection`
      and `from` keep their existing dedicated handling for the
      *identifiers* they carry (`allColumns`' column names, the table
      ref); the generic path covers expressions only, and the table's
      `noExprs` reasons say so. Red:
      `packages/core/test/expr/retarget.test.ts` — "retargets a column
      reference inside groupBy/having/distinctOn" — and
      `packages/core/test/rename-plan.test.ts` — "no leftover diff after
      renaming a column a view groups by". Files:
      `packages/core/src/expr/retarget.ts`, those two tests.
- [x] 2.3 (~7m) [design] **F7.** `decodeSelectNode` reads a v8 snapshot
      written before the clause fields existed: a **missing** field
      decodes to its empty value (`groupBy: []`, `having: null`,
      `distinct: null`, `offset: null`, `limit: null`), a **present but
      malformed** one keeps failing through the existing coded
      diagnostic — never a raw `TypeError`. The design part is that
      boundary, and it is deliberately not a version bump: v8 was
      extended in place, so old v8 files are exactly the case leniency
      exists for (this is the read half of the #412/#413 snapshot
      upgrade-path obligation). Red:
      `packages/core/test/expr/codec.test.ts` — "decodes a pre-extension
      v8 select node without its clause fields" and "fails with a coded
      diagnostic on a malformed clause field". Files:
      `packages/core/src/expr/codec.ts`, that test.

## 3. The compiler's parameter lift

- [x] 3.1 (~10m) **F1 (spec violation).** `liftSelectNode` walks the
      table's clauses in entry order — which is render order — so every
      literal in `distinct on`/`groupBy`/`having` becomes a `$n` bind
      parameter and `$n` numbering still matches the order the
      placeholders appear in the SQL text. `distinct on` sorts *before*
      the projection, matching `renderSelectClauses`. Red:
      `packages/query/test/compile/select.test.ts` — "lifts literals in
      having, groupBy and distinctOn to bind parameters" plus
      "numbers parameters in rendered order across all clauses" (a
      literal in every clause at once, asserting both the SQL text and
      the exact `params` array). Files:
      `packages/query/src/compile/params.ts`, that test.

## 4. The preset's private copy

- [x] 4.1 (~7m) **F5b.** `rls-uncached-auth-call` deletes its own
      `childrenOfExists`/`childrenOfSelectExpr`/`projectionExprsOf`/
      `whereClauseOf` and calls core's exported helpers, so an uncached
      `auth.uid()` inside a subquery's `having` or `groupBy` is found.
      The doc comment explaining *why* this validator descends into a
      subquery stays (it is a different concern from core's scope walk);
      what goes is the duplicated field list. Red:
      `packages/supabase/test/rls-uncached-auth-call.test.ts` — "flags an
      uncached auth.uid() inside an exists() subquery's having". Files:
      `packages/supabase/src/validators/rls-uncached-auth-call.ts`, that
      test.

## 5. A json null is a null

- [x] 5.1 (~6m) **F4.** `resolveJsonLift` guards `null` the way its
      array and interval siblings already do, so a written `null`
      reaches the column as SQL NULL instead of the JSON document
      `'null'`. `undefined` keeps its existing meaning (the key is
      absent). Red: `packages/core/test/query/column-value.test.ts` —
      "lifts a null written to a json column as a SQL null literal" —
      and `packages/core/test/query/mutate.test.ts` — "values({payload:
      null}) compiles to a null parameter, not a 'null' document".
      Files: `packages/core/src/query/column-value.ts`, those two tests.
- [x] 5.2 (~5m) The spec delta this change already carries
      (`specs/query-type-inference/spec.md`, the json bullet's null
      sentence and its scenario) is checked against the implemented
      behavior and the escape hatch in it is compiled, not asserted from
      memory: ``sql`'null'::jsonb` `` still writes a JSON null. Red:
      `packages/core/test/query/mutate.test.ts` — "the sql escape hatch
      still writes a JSON null document". Files: that test.

## 6. Aggregates: typing and precision

- [x] 6.1 (~7m) [design] **F9.** `min`/`max` keep their argument's read
      type (family, `typeNode`, any `.$type<T>()` brand) but drop its
      ColumnRef-ness — the returned expression's `exprNode` is a
      `functionCall`, so a value typed as a `ColumnRef` would be a lie.
      The design part is the return type that expresses "same read type,
      no longer a column reference"; `index(max(t.a))` must stop
      type-checking, and `select({ m: max(t.a) })` must keep its exact
      read type. Red: `packages/core/test/query/select.test.ts` — "max()
      keeps the argument's read type" and "max() is not accepted where a
      ColumnRef is required" (a type-level red). Files:
      `packages/core/src/expr/aggregate.ts`, that test.
- [x] 6.2 (~6m) Characterize **F6** before fixing it: which aggregate
      cell shapes inside a `jsonArrayFrom`/`jsonObjectFrom` actually come
      back wrong — `max(bigintColumn)`, `count()`, `sum(...)` — and
      which are already safe. The measurement decides 6.3's rule instead
      of a guess about it. Red:
      `packages/query/test/db/nested-revive.test.ts` — "an aggregate
      cell in a nested read survives past 2^53". Files: that test.
- [x] 6.3 (~9m) [design] **F6.** `withJsonSafeCasts`' at-risk cast stops
      being `columnRef`-only and covers the aggregate cells 6.2 proved
      are at risk, using the read type the chain already has in
      `projectionInput` (6.1 is what keeps that type available on an
      aggregate). Owner ruling: covering them is the preferred outcome;
      the fallback, if the rule cannot be expressed without spreading
      into unrelated expression shapes, is to reject an at-risk
      aggregate inside a nested read with a coded error — **report the
      fallback and its reason before taking it, do not take it
      silently**. Red: 6.2's test, now green, plus
      `packages/core/test/query/select.test.ts` — "casts an at-risk
      aggregate cell in a nested read". Files:
      `packages/core/src/query/select.ts`, those tests.

## 7. Live witnesses

- [x] 7.1 (~8m) **F1** against a real postgres:17: a query with a value
      in `having` and in `distinct on` runs and returns the right rows,
      with an adversarial value that is not valid SQL text (a quote and
      a semicolon) — text splicing would fail the statement, so the
      witness measures the parameterization rather than restating the
      compiler. Files: `packages/pg/test/integration.test.ts`.
- [x] 7.2 (~6m) **F4** against the same server: `null` written to a
      `jsonb` column is found by `where payload is null`, and a
      `notNull` json column refuses it. Files: same file.
- [x] 7.3 (~7m) **F6** against the same server — added after 6.2 had to
      measure through a proxy (the mock driver cannot round-trip a real
      value, so 6.2 asserts the presence of the `::text` cast instead of
      the surviving value). This is the one place the actual claim can be
      made: a `max(bigint)` and a `count()` cell inside a
      `jsonArrayFrom` whose value is past 2^53 comes back exactly, not
      rounded. Files: same file.

## 8. Release hygiene

- [x] 8.1 (~7m) `skills/hejbro/references/query-layer.md`: the json
      write paragraph gains the null rule and the escape hatch (F4), and
      the aggregate paragraph states that `min`/`max` are expressions,
      not column references (F9). A stale skill is a broken user
      contract, so this lands in the same PR.
- [x] 8.2 (~6m) One `.changeset/*.md` (D59, `patch`). Its body carries
      the reason the grade is not higher, because the proposal calls F9
      breaking: the change is a *type narrowing* on an unreleased
      surface — `min`/`max` stop satisfying an API that demands a
      `ColumnRef`, and F4's null semantics ride on
      `write-json-and-bytea`, which has not shipped — so no released
      contract moves, and `major` is not used before 1.0. `openspec/task-times.csv` rows for every group, README
      task-time badges (`pnpm check:tasktime`) and the CRAP block
      (`pnpm check:crap`), and the `blackbox/` entry. The entry states
      the **decision path**, not just the outcome: the trigger was an
      adversarial review of the day's merges (F1–F9, #444); F4's
      semantics, F6's preferred-cast-with-rejection-fallback and F7's
      absence-tolerance boundary were settled by the lead under the
      owner's 2026-08-29 blanket delegation ("every decision, merges and
      planning alike, judged against ORM and Postgres norms"), not by
      the owner directly. Recording that the decision came through the
      delegation — rather than writing it as if the owner ruled — is
      what the file is for.
- [x] 8.3 (~5m) The second spec delta,
      `specs/query-execution/spec.md` (written by the planner, commit
      and validate only): nested-read revival covers aggregate cells,
      and a `::text` cast is transparent to conversion regardless of who
      wrote it. Added because the live witness turned F6 from "the cast
      is emitted" into "the value survives", and the existing
      requirement only ever spoke of a *column's* declared read type —
      an aggregate cell has none. No code change is expected; if the
      implemented behavior and this wording disagree, the wording is
      what gets reported, not silently edited. Verify with `openspec
      validate fix-select-traversal --strict`.

## Verification

- `pnpm check`, `pnpm check-types`, `pnpm test`, `pnpm check:crap`,
  `pnpm check:tasktime` — all clean, output shown. `check-types` covers
  every package *including `examples/`*: F9 removes a type some call
  site may be relying on (an `orderBy`/`distinct on`/nested-read cell
  written as `max(t.a)`), and a package-scoped run would not show it.
- `pnpm --filter @hejbro/pg test:integration` green against a real
  postgres:17 (group 7).
- No golden or example regeneration: the node's *shape* does not change,
  only who traverses it.
