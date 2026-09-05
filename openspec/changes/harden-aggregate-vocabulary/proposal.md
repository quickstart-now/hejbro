# Proposal: harden-aggregate-vocabulary (#452)

## Why

Two packages classify the same builder functions by hand, on two sides
of one invariant. `@hejbro/core`'s nested-read compiler decides which
cells get a `::text` cast so a value survives JSON transport (`count()`
always; `min`/`max` by the argument's type); `@hejbro/query`'s
conversion decides which cells are revived (`count`/`row_number`/`rank`/
`dense_rank` as `int8`; `min`/`max`/`lag`/`lead`/`first_value`/
`last_value`/`nth_value` as their argument). The lists already
disagree: the revive side knows the window value functions and reads a
windowed cell through its inner call, while the cast side neither
unwraps a window node nor names any window function — so a nested
`over(count(), …)` cell past 2^53 is revived from a JSON number that
has already lost its precision. The existing guard is a fixed set of
three shapes; a function added to one side and not to the guard is not
caught. Precision inside a nested read is the one thing D102's
cast-and-revive promised, and a promise kept by two hand lists is not
kept.

## What Changes

- **One vocabulary in core.** A closed table, keyed by every builder
  aggregate and window function name, states how each result reads
  back: as `int8` (`count`, `row_number`, `rank`, `dense_rank`), as its
  first argument's own type (`min`, `max`, `lag`, `lead`, `first_value`,
  `last_value`, `nth_value`), or as its own JSON-safe shape (`sum`,
  `avg`, `percent_rank`, `cume_dist`, `ntile`). The key type is the
  union of the constructors' own names, so a constructor added without
  a row fails to type-check, and a test enumerates the constructors
  from the public surface so a name string that drifts from its row is
  caught at run time too.
- **Both sides read the table.** The cast side casts a cell whose
  function reads back as `int8` or as its argument — a windowed cell
  through its inner call, exactly as the revive side already reads it —
  and the revive side keeps its behaviour, now derived from the same
  rows. `sum`/`avg` stay neither cast nor revived.
- **The guard becomes a ratchet.** The agreement test iterates the
  table: for every row, a nested cell is cast exactly when it is
  revived, windowed and unwindowed alike; a live witness shows a
  nested `over(count(), …)` value past 2^53 arriving intact.
- The user-facing skill states that windowed cells keep their
  precision inside a nested read; one `patch` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`query-execution`** — MODIFIED requirement: *Nested values are
  revived to their declared types* — the aggregate paragraph names one
  vocabulary for every builder function, windowed cells included, and
  two scenarios pin a windowed cell's precision and the vocabulary's
  closure.
  Also MODIFIED: *A db handle executes built statements* — the
  preview-equals-executed scenario is qualified to the statement's own
  send, so a handle with an applied execution context (whose context
  statements precede the caller's on the same transaction) is no longer
  literally unsatisfiable as worded. No code moves for this clause.

## Impact

- `@hejbro/core`: a new `expr/read-shape.ts` table exported from the
  barrel (the same way `SELECT_CLAUSE_TRAVERSALS` is), the nested-read
  cast in `query/select.ts` reading it.
- `@hejbro/query`: `db/convert.ts` reading it in place of its two lists;
  the drift guard in `test/db/nested-revive.test.ts` rewritten as a
  table-driven ratchet.
- `@hejbro/pg`: one live-witness case.
- `skills/hejbro`: the query-layer reference's nested-read sentence.
