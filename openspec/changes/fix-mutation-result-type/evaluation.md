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
