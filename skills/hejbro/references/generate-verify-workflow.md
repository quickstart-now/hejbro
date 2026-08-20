# generate / verify workflow

Read this when running `hejbro generate`/`hejbro verify`, reading the
migration banner, resolving an ambiguous rename, or reading a warning.

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

Four checks, entirely from checked-out files — no live database
connection: snapshot parses, declarations match the snapshot, the
migration chain is linear (no diverged/broken parent links), and the
chain's tip hash matches the snapshot. Run it in CI. See
`packages/cli/src/commands/verify.ts` (guide page lands in #109).

The **local Docker round-trip** (`pnpm roundtrip` in an example package)
goes further: it applies the full committed migration chain to one
database and a single fresh migration to another, then diffs the schema
dumps — the deeper, pre-merge check `verify` can't do without a database.
