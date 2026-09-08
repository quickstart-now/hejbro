# Brownfield adoption

Read this when bringing hejbro into a repository whose database already
exists and already has data — deciding what to declare, running the
first `generate`, checking a declaration against the real schema, or
deciding what to leave out of hejbro's management.

## What hejbro does and doesn't know about the live database

`hejbro generate` diffs your declarations against the checked-in
snapshot file only (`packages/core/src/engine/generate.ts`); `hejbro
verify` "re-derives the whole chain from checked-out files only — no
live database" (`docs/guide/getting-started.md`), running its five
checks against `packages/cli/src/commands/verify.ts`'s own files-only
inputs. Applying migrations to a database is hejbro's own command
surface (D12, amended — `docs/specs/2026-08-19-hejbro-design.md`):
`hejbro migrate` applies pending migrations, `hejbro status` reports
what the ledger records, `hejbro reset` destroys only what the
declarations manage, and `hejbro raise` stands an empty database up
from a snapshot SQL file — see `generate-verify-workflow.md` for
`migrate`'s own transactional guarantee. `hejbro check`
(`packages/cli/src/commands/check.ts`) is the one command among these
that only reads — no transaction, no migration ever applied — comparing
your declarations against its catalog object by object; see "Checking a
declaration against the real schema" below. Adopting hejbro into an
existing database therefore starts from the same declared-truth model as
a greenfield project; there is no step where `generate`/`verify` inspect
your database for you, and `baseline` doesn't either — it only writes a
file, the same way `generate` does.

## Adoption procedure

1. Write `table()` declarations that match the live schema's tables
   column-for-column, in the tables' actual physical column order (the
   cheatsheet's column-order rule applies here too — hejbro's snapshot
   follows declaration order on a brand-new table).
2. Run **`hejbro baseline`** (not `generate`). Because the checked-in
   snapshot starts empty, this first migration is a full `create
   table`/`create index`/… for every declared object — the same SQL
   `generate` would produce for objects that didn't exist yet — and
   `baseline` marks it in its own banner:

   ```
   -- baseline: these objects already exist — register this migration as applied, do not run it
   ```

3. **Run `hejbro migrate` against the live database.** It reads the same
   `-- baseline:` marker step 2 wrote and registers that file in the
   ledger *without sending its statements* — the objects it would create
   already exist, so nothing is run, and the report says so explicitly
   ("registered 1 baseline migration(s) (statements not executed)"),
   never "applied". Any apply tool you used *before* this existed
   (`supabase db push`, a raw `psql -f migration.sql`, a hand-written
   `insert` into your own tracking table, …) worked the same way in
   spirit — running the file against the already-populated database
   fails on the first statement (`relation "..." already exists`), which
   is exactly the confusing way not to learn a file was never meant to
   be run. `hejbro migrate` is now the one way to register it correctly
   without meeting that failure at all.
4. From that point on, every further `hejbro generate` behaves exactly as
   it does in a greenfield project, emitting only what changed.
   `hejbro baseline` refuses to run a second time
   (`error[baseline-not-first]`) — a baseline is by definition the first
   migration of an adopted database.

## Checking a declaration against the real schema

Nothing in the adoption procedure above confirms the declarations
actually match the live schema — `hejbro check` is that step, comparing
your declarations against the real database's catalog, object by
object, without ever writing to it:

```
hejbro check --url postgres://...
# or: DATABASE_URL=postgres://... hejbro check
```

If `hejbro.config.ts` sets no `driver`, it needs the `@hejbro/pg`
package installed (`pnpm add -D @hejbro/pg`). `hejbro` itself declares
it as no dependency kind at all — not a runtime dependency, not a peer,
optional or otherwise — so installing `hejbro` never pulls in a
Postgres client for the commands that never connect, and the package
manager is never asked to reason about a package only `check` uses.
Configure a `driver` factory instead (see `references/{supabase,neon,
nile}-preset.md` for the decorated shape each preset's own project
uses) and that factory connects for every command that needs one —
`@hejbro/pg` is never installed at all.

The exit code answers three separate questions, not one:

| Exit | Meaning |
|------|---------|
| `0`  | every declared object was compared and agreed |
| `1`  | at least one declared object is missing or differs from the database |
| `2`  | the run could not answer — something could not be compared (e.g. a role without EXPLAIN privilege on a table it owns no policy on, or — on a platform whose preset declares `explainUnavailable`, e.g. Nile — an expression whose declared and catalog text still differ after the fixed text normalization), or the declaration set was empty |

`2` is never a pass and is never folded into `0` or `1`: a CI pipeline
running `check` under a limited role should treat `1` (real drift) and
`2` ("ask for more privilege, then rerun", or, on a text-comparison
platform, "restate the declaration in the catalog's own spelling, then
rerun") as different answers, not one red build indistinguishable from
the other.

A dropped, non-derived primary-key name (above) is `check`'s own live
example of a two-channel report: the catalog's own name still shows up
in the plain **inventory** section on stdout (as an unmanaged index
backing that constraint), but the declared name being missing is a
finding, printed on stderr alongside every other `check-object-missing`
line — reading only stdout misses that the run failed at all (measured
live, 712/R7).

`check` does not compare everything. View bodies are never compared
(only that a declared view exists). Primary keys, unique constraints
and foreign keys are checked for existence only, not their exact shape.
An index is compared as its whole **ordered key list**, not as a filtered
"expression columns" subset: Postgres stores a bare column reference, a
parenthesized column, or a column with an explicit collation as a
*plain* key, so a position where both the declaration and the database
hold a plain column is never compared beyond the index's existence —
only a position at which *either* side is an expression is matched by
rendering, so a declared plain column against a database expression key
is caught, and the reverse too. A covering index's `INCLUDE` columns are
not keys — they carry no ordering and cannot be declared — so they are
neither counted nor compared. A key's sort direction, `NULLS FIRST`/
`LAST`, operator class, an index's uniqueness, and its access method
stay existence-only regardless. Check constraints and generated columns get their
expression compared too — a check constraint's expression (plus
whether the database enforces it) and a generated column's expression
(compared as its own axis, never as a default — a generated column
cannot carry one) — every expression match running the declared and the
catalog's own rendering through the server in the same statement
(Postgres often rewrites an expression on write, so comparing rendered
text directly would false-positive). The report states this coverage
boundary on every run, pass or fail. It also prints an **inventory**
section — tables inside your declared schemas that no declaration
covers, and, on a table your declarations *do* manage, any column,
index or check constraint no declaration covers either — plus the
database's installed extensions. All of it is informational only, never
a `check` finding and never affecting the exit code: an index backing a
declared primary key or unique column is never listed (Postgres created
it, your declaration accounts for it under that constraint's own name),
and one backing anything else is listed alongside the constraint it
backs.

hejbro does not manage a table for one of two reasons — no declaration
covers it at all (`check`'s own inventory, above), or a declaration
covers it with `existingTable()` (never in the inventory) — and the two
are never the same table twice: the section below is the second one.

Before `check` existed, the general technique was to apply the generated
migration to a scratch database (empty, disposable), take a schema dump
of it, and compare that dump against a schema dump of the real database
by hand. This repository's own example packages still use that technique
internally, wired up as each example's `roundtrip` script — but that
answers a different question ("does `generate` always reproduce the same
schema", a generator-fidelity check this repository runs on itself), not
"does this declaration match that database", which is what `check`
exists to answer for your own project.

## Deciding what to manage

`existingTable(schemaName, tableName, columns)` (D41, amended by
add-unmanaged-objects #605, `packages/core/src/dsl/existing-table.ts`)
declares a table for its shape, never for its DDL: it can be an FK
target, used in `exists()`, and joined against — and, since #605, it is
also a real top-level declaration in its own right. Exported from a
schema file the same way a `table()` is, it reaches the snapshot (marked
`existing: true`), the export description, and a vendored contract's
`Tables` entry, exactly like a managed table's shape does. As long as a
table stays declared `existingTable()`, `generateMigration` diffs
nothing about *that table's own identity* against it and emits no
statement for it, on any run (D106 R2, R2-B1: this includes a run that
changes its declared columns, renames it, or removes the declaration
entirely — none of these produce DDL naming that table, and none of
them can be blocked into refusing an unrelated managed change in the
same schema either). It exists for tables that stay outside hejbro's
management for as long as they're declared this way (Supabase's
`authUsers` is the shipped example).

Since #605, the choice is not permanent: replacing a managed `table()`
declaration with an `existingTable()` of the same identity hands the
table to the platform and emits nothing at all, for the table or for
anything hejbro managed on it (its sequences, its row-level security,
its policies). The reverse — replacing an `existingTable()` with a
managed `table()` of the same identity — **adopts** it: no `create
table` is emitted for the table itself (it already exists). What
adoption creates for that table: a serial column's sequence, row-level
security, its policies, and every index, check constraint, foreign key
and primary key the declaration itself carries. Adoption never adds,
changes or drops a column, and never drops anything else either, in
either direction — an object the database holds that no declaration
covers at all is `hejbro check`'s inventory to report, never something
adoption or a handover removes on its own. A column the managed
declaration adds that the database lacks is `hejbro check`'s
`check-object-missing`, naming it as `"<schema>.<table>.<column>"`; the
way to add the column is a following edit, not adoption itself.

A serial column's sequence is the one object adoption normalizes rather
than creating outright: `create sequence if not exists`, then the
sequence is altered, unconditionally, to the declared type and to be
owned by the declared column — regardless of whatever type or ownership
it already carried. A brand-new table's own sequence stays a plain
`create sequence`, so a genuine name collision there still fails
loudly, exactly as any other `create` would.

`hejbro generate` names every object an adoption will create with a
literal `warning[adoption-creates]` diagnostic, one block per adopted
table that the migration creates anything for — a table adopted with
nothing to create (only a column changed, say) is adopted silently.
The block states that apply fails if the database already holds one of
the indexes, checks, foreign keys or the primary key named below it —
a sequence it already holds is reused, and row-level security and
policies are re-applied without failing — and that apply also fails if
the database lacks a column one of the named objects needs, with
`hejbro check --url <url>` naming such a column beforehand. Its `Next:`
line then names the two ways that actually run on the database this
run just adopted: hand the table back — restore the migration and the
snapshot this run just wrote and the `existingTable()` declaration it
replaced — or drop the indexes, checks, foreign keys and primary key it
already holds, never the sequence, and run `hejbro migrate`; for a
database that lacks a column instead, discard the migration and
snapshot this run just wrote, adopt with the columns the database has,
then add the column and its objects in a following edit. `hejbro
baseline` is not one of them: it is the first migration of an adopted
database, and `error[baseline-not-first]` refuses it afterwards.

For the branch where the database lacks a column, the diagnostic prints
*after* `generate` has already written the migration file and the new
snapshot, so that branch's first step is undoing what this run just
wrote — both files, restored together
through version control (e.g. `git checkout -- <migration file>
<snapshot file>`), never just one: reverting only the migration file
leaves the snapshot still recording the adoption as done, so the next
`hejbro generate` reports "no changes" instead of writing back the
migration you just deleted — and `hejbro verify` does not read that as
fine either: it exits 1 with `error[chain-tip-mismatch]`, because the
restored snapshot's own recorded hash no longer matches any surviving
migration's tip — unless the declaration has already moved
on to the recovery's own next step (adopting with the columns the
database has), in which case `generate` writes a second migration whose
parent-snapshot is the snapshot the deleted migration had produced —
now orphaned, matching no surviving migration — and `hejbro
migrate`/`hejbro verify` both refuse it with `error[broken-chain]`.
Restoring the snapshot alone does not clear that one: `verify` then
reports `error[snapshot-stale]` beside it, and the divergent migration
has to go too. Reverting only the snapshot leaves it disagreeing with
the migration file's own recorded hash, and `hejbro verify` refuses
with `error[snapshot-stale]` and `error[chain-tip-mismatch]` (`hejbro
migrate` itself never reads the snapshot's content, so it silently
re-attempts the same failing statement instead of noticing anything is
wrong). hejbro has no command that discards its own just-written
output — this step is manual, on you, same as any other
version-control revert.

A child declared on a column the *existing* declaration didn't list is
not refused at `generate` time, deliberately: `existingTable()` is by
design a partial claim (D106 R2/R2-B2), so a column merely left off
that list is an ordinary, working shape — refusing it there can't tell
that shape apart from a column the database genuinely lacks, since both
look identical to a declaration-only comparison. The two ways through:
list every column a child touches in the existing declaration before
adopting (nothing then distinguishes it from any other adoption), or
adopt with only the columns the database already has and add the
missing column — and whatever's declared on it — in a following,
ordinary managed edit, no longer an adoption at all.

Round-tripping a table — handing it over to `existingTable()`, then
adopting it back with a managed `table()` — round-trips cleanly for a
declaration whose only managed object is that one sequence. A
declaration that also carries an index, a check constraint, a foreign
key or a primary key does not: the earlier handover left those very
objects in the database untouched, and adoption creates each one the
same plain way a first-time managed table's own creation would, so
re-adopting such a declaration fails against what the handover already
left in place. `warning[adoption-creates]` already named what it would
have tried to create, and the two ways through both run on the
database this run just adopted. Handing the table back reverts three
files here, not the missing-column branch's two: the migration, the
snapshot, *and* the declaration this run changed back to
`existingTable()` — reverting only the first two leaves the declaration
still `table()`, and `hejbro verify` refuses with
`error[snapshot-stale]`, exit 1. Dropping instead touches only the
indexes, checks, foreign keys and the primary key the database already
holds, never the sequence, which a held copy already reuses cleanly:
dropping it too loses the `nextval` default a `serial` column carries,
which no later `generate` re-attaches (the snapshot already records the
column as serial), so `hejbro check` reports
`error[check-object-differs]: <table>.<column>` from then on and
`generate` has nothing left to fix. Dropping a primary key other tables
reference needs those foreign keys dropped first, and rows inserted
between the drop and the apply can make the re-creation fail on
duplicates — hand the table back instead when the table is live. A
mid-chain path that records what the database already holds without
reverting or dropping anything does not exist yet (#1037). A table whose `existingTable()` declaration lists its primary key and whose database holds it -- the shape `hejbro import` writes -- therefore fails at apply on every adoption (`42P16`, multiple primary keys) until that path exists; the two ways the notice names are the only ways through, and dropping the key on a live table rebuilds its index and, where a managed foreign key references it, drops that key too (#1045).

**Adoption is a step after `baseline`**: what a database already
holds — its schemas and its objects — is `baseline`'s to record.
Adoption's own job starts from that point on, moving a table
`baseline` never claimed (or one added to the database afterwards)
from `existingTable()` into managed `table()`.

A handover only stays unambiguous when the identity doesn't move: if
the same edit also renames the table (a managed declaration removed,
a same-shaped `existingTable()` appearing under a *different* name in
the same schema and run), `hejbro generate` refuses it with
`ambiguous-table-rename` and emits no DDL at all — the shape genuinely
is indistinguishable from a `--rename`, and a silent drop of the
managed table's own DDL (its table, sequence, policies, RLS) is
exactly the harm the refusal exists to prevent (#703). The safe path
is two runs, not one: first `--rename` the table while both sides are
still `table()` declarations, confirm `hejbro verify` passes, then
hand the renamed table over to `existingTable()` in a later run.

Declaring a schema's tables with `table()`/`existingTable()` no longer
has to stay a bare, unexported reference to work this way, the
difference from before #605.

```ts
import { existingTable, text, uuid } from "hejbro";

export const legacyCustomers = existingTable("public", "legacy_customers", {
	id: uuid().primaryKey(),
	email: text().notNull(),
});
```

## Limits after adoption

Once adopted, `hejbro verify`'s five checks still run entirely against
checked-out files — they confirm the migration history and snapshot stay
internally consistent with each other, and say nothing about whether the
live database has drifted from what's declared. A manual schema change
made directly against the database is invisible to `verify`, but not to
`hejbro check` — rerun it (a scheduled CI job, or before a release) to
catch that drift; it is the one command built to answer exactly that
question. `hejbro baseline` (above) writes the marker, and `hejbro
migrate` (step 3) does the actual registration — together they cover the
registration half of #385.

## Writing step 1 for you: `hejbro import`

The other half of #385 — introspection-assisted seeding, where hejbro
reads a live schema and writes starter declarations for you — is
`hejbro import`:

```
hejbro import --url postgres://... --schema public --out src/schema
# or: DATABASE_URL=postgres://... hejbro import --schema public --out src/schema
```

It reads the named schemas through the same read-only catalog `check`
uses, and writes one starter declaration file per schema into the
directory named by `--out`, using the DSL's own builders — this *is*
step 1 above, generated rather than hand-written, so the adoption
procedure continues unchanged from step 2 (`hejbro baseline`) once
`import` has run. `--schema` is required and repeatable, with no
default: a hosted Postgres's own platform schemas (`auth`, `storage`,
and their neighbours) are schemas too, and adopting those as
declarations is not a default anyone can want — name the ones you
actually own. `--out` is required as well; `import` refuses to
overwrite any file already there, so rerunning it (after fixing
something by hand) never silently discards that edit.

What it infers is necessarily an approximation of a hand-written
declaration, and every reading prints a loss report saying exactly
which kind of approximation it made, in four bands: **Guessed** — a
column's TypeScript key from its SQL name (two columns whose names
would otherwise share a key keep it split: whichever one's own name
the key round-trips back to keeps the bare key, every other one is
suffixed `2`, `3`, … in physical column order; when none of the
colliding names round-trips at all, physical order alone decides —
`foo__bar` keeps the bare `fooBar`, a later `foo_bar_` in the same
table becomes `fooBar2`), the default numeric mode, and unknown
array-element nullability (read as nullable), plus any role name a
schema `USAGE` grant, a table-level grant (including a default
privilege for future tables), or a policy's own `roles` names — a
column-level or a sequence-level grant is never read and contributes
no role name at all, and a policy declared `to current_user`/`to
session_user` names whichever role Postgres already resolved that
keyword to when the policy was created, not the literal keyword: on a
hosted platform this can surface the platform's own owner role,
indistinguishable here from any other guessed name; **Not inferred** —
functions, triggers, view bodies, policy expressions, grants beyond a
role's bare name (a blanket line — never a per-instance list), a
column whose type no builder expresses (this line says nothing about
`check`: such a column still shows up in `check`'s own inventory as
unmanaged, the same as any other undeclared column, neither promised
nor denied by this line), and a standalone sequence no column owns (the
DSL has no `defineSequence()` yet); **Approximated** — a named UNIQUE
constraint as a same-named unique index, when its own column survives
(one omitted for its own name, or for the enum type that typed it,
costs the constraint too — see **Omitted**, below — and an omitted
object never gets an approximation line beside its own), a
`nextval(...)` default kept
as a raw expression, every default/check/generated/index-predicate
expression as raw SQL text rather than a typed builder, a foreign
key whose own catalog name is not a valid hejbro SQL identifier,
declared under the derived name instead (D106 round 3), and a primary
key whose own catalog constraint name is not the one the DSL itself
derives, declared under that derived name instead — `check` keeps
reporting the declared name as missing and the catalog's own name as
an unmanaged index until the constraint is renamed to match (712/R7);
and **Omitted** — each left out of the starter file entirely rather than
guessed at under the wrong name, and named in the report instead. A
column whose SQL name no declaration key can produce, either because
it doesn't round-trip through snake_case (a quoted `"createdAt"`) or
because the key it round-trips to is itself one the DSL's own
identifier rule still rejects (a leading-underscore `_id`) — `check`
keeps reporting that column as undeclared until it's renamed in the
database *and declared* (renaming alone only makes the name one a
declaration can carry): the DSL derives every column's SQL name from its TypeScript
key and accepts no override, so no declaration, hand-written or not,
can carry either kind of name. A column drops out of a declaration for
one of three reasons: its own name (above, an **Omitted** line), the
enum type that types it (an **Omitted** line, below), or (712/R13) its
own type — no column builder expresses it at all, the **Not inferred**
column line already named above, not an **Omitted** one (the column's
own name is fine, so the report never claims otherwise). Whichever of
the three it is, a member naming that column — an index, a check
constraint, a UNIQUE constraint, a generated column, a primary key or a
foreign key — is still omitted on its own line (below). The third
reason has no exit today: it is not a renaming problem (nothing about
the column's own name is wrong) and hand-declaring it is not possible
either (no general-purpose column builder exists in the DSL) — a line
naming a member that fell to this reason carries no `Next:`/`Rename …`
remedy at all, only the reason. Beyond a column, seven further kinds of
catalog name cost hejbro the object that carries it: a **schema**
whose own name is not a valid hejbro SQL identifier (everything it
holds — tables, enums, sequences — is omitted with it, unreported by
`check` since nothing in it is declared); a **table** whose own name
is not (everything it holds — columns, checks, indexes, foreign
keys — is left undeclared with it); an **enum type** whose own name
is not (every column typed by it is left out with it, and `check`
keeps naming each of those columns as unmanaged until it is declared,
but never names the type itself — its inventory has no enum axis,
712/R3); an **index**, a **check constraint** or a **UNIQUE
constraint** whose own name is not (`check` keeps listing each as
unmanaged until it is renamed in the database and declared); and a **foreign key**
whose own *target*'s name — its schema, or its table — is not one
hejbro can carry — the relationship is left out and named, naming the
missing target, while the column that carried it stays declared as a
plain column. A foreign key whose own source or target column was
itself omitted — for its own name, or because it was typed by an enum
that was itself omitted — is left out the same way, its own line
naming the column that cost it and following that column's own cause
(#873, 712/R8); when an omitted enum type took both of a key's columns
at once (an enum-to-enum relationship losing its shared type), only
one line ever announces it, its reason on the declared side (712/R9).
A column left out of the declaration — for any of its three reasons —
takes its own index,
check constraint, UNIQUE constraint and every stored **generated
column whose own expression names it** with it the same way — a
generated column can never name another generated column in its own
expression (Postgres itself forbids it), so this cascade runs exactly
one level deep. A generated column omitted this way — or omitted for
its own cause, above — then takes *its own* index, check constraint,
UNIQUE constraint, primary key and foreign key with it in turn, a
second-order cascade (712/R11, 712/R12, 712/R13); every one of these
lines names the column that cost it and that column's own cause, and
none of them ever gets an approximation line either (712/R10). When
that cause is the column's own name or its enum type, renaming the
object named in one of these lines is never the end of the remedy by
itself: the report's own `Next:` line also says to either re-run
`hejbro import` into a fresh `--out` and merge the new file's
declaration into the one already checked in, or add the declaration by
hand. When the cause is instead the column's own type (above), no
`Next:` line exists at all — there is nothing to rename and no way to
hand-declare it, so the line states only the reason. A foreign key into a schema `import`/`pull` simply never
named is a different case, not an omission: its target's own name may
be perfectly ordinary, so the relationship is kept, declared against an
unexported handle to a table this repository does not declare, and the
report says nothing about it. `import` never hides any of this: every
file's own header carries the full report, and the same report prints
to the terminal on every run, ending with the way out ("The loss ends
when you hand-edit the starter declarations"). Two schemas whose
tables reference each other, or whose columns reference each other's
enum types, would otherwise make their generated files import one
another in a cycle no loader can resolve — a reference to another
file's enum counts as an import exactly as a foreign key to another
file's table does. `import` breaks such a cycle itself, on one
deterministic direction, using an unexported reference-only
declaration for whichever kind of crossing runs that way: a handle
(`existingTable`, above) for a foreign key, a local copy of the enum
for an enum reference — so the starter files' imports form no cycle,
and loading does not depend on which file the loader reaches first.
"Checking a declaration against the real schema" above is still how
you confirm the result (hand-edited or not) matches the database, and
a `hejbro baseline` right after `import` reproduces the database's own
DDL, marked as the baseline `hejbro migrate` registers exactly as step
2 describes.

A database is also a valid *fallback* source for a vendored contract
(`skills/hejbro/references/polyrepo.md`'s own subject) when the schema
repository itself isn't reachable: `hejbro pull --db-url ... --schema
...` reads the same catalog `import` does and writes into the same
destination `hejbro vendor` does, marked with no commit so `vendor
--check`/`outdated` refuse to compare it against one. Its own loss
report prints the same way, ending instead with "The loss ends when
you link the schema repository" — `link` (then `vendor`) is what ends
most of a `pull`-sourced contract's own loss, but not a column whose
SQL name no declaration key can produce (above): no repository's own
declaration, linked or not, can carry that name either, so only
renaming the column in the database ends that one, the same remedy
`import` needs. See that reference for the full shape.

`pull`'s own `--schema` handling mirrors `import`'s (712/R14). A named
schema the database does not hold at all earns a `Not inferred:
nothing to infer in schema "X".` line, the same as `import` prints,
rather than stopping the run — as long as at least one other named
schema contributed something. A named schema whose own catalog name is
not a valid hejbro SQL identifier is a different case: it earns its
own `Omitted: schema …` line instead (above), never the `Not inferred`
one — the two causes stay in the bands they already belong to, exactly
as they do for `import`. When every named schema produces nothing,
`pull` refuses instead of writing an empty bundle:
`error[pull-nothing-to-infer]` when none of them held anything at all,
`error[pull-nothing-declarable]` when at least one held something this
reading could not carry the name of — the same two-code split
`import`'s own `import-nothing-to-infer`/`import-nothing-declarable`
already makes, mirrored rather than collapsed into one. The `pulled …`
line, the lock's own `schemas`, and the contract's own metadata all
name exactly the schemas that actually contributed something to the
snapshot — never one the database doesn't hold, and never one this
reading could not carry the name of.

Some catalog facts are not part of either reading at all yet, so
neither the loss report's own bands nor `check`'s inventory names
them: a table's own partitioning and inheritance (`INHERITS`), a table
declared `UNLOGGED`, SQL comments (`COMMENT ON ...`), and row-level
security's own enabled/forced flag. Neither `import` nor `pull` infers
any of these — a declaration adopting such a table starts from its
column shape only, same as any other, and enabling row-level security
itself stays a declaration you write ("Deciding what to manage",
above); this gap has no report line yet (tracked as #1034), so stating
it here is the only place a reader learns it at all.

## Where this is enforced

- Specs: `docs/specs/2026-08-19-hejbro-design.md` (D12, D41),
  `docs/guide/getting-started.md` (`verify`'s files-only re-derivation).
- Code: `packages/core/src/engine/generate.ts` (diff is
  snapshot-only, no live connection), `packages/cli/src/commands/verify.ts`
  (the five file-only checks, and `readBaselineFileNames`, which reads
  the `-- baseline:` marker for `migrate`), `packages/core/src/dsl/existing-table.ts`
  (`existingTable`), `packages/cli/src/commands/check.ts`
  (the three-way exit code, the coverage-boundary statement, the
  inventory section), `packages/cli/src/check/catalog.ts` (the read-only
  catalog queries), `packages/cli/src/check/driver.ts` (`--url`/
  `DATABASE_URL` resolution, `@hejbro/pg` declared as no dependency
  kind at all, a configured `driver` factory preferred over it when
  `hejbro.config.ts` sets one), `packages/cli/src/apply/plan.ts` (`baselineFileNames`,
  the subset of pending migrations `migrate` registers rather than
  applies), `packages/cli/src/apply/execute.ts` (`applyMigration` skips
  sending a baseline file's SQL), `packages/cli/src/commands/migrate.ts`
  (the "registered ... (statements not executed)" report line),
  `packages/cli/src/commands/import.ts` (`--schema`/`--out` required
  with no default, refuse-before-write), `packages/cli/src/infer/compose.ts`
  (`inferFromCatalog`, the single reading behind both `import` and
  `pull`), `packages/cli/src/declare-emit/emit.ts` (the starter files'
  own builders, the undeclarable-name-column exclusion, the cycle-safe
  handle), `packages/cli/src/commands/pull.ts` (the database fallback,
  writing where `vendor` writes).
- Where an `existingTable()` declaration itself is handled: the
  snapshot marker (`packages/core/src/kinds/table-snapshot.ts`'s
  `existing?: true`, read via `tableExisting`) and the DDL-blocking
  guard it feeds (`packages/core/src/kinds/table-kind.ts`'s
  `isExistingSide`, opening `tableKind.diff`) — the two together are
  why declaring one is never a hard error and never produces a
  migration, add-unmanaged-objects (#605).
- Adoption itself (671): `packages/core/src/engine/diff-engine.ts`
  stamps `KindChange.transition: "adopted"` (`packages/core/src/kind/object-kind.ts`)
  the one time a change's own node or owning table moves from existing
  to managed in a run — see `skills/hejbro/references/extension-interface.md`
  for the field itself. `packages/core/src/kinds/table-kind.ts`'s
  `isAdoptionTransition`/`suppressTableDiff` let that one transition
  through the otherwise-silent existing-side guard;
  `packages/core/src/kinds/table-kind-emit.ts`'s `isAdoption` flag keeps
  an adoption's own emitted SQL off the table's columns while still
  emitting its index/check/foreign-key/primary-key creates.
  `packages/core/src/kinds/sequence-kind.ts` reads the same field to
  choose its idempotent, normalizing form over a plain `create
  sequence`. `packages/cli/src/commands/generate.ts`'s
  `adoptionCreatesDiagnostics` is the one place the `warning[adoption-creates]`
  literal is defined, reading `transition` off the migrations
  `generate` already computed rather than recomputing anything, and
  (671/R8) filtering to a table `adoptionObjectLines` names at least one
  object for. The same file's `suppressAdoptedColumnWarnings` drops a
  `not-null-without-default` warning for a table `adoptedTableIdentities`
  names, entirely on the CLI side — `packages/core/src/engine/core-validators.ts`,
  which raises that warning, is untouched.
- Gates: every path cited above is checked by
  `packages/skills/test/links.test.ts`; the `ts` block on this page is
  type-checked against this repo's real source by
  `packages/skills/test/snippet-compile.test.ts`.
