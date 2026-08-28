# generate / verify workflow

Read this when running `hejbro generate`/`hejbro verify`, reading the
migration banner, resolving an ambiguous rename, reading a warning, or an
apply tool (e.g. `supabase db push`) failed partway through a migration.

## The loop

`hejbro init` (once, scaffolds config + empty snapshot) → declare or edit
schema files → `hejbro generate` → read the banner → commit the migration
file and the updated snapshot → `hejbro verify` (locally or in CI).

## Reading the banner

Every migration file opens with a comment banner listing every object
added/changed/dropped, in declaration-dependency order, followed by two
hash lines:

```
-- + table app.posts [new]
-- parent-snapshot: sha256:...
-- snapshot: sha256:...
```

The two hashes form a tamper-evident chain across the whole migration
history — `hejbro verify` recomputes and checks them.

## Ambiguous renames

`hejbro generate` never guesses whether a same-table column (or schema
table) drop+add pair is a rename or two unrelated changes. It exits 1
with code `ambiguous-column-rename` or `ambiguous-table-rename` and
prints the exact rerun command — copy it verbatim: either
`hejbro generate --rename <schema>.<table>.<old>=<new>`, or, if the drop
and the add really are unrelated,
`hejbro generate --confirm-drop <schema>.<table>.<column>`. See the
owner-approved golden texts in `packages/cli/test/golden.test.ts` (guide
page lands in #109).

## Warnings

A `generate` run can still exit 0 while printing `warning[<code>]:
<identity>` blocks on stderr — these never block the migration, but they
flag something worth a second look. Example: `not-null-without-default`
fires when a migration adds a `not null` column with no `default` to an
existing table (it will fail on any table that already has rows) — fix by
adding `.default(...)`, or by adding the column nullable now and setting
it `not null` in a later migration.

## `hejbro verify`

Five checks, entirely from checked-out files — no live database
connection: snapshot parses, no two migration files share a version,
declarations match the snapshot, the migration chain is linear (no
diverged/broken parent links), and the chain's tip hash matches the
snapshot. Run it in CI. See
`packages/cli/src/commands/verify.ts` (guide page lands in #109).

The **local Docker round-trip** (`pnpm roundtrip` in an example package)
goes further: it applies the full committed migration chain to one
database and a single fresh migration to another, then diffs the schema
dumps — the deeper, pre-merge check `verify` can't do without a database.

## When an apply step fails partway through

Applying a migration to a database is out of hejbro's scope (D12) — an
external pipeline (`supabase db push`, a raw `psql -f migration.sql`, a
CI job, …) reads a migration file and runs it. That pipeline can fail
partway through a file. hejbro's own generated SQL carries no
`begin`/`commit` wrapper of its own — every migration file (the banner
example above included) is a plain sequential list of DDL statements —
so whether a mid-file failure leaves only the earlier statements applied,
or gets rolled back entirely, depends on whether *the apply tool itself*
wraps the run in a transaction. hejbro has no way to know which happened,
and no way to inspect the live database to find out.

### What `verify` tells you here, and what it doesn't

`hejbro verify`'s five checks are entirely file-based (see above) — a
green `verify` after a failed apply confirms your migration *history* is
internally consistent (unique versions, a parseable snapshot, a linear
hash chain, a matching tip hash). It says nothing about the live
database: the same five checks pass identically whether the last
migration was fully applied, half applied, or never run at all. There is
no sixth check and no database-inspecting option — `verify` cannot see a
database, by design.

### A straight retry is not automatically safe

hejbro's generated DDL has no `if not exists`/`or replace` guard on
`create table` (`create table ...`, rendered verbatim — see
`packages/core/src/kinds/table-kind-emit-sql.ts`) — re-running the exact
same migration file against a database that already has some of its
objects fails on whichever object landed before the original failure
(e.g. `relation "..." already exists`), unless the apply tool wrapped the
whole file in a transaction that already rolled everything in it back.
Whether that's the case is entirely the apply tool's own behavior, not
something hejbro controls or reports.

### Forward, not backward

There is no `hejbro` command to edit or regenerate an already-committed
migration — `hejbro generate` only ever diffs your current declarations
against the current tip snapshot and emits a new migration forward from
there. So the recovery path after a failed apply is: work out what
actually landed on the live database (from the apply tool's own output,
or a manual inspection — hejbro has no built-in way to do this), adjust
your declarations if what landed differs from what you intended, and let
the *next* `hejbro generate` express the fix as a new migration — the
same declare → generate → verify loop as any other change, not a special
recovery command.
