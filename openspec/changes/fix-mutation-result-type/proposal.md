# Proposal: fix-mutation-result-type (#622)

## Why

Awaiting `db.insert(t).values(row)` — no `.returning()` — is typed as
`Promise<ReadonlyArray<Row>>` and resolves to `[]` every time: the
statement carries no `RETURNING` clause, so the driver has nothing to
hand back. The type says "the inserted rows come back"; the runtime
says nothing comes back; only a doc comment in `packages/query` (which
calls this a "known, documented imprecision") tells the truth. The
add-apply-engine live witness hit it against a real server and had to
work around it with a raw statement. It is a shipped public surface
claiming more than it does — the exact class of defect the last two
correction rounds were about — and the owner's standing rule closes the
easy exit: hejbro never renders an implicit `returning *`, so the fix is
not "add RETURNING silently".

## What Changes

- A mutation chain that never called `.returning()` SHALL resolve to a
  type that cannot be read as rows: `ReadonlyArray<never>` — the honest
  type of the empty array the runtime already produces. `.returning()`
  with no projection keeps meaning "every declared column"; `.returning({
  … })` keeps meaning exactly those keys. Only the never-called case
  changes, and it changes at the type level only: no SQL, no runtime
  value, no driver call is different.
- The same rule applies to `update` and `delete`, which share the
  mechanism (`ReturningRow`) and today share the imprecision.
- A caller that read rows from a mutation without `.returning()` now
  fails to compile where it previously compiled and read `undefined` —
  that is the point. Pre-1.0, `minor`, called out in the changeset.
- The skill's query reference states the rule in one sentence.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `query-type-inference` — one ADDED requirement: a mutation without
  `returning` resolves to no rows, and the type says so. The existing
  sentence "`returning()` without a projection … carry declared
  nullability, as they always have" is untouched and remains true.

## Impact

- `packages/core/src/query/mutate.ts` (the mutation stages' `TReturning`
  default becomes a distinct never-requested marker; `returning()`'s own
  no-argument form keeps `undefined`), `packages/query/src/types/
  returning.ts`, `packages/query/src/db/db.ts` (`ExecuteResult`),
  `packages/query/src/db/chain.ts` (`*ChainFinal` defaults), their type
  tests, `skills/hejbro/references/query.md` (or wherever the mutation
  result is documented — measured in task 1.1), `.changeset/*.md`,
  `openspec/task-times.csv`.
- Public types touched: `InsertFinal`/`UpdateFinal`/`DeleteFinal` (and
  their earlier stages) gain a wider `TReturning` constraint;
  `ReturningRow`'s second parameter accepts the marker. Exact-set export
  pins in `exports.test.ts` decide whether the marker is exported (task
  1.1, `[design]`).

## Out of scope

- Returning an affected-row count for a mutation without `returning`
  (a new runtime surface; the driver contract would have to carry it).
- Re-writing the G9 witness's raw-statement workaround (it stays correct;
  a follow-up may swap it for `.returning()`).
