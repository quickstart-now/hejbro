# Work — quickstart-now/hejbro#663

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Scoped fn observer asserts the context SQL

_2026-09-05T08:36Z_

The `.as(context).fn` test now reads the recorded transaction: `set local role "app_reader"` followed by the very statement the unscoped call sends, same params.

