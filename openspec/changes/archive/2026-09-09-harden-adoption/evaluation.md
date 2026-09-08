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

## Round 2 (after the round-1 corrections)

Context-free re-review of the corrected deltas
`openspec/changes/harden-adoption/specs/table-declaration/spec.md`
(MODIFIED *An existing table is declared for its shape, never for its
DDL*, 7 scenarios) and
`openspec/changes/harden-adoption/specs/cli-commands/spec.md` (ADDED
*generate names what an adoption will create*, 3 scenarios) against the
built public surface at dev `26b623e4` (worktree
`hejbro-worktrees/d106-harden-adoption-r2`, `packages/cli/dist/cli.js`,
hejbro v0.2.0-pre.1), which carries the change (#1019) and its round-1
corrections (#1043). Read: the two deltas, the base requirement they
replace in `openspec/specs/table-declaration/spec.md`, the round-1 text
above (Method, B1, B2, N1 to N10, the scenario list), `skills/hejbro/
SKILL.md`, `skills/hejbro/references/{brownfield-adoption,dsl-cheatsheet,
generate-verify-workflow}.md`, the `README.md` lines matching adoption
terms (still none beyond a task-time badge), the CLI's `--help` output
for every command, the built typings as `tsc` reports them from a
scratch project, and the archived `add-vendored-related/evaluation.md`
for shape only. Nothing under `proposal.md`/`design.md`/`tasks.md`,
`.blackbox/`, `packages/*/src`, `packages/*/test`, `examples/*/test`,
PR or issue bodies, git log messages, `CHANGELOG` or `.changeset/` was
read; no tool result showed forbidden material. The round-1 corpus under
`/private/tmp/d106-ha/` was read for its inputs only (schema files, run
outputs). This file was byte-identical to `HEAD` (`git diff --stat`
empty) before this section was appended.

Against round 1 the delta changed in three places, all in the sentences
B1 and B2 quoted: the requirement's second paragraph now lists "the
table's own declared children — its indexes, its checks, its foreign
keys and its primary key" as created on adoption; the scenario *An
adopted table gains what the declaration manages* now ends with "the
two ways through are handing the table back — restoring the migration,
the snapshot and the declaration this run changed — or dropping the
indexes, checks, foreign keys and primary key the database holds, never
the sequence, before applying" in place of "`hejbro baseline` records
what the database already holds"; and the ADDED requirement's `Next:`
sentence names the same two ways in place of `hejbro baseline`, with
the scenario example now written `existingTable("app", "widgets", …)`.

### Method

Sixteen real projects under `/private/tmp/d106-ha-r2/` (left in place as
the round-2 corpus, beside the round-1 one), each scaffolded by `hejbro
init` with the built packages symlinked into `node_modules` (`mk.sh`),
each a git repository with a tag per accepted state (`commit.sh`) so
the `Next:` line's "restore" wording could be followed with `git
checkout <tag> -- <file>` and `rm` of the just-written migration, each
driven only through the CLI (`run.sh` saves every command's stdout,
stderr and exit code under `<project>/runs/<label>.{out,err,exit}`) and
`psql` (`sql.sh`, every statement's result under
`runs/<label>.sql.out`), against a real `postgres:17-alpine` (container
`d106-ha-r2-pg`, host port 55790, `log_statement=all`, one database per
project, removed afterwards). Each project's declaration versions are
kept under `versions/` and its driver script is `/private/tmp/d106-ha-r2/
p<N>.sh`. Catalog facts come from `psql` after `hejbro migrate`, never
from hejbro's own reading; SQL facts come from the written migration
file's bytes.

The input table, one project per row group. Rows 1 to 12 re-run every
round-1 input by name on the corrected build; 13 to 15 and the typing
probe are new:

- `p1-widgets` — the delta's own scenario replayed: `app.widgets(id
  integer not null, name text not null, tenant text)` pre-created with
  no sequence, `settings` baselined, `existingTable("app","widgets",…)`
  → `table()` with `serial().notNull()`, `index().on(name)`,
  `rls.enabled` + one policy; a neighbouring `rls-unreachable-schema`
  warning for block order.
- `p2-children` — round 1's B1 input: three adopted tables in one run
  (`tags`, `posts`, `post_tags`), a PK the existing declaration already
  listed (`posts.id: integer().primaryKey()`) and one it did not
  (`tags`), column-level `.references()` on the existing declaration
  (`posts.authorId`), an FK onto `existingTable("ext","accounts")`, an
  extras FK with an explicit name, a column FK with `onDelete`, a
  check, an expression index, a partial index, a composite unique
  index, a column `.unique()`, a `defineTrigger` on the adopted table,
  and a brand-new `comments` whose FK targets the adopted `posts.id`.
  `ext.accounts` was pre-created with its PK this time so the run
  isolates B1 (round 1 had to add it by hand between two migrates).
- `p3a-seq-roundtrip` — managed serial-only `app.items` → handover →
  the left-behind sequence altered to `smallint`, `owned by none`,
  advanced to 2 → re-adopted.
- `p3b-children-roundtrip` — round 1's B2 input: managed `app.orders`
  (serial PK, `orders_total_idx`, `orders_total_nonneg`) with two rows
  → handover → re-adopted; then the printed `Next:` followed literally
  to the end on both branches: hand the table back (restore snapshot
  and declaration to the handover tag, delete the new migration), and
  drop the held index, check and PK (never the sequence) then
  `migrate`; plus the skill's stated shape of restoring only two of the
  three files.
- `p4-missing-column` — adoption adding a column the database lacks
  (`slug`) with an index and a check on it, plus a child on a column
  the database has but the existing declaration never listed
  (`extra`); `check` before `migrate`; the `Next:` missing-column
  branch followed to the end.
- `p5-silent-new-collision` — an adoption with nothing to create (a
  column's nullability changed only), one whose PK both sides list and
  nothing else (`plainpk`, the database holds `plainpk_pkey`), an
  RLS-only adoption, a brand-new serial table whose sequence name
  already exists, then every table handed over in one run, then every
  existing declaration removed.
- `p6-spelling` — reserved words as table and column names (`a.user`
  with `order`/`select` columns, `b.order` with a `user` column), the
  same table name `items` adopted in schemas `a` and `b` in one run
  with different children, a table in `public` (schema declared at
  baseline this time).
- `p7-old-snapshot` — the `"existing": true` marker stripped from a
  written snapshot (three occurrences → 0), read against the same
  `existingTable()` declarations and against `table()` ones, including
  a table whose stripped snapshot lacks a PK the `table()` declares.
- `p8-validators` — the probe preset validator beside `supabasePreset`
  with `existingTable("auth","users")`, then a managed table in `auth`.
- `p9-schema-warnings` — adoption in a schema the snapshot never
  recorded (`ext`) and in `public`; an adopted table and a managed
  table each gaining a `text().notNull()` column in the same run.
- `p10-seq-cells` — re-adoption as `bigserial` over an `integer`
  sequence; re-adoption after the sequence was dropped `cascade`; a
  sequence of the adopted table's derived name that another table's
  column owns (`app.d_id_seq owned by app.other.id`).
- `p11-rename-in-adoption` — a column drop+add (`name` → `title`) in
  the same edit as an adoption, then `--rename`; the table-rename shape
  (existing `docs` removed, managed `documents` appearing).
- `p12-existing-change-policy-handover` — an existing declaration whose
  column list grows; a managed table with RLS, a policy and a serial PK
  handed over.
- `p13-pk-cells` (new) — the primary-key matrix in one run: the
  existing declaration listed the PK and the database holds it under
  the derived name (`t_a`, plus an index); the PK moved to another
  column (`t_b`: `id` → `code`); the database holds it under a custom
  name the existing side never listed (`t_c`, `c_custom_pk`); no PK
  anywhere (`t_e`, which also carries an index no declaration covers);
  a PK a managed table's FK already references (`parent` ← `child`,
  created in an earlier run against the existing declaration); a
  managed `t_f` handed over in the same run; `t_d` kept existing; two
  `.primaryKey()` columns on one adopted table (`t_d`, a composite
  probe run separately); `check --url <url>` with the literal flag.
- `p14-order` (new) — two adopted tables declared in the order that
  disagrees with dependency order: `kids` (FK onto `parents.id`)
  declared before `parents` (whose PK the same adoption creates).
- `p15-rls-policy-roundtrip` (new) — a managed table whose managed
  objects are a serial sequence, RLS and a policy and nothing else,
  handed over and adopted again on a database that kept all three.
- `types-probe` (new) — `tsc --strict --exactOptionalPropertyTypes`
  over four files calling `existingTable` with one, two, three and
  four arguments.

Rows: 152 recorded CLI invocations (`runs/*.exit` across the sixteen
projects; the `hejbro init` calls are not counted) and 48 recorded
`psql` reads/writes, across 16 databases; 33 `adoption-creates` blocks
were printed in total, every one with the same first sentence and the
same `Next:` line (`sort -u` over all blocks: one of each). Two
harness artifacts are left in the corpus and are not cited below:
`p3b`'s `b2-*` labels ran with a stray second migration file that the
`b1b` probe had produced (`diverged-migrations`, exit 2), and `b2c-*`
is the clean branch-2 run; `p13`'s `v1c-composite` is the composite
probe re-run for its bytes as `v1c-composite-bytes`.

### Blocking findings

None. B1 and B2 are closed on the corrected delta and the shipped
behaviour; no correction opened a new contradiction on the inputs
above.

**B1 closed — the primary key is created on adoption regardless of
what the existing declaration listed.** `p2-children` `v2-generate`
(the round-1 input, `posts.id: integer().primaryKey()` on the existing
side, database without a PK): the migration
`20260908153200_add_comments_id_seq.sql` carries `alter table
"app"."posts" add constraint "posts_pkey" primary key ("id");` placed
after the sequence triple and before the indexes, the check and every
foreign key; the banner reads `~ table app.posts [index …, index …,
foreign key …, foreign key …, check …, primary key "posts_pkey" added]`;
the notice names `primary key "posts_pkey"` as before. `v2-migrate`
applies the whole file in one go (exit 0, the `comments.post_id` FK
that failed in round 1 with `42830` now resolves against the created
PK); `psql` after apply lists `posts_pkey p`, `tags_pkey p`,
`comments_post_id_fk f`, `post_tags_post_fk f` and `post_tags_tag_id_fk
f`; `v3-generate` says `no changes`, and `check` no longer reports
`posts_pkey`. `p3b` `v2-readopt`: `alter table "app"."orders" add
constraint "orders_pkey" primary key ("id");` is in the file and the
banner. `p5` `plainpk` (PK on both sides, nothing else): now a block
with the single line `primary key "plainpk_pkey"` and the statement in
the file, where round 1 was silent and emitted nothing, matching the
corrected scenario text that reserves silence for a declaration with
"no index, check, foreign key or primary key". `p13` created and named
all six PK cells: derived name held (`t_a_pkey`), moved column
(`t_b_pkey` becomes `PRIMARY KEY (code)` in `pg_get_constraintdef`),
custom name held (`t_c_pkey` beside the catalog's `c_custom_pk`), none
held (`t_e_pkey`), referenced (`parent_pkey`), and the composite probe
`alter table "app"."t_d" add constraint "t_d_pkey" primary key ("x",
"y");`. `p6` (`user_pkey`, `order_pkey` on reserved-word tables), `p9`
(`things_pkey` in `ext`), `p14` (`parents_pkey`) likewise. Control:
`p7` `vB-generate` on a marker-stripped snapshot adds `nopk_pkey` as an
ordinary managed change with no `adoption-creates` block, and leaves
`legacypk` (PK on both sides) without a statement.

**B2 closed — the `Next:` names two ways that run, and both were run
to the end.** Every block ends with the one line `Next: if the database
already holds these, either hand the table back — restore the migration
and the snapshot this run just wrote and the existingTable() declaration
it replaced — or drop the indexes, checks, foreign keys and primary key
it already holds, never the sequence, and run "hejbro migrate"; if it
lacks a column, discard the migration and snapshot this run just wrote,
adopt with the columns the database has, then add the column and its
objects in a following edit.` (`p1-widgets/runs/v2-generate.err`, and
identical in all 33 blocks). `hejbro baseline` is no longer named
anywhere in the notice or the delta. On `p3b`'s re-adoption (the
database holds `orders_pkey`, `orders_total_nonneg`, `orders_total_idx`
and `orders_id_seq` from the handover; `v2-migrate` fails `42P16:
multiple primary keys for table "orders" are not allowed`, the file
stays pending, the catalog and the two rows unchanged): branch 1
(`git checkout v1 -- hejbro.snapshot.json src/app.schema.ts` and `rm`
of `20260908153144_add_orders_id_seq.sql`) leaves `verify` at `5
checks passed (2 migrations)`, `generate` at `no changes`, `migrate` at
`nothing to apply`, `status` at `nothing pending`, `check` at `no
differences` with `check does not compare app.orders: declared existing
and not compared`, and the catalog untouched (`b1-*`, `s3-catalog`);
branch 2 (`drop index app.orders_total_idx; alter table app.orders
drop constraint orders_total_nonneg; alter table app.orders drop
constraint orders_pkey`, the sequence left alone) lets `b2c-migrate`
apply the same pending file (exit 0), after which `psql` shows
`orders_pkey p`, `orders_total_nonneg c`, `orders_total_idx`, the
sequence still `integer` with `last_value 3` and the column default
still `nextval('app.orders_id_seq'::regclass)`, the three rows intact
and a new insert taking id 4; `b2c-check` `no differences`,
`b2c-verify` `5 checks passed (3 migrations)`, `b2c-generate` `no
changes`. The missing-column branch: `p4` — `check` before `migrate`
names `check-object-missing: app.things.slug` as its first finding,
`migrate` fails `42703: column "slug" does not exist` and rolls back
(catalog unchanged, `s2-catalog`), snapshot restored and migration
deleted, `v3-adopt` with `{id, extra}` creates `things_pkey` and
`things_extra_idx` (applied), `v4-add-column` writes `alter table
"app"."things" add column "slug" text;` plus its index and check with
no `adoption-creates` block (stderr 0 bytes), applied; `v4-check` `no
differences`, `v4-verify` `5 checks passed (4 migrations)`.

### Non-blocking findings

Round-1 numbering is kept where the finding persists; new ones start
at R2-N8. Dispositions are suggestions.

- **N4 — fixed.** The first sentence now reads `adoption creates
  objects for a table hejbro did not create; apply fails if the
  database already holds one of the indexes, checks, foreign keys or
  the primary key named below — a sequence it already holds is reused,
  and row-level security and policies are re-applied without failing`
  (every block). Measured true on both halves: `p15` re-adopts a table
  whose database kept its sequence (`last_value 2`), `relrowsecurity
  = t` and policy `notes_read` — the file (`create sequence if not
  exists`, two `alter sequence`, `enable row level security`, `drop
  policy if exists` + `create policy`) applies with exit 0, the policy
  and RLS are still there, the next insert takes id 3, `check` `no
  differences`; `p3b`/`p5`/`p13` fail on a held PK (`42P16`); round
  1's `p3b` measured the held index (`42P07`) when the index preceded
  the PK, and this build orders the PK first.
- **N8 — fixed.** The scenario now writes `existingTable("app",
  "widgets", …)`; `types-probe`: the three-argument call compiles, and
  the compiler reports `Expected 3 arguments, but got 1` /
  `but got 2` / `but got 4` for the other forms (`plain/` run, exit 2),
  so an existing declaration carries no extras of its own.
- **N3 — half fixed, half open** (suggested: fix the banner, or
  document that an adoption's banner lists snapshot movement). The
  banner now names the primary key the migration creates (`primary key
  "orders_pkey" added`, `p3b`; `primary key "posts_pkey" added`, `p2`),
  which round 1's B1 evidence lacked. It still lists column entries no
  statement implements: `p4` `v2-generate` `~ table app.things [column
  "extra" added, column "slug" added, column "id" changed, …]` over a
  body of one `add constraint` and two `create index`; `p9` `column
  "label" added` for `app.widgets` with no `add column`; `p11`
  `vA-generate` `column "title" added, column "name" dropped` over a
  body of one `create index`; `p13` `column "code" changed, column
  "id" changed` for `t_b`; `p2` `column "id" changed, column "label"
  changed` for `tags`. `generate-verify-workflow.md` still says the
  banner "lists every object added/changed/dropped".
- **N1 — open** (suggested: fix). A `serial` column's `nextval` default
  is still never attached on adoption when the column has none: `p1`
  `s2-owned` shows `pg_get_serial_sequence = app.widgets_id_seq` and an
  empty `column_default`, `v2-check` reports `declared column
  "app.widgets.id" has a default ("nextval('app.widgets_id_seq')"), but
  the database has none`; same for `p2` `posts.id`/`tags.id`, `p10`
  `b.id` (sequence dropped `cascade` then re-adopted: `insert into
  app.b(name) values ('x')` fails `null value in column "id"`) and
  `p10` `d.id` (a sequence another table's column owned, ownership
  moved by `alter sequence … owned by`, default never set). A column
  that already had the default keeps it (`p3a`, `p3b`, `p15`). Outside
  the delta's sentences (which promise the sequence, not the default);
  the skill's "Dropping instead …" paragraph documents the dropped-
  sequence case only.
- **N2 — open** (suggested: fix, or name the unique constraint in the
  delta's list). `p2` `tags.label: text().notNull().unique()`: no `add
  constraint "tags_label_key" unique` in the file, no line under
  `adoption-creates`, `check` reports `check-object-missing:
  app.tags.tags_label_key` (and the not-null drift, which is by
  design), `v3-generate` `no changes`.
- **N5 — open** (suggested: name `create schema` in the notice, or
  document that the schema must be baselined first). `p9`
  `v2-generate`: `create schema "ext";` and `create schema "public";`
  open the file, the three blocks name indexes and a PK only,
  `v2-migrate` fails `42P06: schema "ext" already exists` before any
  adoption statement runs.
- **N6 — open** (suggested: by design, document). `p11` `vA-generate`:
  `existingTable {id, name}` → `table {id, title}` + index exits 0 with
  no rename refusal; `--rename app.docs.name=title` is refused
  `unknown-rename-target: table "app.docs" has no dropped column named
  "name"`; `migrate` fails `42703: column "title" does not exist`;
  `check` lists `app.docs.name` as unmanaged inventory. `vB` (existing
  `docs` removed, managed `documents` appearing) is a plain `create
  table "app"."documents"`.
- **N7 — open** (by design or fix). The adoption block carries no `at
  <file>:<line>`; the neighbouring `rls-unreachable-schema` block in
  `p1` and `p15` ends with an absolute path (`at /private/tmp/
  d106-ha-r2/p1-widgets/src/app.schema.ts:20:7`), which the workflow
  reference says no diagnostic prints. 0 `at` lines inside the 33
  adoption blocks.
- **N9, N10 — unchanged observations.** Blocks are ordered by
  `schema.table` identity, not declaration order (`p2` printed
  `post_tags, posts, tags`; `p14` printed `kids` before `parents`
  although the SQL puts `parents_pkey` first), and precede every other
  warning (`p9`: three blocks, then `not-null-without-default` for
  the managed `settings`; stdout `4 warning(s) — see below`).
  `not-null-without-default` is suppressed for the adopted `widgets`
  and the column is not added (`p9`).
- **R2-N8 — dropping a held primary key that a managed table's foreign
  key references takes that foreign key with it, and nothing re-creates
  it** (suggested: docs in the notice, or fix). `p13`: `child.parent_id`
  references `existingTable("app","parent")`, created by `v1-migrate`
  as `child_parent_id_fk`; adopting `parent` emits `add constraint
  "parent_pkey"`, `v2-migrate` fails `42P16` on it; the plain drop is
  refused by Postgres (`cannot drop constraint parent_pkey … constraint
  child_parent_id_fk on table app.child depends on index
  app.parent_pkey`), `drop constraint parent_pkey cascade` removes the
  FK, `v3-migrate` then applies, and `v3-check` reports
  `check-object-missing: app.child.child_parent_id_fk` with `generate`
  having nothing to emit (the snapshot records the FK as created). The
  delta's "the two ways that run on it" holds — the migration applies —
  but the drop branch is lossy here; `brownfield-adoption.md` already
  says "Dropping a primary key other tables reference needs those
  foreign keys dropped first … hand the table back instead when the
  table is live", the `Next:` line does not.
- **R2-N9 — a table whose existing declaration listed its primary key
  and whose database holds it (the shape `hejbro import` writes) now
  fails at apply on every adoption** (by design under the corrected
  delta; suggested: say so in the skill's adoption procedure). `p5`
  `plainpk`, `p13` `t_a`/`t_b`/`parent`: `42P16: multiple primary keys
  for table … are not allowed`, and the only ways through are the
  two the `Next:` names — handing back, or dropping the PK (a
  rebuild of its index on a live table, with R2-N8's cascade when
  referenced). The skill's "A mid-chain path that records what the
  database already holds without reverting or dropping anything does
  not exist yet (#1037)" is the one sentence that states this.
- **R2-N10 — `check --url` before `migrate` cannot name the held
  objects the apply will fail on** (by design; docs if anything). `p13`
  `v2-check-url`: `t_a_pkey`, `t_b_pkey` and `parent_pkey` exist under
  their derived names, so `check` reports nothing for them and
  `migrate` then fails on `parent_pkey`; only the objects the database
  lacks (`t_a_v_idx`, `t_c_pkey`, `t_e_pkey`) are named, and the
  custom-named `c_custom_pk` appears as `unmanaged index (backs
  constraint c_custom_pk; …)`. The delta promises `check` names a
  missing column, which it does (`p4`), not a held object.
- **R2-N11 — a trigger on the adopted table is created by the same
  migration and not named** (by design; observation). `p2`: `+ trigger
  app.posts.posts_stamp [new]` in the banner, `create trigger
  "posts_stamp" … on "app"."posts"` in the body, `pg_trigger` holds it
  after apply, no line under `adoption-creates: app.posts`; the
  delta's enumerated list has no trigger and `defineTrigger` is its
  own declaration.

### Scenarios verified

Evidence under `/private/tmp/d106-ha-r2/<project>/runs/` and the
migration files named.

1. **An existing declaration produces no statement** — `p1`
   `v1-generate` (`record_widgets.sql`, `carries no statements`,
   snapshot with `"existing": true` and the three columns), `p12`
   `v1-generate` (existing `legacy` gains a column → `reshape_legacy.sql`,
   0 statements), `p5` `v4-remove` (every existing declaration removed
   → `forget_gadgets.sql`, 0 statements, `v4-verify` passes, the five
   tables still in `pg_class`); stderr 0 bytes on each.
2. **A managed table may reference an existing one** — `p13`
   `v1-generate`: managed `child.parentId.references(() => parent.id)`
   onto `existingTable("app","parent")` emits `add constraint
   "child_parent_id_fk" … references "app"."parent" ("id")`, applies,
   an insert of `parent_id = 1` succeeds; no statement names `parent`.
   `p2`: `posts_account_id_fk … references "ext"."accounts"`, `check`
   prints `check does not compare ext.accounts: declared existing`.
3. **A table handed to the platform loses nothing** — `p12`
   `v1-generate`: managed `notes` (RLS, policy `notes_read`, serial PK)
   → `existingTable`, 0 statements; catalog after `v1-migrate`:
   `relrowsecurity = t`, `notes_read`, `notes_pkey`, `notes_id_seq`.
   `p3b` `s1-catalog` (PK, check, index, sequence, column default all
   kept), `p5` `s3-catalog` (three PKs, RLS on `rlsonly`,
   `gadgets_id_seq` kept), `p13` `t_f` handed over in the adoption run
   (`t_f_pkey`, `t_f_q_idx` still present), `p15` `s1-catalog`.
4. **An adopted table gains what the declaration manages** — `p1`
   `v2-generate`: no `create table`; `create sequence if not exists
   "app"."widgets_id_seq"; alter sequence … as integer; alter sequence
   … owned by "app"."widgets"."id"; create index "widgets_name_idx" …;
   alter table … enable row level security; drop policy if exists …;
   create policy …` (bytes of `20260908153144_add_widgets_id_seq.sql`);
   catalog after `v2-migrate`: sequence `integer` owned by `widgets.id`,
   `relrowsecurity = t`, policy `widgets_tenant_read` (`polcmd r`),
   `widgets_name_idx`. Every child kind: `p2` (two indexes, a check,
   three FKs, the composite unique index, `posts_pkey` and `tags_pkey`),
   `p6`, `p13`, `p14`. Sequence round trip: `p3a` — after the handover
   the sequence was `smallint`, `owned by none`, `last_value 2`;
   re-adoption applies (`v2-migrate` exit 0), catalog `integer`, owned
   by `items.id`, `last_value` still 2, the next insert takes id 3,
   `check` `no differences`. Re-adoption with more: `p3b` names
   sequence, index, check and PK, and both `Next:` ways run to the end
   (B2 closure above). Missing column: `p4` (B2 closure above); a child
   on a column the database has but the existing declaration never
   listed (`extra`) applies (`v3-migrate`). `p10`: `bigserial` over the
   integer sequence → `alter sequence … as bigint` applies,
   `pg_sequences.data_type = bigint` while the column stays `integer`
   and `check` reports the type drift.
5. **A reserved-schema validator exempts an existing table** — `p8`
   `vA-generate`: `existingTable("auth","users")` under
   `supabasePreset` raises nothing, migration written; `vB-generate`: a
   managed `table(auth,"audit")` beside it is refused
   `error[reserved-schema]: auth` (twice), exit 1, no file written.
6. **An existing declaration reaches the validators** — `p8`
   `vA-generate`: the probe printed `validator saw table declaration
   {"table":"users","existing":true}` beside
   `{"table":"notes","existing":false}`.
7. **An older snapshot's tables are all managed** — `p7`: marker
   stripped; the same `existingTable()` declarations read against it
   are a handover (`release_legacy.sql`, 0 statements, no block);
   `table()` declarations read against it are an ordinary managed diff
   (`create index "legacy_name_idx"`, `add constraint "nopk_pkey"`, no
   statement for `legacypk`, no block).
8. **Adoption names what it creates** — `p1` `v2-generate`, exit 0,
   stdout `wrote migrations/…` and `2 warning(s) — see below`; stderr
   `warning[adoption-creates]: app.widgets`, the first sentence (N4,
   above), `apply also fails if the database lacks a column one of
   these objects needs — "hejbro check --url <url>" names such a column
   before you migrate`, then `sequence "app.widgets_id_seq"`,
   `row-level security`, `policy "widgets_tenant_read"`, `index
   "widgets_name_idx"`, then the `Next:` line (B2, above); the file is
   written. One block per adopted table that the migration creates
   anything for, the names matching the statements: `p2` three blocks
   for three adopted tables (`comments` new, no block), `p6` five
   (`a.items`, `a.user`, `b.items`, `b.order`, `public.pubthing`,
   reserved words quoted in the SQL, `check` `no differences`), `p9`
   three, `p13` five (`t_f` handed over and `t_d` kept existing, no
   block), `p14` two, `p10` three sequence-only blocks. The stdout
   count equals the number of blocks plus other warnings every time
   (`5 warning(s)` in `p6` and `p13`, `4` in `p9`, `3` in `p10`).
9. **A handover is silent** — `p3a` `v1-handover`, `p3b`
   `v1-handover`, `p5` `v3-handover` (four tables at once), `p12`
   `v1-generate`, `p15` `v1-handover`, `p13` `v2-generate` (`t_f`
   beside five adoptions): stderr carries no `adoption-creates` for
   any handed-over table; the single-table runs have stderr of 0 bytes
   and stdout `carries no statements`.
10. **An adoption with nothing to create is silent** — `p5`
    `v2-generate`: `app.plain` (nullability changed only) prints
    nothing and gets no statement; `app.rlsonly` prints the single line
    `row-level security`; `app.plainpk` prints `primary key
    "plainpk_pkey"` (B1 closure); the brand-new `app.gadgets` prints
    nothing and keeps `create sequence "app"."gadgets_id_seq" as
    integer;`, which fails against the pre-created sequence (`42P07`)
    and applies once it is dropped (`v2-migrate3`).

Also verified: `verify` passes after every adoption and handover run
(`p1`, `p2`, `p3a`, `p3b`, `p4`, `p5`, `p6`, `p12`, `p13`, `p14`,
`p15`); `status` reports a failed adoption file as pending with the
ledger untouched (`p3b`, `p4`, `p5`, `p9`, `p13`); `check` lists what
adoption left alone as inventory rather than a finding (`p13`
`unmanaged index (not covered by any declaration): app.t_e.t_e_extra_idx`
before and after apply; `p11` `app.docs.name`); restoring only the
migration and the snapshot but not the declaration (`p3b` `b1b-*`)
fails `verify` with `error[snapshot-stale]` as the skill says, and the
next `generate` writes the adoption migration again.

### Verdict

**ARCHIVE** — no blocking finding. B1 is closed (the primary key is
created and named on every adoption input, including the ones where
the existing declaration already listed it, with foreign keys onto it
ordered after it), B2 is closed (the `Next:` names two ways that were
each followed to the end on the delta's own re-adoption input, and the
missing-column branch to the end on `p4`), N4 and N8 are fixed, N3 is
fixed for the primary key and open for column entries, and no
correction contradicts another delta sentence on the corpus. Eleven
non-blocking findings (N1, N2, N3, N5, N6, N7 open from round 1; N9,
N10 observations; R2-N8 to R2-N11 new), none contradicting a delta
sentence.
