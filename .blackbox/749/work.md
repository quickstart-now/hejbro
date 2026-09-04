# Work — quickstart-now/hejbro#749

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Setof bodies return the declared table's whole row

_2026-09-04T21:19Z_

Under `returns setof <table>`, `ctx.return()` inside a `defineFunction`
body now accepts only that table's whole row (design.md scope (a),
"whole row only" — the lead's pick over accepting a complete-but-
reordered projection): a `select(<table>)` (or a select filtered/joined
but still whole-row-projected over that table), or a mutation
(`insert`/`update`/`delete`) on that table ending in a bare
`.returning()`. Every other shape is refused, including a projection
naming every column of the declared table in a different order —
Postgres's `return query` matches result columns by position and count,
never by name, so a complete-but-reordered projection is the silently
wrong case a partial one at least fails loudly on; Postgres accepts the
`CREATE` either way and every call then fails at runtime with
"structure of query does not match function result type".

New error code: `return-expects-whole-row`. Check site:
`assertReturnIsWholeRow`, called in `recordReturnQueryShape`
(`packages/core/src/plpgsql/body-context.ts`) right after the existing
`assertReturnHasReturning` and before `markConsumed` — after the
existing "has this mutation called `.returning()` at all"
(`return-expects-returning`) check, before the query is marked consumed,
so a bypassed-type caller reaching this point without `.returning()`
still sees `return-expects-returning` first, and a scalar or trigger
body's own return-shape checks (`scalar-return-expects-expression`,
`trigger-return-expects-row`) still fire first for those declaration
kinds — verified directly by 3 precedence-row tests.

`RecordingState` gained `declaredTable: { schemaName, tableName } |
null`, threaded from `defineFunction` (set only when `returns.
returnsKind === "setofTable"`) through `recordBodyWithGuard`/
`recordOnce`/`createRecordingContext`; `defineTrigger` always passes
`null`.

Type-level narrowing (design.md's own "if it doesn't hold cleanly,
file a follow-up" condition): `ReturnableQuery`'s three mutation members
narrow back to a bare `.returning()` (`InsertFinal<Table, undefined,
"final">`, `UpdateFinal`/`DeleteFinal` the same), and the select member
narrows to `SelectLimited<Table>` (whole-table projection only,
`SelectProjection` is `Table | Record<string, Expr>`). Verified not to
over-narrow the "select with a join" accepted case
(`LeftJoinedBrand`'s own optional-property structural typing keeps a
joined select assignable). Confirmed clean across the whole workspace —
`TURBO_FORCE=1 pnpm check-types` (18/18 packages: core, query, cli,
supabase, pg, neon, nile, and every example) — so the narrowing was kept
rather than reverted to a runtime-only guard.

Test coverage (`packages/core/test/plpgsql/body-context.test.ts`'s new
"a setof body accepts only the declared table's whole row" describe
block, tasks.md's own input table): 18 refused rows (insert/update/
delete on the declared table x {one column, two columns, every column
declared order, every column reversed order, one aliased column} = 15,
plus a column-projected select over the declared table, a select over
another table, and an insert-whole-row on another table = 3), 6 accepted
rows (bare select, select+where, select+join to another table, and
insert/update/delete ending in bare `.returning()`), 3 precedence rows.
Red->green: stashing the three source files reproduced exactly 19
failures (the 18 refused rows plus the one flipped `render-body.test.ts`
pin) with everything else — including the 6 accepted and 3 precedence
rows — still green, confirming the new rows depend only on the new
rule.

`render-body.test.ts`'s previously-shipped "renders a definer function
with a projected returning" test (the #634 acceptance) was flipped into
"refuses a projected returning under returns setof <table>";
`body-context.test.ts`'s type-only "controls" test dropped its
`acceptedProjectedReturning` member and gained a new `@ts-expect-error`
type-check test for the narrowed type.

Task commit: 1.6 (`df64acd2`). Skill/changeset follow-up: 1.7
(`aaa1b1a8`) updates `function-builder-pitfalls.md`'s `ctx.return` table
and #634 paragraph to the refusal rule.

