# Work — quickstart-now/hejbro#816

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — harden-function-locals 1.4: the rendered space is seeded with the argument names

_2026-09-05T10:17Z_

Change `harden-function-locals`, group 1, task 1.4 (commit 41b868f1 on branch `harden-function-locals`).

`createRecordingContext`/`recordOnce`/`recordBodyWithGuard` (`packages/core/src/plpgsql/body-context.ts`) gain an `argNames: ReadonlyArray<string>` parameter, seeding the body's `renderedNames` map with the function's argument SQL names, under kind `"argument"`, before the body callback ever runs. The seed only registers -- it does not re-check the names, since `resolveArgs` already ran the SQL-name/reserved/duplicate checks on them. Call sites: `dsl/define-function.ts` passes the resolved arguments' derived names, `dsl/define-trigger.ts` passes an empty array (trigger functions cannot declare arguments at all, measured in 1.1).

A `ctx.forEach` loop's record name or a `ctx.row`/`ctx.rowOrNull` read's derived scalar that now collides with a seeded argument name is refused with `duplicate-local-name`, naming the argument -- previously the loop or row variable silently won and the argument was unreachable for the rest of the body.

Measured: red first -- six input-table rows (`define-function.test.ts`): a loop shadowing an argument refused naming it; a row read carrying an argument's name but a free derived scalar accepted; a row read's derived scalar shadowing an argument refused naming it; a loop with a different name accepted; a loop named after an argument's *derived* SQL name (`userId` vs `user_id`) refused, proving the comparison is by derived name and not by key; a body with no arguments unaffected -- three failed / three passed. Green re-verified genuinely red by `git stash`-ing the implementation and re-running the six new tests before restoring it. Full `pnpm test` afterward: every package green, no collateral. Pure work ~10 min against an 8 min estimate (implementer-stamped).

