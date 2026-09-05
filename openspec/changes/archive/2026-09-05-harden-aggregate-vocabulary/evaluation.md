# D106 round 1 — harden-aggregate-vocabulary

## Method

Context-free adversarial spec-only review (D106), by input construction
(D110). Evidence read: the delta
`openspec/changes/harden-aggregate-vocabulary/specs/query-execution/spec.md`
against the base `openspec/specs/query-execution/spec.md`, the public
surface `skills/hejbro/references/query-layer.md`, and the built
packages (`packages/*/dist/index.js`, `packages/*/dist/index.d.ts`). No
proposal/design/tasks, no source, no tests, no `.blackbox/`, no git
history.

- Worktree: detached at `upstream/dev` = `67fc7b582ed3990768b66f87255915f9a5e52386`
  (`/private/tmp/d106-av/wt`), `pnpm install --frozen-lockfile`, then
  `TURBO_FORCE=1 pnpm build --force` → `Tasks: 7 successful, 7 total | Cached: 0 cached`.
- Versions: node v26.7.0, pnpm 10.31.0, typescript 5.9.3, `pg` 8.23.0,
  packages `0.2.0-pre.1`.
- Container: `d106-av-pg` = `postgres:17` (PostgreSQL 17.11) on
  `127.0.0.1:55481`, `log_statement = 'all'` for the RLS/preview probes.
- Probe package `/private/tmp/d106-av/probe` with `node_modules/hejbro`,
  `@hejbro/{core,query,pg,supabase}` symlinked to the worktree's built
  packages; runtime probes `probe1..7.mjs`, type probes `types*.ts`
  compiled with `tsc --strict --noEmit`.
- Both MODIFIED requirement titles match the base spec's
  `### Requirement:` lines verbatim (*A db handle executes built
  statements*, *Nested values are revived to their declared types*).
- Declared inputs: `app.posts` (`id uuid pk`, `title text`, `views bigint`,
  `hits bigint{mode:number}`, `sviews bigint{mode:string}`,
  `ratio double precision`, `n integer`, `price numeric`, `at timestamptz`),
  `app.comments` (`id`, `postId → posts.id`, `score bigint`, `body text`,
  `at timestamptz`), `app.ledger` (`id bigserial pk`, `amt numeric`,
  `amtN numeric{mode:number}`, `amtB bigint{mode:number}`). Data: post P1 with
  three comments whose `score` = 9007199254740993 / …995 / …997 (all past
  2^53), post P2 with no comments; ledger ids 9007199254740993 / …995.
- Every constructor the surface names was projected in every position
  the delta names: plain top-level select, `jsonArrayFrom`,
  `jsonObjectFrom`, `related()`, set operations (top-level and with
  nested branches), a CTE body read through `handle.with`, a
  `@hejbro/supabase` decorated handle (plain and `as(asAnon())`), and
  `db.as({ role, settings })`. `db.fn` is not named by the delta and was
  not probed.

Notation below: `bigint "…n"` is the JS type and value as delivered by
the driver-backed handle; `SQL:` is `compile().sql`.

## B1 — A nested cell read through a CTE is cast but not revived

**Scenario sentences measured:** "A cell is cast exactly when it is
revived." / *An aggregate cell keeps its precision too*: "the delivered
value is exactly that `bigint`, not a rounded number and not the cast's
text" / *A windowed cell keeps its precision too*: "each delivered value
is exactly that `bigint`, the compiled SQL shows the text cast on each".

**Input** (`probe7.mjs`, `probe6.mjs`):

```ts
handle.with((w) => {
  const base = w.as("base", select({ id: posts.id, views: posts.views, mxv: max(posts.views),
    n: jsonArrayFrom(select({ score: comments.score, at: comments.at,
         c: over(count(), spec), l: over(lag(comments.score), spec) }, comments)
         .where(eq(comments.postId, posts.id)).orderBy(comments.id)),
    o: jsonObjectFrom(select({ c: count(), m: max(comments.score) }, comments)
         .where(eq(comments.postId, posts.id))) }, posts).groupBy(posts.id, posts.views));
  return select({ id: base.id, views: base.views, mxv: base.mxv, n: base.n, o: base.o }, base)
    .where(eq(base.id, P1));
})
```

**Observed.** `compile()` shows the casts inside the CTE body:
`"score"::text`, `count(*) over (…)::text`, `lag(…) over (…)::text`,
`count(*)::text as "c"`, `max(…)::text as "m"`. Delivered:

| cell | delivered (CTE path) | delivered (same projection, no CTE) | TS type (both) |
|---|---|---|---|
| `o.c` (`count()`) | `string "3"` | `bigint 3n` | `bigint \| null` |
| `o.m` (`max(score)`) | `string "9007199254740997"` | `bigint 9007199254740997n` | `bigint \| null` |
| `n[].c` (`over(count())`) | `string "1"` | `bigint 1n` | `bigint \| null` |
| `n[].l` (`over(lag(score))`) | `string "9007199254740993"` | `bigint 9007199254740993n` | `bigint \| null` |
| `n[].score` (plain column) | `string "9007199254740993"` | `bigint 9007199254740993n` | `bigint \| null` |
| `n[].at` (plain column) | `string "2026-02-01T00:00:00+00:00"` | `Date` | `Date \| null` |
| `views`, `mxv` (top-level CTE fields) | `bigint 9007199254740993n` | — | `bigint` |

Through the CTE the cast fires and the revive does not: the aggregate
and windowed cells arrive as exactly "the cast's text" the scenario
excludes, while the type layer promises `bigint | null`. The plain
`bigint` column and the `timestamptz` column on the same path arrive
unrevived too, so this is the whole nested-read-through-CTE path, not the
aggregate rows alone — the "does not lose that protection by being an
aggregate" half holds relative to a plain column, but the delta's
universal "cast exactly when revived" and the two precision scenarios do
not. Top-level CTE fields (`views`, `mxv`, `rn`) are revived correctly.

## N1 — `sum`/`avg` are called "JSON-safe" but a nested `sum(int8)` is a rounded number and differs in shape from the top-level read

**Sentence measured:** "as its own JSON-safe shape (`sum`, `avg`,
`percent_rank`, `cume_dist`, `ntile` — neither cast nor converted …)" and
the doc (`query-layer.md`, window table): windowed `sum` "arrives as the
*text* Postgres sends for `numeric` (e.g. `"35"`)".

**Input** (`probe1.mjs`): `sum(comments.score)`, `avg(comments.score)`,
`over(sum(comments.score), spec)` over the three scores past 2^53, nested
in `jsonArrayFrom` and top-level.

| cell | nested delivered | top-level delivered |
|---|---|---|
| `sum(score)` | `number 27021597764222984` | `string "27021597764222985"` |
| `avg(score)` | `number 9007199254740996` | `string "9007199254740995.0000"` |
| `over(sum(score))` row 3 | `number 27021597764222984` | `string "27021597764222985"` |

"Neither cast nor converted" is verified (no `::text`, no revive), so the
scenario holds. But the requirement's label "JSON-safe shape" is not
true of `sum`/`avg`: the nested value is a wrong number (the exact sum is
…985), and the nested shape (`number`) is not the top-level shape
(`string`) the doc describes. The doc's nested-reads section says
nothing about `sum`/`avg` in a nested cell. Gap in wording and
documentation, not a scenario contradiction.

## N2 — `percentRank`/`cumeDist`/`ntile` read as the wide numeric union in the type layer while the doc says `number`

**Sentence measured:** doc window table: "`percentRank()` / `cumeDist()`
| `number`", "`ntile(buckets)` | `number`"; delta: "the other three are
carried losslessly".

**Input** (`types.ts`, `types3.ts`): `over(percentRank(), spec)`,
`over(cumeDist(), spec)`, `over(ntile(2), spec)` nested and top-level.

**Observed.** `tsc`: every one of the three is
`string | number | bigint | null` in both positions (`Argument of type
'string | number | bigint | null' is not assignable to parameter of type
'number | null'`). Runtime (`probe1.mjs`): `pr: number 0.5`,
`cd: number 0.666…`, `nt: number 2` — the value is a number, the type is
the family union. The delta states no TS type for these rows; the public
doc does, and the declared type does not match it.

## N3 — A `bigserial` column is typed `bigint` but sits outside the at-risk cast, so it and every argument-row over it round in a nested read

**Sentence measured:** "`bigint` values past 2^53 arrive intact as
`bigint` (the compiler casts at-risk columns to text …)"; argument rows
"cast and revived exactly as that argument would be".

**Input** (`probe2b.mjs`): `ledger.id` is `bigserial().primaryKey()`
(`ColumnReadType` maps `bigserial` → `bigint`); rows 9007199254740993 and
9007199254740995.

| cell | SQL | nested delivered | top-level delivered |
|---|---|---|---|
| `ledger.id` | no cast | `number 9007199254740992` | `string "9007199254740993"` |
| `max(ledger.id)` | no cast | `number 9007199254740996` | `string "9007199254740995"` |
| `over(lag(ledger.id))` | no cast | `number 9007199254740992` | — |

The argument rule holds literally (the argument is neither cast nor
revived, and so is `max`/`lag` over it), but the argument itself is a
wrong value nested and a `string` top-level against a declared `bigint`
read type. The delta names `bigint` columns; `bigserial` is a neighbour it
does not cover. For contrast, `bigint({mode:"number"})`,
`bigint({mode:"string"})` and `numeric` columns are cast and revived
correctly through `max`/`lag` (see OK5).

## N4 — An at-risk aggregate wrapped in a non-vocabulary function loses precision silently

**Sentence measured:** "The vocabulary SHALL be closed over the builder's
constructors"; "A cell is cast exactly when it is revived."

**Input** (`probe6.mjs`, `types3.ts`): nested
`coalesce(max(comments.score), comments.score)`.

**Observed.** SQL: `coalesce(max("app"."comments"."score"), "app"."comments"."score")` —
no cast; delivered `number 9007199254740992` for the row whose exact
value is 9007199254740993; TS type `string | number | bigint | null`.
Cast-equals-revive holds (neither), and `coalesce` is not a builder
aggregate, so this is not a contradiction — but a value past 2^53 built
from vocabulary members through one `coalesce` arrives rounded with no
signal. Recorded as a gap at the vocabulary's boundary.

## N5 — The vocabulary object is reachable from `@hejbro/core` only

**Sentence measured:** "One vocabulary, owned by the core and read by
both the cast side and the revive side".

**Observed** (`probe2.mjs`): `import { BUILDER_READ_SHAPES } from "hejbro"`
→ `SyntaxError: The requested module 'hejbro' does not provide an export
named 'BUILDER_READ_SHAPES'`; the same import from `@hejbro/core`
resolves. The `hejbro` package re-exports core's types
(`export type * from "@hejbro/core"`) so `BuilderFunctionName`/`ReadShape`
are importable from `hejbro`, but the runtime table is not. Consistent
with "owned by the core" and with the d.ts note that it is the query
layer's contract, not user surface; noted so the surface's shape is on
record.

## OK1 — Precision survives the JSON round trip

**Input** (`probe4.mjs`): `handle.as({ role: reader, settings }).select(posts).related({ comments: true })`.
SQL shows `"app"."comments"."score"::text as "score"` inside the
`json_agg` subselect; delivered `comments[0].score = bigint 9007199254740993n`,
`comments[1].score = bigint 9007199254740995n`; P2's `comments = []`.

## OK2 — An aggregate cell keeps its precision too

**Input** (`probe1.mjs`, `probe2.mjs`): nested `count()`, `count(comments.body)`,
`min(comments.score)`, `max(comments.score)` in `jsonArrayFrom` and
`jsonObjectFrom`; the zero-comment parent P2.

SQL: `count(*)::text`, `count("…"."body")::text`, `min(…)::text`,
`max(…)::text`. Delivered (array and object forms identical):
`cnt: bigint 3n`, `cntArg: bigint 2n`, `mn: bigint 9007199254740993n`,
`mx: bigint 9007199254740997n`. Zero rows: `cnt: 0n`, `mx: null`,
`sm: null`; `jsonArrayFrom` over a window projection with zero rows: `[]`.

## OK3 — A windowed cell keeps its precision too

**Input** (`probe1.mjs`): `spec = { orderBy: [comments.id] }`, nested
`over(count())`, `over(max(score))`, `over(min(score))`, `over(sum(score))`,
`over(avg(score))`, `over(rowNumber())`, `over(rank())`, `over(denseRank())`,
`over(percentRank())`, `over(cumeDist())`, `over(ntile(2))`,
`over(lag(score))`, `over(lead(score))`, `over(firstValue(score))`,
`over(lastValue(score))`, `over(nthValue(score, 2))`, `over(lag(at))`.

| cell | `::text` in SQL | delivered (row 3 of 3) |
|---|---|---|
| `over(count())` | yes | `bigint 3n` |
| `over(max(score))` | yes | `bigint 9007199254740997n` |
| `over(min(score))` | yes | `bigint 9007199254740993n` |
| `over(sum(score))` | **no** | `number 27021597764222984` |
| `over(avg(score))` | no | `number 9007199254740996` |
| `over(rowNumber())` / `rank()` / `denseRank()` | yes | `bigint 3n` each |
| `over(percentRank())` / `cumeDist()` / `ntile(2)` | no | `number 1` / `number 1` / `number 2` |
| `over(lag(score))` / `lead` / `firstValue` / `lastValue` / `nthValue(…, 2)` | yes | `bigint` (…995n / `null` / …993n / …997n / …995n) |
| `over(lag(at))` | no (not at-risk) | `Date 2026-02-02T00:00:00.000Z` |

Matches the scenario, including "a nested `over(sum(col), …)` is neither
cast nor converted".

## OK4 — Every builder function is classified, and cast agrees with revive

**Input** (`probe2.mjs`, `types.ts`, `probe1.mjs`).
`BUILDER_READ_SHAPES` at runtime has exactly 16 rows:
`count/row_number/rank/dense_rank → "int8"`,
`min/max/lag/lead/first_value/last_value/nth_value → "argument"`,
`sum/avg/percent_rank/cume_dist/ntile → "own"` — the same 16 names as the
`BuilderFunctionName` union in `core/dist/index.d.ts`, and each of the 16
constructors is importable from `hejbro` and renders that exact
Postgres name (all 16 appear in `probe1`'s compiled SQL). Direct-path
cast/revive per row: every `int8` and `argument` cell above is cast
(`::text`) and revived; every `own` cell is neither (OK3 table, OK2).
Type-level closure: `const bad: BuilderFunctionName = "string_agg"` and
`const partial: Readonly<Record<BuilderFunctionName, ReadShape>> = { count: "int8" }`
both fail `tsc` (both `@ts-expect-error` lines consumed), and
`BUILDER_READ_SHAPES` itself satisfies the full record type. The
string-level enumeration test the sentence describes is a test I was told
not to read; the public-surface half is what is verified here. The one
position where cast does not agree with revive is B1.

## OK5 — Argument rows are cast and revived exactly as their argument

**Input** (`probe2.mjs`): for each `posts` column `c`, nested `c`,
`max(c)`, `over(lag(c), spec)`.

| column | plain cast | `max` cast | `lag` cast | `max` delivered |
|---|---|---|---|---|
| `views bigint` | yes | yes | yes | `bigint 9007199254740993n` |
| `hits bigint{number}` | yes | yes | yes | `number 5` |
| `sviews bigint{string}` | yes | yes | yes | `string "9007199254740993"` |
| `price numeric` | yes | yes | yes | `string "1.25"` |
| `ratio float8` | no | no | no | `number 0.5` |
| `n integer` | no | no | no | `number 7` |
| `at timestamptz` | no | no | no | `Date 2026-01-01T00:00:00.000Z` |
| `title text` | no | no | no | `string "a"` |

Every row's `max`/`lag` cast column equals its plain-column cast column,
and the delivered type equals the column's declared read type.

## OK6 — An explicit user cast is left alone

**Input** (`probe1.mjs`, `probe3.mjs`, `types.ts`): nested
`` sql`${max(comments.score)}::text` `` and `` sql`${count()}::text` ``.
SQL renders each cast exactly once (`max("…"."score")::text as "user_cast"`,
`count(*)::text as "user_cast_cnt"` — no second `::text` appended);
delivered `string "9007199254740997"` and `string "3"` nested, the same
top-level, and inside a union branch; TS type `unknown` (the `sql`
fragment's own type).

## OK7 — One statement under the RLS context

**Input** (`probe4.mjs`): `app_reader` role with a `select` policy
`body is not null` on `app.comments` (comment c3 has `body = null`);
`handle.as({ role: reader, settings: { "app.tenant": "t1" } }).select(posts).related({ comments: true })`.
Postgres `log_statement='all'` between markers:

```
BEGIN
set local role "app_reader"
execute <unnamed>: select set_config($1, $2, true)   Parameters: 'app.tenant', 't1'
statement: select "app"."posts"."id" as "id", … (select coalesce(json_agg("agg"), '[]'::json) … ) as "comments" from "app"."posts"
COMMIT
```

Exactly one statement between the context statements and `COMMIT`.
Nested rows obey the policy: P1 delivers 2 of its 3 comments (c3
excluded); a nested `count()`/`max(score)` under the same context returns
`2n` / `9007199254740995n` where the unscoped handle returns `3n` /
`9007199254740997n`.

## OK8 — Executed SQL equals previewed SQL, with or without a context

**Input** (`probe4.mjs`): the two statements above plus the same nested
aggregate read on the unscoped handle. The logged text of each executed
statement is byte-identical to its `compile().sql`; parameters
(`$1 = '1111…'`) match `compile().params`; the context's
`set local role` / `set_config` precede the statement inside the same
`BEGIN … COMMIT` and do not alter it; without a context no transaction
wraps the single `execute`.

## OK9 — Set operations

**Input** (`probe3.mjs`): (a) `select({c: count(), m: max(comments.score), s: sum(comments.score)}, comments).unionAll(select({…}, posts))`
→ rows `c: bigint 3n / 2n`, `m: bigint …997n / …995n`, `s: string` —
converted per the left branch. (b) A `unionAll` whose both branches carry
`jsonArrayFrom` cells with `count()`, `max`, `sum`, `over(count())`,
`over(lag(score))`, and a user `::text` cast, ordered by `posts.id`:
both branches deliver `c: bigint`, `m: bigint`, windowed `bigint`, user
cast `string`, `sum` `number`; the right branch (P2, zero comments)
delivers `c: 0n`, `m: null`, `s: null`.

## OK10 — Provider handle

**Input** (`probe5.mjs`): `db({posts, comments}, supabaseDriver(pgDriver(URL)))`,
unscoped and `.as(asAnon())` (an `anon` role created with `select`
grants). Compiled SQL is identical to the vanilla handle's; delivered
values identical: `cnt: bigint 3n`, `mx: bigint …997n`, `sm: number`,
`uc: string`, windowed `count`/`lag`/`rowNumber` as `bigint`, windowed
`sum` as `number`; `related({ comments: true })` under `asAnon()`
delivers the three `bigint` scores.

## OK11 — Type layer for nested cells

**Input** (`types.ts`, `types2.ts`, `tsc --strict`): nested
`count()`/`min`/`max` over `bigint` → `bigint | null`; `max(at)` →
`Date | null`; `sum`/`avg` → `string | number | bigint | null`;
`jsonObjectFrom` → `{ readonly cnt: bigint | null } | null`;
`over(count()/max/rowNumber/rank/denseRank/lag/firstValue/lastValue/nthValue)`
→ `bigint | null`; `over(lead(at))` → `Date | null`; a bare `rowNumber()`
in a projection fails to type-check. Nested and top-level types agree
for every cell probed (`types2.ts`).

## Summary

| class | count |
|---|---|
| **B** | 1 (B1) |
| **N** | 5 (N1–N5) |
| **OK** | 11 (OK1–OK11) |

B1: a nested aggregate/window cell read through a CTE body is cast in
`compile()` but delivered as the cast's text (the whole
nested-read-through-CTE path is unrevived — plain `bigint` and
`timestamptz` cells there too), contradicting "A cell is cast exactly
when it is revived" and the two precision scenarios' "not the cast's
text", while the type layer promises `bigint | null`.
