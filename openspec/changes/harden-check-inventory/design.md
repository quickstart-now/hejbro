# Design: harden-check-inventory (#707, #726)

Open decisions for the owner-delegated lead, each as background →
options → recommendation. Nothing here is settled by the implementer.

## Rulings (lead, `.blackbox/707/` R1 and `.blackbox/726/` R1)

The proposal is approved and every question below is settled. The
recommendations stand as written, with one addition and one consequence:

- **Q4** is (a) **plus** a reporting clause: an index this inventory
  reports while it backs a constraint SHALL say so, from the catalog's
  own fact — `unmanaged index (backs constraint <name>; not covered by
  any declaration): <identity>`. A line that named only the index would
  send a reader looking for an index nobody wrote.
- A fourth kind — `unmanaged constraint` for a database-only primary
  key, unique, foreign key or exclusion constraint — is inside hejbro's
  purpose but is its own change: **#859**, filed under #815. This change
  does not touch it.
- Q5's annotation idea (`check` applying the D36 identifier rule to say
  *why* a name cannot be declared) stays recorded here as a candidate
  and gets no issue.
- The changeset is `minor`.

**Consequence for the catalog read (planner, from the Q4 clause).** "The
constraint this index backs" is `pg_constraint.conindid`, and today's
`indexes` query does not select it. Deriving it by matching the index's
name against the constraint names on the same table would be *nearly*
right — Postgres gives a constraint's backing index the constraint's own
name (M4) — but a plain index that happens to carry a name like
`users_email_fkey` would then be annotated as backing a constraint it
has nothing to do with. The `indexes` query therefore gains
`constraintName` from a join on `conindid`, and the exclusion rule reads
that field rather than comparing names: an index is excluded when the
constraint it backs is one the declarations name (the declared primary
key, a declared column's unique constraint). One join on a query
`check` already issues — no new statement, no new round trip, no new
privilege.

## What is already fixed by the code, not by a decision

`check/catalog.ts` already reads the **whole** catalog inventory
unfiltered — every column (`attnum > 0 and not attisdropped`), every
`pg_index` row, every `pg_constraint` row of type `p`/`u`/`f`/`c` — and
`compare.ts` narrows to the declared objects in TypeScript. So an
object-level inventory needs **no new catalog query, no new round trip
and no new privilege**: it is a set difference over rows `check` already
has in hand. That keeps this change inside `check`'s standing constraints
(read-only statements, no driver capability, no transaction) by
construction rather than by care.

## Q1 — Is a database-only object a finding, or inventory?

**Background.** The requirement being modified already answers this for
tables, with a reason: hejbro cannot emit a migration for a table it does
not declare, so reporting it as a difference "would hand the user a
failure with no fix". The same holds one level down. A column the
database has and the declarations do not cannot be fixed by `generate`:
declaring it emits `add column`, which fails against a database that
already has it; the real remedies are `import`/`baseline`, or dropping it
in the database by hand. The comparison-surface list in "Declarations can
be checked against a live database" carries the same parenthetical for
grants ("a table hejbro does not declare is inventory, never a finding").
`import`'s own loss report already describes `check`'s naming of such a
table as "informational, never a failing check".

**Options.**
- (a) Informational inventory, exit code unaffected — one rule with the
  table axis.
- (b) A `Finding` with a new code, exit 1 — "my declarations do not cover
  this database" becomes a failing condition.
- (c) `check-not-compared`, exit 2 — wrong on its face: the object was
  not left uncompared, it was never a declared object at all, and exit 2
  is reserved for "I could not find out".

**Recommendation: (a).** (b) would make every brownfield database fail
`check` forever with no command that clears it, which is the failure mode
the existing rule was written against; it would also flip the exit code
of databases that pass today, a behavior change far past the two issues.
The user-visible promise #726 is about ("`check` reports this column") is
satisfied by (a): the report names it on every run.

## Q2 — What does the line look like?

**Background.** The one shape today is
`unmanaged table (not covered by any declaration): app.users`, printed in
the inventory section beside `installed extensions: …`, never with a code
or a `Next:` line (inventory is not a diagnostic).

**Options.**
- (a) One shape per kind, same sentence:
  `unmanaged column (not covered by any declaration): app.users.legacy_note`,
  `unmanaged index (…): app.users.users_legacy_idx`,
  `unmanaged check constraint (…): app.users.users_legacy_ck`.
- (b) One line per kind group, comma-joined
  (`unmanaged columns: a.b.c, a.b.d`) — shorter on a wide database,
  but breaks the one-object-per-line shape the table axis set.
- (c) Nest under the table (`app.users: 2 unmanaged columns …`).

**Recommendation: (a).** It is the existing sentence with the kind word
varying, so nothing about the section's shape has to be relearned, and
every line stays greppable by the identity it names — the property the
"Differences are reported per object, never as a diff" requirement
protects for findings and this section already honours.

## Q3 — Where does the inventory boundary sit at object level?

**Background.** The table axis is bounded twice: the table's schema must
be one a declaration touches (`declaredSchemaNames`, which since D106 R3
deliberately does *not* count an `existingTable()` node), and the table
must not be covered by a `table:` declaration. At object level the same
two questions recur, plus a new one: what about objects on a table that
is itself unmanaged?

**Options** for objects on an unmanaged table:
- (a) Do not list them; the table's own line stands for everything on it
  (the "missing takes precedence, reported once" idiom the coverage rules
  already use).
- (b) List them too — one unmanaged 40-column table then prints 40+ lines
  that say nothing the table line did not.

**Recommendation: (a)**, plus: objects are inventoried only on a table
the declarations *manage*; an `existingTable()` table contributes
nothing at any level (it declares a shape hejbro does not own — listing
its columns as unmanaged would contradict "SHALL NOT list it in the
unmanaged inventory" one level down); a schema no declaration touches
stays out of scope entirely.

## Q4 — Indexes Postgres creates for declared constraints

**Background.** This is the one place where a naive set difference is
wrong rather than merely noisy. A declared `primaryKey()` or `unique()`
becomes a `pg_constraint` row *and* a `pg_index` row of the same name,
and hejbro's declaration list (`table.indexes`) contains neither. Diffing
`catalog.indexes` against declared index names alone therefore reports an
unmanaged index for every key on every table of a database **hejbro's own
migration produced** — a false report in the exact case the tool is meant
to be trusted in. (Measured: see "Measurements" below.)

**Options.**
- (a) Exclude an index whose name matches a constraint the *declarations*
  name (the declared primary key name, a declared column's unique name).
  Everything else the catalog holds on a managed table is inventoried —
  including the index backing a primary key or unique constraint the
  database has and the declarations do not, which is a genuine unmanaged
  object and gets exactly one line.
- (b) Exclude every index that backs any catalog constraint. Then a
  database-only primary key or unique constraint is invisible — a new
  blind spot of the same shape as the one being closed.
- (c) Report database-only `p`/`u`/`f` constraints as a fourth kind.
  Beyond the lead's three kinds; a scope expansion this change should
  surface rather than take.

**Recommendation: (a).** The exclusion rule reads as one sentence — "the
declaration already accounts for this index under that constraint's own
name" — and leaves no object unnamed. It needs nothing new from the
snapshot either: `primaryKeyName` and a column's `uniqueName` are the
same fields `compare.ts` already compares against `pg_constraint`, and
Postgres names the backing index after the constraint (M4). Note the naming consequence a
reviewer will see: a database-only primary key prints as an *unmanaged
index* line, which is true of the `pg_index` row it names.

## Q5 — Objects whose names a declaration cannot carry (#706)

**Background.** These are the objects the loss report announces. `check`
sees only a catalog row; the reason a name cannot be carried is
`infer/table.ts`'s D36 rule.

**Options.**
- (a) No special marking — the inventory states existence only, and the
  loss report already gave the reason at `import` time.
- (b) `check` applies the D36 identifier rule and annotates the line
  ("its name is not a valid hejbro identifier"), so a user who never ran
  `import` learns why declaring it will not help.

**Recommendation: (a)** for this change, and record (b) as a candidate
follow-up. (b) couples `check`'s report to the inference rule and would
be the first time `check` says anything about *why* an object is not
declared; it is a bigger claim than either issue asks for.

## Q6 — Text mode (a preset that declares the platform cannot plan)

**Background.** The mode exists because expression rendering needs
`EXPLAIN`. The inventory reads no expression.

**Recommendation.** Identical behavior in both modes, and no new
coverage-boundary line for the mode — there is nothing mode-dependent to
state. The text-mode boundary line stays exactly as it is.

## Q7 — Ordering, and D81's physical-order oracle

**Background.** D81 makes physical column order the snapshot's truth, and
the catalog query returns columns in `attnum` order. The loss report,
by contrast, sorts every per-instance line by identity
(`sortedBy`, D106 N3) precisely because an upstream read's order is not
something a report should depend on.

**Options.** (a) identity order (`schema.table.name`); (b) physical
(`attnum`) order for columns, catalog order for the rest.

**Recommendation: (a).** The inventory is not a snapshot and asserts
nothing about order; identity order makes two databases holding the same
objects print the same report, which is what a diffable CI log wants.
D81's oracle is about what a declaration records, and is untouched.

## Q8 — Which columns count

**Recommendation.** Every column the catalog read already yields for a
managed table that no declaration covers — generated and identity columns
included (both are declarable, so their absence from the declarations is
a real gap). System columns and dropped columns never arrive: the
`columns` query already filters `attnum > 0 and not attisdropped`.
Partition-inherited check constraints arrive as ordinary `contype = 'c'`
rows on their own table, which is itself an unmanaged table unless
declared, so Q3(a) already keeps them off the report.

## Q9 — Volume

**Recommendation.** One line per object, no cap — the table axis is
uncapped today and a cap would make the report lie by omission. If the
lead wants a ceiling, it should be a `check`-wide reporting decision, not
one this change invents for one section.

## Why the loss report's new sentence is unconditional

The omitted-index and omitted-check lines now claim, without a
condition, that `check` keeps listing the object as unmanaged. That
claim is only true if such an object always sits on a table `check`
treats as managed — and this change's own Q3 boundary says an unmanaged
table's objects are never listed. Read in the source (not inferred):
`omittedIndexes`/`omittedChecks` are produced **inside** `inferTable`
(`infer/table.ts`), and `inferTable` is called only over
`snapshotTables` (`infer/compose.ts`), which is what survives
`partitionTables` — the filter that removes a table whose own catalog
name no declaration can carry, *before* `table()` is ever called. A
table whose name was omitted therefore contributes no omitted index and
no omitted check at all; every one that exists belongs to a table the
starter files declare with `table()`, which is exactly a managed table.
The sentence needs no `stillReportedInInventory`-style branch, unlike
the omitted-*table* line one level up, whose object may well sit in a
schema with nothing else declared.

## M6 — the join reads more than the constraint an index implements

The first live run of this change's own witness, against
`examples/postgres`'s real chain, reported seven unmanaged indexes on a
database that agreed with its declarations — every declared primary key,
`tasks_pkey` four times over:

```
unmanaged index (backs constraint projects_owner_id_fk; not covered by any declaration): app.members.members_pkey
unmanaged index (backs constraint task_labels_task_id_fk; not covered by any declaration): app.tasks.tasks_pkey
…
```

The cause, reproduced directly:

```
       conname       | contype |  conrelid  |    conindid
---------------------+---------+------------+----------------
 users_pkey          | p       | app.users  | app.users_pkey
 orders_user_id_fkey | f       | app.orders | app.users_pkey
```

`conindid` is not only "the index this constraint implements". A foreign
key's own record names the index it points at on the *referenced* table,
so joining on `conindid` alone yields one extra row per foreign key
pointing at a key, each carrying that foreign key's name — the declared
key is then excluded by nothing (its name is not a declared constraint
name) and is reported, once per referencing table.

The join is therefore restricted to the constraint kinds Postgres backs
with an index of their own — primary key, unique, exclusion. M3/M4 could
not have caught this: that database had no foreign key at all. The
scenario a reviewer would build first — two tables and a reference — is
exactly the one the measurement lacked.

## A gate that does not cover its own witness

`packages/cli/test/infer-omitted-names.integration.test.ts` asserts the
loss-report wording against a live database, and it does **not** run
under `pnpm test`: there is no `test:integration` task in `turbo.json`,
so the suite is reachable only through its own vitest config. A wording
change therefore passes every gate in `AGENTS.md`'s "Before claiming
done" list while leaving that file asserting text the product no longer
prints. It was found here by reading, not by a gate. The same is true of
`check-live.integration.test.ts`, which this change's own live witness
lands in — both are run explicitly and their output is quoted in the
completion report.

## Measurements

Run by cv-implementer in this worktree (built `dist/cli.js`,
`hejbro v0.2.0-pre.1`) against `postgres:17-alpine` (container `cv-pg`,
port 15734), on a scratch project declaring one table:
`id uuid primaryKey`, `email text notNull unique`, `name text notNull`,
one declared index `users_name_idx`, one declared check `users_name_ck`,
with hejbro's own generated migration applied.

**M0 — baseline.** `check` prints the three coverage-boundary lines,
`installed extensions: plpgsql`, `check: no differences.`, exit 0.

**M1 (#726) — a database-only column.**
`alter table app.users add column legacy_note text;` → `check`'s output
is **byte-identical to M0**, exit 0; the string `legacy_note` appears
nowhere in stdout.

**M2 (#707) — a database-only index and check constraint.**
`create index users_legacy_idx on app.users (email);` and
`alter table app.users add constraint users_legacy_ck check (length(name) < 500);`
→ output again **byte-identical to M0**, exit 0; neither name appears.

Both issues reproduce exactly as filed: the report is not merely
incomplete, it is unchanged by the presence of the objects.

**M3/M4 (Q4) — what the catalog holds on a table hejbro itself created.**

```
 nspname |  tbl  |       idx        | backs_constraint
---------+-------+------------------+------------------
 app     | users | users_email_key  | u
 app     | users | users_legacy_idx |
 app     | users | users_name_idx   |
 app     | users | users_pkey       | p
```

Four `pg_index` rows against **one** declared index. Two of them
(`users_pkey`, `users_email_key`) back the declared primary key and the
declared unique column, and their index names are **identical** to the
constraint names hejbro's own migration wrote — so the declared side
already carries those names, as `primaryKeyName` and the column's
`uniqueName`. A set difference over index names alone would print two
unmanaged-index lines for a database hejbro produced from these very
declarations: a 2-in-4 false-report rate on the simplest possible table,
growing with every key declared. This is the measurement Q4(a) rests on.

**M5 — the `conindid` join adds no row.** The committed `indexes` query
text, scoped to the schema under test and otherwise unmodified, run
against the same database:

```
 schema | table |       name       | constraintName
--------+-------+------------------+-----------------
 app    | users | users_email_key  | users_email_key
 app    | users | users_legacy_idx |
 app    | users | users_name_idx   |
 app    | users | users_pkey       | users_pkey
(4 rows)
```

Four rows before the join and four after: a constraint's `conindid` is
one index, so the left join cannot multiply a row. The fact each index
carries is the catalog's own, and the two indexes that back nothing
carry null rather than a name that merely looks unrelated.
