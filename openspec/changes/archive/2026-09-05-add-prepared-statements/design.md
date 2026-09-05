# Design: add-prepared-statements

Open decisions, each as background → options → ruling. Every decision
here was settled by the lead under the owner's full delegation for this
pass (recorded as rulings on the change's issue); the settled answer is
what the delta specs state.

## Q1 — Disposition: implement, or close with a verdict?

**Background.** The archived measurement shows a real, consistently
positive effect (50/50 runs, 6.6–8.4% of a ~0.85 ms local median) that
did not clear a pre-registered bar built on four spread estimators that
disagree structurally. Both terminal states were on the table: ship the
already-designed capability, or close the issue with a verdict that the
work is wrong.

- (i) Close: the absolute win is ~0.06 ms per statement and shrinks to
  noise once a network round trip is involved.
- (ii) Implement, opt-in: the contract was designed for it (a
  capability-gated driver behaviour), the effect never reversed, and the
  cost is one option and one declaration.
- **Ruling (ii).** Nothing in the record shows the capability wrong —
  only small. "Costly but sound" is a deferral, not a verdict, and the
  owner ruled deferrals out for this pass. Opt-in keeps every existing
  caller byte-identical in what it sends.

## Q2 — Where the gate lives

**Background.** The transaction-pooler decorator wraps a caller-built
base driver and can only see what that driver declares. If the base
named statements as a hidden implementation detail, the decorator could
neither know nor stop it, and the failure would surface as a server
error on the second transaction.

- (i) A third capability key, `prepared-statements`. Every driver must
  declare it (the union is closed, so every fake in the repository moves
  with it — ~40 test files, one mechanical edit each).
- (ii) An optional informational member on `Driver` outside the
  capability set (no churn, but a `Record` that stays "exactly two" while
  a third execution property lives beside it).
- (iii) An execution hint on `CompileResult` the decorator strips (an
  execution concern on a compile output).
- **Ruling (i).** Capabilities are already the surface decorators read
  and override; the spec's own sentence anticipates extension ("a spec
  change to this requirement"), and the churn is the enforcement the
  closed union exists to provide.

## Q3 — Default and option shape

- (i) Default on; the pooler decorator refuses unless turned off.
- (ii) Default off; `{ preparedStatements: true }` opts in.
- **Ruling (ii).** Explicit over implicit: a prepared statement changes
  server planning (generic plans after a few executions) and breaks
  silently over a transaction-mode pooler. The option is the second
  argument of `pgDriver` (both overloads) and of `neonDriver`'s `Pool`
  overload only — the HTTP overload has no session to prepare in, so the
  type does not offer it there.

## Q4 — The name

- Name: `hejbro_` followed by the first 32 hex digits of SHA-256 over
  the statement text — 39 bytes, inside Postgres's 63-byte identifier
  limit, stable across processes and connections, distinct across texts.
  The client library caches "parsed" per connection and per name and
  refuses one name for two texts, so a name that is a pure function of
  the text does not collide with a different text on one connection in practice (a 128-bit digest).
- Only built kinds are named. A `sql`-kind text may carry several
  commands (the session pins do; a migration body does) and a prepared
  statement may carry exactly one; hejbro parses no SQL, so the escape
  hatch is always sent unnamed. The rule depends on the declaration and
  the kind only — never on the text, the parameters, or anything seen at
  run time.

## Q5 — The pooler refusal

- Code `prepared-statements-without-session`; the message names the
  endpoint, the base's declaration, and ends with a `Next:` line: build
  the base driver without `preparedStatements`, or use the `"session"`
  endpoint. Checked once at construction, like the unknown-endpoint
  check; no connection is made. The decorated driver declares
  `prepared-statements: false`.

## Q6 — What is not in scope

- No eviction of server-side prepared statements: each distinct text is
  prepared once per connection for the connection's life. The set of
  texts an application compiles is bounded by its code (parameters are
  placeholders), with the one exception of a variable-length `in` list,
  which yields one text per arity; documented, not mitigated.
- The conformance kit is not extended: it observes `CompileResult`s,
  not the client library's query configs, and the naming rule is pinned
  by each driver's own unit tests and the vanilla driver's live witness.
