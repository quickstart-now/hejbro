# Proposal: harden-ledger-identity

## Why

The commands that touch hejbro's own ledger judge it by the wrong fact,
and one piece of `reset`'s advice is narrower than the sentence it claims
to cover. All of it lives in `packages/cli`'s apply/ledger area.

1. **`reset` judges the ledger by existence, not identity.** It asks
   `to_regclass('"hejbro"."migration_ledger"')` and, when anything answers,
   runs `delete from "hejbro"."migration_ledger"` inside its drop
   transaction. An unrelated table that happens to carry that name loses
   every row, and the run exits 0 reporting "cleared the ledger" — the
   tool destroying what it says it does not own, under a success line.

2. **`status` dies on a raw stack when the ledger's name is held by
   something else.** With a view at that name, `status` exits 1 printing
   `column "origin" does not exist` and a stack trace: `readLedger`
   tolerates only Postgres's own "relation does not exist" (42P01), and
   `status` has no coded rendering for any other answer.

3. **`migrate` and `raise` read the ledger the same way**, so they fail
   the same raw way — and `migrate` is the worst case: its bootstrap's
   `create table if not exists` skips any relation at that name with a
   notice, so against an unrelated table that happens to carry the
   ledger's four column names, hejbro's own `insert` lands in a table it
   never created.

4. **`reset`'s cycle advice fires only for a two-table cycle.** The check
   behind the "your own declared objects include a pair that reference
   each other" clause detects mutual direct references only. Three tables
   in one loop (`t_a → t_b → t_c → t_a`) are flushed in identity order,
   refused by the database with `2BP01` and rolled back exactly as the
   contract says — but the `Next:` line then names only the
   outside-the-declarations possibility, sending the user to look for an
   object that is not there.

The first three are one defect seen from four commands: none asks *what*
sits at the ledger's name, only *whether* something does. The fix is one
judgement, shared.

## What Changes

- **The ledger is recognized by identity.** One catalog read, shared by
  every command that touches the ledger, judges the relation at
  `"hejbro"."migration_ledger"`: an ordinary table carrying the four
  columns the bootstrap creates, each with its bootstrap type, is the
  ledger (a further column does not disqualify it); anything else — a
  table of another shape, a view, a materialized view, a foreign table,
  a sequence, a partitioned table — is not, and is never read, written
  or cleared as one.
- **One refusal, `apply-ledger-occupied`**, naming the kind of object
  found and its columns, with a `Next:` line. `migrate` refuses before
  its bootstrap and exits two; `status` refuses instead of crashing;
  `reset` refuses before asking for a confirmation and sends no drop and
  no delete; `raise` refuses before its history read, leaving nothing
  behind. An absent relation stays the no-ledger case each command
  already handles.
- **`reset`'s cycle detection covers a cycle of any length**, so the
  advice states that the declarations contain a cycle whenever they do —
  two tables or twenty around one loop; a table referencing only itself
  is not a cycle. The advice wording drops "a pair" for "a set of your
  declared tables"; the code (`reset-drop-failed`) and its detail-first
  ordering are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`Migrations are applied in chain order, and what was applied is
  recorded`** (`migration-apply`) — the ledger's definition gains the
  identity rule, the shared code, `migrate`'s refusal before bootstrap,
  and two scenarios (the shapes told apart; `migrate`'s refusal).
- **`What the ledger holds can be read without applying anything`**
  (`migration-apply`) — `status`'s refusal and its scenario.
- **`A reset destroys only what the declarations manage`**
  (`migration-apply`) — the refusal before confirmation, the cycle
  sentence generalized to any length, and one scenario for each.
- **`A database can be raised from a snapshot SQL file`**
  (`migration-apply`) — `raise`'s refusal before its history read, and
  its scenario.

`status`'s contract lives in `migration-apply` (the `cli-commands` Purpose
names it and points here), so no `cli-commands` delta is needed;
`diagnostics` already covers the code-plus-`Next:` shape generically.

## Impact

- **Affected code**: `packages/cli` only — a new
  `src/apply/ledger-identity.ts` (the shared probe and its refusal),
  `src/apply/ledger.ts` (`ledgerTableExists` retired),
  `src/apply/reset.ts`, `src/apply/raise.ts`, `src/commands/migrate.ts`,
  `src/commands/status.ts`, their unit tests, the reset live witness,
  and `skills/hejbro/references/generate-verify-workflow.md`.
- **Breaking**: none. A database whose ledger's name is held by something
  hejbro did not create now gets a refusal where it got data loss
  (`reset`), a stack trace (`status`, `raise`) or a write into a
  stranger's table (`migrate`); a real ledger, present or absent, behaves
  exactly as today. One new error code.
- **Publishing**: one `patch` changeset (`hejbro`; the fixed seven-package
  group moves together).

## Out of scope

- **Repairing or moving the object found at the ledger's name.** The
  diagnostic names it and says what to do; hejbro does not touch it.
- **Resolving a declared cycle.** The members still drop in identity
  order and the database's refusal is still reported; breaking the cycle
  is not built.
