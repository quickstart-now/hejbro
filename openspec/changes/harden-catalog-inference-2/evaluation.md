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

## Round 2 (after the round-1 corrections)

Context-free re-review of the corrected delta
`openspec/changes/harden-catalog-inference-2/specs/catalog-inference/spec.md`
(the same two MODIFIED requirements; 12 + 5 scenarios) against dev
`779e7bba` (detached worktree `hejbro-worktrees/d106-catalog-inference-2-r2`,
`packages/cli/dist/cli.js`, hejbro v0.2.0-pre.1). Read: the delta, the
two base requirements it replaces (`openspec/specs/catalog-inference/
spec.md`), the round-1 text above (Method, B1, B2, N1-N12, the
scenario list), `skills/hejbro/SKILL.md`, `skills/hejbro/references/
{brownfield-adoption,polyrepo,dsl-cheatsheet}.md`, `README.md`, every
`--help`, the built packages' `index.d.ts` as installed (copied to
`/private/tmp/d106-cf-r2/typings/`), and the archived
`2026-09-06-add-vendored-related/evaluation.md` for shape. Not read:
`proposal.md`, `design.md`, `tasks.md`, `.blackbox/`, `packages/*/src`,
`packages/*/test`, `examples/*/test`, archived proposals, issues, PRs,
git log, changesets. No tool result showed forbidden material (one
`docker logs` dump landed in a tool result by a redirection slip; it
holds only this review's own SQL and the CLI's catalog queries). The
round-1 text above was `md5`-checked before this section was appended
and is untouched.

### Method

One `postgres:17-alpine` (container `d106-cf-r2-pg`, host port 55795,
`log_statement=all`, removed afterwards). Every input is built with
`psql`, never with hejbro, and every project is a real one (`hejbro
init`, `package.json` pointing `hejbro`, `@hejbro/core`, `@hejbro/query`,
`@hejbro/pg` at the built packages through `file:` plus
`pnpm.overrides`). Everything is kept under `/private/tmp/d106-cf-r2/`
(`INDEX.txt` lists it): `sql/` (inputs, the round-trip dumps and their
diff, the Postgres log and the per-session verb summary), one
`proj-*/` per database and command with every stdout/stderr/exit saved
beside it.

- **Round-1 corpus replayed.** The six round-1 databases (`corpus`,
  `gen1`, `enumdb`, `omit`, `pk`, `loc`) were reloaded from
  `/private/tmp/d106-cf/sql/*.sql` (copied to `sql/`) and every
  round-1 command re-run on the new build: `import` and `pull` of
  `corpus` (`proj-corpus/runs/`, `proj-corpus-pull/`), `gen1`
  (`proj-gen1`, `proj-gen1-pull`), `enumdb` (`proj-enum`), `omit`
  (`proj-omit`), `pk` before and after the round-1 extension (`proj-pk`,
  `proj-pk-pull`, `proj-pk/out-order`, `proj-pk-pull-order`, `proj-pk2`
  for the `baseline`/`migrate`/`check`/rename walk), `loc` under
  `C`/`en_US.UTF-8`/`ko_KR.UTF-8` (`proj-loc`). Each stdout was
  `diff`ed against its round-1 counterpart, so what the corrections
  changed is read off the diff rather than guessed.
- **`r2` (`sql/r2.sql`, `proj-r2/`, `proj-r2-pull*/`)**: the cascade
  corpus. Named schemas `g`, `h`, `"Gx"`, `empty_s` (holds nothing),
  `fn_only` (one function), `enum_only` (one enum), `bad_only` (one
  table `"Only"`), `nope` (does not exist); unnamed `ux`. In `g`:
  `plain` with generated columns of every builder shape (`a + b`,
  `upper(a::text)`, a concatenation, `n / 2`, the constant `1`, beside
  an identity column) and an index, a unique index, a unique
  constraint, a check and a foreign key (`plain_ref.tot`) bound to
  them; `gen_name` with `"Amount"` (omitted for its name) and generated
  columns `dbl`, `mixed` (naming `"Amount"` and a kept `qty`), `via_fn`
  (`upper(("Amount")::text)`), `qty2` (kept column only), plus every
  object the delta lists on each: indexes, unique constraints, checks
  (`"Amount" > 0`, `"Amount" > qty`, through `length()`, `check (true)`,
  `qty > 0`), an expression index, a predicate index, two INCLUDE-only
  indexes (`"Amount"`, `dbl`), and `gen_name_ref` with foreign keys onto
  `dbl`, `mixed`, `qty2`; `gen_enum` with `st "Status"`, `st_arr
  "Status"[]`, `ok status` and generated `st_is_x (st = 'x')`, `ok_is_a`,
  `st_arr_len (cardinality(st_arr))`, an index on `st_arr`, an index and
  a unique index on `st_is_x`, checks on `st`, `ok`, `st_is_x`, and
  `gen_enum_ref.ref -> st_is_x`; `gen_type` with `pt point`, `tsv
  tsvector`, `mny money`, `em g.dom` (a domain) and generated `pt_txt`,
  `tsv_len`, `em_up`, `plain_gen (id * 2)`, an index and a unique index
  on `pt_txt`, an index and a unique constraint and a predicate index on
  `mny`, checks on `pt`, `em`, `pt_txt`, and `gen_type_ref` with keys
  onto `pt_txt` and `mny`; `pk_money` (primary key on `money`),
  `pk_enum` (primary key on `"Status"`) and a referencing table each;
  `pk_gen` (primary key on a generated column of a kept column);
  `gen_self` with a generated `"Doubled"` omitted for its own name and
  an index, check, unique constraint and foreign key on it; a
  partitioned `part`/`part_2026`, an `INHERITS` pair `base`/`kid` and a
  mixed-case `"Mixed"`, each with a generated column; `into_ux` with two
  keys into `ux.target`. In `h`: a second `gen_name` (same table name,
  same index name `gen_name_dbl_idx`, same `"Amount"` shape), `ok`
  beside `"Bad"` with a key into `"Bad"` and a self-key. Later added
  (psql heredocs recorded in `proj-r2-probe/`): `g2` with `pk_gen_bad`
  (primary key on a generated column that names `"Amt"`), `dep` whose
  column `a` was renamed to `"A"` after its index, predicate index,
  generated column, check and unique index were created (so the
  dependency is the catalog's, not the original text), `dep_ref`, and a
  view; and the refusal-boundary schemas `seq_only`, `bad_enum_only`,
  `bad_table_plus_seq`, `bad_col_only`.
- **Commands on `r2`**: `import` over all eight named schemas,
  `baseline`, `migrate`, `check` (`proj-r2/runs/`); `pull --schema g`
  and `--schema g` with `Gx`, `nope`, `h`; `pull` and `import` on each
  single-purpose schema alone and in pairs (`proj-r2-pull-*`,
  `proj-r2-probe/probe-*`); the round trip (`sql/rt-r2-baseline-as-
  written.sql` applied with `psql -1` to the empty `r2_rt`, `ux.target`
  pre-created; container `pg_dump --schema-only -n g -n h -n enum_only
  -n ux` of both, `sql/dump-r2-diff.txt`); the way out followed
  literally (`alter table g.gen_name rename column "Amount" to amount`,
  `g.gen_self."Doubled"` to `doubled`, `alter type g."Status" rename to
  status_old`, then `check`, `import --out fresh-out`, `import --out
  src/schema`, the merge, `check`, `verify`); three strict `tsc`
  compiles of pulled contracts.

Execution rows: 64 recorded CLI invocations (import 24, pull 20,
baseline 4, migrate 4, check 9, verify 1, 2 refused by design) plus 21
`init`s; 8 databases loaded, 1 round-trip apply, 2 dumps, 3 renames;
138 CLI catalog-reading sessions isolated in `sql/pg-full.log`
(`sql/reader-sessions.txt`: the only two `pg_depend` sessions holding a
non-`SELECT`/`SET` statement are the two `pg_dump`s).

### Blocking findings

#### R2-B1: `pull`'s primary-key line no longer names the way out

**Sentence contradicted** (requirement 2, first sentence, universal
over commands): "Every command that uses a catalog reading SHALL print
a loss report naming ... every approximation the reading made ... a
primary key whose catalog name is not the derived one is declared
under the derived name, naming the name it dropped and the way out
whole (rename the constraint in the database to the derived name;
keeping it leaves `check` reporting the declared name as missing on
every run, beside its inventory line for the catalog's own name)".

**Input**: `pk` (`sql/pk.sql`: `constraint pk_orders primary key`,
`constraint "PK_Items" primary key`), `hejbro pull --db-url .../pk
--schema shop` (`proj-pk-pull/pull.stdout`, and after the extension
`proj-pk-pull-order/pull.stdout`).

**Observed**: `Approximated: the primary key "shop.orders.pk_orders"
is declared under the derived name "orders_pkey" instead -- the DSL
derives every primary-key name; the pulled contract carries neither
name, since it names no primary key at all -- the bundle's migration
SQL and `schema.json` do carry "orders_pkey".` The dropped name is
named and the consequence stated is true (`contract.ts` holds no
`pkey`/`pk_orders`/`PK_Items` string; `snapshot.sql` lines 14 and 25
and `schema.json` lines 34 and 189 carry `items_pkey`/`orders_pkey`),
but no way out is named: no "rename the constraint to ...", nothing
about `check`. Round 1 measured the previous text of this line
(`Rename the constraint to "orders_pkey" in the database; until you
do, check reports the declared "orders_pkey" as missing on every run
and lists "pk_orders" in its unmanaged-index inventory`) and called
the `check` half misleading for a consumer (N8 b); the correction
removed the whole parenthetical from `pull` and left the requirement
sentence universal. `import`'s line still carries it whole
(`proj-pk/import-order.stdout`, `proj-pk2/import.stdout`) and its
promise was re-verified end to end (S15 below).

**Expected**: either the line names the way out the sentence
prescribes, or the delta scopes the parenthetical to `import` and
states what `pull`'s line says instead (the sentence "SHALL NOT
promise that `check` will report it where `check` will not" pulls the
other way for a consumer who never runs `check`, so the two sentences
have to be reconciled in the text; the code cannot satisfy both as
written).

**Provenance**: opened by the round-1 N8(b) correction; the round-1
`pull` output carried the way out.

#### R2-B2: a schema whose only objects are omitted for their names is refused as "nothing to infer", with no loss report

**Sentences contradicted** (requirement 1): "Leaving an object out for
its name SHALL never stop the reading -- everything else in the named
schemas is still inferred -- and the loss report SHALL name each of
them"; requirement 2: a loss report is printed by "Every command that
uses a catalog reading". Also the reference's own split
(`brownfield-adoption.md`, "`pull`'s own `--schema` handling"):
"`error[pull-nothing-declarable]` when at least one held something
this reading could not carry the name of".

**Input**: `r2` schemas `bad_only` (one table `"Only"`),
`bad_enum_only` (one enum `"Color"`), `bad_table_plus_seq` (table `"T"`
plus a standalone sequence). Commands: `hejbro import --schema
bad_only --out out-bad`, `hejbro pull --schema bad_only`, the same for
the other two, and the pairs `--schema nope --schema bad_only`,
`--schema empty_s --schema bad_only` (`proj-r2-probe/probe-imp-bad*`,
`probe-pull-bad*`, `probe-pull-nope-bad`, `probe-pull-empty-bad`,
`proj-r2-pull-bad/`).

**Observed**: every one exits 1 with `error[import-nothing-to-infer]`
/ `error[pull-nothing-to-infer]`: `found no table, enum, or sequence
to infer in schema(s) bad_only. Next: confirm the schema name(s) are
correct and that the database holds objects in them, then rerun`;
stdout is empty, so no `Guessed`, no `Omitted: table
"bad_only.Only"`, no way out. The schema name is correct and the
schema does hold a table; the way out printed sends the user to the
wrong place. The contrast inputs show the intended shape exists one
level up: `--schema Gx` alone prints the full report (`Omitted: schema
"Gx" ...`) and then `nothing-declarable` naming `Gx`; `--schema
bad_only --schema Gx` prints `Omitted: table "bad_only.Only"` (with
its own consequence sentence: "the omitted table was the only thing
that schema would have declared, so nothing keeps naming it after this
run's own report") but the refusal that follows names only `Gx`
("found nothing it could declare in schema(s) Gx"); and the eight-
schema `import` (`proj-r2/runs/import.stdout`) prints that same line
and writes the other files. So the table-level and enum-level
omissions are classed as "nothing" whenever they are all a schema
holds, and the report that would have named them is skipped.

**Expected**: the report printed (naming `"Only"`, `"Color"`, `"T"`)
and the refusal, if any, the `nothing-declarable` one naming the
schema, exactly as the schema-level case already does.

**Provenance**: `pull`'s two refusals are new in this change; the
reference says `import`'s split "already makes" the same distinction,
and the shipped `import` shows the same classification (no older
binary was run). The delta text is silent on refusals; the
contradiction is with the universal "SHALL name each of them".

### Non-blocking findings

- **R2-N1 -- Foreign-key lines under the type cause, through a
  generated column, state the wrong cause.** `r2`:
  `gen_type_ref.ref -> gen_type.pt_txt` (a generated column naming
  `pt point`): `Omitted: foreign key "g.gen_type_ref.gen_type_ref_ref_fkey"
  -- it references column "g.gen_type.pt_txt", which this reading left
  out because its expression names column "g.gen_type.pt", whose own
  name no declaration can carry, so the key cannot be declared
  either.` (`proj-r2/runs/import.stdout`; the same words in
  `proj-r2-pull/pull.stdout`). `pt`'s name is fine; its type has no
  builder, which the index, check, unique and generated-column lines
  for the same `pt_txt` say correctly ("which this reading did not
  infer, because no column builder expresses its type "point""). The
  first-order type-cause key (`gen_type_ref_m_fkey`, on `money`) is
  right; the enum-cause second-order key (`gen_enum_ref_ref_fkey`) is
  right; only the name-cause template is reused for the type cause on
  the foreign-key kind. The line carries no `Next:` (consistent with
  the reference's "no exit today"), so no false remedy is printed, but
  the reference's "every one of these lines names the column that cost
  it and that column's own cause" does not hold here. Disposition:
  fix.
- **R2-N2 -- The omission band prints two lists for one kind.**
  Requirement 2 (new text): "The omission band is itself several
  ordered lists, one per kind of object it names". Observed order in
  `proj-r2/runs/import.stdout`: schema, table, enum type, index, check,
  unique constraint, generated column, primary key, foreign key,
  column; within the foreign-key kind `h.ok.ok_ref_fkey` (target
  omitted) prints before `g.gen_enum_ref.gen_enum_ref_ref_fkey` (column
  omitted), and in `corpus` `app.orders.orders_bad_schema_ref_fkey` ...
  `orders_ext_bad_table_ref_fkey` print before
  `app.enum_child.enum_child_code_fkey`; the index, unique-constraint
  and check kinds likewise print their own-name list first
  (`app.users.IDX_Users_Email`, `UQ_Users_Item2`, `CK_Users_N`) and
  their column-cascade list after. Each list is code-point ordered and
  identical under three locales (`proj-loc`), so the scenario holds;
  the sentence undercounts the lists (one per kind and cause).
  Disposition: docs (say so) or fix (one list per kind).
- **R2-N3 -- The `nothing-to-infer` text names what it did not look
  at.** `seq_only` (a standalone sequence only): `found no table,
  enum, or sequence to infer in schema(s) seq_only`
  (`probe-imp-seq`, `probe-pull-seq`), while a standalone sequence is a
  Not-inferred object, not nothing; `fn_only` in the eight-schema run
  gets `Not inferred: 1 function(s) not inferred.` and `Not inferred:
  nothing to infer in schema "fn_only".` in one report. Disposition:
  text ("no table or enum to declare").
- **R2-N4 -- INCLUDE columns (round-1 N3), unchanged and not claimed
  fixed.** `gen1`: `t_a_include_idx (a) include (b)` is re-created as
  `create index "t_a_include_idx" on "app2"."t" ("a")`
  (`proj-gen1/migrations`, line 28) with no line; the INCLUDE-only
  dependencies `gen_name_id_incl_amount_idx`, `gen_name_id_incl_dbl_idx`
  and `t_include_omitted_only_idx` are omitted correctly but their
  lines say "its expression names column". After the way out (below)
  the merged starter carries `index("gen_name_id_incl_amount_idx").on(t.id)`
  and `check` passes, because INCLUDE is neither declared nor compared.
  Disposition: fix.
- **R2-N5 -- The unread target's handle is still typed by guess
  (round-1 N7), not claimed fixed.** `existingTable("ux", "target", {
  code: text(), id: text() })` for an integer `id`
  (`proj-r2/src/schema/g.schema.ts`); `plain`'s own key
  (`gen1`: `existingTable("ext2", "plain", { id: text() })`) the same.
  Nothing consumes it; the keys emit and apply on `r2_rt`.
  Disposition: fix or by design.
- **R2-N6 -- A domain and a composite type have no line of their
  own.** `g.dom` (`sql/dump-r2-diff.txt`, `CREATE DOMAIN g.dom`) and the
  corpus's `app.email_domain`/`app.composite_t` appear only through the
  column line's type name (`column "g.gen_type.em" (type "g.dom") -- no
  column builder expresses it`). The reference's list of what neither
  reading carries (#1034) does not name types the DSL has no builder
  for. Disposition: docs.
- **R2-N7 -- The way out ends with a stale snapshot.** After
  `rename`, `import --out fresh-out` and the merge, `check` is clean
  (below) but `hejbro verify` exits 1 with `error[snapshot-stale]`
  (`proj-r2/runs/verify-after-merge.stderr`), and the next step is a
  `generate` whose `add column`/`create index` statements target
  objects the database already holds (the reference's #1037 gap). The
  lines promise only what `check` does, which is true; the reference's
  "merge the new file's declaration into the one already checked in"
  says nothing about the snapshot. Disposition: docs.

Round-1 non-blocking status, measured on the new build: N1 docs
(reference sentence present; `gen1` still `g_tableonly, postgres`),
N2 fixed (S17), N3 open (R2-N4), N4 docs (the #1034 paragraph; the
`r2` dump diff still shows `INHERITS`, `PARTITION BY`, `ATTACH
PARTITION` only on the source side), N5 settled (S14), N6 docs
(`foo__bar`/`foo_bar_` example in the reference), N7 open (R2-N5),
N8(a) fixed (`pull`'s column-cause key lines read "... so the key
cannot be carried either", `proj-corpus-pull/pull-corpus.stdout` vs
round 1), N8(b) changed into R2-B1, N8(c) fixed (`Omitted: unique
constraint "app.users.UQ_Users_Item2"` in both commands), N9 docs, N10
docs, N11 fixed (S13), N12 open (`t2`, `bad_col_only`), not a delta
subject.

### Scenarios verified

Requirement 1, *A catalog reading yields a snapshot and a marked
description*:

1. **Round-1 B1 closed: generated columns are read, emitted,
   compared and typed read-only.** `gen1`: `total:
   integer().generatedAlwaysAs(sql.raw("(a + b)"))`, `label:
   text().generatedAlwaysAs(sql.raw("upper((a)::text)"))`
   (`proj-gen1/src/schema/app2.schema.ts`); `corpus`: `fullLen:
   integer().generatedAlwaysAs(sql.raw("length(email)"))`
   (`app.schema.ts` line 198); `r2`: all ten kept generated columns
   (`plain.total/label/both_txt/n_half/one`, `gen_type.plain_gen`,
   `base/kid/part/part_2026.v2`, `gen_enum.ok_is_a`, `gen_name.qty2`,
   `pk_gen.id2` under `.primaryKey()`). `baseline` emits `generated
   always as (...) stored` for each (`proj-r2/migrations`, `proj-gen1/
   migrations` lines 18-19, corpus line 169); `check` against the
   imported database exits 0 with `no differences` on `gen1` and `r2`
   (corpus exits 1 only for the announced `orders_created_by_fk`
   derived name, S16); the round trip keeps every one (none appears in
   `sql/dump-r2-diff.txt`); the pulled contracts' `Insert`/`Update`
   omit them (`proj-r2-pull/.hejbro/vendor/contract.ts` `plain`:
   Insert holds `id, a, b, n` only; `gen1` `t`: `id?, a, b, plainId?,
   otherCode?, userId?`), `Row` keeps them; the Approximated blanket
   line now reads "every default, check, generated, and
   index-predicate expression". A primary key on a kept generated
   column (`pk_gen`) and a foreign key onto one (`plain_ref.tot ->
   plain.total`, `gen_name_ref.qty2_ref -> gen_name.qty2`) survive and
   apply on `r2_rt`.
2. **Round-1 B2 closed on the corrected sentence.** "carrying no
   relation for it ... the contract gives a relation only where the
   target has a `Tables` key": `gen1` contract `Relationships` lines
   35-45 name `ext2.other`/`ext2.plain`, `Relations: {}` line 49,
   `contractMetadata.tables.t.foreignKeys` lines 83-84; `r2` `into_ux`
   `Relationships` (lines 186-194, `ux.target`), `Relations: {}` (198),
   `foreignKeys` (510-511), no `"target"` entry among `Tables` (keys
   listed: 20 tables of `g`); `corpus` `orders` `Relationships` carry
   `ext.things` twice (lines 45, 51) and `Relations` holds `user` only.
   All three contracts compile under `tsc --strict
   --exactOptionalPropertyTypes` (exit 0).
3. **Read-only, with the dependency query.** 138 CLI sessions that
   ran the `pg_depend` query sent only `set` and `select`
   (`sql/reader-sessions.txt`); the two `pg_dump` sessions are the only
   `pg_depend` sessions with `BEGIN`/`LOCK`/`PREPARE`. Dependency is
   the catalog's, not the text: `g2.dep`'s column `a` renamed to `"A"`
   after its objects were created, and every line names `"g2.dep.A"`
   (`probe-imp-g2.stdout`); the predicate index
   `gen_name_qty_where_amount_idx`, the expression index
   `gen_name_amount_expr_idx` and the INCLUDE-only indexes are found
   through the dependency rows.
4. **A column left out for its name takes its generated columns,
   and they take their own objects (second order).** `gen_name`:
   `dbl`, `mixed`, `via_fn` omitted ("its expression names column
   "g.gen_name.Amount""); with them `gen_name_dbl_idx`,
   `gen_name_mixed_idx`, `gen_name_id_incl_dbl_idx`, `gen_name_dbl_uq`,
   `gen_name_mixed_uq`, `gen_name_dbl_chk`, `gen_name_ref_dbl_ref_fkey`,
   `gen_name_ref_mixed_ref_fkey`; `qty2` (kept column only) and its
   index, unique constraint and key stay; `gen_self."Doubled"` (a
   generated column omitted for its own name) takes
   `gen_self_doubled_idx`, `_uq`, `_chk`, `gen_self_ref_d_fkey`;
   `g2.pk_gen_bad` loses `amt2` and with it `pk_gen_bad_pkey` ("the
   table is declared without a primary key") and
   `pk_gen_bad_ref_r_fkey`. The starter loads (`baseline`: `loaded 27
   declarations`), none of them reaches the starter, the snapshot SQL
   or the pulled contract, and no Approximated line names any of them
   (the Approximated band holds `gen_name_qty2_uq`, `plain_total_uq`
   and the blanket line only).
5. **The enum cause cascades the same way.** `gen_enum.st`, `st_arr`,
   `pk_enum.st`, `pk_enum_ref.st`, `st2` omitted with `"Status"`;
   generated `st_is_x`, `st_arr_len` omitted with them; then
   `gen_enum_st_is_x_idx`, `_uidx`, `gen_enum_st_is_x_chk`,
   `gen_enum_st_arr_idx`, `gen_enum_st_chk`, `gen_enum_ref_ref_fkey`,
   `pk_enum_pkey`, `pk_enum_ref_st_fkey` (one line for the enum-to-enum
   key); `ok`, `ok_is_a`, `gen_enum_ok_chk` on the kept `status` stay.
6. **The type cause cascades the same way, without a `Next:`.**
   `gen_type.pt/tsv/mny/em` are `Not inferred` (with their types
   `point`, `tsvector`, `money`, `g.dom`); generated `pt_txt`,
   `tsv_len`, `em_up` omitted ("which this reading did not infer,
   because no column builder expresses its type"); then
   `gen_type_pt_txt_idx`, `_uidx`, `gen_type_pt_txt_chk`,
   `gen_type_mny_idx`, `gen_type_id_where_mny_idx`, `gen_type_mny_uq`,
   `gen_type_pt_chk`, `gen_type_em_chk`, `gen_type_ref_m_fkey`,
   `gen_type_ref_ref_fkey`, `pk_money_pkey`, `pk_money_ref_m_fkey`;
   none of these lines carries a `Next:`; `plain_gen (id * 2)` on the
   same table stays. The foreign-key cause text is R2-N1.
7. **Partitioned, inherited and mixed-case tables.** `part`,
   `part_2026`, `base`, `kid` keep `v2` as a generated column; `"Mixed"`
   is omitted whole with `mixed_v2_idx` (one table line, no index
   line), `h."Bad"` likewise and `h.ok` keeps `ok_ref2_fkey` while
   `ok_ref_fkey` is named with "references table "h.Bad"".
8. **Same names across schemas.** `g.gen_name` and `h.gen_name`, each
   with `gen_name_dbl_idx`, are read into two starter files with their
   own lines (`h.gen_name.gen_name_dbl_idx`, `h.gen_name.dbl`,
   `h.gen_name.Amount`); `pull --schema g --schema h` refuses with
   `pull-table-name-collision` naming both and writes nothing, as
   `polyrepo.md` says.
9. **A reference into a schema the run did not name is kept**
   (scenario). `into_ux.t/c -> ux.target(id/code)`: unexported
   `uxTargetRef`, both keys declared against it, emitted by `baseline`
   and applied on `r2_rt` (`APPLIED-TO-EMPTY`), carried in the
   contract as in S2, no report line contains `ux.target`, no
   `ux.schema.ts` written; the description records `ux.target` as
   `existing: true` (`schema.json` line 778).
10. **What is not inferred is named / description records what the
    database holds.** `r2`: `1 function(s)` (`fn_only.f`), `1 view(s)`
    (`g2.dep_view`), the seven typed column lines, `grants beyond their
    role name`; the pulled description carries `amount`, `mixed`,
    `doubled` keys for the omitted columns (`schema.json` lines 897,
    912, 968) while the snapshot SQL and contract carry none of them.
11. **Round-1 scenarios on the replayed corpus stand.** Every
    round-1 stdout differs from its replay only in the corrected text
    (the `Next:` tails, the unique-constraint noun, `pulled corpus
    (app, aux)`, the two `pull` Approximated lines, the un-doubled
    clause); the starter files of `loc` are byte-identical under the
    three locales and identical to round 1's report order
    (`B_table`, `Zeta`, `é_nfd`, `é_nfc`; `IDX_a`, `IDX_b`, `idx_A`;
    `É_col`, `é_col`); the corpus baseline still emits `chk_positive`
    against each of `a_c` and `ab` (lines 59, 66) and `create unique
    index` for `users_email_key`/`users_user_id_uq` (178, 184); the
    corpus roles are `app_auditor, app_reader, app_schemagrant,
    app_writer, postgres` in the report and the contract (`roles`
    line 430) with no `public`.
12. **Code-point order in the starter.** `g.schema.ts` declares
    `base, gen_enum, gen_enum_ref, gen_name, gen_name_ref, ..., plain,
    plain_ref` (dependency kept: each `_ref` after its target), indexes
    `plain_label_uidx, plain_total_idx, plain_total_uq`, keys
    `into_ux_c_fkey, into_ux_t_fkey`; enum values `["a","b"]`,
    `["x","y"]` in catalog order.

Requirement 2, *The loss is announced, with the way out*:

13. **`pull`'s schema list.** `pull --schema g --schema Gx` and
    `--schema g --schema nope` both print `pulled r2 (g)`, write
    `hejbro.lock` `schemas: ["g"]` and `contractMetadata.schemas:
    ["g"]` (`proj-r2-pull-gx`, `proj-r2-pull-nope`); `corpus` now
    `pulled corpus (app, aux)` with the lock `["app","aux"]` (round 1:
    `BadSchema` listed). `Not inferred: nothing to infer in schema
    "nope".` prints in the Not-inferred band, after the typed-column
    lines, once per named-but-absent or empty schema (`empty_s`,
    `fn_only`, `nope` in the eight-schema `import`), never for an
    omitted schema (`Gx` gets its Omitted line instead).
14. **The Approximated band's order** (round-1 N5). `pk` extended:
    UNIQUE (`orders_code_key`), nextval (`seqd`), foreign key
    (`FK_Orders_Buyer` -> `orders_buyer_fk`, both names), primary key
    (`PK_Items` -> `items_pkey`, `pk_orders` -> `orders_pkey`),
    expressions -- the order the corrected sentence states, in
    `import` (`proj-pk/import-order.stdout`) and `pull`
    (`proj-pk-pull-order/pull.stdout`).
15. **A dropped primary-key name is announced with the way out**
    (scenario), `import`. `proj-pk2`: after `baseline` + `migrate`,
    `check` exits 1 with `error[check-object-missing]:
    shop.orders.orders_pkey` and `shop.items.items_pkey` on stderr and
    `unmanaged index (backs constraint pk_orders ...): shop.orders.pk_orders`
    / `PK_Items` on stdout; after `alter table ... rename constraint`
    (both) only the announced `orders_buyer_fk` finding remains and the
    inventory is empty. The `pull` half is R2-B1.
16. **FK derived name.** `FK_Orders_CreatedBy` -> `orders_created_by_fk`
    named with both names; `check` on `corpus` reports the declared
    name missing (exit 1), as the `import` line says; `pull`'s line now
    says "the pulled contract carries "orders_created_by_fk" in its
    foreign-key metadata, never "FK_Orders_CreatedBy"", and the
    contract, `snapshot.sql` and `schema.json` hold exactly that name
    (`grep`: one each, no `FK_Orders_CreatedBy`).
17. **The way out followed literally, to the end** (round-1 N2).
    `r2`: after `rename` alone, `check` still lists `g.gen_name.amount`,
    `dbl`, `mixed`, `via_fn`, `g.gen_self.doubled` and the `status_old`
    columns as unmanaged (28 matching lines, `check2-after-rename.stdout`)
    -- renaming never ends the listing; `import --schema g --out
    fresh-out` exits 0 and its report carries no line for `gen_name`,
    `gen_self` or the enum (only the type-cause lines and `Mixed`
    remain); `import --out src/schema` refuses with
    `import-destination-exists`, as the line's "fresh `--out`" implies;
    merging the fresh `g.schema.ts` over the checked-in one (diff:
    `statusOld` enum, `amount`, `dbl`, `mixed`, `viaFn`, `doubled`, the
    `st*` columns, and every index/check/unique/key the cascade had
    dropped) makes `check` exit 0 with `no differences` and no
    inventory line for any of them (24 lines remain, all type-cause,
    `Mixed`, `Bad`, `h.gen_name`). `verify` afterwards is R2-N7.
18. **What each omission line says `check` will do, measured.**
    `proj-r2/runs/check1.stdout` lists exactly the objects the lines
    name: 2 tables (`g.Mixed`, `h.Bad`), 24 columns (3 by name, 5 by
    enum, 9 generated, 7 by type), 21 indexes (15 plain, 4 backing the
    omitted unique constraints, 2 backing `pk_enum_pkey`/`pk_money_pkey`),
    10 check constraints; no line names `g.Status` (no enum axis), no
    line names anything under `Gx` (the schema line's "`check` will not
    list them") or `bad_only.Only` (the table line's "nothing keeps
    naming it after this run's own report"); foreign-key lines promise
    nothing about `check` and `check` lists no foreign key.
19. **Two refusals and the report around them.** `pull --schema nope`
    -> `pull-nothing-to-infer`, nothing written; `pull --schema Gx` ->
    the report (Guessed, Not inferred, Approximated, `Omitted: schema
    "Gx"`, the way-out line) then `pull-nothing-declarable` naming
    `Gx`, nothing written (`.hejbro/` absent); `--schema nope --schema
    Gx` -> `Not inferred: nothing to infer in schema "nope".` plus the
    `Gx` line, then `nothing-declarable` naming `Gx` only; `--schema
    fn_only --schema enum_only` -> `pulled r2 (enum_only)` with the
    function counted and `nothing to infer in schema "fn_only"`;
    `import` mirrors each with its own codes. The table-only and
    enum-only cases are R2-B2.
20. **The report names the way out** (scenario). Every `pull` ends
    with `The loss ends when you link the schema repository.` and
    every `pull` Omitted line with "then link the schema repository";
    every `import` ends with `The loss ends when you hand-edit the
    starter declarations.`; each starter file's header carries the same
    lines as the terminal.
21. **An omitted enum's line / an omitted object's line** (scenarios).
    `Omitted: enum type "g.Status" ... every column typed by it is
    left out with it: "g.gen_enum.st", "g.gen_enum.st_arr",
    "g.pk_enum.st", "g.pk_enum_ref.st", "g.pk_enum_ref.st2". `check`
    keeps naming each of them as unmanaged until it is declared, and
    never names the type itself -- its inventory has no enum axis.
    Next: rename the type in the database, then re-run `hejbro import`
    into a fresh `--out` and merge the declarations, or declare them
    by hand.`; `omit` replay: index, check and table lines unchanged
    but for the `Next:` tail, each "until it is renamed in the database
    and declared".

### Verdict

**BLOCKED** -- R2-B1, R2-B2. 2 blocking, 7 non-blocking, 21 scenario
and universal-sentence entries verified. Round-1 B1 and B2 are closed
on the shipped build and the corrected text (S1, S2); the cascade the
corrections added holds in every shape constructed (S4-S7) with one
wrong cause sentence (R2-N1); N2, N5, N8(a)(c) and N11 are fixed and
the reference's new sentences match measurement (N1, N4, N6, N9, N10,
the refusal split except for R2-B2). R2-B1 is a text-versus-output
contradiction opened by the N8(b) correction and is likely settled in
the delta; R2-B2 is a shipped-behaviour gap at the boundary the new
refusals introduced.
