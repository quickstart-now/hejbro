# Design — check-scalar-return-family

## Measurement (the refusal table's source of truth)

**Question.** When a plpgsql body's `RETURN <expr>` value is coerced to
the declared return type, which (declared type ← expression type) pairs
does Postgres fail for *every* value, and which only for *some* values?
Only the former may be refused at declaration time — refusing a
value-dependent pair would make hejbro stricter than Postgres.

**Method.** `probe/return-family-probe.sql`, run on `postgres:17`
(17.11): for each of 25 declared types (covering every `SqlTypeFamily`'s
member types: 6 numeric, 5 datetime, 3 text, 3 net, 2 json, 2 array, …)
× 43 returned sample expressions (each family represented by several
member types and by adversarial values chosen to *cross* families),
create `probe_fn() returns <decl>` with body `begin return <src>; end`,
call it, record ok / SQLSTATE. 1075 probes + 8 targeted round-2 probes
(6 new cells; 2 re-probed round-1 cells and failed again, changing no
verdict); raw results in `probe/results.csv`. Same-family cells double
as the positive control (every family's identity cell succeeds).

**Adversarial samples that changed the outcome** (each would have been
"obviously always-fail" by recall):

- `20260101::integer` → `date` **succeeds** (valid ISO date) — so
  datetime ← numeric is value-dependent, not refusable.
- `'{}'::jsonb` → `integer[]`/`text[]` **succeeds** (empty object prints
  `{}`, a valid empty-array literal) — round 2; the round-1 cell was
  ALL-FAIL only because no sampled jsonb printed as a parseable array.
  array ← json is value-dependent, not refusable.
- `'2026-01-01'::date` → `macaddr` **succeeds** (hyphen-separated hex
  groups) — net ← datetime is value-dependent, not refusable.
- `'"2026-01-01"'::jsonb` → `date` **succeeds** (Postgres datetime input
  tolerates double quotes) — datetime ← json is value-dependent.
- `0::integer` → `cidr` **succeeds** (partial-network notation; inet
  accepts `42.5`) — net ← numeric is value-dependent.
- `'1'::jsonb` → `boolean` **succeeds** (`1` parses as true) — boolean ←
  json is value-dependent.
- `'"00000000-0000-0000-0000-000000000000"'::jsonb` → `uuid` **fails**
  (round 2: the printed JSON string keeps its double quotes; uuid input
  accepts braces and hyphens, never quotes) — uuid ← json stays refused
  even for a uuid-shaped payload.

**Family matrix** (rows = declared family, columns = returned family;
`R` = every probe failed → refused, `·` = at least one probe succeeded →
accepted, same-family diagonal always accepted):

| decl \ ret | array | bool | bytea | datetime | interval | json | net | numeric | text | uuid |
|-----------|-------|------|-------|----------|----------|------|-----|---------|------|------|
| array     | —     | R    | R     | R        | R        | ·    | R   | R       | ·    | R    |
| boolean   | R     | —    | R     | R        | R        | ·    | R   | ·       | ·    | R    |
| bytea     | ·     | ·    | —     | ·        | ·        | ·    | ·   | ·       | ·    | ·    |
| datetime  | R     | R    | R     | —        | ·        | ·    | R   | ·       | ·    | R    |
| interval  | R     | R    | R     | ·        | —        | ·    | R   | ·       | ·    | R    |
| json      | ·     | R    | R     | R        | R        | —    | R   | ·       | ·    | R    |
| net       | R     | R    | R     | ·        | R        | ·    | —   | ·       | ·    | R    |
| numeric   | R     | R    | R     | R        | R        | ·    | R   | —       | ·    | R    |
| text      | ·     | ·    | ·     | ·        | ·        | ·    | ·   | ·       | —    | ·    |
| uuid      | R     | R    | R     | R        | R        | R    | R   | R       | ·    | —    |

49 refused pairs. `text` and `bytea` rows are empty — a text- or
bytea-family `returns` accepts every probed family (text IO always
succeeds; bytea input accepts any string in escape format). One
text-family member does not share that argument: an `enum` return
accepts only its own labels and was not probed — it stays unrefused on
the under-refusal (safe) side, not by the IO-conversion argument.
`unknown` is exempt on either side by construction (no static claim to
check).

**Grammar arguments** (why an all-fail cell is value-*independent*, not a
sampling accident — one per returned family, since refusal rides on the
returned value's printed form):

- **uuid**: always the 36-char `8-4-4-4-12` hex form — parses only as
  uuid, text, or bytea input.
- **boolean**: prints exactly `t` or `f` — not valid JSON (`true` would
  be), not a number, not a date/interval/net/array form.
- **bytea**: prints `\x…` — the leading backslash is invalid in every
  refused family's input grammar.
- **net**: dotted-quad / CIDR / colon-hex forms — never brace-wrapped,
  never a bare number, never a uuid shape. (The reverse direction is
  value-dependent — see `macaddr ← date` above — which is why net
  appears as a refused *column* more often than as a refused row.)
- **datetime**: every output style (ISO here; German/SQL styles change
  separators, not character classes) keeps a non-digit separator — never
  numeric, boolean, uuid, JSON (bare unquoted string), or braced.
- **interval**: prints with unit words or a clock form — the clock form
  `00:00:01` parses as `time`, so datetime ← interval is *accepted*;
  nothing interval prints parses as boolean/uuid/net/array/bytea.
- **numeric**: digit strings can be dates, intervals, JSON, booleans and
  partial inets (all measured) — refused only where digits can never
  fit: uuid (needs hyphens), array (needs braces), and as a *declared*
  target for the families above.
- **json**: printed JSON keeps quotes on strings and braces/brackets on
  containers; only uuid refuses it outright (quotes never stripped) —
  every other cell had a succeeding payload.
- **array**: prints brace-wrapped — refused everywhere braces are
  invalid; `{}` doubles as valid JSON, so json ← array is accepted.

**Probes ran under server-default GUCs** (DateStyle ISO, IntervalStyle
postgres, bytea_output hex). The grammar arguments above are the reason
the refused cells survive GUC drift: alternative output styles move
separators around but never produce a form inside another refused
family's input grammar.

## Decisions

1. **Threading.** `recordBodyWithGuard`/`createRecordingContext` gain a
   fourth parameter, `scalarReturnFamily: SqlTypeFamily | null` —
   `defineFunction` passes `familyOfTypeNode(returns.typeNode)` for a
   scalar `returns` and `null` otherwise; `defineTrigger` passes `null`.
   The smallest ripple that states exactly the one new datum; the
   internal signature is not public surface.
2. **Check site.** Inside `recordReturnExpr`, after the existing
   kind guard: fires only when `returnKind === "scalar"`, the declared
   family is known, the expression's family is not `"unknown"`, and the
   pair is in the refusal table.
3. **Refusal table as data.** New module
   `packages/core/src/plpgsql/return-family.ts`:
   `Record<SqlTypeFamily, ReadonlyArray<SqlTypeFamily>>` (total over all
   11 families — TS enforces exhaustiveness; text/bytea/unknown map to
   empty arrays) + an `isRefusedReturnFamily(declared, returned)`
   predicate. The comment states the constraint (measured
   value-independent failures only; a pair with any succeeding value
   stays accepted) — the derivation lives here, not in the code.
4. **Diagnostic contract.** Code `scalar-return-family-mismatch`
   (joins the `scalar-return-*` family). Message:
   `ctx.return() in <identity> received a <returned-family> expression,
   but this declaration returns a <declared-family> type. Postgres
   accepts the CREATE and every call then fails to convert the value.
   Next: return a <declared-family> expression, or declare a
   <returned-family> "returns" type.` — sibling of
   `scalar-return-missing`'s "accepts the CREATE, fails on call"
   framing; `Next:` names both families (#478's shape).
5. **Granularity boundary.** The check is family-level because an
   `Expr` carries only its coarse `SqlTypeFamily` — a within-family
   mismatch (`returns: time()` returning a `date` column) stays a
   first-call failure. Stated in the spec as a boundary (the type
   information the expression carries), not a deferred fix.
