# Supabase preset

Read this when using `@hejbro/supabase` — roles, auth helpers, storage
buckets, or preset warnings.

## Wiring it in

Register the preset in `hejbro.config.ts`, not by hand in application
code:

```ts
presets: [supabasePreset],
```

See `examples/supabase/hejbro.config.ts`.

## Roles and auth helpers

`anonRole`, `authenticatedRole`, `serviceRole` are branded `Role` values
for `.to(...)` in `rls.policy(...)`/`grant(...)`. `authUsers` is an
existing-table reference — an FK target only, never declared/diffed.

`authUid()`/`authJwt()` and their cached forms `authUidCached()`/
`authJwtCached()` (#97) split by where they're used:

- **Inside an RLS `using`/`withCheck` clause, use `authUidCached()`/
  `authJwtCached()`.** They render `(select auth.uid())`/
  `(select auth.jwt())` — Postgres caches that as an initPlan evaluated
  once per statement, instead of re-evaluating a bare `auth.uid()` once
  per row. The `rls-uncached-auth-call` validator warns if a policy uses
  the plain form here instead.
- **Inside a column `default`/`check` expression, use the plain
  `authUid()`/`authJwt()`.** A scalar subquery is illegal there, so the
  cached forms don't work in this position.

See `examples/supabase/src/app.schema.ts` for `authUsers`/
`authUidCached()` in an RLS policy.

## Storage buckets

`storageBucket(name, { public?, fileSizeLimit?, allowedMimeTypes? })` is
hejbro's first row-data object kind: create/alter emit an idempotent
upsert into `storage.buckets`; drop emits no SQL (buckets hold user
files, so hejbro never auto-deletes one — the migration banner notes the
manual-deletion step instead).

## Preset warnings

These warnings render on stderr the same way any other
`warning[<code>]: <identity>` does (see `generate-verify-workflow.md`):

- `exposed-table-without-rls` — a table sits in a schema granted to
  `anon`/`authenticated` but declares no RLS, so every row is
  readable/writable through the API.
- `view-over-rls-without-security-invoker` — a view reads an
  RLS-protected table without `{ securityInvoker: true }`, so it runs
  with its owner's rights and bypasses row-level security.
- `rls-uncached-auth-call` (#97) — a policy's `using`/`with check`
  clause calls the plain `auth.uid()`/`auth.jwt()` instead of
  `authUidCached()`/`authJwtCached()`, so Postgres re-evaluates it once
  per row instead of once per statement. Not raised for a column
  `default`/`check` expression — the plain form is correct there.

`auth`, `storage`, and `realtime` are Supabase-managed — declaring one of
those schemas, or any object inside one, is a hard error, not a warning.

## Local round-trip

The Docker round-trip for a Supabase-preset example needs a seed file for
the Supabase-isms a generic Postgres lacks (roles, `storage.buckets`,
`auth.users`, and `auth.uid()` stubs) — see
`examples/supabase/seed/supabase.sql`, wired up as the `roundtrip` script
in `examples/supabase/package.json`.
