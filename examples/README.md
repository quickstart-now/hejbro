# Examples

Real hejbro declarations that double as integration tests.

| Example | What it is |
|---|---|
| `postgres` | A generic team-workspace schema on plain Postgres — core only. Tables, CHECK constraints, partial and ordered indexes, a self-referencing FK, RLS, a trigger, a view, grants, with a committed four-step migration history and a local Docker round-trip. hejbro manages grants and RLS but never `CREATE ROLE`, so the round-trip seeds the two roles the schema grants to (`seed/roles.sql`) — a real deployment would already have them. |
| `supabase` | The Supabase preset (`presets: [supabasePreset]`) on a generic schema, seeded with sample rows. Storage bucket, `authUsers` FK, `authUid()` RLS, the exposed-table and view-security-invoker warnings, a committed four-step migration history, a local Docker round-trip, and a second local-Docker script (`verify:supabase-image`, D69) that checks the preset against a real `supabase/postgres` image. |
| `cli-smoke` | A CLI end-to-end fixture: drives the built `hejbro` CLI (`init`/`generate`/`verify`) against a real schema in a tmp copy. |
| `preset-smoke` | An extension-interface fixture: a toy custom object kind and expression helper, proving `@hejbro/core`'s provider extension interface (spec §4.1) is generic. |
| `brownfield` | A hand-written, ORM-shaped dump of a database hejbro did not create (#714) — CamelCase schema/table/index/check names beside snake_case siblings, Postgres-default `_fkey` names, a shared check-constraint name, a leading-underscore column, a cross-schema enum reference against the grain of a foreign key, a three-schema `users` foreign-key chain, a foreign key and a UNIQUE constraint on an omitted table, and a quoted identifier containing `*/` — every shape a D106 round on `add-catalog-inference` had to invent its own throwaway database to find. `test:integration` runs `import` → `baseline` → `check` against it; local-only (D49), never in CI, same as every other example's Docker-gated suite below. |

## Running the brownfield witness locally

Unlike the other examples, `brownfield` has no declaration source of its
own to round-trip -- `seed/brownfield.sql` is the fixture, applied fresh
into a container the suite manages itself. Requires Docker; it does not
run in CI (D49). Its `package.json` also carries no plain `test` script
(every other example's own does): this package has no non-integration
tests to run under `pnpm test`, so `test:integration` is the only entry
point.

```bash
pnpm build
pnpm --filter example-brownfield test:integration
```

## Running the round-trip locally

Applies an example's committed migration chain to one database and a
single fresh migration to another, then diffs the two schema dumps —
proving the diff path and the create path produce an identical schema.
Requires Docker Desktop running locally; it does not run in CI (D49).

```bash
pnpm build
pnpm --filter example-postgres roundtrip
pnpm --filter example-supabase roundtrip
```

## Why the round-trip can't replace verifying against the real image (D69)

`scripts/verify-supabase-image.sh` is a second, separate local-Docker
script, only for `examples/supabase`. It answers a different question
than the round-trip above, and neither one can stand in for the other:

| | `scripts/roundtrip.sh` | `scripts/verify-supabase-image.sh` |
|---|---|---|
| Runs on | `postgres:17-alpine` | `supabase/postgres:17.6.1.165` |
| Asks | is the generator **deterministic** — does a chain-built schema equal a freshly built one? | does the preset **match the platform it targets**? |
| Compares | our output against our output | our assumptions against the real thing |

The round-trip cannot answer the second question by construction: it is
a symmetric comparison (chain-built vs. freshly-built, both produced by
the same generator, both checked against a `seed/supabase.sql` stub we
wrote ourselves), so an error both sides make is invisible — the same
blind spot that let `serial` survive two phases. `verify-supabase-image.sh`
instead applies the *committed* migration chain directly to a real,
pinned `supabase/postgres` image and checks it there, with zero stub
objects of its own.

Run it locally (also requires Docker; also not run in CI):

```bash
pnpm build
pnpm verify:supabase-image
```

It found a real defect on its first run (fixed in the same PR that added
it, #113/#97's track): `examples/supabase` never granted `USAGE` on
schema `app` to `anon`/`authenticated` — the round-trip couldn't see this
because it never queries as a restricted role, only diffs schema DDL.

**What it does not cover.** The storage kind (`storage.buckets`) is
explicitly out of scope for this script today: `storage.buckets` is
created by Supabase's separate Storage API service's own migrations, not
by the `supabase/postgres` database image this script runs against
(measured: a freshly started container's `storage` schema exists but
contains zero tables). Verifying it here would mean creating
`storage.buckets` ourselves first and comparing our assumption about its
shape against a stub we just wrote — the exact circularity this script
exists to avoid. A general check that would have caught the schema-usage
gap above without needing a real image at all — warn when a policy's
target role has no `USAGE` on the table's schema — is tracked separately
(#203) as a core validator, not part of this script.

**Also out of scope for hejbro itself, not just this script**: even with
every migration applied correctly, a role can only reach a schema through
Supabase's REST API once that schema is added to the project's exposed
schemas in the dashboard — a platform setting, not something any
migration can express.

## How the four-step history is laid out

Each showcase example ships a designed, four-step declaration history
under `src/steps/` (`step-1.schema.ts` … `step-4.schema.ts`), each a
complete, self-contained declaration set. `src/app.schema.ts` is the live
entry point the CLI actually reads (always equal to the latest step);
`migrations/` and `hejbro.snapshot.json` are the committed output of
regenerating that history step by step with the built CLI.
`test/chain.test.ts` asserts two things, read-only and in-process: regenerating
from the step declarations in order reproduces the committed migration files
exactly (modulo the trailing newline the CLI adds when writing the file), and
the committed migrations' banner hashes form an unbroken chain.

**Regenerating on disk** — after a format change, or after adding a step —
runs the same story through the *built* CLI instead, driving `init`/`generate`
once per step and writing the real files:

```bash
pnpm build
pnpm regen:examples
```

`scripts/regen-examples.sh` enumerates `src/steps/step-*.schema.ts` from the
directory rather than assuming a count, so a new step (a chain grows in
`phase8-constraint-names` and `phase8-grant-sync`) is picked up automatically.
An ambiguous drop+add pair (e.g. step 4's column rename in both examples here)
is resolved the same way a human would: by rerunning with the exact
`--confirm-drop` command the CLI's own diagnostic suggests, never a
hard-coded table/column name.
