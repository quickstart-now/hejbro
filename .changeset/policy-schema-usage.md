---
"@hejbro/core": minor
---

New warning, `rls-unreachable-schema` (#203): fires when a policy's
schema grants `usage` to none of the roles it targets. Postgres checks
schema `usage` before RLS is even consulted, so such a policy can
never run at all — the failure is `permission denied for schema`, not
an RLS denial.
