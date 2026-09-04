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

