# Work — quickstart-now/hejbro#363

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — array-ergonomics group 4 — the witness that talks to a real server

_2026-08-28T00:00Z_

Piece record for `add-array-ergonomics` task 4.1 (tracking #363), built
by the g4 piece team (planner opus / implementer sonnet / reviewer
opus) in worktree `array-g4-witness` off dev `7d7eba3`, verdict PASS at
`b1686064d7f79bea15d340d40d57d0a562d1c331` (single commit, one file,
+148/-2). Every requirement was settled BEFORE red started — the g3
crossing lesson applied — and the piece ran with zero contract churn.

### What the real server proved

1. PG17 accepts a table-level CHECK whose expression carries
   fully-qualified column references
   (`array_position("g5_integration"."roundtrip"."labels", null) is
   null`) inside the very `create table` that defines the table — the
   fact no unit test could establish, and the one the group-1
   escalation asked this piece to witness. The DDL string and the pin
   share ONE constant, and the pin asserts it is core's own
   `generateMigration` output — the witness is bound to "the SQL core
   emits", never to hand-written SQL.
2. A null-element write is rejected by the DATABASE: the typed builder
   path (deliberate cast, reason commented — the type layer already
   rejects it, which mutation 3 proves via a live `@ts-expect-error`)
   surfaces `query-execution-failed` / `kind: insert` with cause
   `23514` and `constraint: labels_no_null_elements` — the constraint
   name pinned so "any failing insert" cannot pass. The failed insert
   sits between the seeds and the select, so the existing
   `toHaveLength(2)` doubles as proof the rejected row left nothing.
3. The read side arrives `ReadonlyArray<string>` — consumed with a
   bare `toUpperCase()` map, no filter; widening it is a real
   `check-types` failure (probe-proven: the pg package's tsconfig
   includes `test/`, established with insert-and-delete TS2344/TS2578
   probes before any claim was made). The empty array passes the CHECK
   for free (the mixed row seeds `[]`).
4. `assertNoNulls` against values the server actually returned: the
   stored `[-1, null, 42]` throws naming index 1 (an assertion, not a
   filter), and the clean value narrows in one call.

Bonus evidence, observed during mutation and kept out of the file (out
of scope; recorded here per the lead's ruling): with the CHECK removed
out-of-band and a null element actually stored, the read path fails
through group 3's guard with its exact `Next:` message — the
query-execution delta's fail-fast scenario, which group 3 proved with
stubs, confirmed against a live server. Mutation 1 (CHECK deleted from
the DDL) also demonstrated the insert then SUCCEEDS — independent
proof this suite converses with a living postgres:17, not a stub.

### Verdict and the one deviation

Four mutations, all red, each mapped to its gate — with the explicit
note of which gates actually guard this piece (`packages/pg`
check-types + the integration suite + biome; xref/next-marker/crap
structurally do not see it, #361). The one procedural deviation: the
implementer reproduced red post-hoc on the finished commit instead of
red-first. Recorded as fact, not sanded over; it does not decide the
verdict because the reviewer's mutation 1 independently reproduced the
implementer's reported red on three axes (location 455:18, shape,
count) — the third-party reproduction closes the "red written to match
the report" hole that a post-hoc red leaves open. Non-blocking
observations kept as observations: the `expect.unreachable`-inside-try
shape matches the existing repo convention (changing it is a repo-wide
question, deliberately NOT filed as an issue — cosmetic, and the 0.2.0
gate should not grow for it); the clean-path `assertNoNulls` call is
guarded by `expectTypeOf` alone, acceptable because the null-bearing
call carries the contract head-on.

### Ledger

Est 9m → 40m (25m editing woven into a ~470-line live harness + 15m
gates/format) + a separate 10m post-hoc-red process row. Tokens 271
requests / 209,944 output / 95.1% cache. Zero contract churn and zero
crossing cost — the requirements-first prescription from g3, measured
working one piece later.

Migrated from the single-file entry `.blackbox/2026-08-28-array-ergonomics-group4.md`, kept verbatim at `.blackbox/363/artifacts/2026-08-28-array-ergonomics-group4.md`.

