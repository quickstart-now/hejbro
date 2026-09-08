# D106 evaluation — harden-catalog-inference-2 (round 1)

Context-free adversarial spec-only review of the delta
`openspec/changes/harden-catalog-inference-2/specs/catalog-inference/spec.md`
(two MODIFIED requirements, *A catalog reading yields a snapshot and a
marked description* with 12 scenarios and *The loss is announced, with
the way out* with 5 scenarios) against the built public surface at dev
`becacf03` (detached worktree `hejbro-worktrees/d106-catalog-inference-2`,
`packages/cli/dist/cli.js`, hejbro v0.2.0-pre.1). Read: the delta, the
two base requirements it replaces (`openspec/specs/catalog-inference/
spec.md`, same titles), `skills/hejbro/SKILL.md`, `skills/hejbro/
references/{brownfield-adoption,dsl-cheatsheet,polyrepo}.md`,
`README.md`, every `--help`, the built packages' `index.d.ts` (copied
to `/private/tmp/d106-cf/typings/`), and the archived
`2026-09-06-add-vendored-related/evaluation.md` for shape. Not read:
`proposal.md`, `design.md`, `tasks.md`, `.blackbox/`, `packages/*/src`,
`packages/*/test`, `examples/*/test`, archived proposals, issues, PRs,
git log, changesets. No tool result showed forbidden material.

## Method

The input table is built with `psql` only (never with hejbro), in seven
databases on one `postgres:17-alpine` (container `d106-cf-pg`, host
port 55750, `log_statement=all`, removed afterwards), and read by the
built CLI from real projects (`hejbro init`, `package.json` pointing
`hejbro`, `@hejbro/core`, `@hejbro/query`, `@hejbro/pg` at the built
packages through `file:` plus `pnpm.overrides`). Everything is kept
under `/private/tmp/d106-cf/`: `sql/*.sql` (the inputs, plus the two
`pg_dump`s and their diff, the Postgres log and the per-session verb
summary), `proj*/` (one project per database, with every stdout/stderr
and exit code saved beside it), `consumer-gen1/` (a `link`+`vendor` of
one starter, for provenance only).

- `corpus` (`sql/corpus.sql`, project `proj/`, pull in `proj-pull/`):
  named schemas `app`, `aux`, `"BadSchema"`; unnamed `ext`, `"Ext"`.
  One probe per delta sentence: identity/serial/bigserial/generated
  columns, arrays of text/numeric/enum, a domain, a composite, tsvector,
  point, int4range, money; enums `status` (values `zeta, alpha, mid
  value, Upper`), `"Status"`, `_kind`, `aux.kind` (cross-schema);
  columns `user_id` + `"USER_ID"` + `"User_Id"`, `"createdAt"`, `_id`,
  `foo__bar`, `foo_1`, `foo_bar_`, `item2`, `"2fa_code"`,
  `"constructor"`; indexes on `lower(email)`, partial on `deleted_at`,
  partial on `"createdAt"`, expression on `"2fa_code"`, INCLUDE
  `"createdAt"`, multi-column with `"createdAt"`, `"IDX_Users_Email"`;
  checks `users_n_positive`, `"CK_Users_N"`, one naming `"createdAt"`;
  UNIQUE constraints ordinary, `"UQ_Users_Item2"`, on `"createdAt"`,
  composite with `"createdAt"`; tables `"Users"`, `"user-profile"`,
  `"users v2"`; foreign keys `"FK_Orders_CreatedBy"`, a carriable
  non-derived name, into `"Users"`, into `"BadSchema".victims`, into
  `ext.things`, into `ext."Things"`, into `"Ext".stuff`, from and into
  `orders."UserId"`, composite through `"MemberId"`, enum-to-enum on
  `"Status"`; a PK on `"Id"`, a composite PK with `"MemberId"`; two
  `chk_positive` checks on `a_c` and `ab`; sequences `ticket_seq`
  (nextval on a kept column) and `orphan_seq` (nextval on `"Legacy_No"`);
  a partitioned parent and child, an `INHERITS` child, an UNLOGGED
  table, a comment, a view, a materialized view, two functions, a
  trigger; roles via table grant (`app_writer`), schema grant
  (`app_schemagrant`), column grant (`app_colgrant`), policy only
  (`app_reader`, `app_auditor`), `to public` (policy and grant), `to
  current_user`; `aux.profiles` referencing `app.users` and back.
- `gen1` (`sql/gen1.sql`, `proj-gen1/`): two plain generated columns,
  INCLUDE on a kept column, hash and desc/nulls-last indexes, a single
  FK into an unnamed schema (`ext2.plain`, `ext2.other`), the collision
  in the reverse physical order (`"USER_ID"` before `user_id`) and a
  pair neither of whose names its key produces back (`"UserID"`,
  `"USERID"`), a column-only grant, a sequence-only grant, `to
  session_user`.
- `loc` (`sql/loc.sql`, `proj-loc/`): omitted tables `"B_table"`,
  `"Zeta"`, an NFC/NFD pair `"é_nfc"`/`"é_nfd"`, indexes `"IDX_a"`,
  `"idx_A"`, `"IDX_b"`, columns `"É_col"`/`"é_col"`, kept tables `a_c`,
  `ab`, `a_table`, `x_y`, `xa`; imported under `LANG=LC_ALL=C`,
  `en_US.UTF-8`, `ko_KR.UTF-8`.
- `pk` (`sql/pk.sql`, `proj-pk/`): PKs `pk_orders` and `"PK_Items"`,
  later extended with a UNIQUE, a nextval on an unowned sequence and a
  `"FK_Orders_Buyer"` for the band order.
- `omit` (`sql/omit.sql`, `proj-omit/`): `"IDX_Keep_Qty"`,
  `"CK_Keep_Qty"`, table `"Gone"`, schema `"Om Bad"`, two FKs into
  them, checks `z_chk`/`a_chk`, a check and an index both named
  `dup_name`.
- `enumdb` (`sql/enum.sql`, `proj-enum/`): enum `"Status"` beside
  `status`, columns of each, `"UserId"` with a PK, an index and a check
  naming it, an index on the `"Status"` column; its baseline applied to
  the empty `enum_rt`.
- `rt`: the corpus baseline SQL applied with `psql -1` to an empty
  database (`ext.things` pre-created), then `pg_dump --schema-only` of
  `corpus` and `rt` diffed (`sql/dump-diff.txt`, 262 lines, every one
  accounted for below).

Execution rows: 44 CLI invocations (init 6, import 14 of which 2
refused by design, pull 3, baseline 5, migrate 4, check 10, link 1,
vendor 1), 7 database loads, 3 baseline applies (1 failing as
predicted), 2 dumps, 12 rename statements, 34 CLI catalog-reading
sessions isolated in the Postgres log.

## Blocking findings

### B1 — A generated column is read as a plain column, silently

**Sentence contradicted** (MODIFIED requirement 1, first sentence):
"a snapshot of the schemas named — tables with columns, defaults,
identity and generated markers"; and requirement 2: "every
approximation the reading made" is announced.

**Input**: `gen1`: `create table app2.t (... a integer not null, b
integer not null, total integer generated always as (a + b) stored,
label text generated always as (upper(a::text)) stored, ...)`;
`corpus`: `app.users.full_len integer generated always as
(length(email)) stored`.

**Observed**: `hejbro import --schema app2` writes `total: integer(),
label: text()` (`proj-gen1/src/schema/app2.schema.ts`), the corpus
starter writes `fullLen: integer()`; no Guessed, Not inferred,
Approximated or Omitted line names any of the three (`proj-gen1/
import.stdout`, `proj/runs/import-corpus.stdout`). `hejbro baseline`
then emits `"full_len" integer` (`proj/migrations/20260907133930_add_app.sql`),
the round trip's dump lacks `GENERATED ALWAYS AS (length(email))
STORED` (`sql/dump-diff.txt`), and `hejbro check --url .../corpus`
against the very database that was imported exits 1 with
`error[check-object-differs]: app.users.full_len — declared column
"app.users.full_len" is a plain column, but the database's column is
generated always as ...` (`proj/runs/check-corpus.stderr`). The pulled
contract types the column as writable: `readonly total?: number |
null` in the Insert and Update shapes (`proj-gen1/.hejbro/vendor/
contract.ts` lines 23, 33), so a consumer's insert compiles and fails
on the server. Identity markers, by contrast, survive (`ident_always`,
`ident_default` reach the starter and the dump unchanged).

**Expected**: `total: integer().generatedAlwaysAs(sql.raw("(a + b)"))`
(the DSL has the builder, and `check` compares that axis), or, failing
that, an Approximated/Omitted line naming the column.

**Provenance**: the sentence is unchanged from the base requirement, so
the root predates this change by text; no older binary was run (git
commands are out of scope for this review), and the same shipped
build shows it wherever the delta does not apply (the vendor path in
`consumer-gen1/` compiles the same starter to the same writable
`total`). Reported as blocking because the delta re-asserts the
sentence and its own `check` scenario pattern ("exactly as the report
said it would") is what breaks: the report says nothing and `check`
fails.

### B2 — The pulled contract carries no relation onto a target in an unnamed schema

**Sentence contradicted** (scenario *A reference into a schema the run
did not name is kept*): "the pulled contract carries the reference
both as a relation and in its foreign-key metadata while giving that
target no entry of its own among its tables"; requirement 1: "the
contract names it through the relation and the foreign-key metadata".

**Input**: `gen1`: `app2.t.plain_id integer references ext2.plain
(id)` and `other_code text references ext2.other (code)`; `hejbro
pull --db-url .../gen1 --schema app2`. Also `corpus`: `orders.ext_ref`
→ `ext.things` (two FKs on that column), `hejbro pull --schema app
--schema aux --schema BadSchema`.

**Observed**: `proj-gen1/.hejbro/vendor/contract.ts`: `Relationships`
lists `t_other_code_fkey → "ext2.other"` and `t_plain_id_fkey →
"ext2.plain"` (lines 39-52) and `contractMetadata.tables.t.foreignKeys`
lists both (87-88), but `readonly Relations: {};` (line 53). The
corpus contract's `orders.Relations` holds only `user` and
`order_notes` (`proj-pull/.hejbro/vendor/contract.ts` 262-264) with
no relation for either FK onto `ext.things`; `Tables` and
`contractMetadata.tables` correctly have no `things` entry, and the
contract compiles (`tsc --strict --exactOptionalPropertyTypes`, exit
0). Everything else in the scenario holds (see S5 below).

**Expected**: a relation entry for the unread target, as the sentence
says; or, if a relation cannot exist without a `Tables` key for its
`target` (the previous change's contract rule), the delta sentence has
to say "in its foreign-key metadata" only. The two sentences cannot
both be true of one contract as the contract format stands.

**Provenance**: the vendor path drops even the `Relationships` entry
for the same starter (`consumer-gen1/.hejbro/vendor/contract.ts`:
`Relationships: readonly []`, `Relations: {}`), so `pull` already
carries more than `vendor` does here; the contradiction is with the
delta's own text.

## Non-blocking findings

- **N1 — Column-level and sequence-level grants contribute no role
  name.** `gen1`: `grant select (a) on app2.t to g_colonly`, `grant
  usage on sequence app2.counter to g_seqonly`, `grant select on app2.t
  to g_tableonly` → `Guessed role names: g_tableonly, postgres`;
  `corpus`: `grant usage on schema app to app_schemagrant` is
  reported, `grant select (email) on app.users to app_colgrant` is not.
  The sentence "role names from the grants and the policies present"
  is universal; the DSL's `grant()` models schema usage, table and
  default privileges only (cheatsheet), which is the grant set read.
  Disposition: docs (say "the grants the DSL models: schema and
  table") or fix. Predates the change (the grants half of the sentence
  is unchanged).
- **N2 — "Next: rename ..., then re-run `hejbro import`" fails when
  followed literally after the first import.** `omit`: after renaming
  `"Om Bad"`→`om_bad`, `"Gone"`→`gone`, `"IDX_Keep_Qty"`, `"CK_Keep_Qty"`,
  `hejbro import --schema om --schema om_bad --out src/schema` exits 1:
  `error[import-destination-exists]: hejbro import would overwrite 1
  existing file(s): src/schema/om.schema.ts. Next: remove or move the
  listed file(s) (import never overwrites), then rerun`
  (`proj-omit/import2.stderr`; same in `proj-enum/import2.stderr`).
  After the documented next step (`baseline`), a second `import` also
  cannot be baselined (`baseline-not-first`, skill), so the whole way
  out is: rename, re-import into a fresh `--out` (or declare by hand),
  merge the declarations, `check`. Done that way it ends the listing
  (`proj-omit/check3.stdout`, `proj-enum/check3.stdout`: no
  differences, the renamed objects gone from the inventory). The
  lines that carry this remedy: schema, enum type, every
  "Next:"-bearing index/check/unique/PK/FK line. The lines the delta's
  own scenarios quote (index/check/table: "until it is renamed in the
  database and declared") are whole. Disposition: fix (text: "re-run
  `hejbro import` into a fresh `--out`, then merge" or "and declare
  it").
- **N3 — INCLUDE columns are dropped silently, and the omitted-index
  line calls them an expression.** `gen1`: `create index
  t_a_include_idx on app2.t (a) include (b)` → starter
  `index("t_a_include_idx").on(t.a)`, no Approximated line, so a
  following baseline re-creates the index without `INCLUDE (b)`.
  `corpus`: `users_include_omitted_idx (email) include ("createdAt")`
  is omitted (correct: it names an omitted column) but its line reads
  "its expression names column app.users.createdAt"; there is no
  expression. Disposition: fix (an Approximated line for a dropped
  INCLUDE; "its INCLUDE list names column").
- **N4 — Partitioning, inheritance, UNLOGGED, comments and RLS
  enablement are dropped without a line.** `sql/dump-diff.txt`:
  `PARTITION BY RANGE (at)`, `ATTACH PARTITION app.events_2026`,
  `INHERITS (app.base_items)`, `CREATE UNLOGGED TABLE app.scratch`,
  `COMMENT ON TABLE app.users`, `ALTER TABLE app.users ENABLE ROW LEVEL
  SECURITY` (and `app.orders`) all exist only on the `corpus` side;
  the starter declares `events` and `events_2026` as two ordinary
  tables (`events_2026.id` gets the parent's `nextval` as a raw
  default, announced) and `child_items` as a full copy of its parent's
  columns. Policies are announced ("5 policy expression(s) not
  inferred"); the `rls()` the DSL does have is not. Disposition: docs
  (list them under Not inferred) or fix; the delta is silent on all
  five.
- **N5 — The Approximated band's inner order is not the requirement's
  prose order.** `pk` extended: lines print UNIQUE, nextval, FK
  derived name, PK derived name, then the blanket expressions line
  (`proj-pk/import-order.stdout`); the requirement lists UNIQUE,
  nextval, expressions, FK, PK. If "the report's own bands ... keep
  the order stated here" means each approximation is a band, the
  expressions band is out of place; if it means the four outer bands
  only, the output complies. Disposition: docs (say which) or fix.
- **N6 — A collision where neither name produces the key back is
  resolved by physical order, unstated.** `corpus`: `foo__bar` then
  `foo_bar_` → keys `fooBar`, `fooBar2`; `gen1`: `"UserID"` then
  `"USERID"` → `userid`, `userid2` (`schema.json` of each pull). Both
  columns are omitted from the snapshot anyway, so only the
  description shows it. Disposition: docs (by design).
- **N7 — The unread target's handle is shaped by a guess.** The
  starter always types the handle's column `text()`
  (`existingTable("ext", "things", { id: text() })` for a uuid column,
  `existingTable("ext2", "plain", { id: text() })` for an integer
  one); the snapshot's `table:ext.things` entry carries `id uuid not
  null default gen_random_uuid()`, which is `orders.id`'s own shape
  looked up by column name (`ext2.plain.id` → `integer not null`
  from `t.id`; `ext2.other.code` → bare `text` because `t` has no
  `code`). Nothing consumes the shape today (no DDL for an existing
  table, no contract entry, the FK still emits and applies), so no
  sentence is contradicted, but the reading knows the referencing
  column's type and states something else. Disposition: fix (carry
  the referencing column's type, no default) or by design.
- **N8 — Text nits in the loss lines.** (a) `pull`'s FK-at-omitted-
  column lines double the clause: "... left out because no declaration
  can carry its name, so it cannot be carried in the contract, so the
  key cannot be carried either" (`proj-pull/pull-corpus.stdout`,
  three lines). (b) `pull`'s PK line tells the consumer what
  "`generate`/`check` will name" and that "`check` reports the declared
  ... as missing on every run" (`proj-pk/pull.stdout`); a consumer
  runs neither. (c) A UNIQUE constraint omitted for its own name is
  announced as `index "app.users.UQ_Users_Item2"`, the same kind
  omitted for a column as `unique constraint "app.orders.UQ_Orders_UserId"`.
  Disposition: docs/text.
- **N9 — `to current_user`/`to session_user` policies report the
  resolved login role.** `corpus` and `gen1`: `Guessed role names: ...,
  postgres`, and `roles: [..., "postgres"]` in both contracts. The
  catalog stores the resolved OID, so the reading is faithful, but a
  hosted database's owner role will land in every consumer's role
  whitelist. Disposition: by design (note in docs).
- **N10 — The not-inferred column lines are silent about `check`.**
  `comp`, `em`, `mny`, `pt`, `rng`, `tsv` are listed by `check` as
  unmanaged columns (`proj/runs/check-corpus.stdout`); their "Not
  inferred" lines say nothing either way, which the requirement
  permits (no false promise). Disposition: docs.
- **N11 — `pull` reports the omitted schema as pulled.** `pulled corpus
  (BadSchema, app, aux)` and `hejbro.lock` `schemas: ["BadSchema",
  "app", "aux"]` while the loss report omits the schema whole.
  Disposition: docs or fix (minor).
- **N12 — Export-name dodge.** A table named `t` is exported as `t2`
  (`export const t2 = table(app2, "t", ...)`, both `gen1` and the
  re-imported `om_bad.t`), presumably to avoid the extras callback's
  `t` parameter; loads and checks clean. Not a delta subject; noted
  because the file name a user will grep for is not the export name.

## Scenarios verified

Requirement 1, *A catalog reading yields a snapshot and a marked
description*:

1. **Read-only, with the dependency query.** Every CLI session that
   ran the `pg_depend dep` query (34 sessions isolated by PID in
   `sql/pg-full.log`, summarised in `sql/reader-sessions.txt`) sent
   only `SELECT` and the session settings `set intervalstyle to
   'postgres'; set bytea_output to 'hex'`; no insert/update/create/
   alter/drop/lock. `users_expr_on_omitted_idx (lower("2fa_code"))`
   and `users_predicate_on_omitted_idx (email) where "createdAt" is
   not null` are both omitted naming the column they reach through
   the expression or the predicate, which the key list alone could
   not have found; `users_email_lower_idx` is kept as
   `index(...).on(sql.raw("lower(email)"))`.
2. **Tables and enums are inferred** (scenario). `corpus`: `app` and
   `aux` with `profiles.user_id → app.users` and `users.profile_id →
   aux.profiles`, `users_n_positive`, `users_email_lower_idx`, enum
   `status` with values in catalog order `zeta, alpha, mid value,
   Upper`; the starter carries each, the baseline SQL recreates them,
   and the report opens with "Guessed: TypeScript keys from SQL
   names ...".
3. **Key rule.** `2fa_code → _2faCode`, `USER_ID → userId2`, `User_Id
   → userId3`, `createdAt → createdat`, `MemberId → memberid`, `_id →
   _id`, `user_id → userId` (bare key to the column whose name it
   produces back, in both physical orders: `corpus` has `user_id`
   first, `gen1` has `"USER_ID"` first and still gives `userId2` to
   it). Read from `schema.json` of each pull.
4. **Two SQL names that collide on one key are both described**
   (scenario). Description (`proj-pull/.hejbro/vendor/schema.json`)
   carries `user_id: userId`, `USER_ID: userId2`, `User_Id: userId3`;
   the loss report names `app.users.USER_ID` and `app.users.User_Id`
   as omitted; the snapshot and contract carry `user_id` only.
5. **A reference into a schema the run did not name is kept**
   (scenario). `orders.ext_ref → ext.things`: starter declares `const
   extThingsRef = existingTable("ext", "things", ...)` (not exported)
   and both FKs against it; the contract's `Relationships` and
   `contractMetadata.tables.orders.foreignKeys` carry `ext.things`,
   `Tables` and `contractMetadata.tables` have no `things` entry; the
   report says nothing about it (no line contains `ext.things`);
   `baseline` emits `alter table "app"."orders" add constraint
   "orders_ext_ref_fkey" foreign key ("ext_ref") references
   "ext"."things" ("id")` and it applies on `rt`; no `ext.schema.ts`
   is written. The relation half is B2.
6. **Reference target in an unnamed schema whose own name cannot be
   carried is omitted.** `ext."Things"` and `"Ext".stuff`: both FKs
   omitted, lines name "table ext.Things" / "schema Ext" - the
   target's name, not the reading scope, decides.
7. **A name no declaration can carry costs that object, not the run**
   (scenario). `"Users"`, `"user-profile"`, `"users v2"` omitted with
   schema-qualified names and what to do; the other 15 `app` tables,
   both starter files and the contract are written; `"IDX_Users_Email"`
   and `"CK_Users_N"` cost themselves alone (`users` keeps its other
   five indexes and its other check). `omit`: `"Om Bad"` costs the
   schema, `om.keep` and `om.other` survive.
8. **A reference into an omitted object is omitted with it**
   (scenario). `orders` keeps `orders_user_id_fkey`,
   `orders_created_by_fk`, the two `ext.things` keys; loses
   `orders_bad_user_ref_fkey` (line names "table app.Users") and
   `orders_bad_schema_ref_fkey` (line names "schema BadSchema"); no
   Approximated line names anything omitted (checked: the Approximated
   band's objects are `users_email_key`, `users_user_id_uq`,
   `child_items.id`, `events_2026.id`, `tickets.id`,
   `FK_Orders_CreatedBy` - all declared).
9. **No approximation is announced for an object omitted for its
   name** (scenario). `"UQ_Users_Item2"` is announced only as omitted;
   `"Legacy_No" default nextval('app.orphan_seq')` gets no nextval
   line (only the column's Omitted line and the sequence's Not
   inferred line); `users_email_key` and `users_user_id_uq` on the
   same table are still announced as the unique index each becomes,
   and the baseline emits `create unique index` for both.
10. **Two tables sharing a constraint name keep their own
    expressions** (scenario). `a_c.chk_positive (qty > 0)` and
    `ab.chk_positive (price >= 1)`: starter and baseline carry each
    against its own table (`constraint "chk_positive" check ((qty >
    0))` under `a_c`, `check ((price >= (1)::numeric))` under `ab`);
    the round-trip dump matches.
11. **What is not inferred is named** (scenario). "2 function(s)", "1
    trigger(s)", "2 view(s)" (view + materialized view), "5 policy
    expression(s)", "grants beyond their role name", six columns with
    their types (`app.composite_t`, `app.email_domain`, `money`,
    `point`, `int4range`, `tsvector`), sequences `app.orphan_seq` and
    `app.ticket_seq` by name; none reaches the snapshot or the
    baseline SQL (the dump diff shows each only on the corpus side).
12. **A foreign key at an omitted column is omitted with it**
    (scenario). `orders."UserId"`: `orders_userid_users_fk` (from it)
    and `order_notes_order_user_fkey` (into it) reach neither starter
    nor contract; the starter loads (`baseline`: "loaded 22
    declarations"); both lines name the key and "column
    app.orders.UserId"; `orders` keeps `orders_user_id_fkey` and
    `orders_created_by_fk`.
13. **An index and a check at an omitted column are omitted with it**
    (scenario). `enumdb`: `"UserId"` (name) and `st` (enum `"Status"`),
    `things_userid_idx`, `things_st_idx`, `things_userid_chk`,
    `things_pkey` on `"UserId"`: none in the starter or the contract,
    each line names the column that took it out and its cause ("no
    declaration can carry its name" / "with the enum type en.Status
    that types it"), no Approximated line names any of them, and the
    baseline SQL applies to the empty `enum_rt` with `psql -1`
    (`APPLIED-TO-EMPTY`). Same for the corpus's composite PK
    `memberships_pkey`, unique `memberships_MemberId_role_key` and
    `users_multi_uq`, and the composite FK through `"MemberId"`.
14. **A role named only by a policy is inferred** (scenario).
    `app_reader` (policy only), `app_auditor` (policy list `to
    app_reader, app_auditor`), `app_writer` (grant only) all in
    `Guessed role names` and in `contract.ts` `roles`; `public` (a
    policy `to public` and a `grant ... to public`) in neither. See N1
    for column/sequence grants and N9 for `current_user`.
15. **An enum type whose name a declaration cannot carry is omitted
    with its columns** (scenario). `"Status"` and `_kind` (round-trips,
    fails the rule): the starter carries `status` and `st`, `stArr`,
    and neither `"Status"` nor `st_bad`, `st_bad_arr`, `k_underscore`;
    `grep Status src/schema/*.ts` finds only the report header; the
    enum-to-enum key `enum_child_code_fkey` is announced once.
16. **Round trip.** The corpus `enum_parent` table survives with zero
    columns and loads; the baseline as written fails on the empty
    server exactly where the report said it would (`relation
    "app.ticket_seq" does not exist`, the announced raw `nextval`
    default), and applies after that one sequence is pre-created;
    the dump diff is then exactly the announced losses plus B1, N3,
    N4 (`sql/dump-diff.txt`).
17. **Code-point order of the starter lists.** Tables `a_c` before
    `ab`, `membership_logs` before `memberships`, `a_table` before
    `ab` (`_` 0x5F before `b`), dependency order kept (`users` before
    `orders` before `order_notes`; `a_c`, `ab` before `x_y`); indexes,
    checks and FKs sorted by name within a table; enum values in
    catalog order. Identical files under the three locales
    (`proj-loc/out-*` `diff -r`: no output).
18. **Description records what the database holds.** The pulled
    description's `tables` carry `app.Users`, `app.user-profile`,
    `app.users v2` and every omitted column with a guessed key; the
    snapshot carries none of them and `ext.things` as `existing`.

Requirement 2, *The loss is announced, with the way out*:

19. **Every catalog-reading command prints the report.** `import` and
    `pull` both print all four bands to stdout (exit 0, stderr empty);
    the same 67 lines appear in each starter file's header
    (`proj/runs/header-app.txt` vs `terminal-report.txt`: identical;
    `app` and `aux` headers identical). `check` prints its own
    inventory and no loss report.
20. **The report names the way out** (scenario). `pull` ends with "The
    loss ends when you link the schema repository."; `import` with
    "The loss ends when you hand-edit the starter declarations.";
    every pull Omitted line ends "then link the schema repository".
21. **A dropped primary-key name is announced with the way out**
    (scenario). `pk`: "Approximated: the primary key
    "shop.orders.pk_orders" is declared under the derived name
    "orders_pkey" instead ... Rename the constraint to "orders_pkey"
    in the database; until you do, `check` reports the declared
    "orders_pkey" as missing on every run and lists "pk_orders" in its
    unmanaged-index inventory." After `baseline` + `migrate`, `check`
    exits 1 with `error[check-object-missing]: shop.orders.orders_pkey`
    on stderr and `unmanaged index (backs constraint pk_orders ...):
    shop.orders.pk_orders` on stdout; after `alter table shop.orders
    rename constraint pk_orders to orders_pkey` (and the same for
    `"PK_Items"`), `check` exits 0, "no differences", inventory
    empty. A PK whose name also fails D36 (`"PK_Items"`) takes the same
    line.
22. **The report's order does not depend on the locale** (scenario).
    `loc` under `C`, `en_US.UTF-8`, `ko_KR.UTF-8`: stdout identical
    but for the `created` path; Omitted tables print `B_table`, `Zeta`,
    `é_nfd` (e + U+0301), `é_nfc` (U+00E9) - code points, where ICU
    would sort `B_table` last and the NFC form first; indexes `IDX_a`,
    `IDX_b`, `idx_A`; columns `É_col` before `é_col`. Within every
    band of the corpus report the lines are in code-point order
    (`users.2fa_code` < `USER_ID` < `User_Id` < `_id` < `createdAt` <
    `foo_1` < `foo__bar` < `foo_bar_`).
23. **An omitted enum's line names its columns and what check will
    do** (scenario). One line per enum: "enum type "app.Status" ...
    every column typed by it is left out with it: "app.enum_child.code",
    "app.enum_parent.code", "app.users.st_bad", "app.users.st_bad_arr".
    `check` keeps naming each of them as unmanaged until it is
    declared, and never names the type itself -- its inventory has no
    enum axis. Next: rename the type in the database, re-run `hejbro
    import`, and declare both." `check` on `corpus` and `enumdb` lists
    exactly those columns as `unmanaged column` and no line names the
    type; after `alter type en."Status" rename to status2` alone the
    listing is unchanged (`proj-enum/check2.stdout`); after re-import
    and declaring both, `en.plain.st`, `en.things.st`,
    `things_st_idx` leave the inventory (`check3.stdout`). The "re-run
    import" step is N2.
24. **An omitted object's line says what check will do about it**
    (scenario). Index `"IDX_Keep_Qty"`, check `"CK_Keep_Qty"`, table
    `"Gone"` in `om` beside `keep`/`other`: each line says "`check`
    keeps listing it as unmanaged until it is renamed in the database
    and declared" (table: "in its unmanaged-table inventory
    (informational, never a failing check) until it is renamed in the
    database and declared"); no line says hejbro will not mention it
    again. `check` after `baseline`: exit 0 with the three inventory
    lines; after renaming all three (and the schema): still exit 0
    with `om.gone`, `om.keep.idx_keep_qty`, `om.keep.ck_keep_qty`
    listed; after declaring them: inventory empty. The schema line's
    "`check` will not list them" holds: nothing under `"BadSchema"` or
    `"Om Bad"` ever appears in an inventory.
25. **Omitted-column lines.** "`check` reports this column until it is
    renamed in the database and declared": all 13 corpus columns and
    `en.things.UserId` appear as `unmanaged column` in `check`'s
    inventory; omitted PK lines' "`check` keeps listing the index that
    backs it as unmanaged, naming ..." matches `unmanaged index (backs
    constraint pk_on_bad_pkey ...)`; omitted unique-constraint lines
    match `unmanaged index (backs constraint UQ_Orders_UserId ...)`.
26. **FK derived name.** `"FK_Orders_CreatedBy"` → `orders_created_by_fk`
    announced with both names; `check` reports the declared name
    missing, as the line says ("will name this constraint differently
    from the database"); a carriable non-derived name
    (`orders_custom_named_fk`) is declared with `name:` and `check`
    finds it.
27. **Way-out shared comparator.** Every list in every report and
    inventory observed sorted by code points; `check`'s inventory
    order matches the report's for the same objects
    (`app.users.IDX_Users_Email` before `app.users.UQ_Users_Item2`
    before `users_created_uq`).

## Verdict

**BLOCKED** — B1, B2. 2 blocking, 12 non-blocking, 27 scenario and
universal-sentence entries verified (every one of the 17 delta
scenarios exercised; B1 sits in requirement 1's first sentence, B2 in
scenario *A reference into a schema the run did not name is kept*).
