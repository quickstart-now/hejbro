# Design: add-vendored-related

Settled by the lead under the owner's full delegation for this pass
(412/D24, D25); recorded as R1 on #653 for ratification.

## Q1 — Where the relation keys come from at the type level

- (i) Derive them in the consumer from `Relationships` (SQL column
  names) plus `Row` keys.
- (ii) Emit a ready `Relations` map per table from the declaring
  repository, where the column keys are known.
- **Ruling (ii).** `Relationships` carries SQL names; the relation key
  is a *column key* stripped of `Id`, and the SQL-name→key mapping is
  a runtime fact (`contractMetadata.tables[name].columns[].key`) the
  type layer cannot read. The declaring side computes the key once,
  with the same `stripId` rule the runtime uses, so the contract states
  the relation the way the runtime will resolve it — one truth, two
  readers, the same reason `foreignKeys` is carried at all.

## Q2 — Contracts emitted before this change

`Relations` is optional on `DatabaseShape`; a missing map means no
table has `.related`. No description-format bump: the export
description is unchanged, only the emitted TypeScript grows, and the
existing "A pre-functions contract still builds a client" rule is the
precedent. Re-vendoring the same commit after upgrading the CLI is a
diff in `contract.ts` (`vendor` writes what it read), which `outdated`
does not report — it compares commits, not emitters — so the reference
says so.

## Q3 — Runtime

Forward to the internal `db()` handle's `related()`. Its runtime guards
(`unknown-relation`, `ambiguous-relation`) stay as the JS-caller
backstop; nothing is re-derived in the client. The nested read's
compiled SQL is therefore byte-identical to the `db()` surface's, which
the compile-parity test pins.

## Q4 — The result chain

`NameKeyedRelatedChain<TRow & Nested>`: exactly the stages the `db()`
surface's own `SelectChainRelated` has — `.where()`, `.orderBy()`,
`.limit()` — and no further `.related()`. Measured while implementing
task 1.2: that family has never carried `.offset()` (`chain.ts`'s
`SelectChainRelatedLimited` is a bare terminal), so "the same shape" and
"four stages" could not both be true; the shape wins (653/R4).
`.related()` is available on the whole-table select only — the client
has no projection stage, so the question of "related after a
projection" does not arise here.

## Q5 — Collision rule at emit time

Mirror `RelationKeysOf` exactly: a key present as both forward and
reverse, or as a relation and a column, is omitted from `Relations`
(the runtime would throw `ambiguous-relation` on the second case and
resolve the forward edge first on the first; the type layer refuses
both, and the contract follows the type layer). The emit test's input
table covers each collision class.
