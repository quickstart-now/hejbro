# Tasks: narrow-join-nullability

## Frozen contract (do not renegotiate mid-group)

Groups 1-3 share one type contract. It is frozen here **before** group 1
starts; a task that needs it changed stops and escalates to the planner
rather than editing around it.

```ts
// packages/core/src/query/left-joined.ts   (new file, task 1.1)

/** Phantom marker, never assigned at runtime — the `columnOriginBrand`
 *  precedent. A select stage carries its left-joined set here because a
 *  type parameter no part of a type's structure uses is erased for
 *  inference: `ExecuteResult` could not recover it otherwise. */
export const leftJoinedBrand: unique symbol = Symbol("hejbro:left-joined");

/** This position does not carry the statement's left-joined set, so every
 *  projected field stays widened (the fail-safe direction).
 *
 *  `unknown` and not a literal sentinel, corrected mid-G1 against a
 *  measurement: a narrow sentinel made a tracked stage unassignable to
 *  any position annotated with the default (TS2379 at `chain.ts`'s
 *  `makeJoinableChain`), which defeats the very back-compatibility the
 *  default exists for. As the top type it also makes `UntrackedJoins |
 *  <Table>` collapse back to `unknown` by TypeScript's own union
 *  absorption, so "untracked wins" is enforced by the type system rather
 *  than by a matcher that could regress. */
export type UntrackedJoins = unknown;

/** What a select stage carries about its left joins: a union of the
 *  left-joined `Table`s, or {@link UntrackedJoins}. */
export type LeftJoinedBrand<TLeftJoined> = {
  readonly [leftJoinedBrand]?: TLeftJoined;
};
```

- **Every core select stage type** (`SelectLimited`, `SelectOffsetted`,
  `SelectOrdered`, `SelectLimitedThenOffset`, `SelectHaving`,
  `SelectGrouped`, `SelectFiltered`, `SelectJoinable`,
  `SelectDistinctable`) takes a second parameter
  `TLeftJoined = UntrackedJoins` and forwards it to every stage it
  returns. `SelectLimited` carries `LeftJoinedBrand<TLeftJoined>` in its
  own shape; the others inherit it through their intersection.
- `leftJoin<TJoined extends Table>(joined: TJoined, on: Condition):
  SelectJoinable<TProjection, TLeftJoined | TJoined>` —
  `innerJoin` takes the same generic and returns `TLeftJoined`
  unchanged.
- `select()` returns `SelectDistinctable<TProjection, never>`: a fresh
  statement has left-joined nothing. `never | TJoined` is `TJoined`, so
  accumulation needs no special first case.
- **Untracked wins over any union**: a set is untracked when
  `[UntrackedJoins] extends [TLeftJoined]`. Measured truth table
  (G1 review, `tsc` directly): `never`, `{}`, `object`, `null`, a `Table`
  and a union of `Table`s all resolve **false**; `unknown` resolves
  **true**; and so does **`any`** — `any` is a second accepting type, not
  an exception to be waved away. The consequence is benign and is stated
  rather than discovered later: a set that arrives as `any` is judged
  untracked and its fields widen, which is the fail-safe direction. A
  default-typed stage that is then left-joined stays untracked because
  the union absorbs (`unknown | T` is `unknown`), not because a matcher
  special-cases it — that half is independently confirmed.
- **An absent carrier reads as untracked, deliberately.** The phantom is
  optional, so a type that carries no brand at all infers `unknown` — the
  same value the untracked sentinel has. Losing the carrier therefore
  widens rather than lies, which is the direction this change wants. It
  also means a test that exercises only the untracked path cannot tell a
  working carrier from a deleted one: the tracked path (`never` start,
  then `leftJoin`, expecting exactly `{Table}`) is where a missing
  carrier shows up, and the untracked path is where a lost union shows
  up. Both paths are required.
- `SelectResult<TProjection, TLeftJoined = UntrackedJoins>`. An
  object-projection field narrows to `SelectColumnResult<origin column>`
  only when **all four** hold: the value is a direct column reference
  (`exprNode extends ColumnRefNode` — this is what excludes `min`/`max`/
  `over(lag(…))`, whose `Aggregated<TExpr> = Omit<TExpr, "exprNode" |
  "sqlName">` preserves the origin brand), the origin brand is present,
  the set is tracked, and the origin's column map matches no member of
  the set. Otherwise the field keeps `| null`, exactly as today.
- Chain stages mirror the same second parameter with the same default;
  `ChainApi["select"]` returns `SelectChainDistinctable<TProjection,
  never>`.
- The phantom is **optional**, so `infer TLeftJoined` yields
  `… | undefined`; strip it with `NonNullable` at the use site (the
  `OriginColumn`/`ReadAsType` precedent in `select-result.ts`).

Every task's red test is a **type test** (`expectTypeOf` /
`@ts-expect-error`). Done for every task means the change's own gates
pass with `TURBO_FORCE=1` (#448) and **no SQL golden or runtime snapshot
moves** — this change compiles no differently.

## 1. Core select stages carry the left-joined set (#546)

Files: `packages/core/src/query/left-joined.ts` (new),
`packages/core/src/query/select.ts`, `packages/core/src/index.ts`,
`packages/core/test/query/select-join-types.test.ts` (new).

- [x] 1.1 Add `left-joined.ts` with the three frozen declarations and
      export them from `packages/core/src/index.ts`. Red: the new test
      file's `import type { UntrackedJoins } from "@hejbro/core"` does
      not compile. (6 min)
- [x] 1.2 Thread `TLeftJoined = UntrackedJoins` through the nine stage
      types and hang `LeftJoinedBrand<TLeftJoined>` off `SelectLimited`;
      `select()` starts at `never`. Red: a type test asserting
      `select(posts)`'s stage is assignable to
      `SelectDistinctable<typeof posts, never>`. Runtime untouched —
      `makeStages` never assigns the phantom. (10 min)
- [x] 1.3 Make `leftJoin`/`innerJoin` generic in the joined table and
      accumulate on `leftJoin` only. Red: type tests asserting
      `select(posts).leftJoin(comments, on)` carries `typeof comments`
      and `select(posts).innerJoin(comments, on)` still carries `never`.
      (8 min)
- [x] 1.4 [design] Settle the public surface: which of the three names
      ship from `@hejbro/core`'s index and with what doc comments, and
      state in `select.ts` why the positions that take a bare
      `SelectLimited<T>` (`jsonArrayFrom`/`jsonObjectFrom`, `withCte`,
      `defineView`) deliberately fall back to the untracked default.
      (8 min)

## 2. The result type applies nullability per field (#547)

Files: `packages/query/src/types/select-result.ts`,
`packages/query/test/types/select-result.test.ts`.

- [x] 2.1 Add the second parameter and thread it into the
      object-projection branch. Red: `SelectResult<{ t: typeof
      posts.titleRequired }, never>` expected `{ t: string }`, actual
      `string | null`. (10 min)
- [x] 2.2 Restrict narrowing to direct column references. Red:
      `SelectResult<{ m: ReturnType<typeof max<typeof
      posts.amountRequired>> }, never>` and the same for
      `over(lag(posts.titleRequired), spec)` must both stay `| null`
      after 2.1 (they carry the origin brand through `Aggregated`, so
      2.1 alone narrows them — this is the task that stops it). The
      window case needs `over`/`lag` imported here; this file imports
      neither today. Correct `select-result.ts`'s `ReadAsType` comment
      while here: "an aggregate over one produces a new expression that
      carries no origin" is true of `count()` alone — `min`/`max` and
      `over(lag(…))` preserve the origin brand, which is the whole
      reason this task exists. (10 min)
- [x] 2.3 Match a field's origin column map against the tracked set.
      This file's fixtures are one table (`posts`) — add two more with
      **deliberately different column maps** (a structural collision
      would make the test prove nothing) and name the divergence in a
      comment. Red: a second table's `notNull` field is `| null` when
      that table is the tracked set, and is not when a third,
      non-joined table is. (10 min)
- [x] 2.4 Pin the untracked default and rewrite the legacy test that
      asserted the blanket widening (`select-result.test.ts:175`,
      "nullability stays widened until #307") into its replacement. Red:
      `SelectResult<{ t: typeof posts.titleRequired }>` — one argument —
      stays `string | null`. (6 min)
- [x] 2.5 [design] Settle the set-membership helper's shape (mutual
      `extends` versus an `Equals`-style comparison) and the arm order in
      `ProjectedColumnResult`, and rewrite that type's doc comment: it
      currently states the constraint this change removes ("this layer
      cannot yet see which tables were left-joined"). The replacement
      records what still holds — why only a direct column reference
      narrows, and why a structural collision can only widen. (8 min)

      Reviewer-flagged G2 review round (test-only, no source change,
      commit/tag `handoff/narrow-join-nullability-g2-r2`): closed a
      test-suite gap the mutant sweep found — the mirror direction of
      2.5's own superset/subset case (origin the subset, tracked member
      the superset) had no assertion, so a reverse-only one-directional
      membership check passed the whole suite. Also added: the union
      tracked-set distribution case (two real `leftJoin` calls, not just
      `never`/a single `Table`) with both-member and non-member
      assertions, and confirmed the existing `any`-flows-in assertion
      (added in g2-r1) already covers the frozen contract's `any` clause.

- [ ] 2.6 **Defect, found during group 3.** The narrowing arm returns
      `ColumnTsType<origin>` directly, but that mapping carries no
      nullability — `SelectColumnResult` is what pairs it with
      `IsColumnNotNull`, and the frozen contract named
      `SelectColumnResult` for exactly this reason. As shipped, a
      **nullable** column that meets all four narrowing conditions loses
      its `| null`: the one arm that was supposed to narrow honestly is
      the one that lies. Group 2's tests never crossed "nullable column"
      with "actually narrowing" — every narrowing case used a `notNull`
      column, and every nullable case was untracked or a member. Red: a
      nullable column projected against a tracked set that does not
      contain it, expected `string | null`. (6 min)

## 3. The chain surface and `execute` carry it through (#548)

Files: `packages/query/src/db/chain.ts`, `packages/query/src/db/db.ts`,
`packages/query/src/types/returning.ts`,
`packages/query/test/types/chain-types.test.ts`,
`packages/query/test/types/returning.test.ts`,
`packages/query/test/db/execute-result-type.test.ts`.

- [x] 3.1 Thread the second parameter through the chain stage types;
      `db.select(...)` starts at `never`. Red: a chain type test where
      the awaited row of `db.select({ t: posts.titleRequired }, posts)`
      is expected `{ t: string }`. (10 min)
- [x] 3.2 Accumulate on the chain's `leftJoin`, not its `innerJoin`.
      Red: after `.leftJoin(comments, on)` the comments-sourced field is
      `| null` while the posts-sourced field is not, and the `innerJoin`
      form narrows both. (10 min)
- [ ] 3.3 Make `ExecuteResult` infer the set from the core stage
      (`NonNullable` on the optional phantom) and update the two
      `#307` comments in `execute-result-type.test.ts` to the landed
      rule. Red: `db.execute(select({ t: posts.titleRequired }, posts))`
      expected non-null, and the `.leftJoin(...)` variant expected
      nullable. (8 min)
- [ ] 3.4 Pin the untracked boundary at the chain: a nested read's
      subselect, a `db.with` body, and `related()` all still type every
      projected field `| null`. Red: type tests asserting exactly that.
      (8 min)
- [ ] 3.5 Narrow `returning()` too: `ReturningRow` resolves
      `SelectResult<TProjection, never>`, not the one-argument form.
      A mutation chain has no join grammar at all — no `leftJoin`, no
      `UPDATE … FROM` — so the honest set there is not "unknown" but
      **definitively empty**, and widening it was the one place this
      change left information on the table (G2 review). Red:
      `returning({ t: posts.titleRequired })`'s field expected
      `string`, actual `string | null` — a **new** case, since
      `returning.test.ts`'s existing object projections all use a
      nullable column and read identically either way. Only the object
      branch changes; the whole-table branch never consulted the set.
      Expect one knock-on in `execute-result-type.test.ts` (a
      `DeleteFinal` projection of a `primaryKey` column asserted as
      `string | null`) — that assertion becoming wrong is this task's
      point, not a regression, and it moves with the raw error quoted.
      (10 min)
- [ ] 3.6 [design] Confirm and record that no chain member drops the set
      silently — the set-op combinators resolve their row type before
      combining, and `related()` is untracked by decision, not by
      accident. Two branches of a `union`/`intersect`/`except` can carry
      **different** left-joined sets, and this is the one path in the
      change where a mistake would narrow rather than widen: if one
      branch's set were applied to the other, a nullable field could be
      typed non-null. Pin it with a test — each branch resolves its own
      row first, so a field non-null on one side and nullable on the
      other combines to nullable. (6 min)

## 4. Surface documentation and release artifacts (#549)

Files: `skills/hejbro/references/query-layer.md`,
`.changeset/narrow-join-nullability.md`, `openspec/task-times.csv`,
`README.md`.

- [ ] 4.1 Replace the `#307` paragraph in
      `skills/hejbro/references/query-layer.md:429` with the landed
      rule: what narrows, what does not (aggregates, window functions,
      anything not a direct column reference), and which positions stay
      widened because they do not carry the set. Cover the three new
      names too: `packages/cli/src/index.ts` re-exports all of
      `@hejbro/core`, so `leftJoinedBrand`/`UntrackedJoins`/
      `LeftJoinedBrand` reach the user-facing `hejbro` package whether or
      not they were meant to (G1 review). One line each, framed as what
      they are — inference plumbing a user reads in a hover and never
      writes. (10 min)
- [ ] 4.2 Add the `minor` changeset, write the durations into
      `openspec/task-times.csv`, and refresh the README badges
      (`pnpm check:crap`, `pnpm check:tasktime`). (8 min)

      Group 1 gets **one** row, not four — its per-task clocks were never
      taken, and splitting a group total across tasks would be an
      invention:
      `2026-08-31,narrow-join-nullability,1.1-1.4,1,32,12,5,"group-level
      row; per-task clocks unavailable, lead-observed message
      timestamps; est = 6+10+8+8; waited = escalation on the untracked
      sentinel"`.
      Groups 2-4 are per-task rows with `clock-stamped <start>-<end>` in
      the notes, the `enforce-driver-contract` precedent.

      Group 2's stamps, recorded here so they survive to this task
      (2026-08-31, all UTC): 2.1 `00:47:10-00:49:17`, 2.2
      `00:49:17-00:52:38`, 2.3 `00:53:42-00:56:11`, 2.4
      `00:56:22-00:57:18`, 2.5 `00:57:18-01:00:02`. Estimates were
      10/10/10/6/8; every one came in far under, which is a calibration
      fact for the CSV to carry, not a number to round up.
