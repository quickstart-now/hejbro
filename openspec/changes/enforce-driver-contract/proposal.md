# enforce-driver-contract

## Why

The design proposition "the provider interface is the product" is only as
good as what the code actually observes. Four places declare a contract
and never check it — found by the Neon preset piece (the second provider
was the instrument) and by the 2026-08-29 UX audit:

- **#481** `DriverCapabilityKey` has two members and only one is read.
  Measured on this branch (`00dfcf0`): `assertCapability` is called at
  `packages/query/src/db/context.ts:173` and
  `packages/query/src/db/transaction.ts:300`, both with
  `"interactive-transactions"`; no call anywhere in `packages/*/src`
  passes `"session-state"`. A driver that honestly declares
  `session-state: false` is stopped by nothing.
- **#490** A driver that lacks a capability must throw the
  missing-capability error, but `@hejbro/query` exports neither the
  builder nor `assertCapability` (`packages/query/src/index.ts` lists
  driver *types* only). So `packages/neon/src/http.ts:53-63` reproduces
  the message, `code`, and enriched fields of
  `packages/query/src/driver/errors.ts:4-14` — its own comment records
  the copy as deliberate ("kept byte-identical here rather than
  diverging just because this driver has no access to the original").
  The copy count grows with every preset; nothing pins the identity (the
  one drift check on record was human-run, #490's own comment).
- **#482** `hejbro check` hardcodes a preset's kind:
  `"supabase-storage-bucket"` is a key in `KIND_COMPARATORS`
  (`packages/cli/src/check/compare.ts:705-723` at filing;
  `:686-723` on this branch) — the only preset-boundary leak into the
  CLI. Any kind not in that object is reported as
  `check-object-differs` (`compareEntry`, `:728-746` at filing,
  `:736-745` here), while the cli-commands spec requires the opposite:
  an object the command cannot compare is reported as **not compared,
  with the reason**, and never counted as a difference. The spec is
  right and the code violates it — no spec change is needed for that
  half.
- **#475** `skills/hejbro/references/dsl-cheatsheet.md` carries two
  `## Foreign keys` sections (`:85` and `:145`), the second unaware of
  the first and presenting `extras.foreignKeys` as the only form; and
  `compare.ts` holds a four-row table as four functions
  (`comparePrimaryKey`/`compareUniqueConstraints`/`compareForeignKeys`/
  `compareChecks`, each passing one `(type letter, description)` pair to
  the already-extracted `compareConstraintExistence`). Same file as
  #482, so it rides along rather than touching that file twice.

#481 and #490 are one disease in two places: the query layer holds a
requirement, exports no way to satisfy or observe it, and each preset
re-derives it by hand.

## What changes

1. **A missing-capability error is constructed, never copied** (#490).
   `@hejbro/query` gains a public way for a driver to produce the
   contract's own missing-capability failure, and `@hejbro/neon`'s HTTP
   driver uses it instead of its copy. The user-facing text has exactly
   one definition after this change.
2. **The `session-state` declaration becomes observable** (#481).
   Today's gap is not a missing `assertCapability` call at the execute
   path: the driver-contract spec deliberately blesses a
   `session-state: false` driver that carries the settings with every
   statement (the Neon HTTP path), so a guard there would refuse a
   driver the spec admits. What is missing is that *nothing checks
   either half of that bargain*. This change makes the bargain
   observable for every driver, in-repo and out — shape settled in
   `[design]` before code.
3. **`check` routes custom kinds through the registry** (#482). The
   extension interface gains an optional, additive comparison
   contribution — the same optional-additive pattern `siblingChanges`,
   `nextSnapshot`, and `requiredKeys` already established — and
   `compare.ts` stops naming any preset's kind. A declared object whose
   kind the run cannot compare is reported as *not compared, with the
   reason* (`check-not-compared`, the code
   `packages/cli/src/check/expression.ts` already uses), never as a
   difference.
4. **Two documentation/shape fixes** (#475). The cheatsheet's two
   foreign-key sections merge into one with a when-to-use-which table
   (both entry points are legitimate: the column-level form feeds
   relation typing, `extras.foreignKeys` covers composite,
   self-referencing, and `onDelete`/`onUpdate`). `compare.ts`'s four
   constraint wrappers become the table they already are.

## Impact

- `packages/query`: driver error surface + public exports; whatever
  decision 2 settles.
- `packages/neon`: HTTP driver drops its copied error text.
- `packages/core`: `ObjectKind` (or `Preset`) gains one optional member —
  additive, so every existing kind, in-repo or third-party, is
  unaffected.
- `packages/cli`: `check/compare.ts` routing and the constraint table;
  `commands/check.ts` only if decision 4 changes what an uncomparable
  kind does to the exit code.
- `packages/supabase`: its bucket kind declares what the CLI used to
  hardcode.
- Spec deltas: `driver-contract` (#481/#490) and `cli-commands` (#482).
- `skills/hejbro`: the cheatsheet section merge, plus the query-layer and
  preset references if the public surface grows.
- One `.changeset/*.md` (`minor` — new public surface on published
  packages).

## Open decisions

Settled with the lead in the `[design]` tasks before any production
code; each names the alternatives it is chosen against.

- **D1 — the missing-capability export's shape.** A throwing helper
  (`never`-returning, what `@hejbro/neon` needs today), a builder that
  returns the `Error`, and/or `assertCapability` itself for drivers that
  want to enforce their own declaration. Fewer exports is better; the
  spec scenario "a driver's own transaction member refuses when the
  capability is false" is the use to serve.
- **D2 — how `session-state` becomes observable.** Candidates: (a) a
  driver-conformance kit exported from `@hejbro/query` that every driver
  package runs against a recording session, asserting the declaration
  matches behavior (`false` ⇒ the required settings ride with each
  statement; `true` ⇒ the session-setup hook delivers them); (b) the
  same, but kept in-repo with no public export; (c) narrower — the query
  layer names the settings its value conversion depends on as exported
  data, ending the three hand-copies of the pin SQL
  (`packages/pg/src/driver.ts:94`, `packages/neon/src/driver.ts:51-52`,
  `packages/neon/src/http.ts:41-44`). (c) modifies a standing spec
  requirement (today the hook's contents are "that driver's
  responsibility, not the query layer's"), so it is a decision, not a
  detail.
- **D3 — the comparison slot's name and shape.** `ObjectKind.compare?`
  versus `Preset.comparators?`; and function-valued (a real comparator,
  which would drag the CLI's catalog types across the preset boundary —
  presets may use core plus the query driver contract, nothing else)
  versus data-valued (the kind declares that no catalog object backs it,
  with the reason, and the CLI keeps every comparator it owns). This is
  the extension interface itself, so the lead ratifies it.
- **D4 — what an uncomparable kind does to the exit code.** Today the
  bucket kind returns zero findings, i.e. `check` reports it as
  agreeing. The spec forbids passing an object that was not compared,
  and `check` exits 2 when every finding is `check-not-compared` — so
  the honest report may turn every Supabase project's clean run into an
  exit 2. The alternative is a third category: an object stated in the
  coverage-boundary section (which the spec already requires the report
  to carry) rather than counted as a finding.

## Approval

Pending. Proposed by the driver-contract piece's planner; the lead
approves under the owner's standing delegation.
