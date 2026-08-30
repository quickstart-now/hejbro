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

## Decisions

Settled at approval; the remaining detail (names and shapes) is settled
in the `[design]` tasks. Each records the alternative it was chosen
against.

### One throwing helper, not three exports

`@hejbro/query` exports a single `never`-returning helper that throws the
missing-capability failure. Rejected: also exporting a builder that
returns the `Error`, and exporting `assertCapability` — both are
composable from, or redundant with, the one export, and the use to serve
is the spec scenario "a driver's own transaction member refuses when the
capability is false". The name is settled in `[design]` against the
existing diagnostic naming family. Machine check for done: the copied
message string appears nowhere outside `@hejbro/query`.

### A conformance kit, not a runtime guard

An `assertCapability(driver, "session-state", …)` at the execute path is
rejected outright: the driver-contract spec does not merely permit a
`session-state: false` driver, it *obliges* one to carry the settings
value conversion depends on with every statement it executes (and to
keep declaring `false` all the same). A guard there would refuse a
driver that is discharging that obligation. Instead `@hejbro/query`
gains a conformance kit each driver package runs against its own driver.

Its binding design constraint: the kit checks **tier-specific
obligations**, never "declaration equals behavior". Declaring `false`
and applying the settings per execution is the spec's own prescribed
combination, so a kit that inferred or corrected the declaration from
observed behavior would violate the requirement that such a driver still
reads `false`. Exposure (whether the kit is a public subpath export —
the justification being that out-of-repo driver authors are consumers
too) is settled in `[design]`.

### Deliberately not added: query-owned session settings

Centralizing the pin SQL in the query layer (ending its three copies at
`packages/pg/src/driver.ts:94`, `packages/neon/src/driver.ts:51-52`,
`packages/neon/src/http.ts:41-44`) is *not* part of this change. The
conformance kit makes a drift between those copies observable, which was
the reason to centralize; what would remain is the cost of modifying a
standing requirement (today the hook's contents are "that driver's
responsibility, not the query layer's"). Revisit when a fourth copy
appears.

### A data slot on the kind, not a comparator function

The extension interface gains a **data** contribution: a kind declares
that no catalog object backs it, with the reason. Rejected: a
function-valued comparator slot, which would drag the CLI's catalog and
finding types across the preset boundary (a preset may use core's
extension interface plus the query driver contract, nothing else), and
which no existing kind needs — there is no custom kind today that a
catalog *could* compare. That makes a function slot speculative surface
rather than a gap that can be closed; the boundary is stated in the spec
and cited at the code site by issue number, to be decided when a third
provider actually asks for it.

### Two categories, not one, for what `check` did not compare

A kind that declares itself uncomparable by design (the storage bucket:
the Storage API owns that row, no catalog object exists) is stated in
the report's coverage-boundary section and leaves the exit code
unchanged. A comparison that *should* have happened and could not
(missing privilege, unrenderable expression, an unregistered kind)
stays `check-not-compared` and still forbids exit zero. Today's spec
text does not distinguish the two, and reading it as one category would
turn every clean Supabase run into an exit 2 — which was never its
intent; its intent is that `check` must not report a difference it did
not find. Drawing that line is the substance of the `cli-commands`
delta.

## Approval

Approved 2026-08-30 by the lead session under the owner's standing
delegation, with the five decisions above; proposed by this piece's
planner. To be surfaced to the owner on return.
