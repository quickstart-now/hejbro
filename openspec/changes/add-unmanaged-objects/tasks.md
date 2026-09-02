# Tasks: add-unmanaged-objects (#605)

Piece team (planner + implementer). Base: dev at branch creation.
Groups are file-disjoint and sequential (G2 needs G1's marker, G3 needs
G2's export field).

## 1. The snapshot knows an unmanaged table (#605)
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
unmanaged table, so it is not in this group's file list.
`synthesize.ts` is shared with group 3 (marker); the groups run
sequentially, so the two never edit it at once.

- [x] 1.1 (~8m) [design — settled, lead judgement J1/J2] The marker is
      `unmanaged?: true` on the table snapshot node (D33 compact rule:
      absent = managed), read through a `tableUnmanaged()` helper beside
      `tableChecks`/`tablePrimaryKeyName`, written by a
      `unmanagedField(declaration)` spread beside `checksField`/
      `primaryKeyNameField` and set from `TableDeclaration.existing`.
      Indexes/checks/rls need no rule: `existingTable()` fixes them
      empty by construction, so the existing serializer already produces
      the right node and `requiredKeys` stays satisfied. Column-level
      facts are kept as serialized today — the export and the contract
      read them for typing and relations, and a second serializer path
      would be a divergence to maintain. Failing test:
      `existing-table.test.ts` — "records an existing table as unmanaged
      with its declared columns".
- [x] 1.2 (~9m) `generate` accepts an exported `existingTable()`, emits
      nothing for it, and diffs nothing: adding, changing, removing →
      zero statements. The refusal retires at a single chokepoint — the
      guard sits at the top of `tableKind.diff`, before
      `createOrDropDiff`, and returns `[]` when *either* side is
      unmanaged, so a managed↔unmanaged flip emits nothing either (J2).
      The `existing-table-declared` code stays registered with a note.
      Same task, same commit (a task that removes a guard installs its
      replacement): `synthesize.ts` moves its discriminator from
      `existing` to `authority: "usage"`, so `synced-table-declared`
      keeps refusing a vendored contract's table, its own test expecting
      that code instead; `name-keyed-db.ts`'s four `DeclaredTable`
      annotations widen with it. `reserved-schemas.ts`'s comment cites
      the retired refusal and is corrected here.
      Failing tests: `generate.test.ts` — "an unmanaged table produces
      no migration", "changing an unmanaged declaration produces no
      migration", "removing an unmanaged declaration produces no
      migration", "a managed foreign key onto an unmanaged table is
      emitted and the target untouched", "a table changing hands emits
      nothing: managed to unmanaged", "a table changing hands emits
      nothing: unmanaged to managed" (both directions, same subject as
      the delta scenario). `synthesize.test.ts`'s own refusal case splits
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
      skip an unmanaged table; one that judges a *reference* SHALL see
      it unchanged. Full audit (measured, not assumed — see each
      validator's own file for the reachability proof):
      - `packages/core/src/engine/core-validators.ts`'s
        `notNullWithoutDefaultWarnings` — reads diff `changes`, never
        declarations; the DDL-blocking guard already empties `changes`
        for an unmanaged table, so this never reaches one. No fix.
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
        includes an unmanaged table. No fix.
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
      written before it existed) carrying one table with no `unmanaged`
      key, run through `generateMigration` with an empty declaration
      list — the real risk this pins is silent: if `tableUnmanaged`
      misread the absent field as unmanaged, the DDL-blocking guard
      would swallow every drop for every user's pre-existing table on
      upgrade. Failing test: `snapshot.test.ts` — "an older snapshot's
      tables are still managed" (asserts both `tableUnmanaged(node) ===
      false` and that the run's SQL actually contains `drop table
      "app"."posts"`). The D33 compact-rule doc line was already written
      in 1.1's own commit (`TableSnapshot.unmanaged`'s doc comment: "A
      snapshot written before this field existed has no unmanaged
      tables") — nothing to add there. Mutant: `tableUnmanaged` to
      `snapshot.unmanaged ?? true` — explosive by design (every managed
      table in the whole suite lacks the field, so the DDL guard now
      misreads all of them as unmanaged): 131 red across 18 files/1462,
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
      `unmanaged: boolean`, **always present** (`false` for a managed
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
      unmanaged table **already** reaches `tables` post-group-1 (measured
      directly: schemaName/tableName/exportName/columns all present,
      only the marker missing) — the writer red is "marked as such," not
      "appears at all," which was already true. ② the reader file is
      exactly `packages/cli/src/vendor/validate-export.ts`. ③
      `EXPORT_DESCRIPTION_FORMAT = 1` (`export/format.ts`), checked by
      `assertDescriptionFormatSupported` in the same reader file; an
      older format is read as-is (no shim exists yet, none needed).
      Failing tests: `export-write.test.ts` — "carries an unmanaged table
      marked as such" (asserts the unmanaged table's `unmanaged: true`
      **and** the managed table's `unmanaged: false` in the same test);
      `export-determinism.test.ts` — "a table fact's keys are
      alphabetically sorted, `unmanaged` included" (extends the
      determinism fixture with an unmanaged table); new file
      `validate-export.test.ts` (direct unit test of `validateExport`,
      no CLI subprocess needed — it does no I/O of its own) — "a current
      export's unmanaged table reads back as unmanaged" and "an export
      written before the marker reads as managed" (hand-written
      pre-marker JSON, never built by our own writer — same reasoning as
      1.3's snapshot fixture: a writer-built fixture already carries the
      field one way or the other and proves nothing about a file written
      before it existed).
      Mutant (a), writer (`tableFact` in `description.ts`): hardcode
      `unmanaged: false` regardless of `meta.existing` → exactly 1 red
      (the writer test), the two reader tests and the determinism test
      stay green (12/13 in the three files together).
      Mutant (b), reader (`validate-export.ts`): drop `.default(false)`,
      making `unmanaged` a required field → exactly 1 red (the
      pre-marker reader test, which now throws `vendor-export-invalid`
      instead of returning), the writer test and the current-export
      reader test stay green (12/13).
- [ ] 2.2 (~9m) `check` compares nothing about an unmanaged table and
      omits it from the inventory. Includes the loader's own
      characterization (planning error corrected: `loader.ts` collects
      every `isTable()` export already, so an exported `existingTable()`
      needs no loader change once group 1 lands — and `loader.ts`'s
      vendored-contract refusal, R2-G5 5.12, keys on the module's
      `contractMetadata`, not on `existing`, so it stays exactly as it
      is). Failing tests: `loader.test.ts` — "an exported existing table
      is loaded as a declaration"; `check-command.test.ts` — "an
      unmanaged declaration is neither compared nor inventoried".
- [ ] 2.3 (~5m) `reset` drops nothing of an unmanaged table and `raise`
      ignores it. Failing test: `reset-command.test.ts` — "reset drops no
      unmanaged table".

## 3. The contract, the client, and the witness (#605)
Files: `packages/cli/src/contract/{tables,emit}.ts`, `packages/query/src/
client/{synthesize,name-keyed-db,contract-types}.ts`, `packages/
supabase/src/auth-tables.ts` (doc), `examples/*/test/*vendor*.test.ts`,
`skills/hejbro/references/{brownfield-adoption,polyrepo}.md` (measure
names), `docs/specs/2026-08-19-hejbro-design.md` (D41 amendment note),
`.changeset/*.md`. `synthesize.ts` is shared with group 1 (see there).

- [ ] 3.1 (~9m) [design] The contract emits the unmanaged table's
      `Row`/`Insert`/`Update` and marks its client metadata; relations
      onto it resolve (the "no relation" rule narrows to undeclared
      tables). Failing tests: contract emit test — "emits an unmanaged
      table under Tables, marked"; relation test — "a foreign key onto a
      declared unmanaged table resolves to a relation".
- [ ] 3.2 (~9m) The two-repository witness: the examples' supabase
      schema exports `authUsers` as unmanaged; the consumer reads a
      managed table joined to it against a real server (PG15/PG17).
      Failing test: the existing witness gains the join.
- [ ] 3.3 (~7m) Skill sentences (brownfield: an exported `existingTable`
      is now a declaration that emits nothing — the sentence naming the
      hard error goes; polyrepo: unmanaged tables cross the boundary),
      the D41 amendment note beside the decision's own row (the original
      text is never deleted, only annotated: "amended by
      add-unmanaged-objects (#605) — an exported existingTable is a
      declaration that emits nothing; pending owner ratification"),
      `minor` changeset, ledger rows. The changeset body MUST carry, near
      verbatim, the user-facing half of 1.2's exemption restoration:
      "preset validators (Supabase, Nile) skip unmanaged declarations —
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
