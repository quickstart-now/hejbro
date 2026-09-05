# Work — quickstart-now/hejbro#899

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — catchUpStandingGrants shared by tableKind and viewKind

_2026-09-05T09:01Z_

Measured by the examples/postgres step-10 round trip: before the fix the fresh dump carried `GRANT SELECT ON TABLE app.task_projects TO app_auditor` and the chain did not; after it, `0010_add_task_projects.sql` re-issues the three standing grants after `create view` and the round trip is green (68-line dumps identical). view-kind.test.ts pins the three rules (re-issue, no duplicate in the same diff, other schema ignored).

