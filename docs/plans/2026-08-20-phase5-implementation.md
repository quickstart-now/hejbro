# Phase 5 — CLI (`hejbro init` / `generate` / `verify`): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `hejbro` CLI — `init`, `generate`, and `verify` — so an
`examples/` project generates migrations end-to-end from TypeScript
declarations, fully non-interactively (AI-agent- and CI-drivable).

**Architecture:** `packages/cli` gains a real build (tsdown + `bin`), loads
`hejbro.config.ts` and declaration entries through **jiti** (single loader
path), validates config with **zod** (errors re-wrapped in spec-§7 style),
and drives `@hejbro/core`'s existing pure pipeline. Rename ambiguity is
resolved by **CLI flags** (`--rename`, `--confirm-drop`) parsed into pure
data that core's new `planRenames` engine step consumes — core stays pure
(no fs, no clock, no new runtime deps). The single snapshot file gains a
tamper-evident **banner hash chain**: every migration records
`parent-snapshot`/`snapshot` sha256 lines, and `verify` reconstructs the
chain to detect divergent branches.

**Tech Stack:** TypeScript strict, vitest, Biome, pnpm + turbo, tsdown.
CLI runtime deps: `citty` (commands), `jiti` (TS loading), `zod` (config
validation). Core: zero new runtime deps.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` — §6 (pipeline, banner),
§7 (error principles), D6, D12, D13, D14. Roadmap:
`docs/plans/2026-08-19-roadmap.md` §Phase 5. All owner decisions below were
made 2026-08-20 through the Phase 5 brainstorm (recorded here; spec/decision
-log wording updates are Task 2, final wording owner-approved at spec
review).

## Owner decisions (2026-08-20 brainstorm — do not revisit)

| # | Decision |
|---|----------|
| U1 | Declaration/config loader = **jiti only** (native strip-types, tsx rejected). D13 (Node ≥ 22) unchanged. |
| U2 | `hejbro.config.ts` is loaded with the same jiti path as entries; loader fixed by CLI, not configurable. |
| U3 | `defineConfig()` helper + **zod** validation (CLI dep only; zod errors never shown raw — re-wrapped in §7 style). Fields: `entry`, `migrationsDir`, `snapshotPath`, `prefixStrategy` (D14). No preset fields reserved. |
| U4 | CLI framework = **citty**. |
| U5 | Renames resolved **non-interactively via CLI flags** — no TTY prompts in v1, no prompt library. `--rename <schema>.<table>.<old>=<new>` (column), `--rename <schema>.<old>=<new>` (table), `--confirm-drop <schema>.<table>.<column>` / `--confirm-drop <schema>.<table>` (all repeatable). Errors print the **exact rerun command**. Rule A: any same-table drop+add pair (type-agnostic) is ambiguous; cross-table moves are never rename candidates; expand–contract (two generate runs) is the documented no-flag path. |
| Snapshot | **Single snapshot file** (`snapshotPath` kept) + banner carries `parent-snapshot:`/`snapshot:` sha256 of the normalized snapshot text + **compact format** requirement (no key-name duplication, no default values recorded). Divergent branches detected from the banner chain (`error[diverged-migrations]`). Snapshot is derived — recovery via git, never regeneration. |
| U6 | Consistency command = **`hejbro verify`** (`check` reserved for §9 live-DB). Four checks: snapshot parses; declarations ↔ snapshot agree; banner chain is linear; chain tip hash == current snapshot hash. |
| U7 | `init` scaffolds `hejbro.config.ts` + migrations dir + **empty snapshot**; no example entry file; idempotent (never overwrites; reports and exits 0). Missing-entry errors are the onboarding surface. |
| U8 | Watch mode is a **permanent non-goal** (spec wording in Task 2). |
| U9 | npm-pack install-path smoke test deferred to Phase 7–8 (issue below). |
| ③ | Output is **text-only** (no `--json` in v1). Diagnostic grammar: `error[<code>]: <identity>` + body + `Next:` + `at <file> (export "<name>")`, stderr, exit 1. |
| ④ | `--help` is a **short summary** (full rename walkthrough moves to a GitHub Pages doc, Phase 7 issue). Error messages carry the complete instructions, so there is no usability gap. |
| ⑤ | `Next:` marker applies to new errors only; retrofitting Phase 1–4 errors is a Phase 7 issue. |
| ⑥ | All error/help golden texts below are **owner-approved verbatim** — do not reword. |
| ⑦ | Table-level `--confirm-drop <schema>.<table>` (2 segments) approved. |
| ⑧ | `schema()`/`table()` (and column names) validate final SQL names against `^[a-z][a-z0-9_]*$` at declaration time — hard error on violation. |

## Global Constraints

- Core purity: `@hejbro/core` never reads files, never calls `Date.now()`,
  no new runtime deps. sha256 hashing and all fs live in `packages/cli`.
- TS style: no `any`, no `let`/`var`, no `for`/`while`, no ternary
  (owner's `typescript-rules`); Biome tabs + double quotes.
- All GitHub-facing text in English; conventional commits ≤72-char subject.
- Every new error uses the diagnostic grammar (decision ③) and states why +
  what to do (spec §7). Owner-approved golden texts are verbatim.
- Determinism: `generate` is a pure function of (repo state + explicit
  argv). Same inputs → byte-identical outputs. Golden tests pin all
  user-facing text.
- `HEJBRO_SNAPSHOT_VERSION` stays `2` unless the Task 3 audit finds
  violations — any format change is a **stop-and-report-to-main** gate.
- Before claiming any PR done: `pnpm check`, `pnpm check-types`,
  `pnpm test` all pass with output shown — **from a clean state**
  (`rm -rf packages/*/dist` first, or CI green confirmed): stale local
  `dist/` artifacts can mask missing turbo build-dependency wiring
  (learned on PR B, 2026-08-20).

## Issues to create — created (PR E, Task 19)

| # | Title | Parent phase | Issue |
|---|-------|--------------|-------|
| 1 | docs: onboarding example schema page (GitHub Pages) | Phase 7 (#8) | #83 |
| 2 | docs: rename rules page (`--rename`/`--confirm-drop` and the expand–contract walkthrough; revisit help pointer once live) — merged row 4 into this one (same doc page) | Phase 7 (#8) | #84 |
| 3 | docs: `hejbro verify` CI workflow example | Phase 7 (#8) | #85 |
| ~~4~~ | ~~docs: expand–contract two-run generate guide~~ — merged into row 2/#84 | — | — |
| 5 | test: npm-pack install-path smoke (U9) | Phase 8 (#9) — release-readiness/publish-verification, not real-Postgres/examples/skills | #86 |
| 6 | refactor: retrofit `Next:` marker onto Phase 1–4 error messages (⑤) | Phase 7 (#8) | #87 |
| 7 | feat(core): extend `assertSqlName` to explicit (user-pinned) index names — declaration-time validation consistency (PR-A review observation) | Phase 7 (#8) | #88 |
| 8 | feat(cli): support `--flag=value` equals-joined token form in rawArgs parsing and rerun assembly (silently ignored in v1; PR-C review observation) | Phase 7 (#8) | #89 |
| ~~9~~ | ~~feat(cli): `hejbro verify` reports independent check groups together~~ — implemented in PR D (#82), never orphaned | — | — |

Plus one implementation sub-issue of #6 per PR below.

## PR map (each PR is a sub-issue of #6, squash-merged to `dev`)

| PR | Issue | Tasks | Branch | Scope |
|----|-------|-------|--------|-------|
| A — core: rename plan engine + name validation + banner hashes | #74 | 1–7 | `phase5-core-rename-plan` | pure core additions |
| B — cli: package foundation, config, loader, diagnostics, init | #75 | 8–12 | `phase5-cli-foundation` | packages/cli |
| C — cli: generate command + golden texts | #76 | 13–15 | `phase5-generate` | packages/cli |
| D — cli: verify command + chain checks | #77 | 16–17 | `phase5-verify` | packages/cli + core banner parse |
| E — acceptance: examples e2e + roadmap close-out | #78 | 18–19 | `phase5-acceptance` | examples/, docs |

---

## Task 1: Commit the phase docs (PR-A opening commit)

**Files:**
- Already written: `docs/plans/2026-08-20-phase5-implementation.md` (this file)

- [ ] **Step 1: Commit**

```bash
git add docs/plans/2026-08-20-phase5-implementation.md
git commit -m "docs(plans): phase 5 cli implementation plan"
```

## Task 2: Spec + roadmap wording for the phase decisions

**Files:**
- Modify: `docs/specs/2026-08-19-hejbro-design.md` (decision log + §6 + §9)
- Modify: `docs/plans/2026-08-19-roadmap.md` (§Phase 5 bullet refresh)

- [ ] **Step 1: Draft the spec edits** — add decision-log rows (next free D
  numbers) for: jiti loader (U1/U2), zod-validated `defineConfig` (U3),
  citty (U4), flag-based non-interactive renames (U5 + rule A + ⑦),
  single snapshot + banner hash chain + compact format, `verify` (U6),
  `init` scaffold set (U7), strict identifier validation (⑧). Append to §9
  (out of scope): *"Watch mode — permanently out of scope: regenerating on
  every keystroke contradicts migration-per-change-set; `generate` is a
  deliberate, explicit action."* (U8). In §6 step 6, note the two banner
  hash lines. **Do not commit as final until main confirms wording with the
  owner** — open the PR as draft if still pending.

- [ ] **Step 2: Update roadmap Phase 5 bullets** to name `verify`, the flag
  syntax, and the banner hash chain; commit both files:

```bash
git add docs/specs/2026-08-19-hejbro-design.md docs/plans/2026-08-19-roadmap.md
git commit -m "docs(spec): record phase 5 brainstorm decisions"
```

## Task 3: Compact snapshot audit (report-only gate)

**Files:**
- Read: `packages/core/src/kinds/*.ts` serializers, `packages/core/src/snapshot/snapshot.ts`

- [ ] **Step 1: Audit every kind's `serialize` output** against the two
  compact rules: (a) no key-name duplication (identity data appearing both
  as the `objects` key and again inside the node is acceptable only where
  `emit` needs it — list each instance), (b) no default values recorded
  (e.g. a column serializing `notNull: false` explicitly). Produce a table
  in the PR description: kind → violations found.
- [ ] **Step 2: Gate.** If violations exist, **stop and report to main**
  (snapshot format change + version handling is owner-gated). If none,
  record "audit clean, format unchanged, version stays 2" in the PR body
  and proceed. **Expect this gate to fire:** `ColumnSnapshot` currently
  records `notNull`/`primaryKey`/`unique`/`default` even when
  `false`/`null`, which likely violates the no-defaults rule — plan for an
  owner decision interleaving here rather than being surprised by it.

## Task 4: Strict SQL identifier validation (⑧)

**Files:**
- Create: `packages/core/src/sql/identifier-rules.ts`
- Modify: `packages/core/src/dsl/schema.ts`, `packages/core/src/dsl/table.ts`
- Test: `packages/core/test/identifier-rules.test.ts`

**Interfaces:**
- Produces: `assertSqlName(name: string, context: string, declaredAt: string | null): string`
  — returns `name` or throws `HejbroError` code `invalid-sql-name`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { schema, table, text } from "../src";
import { assertSqlName } from "../src/sql/identifier-rules";

describe("assertSqlName", () => {
	it("accepts snake_case names", () => {
		expect(assertSqlName("blog_posts", "table", null)).toBe("blog_posts");
	});
	it("rejects dots, equals, uppercase, and leading digits", () => {
		const bad = ["weird.col", "a=b", "Posts", "1st", ""];
		bad.map((name) =>
			expect(() => assertSqlName(name, "column", null)).toThrowError(
				expect.objectContaining({ code: "invalid-sql-name" }),
			),
		);
	});
});

describe("declaration-time validation", () => {
	it("schema() rejects invalid names", () => {
		expect(() => schema("My.Schema")).toThrowError(
			expect.objectContaining({ code: "invalid-sql-name" }),
		);
	});
	it("table() rejects a column whose snake_case name is still invalid", () => {
		const app = schema("app");
		expect(() => table(app, "posts", { "weird.col": text() })).toThrowError(
			expect.objectContaining({ code: "invalid-sql-name" }),
		);
	});
});
```

- [ ] **Step 2: Run** `pnpm --filter @hejbro/core test identifier-rules` — FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
import { throwHejbroError } from "../error";

const SQL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Enforces decision ⑧ (2026-08-20): every final SQL name must match
 * `^[a-z][a-z0-9_]*$` so identifiers survive `--rename`/`--confirm-drop`
 * flag parsing (`.`/`=` separators) and stay quoting-free. Loosening this
 * later is non-breaking; tightening later would be breaking — so we start
 * strict.
 */
export const assertSqlName = (
	name: string,
	context: string,
	declaredAt: string | null,
): string => {
	if (SQL_NAME_PATTERN.test(name)) {
		return name;
	}
	return throwHejbroError(
		"invalid-sql-name",
		`${context} name ${JSON.stringify(name)} is not a valid hejbro SQL identifier — names must match ^[a-z][a-z0-9_]*$ (lower-case snake_case, no dots or symbols) so they can be referenced from --rename/--confirm-drop flags. Next: rename the ${context} to snake_case.`,
		declaredAt,
	);
};
```

Wire it: `schema()` validates `schemaName`; `table()` validates the table
name and every column's post-`toSnakeCase` name (and index/FK derived names
are built from already-validated parts, so no extra call sites).

- [ ] **Step 4: Run tests** — PASS. Also run the full core suite to catch
  fixtures using non-snake names.
- [ ] **Step 5: Commit** `feat(core): strict sql identifier validation`

## Task 5: `table()` declaration-site capture

**Files:**
- Modify: `packages/core/src/dsl/table.ts` (store `declaredAt` on the
  `TableDeclaration` via the existing `captureDeclarationSite()` — same
  pattern as `defineFunction`)
- Test: `packages/core/test/dsl.test.ts` (extend)

- [ ] **Step 1: Failing test** — `getTableMeta(t).declaredAt` is a string
  containing the test filename (mirror the existing `defineFunction`
  capture test).
- [ ] **Step 2: Implement** — add `readonly declaredAt: string | null` to
  `TableDeclaration`; populate in `table()`. Snapshot serialization is
  **unchanged** (declaredAt never enters the snapshot; rename diagnostics
  read it from live declarations, Task 6).
- [ ] **Step 3: Tests pass; commit** `feat(core): capture table declaration site`

## Task 6: Rename plan engine (`planRenames`) — rule A + flag validation

**Files:**
- Create: `packages/core/src/engine/rename-plan.ts`
- Create: `packages/core/src/sql/rename-sql.ts`
- Test: `packages/core/test/rename-plan.test.ts`

**Interfaces:**
- Produces (all exported from core's index):

```ts
export type ColumnRenameSpec = {
	readonly target: "column";
	readonly schemaName: string;
	readonly tableName: string;
	readonly oldName: string;
	readonly newName: string;
};
export type TableRenameSpec = {
	readonly target: "table";
	readonly schemaName: string;
	readonly oldName: string;
	readonly newName: string;
};
export type RenameSpec = ColumnRenameSpec | TableRenameSpec;
export type ConfirmDropSpec =
	| { readonly target: "column"; readonly schemaName: string; readonly tableName: string; readonly columnName: string }
	| { readonly target: "table"; readonly schemaName: string; readonly tableName: string };

export type RenamePlan = {
	/** previous snapshot with confirmed renames applied (old→new names) */
	readonly rewrittenPrevious: Snapshot;
	/** `alter table … rename …` statements, identity-ordered, emitted first */
	readonly renameStatements: ReadonlyArray<string>;
	/** synthetic banner-only changes, e.g. `~ table app.posts [column "slug" renamed to "handle"]` (quoted names — the existing diff-note convention) */
	readonly renameChanges: ReadonlyArray<KindChange>;
	/** batch-collected diagnostics; non-empty ⇒ caller must not emit SQL */
	readonly errors: ReadonlyArray<HejbroError>;
};

export const planRenames = (options: {
	readonly previous: Snapshot;
	readonly next: Snapshot;
	readonly renames: ReadonlyArray<RenameSpec>;
	readonly confirmedDrops: ReadonlyArray<ConfirmDropSpec>;
	readonly declaredAtByIdentity: ReadonlyMap<string, string | null>;
}): RenamePlan;
```

- Consumes: `Snapshot`, table snapshot nodes (`asTableSnapshot` shape),
  `hejbroError`, `quoteIdentifier`/`qualifyName`, `compareKeys` ordering.

**Algorithm (implements owner decisions U5 + rule A, batch-collected):**
1. Compute per-schema dropped/created table sets and, for tables present in
   both snapshots, per-table dropped/added column name sets (raw sets).
2. Validate specs against raw sets → `unknown-rename-target`,
   `duplicate-rename-target`, `unknown-confirm-drop-target` (owner-approved
   texts, Task 14 golden). Invalid specs do not consume set entries.
3. Apply valid renames: rewrite `previous` (rename column in the table
   node / re-key + rename the table node and every dependent identity —
   indexes, FKs, rls/policy/trigger/grant identities that embed the table
   name — plus **other tables' `referencesTable`/`referencesColumns`
   fields** pointing at a renamed table/column: rewritten in the node only,
   no SQL, since Postgres tracks FK targets by OID and updates them with
   the rename); emit one `alter table "s"."t" rename column "old" to
   "new";` or `alter table "s"."old" rename to "new";` per spec (from
   `sql/rename-sql.ts`), ordered by `compareKeys` on the target identity.
4. **Derived-name statements (drift guard).** Postgres `RENAME` does not
   rename existing indexes or constraints, but hejbro derives their names
   from table + column names (`<table>_<cols>_idx`, `<table>_<cols>_fk`).
   For every index/FK on a renamed table, and every index/FK whose column
   list contains a renamed column, synthesize the matching statement right
   after its owning rename, old-name → new-name (both computed with the
   existing `deriveIndexName`/`deriveForeignKeyName` helpers):
   `alter index "s"."<old>_idx" rename to "<new>_idx";` and
   `alter table "s"."<t>" rename constraint "<old>_fk" to "<new>_fk";`
   (after a table rename, `"<t>"` is the **new** table name — the table
   rename statement has already run). Implementation notes: (a)
   `deriveIndexName`/`deriveForeignKeyName` are currently module-private in
   `table-kind.ts` — export them (or move to a shared module) for
   `rename-plan.ts`; (b) **only** synthesize a derived-name rename when the
   snapshot node's stored name equals `derive(<old names>)` — a
   user-pinned `indexName` is not derived, must keep its name, and gets no
   statement.
   The rewritten previous node carries the new derived names too, so the
   subsequent diff sees no index/FK change — snapshot and database stay
   aligned without a drop/recreate. `renameChanges` (banner entries) are
   ordered by `compareKeys` on the change identity.
5. Remove renamed olds/news and confirmed drops from the raw sets. For each
   table whose residual dropped **and** added sets are both non-empty →
   `ambiguous-column-rename`; for each schema with residual dropped and
   created tables → `ambiguous-table-rename` (rule A; declaredAt from
   `declaredAtByIdentity` of the added/created side).
6. Return the plan; errors non-empty ⇒ `rewrittenPrevious` is unused.

- [ ] **Step 1: Failing tests** (representative set — write all of these):

```ts
import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, HejbroInput } from "../src";
import {
	buildSnapshot, createDefaultRegistry, getTableMeta, isTable, planRenames,
	schema, table, text,
} from "../src";

const app = schema("app");
const registry = createDefaultRegistry();
// table() returns a column-ref proxy (D15); unwrap to its declaration the
// same way generate.ts's resolveDeclarations does before snapshotting.
const unwrap = (input: HejbroInput): HejbroDeclaration =>
	isTable(input) ? getTableMeta(input) : input;
const snap = (...decls: ReadonlyArray<HejbroInput>) =>
	buildSnapshot(decls.map(unwrap), registry);
const noDeclSites = new Map<string, string | null>();

describe("planRenames", () => {
	it("flags a same-table drop+add pair as ambiguous (rule A)", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous, next, renames: [], confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({ code: "ambiguous-column-rename" }),
		]);
	});

	it("a --rename spec resolves the pair into a RENAME statement", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous, next,
			renames: [{ target: "column", schemaName: "app", tableName: "posts", oldName: "slug", newName: "handle" }],
			confirmedDrops: [], declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
		]);
		// rewrittenPrevious now matches next → no further diff changes
	});

	it("a --confirm-drop spec silences the ambiguity and keeps the drop", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous, next, renames: [],
			confirmedDrops: [{ target: "column", schemaName: "app", tableName: "posts", columnName: "slug" }],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([]);
	});

	it("collects all ambiguities across tables in one run (batch)", () => {
		const previous = snap(app,
			table(app, "posts", { slug: text() }),
			table(app, "users", { nick: text() }));
		const next = snap(app,
			table(app, "posts", { handle: text() }),
			table(app, "users", { alias: text() }));
		const plan = planRenames({
			previous, next, renames: [], confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toHaveLength(2);
	});

	it("table drop+create in one schema is ambiguous; --rename rewrites identity", () => {
		const previous = snap(app, table(app, "posts", { id: text() }));
		const next = snap(app, table(app, "blog_posts", { id: text() }));
		const ambiguous = planRenames({
			previous, next, renames: [], confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(ambiguous.errors).toEqual([
			expect.objectContaining({ code: "ambiguous-table-rename" }),
		]);
		const renamed = planRenames({
			previous, next,
			renames: [{ target: "table", schemaName: "app", oldName: "posts", newName: "blog_posts" }],
			confirmedDrops: [], declaredAtByIdentity: noDeclSites,
		});
		expect(renamed.errors).toEqual([]);
		expect(renamed.renameStatements).toEqual([
			`alter table "app"."posts" rename to "blog_posts";`,
		]);
	});

	it("rename + type change yields RENAME plus a residual alter", () => {
		// previous: slug text; next: handle varchar(64) — after rewrite the
		// diff sees handle text→varchar, so emit produces the ALTER TYPE.
		// Implementer: write the full body — assert via
		// diffSnapshots(plan.rewrittenPrevious, next, registry) notes.
	});

	it("renaming an indexed column also renames its derived index", () => {
		// previous: posts(slug text) + index on slug → posts_slug_idx
		// next: posts(handle text) + index on handle → posts_handle_idx
		// --rename app.posts.slug=handle ⇒ renameStatements are exactly:
		//   alter table "app"."posts" rename column "slug" to "handle";
		//   alter index "app"."posts_slug_idx" rename to "posts_handle_idx";
		// and diffSnapshots(plan.rewrittenPrevious, next, registry) is empty.
		// Implementer: write the full body.
	});

	it("unknown-rename-target when old is not dropped or new is not added", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { slug: text() }));
		const plan = planRenames({
			previous, next,
			renames: [{ target: "column", schemaName: "app", tableName: "posts", oldName: "slug", newName: "handle" }],
			confirmedDrops: [], declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({ code: "unknown-rename-target" }),
		]);
	});

	it("duplicate-rename-target when two specs claim the same old or new", () => {
		// two column specs with the same oldName "slug" → single
		// duplicate-rename-target error. Implementer: write the full body.
	});
	it("unknown-confirm-drop-target for a column this run does not drop", () => {
		// confirm-drop app.posts.title while title exists unchanged →
		// unknown-confirm-drop-target. Implementer: write the full body.
	});
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `rename-plan.ts` per the algorithm and
  `rename-sql.ts`:

```ts
import { qualifyName, quoteIdentifier } from "./identifier";

export const renderColumnRename = (spec: ColumnRenameSpec): string =>
	`alter table ${qualifyName(spec.schemaName, spec.tableName)} rename column ${quoteIdentifier(spec.oldName)} to ${quoteIdentifier(spec.newName)};`;

export const renderTableRename = (spec: TableRenameSpec): string =>
	`alter table ${qualifyName(spec.schemaName, spec.oldName)} rename to ${quoteIdentifier(spec.newName)};`;
```

Error messages: use the owner-approved flat texts (Task 14 lists them as
goldens; core builds them with the concrete names interpolated — the golden
tests in the CLI pin the final rendering).

- [ ] **Step 4: Tests pass.**
- [ ] **Step 5: Commit** `feat(core): rename plan engine with rule-a ambiguity detection`

## Task 7: Wire `planRenames` into `generateMigration` + banner hash lines

**Files:**
- Modify: `packages/core/src/engine/generate.ts`
- Modify: `packages/core/src/sql/migration-file.ts`
- Test: `packages/core/test/generate.test.ts` (extend), `packages/core/test/migration-file.test.ts` (extend)

**Interfaces:**
- `GenerateMigrationOptions` gains `renames?`, `confirmedDrops?`, and
  `bannerHashes?: { readonly parent: string; readonly current: string }`
  (opaque strings; CLI passes `"sha256:<hex>"`).
- `GenerateMigrationResult` gains `errors: ReadonlyArray<HejbroError>`
  (non-empty ⇒ `sql === ""`, `hasChanges === false`, nothing writable).
- `renderBanner(changes, hashes?)` appends, when `hashes` is given:

```
-- parent-snapshot: sha256:<hex>
-- snapshot: sha256:<hex>
```

- New export `parseBannerHashes(fileContent: string): { parent: string; current: string } | null`
  — pure text parsing of the two banner lines (used by `verify`; returns
  `null` for pre-Phase-5 files without hash lines).

- [ ] **Step 1: Failing tests** — (a) `generateMigration` with an ambiguous
  pair returns `errors` non-empty and empty `sql`; (b) with a matching
  `renames` spec the result `sql` starts with the banner, the banner line
  reads `~ table app.posts [column "slug" renamed to "handle"]`, and the first
  statement after the banner is the RENAME; (c) `renderBanner` with hashes
  appends exactly the two lines above; (d) `parseBannerHashes` round-trips
  (c) and returns `null` on a hash-less banner.
- [ ] **Step 2: Run — FAIL. Step 3: Implement.** Pipeline order inside
  `generateMigration`: build next → `planRenames` (declaredAt map keyed by
  table identity, built from the **pre-normalization inputs**: for each
  `input` where `isTable(input)`, `getTableMeta(input).declaredAt` — after
  normalization the values are already plain `TableDeclaration`s, so read
  `declaration.declaredAt` directly there instead) → on errors return
  early → `diffSnapshots(plan.rewrittenPrevious, next, registry)` →
  `sql = [renderBanner([...plan.renameChanges, ...changes], hashes), ...plan.renameStatements, ...main, ...deferred].join("\n\n")`;
  `hasChanges = changes.length > 0 || plan.renameStatements.length > 0`.
- [ ] **Step 4: Full core suite passes. Step 5: Commit**
  `feat(core): flag-driven renames and banner hash chain in generate` —
  **open PR A** (body: task list, audit table from Task 3, commits,
  `Closes #<PR-A sub-issue>`).

## Task 8: CLI package foundation (build, bin, deps)

**Files:**
- Modify: `packages/cli/package.json`
- Create: `packages/cli/tsdown.config.ts`
- Create: `packages/cli/src/cli.ts` (bin entry), modify `packages/cli/src/index.ts` (re-export DSL + `defineConfig`)

- [ ] **Step 1: Add deps and build wiring**

```bash
pnpm --filter hejbro add citty jiti zod
pnpm --filter hejbro add -D tsdown vitest
```

`package.json` additions: `"bin": { "hejbro": "./dist/cli.js" }`,
`"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`,
`"files": ["dist"]`, scripts `"build": "tsdown"`, `"test": "vitest run"`.
`tsdown.config.ts`: `entry: ["src/index.ts", "src/cli.ts"]`, `dts: true`,
and a `#!/usr/bin/env node` banner on the `cli` entry.

- [ ] **Step 2: Verify** — `src/cli.ts` is a citty `runMain(main)` stub with
  the root command (owner-approved root help text, Task 15 golden);
  `src/index.ts` re-exports `@hejbro/core`'s DSL surface plus
  `defineConfig` (Task 9). **Verify citty behaviors flagged in design
  review:** (a) repeated `--rename` flags arrive as an array, (b) the
  kebab-case `--confirm-drop` arg name mapping, (c) whether `renderUsage`
  re-wraps `meta.description` (if wrapping is width-dependent, install a
  custom deterministic `showUsage`). Record findings in the PR body.
- [ ] **Step 3: Build passes** (`pnpm build`), `node packages/cli/dist/cli.js --help` prints the root help. **Commit** `feat(cli): package build, bin entry, and citty root command`

## Task 9: `defineConfig` + zod validation (§7-wrapped)

**Files:**
- Create: `packages/cli/src/config.ts`
- Test: `packages/cli/test/config.test.ts`

**Interfaces:**
- Produces:

```ts
export type HejbroConfig = {
	readonly entry: ReadonlyArray<string>;
	readonly migrationsDir: string;
	readonly snapshotPath: string;
	readonly prefixStrategy: MigrationPrefixStrategy; // default "timestamp"
};
export const defineConfig = (config: HejbroConfig): HejbroConfig => config;
/** zod-parse an unknown loaded value; zod issues are re-wrapped into
 *  HejbroError code "invalid-config" — zod's own message text never
 *  reaches the user (owner condition, U3). */
export const parseConfig = (value: unknown, configPath: string): HejbroConfig;
```

- [ ] **Step 1: Failing tests** — valid config round-trips; missing `entry`
  → error code `invalid-config` whose message names the field, the
  expectation, and the config path (assert the message does **not** contain
  the strings `"ZodError"` or `"invalid_type"`); bad `prefixStrategy` value
  → message lists the three valid strategies.
- [ ] **Step 2–4: Implement (zod schema + issue-to-§7 re-wrapper), tests pass.**
- [ ] **Step 5: Commit** `feat(cli): defineconfig and zod-validated config parsing`

## Task 10: jiti loader module

**Files:**
- Create: `packages/cli/src/loader.ts`
- Test: `packages/cli/test/loader.test.ts` (fixture files under `packages/cli/test/fixtures/`)

**Interfaces:**
- Produces: `loadConfig(cwd: string, configFlag: string | undefined): Promise<{ config: HejbroConfig; configPath: string }>` and
  `loadDeclarations(configPath: string, config: HejbroConfig): Promise<ReadonlyArray<HejbroInput>>`
  (glob `entry` patterns relative to the config file, jiti-import each,
  collect every exported value that is a hejbro declaration — reuse
  `isTable`/`declarationKind` narrowing; non-declaration exports ignored).

- [ ] **Step 1: Failing tests** — fixture project loads; config default
  export via `jiti.import(path, { default: true })`; **smoke test for the
  self-import cycle**: a fixture config that itself does
  `import { defineConfig } from "hejbro"` loads cleanly (U2 finding);
  `config-not-found` / `entry-not-found` errors with owner-approved texts
  (golden in Task 14); deterministic ordering (glob results sorted).
- [ ] **Step 2–4: Implement, tests pass. Step 5: Commit**
  `feat(cli): jiti config and declaration loading`

## Task 11: Diagnostic type + renderer

**Files:**
- Create: `packages/cli/src/diagnostics.ts`
- Test: `packages/cli/test/diagnostics.test.ts`

**Interfaces:**
- Produces:

```ts
export type Diagnostic = {
	readonly code: string;
	readonly identity: string;
	readonly body: ReadonlyArray<string>;        // indented body lines
	readonly suggestions: ReadonlyArray<{ readonly label: string; readonly lines: ReadonlyArray<string> }>; // "→" blocks
	readonly at: string | null;
};
export const renderDiagnostics = (diagnostics: ReadonlyArray<Diagnostic>, summary: string | null): string;
export const fromHejbroError = (error: HejbroError, identity: string): Diagnostic;
```

Grammar (decision ③, verbatim): first line `error[<code>]: <identity>`,
body indented two spaces, each suggestion as an indented `→ ` block, tail
`at <file> (export "<name>")` when known, blocks separated by blank lines,
optional batch summary line last. Output goes to **stderr**; colors only
when `process.stderr.isTTY && !process.env.NO_COLOR`, and golden tests run
color-free.

- [ ] **Step 1: Failing golden test** — render the ambiguous-column-rename
  terminal block exactly as the owner-approved mockup (single-pair case)
  including the two rerun-command suggestions; batch summary rules:
  `2 ambiguous column renames — resolve and rerun \`hejbro generate\`.` /
  mixed: `3 ambiguous renames (2 columns, 1 table) — resolve and rerun \`hejbro generate\`.`
- [ ] **Step 2–4: Implement, pass. Step 5: Commit** `feat(cli): diagnostic renderer`

## Task 12: `hejbro init`

**Files:**
- Create: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/init.test.ts` (tmp-dir based)

Behavior (U7): create `hejbro.config.ts` scaffold (default
`entry: ["src/**/*.schema.ts"]`, `migrationsDir: "migrations"`,
`snapshotPath: "hejbro.snapshot.json"`, `prefixStrategy: "timestamp"`,
using `defineConfig`), create the migrations dir, write
`renderSnapshot(emptySnapshot)` (a const `Snapshot` value, not a function)
to the snapshot path. Idempotent: any
already-existing artifact is left untouched and reported
(`skipped hejbro.config.ts (exists)`), exit 0 always.

- [ ] **Step 1: Failing tests** — fresh dir creates all three; second run
  reports three skips, exit 0, files byte-identical; partial pre-existing
  state fills only the gaps.
- [ ] **Step 2–4: Implement, pass. Step 5: Commit** `feat(cli): init command` — **open PR B**.

## Task 13: `hejbro generate` command

**Files:**
- Create: `packages/cli/src/commands/generate.ts`
- Create: `packages/cli/src/flags.ts` (rename/confirm-drop parsing)
- Create: `packages/cli/src/rerun.ts` (rerun-command assembly)
- Test: `packages/cli/test/flags.test.ts`, `packages/cli/test/rerun.test.ts`, `packages/cli/test/generate-command.test.ts`

**Interfaces:**
- `parseRenameFlag(value: string): RenameSpec` — 3 dot-segments + one `=` →
  column; 2 segments → table; otherwise throw `invalid-rename-flag`
  (owner-approved text). `parseConfirmDropFlag` analogous (3 segments →
  column, 2 → table; format errors reuse `invalid-rename-flag`).
- `assembleRerunCommand(argv: ReadonlyArray<string>, newFlags: ReadonlyArray<string>): string`
  — all-or-nothing rule: original non-rename args in original order, then
  original `--rename`/`--confirm-drop` in original order, then new flags
  sorted by target identity (`compareKeys` order); multi-flag commands
  join with ` \\\n  `.

Command flow: `loadConfig` → `loadDeclarations` → read + `parseSnapshot`
the snapshot file (missing → `snapshot-not-found`/`snapshot-lost` per the
migrations-dir file count, owner-approved texts) → compute
`parent = "sha256:" + sha256hex(renderSnapshot(previousSnapshot))` → call
`generateMigration({ declarations, previousSnapshot, renames,
confirmedDrops, bannerHashes: { parent, current } })` where `current` is
computed from the result snapshot (two-pass: run once without hashes to
get the next snapshot, hash it, render the final SQL with hashes — both
calls are pure and cheap) → on `result.errors`: render diagnostics with
rerun commands, exit 1 → on `hasChanges === false`: print
`no changes — snapshot already matches your declarations.`, exit 0 →
else write `migrationsDir/<migrationFileName(...)>` (clock injected here:
`new Date()`; `previousCount` = existing `.sql` count; slug from `--name`
or `deriveSlug`), overwrite the snapshot file, print the success block
(loaded count, wrote path, per-change `+`/`~`/`-` lines mirroring the
banner).

- [ ] **Step 1: Failing tests** — flag parsing (column/table/invalid forms);
  rerun assembly (the owner-approved example: preserves
  `--config db/hejbro.config.ts --name fix_blog` and the prior
  `--rename app.comments.body=content`); end-to-end tmp-dir run:
  init → write a schema fixture → generate produces a migration whose
  banner contains both hash lines and whose snapshot updates; ambiguous
  fixture exits 1 with the exact golden stderr (Task 14).
- [ ] **Step 2–4: Implement, pass. Step 5: Commit** `feat(cli): generate command with rename flags`

## Task 14: Golden texts — error corpus

**Files:**
- Create: `packages/cli/test/golden/` (one `.txt` per case) + `packages/cli/test/golden.test.ts`

Pin the owner-approved (⑥) texts **verbatim** — flat messages and terminal
renderings for: `ambiguous-column-rename` (single + multiple),
`ambiguous-table-rename`, `unknown-rename-target`,
`duplicate-rename-target`, `unknown-confirm-drop-target`,
`invalid-rename-flag`, `config-not-found`, `entry-not-found` (with the
onboarding example block — **verify the example's imports
(`schema, table, uuid, text from "hejbro"`) against the actual `hejbro`
re-export surface and fix the re-exports, not the golden text, on
mismatch**), `snapshot-not-found`, `snapshot-lost`, batch summary lines.
Fixtures control cwd; assert no absolute paths appear in output.

- [ ] **Step 1: Write goldens (FAIL). Step 2: Fix renderers until byte-equal. Step 3: Commit** `test(cli): golden error corpus`

## Task 15: Golden texts — help output

**Files:**
- Create: `packages/cli/test/help.test.ts`

Pin `hejbro --help` and `hejbro generate --help` to the owner-approved
short-form texts (④ — root description ends
`…for the --rename/--confirm-drop flags.`; generate description is the
two-paragraph short form; args: `--config`, `--name`, `--rename`,
`--confirm-drop` with their approved one-line descriptions). If Task 8
found `renderUsage` non-deterministic, these tests run against our custom
`showUsage`.

- [ ] **Steps: write failing goldens → implement/adjust → pass → commit**
  `test(cli): golden help output` — **open PR C**.

## Task 16: Banner chain checks (core pure part)

**Files:**
- Create: `packages/core/src/engine/chain.ts`
- Test: `packages/core/test/chain.test.ts`

**Interfaces:**
- Produces:

```ts
export type ChainEntry = { readonly fileName: string; readonly parent: string; readonly current: string };
export type ChainReport =
	| { readonly ok: true; readonly tip: string | null }
	| { readonly ok: false; readonly code: "diverged-migrations" | "broken-chain"; readonly details: ReadonlyArray<string> };
export const checkChain = (entries: ReadonlyArray<ChainEntry>): ChainReport;
```

`checkChain` (pure): entries must form one linked list. **Root rule: the
first hashed entry's `parent` is accepted as the chain root unconditionally**
— core cannot (and must not) compute the empty-snapshot hash itself
(hashing is CLI-owned), and with a legacy prefix the first hashed file's
parent is not the empty snapshot anyway. From the root on: two entries
sharing a `parent` → `diverged-migrations` (details name both files; the
CLI's `Next:` tells the user to delete and regenerate the migration that
merged last); a `parent` matching no prior `current` → `broken-chain`.
Files without hash lines (`parseBannerHashes` → null, pre-chain history)
are reported as a skipped prefix: the chain check starts from the first
hashed file.

- [ ] **Steps: failing tests (linear ok / fork / hole / legacy prefix) → implement → pass → commit** `feat(core): migration banner chain checks`

## Task 17: `hejbro verify`

**Files:**
- Create: `packages/cli/src/commands/verify.ts`
- Test: `packages/cli/test/verify.test.ts`

The four checks (U6), dependency-aware batch reporting [amended
2026-08-20 after PR-D review — supersedes the same day's earlier
"sequential short-circuit, keep as-is" amendment: that call assumed
batch reporting needed new renderer infrastructure plus a new
owner-approved batch-summary text, which didn't hold up under
reviewer's follow-up evaluation — multi-block rendering already
existed from PR B, the actual diff was ~60–80 lines, and only two
short lines of new text were needed, so the cost/benefit flipped]:
checks 1 (snapshot parses) and 3 (chain linearity) always run; check 2
(declarations ↔ snapshot) runs only when 1 passed; check 4 (tip ↔
snapshot) runs only when 1 and 3 passed. All failures are collected and
rendered as one multi-diagnostic batch (reusing the PR-B renderer);
skipped checks are marked with a fixed `skipped:` line; loader errors
(config/entry) remain a single-diagnostic early exit (pre-condition of
all four checks). Exit 1 on any failure.
1. **snapshot parses** — read + `parseSnapshot`; JSON parse failure (e.g.
   git conflict markers) surfaces the existing `invalid-snapshot` error in
   diagnostic dress.
2. **declarations ↔ snapshot** — `buildSnapshot(loadDeclarations(...))`
   rendered text equals the on-disk snapshot text (byte compare) →
   otherwise `error[snapshot-stale]`: *"the checked-in snapshot does not
   match your declarations. Next: run `hejbro generate` and commit the
   result (or restore the declarations you meant)."* (new text — drafted
   per the approved grammar; flag for owner wording review in the PR).
3. **chain linearity** — read every migration file, `parseBannerHashes`,
   `checkChain` → `diverged-migrations` / `broken-chain` diagnostics with
   file names in the body.
4. **tip == current** — chain tip hash equals the **normalized** snapshot
   hash `sha256(renderSnapshot(parseSnapshot(diskText)))` — the same
   normalization `generate` uses for `parent`, so the chain stays
   byte-format-independent (raw byte equality is already check 2's job) →
   otherwise `error[chain-tip-mismatch]` (drafted text, same review flag).

Success output: `verify: 4 checks passed (<n> migrations, snapshot sha256:<first 12 hex>…)`, exit 0.

- [ ] **Steps: failing tests (clean repo passes / each check fails in isolation via fixtures) → implement → pass → commit** `feat(cli): verify command` — **open PR D** (body flags the two drafted texts for owner wording approval).

## Task 18: `examples/cli-smoke` end-to-end acceptance

**Files:**
- Create: `examples/cli-smoke/package.json` (private, workspace member,
  deps: `hejbro: workspace:*`), `examples/cli-smoke/hejbro.config.ts`,
  `examples/cli-smoke/src/app.schema.ts` (a schema + two tables with an FK
  and an index — exercising the DSL through the `hejbro` re-export),
  `examples/cli-smoke/test/e2e.test.ts`

The e2e test drives the **built** CLI (`node <repo>/packages/cli/dist/cli.js`)
via `node:child_process.execFile` in a tmp copy of the example:
1. `init` → three artifacts exist.
2. `generate` → migration file written; banner has `+` lines and both hash
   lines; snapshot non-empty.
3. `generate` again → "no changes", exit 0, no new file.
4. `verify` → exit 0.
5. Rename the column in the fixture source, `generate` → exit 1 with
   `ambiguous-column-rename`; rerun with the suggested `--rename` → RENAME
   migration written; `verify` → exit 0.

- [ ] **Steps: write the failing e2e → wire `examples/*` test into turbo
  (`pnpm test` runs it after `build`; add `"test": { "dependsOn": ["^build"] }`
  to `turbo.json` so the dist exists) → pass → commit**
  `test(examples): cli end-to-end smoke`

## Task 19: Roadmap close-out + issue batch

- [ ] **Step 1:** Update `docs/plans/2026-08-19-roadmap.md` Phase 5 section
  to "landed" prose (PR numbers, decision recap), same style as Phase 4.
- [ ] **Step 2:** Create the six deferred issues from the **Issues to
  create** table via `issue.sh` (each linked to its phase parent), plus
  close the Phase 5 sub-issues as PRs merged.
- [ ] **Step 3:** Commit `docs(plans): phase 5 close-out` — **open PR E**.
  Final gate: `pnpm check && pnpm check-types && pnpm test` all green with
  output in the PR body.

---

## Self-review notes

- **Spec coverage:** roadmap Phase 5 bullets map to: config (T9), loading
  (T10), emission + banner (T7/T13), rename confirmation (T6/T13/T14),
  consistency check (T16/T17), examples e2e (T18). Owner decisions U1–U9,
  ①–⑧ and the snapshot architecture each appear in a concrete task.
- **Two texts are new drafts** (verify's `snapshot-stale`,
  `chain-tip-mismatch`) — flagged for owner wording approval in PR D; all
  other user-facing texts are the owner-approved goldens, verbatim.
- **Known verification points recorded** (citty array flags, kebab-case
  mapping, renderUsage determinism, `hejbro` re-export surface vs. the
  onboarding example) — each sits inside the task that must resolve it.
