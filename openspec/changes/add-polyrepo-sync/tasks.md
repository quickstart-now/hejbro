# Tasks: add-polyrepo-sync

Groups run in order. Five files are **shared and unowned**: every group
that touches one may only add to it, never restructure it —
`packages/core/src/engine/generate.ts` (groups 1, 2, 5 — group 5 names
`origin` in the synced-table-declared refusal, the half group 2's own
carrier-less refusal could not reach),
`packages/core/src/index.ts` (groups 2, 4, 5 — each adds only the exports
its own failing test demands, never exports for a later group; group
5's `MANIFEST_FORMAT` re-export replaces a second copy of the same fact
sync's own reader had been holding),
`packages/cli/src/commands/generate.ts` (groups 3, 4, 5 — group 3 adds
only a guard call), `packages/cli/src/snapshot-file.ts` (groups 3, 4)
and
`packages/cli/src/commands/verify.ts` (group 4 only, listed because
group 3's per-command guard lands in it too) and
`packages/cli/src/manifest-read.ts` (groups 5, 6 — one reader of the
manifest table, because two would be free to disagree about the row
they both parse; it stays free of `node:*` so the startup path can
import it). Every other file belongs to exactly one group.

A row whose red test is a **type** assertion is red only under
`check-types`; the test runner executes `expectTypeOf` as a no-op and
reports it passing however false it is. Where such a row crosses a
package boundary, the reading package resolves the other through its
built output, so a build has to precede the check.

Three questions are asked of every row of every three-column table
below, because this change has already been caught by each. **Does the
test's subject match the scenario's?** — a scenario about what an
*existing* reader does is not pinned by a test about what the *new* one
does. **Which universal is this new scenario a member of?** — a
sentence that counts has to move whenever a requirement is added beside
it. **Which word did the vocabulary ruling move?** — `sync`, `pull` and
`manifest` each changed meaning or owner, and a sentence using one in
its old sense is wrong even when everything around it is right; no gate
reads for it, so the check is a search run before the packet is handed
over, not a rule to remember.

And a fourth rule, because R2 begins by deleting: **a scenario that
leaves a requirement is named as removed, with where it went.**

Estimates are agent execution minutes and are frozen per group at
`est_frozen`; overruns correct the next group's estimate, never this
one's. Four groups carry a re-freeze, and the reason is recorded rather
than absorbed: the delta gained requirements after the first freeze —
a manifest format higher than the reader knows is refused, the export
name of a declared function is a carried fact, a foreign key whose
target is outside the manifest derives no relation, an embedded
snapshot format the reader refuses carries this reader's own remedy,
and a payload that does not answer its own format is a situation of its
own rather than a cast. Group 3 moved 40m → 46m, group 5 moved
47m → 93m, group 6 moved 26m → 30m, and group 7 moved 24m → 26m. One of group 5's steps
(63m → 69m) is the one re-freeze that is not a spec change: a
requirement's second half turned out to be unreachable from the group
that owns the first, and covering it needed a task rather than a
sentence. A re-freeze is never a task running long — an estimate moves
only when the work it estimates does, so that the ratio of actual to
estimate keeps measuring execution rather than scope. Durations land
per task in `openspec/task-times.csv`, measured with `date -u` at task
start and end.

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
| " | A chain that starts carrying midway is not a gap | `cli/test/verify-manifest.test.ts > a chain that begins carrying manifests midway is not reported` |
| " | Stripping the end of a chain is caught too | `cli/test/verify-manifest.test.ts > reports a chain whose last migration was stripped` |
| The emitted manifest statements are deterministic | " (the recorded hash is the snapshot's) | `cli/test/generate-manifest.test.ts > the inserted snapshot hash is the one the banner records` |
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

## 5. The `sync` command — `est_frozen: 93m` — issue #583

Files: `packages/cli/src/commands/sync.ts` (new),
`packages/cli/src/sync/*` (new), `packages/cli/src/main.ts`,
`packages/cli/src/flags.ts`.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A repository obtains a schema it does not own from the database | A schema arrives as one module | `cli/test/sync-emit.test.ts > writes one module and nothing else` |
| " | No connection is a coded failure | `cli/test/sync-connection.test.ts > names what to supply when no connection is given` |
| " | A file that is not a synced module is not overwritten | `cli/test/sync-emit.test.ts > refuses to overwrite a file it did not write` |
| The database driver is an optional dependency | A missing driver is explained for the syncing command too | `cli/test/sync-connection.test.ts > names the driver package to install` |
| A synced module reproduces the consumer-visible type layer | Result keys / element nullability / numeric mode / relation keys / enum values match | `cli/test/sync-emit.test.ts > reproduces the carried choices of the manifest` |
| " | Write inputs follow what the database does for a column | `query/test/types/usage-table.test.ts > a defaulted column is optional and a computed one is absent from writes` |
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
| " | A payload that does not answer its format says so | `cli/test/sync-states.test.ts > refuses a payload that does not answer its own format` |
| " | The seven situations are told apart | `cli/test/sync-states.test.ts > reports seven distinct codes, each with its own remedy` |
| A manifest format higher than the reader knows is refused | A higher manifest format is refused | `cli/test/sync-states.test.ts > refuses a higher manifest format without parsing the payload` |
| " | A lower manifest format is read | `cli/test/sync-states.test.ts > reads a lower manifest format whose snapshot format it accepts` |
| " | An embedded snapshot format the reader refuses names the two repositories | `cli/test/sync-states.test.ts > a refused embedded snapshot format carries this reader's remedy` |
| " (reader hardening) | The seven situations are told apart | `cli/test/sync-states.test.ts > a row whose manifest_format column is not an integer is refused as unknown, never read` |
| " | Format skew is not reported as staleness | `cli/test/sync-states.test.ts > format skew never advises re-syncing` |
| The command can check without writing | Checking leaves the module untouched | `cli/test/sync-states.test.ts > check mode writes nothing and exits non-zero` |
| The schema filter is reserved, not silently ignored | The reserved filter is refused | `cli/test/sync-states.test.ts > refuses the reserved schema filter` |

- [x] 5.1 `[design]` Settle the module's file name, header, the names of
      its exported stamp and role list, and how the manifest row a
      module carries reaches a refusal that wants to name it — the
      carrier group 2 deliberately did not build. Start from
      `cli/test/sync-emit.test.ts > writes one module and nothing else`.
      ~8m
- [x] 5.2 Register the command, its value-taking flags and its help
      row. Start from `cli/test/help.test.ts > lists the sync command`.
      ~5m
- [x] 5.11 Read the newest manifest row through the handed session —
      one reader, shared with the startup path, free of `node:*` so that
      path can import it. Start from `cli/test/manifest-read.test.ts >
      reads the newest row and nothing else`. ~5m
- [x] 5.12 The comparison mode that writes nothing, with an exit status
      that separates agreement from staleness; and the reserved schema
      filter, parsed and refused so a caller never believes a filter
      applied. Start from `cli/test/sync-states.test.ts > check mode
      writes nothing and exits non-zero`, then `> refuses the reserved
      schema filter`. ~8m
- [x] 5.3 Connection entry, dynamic driver import, and both coded
      refusals. Start from `cli/test/sync-connection.test.ts > names what
      to supply when no connection is given`. ~8m
- [x] 5.4 Read the newest row and emit usage-constructor calls for its
      tables and enums — and for nothing else. Start from
      `cli/test/sync-emit.test.ts > reproduces the carried choices of the
      manifest`, then `> emits tables and enums and no function
      declaration`. ~10m
- [x] 5.5 Export the role list and the stamp, and pin the module as a
      function of its row (two syncs byte-identical, no clock value in
      the header). Start from `cli/test/sync-emit.test.ts > two syncs of
      the same row write byte-identical modules`. ~8m
- [x] 5.6 `[design]` Settle the seven codes and their remedies, then
      raise the five this command owns — including a payload validated
      against its format rather than cast, and the absent-versus-empty
      pair that a raw error currently collapses. Start from
      `cli/test/sync-states.test.ts > distinguishes an absent manifest
      table`. ~10m
- [x] 5.7 Refuse a higher manifest format before the payload is parsed;
      read a lower one whose snapshot format is acceptable; and carry
      this reader's own remedy when the embedded snapshot format is
      refused. Start from `cli/test/sync-states.test.ts > refuses a
      higher manifest format without parsing the payload`. ~10m
- [x] 5.10 Read a manifest whose table has a column whose position and
      declaration order disagree, and attach each fact to the column it
      names. Group 3 pins the emitting half against a stand-in ordering;
      this is the half where a real snapshot, a re-added column and a
      consumer meet. Start from `cli/test/sync-emit.test.ts > attaches
      each column fact to the column it names, not the one at its
      position`. ~4m
- [x] 5.9 Carry the manifest row an emitted module came from as far as
      the refusal, so the half of the contract group 2 could not reach —
      naming an origin where one exists — gets its own failing test.
      Start from `cli/test/sync-refusal.test.ts > generating from an
      emitted module names the manifest row it came from`. ~6m
- [x] 5.8 `[design]` Settle how a foreign key whose target is outside
      the manifest is emitted, then derive no relation for such an edge
      while keeping the column. Start from `cli/test/sync-emit.test.ts >
      derives no relation for a reference to an unmanaged table`. ~6m

## 6. Freshness at startup — **superseded by the git-channel pivot, not built** — `est_frozen: 30m` — issue #584

**D106 m7**: this group belonged to the withdrawn database channel — a
manifest row to read at startup no longer exists once the channel is
git, not a database (proposal.md, "What happens to the groups", G6:
"Purpose dissolved by the judgement that a database's shape is not
verified"). Left unchecked below is correct, not pending: nothing here
is planned for this change, ever. Kept for the historical record rather
than deleted, the same reasoning R2-G9's own header uses for its move.

Files: `packages/cli/src/assert-schema.ts`,
`packages/cli/src/manifest-read.ts` (new).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| Freshness is judged by comparison, never by hashing at run time | A current module passes | `cli/test/assert-schema-manifest.test.ts > passes when the stamp matches the newest row` |
| " | A stale module fails with a counted distance | `cli/test/assert-schema-manifest.test.ts > fails naming both rows and the distance` |
| " | The failure claims no cause | `cli/test/assert-schema-manifest.test.ts > the failure text asserts no cause` |
| The database owns the order of manifest rows | Distance is counted, not inferred from time | `cli/test/assert-schema-manifest.test.ts > counts rows rather than comparing timestamps` |
| Each way a manifest can fail a reader is named separately | A database with no manifest table / an empty table / an unmatched stamp / a higher manifest format / an unparsable payload / a refused snapshot format | `cli/test/assert-schema-manifest.test.ts > distinguishes the seven situations` |
| " (reader hardening) | The seven situations are told apart | `cli/test/assert-schema-manifest.test.ts > a row whose manifest_format column is not an integer is refused as unknown, never read` |
| A manifest format higher than the reader knows is refused | Format skew is not reported as staleness | `cli/test/assert-schema-manifest.test.ts > format skew is not staleness` |
| " | An embedded snapshot format the reader refuses names the two repositories | `cli/test/assert-schema-manifest.test.ts > a refused embedded snapshot format names both repositories` |
| " (import discipline) | — | `cli/test/assert-schema-imports.test.ts` stays green |

- [ ] 6.1 Read the stamp from the handle's schema and the row through
      the handle's driver, reusing group 5's reader rather than writing
      a second one. Start from
      `cli/test/assert-schema-manifest.test.ts > passes when the stamp
      matches the newest row`. ~5m
- [ ] 6.2 `[design]` Settle the failure text's upper bound and the code
      name for a refused embedded snapshot format, then count the
      distance by rows rather than by time. Start from
      `cli/test/assert-schema-manifest.test.ts > fails naming both rows
      and the distance`. ~10m
- [ ] 6.3 The seven situations, translated into this surface's own code
      vocabulary, including format skew and an unparsable payload as
      outcomes of their own. This surface meets the same seven the
      command does, because it reads the same rows through the same
      reader; only the vocabulary it reports them in differs. Start from
      `cli/test/assert-schema-manifest.test.ts > distinguishes the seven
      situations`. ~12m

## 7. Documentation and release plumbing — **superseded by R2-G8, not built as written here** — `est_frozen: 26m` — issue #585

**D106 m7**: redefined against the shipped git-channel surface rather
than run as its own group (proposal.md, "What happens to the groups",
G7: "Redefined against the new surface; reissued") — the actual
documentation/skill/changeset work is R2-G8's, whose own files
(`docs/guide/polyrepo.md`, `skills/hejbro/references/polyrepo.md`,
`SKILL.md`, `.changeset/*.md`, `scripts/pack-install-smoke.sh`) are the
same list below with one rename (`polyrepo-sync.md` → `polyrepo.md`).
Kept for the historical record, same reasoning as group 6 above.

Files: `docs/guide/polyrepo.md` (new),
`skills/hejbro/references/polyrepo-sync.md` (new),
`skills/hejbro/SKILL.md`, `.changeset/*.md` (new),
`scripts/pack-install-smoke.sh`.

No unit test covers prose. Each task names the gate that fails without
it; that gate is the task's red signal.

- [ ] 7.1 The guide: what crosses the boundary, what does not, the size
      property in numbers, the CI drift-check workflow template, and all
      seven reader situations with the repository each remedy sends the
      reader to. The xref gate runs one way only — it checks that every
      code the guide cites exists, never that every code is cited — so a
      code added late stays undocumented unless the guide enumerates
      them deliberately. Gate: `pnpm check:diagnostic-xref`, plus a
      count of the guide's rows against the delta's enumeration. ~12m
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

## 8. The two-repository witness — **superseded by R2-G9, which itself moved to #603 — not built here** — `est_frozen: 25m` — issue #586

**D106 m7**: redefined and sequenced after the apply engine
(proposal.md, "What happens to the groups", G8: "Redefined, and
sequenced after the apply engine, since the consumer's loop cannot
close without it") — became R2-G9, which itself later moved in full to
the apply-engine change (#603, see R2-G9's own header for that second
hop). Two supersessions deep; kept for the historical record, same
reasoning as groups 6 and 7 above.

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

---

## Shared and unowned files (R2)

`packages/core/src/index.ts` (R2-G1 removes, R2-G2 adds) ·
`packages/cli/src/commands/generate.ts` (R2-G2, R2-G3) ·
`packages/cli/src/git.ts` (R2-G4 only, listed because every git
subprocess in the package goes through it) ·
`packages/cli/src/config.ts` (R2-G7 — R2-G4 does not touch it; see that
group's own 4.12 for the full history of why) ·
`packages/cli/src/commands/vendor.ts` (R2-G4 writes it, R2-G5 only adds
the contract file on top, 5.11).
Every other file belongs to exactly one group.

## R2-G1 — Withdrawing what lost its reader — `est_frozen: 38m` — #594

Files: `packages/core/src/dsl/usage-table.ts` (deleted),
`packages/core/src/dsl/table.ts`, `packages/core/src/index.ts`,
`packages/query/test/types/usage-table.test.ts` (deleted),
`packages/cli/src/main.ts`, `packages/cli/src/commands/sync.ts`
(deleted), `packages/cli/src/sync/{connection,emit,manifest-state}.ts`
(deleted; `sync/write.ts` preserved for R2-G4), `packages/cli/src/manifest-read.ts`
(deleted), `packages/cli/src/flags.ts`, and the deleted modules' own
tests.

- [x] 1.1 Delete the usage-table constructor and the three write-fact
      helpers, and remove their exports. Start from the type test that
      asserts they exist: it is deleted in the same step, and the
      failing signal is `check-types` over the packages that imported
      them. ~6m
- [x] 1.2 `[design]` Decide whether the authority brand's **declared**
      side survives on its own ground. It narrows what generation
      accepts, which is a property of the repository that authors
      migrations and does not depend on what a consumer holds. Settle
      *keep* or *withdraw* with the reason recorded in one line, then
      execute it. Start from
      `core/test/types/declared-table.test.ts`. ~8m
      **Decision: keep.** `TableAuthority` stays `"declared" | "usage"`
      — the runtime chokepoint in `engine/generate.ts` still refuses
      any hand-assembled `"usage"`-tagged value regardless of whether a
      public constructor exists, so the brand keeps guarding a property
      of the repository that authors migrations.
- [x] 1.3 Remove the origin carrier and the origin clause of the
      refusal, keeping the refusal itself. Start from
      `core/test/engine/authority-refusal.test.ts > the refusal names
      what it observed`. ~6m
- [x] 1.4 Command registration + `commands/sync.ts` deletion. Start
      from `cli/test/help.test.ts`'s command-listing assertion losing
      `sync`. ~6m
- [x] 1.5 Delete `src/sync/{connection,emit,manifest-state}.ts` and
      `manifest-read.ts` plus their tests. `write.ts` preserved. Red
      signal: `check-types` and the remaining suite. ~7m
- [x] 1.6 Flag-surface cleanup — only what no other command uses
      (`--out`, `--schema`; `--url` stays, shared with `check`). ~5m

**Re-freeze: 20m → 38m.** Reason: no task covered retiring the `sync`
command itself — a planning-gap correction (owner caught it from an
implementer's observation that its own generated-code emitter still
named the four withdrawn symbols by string, with no gate in this repo
able to catch it), not a task running long.

## R2-G2 — The export directory — `est_frozen: 76m` — #595

Files: `packages/cli/src/export/*` (new),
`packages/cli/src/manifest-payload.ts` → renamed to
`packages/cli/src/export/description.ts`, `packages/cli/src/commands/
generate.ts` (shared), `packages/cli/src/commands/verify.ts` (2.9 only),
`packages/cli/src/manifest-chain.ts` (deleted, 2.9),
`packages/core/src/sql/manifest.ts` (deleted, 2.10),
`packages/core/src/sql/migration-file.ts` (2.10, banner line + parser
only), `packages/core/src/engine/generate.ts` (2.10, emission wiring
only), `packages/core/src/index.ts` (2.10, `MANIFEST_FORMAT`
re-export only).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A repository publishes the schema it declares | Generating writes the export | `cli/test/export-write.test.ts > writes the description, the SQL and the format record` |
| " | The export needs no database | `cli/test/export-write.test.ts > writes the export with no database reachable` |
| " | A repository without the export is unchanged | `cli/test/export-write.test.ts > migration and snapshot are byte-identical with the export disabled` |
| The export is a function of the declarations | Two runs separated in time are byte-identical | `cli/test/export-determinism.test.ts > two runs separated in time are byte-identical` |
| " | The export names no clock and no machine | `cli/test/export-determinism.test.ts > the export names no clock, no host name, and no absolute path` |
| The export carries what the schema alone does not say | The carried choices survive the round trip | `cli/test/export-facts.test.ts > every declaration-time choice is recovered` |
| " | A re-added column keeps its own facts | `cli/test/export-facts.test.ts > facts follow the column's name, not its position` |
| " | A synthesized trigger function carries no export name | `cli/test/export-facts.test.ts > a trigger's function carries no export name` |
| " | A brand is not among the carried facts | `cli/test/export-facts.test.ts > a brand is not among the carried facts` |
| The export records the formats it is written in | The two format versions are separate | `cli/test/export-write.test.ts > description and snapshot formats are distinct values` |
| The export includes the SQL that raises the schema | The squashed SQL is complete on its own | `cli/test/export-sql.integration.test.ts > applies cleanly to an empty database and the schema it declares is there` |
| " | The squashed SQL is not a migration | `cli/test/export-sql.test.ts > listing migrations does not yield the export's SQL` |

- [x] 2.1 `[design]` Settle the export's shape on disk: directory name,
      the three file names, and the name of the format record — which
      must not be `manifest`, since that word now belongs to the
      apply-engine ledger. Start from
      `cli/test/export-write.test.ts > writes the description, the SQL
      and the format record`. ~8m
      **Decision:** directory `.hejbro/export/`; files `schema.json`
      (description + embedded snapshot), `snapshot.sql` (squashed SQL),
      `format.json` (the format record — plain, says what it is, no
      collision with the apply-engine's own future vocabulary).
- [x] 2.2 Assemble the description from the declarations and the
      snapshot, reusing the existing sidecar builder. Start from
      `cli/test/export-facts.test.ts > every declaration-time choice is
      recovered`. ~8m
- [x] 2.3 Carry facts against a column's SQL name, and prove it with a
      table whose physical order differs from its declaration order.
      Start from `cli/test/export-facts.test.ts > facts follow the
      column's name, not its position`. ~8m
- [x] 2.4 The format record, with the description's own version and the
      snapshot's kept separate. Start from `cli/test/export-write.test.ts
      > description and snapshot formats are distinct values`. ~6m
- [x] 2.5 The squashed SQL, taken from a `generateMigration` call against
      an empty snapshot (the same shape `generate` already knows how to
      make; no second SQL-rendering path), written outside the migrations
      directory. Start from `cli/test/export-sql.test.ts > listing
      migrations does not yield the export's SQL`. ~8m
- [x] 2.6 Determinism: no clock, no host, no absolute path, one
      serializer. Start from `cli/test/export-determinism.test.ts > two
      runs separated in time are byte-identical`. ~7m
- [x] 2.7 Wire the export into generation behind its own `--export` flag
      (`--manifest`'s own pattern); with it off, the migration and
      snapshot are byte-identical to today's. Start from
      `cli/test/export-write.test.ts > migration and snapshot are
      byte-identical with the export disabled`. ~7m
- [x] 2.8 `[design]` Settle whether the three facts the new promise
      needs — a view's column types, a function's structural signature,
      a function argument's TypeScript key — are carried in this
      version. The third cannot be: the declaration does not keep it and
      the conversion is one-way, so carrying it is a change to the DSL.
      Record the boundary and what a consumer sees at it. Start from
      `cli/test/export-facts.test.ts > the export states what it does
      not carry`. ~8m
      **Decision: none of the three, this version.** A view yields no
      fact at all (unchanged scope from the sidecar this reuses); a
      function's fact carries only its names, never a signature. A
      consumer sees no view entry and no function argument/return
      information — never a partial or guessed one — documented on
      `ExportDescription` itself.
- [x] 2.9 Withdraw the monotonicity gate: delete `manifest-chain.ts` +
      the `generate.ts`/`verify.ts` wiring + the tests that exercised it
      (`manifest-chain.test.ts`, `verify-manifest.test.ts`, and the one
      `generate-manifest.test.ts` case that depended on it). The delta
      disposed of this requirement as **Ends** ("against a committed
      file that state cannot arise"); left in place by G1 only because it
      crossed that group's own file boundary. ~6m
- [x] 2.10 Withdraw core's manifest emission machinery: delete
      `sql/manifest.ts` (bootstrap/insert renderer, dollar-quote guard,
      `MANIFEST_PAYLOAD_TERMINATOR`, `MANIFEST_FORMAT`) and its test;
      remove the manifest banner line and `parseBannerManifestFormat`
      from `migration-file.ts` (every other banner line and its parser
      stays); remove the `MANIFEST_FORMAT` re-export from `index.ts`;
      remove the emission-option wiring from `engine/generate.ts`; remove
      the CLI's `--manifest` flag, `resolveManifestOptions`,
      `manifestOptions` and the baseline exception note from
      `commands/generate.ts`, and delete `generate-manifest.test.ts`
      (the whole file exercised only this). `manifest-payload.ts` itself
      is untouched — already renamed to the export's own description
      builder in 2.2, a fact-collector rather than an emission machine.
      ~10m

**Re-freeze: 60m → 66m → 76m.** First move (60→66): no task covered
retiring the monotonicity gate itself — a planning-gap correction, not a
task running long (2.9 added). Second move (66→76): the delta already
disposed of the manifest-emission requirements as moved to the
apply-engine change or ended outright, but no task covered actually
removing the code — living code with no describing contract, caught by
the owner's END/REMOVED cross-check rather than by this group's own
planning (2.10 added). The live-database proof for "the squashed SQL is
complete on its own" moved to a new `export-sql.integration.test.ts`
(docker-gated, mirrors `assert-schema-live.integration.test.ts`) rather
than `export-sql.test.ts` as the delta packet named it — proving SQL
actually creates a schema needs a real database, and the default
`pnpm test`/CI run must stay database-free; `export-sql.test.ts` keeps
only the migrations-directory scenario, which needs no database.

## R2-G3 — The schema repository's own check — `est_frozen: 30m` — #596

Files: `packages/cli/src/commands/verify.ts`,
`packages/cli/src/export-compare.ts` (new),
`packages/cli/src/export/squash.ts` (new — `buildSquashedSql`, moved out
of `commands/generate.ts` so `generate` and `verify` share one
squashed-SQL builder rather than two).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A committed export matches the declarations beside it | A stale export is reported | `cli/test/verify-export.test.ts > reports an export written before the last declaration change` |
| " | A current export passes | `cli/test/verify-export.test.ts > a regenerated export passes` |

- [x] 3.1 Compare by regenerating the description in memory and
      comparing bytes, so the check and the writer cannot disagree about
      what "matching" means. Start from `cli/test/verify-export.test.ts
      > reports an export written before the last declaration change`.
      ~9m
- [x] 3.2 The failure names the command that regenerates, and asserts
      nothing about why the export is stale. Start from
      `cli/test/verify-export.test.ts > the failure names the command,
      not a cause`. ~6m
- [x] 3.3 A repository with no export at all is not reported as stale —
      the check applies where an export exists. Start from
      `cli/test/verify-export.test.ts > a repository without an export
      is not reported`. ~7m
- [x] 3.4 Wire into `verify` beside the existing chain checks, without
      changing their output. Start from `cli/test/verify.test.ts >
      existing chain diagnostics are unchanged`. ~8m
      `TOTAL_CHECKS` (now `totalChecks(exportApplied)`) only counts the
      export check when it actually ran — an export-less repository's
      "5 checks passed"/"of 5 checks failed" wording is byte-identical
      to before this group, pinned by the new "existing chain
      diagnostics are unchanged" test.

## R2-G4 — `link` and `vendor` — `est_frozen: 88m` — #597

Files: `packages/cli/src/git.ts` (remote functions added),
`packages/cli/src/vendor/*` (new — includes `write.ts`, adopted from
the withdrawn `sync/write.ts` via `git mv`, see 4.7; `source-file.ts`
new as of 4.13),
`packages/cli/src/commands/{link,vendor,outdated}.ts` (new —
`commands/vendor.ts` is shared with R2-G5, which only adds),
`packages/core/test/migration-file.test.ts` (4.11 only). `config.ts`
stays untouched — this group's own commands read no
`hejbro.config.ts` field at all (see 4.4/4.12/4.13's own history: a
`schemaSource` field was added and then reverted).

**This group writes the description, the squashed SQL and the lock —
never the contract file.** The delta's "Vendoring pins what it read"
scenario names the contract too, but that names the *finished* feature;
this group's own red tests assert only what it writes, and the contract
half of that scenario is closed by R2-G5 (5.11).

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| A repository obtains a schema it does not own over git | Linking records the repository alone | `cli/test/link.test.ts > records the repository and no branch` |
| " | Vendoring pins what it read | `cli/test/vendor.test.ts > writes the description and the squashed SQL and records the commit` |
| " | A one-off ref does not stick | `cli/test/vendor.test.ts > --ref does not persist and the lock records its origin` |
| " | Checking needs no network | `cli/test/vendor-check.test.ts > checks with the remote unreachable` |
| Vendoring never overwrites a file it did not write | A hand-written file is not overwritten | `cli/test/vendor-write.test.ts > refuses a destination it did not write` |
| The check compares without writing | Checking leaves the files untouched | `cli/test/vendor-check.test.ts > exits non-zero and writes nothing` |
| " | A matching set passes quietly | `cli/test/vendor-check.test.ts > a matching set exits zero` |

- [x] 4.1 Resolve the remote's symbolic HEAD and its commit in one
      call, through the file that owns every git subprocess. Start from
      `cli/test/git-remote.test.ts > resolves the default branch and its
      commit`. ~8m
      `git ls-remote --symref <remote> HEAD`, one round trip, so a caller
      never reads a branch name and its commit from two calls that could
      race a push in between.
- [x] 4.2 Read one path at one commit without a working tree, so a
      locked commit can be read directly. Start from
      `cli/test/git-remote.test.ts > reads a file at a given commit`.
      ~9m
      A throwaway bare repository per call, `git fetch --filter=blob:none
      --depth=1 <remote> <commit>` then `git show <commit>:<path>` — any
      reachable commit, not only the branch tip (`git archive --remote`
      cannot do this and GitHub refuses it outright).
- [x] 4.3 `link`: record the source repository, and nothing else. Start
      from `cli/test/link.test.ts > records the repository and no
      branch`. ~6m
- [x] 4.4 `vendor`: write the description and the squashed SQL and the
      lock, recording the commit and the ref it was resolved from
      (R2-G5's 5.11 adds the contract file on top, once it exists).
      Start from `cli/test/vendor.test.ts > writes the description and
      the squashed SQL and records the commit`. ~9m
      **Layout, settled after three owner corrections (4.12's and
      4.13's own history)**: the two raw copies are
      `.hejbro/vendor/{schema.json,snapshot.sql}` — symmetric to the
      schema repository's own `.hejbro/export/`, kept byte-identical to
      what was fetched, never wrapped or marked, so a consumer can diff
      them directly against the upstream export (this part of the
      initial self-determined layout stood throughout, unchanged by
      either correction). The lock does **not** carry `source` (see
      4.13): it is **`hejbro.lock` at the repository root** — the same
      place `package-lock.json`/`go.sum` sit, owner-decided, so a schema
      move is visible in a pull request's own file list rather than
      hidden inside `.hejbro/` — and it is **`vendor`'s file alone**.
      `source` lives in a sibling root file, **`hejbro.json`**, written
      only by `link`, so the pair mirrors `package.json`/
      `package-lock.json`: an intent file and a truth file, always
      together, never one without the other. Neither file's writer ever
      touches the other's field.
- [x] 4.5 The lock also records the description's format version. Start
      from `cli/test/vendor.test.ts > the lock records the description
      format version`. ~6m
- [x] 4.6 `--ref` overrides one run and does not persist. Start from
      `cli/test/vendor.test.ts > --ref does not persist and the lock
      records its origin`. ~7m
- [x] 4.7 Carry the overwrite guard over: a textual marker, checked
      without loading the file as code, with a fixture that contains a
      comment so the check has something to discriminate against. Start
      from `cli/test/vendor-write.test.ts > refuses a destination it did
      not write`. ~7m
      Adopted `sync/write.ts` → `vendor/write.ts` (`git mv`), renamed
      `SYNCED_MODULE_MARKER` → `VENDOR_LOCK_MARKER` and the error code
      `sync-destination-not-synced` → `vendor-destination-not-vendored`.
      JSON can't carry a comment marker the way a generated TS module
      could, so the guard protects `hejbro.lock` alone (a top-level
      `"generatedBy": "hejbro vendor"` field, checked as a substring) —
      `hejbro.lock` is always a hejbro-only format, unlike
      `schema.json`/`snapshot.sql`, which stay unmarked raw copies (4.4).
      `readLock` enforces the same check before ever trusting an
      existing lock, not only the write path; the guard runs before
      `hejbro.config.ts` even loads, so a foreign lock blocks a run
      regardless of whether a source is configured yet. The negative
      fixture is a believable hand-written `hejbro.lock` (real key
      shapes, missing only the mark), not a comment-bearing TS file —
      confirmed to have real discriminating power by hand: weakening
      `VENDOR_LOCK_MARKER` to `'"commit"'` flipped
      `vendor-write.test.ts`'s guard test red (sha256 of `write.ts`
      before/after the revert: `cfbf640a…6f4ac`, byte-identical).
- [x] 4.8 `vendor --check`: compare against the lock, offline, writing
      nothing. Start from `cli/test/vendor-check.test.ts > exits
      non-zero and writes nothing`. ~8m
      The lock also carries a sha256 of each vendored file's content —
      what makes an offline comparison possible at all without
      re-fetching or re-diffing against the remote.
- [x] 4.9 `outdated`: report a newer commit as advice, exiting zero.
      Start from `cli/test/outdated.test.ts > reports a newer commit
      without failing`. ~6m
- [x] 4.10 A machine without `git` is told so, rather than shown a
      subprocess failure — the same shape the missing-driver diagnostic
      already uses. Start from `cli/test/vendor.test.ts > a missing git
      binary is a coded failure`. ~6m
      Shared `vendor/git-diagnostic.ts` (`vendor` and `outdated`, the two
      commands that ever reach a remote) rather than one copy per
      command; the diagnostic text is asserted directly in a subprocess
      test with `PATH` stripped, not inferred from a type passing.
      `packages/cli/src/config.ts` needed no change, in the end (settled
      across 4.12 and 4.13): `link`/`vendor`/`outdated` read no
      `hejbro.config.ts` field at all.
- [x] 4.11 Restore the forward-compatibility regression guard 2.10
      removed along with `parseBannerManifestFormat`: a banner line no
      current parser recognizes at all must not break the parsers that
      read the *other* lines. Distinct from `parseBannerHashes`'s own
      "#229 unknown-line tolerance" test, which only proves that *other
      known* prefixes (the version line) don't confuse a parser reading
      its own — a genuinely fabricated, nobody-recognizes-it prefix is a
      different, stronger claim (forward compatibility, required by the
      shipped `migration-format` spec), and after 2.10 no test in
      `packages/core/test` used one any more. Start from
      `core/test/migration-file.test.ts > every current parser still
      reads its own line with a fabricated, nobody-recognizes-it line
      mixed in`. Not a spec change — restores coverage for already-shipped
      behavior. ~5m
- [x] 4.12 Layout correction: move the lock from
      `.hejbro/vendor/lock.json` to the repository root as `hejbro.lock`
      (owner decision — see 4.4's own note for the full history,
      including a `hejbro.config.ts`-`schemaSource` detour that was
      itself reverted). Move the overwrite guard's protected file
      accordingly; replace the negative fixture with a believable
      hand-written `hejbro.lock` (real key shapes, missing only the
      mark) and confirm its discriminating power by hand — weaken
      `VENDOR_LOCK_MARKER` to a common substring, confirm the guard test
      goes red, revert, confirm `write.ts`'s sha256 is byte-identical to
      before. `config.ts` untouched throughout this task's own scope.
      ~5m
- [x] 4.13 Layout correction, superseding 4.12's own choice of where
      `source` lives: split it out of `hejbro.lock` into a new root file,
      **`hejbro.json`**, containing exactly `{source}` — its own schema
      rejects any other key, so no door is left open for configuration to
      drift into it (owner's sealed decision, "(C)": an intent file and a
      lock file are always a pair in every ecosystem this borrows its
      pedagogy from — `package.json`/`package-lock.json`,
      `go.mod`/`go.sum` — no ecosystem ships a lock file alone).
      `hejbro.lock` becomes pure truth: `source` removed from
      `VendorLock` entirely. `link` writes only `hejbro.json`; `vendor`
      writes only `hejbro.lock`, and regains its own `--force` (removed
      in 4.12, needed again now that no other command ever claims
      `hejbro.lock` on its behalf). The already-landed 4.12 state (source
      inside `hejbro.lock`) was carried forward rather than reverted
      first, per the owner's own instruction, since `config.ts` needed no
      touching either way. `hejbro.json`'s own overwrite guard reuses the
      `vendor-destination-not-vendored` code but checks strict-schema
      validity rather than a textual marker — `{source}` alone leaves no
      room for an extra marker field without breaking "reject any other
      key" — flagged to the planner as a self-determined interpretation,
      not literally specified. `vendor`'s own guard on `hejbro.lock` now
      runs before it reads the linked source at all (the same
      guard-before-dependent-work order every destination file's guard in
      this codebase follows), confirmed by a fixture where a source is
      already linked yet a hand-written lock still refuses. Start from
      `cli/test/link.test.ts > refuses to overwrite a hand-written
      hejbro.json without --force`. ~13m

**Re-freeze: 70m → 72m → 77m → 82m → 88m.** First move (70→72):
decomposing this group surfaced the missing-`git` diagnostic, which the
delta requires and no task covered. Second move (72→77): 2.10's own
removal of `parseBannerManifestFormat` took its sibling test's
forward-compatibility fixture with it, without a replacement — found and
confirmed during R2-G3's review exchange, not a task running long (4.11
added). Third move (77→82): the owner's own lock-location and
intent/truth-separation rulings reached the implementer after 4.1–4.10
had already landed on a self-determined layout, requiring a follow-up
correction (4.12) — a delivery-timing gap, not a task running long; a
parallel ruling that would have added a `schemaSource` field to
`hejbro.config.ts` was raised and then withdrawn within the same
exchange, before any estimate moved for it. Fourth move (82→88): the
owner's sealed decision landed after 4.12 had already shipped, requiring
a second follow-up correction (4.13) to introduce `hejbro.json` and
strip `source` back out of `hejbro.lock` — again a delivery-timing gap
between two owner-driven rulings reaching the implementer in sequence,
not a task running long.

## R2-G5 — The emitted contract — `est_frozen: 88m` — #598

Files: `packages/cli/src/contract/*` (new),
`packages/cli/src/commands/vendor.ts` (shared with R2-G4 — 5.11 only
adds the contract-emission call and the lock's third hash, never
touches R2-G4's own read/write paths), `packages/cli/src/loader.ts`
(planner-assigned to this group, 5.12 — the old group 3 that once
touched it is already closed, so this is a plain addition, not a
shared file).

**Scope, settled before this group started:** 5.10 keeps only
determinism and the absence of a clock — the "prove it by loading and
running the emitted module" property moves to R2-G6's own 6.11, since
the client that would load and run a contract does not exist until that
group exists. 5.11 adds the wiring itself: `vendor` calls into
`contract/*` and writes the contract file alongside the description and
the squashed SQL, closing the contract half of "Vendoring pins what it
read" (R2-G4's own note on 4.4 names this the same scenario).

**Architecture, confirmed by reading rather than assumed:** `schema.json`
already embeds the full structured `Snapshot` alongside the sidecar
facts (`export/write.ts`'s `ExportPayload = ExportDescription &
{snapshot: Snapshot}`, `serializeExportDescription` serializes the whole
payload at runtime) — every column fact type synthesis needs
(`typeNode`, `notNull`, `default`, `generated`, `identity`) is already
vendored, with no export-format change needed for this group. `core`'s
`TableSnapshot`/`ColumnSnapshot`/`TypeNode`/`renderTypeNode`/
`columnDefault`/`columnGenerated`/`columnIdentity`/`columnNotNull` are
public and reused directly; `EnumSnapshot` (`enum-kind.ts`) is not, so
`contract/read-snapshot.ts` restates its `{schema, name, values}` shape
locally — proposal.md's own "the reader restates an internal shape
rather than importing it", confirmed to mean exactly this.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| The vendored contract is a function of the commit | Two runs against one commit are byte-identical | `cli/test/contract-emit.test.ts > two runs write byte-identical files` |
| " | The contract names no clock | `cli/test/contract-emit.test.ts > carries no timestamp` |
| The contract names the point it was generated from | The origin is readable | `cli/test/contract-emit.test.ts > exports the commit and export identity` |
| A consumer holds a contract, not declarations | The contract yields no declaration | `cli/test/contract-authority.test.ts > nothing in the contract can be passed to generation` |
| " | Generating from a vendored contract is refused | `cli/test/contract-authority.test.ts > refuses and names the owning repository` |
| The contract reproduces the consumer-visible type layer | Row keys match the declaring repository | `cli/test/types/contract-types.test.ts > row keys are the declared TypeScript keys` |
| " | Element nullability follows the declaration | `cli/test/types/contract-types.test.ts > non-null elements are not nullable` |
| " | Numeric mode follows the declaration | `cli/test/types/contract-types.test.ts > numeric mode follows the declaration` |
| " | Enum columns keep their values | `cli/test/types/contract-types.test.ts > an enum types as its values` |
| " | Write inputs follow what the database does | `cli/test/types/contract-types.test.ts > defaulted optional, computed absent, identity optional` |
| " | A branded column reads as its unbranded type | `cli/test/types/contract-types.test.ts > a brand does not cross` |
| Role names travel with the contract | Supplied roles are accepted (metadata half; the runtime half is R2-G6's, see 5.8's own note) | `cli/test/contract-roles.test.ts > the exported roles are exactly what the schema declares` |
| " | Omitting the roles leaves the rejection in force (metadata half; ditto) | `cli/test/contract-roles.test.ts > omitting every grant leaves the role list empty, not omitted` |
| A reference to a table the schema does not own has no relation | A relation to an unmanaged target is absent | `cli/test/contract-emit.test.ts > no relation is derived for an unmanaged target` |

- [x] 5.1 `[design]` Settle the contract's file layout and the shape of
      the interface — one file or several, and what the metadata
      constant holds. Start from `cli/test/contract-emit.test.ts > two
      runs write byte-identical files`. ~9m
      **Settled, planner-confirmed:** one file, `.hejbro/vendor/
      contract.ts` — proposal.md's own text already says "one type
      file", so this was barely open. The `Database` interface mirrors
      Supabase's own generated shape (`Tables`/`Views`/`Functions`/
      `Enums`); `Views`/`Functions` are always present and always
      `{[key: string]: never}` with a comment naming R2-G2's 2.8 as the
      reason (not "none declared") — distinguishing "not supported yet"
      from "this schema genuinely has none", per an earlier planner
      note asking for exactly that. `Tables` is keyed by the bare SQL
      table name, not schema-qualified — the mirror is flat
      (proposal.md, "the emitted mirror is flat"). Metadata:
      `{commit, exportHash, roles, tables}` — `exportHash` is a sha256
      of the exact `schema.json` bytes (same value as `hejbro.lock`'s
      own `schemaHash`), read as "the identity of the export" half of
      "The contract names the point it was generated from"; `ref` was
      considered and dropped, since the requirement is a function of
      the *commit*, not of which ref resolved to it. `tables` (planner
      follow-up, see 5.6's own note below) is a runtime name map, added
      after the first draft's `{commit, exportHash, roles}` was found to
      be short one thing R2-G6 cannot do without.
      **Recorded, not built (planner's own follow-up, out of this
      group's scope):** the contract living inside a dot-directory
      (`.hejbro/vendor/`) is invisible to a human browsing the tree and
      some bundlers/toolchains skip dot-directories outright. Making the
      output path consumer-configurable may be needed later; reopening
      the config surface for it now would cost more than it returns
      today, so this is a filed note, not a task.
- [x] 5.2 Emit the row, insert and update shapes per table from the
      description. Start from `cli/test/types/contract-types.test.ts >
      row keys are the declared TypeScript keys`. ~9m
- [x] 5.3 Write optionality decided at emission: defaulted optional,
      computed absent, identity-by-default optional. Start from
      `cli/test/types/contract-types.test.ts > defaulted optional,
      computed absent, identity optional`. ~8m
      **`serial` gap closed, not accepted (planner asked to check
      before accepting it — the check paid off):** `hasDefault` is
      re-derived from the vendored snapshot alone (an explicit
      `default`, an `identity`, or ownership by a synthesized sequence)
      since `@hejbro/core`'s own `hasDefault` flag (`insert-input.ts`)
      is declaration-time-only and never reaches a snapshot. A `serial`/
      `smallserial`/`bigserial` column decomposes to its base integer
      type before it ever reaches a snapshot (`table-kind.ts`'s
      `materializeTypeNode`) and its `nextval(...)` default lives on a
      separately synthesized `sequence` object rather than the column —
      but that object records its own owner (`SequenceSnapshot.table`/
      `.column`, `sequence-kind.ts`, exported specifically for this kind
      of cross-reference — its own doc comment says so), so
      `columnOwnedBySequence` (`contract/read-snapshot.ts`) derives
      "the database fills this in" without a new sidecar fact. Covered
      by `types/contract-types.test.ts > a serial column is optional on
      insert`. No R2-G2 delta change, no follow-up issue needed.
- [x] 5.4 Element nullability, numeric mode and enum values, each from
      its carried fact. Start from `cli/test/types/contract-types.test.ts
      > non-null elements are not nullable`. ~8m
      A `bigint`/`numeric` column with no recorded mode does **not**
      share one fallback type: `bigint` defaults to `bigint` and
      `numeric` defaults to `string` (`@hejbro/core`'s own
      `DefaultBigintMode`/`DefaultNumericMode`, `numeric-mode-defaults.ts`
      — neither exported publicly, so `contract/ts-type.ts` restates the
      two literals). A first draft that shared one "no mode → number"
      fallback was caught by its own red test going the wrong shade of
      green before this was fixed — worth naming since it is exactly the
      kind of drift `ts-type.ts`'s own doc comment now warns against.
- [x] 5.5 Brands do not cross. Start from
      `cli/test/types/contract-types.test.ts > a brand does not cross`.
      ~5m
      Needed no code: a `TypeNode` never carries a `$type` brand at all
      (it is a `ColumnBuilder`-only, type-level-only fact), so nothing
      here could leak one even by accident. The task's own work was the
      test proving it, not a guard.
- [x] 5.6 The metadata constant and the factory, with the binding done
      inside the generated module so no type parameter reaches the
      caller. Start from `cli/test/contract-emit.test.ts > the factory
      takes only a connection`. ~9m
      **`createDb`'s body: planner-confirmed placeholder** — it throws a
      clear, coded-free `Error` naming why (`@hejbro/query`'s name-keyed
      client doesn't exist until R2-G6) — every schema-vendoring
      scenario about the contract this group owns is a static-type or
      metadata property, never a runtime query, so nothing in this
      group's own delta needs `createDb` to work yet. Wiring a real body
      is R2-G6's own task, not a rewrite of this file's shape (mirrors
      5.10's own G6 deferral).
      **Metadata gained a fourth field, `tables` (planner correction to
      5.1's own first draft):** `{commit, exportHash, roles}` alone
      cannot build SQL — a client needs the SQL identity behind every TS
      key (a table's `{schema, name}`, a column's TS-key→SQL-name map),
      or it would have to read `schema.json` at runtime, breaking the
      "import one file" surface the contract exists to give. Carries no
      value-conversion policy (numeric mode, etc.) — additive once R2-G6
      reveals what it actually needs, per the planner's own "additive
      when needed" principle applied to this one field only. Covered by
      `contract-emit.test.ts > carries every table's schema, SQL name,
      and TS-key-to-SQL-name column map`.
- [x] 5.7 The origin stamp as an exported value. Start from
      `cli/test/contract-emit.test.ts > exports the commit and export
      identity`. ~6m
- [x] 5.8 The exported role list. Start from
      `cli/test/contract-roles.test.ts > the exported roles are
      accepted`. ~6m
      **Narrowed, mirroring 5.10's own precedent (self-determined,
      flagged for confirmation):** this group proves the *metadata*
      half only — `contractMetadata.roles` carries exactly what the
      schema declares. "Supplied roles are accepted"/"an unlisted role
      is still rejected" name *runtime* acceptance/rejection through a
      real client, which does not exist until R2-G6 — the same client
      dependency 5.10's own note already made explicit for the
      execution proof. Renamed the two red tests accordingly
      (`the exported roles are exactly what the schema declares` /
      `omitting every grant leaves the role list empty, not omitted`).
      **D106 finding B2**: this narrowing renamed the tests but never
      propagated to the delta's own requirement text, which kept
      describing a "consumer passes the roles explicitly" interaction
      the shipped factory (one-parameter `createDb`) makes impossible.
      Fixed by revising the requirement to the model that actually
      shipped — opt-in moved from construction time to call time
      (`client.as({role})`) — with a third, previously-missing observer
      added (`roles.test.ts`: no role is active without calling
      `as()`). See `blackbox/` for why the gap survived.
- [x] 5.9 No relation for an unmanaged target. Start from
      `cli/test/contract-emit.test.ts > no relation is derived for an
      unmanaged target`. ~6m
      `Relationships` mirrors Supabase's own generated shape
      (`{foreignKeyName, columns, referencedRelation,
      referencedColumns}`, SQL names throughout) — populated only when
      the foreign key's target table exists in the vendored snapshot;
      the referencing column itself is unaffected either way (still a
      plain scalar in `Row`/`Insert`/`Update`).
- [x] 5.10 Determinism and the absence of a clock, asserted on the
      emitted files themselves (byte-identity across two runs, no
      timestamp/host substring) — not by loading and executing the
      module, since no client to run it against exists until R2-G6
      (that proof is 6.11). Start from
      `cli/test/contract-emit.test.ts > two runs write byte-identical
      files`. ~9m
- [x] 5.11 `[design]` Wire `vendor` to the contract: call `contract/*`
      and write the contract file alongside the description and the
      squashed SQL, on every update run. Decide whether the lock's hash
      list grows to cover the contract too, so `vendor --check` catches
      a hand-edited contract the same way it already catches a
      hand-edited description or SQL file. Start from
      `cli/test/vendor.test.ts > vendor also writes the contract file`.
      ~6m
      **Decided: yes, the lock's hash list grows** — `contractHash`
      alongside `schemaHash`/`sqlHash` (planner-confirmed): the contract
      is the easiest of the three vendored files to touch by hand (the
      one a consumer's own code imports), so excluding it from `--check`
      would leave the most likely tamper outside the gate the scenario
      exists to close.
- [x] 5.12 A vendored contract cannot author migrations, refused by
      name. **Discovered gap, not in the original task list**: the
      SHALL/scenario table above already names this group's own
      "A consumer holds a contract, not declarations" requirement
      (`contract-authority.test.ts`, both its scenarios), but no task
      5.1–5.11 implemented it — the fifth planning gap this change has
      surfaced, and the first of the "scenario listed, no task closes
      it" shape rather than "task running long". `loader.ts` had no
      owner in R2 (the old group 3 that once owned it is already closed)
      — **planner-assigned to this group**, `est_frozen 81m → 88m`.
      Start from `cli/test/contract-authority.test.ts > nothing in the
      contract can be passed to generation`. ~7m
      **Judged by what a contract always carries, never by what a user
      could rename or relocate (planner's own design note, echoing the
      overwrite guard's "the check is textual, on the value, never the
      path" principle):** `loader.ts`'s new `hasContractMetadataExport`
      checks for the `contractMetadata` export itself — the one thing
      every file `hejbro vendor` ever writes always carries — not the
      file's name or its `.hejbro/vendor/` location. A matching module
      refuses immediately with the new `vendored-contract-declared`
      code, before falling through to the generic `entry-not-found`/
      "exports nothing" diagnostics, neither of which names a
      repository. "The contract yields no declaration" needed no
      separate guard: `contractMetadata`/`createDb` carry no
      `declarationKind`, so the existing `isHejbroInput` filter already
      excluded them — the new check only makes the *reason* specific.

**Re-freeze: 75m → 81m → 88m.** First move (75→81, before this group
started): 5.11 added for the vendor↔contract wiring the original list
never carried a task for. Second move (81→88): 5.12 added mid-
implementation for a real gap in the delta's own scenario table that no
task closed — an oversight in the task list itself, not a task running
long.

## R2-G6 — The name-keyed client — `est_frozen: 96m` — #599

Files: `packages/query/src/client/*` (new),
`packages/query/test/client/*` (new),
`packages/cli/src/contract/emit.ts` (shared with R2-G5, additive only —
6.12 replaces the placeholder `createDb` body, never touches
`renderDatabaseInterface`/`renderMetadata`'s own output shape),
`examples/cli-smoke/test/vendored-contract.test.ts` (new, 6.12's own
round-trip proof), `biome.json` (new override for
`packages/query/src/client/**`/`test/client/**`/`test/exports.test.ts` —
`Row`/`Insert`/`Update`/`Tables` deliberately mirror the contract's own
PascalCase field names, the same exception `packages/core/src/kinds/**`
already carries for snapshot field names).

**The one group with no comparable predecessor.** Its estimate is the
least trustworthy in this change, and a re-freeze, if one happens,
happens here.

- [x] 6.1 `[design]` Settle what the client takes and how much of the
      existing chain and compiler it reuses: whether the metadata
      constant feeds the same statement compiler with names where table
      values used to be, or a parallel path. This decides the size of
      everything below it. Start from `query/test/client/select.test.ts
      > selects and types rows from the contract`, which is where the
      choice first becomes observable. ~10m
      **Settled, planner-confirmed: construction, not comparison.**
      `contractMetadata` carries enough per-column facts
      (`typeNode`/`mode`/`notNullElements`) to reconstruct a real,
      queryable `Table` value at runtime (`synthesizeTable`,
      `@hejbro/query`'s own new `client/synthesize.ts`) — the same public
      mechanism `@hejbro/core`'s `existingTable()` uses for "a table this
      repository does not own" (`tableMeta` is a `Symbol.for`
      global-registry symbol, confirmed against `@hejbro/supabase`'s
      `authUsers` as a real cross-package precedent). The reconstructed
      table feeds the already-shipped, unmodified `db()` handle, so
      select/insert/update/deleteFrom/relations/roles all come from the
      existing compiler and executor — 6.5/6.9 hold **by construction**,
      not by a separate comparison. Metadata carries only the three
      facts `db/convert.ts` actually reads at runtime (planner condition
      ④) — `primaryKey`/`unique`/`defaultValue` are hardcoded `false`/
      `null` in the synthesized `ColumnState`, documented as never read.
- [x] 6.2 `[design]` Settle the surface: what `createDb(conn)` returns
      and how a table is reached on it, in the shape the contract
      already teaches. Start from the same test as 6.1 — the two
      decisions are settled together and first observed there. ~9m
      **Settled, owner-sealed ("봉인 (가)"):** `createNameKeyedDb
      <TDatabase>(conn, metadata)` returns one client object keyed by
      table name (`NameKeyedDb`). Each table exposes `select`/`insert`/
      `update`/`delete`, plus **`columns`** — a plain-`Expr` bag (the
      owner's own accessor name, from the sealed example `db.post.
      columns.status`) a caller combines with the already-public `eq`/
      `and`/`or` to build a `.where()` predicate:
      `client.posts.select().where(eq(client.posts.columns.id, value))`.
      `select()` returns a real filterable/orderable/limitable chain
      (`NameKeyedSelectChain`, `.where`/`.orderBy`/`.limit`/`.offset`,
      thenable, `.compile()`); `update`/`delete` return a filterable
      terminal (`NameKeyedMutationChain`, `.where`). The owner's own
      reasoning (recorded, not re-derived): a second filter dialect would
      be the same "permanent tax" that ruled out table values crossing
      in the first place — reuse, not a second grammar, or the choice
      contradicts itself. `columns` never carries declaration authority
      (no `.notNull()`, no `[tableMeta]`) — a leaf `Expr`, outside what
      the "no `Table`" seal restricts. Also exposes `.as(context)`
      (role-scoping, R2-G5 5.8's own functional half, closed here) —
      never needed the filter ruling since `DbContext` is a plain
      `{role, settings?}` value. Planner condition ①, "no `Table` in the
      client's public types", is a type-level exact-key assertion plus a
      runtime own-symbol-property check (`no-table-leak.test.ts`), not a
      comment — the one observation that tells "`ColumnRef` is exposed,
      `Table` is not" apart.
- [x] 6.3 Select against a named table, typed from the contract. Start
      from `query/test/client/select.test.ts > selects and types rows
      from the contract`. ~10m
- [x] 6.4 Insert and update, honouring the write optionality the
      contract emitted. Start from `query/test/client/write.test.ts >
      rejects a computed column in an insert`. ~10m
      A computed column has no key in `Insert`/`Update` at all (5.3's
      own exclusion) — proven as a compile-time `@ts-expect-error`, not a
      runtime check, since the client's own types come from the
      contract's static `Insert`/`Update`, never re-derived from the
      loosely-typed synthesized table. `update`/`delete` also gained
      `.where(eq(...))` once the filter seal landed (6.2) — narrowing
      which rows are touched, the same `columns` bag `select()` uses.
- [x] 6.5 The compiled SQL equals what the declaration-based path
      compiles for the same query. Start from
      `query/test/client/parity.test.ts > compiles to the same SQL as
      the declaration path`. ~10m
      True by construction (6.1) — passed on the first run, both times.
      Two scenarios, both through the real `createNameKeyedDb` wrapper
      (not a lower internal seam): a plain whole-table select, and — once
      the filter seal landed — a `.where(eq(...))`-filtered one, per the
      planner's own note that the unfiltered case alone would leave this
      design's largest reused surface (the compiler's own `where`
      rendering) unverified.
- [x] 6.6 Relations, where the contract carries them. Start from
      `query/test/client/relations.test.ts > follows a carried
      relation`. ~9m
      Proven at the same internal seam as 6.5 (`synthesizeTable`'s own
      reconstructed `foreignKeys` feed `db/related.ts` unchanged) —
      exposing `.related()` on the public per-table client is a further
      surface decision (its own projection shape) not covered by the
      filter seal, so this still proves the mechanism, not the public
      surface.
- [x] 6.7 The role whitelist reaches the client from the contract's
      exported list. Start from `query/test/client/roles.test.ts >
      accepts a role the contract exports`. ~8m
      Closes the runtime half R2-G5 5.8 deferred here — `client.as({role:
      ...})` accepts a role the contract exports and rejects one it
      doesn't (`undeclared-role`), through `db()`'s own already-shipped
      whitelist, fed `contractMetadata.roles`.
- [x] 6.8 Errors name the contract, not internals: a table that is not
      in the contract fails saying so. Start from
      `query/test/client/errors.test.ts > names a table absent from the
      contract`. ~8m
      A `Proxy` over the client object (`wrapWithTableGuard`) refuses an
      unknown table name with a coded, contract-naming error before a
      raw "Cannot read properties of undefined" ever surfaces — reachable
      when a caller's own `TDatabase` type disagrees with
      `contractMetadata` at runtime (hand-edited, or generated against a
      different commit), which the type system alone cannot catch.
- [x] 6.9 The existing declaration-based surface is untouched. Start
      from the query package's existing suites, run unchanged. ~8m
      True by construction (6.1: zero changes to `db.ts`/`chain.ts`/
      `compile.ts`) — the full existing suite (57 files, 802 tests before
      this group's own additions) still passes unchanged.
- [x] 6.10 The type-level claims in this group are evidenced by
      `check-types`, not by the test runner, and the cross-package pins
      read built output — so the build precedes the check. Start from
      `query/test/client/select.test.ts`'s type assertions, verified
      under `check-types` after a build. ~8m
- [ ] 6.11 **Moved to R2-G9 9.2 — not skipped, relocated.** The execution
      proof 5.10 deferred here (load a real emitted contract, run a real
      query through it end to end against a live database) belongs where
      the full loop is already alive: R2-G9's own Docker-gated
      `polyrepo.integration.test.ts` raises a real database from vendored
      SQL and queries it through the contract (9.2). Building a second
      Docker harness here, next to that one, would be the harness-level
      instance of exactly the "second copy of the same fact" shape this
      change has repeatedly cut (planner's own framing) — flagged rather
      than built without confirmation (see the prior commit's own note,
      superseded by this one), and the planner's own call was to move it,
      not duplicate it. The full async execution path minus a live
      Postgres — table synthesis → `db()` → compile → a real driver's
      `execute` → row conversion → resolve — is still exercised for real
      in `select.test.ts`/`write.test.ts`/`roles.test.ts`/
      `parity.test.ts`, and `examples/cli-smoke`'s round-trip test (6.12)
      proves a real `hejbro vendor` output against the real installed
      package via a real `tsc --strict` — neither needs a live database,
      so neither is redone at 9.2; 9.2's own addition is specifically
      what mocks *cannot* prove: real row conversion off a real driver's
      wire format (see R2-G9 9.2's own updated note). Time moves with
      the task, both groups' own re-freeze notes below.
- [x] 6.12 Replace R2-G5's placeholder `createDb` body
      (`packages/cli/src/contract/emit.ts`'s `CREATE_DB_FACTORY`) with a
      real call into this group's own client — the third "group A built
      it, group B calls it" seam this change has had, discovered by the
      planner rather than left implicit. Start from
      `cli/test/contract-emit.test.ts > the emitted factory returns a
      working client`. ~6m
      `createDb = (conn: Driver) => createNameKeyedDb<Database>(conn,
      contractMetadata)` — `Driver`/`createNameKeyedDb` imported from
      `"hejbro"` (not `"@hejbro/query"` directly), since a consumer
      already depends on `hejbro` and its barrel re-exports query's full
      surface (`packages/cli/src/index.ts`, `export * from
      "@hejbro/query"`) — no second dependency for the one thing a
      vendored contract needs from it. Proven by a genuine round trip,
      not a unit test alone: `examples/cli-smoke`'s new
      `vendored-contract.test.ts` runs the **built** CLI end to end
      (`init` → `generate --export` → git commit → `link` → `vendor` in
      a second temp repo) and then a real `tsc --strict` against the
      resulting `contract.ts`, resolving `hejbro` through a real
      `node_modules` symlink to the built package — the one proof
      packages/cli's own aliased-source unit tests structurally cannot
      give.

**Re-freeze: 90m → 96m → 102m → 96m.** First move (90→96, before this
group started): 6.11 added for the execution proof 5.10 deferred here.
Second move (96→102, before this group started): 6.12 added for the
placeholder-replacement seam R2-G5 knowingly left open and reported, but
that no task closed — the sixth planning gap this change has surfaced.
Third move (102→96, planner-directed, after 6.1-6.10/6.12 landed): 6.11
relocated to R2-G9 9.2, where a live database loop already exists —
building a second Docker harness in this package would duplicate that
proof, not add to it. R2-G9's own re-freeze carries the matching +2m
(not the full 6m: 9.2 already had its own estimate for the parts of
this proof it always owned).

## R2-G7 — The consumer's check — `est_frozen: 45m → 94m` — #600

Files: `packages/cli/src/vendor/state.ts` (new),
`packages/cli/src/commands/vendor.ts`, `packages/cli/src/vendor/lock.ts`,
`packages/cli/src/vendor/git-diagnostic.ts`, `packages/cli/src/git.ts`,
`packages/cli/src/tty.ts` — not `packages/cli/src/config.ts` (that file
is `hejbro.config.ts`'s own shape, D30, and turned out unrelated to this
group's boundary logic; the original file list assumed a connection that
wasn't there).

**Re-freeze: 45m → 94m** (actual: 94m across 7.1/7.2/7.3/7.5 including
three mid-implementation corrections, 7.4 left structurally partial).
Planner-attributed, in four parts, so the ledger separates
implementation pace from coordination cost (the parts overlap the
underlying task-times.csv rows rather than partitioning them exactly —
a rough split by cause, not a re-audit of the row totals):
- **+19m — planning underestimate.** Two members (2's other half, and
  7) needed genuinely new code with no task row of their own,
  discovered while wiring the rest of the group; ordinary scope growth
  against the original estimate, not a mistake by anyone.
- **+15m — a planner approval error, corrected.** The first-approved
  design for member 10 was itself wrong (see 7.1's own note below): it
  had to be built, then found wrong, then removed.
- **+5m — the same correction, corrected again across a crossed
  message.** The `file://` fixture question was answered twice,
  oppositely, because two messages crossed in transit and each
  answered a different snapshot of the same state.
- **+14m — a final-review finding, not a planner-approval error this
  time.** A full-repo count of shipped `vendor-*` codes (13) against
  the enumeration's own claimed count (10, at the time) surfaced a real
  gap this implementer's own work had left uncaught: the enumeration
  test proved its eleven — later ten — members distinct from each
  other, but nothing ever checked the count against the actual code
  set. This one is implementation pace, not coordination cost — the
  gap was in the code and tests this group shipped, not in a design
  decision handed down and later reversed.

The middle two are recorded as the planner's own coordination cost, not
this implementer's pace, per the planner's own request; the last is
recorded as this implementer's own gap, for the same reason in reverse.
7.1's own
design needed a real correction after landing: a local replacement was
found not to be reachable by any caller in this change at all (see
7.1's own note below) and was dropped from the enumeration entirely —
**eleven becomes ten**, in this same edit, everywhere the
count was cited.

| SHALL (delta) | Scenario | Red test |
|---|---|---|
| Each way vendoring can fail is named separately | The eleven situations are told apart | `cli/test/vendor-states.test.ts > reports eleven distinct codes` |
| " | A commit with no export names the other repository | `cli/test/vendor-states.test.ts > names the owning repository` |
| " | A lock naming a lost commit is not silently moved | `cli/test/vendor-states.test.ts > fails and leaves the lock unchanged` |
| " | Being behind is advice, not failure | `cli/test/vendor-states.test.ts > staleness does not fail the check` |
| A description format newer than the reader is refused | A newer format is refused with the command that fixes it | `cli/test/vendor-states.test.ts > refuses a newer format and names the upgrade` |
| " | An older format is read | `cli/test/vendor-states.test.ts > reads an older format with absent facts absent` |
| The schema filter is reserved | The reserved filter is refused | `cli/test/vendor-states.test.ts > refuses the reserved schema filter` |

- [x] 7.1 `[design]` Settle the eleven codes and their remedies, and
      decide whether the two boundary situations — a local replacement
      active, and a lock resolved from a non-default ref — are one code
      or two. They differ in remedy, which argues for two; the boundary
      rule below may collapse them. If they collapse, the delta's count
      and every sentence citing it move in the same edit. Start from
      `cli/test/vendor-states.test.ts > reports eleven distinct codes`.
      ~10m
      **Corrected mid-implementation, planner-directed, twice (the first
      correction pass itself needed re-correcting): "a local replacement
      is active" is dropped, not collapsed with the other — eleven
      becomes ten.** The first approval (10/11 stay separate, judged from
      a committed `source`'s own shape) was itself wrong, and not merely
      unreachable but actively harmful the way it was first coded: the
      owner's own design names a local path as a **first-class,
      legitimate source** (a monorepo consumer commits `hejbro link
      ../schema`, and that repository's own CI has that neighbor checkout
      too) — "a local replacement" is a *different*, `replace`-shaped
      situation instead: an uncommitted, gitignored override sitting
      *beside* the committed source. This change builds no `replace` in
      any R2 group, so per the enumeration's own qualifying rule ("a
      situation earns a place only if it is reachable by some caller in
      this change") it is not a member at all. The scheme-based
      heuristic this task first shipped could not tell the two apart —
      it would have failed a legitimate monorepo consumer's CI (`vendor
      --check` defaults to strict outside a TTY) for committing exactly
      the configuration the owner designed for. Building a flag to make
      the situation reachable (inverted priority — enumerating what
      doesn't exist yet) and gating the legitimate configuration instead
      (breaking real workflows for an unreached situation) were both
      rejected as symptom treatment; the first fixture workaround
      (`file://`-scheme sources in this suite's own tests) was masking
      exactly that harm; production code cannot be handed the equivalent
      escape hatch a fixture can. Removed for good:
      `vendor-local-source-active`, `vendor/state.ts`'s
      `isLocalSource`/`warnIfLocalSource`, and the matching describe
      block and enumeration-test scenario. The `file://`-scheme fixture
      change is **kept, but as an incidental improvement, not a
      workaround** — a real schema repository is named by a URL, so it
      is simply the more realistic fixture, now that nothing depends on
      it to avoid a false positive. Records the absence in the delta
      spec (`schema-vendoring/spec.md`) the same way R2-G9's own header
      records a different absence — a later reader can reconstruct why,
      and it returns to the enumeration when `replace` lands.
      **Settled and kept**: the lock-resolved-from-a-non-default-ref
      situation stays, since `--ref` is real and reachable today.
      `resolvedBy: "default-branch" | "explicit-ref"` is its lock field,
      asymmetric-tolerant: an old lock missing it reads as
      `"default-branch"` and never breaks (same discipline as the
      format-skew rule, member 6). `packages/cli/src/vendor/state.ts`
      houses `warnIfNonDefaultRef` (always-advisory, used at `vendor`
      itself — see 7.2) and `assertBoundaryAtCheck` (the strict/warn
      split, used at `vendor --check`).
      **Two members closed as genuinely new code, found while wiring
      the rest of this group** (neither had its own task row — both
      fell under this task's "settle the codes" umbrella): member 2's
      other half, and member 7. `vendor/git-diagnostic.ts`'s
      `withGitDiagnostic` only ever caught a missing `git` binary
      (ENOENT) — every other git failure (bad URL, unreachable host,
      auth failure) re-threw the raw subprocess error uncaught, crashing
      the process with a stack trace instead of a diagnostic. Fixed:
      catches `HejbroError` first and re-throws it unchanged (a
      more-specific diagnostic from inside the wrapped call, e.g.
      `vendor-export-missing`, must never be re-coded), then
      `isGitBinaryMissing` as before, then everything else as a new
      `vendor-remote-unreachable`, naming the source and the first line
      of git's own stderr (or the error's own message as fallback).
      Member 7 (`vendor-lock-commit-lost`): `git.ts` gained
      `remoteHasCommit(remote, commit): boolean`, sharing a new
      `withFetchedCommit` helper factored out of the existing
      blobless-fetch machinery `readFileAtRemoteCommit` already used.
      `commands/vendor.ts`'s `assertLockCommitNotLost` calls it *after*
      `resolveExport` succeeds — deliberately, since that success
      already proves the remote is reachable, so a `false` here can only
      mean the lock's own commit specifically is gone, never a
      misdiagnosis of total unreachability. `--force` (already the
      destination-file guard's override) is reused rather than inventing
      a second one, matching the enumeration's own remedy text ("a
      decision, not a repair"). Proven with a genuine git-history
      rewrite in `vendor-states.test.ts` (`checkout --orphan` + re-commit
      + `branch -D`/`-m` + `reflog expire` + `gc --prune=now`), not a
      mocked failure — the old commit object is actually gone from the
      fixture repo.
      **Corrected again, final-review finding (F-1b/F-1c, planner token
      `PS-FINAL-FIX-01`): ten becomes eleven — not by resurrecting the
      removed local-replacement member, but because a full-repo count
      found the shipped `vendor-*` codes (13) didn't match the
      enumeration's own count (10).** Two gaps, two different fixes:
      `vendor-git-missing` was never a member at all — it already had an
      owner (`cli-commands`'s "An external tool is an optional
      dependency", scenario "A missing git is explained") and simply
      wasn't grep-able from the enumeration's own text, so the
      requirement now states its own scope explicitly ("obtaining and
      checking a vendored schema", not "whether the tool it depends on
      exists"). `vendor-not-yet-vendored` ("a check is asked for before
      anything has ever been vendored") was a genuine miss: reachable
      (a real test already reached it, via `outdated`), with its own
      remedy (run `vendor`) — it satisfies this enumeration's own
      qualifying rule squarely and had simply never been counted. New
      dedicated test (`names the remedy when --check runs before
      anything has ever been vendored`) plus an 11th enumeration
      scenario. **New: `vendor-code-ownership.test.ts`**, the
      reviewer-requested regression guard for the actual root cause —
      not "the count was wrong" but "nobody was checking the count
      against the real code set". Scans `packages/cli/src` for every
      `vendor-*` code exactly like `check-diagnostic-xref.mjs` scans for
      DEFINED codes, and asserts a hand-maintained ownership map (a)
      covers every code the source can throw and (b) carries no stale
      entry for a code the source can no longer throw — bidirectional,
      so a future addition on either side goes red until someone assigns
      it an owner, the same "size, not just distinctness" gap
      `reports eleven distinct codes` was already flagged (in its own
      updated comment) as never having covered. Also: `biome.json`
      gained a path-scoped override for
      `packages/skills/test/fixtures/preludes/polyrepo-contract.ts` (a
      `typeMember` naming-convention exemption, the same shape as the
      existing `packages/query/src/client/**` precedent) — that fixture
      reproduces Supabase's own generated `Database` shape on purpose
      (R2-G8 8.2's own prelude), and renaming its PascalCase members to
      satisfy this repo's own convention would defeat the fixture's
      entire point; the rationale is recorded as a comment in the
      fixture itself, not just here.
      **A known gap left open on purpose, reviewer-flagged**:
      `vendor-code-ownership.test.ts` binds code ↔ ownership-map ↔ total
      count together, but not to the delta requirement's own prose
      count ("eleven") — the spec's own sentence can still drift alone
      and this guard stays silent. Judgement: leave it. Parsing spec
      prose to cross-check a number is brittle (it breaks on a wording
      change, not just a real drift), and that particular failure mode
      is already caught by human eyes — D106's spec-only review and its
      own counting procedure. Code-side drift is stopped by the guard;
      spec-side drift is stopped by review; neither path is
      undefended.
- [x] 7.2 `[design]` Settle how a run that must fail is told from one
      that may warn. This repository has no precedent for reading a CI
      environment variable, and its habit is an explicit flag first with
      an inferred fallback. Record the basis in one line. Start from
      `cli/test/vendor-states.test.ts > a replacement warns locally and
      fails at the boundary`. ~9m
      **Mechanism**: `tty.ts` gained `resolveStrictMode(flag)`, mirroring
      `shouldUseLinks`'s own explicit-flag-first shape — `--strict`/
      `--no-strict` always win; with neither, a non-interactive terminal
      (CI, or piped output) defaults to failing and an interactive one
      defaults to warning. Tested in both directions in `tty.test.ts`.
      **Where it applies**: reading `vendor`/`vendor --check` literally
      as "warned *locally*" vs. "failed at *the boundary*" — this
      repository's own words, not an invented split — `vendor --check`
      is already the established boundary gate (member 8's own note:
      offline, and the command CI relies on), so the remaining boundary
      member (11, the non-default-ref lock) is *always* advisory at
      plain `vendor` (`warnIfNonDefaultRef`, never throw — an explicit
      `--ref` on your own machine is a deliberate choice, not a
      surprise) and only `vendor --check` applies `resolveStrictMode` to
      actually fail.
- [x] 7.3 Validate the vendored description against its format rather
      than casting it, and raise the situations reading owns. Start from
      `cli/test/vendor-states.test.ts > refuses a description that does
      not answer its format`. ~9m
      `vendor/validate-export.ts` (new) — a zod schema for
      `format.json`/`schema.json`'s own top-level shape (member 5), never
      the blind `as ExportFormatRecord`/`as ExportPayload` cast
      `fetch.ts` used before. The embedded `snapshot` field is
      re-serialized and handed to `@hejbro/core`'s own `parseSnapshot`
      rather than restated as a second schema — one validator for that
      shape, not two that could drift. `fetch.ts`'s `FetchedExport` now
      carries the validated `payload` directly; `commands/vendor.ts` no
      longer re-parses `schemaText` itself.
      **Also closed, found while reading the spec's own requirement list
      alongside this task**: "The schema filter is reserved, not
      silently ignored" — `vendor --schema <anything>` now refuses
      outright (`vendor-schema-filter-reserved`) rather than accepting
      and ignoring it; no filtering feature exists yet, so any value is
      refused the same way.
- [ ] 7.4 Format skew, refused upward with the upgrade command named
      and read downward. Start from `cli/test/vendor-states.test.ts >
      refuses a newer format and names the upgrade`. ~9m
      **Upward half done** (`vendor-export-format-unsupported`, naming
      both versions and the upgrade command) — covered by
      `vendor-states.test.ts`, and left checked off nowhere else since
      this task's own two scenarios aren't both closed yet. **Downward
      half structural, not yet exercisable, left unchecked on
      purpose**: `EXPORT_DESCRIPTION_FORMAT` has been `1` since the
      format existed, so there is no earlier shape to construct a real
      "reads an older format with absent facts absent" fixture against
      — `validateExport`'s own comment records this rather than
      claiming the scenario is proven. Closes for real the day format
      `2` ships. **D106 M4/m7**: the delta's own requirement text now
      states this same boundary explicitly (`schema-vendoring/spec.md`,
      "A description format newer than the reader is refused"), so the
      spec and this note agree rather than the spec silently promising
      more than this task ever closed. Still left unchecked — the
      downward scenario remains genuinely unobservable, not merely
      undocumented.
- [x] 7.5 The enumeration test runs the reader against each situation
      and compares the codes themselves, not their labels. Start from
      `cli/test/vendor-states.test.ts > reports eleven distinct codes`.
      ~8m
      `vendor-states.test.ts > reports eleven distinct codes` (written
      against eleven fixtures, corrected to ten alongside 7.1's own
      mid-implementation correction, corrected back to eleven — a
      different eleventh member — in the final-review pass, F-1b):
      eleven independent fixtures (one per member), each run through
      the real built CLI, `error[<code>]` extracted from `stderr` by
      regex and compared as an ordered array against the eleven
      expected code *strings* — never against the surrounding message
      text — plus a `Set` size check (11) guarding against two members
      quietly sharing one code, the exact regression a label-only
      comparison has missed before (planner's own note). This test's
      own comment now names what it does *not* cover too: distinctness
      among the eleven, never whether a twelfth code exists uncounted —
      that gap is `vendor-code-ownership.test.ts`'s job (see 7.1's own
      final-review note). Members 1/3/4/8/9 get a purpose-built fixture
      here too, rather than reusing another file's test, so this one
      test is a genuine end-to-end cross-check independent of every
      other file's own
      coverage.

## R2-G8 — Documentation, skill and changeset — `est_frozen: 26m → 44m` — #601

Files: `docs/guide/polyrepo.md` (new),
`skills/hejbro/references/polyrepo.md` (new), `skills/hejbro/SKILL.md`,
`packages/skills/test/fixtures/preludes/polyrepo-contract.ts` (new, not
in the original file list — needed once the skill's own snippet-compile
gate, #373, caught the first draft's doc example), `.changeset/*.md`
(new), `scripts/pack-install-smoke.sh`.

**Re-freeze: 26m → 44m** (actual: 44m across 8.1/8.1b/8.2/8.3, plus a
final-review correction). The owner's mid-task addendum (the three-way
boundary section, planner relay PS-PIVOT) landed inside 8.1 rather than
as separate scope, and 8.2's own gate (`@hejbro/skills`'s real TS
type-check of every doc snippet) caught a genuine drift on the first
run — the fix (a proper prelude fixture) cost real time neither task's
own estimate carried, since neither anticipated the guide's own code
examples needing to compile for real. **+6m, final-review finding
(F-1b, planner token `PS-FINAL-FIX-01`, paired with R2-G7's own +14m
for the same finding)**: the guide's failure table and the skill's own
wording both moved from ten to eleven once `vendor-not-yet-vendored`
was recognized as a genuine member — this implementer's own gap, not a
planner-approval reversal, so it's counted as pace here too.
**Correction (D106 M7): that claim was itself wrong for one row.**
`references/polyrepo.md`'s own body text moved to "eleven", but
`SKILL.md`'s References table row — a separate copy of the same count,
one line — was missed and still said "ten" at merge. Fixed by D106's
own pass; the eighth counting failure of this change, and the first
found outside the team that built it.

- [x] 8.1 The guide's body: what crosses and what does not, the command
      surface, and the boundary between local freedom and committed
      state. Gate: `pnpm check:diagnostic-xref`. ~6m
      `docs/guide/polyrepo.md` (new) — what crosses (the IR, the
      generated contract) and what never does (declarations, a live
      database connection, lockstep toolchain versions); the **three-way
      boundary** as its own section, first sentence "if you're in the
      same workspace, use an alias; only cross a repository boundary
      with `vendor`" (owner ruling, planner-directed, added after the
      body's own first draft — monorepo/polyrepo/neighbor-checkout, with
      the trap named explicitly: `link ../schema` *inside* a monorepo is
      a working but unnecessary detour); the five real commands
      (`link`/`vendor`/`vendor --check`/`outdated`, `vendor` covering
      both the first vendor and every later pin move — there is no
      separate `--update` flag), with the sixth (`pull --db-url`)
      explicitly named as **not existing yet** (#604) rather than left
      unmentioned or promised; the four-file pair
      (`hejbro.json`/`hejbro.lock`/the two IR files/`contract.ts`) via
      the `package.json`/`package-lock.json` analogy the owner's own
      education frame already uses; `--strict`'s TTY default and that it
      fires under piped output, not only a recognized CI variable; that
      `vendor` is the only command needing network for the normal
      build/type-check path; and the schema repository's own half
      (`generate --export`, `verify`'s opt-in export-match check).
- [x] 8.1b The guide's failure table: **all eleven, each with the
      repository its remedy sends the reader to**. The cross-reference
      gate runs one way only — it checks that cited codes exist, never
      that every code is cited — so the enumeration is deliberate and
      its completeness is checked by counting the table's rows against
      the delta's list. ~6m
      Eleven rows (updated from ten in the final-review pass, F-1b, once
      `vendor-not-yet-vendored` was recognized as a genuine eleventh
      member — see R2-G7 7.1's own updated note), counted against
      `schema-vendoring/spec.md`'s own requirement list — 8 send the
      reader back to the consumer's own repository, 2
      (`vendor-export-missing`/`vendor-export-invalid`) to the schema
      repository, and 1 (`vendor-export-format-unsupported`) to the
      consumer's own toolchain specifically (upgrade hejbro) rather than
      its repository's files. Also notes, in the same table's footer,
      that a local replacement is deliberately absent (belongs to
      `replace`, which this change does not build) and that staleness is
      `outdated`'s advisory, not a failure.
- [x] 8.2 The skill reference and its row in the References table,
      including the one-line migration for a reader who annotated
      declarations with the general table type. ~8m
      `skills/hejbro/references/polyrepo.md` (new) — the same
      alias-vs-vendor decision as the guide's own, agent-directive and
      terse rather than narrative; explicitly does not restate the
      eleven-code table (points at the guide instead, "two copies of the
      same list is exactly the kind of drift this project avoids
      elsewhere"). `SKILL.md` gained: a `description` clause naming this
      trigger, two new numbered gotchas (11: alias-vs-vendor by
      repository boundary; 12: the `Table`→`DeclaredTable` one-line
      migration, R1's own public-surface change, #580, never previously
      documented in the skill — found while writing this task, closed
      opportunistically since a stale skill is a broken user contract
      per this repo's own "before claiming done" checklist), and a new
      References table row.
- [x] 8.3 One `minor` changeset naming any member of the fixed group,
      plus a database-free reachability assertion for the new commands
      in the pack-install smoke. Gate: `changeset status`. ~6m
      `.changeset/add-polyrepo-sync.md` (new, `hejbro: minor`) —
      `changeset status` confirms all seven fixed-group packages bump
      together. `scripts/pack-install-smoke.sh` gained assertion 6:
      through the real npm-installed tarball's own `hejbro` binary
      (no workspace alias), `link` writes `hejbro.json` with no network
      reachability check of its own, then `vendor --check` and
      `outdated` both report `vendor-not-yet-vendored` — proving the
      four new commands are wired into the installed CLI without a
      database or a network call, the M6-gap shape assertions 3–5
      already established for other packages' exports. A full vendoring
      round trip needs a real git remote and stays R2-G9's own job.
      Passed on the first run.

## R2-G9 — The two-repository witness — **moved to the apply-engine change (#603)** — #602

**Lead decision (PS-PIVOT-R3-09): this group is not built in
add-polyrepo-sync.** 9.2's own requirement — "the consumer raises a
database from the vendored SQL and runs a typed query through the
contract" — is *applying*: raising a database from SQL is exactly what
#603 exists to do, and that change builds its own harness for it
regardless. Building a second one here, sequenced only to be thrown
away or duplicated once #603 lands, would be the harness-level instance
of the "second copy of the same fact" shape this change has repeatedly
cut elsewhere (R2-G6's own 6.11/6.12 split, R2-G7's own reused
diagnostics). The board reflects this: #601 is closed, and #602 is now
a sub-issue of #603, not of #314.

**The row-conversion proof's own path, so a later reader can follow
it across both hops**: R2-G6's own 6.11 ("load a real emitted contract,
run a real query end to end against a live database") was first
relocated to this group's own 9.2 (planner-directed, R2-G6's own
re-freeze note carries that history) rather than duplicating a second
Docker harness in `@hejbro/query`. Now the same proof moves a second
time, whole, to #603 — the group that absorbed it never got to build
it, but the requirement it was answering (real row conversion —
`numeric`/`bigint`/`timestamptz` off a real driver's own wire format,
never SQL identity, which 6.5's own parity test already proved, or the
async pipeline, already exercised end to end against a mock in
6.3/6.4/6.7) travels intact to wherever #603 ends up proving it.

**No live-execution proof exists in this change** — recorded exactly as
it was when this group still lived here, with its destination updated:
this change's entire live-execution coverage is mocked-driver only
(`@hejbro/query`'s own `recordingTransactionalDriver` suite) plus a
real-`tsc`, no-database round trip (`examples/cli-smoke`'s
`vendored-contract.test.ts`, R2-G5 6.12) — both real proofs of their
own claims, neither a live query. The live query itself now comes from
**#603**, not from a future group of this change.

**`est_frozen: 27m` moves with the work, to #603 — it no longer counts
toward this change's own total.** `openspec/task-times.csv` is
untouched: R2-G9 never ran, so it never had a row, and every other row
stays exactly as measured.

Files and tasks below are kept as the record of what was planned here,
not built here, and not deleted — a later reader (in this change or in
#603) can see the original shape without reconstructing it from a
closed issue.

Files (as planned, never created): `packages/cli/test/integration/
polyrepo.integration.test.ts` and its fixtures.

- [ ] 9.1 A fixture schema repository generates, exports and commits;
      a fixture consumer links and vendors from it over a local remote.
      Start from `polyrepo.integration.test.ts > vendors from a real
      git remote`. ~9m
- [ ] 9.2 The consumer raises a database from the vendored SQL and runs
      a typed query through the contract — absorbing R2-G6's own 6.11
      (relocated, not duplicated). What a live run must confirm that a
      mock cannot: **row conversion**, not SQL identity — a `numeric`/
      `bigint`/`timestamptz` column actually arriving as the contract's
      promised type from a real driver's own wire format, not a mock's
      hand-fed JS value. SQL sameness is already 6.5's own parity proof;
      the async execution pipeline itself is already exercised end to
      end against a mock (6.3/6.4/6.7); only the driver's real decoding
      is something no unit test can stand in for. Start from
      `polyrepo.integration.test.ts > queries the raised database
      through the contract`. ~10m
- [ ] 9.3 The schema repository changes, and the consumer's check
      reports staleness without failing, then vendors the change and
      sees it as a diff. Start from `polyrepo.integration.test.ts >
      staleness is advice and the update is a diff`. ~8m

**Re-freeze history kept for the record: 25m → 27m (planner-directed,
before the move to #603).** 9.2 absorbed R2-G6's own 6.11 (relocated
here rather than duplicated) — +2m, not the full 6m 6.11 once carried:
9.2 already owned raising the database and running a typed query; the
only genuinely new scope this absorption added was the row-conversion
assertion (`numeric`/`bigint`/`timestamptz` off a real driver) that
6.11's own text named. That 27m, and the row-conversion scope it
covers, is what now travels to #603.

## Archive procedure — verified, one step you can now skip

**D106 finding, PS-D106-FIX-02**: a reviewer ran `openspec archive
add-polyrepo-sync -y` in an isolated worktree (reverted after) and
observed `+ 24, ~ 1, - 0` — zero removals, so both REMOVED requirements
(`cli-commands`'s "The database driver is an optional dependency" and
`query-type-inference`'s "No generated type artifacts") would have
survived archive alongside their own replacements, the corpus asserting
both a prohibition and its opposite at once.

**Root cause, confirmed by observation, not assumed**: this change's
own delta files headed their REMOVED entries `### Removed: <title>`.
`openspec archive` matches a REMOVED entry against the shipped spec by
the exact header shape ADDED/MODIFIED entries use — `### Requirement:
<title>` — and a `### Removed:` header simply never matches, with no
error surfaced. Two minimal probes confirmed this, both in a detached
`/tmp` worktree, never this one:
1. Every *other* archived change in this repository's own history
   heads its REMOVED entries `### Requirement: <title>`, and their
   removals took (e.g. `align-spec-corpus`'s "The baseline banner
   marker is machine-readable" — gone from the shipped `cli-commands`
   spec today).
2. Changing only this change's own two header lines from `### Removed:`
   to `### Requirement:` (title text byte-identical either way) and
   re-running the same archive produced `- 2 removed`, and the shipped
   specs then carried the new requirement alone.

`schema-export`/`schema-vendoring` are unaffected either way: both are
first-time `create` capabilities (`openspec/specs/` carries neither
today), so their own eleven `### Removed:` entries have no shipped
baseline to remove from regardless of header shape — the archive tool's
own dry-run output never lists a removal for either, before or after
this fix.

**Fix applied here, not deferred to the archive step**: both headers
corrected in this change's own delta files
(`cli-commands/spec.md`/`query-type-inference/spec.md`), each carrying
a one-line note explaining why. This makes the manual-removal
contingency unnecessary — `openspec archive add-polyrepo-sync -y` now
removes both on its own — but the archiver should still **read the
totals line before confirming**: expect `- 2` (not `- 0`), and expect
`cli-commands`'s own "The database driver is an optional dependency"
and `query-type-inference`'s own "No generated type artifacts" to be
absent from `openspec/specs/` afterward. If either check fails, stop
before committing the archive — something about this tool's own
matching changed since this note was written, and that is worth a new
finding, not a silent workaround.
