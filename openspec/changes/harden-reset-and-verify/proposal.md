# Proposal: harden-reset-and-verify

## Why

Two commands each promise something they do not check.

1. **`reset` drops declared objects in an order that ignores their own
   foreign keys.** Within one kind (a table, most commonly), drops are
   ordered by identity alone — alphabetically — never by what a table's
   own foreign keys point at. A referencing table sorted after the table
   it references fails to drop with the server's own dependency error,
   and because `reset`'s drop and its ledger clear already share one
   transaction, the half-run rolls back cleanly — but the failure itself
   escapes as an uncaught, uncoded crash rather than a hejbro diagnostic,
   so a caller automating `reset` gets a stack trace instead of a `Next:`
   line.

2. **`verify` never runs a registered preset's own validators.** It
   rebuilds the declared snapshot to compare against the checked-in one
   through the same `generateMigration` call `generate` uses, but that
   call is never handed the registered validators — an omitted argument,
   not a missing feature — so a declaration a preset would refuse at
   `generate` time passes `verify` silently, and CI built on `verify`
   alone cannot gate provider compatibility.

Both were reported against `0.2.0-pre.0` by an external user
(hejbro-assist), reproduced on Postgres 18.6, Neon, and Nile.

## What Changes

- **`reset`'s drop order follows the snapshot's own dependency graph**,
  reversed: a table that references another declared table, through its
  own foreign keys, drops before the table it references. Cross-kind
  order (a view, a policy, a trigger, a sequence, all before their own
  table; a table before its own schema) is already correct today via
  each kind's `dependsOn` — this closes the one real gap, ordering
  *within* a kind, without ever emitting `cascade`: a `cascade` drop
  could remove an object the declarations do not describe, which is
  exactly what this requirement already forbids.
- **A drop that fails is reported as a coded hejbro diagnostic**, naming
  the database's own reason, instead of escaping as a raw, uncaught
  error. The rollback this failure leaves behind (nothing dropped, the
  ledger untouched) is already `reset`'s existing behavior — the gap was
  only in how the failure surfaced.
- **`verify` runs every registered preset's validators as a further
  check**, over the same declared snapshot its existing snapshot-parity
  check already builds, and refuses with the identical coded error
  `generate` would raise for the same declaration. A configuration with
  no preset registered runs exactly as many checks as it does today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`A reset destroys only what the declarations manage`**
  (`migration-apply`) gains the drop-order sentence and the
  coded-failure sentence, plus two scenarios: a referencing/referenced
  pair (with their own schema) dropping cleanly, and a failed drop
  reporting truthfully through both the coded error and a later
  `hejbro status`.
- **`The migration chain on disk is verifiable`** (`cli-commands`) gains
  the sixth check's own sentence and two scenarios: a preset-refused
  declaration failing `verify` with `generate`'s own error, and a
  configuration with no preset registered running unaffected.
- **`A preset refuses declarations its platform will not accept`**
  (`preset-validation`) gains one sentence stating that `generate` and
  `verify` agree on the same refusal, and the scenario that states it.

## Impact

- **Affected code**: `packages/core` (`kind/object-kind.ts`'s extension
  interface, `kinds/table-kind.ts`, `engine/diff-engine.ts`) and
  `packages/cli` (`apply/reset.ts`, `commands/verify.ts`).
- **Breaking**: none. The drop order changes for a declaration set that
  carries a same-kind cross-reference (a foreign key between two
  declared tables); which migrations apply and what a chain records does
  not. A repository whose migrations `generate` already refuses (a
  registered preset's validator failing) now also has `verify` refuse
  it, where it silently passed before; this is the fix, not a
  regression.
- **Publishing**: one `patch` changeset covering both items (`hejbro`
  and, since the drop-order fix and the new `ObjectKind` extension
  member live there, `@hejbro/core` — the fixed seven-package group
  moves together regardless).

## Out of scope

- **A same-kind dependency cycle's own resolution.** Where two declared
  objects of the same kind reference each other (a circular foreign
  key), the ordering leaves them in their existing identity order rather
  than guessing further or falling back to `cascade`; if the database
  then refuses the resulting drop, that refusal surfaces through the
  same coded `reset-drop-failed` path any other drop failure does.
  Teaching `reset` to break such a cycle itself is not part of this
  change.
- **`generate --check`.** The lead's own direction for #752 (run the
  registered validators as a further `verify` check, not a new command)
  settles this; a write-free `generate --check` is not built.
