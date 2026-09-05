# D106 evaluation — add-batched-transactions (round 1)

Reviewer: context-free session, model fable. Read only the delta
(`openspec show add-batched-transactions --diff`), the public surfaces
(`packages/query/src/index.ts`, the contract's exported types,
`packages/{pg,neon,nile,supabase}/src/index.ts` and constructor
signatures), `skills/hejbro/references/{query-layer,neon-preset,supabase-preset}.md`,
and the built packages' behavior. Proposal, design, tasks, `.blackbox/`,
implementation bodies and tests were not read.

## Method

Constructor mode: the change's inputs are the driver contract and two
external client libraries, so every universal sentence of the delta was
run against an input table rather than one example. Detached worktree at
`upstream/dev` 8d79eb00, `pnpm install --offline && pnpm build --force`,
three ESM scripts importing the built `dist/` of every package
(scripts under `/private/tmp/d106-bt/`, deleted after the run).

Layers measured:

1. **Declarations** — every shipped driver value (`pgDriver` ×2 option
   forms, `neonDriver(Pool)` ×2, `neonDriver(neon())`, `nileDriver` over
   pg and over Neon HTTP, `supabaseDriver` session ×2 / pooler / over
   Neon HTTP) plus fake minimal drivers: four keys exactly, frozen,
   readable before any connection; `batch` present on all. Type-level
   exhaustiveness probed with `tsc` (`@ts-expect-error` on a missing
   fourth key, a fifth key, a `Driver` without `batch`, a mutation).
2. **Fake minimal drivers** (recording `execute`/`transaction`/`batch`)
   behind `db()` — path selection for `db.as`, provider handle,
   `contextRequired`, `fn`, `transaction(callback)`, contributed
   rendering, failure reporting, count mismatch (fewer/more/none and a
   non-list).
3. **Real `neonDriver(neon(connectionString))`** with the genuine
   `@neondatabase/serverless@1.1.0` client and `neonConfig.fetchFunction`
   stubbed — records the wire body (post-serialization) and forges
   responses/400s. 23 checks.
4. **Real Postgres 17** (Docker `d106-bt-pg`, port 55620) through
   `pgDriver`, and `neonDriver(pool)` with a node-postgres `Pool` as a
   stand-in for the WebSocket `Pool` (same protocol layer; not a Neon
   WebSocket): #892 multi-command table (13 texts × 2 drivers), #891
   server-side `pg_prepared_statements` names vs the export, the
   interactive `db.as` baseline with RLS, failure text.
5. **Local proxy emulating Neon's HTTP batch endpoint over the same
   Postgres** (my own `BEGIN…COMMIT`/`ROLLBACK` around the `queries[]`
   body, raw-text output) with the real `neon()` client pointed at it
   via `neonConfig.fetchEndpoint` — shows the composed batch actually
   runs on Postgres (role/`set_config` visible inside, absent after,
   RLS filtering, rollback on a failing member). This measures the
   client-side composition and Postgres semantics, **not** Neon's
   server.

Totals: 118 checks executed (part 1: 48, part 2: 23, part 3: 47), of
which 39 ran against the real Postgres server (28 #892 rows, 2 #891
rows, 3 interactive baseline, 6 proxy-emulated). Four checks read
`FAIL` and none is a delta contradiction: two are my own expectation
(`sql\`\`` with an empty text is refused at `compile()` with
`empty-sql-statement`, pre-existing and outside the delta), one is a
repeated-run artifact (rows left from the previous run of the same
script), one is the non-list neighbor input recorded as N2 below.

## Blocking findings

None.

## Non-blocking findings

- **N1 — two error shapes for one code.** `driver-missing-capability`
  carries `capability` (string) when one key is missing and
  `capabilities` (array, no `capability`) when the operation admits two
  keys and both read `false`. A caller branching on `err.capability`
  sees `undefined` for the both-missing `db.as` case. The delta says
  "naming both keys" and the message does; the field shape is
  unspecified and undocumented in `query-layer.md`'s error table.
- **N2 — a non-list `batch` result is misreported.** A batched-only
  driver whose `batch` resolves `undefined` (not "fewer, more, or none"
  — the delta's words — but not a list at all) surfaces as
  `query-execution-failed` "for a batch of 2 context statements …; the
  driver does not report which member failed" with a `TypeError` as
  `cause`. No rows reach the caller (the guarantee holds), but the text
  blames the database for a driver contract violation. Neighbor input
  outside the delta's sentence.
- **N3 — the Neon HTTP driver's own `batch` does not check the server's
  result count.** With a forged response of two results for three
  members, `driver.batch(three)` resolves a two-element list. Through
  `db.as` the query layer refuses it (`batch-result-count-mismatch`,
  both counts named — verified fewer and more), which is exactly where
  the delta places the rule; a direct `driver.batch` caller is not
  covered by any delta sentence. The driver-contract requirement's
  "the result is one row list per member" is a promise the driver
  cannot verify against a lying server, so this is a wording gap, not
  a contradiction.
- **N4 — `supabase-preset.md` capability table vs a non-pg base.** The
  table gives `batched-transactions` = `false` unconditionally for the
  session row and the prose says it "reads `false` on both paths:
  `pgDriver` itself never declares it `true`". Measured:
  `supabaseDriver(neonDriver(neon(…)))` (session path, no options)
  declares `false/false/false/true` — inherited from the wrapped
  driver, as the prose's own "whatever the wrapped driver declares"
  predicts. `db.as(asUser(claims))` on it batches `set local role
  "authenticated"` + `set_config('request.jwt.claims', …, true)` +
  the caller's statement. The table's `false` is only true for a pg
  base; the prose is self-consistent. Doc precision, not behavior.
- **N5 — `lastRows([])` throws an "internal invariant … file an issue"
  error.** Unreachable through the shipped drivers (node-postgres never
  answers an empty array; `";"` alone resolves `[]`), noted only
  because the helper is a public export.
- **N6 — the WebSocket path was measured with a node-postgres `Pool`
  stand-in.** `neonDriver(pool)` duck-types the `Pool`; every #891/#892
  check on it therefore exercises the driver's own code over the same
  wire protocol, not Neon's WebSocket tunnel. Recorded so the "Neon
  WebSocket" rows in the table below are read with that caveat.
- **N7 — batch headers.** The HTTP batch is sent with
  `Neon-Raw-Text-Output`/`Neon-Array-Mode` only — no
  `Neon-Batch-Isolation-Level`/`Read-Only`/`Deferrable`, so the server's
  defaults apply. The delta says nothing about isolation; recorded as
  an observation for a future sentence, not a finding against one.

## Scenarios verified

| Spec / scenario | Result | How |
| --- | --- | --- |
| driver-contract · Capabilities are inspectable (4 keys) | PASS | 11 shipped values + fakes: exactly 4 keys, frozen, no connection made (`pool.totalCount` 0) |
| driver-contract · exhaustive & statically checked (four) | PASS | `tsc`: missing 4th key, 5th key, `Driver` without `batch`, mutation all rejected; valid literal accepted |
| driver-contract · one-shot driver declares its limits (`batched` = what the request can do) | PASS | `neonDriver(neon())` = `false/false/false/true`; readable before any fetch |
| driver-contract · path fixed by client, not a probe | PASS | no fetch/connection during construction (fetch stub count 0, pool count 0) |
| driver-contract · batch runs in order, every member's rows | PASS (client) / PASS (proxy-emulated) | wire body order = pins then members; 3 row lists in order; on Postgres via proxy: insert → select sees it → count |
| driver-contract · failing member fails the batch | PASS (client) / PASS (proxy-emulated) | 400 → rejects with the server error, one fetch; proxy: `1/0` as 2nd member → first insert not visible, third never ran |
| driver-contract · one-shot driver's pins lead the batch | PASS | wire: `set intervalstyle to 'postgres'`, `set bytea_output to 'hex'`, then members; pins' results excluded from the resolved list |
| driver-contract · empty member list sends nothing | PASS | `batch([])` → 0 fetches, `[]` |
| driver-contract · driver without the capability refuses before sending | PASS | pg, neon ws, nile(pg), supabase session, supabase pooler: `driver-missing-capability`, `capability: "batched-transactions"`, `operation: "batch"`, pools never connected |
| driver-contract · both drivers name through the export | PASS | `pg_prepared_statements` on `pgDriver({ps:true})` and `neonDriver(pool,{ps:true})` = `preparedStatementName(text)` = `hejbro_` + sha256[0:32]; `packages/{pg,neon}/src` contain no `createHash`/`sha256`/`hejbro_` |
| driver-contract · two selects resolve to the second's rows | PASS | `[{b:2}]` on both drivers; plus 3-command, comment, `/* ; */`, `;;`, trailing `;`, `;` alone, `set … ; select` → last command's rows in every case |
| driver-contract · trailing command without rows → `[]` | PASS | `select…; set x.y='1'` → `[]`; `select…; create temp table` → `[]`; `select…; select … where false` → `[]`; never `undefined` |
| rls · Context on an interactive driver (statements as before) | PASS | fake both-true: `transaction` used, `batch` never; real pg: RLS rows alice=[1,3]/bob=[2], nothing persists after |
| rls · Context on a batched-only driver | PASS | fake: `batch` once with `[set local role, set_config, caller]`; members byte-equal (sql/params/kind/order) to the interactive path's `session.execute` sequence; contributed rendering likewise |
| rls · A preset's one-shot driver applies the context in one batch | PASS (client) / PASS (proxy-emulated) / NOT MEASURABLE (Neon server) | real `neonDriver(neon())`: one fetch, members after pins; following unscoped call carries none; proxy over Postgres: `current_user=app_reader`, `app.user=alice` inside, `postgres`/empty after |
| rls · Context on a driver with neither form | PASS | fake: `driver-missing-capability`, `capabilities: ["interactive-transactions","batched-transactions"]`, message names both and `db.select`, nothing sent; same for `execute(sql)` and `fn` |
| rls · A callback stays interactive | PASS | batched-only fake and real HTTP driver: `as(ctx).transaction(cb)` → names `interactive-transactions` only, zero sends |
| rls · A failing batch is reported as a batch | PASS | fake and real HTTP (400): `query-execution-failed`, "a batch of 2 context statements and this "select" statement; the driver does not report which member failed", members `1) 2) 3)` in order, pins absent, `cause` is the driver error unchanged (`code`, `hint` intact) |
| rls · The interactive path still names the failing statement | PASS | fake: context `set_config` raising → message names that statement alone; real pg: RLS-denied insert names the caller's statement alone |
| rls · Wrong number of row lists is refused | PASS | fake fewer/more/none and real HTTP forged fewer/more → `batch-result-count-mismatch`, both counts in the message, no rows |
| rls · provider handle: missing capability fails before the resolver | PASS | neither: resolver called 0 times, error names both, nothing sent |
| rls · provider handle batches on a batched-only driver | PASS | fake and real HTTP: resolver once, `batch` gets ctx + caller after pins |
| (delta prose) `contextRequired` served the same way | PASS | batched-only fake with `contextRequired`: unscoped refused, scoped runs via `batch` |
| (delta prose) interactive wins where both are declared | PASS | fake both-true never calls `batch` |
| (skills) `neon-preset.md` two-path table, `client.end` no-op | PASS | declarations match; `end()` resolves |
| (skills) `query-layer.md` capability prose and error rows | PASS | `batch-result-count-mismatch` and batch-shaped `query-execution-failed` rows match measured text |
| (skills) `supabase-preset.md` capability table | PASS for pg base / see N4 | measured session/pooler rows over `pgDriver`; Neon-HTTP base diverges from the table |

## Not measurable here

- **Neon's server-side atomicity and isolation** of `sql.transaction([...])`
  — that a failing member rolls back earlier members, that
  `set local role`/`set_config(…, true)` are transaction-local across
  Neon's HTTP proxy, and that a following request carries none of it.
  Verified only (a) client-side by the wire body and (b) against a local
  proxy emulating the endpoint with an explicit `BEGIN…COMMIT` over
  Postgres 17. The delta scenario "A preset's one-shot driver applies
  the context in one batch" is therefore confirmed for what hejbro
  sends and for Postgres semantics, and assumed for Neon's proxy.
- **Neon WebSocket tunnel** — see N6; the `neonDriver(pool)` rows ran
  over node-postgres's `Pool` to the local server.
- **Neon HTTP behavior on a multi-command text** — the delta scopes
  #892 to session-holding drivers, so nothing was asserted; not run.

## Verdict

**ARCHIVE.** Every delta scenario that can be measured without Neon's
network is confirmed on an input table, including the universal claims
(all shipped driver values, all four failure/mismatch shapes, thirteen
multi-command texts on two drivers). The seven non-blocking notes are
neighbor inputs, one field-shape inconsistency, one documentation
precision issue and two measurement caveats — none contradicts a delta
sentence.
