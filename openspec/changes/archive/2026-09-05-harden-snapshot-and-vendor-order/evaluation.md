# D106 round 1 — harden-snapshot-and-vendor-order

## Method

Context-free adversarial review (D106 archive gate), input-constructor
method (D110): every delta scenario was judged only against inputs
constructed here and run through the shipped surface. No proposal,
design, tasks, blackbox, git history, implementation source or test file
was read; the contract came from `pnpm exec openspec show
harden-snapshot-and-vendor-order --diff` and the user-facing surface from
`skills/hejbro/`, the built CLI, and `@hejbro/query`'s public types.

| | |
|---|---|
| Worktree | `_tmp-d106-so`, detached at `31e951fb` |
| Build | `TURBO_FORCE=1 pnpm build --force` — 7/7 tasks, 0 cached |
| `hejbro` | 0.2.0-pre.1 (`packages/cli/dist/cli.js`) |
| Node | v26.7.0 |
| TypeScript | 5.9.3 (real `tsc --noEmit` run) |
| Postgres | 17.11 in `d106-so-pg` (own container, host port 15911) |
| Scratch | `/private/tmp/d106-so/` — removed at the end |

Inputs constructed: 13 real hejbro projects (`p1`, `p3`–`p9`, `s1`–`s3`,
`c1`, plus a `schemarepo`/`consumer` pair joined by `link` + `vendor`);
28 declaration variants run through `generate`/`verify`/`check`/`pull`;
2 hand-written `contractMetadata` shapes (list and legacy object-keyed)
rendered through `createNameKeyedDb`; 9 hand-edits of a committed
snapshot file; 8 TypeScript cases compiled with `tsc`; 9 SQL programs
executed on Postgres 17.

**BLOCKING 1 / NON-BLOCKING 3 / OK 18**

---

## BLOCKING

### B1 — `schema-vendoring`: the owning repository's own client does **not** send the vendored column order

**Scenario/requirement sentence judged against** (`schema-vendoring`,
"The client metadata lists columns in physical order"):

> A vendored contract's client metadata SHALL carry each table's columns
> as an ordered list in the snapshot's physical column order — **the same
> order the emitted `Row` interface and the owning repository's own client
> use** […] The name-keyed client SHALL build its statements from that
> order, **so the explicit column list a consumer sends is the one the
> owning repository would send**, whatever the columns are named

**Input.** A schema repository whose declaration-literal order differs
from the table's physical order — the case the DSL cheatsheet itself
documents ("a column added later lands at the **end** of the table in
Postgres whatever position it has in the object literal […] reordering
existing columns in TypeScript changes nothing"):

```ts
// schemarepo/src/app.schema.ts  (after `views` was added in a later run)
export const posts = table(app, "posts", {
	views: integer().notNull().default(0),
	title: text().notNull(),
	id: uuid().primaryKey().defaultRandom(),
});
```

**Commands.**

```
schemarepo$ hejbro generate            # -> "no changes" (a pure TS reorder is a documented no-op)
schemarepo$ hejbro generate --export ; git commit
consumer$   hejbro link /private/tmp/d106-so/schemarepo && hejbro vendor
```

Then both clients were driven against a recording driver — the consumer's
own `createDb` from `.hejbro/vendor/contract.ts`, and the owning
repository's own `db({ posts }, driver)` handle — and the compiled SQL
compared.

**Observed.**

```
schemarepo snapshot physical order:  ['id', 'title', 'views']
real catalog (attnum):               1 id, 2 title, 3 views
vendored contract metadata + Row:    id, title, views          <- physical, correct
consumer (vendored):   select "id", "title", "views" from "app"."posts"
owner   (local db()):  select "views", "title", "id" from "app"."posts"
SELECT MATCH: false
```

The same divergence appears with a column simply added mid-literal
(`id, views, title` from the owner vs `id, title, views` from the
consumer).

**Verdict: BLOCKING.** Two of the three artifacts the requirement names
do agree — the emitted `Row` interface and the client metadata are both
in physical order (verified independently, including through `pull` on a
catalog with `attnum` gaps: `a, b, c, d` after a dropped column). The
third does not: the owning repository's own `db()` handle builds its
projection from the declaration literal, not from the snapshot, so it
sends declaration order. `db(schema, driver)` takes declarations only and
has no snapshot to consult, so this is structural, not incidental. The
requirement's normative `SHALL`s hold; the clause "the same order […] the
owning repository's own client use" and the stated consequence "the
explicit column list a consumer sends is the one the owning repository
would send" are contradicted by shipped behaviour, and they are the
change's own stated point. Archiving as written would put a false claim
into `openspec/specs/schema-vendoring`. Either the sentence drops the
owning-client half (keeping "the snapshot's physical column order" and
the `Row` interface, both true), or the owner-side `db()` has to read the
same order — a scope question for the lead, not a wording one.

Reachability is not exotic: reordering columns in the TypeScript literal
is documented as changing nothing, and after this change it silently
changes what the declaring repository's own runtime client sends while
the vendored consumer stays pinned to physical order.

---

## NON-BLOCKING

### N1 — an empty `update of` column list generates SQL Postgres cannot parse

The delta now sorts an `update` event's column list ("with an `update`
event's column list sorted by name"). The degenerate empty list is
sorted, accepted, and emitted.

**Input.**

```ts
export const tg = defineTrigger(t1,
	{ name: "tg1", timing: "before", events: [{ update: [] }], forEach: "row" },
	(ctx, { new: row }) => { ctx.return(row); });
```

**Command / observed.** `hejbro generate` succeeds and writes:

```sql
create trigger "tg1"
	before update of  on "app"."t1"
	for each row execute function "app"."tg1_fn"();
```

Applied to Postgres 17:

```
psql:<stdin>:33: ERROR:  syntax error at or near "on"
LINE 2:  before update of  on "app"."t1"
```

The snapshot node records `{"columns": [], "event": "update"}` and
`verify` passes. Not covered by any delta scenario, and pre-existing
rather than introduced — but this change is the one that takes ownership
of this exact array, and a declaration-time refusal (or treating an empty
list as a bare `update`) belongs with it. A user sees a raw Postgres
syntax error at apply time for a declaration hejbro accepted.

### N2 — `unsupported-return-value`'s text contradicts the new setof rule

**Input.** A `returns setof <table>` body returning a union of two
whole-row selects over the declared table:

```ts
ctx.return(select(tasks).where(gt(tasks.rank, 0)).union(select(tasks).where(eq(tasks.rank, 0))));
```

**Observed.**

```
error[unsupported-return-value]: hejbro.config.ts
  ctx.return() in app.f_x received a value that isn't a trigger row (new/old)
  or a query with .returning(). Next: pass one of those.
```

Under the ADDED requirement the primary accepted form is
`select(<table>)` — no `.returning()` anywhere — so this message tells the
user the opposite of the rule that now governs. It also never names the
two accepted forms, which the new `return-expects-whole-row` error does
correctly and which the requirement mandates for that error. The
set-operation stage itself not being a `ReturnableQuery` is pre-existing
(`ReturnableQuery = SelectLimited<Table> | InsertFinal<…> | UpdateFinal<…>
| DeleteFinal<…>`) and out of scope; the stale wording sits directly on
the surface this change reshaped.

### N3 — "the snapshot file **as stored**" is not what the tip hash covers

**Sentence** (`cli-commands`): "the tip migration's recorded hash is still
compared against the snapshot file as stored, so a hand edit of the
snapshot — a reordered set included — is still reported as a tip
mismatch."

**Input / observed.** The reordered-set half is true (see OK-C2 below).
But the hash is over a canonical re-serialization, not the stored bytes:

```
$ python3 -c "...insert one space before the \"dialect\" key..."
$ shasum -a 256 hejbro.snapshot.json
89ff6dff93c0…                      # file bytes changed
$ grep 'snapshot:' migrations/0002_alter_tasks.sql
-- snapshot: sha256:bc2ce6bcde33…
$ hejbro verify
verify: 5 checks passed (2 migrations, snapshot sha256:bc2ce6bcde33…)
```

Re-indenting the whole file to 4 spaces likewise passes. The behaviour is
defensible (a reformat is not a semantic edit, and array order — the case
the scenario names — *is* caught), but "as stored" reads as byte-level and
is not. Wording only.

---

## OK — verified scenarios

### `snapshot-format`

**OK-F1 — Declarations differing only in a set's order serialize
identically.** Base declaration: a table with three named indexes
(`tasks_zeta_idx`, `tasks_alpha_idx`, `tasks_mid_idx`), two named checks
(`tasks_zcheck`, `tasks_acheck`), a policy `.to(rCharlie, rAlpha, rBravo)`,
and a trigger `events: ["delete", { update: ["title", "status"] }, "insert"]`.
The snapshot records indexes/checks sorted by name, roles sorted by name,
events as insert/update/delete with the update column list sorted. Every
array was then reordered in the declaration; `generate` reported "no
changes" and the snapshot file was byte-identical (`diff -q`).

Sorting is a codepoint sort and total — with roles `Zed, apple, Apple,
_under, ápple, apple2` declared in six different orders the snapshot
always records `["Apple","Zed","_under","apple","apple2","ápple"]`, and
the reordered declaration produced a byte-identical file. Duplicate
members survive (`.to(bee, ant, bee)` → `["ant","bee","bee"]`, rendered
`to "ant", "bee", "bee"`, which Postgres accepts); an empty `.to()` is
refused earlier with `rls-policy-missing-roles`.

**OK-F2 — An ordered array keeps its declared order.** Reversing an
enum's values (`["draft","live","gone"]` → `["gone","live","draft"]`)
still diffs as `enum values removed; recreating type`; reversing an
index's columns still diffs as `index "tasks_ab_idx" changed`; reversing
a foreign key's local and referenced column lists still emits
`drop constraint` + `add constraint … ("fy","fx") references … ("y","x")`;
reordering a function's `args` still emits `drop function` +
`create or replace function "app"."f"(beta text, alpha integer)`.
`grant`'s privileges and roles are already canonical and stayed so
(`("update","select","insert")` → no change; one grant object per role).

**OK-F3 — The format version does not move.** `formatVersion` is 8 in
every snapshot written here and in the committed `examples/postgres`
snapshot, whose set arrays are all canonical. A snapshot hand-set to
`formatVersion: 7` is refused by both `verify` and `generate` with
`unsupported-snapshot-version`, so no silent read of an older format
exists.

### `snapshot-diff`

**OK-D1 — Reordering a set-shaped array generates nothing.** Covered by
OK-F1: change list empty, no migration written.

**OK-D2 — A snapshot written before the canonical order compares equal.**
A pre-canonical snapshot was constructed by rewriting the committed file
with every set array reversed (roles `["r_charlie","r_bravo","r_alpha"]`,
events delete/update/insert with columns `["title","status"]`, indexes and
checks reversed) and re-stamping the tip migration's `snapshot:` line.
`hejbro verify` passed (5 checks, `sha256:c66130229663…`) and `hejbro
generate` reported "no changes — snapshot already matches your
declarations", leaving the pre-canonical file on disk untouched.

**OK-D3 — A member change is still a change.** Removing a role, removing
an event, removing a column from an `update of` list and renaming an index
in one run produced the same notes as before:
`~ table app.tasks [index "tasks_renamed_idx" added, index "tasks_alpha_idx" dropped]`,
`~ trigger … [trigger changed; recreating]`,
`~ policy … [policy changed; recreating]`, with the recreated SQL rendered
in canonical order (`after insert or update of "title" or delete`,
`to "r_bravo", "r_charlie"`).

### `cli-commands`

**OK-C1 — A reorder-only difference writes nothing and verifies.** See
OK-F1: `generate` printed the no-change line, wrote no migration, left the
snapshot byte-identical; `verify` passed with exit code 0.

**OK-C2 — A hand-reordered snapshot is still a tip mismatch.**
Reordering the snapshot's own `roles` array by hand:

```
error[chain-tip-mismatch]: migrations/0001_add_app.sql
  the migration chain's tip hash doesn't match the current snapshot — …
verify: 1 of 5 checks failed …            (exit 1)
```

A hand-edited *value* (`r_alpha` → `r_zulu`) is caught by two checks,
`snapshot-stale` and `chain-tip-mismatch`.

**OK-C3 — The next real change writes the canonical order.** From the
pre-canonical state of OK-D2, adding one column produced a migration
carrying exactly `alter table "app"."tasks" add column "note" text;` and
nothing else, and rewrote the snapshot with every set array canonical
(roles `["r_alpha","r_bravo","r_charlie"]`, events insert/update/delete
with `["status","title"]`, indexes and checks sorted); `verify` passed.

`hejbro check --url …` against a live database reported "no differences"
both before and after every set array was reordered in the declarations.

### `schema-vendoring`

**OK-V1 — Integer-like column names keep their physical position.**
Hand-written list metadata for a table recording
`id, 0, label, 2, 10, __proto__, constructor, Upper, needs quote` in that
physical order, rendered through `createNameKeyedDb`:

```
select "id", "0", "label", "2", "10", "__proto__", "constructor", "Upper", "needs quote" from "vend"."weird"
```

— not with the integer-like names first.

**OK-V2 — Every column-name class keeps its position.** Same run: the
integer-like, `__proto__`, `constructor`, upper-case and needs-quoting
names all hold their declared position, in the metadata and in the
rendered statement. A one-column table renders `select "solo" …`.
(`pull` itself cannot produce these names — it omits every column whose
SQL name no declaration key would produce back, naming each one; the
scenario's own premise, "hand-edited, or written by a toolchain whose
naming rules differ", matches that exactly. `constructor` is snake-case
enough to survive `pull` and was carried faithfully.)

**OK-V3 — A contract with the object-keyed map still builds.** The same
table expressed as the legacy object-keyed column map built a working
client and rendered `select "0", "2", "10", "id", "label", "__proto__",
"constructor", "Upper", "needs quote" …` — the order that map yields,
integer-like keys first, exactly as the scenario says.

Emitted-side checks: `hejbro pull` writes `columns: [ { key, sqlName,
typeNode, mode, notNullElements }, … ]` as a list in catalog order, and
the emitted `Row`/`Insert`/`Update` interfaces follow the same order,
including across `attnum` gaps left by a dropped column (`a, b, c, d`).

*(See B1 for the half of this requirement that does not hold.)*

### `plpgsql-function-bodies` (ADDED)

**OK-P1 — A projected returning under setof is refused.** Six variants —
one column, every column, every column reordered, an aliased column, an
`update … .returning({…})`, a `deleteFrom … .returning({…})` — each fail
with

```
error[return-expects-whole-row]: app.tasks
  ctx.return() in app.f_x received an insert whose rows are not the whole row of
  "app"."tasks" — … Next: return select(tasks), or an insert/update/delete on
  tasks ending in a bare .returning(); to return a different shape, declare
  "returns" as that shape instead.
```

and no declaration is produced (no migration written). The `Next:` clause
names both working forms, as the requirement demands.

**OK-P2 — A projected select under setof is refused.**
`select({ id, title, rank }, tasks)` (every column), `select({ id }, tasks)`,
and `select({ rank, title, id }, tasks)` (every column reordered) all fail
with the same error; so do `select(other)` and `insert(other)…returning()` /
`update(other)…returning()` — a query whose row source is another table.

**OK-P3 — The whole-row forms are accepted and render in physical order.**
`select(tasks)`, `select(tasks).where(…)`, `.orderBy().limit().offset()`,
`.distinct()`, `.innerJoin(other, …)`, `.leftJoin(…)`, and bare-returning
insert/update/delete on the table all compile and render the table's
columns in physical order:

```sql
return query select "id", "title", "rank" from "app"."tasks";
return query insert into "app"."tasks" ("title", "rank") values ('x', 1) returning "id", "title", "rank";
return query delete from "app"."tasks" where "app"."tasks"."rank" > 0 returning "id", "title", "rank";
```

"Physical" is the snapshot's order, not the literal's: a table declared
`{ id, title }` then given `rank` **in the middle of the TypeScript
literal** re-rendered both function bodies as `"id", "title", "rank"` in
the same migration that added the column, and the migration applied and
both functions returned correct rows on Postgres 17.

**OK-P4 — The returning-stage refusal comes first.** A mutation that never
called `.returning()`, with the type bypassed, fails with
`return-expects-returning` ("received an insert that never called
.returning() …"), never with the whole-row error.

**Type narrowing.** A real `tsc --noEmit` (5.9.3, `strict`) on eight cases:
`select(tasks)` and a bare-returning insert compile; a projected
`.returning({id})`, a projected `.returning({id,title,rank})`, a projected
`select({id}, tasks)` and a mutation with no `.returning()` are all
`TS2345`. The narrowing is visible in the exported type —
`ReturnableQuery = SelectLimited<Table> | InsertFinal<Table, undefined,
"final"> | …`, the `undefined` slot being the projection. Consistent with
the requirement, which claims type-level narrowing for the projected
returning specifically and declaration-time refusal for the other-table
case: `select(other)` and `insert(other)…returning()` type-check and are
caught at declaration time.

**Requirement rationale, substantiated on Postgres 17.** Hand-written
SQL confirms each claim the requirement makes about why this matters:

```sql
create function z.p() returns setof z.tasks as $$ begin return query select id from z.tasks; end; $$ ...
-- CREATE accepted; first call: ERROR: structure of query does not match function result type
--                              DETAIL: Number of returned columns (1) does not match expected column count (3)
create function z.q() ... return query select rank, title, id from z.tasks; ...
-- CREATE accepted; call returns id=10, title=t, rank=1 — silently wrong (values swapped)
create function z.r() ... return query select id, title, rank from z.other; ...
-- CREATE accepted; call returns the OTHER table's rows — silently wrong
```

### `plpgsql-function-bodies` (MODIFIED)

**OK-M1 — A returning mutation is returned as before.** An insert, update
or delete on the declared table ending in a bare `.returning()` compiles
and renders `return query <sql>;` carrying that statement's own whole-row
`RETURNING` list (see OK-P3).

**OK-M2 — An executed mutation is unaffected.**
`ctx.execute(insert(tasks).values({…}))` renders
`insert into "app"."tasks" ("title", "rank") values ('x', 1);` in body
order alongside a `return query`; `ctx.execute` on a mutation that *did*
call `.returning()` is still refused with `execute-expects-no-returning`.

The fixed refusal order the requirement restates also holds: a scalar body
handed a mutation fails with `scalar-return-expects-expression` (and so
does one handed a whole-row select), a trigger body with
`trigger-return-expects-row` — neither reaches
`return-expects-returning` or the whole-row error.

### Public surface (`skills/hejbro`)

`references/function-builder-pitfalls.md` states the whole-row rule, names
`return-expects-whole-row`, and covers the complete-but-reordered
projection case; `references/polyrepo.md` states that the client metadata
carries columns as a physical-order list rather than an object whose key
enumeration order JavaScript decides. Both match what ships. Neither
repeats B1's owning-client claim.

---

## Cleanup

`d106-so-pg` removed; `/private/tmp/d106-so/` removed. No file in the
repository was modified other than this one, and nothing was committed.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; rulings in `.blackbox/701/`, `740/`, `749/`).

- **B1** — repaired in the delta (tasks.md 2.1): the requirement no longer says the owning repository's own client sends the physical order. Measured, that client is built from declarations and sends the declaration's literal order; the two agree by name, never by position, and the normative SHALLs (physical order in the metadata, the name-keyed client built from it, the `Row` interface) hold as shipped. The false clause was rationale, not a contract the product ever implemented, so the repair is the sentence, not the product.
- **N2** — repaired here: `unsupported-return-value` names the accepted forms (a select over the declared table under `returns setof`, a mutation with `.returning()`, `new`/`old` in a trigger). The set-operation stage not being a `ReturnableQuery` stays pre-existing and out of scope.
- **N3** — wording repaired: the tip hash covers the snapshot file's canonical serialization (every value and order, not its formatting); the scenario says so.
- **N1** — an empty `update of` column list emits SQL Postgres cannot parse → folded into #856 (the same validation site as duplicated events).

Archived at this disposition.

