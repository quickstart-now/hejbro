# Proposal: fix-cli-init-and-vendoring (#687, #697)

## Why

Three defects sit on shipped surfaces, each one silent where it fails:

- `hejbro init` hard-codes `migrations/` and `hejbro.snapshot.json` and never
  reads the configuration it is scaffolding beside. In a repository whose
  `hejbro.config.ts` points `migrationsDir` at `db/migrations`, `init` creates
  a second, unused directory and reports a path no other command will read —
  and its "repair the missing pieces" use, which the snapshot-missing
  diagnostic tells users to run, repairs the wrong place (#687).
- The contract emitter renders every metadata key as a quoted string key. In an
  object literal `"__proto__": { … }` sets the prototype instead of creating a
  property, so a column (or table, or function) named `__proto__` is emitted,
  compiles, and then does not exist at runtime: the client enumerates
  `Object.keys` and the column is simply gone from every query it builds
  (#697, R2-N2).
- The `db.fn` runtime guard counts argument keys and never looks at their
  names. A caller that TypeScript does not check — plain JS, an `any`, a
  `JSON.parse`d object — passing `{ user_id: … }` where `{ userId: … }` is
  declared passes the count check and sends `null` for the declared argument
  (#697, R2-N1).

## What Changes

- `init` becomes a command that reads its configuration: with a
  `hejbro.config.ts` present it honours that file's `migrationsDir` and
  `snapshotPath`, creates only the artifacts that are absent, and reports the
  path it actually acted on. A configuration that cannot be read stops the run
  before anything is created, with the coded failure every other command
  already raises for it. With no configuration file, today's behaviour stands.
- The contract emitter renders a metadata key whose literal form would carry
  special meaning as a computed key, so every table, function and column key
  the export carried is an own property of `contractMetadata`.
- The `db.fn` guard checks the key set, not only its size: an argument the
  declaration does not name is refused before any SQL is sent, naming the
  unknown key and the declared ones.
- One `patch` changeset (`hejbro`); one sentence in
  `skills/hejbro/references/generate-verify-workflow.md` for `init`.

## Capabilities

- `cli-commands` — ADDED: `init` scaffolds what is missing, where the
  configuration says.
- `schema-vendoring` — ADDED: an emitted key survives as data, whatever it is
  named; MODIFIED: the typed function surface's runtime guard checks the key
  set, not only the key count.

## Impact

- `packages/cli/src/commands/init.ts` (config-aware scaffolding; `runInit`
  becomes async and gains the diagnostic-carrying result shape the other
  commands use), `packages/cli/test/init.test.ts`.
- `packages/cli/src/contract/emit.ts` (metadata key rendering),
  `packages/cli/test/contract-emit.test.ts`.
- `packages/query/src/db/fn.ts` (unknown-key refusal),
  `packages/query/test/client/functions.test.ts`.
- `skills/hejbro/references/generate-verify-workflow.md`;
  `.changeset/fix-cli-init-and-vendoring.md` (`patch`).
- Refs #687, #697.
