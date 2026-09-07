# D106 evaluation — harden-adoption (round 1)

Context-free adversarial spec-only review of the two deltas
`openspec/changes/harden-adoption/specs/table-declaration/spec.md`
(MODIFIED *An existing table is declared for its shape, never for its
DDL*, 7 scenarios) and
`openspec/changes/harden-adoption/specs/cli-commands/spec.md` (ADDED
*generate names what an adoption will create*, 3 scenarios) against the
built public surface at dev `becacf03` (worktree
`hejbro-worktrees/d106-harden-adoption`, `packages/cli/dist/cli.js`,
hejbro v0.2.0-pre.1). Read: the two deltas, the base requirement they
replace in `openspec/specs/table-declaration/spec.md`,
`skills/hejbro/SKILL.md`, `skills/hejbro/references/{brownfield-adoption,
dsl-cheatsheet,generate-verify-workflow}.md`, the `README.md` lines
matching adoption terms (none beyond a task-time badge), the CLI's
`--help` output, the built `.d.ts` typings, and the archived
`add-vendored-related/evaluation.md` for shape only. Nothing under
`proposal.md`/`design.md`/`tasks.md`, `.blackbox/`, `packages/*/src`,
`packages/*/test`, `examples/*/test`, PR or issue bodies, git log
messages, `CHANGELOG` or `.changeset/` was read. No tool result showed
forbidden material.

## Method

Thirteen real projects under `/private/tmp/d106-ha/` (left in place as
the corpus), each scaffolded by `hejbro init` with the built packages
symlinked into `node_modules` (`mk.sh`), each driven only through the CLI
(`run.sh` saves every command's stdout, stderr and exit code under
`<project>/runs/<label>.{out,err,exit}`), against a real
`postgres:17-alpine` (container `d106-ha-pg`, host port 55740,
`log_statement=all`, one database per project, removed afterwards).
Every claim below names the project and run label that produced it.
Catalog facts come from `psql` after `hejbro migrate`, never from
hejbro's own reading; SQL facts come from the written migration file's
bytes.

The input table, one project per row group:

- `p1-widgets` — the delta's own scenario: `app.widgets(id integer not
  null, name text not null, tenant text)` pre-created without a
  sequence, baselined `app` schema, `existingTable` → `table()` with
  `serial().notNull()`, `index().on(name)`, `rls.enabled` + one policy.
- `p2-children` — every child kind at once on three adopted tables in
  one run: a PK the existing declaration already listed (`posts`) and
  one it did not (`tags`), column-level `.references()` present on the
  existing declaration (`posts.authorId`), a column-level FK onto an
  `existingTable("ext","accounts")`, an extras FK with an explicit name
  (`post_tags_post_fk`), a column-level FK with `onDelete`, a check, an
  expression index, a partial index, a composite unique index, a
  column-level `.unique()`, a `defineTrigger` on the adopted table, and a
  brand-new `comments` table beside them whose FK targets the adopted
  `posts`. Declaration order `tags, posts, post_tags`.
- `p3a-seq-roundtrip` — managed serial-only `app.items` → handover →
  the left-behind sequence altered by hand to `smallint`, `owned by
  none`, advanced to 2 → re-adopted.
- `p3b-children-roundtrip` — managed `app.orders` with serial PK, index
  and check → handover → re-adopted; then the printed `Next:` first
  branch (`hejbro baseline`) followed literally, then `hejbro migrate`.
- `p4-missing-column` — adoption adding a column the database lacks
  (`slug`) with an index and a check on it, plus a child on a column
  the database has but the existing declaration never listed (`extra`);
  `check --url` before `migrate`; the `Next:` second branch followed by
  hand to the end.
- `p5-silent-new-collision` — an adoption with nothing to create (only
  a column changed), one whose PK both sides list and nothing else, an
  RLS-only adoption (`rls.enabled({})`), a brand-new serial table whose
  sequence name already exists in the database, then every table handed
  over in one run (sequence, PK, RLS all present), then every existing
  declaration removed.
- `p6-spelling` — reserved words as table and column names (`user`,
  `order`, `select`), the same table name `items` in schemas `a` and `b`
  adopted in one run with different children; mixed-case names were
  also tried and are refused by the DSL before any adoption
  (`invalid-sql-name`, so that spelling class is unreachable).
- `p7-old-snapshot` — the `"existing": true` marker stripped from a
  written snapshot, then read against an `existingTable()` and against
  a `table()`.
- `p8-validators` — a probe preset validator in `hejbro.config.ts`
  listing every table declaration it receives, beside `supabasePreset`
  with `existingTable("auth","users")` and then a managed table in
  `auth`.
- `p9-schema-warnings` — adoption of a table in a schema the snapshot
  never recorded (`ext`) and in `public`; an adopted table and a
  managed table each gaining a `text().notNull()` column without a
  default in the same run (warning order and suppression).
- `p10-seq-cells` — re-adoption as `bigserial` over the `integer`
  sequence a handover left; re-adoption after that sequence was dropped
  with `cascade` (taking the column default with it).
- `p11-rename-in-adoption` — a column drop+add (`name` → `title`) in
  the same edit as an adoption, then `--rename`; a table rename shape
  (existing `docs` removed, managed `documents` appearing).
- `p12-existing-change-policy-handover` — an existing declaration whose
  column list changes; a managed table with RLS, a policy, a serial PK
  handed over.

Rows: 109 recorded CLI invocations (`runs/*.exit` across the 13
projects; the 13 `hejbro init` calls are not counted) and the `psql`
catalog reads quoted below, across 13 databases.

## Blocking findings

### B1 — A primary key the existing declaration already listed is named by `adoption-creates` but never created

**Delta sentences contradicted.** table-declaration, paragraph 2: "on
adoption … the table's own declared children — its indexes, its checks,
its foreign keys and its primary key — are created"; scenario *An
adopted table gains what the declaration manages*: "every index, check,
foreign key and primary key the declaration carries is created".
cli-commands requirement: "naming the objects the migration will create
for it — sequences, row-level security, policies, indexes, checks,
foreign keys, primary key".

**Input** (`p2-children`): database `app.posts(id integer not null,
author_id uuid, slug text, score integer, account_id uuid)` with **no**
primary key; v1 `existingTable("app","posts",{ id:
integer().primaryKey(), authorId: uuid().references(() => users.id),
… })`; v2 the same identity as `table(app,"posts",{ id:
serial().primaryKey(), … }, …)` with two indexes, a check and two FKs.
Run `v2-generate`.

**Observed.** stderr names `primary key "posts_pkey"` as the seventh
object under `warning[adoption-creates]: app.posts`. The migration
`20260907133939_add_comments_id_seq.sql` carries, for `posts`, the
sequence triple, `create index "posts_score_idx"`, `create index
"posts_slug_lower_idx"`, `add constraint "posts_score_nonneg" check`,
`add constraint "posts_account_id_fk"`, `add constraint
"posts_author_id_fk"` — and no `primary key` statement; its banner line
reads `~ table app.posts [index …, index …, foreign key …, foreign key
…, check …]`. `hejbro migrate` (`v2-migrate2`, after the `ext.accounts`
target got its PK) fails with `42830: there is no unique constraint
matching given keys for referenced table "posts"` on the new
`comments.post_id` FK, because the migration never created
`posts_pkey`; after adding the PK by hand (`v2-migrate3`) the file
applies. `hejbro check` (`v2-check`) reports `check-object-missing:
app.posts.posts_pkey` and a further `generate` (`v3-generate`) says `no
changes` — no later run will ever create it.

**Same root, second input** (`p3b-children-roundtrip`, `v2-readopt`):
`existingTable(… id: serial().primaryKey() …)` re-adopted; stderr names
`primary key "orders_pkey"`, the migration carries sequence, index and
check only, banner `[index "orders_total_idx" added, check
"orders_total_nonneg" added]`.

**Control cells.** When the existing declaration did **not** list the
PK, the PK is created and named: `p2-children` `tags` (`alter table
"app"."tags" add constraint "tags_pkey" primary key ("id")`),
`p4-missing-column` `things_pkey`, `p6-spelling` `user_pkey`,
`p9-schema-warnings` `things_pkey`. When the PK is on both sides and
the table has nothing else to create (`p5-silent-new-collision`
`plainpk`), the table is adopted silently — no PK line, no statement.
So the PK line in the notice is derived from the managed declaration
whenever the table has any other object to create, while the migration
emits the PK only when the existing side's snapshot lacked it. The FK
cell behaves differently: `posts.authorId.references()` present on the
existing declaration was still created (`posts_author_id_fk`) and
named.

**Expected.** Either the migration creates the PK on adoption
regardless of what the existing declaration listed (the delta's "every
… primary key the declaration carries is created"), or the notice
omits a PK the migration does not create ("naming the objects the
migration will create"). As shipped the notice names it and the
migration skips it, and `check` then reports a drift no `generate` can
repair.

### B2 — The `Next:` branch and the scenario's `hejbro baseline` cannot run after any adoption

**Delta sentences contradicted.** table-declaration scenario *An adopted
table gains what the declaration manages*: "a declaration with more
(indexes, checks, foreign keys, a primary key) is named by
`adoption-creates` on re-adoption, and `hejbro baseline` records what
the database already holds". cli-commands requirement: "ending with a
`Next:` line naming `hejbro baseline` for a database that already holds
these objects".

**Input** (`p3b-children-roundtrip`): managed `app.orders` (serial PK,
`orders_total_idx`, `orders_total_nonneg`) applied (`v0-migrate`),
handed over (`v1-handover`: `carries no statements`, `v1-migrate`
applied, catalog still holds `orders_pkey`, `orders_total_nonneg`,
`orders_total_idx`, `orders_id_seq`), re-adopted (`v2-readopt`: the
notice names all four and ends with `Next: if the database already
holds these, run "hejbro baseline" to record them instead of applying
this migration; …`). The database does hold them, so the first branch
is the one to follow.

**Observed.** `hejbro baseline` (`v2-next-baseline`) exits 1:

```
error[baseline-not-first]: migrations
  baseline only runs on a project with no migrations yet — found 3
  migration(s) in "migrations" and a snapshot that already records
  declared objects. Next: a baseline is the FIRST migration of a
  database hejbro is adopting. To record a change to an already-adopted
  project, run "hejbro generate" instead.
```

It records nothing. `hejbro migrate` on the written file (`v2-migrate`)
then fails with `42P07: relation "orders_total_idx" already exists`,
the whole file rolls back (catalog unchanged, `v2-status`: pending),
and `hejbro check` (`v2-check`) reports `no differences` because the
database already has everything — so the project is left with a
migration that can never apply and no command that records the state.

**Why it is universal.** An adoption needs a previous snapshot that
recorded the table as existing, which only a previous `generate` (or
`baseline`) writes, and each of those writes a migration; so at the
moment `adoption-creates` prints, `migrations/` is never empty and
`baseline` always refuses. The skill's own text says both things at
once: `brownfield-adoption.md` "the way through is `hejbro baseline`
instead of `hejbro generate` — it records what the database already
holds rather than trying to create it again", two paragraphs after
"`hejbro baseline` refuses to run a second time
(`error[baseline-not-first]`) — a baseline is by definition the first
migration of an adopted database" and "`hejbro baseline` is the same
command `error[baseline-not-first]` (above) refuses to run a second
time".

**Expected.** A `Next:` that can be followed on the database it
describes — a command that records already-held objects mid-chain, or
a `Next:` that names what actually works (e.g. hand over again, or
drop the held objects), and the scenario sentence changed to match.

## Non-blocking findings

- **N1 — A `serial` column's `nextval` default is never attached or
  re-attached on adoption** (suggested: fix). `p1-widgets` `v2-migrate2`:
  the sequence is created, typed and owned (`pg_get_serial_sequence`
  returns `app.widgets_id_seq`) but `information_schema.columns` shows
  `column_default` empty for `widgets.id`; `check` (`v2-check2`) reports
  `declared column "app.widgets.id" has a default
  ("nextval('app.widgets_id_seq')"), but the database has none`, and
  the snapshot already records the column as serial, so no later
  `generate` emits the default. `p10-seq-cells` cell (b): a handover's
  sequence dropped with `cascade`, re-adopted — `create sequence if not
  exists` recreates it, the column keeps no default, `insert into app.b
  (name) values ('x')` fails with `null value in column "id"`. The
  delta's "reused and normalized rather than refused" holds for the
  sequence object; the column that made it a `serial` is left
  half-adopted. Same for `p2-children` `posts.id`/`tags.id`.
- **N2 — A column-level `.unique()` on an adopted table is neither
  created nor named** (suggested: fix or spell out in the delta's
  list). `p2-children` `tags.label: text().notNull().unique()`: banner
  `column "label" changed`, no `add constraint "tags_label_key" unique`
  in the file, no line under `adoption-creates`; `check` (`v2-check3`)
  reports `check-object-missing: app.tags.tags_label_key` and
  `app.tags.label is not null, but the database allows null`; a further
  `generate` has `no changes`. The delta lists indexes, checks, foreign
  keys and the primary key; a unique constraint is none of these in
  hejbro's vocabulary and falls through.
- **N3 — The migration banner reports column DDL an adoption never
  emits** (suggested: fix the banner, or document). `p4-missing-column`
  `v2-generate` banner: `~ table app.things [column "extra" added,
  column "slug" added, column "id" changed, …]` over a body with no
  `add column`/`alter column`; `p9-schema-warnings`: `column "label"
  added` for `app.widgets`, no statement; `p11-rename-in-adoption`
  `vA-generate`: `column "title" added, column "name" dropped`, no
  statement. The skill (`generate-verify-workflow.md`) says the banner
  "lists every object added/changed/dropped"; here it lists what the
  snapshot moved, not what the SQL does.
- **N4 — The notice's first sentence overstates the apply failure**
  (suggested: fix text). Every block opens with `adoption creates
  objects for a table hejbro did not create; apply fails if the
  database already holds any of them`. Measured: a held sequence
  applies cleanly (`p3a-seq-roundtrip` `v2-migrate`, `create sequence
  if not exists` + two `alter`s), a held RLS enablement is idempotent
  (`alter table … enable row level security`), a policy is emitted as
  `drop policy if exists` + `create policy` (`p1-widgets` migration
  bytes). Only an index, a check, a foreign key or a primary key fails
  (`p3b` `42P07` on the index). The delta does not contain this
  sentence; the shipped text does.
- **N5 — Adopting a table in a schema the snapshot never recorded emits
  `create schema`, which the notice does not name and which fails first
  on the real database** (suggested: name it, or document that the
  schema must be baselined). `p9-schema-warnings` `v2-generate`: `create
  schema "ext";` and `create schema "public";` open the file; the three
  `adoption-creates` blocks list indexes and a PK only; `v2-migrate`
  fails `42P06: schema "ext" already exists` before any adoption
  statement runs. `create schema "public"` is the same behaviour for a
  schema every database has.
- **N6 — A column drop+add in the same edit as an adoption is not
  refused as an ambiguous rename** (suggested: by design, document).
  `p11-rename-in-adoption` `vA-generate`: `existingTable {id, name}` →
  `table {id, title}` + `index().on(title)` exits 0, banner `column
  "title" added, column "name" dropped`, body `create index
  "docs_title_idx" on "app"."docs" ("title")` alone; `--rename
  app.docs.name=title` (`vA2-generate`) is refused
  `unknown-rename-target: table "app.docs" has no dropped column named
  "name"`; `migrate` fails `42703: column "title" does not exist`;
  `check` lists `app.docs.name` as unmanaged inventory and
  `app.docs.title` as missing. A managed-to-managed edit of the same
  shape is `ambiguous-column-rename`, exit 1. The skill documents the
  table-rename refusal (#703) for the handover direction only; the
  reverse shape (`vB-generate`: existing `docs` removed, managed
  `documents` appearing) is a plain `create table "app"."documents"`
  with no refusal either.
- **N7 — The notice carries no `at <file>:<line>` location, unlike
  every other warning** (suggested: by design or fix). `p1-widgets`
  `v2-generate.err`: the `adoption-creates` block ends at its `Next:`
  line and a blank line; the `rls-unreachable-schema` block that follows
  ends with `at /private/tmp/d106-ha/p1-widgets/src/app.schema.ts:20:7`
  — an absolute path, which `generate-verify-workflow.md` says no
  diagnostic prints ("none ever print an absolute path"); that path is
  the neighbour warning's, not this delta's.
- **N8 — The scenario text writes `existingTable("widgets")`**, a
  one-argument form the DSL does not have
  (`existingTable(schemaName, tableName, columns)` in the built
  typings) (suggested: docs nit in the delta).
- **N9 — Block order is by `schema.table` identity, not declaration
  order** (observation, by design). `p2-children` declared `tags,
  posts, post_tags` and printed `post_tags, posts, tags`; `p6-spelling`
  printed `a.items, a.user, b.items`. `adoption-creates` blocks precede
  every other warning in the run (`p9-schema-warnings`: three blocks,
  then `not-null-without-default` for the managed `app.settings`); the
  stdout summary counts them (`4 warning(s) — see below`).
- **N10 — `not-null-without-default` is suppressed for the adopted
  table and the column is not added either** (observation, matches the
  skill). `p9-schema-warnings`: `widgets.label text().notNull()` raises
  nothing, `settings.owner` in the same run raises it; only
  `settings` gets `add column "owner" text not null`.

## Scenarios verified

Evidence under `/private/tmp/d106-ha/<project>/runs/` and the
migration files named.

1. **An existing declaration produces no statement** — `p1-widgets`
   `v1-generate`: `record_widgets.sql` carries no statements, snapshot
   has `"existing": true` with the three declared columns;
   `p12-existing-change-policy-handover` `v1-generate`: the existing
   declaration gained a column → `reshape_legacy.sql`, 0 statements;
   `p5-silent-new-collision` `v4-remove`: all existing declarations
   removed → `forget_gadgets.sql`, 0 statements; every such run's stderr
   is 0 bytes.
2. **A managed table may reference an existing one** — `p2-children`:
   `posts.accountId.references(() => accounts.id)` onto
   `existingTable("ext","accounts")` emits `add constraint
   "posts_account_id_fk" … references "ext"."accounts" ("id")` and no
   statement names `ext.accounts`; `check` prints `check does not
   compare ext.accounts: declared existing and not compared`.
3. **A table handed to the platform loses nothing** —
   `p12-existing-change-policy-handover` `v1-generate`: managed `notes`
   with RLS, policy `notes_read`, serial PK → `existingTable`, 0
   statements; after `v1-migrate` the catalog still has
   `relrowsecurity = t`, `notes_read`, `notes_id_seq`, `notes_pkey`.
   `p3b` and `p5 v3` (index, check, PK, RLS-only, brand-new serial
   table) likewise 0 statements and nothing dropped.
4. **An adopted table gains what the declaration manages** —
   `p1-widgets` `v2-generate`: no `create table`; `create sequence if
   not exists "app"."widgets_id_seq"; alter sequence … as integer; alter
   sequence … owned by "app"."widgets"."id"; create index
   "widgets_name_idx" …; alter table … enable row level security; drop
   policy if exists …; create policy …` (bytes of
   `20260907133559_add_widgets_id_seq.sql`); catalog after
   `v2-migrate2`: sequence `integer` owned by `widgets.id`,
   `relrowsecurity = t`, policy `widgets_tenant_read` for `app_reader`,
   `widgets_name_idx`. Children: `p2-children` created two indexes
   (expression and partial), a check, three FKs (column-level, explicit
   name, `on delete cascade`), a composite unique index, and the PK
   where the existing side lacked it (`tags_pkey`, also `p4`, `p6`,
   `p9`). **PK where the existing side listed it: not created — B1.**
   Sequence round trip: `p3a-seq-roundtrip` — handover, sequence
   mutated to `smallint`, `owned by none`, `last_value 2`; re-adoption
   applies cleanly (`v2-migrate` exit 0), catalog `integer`, owned by
   `items.id`, `last_value` still 2, `check: no differences`.
   `p10-seq-cells` (a): `bigserial` over the integer sequence → `alter
   sequence … as bigint` applies, `pg_sequences.data_type = bigint`
   while the column stays `integer` (`check` reports the column type
   drift, as it should). Re-adoption with more: `p3b` names sequence,
   index, check and PK; **`hejbro baseline` refuses — B2**. Missing
   column: `p4-missing-column` — `check --url` before `migrate` names
   `check-object-missing: app.things.slug` first; `migrate` fails
   `42703: column "slug" does not exist`, file rolled back (catalog
   unchanged); the `Next:` second branch done by hand (restore both
   files, adopt with `{id, extra}` → `v3-migrate` applied, then add
   `slug` + index + check → `v4-migrate` applied, `check: no
   differences`, `verify: 5 checks passed (4 migrations)`); a child on
   a column the database has but the existing declaration never listed
   (`extra`) applies.
5. **A reserved-schema validator exempts an existing table** —
   `p8-validators` `vA-generate`: `existingTable("auth","users")` under
   `supabasePreset` raises nothing, migration written; `vB-generate`: a
   managed `table(auth,"audit")` beside it is refused
   `error[reserved-schema]: auth` (twice: the `schema("auth")` and the
   table), exit 1, no file written.
6. **An existing declaration reaches the validators** —
   `p8-validators` `vA-generate`: the probe validator printed
   `validator saw table declaration {"table":"users","existing":true}`
   beside `{"table":"notes","existing":false}`.
7. **An older snapshot's tables are all managed** — `p7-old-snapshot`:
   marker stripped; the same `existingTable()` read against it is a
   handover (`release_legacy.sql`, 0 statements, no `adoption-creates`);
   a `table()` with an index read against it is an ordinary managed
   diff (`create index "legacy_name_idx"`, no `adoption-creates`).
8. **Adoption names what it creates** — `p1-widgets` `v2-generate`,
   exit 0, stdout `wrote migrations/…`, `2 warning(s) — see below`;
   stderr block `warning[adoption-creates]: app.widgets` with lines
   `sequence "app.widgets_id_seq"`, `row-level security`, `policy
   "widgets_tenant_read"`, `index "widgets_name_idx"`, the sentence
   `apply also fails if the database lacks a column one of these objects
   needs — "hejbro check --url <url>" names such a column before you
   migrate`, and `Next: if the database already holds these, run "hejbro
   baseline" …; if it lacks a column, discard the migration and snapshot
   this run just wrote, adopt with the columns the database has, then
   add the column and its objects in a following edit.` The file is
   written. One block per adopted table: three in `p2-children`, three
   in `p6-spelling` (`a.items`, `a.user`, `b.items` — same table name
   in two schemas kept apart; reserved words `user`, `order`, `select`
   quoted in the SQL and applied, `check: no differences`).
9. **A handover is silent** — `p3a v1-handover`, `p3b v1-handover`,
   `p5 v3-handover`, `p12 v1-generate`: stderr 0 bytes, stdout `carries
   no statements`.
10. **An adoption with nothing to create is silent** —
    `p5-silent-new-collision` `v2-generate`: `app.plain` (a column's
    nullability changed only) and `app.plainpk` (PK on both sides,
    nothing else) print nothing under `adoption-creates`; the one block
    in that run is `app.rlsonly` with the single line `row-level
    security`; the brand-new `app.gadgets` prints nothing and keeps the
    plain `create sequence "app"."gadgets_id_seq" as integer;`, which
    fails at apply against the pre-created sequence (`42P07: relation
    "gadgets_id_seq" already exists`) and applies once it is dropped.

Also verified: `verify` passes after every adoption and handover run
(`p1`, `p3a`, `p4`, `p5`, `p6`, `p2`); `status` reports the failed
adoption file as pending and the ledger untouched (`p3b`, `p4`, `p9`);
`check` lists what adoption left alone as inventory rather than a
finding (`p11`: `unmanaged column (not covered by any declaration):
app.docs.name`).

## Verdict

**BLOCKED** — two blocking findings (B1: a primary key the existing
declaration already listed is named by `adoption-creates` but the
migration never creates it, leaving a drift `check` reports and no
`generate` repairs; B2: the `Next:` first branch and the scenario's
"`hejbro baseline` records what the database already holds" cannot run
after any adoption — `baseline-not-first` on the delta's own
re-adoption input), ten non-blocking findings (N1–N10). Every other
delta sentence held on real inputs: sequences created idempotently and
normalized, RLS, policies, indexes, checks and foreign keys created,
handovers and nothing-to-create adoptions silent with zero statements,
missing columns named by `check` and failing at apply, validators and
the older-snapshot reading as specified.
