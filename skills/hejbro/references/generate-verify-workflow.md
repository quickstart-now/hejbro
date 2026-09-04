# generate / verify workflow

Read this when running `hejbro generate`/`hejbro verify`, reading the
migration banner, resolving an ambiguous rename, reading a warning, or an
apply tool (e.g. `supabase db push`) failed partway through a migration.

## The loop

`hejbro init` (once, scaffolds config + empty snapshot, honouring an
existing `hejbro.config.ts`'s `migrationsDir`/`snapshotPath` and creating
only what's missing; `--config <path>` names the configuration file
exactly as it does for `generate` — `migrationsDir`/`snapshotPath` stay
relative to the working directory, never to the configuration file's own
directory) → declare or edit schema files → `hejbro generate` →
read the banner → commit the migration file and the updated snapshot →
`hejbro verify` (locally or in CI).

## A configured path can refuse the run

A `migrationsDir` or `snapshotPath` spelled as an absolute path
(`"/db/migrations"`) is refused with `error[invalid-config]` naming the
field — both fields are relative to the working directory, and every
command used to silently re-root the leading `/` under it instead (a
behaviour change for a configuration that used to be honoured). A
`snapshotPath` spelled as a directory (a trailing `/`, an empty value, or
a last segment of `.`/`..`) is refused the same way, at the same
`error[invalid-config]` — the snapshot is a file, and no spelling that
names a directory can ever hold one. A directory or a dangling symbolic
link sitting at the configured `snapshotPath` is refused with
`error[snapshot-not-a-file]` — the snapshot is a file hejbro writes,
never a directory it reads into. A snapshot file this process cannot
read (permissions, an ancestor on the way that's a file or a dangling
link, or a directory on the way that blocks the look-up) is refused with
`error[snapshot-unreadable]`, naming the path and the operating system's
own code. A `migrationsDir` that is a file or a dangling link is refused
with `error[migrations-dir-not-a-directory]`; the same ancestor or
permission faults on the way to it are refused with
`error[migrations-dir-unreadable]` — nothing at `migrationsDir` is not a
fault, since the commands that write into it create it.

`--config` names a file the same way for `init`, `generate`, `baseline`
and `history`: an empty value (`--config=`, or a trailing `--config`
with nothing after it) is refused with `error[invalid-config-flag]`
before any path is even resolved, never silently the working directory.
A directory or a dangling symbolic link at the resolved configuration
path is refused with `error[config-not-a-file]`; an ancestor in the way,
or a path that cannot even be inspected, is refused with
`error[config-unreadable]`. `init` refuses the same trees under its own
`error[init-path-conflict]`, naming the same node.

Every one of these names a `Next:` step; none ever print an absolute
path.

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

### Parsing the banner instead of reading it

An apply tool deciding what to do with a migration file doesn't have to
string-match these lines — hejbro exports a parser for each marker a
banner can carry:

```ts
import {
	parseBannerBaseline,
	parseBannerHashes,
	parseBannerVersion,
} from "hejbro";

declare const fileContent: string;

const hashes = parseBannerHashes(fileContent); // { parent, current } | null
const version = parseBannerVersion(fileContent); // string | null (pre-#229 files carry none)
const isBaseline = parseBannerBaseline(fileContent); // boolean — see below
```

`parseBannerHashes`/`parseBannerVersion` return `null` when their own
line is absent (a pre-Phase-5 or pre-#229 file). `parseBannerBaseline`
returns a plain `boolean` instead — for a marker, absence is itself a
meaningful answer (`false`, an ordinary migration to *run*), not a
missing value; `true` means *register this migration as applied, never
run it* — the marker `hejbro baseline` writes (`brownfield-adoption.md`
covers when and why). Every parser matches its own known prefix only
(`parseBannerBaseline`'s is `-- baseline:` itself, never the human-facing
guidance after the colon, which may reword), so an unrelated banner
line — or a future line an older hejbro doesn't recognize — is never
mistaken for one it does.

## A run can write two migrations, not one

`hejbro generate` normally writes one migration. It writes **two** where
Postgres's own transaction semantics require a boundary between
statements the run produced: a run that adds a value to an existing enum
type AND emits that value into an expression the database resolves while
executing the statement that carries it (a column default, a generated
column, a check constraint, an index expression/predicate, a policy's
`using`/`with check`, or a view body) — Postgres refuses to use an
enum value in the same transaction that added it. The enum change lands
first, the rest of the run second; both carry their own banner and chain
onto each other, and `--name` never collapses them into one file. A
value used only inside a `plpgsql` function body does not trigger this
(its SQL is not resolved when the function is created), and neither does
a value added by the same run that also *creates* the enum type (the
restriction is about values added to a type that already existed).

`@hejbro/core` exposes this as `generateMigrations` (plural) — the CLI's
own entry point for `hejbro generate`. It returns `{ migrations,
hasChanges, snapshot, snapshotChanged, errors, ambiguities, warnings }`,
where `migrations` is `[]` when nothing at all needs writing, one entry
for an ordinary run (including a zero-statement entry when an
existing-table's own marker moved (D106 R3, R3-B1), its own declared
shape changed — a column added, renamed or retyped (D106 R4, R4-B1) —
or an ordinary managed declaration was merely restated, such as two
`index()` or `check()` entries swapped in order (D106 R5, R5-B1; the
file is named `restate_<table>`); its banner still anchors the chain),
and two when the run above applies
— each `GeneratedMigration`
carries its own `sql`/`changes`/`snapshot`, and the top-level `snapshot`
(D106 R2) is the state this run reached regardless, present even when
`migrations` is `[]`. `hasChanges` and `snapshotChanged` (D106 R3, J14)
state two different facts, not one: `hasChanges` is whether there is DDL
to emit, `snapshotChanged` is whether `snapshot` differs from
`previousSnapshot` at all. A declaration whose own identity never diffs
into a statement (an `existingTable()` marker change) can leave
`hasChanges: false` while `snapshotChanged: true` — a caller that needs
"is there DDL" reads `hasChanges`; a caller that needs "is there anything
to write at all" reads `snapshotChanged` (or, equivalently, checks
whether `migrations` is non-empty). `generateMigration` (singular) is
unchanged for existing callers that only need one file's worth of a run
that can't split; it refuses (`migration-requires-split`) a run that
would need two, naming `generateMigrations` as the entry point that
returns the split.

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

Five checks always run, entirely from checked-out files — no live
database connection: snapshot parses, no two migration files share a
version, declarations match the snapshot, the migration chain is linear
(no diverged/broken parent links), and the chain's tip hash matches the
snapshot. Two more can apply on top, independently, each still file/
declaration-based rather than a database connection: the export-
freshness check (only when `generate --export` is in use) and every
registered preset's own validators (only when the active config
registers at least one preset validator) — up to seven checks in one
run, whichever apply; a config with neither never mentions either and
reports the same five it always has. Run it in CI. See
`packages/cli/src/commands/verify.ts` (guide page lands in #109).

The **local Docker round-trip** (`pnpm roundtrip` in an example package)
goes further: it applies the full committed migration chain to one
database and a single fresh migration to another, then diffs the schema
dumps — the deeper, pre-merge check `verify` can't do without a database.

## `hejbro reset`

`hejbro reset --confirm-drop <database>:<count>` drops every object your
declarations manage and clears the ledger for what it dropped — refusing
first without the exact confirmation it names, bound to the connected
database's own name (queried live) so a confirmation learned against one
database can't silently pass, unchanged, against another. Drops run in
reverse *dependency* order: a table that references another declared
table drops before the table it references, so nothing this run also
drops still stands as a dependency when its own turn comes — the same
graph `generate` computes (above), read in the opposite direction, never
the literal reverse of one specific run's own emitted statement sequence.
Declared tables that reference each other in a cycle — two or more,
around one loop — can't all drop first; `reset` leaves them in their
existing identity order and lets the database itself refuse the one drop
that order can't satisfy.

Before it touches anything, `reset` (like `hejbro status`, `hejbro
migrate` and `hejbro raise`) checks who the relation at
`"hejbro"."migration_ledger"` actually is — not merely whether one
exists. It is hejbro's own ledger only when it is an ordinary, logged
table carrying the four columns the bootstrap creates, each under its
bootstrap type (a further column doesn't disqualify it); anything else
at that name — a table of another shape, an unlogged table, a view, a
materialized view, a foreign table, a sequence, a partitioned table —
is refused with the coded `apply-ledger-occupied` error, naming what
was found. `reset`
refuses this way *before* it ever asks for `--confirm-drop`'s
confirmation. None of the four commands reads, writes or clears that
object: it's left exactly as it was, and the error says to move or drop
it yourself, or point `--url` at the database hejbro actually manages.

A drop the database refuses — most commonly an object outside your
declarations still depending on one being dropped, or the declared-cycle
case above — surfaces as the coded `reset-drop-failed` error carrying the
database's own reason. The whole transaction (every drop, and the ledger
clear) rolls back: the database and the ledger are exactly as they were,
`hejbro status` run afterward still reports every previously-applied
migration as applied, and nothing is left half-dropped.

A database whose declared objects were applied outside hejbro (`psql -f`,
an external pipeline) has no ledger table at all — `reset` still drops
every object the declarations manage, but its report says so: "There was
no hejbro ledger to clear" rather than claiming a clear that never
happened.

## When an apply step fails partway through

`hejbro migrate` (D12, amended — applying is now hejbro's own command
surface) sends each migration inside its own
transaction, so a failure partway through one file's statements always
rolls back that whole file — never a partial apply — and its report
names the file, the database's own code and message, and the next
command to run. Earlier migrations in the same `migrate` run keep
whatever they already committed (each file is its own transaction, not
one transaction over the whole run); `hejbro status` then shows exactly
which files are still pending.

An external pipeline (`supabase db push`, a raw `psql -f migration.sql`,
a CI job, …) reading a migration file and running it directly is still
a valid alternative to `hejbro migrate`, and for that path the original
uncertainty still holds: hejbro's own generated SQL carries no
`begin`/`commit` wrapper of its own — every migration file (the banner
example above included) is a plain sequential list of DDL statements —
so whether a mid-file failure under that other tool leaves only the
earlier statements applied, or gets rolled back entirely, depends on
whether *that apply tool itself* wraps the run in a transaction. hejbro
has no way to know which happened there, and no way to inspect the live
database to find out — only `hejbro migrate`'s own path carries that
guarantee.

### What `verify` tells you here, and what it doesn't

`hejbro verify`'s checks are entirely file/declaration-based (see
above, including the export and preset-validator checks) — a green
`verify` after a failed apply confirms your migration *history* is
internally consistent (unique versions, a parseable snapshot, a linear
hash chain, a matching tip hash) and, where they apply, that the export
and every registered preset's validators still agree with your
declarations. It says nothing about the live database: the same checks
pass identically whether the last migration was fully applied, half
applied, or never run at all. There is no database-inspecting check or
option — `verify` cannot see a database, by design.

### A straight retry is not automatically safe

Re-running `hejbro migrate` itself after a failure IS safe: its own
transaction already rolled the failed file back completely (above), so
nothing of it landed for a retry to collide with.

For any OTHER apply tool, this is not automatic. hejbro's generated DDL
has no `if not exists`/`or replace` guard on `create table` (`create
table ...`, rendered verbatim — see
`packages/core/src/kinds/table-kind-emit-sql.ts`) — re-running the exact
same migration file against a database that already has some of its
objects fails on whichever object landed before the original failure
(e.g. `relation "..." already exists`), unless that apply tool wrapped
the whole file in a transaction that already rolled everything in it
back. Whether that's the case is entirely the apply tool's own behavior,
not something hejbro controls or reports. This isn't uniform across every
statement in a migration file, though: a function or a view is always
rendered `create or replace` (`packages/core/src/plpgsql/render-body.ts`,
`packages/core/src/kinds/view-kind.ts`), so re-running one of those
statements alone is idempotent — a straight retry fails first on a
`create table` (or a bare `create schema`/`create index`, which carry no
guard either), before it ever reaches a function or view statement later
in the same file.

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
