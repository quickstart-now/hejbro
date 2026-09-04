# Evaluation — harden-query-conformance (D106 adversarial spec-only review)

## Round 1

Context-free reviewer at `dev` 17f54953 (merged PR #737). Read: the two
delta specs (`specs/driver-contract/spec.md`,
`specs/query-type-inference/spec.md`) against the main specs they modify,
and the public surface the scenarios name. Not read: proposal, design,
tasks, PR bodies, commit messages, `blackbox/`, `.agents/`.

### Verdict

**BLOCKING 0 / NON-BLOCKING 5 / OK 20**

### Blocking

None. Every delta scenario's shipped behavior matches its text on the
inputs below, including the adversarial ones.

### Non-blocking

1. **Classification-rule text vs. kit on two glued-semicolon spellings.**
   The rule says a statement is classified "by the word its text leads
   with once that text is trimmed, lower-cased, and stripped of any
   trailing semicolons". Measured against the kit
   (`packages/query/src/testing/driver-conformance.ts:130-163`):
   `"commit; ;"` → only the final `;` run is stripped, the leading token
   is `commit;`, classified *ordinary* → envelope `begin / set local /
   "commit; ;" / caller` **passes** (PG17: ends the block; caller runs
   outside it). `"begin; set local x"` → leading token `begin;` →
   *ordinary* → **VIOL-1** (PG17: opens and applies the setting — a
   conforming wire refused). Under the sentence's natural reading the
   leading *word* is `commit`/`begin` in both. Contrived drivers, so
   non-blocking; either tighten the normalizer (strip `;` from the
   leading token too) or narrow the sentence.
2. **"The ordinary spellings of opening and ending a transaction are all
   seen" over-claims; the rule's own consequences are not named.**
   Measured on PG 17.11 with the kit alongside: (a) batch
   `"set local x; commit"` after `begin` → kit **PASS**, PG ended the
   block (caller outside, `SET LOCAL` gone) — the "never split on an
   interior `;`" rule says this, but not that it is a known false pass;
   (b) `/* trace */ begin` and `-- c\nbegin` → kit *ordinary*, PG opens —
   a driver with sqlcommenter-style prefixes is refused; (c)
   `prepare transaction 'x'` → kit *ordinary* (**PASS**), PG ends the
   block; (d) `commit and chain` → kit `end`, message "was not sent
   inside an open transaction" while PG *is* in a (chained) transaction
   (the settings were discarded, so the fail is right, the sentence is
   not), and `begin / commit and chain / set local / caller` — PG: in
   block, setting applied — is refused (VIOL-1) because the chain's
   opening is not seen. The code comment (`driver-conformance.ts:121`)
   admits "a driver-decorated opener or closer whose own leading word
   isn't in this vocabulary"; the requirement should carry the same
   limit instead of "all seen".
3. **`rollback to savepoint` is ordinary by the rule, and discards a
   `SET LOCAL` issued after the savepoint.** Spec-consistent ("counts as
   an ordinary statement here"), but measured: `begin / savepoint x /
   set local intervalstyle iso_8601 / rollback to savepoint x` → block
   still open, `show intervalstyle` = `postgres`. Envelope
   `begin / set local / rollback to savepoint x / caller` passes the kit
   while the settings did not reach the caller — the exact "discarded
   without applying" failure the envelope obligation exists to catch.
   Worth naming as an observation limit next to the savepoint sentence.
4. **"A driver shipped from this repository SHALL be checked, at test
   time" — two shipped drivers never meet the kit.** Kit call sites:
   `packages/pg/test/driver.test.ts:761`, `packages/neon/test/http-session.test.ts:266`
   (http, false/false), `packages/supabase/test/driver.test.ts:240`
   (session), `packages/supabase/test/pooler.test.ts:313` (pooler,
   false/true). The Neon WebSocket driver (`neonDriver(pool)`, true/true;
   `packages/neon/test/driver.test.ts:185` checks the pin directly, not
   through the kit) and the Nile decorator (`packages/nile/`, passes the
   base's capabilities through) are not checked against their declared
   tier. Pre-existing gap that the MODIFIED requirement restates without
   closing; my live control shows the pg hook passes the kit, so a
   neon-ws/nile kit test would be a one-liner each.
5. **`skills/hejbro/references/query-layer.md` drifts from the modified
   requirement.** Line ~214: "mismatched key sets fail to type-check
   (the database would reject the statement)" — the requirement now
   states the opposite (measured: Postgres accepts; the refusal is
   TypeScript's). And the new `ExecuteResult` arm (a core-built
   `select(a).union(select(b))` executed through `handle.execute()`
   reads back as the left branch, object projection widened with `null`)
   is a public typing surface (`packages/query/src/db/db.ts:237-238`)
   with no mention in the skill's "Set operations" section, which only
   documents the chain surface (`handle.select(...).union(...)`).

Observations (no finding): `select(posts).innerJoin(posts, …)` renders
`from "app"."posts" inner join "app"."posts"` → PG 42712 "specified more
than once" — the query-builder spec promises no aliasing, noted only as
the one join shape qualification does not rescue. `assertFalseTier…` and
the envelope check match the caller by exact `sql` text: `SELECT 1` vs
`select 1` is "caller absent" → VIOL-1 (spec-consistent; the caller hands
over its own statement).

### Verified scenarios

driver-contract — "Every declared tier's obligation is machine-verified":
- OK — *A driver that fails its declared tier's obligation is caught*:
  kit table `packages/query/test/driver/conformance.test.ts` (72 tests
  across the three query files pass); probe A rows `begin / set local /
  COMMIT; / caller` → VIOL-1 naming tier `session-state:false+interactive-transactions:true`.
- OK — *Checked against the wrong tier is refused*: probe A —
  (true,true)+`recordedOnConnection` → refused (`session-state:true`),
  (false,false)+`recordedOnConnection` → refused (`session-state:false`),
  (false,true)+`recordedForSetupSession` → refused.
- OK — *Compliant driver's declaration is left unchanged*: probe A and
  C6 — capabilities value byte-identical after each compliant check.
- OK — *Settings sent before the transaction opens are caught*: kit row
  `settings/open/caller/end` → VIOL-2 ("no statement was sent between the
  transaction's own opening"); `supabase/test/pooler.test.ts:264` same.
- OK — *An observation that cannot show transaction control is refused*:
  probe A — (false,true)+`recordedForOneExecute` → shape refusal (reads
  which record, not its statements); `recordedOnConnection: [select 1]`
  and `[]` → judged and failed (VIOL-1), not refused, as the text
  requires.
- OK — envelope vocabulary as written: `BEGIN;`, `begin work`,
  `START TRANSACTION READ ONLY`, `Start Transaction;`, `begin\n;`, `END;`,
  `end transaction`, `abort`, `abort work`, `rollback work`, `COMMIT;;`,
  `  Commit \n;\n`, `commit ; select 1` (leading `commit`) all classify
  as the text predicts; `savepoint x` / `release savepoint x` /
  `rollback to savepoint x` / `ROLLBACK TO SAVEPOINT x;` / `do $$ begin …
  end $$` / `select 'begin'` / caller `commit` / caller `begin` all
  ordinary or excluded as the text says. Each of those spellings
  measured on PG 17.11 opens/ends exactly as the kit classifies (probe
  B), except the cases in NB1–NB3.
- OK — in-repo drivers as controls on the real wire (PG 17.11,
  `log_statement=all`): pg (true,true) hook → PASS; supabase `session`
  endpoint (pass-through, true,true) → PASS; supabase
  `transaction-pooler` over pg (false,true), wire = `set intervalstyle…;
  set bytea_output…` (checkout pin) / `BEGIN` / `set local intervalstyle`
  / `set local bytea_output` / caller / `COMMIT` → PASS for every caller
  statement; the same wire as `recordedForOneExecute` → refused. Neon
  http (false,false) `recordedForOneExecute` → its own test passes (8/8).

driver-contract — "Vanilla driver pins IntervalStyle at checkout":
- OK — *The pin precedes the first caller statement, on either path*:
  live wire c1/c2: pin → (hook marker) → `select 'caller'`; pin → hook →
  `BEGIN` → caller → `COMMIT`.
- OK — *A reused connection is not pinned twice*: c1 second execute on
  the same `max:1` pool shows `select 'caller-2'` with no second pin.
- OK — *A failed pin attempt is retried on the next checkout*:
  `packages/pg/test/driver.test.ts:602` (28/28 pass); not re-probed live.
- OK — *A wrapped session-setup hook takes effect at checkout*: c1/c2 —
  `driver.setupSession = wrapper` after `pgDriver()`; wire shows the
  wrapper's own marker between the pin and the caller, on both paths.
  `Driver.setupSession` is a method signature (not `readonly`,
  `packages/query/src/driver/contract.ts:120`), so the admitted in-place
  replacement type-checks without a cast.
- OK — *A decorator that returns a new driver value runs its own hook*:
  c3 (`{...driver, setupSession: own}` executed through the new value) —
  wire: base pin then caller, own hook never runs; c5 (member replaced on
  the spread value) — no effect; c4 (base member replaced *after*
  spreading) — the wrapper runs on the spread value's execute, i.e. the
  member is read late from the value fixed at build. Pooler control
  (`supabaseDriver(pg, {endpoint:"transaction-pooler"})`) shows the same:
  base checkout pin still sent, pooler's no-op hook never consulted.

query-type-inference — "Set-operation branches must be row-compatible…":
- OK — *Identical branch shapes pass through unchanged*: tsc S9a — chain
  `handle.select(posts).union(handle.select(posts))` equals the single
  select's row type.
- OK — *Mismatched keys are rejected at compile time*: tsc S7 (core
  combinator) and S9 (chain) — `@ts-expect-error` consumed on
  `{id,name}` ∪ `{id,title}`.
- OK — *Nullability widens to the union*: tsc S9b — chain `posts`
  (`status` notNull) ∪ `posts2` (`status` nullable) → `string | null`.
- OK — *A core-built set operation executed on a handle reads back as its
  left branch*: tsc S1/S2/S6 with real values — `select(posts).union(
  select(posts2))`, `.intersect`, `.except`, `.unionAll().orderBy().limit()`,
  `(a ∪ b) \ a`, and `tx.execute` all resolve exactly the row the left
  branch resolves alone (`{id: string; status: string; amount: bigint |
  null}`); no key is `unknown`; an undeclared key is a type error
  (`@ts-expect-error` consumed). Left-branch-only typing pinned both ways
  (S8: `posts2 ∪ posts` → `string | null`, `posts ∪ posts2` → `string`).
  Live PG: every combinator executes through `handle.execute()` and rows
  arrive with the declared keys (`amount` as `bigint`), including `.orderBy().limit()`.
- OK — *An object projection widens where the join record is missing*:
  tsc S3 — `select({label: posts.status, amt: posts.amount}, posts).union(…)`
  → `{label: string | null; amt: bigint | null}` while the same left
  branch executed alone gives `{label: string}` (S3b); S4 (left branch
  with `leftJoin`, keys drawn from the joined table) → both `| null`; S5
  (whole-table left branch carrying a `leftJoin`) → unaffected, `status:
  string`. Live PG: object-projection union and left-join union execute
  with the left branch's keys.

Supporting (not a delta scenario; query-builder "Inner and left join …
every projected column stays schema-qualified"): live PG —
whole-table `innerJoin`/`leftJoin` over `posts`/`comments` (both declare
`id`) render `"app"."posts"."id", …` and execute; the hand-written
unqualified form fails 42702; join-free render is byte-identical
(`select "id", "status", "amount" from "app"."posts"`); object-projection
join and CTE-from join (`with "recent" as (…) select "recent"."id" …
inner join "app"."comments"`) execute. `packages/core/test/query/select.test.ts`
50/50 pass.

### Method

- Build: the worktree's `dist` built at 17f54953 (not rebuilt here). Type
  probe (`tsc --noEmit`, TypeScript 5.9.3, `strict` +
  `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) resolved
  `@hejbro/core`/`@hejbro/query`/`@hejbro/pg` through each package's
  `dist/index.d.ts` — the published surface — with real values
  (`select(...)`, `db(schema, pgDriver(...))`), not `SetOpStage<…>` type
  literals; every pin an `Equal<>` literal, `@ts-expect-error` counted as
  a failed pin if reported unused. Runtime probes imported
  `packages/*/dist/index.js` by path; the kit (not exported) was compiled
  standalone from `packages/query/src/testing/driver-conformance.ts`.
- Live server: `postgres:17` (17.11) in Docker, `log_statement=all`,
  `log_line_prefix='%a|%p| '` so each case's wire is read from the
  server log by `application_name`, plus a `pg.Client.prototype.query`
  spy on the client side (both agreed on every case);
  `max_prepared_transactions=10` for the `prepare transaction` case.
  Block-open detection: `transaction_timestamp()` equal across two
  statements with `pg_sleep` between; setting applied: `show intervalstyle`
  after `set local intervalstyle to 'iso_8601'`.
- Inputs: 35 kit envelope rows + 6 shape rows (probe A); 35 live
  spellings (probe B); 5 decorator shapes on the real pg driver + pooler
  + session endpoint + pg hook (probes C/C6); 7 set-op statements and 5
  join shapes + CTE join on live PG (probes E/E2); 14 + 3 `tsc` pins
  (probe D).
- Targeted test runs (file-scoped, no workspace-wide gates):
  `@hejbro/query` conformance/execute-result-type/join (72 pass),
  `@hejbro/pg` driver (28), `@hejbro/supabase` pooler+driver (22),
  `@hejbro/neon` http-session (8), `@hejbro/core` select (50).
- Loaded vs read: kit, `db.ts`, `select-result.ts`, core `select.ts`,
  `render-sql.ts`, pg/supabase/neon driver sources and the listed tests
  were read; skills/hejbro grep-read only. Probe directories and the
  container were removed after the run.
