# Design: harden-vendor-name-collision

## The guard is a predicate over what the emitter already computed

`emitContract` computes `tables` once (`computeTables`) and renders the
`Database` interface and `contractMetadata` from that one array — the
two can never disagree about which tables exist. The guard runs over
the same array, before any rendering: group by SQL name, keep the
groups with more than one member. A group is a collision by exact SQL
name across different schemas; two names that differ only in case are
two keys in TypeScript and two identifiers in Postgres, so they are not
grouped. Same name in the same schema cannot occur (the snapshot is
keyed by identity).

## One message shape, one `Next:` per origin

The emitter already receives the `ContractOrigin` discriminated union
(`git` for `vendor`, `database` for `pull`), so the command is known
without a new parameter. The message body is shared — the keying rule,
then one clause per colliding name listing its qualified tables in
identity order (`"schema"."table"`, sorted by schema then name) — and
the `Next:` sentence and the code come from the origin:

- `git` → `vendor-table-name-collision`. `Next:` says `--schema` is
  reserved on `vendor` (the shipped spec refuses it), so the export
  itself must carry one table per SQL name — a change in the declaring
  repository. The message does not suggest a flag that does not exist.
- `database` → `pull-table-name-collision`. `Next:` says to drop one of
  the schemas from `--schema` and rerun.

The issue's verdict pointed at "a schema filter" for both; the vendor
branch was corrected against the reserved-filter requirement (1004/R1
item 3).

## Why not a twelfth enumeration member

*Each way vendoring can fail is named separately* is scoped to
obtaining and checking a vendored schema, and its scenario title
carries the number eleven; a MODIFIED block cannot rename a scenario
and REMOVED+ADDED of the whole enumeration for one word is churn
without content. The refusal is a property of emission, which `pull`
shares and which the enumeration never covered, so it is its own
requirement and says so.

## Write order is the existing one

Both commands call `emitContract` before `mkdirSync`/`writeFileSync`/
`writeLock`, so a refusal leaves no vendor directory and no lock
without any new ordering code; the CLI test pins that order so a later
reordering cannot silently start writing partial layouts.
