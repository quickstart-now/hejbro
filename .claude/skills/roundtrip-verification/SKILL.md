---
name: roundtrip-verification
description: Run and interpret the local Docker round-trip for examples. Use when changing anything under examples/ — declarations, steps, migration chains, seeds — before claiming the change done.
paths:
  - "examples/**"
---

# Round-trip verification

The round-trip applies an example's committed migration chain to one
database and a single fresh migration to another, then diffs the two
schema dumps — proving the diff path and the create path produce an
identical schema (D49). It runs locally on Docker, never in CI. The full
rationale, including why the separate real-image check exists (D69),
lives in `examples/README.md` — read it for anything this runbook
doesn't answer.

## Run

```bash
# Docker runtime must be up (Docker Desktop, or colima: `colima start`)
docker info >/dev/null || echo "start your Docker runtime first"

pnpm build            # stale dist? use: pnpm build --force
pnpm --filter example-postgres roundtrip
pnpm --filter example-supabase roundtrip
pnpm verify:supabase-image   # supabase preset vs the real supabase/postgres image (D69)
```

Pass = each script exits 0: the two `pg_dump` outputs are identical
(the script asserts identity and shows the diff on mismatch), and for
`example-supabase` the storage bucket row matches.

## Interpreting failures (all found the hard way)

- **Missing role errors**: roles are cluster-level objects hejbro never
  creates. Each example seeds its granted roles (`seed/roles.sql`,
  `seed/supabase.sql`); a new grant target needs a seed entry.
- **ACL (grant) lines differ between the two dumps**: `grant … on all
  tables in schema` is one-shot — a table added later in the chain has
  no ACL on the chain path. Pair schema-wide grants with
  `defaultTablePrivileges` in the declarations.
- **Drop-order errors** (`cannot drop … because other objects depend on
  it`): dependent-object drops must precede table alters — the engine's
  predrop stage owns this; a failure here is an engine bug, not an
  example bug. File it against core.
- **A pass you didn't expect**: the harness guards against vacuous
  passes (empty dumps compared equal once). If a run looks too green,
  check the dump line counts are non-trivial.
- **Round-trip green but the platform rejects the schema**: the
  round-trip is a symmetric comparison — an error both paths share is
  invisible to it (e.g. a role lacking `usage` on the schema; the
  `serial` gap). That class only surfaces in
  `verify:supabase-image` or as a core validator — do not try to make
  the round-trip catch it.
- **`storage.buckets` missing under `verify:supabase-image`**: expected —
  the bare `supabase/postgres` image has no Storage API migrations; the
  storage kind is documented as outside real-image verification (D69).
