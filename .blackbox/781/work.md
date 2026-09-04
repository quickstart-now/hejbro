# Work — quickstart-now/hejbro#781

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — a generated column is compared by its generated axis and expression, never as a default

_2026-09-04T15:35Z_

A generated column is now compared by its own axis (whether each side is generated at all, `compareColumnGenerated` in `compare.ts`) and its own expression (`compareGeneratedColumn`, async, `expression.ts`) — never as a default. The bug: the catalog read's `attgenerated`-based text was joined into the same `catalogDefault` field a plain column's real default uses, so every declared generated column — having no `default` field at all, by construction — was read as "a default the declaration does not have", reported `check-object-differs: … has no default, but the database has one ("lower(email)")` on every run, in both comparison modes, permanently.

Fix, two layers: (1) the catalog read (task 1.2) splits `catalogDefault`/`catalogGenerated` into two fields via `case a.attgenerated when '' then … end` — exactly one is ever non-null, measured directly (a plain column's `attgenerated` is `''`, never `NULL`; a stored-generated column's is `'s'`). (2) `compare.ts`'s `compareColumn` (task 1.3) skips the default axis entirely whenever either side is generated (`compareColumnDefaultUnlessGenerated`), and runs a new `compareColumnGenerated` axis instead: declared-generated vs catalog-plain (or vice versa) is one `check-object-differs` naming which side is generated, never mentioning "default"; both-generated or both-plain produces nothing from this axis. The actual expression match/mismatch is `compareGeneratedColumn`'s (task 1.4), reusing the catalog row already read — no second catalog query — and wired into the run in task 1.6.

End-to-end (task 1.6, in-process fake session; task 1.7, Docker): a matching generated column produces no finding, in either comparison mode. Live-witness confirms the specific class the fixed six-step text normalization cannot close: a generated column's catalog text commonly carries a `::type` cast the server appends to a *column reference* (`(price * (qty)::numeric)`, when the generation expression mixes a numeric and an integer column) — normalization only strips a cast on a string literal, so that column is `check-not-compared` (never falsely `check-object-differs`) under an `explainUnavailable` preset, the same class as #782.

Gates: `pnpm check` (clean) · `pnpm check-types` (18/18) · `pnpm check:bans` (0 violations) · `check-compare.test.ts`/`check-expression.test.ts`/`check-command.test.ts` green · `pnpm --filter hejbro test:integration` (Docker, generated-column control/mutation/text-mode scenarios all pass).

Commits: 31d25575 fix(cli): compare a generated column by its own axis, not default; 093d1563 fix(cli): compare expression surfaces uniformly, probe generated columns; 10e7ff9c fix(cli): wire index and generated-column checks into the run.

