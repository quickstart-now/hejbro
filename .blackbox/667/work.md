# Work — quickstart-now/hejbro#667

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — In-process observer for the existing-table read

_2026-09-05T08:36Z_

A recording-driver contract with `auth.users` marked existing and a managed `app.posts` referencing it: the client's select renders `select "id", "email" from "auth"."users"`, rows type as the declared columns; the Docker witness is now a confirmation.

