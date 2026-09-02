# Tasks: add-unmanaged-objects (#605)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint and sequential (G2 needs G1's marker, G3 needs
G2's export field).

## 1. The snapshot knows an existing table (#605)
Files: `packages/core/src/kinds/{table-snapshot,table-kind}.ts`,
`packages/core/src/engine/generate.ts`, `packages/core/src/dsl/
existing-table.ts` (doc only), `packages/core/test/**`,
`packages/query/src/client/{synthesize,name-keyed-db}.ts`,
`packages/query/test/client/synthesize.test.ts`,
`packages/supabase/src/validators/{schema-of,reserved-schemas,
exposed-tables,rls-cached-auth-outside-rls}.ts` and their tests (upgraded
from comment-only, R1-06/R1-08: a real, reachable exemption, not a
premise cleanup — see 1.2's own body), `packages/nile/src/validators.ts`
and its test. `packages/core/src/engine/core-validators.ts` is measured
(1.2's own body) but **not opened for a fix** — R1-08 closed that
condition: both its validators are structurally unreachable from an
existing table, so it is not in this group's file list.
`synthesize.ts` is shared with group 3 (marker); the groups run
sequentially, so the two never edit it at once.

- [x] 1.1 (~8m) [design — settled, lead judgement J1/J2] The marker is
      `existing?: true` on the table snapshot node (D33 compact rule:
      absent = managed), read through a `tableExisting()` helper beside
      `tableChecks`/`tablePrimaryKeyName`, written by an
      `existingField(declaration)` spread beside `checksField`/
      `primaryKeyNameField` and set from `TableDeclaration.existing`.
      Indexes/checks/rls need no rule: `existingTable()` fixes them
      empty by construction, so the existing serializer already produces
      the right node and `requiredKeys` stays satisfied. Column-level
      facts are kept as serialized today — the export and the contract
      read them for typing and relations, and a second serializer path
      would be a divergence to maintain. Failing test:
      `existing-table.test.ts` — "records an existing table as such,
      with its declared columns" (renamed 2.1b, R1-05 — see that task).
- [x] 1.2 (~9m) `generate` accepts an exported `existingTable()`, emits
      nothing for it, and diffs nothing: adding, changing, removing →
      zero statements. The refusal retires at a single chokepoint — the
      guard sits at the top of `tableKind.diff`, before
      `createOrDropDiff`, and returns `[]` when *either* side is
      existing, so a managed↔existing flip emits nothing either (J2).
      The `existing-table-declared` code stays registered with a note.
      Same task, same commit (a task that removes a guard installs its
      replacement): `synthesize.ts` moves its discriminator from
      `existing` to `authority: "usage"`, so `synced-table-declared`
      keeps refusing a vendored contract's table, its own test expecting
      that code instead; `name-keyed-db.ts`'s four `DeclaredTable`
      annotations widen with it. `reserved-schemas.ts`'s comment cites
      the retired refusal and is corrected here.
      Failing tests: `generate.test.ts` — "an existing table produces
      no migration", "changing an existing declaration produces no
      migration", "removing an existing declaration produces no
      migration", "a managed foreign key onto an existing table is
      emitted and the target untouched", "a table changing hands emits
      nothing: managed to existing", "a table changing hands emits
      nothing: existing to managed" (both directions, same subject as
      the delta scenario; renamed 2.1b, R1-05). `synthesize.test.ts`'s own refusal case splits
      in two: "is rejected by HejbroInput's own type, not just at runtime
      (type pin — evidence is check-types, not vitest; mirrors
      core/test/types/declared-table.test.ts's own usage-table pin)" and
      "is refused at runtime too, for the caller the type layer never saw
      (a JS/jiti caller with no compile step, engine/generate.ts's own
      `authority === "usage"` guard)", the latter now `synced-table-
      declared`.

      **Exemption restoration (lead J6-1/J6-2), same task, its own second
      commit** (items 1-3 above already landed as `9855c9b8` before this
      slice was ordered — see that commit for the retirement/DDL-guard/
      authority-migration half): before this task, no
      preset validator ever saw an `existingTable()` declaration —
      `resolveTableDeclarations`'s retired `existing-table-declared`
      guard refused it before `normalized` was ever built, so every
      validator's own "existingTable is exempt" was a structural fact,
      never a check. Retiring that guard makes every validator that
      filters on `declarationKind === "table"` see one for the first
      time. J6-2's rule: a validator that judges *managed DDL* SHALL
      skip an existing table; one that judges a *reference* SHALL see
      it unchanged. Full audit (measured, not assumed — see each
      validator's own file for the reachability proof):
      - `packages/core/src/engine/core-validators.ts`'s
        `notNullWithoutDefaultWarnings` — reads diff `changes`, never
        declarations; the DDL-blocking guard already empties `changes`
        for an existing table, so this never reaches one. No fix.
      - `packages/core/src/engine/core-validators.ts`'s
        `rlsUnreachableSchemaWarnings` — filters `PolicyDeclaration`;
        `existingTable()` hardcodes `rls: null` (no builder option to
        set it), so it can never produce one. No fix.
      - **Supabase: one shared predicate.** Measured every caller of
        `schema-of.ts`'s `isTableDeclaration` first (lead's own
        instruction, R1-08): its only *other* uses are internal to
        `schemaOf`/`declaredAtOf` (generic field-extraction dispatchers,
        not DDL judgment — `schemaOf`'s only caller is
        `reservedSchemaValidator` itself; `declaredAtOf`'s two other
        callers pass a `ViewDeclaration`/`PolicyDeclaration`, never a
        table). So a *second*, narrower predicate was added —
        `isManagedTableDeclaration` (`isTableDeclaration(d) &&
        !d.existing`) — rather than redefining `isTableDeclaration`
        itself (which would have silently changed `schemaOf`/
        `declaredAtOf`'s own generic meaning for every future caller).
        All three DDL-judging validators below import the one new
        predicate:
        - `reserved-schemas.ts`'s `reservedSchemaValidator` (D38).
          Failing tests: `reserved-schemas.test.ts` — "an existingTable
          in a reserved schema is exempt (add-unmanaged-objects, J6-2)"
          and its control "a managed table in auth is still refused (the
          exemption does not swallow the protection)".
        - `exposed-tables.ts`'s `exposedTableValidator` (D40, "declare
          rls(...)" is unactionable for a builder with no rls option).
          Failing test: `exposed-tables.test.ts` — "does not warn on an
          existingTable in a schema granted to anon/authenticated
          (add-unmanaged-objects, J6-2 — its builder has no rls(...)
          option to declare)".
        - `rls-cached-auth-outside-rls.ts`'s
          `rlsCachedAuthOutsideRlsValidator` (a default/check/
          index-predicate becoming real SQL — included per lead
          judgement even though `indexes`/`checks` are always `[]` for
          an `existingTable()` by construction and only a
          deliberately-written `.default(authUidCached())` can ever
          reach it: the six sites are one pattern, and leaving one
          unfixed reads as "rare in practice", not a contract). Failing
          test: `rls-cached-auth-outside-rls.test.ts` — "does not error
          on an existingTable's column default calling authUidCached()
          (add-unmanaged-objects, J6-2 — never emitted as real DDL)".
        Mutant (one, on the shared predicate): drop `&&
        !d.existing` → all three failing tests above go red at once
        (measured: 3 red/141), every other test in the 17-file suite
        stays green, including `reserved-schemas.test.ts`'s own control.
      - `packages/supabase/src/validators/view-security-invoker.ts`'s
        `viewSecurityInvokerValidator` — filters `ViewDeclaration`, and
        its `protectedTables` set is built from `RlsDeclaration` the
        same way `rlsUnreachableSchemaWarnings` is — structurally never
        includes an existing table. No fix.
      - `packages/supabase/src/validators/rls-uncached-auth-call.ts`'s
        `rlsUncachedAuthCallValidator` — filters `PolicyDeclaration`,
        same reasoning as `rlsUnreachableSchemaWarnings`. No fix.
      - `packages/nile/src/validators.ts`'s `nileSerialValidator`/
        `nileTenantPrimaryKeyValidator`/`nileIdentityValidator` (all
        three: managed DDL, tenant-aware table constraints Nile would
        have to run) — all three call sites of the file's own
        `isTableDeclaration` are managed-DDL-judging (measured: `grep
        isTableDeclaration` finds exactly these three, nothing else), so
        the exclusion moved into the predicate itself, renamed
        `isManagedTableDeclaration` (a name that quietly excluded
        existing tables while still called `isTableDeclaration` would
        lie about itself). Failing test: `validators.test.ts` — "an
        existingTable is not validated as a managed table" (one test,
        one declaration set exercising all three rules at once).
      - `packages/nile/src/validators.ts`'s `nileRlsValidator`/
        `nileFunctionTriggerValidator`/`nileGrantValidator` — filter
        Rls/Policy/Function/Trigger/Grant declarations; `existingTable()`
        cannot produce any of them. No fix.
      - `packages/neon`: zero validators registered. N/A.
      Nile mutant (on `isManagedTableDeclaration`, the renamed and
      excluding `isTableDeclaration`): drop the exclusion → the one
      combined failing test above goes red (measured: 1 red/59), every
      other test — including task 4.5's own "what the platform accepts
      is untouched" control — stays green.
- [x] 1.3 (~5m) Older snapshots read as all-managed — a behavioral pin,
      not a marker-presence check: a hand-written, pre-marker `Snapshot`
      literal (never built by `buildSnapshot`, which always writes the
      marker one way or the other and so can never stand in for a file
      written before it existed) carrying one table with no `existing`
      key, run through `generateMigration` with an empty declaration
      list — the real risk this pins is silent: if `tableExisting`
      misread the absent field as existing, the DDL-blocking guard
      would swallow every drop for every user's pre-existing table on
      upgrade. Failing test: `snapshot.test.ts` — "an older snapshot's
      tables are still managed" (asserts both `tableExisting(node) ===
      false` and that the run's SQL actually contains `drop table
      "app"."posts"`). The D33 compact-rule doc line was already written
      in 1.1's own commit (`TableSnapshot.existing`'s doc comment: "A
      snapshot written before this field existed has every table
      reading as managed") — nothing to add there. Mutant: `tableExisting`
      to `snapshot.existing ?? true` — explosive by design (every managed
      table in the whole suite lacks the field, so the DDL guard now
      misreads all of them as existing): 131 red across 18 files/1462,
      confirmed the new test is among them (its own file: 1 red/82).
      Reverted, full suite green (97 files/1461+1 todo).

## 2. The export and the check (#605)
Files: `packages/cli/src/loader.ts`, `packages/cli/src/export/
description.ts`, `packages/cli/src/vendor/validate-export.ts` (reader
half, added to this group's scope by 2.1's own lead judgement),
`packages/cli/src/check/compare.ts`, `packages/cli/src/
check/inventory.ts`, `packages/cli/src/commands/{reset,raise}.ts` (skip),
`packages/cli/test/**`

- [x] 2.1 (~8m) [design — settled, lead judgement] `ExportTableFact` gains
      `existing: boolean` (named `unmanaged` at first landing, renamed by
      2.1b — see that task), **always present** (`false` for a managed
      table) — the opposite of the snapshot's compact convention,
      because `export/description.ts`'s own doc comment already commits
      this file's format to "every field is a plain, always-present JSON
      value" (medium-appropriate, not a new rule). **No description-
      format bump** (`EXPORT_DESCRIPTION_FORMAT` stays 1): additive field,
      and bumping would make every older-format reader refuse an export
      it could otherwise read. The read side carries the real risk:
      `vendor/validate-export.ts`'s `tableFactSchema` (zod) reads an
      absent key as `false` (`z.boolean().default(false)`) — a required
      field there would refuse a perfectly valid pre-add-unmanaged-
      objects export for a fact it never claimed to carry.
      Pre-measured (lead's own instruction, before writing code): ①
      `buildExportDescription`'s `isDeclaredTable` is `isTable`, so an
      existing table **already** reaches `tables` post-group-1 (measured
      directly: schemaName/tableName/exportName/columns all present,
      only the marker missing) — the writer red is "marked as such," not
      "appears at all," which was already true. ② the reader file is
      exactly `packages/cli/src/vendor/validate-export.ts`. ③
      `EXPORT_DESCRIPTION_FORMAT = 1` (`export/format.ts`), checked by
      `assertDescriptionFormatSupported` in the same reader file; an
      older format is read as-is (no shim exists yet, none needed).
      Failing tests: `export-write.test.ts` — "carries an existing table
      marked as such" (asserts the existing table's `existing: true`
      **and** the managed table's `existing: false` in the same test);
      `export-determinism.test.ts` — "a table fact's keys are
      alphabetically sorted, `existing` included" (extends the
      determinism fixture with an existing table); new file
      `validate-export.test.ts` (direct unit test of `validateExport`,
      no CLI subprocess needed — it does no I/O of its own) — "a current
      export's existing table reads back as existing" and "an export
      written before the marker reads as managed" (hand-written
      pre-marker JSON, never built by our own writer — same reasoning as
      1.3's snapshot fixture: a writer-built fixture already carries the
      field one way or the other and proves nothing about a file written
      before it existed). Wording renamed 2.1b (R1-05) — see that task.
      Mutant (a), writer (`tableFact` in `description.ts`): hardcode
      `existing: false` regardless of `meta.existing` → exactly 1 red
      (the writer test), the two reader tests and the determinism test
      stay green (12/13 in the three files together).
      Mutant (b), reader (`validate-export.ts`): drop `.default(false)`,
      making `existing` a required field → exactly 1 red (the
      pre-marker reader test, which now throws `vendor-export-invalid`
      instead of returning), the writer test and the current-export
      reader test stay green (12/13).
- [x] 2.1b (~15m) [design — settled, lead judgement, R1-05/R1-06]
      **Rename the marker `existing`, not `unmanaged`, everywhere it is
      our own concept.** Decision axis: not "are the two senses
      confusable" but "does this concept already have a name" — the DSL
      (`existingTable()`), core's `TableDeclaration.existing`, and the
      vendored client's `authority`/`existing: true` all already say
      `existing`; `unmanaged` would have been a fourth name for the same
      thing, and the one that collides with `hejbro check`'s own shipped
      "unmanaged" (a catalog table no declaration covers at all —
      `check/inventory.ts`'s `UnmanagedTable`, unaffected). `check`'s own
      inventory type/text and this feature's DSL/id (`add-unmanaged-objects`,
      directory, branch, issue title) are untouched by design.
      Scope: core's snapshot marker (`existing?: true`), reader
      (`tableExisting`), serializer helper (`existingField`), diff-guard
      predicate (`isExistingSide`); the export field
      (`ExportTableFact.existing`) and its zod key
      (`existing: z.boolean().default(false)`); every test name/comment
      describing *our* concept across core/cli/query/supabase/nile
      (validator doc comments already said "existing table" generically
      enough not to need touching, except three that said "an unmanaged
      table's"). `isManagedTableDeclaration` (nile, supabase) is
      unaffected — "managed" is already the right word, not a fourth
      name for "existing". `check/inventory.ts` gains one disambiguating
      doc-comment line (R1-06 item 1, constraint-only) on
      `UnmanagedTable`.
      Machine-checked residue (grep `unmanaged` across
      `packages/*/src`, `packages/*/test`,
      `openspec/changes/add-unmanaged-objects/**`, this file included):
      every remaining hit is one of exactly three kinds — ① `check`'s
      own inventory (type/field names, `commands/check.ts`'s rendered
      text, and the tests pinned to both, including `check-inventory.test.ts`,
      `check-compare.test.ts`, and `check-command.test.ts`'s
      pre-existing 5.1-section tests); ② the change id/path string
      `add-unmanaged-objects` itself (directory, branch, issue title,
      doc-comment attributions); ③ this file's own historical/comparison
      prose (this section, and the `cli-commands` delta's contrast
      sentence). A fourth, pre-existing sense also survives untouched
      and was confirmed unrelated by reading each site: `apply/ledger.ts`,
      `contract/read-snapshot.ts`, `contract/ts-type.ts`,
      `apply-raise.test.ts`, `apply-reset.test.ts`, `contract-emit.test.ts`
      all cite an *earlier* change's own "an object no declaration
      covers"/"a target the export does not describe" vocabulary (task
      references "5.9"/"6.2", predating add-unmanaged-objects), which is
      the same axis as `check`'s inventory concept, not this one — left
      alone as out of this change's scope.
      Same commit as the five spec documents the lead already staged in
      the worktree (`proposal.md` + all four capability deltas) — spec
      sentences first, code proving them second, never split across two
      commits. `7db42527` (2.1's own commit) is NOT amended (lead
      ruling, R1-06): once a report quotes a SHA for specific content,
      amending it — pushed or not — makes the quoted evidence false.

- [x] 2.2 (~9m) `check` compares nothing about an existing table and
      omits it from the inventory.

      **Name-collision measurement (lead-flagged, R1-03/R1-04),
      resolved by 2.1b (R1-05/R1-06)**: `check/inventory.ts` already had
      `UnmanagedTable`/`unmanagedTables` — "a catalog table no
      declaration covers at all," a different axis from this task's
      "declared but not managed." Measured: the word reaches
      user-facing stdout (`commands/check.ts:138`, `` `unmanaged table
      (not covered by any declaration): ${schema}.${table}` ``), so this
      was an observable-contract question, not an internal-naming one —
      correctly held rather than decided unilaterally. Lead ruling:
      rename *our* concept to `existing` (2.1b); `check`'s own
      "unmanaged" stays exactly as it was. `UnmanagedTable` gains one
      disambiguating doc-comment line (R1-06 item 1).

      **`compare.ts`**: `compareTable` returns `[]` immediately for an
      `existing: true` node, before the catalog lookup even runs (zero
      comparisons, not a shape-diff skip) — `LocalTableSnapshot` gains
      the same optional `existing?: true` mirror the rest of this
      file's compact-format locals already use.
      **`inventory.ts`**: needs no code change beyond the R1-06
      disambiguating comment — measured, not assumed.
      `declaredTableIdentities` already reads every `"table:"` snapshot
      key regardless of managed/existing, so an existing declared
      table's identity is already "declared" for this file's own
      purposes and was never going to appear in `unmanagedTables` (that
      inventory concept is catalog-vs-undeclared, and this table *is*
      declared). Verified by mutant (b) below, not left untested just
      because untouched.
      **`loader.ts`**: no code change — `loadDeclarations`'s
      `isHejbroInput` calls `isTable()` before any `declarationKind`
      check, matching any `Table` regardless of `existing`, so an
      exported `existingTable()` was already collected once group 1
      landed. Characterization pin, **green on arrival** (not a failing
      test — the plan's "failing test" wording predates group 1 landing
      the loader-relevant half); load-bearing shown by mutant, not by
      red.

      Failing test (1, `compare.ts`'s own fix): `check-command.test.ts`
      — four independent `it`s under "an existing declaration is
      neither compared nor inventoried" — "no difference is reported for
      it" (①), "is absent from the inventory section" (②), "the exit
      code is unaffected" (③), and "the word `unmanaged` never appears
      in the report, even though an existing table is declared" (④,
      R1-06 item 2 — reuses this file's own line-179 stdout-absence
      idiom, phrase-independent of ①-③), sharing one scenario (a
      declared existing table whose catalog counterpart has a genuinely
      different column type — proves the skip runs before any shape
      comparison, not that the shapes happened to agree). Split into
      independent `it`s specifically so a mutant that breaks only one
      side doesn't hide behind the others.
      Characterization pin (0 red, already true): `loader.test.ts` — "an
      exported existing table is loaded as a declaration" (new fixture
      `test/fixtures/existing-table/`, since `fixtures/basic`'s own table
      count is asserted elsewhere and would break if extended).

      Mutant (a), `compare.ts`'s skip removed: findings ① and exit-code
      ③ go red (measured: 2/20), inventory ② stays green — proving ②
      never depended on compare.ts at all.
      Mutant (b), `inventory.ts`'s `declaredTableIdentities` narrowed to
      exclude existing tables (a probe mutant proving ②'s own test is
      load-bearing despite no real code existing to remove): only ②
      goes red (measured: 1/20), ① and ③ stay green — the reverse
      independence, and the reason "no fix needed" above is a measured
      claim, not an assumption.
      Mutant (c), `loader.ts`'s `isHejbroInput` narrowed to
      `isTable(value) && !getTableMeta(value).existing`: exactly 1 red
      (the new loader test), the other 8 in that file stay green —
      proves the characterization pin is load-bearing even though it
      arrived green.
- [x] 2.3 (~9m) `reset` drops nothing of an existing table; `raise` and
      `baseline` measured, neither needs a fix.

      **Measured first, per instruction, before writing anything.**
      **`reset`**: `apply/reset.ts`'s `planReset` (`diffSnapshots`) and
      its DDL-generating `resetMigrationSql` (`generateMigrations`) both
      route through core's `tableKind.diff`, which opens with the
      group-1 `isExistingSide` guard (`table-kind.ts:627`) before
      `createOrDropDiff` runs — structurally the same chokepoint
      `generate`/`baseline` already rely on, no reset-specific code
      exists to add a skip to.
      **`raise`**: `apply/raise.ts`'s `SnapshotFile`/`applyRaise` never
      touch a `Snapshot` or declarations at all — only opaque migration
      SQL text (`{fileName, sql, origin}`) and the ledger. Structurally
      no existing-table-specific test is constructible here; the
      pre-existing `apply-raise.test.ts:206` ("never refuses over an
      object this snapshot's own DDL does not touch (an unmanaged object
      is not a declared one)") already covers the identical
      "raise doesn't inspect anything beyond its own text" reasoning,
      under `check`'s own unrelated "unmanaged" sense (left untouched by
      2.1b, category ②) — a new pin here would assert the same absence
      of behavior a second time, not a different one, so none was added.
      **`baseline`**: `commands/generate.ts`'s `runGenerate` calls the
      identical `generateMigrations({declarations, previousSnapshot,
      ...})` for `mode: "generate"` (line 672/729, first and final pass)
      and `mode: "baseline"` — `mode` only gates
      `assertBaselineIsFirst`/`throwBaselineNothingToAdopt` and report
      text (`reportHead`), and the `baseline: mode === "baseline"` flag
      passed into the final pass only marks the emitted migration's own
      banner (`engine/generate.ts:170-171`, doc comment: "Core only
      renders the marker; deciding when it is legal is the CLI's job").
      No diff-logic branch reads `mode` or `baseline` — baseline shares
      `generate`'s exact code path through the group-1 guard, so this
      task owns baseline's coverage too (proposal.md's claim; tasks.md
      had no task naming it before this one).
      **G3 pre-measurement** (cheap, reported only — judgement reserved
      for the lead): `contract/emit.ts` and `contract/tables.ts` have
      zero case-insensitive occurrences of `unmanaged` or `existing` —
      the marker doesn't reach contract text yet, so 3.1 starts from a
      clean file with no collision to resolve.

      Test added: `apply-reset.test.ts` — "leaves a declared-but-existing
      table standing, and never counts it toward the drop confirmation"
      (an `existingTable()` alongside a managed table; asserts
      `planReset`'s own change list excludes it entirely, so it never
      raises the confirmation count, and that the DDL `applyReset` sends
      never mentions its schema). Green on arrival (0 red) — the
      group-1 guard already covers it; not a failing-test task, a
      probe-mutant one.
      Probe mutant: `table-kind.ts`'s `isExistingSide(previous) ||
      isExistingSide(next)` guard replaced with `false`. Exactly 1 red
      (the new test) across the file's 11, the other 10 (including the
      pre-existing "leaves an unmanaged table standing" test, `check`'s
      own sense) stay green — proves reset's "no fix needed" claim is
      measured, not assumed, the same technique 2.2 used for
      `inventory.ts`. Reverted; core rebuilt; file back to 11/11 green,
      `git diff` on `table-kind.ts` empty.

## 3. The contract, the client, and the witness (#605)
Files: `packages/cli/src/contract/{tables,emit}.ts`, `packages/query/src/
client/{synthesize,name-keyed-db,contract-types}.ts`, `packages/
supabase/src/auth-tables.ts` (doc), `examples/*/test/*vendor*.test.ts`,
`skills/hejbro/references/{brownfield-adoption,polyrepo}.md` (measure
names), `docs/specs/2026-08-19-hejbro-design.md` (D41 amendment note),
`.changeset/*.md`. `synthesize.ts` is shared with group 1 (see there).

- [x] 3.1 (~20m) [design — settled, lead judgement] The contract marks
      an existing table's client metadata; `Row`/`Insert`/`Update` and
      relation resolution were already true (measured, not assumed).

      **Design (lead ruling, not reopened)**: the marker is **compact**
      `existing?: true` on `contractMetadata`'s own per-table meta —
      present only for an existing table, absent for a managed one
      (opposite of the export description's always-present convention,
      D57: generated code is read and diffed by a person, so the common
      case carries no noise). The marker is **client-metadata only** —
      the `Database`/`Tables` TypeScript interface is untouched
      (Supabase-style consumer compatibility; the delta only requires
      metadata). No code reads the mark today — carried for the reader
      of the generated file and for tooling built on it (the sentence
      the lead staged into `specs/schema-vendoring/spec.md`, bundled
      here unedited).

      **Pre-measurement confirmed both green-on-arrival claims by
      actually running `emitContract`** (throwaway probe, not
      committed): a managed table referencing an `existingTable()`
      already emitted the existing table fully under `Tables`
      (`Row`/`Insert`/`Update`) and the relation already resolved
      (`referencedRelation: "auth.users"`) — the only thing missing was
      the marker itself.

      **Edit points** (all three found by measurement, no others
      needed): `contract/tables.ts`'s `TableComputation` gains
      `existing: boolean`, sourced once from the snapshot node
      (`table.existing === true`) so both renderers that read this
      shared array can never disagree about it, even though only the
      metadata renderer uses it; `TableClientMeta` gains `existing?:
      true` plus a `clientMetaExistingField` helper (mirrors core's own
      `existingField` — `{}` or `{ existing: true }`, spread into
      `buildTableClientMeta`'s return); `query/src/client/
      contract-types.ts`'s `ContractTableMeta` mirrors the same field
      (this package restates the shape rather than importing it, `hejbro`
      never being a dependency of `@hejbro/query`); `contract/emit.ts`'s
      `renderTableClientMetaEntry` is a **hand-written per-field
      renderer** (`JSON.stringify` per line), so the type addition alone
      does not print — a conditional `existingMetaLine` helper
      (`""` or `"\t\t\texisting: true,\n"`, if/return, no ternary) had
      to be added and spliced into the rendered entry.

      **`name-keyed-db.ts` boundary (tf coexistence)**: confirmed by
      reading — `createNameKeyedDb` forwards `ContractTableMeta` to
      `synthesizeTable` untouched, no field-level branching. **Not
      opened** for 3.1 — the marker needed no runtime consumer there.

      **Red — proved by executing the generated module, not by
      pattern-matching its text** (planner instruction, after this repo
      has previously shipped a module that passed every text assertion
      and still threw on load): new test support
      `test/support/load-emitted-contract.ts` transpiles `emitContract`'s
      real output with `typescript`'s own `transpileModule` and
      dynamically `import()`s it from inside `packages/cli/` (never
      `node_modules/` or `/tmp` — Node's package self-reference needs an
      unbroken walk-up to `package.json`'s own `exports` field to
      resolve the emitted file's `import ... from "hejbro"`; measured
      that a `node_modules`-nested temp dir breaks that walk),
      auto-cleaned after every call. Test (`contract-existing.test.ts`)
      — "emits an existing table under Tables, marked": loads the real
      module, asserts `contractMetadata.tables.users.existing === true`
      and (compact's other side) `"existing" in
      contractMetadata.tables.posts === false`. Confirmed genuinely red
      before this task's code (`existingMetaLine` temporarily forced to
      always return `""`) — exactly 1 red, the other 2 new tests stayed
      green; reverted, green again.

      **Two green-on-arrival pins, each proved load-bearing by its own
      probe** (not left untested just because pre-existing): "green on
      arrival: an existing table already appears under Tables with its
      own Row/Insert/Update" (text-based — a TS interface has no runtime
      value to load) and "a foreign key onto a declared existing table
      resolves to a relation" (text-based, mirrors the sibling "carries
      a relation to a managed target" test). The existing "no relation
      is derived for an unmanaged target" (`contract-emit.test.ts`
      123-143, the undeclared-target axis) is cited as the control, not
      duplicated.
      Probe (entry presence): `computeTables` (emit.ts) temporarily
      filtered `!entry.existing` — exactly 2 red (the marker test and
      the entry-presence pin, both of which depend on the table's whole
      computation surviving), the relation pin and all of
      `contract-emit.test.ts`'s own 9 tests stayed green (relation
      resolution reads the raw snapshot independently of this filtered
      array). Reverted.
      Probe (relation, surgical): `buildRelationships` (`tables.ts`)
      temporarily excluded an existing target
      (`target.existing === true`) from resolving. Exactly 1 red (only
      the relation pin) across the 12 tests in `contract-existing.test.ts`
      + `contract-emit.test.ts` together — the marker pin, the
      entry-presence pin, and the existing undeclared-target control all
      stayed green, showing the two axes (existing vs. undeclared) are
      independently guarded. Reverted.

      Gates: `TURBO_FORCE=1 build --force` (7/7), `check` (645 files
      clean), `check-types` (16/16, 0 cached), `test` (64 files/512
      tests, 0 cached — +1 file/+3 tests over G2's close).
- [ ] 3.2 (~9m) The two-repository witness: the examples' supabase
      schema exports `authUsers` as existing; the consumer reads a
      managed table joined to it against a real server (PG15/PG17).
      Failing test: the existing witness gains the join.
- [ ] 3.3 (~7m) Skill sentences (brownfield: an exported `existingTable`
      is now a declaration that emits nothing — the sentence naming the
      hard error goes; polyrepo: existing tables cross the boundary),
      quoting the two-senses distinction verbatim (R1-06 item 3): "hejbro
      does not manage a table for one of two reasons — no declaration
      covers it at all (`check`'s own inventory), or a declaration
      covers it with `existingTable()` (never in the inventory)." The
      D41 amendment note beside the decision's own row (the original
      text is never deleted, only annotated: "amended by
      add-unmanaged-objects (#605) — an exported existingTable is a
      declaration that emits nothing; pending owner ratification"),
      `minor` changeset, ledger rows. The changeset body MUST carry, near
      verbatim, the user-facing half of 1.2's exemption restoration:
      "preset validators (Supabase, Nile) skip existing declarations —
      they judge managed DDL" — a real behavior change (a warning/error
      that used to fire on a declared `existingTable()` no longer does),
      not an internal refactor, so it belongs in the `minor` changeset's
      own body, not just this file.

## Verification (definition of done, not a task)
`openspec validate add-unmanaged-objects --strict`; `openspec show
add-unmanaged-objects --diff` with zero warnings; `TURBO_FORCE=1 pnpm
check / check-types / test / check:bans / check:crap`; `pnpm build
--force` then the cli subprocess suites and `pnpm --filter hejbro
test:integration` on both majors; the D106 gate before archive.
