# Proposal: harden-check-inventory (#707, #726)

## Why

Two findings against `hejbro check`, one defect: the inventory axis — the
one direction `check` does *not* compare in — stops at the table level, so
a database object sitting on a table hejbro manages is invisible to every
line of the report.

- **#707** — `check` reports a table no declaration covers as
  `unmanaged table (not covered by any declaration)`, and reports nothing
  about an index or a check constraint the database holds on a table a
  declaration *does* manage. Since #706, `import` deliberately omits an
  index or a check whose catalog name no declaration can carry and records
  the omission in its loss report; after the starter declarations are
  adopted, that object stays in the database and no hejbro command ever
  names it again. The loss report says so in as many words ("hejbro will
  not mention it again") — which is an accurate description of a blind
  spot, not a design.
- **#726** — the same loss report tells the user the opposite about a
  column: every `Omitted: column …` line ends "`check` reports this column
  until it is renamed in the database". `check` cannot: `check/compare.ts`
  reads catalog rows through the *declared* column list only, and
  `check/inventory.ts`'s single inventory axis is `unmanagedTables`, a
  table-level set. A database column that no declaration covers produces no
  line and no exit code — the promise is unbacked.

Judged against hejbro's purpose — a declaration set that covers the
database the owner runs on, and a `check` that tells the truth about
whether it does — the two are one rule, not two patches. A reader of a
passing `check` believes the declarations cover the tables `check` did not
complain about; today that belief is wrong at the column, index and check
level, and hejbro's own `import` output promises it is not.

## What Changes

- **`check`'s inventory axis becomes object-level.** Beside the tables no
  declaration covers, `check` reports — as information, never as a
  difference — the columns, indexes and check constraints the database
  holds on a table the declarations *manage* and no declaration covers.
  One rule for all three kinds; none of them is left out.
- **The inventory keeps its boundaries, stated explicitly.** An object is
  inventoried only on a table a declaration manages: an unmanaged table is
  still reported once, with nothing listed beneath it; a table declared
  with `existingTable()` is out of the inventory entirely, its columns
  included; a schema no declaration touches stays out of scope; and an
  index that backs a constraint the declarations name (a declared primary
  key, a declared unique column) is not an unmanaged index, because the
  declaration accounts for it under that constraint's own name.
- **The inventory stays existence-only and exit-code-neutral**, exactly as
  the table axis is today: nothing here reads a type, a default or an
  expression, so nothing here can report a difference that is not one, and
  a project may legitimately leave objects unmanaged.
- **The loss report stops promising what `check` will not do and starts
  describing what it does.** `import`'s promise about an omitted column
  ("`check` reports this column until it is renamed") becomes true by
  behavior rather than by rewording; the omitted-index and omitted-check
  lines lose "hejbro will not mention it again", which this change makes
  false, and name the inventory instead.
- `skills/hejbro` states what the inventory covers; the diagnostics
  cross-reference stays unchanged, since no new error code is introduced
  (the inventory carries none, by the rule it already follows).

## Capabilities

- `cli-commands` — MODIFIED: "Objects the declarations do not manage are
  reported, not failed on" (the inventory axis, its boundaries, its
  ordering). Not modified: "import writes starter declarations from a
  database" — its "`check` reports that column until it is renamed" claim
  is made true by this change rather than reworded.
- `catalog-inference` — MODIFIED: "The loss is announced, with the way
  out" (a loss-report line SHALL describe what `check` will do about the
  object it names, and never claim hejbro will not mention it again where
  `check` will).
- `diagnostics` — no delta: the inventory is not a `Finding` and carries
  no error code.

## Impact

- `packages/cli/src/check/inventory.ts` (the object-level axes and their
  boundaries), `packages/cli/src/commands/check.ts` (`inventoryLines`,
  `EMPTY_INVENTORY`), `packages/cli/src/infer/loss-report.ts` (the
  omitted-index and omitted-check consequence sentences).
- Tests: `packages/cli/test/check-inventory.test.ts`,
  `check-command.test.ts`, `check-live.integration.test.ts` (Docker),
  `infer-loss-report.test.ts`.
- `skills/hejbro/references/brownfield-adoption.md`;
  `.changeset/harden-check-inventory.md`.
