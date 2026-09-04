# Adversarial spec-only evaluation — harden-query-guards (D106)

## Round 1

Reviewer input: the change's delta requirements/scenarios
(`openspec show harden-query-guards --diff`) and the public surface they
name — `@hejbro/query`'s exports, `client/name-keyed-db.ts`, the
transaction path, `@hejbro/query/testing`'s conformance kit,
`@hejbro/pg`, and `skills/hejbro/references/query-layer.md`. Worktree
`_tmp-d106-qy` at `98e99652`. No proposal/design/tasks/PR/issue/blackbox
text was read as evidence; every claim below was re-derived from inputs
constructed here and run.

### Verdict

**BLOCKING 0 / NON-BLOCKING 4 / OK 11**

All eleven delta scenarios match shipped behavior exactly. The four
non-blocking findings are neighbour inputs the scenarios leave open and
one universal sentence whose literal reading shipped behavior does not
honor.

### Gates

All six run in this worktree with `TURBO_FORCE=1`, fully, before any
scenario was evaluated. Raw results:

```
pnpm build --force        Tasks: 7 successful, 7 total | Cached: 0 cached, 7 total | Time: 14.225s
pnpm check                Checked 739 files in 508ms. No fixes applied.
pnpm check-types          Tasks: 18 successful, 18 total | Cached: 0 cached, 18 total | Time: 18.422s
pnpm test                 Tasks: 18 successful, 18 total  (core 100, query 64, hejbro 92, supabase 17,
                          neon 6, nile 5, skills 5, examples 3+4+1, pg 1, cli-smoke 1 test files — all passed)
                          then Tasks: 2 successful, 2 total (test:types)
pnpm check:bans           check-bans: ok — no `let`/`var`/loop statements, and no copy of the
                          missing-capability message text, in 237 package source files
openspec validate harden-query-guards --strict
                          Change 'harden-query-guards' is valid
```

The `driver-contract` MODIFIED target requirement — *Every declared
tier's obligation is machine-verified in this repository* — exists in
`openspec/specs/driver-contract/spec.md:385`, so the delta has a real
target to merge into (checked separately: `validate --strict` does not
look at that). No scenario is dropped or renamed by the MODIFIED delta;
it rewrites the classification sentence and appends four scenarios.

### Blocking

None.

### Non-blocking

**NB1 — A comment glued to the end of a control word hides it.**
`packages/query/src/testing/driver-conformance.ts:162`

The leading word is "the first run of characters that are neither
whitespace nor `;`", so a comment with no space before it becomes part
of the word and the statement stops being a transaction boundary.

Reproduction (envelope tier, `session-state:false` +
`interactive-transactions:true`; classified by placing the text between
the opening and the caller statement, and as the opener):

| statement text | classified | real Postgres |
|---|---|---|
| `commit-- x` | ORDINARY | ends the transaction |
| `COMMIT/**/` | ORDINARY | ends the transaction |
| `/* trace */ commit` | ORDINARY | ends the transaction (pinned by the delta as ordinary — declared) |
| `-- opens\nbegin` | ORDINARY (no opening) | opens (pinned by the delta — declared) |

The delta declares the *leading*-comment blind spot in a scenario of its
own ("A comment-led statement is ordinary") and the proposal's out of
scope names "stripping leading comments". Neither covers the trailing
glued comment, and the classification sentence's own reading
("a semicolon glued to the word … never become part of it") invites a
reader to assume the same for a glued comment. A driver that emitted
`COMMIT-- pin` would pass the envelope check with the caller's statement
outside the transaction — the exact failure this tier's obligation
exists to catch. A neighbour input the scenarios should have covered, or
that the requirement should have named as a blind spot alongside the
leading-comment one.

**NB2 — "A lookup resolves only to an own property the surface actually
carries" is not true of three of the five carved-out names.**
`packages/query/src/client/name-keyed-db.ts:227,244`

The `schema-vendoring` requirement's second sentence is universal; its
third sentence carves out `then`/`toString`/`valueOf`/`constructor`/
`toJSON` as "readable rather than refused". Shipped behavior for those
five, on a contract vendoring `posts` and the function `add`:

| name | client | `client.as(ctx)` | resolves to |
|---|---|---|---|
| `then` | OK | OK | `undefined` (not carried, not inherited) |
| `toJSON` | OK | OK | `undefined` |
| `toString` | OK | OK | `Object.prototype.toString` (inherited **function**) |
| `valueOf` | OK | OK | `Object.prototype.valueOf` (inherited function) |
| `constructor` | OK | OK | `Object` (inherited) |
| `__proto__` | THROW `unknown-contract-table` | THROW `unknown-contract-table` | — |
| `hasOwnProperty` | THROW | THROW | — |
| `isPrototypeOf` | THROW | THROW | — |
| `propertyIsEnumerable` | THROW | THROW | — |

So three of the five carve-outs *do* resolve to an inherited
`Object.prototype` member, which the universal sentence says a lookup
never does. No scenario pins what they resolve to — the scenario only
says "none of those refuses" — so a future reader taking the universal
sentence at face value would expect `client.toString` to be `undefined`
and could "fix" the guard into refusing it, breaking `String(client)`.
Wording a future reader would misread; the behavior itself is right.

**NB3 — A table vendored under a client-member name is dropped from the
"vendored list" the refusal names, and reachable on only one surface.**
`packages/query/src/client/name-keyed-db.ts:265,451,503`

Contract vendoring tables `posts`, `as`, `fn` and function `add`:

| lookup | observed |
|---|---|
| `client.as` | the scope **function** — the vendored `as` table is shadowed |
| `client.as(ctx).as` | the vendored `as` **table** (`.select` is a function) |
| `client.fn` / `scoped.fn` | the `fn` façade — the vendored `fn` table is unreachable on both surfaces |
| `client.fn.select` | THROW `unknown-contract-function` (`"select" is not a function this contract vendors`) |
| `client.zzz` | THROW `unknown-contract-table` — `Vendored tables: posts.` |
| `scoped.zzz` | THROW `unknown-contract-table` — `Vendored tables: posts.` |

The requirement says the refusal names "the vendored list" and that an
own property "always wins". Both hold for every ordinary name; for `as`
and `fn` the list omits two names the contract genuinely vendors, and
"always wins" holds on the scoped handle but not on the client. The
delta's own sentence — "`as` is a member of the client and not of the
scoped handle" — is the sentence a reader would consult here and it says
nothing about the collision. Pre-existing shape, but the ADDED
requirement is what now states the guard universally ("on every surface
it exposes"), so the gap is now spec-adjacent. Neighbour input.

**NB4 — After a nested transaction its own parent callback never
awaited, the starting `tx` is refused `statement-during-nested-transaction`
for the rest of the transaction, with nothing in flight.**
`packages/query/src/db/transaction.ts:308-309`

`tree.innermost` is restored by each nested transaction's `finally`, so
restoration is last-writer-wins. Strict LIFO nesting is guaranteed only
while every nested transaction is awaited by the callback that started
it. With a floating one, the deeper transaction's `finally` runs last and
leaves `tree.innermost` pointing at an already-**settled** token.

Reproduction (real Postgres 17, `@hejbro/pg` pool; identical at all four
root sites — unscoped, scoped `db.as(ctx)`, provider, pooler-decorated):

```js
await db.transaction(async (tx1) => {
  await tx1.transaction(async (tx2) => {
    tx2.transaction(async (tx3) => { await tx3.execute(sql`insert into t values (19)`); });  // never awaited
    return "tx2-done";
  });
  await new Promise((r) => setTimeout(r, 300));   // everything has settled by now
  await tx1.execute(sql`insert into t values (20)`);
});
```

Observed:

```
parentAfterward: "statement-during-nested-transaction"
wire: ["savepoint sp_1","savepoint sp_2","release savepoint sp_1","insert into t values (19)",
       "release savepoint sp_2","rollback to savepoint sp_2"]
floating promise rejects: savepoint-rollback-failed
rows afterwards: []      (the whole transaction is lost; db.transaction() still resolves)
```

Two things the delta's text does not hold up to here. (a) "Sequential use
stays unaffected: once a nested transaction has settled — released or
rolled back — the `tx` that started it accepts statements again" — `tx2`
settled (its `RELEASE` is on the wire) and `tx1` is still refused, for
the rest of the transaction. (b) The refusal's own message states
something false: *"while a nested transaction started from it (or from a
`tx` above it) is still in flight"* — none is.

Classified non-blocking rather than blocking: reaching it needs a
never-awaited nested transaction (a floating promise — a caller bug, and
undefined behavior for any promise-based API), and by the time the
refusal is observed the enclosing transaction is already unrecoverable
for an unrelated reason — `RELEASE sp_1` destroyed the still-live
`sp_2`, so the transaction aborts and `COMMIT` silently becomes a
rollback. A reviewer reading the "Sequential use stays unaffected"
sentence literally could reasonably escalate this; the finding is
recorded with its full reproduction so the owner can decide whether the
requirement should exclude an unawaited nested transaction explicitly.

### Verified scenarios

`schema-vendoring` — *A lookup of a name the contract does not vendor is
refused*

- **An unvendored table is refused on the scoped handle exactly as on the
  client** — OK. Built a client over a contract vendoring `posts` + `fn.add`
  and looked 13 names up on the client and on `client.as({role:"app_user"})`
  in turn. `nope`, `__proto__`, `hasOwnProperty`, `isPrototypeOf`,
  `propertyIsEnumerable` all throw `unknown-contract-table` on **both**,
  message `"…" is not a table this contract vendors. Vendored tables: posts.
  Next: …`; none yields `undefined`. Empty-contract case names
  `(none vendored)` on both.
- **An inherited name is refused on the scoped handle** — OK. `__proto__`
  and `hasOwnProperty` on `client.as(ctx)`: `unknown-contract-table`; on
  its `fn`: `unknown-contract-function` (`Vendored functions: add.`).
  Neither resolves to `Object.prototype` nor to an inherited function.
  A contract that vendors a table literally named `__proto__` or
  `hasOwnProperty` resolves it instead — own property wins, as the
  requirement says.
- **The names the language reads stay readable on the scoped handle** —
  OK. `await scoped` resolves; `String(scoped)`, `${scoped}`,
  `JSON.stringify(scoped)`, `util.inspect(scoped)`, `{...scoped}`,
  `Object.keys(scoped)`, `Object.getPrototypeOf(scoped)`, `"nope" in
  scoped` and symbol lookups (`Symbol.toPrimitive`, `Symbol.iterator`,
  `Symbol.toStringTag`, `Symbol.for("nodejs.util.inspect.custom")`) all
  succeed without refusing — same on the client. See NB2 for the wording.
- **A vendored member resolves on the scoped handle** — OK.
  `scoped.posts.select` is a function, `scoped.fn.add` is a function, and
  `scoped.as` throws `unknown-contract-table` naming `posts`. Chaining
  onto a refused name (`scoped.nope.select()`, `client.nope.select()`)
  raises the coded error at the lookup, never an uncoded `TypeError`.
  See NB3 for a contract that vendors `as`/`fn` as table names.

`driver-contract` — *Every declared tier's obligation is machine-verified
in this repository* (MODIFIED)

- **A semicolon glued to the leading word does not hide it** — OK. Ran
  the envelope tier over an input table of 56 statement texts, each
  placed twice: as the opener (`[text, settings, caller]`) and between
  the opening and the caller (`[begin, settings, text, caller]`).
  `commit;`, `commit; ;`, `COMMIT;;`, `;commit`, `rollback; to savepoint x`
  all END (caller after one of them → refused, "the caller's own statement
  was not sent inside an open transaction"); `  BEGIN ;` and
  `begin; set local x` both OPEN, and a conforming wire opening with
  either is not refused. Neighbours confirmed on the same run: `commit`,
  `commit ;`, `COMMIT`, `end`, `END`, `abort`, `rollback`, `commit;x`,
  `\t\ncommit`, `rollback ; to savepoint x`, `rollback work; to savepoint x`
  → END; `;begin`, `;;begin;;`, `;start transaction`, `begin work`,
  `begin transaction`, `begin isolation level serializable`, `BEGIN\n;`,
  `start transaction read only`, `start\ttransaction`, `start\ntransaction`
  → OPEN; `beginning`, `startle transaction`, `savepoint commit`,
  `release commit` → ORDINARY.
- **Nothing past the leading statement is read** — OK. `start; transaction`
  opens nothing (as opener → refused; as a middle statement → ordinary);
  `savepoint x;`, `select 'begin; commit'`, `select ';'` are all ordinary
  and the envelope conforms with any of them standing in for the settings.
  `start transaction; commit` still OPENs (the `commit` past the `;` is
  never reached) and `commit;begin` still ENDs. `""`, `"   "`, `";;;"` are
  ordinary.
- **A savepoint rollback keeps its optional words** — OK.
  `rollback transaction to savepoint x`, `rollback work to savepoint x`,
  `ROLLBACK TRANSACTION TO SAVEPOINT s`, `rollback  work  to  savepoint x`,
  `rollback\tto savepoint x` are all ordinary, exactly as
  `rollback to savepoint x`; `rollback work` and `rollback transaction`
  on their own still END, and `rollback work; to savepoint x` ENDs (the
  `;` stops the read).
- **A comment-led statement is ordinary** — OK. `-- opens\nbegin` as the
  opener → the envelope is refused for having no opening;
  `/* trace */ commit` between the opening and the caller → conforms.
  `/* c */ begin` likewise opens nothing. See NB1 for the trailing-comment
  neighbour.
- The requirement's headline claim was checked too: the kit is actually
  called from `packages/pg/test/driver.test.ts`,
  `packages/neon/test/http-session.test.ts`,
  `packages/supabase/test/driver.test.ts` and
  `packages/supabase/test/pooler.test.ts` — every shipped driver tier has
  a caller.

`query-execution` — *A statement beside an in-flight nested transaction
is rejected*

All of the below ran against a real `postgres:17-alpine` through
`@hejbro/pg`'s pool driver, with the driver session wrapped in a
recording proxy so the exact wire is observed, and with the row set read
back out-of-band after each case. Every case was run at **four** root
sites: unscoped `db.transaction`, scoped `db.as(ctx).transaction`,
provider `db.transaction` (a registered `contextProvider`), and a
`supabaseDriver(..., {endpoint:"transaction-pooler"})`-decorated driver.
Results were identical at all four (only the pins differ on the wire).

- **A statement beside a nested transaction is refused and the nested
  work survives** — OK. `Promise.all([tx.transaction(cb), tx.execute(s)])`:
  the statement rejects with `statement-during-nested-transaction`, the
  wire is exactly `savepoint "hejbro_sp_1"` → the nested insert →
  `release savepoint "hejbro_sp_1"` (the refused statement never appears),
  the nested callback returns `"nested-ok"`, and the nested row is present
  afterwards.
- **A chain awaited beside a nested transaction is refused at the send** —
  OK. Built `tx.with(...)`, `tx.insert(t).values(...)`, `tx.deleteFrom(t)`,
  `tx.update(t).set(...)` and `tx.select(t)` *before* starting the nested
  transaction: construction refuses nothing. Awaiting each while the
  nested transaction is in flight rejects with
  `statement-during-nested-transaction`, and the wire carries nothing for
  any of the five.
- **Every tx above the nested transaction is refused alike** — OK. Nested
  two levels down (`tx1 → tx2 → tx3`), from inside `tx3`'s callback:
  `tx1.execute` → `statement-during-nested-transaction`, `tx2.execute` →
  `statement-during-nested-transaction`, a chain awaited on `tx1` →
  `statement-during-nested-transaction`, `tx1.transaction(...)` →
  `concurrent-nested-transaction` (its own refusal, as the requirement
  says). `tx3`'s own work completes; wire is `sp_1, sp_2, insert,
  release sp_2, release sp_1`.
- **A nested handle used after its callback settled is refused** — OK.
  Kept the `tx` from a nested callback that **released**: `execute`,
  a `with` chain await, an `insert` chain await and `transaction()` all
  reject with `statement-after-nested-transaction`. Repeated with a
  nested callback that **rolled back** on a thrown error: same code for
  both a statement and a new nested transaction. Nothing reaches the
  connection — no statement and no `savepoint` appears on the wire for
  any of them — and the enclosing `tx` still sends normally right
  afterwards.
- **A transaction's own handle used after it settled is refused** — OK.
  Kept the root `tx` after a **committed** transaction: `execute`, a
  `with` chain await, a `select` chain await and `transaction()` all
  reject with `statement-after-transaction`; wire after the callback is
  empty and the row the refused statement would have written does not
  exist (only the committed row is present). Repeated after a transaction
  that **rolled back** on a thrown error: same code for statement, chain
  and nested transaction, and the table is empty afterwards. Identical at
  all four root sites, which is what makes the single `runCallbackWithTx`
  settling site observable rather than assumed.
- **Sequential use after a settled nested transaction still works** — OK
  for the awaited shape. `nested(release) → tx.execute → nested(release)
  → nested(rollback on caught error) → tx.execute → nested(release)` runs
  end to end on one connection; the wire is
  `sp_1, ins, release sp_1, ins, sp_2, ins, release sp_2, sp_3, ins,
  rollback to sp_3, release sp_3, ins, sp_4, ins, release sp_4`, savepoint
  names never reused, and the surviving rows are exactly the four that
  should survive. See NB4 for the unawaited shape.
- Two extra inputs, both matching the requirement rather than
  contradicting it. **Two sibling nested transactions**: the second
  rejects `concurrent-nested-transaction` before its callback ever runs
  (only one savepoint sequence on the wire) — the requirement's own
  "keeps its own refusal". **Reversed-order `Promise.all([tx.execute(s),
  tx.transaction(cb)])`**: `s` is *not* refused, because at the moment it
  is sent no nested transaction is in flight; the wire proves it lands
  before the `SAVEPOINT` (`insert 17, savepoint sp_1, insert 18, rollback
  to sp_1, release sp_1`) and row 17 survives the nested rollback. That is
  the requirement's "the refusal is decided where the statement is sent"
  read from the other direction, and it is right.

The user-facing skill (`skills/hejbro/references/query-layer.md:813-838`
and the error table at :1088-1095) states all four codes and their
remedies, and every sentence there matches what was observed — including
"before any savepoint statement is sent and before its callback ever
runs" for `concurrent-nested-transaction`, which the wire confirms.

### Method

- Worktree `_tmp-d106-qy`, detached, `98e99652`. No other checkout
  touched. All six gates run first with `TURBO_FORCE=1`, quoted above.
- Name-lookup and conformance-kit scenarios: purpose-built vitest files
  under `packages/query/test/zz-d106/` importing the shipped modules
  directly (`src/client/name-keyed-db.ts`,
  `src/testing/driver-conformance.ts`), driven by input tables (13 names ×
  4 surfaces; 56 statement texts × 2 positions), never by the change's own
  tests. Probe output written to `/tmp` so nothing was inferred from a
  passing assertion.
- Transaction scenarios: a standalone Node script under
  `packages/pg/zz-d106/` importing the **built** `@hejbro/query`,
  `@hejbro/pg` and `@hejbro/supabase` (the real public surface, not source
  aliases), against `postgres:17-alpine` in Docker
  (`docker run -d --name d106-qy-pg -e POSTGRES_HOST_AUTH_METHOD=trust
  -p 127.0.0.1::5432 postgres:17-alpine`). Every case observes three
  things independently: the returned error `code`, the exact statement
  list captured off the driver session, and the table contents read back
  through a second connection. Ten cases × four root sites.
- Container removed and all scratch files deleted after the run; nothing
  committed.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling in `.blackbox/769/`).

- **NB1** — fixed here (tasks.md 2.1): the kit's leading words are identifier runs, so a comment opener glued to the control word (`commit-- x`, `COMMIT/**/`) ends the word and the statement is still classified; four rows pinned.
- **NB4** — fixed here: a token carries its parent and a settling nested transaction restores the nearest ancestor still in flight, never a settled token; a nested transaction the callback never awaited keeps the starting `tx` refused only while it is in flight, and its settling restores the starting `tx`. The requirement says so. The wider shape (the floating transaction commits alone after the root) stays #848.
- **NB2** — wording repaired: the lookup sentence states what the five language names resolve to when the surface carries no own member of that name.
- **NB3** — already tracked as #845.

Archived at this disposition.

