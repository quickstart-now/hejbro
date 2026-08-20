# Phase 6 — Supabase preset (`@hejbro/supabase`): Implementation Plan

> Historical record. Names and paths below were updated in Phase 7 (PRs D and #118) when the example directory was renamed; the events themselves are unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@hejbro/supabase` — role presets, `authUid()`/`authJwt()`
helpers, the storage-bucket object kind, reserved-schema protection, the
two RLS warnings (exposed table, #66 view) — built strictly on core's
public extension interface, growing that interface (validators, existing-
table references, branded `Role`) where Phase 6 proved it too small.

**Architecture:** Two pure core additions land first: (1) a **validation
channel** — `generateMigration({ validators })` runs preset-supplied pure
functions over the built snapshot + normalized declarations and returns
`warnings` (error-severity diagnostics join `errors` and block generation);
(2) an **`existingTable()` primitive** — a reference-only `Table` (FK
targets, `exists()`, view from/joins) that is never declared, diffed, or
emitted. The preset then contributes only through public surface: role
constants (branded `Role`), typed expression helpers, three validators,
one custom `ObjectKind` (`supabase-storage-bucket`, the first row-data
kind), and the prebuilt `authUsers` existing-table reference. Acceptance is a
reduced `examples/supabase` plus a toy `examples/preset-smoke` preset.

**Tech Stack:** TypeScript strict, vitest, Biome, pnpm + turbo, tsdown.
`@hejbro/supabase` runtime deps: `@hejbro/core` only. Core: zero new
runtime deps, zero I/O (unchanged).

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` — §4.1 (as amended this
phase), §7, D5, D24–D28, and new rows D37–D45. Roadmap:
`docs/plans/2026-08-19-roadmap.md` §Phase 6. Issues: #7 (phase), #66
(view security_invoker warning, closed by PR C).

## Owner decisions (2026-08-20 brainstorm — do not revisit)

| # | Decision |
|---|----------|
| D37 | Validation channel = optional `validators` array on `generateMigration` — `(snapshot, declarations) => ReadonlyArray<Diagnostic>`; result gains `warnings`; error severity joins `errors` and short-circuits like rename errors. §4.1 becomes five contributions. |
| D38 | Reserved schemas (`auth`/`storage`/`realtime`) = **hard error** on any managed declaration targeting them, shipped as a preset validator. Existing-table references are exempt by construction (declaration path errors, reference path allowed). |
| D39 | #66 warning judges from **original declarations** (`query.from`/`joins` × RLS declarations); `ViewSnapshot` unchanged. |
| D40 | Exposed-table warning fires only on: schema has `allTablesPrivileges`/`defaultTablePrivileges` grant to `anon`/`authenticated` **and** table has no RLS declaration. |
| D41 | `existingTable(schemaName, tableName, columns)` core primitive; passing one to `generateMigration` is a hard error (`existing-table-declared`); preset exports prebuilt `authUsers`. |
| D42 | Storage bucket = first row-data kind: `create`/`alter` emit `insert … on conflict (id) do update set …`; `drop` emits **no SQL**, only a banner note (manual deletion). |
| D43 | Branded `Role` type now: core exports `Role` + `roleName()`; `grant().to()`/`rls.policy().to()` widen to `string \| Role` (non-breaking); preset constants are `Role`. |
| D44 | Acceptance = reduced `examples/supabase` (every preset feature once) + `examples/preset-smoke` (one custom kind + one expr helper); a fuller port of the original production schema stays Phase 7. |
| D45 | `authUid()` renders the plain `auth.uid()` call — no automatic `(select auth.uid())` wrapping (illegal in column `default`/`check`); cached variant = Phase 7 follow-up; preset README carries the performance guidance. |

### Resolved at plan review (owner, 2026-08-20)

- **⑨ CLI preset wiring = deferred to Phase 7.** Acceptance drives the
  examples through `generateMigration` directly (vitest + golden SQL);
  D30's "no preset fields reserved" stays untouched this phase. The
  Phase 7 follow-up issue (config `presets` field + CLI warning rendering
  with owner-approved golden texts) is filed in Task 19 — no PR F.
- **⑩ `authUid()` = plain `auth.uid()` render (now D45).** No automatic
  `(select auth.uid())` initPlan wrapping — subqueries are illegal in
  column `default`/`check` expressions where the helper is also idiomatic.
  The cached variant is a Phase 7 follow-up issue (Task 19); the preset
  README (Task 9) carries the RLS performance guidance.

## Global Constraints

- Core purity: `@hejbro/core` never reads files, never opens a connection,
  no new runtime deps. `@hejbro/supabase` is equally pure — it is a
  declaration/validation library, not a client.
- The preset imports **only from `@hejbro/core`'s public `index.ts`**
  surface. Needing a deep import = the interface is wrong; stop and
  surface it (spec §4.1).
- TS style: no `any`, no `let`/`var`, no `for`/`while`, no ternary
  (owner's `typescript-rules`); Biome tabs + double quotes. The single
  `as Role` inside `roleName()` is the one sanctioned assertion (brand
  constructors cannot avoid it); annotate it.
- All GitHub-facing text in English; conventional commits, ≤72-char
  subject.
- Every new error/diagnostic states why + what to do (spec §7); codes are
  kebab-case (`reserved-schema`, `existing-table-declared`, …).
- Determinism: validators are pure and their diagnostics are emitted in a
  deterministic order (declaration order, then code). Golden tests pin all
  user-facing text.
- Snapshot version stays `2`; the bucket kind adds new `objects` entries
  but changes no existing node shape (D39 keeps `ViewSnapshot` frozen).
  Any format change = stop-and-report gate.
- Before claiming any PR done: `pnpm check`, `pnpm check-types`,
  `pnpm test` all pass from a clean state (`rm -rf packages/*/dist`
  first), output shown.

## PR map (each PR is a sub-issue of #7, squash-merged to `dev`)

| PR | Issue | Tasks | Branch | Scope |
|----|-------|-------|--------|-------|
| A — core: validation channel (`Diagnostic`, `validators`, `warnings`) | #91 | 1–4 | `phase6-core-validators` | pure core |
| B — core: `existingTable` + branded `Role` | #92 | 5–8 | `phase6-core-existing-refs` | pure core |
| C — preset: roles, auth helpers, `authUsers`, three validators | #93 (also closes #66) | 9–13 | `phase6-preset-foundation` | packages/supabase |
| D — preset: storage bucket kind | #94 | 14–16 | `phase6-storage-bucket` | packages/supabase |
| E — acceptance: `preset-smoke` + `supabase` example + roadmap close-out | #95 | 17–19 | `phase6-acceptance` | examples/, docs |

---

## Task 1: Commit the phase docs (PR-A opening commit)

**Files:**
- Already written: `docs/plans/2026-08-20-phase6-implementation.md` (this file)

- [ ] **Step 1: Commit**

```bash
git add docs/plans/2026-08-20-phase6-implementation.md
git commit -m "docs(plans): phase 6 supabase preset implementation plan"
```

## Task 2: Spec + roadmap wording for the phase decisions

**Files:**
- Modify: `docs/specs/2026-08-19-hejbro-design.md` (§4.1 five contributions; decision-log rows D37–D45) — **already drafted in this worktree**
- Modify: `docs/plans/2026-08-19-roadmap.md` (§Phase 6 bullet refresh: name the validators channel, `existingTable`/`authUsers`, hard-error reserved schemas, D44 acceptance split)

- [ ] **Step 1: Confirm wording.** Do not commit as final until main
  confirms the D37–D45 wording with the owner — open PR A as draft if
  still pending.
- [ ] **Step 2: Update roadmap Phase 6 bullets** and commit both files:

```bash
git add docs/specs/2026-08-19-hejbro-design.md docs/plans/2026-08-19-roadmap.md
git commit -m "docs(spec): record phase 6 brainstorm decisions"
```

## Task 3: `Diagnostic` type + `validators` in `generateMigration` (D37)

**Files:**
- Create: `packages/core/src/engine/validate.ts`
- Modify: `packages/core/src/engine/generate.ts`
- Test: `packages/core/test/validators.test.ts`

**Interfaces (later tasks rely on these exact names):**

```ts
// engine/validate.ts
export type DiagnosticSeverity = "warning" | "error";

export type Diagnostic = {
	readonly severity: DiagnosticSeverity;
	readonly code: string;
	readonly message: string;
	readonly declaredAt: string | null;
};

export type Validator = (
	snapshot: Snapshot,
	declarations: ReadonlyArray<HejbroDeclaration>,
) => ReadonlyArray<Diagnostic>;

export const diagnostic = (
	severity: DiagnosticSeverity,
	code: string,
	message: string,
	declaredAt: string | null = null,
): Diagnostic => ({ severity, code, message, declaredAt });

/** Runs validators in order; returns their diagnostics flattened, order-preserving. */
export const runValidators = (
	validators: ReadonlyArray<Validator>,
	snapshot: Snapshot,
	declarations: ReadonlyArray<HejbroDeclaration>,
): ReadonlyArray<Diagnostic> =>
	validators.flatMap((validator) => validator(snapshot, declarations));
```

`GenerateMigrationOptions` gains `readonly validators?: ReadonlyArray<Validator>`.
`GenerateMigrationResult` gains `readonly warnings: ReadonlyArray<Diagnostic>`.
Semantics: validators run on the **next** snapshot + the **normalized**
declarations (post-`resolveDeclarations`, so grant-sets are fanned out and
table RLS/policies are expanded). Warning severity → `warnings`. Error
severity → mapped to `HejbroError` (`hejbroError(d.code, d.message,
d.declaredAt)`) and appended to `errors` **after** any rename errors; any
non-empty `errors` keeps the existing short-circuit contract (`sql === ""`,
`hasChanges === false`).

- [ ] **Step 1: Write failing tests** in
  `packages/core/test/validators.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptySnapshot, generateMigration, schema } from "../src/index";
import { diagnostic } from "../src/engine/validate";

describe("generateMigration validators", () => {
	const app = schema("app");

	it("returns warning diagnostics in result.warnings without blocking sql", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [
				() => [diagnostic("warning", "test-warning", "a warning.")],
			],
		});
		expect(result.warnings).toEqual([
			{ severity: "warning", code: "test-warning", message: "a warning.", declaredAt: null },
		]);
		expect(result.hasChanges).toBe(true);
		expect(result.sql).toContain("create schema");
	});

	it("maps error diagnostics into result.errors and blocks generation", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [
				() => [diagnostic("error", "test-error", "an error.", "app.ts:1")],
			],
		});
		expect(result.errors).toEqual([
			{ code: "test-error", message: "an error.", declaredAt: "app.ts:1" },
		]);
		expect(result.sql).toBe("");
		expect(result.hasChanges).toBe(false);
	});

	it("passes the built snapshot and normalized declarations to validators", () => {
		const seen: Array<ReadonlyArray<string>> = [];
		generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
			validators: [
				(snapshot, declarations) => {
					seen.push(declarations.map((d) => d.declarationKind));
					expect(Object.keys(snapshot.objects)).toContain("schema:app");
					return [];
				},
			],
		});
		expect(seen).toEqual([["schema"]]);
	});

	it("omitting validators yields empty warnings (back-compat)", () => {
		const result = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		expect(result.warnings).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hejbro/core test`
  fails (`validate.ts` missing, `warnings` missing).
- [ ] **Step 3: Implement** `engine/validate.ts` (code above) and wire into
  `generateMigration` per the semantics block. Keep the existing
  rename-error path untouched; compute `validatorDiagnostics` after
  `buildSnapshot`, partition by severity, merge.
- [ ] **Step 4: Run tests** — all core tests pass (existing `generate`
  golden tests must be untouched: `warnings: []` is additive).
- [ ] **Step 5: Commit** — `feat(core): validation channel — validators option and warnings result`

## Task 4: Export the validation surface

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: extend `packages/core/test/validators.test.ts`

- [ ] **Step 1: Failing test** — import `diagnostic`, `runValidators`, and
  types `Diagnostic`, `DiagnosticSeverity`, `Validator` from
  `../src/index` in the test file; type-check fails.
- [ ] **Step 2: Add exports** to `index.ts` (types under `export type`,
  values in the alphabetized value block, matching house organization).
- [ ] **Step 3: `pnpm check && pnpm --filter @hejbro/core test`** — green.
- [ ] **Step 4: Commit** — `feat(core): export diagnostic and validator surface`
- [ ] **Step 5: Open PR A** (draft until Task 2 wording confirmed): body
  lists squash commits + `Part of #7` + the PR-A sub-issue.

## Task 5: Branded `Role` type + widened `.to()` (D43)

**Files:**
- Create: `packages/core/src/dsl/role.ts`
- Modify: `packages/core/src/dsl/grant.ts` (`GrantRolesStage.to`), `packages/core/src/dsl/rls.ts` (policy `.to()`), `packages/core/src/index.ts`
- Test: `packages/core/test/role.test.ts`

**Interfaces:**

```ts
// dsl/role.ts
declare const roleBrand: unique symbol;
/** A Postgres role name carrying compile-time provenance (D43). Assignable to string. */
export type Role = string & { readonly [roleBrand]: true };
/** Brands a role name. The single sanctioned assertion in core (brand constructor). */
export const roleName = (name: string): Role => name as Role;
```

`.to()` signatures widen to `to(...roles: ReadonlyArray<string | Role>)` —
type-level only; runtime behavior unchanged (a `Role` *is* a string).

- [ ] **Step 1: Failing test:**

```ts
import { describe, expect, it } from "vitest";
import { grant, roleName } from "../src/index";
import type { Role } from "../src/index";

describe("branded Role", () => {
	it("roleName brands and grant().to() accepts Role and string mixed", () => {
		const anon: Role = roleName("anon");
		const set = grant("app").tables("select").to(anon, "authenticated");
		expect(set.grants.map((g) => g.role)).toEqual(["anon", "authenticated"]);
	});
});
```

- [ ] **Step 2: Verify failure** (no `roleName` export).
- [ ] **Step 3: Implement + export.** Run full core suite — existing
  string call sites must compile untouched.
- [ ] **Step 4: Commit** — `feat(core): branded role type (D43)`

## Task 6: `existingTable()` primitive (D41)

**Files:**
- Create: `packages/core/src/dsl/existing-table.ts`
- Modify: `packages/core/src/dsl/table.ts` (`TableDeclaration` gains `readonly existing: boolean`; `table()` sets `false`; extract the column-builder→`ColumnRef` resolution into a shared internal helper if not already reusable)
- Test: `packages/core/test/existing-table.test.ts`

**Interfaces:**

```ts
// dsl/existing-table.ts
/**
 * A reference-only table (D41): usable as an FK target, in exists(), and
 * in view from/joins — never passed to generateMigration, never diffed,
 * never emitted. Column names go through the same snake_case + D36 rules.
 */
export const existingTable = <TColumns extends Record<string, ColumnBuilder>>(
	schemaName: string,
	tableName: string,
	columns: TColumns,
): Table<TColumns>;
```

Internally builds a `TableDeclaration` with `existing: true`, an inline
`SchemaDeclaration` (`{ declarationKind: "schema", schemaName, declaredAt: null }`
— never exported, never declared), no indexes/FKs/RLS.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from "vitest";
import { emptySnapshot, existingTable, generateMigration, schema, table, uuid } from "../src/index";

describe("existingTable", () => {
	const authUsers = existingTable("auth", "users", { id: uuid() });
	const app = schema("app");

	it("serves as an FK target without entering the snapshot", () => {
		const profiles = table(app, "profiles", { id: uuid().primaryKey() }, (t) => ({
			foreignKeys: [{ columns: [t.id], references: { table: authUsers, columns: [authUsers.id] } }],
		}));
		const result = generateMigration({
			declarations: [app, profiles],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('references "auth"."users"');
		expect(result.sql).not.toContain("create schema \"auth\"");
		expect(Object.keys(result.snapshot.objects)).not.toContain("table:auth.users");
	});

	it("hard-errors when passed as a declaration", () => {
		expect(() =>
			generateMigration({ declarations: [authUsers], previousSnapshot: emptySnapshot }),
		).toThrowError(/existing-table-declared/);
	});
});
```

  (Adjust the FK-SQL assertion string to the emitter's actual quoting —
  read `table-kind-emit-sql.ts:120-127` first; the golden corpus has the
  canonical form.)
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** In `resolveDeclarations`
  (`engine/generate.ts`): `isTable(input) && getTableMeta(input).existing`
  → `throwHejbroError("existing-table-declared", "existingTable(\"auth\", \"users\") is reference-only — it describes an existing table and must not be passed to generateMigration; remove it from the declarations list. Managed tables are declared with table().", declaredAt)` (message built from actual names).
- [ ] **Step 4: Run full core suite** — `existing: false` must not appear
  in serialized snapshots (compact rule: serializer omits the field
  entirely; verify against an existing table golden).
- [ ] **Step 5: Commit** — `feat(core): existingTable reference-only primitive (D41)`

## Task 7: `existingTable` in `exists()` and view from/joins

**Files:**
- Test: extend `packages/core/test/existing-table.test.ts` (no production code expected — `select()`/`exists()` already accept any `Table` shape; this task pins that behavior)

- [ ] **Step 1: Write tests** — an `rls.policy` whose `using` wraps
  `exists(select(...).from(authUsers).where(...))` renders
  `"auth"."users"` in the policy SQL; a `defineView` over a managed table
  joined to `authUsers` renders and snapshots without an `auth` object.
  Use the policy/view golden tests as templates for exact assertion text.
- [ ] **Step 2: Run; if green already, keep the tests as regression pins.**
  If red, fix in `query/select.ts` only if the failure is a genuine
  interface gap — otherwise stop and report (spec §4.1).
- [ ] **Step 3: Commit** — `test(core): pin existingTable in exists and view queries`

## Task 8: Export + PR B

**Files:**
- Modify: `packages/core/src/index.ts` (`existingTable`, `Role`, `roleName`)

- [ ] **Step 1: Exports + full gate** (`pnpm check && pnpm check-types && pnpm test` from clean state).
- [ ] **Step 2: Commit** — `feat(core): export existingTable and role surface` — and open PR B (`Part of #7`, sub-issue ref).

## Task 9: Preset package foundation

**Files:**
- Modify: `packages/supabase/package.json` (mirror `@hejbro/core`: `exports` → `dist`, `files`, `build: tsdown`, `test: vitest run`, devDeps `tsdown`/`typescript`/`vitest` from catalog)
- Create: `packages/supabase/tsdown.config.ts`, `packages/supabase/vitest.config.ts` (copy core's, adjust name), `packages/supabase/README.md` (one-paragraph scope + the D45 initPlan performance note)
- Modify: `packages/supabase/src/index.ts` (keep header comment; exports grow per task)

- [ ] **Step 1: Copy configs, add a `smoke.test.ts`** asserting the package
  imports (`import * as preset from "../src/index"`).
- [ ] **Step 2: `pnpm install && pnpm build && pnpm --filter @hejbro/supabase test`** — green; turbo picks the new build up (check `turbo.json` needs no change: tasks are inferred by convention from Phase 5 wiring).
- [ ] **Step 3: Commit** — `chore(supabase): package build, test harness`

## Task 10: Role constants + `authUid()` / `authJwt()`

**Files:**
- Create: `packages/supabase/src/roles.ts`, `packages/supabase/src/auth.ts`
- Test: `packages/supabase/test/roles.test.ts`, `packages/supabase/test/auth.test.ts`

**Interfaces:**

```ts
// src/roles.ts
import { roleName, type Role } from "@hejbro/core";
export const anonRole: Role = roleName("anon");
export const authenticatedRole: Role = roleName("authenticated");
export const serviceRole: Role = roleName("service_role");

// src/auth.ts
import { expr, type Expr } from "@hejbro/core";
/** `auth.uid()` — the calling user's id (uuid). Plain call (D45): safe in RLS, column defaults, and checks. */
export const authUid = (): Expr<"uuid"> =>
	expr("uuid", { nodeKind: "functionCall", schemaName: "auth", functionName: "uid", args: [] });
/** `auth.jwt()` — the calling user's JWT claims (jsonb). */
export const authJwt = (): Expr<"json">;  // same shape, family "json", functionName "jwt"
```

- [ ] **Step 1: Failing tests** — `eq(t.userId, authUid())` inside an
  `rls.policy().using()` on a `table()` renders `auth.uid()` in the policy
  SQL via `generateMigration` (assert exact rendered fragment
  `"auth"."uid"()` or unquoted per `qualifiedFunctionName` — read
  `expr/render-sql.ts:610` first and pin the actual form); role constants
  fan out through `grant().to(anonRole, authenticatedRole)`.
- [ ] **Step 2: Verify failure → implement → green.** If `expr`'s public
  export is insufficient to build the node, **stop — interface gap report**
  (do not deep-import).
- [ ] **Step 3: Commit** — `feat(supabase): role constants and auth expression helpers`

## Task 11: `authUsers` prebuilt existing-table reference

**Files:**
- Create: `packages/supabase/src/auth-tables.ts`
- Test: `packages/supabase/test/auth-tables.test.ts`

```ts
// src/auth-tables.ts
import { existingTable, uuid, text } from "@hejbro/core"; // confirm column builders are exported from core index; if only via `hejbro`, import what core exposes
/** Reference-only `auth.users` (D41): the columns hejbro users actually target — id (FK anchor), email. Extend as real usage demands; never declared. */
export const authUsers = existingTable("auth", "users", {
	id: uuid(),
	email: text(),
});
```

- [ ] **Step 1: Failing test** — a `table()` with
  `references: { table: authUsers, columns: [authUsers.id] }` generates FK
  SQL naming `"auth"."users"` and no `auth` snapshot objects (mirror Task 6's
  assertions through the preset import path).
- [ ] **Step 2: Implement → green → commit** — `feat(supabase): authUsers existing-table reference`

## Task 12: Reserved-schema validator (D38) + exposed-table validator (D40)

**Files:**
- Create: `packages/supabase/src/validators/reserved-schemas.ts`, `packages/supabase/src/validators/exposed-tables.ts`, `packages/supabase/src/validators/schema-of.ts` (shared: declaration → schema name, per declarationKind)
- Test: `packages/supabase/test/reserved-schemas.test.ts`, `packages/supabase/test/exposed-tables.test.ts`

**Interfaces:**

```ts
export const reservedSchemas: ReadonlyArray<string> = ["auth", "storage", "realtime"];
export const reservedSchemaValidator: Validator;   // severity "error", code "reserved-schema"
export const exposedTableValidator: Validator;     // severity "warning", code "exposed-table-without-rls"
```

Reserved-schema message shape (spec §7 — why + what to do):
`schema "auth" is managed by Supabase — hejbro must not create or alter objects in it. Remove the declaration; to reference an existing table there, use existingTable() (e.g. @hejbro/supabase's authUsers).`
Exposed-table message:
`table "app"."posts" is reachable by API roles (grant to "anon"/"authenticated" on schema "app") but has no row-level security — every row is readable/writable through the API. Declare rls(...) on the table, or drop the schema grant.`

Logic (over **normalized** declarations): reserved — flag any declaration
whose target schema (via `schema-of.ts`: `schema`→`schemaName`,
`table`/`view`→`schema.schemaName`, `function`/`trigger`→their schema
field, `rls`/`policy`/`grant`→`schemaName`) is in `reservedSchemas`.
Exposed — collect schemas with a `grant` declaration of kind
`allTablesPrivileges`/`defaultTablePrivileges` to `anon`/`authenticated`;
warn per `table` declaration in those schemas lacking a matching `rls`
declaration (`schemaName`+`tableName`). Deterministic order: declaration
order.

- [ ] **Step 1: Failing tests** — cover: `schema("auth")` errors;
  `table(storageSchema, …)` errors; granted schema + RLS-less table warns;
  same table **with** `rls` in extras does not warn; grant to
  `service_role` only does not warn; existing-table references never flag.
- [ ] **Step 2: Implement → green.**
- [ ] **Step 3: End-to-end check** — via `generateMigration({ validators:
  [reservedSchemaValidator] })`, the reserved error blocks sql (Task 3
  contract).
- [ ] **Step 4: Commit** — `feat(supabase): reserved-schema and exposed-table validators`

## Task 13: View `security_invoker` validator (#66, D39) + preset index

**Files:**
- Create: `packages/supabase/src/validators/view-security-invoker.ts`
- Modify: `packages/supabase/src/index.ts` (export everything + `supabaseValidators`)
- Test: `packages/supabase/test/view-security-invoker.test.ts`

```ts
export const viewSecurityInvokerValidator: Validator; // severity "warning", code "view-over-rls-without-security-invoker"
export const supabaseValidators: ReadonlyArray<Validator> = [
	reservedSchemaValidator,
	exposedTableValidator,
	viewSecurityInvokerValidator,
];
```

Logic: for each normalized `view` declaration with
`securityInvoker === false`, walk `query.from` and `query.joins[].table`
(`TableRefNode.schemaName`/`tableName` — confirm exact node fields in
`expr/ast.ts:127-161`), collect referenced tables; if any has an `rls`
declaration → warn:
`view "app"."recent_posts" reads RLS-protected table "app"."posts" without security_invoker — the view runs with its owner's rights and bypasses row-level security (PG15+). Pass { securityInvoker: true } to defineView, or confirm the bypass is intended.`

- [ ] **Step 1: Failing tests** — view over RLS table without the option
  warns; with `{ securityInvoker: true }` does not; view over non-RLS
  table does not; view joining an RLS table (join, not from) warns.
- [ ] **Step 2: Implement → green.**
- [ ] **Step 3: Commit** — `feat(supabase): view security-invoker validator (#66)` —
  open PR C: `Closes #66`, `Part of #7`.

## Task 14: Storage bucket DSL (D42)

**Files:**
- Create: `packages/supabase/src/storage/bucket.ts`
- Test: `packages/supabase/test/storage-bucket-dsl.test.ts`

**Interfaces:**

```ts
export type StorageBucketDeclaration = {
	readonly declarationKind: "supabase-storage-bucket";
	readonly bucketName: string;
	readonly isPublic: boolean;
	readonly fileSizeLimit: number | null;
	readonly allowedMimeTypes: ReadonlyArray<string> | null;
	readonly declaredAt: string | null;
};

export const storageBucket = (
	bucketName: string,
	options?: {
		readonly public?: boolean;             // default false
		readonly fileSizeLimit?: number;       // bytes
		readonly allowedMimeTypes?: ReadonlyArray<string>;
	},
): StorageBucketDeclaration;
```

Name rule: `^[a-z0-9][a-z0-9._-]*$`, max 100 chars (Supabase/S3-compatible
— dashes are idiomatic bucket style, so D36's identifier regex does not
apply; this is a row value, not a SQL identifier). Hard error
`invalid-bucket-name` with the rule spelled out.

- [ ] **Step 1: Failing tests** — defaults (`isPublic false`, nulls),
  option passthrough, name-rule rejection (`"My Bucket"` errors,
  `"profile-images"` passes), `declaredAt` captured
  (`captureDeclarationSite` from core).
- [ ] **Step 2: Implement → green → commit** — `feat(supabase): storage bucket declaration`

## Task 15: Storage bucket `ObjectKind` — serialize/identify/diff

**Files:**
- Create: `packages/supabase/src/storage/bucket-kind.ts`
- Test: `packages/supabase/test/storage-bucket-kind.test.ts`

```ts
export const storageBucketKind: ObjectKind<StorageBucketDeclaration>;
// kind: "supabase-storage-bucket", dependsOn: []
```

Snapshot node (compact — omit defaults): `{ name: string; public?: true;
fileSizeLimit?: number; allowedMimeTypes?: ReadonlyArray<string> }`.
Identity: `bucketName`. Diff: null→node = create; node→null = drop;
deep-unequal = alter (single change, D24-style: `previous`/`next` carry
the nodes).

- [ ] **Step 1: Failing tests** — serialize omits defaults; identify;
  create/drop/alter diffs (model on `packages/core/test/grant-kind.test.ts`
  structure); registers cleanly via `createKindRegistry().register(...)`.
- [ ] **Step 2: Implement → green → commit** — `feat(supabase): storage bucket kind (serialize, diff)`

## Task 16: Storage bucket emit (upsert; drop = banner note only)

**Files:**
- Modify: `packages/supabase/src/storage/bucket-kind.ts`
- Modify: `packages/supabase/src/index.ts` (export `storageBucket`, `storageBucketKind`, `StorageBucketDeclaration`, plus a `registerSupabaseKinds(registry)` convenience)
- Test: extend `packages/supabase/test/storage-bucket-kind.test.ts`

Emit for create/alter (one statement; exact golden below — single-quoted
literals escaped by doubling; `allowed_mime_types` as `array[...]::text[]`,
or `null`):

```sql
insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg']::text[])
on conflict ("id") do update set
  "public" = excluded."public",
  "file_size_limit" = excluded."file_size_limit",
  "allowed_mime_types" = excluded."allowed_mime_types";
```

Drop: `emit` returns `[]`; the `KindChange.notes` (produced in `diff`)
carries: `bucket "avatars" removed from declarations — buckets hold user
files, so hejbro emits no delete; remove it manually in Supabase when
ready.` (surfaces in the migration banner via existing note rendering).

- [ ] **Step 1: Failing golden tests** — full-option bucket, minimal bucket
  (`"public"` false, nulls), alter emits the same upsert, drop emits `[]`
  with the note; end-to-end `generateMigration({ registry })` snapshot +
  sql golden.
- [ ] **Step 2: Implement → green.**
- [ ] **Step 3: Full gate from clean state; commit** —
  `feat(supabase): storage bucket upsert emit` — open PR D.

## Task 17: `examples/preset-smoke` — toy preset (D44)

**Files:**
- Create: `examples/preset-smoke/package.json`, `examples/preset-smoke/src/preset.ts`, `examples/preset-smoke/src/app.schema.ts`, `examples/preset-smoke/test/preset-smoke.test.ts`

Contents (proves genericity with zero Supabase concepts, using **only**
`@hejbro/core` public surface): a `schema-note` custom kind
(declaration `{ declarationKind: "smoke-schema-note"; schemaName; note }` →
emits `comment on schema "x" is 'note';`, identity = schemaName, standard
create/drop/alter diff) and one expression helper
`txidCurrent(): Expr<"number">` (`functionCall`, `txid_current`). Test:
register kind, declare a schema + note + a column default using the
helper, `generateMigration`, golden-assert the SQL.

- [ ] **Step 1: Write the failing e2e test; Step 2: implement preset;
  Step 3: green; Step 4: commit** —
  `test(examples): preset-smoke proves the extension interface is generic`

## Task 18: `examples/supabase` — reduced acceptance example (D44)

**Files:**
- Create: `examples/supabase/package.json`, `examples/supabase/src/app.schema.ts`, `examples/supabase/test/preset.test.ts`

Schema (every preset feature once, mirroring spec §5 style): `app`
schema; `profiles` table with `userId` FK → `authUsers.id`; RLS policy
`using(eq(t.userId, authUid()))` `.to(authenticatedRole)`; an `avatars`
storage bucket; `grant("app").tables("select").to(anonRole)`; a
deliberately RLS-less `drafts` table + the grant so
`exposedTableValidator` warns (pinned in the golden), and a
`defineView` over `profiles` without `securityInvoker` so #66 warns
(pinned). Test drives `generateMigration({ declarations, registry:
<default + registerSupabaseKinds>, validators: supabaseValidators })` and
golden-asserts: the SQL file, the warning list (exact messages), and that
reserved-schema misuse (`schema("auth")`) errors in a negative case.

- [ ] **Step 1: Failing test with the golden expectations sketched;
  Step 2: write the schema; Step 3: green (this is the phase's acceptance
  bar — every D37–D45 behavior observable here); Step 4: commit** —
  the Phase 6 acceptance commit (`917a788`)

## Task 19: Roadmap close-out + issue batch

**Files:**
- Modify: `docs/plans/2026-08-19-roadmap.md` (Phase 6 ✅ section in the Phase 4/5 close-out style: decisions D37–D45, PR/issue list, what moved)
- Modify: `packages/core/src/dsl/define-view.ts` (JSDoc: point #66 to `@hejbro/supabase`'s `viewSecurityInvokerValidator` — the delegation is now discharged)

- [ ] **Step 1: File follow-up issues** (each linked to the phase that will
  process it, per the no-orphan rule): CLI preset wiring + warning
  rendering (**filed: #96**, Phase 7 — ⑨ deferred by owner, 2026-08-20; the D30 "no preset
  fields" decision is untouched this phase and reopens there); `authUid()`
  initPlan-cached variant (**filed: #97**, Phase 7 — D45); a fuller port of the
  original production schema grows the example (Phase 7, already tracked — verify).
- [ ] **Step 2: Roadmap update; full gate from clean state; commit** —
  `docs(plans): phase 6 close-out` — open PR E.

---

## Self-review notes (kept for executors)

- Spec coverage: D37→T3–4; D38→T12; D39→T13; D40→T12; D41→T6–7, T11;
  D42→T14–16; D43→T5; D44→T17–18; D45→T10; §4.1 five-contribution
  wording→T2; #66→T13. Roadmap Phase 6 bullets: roles→T10, authUid→T10,
  bucket→T14–16, reserved→T12, exposed warning→T12, acceptance→T17–18.
- Deliberate unknowns executors must resolve by reading before asserting:
  exact FK/function-call quoting in rendered SQL (Tasks 6, 10 — read the
  emitters/goldens first); `TableRefNode` field names (Task 13). Confirmed
  already: core's `index.ts` does export the column builders (`uuid`,
  `text`, `ColumnBuilder`, … — index.ts:260, 289, 294), so Tasks 6/11
  import them directly.
- Anything requiring a deep import from `@hejbro/core/src/...` in
  `packages/supabase` or `examples/` is a **stop-and-report** — that is
  the §4.1 tripwire this phase exists to test.
