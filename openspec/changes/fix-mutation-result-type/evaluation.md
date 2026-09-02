# D106 adversarial spec-only evaluation — fix-mutation-result-type

**FAIL — 1 blocking, 1 major, 2 minor**

Scope: the delta as rendered by `openspec show fix-mutation-result-type
--diff` (the single ADDED requirement under `query-type-inference`) and
the public surface it describes. `openspec validate
fix-mutation-result-type --strict` → *valid*; the diff emitted no
"No matching main requirement" warning.

---

## B1 (BLOCKING) — the delta says only the never-requested case changes; the `.returning()` case changed too, and it broke `ctx.return` / `ctx.execute`

**Delta sentence.**

> Calling `returning()` with no projection SHALL keep resolving every
> declared column, and calling it with a projection SHALL keep resolving
> exactly the projected keys. **The only case that changes is the one
> where nothing was requested.**

and

> #### Scenario: Returning without a projection is unchanged
> - **WHEN** the same chain calls `returning()` with no argument before
>   it is awaited
> - **THEN** it resolves to every declared column of the table, typed as
>   declared, **exactly as before this requirement**

**What I observed.** The "never requested" marker is implemented as the
*default type argument* of the three exported stage types —
`packages/core/src/query/mutate.ts:167`, `:199`, `:218`
(`TReturning extends ReturningProjection | undefined = never`). That
default is what the **bare-name** types mean, and the bare names are
load-bearing in already-shipped code:
`packages/core/src/plpgsql/body-context.ts:85-89` defines

```ts
export type ReturnableQuery =
  | SelectLimited
  | InsertFinal      // now InsertFinal<Table, never>
  | UpdateFinal
  | DeleteFinal;
```

which is the parameter type of `ctx.execute` (`body-context.ts:105`) and
half of `ctx.return`'s (`body-context.ts:103`). Under
`exactOptionalPropertyTypes: true` (`tsconfig.base.json`),
`InsertFinal<Posts, undefined>` — what `.returning()` with no argument
returns — is no longer assignable to `InsertFinal<Table, never>`.

Probe (`packages/core/test/d106-probe.test.ts`, since deleted), run as
`npx tsc --noEmit -p packages/core/tsconfig.json`, against the worktree
as it stands and against an unmodified copy of the same tree with only
the three defaults flipped back to `undefined` (`/tmp/d106-core-before`):

| # | form | before (`= undefined`) | after (`= never`) |
|---|------|------------------------|-------------------|
| A | `const stage = insert(p).values(r).returning(); ctx.return(stage)` | compiles | **TS2345** |
| B | same `stage`, `ctx.execute(stage)` | compiles | **TS2345** |
| C | `ctx.return(insert(p).values(r).returning({ i: p.id }))` | TS2345 | TS2345 |
| D | `const s: InsertFinal<typeof posts> = stage` | compiles | **TS2375** |
| E | `const s: InsertFinal<typeof posts> = insert(p).values(r).returning()` (inline) | compiles | compiles |

Exact text for A:

```
error TS2345: Argument of type 'InsertFinal<Table<{…}, "declared">, undefined>'
  is not assignable to parameter of type 'Expr | ReturnableQuery | TriggerRow<Table>'.
  Type … is not assignable to type 'InsertFinal' with 'exactOptionalPropertyTypes: true'.
    Type 'undefined' is not assignable to type 'never'.
```

Row E is why `pnpm check-types` is green repo-wide (verified: `TURBO_FORCE=1
pnpm check-types` → 16/16 successful): every shipped call site inlines the
no-argument `.returning()` directly into the `ctx.*` argument position
(`packages/core/test/plpgsql/render-body.test.ts:124`, `:139`;
`mutation-value-body.test.ts:46`; `body-context.test.ts:450`;
`mutate.test.ts:292`), so TypeScript infers `TProjection = never` from the
contextual return type and the mismatch never surfaces. Bind the same
stage to a variable first — an ordinary refactor, and the only way to
build one conditionally, which the shipped plpgsql spec explicitly
contemplates (`openspec/specs/plpgsql-function-bodies/spec.md:218`,
`ctx.return(flag ? update(…) : deleteFrom(…))`) — and it stops compiling.

**Why it is a defect.** Two shipped sentences are contradicted:

- `openspec/specs/plpgsql-function-bodies/spec.md:114-129` — "`ctx.execute(...)`
  SHALL reject a mutation that carries `.returning()`, **at declaration
  time, with a named error** … THEN the declaration fails with
  `execute-expects-no-returning`." Form B no longer reaches that error at
  all; it fails at compile time, so the specified named error is
  unreachable for that form.
- `body-context.ts:84`'s documented contract for `ctx.return` — "any query
  ending in `.returning()`" — is a capability the change silently
  removes for variable-bound stages (form A), and the shipped
  `plpgsql-function-bodies` spec has no delta in this change.

And the delta's own "The only case that changes is the one where nothing
was requested" / "exactly as before this requirement" is false as
written: rows A, B and D changed, and all three are `.returning()` cases.

Row C is a **pre-existing** defect (broken before and after) — not this
change's, but any repair should cover it, because the query-builder spec
(`openspec/specs/query-builder/spec.md:50-51`) makes the projected form
the canonical one: "A `returning` clause SHALL require an explicit column
list".

**Repair.** Either (a) stop encoding "never requested" as the *default*
of the exported names — keep `= undefined` and carry the marker
somewhere that does not change what the bare name accepts (e.g. a
separate optional phantom field, or a marker type that remains
assignable in both directions); or (b) widen every bare-name consumer to
the full parameter range — `ReturnableQuery` becomes
`SelectLimited | InsertFinal<Table, ReturningProjection | undefined> | …`
— which also fixes row C; and, either way, (c) add a delta sentence and a
scenario owning what a bare `InsertFinal<T>` accepts, plus a
`plpgsql-function-bodies` delta if the `ctx.*` contract is intended to
narrow. Option (b) alone still breaks user code shaped like row D, so it
needs (c) regardless.

---

## M1 (MAJOR) — no delta sentence owns the change to the exported stage types' bare-name meaning

**Delta sentence.**

> An `insert`, `update`, or `delete` chain that never calls `returning()`
> SHALL resolve, when awaited or executed, to a type that cannot be read
> as rows … `ReadonlyArray<never>`.

**What I observed.** Every sentence in the delta is about the *resolved
result* type. The implementation changes something else as well: the
meaning of the **public exported type names** `InsertFinal`,
`UpdateFinal`, `DeleteFinal` (`packages/core/src/index.ts:322,325,331`,
pinned in the exact-set export test) and `InsertChainFinal`,
`UpdateChainFinal`, `DeleteChainFinal`
(`packages/query/src/db/chain.ts:512-555`, pinned at
`packages/query/test/exports.test.ts:36,95`) when written with one type
argument. `InsertFinal<Posts>` used to mean "an insert stage on posts,
returning shape unspecified"; it now means "an insert stage on posts that
requested nothing", and it rejects stages that did request something
(B1 rows C/D). That is a user-facing change to a published surface with
no owning sentence and no scenario — the delta's "it changes at the type
level only" gloss reads as if nothing beyond the result type moved.

**Why it is a defect.** D87's contract is that an externally observable
change goes through the delta. A user who wrote a helper
`(s: InsertFinal<typeof posts>) => …` — the documented way to name a
stage — gets a new compile error with nothing in the spec explaining it,
and the archived spec will not record it.

**Repair.** Add a sentence to the requirement stating what the bare name
now means and what it now refuses, plus a scenario pinning it (e.g.
"WHEN a stage that called `returning()` is passed where a bare
`InsertFinal<T>` is expected — THEN …"). If the intent is that the bare
name stay permissive, the surface must change instead (B1 repair (a)/(b))
and this sentence is unnecessary.

---

## m1 (MINOR) — "a type that cannot be read as rows" is stronger than what `ReadonlyArray<never>` delivers

**Delta sentence.**

> SHALL resolve … **to a type that cannot be read as rows** — the empty
> array the statement actually produces, typed as `ReadonlyArray<never>`.

**What I observed.** The narrow claim holds: with
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on, my probe
confirmed `rows[0].status` → TS2532, `for (const r of rows) r.status` →
`TS2339: Property 'status' does not exist on type 'never'`,
`rows.map(r => r.status)` → TS2339. But `ReadonlyArray<never>` is
assignable to `ReadonlyArray<Row>`, so an annotated destination compiles
clean and reads the empty array as rows:

```ts
const rows: ReadonlyArray<{ readonly id: string; readonly status: string }> =
  await db.insert(posts).values(row);   // no error
```

(probe form 5 — no diagnostic emitted.) That is the exact failure the
requirement exists to close, still reachable.

**Why it is a defect.** The prose promises more than the type can. It is
not repairable by choosing a different type (`never` is the bottom type;
any inhabited alternative is worse), so the sentence, not the surface,
is what should move.

**Repair.** Reduce the claim to what is delivered — "SHALL resolve to
`ReadonlyArray<never>`, so reading a column off an element is a
compile-time error" — and drop "cannot be read as rows", or add a
sentence acknowledging that an explicitly annotated destination still
accepts the empty array.

---

## m2 (MINOR) — two public types now default the same parameter in opposite directions, unowned by the delta

**What I observed.** `ReturningRow<TTable, TProjection = undefined>`
(`packages/query/src/types/returning.ts:49-54`) is publicly exported
(`packages/query/src/index.ts:87`, pinned at `exports.test.ts:41,100`);
written bare as `ReturningRow<Posts>` it means *every declared column*.
Its three consumers `InsertChainFinal`/`UpdateChainFinal`/
`DeleteChainFinal` (`chain.ts:514,537,554`) and the three core stage
types now default the *same* parameter to `never`, so written bare they
mean *nothing*. Both spellings are public and adjacent; the delta
mentions neither default.

**Why it is a defect.** A reader of the archived spec has no way to know
which bare name means which, and the two will be read as synonyms.

**Repair.** State the defaults in the requirement (one sentence: the
stage/chain types default to "nothing requested", `ReturningRow` defaults
to "no projection = every column"), or align `ReturningRow`'s default and
adjust its call sites.

---

## Checked and clean

- **Scenario 1's THEN, resolved element type.** Verified by probe under
  `pnpm --filter @hejbro/query exec tsc --noEmit -p tsconfig.json`: real
  chains, not hand-written type aliases. `db.insert(t).values(r)`,
  `db.update(t).set(v)` and `db.deleteFrom(t)` each await to exactly
  `ReadonlyArray<never>` (`expectTypeOf(...).toEqualTypeOf`), and
  `db.execute(insert(t).values(r))` resolves the same.
- **Scenario 2.** `db.insert(t).values(r).returning()` awaits to
  `ReadonlyArray<{ readonly id: string; readonly status: string }>` —
  every declared column, declared nullability intact. Unchanged.
- **Scenario 3.** Update and delete ride the same `ReturningRow`
  distribution over a naked type parameter (`returning.ts:52-54`); the
  `never` result is the conditional's own behaviour, not three copies of
  a rule. `chain.ts:515,538,555` all delegate to
  `ChainTerminal<ReturningRow<TTable, TReturning>>`.
- **"The rendered SQL carries no `returning` clause in that case."**
  Verified by reading the compiler: `insert()`/`update()`/`deleteFrom()`
  initialise `returning: null` (`mutate.ts:503`, `:573`, `:641`) and only
  `returning()` ever populates it (`:426`, `:449`, `:528`, `:551`,
  `:598`, `:621`); `renderReturning` returns the empty string for `null`
  (`packages/core/src/expr/render-sql.ts:436-441`). Consistent with the
  shipped `query-builder` requirement at `spec.md:48-51`.
- **"the awaited value is an empty array at runtime."** Verified against
  the recording fake driver: `packages/query/test/db/chain.test.ts:242`
  and `:269` await `handle.update(posts).set(...)` and
  `handle.deleteFrom(posts)` and assert `toEqual([])`, with the statement
  still sent (`topLevelSent` length 1). Against a **real Postgres server**
  this is UNVERIFIED here — it rests on `packages/pg/src/driver.ts:80`
  returning `result.rows`, which node-postgres leaves empty for a
  mutation without `RETURNING`.
- **No contradiction with the shipped `query-type-inference` sentences.**
  "Whole-table projections and `returning()` without a projection are
  unaffected and carry declared nullability, as they always have"
  (`spec.md:41-43`) and the returning-projection paragraph
  (`:45-53`, scenario `:89-93`) all remain true — confirmed by the
  scenario-2 and scenario-3 probes above.
- **Skill text.** `skills/hejbro/references/query-layer.md:130-137`
  states the rule in the delta's own terms ("resolves to an empty array
  and still runs … the awaited value is `ReadonlyArray<never>`, so
  reading a column off it is a compile-time error"). It inherits m1's
  overstatement only in the milder "compile-time error" form, which is
  accurate.
- **Repo gates.** `TURBO_FORCE=1 pnpm check-types` → 16 tasks, all
  successful, with my probe files removed. This is green *because* of
  B1's row E, not because B1 is absent.

---

## Worktree note (not a spec finding)

While this review ran, commit `eba91470` ("fix(query): a mutation without
returning resolves to no rows (#622)") was created in this worktree with
my throwaway probe file `packages/query/test/d106-probe.test.ts` swept
into it. I deleted the file from the working tree (`git status` shows the
unstaged deletion); **it is still present in `eba91470` and must be
removed from the commit before the PR.** No other file in the worktree
was modified by this review.

---

# Round 2

**FAIL — 1 blocking, 0 major, 0 minor**

Scope: the delta as rendered by `openspec show fix-mutation-result-type
--diff` (the single ADDED requirement under `query-type-inference`) and
the public surface it describes. `openspec validate
fix-mutation-result-type --strict` → *valid*; the diff emitted no
"No matching main requirement" warning. Every form below was checked by
execution (`pnpm --filter @hejbro/core exec tsc --noEmit -p
tsconfig.json`, the `@hejbro/query` equivalent, and
`… exec vitest run <probe>`); both probe files are deleted and
`git status --porcelain` is empty apart from this report.

---

## B2 (BLOCKING) — the requirement says the bare stage names accept a **projected** stage; they refuse it, and so do the bare `*ChainFinal` names

**Delta sentences.**

> `InsertFinal<T>`, `UpdateFinal<T>`, `DeleteFinal<T>`, their
> `*ChainFinal` counterparts and `ReturningRow<T>` written with one type
> argument SHALL keep meaning "every declared column", exactly as before,
> so code that names a stage by its bare type keeps compiling and
> **keeps accepting stages that requested a projection or no projection**.

> #### Scenario: A bare stage name keeps its meaning
> - **WHEN** a stage that called `returning()` — **with or without a
>   projection** — is passed where a bare `InsertFinal<T>` (or the update
>   or delete equivalent) is expected, or a pre-`returning()` stage is
> - **THEN** it compiles as it did before this requirement; the bare name
>   accepts every instantiation it accepted

**What I observed.** The "no projection" half holds; the "with a
projection" half does not, on either surface.

Core (`packages/core/src/query/mutate.ts:167-172`): the bare name is
`InsertFinal<TTable, undefined>`, and its optional brand field is
`MutationStageMeta<TTable, undefined>`, whose `returning` member is
typed `undefined`. A projected stage carries `returning:
ReturningProjection`, which is not assignable to `undefined`:

```ts
const stage = insert(posts).values({ slug: "x" }).returning({ i: posts.id });
const s: InsertFinal<typeof posts> = stage;
```
```
error TS2375: Type 'InsertFinal<Table<{…}, "declared">, { … }>' is not
  assignable to type 'InsertFinal<Table<{…}, "declared">>' with
  'exactOptionalPropertyTypes: true'.
  Type '{ i: Expr<"uuid"> & … }' is not assignable to type 'undefined'.
```

The same value into `ctx.return` (round 1's row C) is still `TS2345`,
by the same clause.

Query (`packages/query/src/db/chain.ts:512-517`): `InsertChainFinal<T>`
is `ChainTerminal<ReturningRow<T, undefined>>`, i.e. a thenable over the
whole declared row. The projected chain stage is a thenable over
`{ readonly i: string }`, and thenable-over-X is invariant enough here to
refuse:

```ts
const projected: InsertChainFinal<Posts> =
  db.insert(posts).values({ id: "i", status: "a" }).returning({ i: posts.id });
```
```
error TS2322: … not assignable to type 'PromiseLike<readonly {…whole row…}[]>'.
  Type '{ readonly i: string; }' is missing the following properties …:
  id, status, amount, duration
```

**Why it is a defect.** The requirement's clause is unhedged and
normative (`SHALL … so … keeps accepting stages that requested a
projection or no projection`) and is false for exactly half of what it
enumerates, on both the `*Final` and the `*ChainFinal` families it names.
Scenario 3's WHEN deliberately widens to "with or without a projection"
and its THEN says "it compiles" — executed, it does not. The trailing
hedge "as it did before this requirement / accepts every instantiation it
accepted" would be true, but it is glued to an assertion that it
compiles, so the scenario as written cannot be satisfied by the shipped
surface. The change's own proposal already knows this ("`ctx.return`
refusing a mutation whose `returning()` carries a projection —
pre-existing … filed as #634"), so the delta and the proposal disagree
with each other as well.

This is the one case where the pre-existing #634 defect becomes this
change's problem: the delta affirmatively claims the opposite of shipped
behaviour, and an archived spec asserting it would be wrong on the day it
lands.

**Repair (spec-only, no code needed).** Say what is true and no more —
drop "keeps accepting stages that requested a projection or no
projection" in favour of "keeps accepting a stage that called
`returning()` with no projection, and a pre-`returning()` stage", and
narrow Scenario 3's WHEN to those two forms, referencing #634 for the
projected case. If the intent really is that the bare name accept a
projected stage, that is a surface change (widen the brand's `returning`
member, or the consumers' parameter types) and needs its own scenario.

---

## Checked and clean

All by execution, with a non-vacuity check (asserting
`ReadonlyArray<Row>` against a no-`returning()` chain, and
`rows.map(r => r.status)` on one) confirming the probes actually bind:
both produced errors (`TS2344` on the `expectTypeOf` and
`TS2339: Property 'status' does not exist on type 'never'`).

- **Scenario 1 (`ReadonlyArray<never>`), real chains.**
  `await db.insert(posts).values(row)`,
  `await db.update(posts).set(v)` and `await db.deleteFrom(posts)` each
  `toEqualTypeOf<ReadonlyArray<never>>`; so do
  `db.execute(insert(…).values(…))`, `db.execute(update(…).set(…))` and
  `db.execute(deleteFrom(…))`.
- **Scenario 2 (`returning()` unchanged).**
  `.returning()` awaits to `ReadonlyArray<{ id: string; status: string;
  amount: bigint | null; duration: IntervalValue | null }>` — every
  declared column, declared nullability intact. `.returning({ i: posts.id
  })` awaits to `ReadonlyArray<{ readonly i: string }>`.
- **Scenario 4 (update/delete by the same mechanism).**
  `ReturningRow` (`packages/query/src/types/returning.ts:49-54`) is one
  conditional over a naked type parameter; `chain.ts:515,538,555` all
  delegate to it. `never` distributes to `never` unaided — no second copy
  of the rule.
- **Round 1's B1 forms A/B/D/E — all repaired.** A variable-bound
  `.returning()` stage now compiles into `ctx.return` (A) and into
  `ctx.execute` (B); assigning it to a bare `InsertFinal<typeof posts>`
  compiles (D); inline still compiles (E). Update and delete equivalents
  likewise (`UpdateFinal<typeof posts>` ← `update(…).set(…).returning()`,
  `DeleteFinal<typeof posts>` ← `deleteFrom(…).returning()`).
- **The plpgsql spec's named error is reachable again.** A trigger body
  that binds `.returning()` to a variable and passes it to `ctx.execute`
  now type-checks and throws at declaration time, matching
  `openspec/specs/plpgsql-function-bodies/spec.md:115,126-128`
  (`execute-expects-no-returning`). Under round 1's shape this form was a
  compile error, so the specified runtime error was unreachable.
- **The new claim: a pre-`returning()` stage is assignable wherever the
  bare name is accepted.** Verified in every position I could construct —
  `ctx.execute(insert(p).values(r))` inline and variable-bound (update
  and delete too), `ctx.return(insert(p).values(r))`, assignment to
  `InsertFinal<typeof posts>` and to the fully bare `InsertFinal`, and to
  `InsertChainFinal<Posts>` / `UpdateChainFinal<Posts>` /
  `DeleteChainFinal<Posts>` on the chain side.
- **Shipped `plpgsql-function-bodies` forms still compile.**
  `spec.md:218`'s conditional-branch form
  `ctx.return(flag ? update(…) : deleteFrom(…))` compiles both with and
  without `.returning()` on the branches; `spec.md:220-223`'s helper form
  (a helper *declared* as returning the bare `InsertFinal<typeof posts>`,
  consumed by `ctx.execute`) compiles.
- **"The rendered SQL carries no `returning` clause in that case."** Read
  the compiler: `insert()`/`update()`/`deleteFrom()` initialise
  `returning: null` (`packages/core/src/query/mutate.ts:512`, `:582`,
  `:650`) and only `returning()` ever populates it; `renderReturning`
  returns `""` for `null`
  (`packages/core/src/expr/render-sql.ts:436-441`), and it is the sole
  producer of the clause for all three statement kinds (`:583`, `:612`,
  `:633`).
- **No contradiction with the shipped `query-type-inference` sentences.**
  "Whole-table projections and `returning()` without a projection are
  unaffected and carry declared nullability, as they always have"
  (`spec.md:41-43`) and the returning-projection paragraph (`:45-53`)
  both remain true — pinned by the scenario-2 probes above.
- **Skill text.** `skills/hejbro/references/query-layer.md:129-136` now
  states the rule in the delta's own terms and stops at the accurate
  claim ("reading a column off it is a compile-time error"), not the
  round-1 overstatement.
- **Runtime empty array against a real Postgres server: UNVERIFIED
  here** — carried forward from round 1. Verified only against the
  recording fake driver.

---

## Round 1 findings — status

- **B1 (BLOCKING) — repaired.** The `never` marker moved off the bare
  names' defaults onto the pre-`returning()` stages
  (`mutate.ts:176-179`, `:210-213`, `:229-232`; `chain.ts:519`, `:541`,
  `:558`); the bare `*Final`/`*ChainFinal` defaults are back to
  `undefined`. Rows A, B, D and E all compile again, and B's specified
  runtime error is reachable. Row C stays refused — pre-existing, but see
  B2: the delta now claims otherwise.
- **M1 (MAJOR) — repaired.** A dedicated paragraph plus Scenario 3 now
  own what the bare names mean and accept. The paragraph's projection
  clause is wrong (B2), but the omission M1 named is gone.
- **m1 (MINOR) — repaired.** "a type that cannot be read as rows" is
  replaced by "typed so that reading a column off an element is a
  compile-time error", and the escape is acknowledged in the delta's own
  parenthetical ("An explicitly annotated destination of a row-array type
  still accepts the empty array"). Confirmed both halves by probe.
- **m2 (MINOR) — repaired.** The requirement now names `ReturningRow<T>`
  written with one type argument alongside the bare stage names and gives
  them the same meaning ("every declared column"), which matches the code
  (`returning.ts:51` defaults `TProjection = undefined`;
  `mutate.ts:169`, `chain.ts:514` default `TReturning = undefined`). The
  two defaults no longer diverge.

---

# Round 3

**PASS — 0 blocking, 0 major, 0 minor**

Scope: the delta as rendered by `openspec show fix-mutation-result-type
--diff` (the single ADDED requirement under `query-type-inference`) and
the public surface it describes. `openspec validate
fix-mutation-result-type --strict` → *valid*; the diff emitted no
"No matching main requirement" warning. Every clause below was checked by
execution — two throwaway probe files (`packages/query/test/db/`,
`packages/core/test/`) run under `pnpm --filter @hejbro/query exec tsc
--noEmit -p tsconfig.json`, the `@hejbro/core` equivalent, and
`… exec vitest run <probe>` — with a non-vacuity pass confirming the
probes bind. Both probe files are deleted; `git status --porcelain` shows
only this report.

Non-vacuity evidence (deliberately-wrong assertions, all of which
errored): `expectTypeOf(await handle.insert(posts).values(row))
.toEqualTypeOf<ReadonlyArray<WholeRow>>()` → `TS2344`; `(await
handle.insert(posts).values(row)).map(r => r.status)` → `TS2339:
Property 'status' does not exist on type 'never'` (the same `.map` on a
`.returning()` chain emitted nothing, so the error is the `never`, not
the probe shape); a `@ts-expect-error` planted on a form that does
compile → `TS2578: Unused '@ts-expect-error' directive`.

No finding. Every normative clause of the requirement is true of the
shipped surface as executed.

---

## Checked and clean

**Awaited types of real chains** (a real `db({ posts }, driver)` handle,
not hand-written aliases; `WholeRow` = `{ readonly id: string; readonly
status: string; readonly amount: bigint | null; readonly duration:
IntervalValue | null }`):

| chain | awaited type |
|---|---|
| `handle.insert(posts).values(row)` | `ReadonlyArray<never>` |
| `… .returning()` | `ReadonlyArray<WholeRow>` |
| `… .returning({ i: posts.id })` | `ReadonlyArray<{ readonly i: string }>` |
| `handle.update(posts).set({…})` | `ReadonlyArray<never>` |
| `… .returning()` | `ReadonlyArray<WholeRow>` |
| `handle.deleteFrom(posts)` | `ReadonlyArray<never>` |
| `… .returning()` | `ReadonlyArray<WholeRow>` |
| `handle.insert(posts).values(row).onConflictDoNothing(posts.id)` | `ReadonlyArray<never>` |
| `… .onConflictDoNothing(posts.id).returning()` | `ReadonlyArray<WholeRow>` |

- **"or executed."** `handle.execute(insert(…).values(…))`,
  `handle.execute(update(…).set(…))` and `handle.execute(deleteFrom(…))`
  each resolve `ReadonlyArray<never>`;
  `handle.execute(insert(…).values(…).returning())` resolves
  `ReadonlyArray<WholeRow>`. Inside `handle.transaction(async tx => …)`,
  `tx.execute` resolves identically for both forms — the requirement's
  "awaited or executed" holds on the transaction surface too, which no
  earlier round executed.
- **Bare `*Final` names resolve every declared column.**
  `Awaited<ReturnType<typeof dbExecute<InsertFinal<Posts>>>>`,
  and the `UpdateFinal<Posts>` / `DeleteFinal<Posts>` equivalents, each
  `ReadonlyArray<WholeRow>`.
- **Bare `*ChainFinal` names likewise.** `Awaited<InsertChainFinal<Posts>>`,
  `Awaited<UpdateChainFinal<Posts>>`, `Awaited<DeleteChainFinal<Posts>>`
  each `ReadonlyArray<WholeRow>`.
- **`ReturningRow<T>` bare = every column.**
  `ReturningRow<Posts>` `toEqualTypeOf<WholeRow>` — matches the
  requirement's grouping of it with the bare stage names.
- **Bare-name assignability, no-projection form.** A variable-bound
  `.returning()` stage assigns to `InsertFinal<Posts>` /
  `UpdateFinal<Posts>` / `DeleteFinal<Posts>` and to
  `InsertChainFinal<Posts>` / `UpdateChainFinal<Posts>` /
  `DeleteChainFinal<Posts>`; the same stage passes into `ctx.return`
  (`defineFunction` body, rendered `return query insert into … returning
  …`) and into `ctx.execute` (where it reaches the *runtime*
  `execute-expects-no-returning` error, not a compile error — the shipped
  `plpgsql-function-bodies` requirement at `spec.md:114-129` stays
  reachable).
- **Bare-name assignability, pre-`returning()` form.**
  `insert(posts).values({…})`, `update(posts).set({…})` and
  `deleteFrom(posts)` each assign to the bare `*Final` name and to the
  bare `*ChainFinal` name, and each passes into `ctx.return` and
  `ctx.execute`, variable-bound (not inlined). This is the delta's
  clause "that instantiation is assignable wherever the bare name is
  accepted" — and `ReturnableQuery` (`body-context.ts:86-89`) is the
  *only* bare-name consumer in `packages/*/src`
  (`grep -rn 'Insert(Chain)?Final|…' packages/{core,query,cli,supabase}/src`
  returns only the export lists, `body-context.ts:87-89`, and
  `db.ts:223,228,233` — and those three are `infer` positions, not
  constraints), so the clause is exhaustively covered, not sampled.
- **Projected stage refused, as the delta says (#634).**
  `const i: InsertFinal<Posts> = insert(posts).values({…}).returning({ x:
  posts.id })` → `TS2375`; `ctx.return(insert(posts).values({…})
  .returning({ x: posts.id }))` → `TS2345` ("Type '{ x: Expr<"uuid"> …
  }' is not assignable to type 'undefined'"); `const a:
  InsertChainFinal<Posts> = handle.insert(posts).values(row)
  .returning({ i: posts.id })` → error. All three were asserted with
  `@ts-expect-error` and none was reported unused. The delta claims
  exactly this ("was never assignable … and still is not"), so it is not
  a finding. The *historical* half of that parenthetical ("was never")
  is **UNVERIFIED** by execution in this round — no pre-change tree is
  available to me — though round 1's measured row C (refused before and
  after) is consistent with it.
- **Only the enumerated stages carry the marker.** `grep` over the two
  files finds the `never` instantiation at exactly six sites:
  `packages/core/src/query/mutate.ts:178` (`InsertReturnable`), `:212`
  (`UpdateReturnable`), `:233` (`DeleteReturnable`), and
  `packages/query/src/db/chain.ts:519`, `:542`, `:559` (the `*ChainReturnable`
  trio) — `InsertConflictable` (`mutate.ts:191`),
  `UpdateFilterable` (`:218`), `DeleteFilterable` (`:239`) and their chain
  counterparts (`chain.ts:525`, `:548`, `:565`) inherit it through those,
  which is what "and … through them" means. No other type in either
  package carries it. The bare defaults are `= undefined` at
  `mutate.ts:170`, `:204`, `:225` and `chain.ts:515`, `:538`, `:555`,
  matching the delta's "not on the bare exported names".
- **No RETURNING clause is rendered without `returning()` — read from
  the compiler.** `insert()`/`update()`/`deleteFrom()` initialise
  `returning: null` at `packages/core/src/query/mutate.ts:512`, `:582`,
  `:650`; the only writers are the `returning:` builder members at
  `:435`/`:458` (insert), `:537`/`:560` (update), `:607`/`:630` (delete),
  each reachable solely through a `.returning(...)` call.
  `renderReturning` (`packages/core/src/expr/render-sql.ts:436-441`)
  returns `""` for `null`, and it is the sole producer of the clause for
  all three statement kinds (`:583`, `:612`, `:633`). Confirmed
  end-to-end against the recording driver: the three mutations sent
  `insert into "app"."posts" ("id", "status") values ($1, $2)`,
  `update "app"."posts" set "status" = $1`, and
  `delete from "app"."posts"` — no `returning` in any of them. Consistent
  with the shipped `query-builder` requirement (`spec.md:48-51`).
- **"the awaited value is an empty array at runtime."** All three
  mutations resolved `[]` while `topLevelSent` recorded three statements
  — the statement still runs. Against a **real Postgres server** this
  stays **UNVERIFIED** (carried forward from rounds 1–2); it rests on
  `packages/pg/src/driver.ts` returning `result.rows`, which
  node-postgres leaves empty for a mutation without `RETURNING`.
- **The annotated-destination parenthetical.** `const rows:
  ReadonlyArray<WholeRow> = await handle.insert(posts).values(row)`
  compiles clean — exactly what the delta's parenthetical concedes, no
  more and no less.
- **No contradiction with shipped sentences.**
  `query-type-inference/spec.md:41-43` ("Whole-table projections and
  `returning()` without a projection are unaffected and carry declared
  nullability, as they always have") and the returning-projection
  paragraph (`:45-53`, scenario `:89-93`) both stay true — pinned by the
  `.returning()` and `.returning({…})` rows above.
  `query-builder/spec.md:48-51` ("A `returning` clause SHALL require an
  explicit column list; the rendered SQL SHALL never contain `returning
  *`") is unaffected. `plpgsql-function-bodies/spec.md:114-129`
  (`execute-expects-no-returning`) and `:218-228` (the conditional-branch
  and helper forms) all still hold — no delta is needed there, because
  nothing about `ctx.return`/`ctx.execute` acceptance changed.
- **Shipped type tests actually pin the delta.**
  `execute-result-type.test.ts`, `chain-types.test.ts` and
  `exports.test.ts` (47 tests) and `packages/core/test/query/mutate.test.ts`
  (30 tests) all pass; `execute-result-type.test.ts` carries the
  `ReadonlyArray<never>` assertion for insert/update/delete plus the
  `@ts-expect-error` on reading a row off it, and `chain-types.test.ts:205`
  carries the chain-side equivalent. The pins are in the suite, not only
  in my probes.
- **Skill text.** `skills/hejbro/references/query-layer.md:130-137`
  states the rule in the delta's own terms and stops at the accurate
  claim ("the awaited value is `ReadonlyArray<never>`, so reading a
  column off it is a compile-time error"), with the runtime half stated
  correctly ("resolves to an empty array and still runs"). No
  overstatement.

---

## Round 2 findings — status

- **B2 (BLOCKING) — repaired.** The requirement paragraph now reads
  "keeps accepting a stage that called `returning()` with no projection,
  and a pre-`returning()` stage", and adds the parenthetical "(A stage
  whose `returning()` carries a projection was never assignable to the
  bare name and still is not — that is #634, untouched here.)".
  Scenario 3's WHEN is narrowed to the two forms that actually compile.
  Executed: both narrowed forms compile on the `*Final` family, the
  `*ChainFinal` family, and in `ctx.return`/`ctx.execute`; the projected
  form is refused on all three, which is now what the delta says. The
  delta and the proposal's "Out of scope" bullet agree with each other
  again. No spec sentence remains that the shipped surface contradicts.
