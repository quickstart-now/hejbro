# Examples

Real hejbro declarations that double as integration tests.

| Example | What it is |
|---|---|
| `postgres` | A generic team-workspace schema on plain Postgres — core only. Tables, CHECK constraints, partial and ordered indexes, a self-referencing FK, RLS, a trigger, a view, grants, with a committed four-step migration history and a local Docker round-trip. hejbro manages grants and RLS but never `CREATE ROLE`, so the round-trip seeds the two roles the schema grants to (`seed/roles.sql`) — a real deployment would already have them. |
| `supabase` | The Supabase preset (`presets: [supabasePreset]`) on a generic schema, seeded with sample rows — lands in PR D. |
| `cli-smoke` | A CLI end-to-end fixture: drives the built `hejbro` CLI (`init`/`generate`/`verify`) against a real schema in a tmp copy. |
| `preset-smoke` | An extension-interface fixture: a toy custom object kind and expression helper, proving `@hejbro/core`'s provider extension interface (spec §4.1) is generic. |

## Running the round-trip locally

Applies an example's committed migration chain to one database and a
single fresh migration to another, then diffs the two schema dumps —
proving the diff path and the create path produce an identical schema.
Requires Docker Desktop running locally; it does not run in CI (D49).

```bash
pnpm build
pnpm --filter example-postgres roundtrip
```

## How the four-step history is laid out

Each showcase example ships a designed, four-step declaration history
under `src/steps/` (`step-1.schema.ts` … `step-4.schema.ts`), each a
complete, self-contained declaration set. `src/app.schema.ts` is the live
entry point the CLI actually reads (always equal to the latest step);
`migrations/` and `hejbro.snapshot.json` are the committed output of
regenerating that history step by step with the built CLI.
`test/chain.test.ts` asserts two things: regenerating from the step
declarations in order reproduces the committed migration files
byte-for-byte, and the committed migrations' banner hashes form an
unbroken chain.
