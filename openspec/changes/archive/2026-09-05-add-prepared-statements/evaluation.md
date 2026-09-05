# D106 round 1 — add-prepared-statements

## Method

Context-free adversarial review (D106 archive gate), input-constructor
method (D110): every delta scenario was judged only against inputs
constructed here and run through the shipped surface. No proposal,
design, tasks, blackbox, git history, implementation source (beyond
`packages/query/src/driver/contract.ts`) or test file was read. The
contract came from `openspec/changes/add-prepared-statements/specs/
driver-contract/spec.md` read against `openspec/specs/driver-contract/
spec.md`; the user-facing surface from `skills/hejbro/references/
{query-layer,neon-preset,supabase-preset}.md`, the built `dist` of
`@hejbro/{pg,neon,supabase,query}` and `hejbro`, and the exported
contract types.

| | |
|---|---|
| Worktree | `/private/tmp/d106-ps/wt`, detached at `0ecee28c` (`upstream/dev`, contains squash `6cbedf29`) |
| Build | `pnpm install --frozen-lockfile`; `TURBO_FORCE=1 pnpm build --force` — 7/7 tasks, 0 cached |
| Packages | `@hejbro/{pg,neon,supabase,query}` 0.2.0-pre.1; `pg` 8.23.0; `@neondatabase/serverless` 1.1.0 |
| Node / TypeScript | v26.7.0 / 5.9.3 (real `tsc --noEmit` runs) |
| Postgres | 17.11 in `d106-ps-pg` (own container, host port 55438) |
| Pooler | PgBouncer 1.25.2 in `d106-ps-pgb`, `pool_mode = transaction`, `default_pool_size = 2` (host port 55439); `max_prepared_statements` toggled 200 (its default) / 0 through the admin console |
| Neon WebSocket path | `ghcr.io/neondatabase/wsproxy` in `d106-ps-wsproxy` (host port 55440) fronting the same Postgres; `@neondatabase/serverless` `Pool` driven through `neonConfig.wsProxy` |
| Scratch | `/private/tmp/d106-ps/` — probe scripts `proj/probe-*.mjs`, outputs `probe-*.out`, `tsc.out` |

Inputs constructed: 9 TypeScript files compiled with `tsc` (capability
set exhaustiveness, option shapes on both `pgDriver` overloads and both
`neonDriver` overloads); 7 node probes over the built packages: `pg`
naming at the client-library boundary (a `pg.Client.prototype.query`
recorder) and on the wire (`pg_prepared_statements` read on the live
transaction connection), name derivation across two connections and a
spawned second process, statement kinds beyond the five built ones
(`with`, `db.fn`, `db.as` context), runtime option widening,
`supabaseDriver` on all three endpoint spellings over a preparing and a
non-preparing base, a preparing driver aimed straight at the
transaction-mode PgBouncer under both tracking settings, the Neon `Pool`
path over wsproxy and the HTTP overload, and the pin/prepared-statement
interplay on a one-connection pool.

**BLOCKING 0 / NON-BLOCKING 5 / OK 16**

---

## NON-BLOCKING

### N1 — a two-command escape-hatch text "runs" only at the driver member; through the query layer it crashes with an uncoded `TypeError`, and the driver member returns `undefined` rows (pre-existing)

**Scenario sentence judged against** ("The escape hatch is never
named"): *WHEN a driver declaring prepared statements executes a
`sql`-kind statement — with parameters, without parameters, and one
carrying two commands — THEN each is sent unnamed and runs, including
the two-command text.*

**Input** (`probe-pg.mjs`, section E; `probe-pin.mjs`, section C):
`pgDriver(pool, { preparedStatements: true })`, then the same text sent
five ways.

**Observed:**

| path | text | result |
|---|---|---|
| `driver.execute({ sql: "create temp table tmp_three(a int); drop table tmp_three", params: [], kind: "sql" })` | two commands, no params | sent unnamed; resolves — but to `undefined`, not an array |
| `driver.execute(... "insert into app.posts ... ($1, 'x'); delete ... where id = $1", params: [id])` | two commands, one param | sent unnamed; server `42601 cannot insert multiple commands into a prepared statement` |
| `handle.execute(sql\`create temp table tmp_two(a int); drop table tmp_two\`)` | two commands, no params | sent unnamed; `TypeError: Cannot read properties of undefined (reading 'map')` at `convertRows` — no `code` |
| `handle.execute(sql\`insert ... (${id}, 'x'); delete ... ${id}\`)` | two commands, params | `query-execution-failed`, cause `42601` |
| `tx.execute(sql\`create temp table tmp_four(a int); drop table tmp_four\`)` inside `handle.transaction` | two commands, no params | same `TypeError`; transaction rolled back |

The identical five inputs on `pgDriver(URL)` (declaring `false`) behave
byte-for-byte the same (`probe-pin.mjs` C/C2), so the naming change did
not introduce this. The unnamed send is verified (no `name` key reached
the client library in any of the five). The defect is in what comes
back: the underlying client returns an *array of results* for a
multi-command simple-protocol text, the driver hands that through as
`undefined` rows (against `DriverSession.execute`'s declared
`Promise<ReadonlyArray<DriverRow>>`), and the query layer's own
`execute` — the surface the skill documents for the escape hatch —
throws an error with no `code` and no `Next:` line. "Runs" is true at
the driver member for a parameterless text and false for every other
combination, and the scenario does not say which it means.

### N2 — a declared-function call (`db.fn`) is never named, and neither the delta nor the skill says so

**Requirement sentence judged against:** *A driver that declares
`prepared-statements` `true` SHALL send every built statement — one
whose kind is `select`, `insert`, `update`, `delete` or `setOp` — as a
named statement … A statement of the `sql` kind SHALL always be sent
unnamed … so the escape hatch, the session pins and a migration body are
never named.*

**Input** (`probe-kinds.mjs`): `defineFunction(app, "search_by_status",
{ args: { status: text() }, returns: posts }, …)`, the function created
on the server, `handle.fn.searchByStatus({ status: "draft" })` on a
driver declaring `true`, with a spy driver recording `compiled.kind`.

**Observed:** `kind = "sql"`; the client library saw
`{ text: 'select "id", "status", "n" from "app"."search_by_status"($1)' }`
with no `name` — a single parameterized statement the query layer itself
rendered, sent unnamed on every call. For comparison the `with(...)`
statement in the same probe compiled as `kind = "select"` and was named
(`hejbro_a5514ce68db152012bd23f9e0b04aee8`).

The behaviour is consistent with "kind only decides", but the delta's
list of what is never named (escape hatch, pins, migration body) and the
skill's list of what is named (`select`/`insert`/`update`/`deleteFrom`/
a set operation) both leave `db.fn` unstated, and a reader of either
would expect a query-layer-rendered, single-command, parameterized
statement to be prepared. A gap in the contract's own enumeration, not
a contradiction.

### N3 — an untyped caller's non-boolean option value lands verbatim in the capability declaration

**Requirement sentence judged against** (Vanilla Postgres driver): *The
driver's prepared-statements declaration SHALL be the caller's, stated
at construction through an options argument … when the caller states
nothing it SHALL be `false`.* `DriverCapabilities` is
`Readonly<Record<DriverCapabilityKey, boolean>>`.

**Input** (`probe-kinds.mjs`): `pgDriver(URL, { preparedStatements: v })`
for `v` in `"true"`, `1`, `0`, `null`, `undefined` (a JavaScript caller;
`tsc` rejects the string form — `tsc.out` t7).

**Observed:**

| `preparedStatements` | `capabilities["prepared-statements"]` |
|---|---|
| `"true"` | `"true"` (string) |
| `1` | `1` (number) |
| `0` | `0` (number) |
| `null` | `false` |
| `undefined` | `false` |

The declaration a downstream decorator reads (`supabaseDriver`'s pooler
check compares against `true`) can therefore be a truthy non-boolean
from a JS caller. Type-level only; the delta fixes no runtime rule for
this, so it is a gap rather than a contradiction. Also observed in the
same probe: the capabilities object is not frozen — a plain assignment
`driver.capabilities["prepared-statements"] = false` succeeds and is
read back.

### N4 — `prepared-statements-without-session` is missing from the query-layer error table

**Scenario sentence judged against** ("The pooled-transaction path
refuses a preparing base"): *construction fails with
`prepared-statements-without-session` …*

**Input:** `skills/hejbro/references/query-layer.md` "Errors" table,
which presents itself as the list of every coded error and already
carries other presets' codes (`claims-subject-missing`,
`nile-context-value-invalid`, `nile-context-unsupported`).

**Observed:** the new code appears only in `supabase-preset.md`'s prose
and code comment; the errors table has no row for it. A reader who
meets the code and looks it up where every other code is listed finds
nothing. Documentation gap.

### N5 — the "explicitly declared false fails closed" scenario has no input for the third key

**Scenario sentence judged against** (MODIFIED "The capability set is
exhaustive and statically checked"): *WHEN a driver declares a
capability as `false` … THEN an operation requiring that capability
fails with the missing-capability error.*

**Input:** every execution surface (`select`/`insert`/`update`/
`deleteFrom`/`with`/`fn`/`execute`/`transaction`/`as`) run on drivers
declaring `prepared-statements` `false` (`probe-pg.mjs` F,
`probe-supabase.mjs` C, `probe-neon.mjs` D); the built `@hejbro/query`
scanned for the key.

**Observed:** no operation is refused — all run unnamed — and the
built query layer contains zero occurrences of the string
`prepared-statements`. No operation *requires* this capability, so the
scenario, retained verbatim while the requirement grew from two keys to
three, cannot be exercised for the key it now also covers. Ambiguity in
the spec text, not a defect in the shipped behaviour.

---

## OK

### OK1 — capabilities are inspectable before any connection

Scenario: *its declared capability set is readable and matches what the
driver actually supports.* `probe-pg.mjs` A, `probe-neon.mjs` A,
`probe-supabase.mjs` B/C: every driver value printed its three-key
object with the owning pool's `totalCount = 0`. Matched by the wire
observations below (named on `true`, unnamed on `false`).

### OK2 — omitting a key is a compile error (both the new key and an old one)

`tsc.out` t2: `{ "interactive-transactions": true, "session-state": true }`
→ `TS2741: Property '"prepared-statements"' is missing`. t3: omitting
`session-state` while naming the new key → `TS2741` on
`"session-state"`.

### OK3 — naming a key outside the set is a compile error

t4: a fourth key `"batching": true` → `TS2353: Object literal may only
specify known properties`. t9: reading `capabilities["batching"]` →
`TS7053`. t1: the full three-key literal, and a `Driver` built on it,
compile clean.

### OK4 — vanilla driver: both constructor forms take the option; absent means `false`

Scenario: *built from a pool or from a connection string, with the
option stating prepared statements, and again with the option absent —
the first declares `true` and the second `false`, both readable before
any connection.* `probe-pg.mjs` A: `pgDriver(pool, {preparedStatements:
true})` and `pgDriver(URL, {preparedStatements: true})` → `true`;
`pgDriver(pool)`, `pgDriver(URL)`, `pgDriver(URL, {})`,
`pgDriver(pool, {preparedStatements: false})` → `false`; all with
`totalCount = 0`. Both older keys read `true` on all six. `tsc.out` t5:
both overloads accept the option; t8: an unknown option key is
rejected (`TS2769` … `'prepared' does not exist in type
'PgDriverOptions'`).

### OK5 — Neon session path takes the option, one-shot path offers none

Scenarios: *A session-path driver declares … prepared statements as the
caller stated — `false` when nothing was stated* / *A one-shot-path
driver declares interactive transactions, session state and prepared
statements as `false`.* `probe-neon.mjs` A: `neonDriver(pool,
{preparedStatements: true})` → `true`; `neonDriver(pool)` and
`neonDriver(pool, {preparedStatements: false})` → `false`;
`neonDriver(neon(URL))` → all three `false`; every pool at
`totalCount = 0`. `tsc.out` t6: `neonDriver(neon(URL), {
preparedStatements: true })` → `TS2345` (the HTTP overload's type has no
options parameter, so the call falls to the `Pool` overload and fails).

### OK6 — the path is fixed by the client, never probed

Every driver value across all probes reported its owning pool at
`totalCount = 0` immediately after construction (pg, Neon `Pool`, and
the base pool under `supabaseDriver` on all three endpoint spellings,
including the refusing one).

### OK7 — built statements are named on the direct path and inside a held transaction, all five kinds

Scenario: *one statement of each built kind … through its own execution
member and inside a transaction it holds — each reaches the client
library as a named statement whose name is derived from the statement
text, and the rows come back unchanged.* `probe-pg.mjs` C1/C2: `insert`,
`select`, `update`, `union` (setOp), `delete` each reached
`pg.Client.query` with `name: "hejbro_…"` on the direct path and again
inside `handle.transaction`; the same five over the Neon `Pool`
(`probe-neon.mjs` B) with `unionAll`. Rows: the same statements on the
`false` driver produced identical `text`/`values` pairs (F), and
`handle.select` under `supabaseDriver` session path returned rows.

### OK8 — the name is a function of the text: two connections, two processes, one-character difference, 63-byte fit

`probe-names.mjs`: the same select text carried
`hejbro_2211674d21f2398d2ed1932e62ca3903` on a transaction's held
connection and on a second pooled connection (`totalCount = 2`), and in
a spawned child process. Texts differing by one character (`as "a"` vs
`as "b"`) → `hejbro_e117641c…` vs `hejbro_38eb29e1…`; `in ($1)` vs
`in ($1, $2)` → distinct names. Every name is 39 bytes and equals
`"hejbro_" + sha256(text).hex.slice(0, 32)` (`probe-pg.mjs` D, five of
five), the shape the skill documents. `@hejbro/neon` produced the same
name for the same text as `@hejbro/pg`.

### OK9 — the escape hatch is sent unnamed, with and without parameters

`probe-pg.mjs` E: `sql\`select ${1}::int as a\`` → `{ text: "select
$1::int as a", values: [1] }` with no `name` key; `sql\`select 2 as
b\`` → unnamed; both ran and returned rows. The session pin `set
intervalstyle to 'postgres'; set bytea_output to 'hex'` (itself a
two-command text) is unnamed on every fresh connection. The two-command
caller text is covered by N1.

### OK10 — a context's own applied statements are never named

`probe-kinds.mjs` AS: `handle.as({ role: roleName("postgres"),
settings: { "app.x": "1" } }).select(posts)` sent `BEGIN`, `set local
role "postgres"`, `select set_config($1, $2, true)` unnamed, then the
select named `hejbro_2211674d…`, then `COMMIT`.

### OK11 — a driver declaring `false` sends nothing named, byte-for-byte the true driver's text and values

Scenario: *no statement reaches the client library with a name, and
what is sent is byte-for-byte what the driver sent before the option
existed.* `probe-pg.mjs` F: `pgDriver(pool)` and `pgDriver(pool,
{preparedStatements: false})` each sent 14 statements, 0 with a `name`
key present, and the first six `text`/`values` pairs are identical to
the declaring driver's run. `probe-neon.mjs` D: `neonDriver(pool)` — 5
statements, none named. (Comparison to the pre-option build was not
possible from this seat; the identical text/values across the
`true`/`false` drivers is the evidence.)

### OK12 — a prepared statement is reused on its connection

Scenario: *the server's own catalog of prepared statements for that
connection holds one entry for that text after both executions.*
`probe-pg.mjs` C3: after each of five texts ran twice inside one
transaction, `select name, statement from pg_prepared_statements` on
that connection listed exactly five `hejbro_` rows, one per text.
`probe-neon.mjs` C: same over the Neon `Pool` (five rows after the
select ran three times).

### OK13 — pin and prepared statement interplay on one physical connection

`probe-pin.mjs` A: pool `max: 1`, three direct `handle.select` checkouts:
the IntervalStyle pin was sent once, every execution carried the same
name, and the catalog on that connection held one `hejbro_` entry — the
statement stayed prepared across checkouts, the driver evicted nothing.
The skill's stale-plan warning was also reproduced: after `alter table
app.posts alter column n type bigint` from another client, the next
execution on the pooled connection failed with `query-execution-failed`,
cause `0A000 cached plan must not change result type`, and again on the
following execution.

### OK14 — the pooled-transaction path refuses a preparing base at construction

Scenario: *construction fails with `prepared-statements-without-session`,
the message names the endpoint and ends with a `Next:` line naming both
remedies, no driver value is produced and no connection is opened.*
`probe-supabase.mjs` A: `supabaseDriver(pgDriver(URL, {
preparedStatements: true }), { endpoint: "transaction-pooler" })` threw
`Error` with `code = "prepared-statements-without-session"` and message

```
the base driver passed to supabaseDriver declares "prepared-statements": true, but the "transaction-pooler" endpoint keeps no session between transactions -- a statement prepared on one backend may be bound on another, where it does not exist. Next: build the base driver without preparedStatements, or use the "session" endpoint.
```

The base pool's `totalCount` stayed `0`. A2: a hand-written base object
declaring `"prepared-statements": true` (no `pg` involved) is refused
with the same code — the check reads the declaration, not the client.

### OK15 — the pooled-transaction path declares `false` over a non-preparing base and runs on a real transaction-mode pooler

`probe-supabase.mjs` C: over `pgDriver(PGB)` and `pgDriver(PGB, {
preparedStatements: false })` the decorated driver declared
`{ "interactive-transactions": true, "session-state": false,
"prepared-statements": false }`. Against PgBouncer 1.25.2 in
transaction mode, a direct select and a `handle.transaction` sent
`BEGIN` / `set local intervalstyle …` / `set local bytea_output …` /
the select / `COMMIT`, all unnamed, and returned rows.

Rationale check (`probe-pgbouncer.mjs`): a preparing `pgDriver` aimed
straight at that pooler with three concurrent handles over two backends
failed on the first round under `max_prepared_statements = 0` with the
server's own `42P05 prepared statement "hejbro_2211674d…" already
exists` (surfacing as `query-execution-failed`), the shape the
requirement describes. Under PgBouncer's default
`max_prepared_statements = 200` (its own protocol-level tracking,
1.21+), six rounds ran without failure — informational: the refusal is
conservative on poolers that track named statements, which is not a
contradiction of anything the delta states.

### OK16 — the session endpoint, and no endpoint, pass the declaration through

Scenario: *the decorated driver declares `prepared-statements` `true`
and its built statements reach the base named.* `probe-supabase.mjs` B:
`supabaseDriver(basePrep, { endpoint: "session" })`,
`supabaseDriver(basePrep)`, `supabaseDriver(basePrep, {})` → all three
keys `true`, base pool `totalCount = 0`; a direct select and one inside
`handle.transaction` reached `pg.Client.query` as
`hejbro_2211674d21f2398d2ed1932e62ca3903` with the pin and `BEGIN`/
`COMMIT` unnamed around them.

---

## Summary

| class | count |
|---|---|
| B | 0 |
| N | 5 |
| OK | 16 |

- N1 — two-command `sql` text: unnamed send verified, but "runs" holds only at `driver.execute` for a parameterless text (returns `undefined`, not rows); `handle.execute`/`tx.execute` throw an uncoded `TypeError`. Pre-existing on the `false` driver too.
- N2 — `db.fn` calls compile as kind `sql` and are never named; unstated in the delta and in `query-layer.md`.
- N3 — a JS caller's `{ preparedStatements: "true" }` / `1` lands verbatim (non-boolean) in the declaration; capabilities object is mutable.
- N4 — `prepared-statements-without-session` absent from `query-layer.md`'s error table.
- N5 — the retained "declared `false` fails closed" scenario has no operation that requires `prepared-statements`.

Containers `d106-ps-pg`, `d106-ps-pgb`, `d106-ps-wsproxy` and network
`d106-ps-net` stopped and removed; worktree `/private/tmp/d106-ps/wt`
removed after this report was written.
