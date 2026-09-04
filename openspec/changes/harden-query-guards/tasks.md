# Tasks: harden-query-guards

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited outside `packages/query`**: `packages/pg/test/
integration.test.ts` (1.5, a Docker-gated witness — `packages/pg/src` is
never touched) and `skills/hejbro/references/query-layer.md` (1.6). If a
task appears to need any other file, that goes back to the planner, not
into the diff.

**Ordering.** 1.1, 1.2 and 1.3 are independent. 1.4 extends 1.3's state
and follows it; 1.5 witnesses 1.3 on a real server and follows it; 1.6
documents everything and comes last.

## 1. Query-layer guards

- [x] 1.1 (~8m, actual ~4m) **[design]** The scoped handle refuses exactly what the
      unscoped handle refuses. Settles that the scoped handle shares the
      code, the message and the pass-through list, and that `as` on the
      scoped handle is refused like any other name it does not carry.
      Red: `packages/query/test/client/errors.test.ts`, new describe
      *"the scoped handle refuses exactly what the unscoped handle
      refuses"*, one `it.each` over an input table run against both
      surfaces (`client` and `client.as({ role })` on a contract vendoring
      `posts` and `add`, with the role declared):

      | lookup | expected on both surfaces |
      |---|---|
      | `nope` | `unknown-contract-table`, message names `posts` (scoped row is the red) |
      | `__proto__` | `unknown-contract-table` (scoped red) |
      | `hasOwnProperty` | `unknown-contract-table` (scoped red) |
      | `fn.__proto__` | `unknown-contract-function` (already green — control) |
      | `constructor` | readable, not refused |
      | `then` / `toJSON` | readable (`undefined`), not refused |
      | `posts` / `fn.add` | the vendored member (control) |
      | `await …`, `String(…)`, `JSON.stringify(…)` | no refusal |
      | `as` | member on `client`; `unknown-contract-table` on the scoped handle (red) |

      Also pin, once, that `scoped.nope.select()` throws the coded error
      at the lookup, never a `TypeError`. Green: one builder produces the
      guarded object for both handles — the scoped literal passes
      through `wrapWithTableGuard` — and the tsdoc for `as` records the
      guard. Files: `packages/query/src/client/name-keyed-db.ts`,
      `packages/query/test/client/errors.test.ts`.

- [x] 1.2 (~8m, actual ~2m) **[design]** The kit classifies by the leading word as the
      contract defines it. Settles the rule (design Q2a) and the
      comment-led limit (Q2b). Red:
      `packages/query/test/driver/conformance.test.ts`, a new
      `describe.each` *"the leading word is read past a glued semicolon,
      and nothing past the leading statement"*, each row a statement
      text and its expected class, observed through the envelope
      obligation (`capabilities` false/true): an `open` row is placed
      where the opening goes (`[row, settings, caller]` conforms); an
      `end` row between the settings and the caller (`[begin, settings,
      row, caller]` → "was not sent inside an open transaction"); an
      `ordinary` row between the opening and the caller (`[begin, row,
      caller]` conforms, the row standing in for the settings):

      | text | class | red today? |
      |---|---|---|
      | `commit;` | end | green (control) |
      | `commit; ;` | end | red |
      | `COMMIT;;` | end | green (control) |
      | `;commit` | end | red |
      | `rollback; to savepoint x` | end | red |
      | `  BEGIN ;` | open | green (control) |
      | `begin; set local x` | open | red |
      | `start; transaction` | ordinary | green (control) |
      | `savepoint x;` | ordinary | green (control) |
      | `select 'begin; commit'` | ordinary | green (control) |
      | `select ';'` | ordinary | green (control) |
      | `-- opens\nbegin` | ordinary (limit) | green (control) |
      | `/* trace */ commit` | ordinary (limit) | green (control) |

      Green: replace `normalizeStatement` + `split(/\s+/)` with a
      leading-words reader — skip leading whitespace and `;`, take the
      first run of `[^\s;]`, then the second run only if the separator
      between them is whitespace alone. The tsdoc's rule sentence is
      rewritten to the delta's words. Definition of done includes the
      kit's four in-repo consumers staying green: `pnpm --filter
      @hejbro/pg --filter @hejbro/supabase --filter @hejbro/neon test`
      (report the counts). Files:
      `packages/query/src/testing/driver-conformance.ts`,
      `packages/query/test/driver/conformance.test.ts`.

- [x] 1.3 (~9m, actual ~2m) **[design]** A statement through the `tx` that started an
      in-flight nested transaction is refused before it is sent. Settles
      the code, the message's two remedies (design Q3c), and that the
      check runs at the send (Q3d). Red:
      `packages/query/test/db/transaction.test.ts`, new cases driven by
      a concurrency table on the `transactionalDriver` fixture:

      | shape | expected |
      |---|---|
      | `Promise.all([tx.transaction(a), tx.execute(s)])` | `execute` rejects `statement-during-nested-transaction`; wire is exactly `savepoint / a's select / release` — `s` never sent; `a` resolves its own value (red) |
      | same with `tx.select(posts)` awaited beside | same refusal at the await; building the chain before `tx.transaction` starts refuses nothing (red) |
      | same with `tx.insert(posts).values(…)` and `tx.with(…)` | same refusal (red) |
      | `Promise.all([tx.transaction(a), tx.transaction(b)])` | `concurrent-nested-transaction`, unchanged (control) |
      | `await tx.transaction(a); await tx.execute(s)` | runs (control) |
      | `tx.transaction(async (inner) => inner.execute(s))` | runs (control) |
      | `a` throws, caught; then `tx.execute(s)` | runs (control, existing) |

      Green: the per-tree `SavepointCounter` grows into the tree's state
      (`{ next, innermost }`); `buildTx` receives its own token, the
      savepoint api sets `innermost` to the child's token for the
      flight and restores its own on exit (in the `finally` that already
      clears `active`), and the `tx`'s `execute` and chain `run` refuse
      when `innermost` is not this `tx`'s token. The thrower is a
      `function` declaration returning `never`, message ending in
      `Next:` with both remedies. Files:
      `packages/query/src/db/transaction.ts`,
      `packages/query/test/db/transaction.test.ts`.

- [x] 1.4 (~6m, actual ~4m) **[design]** The whole tree, not one level: any `tx` above
      the in-flight nested transaction is refused, and a nested handle
      kept past its callback is refused under its own code. Settles
      `statement-after-nested-transaction` and its remedy. Red: same
      file, three cases —
      `outer.transaction(async (mid) => Promise.all([mid.transaction(a),
      outer.execute(s)]))` refuses `outer.execute` with
      `statement-during-nested-transaction` (red); `const leaked = await
      tx.transaction(async (inner) => inner); await leaked.execute(s)`
      refuses with `statement-after-nested-transaction` and sends
      nothing (red), for a released and for a rolled-back nested
      transaction alike; and the sequential control — after a settled
      nested transaction, `tx.execute(s)` then `tx.transaction(b)` both
      run, with `b` on a fresh savepoint name. Green: a settled token is
      marked so the refusal picks the second code; nothing else changes.
      Files: those two.

- [x] 1.4b (~3m, actual ~1m) A settled nested handle refuses to start a nested
      transaction too, under the same code. Found in 1.4: `leaked
      .transaction(cb)` sent a fresh savepoint with no error, and its
      exit restored the tree's innermost token to the settled handle,
      so the live parent's next statement would have been refused.
      Red: `packages/query/test/db/transaction.test.ts`, one case — a
      kept nested handle, released and rolled back alike, calling
      `transaction(cb)` rejects with `statement-after-nested-transaction`,
      `cb` never runs, no savepoint is sent, and the parent's next
      `execute` still runs. Green: the settled check at the savepoint
      api's entry, before the sibling guard. Files: those two.

- [x] 1.5 (~6m, actual ~8m) A real server witnesses the refusal and the survival.
      Red: `packages/pg/test/integration.test.ts` (Docker-gated,
      `pnpm --filter @hejbro/pg test:integration`, `postgres:17` as the
      harness already pulls), new case *"a statement beside a nested
      transaction is refused, so a nested rollback never takes it
      along"* — inside one `handle.transaction`, `Promise.all([
      tx.transaction(inserts then throws), tx.execute(insert B)])`
      with the nested error caught: assert `execute` rejected with the
      code, then that a sequential `tx.execute(insert B)` afterwards
      commits and reads back after the transaction. Before 1.3 the
      first assertion fails (the insert ran and vanished with the
      rollback — record the observed row count in the task-times note).
      `packages/pg/src` is not edited. Files:
      `packages/pg/test/integration.test.ts`.

- [x] 1.6 (~5m, actual ~1m) The skill states the new refusals. No red test observes
      prose; the observer is `pnpm --filter @hejbro/skills test`, which
      type-checks every code block in the reference against its prelude,
      so the one added example must compile. Edits to
      `skills/hejbro/references/query-layer.md`: the "Transactions"
      section gains one paragraph after "Only one nested transaction in
      flight per `tx`" — while a nested transaction is in flight only
      its own `tx` may send, a statement through the starting `tx` (or
      any above it) fails with `statement-during-nested-transaction`
      before it is sent, and a nested `tx` kept past its callback fails
      with `statement-after-nested-transaction`; the Errors table gains
      those two rows, and the `unknown-contract-table` row names the
      scoped handle (`client.as(context)`) as guarded alike, `as` on it
      included. Files: that reference.

## Close-out (not a group)

`.changeset/harden-query-guards.md` (`"@hejbro/query": patch`, one
paragraph in user-facing terms), `openspec/task-times.csv` rows (one per
task), README stamps (`pnpm check:tasktime`, `pnpm check:crap`), and the
three `W#` entries (`pnpm blackbox add work 769|761|449`) land in one
close-out commit before the review is requested.
