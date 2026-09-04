# Design: harden-snapshot-and-vendor-order

Mechanisms only. Open decisions are settled by the lead before
implementation and recorded in the work items' decision logs, not here.
Where a decision picks between mechanisms, each is written down; the
deltas are drafted for the recommended one and the tasks name what the
lead settled.

## Canonical order of set-shaped arrays (#701)

Which arrays are sets, and their canonical order:

| kind | array | canonical order | today |
|------|-------|-----------------|-------|
| `policy` | `roles` | sorted by name (`compareKeys`) | declaration order; `sameJson` gate → reorder = drop + create policy |
| `trigger` | `events` | fixed rank insert, update, delete | declaration order; reorder = drop + create trigger |
| `trigger` | `events[].columns` (`update of`) | sorted by name | declaration order; same |
| `table` | `indexes` | sorted by `name` | declaration order; name-keyed diff → no alter, but bytes move → zero-statement `restate_<table>` migration, and `verify` reports `snapshot-stale` until it is written |
| `table` | `checks` | sorted by `name`; absent stays absent | same |
| `grant` | `privileges` | already canonical — select, insert, update, delete (`normalizePrivileges`, DSL) | — |
| `table` | `foreignKeys` | already canonical (`compareForeignKeys`, DSL: local columns, then target identity) | — |

Ordered, untouched: `table.columns` (physical order, the oracle),
`index.columns`, `foreignKey.columns`/`referencesColumns`,
`function.args`, `enum.values`, `view.columns`/`query`, every expression
and statement node, `sequence`/`schema`/`rls` (no arrays). The Supabase
preset's `allowedMimeTypes` is a Postgres `text[]` whose stored order is
the row's own — left to the preset.

Three readers compare snapshots and every one of them is byte-based
today: a kind's `diff` (`sameJson`), `generate`'s "did the snapshot
move" (`snapshotChangedFrom`, `engine/generate.ts`), and `verify`'s
check 2 (`buildCheck2Outcome`, `commands/verify.ts`: the snapshot
rebuilt from the declarations, rendered, equals the file's text). A
write-side sort alone turns all three against every snapshot already on
disk; the decision is which of them read the canonical form and whether
the format moves. Three mechanisms; the lead picks one:

- **(1) Format bump to 9, exact readers.** `HEJBRO_SNAPSHOT_VERSION`
  becomes 9; `serialize` writes the canonical order; nothing on the read
  side changes — a version-8 file is refused as older (pin-or-reset), so
  every readable snapshot is canonical by construction, `sameJson`,
  `snapshotChangedFrom` and check 2 stay byte-exact, and a hand edit of
  any kind is still reported. The precedent is the foreign-key order
  (v6 → v7). Cost: the same in-repository replay as (2) — goldens and
  the two examples, banners included, as the v7 → v8 bump did in one
  commit — plus, outside this repository, every version-8 project is
  refused until it resets snapshot and migrations together (the
  older-format diagnostic's own path; 0.2.0 has not shipped, so today
  that is the owner's own projects); the `snapshot-format` spec's first
  requirement and two `formatVersion SHALL stay 8` sentences move with
  it.
- **(2) One canonical form, read at every comparison; format stays 8.**
  `ObjectKind` gains an optional, additive `canonicalize?(node:
  JsonValue): JsonValue` (the widening precedent of `requiredKeys`,
  `ownerTableIdentity`, `dependsOnIdentities`; a kind that does not set
  it is compared as it always was), and core exports
  `canonicalizeSnapshot(snapshot, registry)`, pure. `buildSnapshot`
  writes `canonicalize(serialize(…))`, so every new snapshot is canonical
  whatever the declaration order. `diffSnapshots` canonicalizes both
  sides before any kind's `diff` — per key, inside its existing guarded
  node read, so a malformed node is still reported as
  `malformed-snapshot-node` rather than escaping as a raw error from a
  whole-snapshot pass — so every `sameJson` gate keeps working
  unchanged and an old-order previous compares equal to a canonical
  next. `snapshotChangedFrom` compares the canonical forms, so a run
  whose only movement is a set's order writes nothing — the canonical
  bytes reach the file with the next run that has something to record.
  `verify`'s check 2 compares `renderSnapshot(canonicalizeSnapshot(parsed
  file))` against the rendered rebuilt snapshot; check 1 — the tip
  migration's recorded hash against the file as stored — stays
  byte-exact, so a hand edit of any kind, a set's order included, is
  still reported there (`chain-tip-mismatch`): the hand-edit detection
  does not weaken, it moves from two checks to one for this one edit
  class. `parseSnapshot` never canonicalizes — `verify` re-renders
  exactly what it parsed. Cost: in this repository, the goldens
  (`packages/core/test/golden/cases/*/expected/snapshot.json`, compared
  byte for byte) and the two examples (`examples/{postgres,supabase}`,
  whose chain tests compare the replayed snapshot byte for byte against
  the committed file) are replayed once — snapshot and every migration
  banner's two hash lines, the same replay the v7 → v8 bump did — since
  their committed indexes and checks are in declaration order today.
  Outside this repository nothing moves: a project's snapshot stays as
  it is, `generate` reports no change, `verify` passes. One interface
  member; the `cli-commands` delta below.
- **(3) Per-kind sort on write and compare on read, no interface
  change.** The three kinds sort inside `serialize` and compare
  `sameJson(canonical(previous), canonical(next))` inside `diff`;
  `snapshotChangedFrom` and check 2 stay byte-exact, so an old-order
  snapshot is written once by a zero-statement migration on the first
  `generate` after upgrade and `verify` reports `snapshot-stale` until
  then — the pattern already measured and declined (a write-side sort
  alone turns `verify` red on every existing project).

Recommendation: (2). Under it, rendering follows the canonical order for
objects created or recreated after this change: `create policy … to
<roles sorted>`, `create trigger … after insert or update …`, `update of
<columns sorted>`. Committed migrations are history and do not move.

## Physical column order in the vendored client metadata (#740)

`contract/tables.ts`'s `buildTableClientMeta` builds `columns` from
`computation.entries`, which already is `table.columns` in physical
order; the order is lost at `Object.fromEntries` and again at run time
when `@hejbro/query`'s `synthesize.ts` reads `Object.entries(meta.columns)`
— JavaScript enumerates integer-like keys first (`Object.keys({ b, "2",
a, "0", constructor })` → `["0", "2", "b", "a", "constructor"]`; a
literal `__proto__:` key sets the prototype and never becomes an own key
at all, which is why the emitter writes it computed), so no emitter-side
ordering survives an object-keyed shape. Two shapes; the lead picks one:

- **(A) A list.** `TableClientMeta.columns` becomes
  `ReadonlyArray<{ key, sqlName, typeNode, mode, notNullElements }>` —
  the shape `functions[].args` already has. `emit.ts` renders one entry
  per line in `entries` order; the key is a string value, so
  `renderMetadataKey`'s `__proto__` case is no longer needed for a
  column (it stays for table and function names). `@hejbro/query`'s
  `ContractTableMeta.columns` becomes the union of the list and the
  object-keyed map, and `synthesize.ts` reads through one
  `columnEntries(meta)` helper (`Array.isArray` → as is; else
  `Object.entries` mapped) for both the declaration's `columns` and the
  `refsObject` — a contract vendored before the list still builds, the
  way a pre-`functions` contract does.
- **(B) A sibling order list.** Keep the map and add
  `columnOrder: ReadonlyArray<string>` (TypeScript keys in physical
  order); the reader iterates `columnOrder` when present. Smaller diff,
  but two carriers of one fact that can disagree.

Recommendation: (A). Either way the runtime reader lives in
`packages/query/src/client/` (`contract-types.ts`, `synthesize.ts`, two
tests) — another team's package this change cannot avoid touching; the
lead settles the boundary. `Row`/`Insert`/`Update` in the emitted
interface already follow snapshot order and do not change.

## The whole-row rule for setof bodies (#749)

`RecordingState` gains the declared table (`{ schemaName, tableName }`
or `null`), threaded from `defineFunction` (`returns.returnsKind ===
"setofTable"`) through `recordBodyWithGuard`/`recordOnce`/
`createRecordingContext` as one added parameter; `defineTrigger` passes
`null`. `recordReturnQueryShape` calls a new `assertReturnIsWholeRow`
after `assertReturnHasReturning` and before `markConsumed`: a select is
whole-row when `projection.projectionKind === "allColumns"` and `from` is
the declared table (`schemaName`/`tableName` equal; a `cteName` source is
not a table); a mutation is whole-row when `returning.returningKind ===
"allColumns"` and `table` is the declared table. Anything else throws the
named error; the thrown error leaves the builder unconsumed, which
`recordOnce`'s `catch` already closes.

The rendered `return query` already reorders an `allColumns` projection
or returning through the column-order oracle (`applyColumnOrderToQuery`),
so the accepted forms render the physical order without new rendering
code.

Two rule scopes; the lead picks one:

- **(a) Whole row only.** Every projection is refused, complete ones
  included — a complete projection adds nothing a bare `.returning()`
  does not carry (Postgres ignores the names), and a complete projection
  in another order is the silently-wrong case. The shipped pin of the
  projected form (`render-body.test.ts`, "renders a definer function
  with a projected returning") flips to the refusal; the type-only
  control in `body-context.test.ts` flips to `@ts-expect-error`.
- **(b) Complete projection accepted.** A projection naming every column
  of the declared table exactly once, as plain column references, in any
  order, is accepted and recorded as the whole-row form (rewritten to
  `allColumns`, aliases dropped, so it renders in physical order); a
  partial, aliased-expression, or other-table projection is refused,
  naming the missing columns. Honors the issue's acceptance line
  literally at the cost of a rewrite step and a form whose only effect
  is to be equivalent to the bare one.

Recommendation: (a).

Type narrowing: `ReturnableQuery`'s three mutation members drop the
projection parameter back to `undefined` (`InsertFinal<Table, undefined,
"final">`, …) and the select member narrows to a whole-table projection
(`SelectLimited<Table>`; `SelectProjection` is `Table | Record<string,
Expr>`) — checked by compiling the input table's refused rows under
`@ts-expect-error` beside the runtime assertions; if a narrowing does not
hold cleanly across the stage types, the runtime refusal stands alone and
the type is filed as a follow-up.

Candidate code, in the family of `return-expects-returning`:
`return-expects-whole-row`. Candidate message: `ctx.return() in
<identity> received <a delete> whose rows are not the whole row of
"<schema>"."<table>" — this declaration returns setof that table, and
plpgsql's "return query" must produce exactly that row shape; Postgres
accepts the CREATE and every call then fails with "structure of query
does not match function result type". Next: return select(<table>), or
an insert/update/delete on <table> ending in a bare .returning(); to
return a different shape, declare "returns" as that shape instead.`
