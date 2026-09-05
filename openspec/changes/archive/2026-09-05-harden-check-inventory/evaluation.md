# D106 round 1 — harden-check-inventory

## Method

Context-free input construction (D110). The delta
(`openspec show harden-check-inventory --diff`: `cli-commands` MODIFIED ×2,
`catalog-inference` MODIFIED ×1) and the public surface (`skills/hejbro`,
the built `packages/cli/dist/cli.js`) were the only things read; the
proposal, design, tasks, implementation source and tests were not.

- Worktree `_tmp-d106-cv` at `727a6f8d`, built with `TURBO_FORCE=1 pnpm build --force`
  (`hejbro v0.2.0-pre.1`), node v26.7.0, macOS 26.6.2.
- Database: own container `d106-cv-pg`, `postgres:17` → PostgreSQL 17.11, host port 55437.
- Inputs: 6 scratch projects (`/private/tmp/d106-cv/p1…p6`) over 6 databases
  (`app`, `adopt`, `ext`, `misc`, `sorta`, `sortb`); ~90 hand-added
  database-only objects — plain / generated / identity / dropped / mixed-case /
  `_id` / `a*/b` / NFC-NFD / newline- and quote-bearing columns; plain, partial,
  expression, unique, constraint-backing (PK, UNIQUE, EXCLUDE), FK-referenced
  and undeclarable-name indexes; check constraints, one sharing its name with an
  index; unmanaged, partitioned, partition-child and unlogged tables; a view and
  a materialized view with its own index; an `existingTable()` table; two schemas
  holding same-named tables; a schema no declaration touches; a DB-only trigger,
  function, RLS policy and sequence. 6 `check` runs across two databases × three
  locales (`en_US.UTF-8`, `sv_SE.UTF-8`, `C`) for order determinism, plus the
  full `import → baseline → migrate → check → rename → check → declare → check`
  round trip and a `pull` run.

**BLOCKING 1 / NON-BLOCKING 3 / OK 12**

---

## BLOCKING

### B1 — `pull`'s omitted-index and omitted-check lines promise a `check` listing that `pull`'s own channel never produces

Command (project `p6`, which has no declaration files — the shape `pull` writes,
`.hejbro/vendor/{contract.ts,schema.json,snapshot.sql}` plus `hejbro.lock`):

```
hejbro pull --db-url postgres://…/misc --schema m
```

SQL behind it:

```sql
create index "idx
newline" on m.kept ("Label");
alter table m.kept add constraint "chk!bad" check (id is not null);
create table m."tbl!bad" (a int primary key);
alter table m.kept add column "Label" text;
```

Observed (one report, three omission kinds side by side):

```
Omitted: table "m.tbl!bad" -- its catalog name is not a valid hejbro SQL identifier, so it cannot be
  carried in the contract, with everything it holds. Rename the table in the database, then link the
  schema repository.
Omitted: index "m.kept.idx
newline" -- … `check` keeps listing it as unmanaged until it is renamed in the database and declared;
  a hand-written declaration under a different name only adds a second one.
Omitted: check constraint "m.kept.chk!bad" -- … `check` keeps listing it as unmanaged until it is
  renamed in the database and declared; a hand-written declaration under a different name only adds
  a second one.
Omitted: column "m.kept.Label" -- no declaration key produces this SQL name back, so it cannot be
  carried in the contract. Rename the column in the database, then link the schema repository.
The loss ends when you link the schema repository.
```

`check` in that same project:

```
$ hejbro check
error[entry-not-found]: src/**/*.schema.ts
  hejbro.config.ts's entry pattern "src/**/*.schema.ts" matched 0 files. …
exit=1
```

The table line and the column line are `pull`-shaped (contract, linking); the
index and check-constraint lines are the `import` text, unchanged for this
channel. A `pull` consumer holds no declarations of the producer's schema —
`pull` writes none, and its own remedy in every other line is *link the schema
repository*, not *declare it*. `check` there lists nothing about
`m.kept."idx\nnewline"` (it cannot even run without declaration files), so
"`check` keeps listing it as unmanaged" and "a hand-written declaration under a
different name only adds a second one" are both false in the report that prints
them.

Judged against `catalog-inference` / "The loss is announced, with the way out":
"the consequence it states SHALL be what hejbro will actually do about that
object afterwards … and SHALL NOT promise that `check` will report it where
`check` will not". The delta's scenario ("An omitted object's line says what
check will do about it") is satisfied for `import` (see OK10) and contradicted
for `pull`, which is the channel the requirement's own surviving scenario
("WHEN `pull --db-url` completes") is written about.

---

## NON-BLOCKING

### N1 — `skills/hejbro` still carries the two claims this change makes false

`skills/hejbro/references/brownfield-adoption.md` was updated in its `check`
section (lines 122–133 now describe the object-level inventory and the
constraint-backing rule) but not in its `import`/`pull` loss section:

- line 279: "`check` keeps reporting that column as undeclared **until it's
  renamed in the database**" — the delta explicitly forbids stating renaming
  alone as the end of the reporting ("Renaming alone SHALL NOT be stated as the
  end of the reporting"), and the shipped CLI line now says "renamed in the
  database **and declared**". Measured: after
  `alter table shop.users rename column "createdAt" to created_at`, `check`
  still prints `unmanaged column (not covered by any declaration): shop.users.created_at`.
- lines 288–289: "an **index** or a **check constraint** whose own name is not
  (each is **never mentioned again**, since `check` compares only what is
  declared)" — measured false: `unmanaged index (not covered by any
  declaration): shop.orders.orders total*idx` and `unmanaged check constraint
  (not covered by any declaration): shop.orders.total>0`.

One file now says both things. Not judged BLOCKING because the delta's sentences
bind the loss report and `check`, not the skill; but the skill is the documented
public surface, and AGENTS.md's own gate ("a stale skill is a broken user
contract") points at exactly this paragraph.

### N2 — an adopted key whose catalog name differs is reported twice, under two names, with nothing tying the two lines together

```sql
create table shop.users (id uuid constraint users_pk_custom primary key, …);
```

`hejbro import --schema shop --out src` (which does not carry a primary key's
catalog name into the declaration), then `baseline`, then:

```
unmanaged index (backs constraint users_pk_custom; not covered by any declaration): shop.users.users_pk_custom
error[check-object-missing]: shop.users.users_pkey
  declared primary key "shop.users.users_pkey" was not found in the database. …
check: 2 finding(s) …   exit=1
```

Both lines are individually correct and follow the requirement as written (no
declaration *names* `users_pk_custom`). The exit-1 half is pre-existing (import
carries a foreign key's catalog name — D106 R3 — but not a primary key's).
What this change adds is a second line about the same physical key under its
other name, in the first `check` a brownfield adopter ever runs, with no hint
that the "unmanaged" index and the "missing" primary key are one object. The
boundary bullet's own justification ("a database hejbro's own migration produced
would otherwise report an unmanaged index for every key it declared") does not
extend to a database hejbro adopted.

### N3 — the inventory's kinds stop at three, while the line text reads as a coverage claim

On a managed table (`m.kept`, declared, all columns declared), the following
produce no inventory line, no finding and no exit code, and `check` ends with
`check: no differences.`:

```sql
create sequence m.orphan_seq;
create function m.f() returns trigger …;
create trigger kept_trg before insert on m.kept for each row execute function m.f();
alter table m.kept enable row level security;
create policy kept_pol on m.kept using (true);
create view m.v_kept as select id from m.kept;
create materialized view m.mv_kept as select id from m.kept;   -- with its own index
create type m.mood as enum ('a','b');
```

The delta enumerates the three kinds ("a table, and — on a table the
declarations manage — a column, an index and a check constraint") and defers
other *constraint* kinds to #859, so this is not a contradiction. It is worth
recording because the requirement's opening reads wider ("every object the
database holds inside the declared schemas that no declaration covers"), because
row-level security **is** in hejbro's DSL yet a database that turns RLS on and
adds a policy under a declaration that declares neither still passes silently,
and because a printed `unmanaged …` axis makes a passing `check` more, not less,
persuasive about the kinds it does not read.

---

## OK

Each verified with constructed inputs; every `check` invocation below was run
directly (not through a pipe) when an exit code is quoted.

**OK1 — a column the database holds and no declaration covers is reported without failing.**
Declaration `app.posts { id, ownerId → users.id, title }` + `app.users { id, email unique }`,
migrated by hejbro itself; then `alter table app.posts add column legacy_note text`,
`… add column gen_col text generated always as (title || 'x') stored`,
`… add column ident_col int generated always as identity`,
`… add column "createdAt" timestamptz`, `… add column "_id" int`, `… add column "a*/b" int`,
plus `alter table app.posts add column to_be_dropped text; … drop column to_be_dropped`.
`hejbro check` printed one line each for `_id`, `a*/b`, `createdAt`, `gen_col`,
`ident_col`, `legacy_note`, no line for the dropped column, no line for any
system column, no difference for any of them, `exit=0`. `shop.users.createdAt`
and `shop.users._id` — the two columns `import` had just omitted — were listed
by the same rule (OK10).

**OK2 — an index and a check constraint on a managed table are reported without failing.**
`create index posts_title_idx on app.posts (title)`, `… posts_partial_idx … where title <> ''`,
`… posts_expr_idx on app.posts (lower(title))`, `create unique index posts_uq_idx on app.posts (id, title)`,
`alter table app.posts add constraint posts_title_chk check (title <> '')`.
All five listed by schema, table and name, no difference reported, `exit=0`.

**OK3 — an index backing a declared key is not called unmanaged.**
The declaration above declares a primary key on each table and `.unique()` on
`app.users.email`; hejbro's own migration created `app.users_pkey`,
`app.posts_pkey`, `app.users_email_key` (verified in `pg_index`). No inventory
line named any of the three, `exit=0`. Same for the adopted database once its
keys carry the derived names, and for `shop.users_email_unique`, a real UNIQUE
*constraint* in the database declared as a same-named unique index.

**OK4 — an unmanaged index that backs a constraint names that constraint, once.**
`alter table app.posts add constraint posts_uq_con unique (title, id)` →
`unmanaged index (backs constraint posts_uq_con; not covered by any declaration): app.posts.posts_uq_con`.
Same for a database-only primary key (`kept_pk`) and an exclusion constraint
(`kept_excl exclude using gist (r with &&)`). The foreign-key trap the delta
calls out was probed directly: `alter table app.users add constraint users_code_uq unique (code)`
with `app.ref_a` and `app.ref_b` both `references app.users(code)` produced
**exactly one** line, naming `users_code_uq` — not one per referencing foreign
key, and never under a foreign key's name.

**OK5 — an unmanaged table's own objects are not listed under it.**
`create table app.legacy (a int primary key, b text, constraint legacy_b_chk check (b <> ''))`
+ `create index legacy_b_idx on app.legacy (b)` produced one line
(`unmanaged table … app.legacy`) and no line mentioning `legacy_b_idx`,
`legacy_b_chk`, `legacy_pkey`, `a` or `b`. Same for `shop."bad table!"` and for
a partitioned parent with two partitions (`m.events`, `m.events_2025`,
`m.events_2026` — three table lines, nothing beneath them, including
`events_at_idx` and `events_chk`).

**OK6 — an existing declaration's own objects are never inventoried.**
`existingTable("plat", "accounts", { id, email })` against a database table
holding `extra_col`, `secret`, `accounts_extra_idx` and `accounts_chk`: `check`
printed only `check does not compare plat.accounts: declared existing and not
compared.` and no inventory line for the table or anything on it, `exit=0`.

**OK7 — the inventory is ordered the same way on every run.** Six `check` runs
over the two sort databases printed byte-identical inventory blocks (36 lines).

**OK8 — the order does not depend on a collation.** Two databases holding the
same 12 unmanaged columns, 12 indexes and 12 check constraints, created in
opposite orders, run under `LC_ALL=en_US.UTF-8`, `sv_SE.UTF-8` and `C`: all six
outputs identical, in UTF-16 code-unit order
(`0a` < `A*b` < `AB` < `Ab` < `_a` < `aB` < `a_b` < `ab` < `e`+U+0301`x` < `z` < `ä` < `éx`).
The NFC/NFD pair (`c3a978` and `65cc8178`, both real columns of `srt.t`) is kept
distinct and stably ordered; `sv_SE`'s placement of `ä` after `z` and `en_US`'s
case folding change nothing.

**OK9 — exit codes.** Inventory alone (20 inventory lines over `app`) → `exit=0`.
`alter table app.posts rename column title to title2` → the same inventory plus
`error[check-object-missing]: app.posts.title` and `check: 1 finding(s)` →
`exit=1`, with `title2` itself appearing as an unmanaged column. Two findings
plus inventory in the adopted database → `exit=1`.

**OK10 — the loss report and the round trip agree.** `import --schema shop`
against a database holding `shop."bad table!"`, `shop.orders."orders total*idx"`,
`shop.orders."total>0"`, `shop.users."createdAt"`, `shop.users."_id"` printed
five `Omitted:` lines, each ending "`check` keeps listing it as unmanaged until
it is renamed in the database **and declared**" (the table line: "keeps listing
the table itself in its unmanaged-table inventory … until it is renamed in the
database and declared"); no line said hejbro would not mention the object again.
`baseline` → `migrate` (registered, not executed) → `check` then listed
**exactly** those five objects and nothing else, `exit=0`. After renaming all
five in the database, `check` listed all five under their new names — renaming
alone ended nothing. After declaring them (two columns, an index, a check
constraint, the table), every one of the five lines disappeared.

**OK11 — existence only, by identity.** Columns of a domain, an enum, a
composite, an array, `tsvector` and `int4range` types, generated and identity
columns, and columns holding a quote or a newline in their names are listed
without reading a type, default or expression and without an error. A column
`"Label"` on a table declaring `label` is listed (identity is exact, not
case-folded); `check` reported no difference for any of them.

**OK12 — the remaining boundaries.** A schema no declaration touches
(`untouched`, with a table, an index and a check constraint) produced no line.
A view, a materialized view and the materialized view's own index in a declared
schema produced no line (they are not managed tables). An index and a check
constraint sharing the name `shared_name` on the same managed table were both
listed, once each, on their own axis. Declaring a *check* named `dup_name` did
not suppress a database-only *index* named `dup_name` (and vice versa): both
were inventoried, and both declarations were reported missing — kinds are not
collapsed by a matching name. `check` renders identically to a TTY and to a
pipe (no second output mode: `check` exposes only `--url`).

## Observations (not findings)

- An identifier containing a newline (`m.kept."weird\nname"`,
  `m.kept."idx\nnewline"`) is printed raw, so its inventory line spans two lines
  and no quoting marks the boundary. The pre-existing table axis behaves the same
  way, and the sort stays deterministic; recorded only because this change adds
  three more axes that emit catalog names verbatim.
- `hejbro import` does not carry a primary key's catalog name into the starter
  declaration the way it now carries a foreign key's (D106 R3), which is what
  makes N2 visible on the first `check` after an adoption.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling `.blackbox/707/` R5).

- **B1** — repaired here (tasks.md 2.1): `pull`'s omitted-index and omitted-check-constraint lines now state `pull`'s own consequence — the object cannot be carried in the contract; rename it in the database, then link the schema repository — and no longer promise a `check` listing that a pull consumer never sees. The `import` lines are unchanged.
- **N1** — repaired here: the skill's loss section says the column stays reported until it is renamed *and declared*, and that `check` keeps listing an omitted index or check constraint.
- **N2** — the two-line shape of an adopted key under a foreign name is what #872 (carry the primary key's catalog name into the starter declaration) resolves; the measured shape is recorded there.
- **N3** — the inventory's kinds versus the requirement's opening sentence → recorded on #859, whose scope is the object kinds hejbro declares.

Archived at this disposition.
