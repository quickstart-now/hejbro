# Work — quickstart-now/hejbro#761

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Conformance kit classifies by the leading word past a glued semicolon

_2026-09-04T16:00Z_

Built: `leadingWords` in `packages/query/src/testing/driver-conformance.ts` replaces
`normalizeStatement` + `split(/\s+/)`. It trims/lower-cases, then reads the leading word
as the first run of characters that are neither whitespace nor `;`; a second word counts
only when the separator immediately after the first is whitespace alone — a `;` in
between ends the leading statement and nothing past it is read. `isTransactionOpen`/
`isTransactionEnd`/`BARE_END_WORDS` are unchanged. The driver-contract spec's own
classification sentence was rewritten to match this rule exactly, plus three new
scenarios pinning the glued-semicolon, nothing-past-the-statement, and comment-led
edges.

Measured: red was exactly `commit; ;`, `;commit`, `rollback; to savepoint x`, and
`begin; set local x` (4 of 13 rows in a new `describe.each`, `conformance.test.ts`) —
every other row (including `commit;`, `COMMIT;;`, `  BEGIN ;`, both comment-led rows,
and the quoted-semicolon rows) was already green. After the fix: 55/55 in the file, 64
files / 945 tests package-wide, and the kit's four real in-repo consumers stayed green
(`@hejbro/pg` 28, `@hejbro/supabase` 141, `@hejbro/neon` 39).

<a id="w2"></a>
## W2 — Savepoint rollback keeps its optional work/transaction word

_2026-09-04T16:34Z_

Review repair (1.2b): `leadingWords` in `packages/query/src/testing/driver-conformance.ts`
now reads a third word past the second, under the same whitespace-only-separator rule
applied recursively. New `isSavepointRollback(secondWord, thirdWord)` replaces the old
`secondWord !== "to"` check: a rollback stays ordinary (a savepoint rollback) when `to`
follows it directly, or after one optional `work`/`transaction`; the two words alone,
with no `to`, still end the transaction. The driver-contract spec's classification
sentence and one new scenario ("A savepoint rollback keeps its optional words") were
rewritten to state this rule.

Measured: red was exactly the three new `ordinary` rows (`rollback transaction to
savepoint x`, `rollback work to savepoint x`, `ROLLBACK TRANSACTION TO SAVEPOINT s`) — 3
of 60 tests in `conformance.test.ts`; the two new `end` controls (`rollback work`,
`rollback transaction` alone) and every existing row were already green. After the fix:
60/60 in the file, 64 files / 963 tests package-wide, and the kit's four real consumers
stayed green (`@hejbro/pg` 28, `@hejbro/supabase` 141, `@hejbro/neon` 39).

