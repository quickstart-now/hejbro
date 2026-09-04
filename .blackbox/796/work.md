# Work — quickstart-now/hejbro#796

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — status refuses an occupied ledger name with apply-ledger-occupied

_2026-09-04T13:31Z_

`runStatus` now calls `probeLedgerIdentity` and `assertLedgerNotOccupied("hejbro status")` before `readLedger`, rendering a refusal through its existing `preconditionResult` path (exit 1) instead of letting the database's own read fail raw.

Before the fix, measured against a view squatting on `hejbro.migration_ledger`, `readLedger`'s own `select "filename", "origin" from ...` failed with Postgres code 42703 (`column "filename" does not exist` / `column "origin" does not exist`), which `status` had no coded handling for and let escape as a raw stack.

Unit tests (`status-command.test.ts`): a new case answers the probe with a view row and asserts exit 1, `error[apply-ledger-occupied]`, a `Next:` line, and that `select "filename"` is never sent; a regression case pins today's byte-exact report when the probe answers the real ledger.

Live witness (`apply-reset.integration.test.ts`, shared with #783/#797): against a real container, both an unrelated table and a view at the ledger's name were tested through `status` — exit 1 with `error[apply-ledger-occupied]`, and stderr asserted to contain neither `column "origin"` nor a stack frame line (`    at `).

Commit: fe6118fa.

