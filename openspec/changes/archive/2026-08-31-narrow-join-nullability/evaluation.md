# D106 adversarial spec-only evaluation — `narrow-join-nullability`

**VERDICT: BLOCK — 1 BLOCKING, 1 MAJOR, 2 MINOR (+2 out-of-scope observations).**

Evaluator: isolated D106 agent, zero team context. Evidence base: the delta
spec file, the main spec corpus (`openspec/specs/**`), the public surface
(`skills/hejbro/**`, `.changeset/narrow-join-nullability.md`, README, the
published packages' `dist` entry types after `pnpm build --force`), and
executed probes. All type probes ran through the **published entry points**
(`hejbro` → `packages/cli/dist/index.d.ts`, `@hejbro/core` / `@hejbro/query`
dist types) under the repo's own strict tsconfig — i.e. exactly the surface a
user gets. Probe sources: `d106-lj-eval/d106-probes/{probe.ts, probe2.ts,
reveal.ts, reveal2.ts, compile-probe.mjs}`; the final `probe.ts` + `probe2.ts`
suites compile clean (tsc exit 0), so every assertion quoted below is a
verified fact about shipped types.

Important context for the verdict: **shipped behavior is sound everywhere I
could drive it** — no probe found a position where a value that can be SQL
NULL is typed non-null. Every finding below is about the **spec text** (and
its echoes in the changeset and skill) misdescribing that behavior. That is
exactly what this gate exists to catch before the delta is folded into the
corpus.

---

## F1 — BLOCKING: the "untracked positions stay widened" scenario contradicts shipped behavior for `related()` and whole-table nested subselects

**Citation** (delta,
`openspec/changes/narrow-join-nullability/specs/query-type-inference/spec.md`):

Requirement "A left join is what widens a projected field's nullability",
second paragraph:

> "Where the join set is **not** carried, every projected field SHALL stay
> widened to nullable, exactly as before this requirement existed. […] a
> nested read's subselect (`jsonArrayFrom`/`jsonObjectFrom`), a CTE body, a
> view body, `related()`, and any hand-written use of the result-type utility
> — therefore keep the old widening"

and its scenario:

> "#### Scenario: A row type resolved without the join set stays widened
> - **WHEN** a projection's row type is resolved in a position that does not
>   carry the statement's left-joined set — a nested read's subselect, a CTE
>   body, a view body, or `related()`
> - **THEN** every projected field types as possibly `null`, the same
>   widening that applied before joins were tracked"

**Observed behavior** (executed type probes; `probe.ts` P10, `reveal.ts`
R4–R6, all through the public API):

```ts
// related(): the position the scenario names — nothing is widened.
const p10d = handle.select(users).related({ posts: true });
type P10d = Awaited<typeof p10d>[number];
assert<Eq<P10d["id"], string>>();                    // PASSES — non-null
assert<Eq<P10d["posts"][number]["title"], string>>(); // PASSES — non-null

const p10e = handle.select(posts).related({ author: true });
assert<Eq<NonNullable<Awaited<typeof p10e>[number]["author"]>["name"], string>>(); // PASSES

// nested read's subselect with a whole-table projection — not widened either.
const p10b = handle.select(
  { id: users.id, ps: jsonArrayFrom(select(posts).where(eq(posts.authorId, users.id))) },
  users,
);
assert<Eq<Awaited<typeof p10b>[number]["ps"][number]["title"], string>>(); // PASSES — non-null
```

(`users.id`, `posts.title`, `users.name` are all `notNull` declared columns;
the delta's THEN demands `string | null` for every one of these fields.)

The scenario's WHEN covers these cases — `related()` is listed by name, a
whole-table select is a `SelectProjection` and the delta's own sibling
requirement calls it a "Whole-table projection" — and the THEN ("**every**
projected field types as possibly `null`") is false for them. The widened
behavior the scenario describes is real only for **object-projection fields**
(verified: P10a `jsonArrayFrom(select({t: posts.title}, posts))` element
`t: string | null`; P10c `jsonObjectFrom` → `{t: string | null} | null`;
P10f CTE reference field → `string | null`; hand-written
`SelectResult<{n: …}>` → `string | null` — all pass). The normative sentence
has the same defect: "every projected field SHALL stay widened … exactly as
before this requirement existed" is self-contradictory for whole-table rows
and `related()` rows, whose fields were **never** widened before.

**The same over-claim is replicated in the public docs**, so a user reading
only specs + docs is told twice that `related()` rows are always-nullable:

- `.changeset/narrow-join-nullability.md`: "a nested read, a CTE body, a view
  body, and `related()` stay at the pre-narrowing, **always-nullable**
  behavior" — false for `related()` and whole-table nested reads.
- `skills/hejbro/references/query-layer.md` (Type inference section): "A
  handful of positions stay at the pre-narrowing, always-nullable behavior …
  a nested read (`jsonArrayFrom`/`jsonObjectFrom`) … `related()`'s sugar" —
  which contradicts the same file's own Relational-reads section ~300 lines
  earlier: "`rows[0].comments: ReadonlyArray<{ id: string; postId: string;
  body: string | null }>`" (non-null `id`/`postId`).

**Evidence kind:** executed probe (tsc over published dist types; suite exit
0 with the quoted assertions).

**Why BLOCKING:** per the rubric, a delta scenario contradicting shipped
behavior driven through the public API blocks the archive. The behavior is
the sound side; the spec text is what must change. Minimal fix: scope the
sentence and scenario to *object-projection fields* ("keep the widening those
fields had", not "every projected field types as possibly null"), state that
whole-table rows and `related()` rows carry declared nullability in these
positions too, and fix the changeset/skill sentences to match.

---

## F2 — MAJOR: the delta silently puts shipped behavior in contradiction with the corpus requirement "Nested read types equal the declared read types"

**Citation** (corpus, `openspec/specs/query-type-inference/spec.md`, NOT
touched by the delta):

> "### Requirement: Nested read types equal the declared read types
> A row read through `jsonArrayFrom`/`jsonObjectFrom` or `related()` SHALL
> surface each column with exactly the TypeScript type the same column has in
> a top-level select …"
>
> "#### Scenario: Nested and top-level types agree column by column …
> - **THEN** both positions type `createdAt: Date` and `viewCount: bigint` —
>   identical"

**Observed behavior** (executed probes, `probe.ts` P11 vs P10a):

```ts
// top level, object projection of a notNull column:
const p11top = handle.select({ t: posts.title }, posts);
assert<Eq<Awaited<typeof p11top>[number]["t"], string>>();          // PASSES

// the SAME projection inside a nested read:
const p10a = handle.select(
  { id: users.id,
    ps: jsonArrayFrom(select({ t: posts.title }, posts).where(eq(posts.authorId, users.id))) },
  users,
);
assert<Eq<Awaited<typeof p10a>[number]["ps"][number]["t"], string | null>>(); // PASSES
```

`string` vs `string | null` — no longer "exactly the TypeScript type the same
column has in a top-level select", under **any** reading of "top-level
select" (whole-table top-level also gives `string`). Before this change the
two positions agreed (`string | null` in both, blanket widening), so this
divergence is **created by the delta**, and the delta neither MODIFIES nor
mentions the nested-read requirement. On archive, the corpus would contain
two requirements demanding different types for the same nested field, with
shipped behavior following the new one.

Secondary instance, same root, weaker text: the corpus CTE requirement ("A
CTE reference carries its query's row type … typed as that field reads back")
— a CTE body's direct-column field now reads back `string` when the identical
statement is awaited on its own but `string | null` through the CTE reference
(P10f, passes). Pre-change, object-projection bodies agreed at `string |
null`; the delta creates the gap for direct-column fields while listing "a
CTE body" as untracked without citing that requirement. The CTE text is vague
enough ("reads back" — where?) that I rate it a rider on this finding, not
its own.

**Evidence kind:** executed probe + textual derivation (corpus text vs
verified types).

**Fix direction:** the delta must MODIFY (or at least carve) the nested-read
requirement — e.g. "identical up to the untracked-position widening of
object-projection fields" — so the corpus stays coherent after the merge.
Widening the nested read is behaviorally fine (fail-safe); the corpus just
must stop promising "identical".

---

## F3 — MINOR: the delta's two ADDED requirements contradict each other for whole-table projections whose source map is in the left-joined set (no executable counterexample)

**Citation** (delta): requirement 2 opens with

> "a projected field whose source table is in that set SHALL type as possibly
> `null` regardless of the column's own `notNull`"

and its structural-identity paragraph states, without projection-form
restriction:

> "Two tables declared with identical column maps are therefore
> indistinguishable here, and a projected field of one is widened when the
> other is left-joined."

while requirement 1 states:

> "Whole-table projections and `returning()` without a projection are
> unaffected and carry declared nullability, as they always have."

**Observed behavior:** the whole-table branch ignores the join set entirely.
Probe P16 (passes): `handle.select(users).leftJoin(usersTwin, …)` with
`usersTwin` declared column-map-identical to `users` types `name: string`
(non-null) — requirement 2's sentences say this field SHALL be `| null`;
requirement 1 says it carries declared nullability; shipped follows
requirement 1. The object-projection counterpart (P4) widens as requirement 2
says (`string | null`), and self-join (P6) widens too.

**Why only MINOR:** no executable statement can be mistyped through this
gap. A whole-table projection always projects the FROM table (verified:
`resolveProjection` ignores a second argument when the projection is a
`Table`, and there is no other spelling), and a LEFT JOIN never nulls the
FROM side — so the only colliding instantiations are the structural twin and
the self-join, and both render SQL Postgres rejects (derived, not executed
against a live server):

```
SELF-JOIN SQL:  select "app"."users"."name" as "n" from "app"."users" left join "app"."users" on …
                → Postgres 42712, table name "users" specified more than once
WHOLE-TABLE TWIN-JOIN SQL: select "id", "name" from "app"."users" left join "app"."users_twin" on …
                → Postgres 42702, column reference "id" is ambiguous
                  (identical column maps ⇒ identical column names ⇒ always ambiguous)
```

(compile output from `compile-probe.mjs`, executed; the Postgres refusal
codes are textual derivation from documented Postgres behavior.) The
requirement-2 scenario "A left-joined table's column is nullable" is likewise
satisfiable in its WHEN by the (inexecutable) whole-table self-join with a
false THEN. Fix: one clause in requirement 2 scoping it to object-projection
fields, mirroring the carve-out requirement 1 already states.

Also verified while here, favorable to the delta: a **superset** column map
does not collide (P5: project `usersSuper.name` with `users` left-joined →
`string`, passes) — consistent with the delta's "identical column maps"
claim, which promises nothing about supersets.

---

## F4 — MINOR: three new public export names are documented in the skill but specified nowhere

**Citation:** `skills/hejbro/references/query-layer.md`:

> "`leftJoinedBrand`, `UntrackedJoins`, and `LeftJoinedBrand` are visible in
> hover types on a select/chain stage (and, since `hejbro` re-exports all of
> `@hejbro/core`, importable from `hejbro` too)"

**Observed:** all three import from `hejbro` and behave as documented
(probe P17 passes: `UntrackedJoins` = `unknown`; `LeftJoinedBrand<T>`
constructible; the `leftJoinedBrand` value importable; a tracked chain stage
is assignable where the one-arg untracked stage type is expected — the
compat property the change depends on). The delta specifies the type-level
carrying ("A select's builder stages SHALL carry, at the type level, the set
of tables joined with `leftJoin`") but never names the exported surface; it
refers to "the result-type utility" without naming `SelectResult` either.
Consequence: the documented public names have no spec-backed contract — a
rename would break the skill's promise without violating any requirement.
Either name them in the delta (one sentence) or soften the skill to not
present them as a stable import surface.

---

## Out-of-scope observations (pre-existing; not caused by this delta; recorded for the archive review)

**O1.** `handle.execute()` of a **core-built set-operation** statement types
rows as `Readonly<Record<string, unknown>>` (reveal2 S6, executed probe),
while the same combination through the chain surface types per-key unions
(P12, passes). The corpus set-op requirement ("The combined result row SHALL
take the LEFT branch's keys … each column's type the union of the two
branches' declared read types") is therefore delivered only on the chain
path. The published type's own JSDoc marks the `execute` fallback as
longstanding ("exactly as it always has"), and the delta says nothing about
set-ops, so this is not this change's regression — but note the chain path
**was** re-verified for the one place this change could have made it unsound:
`narrow.union(joined-widened)` and the reverse both resolve `string | null`
(also `unionAll`/`intersect`/`except`), never narrowing (reveal2 S1–S5,
executed).

**O2.** A whole-table select combined with a join renders its projected
columns **unqualified** (`select "id", "name" from "app"."users" left join …`,
compile-probe output), while the query-builder corpus scenario "Inner and
left join between declared tables" promises "every projected column stays
schema-qualified". Object-projection joins do qualify
(`"app"."users"."name"`). Pre-existing rendering trait, out of this delta's
scope (the changeset's "generated SQL … unchanged" claim is about this change
introducing no SQL diff, which nothing contradicts) — flagged because the
probes surfaced it and it doubles as the reason F3 has no executable
counterexample.

---

## What was verified clean (so the BLOCK is read at its true size)

Every other delta scenario matches shipped behavior, probed through the
public API (suite `probe.ts` + `probe2.ts`, tsc exit 0):

- **Declaration-driven narrowing:** no-join object projection: `notNull` →
  non-null, nullable → `| null`, `bigint` mode kept (P1); computed
  expression → family `| null` (P1b); `$type` brand and array richness under
  alias, narrow (probe2 Q2); array element nullability
  (`tags`/`labels`+`notNullElements`) exact (probe2 Q1).
- **Join rule:** left-joined side widened, FROM side kept (P2); inner join
  widens nothing (P3); structural twin collides toward widening (P4);
  self-join widens (P6); enum column across a left join →
  `"draft" | "published" | null` (P15); every chain stage transition
  (`where`/`groupBy`/`having`/`orderBy`/`limit`/`offset`/`distinct`)
  preserves the tracked set in both directions (P14); core statements through
  `handle.execute` carry the set too (P13a/b).
- **`returning()`:** non-null-exact on insert/update/delete and through
  `onConflictDoNothing` (P8); no-projection `returning()` = whole-table
  declared (P19). The stated premise holds at both levels the delta claims:
  no `leftJoin` member on any mutation chain or core mutation builder (six
  `@ts-expect-error` probes, P9), and no field of the public `InsertNode`/
  `UpdateNode`/`DeleteNode` can hold a `JoinNode` (mapped-type sweep with
  `SelectNode.joins` as positive control, P9) — the "definitively empty"
  claim is true of today's exported node shapes.
- **Aggregates/windows:** `count`/`max`/`sum` → declared-or-wide `| null`
  even with no join and a `notNull` argument (P7); `over(lag(col))` and
  `over(rowNumber())` nullable (P7); offset function **with** a `default`
  still nullable (P20 — spec says "every window function's projected field",
  and behavior agrees); windowed `count()` ≡ plain `count()` (probe2 Q3).
- **Untracked positions, object-projection form:** hand-written
  `SelectResult` widened; `jsonArrayFrom`/`jsonObjectFrom` object-projection
  subselects widened; CTE reference fields widened (P10a/c/f, P10Hand);
  tracked stages are accepted at every untracked one-arg position
  (`defineView`, `jsonArrayFrom`, `withCte` — P18) with no assignability
  break (P17).
- **REMOVED-requirement audit:** every guarantee of the removed requirement
  survives in the ADDED pair — declared-type/projected-key/array-element
  rules verbatim, the `missing-from-table` object-projection rule, the
  whole-table/`returning()` carve-out — nothing dropped; the removal's stated
  reason (the blanket-widening paragraph and its pinned scenario are no
  longer true) is confirmed by P1.

**Limitations:** no live database in this environment — the delta's
execution-dependent scenario text ("… executes against a real database", the
conversion halves of the MODIFIED aggregate/window requirements) is carried
over unchanged from the corpus and was verified here at the type level only;
the runtime-conversion claims were not re-run. No git history in this export
— "pre-existing" judgments rest on the corpus text, the delta's own
description of the prior state, and the dist types' own markers, not on
diffs.

**Bottom line:** the implementation narrows exactly where the declaration
justifies it and never narrows on missing information; the chain's set-op
combination — the one spot a mistake would have been unsound — is correct in
both orders. What blocks the archive is spec prose: one scenario (F1) and one
unmodified corpus requirement (F2) that now say things the shipped types
demonstrably do not, plus two wording-level precision gaps (F3, F4). All four
are text fixes; none requires code change.
