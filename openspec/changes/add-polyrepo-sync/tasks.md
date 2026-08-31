# Tasks: add-polyrepo-sync

Groups run in order. Five files are **shared and unowned**: every group
that touches one may only add to it, never restructure it —
`packages/core/src/engine/generate.ts` (groups 1, 2),
`packages/core/src/index.ts` (groups 2, 4 — each adds only the exports
its own failing test demands, never exports for a later group),
`packages/cli/src/commands/generate.ts` (groups 3, 4, 5 — group 3 adds
only a guard call), `packages/cli/src/snapshot-file.ts` (groups 3, 4)
and
`packages/cli/src/commands/verify.ts` (group 4 only, listed because
group 3's per-command guard lands in it too). Every other file belongs
to exactly one group.

A row whose red test is a **type** assertion is red only under
`check-types`; the test runner executes `expectTypeOf` as a no-op and
reports it passing however false it is. Where such a row crosses a
package boundary, the reading package resolves the other through its
built output, so a build has to precede the check.

Two questions are asked of every row of every three-column table below,
because this change has already been caught by both. **Does the test's
subject match the scenario's?** — a scenario about what an *existing*
reader does is not pinned by a test about what the *new* one does.
**Which universal is this new scenario a member of?** — a sentence that
counts has to move whenever a requirement is added beside it.

Estimates are agent execution minutes and are frozen per group at
`est_frozen`; overruns correct the next group's estimate, never this
one's. Three groups carry a re-freeze, and the reason is recorded rather
than absorbed: the delta gained requirements after the first freeze —
a manifest format higher than the reader knows is refused, the export
name of a declared function is a carried fact, a foreign key whose
target is outside the manifest derives no relation, and an embedded
snapshot format the reader refuses carries this reader's own remedy.
Group 3 moved 40m → 46m, group 5 moved 47m → 69m, and group 6 moved
26m → 28m. Group 5's last step (63m → 69m) is the one re-freeze that is
not a spec change: a requirement's second half turned out to be
unreachable from the group that owns the first, and covering it needed a
task rather than a sentence. A re-freeze is never a task running long. Durations land per task in `openspec/task-times.csv`, measured
with `date -u` at task start and end.

## 1. Manifest emission in core — `est_frozen: 47m` — issue #579

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
| " (parser hardening) | The line is readable by its prefix | `core/test/migration-file.test.ts > a non-integer banner manifest format is rejected, not coerced` |

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
- [x] 1.7 The banner parser rejects a format that is not an integer
      rather than coercing it, so nothing downstream ever compares
      against a value that is not a number. Start from
      `core/test/migration-file.test.ts > a non-integer banner manifest
      format is rejected, not coerced`. ~3m

## 2. Migration authority as a type — `est_frozen: 42m` — issue #580

Files: `packages/core/src/dsl/table.ts`,
`packages/core/src/dsl/usage-table.ts` (new),
`packages/core/src/dsl/existing-table.ts` (return type only — it is
authored here, so it carries the brand and its existing runtime refusal
keeps working unchanged),
`packages/core/src/engine/generate.ts` (shared, additive),
`packages/core/src/index.ts`,
`packages/query/test/types/usage-table.test.ts` (new — a test only; the
promise that a usage table queries like any other is observable in that
package and nowhere else, and `packages/query/src` stays untouched).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A synced module holds no migration authority | The module yields no authority-carrying declaration | `core/test/types/declared-table.test.ts > a usage table is not assignable to the migration input` |
| " | Generating from a synced module is refused | `core/test/engine/authority-refusal.test.ts > refuses a table that carries no migration authority` |
| " | The refusal states what it observed | `core/test/engine/authority-refusal.test.ts > the refusal names the absent authority, not a provenance` |
| " | A table with no origin is refused without one | `core/test/engine/authority-refusal.test.ts > a hand-written usage table is refused with no origin in the message` |
| " | Querying through the module is unaffected — structural half | `core/test/dsl/usage-table.test.ts > a usage table is an ordinary queryable table` |
| " | " — query half (core cannot import the query package) | `query/test/types/usage-table.test.ts > a usage table keeps its relation keys and write inputs` |
| " (regression pin, unchanged test) | — the pre-existing runtime refusal still reaches its input | `core/test/existing-table.test.ts > hard-errors when passed as a declaration` |
| " (public surface) | The general table type no longer satisfies the input | `core/test/types/declared-table.test.ts > the published input type takes a declared table and refuses a bare one` |
| A synced module reproduces the consumer-visible type layer | Result keys match the declaring repository | `core/test/dsl/usage-table.test.ts > carries the TypeScript key of each column` |
| " | Element nullability / numeric mode / relation keys / enum values match | `core/test/dsl/usage-table.test.ts > carries mode, non-null elements, references and enum values` |

- [x] 2.1 `[design]` The brand's shape and the usage constructor's name.
      *Settled:* a type parameter carried inside the `tableMeta` member,
      **not** an intersection — measured, a required phantom key changes
      what `table()` returns and breaks core's own type-checks and the
      query package's type tests, because the extra key reaches every
      mapped type that reads `keyof Table`. The parameter's default is
      the **whole union**, so every existing `Table<X>` still accepts
      both kinds and no other package moves; the narrowing happens in
      one place, `HejbroInput`. Bare `Table` is a type users write in
      their own annotations, so a default of `"declared"` would make a
      consumer's own helpers reject the very tables they synced — and
      that failure would surface in their code, not in ours. `DeclaredTable<TColumns>` is the named
      alias for the declared side — but only where it is read by a few
      call sites. **`table()`'s own return type must be written inline
      as `Table<TColumns, "declared">`, never as the alias**: measured
      by bisection, substituting the structurally identical alias in the
      return type of a function the whole suite calls breaks core's
      type-check in 48 places and nine unrelated test files. The reason
      was not identified; the reproduction was. `existingTable()` takes
      the inline form for the same reason. Plus
      `authority: "declared" | "usage"` on the declaration — a union
      rather than a boolean so a third constructor does not break it.
      The brand says the value was **authored in this repository**, not
      that the table is migratable: `existingTable` is authored here too
      and carries it, and its own refusal stays the separate runtime
      rule it already is. The value avoids `"synced"` because a
      hand-called `syncedTable()` would make that word false while
      `"usage"` stays true. The word `origin` is reserved for the
      delta's other meaning, the manifest row a module carries.
      Constructor named `syncedTable`. Start from
      `core/test/types/declared-table.test.ts > the declaration
      constructor yields a branded table`. ~10m
- [x] 2.2 Brand the declaration constructor without changing `Table`;
      pin the unchanged type with an equivalence assertion. Start from
      `core/test/types/declared-table.test.ts > Table is structurally
      unchanged`. ~8m
- [x] 2.3 Narrow the migration input type to the branded form. Start
      from `core/test/types/declared-table.test.ts > a usage table is not
      assignable to the migration input`. ~6m
- [x] 2.4 The usage constructor, carrying columns, numeric mode,
      non-null elements, TypeScript keys, export name and references.
      Start from `core/test/dsl/usage-table.test.ts > carries the
      TypeScript key of each column`. ~10m
- [x] 2.5 `[design]` The refusal's code name and its single chokepoint.
      *Settled:* `synced-table-declared`, raised where `existingTable`
      is already refused; refuse on `authority === "usage"` and treat an
      absent value as declared — a declaration built by hand rather than
      through a constructor was still authored here, and refusing it
      would break callers this change never meant to touch; the type
      layer is what makes that safe, since the usage constructor always
      writes the value. Keyed on the brand, never on provenance; the message states the observation (no migration
      authority) and offers `sync` output only as an example. This group
      builds **no carrier** for an origin and therefore never names one —
      the `kind` field says which constructor ran, not where the value
      came from, and quoting it as provenance is the error this seal
      exists to prevent. The carrier is settled in group 5. The runtime
      refusal keeps its **own** failing test, separate from the
      type-level one: once the input type is narrowed, this guard is
      reachable only from a caller the types never saw — a JavaScript
      project, or a config loaded without compilation — and a single
      test covering both layers would let either one rot unnoticed.
      Start from
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
| " | A re-added column keeps its own facts | `cli/test/manifest-payload.test.ts > keys every column fact by the column's SQL name, not its position` |
| " | The two format versions are separate — *owned by group 1: both are columns the renderer writes, not payload fields* | `core/test/manifest.test.ts > renders the exact bootstrap and insert text` |
| " | A brand is not among the carried facts | `cli/test/manifest-payload.test.ts > carries no brand information` |
| The emitted manifest statements are deterministic | Two runs separated in time are byte-identical | `cli/test/manifest-payload.test.ts > serializes with the snapshot's own stable serialization` |
| Configuration asks each command only for what it needs | A consuming repository needs none of them | `cli/test/config.test.ts > accepts a configuration without the migration-authoring fields` |
| " | A migration-authoring command names the field it needs | `cli/test/config-required.test.ts > names the missing field before any work` |

- [x] 3.1 `[design]` How the loader preserves each declaration's module
      export name. *Settled:* the loader keeps returning the same array
      and returns an `exportNames: Map<HejbroInput, string>` beside it,
      keyed by identity — additive, so every existing caller is
      untouched, which is the lesson group 2 paid for. A `Map` rather
      than a `WeakMap`: the payload builder needs to enumerate it (to
      check that every table it carries has a name), and its lifetime is
      one CLI run, so there is no leak axis to protect against. A
      declaration that was never exported simply has no key, which is
      how the synthesized-function scenario holds. Start from
      `cli/test/loader.test.ts > preserves the module export name for
      each table`. ~8m
- [x] 3.2 Collect the carried choices from the loaded declarations,
      including the export name of every exported table and function.
      Start from `cli/test/manifest-payload.test.ts > collects mode,
      non-null elements, TypeScript keys, table and function export
      names, and roles`. ~10m
- [x] 3.6 A declaration that was never a module export carries no export
      name. Start from `cli/test/manifest-payload.test.ts > carries no
      export name for a trigger-synthesized function`. ~6m
- [x] 3.3 Assemble the payload with both format versions and the
      snapshot's stable serialization. Start from
      `cli/test/manifest-payload.test.ts > serializes with the
      snapshot's own stable serialization`. ~8m
- [x] 3.4 `[design]` The relaxation scope. *Settled:* the three
      migration-authoring fields become optional and each command that
      needs one refuses by name; `entry` is **not** relaxed — a
      consuming repository still reads declarations, and the fact that
      the module does not exist before the first sync belongs to the
      question of where that module's path comes from, which group 5
      owns. Start from `cli/test/config.test.ts > accepts a
      configuration without the migration-authoring fields`. ~6m
- [x] 3.5 Per-command coded refusal, raised before any work. Whether it
      reuses the existing config diagnostic or takes a code of its own
      follows the repository's existing habit — read how other codes
      treat a per-field failure before choosing, and record the basis in
      one line. Start from `cli/test/config-required.test.ts > names the
      missing field before any work`. ~8m

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

- [x] 4.1 Configuration flag, and `generate` handing the payload to the
      renderer. Start from `cli/test/generate-manifest.test.ts > enabled
      emission appends the statements to the difference`. ~8m
- [x] 4.2 Byte-identical output with emission off, and the payload's
      embedded snapshot pinned equal to the snapshot written beside it.
      Start from `cli/test/generate-manifest.test.ts > disabled emission
      is byte-identical`. ~7m
- [x] 4.3 Baseline emits none, and reports the absent row. Start from
      `cli/test/generate-manifest.test.ts > a baseline carries no
      manifest statements`. ~7m
- [x] 4.4 Monotonicity refusal in `generate`, reading the chain's last
      migration only. Start from `cli/test/manifest-chain.test.ts >
      refuses generation when the chain carries manifests and emission is
      off`. ~7m
- [x] 4.5 Monotonicity detection in `verify`, over the files it already
      reads. Start from `cli/test/verify-manifest.test.ts > reports a
      chain that stopped carrying its manifests`. ~7m

## 5. The `sync` command — `est_frozen: 73m` — issue #583

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
| A re-added column keeps its own facts | " — read half (group 3 pins the emitted half) | `cli/test/sync-emit.test.ts > attaches each column fact to the column it names, not the one at its position` |
| A synced module carries its freshness stamp as a value | The stamp is importable | `cli/test/sync-emit.test.ts > exports the identity of its manifest row` |
| A synced module holds no migration authority | The refusal states what it observed — the half group 2 cannot reach | `cli/test/sync-refusal.test.ts > generating from an emitted module names the manifest row it came from` |
| A synced module carries tables and enums, not functions | A synced module emits no function declarations | `cli/test/sync-emit.test.ts > emits tables and enums and no function declaration` |
| A reference to a table the schema does not own has no relation | A relation to an unmanaged target is absent | `cli/test/sync-emit.test.ts > derives no relation for a reference to an unmanaged table` |
| A synced module is a function of the row it was made from | Two syncs of the same row are byte-identical | `cli/test/sync-emit.test.ts > two syncs of the same row write byte-identical modules` |
| " | The module names no clock | `cli/test/sync-emit.test.ts > the module carries no timestamp` |
| Each way a manifest can fail a reader is named separately | A database with no manifest table says so | `cli/test/sync-states.test.ts > distinguishes an absent manifest table` |
| " | An empty manifest table says so | `cli/test/sync-states.test.ts > distinguishes an empty manifest table` |
| " | A stamp with no matching row says so | `cli/test/sync-states.test.ts > distinguishes a stamp with no matching row` |
| " | The six situations are told apart | `cli/test/sync-states.test.ts > reports six distinct codes, each with its own remedy` |
| A manifest format higher than the reader knows is refused | A higher manifest format is refused | `cli/test/sync-states.test.ts > refuses a higher manifest format without parsing the payload` |
| " | A lower manifest format is read | `cli/test/sync-states.test.ts > reads a lower manifest format whose snapshot format it accepts` |
| " | An embedded snapshot format the reader refuses names the two repositories | `cli/test/sync-states.test.ts > a refused embedded snapshot format carries this reader's remedy` |
| " (reader hardening) | The six situations are told apart | `cli/test/sync-states.test.ts > a row whose manifest_format column is not an integer is refused as unknown, never read` |
| " | Format skew is not reported as staleness | `cli/test/sync-states.test.ts > format skew never advises re-syncing` |
| The command can check without writing | Checking leaves the module untouched | `cli/test/sync-states.test.ts > check mode writes nothing and exits non-zero` |
| The schema filter is reserved, not silently ignored | The reserved filter is refused | `cli/test/sync-states.test.ts > refuses the reserved schema filter` |

- [ ] 5.1 `[design]` Settle the module's file name, header, the names of
      its exported stamp and role list, and how the manifest row a
      module carries reaches a refusal that wants to name it — the
      carrier group 2 deliberately did not build. Start from
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
- [ ] 5.7 Refuse a higher manifest format before the payload is parsed;
      read a lower one whose snapshot format is acceptable; and carry
      this reader's own remedy when the embedded snapshot format is
      refused. Start from `cli/test/sync-states.test.ts > refuses a
      higher manifest format without parsing the payload`. ~10m
- [ ] 5.10 Read a manifest whose table has a column whose position and
      declaration order disagree, and attach each fact to the column it
      names. Group 3 pins the emitting half against a stand-in ordering;
      this is the half where a real snapshot, a re-added column and a
      consumer meet. Start from `cli/test/sync-emit.test.ts > attaches
      each column fact to the column it names, not the one at its
      position`. ~4m
- [ ] 5.9 Carry the manifest row an emitted module came from as far as
      the refusal, so the half of the contract group 2 could not reach —
      naming an origin where one exists — gets its own failing test.
      Start from `cli/test/sync-refusal.test.ts > generating from an
      emitted module names the manifest row it came from`. ~6m
- [ ] 5.8 `[design]` Settle how a foreign key whose target is outside
      the manifest is emitted, then derive no relation for such an edge
      while keeping the column. Start from `cli/test/sync-emit.test.ts >
      derives no relation for a reference to an unmanaged table`. ~6m

## 6. Freshness at startup — `est_frozen: 28m` — issue #584

Files: `packages/cli/src/assert-schema.ts`,
`packages/cli/src/manifest-read.ts` (new).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| Freshness is judged by comparison, never by hashing at run time | A current module passes | `cli/test/assert-schema-manifest.test.ts > passes when the stamp matches the newest row` |
| " | A stale module fails with a counted distance | `cli/test/assert-schema-manifest.test.ts > fails naming both rows and the distance` |
| " | The failure claims no cause | `cli/test/assert-schema-manifest.test.ts > the failure text asserts no cause` |
| The database owns the order of manifest rows | Distance is counted, not inferred from time | `cli/test/assert-schema-manifest.test.ts > counts rows rather than comparing timestamps` |
| Each way a manifest can fail a reader is named separately | A database with no manifest table / an empty table / an unmatched stamp / a higher manifest format / a refused snapshot format | `cli/test/assert-schema-manifest.test.ts > distinguishes the six situations` |
| " (reader hardening) | The six situations are told apart | `cli/test/assert-schema-manifest.test.ts > a row whose manifest_format column is not an integer is refused as unknown, never read` |
| A manifest format higher than the reader knows is refused | Format skew is not reported as staleness | `cli/test/assert-schema-manifest.test.ts > format skew is not staleness` |
| " | An embedded snapshot format the reader refuses names the two repositories | `cli/test/assert-schema-manifest.test.ts > a refused embedded snapshot format names both repositories` |
| " (import discipline) | — | `cli/test/assert-schema-imports.test.ts` stays green |

- [ ] 6.1 Read the stamp from the handle's schema and the row through
      the handle's driver. Start from
      `cli/test/assert-schema-manifest.test.ts > passes when the stamp
      matches the newest row`. ~8m
- [ ] 6.2 `[design]` Settle the failure text's upper bound and the code
      name for a refused embedded snapshot format, then count the
      distance by rows rather than by time. Start from
      `cli/test/assert-schema-manifest.test.ts > fails naming both rows
      and the distance`. ~10m
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
- [ ] 7.2 The skill reference and its row in the References table,
      including the one-word migration for a reader who annotates
      declarations as `Table[]`: the migration input now asks for
      `DeclaredTable`.
      Gate: the skill documents the public surface this change adds —
      absent, the surface ships undocumented. ~8m
- [ ] 7.3 One `minor` changeset naming any member of the fixed group —
      `@hejbro/core` is the package this change actually moves, and the
      group versions together, so one name is enough — plus a
      database-free `sync` reachability assertion in the pack-install
      smoke. Gate: `changeset status`, then
      `scripts/pack-install-smoke.sh` assertion 3. ~6m

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
