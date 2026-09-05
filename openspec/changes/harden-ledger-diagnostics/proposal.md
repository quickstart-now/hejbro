# Proposal: harden-ledger-diagnostics

## Why

`harden-ledger-identity` settled *what* may sit at the ledger's name. It
did not settle what happens when the relation there **is** hejbro's own
ledger and the database refuses to let hejbro read or write it. Both
remaining defects live in `packages/cli`'s apply/ledger area, and both
are the same shape: a failure the ledger owns is reported as something
else.

1. **#836 — a ledger read the server refuses reaches the user raw.**
   `readLedger` interprets exactly one server answer, Postgres's own
   "relation does not exist" (42P01), and rethrows every other one
   unchanged. A role that may connect but may not read
   `"hejbro"."migration_ledger"` therefore gets the driver's own error
   object and a stack trace: the identity probe reads the catalog (which
   needs no privilege on the table) and correctly answers "this is the
   ledger", and the very next statement is refused. The command's own
   top-level catch (`asHejbroError`) rethrows anything that is not a
   `HejbroError`, by design — so the raw failure is not a rendering bug
   in one command, it is a missing classification at the one place that
   reads the ledger. Every command that reads the ledger inherits it.

2. **#823 — a ledger write failure is reported as the migration's
   failure.** `applyMigration` runs the migration's own statement and the
   ledger `insert` inside one transaction and one `catch`. The catch
   knows only the filename, so a refusal of hejbro's own `insert` is
   rendered as `apply-failed` naming the migration file — pointing the
   reader at a file that is not at fault, for a run that was rolled back
   in full. The measured case is a ledger whose four bootstrap columns
   are present with their bootstrap types (so the identity judgement
   correctly calls it the ledger) but whose `id` carries no identity and
   no default: the `insert` fails, everything rolls back, and the report
   names the migration.

The two are one rule seen from both directions: **a failure the ledger
owns is attributed to the ledger** — never left raw, never charged to a
migration file.

## What Changes

- **Every failure the server raises on the ledger becomes a hejbro-coded
  diagnostic.** Reading and writing the ledger are the operations; the
  relation's absence stays a *state* (the ledger that does not exist yet),
  not a failure. The diagnostic names the ledger, the connected role, and
  the server's own code and message unsummarized, and ends with a `Next:`
  line.
- **Read and write are told apart**, because they send the reader
  somewhere different: a read refusal is answered by a grant or by
  connecting as the role that applied; a write refusal names hejbro's own
  bookkeeping row as what the database rejected and states that the
  migration's transaction was rolled back in full.
- **The rule reaches every path that touches the ledger**, not the one
  command each issue was filed from: reading (`status`, `migrate`,
  `raise`), writing (`migrate` and `raise`'s bootstrap, recorded row and
  in-transaction recheck; `reset`'s clearing of the rows). One rule, one
  place — `packages/cli/src/apply/ledger.ts` is the only module that
  sends a statement to the ledger, and it is where the classification
  lands.
- **A ledger write failure is never attributed to the migration being
  applied.** `applyMigration`'s single catch learns which half of its
  transaction failed structurally — not by re-reading SQL text — so
  `apply-failed` keeps naming migration files only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`Migrations are applied in chain order, and what was applied is
  recorded`** (`migration-apply`) — the ledger's definition gains the
  read and write failure rules, their two codes, and the scenarios for
  each.
- **`A migration is applied atomically with its own ledger row`**
  (`migration-apply`) — the atomic pair's failure attribution: which half
  failed decides which diagnostic is raised, and the rollback is stated.
- **`What the ledger holds can be read without applying anything`**
  (`migration-apply`) — `status`'s existing "no error the database raised
  reaches the user raw" promise, today scoped to the occupied-name case,
  covers every answer the server gives on the ledger.
- **`A reset destroys only what the declarations manage`**
  (`migration-apply`) — a refused clearing of the ledger's rows is the
  ledger's failure, not a drop's.

`status`'s contract lives in `migration-apply` (`cli-commands`'s Purpose
names it and points here), so no `cli-commands` delta is needed;
`diagnostics` already covers the code-plus-`Next:` shape generically.

## Impact

- **Affected code**: `packages/cli`, plus two no-op `error` listeners in
  `packages/pg` (836/R4: a connection lost during a ledger read killed
  the process before any `catch` could report it — the delta's "no error
  reaches the user raw" sentence cannot hold without them; the driver
  contract never promised a crash). Two, not one, and measured: the
  pool's own `error` event covers **idle** clients only, so silencing it
  alone still crashed with `Emitted 'error' event on Client instance` —
  a checked-out client raises its own. The second listener is therefore
  attached per checkout, in `execute` and in `transaction`. Both are
  no-ops: the waiting query still rejects through its own promise and
  travels the ordinary tagged-failure path, and the listeners' only job
  is to stop Node from treating the event as fatal —
  `src/apply/ledger.ts` (the classification and its two codes),
  `src/apply/execute.ts` (which half of the transaction failed),
  `src/apply/raise.ts`, `src/apply/reset.ts`, `src/commands/status.ts`,
  `src/commands/migrate.ts`, their unit tests, a live witness, and
  `skills/hejbro/references/generate-verify-workflow.md`.
- **Breaking**: none for a database hejbro can read and write — that path
  is untouched. A database that refuses hejbro's own ledger statements
  now gets a coded diagnostic where it got a stack trace (#836) or a
  diagnostic naming the wrong artifact (#823). Two new error codes.
- **Publishing**: one `patch` changeset (`hejbro`; the fixed seven-package
  group moves together).

## Out of scope

- **Granting, repairing or migrating the ledger.** The diagnostic names
  what the server refused and what to do; hejbro issues no `grant` and
  alters no column.
- **Retrying under another role or connection.** One connection, one
  answer; a failed run is rerun by the user.
- **Classifying failures outside the ledger.** A migration's own refusal
  keeps `apply-failed`, the catalog probe keeps `apply-ledger-occupied`,
  and the connection family (`apply-connection-*`) is untouched.
