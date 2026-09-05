# Tasks: add-vendored-related

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/cli/src/contract/tables.ts`, the contract
emit tests and goldens under `packages/cli/test/` (1.1); `packages/query/
src/client/name-keyed-db.ts` and its tests (1.2); `packages/cli/test/
two-repo.integration.test.ts`, `skills/hejbro/references/polyrepo.md`,
`skills/hejbro/references/query-layer.md`, one `.changeset/*.md` (1.3).
If a task appears to need any other file, that goes back to the planner,
not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3.

## 1. `.related()` on the vendored client

- [ ] 1.1 (~9m) **[design]** The contract emits `Relations`. Settles the
      rendered shape (`readonly Relations: { readonly owner: { readonly
      target: "users"; readonly mode: "one" } }`, `{}` when empty) and
      key order (forward keys in column order, then reverse keys in
      `Tables` order). Red: `packages/cli/test/contract-emit.test.ts`, an
      input table over {forward single-column FK with an `Id` key,
      forward FK whose key does not end in `Id` (no relation), composite
      FK (none), reverse FK from a managed table, reverse FK from an
      existing table, FK onto an uncarried table (none), forward/reverse
      key collision (omitted), relation/column collision (omitted)}
      asserting the emitted text; goldens refreshed. Files: `tables.ts`,
      tests, goldens.

- [ ] 1.2 (~10m) `.related()` on the name-keyed chain. Red: the
      name-keyed type test — over a `Database` fixture with `Relations`,
      `.related({ owner: true })` types the nested field `Row | null`,
      `.related({ comments: true })` types it `ReadonlyArray<Row>`, a key
      outside the map fails (`@ts-expect-error`), a table with `Relations
      {}` and a `Database` without `Relations` have no `.related`
      member; the runtime test — `.related(spec).compile()` equals the
      internal handle's `select(table).related(spec).compile()` for the
      same spec, the four stages compose after it, and `client.as(ctx)`
      scopes the nested read (the recorded `set_config` precedes the
      statement). Files: `name-keyed-db.ts`, tests.

- [ ] 1.3 (~8m) The witness, the reference, the changeset. Red:
      `two-repo.integration.test.ts` gains "3.3: the consumer joins the
      platform-owned table" — a managed `posts` referencing the declared
      existing `auth.users` is vendored, rows are inserted on the real
      server, and `client.posts.select().related({ author: true })`
      resolves the parent row typed as `auth.users`'s declared columns;
      `polyrepo.md` documents `.related()` on the vendored client and the
      re-vendor note (design Q2); `query-layer.md`'s `related()` section
      cross-references it; `pnpm changeset` → `minor`. Files: the test,
      the two references, `.changeset/*.md`.
