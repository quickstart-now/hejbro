# Proposal: add-check-schema

## Why

hejbro compares declarations to its snapshot, never to the live schema. A
column typed `text` that is really `varchar(120)` produces a clean
`verify` and a wrong migration the first time that column changes. The
failure is silent in the worst way: every signal the tool gives says the
project is healthy, right up to the migration that breaks.

`baseline` (#441) closed the registration half of adoption — a database
hejbro did not create can now be adopted. The other half was left
explicitly open, in this capability's own main spec:

> Introspection — reading a live schema or a dump *to write declarations*
> — is NOT part of this: the user writes the declarations, and
> **confirming they match the live schema stays a separate step.**

This change is that separate step. It is not the introspection-assisted
generator #442 also weighs: writing declarations is work a user can do,
and `add-baseline-adoption` already settled that a generator is the
larger surface and not what unblocks adoption. A checker stays useful for
the life of the project; a generator is run once.

## What Changes

- **`hejbro check`**, a new command. It opens a **read-only** connection
  to a live database (`--url`, else `DATABASE_URL`), builds the declared
  snapshot in memory — the same `generateMigration` first pass `verify`
  already uses — and compares it to the database's own catalog, object by
  object.
- **What it compares**: existence by identity for every declared kind;
  for columns, type, `notNull` and default; for expressions (check
  constraints, index predicates, generated columns) the *server's own*
  rendering of both sides.
- **What it reports**: one finding per object, with a hejbro error code
  and a `Next:` line. Never a raw diff — a diff hunk does not carry the
  identity of the object it belongs to.
- **What it says it does not check.** The command states its own
  coverage boundary in its report. A checker that stays quiet about its
  blind spots is read as a guarantee it never made.
- **Unmanaged inventory**, informational: tables inside the declared
  schemas that no declaration covers, and the extensions the database
  has. Existence only, no exit-code effect. This is the honest answer to
  "check passed, so my declarations cover this database" — they may not.
- **Driver**: `@hejbro/pg` as an optional peer, imported dynamically,
  with a hejbro-coded diagnostic naming the install command when it is
  absent. The connection string is never read from `hejbro.config.ts`:
  that file is committed, and a database URL carries a secret.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-commands`: the `check` command — what it compares, what it
  refuses, what its report must state about its own coverage, and the
  inventory it reports without failing on.

## Impact

- **Affected code**: `packages/cli` only — a new `check` command plus a
  catalog/comparison module and its driver acquisition. `@hejbro/core`
  is **unchanged**: `diffSnapshots`, `decodeExprNode`, `renderExpr` and
  `renderTypeNode` are already public exports, and core stays a pure
  transformation over declarations. No file under `packages/core`,
  `packages/query` or `packages/pg` is edited.
- **Driver contract**: unchanged, and no capability is required beyond
  the parameterless read-only statements every driver must already
  support. This was not free: an earlier form of the expression
  comparison needed `SET` to pin the plan shape, which would have made
  the command depend on a driver's session-state capability. Comparing
  the expression as an *output* rather than a *predicate* removed that
  dependency along with two other hazards (below).
- **Breaking**: none. New command, no change to existing output.
- **Decision log**: no existing decision is revisited. D12 ("hejbro does
  not apply migrations") is about writing; this command only reads, and
  it reads without opening a transaction or setting session state —
  `EXPLAIN` without `ANALYZE` plans a statement without running it. That
  the CLI gains a database connection at all is new ground for the tool
  and is recorded here rather than assumed.

## Why a live connection and not a dump file

#442 names the command `hejbro check --schema <dump>`. Measurement says
a dump file cannot be the input, and the reason is worth recording
because it is not obvious.

There is no SQL parser anywhere in this repository — every SQL path runs
in the emit direction — so reading a dump means either writing a parser
or replaying the dump into a scratch database. Replaying was measured:
a `pg_dump --schema-only` of `examples/postgres` restored into a database
whose roles do not exist produces 40 errors, **exit code 0**, and a
database missing **12 of 12 RLS policies and 48 of 104 grants**. A check
run against that database reports every policy as absent. The tool would
be loudly wrong about the one feature this product leads with.
`ON_ERROR_STOP=1` inverts the failure rather than fixing it: the restore
stops at the first grant and nothing is compared at all.

Parsing the dump text instead was measured on the comparison side, not
just the input side: pg_dump output is version-sensitive in content, not
only in headers. The same schema dumped by pg15 and by pg16/17 differs in
the body of a view, because PG16 changed `pg_get_viewdef` to drop
unnecessary table qualification — six lines of pure false positive per
view, on a schema that is identical. hejbro controls neither the version
nor the flags a user's dump was made with.

Reading the catalog over a connection has neither problem: the same three
server versions returned byte-identical results for the fields this
command compares.

## Why the server renders both sides of an expression

Comparing our rendered expression text to the catalog's text was measured
and does not work: 23 expression-bearing fields in `examples/postgres`
produced **14 false positives**, including **8 of 8 check constraints**.
Postgres rewrites expressions on write — `in (...)` becomes
`= ANY (ARRAY[...])`, `between 1 and 200` splits into two comparisons,
and casts appear *inside* the expression rather than at its end, where
the existing normalization could strip them. Normalizing that away is not
normalization; it is reimplementing Postgres's expression rewriter, and
the 8-of-8 rate on a schema this repository maintains is the ceiling, not
the floor.

The cause is asymmetry: only one side had been through the server. Send
both sides through the *same server in the same session* and the rewrite
cancels — measured, 8 of 8 check constraints match. The check that
matters is the opposite one: expressions that genuinely differ must still
be reported. Six true differences (a changed bound, a missing list
member, `>=` against `>`, a dropped function call, a narrowed regex, two
swapped columns) were **all six** reported as different. Cancellation
does not swallow real differences.

*How* both sides are sent through the server turned out to matter as much
as the fact that they are. Compared as a query predicate, the expression
is at the mercy of two things that have nothing to do with whether the
declaration is right: the planner moves it depending on which indexes
exist (measured: adding one index moves the predicate from `Filter` to
`RecheckCond` *and* `IndexCond` at once, so two probes run seconds apart
can disagree because a background `analyze` ran in between), and
row-security rewriting deletes it outright for a role with no policy —
measured, two genuinely different constraints then compare **equal**, a
false pass produced by the checker itself.

Compared as an *output expression* instead, neither applies: it is not a
qual, so the planner has nothing to move and row-security has nothing to
remove. Measured on the same fixtures, the two forms cancel identically
(8 of 8) and detect identically (6 of 6), and only the output form
survives an index on the probed column and a role with no policy. It also
needs no `SET`, which is why this command requires no driver capability,
and it puts boolean predicates and scalar expressions (a generated
column) on one path instead of two.

This comparison is syntactic equality after the server's own rendering,
not a proof of semantic equivalence. Reordered operands are reported as a
difference — correctly: hejbro's own snapshot diff treats a reordered
declaration as a change too.

## Out of scope

- **A dump file as input** (`--schema <dump>`), for the measured reasons
  above. Reopen as a new issue if organizations that only ever receive a
  dump turn out to be a primary scenario — the cost is a real SQL parser,
  and that decision should be made against that price, not by inheriting
  the phrasing of an issue title.
- **Writing declarations from a live schema.** The generator half of
  #442, already weighed and declined once in `add-baseline-adoption`.
- **View bodies.** A whole query's plan shape depends on statistics and
  join order, not only on semantics, so the same-server trick that works
  for a scalar expression is not sound for a view body. The command says
  it does not check them.
- **Applying anything.** The connection is read-only and the command
  never writes, creates a scratch database, or requires `CREATEDB`.
- **A driver factory in `hejbro.config.ts`** (which would also let a
  Supabase-decorated driver be used here): #458.
