# Design: harden-ledger-identity

Lead rulings `.blackbox/783/` R2–R4 and `.blackbox/797/` R1 (under the
owner's delegation, #750/D3, D7) settle the contract details; the delta
spec carries the contract, this file carries the shape the
implementation takes.

## The ledger identity probe (783/R2)

- **Module**: a new `packages/cli/src/apply/ledger-identity.ts` — the
  shared judgement lives beside `ledger.ts`, not inside it, so
  `ledger.ts` keeps its stated property of raising no `HejbroError`.
- **Read**: one statement, no transaction, over `pg_class` joined to
  `pg_namespace` and left-joined to `pg_attribute` (`attnum > 0`, not
  `attisdropped`), filtered to `nspname = 'hejbro'` and `relname =
  'migration_ledger'`, returning `relkind`, `attname`,
  `format_type(atttypid, atttypmod)`, ordered by `attnum`. Never
  `information_schema` (role-dependent) and never `to_regclass`
  (answers non-null for every relation kind, measured).
- **Judgement** (`LedgerIdentity`): `{ kind: "absent" }` when no row
  comes back; `{ kind: "ledger" }` when `relkind = 'r'` and the columns
  include `id bigint`, `filename text`, `origin text`, `applied_at
  timestamp with time zone` (a further column does not disqualify);
  otherwise `{ kind: "occupied", relation: <word>, columns:
  ReadonlyArray<string> }`. Relkind `p` (partitioned, can carry the
  exact four columns — measured) is `occupied`: hejbro never creates
  one. The relkind-to-word map: `r` table, `p` partitioned table, `v`
  view, `m` materialized view, `f` foreign table, `S` sequence, any
  other letter rendered as `relation (<letter>)`.
- **Callers, one probe each, before any read or write of the ledger**:
  `migrate` (before `bootstrapLedger` — `create table if not exists`
  skips any relation at the name with a notice, measured, so the insert
  would otherwise land in a stranger's table), `status` (before
  `readLedger`), `reset` (right after the empty-declaration refusal,
  before the confirmation check — see below), `raise` (before its
  ledger-history read, so nothing is bootstrapped either).
  `ledgerTableExists` is retired; `reset`'s `ledgerCleared` is `true`
  only for `ledger`.

## The shared refusal (783/R3)

- **Code**: `apply-ledger-occupied`. `apply-*` because four commands
  raise it for one operation (touching the ledger); "occupied" states
  the fact — hejbro's own name is held by something else.
- **Thrown by** `assertLedgerNotOccupied(identity, commandName)` in
  `ledger-identity.ts`; every caller renders it through the
  precondition path it already has (`status`/`reset`/`raise` exit 1,
  `migrate` exit 2 — its "could not act at all" answer).
- **Message**:

  ```
  "hejbro"."migration_ledger" is held by a <word> that is not hejbro's ledger (columns: <a, b, c>|no columns). hejbro reads, writes and clears only the ledger it created, so this database is not one hejbro has applied to. Next: move or drop that <word> yourself (hejbro will not touch it), or point --url at the database hejbro manages, then rerun `hejbro <command>`.
  ```

- **Where `reset` refuses**: before the confirmation check, right after
  `assertDeclarationsNotEmpty`. A precondition of the same rank; asking
  for the `<database>:<count>` token (which names what would be dropped)
  for a run that is refused anyway is wasted and misleading. The probe
  is a catalog read outside any transaction, so nothing the confirmation
  protects is touched. The existing "refuses without confirmation and
  sends only the `current_database()` probe" pin gains the identity
  probe as the one other statement allowed through; the confirmation
  scenarios for a real and an absent ledger are unchanged.

## The cycle detector (797/R1)

- `kindHasCycle` in `apply/reset.ts` becomes a peel: from the in-set
  edge map (self-edges and edges outside the plan already filtered),
  recursively remove every identity whose remaining dependencies are
  all gone; a non-empty remainder from which nothing can be removed is
  a cycle. Recursion, not a loop. A self-referencing table alone is not
  a cycle (its drop takes its own constraint, measured); two disjoint
  cycles are a cycle.
- `declaredCycleAdvice` wording: "a set of your declared tables that
  reference each other in a cycle" replaces "a pair that reference each
  other"; the detail-first ordering and the outside-declarations clause
  stay exactly as they are. `DETAIL` is never parsed.

## Scope (783/R4)

All four ledger-touching commands, in this change: one defect, one
probe, one code. Tracking stays with the three bug issues; `migrate` and
`raise` are noted in `.blackbox/783/`. No `cli-commands` or
`diagnostics` delta (783/R2): `status`'s contract lives in
`migration-apply`, and the code-plus-`Next:` shape is already generic.
