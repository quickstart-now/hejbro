# Design: harden-query-guards

Open decisions, each as background → options → recommendation. Every
decision here is settled by the lead before implementation; the settled
answer is what the delta specs already state, and a different ruling
ripples back into the delta before any task starts.

## Q1 — The scoped handle's guard (#769)

**Background.** `createNameKeyedDb` wraps the client in a `Proxy`
(`wrapWithTableGuard`) whose `get` refuses any string key that is not an
own property and not in the pass-through list (`then`, `toString`,
`valueOf`, `constructor`, `toJSON`). `as` builds its return value as a
plain object literal from the same parts and never wraps it. The unscoped
handle's known-table list already filters out `as` and `fn`.

**Q1a — Same code and message on the scoped handle, or its own?**
- (i) Same `unknown-contract-table`, same message naming the vendored
  list. One guard, one builder for both handles.
- (ii) A scoped-specific code or message ("…on the scoped handle").
- **Recommend (i).** The vendored list is the same; a caller fixing a
  typo does the same thing on either handle. A second code is a second
  thing for callers to match with no second remedy.

**Q1b — `as` looked up on the scoped handle.**
Today `scoped.as` is `undefined` (the type already omits it). Under the
guard it is not an own property, so:
- (i) Refused with `unknown-contract-table` like any other unknown name.
- (ii) Added to the pass-through list (stays `undefined`).
- **Recommend (i).** `undefined` is the silent shape this change exists
  to remove; re-scoping a scoped handle is not a decided surface, and a
  coded refusal is the honest answer until it is. The message's
  vendored-list text is accurate (it is not a table).

**Q1c — Pass-through list.** Unchanged: `then`, `toString`, `valueOf`,
`constructor`, `toJSON`, plus every symbol key (the existing
`typeof prop === "string"` gate). No addition is needed for the scoped
handle; `util.inspect` reads a symbol.

## Q2 — The kit's leading-word rule (#761)

**Background.** `normalizeStatement` trims, lower-cases, strips one
trailing run of `;` and splits on whitespace. `commit; ;` therefore
yields the token `commit;` (ordinary — a transaction end is missed, the
envelope passes) and `begin; set local x` yields `begin;` (ordinary — a
conforming wire is refused). The contract sentence says "the word its
text leads with … stripped of any trailing semicolons".

**Q2a — The exact rule.**
- (i) *Leading word = first run of characters that are neither
  whitespace nor `;`, after trim + lower-case (leading `;` and
  whitespace skipped). The second word (needed for `start transaction`
  and to exclude `rollback to`) counts only when whitespace alone
  separates it from the first; a `;` between them ends the leading
  statement.* Consequences: `commit;`, `commit; ;`, `COMMIT;;`,
  `;commit` → end; `rollback; to savepoint x` → end (the server runs
  `ROLLBACK`, then errors on the rest — the transaction did end);
  `begin; set local x`, `  BEGIN ;` → open; `start; transaction` →
  ordinary (the server rejects a bare `START`, nothing opens);
  `savepoint x;` → ordinary; quotes are never reached, so `select
  'begin; commit'` → ordinary.
- (ii) Split on `[\s;]+` and take the first two tokens regardless of
  what separated them. Simpler, but `rollback; to savepoint x` → ordinary
  (misses a real end) and `start; transaction` → open (opens nothing).
- **Recommend (i).** It is the only reading under which every row above
  matches what the server does, and it is the contract sentence's
  natural reading.

**Q2b — A statement that leads with a comment.**
`-- c\nbegin` and `/* trace */ begin` open a transaction on the server;
under any leading-word rule they classify ordinary.
- (i) State the limit: a comment-led statement is ordinary, pinned by a
  scenario, and the requirement says the check reads no SQL lexical
  structure beyond the leading word.
- (ii) Strip leading `--` line comments and `/* */` block comments before
  classifying.
- **Recommend (i).** No driver in this repository emits a comment-led
  control statement. (ii) is the first step of a SQL lexer (nested block
  comments are legal in Postgres) inside a check whose stated design is
  to read one word; the same over-claim (`prepare transaction`, `commit
  and chain` opening a chained transaction) is already tracked as a
  separate finding, and this change should not half-close it.

**Q2c — Regression evidence.** The `@hejbro/pg` driver declares
`session-state: true`, so the kit judges its setup-hook recording — a
tier the normalization never touches. "No regression" is therefore the
kit's four in-repo consumers staying green (`packages/pg`,
`packages/supabase` session and pooler, `packages/neon` http), which is
the definition of done for the task, not a task of its own.

## Q3 — A statement beside an in-flight nested transaction (#449)

**Background.** `createSavepointApi` keeps one `active` flag per `tx`,
consulted only by `tx.transaction`. `tx.execute` and the chain members
send straight through the held session. `Promise.all([tx.transaction(a),
tx.execute(s)])` puts `s` between `SAVEPOINT` and `ROLLBACK TO`, so `s`
is undone when `a` throws — silently. The savepoint counter is already a
per-transaction-tree object shared through `buildTx`.

**Q3a — Refuse, or serialize?**
- (i) Refuse with a coded error before the send, the shape the sibling
  guard already has.
- (ii) Queue the statement until the nested transaction settles.
- **Recommend (i).** Serializing reorders what the caller wrote (a second
  silent behavior), and a nested callback that awaits the queued
  statement's promise deadlocks. The sibling guard chose refusal for the
  same reasons; one shape for both.

**Q3b — Which `tx` may send?** The invariant is: *only the innermost
in-flight `tx` of a transaction tree may send*. That decides three cases
at once:
- the `tx` that started the nested transaction (the issue's case);
- any `tx` above it — a grandparent is just as wrong, and a per-`tx`
  flag would not see it;
- a nested `tx` kept past its callback — its savepoint is gone, and its
  statements land in the enclosing transaction unbracketed.
- (i) Guard the first two (during flight) only.
- (ii) Guard all three.
- **Recommend (ii).** The shared tree state that answers "who is
  innermost" answers the third case for free, and a stale nested handle
  used while a *new* sibling is in flight would otherwise land inside
  that sibling's savepoint — the original defect through another door.
  The third case has its own remedy, so it carries its own code (below).

**Q3c — Error codes and remedies.**
- `statement-during-nested-transaction` — a statement through a `tx`
  that is not the innermost in flight. Remedy in the message: issue it
  through the nested callback's own `tx` when it belongs to that work,
  or await the nested transaction first when it does not.
- `statement-after-nested-transaction` — a statement through a nested
  `tx` whose callback has settled. Remedy: issue it through the
  enclosing `tx`; the nested handle is that nested transaction only.
- Alternative: one code for both with a message that branches. Rejected
  by the corpus's own rule that a distinct remedy earns a distinct code.
- Naming follows the existing family (`concurrent-nested-transaction`,
  `nested-transaction-unsupported`): kebab-case, the situation, no verb.

**Q3d — Where the check runs.** At the send: `tx.execute` at the call,
a chain member when awaited (`then`), `with` the same. Never at chain
construction (inert by contract, `.compile()` sends nothing). The check
happens before `executeOn`, so a refused statement is never compiled
into a driver call. The `tx.transaction` member keeps the sibling guard
as it is; the new state does not replace it.

**Q3e — Surfaces.** `execute`, `select`/`insert`/`update`/`deleteFrom`/
`with` (every `ChainRun` a `tx` builds), and — through `buildTx` being
the one builder — both the unscoped `db.transaction` path and the scoped
`db.as(context).transaction` path.

## Deviation from the brief, recorded

The brief expected the `schema-vendoring` delta as MODIFIED. No
requirement in that spec (or any other) states what a name-keyed lookup
of an unvendored name does — the last repair of that guard recorded
exactly this gap — so the delta is ADDED, stating the guard for every
surface, with the unscoped rows as controls.
