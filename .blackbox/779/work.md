# Work — quickstart-now/hejbro#779

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — expression texts in check diagnostics are delimited by backticks

_2026-09-04T15:35Z_

Every expression text `check` carries in a not-compared or differs finding is now delimited with backticks instead of double quotes, at all four message sites: the server-mode not-compared finding (both declared/catalog texts), the text-mode not-compared finding (both texts; the trailing `Next: restate … spelling: <text>` line stays unwrapped, unchanged), and the differs finding's shared "renders as `x`, but the database's own … renders as `y`." line (now built by one shared `rendersAsMessage(surface, declaredText, catalogText)` helper instead of four near-duplicate template literals).

The bug: a table-bound expression begins with a quoted identifier (`"table"."column"`) under server mode, or `"table"."column"` under text mode — wrapping that in the same double-quote character the message delimiter used made `Declared expression: "..."` collide with the expression's own leading quote, e.g. `Declared expression: ""posts"."role" = 'owner'"`. Backticks cannot appear as a SQL quote character and already wrap commands (`` `hejbro check` ``) in these same messages, so the fix costs no new vocabulary.

Pinned with an input table over the three message sites × three expression shapes (begins with a quoted identifier, carries a double quote inside a string literal, carries a `::type` cast) in `check-expression.test.ts`'s new "3.8 expression texts are delimited by backticks" describe — asserting the backtick pattern is present, the old double-quote pattern is absent, and the finding's `code` and `Next:` substring are byte-identical to the pre-change strings. Object identity strings (`declared check constraint "app.posts.x"`) are untouched — only expression *text*, never an identity, is backtick-delimited, since only expression text can begin with the colliding quote.

Gates: `pnpm check` (clean) · `pnpm check-types` (18/18) · `pnpm check:bans` (0 violations) · `check-expression.test.ts` full suite green (58/58 pre-existing tests unaffected).

Commit: 0c756544 fix(cli): delimit check expression texts with backticks not quotes.

