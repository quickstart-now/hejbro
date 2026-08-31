---
"@hejbro/nile": minor
---

Nile provider preset (#301), the seventh published package:
`nileDriver(driver)` decorates any `@hejbro/query` driver, declaring
`roleLessPlatform` and `contextRequired` and contributing a tenant
context rendering (`SET LOCAL`, never `set_config`, the tenant setting
first and the user setting after it when named). `asTenant(tenantId,
userId?)` builds the role-less context; both values are refused before
any statement is sent unless they are canonical UUIDs, and the rendered
value is always literal-quoted. Validators refuse, at generate time,
what the platform rejects — RLS/policies, functions, triggers, grants,
`serial`/`smallserial`/`bigserial` in a tenant-aware table, and a
tenant-aware table's primary key that excludes `tenant_id` — each error
naming its own evidence grade (the platform's published limitations, or
this preset's own measurement against Nile's official testing
container).
