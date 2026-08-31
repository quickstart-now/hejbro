# Tasks: add-polyrepo-sync

Groups run in order. Four files are **shared and unowned**: every group
that touches one may only add to it, never restructure it —
`packages/core/src/engine/generate.ts` (groups 1, 2),
`packages/core/src/index.ts` (groups 2, 4 — each adds only the exports
its own failing test demands, never exports for a later group),
`packages/cli/src/commands/generate.ts` (groups 4, 5) and
`packages/cli/src/commands/verify.ts` (group 4 only, listed because
group 3's per-command guard lands in it too). Every other file belongs
to exactly one group.

Estimates are agent execution minutes and are frozen per group at
`est_frozen`; overruns correct the next group's estimate, never this
one's. Three groups carry a re-freeze, and the reason is recorded rather
than absorbed: the delta gained requirements after the first freeze —
a manifest format higher than the reader knows is refused, the export
name of a declared function is a carried fact, and a foreign key whose
target is outside the manifest derives no relation. Group 3 moved
40m → 46m, group 5 moved 47m → 60m, and group 6's scope grew. A
re-freeze is only ever a spec change, never a task running long. Durations land per task in `openspec/task-times.csv`, measured
with `date -u` at task start and end.

## 1. Manifest emission in core — `est_frozen: 44m` — issue #579

Files: `packages/core/src/sql/manifest.ts` (new),
`packages/core/src/sql/migration-file.ts`,
`packages/core/src/engine/generate.ts` (shared, additive).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A migration can carry the schema it produced | Enabled emission appends the manifest statements | `core/test/manifest.test.ts > appends the bootstrap and insert after the change statements` |
| " | Disabled emission changes nothing | `core/test/manifest.test.ts > renders nothing when no payload is supplied` |
| The bootstrap is idempotent and precedes the insert | A chain applied from a later point succeeds | shape here: `core/test/manifest.test.ts > the bootstrap is idempotent and comes first`; server in group 8 |
| The payload is embedded so that it cannot be misread | A payload that could break out is refused | `core/test/manifest.test.ts > refuses a payload containing its own terminator` |
| A migration announces its manifest format in the banner | The line is readable by its prefix | `core/test/migration-file.test.ts > parses the manifest format line by its prefix` |
| " | A reader that does not know the line is unaffected | `core/test/migration-file.test.ts > an unknown banner line is ignored` |
| The emitted manifest statements are deterministic | Two runs separated in time are byte-identical | `core/test/manifest.test.ts > two renders with different clocks are byte-identical` |
| " | The statements name no clock and no file | `core/test/manifest.test.ts > the insert carries no timestamp and no file name` |

- [x] 1.1 `[design]` Settle the emitted SQL: table DDL (column set,
      identity ordering column, two format columns, payload column
      type), the insert's column list, and the banner prefix. Start
      from `core/test/manifest.test.ts > appends the bootstrap and
      insert after the change statements`. ~10m
- [x] 1.2 `[design]` Settle the payload's embedding form and its
      fail-closed guard. Start from
      `core/test/manifest.test.ts > refuses a payload containing its
      own terminator`. ~8m
- [x] 1.3 Render the bootstrap and insert; render nothing when no
      payload is supplied. Start from
      `core/test/manifest.test.ts > renders nothing when no payload
      is supplied`. ~8m
- [x] 1.4 Banner line and its prefix-only parser, beside the existing
      banner parsers. Start from
      `core/test/migration-file.test.ts > parses the manifest format
      line by its prefix`. ~8m
- [x] 1.5 Append the statements to the engine's statement array behind
      the option; goldens stay byte-identical with it absent. Start from
      `core/test/manifest.test.ts > the bootstrap is idempotent and
      comes first`. ~5m
- [x] 1.6 Determinism: the payload arrives pre-serialized and no value
      is derived from a clock or a file name. Start from
      `core/test/manifest.test.ts > two renders with different clocks
      are byte-identical`. ~5m

## 2. Migration authority as a type — `est_frozen: 42m` — issue #580

Files: `packages/core/src/dsl/table.ts`,
`packages/core/src/dsl/usage-table.ts` (new),
`packages/core/src/engine/generate.ts` (shared, additive),
`packages/core/src/index.ts`.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A synced module holds no migration authority | The module yields no authority-carrying declaration | `core/test/types/declared-table.test.ts > a usage table is not assignable to the migration input` |
| " | Generating from a synced module is refused | `core/test/engine/authority-refusal.test.ts > refuses a table that carries no migration authority` |
| " | Querying through the module is unaffected | `core/test/dsl/usage-table.test.ts > a usage table is an ordinary queryable table` |
| A synced module reproduces the consumer-visible type layer | Result keys match the declaring repository | `core/test/dsl/usage-table.test.ts > carries the TypeScript key of each column` |
| " | Element nullability / numeric mode / relation keys / enum values match | `core/test/dsl/usage-table.test.ts > carries mode, non-null elements, references and enum values` |

- [ ] 2.1 `[design]` Settle the brand's shape and the usage
      constructor's name and signature. Start from
      `core/test/types/declared-table.test.ts > the declaration
      constructor yields a branded table`. ~10m
- [ ] 2.2 Brand the declaration constructor without changing `Table`;
      pin the unchanged type with an equivalence assertion. Start from
      `core/test/types/declared-table.test.ts > Table is structurally
      unchanged`. ~8m
- [ ] 2.3 Narrow the migration input type to the branded form. Start
      from `core/test/types/declared-table.test.ts > a usage table is not
      assignable to the migration input`. ~6m
- [ ] 2.4 The usage constructor, carrying columns, numeric mode,
      non-null elements, TypeScript keys, export name and references.
      Start from `core/test/dsl/usage-table.test.ts > carries the
      TypeScript key of each column`. ~10m
- [ ] 2.5 `[design]` Settle the refusal's code name and place it at the
      single chokepoint. Start from
      `core/test/engine/authority-refusal.test.ts > refuses a table that
      carries no migration authority`. ~8m

## 3. Sidecar collection and configuration — `est_frozen: 46m` — issue #581

Files: `packages/cli/src/loader.ts`, `packages/cli/src/config.ts`,
`packages/cli/src/manifest-payload.ts` (new),
`packages/cli/src/config-required.ts` (new), and the guard call in
`packages/cli/src/commands/{verify,check,restore,history}.ts`.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A manifest row carries what a database cannot be asked | The carried choices survive the round trip | `cli/test/manifest-payload.test.ts > collects mode, non-null elements, TypeScript keys, table and function export names, and roles` |
| " | A synthesized function has no export name | `cli/test/manifest-payload.test.ts > carries no export name for a trigger-synthesized function` |
| " | The two format versions are separate | `cli/test/manifest-payload.test.ts > carries the manifest format and the snapshot format as separate values` |
| " | A brand is not among the carried facts | `cli/test/manifest-payload.test.ts > carries no brand information` |
| The emitted manifest statements are deterministic | Two runs separated in time are byte-identical | `cli/test/manifest-payload.test.ts > serializes with the snapshot's own stable serialization` |
| Configuration asks each command only for what it needs | A consuming repository needs none of them | `cli/test/config.test.ts > accepts a configuration without the migration-authoring fields` |
| " | A migration-authoring command names the field it needs | `cli/test/config-required.test.ts > names the missing field before any work` |

- [ ] 3.1 `[design]` Settle how the loader preserves each declaration's
      module export name. Start from
      `cli/test/loader.test.ts > preserves the module export name for
      each table`. ~8m
- [ ] 3.2 Collect the carried choices from the loaded declarations,
      including the export name of every exported table and function.
      Start from `cli/test/manifest-payload.test.ts > collects mode,
      non-null elements, TypeScript keys, table and function export
      names, and roles`. ~10m
- [ ] 3.6 A declaration that was never a module export carries no export
      name. Start from `cli/test/manifest-payload.test.ts > carries no
      export name for a trigger-synthesized function`. ~6m
- [ ] 3.3 Assemble the payload with both format versions and the
      snapshot's stable serialization. Start from
      `cli/test/manifest-payload.test.ts > serializes with the
      snapshot's own stable serialization`. ~8m
- [ ] 3.4 `[design]` Settle the relaxation scope, then make the three
      migration-authoring fields optional. Start from
      `cli/test/config.test.ts > accepts a configuration without the
      migration-authoring fields`. ~6m
- [ ] 3.5 Per-command coded refusal, raised before any work. Start from
      `cli/test/config-required.test.ts > names the missing field before
      any work`. ~8m

## 4. Emission wiring and monotonicity — `est_frozen: 36m` — issue #582

Files: `packages/cli/src/commands/generate.ts` (shared, additive),
`packages/cli/src/commands/verify.ts` (shared, additive),
`packages/cli/src/manifest-chain.ts` (new).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| Migrations are generated deterministically from declarations | Manifest statements ride with the difference | `cli/test/generate-manifest.test.ts > enabled emission appends the statements to the difference` |
| A migration can carry the schema it produced | Disabled emission changes nothing | `cli/test/generate-manifest.test.ts > disabled emission is byte-identical` |
| " | The embedded snapshot is the snapshot written beside it | `cli/test/generate-manifest.test.ts > the payload embeds the snapshot the run writes to disk` |
| " | No change records no manifest | `cli/test/generate-manifest.test.ts > no difference writes nothing` |
| A baseline migration carries no manifest row | A baseline carries no manifest statements | `cli/test/generate-manifest.test.ts > a baseline carries no manifest statements` |
| " | The baseline report says what is missing | `cli/test/generate-manifest.test.ts > the baseline report names the absent row` |
| A chain that carries manifests keeps carrying them | Generating with emission turned back off is refused | `cli/test/manifest-chain.test.ts > refuses generation when the chain carries manifests and emission is off` |
| " | A hand-edited chain is caught without a database | `cli/test/verify-manifest.test.ts > reports a chain that stopped carrying its manifests` |
| " | Enabling again succeeds | `cli/test/manifest-chain.test.ts > generation proceeds when emission is enabled` |

- [ ] 4.1 Configuration flag, and `generate` handing the payload to the
      renderer. Start from `cli/test/generate-manifest.test.ts > enabled
      emission appends the statements to the difference`. ~8m
- [ ] 4.2 Byte-identical output with emission off, and the payload's
      embedded snapshot pinned equal to the snapshot written beside it.
      Start from `cli/test/generate-manifest.test.ts > disabled emission
      is byte-identical`. ~7m
- [ ] 4.3 Baseline emits none, and reports the absent row. Start from
      `cli/test/generate-manifest.test.ts > a baseline carries no
      manifest statements`. ~7m
- [ ] 4.4 Monotonicity refusal in `generate`, reading the chain's last
      migration only. Start from `cli/test/manifest-chain.test.ts >
      refuses generation when the chain carries manifests and emission is
      off`. ~7m
- [ ] 4.5 Monotonicity detection in `verify`, over the files it already
      reads. Start from `cli/test/verify-manifest.test.ts > reports a
      chain that stopped carrying its manifests`. ~7m

## 5. The `sync` command — `est_frozen: 60m` — issue #583

Files: `packages/cli/src/commands/sync.ts` (new),
`packages/cli/src/sync/*` (new), `packages/cli/src/main.ts`,
`packages/cli/src/flags.ts`.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A repository obtains a schema it does not own from the database | A schema arrives as one module | `cli/test/sync-emit.test.ts > writes one module and nothing else` |
| " | No connection is a coded failure | `cli/test/sync-connection.test.ts > names what to supply when no connection is given` |
| The database driver is an optional dependency | A missing driver is explained for the syncing command too | `cli/test/sync-connection.test.ts > names the driver package to install` |
| A synced module reproduces the consumer-visible type layer | Result keys / element nullability / numeric mode / relation keys / enum values match | `cli/test/sync-emit.test.ts > reproduces the carried choices of the manifest` |
| Type brands do not cross the boundary | A branded column reads as its unbranded type | `cli/test/sync-emit.test.ts > emits no brand for a branded column` |
| Role names travel with the module and the consumer opts in | Supplied roles are accepted | `cli/test/sync-emit.test.ts > exports the manifest's role names in branded form` |
| A synced module carries its freshness stamp as a value | The stamp is importable | `cli/test/sync-emit.test.ts > exports the identity of its manifest row` |
| A synced module carries tables and enums, not functions | A synced module emits no function declarations | `cli/test/sync-emit.test.ts > emits tables and enums and no function declaration` |
| A reference to a table the schema does not own has no relation | A relation to an unmanaged target is absent | `cli/test/sync-emit.test.ts > derives no relation for a reference to an unmanaged table` |
| A synced module is a function of the row it was made from | Two syncs of the same row are byte-identical | `cli/test/sync-emit.test.ts > two syncs of the same row write byte-identical modules` |
| " | The module names no clock | `cli/test/sync-emit.test.ts > the module carries no timestamp` |
| Each way a manifest can fail a reader is named separately | A database with no manifest table says so | `cli/test/sync-states.test.ts > distinguishes an absent manifest table` |
| " | An empty manifest table says so | `cli/test/sync-states.test.ts > distinguishes an empty manifest table` |
| " | A stamp with no matching row says so | `cli/test/sync-states.test.ts > distinguishes a stamp with no matching row` |
| " | The five codes are five | `cli/test/sync-states.test.ts > reports five distinct codes for the five situations` |
| A manifest format higher than the reader knows is refused | A higher manifest format is refused | `cli/test/sync-states.test.ts > refuses a higher manifest format without parsing the payload` |
| " | A lower manifest format is read | `cli/test/sync-states.test.ts > reads a lower manifest format and treats its absent facts as absent` |
| " | Format skew is not reported as staleness | `cli/test/sync-states.test.ts > format skew never advises re-syncing` |
| The command can check without writing | Checking leaves the module untouched | `cli/test/sync-states.test.ts > check mode writes nothing and exits non-zero` |
| The schema filter is reserved, not silently ignored | The reserved filter is refused | `cli/test/sync-states.test.ts > refuses the reserved schema filter` |

- [ ] 5.1 `[design]` Settle the module's file name, header, and the
      names of its exported stamp and role list. Start from
      `cli/test/sync-emit.test.ts > writes one module and nothing else`.
      ~8m
- [ ] 5.2 Register the command, its value-taking flags and its help
      row. Start from `cli/test/help.test.ts > lists the sync command`.
      ~5m
- [ ] 5.3 Connection entry, dynamic driver import, and both coded
      refusals. Start from `cli/test/sync-connection.test.ts > names what
      to supply when no connection is given`. ~8m
- [ ] 5.4 Read the newest row and emit usage-constructor calls for its
      tables and enums — and for nothing else. Start from
      `cli/test/sync-emit.test.ts > reproduces the carried choices of the
      manifest`, then `> emits tables and enums and no function
      declaration`. ~10m
- [ ] 5.5 Export the role list and the stamp, and pin the module as a
      function of its row (two syncs byte-identical, no clock value in
      the header). Start from `cli/test/sync-emit.test.ts > two syncs of
      the same row write byte-identical modules`. ~8m
- [ ] 5.6 `[design]` Settle the five codes and their remedies, then
      raise the four this command owns. Start from
      `cli/test/sync-states.test.ts > distinguishes an absent manifest
      table`. ~8m
- [ ] 5.7 Refuse an unknown manifest format in both directions, before
      the payload is parsed. Start from `cli/test/sync-states.test.ts >
      refuses a higher manifest format without parsing the payload`. ~7m
- [ ] 5.8 `[design]` Settle how a foreign key whose target is outside
      the manifest is emitted, then derive no relation for such an edge
      while keeping the column. Start from `cli/test/sync-emit.test.ts >
      derives no relation for a reference to an unmanaged table`. ~6m

## 6. Freshness at startup — `est_frozen: 26m` — issue #584

Files: `packages/cli/src/assert-schema.ts`,
`packages/cli/src/manifest-read.ts` (new).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| Freshness is judged by comparison, never by hashing at run time | A current module passes | `cli/test/assert-schema-manifest.test.ts > passes when the stamp matches the newest row` |
| " | A stale module fails with a counted distance | `cli/test/assert-schema-manifest.test.ts > fails naming both rows and the distance` |
| " | The failure claims no cause | `cli/test/assert-schema-manifest.test.ts > the failure text asserts no cause` |
| The database owns the order of manifest rows | Distance is counted, not inferred from time | `cli/test/assert-schema-manifest.test.ts > counts rows rather than comparing timestamps` |
| Each way a manifest can fail a reader is named separately | A database with no manifest table / an empty table / an unmatched stamp / an unknown format | `cli/test/assert-schema-manifest.test.ts > distinguishes the five situations` |
| A manifest format higher than the reader knows is refused | Format skew is not reported as staleness | `cli/test/assert-schema-manifest.test.ts > format skew is not staleness` |
| " (import discipline) | — | `cli/test/assert-schema-imports.test.ts` stays green |

- [ ] 6.1 Read the stamp from the handle's schema and the row through
      the handle's driver. Start from
      `cli/test/assert-schema-manifest.test.ts > passes when the stamp
      matches the newest row`. ~8m
- [ ] 6.2 `[design]` Settle the failure text's upper bound, then count
      the distance by rows rather than by time. Start from
      `cli/test/assert-schema-manifest.test.ts > fails naming both rows
      and the distance`. ~8m
- [ ] 6.3 The five situations, translated into this surface's own code
      vocabulary, including format skew as its own outcome. Start from
      `cli/test/assert-schema-manifest.test.ts > distinguishes the five
      situations`. ~10m

## 7. Documentation and release plumbing — `est_frozen: 24m` — issue #585

Files: `docs/guide/polyrepo.md` (new),
`skills/hejbro/references/polyrepo-sync.md` (new),
`skills/hejbro/SKILL.md`, `.changeset/*.md` (new),
`scripts/pack-install-smoke.sh`.

No unit test covers prose. Each task names the gate that fails without
it; that gate is the task's red signal.

- [ ] 7.1 The guide: what crosses the boundary, what does not, the size
      property in numbers, and the CI drift-check workflow template.
      Gate: `pnpm check:diagnostic-xref` (every code the guide cites
      must exist). ~10m
- [ ] 7.2 The skill reference and its row in the References table.
      Gate: the skill documents the public surface this change adds —
      absent, the surface ships undocumented. ~8m
- [ ] 7.3 One `minor` changeset, and a database-free `sync`
      reachability assertion in the pack-install smoke. Gate:
      `changeset status`, then `scripts/pack-install-smoke.sh`
      assertion 3. ~6m

## 8. The two-repository witness — `est_frozen: 25m` — issue #586

Files: `packages/cli/test/integration/polyrepo.integration.test.ts`
(new) and its fixture helpers in the same directory. **No new package
and no new vitest configuration**: `packages/cli` already excludes
`test/integration/**` from the default run by pattern and already ships
a separate integration configuration alongside two live suites, so this
witness joins an existing arrangement instead of creating one. Both
"repositories" are temporary directories the test builds and drives
through the built CLI.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| The bootstrap is idempotent and precedes the insert | A chain applied from its beginning succeeds | `cli/test/integration/polyrepo.integration.test.ts > applies a chain and finds one row per migration` |
| " | A chain applied from a later point succeeds | `cli/test/integration/polyrepo.integration.test.ts > applies a chain from a later migration against an existing schema` |
| A repository obtains a schema it does not own from the database | A schema arrives as one module | `cli/test/integration/polyrepo.integration.test.ts > syncs a module from the applied chain` |
| A synced module holds no migration authority | Generating from a synced module is refused | `cli/test/integration/polyrepo.integration.test.ts > refuses to generate from the synced module` |
| The database owns the order of manifest rows | Distance is counted, not inferred from time | `cli/test/integration/polyrepo.integration.test.ts > counts the distance across rows applied in the same second` |
| Freshness is judged by comparison, never by hashing at run time | A stale module fails with a counted distance | `cli/test/integration/polyrepo.integration.test.ts > fails with a counted distance after one more migration` |

- [ ] 8.1 `[design]` Settle the fixture shape: how each temporary
      repository is built, how its dependencies are linked, and how the
      container is started and stopped. Start from
      `cli/test/integration/polyrepo.integration.test.ts > applies a
      chain and finds one row per migration`. ~10m
- [ ] 8.2 Sync from the applied chain, type-check the consumer against
      the module, and refuse generation from it. Start from
      `cli/test/integration/polyrepo.integration.test.ts > refuses to
      generate from the synced module`. ~8m
- [ ] 8.3 Apply one further migration and fail with the counted
      distance, including two rows applied within the same second. Start
      from `cli/test/integration/polyrepo.integration.test.ts > counts
      the distance across rows applied in the same second`. ~7m
