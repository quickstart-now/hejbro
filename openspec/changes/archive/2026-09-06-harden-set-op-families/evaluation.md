# D106 evaluation — harden-set-op-families (round 1)

Context-free adversarial spec-only review. Inputs read: the delta
`specs/query-type-inference/spec.md` (ADDED "Set-operation branches must
agree in type family", 6 scenarios), the main
`openspec/specs/query-type-inference/spec.md`, the built public surface
(`hejbro`, `@hejbro/query`, `@hejbro/pg` imported as a user, `tsc
--strict`), `skills/hejbro/references/query-layer.md`, `README.md`, and
`.changeset/harden-set-op-families.md`. Not read: proposal, design,
tasks, `.blackbox/`, `packages/*/src`, `packages/*/test`, PR/issue text,
git log. Worktree at dev `116e13f4` (PR #992 merged), fresh
`pnpm install --frozen-lockfile && TURBO_FORCE=1 pnpm build --force`.
Server: `postgres:17-alpine` (PostgreSQL 17.11), container `d106-sf-pg`,
host port 55680, removed afterwards.

## Method

1. **Family map.** Every column factory the public surface exports
   (`bigint serial boolean bytea char cidr date doublePrecision inet
   integer interval json jsonb jsonb().$type<…>() macaddr numeric real
   smallint text text().notNull() time timestamp timestamptz timetz uuid
   varchar`, two `pgEnum` columns, `text[] integer[] time[]
   timestamptz[]`) and every expression form a projection accepts
   (`` sql`'abc'` ``, `` sql`'1'` ``, `` sql`null` ``, `` sql`1` ``,
   `` sql`now()` ``, `now()`, `count()`, `genRandomUuid()`,
   `literal(true)`) was resolved to its `Expr<F>` family through `tsc`
   (41 kinds). The family union the surface exposes is
   `boolean | uuid | text | numeric | datetime | interval | json | bytea
   | net | array | unknown` — ten concrete families plus `unknown`,
   matching the reference's "ten concrete type families". `literal()`
   accepts only a boolean and types `Expr<"boolean">`; there is no
   string/number literal constructor, so a quoted literal or `NULL` is
   only spellable through `sql`.
2. **Full 41×41 pair table, both directions.** For every ordered pair
   the same statement was (a) type-checked as `select({k: A}, t)
   .union(select({k: B}, t))` on the core builder and as
   `h.select(…).union(h.select(…))` on the chain (3,362 assertions,
   errors mapped back per line), and (b) compiled with hejbro's own
   `.compile()` and executed on the server as both `union` and
   `union all` against a seeded one-row table (3,362 executions,
   SQLSTATE recorded). Core and chain compile to byte-identical SQL.
3. **Other combinators and the recursive pair.** 14 family
   representatives (one per concrete family, an array, plus `sql`
   string / `sql null` / `sql 1` / `literal(true)`) × 14 for
   `unionAll`, `intersect`, `intersectAll`, `except`, `exceptAll` on
   core and chain (1,960 assertions, 980 executions), and for
   `w.asRecursive(anchor, self => term)` on `withCte` and on
   `handle.with` (392 assertions, 196 executions; the recursive term
   is `select({k: B}, self).innerJoin(t, sql\`true\`).where(sql\`false\`)`
   so the server resolves the union's types without recursing).
4. **Nesting / three branches** over `text`, `integer`, `` sql`'abc'` ``:
   `(A ∪ B) ∪ C`, `A ∪ (B ∪ C)`, and the chain's left-nested form (81
   assertions, 54 executions).
5. **Within-family divergence** (`integer/bigint`, `bigint/integer`,
   `numeric/bigint`, `bigint/numeric`, `text/varchar`, `inet/cidr`,
   `date/timestamptz`) as a plain union and as anchor/term (14
   assertions, 14 executions).
6. **Diagnostics, result types, docs.** Where the error lands and what
   it says per surface, the key's result type after a same-family
   union, the key-set-mismatch diagnostic for comparison, the
   reference's recursive-CTE example compiled and executed verbatim
   (rows come back), the reference's "text anchor vs integer term"
   sentence, and `literal(true)` unions executed end-to-end through
   `handle` with `pgDriver` (plain and `preparedStatements: true`).

Totals: **5,868 type-probe assertions; 4,612 server executions.**

Type-layer result, before comparing with the server: across every
surface (core, chain, `withCte`/`handle.with` recursive) and every
combinator, the refused set is *exactly* the set of ordered pairs whose
two families are both concrete and different — 0 refusals of a
same-family or `unknown`-sided pair, 0 accepted cross-family pairs,
0 core/chain disagreements, 0 combinator-to-combinator disagreements.
Every refusal is `TS2345 Argument of type '…' is not assignable to
parameter of type 'never'` at the combinator's argument (for
`asRecursive`, at the recursive-term callback argument) — the same
shape the existing key-set-mismatch refusal produces.

## Blocking findings

### B1 — `literal(true)`/`literal(false)` is refused against text, bytea and json, but the server unifies and runs the compiled statement

Delta sentences contradicted:

> "this rule SHALL refuse only what it can prove the server refuses"
> "Every pair the server unifies is a same-family one; those SHALL stay
> accepted."
> Scenario "A pair the server unifies stays accepted": "the only
> cross-branch pairs the server is known to unify (measured: no
> cross-family pair unifies on postgres:17)".

Reproduction (user code, `tsc --strict`):

```ts
const t = table(app, "t", { text: text(), boolean: boolean() });
select({ k: t.text }, t).union(select({ k: literal(true) }, t));
// error TS2345: Argument of type 'SelectDistinctable<{ k: Expr<"boolean">; }, never>'
//   is not assignable to parameter of type 'never'.
handle.select({ k: literal(false) }, t).union(handle.select({ k: t.text }, t)); // same
```

The same statement, compiled by hejbro and executed through
`pgDriver` (plain and with `preparedStatements: true`):

```
select "app"."t"."text" as "k" from "app"."t" union all select $1 as "k" from "app"."t"   params [true]
rows: [{"k":"x"},{"k":"true"}]
```

`literal()` compiles to an untyped parameter `$1`; the server resolves
it against the other branch at type resolution exactly as the delta
describes for a quoted literal, and accepts it. Measured on postgres:17
for every combinator and both operand orders: **`literal(true|false)`
against `text`, `text().notNull()`, `varchar`, `char`, `bytea`, `json`,
`jsonb`, `jsonb().$type<…>()` is accepted by the server (rows returned)
and refused by the type layer** — 16 of the 1,681 union pairs, 30 of
the 980 rows per other combinator, 8 of the 196 recursive pairs. Against
the remaining families the same `$1` is accepted at type resolution too
and fails only at the value level (`22P02`/`22007`, e.g. `integer` vs
`'true'`), so for `literal()` there is no pairing the server refuses at
type resolution at all. The type layer places `literal(true)` in the
`boolean` family (it is not `"unknown"`), so the delta's own
`"unknown"` carve-out does not cover it, and the sentence "no
cross-family pair unifies" is false for hejbro's own compiled output.

Scope is narrow (the only placeable literal is a boolean), and the
remedy can be either side — a spec sentence stating that a `literal()`
travels as an untyped parameter and is nevertheless refused by family
(a refusal stricter than the server's, like the key-set rule), or
typing `literal()` as `"unknown"` for the combinator's purposes — but
as written the delta's universal sentence and the shipped behavior
disagree on a concrete input with a reproduction. Verdict follows the
brief: a delta sentence contradicted by shipped behavior blocks.

## Non-blocking findings

- **N1 — An `unknown`-headed nested set operation hides a typed branch
  from the outer combinator.** `select({k: t.text}, t).union(
  select({k: sql\`'abc'\`}, t).union(select({k: t.integer}, t)))` and
  `select({k: sql\`'abc'\`}, t).union(select({k: t.text}, t)).union(
  select({k: t.integer}, t))` both type-check (the inner set operation
  carries only its left branch's projection, which is `"unknown"`),
  while the server refuses them (`42804`/`22P02`). The delta's
  per-combinator wording ("SHALL match every family on the other side")
  is honoured literally; the main spec's "carries the LEFT branch's
  projection alone" explains it. Worth a sentence beside the `unknown`
  rule so a reader does not take the wildcard as a proof of acceptance
  through nesting. When the typed branch heads the inner set operation
  (`text ∪ (integer ∪ sql)`) the refusal fires as expected.
- **N2 — `sql` fragments the server types are refused there, as
  stated, and the refusal code is not always `42804`.** `` sql`now()` ``
  against `time`/`timetz` is `42846` ("could not convert type"), against
  everything else `42804`; `` sql`1` `` against every non-numeric family
  is `42804`. The delta's parenthetical "42804 or 42846" covers both;
  noted only because the scenario text names just "may be refused".
- **N3 — `json ∪ json` (deduplicating `union`, `intersect`, `except`)
  is refused by the server with `42883` "could not identify an equality
  operator for type json", while `union all` accepts it.** A same-family,
  same-type pair the delta's "those SHALL stay accepted" covers; the
  refusal is not a type-resolution one (not `42804`/`42846`), so it is
  outside the sentence's letter, but "a pair the server unifies stays
  accepted" reads as a promise the statement runs. Neighbor, not this
  rule's.
- **N4 — Scenario "A family added without a row is caught" names
  `sqlTypeFamilies`, which is not on the public surface** (`hejbro`
  exports no such value; `import { sqlTypeFamilies } from "hejbro"`
  is `undefined`). The scenario is only verifiable from the test suite,
  which a spec-only review cannot open; it is a test-contract scenario
  rather than a user-observable one. Acceptable, but flagged because
  every other scenario in the delta is black-box checkable.
- **N5 — The reference's timing sentence is slightly off for
  constants.** `query-layer.md` says the value-level failure of a
  literal inside a `sql` fragment is answered "at execution
  (`22P02`/`22007`)"; on the server a constant is coerced during
  analysis, so the error is raised on the first round-trip even when
  the table is empty (measured with and without rows). From the
  client's side it arrives on execute either way; wording only.
- **N6 — Diagnostic content.** Every refusal is "not assignable to
  parameter of type 'never'": the key and the two families are visible
  only inside the printed argument type (e.g. `{ k: Expr<"numeric">
  … }`), never named in the message. The delta promises "exactly as a
  key-set mismatch is refused today", which is met (same shape); a
  reader of the reference who expects the families to be named will not
  find them. Neither spec nor reference promises more, so this is an
  observation.
- **Verified as stated, no action:** the #977 same-family server
  refusals are exactly the list the delta enumerates (enum vs
  text/varchar/char/other enum: `42804`/`42846`; `time`/`timetz` vs
  `date`/`timestamp`/`timestamptz`: `42846`; `json` vs `jsonb`:
  `42846`; `macaddr` vs `inet`/`cidr`: `42804`; `text[]`/`integer[]`/
  `time[]`/`timestamptz[]` against each other: `42846`) and no other
  same-family pair is refused at type resolution. Cross-family pairs of
  typed expressions: all 1,014+34 refused (`42804`, `42846`), none
  unify. Within-family divergence: `integer ∪ bigint` type-checks and
  runs; as anchor/term, `integer`→`bigint`, `bigint`→`numeric`,
  `date`→`timestamptz` are refused by the server (`42804` "… in
  non-recursive term but type … overall") and type-check — the #489 gap,
  stated. Nullability (`text().notNull()` vs `text()`), `$type` brand
  (`jsonb().$type<…>()` vs `jsonb()`), `inet` vs `cidr`, `text` vs
  `varchar`/`char` all accepted on both sides. Same-family result type
  unchanged (`{ k: string }` stays `{ k: string }` on the chain; the
  core set operation's key stays `Expr<"text">`). Changeset text and
  reference prose agree with the measured behavior except as in B1.

## Scenarios verified

| Scenario | Result |
|---|---|
| A refused pair fails to type-check | Holds for every cross-family pair of typed expressions, on core, chain, and both recursive surfaces, all six combinators, before compile (1,117/1,681 union pairs; 700/980 per other combinator; 116/196 recursive). |
| An expression the server leaves untyped is resolved against the other branch | Holds for `` sql`'abc'` ``, `` sql`'1'` ``, `` sql`null` `` on either side or both: type-checks, server resolves against the other branch, value-level `22P02`/`22007` where the text does not parse. |
| A `sql` fragment is accepted because the type layer cannot see it | Holds: `` sql`1` ``, `` sql`now()` `` type-check against every family and are refused by the server (`42804`/`42846`) where it types them. |
| A pair the server unifies stays accepted | Holds for every same-family pair; **contradicted by `literal(true|false)` vs text/bytea/json — B1.** |
| A family added without a row is caught | Not verifiable from the public surface (N4). |
| Within-family divergence is not this rule's | Holds: `integer ∪ bigint` type-checks and runs; the recursive form's server refusal is the stated #489 gap. |

## Verdict

**BLOCKED** — one blocking finding (B1: `literal()` compiles to an
untyped parameter the server unifies with text/bytea/json, while the
family rule refuses it, contradicting "refuse only what it can prove
the server refuses" and "no cross-family pair unifies"); six
non-blocking notes. 5,868 type-probe assertions; 4,612 server
executions.

## Round 2 (after the B1 wording repair)

Scope as requested by the lead: the three corrected delta sentences
("refuse only pairs of families it can see — cross-family pairs of
placed expressions"; "Every pair of placed expressions the server
unifies is a same-family one"; scenario 4's `literal()` parenthetical),
the two corrected reference sentences, and whether any public path
places `literal()` outside `boolean`. Code unchanged (dev `116e13f4`);
delta and reference read from the lead's archive worktree, probes run
from the round-1 worktree against a fresh `postgres:17-alpine`
(container `d106-sf-pg`, port 55680, removed afterwards).

### Method

- **Matrix.** 20 kinds — every text-family column (`text`,
  `text().notNull()`, `varchar`, `char(1)`), `bytea`, `json`, `jsonb`,
  `jsonb().$type<…>()`, one column per remaining concrete family
  (`integer`, `boolean`, `uuid`, `timestamptz`, `interval`, `inet`,
  `text[]`), the unplaced forms `` sql`'abc'` ``/`` sql`null` ``/
  `` sql`1` ``, and both `literal(true)` and `literal(false)` — in every
  ordered pair, for all six combinators on core and chain and for
  `w.asRecursive` on `withCte` and `handle.with`: **5,600 type
  assertions**, and the same 2,800 hejbro-compiled statements executed
  on the server (**2,800 executions**). Each row was tested against the
  corrected sentences mechanically: S1 the refused set must equal
  "cross-family pairs of placed expressions"; S2 no cross-family pair
  of placed expressions other than `literal()` may unify on the server;
  S3 same-family placed pairs must type-check; S4 an `unknown`-sided
  pair must type-check; and the 448 B1 rows (`literal(true|false)`
  against the eight text/bytea/json kinds, both orders, every surface)
  must read as "refused by declaration, resolved as a parameter by the
  server".
- **`literal()` placement (3).** `typeof literal` from `hejbro` and
  `@hejbro/core` revealed through `tsc`; `@hejbro/query`'s export set
  checked for a `literal`; calls with `string`, `number`, `null`,
  `Date`, `boolean[]`, `boolean | null`, and an explicit type argument
  (11 assertions).
- **Reference timing sentence (4).** On an *empty* table: a quoted
  constant vs `integer` under `PREPARE` alone and under execute; a bind
  parameter `'true'` vs `integer` under `PREPARE` alone and under
  execute; the same parameter vs `text` (5 executions).

Totals for this round: **5,611 type-probe assertions; 2,805 server
executions.**

### Findings

- **B1 is repaired for every plain combinator.** S1–S4: 0 violations
  across 5,600 rows; 0 core/chain disagreements. All 448 B1 rows are
  refused by the type layer (cross-family by declaration), and in the
  six plain combinators the server resolves the parameter against the
  other branch exactly as the corrected sentence says — accepted and
  executed, except `json` under a deduplicating or `ALL`
  intersect/except, which passes type resolution and then fails on
  `json`'s missing equality operator (`42883`, the N3/#997 neighbor,
  not a type-resolution refusal). The scenario-4 parenthetical and the
  reference's placed-expression sentence read true against the same
  rows. No placed cross-family pair other than `literal()` unified on
  the server (S2: 0).
- **R2-N1 (non-blocking) — the explanatory clause "what the server's
  parameter resolution would accept" over-generalizes for the
  recursive anchor position.** When `literal()` is the *anchor* of
  `w.asRecursive`, the server fixes the CTE's column type from the
  anchor alone, resolves the bare parameter to `text`, and then refuses
  a `varchar`, `char`, `bytea`, `json`, `jsonb` or
  `jsonb().$type<…>()` recursive term itself: `42804` "recursive query
  "r" column 1 has type text in non-recursive term but type character
  varying/bpchar/bytea/json/jsonb overall" (24 of the 448 B1 rows; only a
  `text`/`text().notNull()` term is accepted there). `char(1)` as the
  anchor against a `literal()` term is refused too (`42804` "…
  character(1) in non-recursive term but type bpchar overall", 4 rows —
  a typmod quirk of the recursive form). The SHALL is unaffected — every
  one of these rows is refused by the type layer, so no user can observe
  the difference — but the sentence as written claims server acceptance
  for "a recursive CTE's anchor/recursive-term pair" too, and for the
  anchor position that is measured false outside `text`. Suggested
  precision: "…what the server's parameter resolution would accept in a
  plain set operation (as a recursive CTE's anchor the parameter is
  fixed to `text` from the anchor alone, and the server itself refuses
  a non-`text` term)". Classified non-blocking because it is a rationale
  clause about a statement the type layer never lets reach the server;
  the lead may prefer to tighten it before archive.
- **(3) `boolean` qualification is correct.** `literal` is
  `(value: boolean) => Expr<"boolean">` on `hejbro` and `@hejbro/core`
  (identical), has no overloads and no type parameter (`literal<"text">`
  → `TS2558 Expected 0 type arguments`), rejects `string`, `number`,
  `null`, `Date`, `boolean[]` and `boolean | null`, and `@hejbro/query`
  exports no `literal`. There is no public path that places `literal()`
  in another family.
- **(4) Reference timing sentence holds.** A quoted constant against
  `integer` fails at `PREPARE` (analysis) on an empty table —
  `22P02 invalid input syntax for type integer: "abc"` with no row ever
  read — so "for a constant, already in the analysis of the first round
  trip" is exact. A bind parameter is different: `PREPARE` succeeds and
  the same `22P02` arrives at execute (bind); the sentence is scoped to
  constants, so it does not claim otherwise, and `literal()`'s parameter
  case is not described as a constant anywhere. The reference's
  "declared `boolean` family against `text`, `bytea` or `json`" matches
  the family map (`varchar`/`char` fall under `text`).
- **(2) Other scenarios unbroken.** Scenario 2 (`` sql`'abc'` ``,
  `` sql`null` ``): type-checks on every surface; server resolves the
  literal against the other branch, `22P02`/`22007` only where the text
  does not parse. Scenario 3 (`` sql`1` ``): type-checks everywhere;
  refused by the server (`42804`) against every non-numeric family.
  Scenario 4 (same family): 217/217 placed same-family pairs per surface
  type-check; the only server refusals among them are `json` vs `jsonb`
  (`42846`, the stated #977 gap) and `json ∪ json` under deduplication
  (`42883`, N3). Scenario 6 unchanged.

### Verdict (round 2)

**ARCHIVE** — 0 blocking. B1 is closed by the corrected wording on
every plain combinator and both operand orders; one non-blocking
precision note (R2-N1) on the rationale clause for the recursive
anchor position, which the lead may tighten before archive.
5,611 type-probe assertions; 2,805 server executions this round
(11,479 / 7,417 cumulative).
