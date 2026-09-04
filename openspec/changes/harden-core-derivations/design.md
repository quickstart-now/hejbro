# Design: harden-core-derivations

Mechanisms only. Open decisions are settled by the lead before
implementation and recorded in the work items' decision logs, not here.

## Reserved names (`packages/core/src/plpgsql/reserved.ts`)

- `reservedPlpgsqlNames` gains, alphabetically: `analyse`, `analyze`,
  `current_catalog`, `except`, `found`, `lateral`, `sqlerrm`,
  `sqlstate`, `system_user`, `tg_argv`, `tg_event`, `tg_level`,
  `tg_name`, `tg_nargs`, `tg_op`, `tg_relid`, `tg_relname`,
  `tg_table_name`, `tg_table_schema`, `tg_tag`, `tg_when`.
  Evidence for the keyword rows is Postgres's own keyword table
  (`RESERVED_KEYWORD` category; `system_user` reserved since PostgreSQL
  16, inside the supported range); evidence for the variable rows is the
  plpgsql manual's list of variables it declares (`FOUND`, `SQLSTATE`,
  `SQLERRM`, the trigger variables).
- `assertValidLocalName` compares `name.toLowerCase()` against the set.
  Argument names are already lower-case by the SQL-name rule; row and
  loop names are rendered as given, and an unquoted identifier folds to
  lower case in Postgres, so the fold is what makes the check match the
  server's resolution.
- Message prose is widened to say what the check observed — a name
  plpgsql reserves as a keyword or declares itself — under the same code
  and the same `Next:`.

## Duplicate argument names (`packages/core/src/dsl/define-function.ts`)

- In `resolveArgs`, after the per-key `map` (which already runs
  `assertSqlName` then `assertValidLocalName` per key in declaration
  order), find the first entry whose `argName` an earlier entry already
  produced (`findIndex` over the resolved list against a `Set` built by
  `reduce`, or the `indexOf !== index` form `buildColumnEntries` uses),
  and throw `duplicate-argument` naming the identity, both keys and the
  shared name. Extracted as its own helper so `resolveArgs`' branch
  count stays under the CRAP gate.

## Same-identity changes in the refinement (`packages/core/src/engine/diff-engine.ts`)

- `refineByDependsOnIdentities` groups `changes` by identity into a
  `ReadonlyMap<string, ReadonlyArray<KindChange>>` (insertion order —
  the changes arrive already sorted by identity with a stable sort, so
  same-identity entries are adjacent and in the kind's reported order),
  runs the waves over the *unique* identity list, and flattens each
  placed identity's group back out. `buildPredecessors` already
  tolerates repeated identities (set union); `runWaves` gets a
  duplicate-free list and needs no change.
- `preRefinementOrder` in `sql/migration-file.ts` re-sorts by identity
  with a stable sort and is unaffected.
- The test kind (first custom `ObjectKind` in `diff-engine.test.ts`):
  registered on a standalone `createKindRegistry()` under a hyphenated
  name (`"test-kind"` — an unprefixed name outside the core ids is
  refused by `register`), `dependsOn: []`, `owns: () => false`,
  `serialize`/`emit` stubs (`emit: () => []`), `identify` reading
  `schema`/`name` from the node, `dependsOnIdentities` reading a
  `dependsOn` array from the node, and `diff` returning the changes the
  node itself lists (`reports: [{ operation, note }]`) — with the node
  on the side each operation carries (`next` for create/alter,
  `previous` for drop; both for alter), since the refinement reads
  `dependsOnIdentities` off that side. Snapshots are built by hand:
  `{ ...emptySnapshot, objects: { "test-kind:app.b": node } }`, and
  `diffSnapshots(previous, next, registry)` is called directly. The
  control kind is the same shape minus `dependsOnIdentities`.

## Purpose of the new `snapshot-diff` capability

Written into `openspec/specs/snapshot-diff/spec.md` by the archive
commit that first creates that file (a spec file with an empty
Requirements section fails `openspec validate --specs`, so it cannot be
created earlier):

> What the change list `diffSnapshots` computes from two snapshots
> promises — which changes appear, how many times each, and in what
> order — to the kinds that feed it, built-in and preset alike. The
> contract of the extension interface's `diff` and `dependsOnIdentities`
> stages as seen from the migration they end up in.
