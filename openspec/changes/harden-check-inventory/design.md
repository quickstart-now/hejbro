# Design: harden-check-inventory (#707, #726)

Open decisions for the owner-delegated lead, each as background →
options → recommendation. Nothing here is settled by the implementer.

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
name" — and leaves no object unnamed. Note the naming consequence a
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

## Measurements

Run in the worktree against `postgres:17-alpine` (container `cv-pg`),
built CLI, by cv-implementer. Filled in before this document is judged.

- M0 — a hejbro-generated schema applied to an empty database:
  `check` output and exit code (baseline).
- M1 (#726) — one database-only column on a managed table: today's
  output and exit code.
- M2 (#707) — one database-only index and one database-only check
  constraint on a managed table: today's output and exit code.
- M3/M4 (Q4) — every `pg_index` row on the hejbro-generated schema, with
  the constraint each one backs and whether the index name equals the
  constraint name.
