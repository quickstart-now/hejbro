# Renames

`hejbro generate` never guesses. Any same-table column drop+add — regardless of whether the types match — is treated as an *ambiguous rename candidate* (rule A); cross-table moves are never rename candidates. There is no interactive prompt: you resolve it with a flag, or accept the drop+add as two separate changes.

## Flag grammar

- `--rename <schema>.<table>.<old>=<new>` — confirms a column rename.
- `--rename <schema>.<old_table>=<new_table>` — confirms a table rename.
- `--confirm-drop <schema>.<table>.<column>` — confirms a genuine drop (not a rename).
- `--confirm-drop <schema>.<table>` — confirms a genuine table drop.

Both flags are repeatable — pass one per ambiguity.

## Worked example: an ambiguous column rename

Start from a table with a `slug` column, then rename it to `handle` in the declaration:

```ts
// before
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	slug: text().notNull(),
});

// after
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	handle: text().notNull(),
});
```

```
hejbro generate
```

```
error[ambiguous-column-rename]: app.posts
  column "slug" was dropped and column "handle" was added in the same
  generate run — hejbro exited without writing SQL for this table; it
  won't guess between two possible next steps.

  → if this is a rename, rerun:
      hejbro generate --rename app.posts.slug=handle

  → if these are unrelated changes, rerun:
      hejbro generate --confirm-drop app.posts.slug

  at src/app.schema.ts:5:49
```

If this is a rename:

```
hejbro generate --rename app.posts.slug=handle
```

```
hejbro generate
loaded 2 declarations
wrote migrations/20260821013105_migration.sql
-- hejbro migration
-- ~ table app.posts [column "slug" renamed to "handle"]
-- parent-snapshot: sha256:743dd1b6546928b6605322a057a2fb70884be0a2ea506307c848c6d68efcc4b1
-- snapshot: sha256:a39c8fc7b5f0cb1be3162c6c42f80a45f731fd3dd790261b768711f37f3ea54a
```

If they're genuinely unrelated (a drop and a separate add), confirm the drop instead:

```
hejbro generate --confirm-drop app.posts.slug
```

## Table renames

The same shape applies one level up — a dropped table plus a created table in the same run is `ambiguous-table-rename`. A table rename recreates every column, index, foreign key, RLS policy, and trigger on it, so hejbro will not guess:

```
hejbro generate --rename app.old_table=new_table
```

## When you don't want a flag at all: expand–contract

For a rename you'd rather ship as two safe, backward-compatible steps:

1. **Expand** — add the new column (nullable; no `--rename` needed, since nothing was dropped this run), generate, deploy, backfill data (the new column is appended at the end of the table — Postgres has no "add column at position", and hejbro mirrors that in its snapshot).
2. **Contract** — drop the old column in a later `generate` run, confirming it with `--confirm-drop`.

This avoids a single migration that both adds and drops in the same statement batch — useful when you need a deploy window between the two.

## Expressions retarget too

RLS policy `using`/`with check`, CHECK constraints, index predicates and
index expression columns, and view queries are stored in the snapshot as
structured expression nodes, not rendered SQL text (D67/D70) — so a
`--rename` retargets the identifiers inside them exactly, the same way it
retargets a plain column reference. Renaming a column used inside
``index("…").on(sql`lower(${t.email})`)``, for example, retargets the
stored expression to the new column name — no index DDL is emitted (no
drop, no create), only the `alter table … rename column` statement, and no
ambiguity error. See the [indexes guide](indexes.md) for the
expression-index example end to end.

## Rolling back

There is no `hejbro rollback` command — migrations are forward-only, the same way `git revert` adds a new commit instead of rewriting history:

1. To undo a change, edit your declaration files back to the prior shape and run `hejbro generate` again — this produces a new, forward migration that happens to move the declared state backward, not a rewrite of an existing one.
2. That new migration's `snapshot:` hash converges to the same value the chain had before the change being undone, so `hejbro verify` and the committed chain agree once it's applied.
3. Never `git revert` (or hand-edit) a committed migration `.sql` file or `hejbro.snapshot.json` — the chain's `parent-snapshot`/`snapshot` lines are hashes of the declaration snapshot before and after each migration, so reverting a file, editing one of those two hash lines, or editing the snapshot breaks the chain (`hejbro verify`'s check 3, or check 4 for the last migration's `snapshot:` line). The chain's head is the one place `verify` takes as given: the first migration's own `parent-snapshot:` line is not checked, and deleting the first migration — or any leading run of migrations — leaves a chain that still verifies; never rely on that. The two hash lines are not hashes of the file's SQL body either: a body edit that leaves them intact is not something `verify` can see, which is one more reason never to make one. The only migrations safe to delete are ones that were generated but never applied anywhere.
4. A rollback that drops a column emits without needing a `--rename` flag (it's a genuine drop, not a rename candidate), but it can lose data — Postgres drops the column's stored values along with it. If the rollback needs to preserve data, use [expand–contract](#when-you-dont-want-a-flag-at-all-expand-contract) instead of a straight drop.

Known limitation: `hejbro verify`'s check 3 doesn't yet distinguish "the chain rolled forward back to a snapshot state it already passed through" from a genuinely diverged chain; see #129.
