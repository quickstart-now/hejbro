# Phase 9 — 0.1.x stabilization (dogfood-driven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the published 0.1.x packages survive a real consumer's editing
scenarios on real Postgres/Supabase — fix the one runtime defect the first
dogfood pass found (#261), close the docs/CLI/DSL gaps it found (#262–#265,
#269), stand up the dogfood repository that is the phase's acceptance
instrument (#266), and ship it all as 0.1.1 (#268).

**Architecture:** Phase issue **#260**; decisions **D80** (dogfood model) and
**D81** (physical column order) in the spec's decision log. Six PRs on
`dev`, each a sub-issue; one external repository (`hejbro-dogfood`,
private, npm consumer). #261 is the only core change: `buildSnapshot`
learns the parent snapshot and (optionally) the rename directives, derives
each table's *physical* column order from them, and hands every kind a
`SerializeContext` whose `columnOrder` oracle re-orders the table's
`columns` array and re-resolves every `allColumns` projection/`returning`
list at snapshot-build time. `generate`, `verify` and `restore` all pass a
real parent. No snapshot field changes; `formatVersion` stays 5.

**Tech Stack:** TypeScript strict, pnpm, vitest, Biome, citty (CLI),
Postgres 17 in local Docker (colima) for the dogfood repository only.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` (D80, D81; the
decision log is the authority) · roadmap section "Phase 9" in
`docs/plans/2026-08-19-roadmap.md` · issues #260–#269.

## Global Constraints

- `@hejbro/core` stays **pure**: no fs, no DB, no new runtime dependency.
- Our own TS: no `any`, no `let`/`var`, no `for`/`while`, no ternary, no
  enums; CRAP ≤ 5 is gated in CI (`pnpm check:crap`), so new functions stay
  small and fully covered.
- Naming follows the medium (D57): snapshot fields `name`/`schema`/`table`;
  kebab-case tokens in generated artifacts; camelCase in TS-only unions.
- **Every PR that changes a published package carries exactly one
  `.changeset/*.md`** (D59). Phase 9 PRs are `patch` unless the owner
  decides otherwise at PR B (#269).
- All GitHub-facing text in English; conventional commits, subject ≤ 72
  chars, lower-case.
- Owner-approved verbatim CLI texts (`hejbro --help` root description,
  `generate --help` two paragraphs, restore messages) **do not change**
  without the owner; this plan proposes the only wording/help changes it
  needs (Tasks 13–15) and the owner's approval of this plan covers them.
- Work in a worktree under `../hejbro-worktrees/`; push branches to
  `upstream`; PR body lists the squash commits and `Closes #N`.

---

## PR map

| PR | Branch | Issues | Changeset | Depends on |
|----|--------|--------|-----------|------------|
| plan | `phase9-plan` | #260 (this document, roadmap, D80–D81, Phase 8 closeout) | none (docs) | — |
| A | `phase9-column-order` | #261 | `patch` | — |
| B | `phase9-schema-arg` | #269 | `patch` (or `minor`, owner's call — Task 10) | — |
| C | `phase9-docs` | #262, #263 | none (docs only) | B lands first so README can use the object form |
| D | `phase9-cli-help` | #264, #265 | `patch` | — |
| E | (repo `hejbro-dogfood`, `main`) | #266 | — | A published as 0.1.1 before the final pass |
| F | `phase9-ts7` | #267 | `patch` if it changes a published package's build output, else none | — |
| release | owner | #268 | — | A–D merged |

A, B, D, F are independent and can run in parallel worktrees. C follows B.

---

## PR A — #261: snapshot column order is physical order (D81)

### Design summary (read before Task 1)

Today:

- `TableDeclaration.columns` is declaration order
  (`packages/core/src/dsl/table.ts:62–78`); `serializeColumns`
  (`packages/core/src/kinds/table-kind.ts:250–265`) copies that order into
  `TableSnapshot.columns`; `createTableSql`
  (`packages/core/src/kinds/table-kind-emit-sql.ts:131–138`) emits it.
- `select(table)` freezes `columnNames` into a `ProjectionNode`
  (`packages/core/src/query/select.ts:108–116`) and bare `.returning()`
  into a `ReturningNode` (`packages/core/src/query/mutate.ts:97–100`) —
  both from `getTableMeta(target).columns`, i.e. declaration order, at
  DSL time. `renderProjection`/`renderReturning`
  (`packages/core/src/expr/render-sql.ts:313–314`, `369–370`) print them.
- `buildSnapshot(declarations, registry)`
  (`packages/core/src/snapshot/snapshot.ts:122–148`) has no parent; its one
  production call site is `generateMigration`
  (`packages/core/src/engine/generate.ts:276`), which *does* have
  `options.previousSnapshot` and `options.renames` in hand.
- `verify` check 2 (`packages/cli/src/commands/verify.ts:387–406`) and
  `restore` (`packages/cli/src/commands/restore.ts:392–399`) rebuild with
  `previousSnapshot: emptySnapshot` although both hold the right parent
  text four lines earlier (`diskText`, `targetSnapshotText`).
- The table diff is name-keyed (`diffByKey`,
  `packages/core/src/kind/diff-helpers.ts:119–152`; pinned by
  `packages/core/test/table-kind-diff.test.ts:179–191` "no changes when
  only column declaration order changes") — that pin stays true.

After:

```
generateMigration(options)
  └ buildSnapshot(normalized, registry, options.previousSnapshot, options.renames)
        ├ oracle = computeColumnOrder(normalized, previous, renames)     // Task 1
        └ kind.serialize(declaration, { columnOrder: oracle })           // Task 3
              ├ tableKind: columns re-ordered by oracle                  // Task 4
              ├ functionKind: renderFunctionSql(decl, oracle) — every
              │   select/returning allColumns list re-resolved            // Task 5
              └ viewKind: query + columns re-resolved                     // Task 6
```

The oracle's rule (D81): for a table present in the parent, existing
columns keep the parent's order (column renames mapped old → new, table
renames looked up under the old name), then columns not in the parent are
appended in declaration order; for a table absent from the parent,
declaration order. A table that a `--rename` directive keeps alive under a
new name therefore keeps its positions; a dropped-then-re-added column is
"not in the parent" and goes last — exactly what Postgres does.

### File structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/snapshot/column-order.ts` (new) | `ColumnOrderOracle` type; `computeColumnOrder(declarations, previous, renames)`; `applyColumnOrderToSelect` / `applyColumnOrderToQuery` (re-resolve `allColumns` lists on AST nodes) |
| `packages/core/src/kind/object-kind.ts` | `SerializeContext` type; `serialize(declaration, context?)` |
| `packages/core/src/snapshot/snapshot.ts` | `buildSnapshot(declarations, registry, previous, renames = [])` |
| `packages/core/src/kinds/table-kind.ts` | `serializeColumns` ordered by the oracle |
| `packages/core/src/plpgsql/render-body.ts`, `packages/core/src/kinds/function-kind.ts` | `renderFunctionSql(declaration, columnOrder)` threads the oracle into `returnQuery`/`selectInto`/`forEach` |
| `packages/core/src/kinds/view-kind.ts` | `serialize` re-resolves the projection |
| `packages/core/src/engine/generate.ts` | passes `previousSnapshot` + `renames` into `buildSnapshot` |
| `packages/cli/src/commands/verify.ts`, `restore.ts` | real parent instead of `emptySnapshot` |
| `packages/core/src/index.ts` | exports `ColumnOrderOracle`, `SerializeContext`, `computeColumnOrder` (presets may want them; `applyColumnOrderTo*` stay internal) |
| tests | `packages/core/test/column-order.test.ts` (new), additions in `snapshot.test.ts`, `table-kind-diff.test.ts`, `function-kind.test.ts`, `view-kind.test.ts`, `generate.test.ts`, new golden case `packages/core/test/golden/cases/column-insert-mid/`, `packages/cli/test/verify.test.ts`, `restore-command.test.ts`, `examples/cli-smoke/test/e2e.test.ts` |
| docs | `skills/hejbro/references/dsl-cheatsheet.md`, `docs/guide/renames.md`, `.changeset/phase9-column-order.md` |

### Task 1: the column-order oracle (pure)

**Files:**
- Create: `packages/core/src/snapshot/column-order.ts`
- Test: `packages/core/test/column-order.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (`snapshot/snapshot.ts:40`), `TableSnapshot`/`asTableSnapshot` (`kinds/table-snapshot.ts:146,167`), `HejbroDeclaration` + `TableDeclaration` (`dsl/table.ts:62`), `RenameSpec`/`ColumnRenameSpec`/`TableRenameSpec` (`engine/rename-plan.ts:49–66`), `TableRefNode`, `SelectNode`, `QueryNode` (`expr/ast.ts`).
- Produces:
  ```ts
  export type ColumnOrderOracle = (table: TableRefNode) => ReadonlyArray<string> | null;
  export const computeColumnOrder: (
    declarations: ReadonlyArray<HejbroDeclaration>,
    previous: Snapshot,
    renames: ReadonlyArray<RenameSpec>,
  ) => ColumnOrderOracle;
  export const applyColumnOrderToSelect: (node: SelectNode, columnOrder: ColumnOrderOracle) => SelectNode;
  export const applyColumnOrderToQuery: (node: QueryNode, columnOrder: ColumnOrderOracle) => QueryNode;
  export const noColumnOrder: ColumnOrderOracle;   // () => null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/column-order.test.ts
import { describe, expect, it } from "vitest";
import { emptySnapshot, schema, table, text, timestamptz, uuid } from "../src/index";
import { getTableMeta } from "../src/dsl/table";
import {
	applyColumnOrderToQuery,
	applyColumnOrderToSelect,
	computeColumnOrder,
} from "../src/snapshot/column-order";
import type { Snapshot } from "../src/snapshot/snapshot";

const app = schema("app");
const ref = { schemaName: "app", tableName: "projects" };

const parentWith = (columns: ReadonlyArray<string>): Snapshot => ({
	...emptySnapshot,
	objects: {
		"table:app.projects": {
			schema: "app",
			name: "projects",
			columns: columns.map((name) => ({ name, typeNode: { typeName: "text" } })),
			indexes: [],
			foreignKeys: [],
		},
	},
});

const declared = (...names: ReadonlyArray<string>) =>
	getTableMeta(
		table(
			app,
			"projects",
			Object.fromEntries(names.map((name) => [name, text()])),
		),
	);

describe("computeColumnOrder", () => {
	it("keeps declaration order for a table absent from the parent", () => {
		const oracle = computeColumnOrder([app, declared("id", "title")], emptySnapshot, []);
		expect(oracle(ref)).toEqual(["id", "title"]);
	});

	it("inherits the parent's order and appends new columns in declaration order", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "title", "description", "level", "archivedAt")],
			parentWith(["id", "title", "archived_at"]),
			[],
		);
		expect(oracle(ref)).toEqual(["id", "title", "archived_at", "description", "level"]);
	});

	it("ignores a reorder of existing columns", () => {
		const oracle = computeColumnOrder(
			[app, declared("archivedAt", "title", "id")],
			parentWith(["id", "title", "archived_at"]),
			[],
		);
		expect(oracle(ref)).toEqual(["id", "title", "archived_at"]);
	});

	it("keeps a renamed column in place", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "name", "archivedAt")],
			parentWith(["id", "title", "archived_at"]),
			[{ target: "column", schemaName: "app", tableName: "projects", oldName: "title", newName: "name" }],
		);
		expect(oracle(ref)).toEqual(["id", "name", "archived_at"]);
	});

	it("looks a renamed table up under its old name", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "title", "archivedAt", "description")],
			{
				...emptySnapshot,
				objects: { "table:app.items": parentWith(["id", "title", "archived_at"]).objects["table:app.projects"] },
			},
			[{ target: "table", schemaName: "app", oldName: "items", newName: "projects" }],
		);
		expect(oracle(ref)).toEqual(["id", "title", "archived_at", "description"]);
	});

	it("drops a column that left the declaration and appends it again if it comes back", () => {
		const oracle = computeColumnOrder(
			[app, declared("id", "archivedAt", "title")],
			parentWith(["id", "archived_at"]), // "title" was dropped in an earlier migration
			[],
		);
		expect(oracle(ref)).toEqual(["id", "archived_at", "title"]);
	});

	it("returns null for a table it knows nothing about", () => {
		const oracle = computeColumnOrder([app], emptySnapshot, []);
		expect(oracle({ schemaName: "auth", tableName: "users" })).toBeNull();
	});
});

describe("applyColumnOrderTo*", () => {
	const oracle = computeColumnOrder(
		[app, declared("id", "title", "description", "archivedAt")],
		parentWith(["id", "title", "archived_at"]),
		[],
	);
	const allColumns = { projectionKind: "allColumns", columnNames: ["id", "title", "description", "archived_at"] } as const;
	const select = { queryKind: "select", projection: allColumns, from: ref, joins: [], where: null, orderBy: [], limit: null } as const;

	it("re-orders an allColumns projection by the oracle", () => {
		expect(applyColumnOrderToSelect(select, oracle).projection).toEqual({
			projectionKind: "allColumns",
			columnNames: ["id", "title", "archived_at", "description"],
		});
	});

	it("leaves a columns projection and an unknown table alone", () => {
		const unknown = { ...select, from: { schemaName: "auth", tableName: "users" } };
		expect(applyColumnOrderToSelect(unknown, oracle)).toBe(unknown);
	});

	it("re-orders an allColumns returning on insert/update/delete", () => {
		const update = {
			queryKind: "update",
			table: ref,
			set: [],
			where: null,
			returning: { returningKind: "allColumns", columnNames: ["id", "title", "description", "archived_at"] },
		} as const;
		expect(applyColumnOrderToQuery(update, oracle)).toMatchObject({
			returning: { columnNames: ["id", "title", "archived_at", "description"] },
		});
	});
});
```

(`getTableMeta` is exported from `../src/index` (line 66) — either import
works. `text()` columns suffice — the oracle reads names only; `TypeNode`'s
simple variant is `{ typeName: "text" }` (`packages/core/src/types/type-node.ts:45`).)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hejbro/core exec vitest run test/column-order.test.ts`
Expected: FAIL — `Cannot find module '../src/snapshot/column-order'`.

- [ ] **Step 3: Implement the module**

```ts
// packages/core/src/snapshot/column-order.ts
import type { HejbroDeclaration } from "../kind/object-kind"; // type-only; object-kind.ts imports ColumnOrderOracle back as `import type`, which TS erases — no runtime cycle
import type { TableDeclaration } from "../dsl/table";
import type { ColumnRenameSpec, RenameSpec, TableRenameSpec } from "../engine/rename-plan";
import type { ProjectionNode, QueryNode, ReturningNode, SelectNode, TableRefNode } from "../expr/ast";
import { asTableSnapshot } from "../kinds/table-snapshot";
import type { Snapshot } from "./snapshot";

/** Answers "what is the physical column order of this table?" — `null` when the table is unknown to the declarations being built. */
export type ColumnOrderOracle = (table: TableRefNode) => ReadonlyArray<string> | null;

/** The oracle that knows nothing — used where no parent snapshot applies (tests, presets calling `serialize` directly). */
export const noColumnOrder: ColumnOrderOracle = () => null;

const isTableDeclaration = (declaration: HejbroDeclaration): declaration is TableDeclaration =>
	declaration.declarationKind === "table";

const isColumnRename = (spec: RenameSpec): spec is ColumnRenameSpec => spec.target === "column";
const isTableRename = (spec: RenameSpec): spec is TableRenameSpec => spec.target === "table";

/** The parent-side name of a table: if a table rename lands on this name, look the parent up under the old one. */
const parentTableName = (schemaName: string, tableName: string, renames: ReadonlyArray<RenameSpec>): string =>
	renames
		.filter(isTableRename)
		.filter((spec) => spec.schemaName === schemaName && spec.newName === tableName)
		.map((spec) => spec.oldName)[0] ?? tableName;

/** Parent column names, already spelled the way the next snapshot spells them (column renames applied). */
const parentColumnNames = (
	previous: Snapshot,
	schemaName: string,
	tableName: string,
	renames: ReadonlyArray<RenameSpec>,
): ReadonlyArray<string> => {
	const node = previous.objects[`table:${schemaName}.${parentTableName(schemaName, tableName, renames)}`];
	if (node === undefined) {
		return [];
	}
	const renamed = new Map(
		renames
			.filter(isColumnRename)
			.filter((spec) => spec.schemaName === schemaName && spec.tableName === tableName)
			.map((spec) => [spec.oldName, spec.newName] as const),
	);
	return asTableSnapshot(node).columns.map((column) => renamed.get(column.name) ?? column.name);
};

/** D81: parent order for the columns that survive, then the newcomers in declaration order. */
const physicalOrder = (parent: ReadonlyArray<string>, declared: ReadonlyArray<string>): ReadonlyArray<string> => {
	const declaredSet = new Set(declared);
	const parentSet = new Set(parent);
	return [
		...parent.filter((name) => declaredSet.has(name)),
		...declared.filter((name) => !parentSet.has(name)),
	];
};

export const computeColumnOrder = (
	declarations: ReadonlyArray<HejbroDeclaration>,
	previous: Snapshot,
	renames: ReadonlyArray<RenameSpec>,
): ColumnOrderOracle => {
	const orders = new Map(
		declarations.filter(isTableDeclaration).map((declaration) => {
			const schemaName = declaration.schema.schemaName;
			const declared = declaration.columns.map((column) => column.columnName);
			return [
				`${schemaName}.${declaration.tableName}`,
				physicalOrder(parentColumnNames(previous, schemaName, declaration.tableName, renames), declared),
			] as const;
		}),
	);
	return (table) => orders.get(`${table.schemaName}.${table.tableName}`) ?? null;
};

const orderedProjection = (projection: ProjectionNode, table: TableRefNode, columnOrder: ColumnOrderOracle): ProjectionNode => {
	if (projection.projectionKind !== "allColumns") {
		return projection;
	}
	const order = columnOrder(table);
	if (order === null) {
		return projection;
	}
	return { projectionKind: "allColumns", columnNames: order };
};

const orderedReturning = (returning: ReturningNode | null, table: TableRefNode, columnOrder: ColumnOrderOracle): ReturningNode | null => {
	if (returning === null || returning.returningKind !== "allColumns") {
		return returning;
	}
	const order = columnOrder(table);
	if (order === null) {
		return returning;
	}
	return { returningKind: "allColumns", columnNames: order };
};

export const applyColumnOrderToSelect = (node: SelectNode, columnOrder: ColumnOrderOracle): SelectNode => {
	const projection = orderedProjection(node.projection, node.from, columnOrder);
	if (projection === node.projection) {
		return node;
	}
	return { ...node, projection };
};

export const applyColumnOrderToQuery = (node: QueryNode, columnOrder: ColumnOrderOracle): QueryNode => {
	if (node.queryKind === "select") {
		return applyColumnOrderToSelect(node, columnOrder);
	}
	const returning = orderedReturning(node.returning, node.table, columnOrder);
	if (returning === node.returning) {
		return node;
	}
	return { ...node, returning };
};
```

Notes for the implementer: identity equality (`=== node`) is what the "leaves alone" test
asserts, so return the same object when nothing changes. Each function is
a handful of lines — CRAP stays under 5 with the tests above.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hejbro/core exec vitest run test/column-order.test.ts`
Expected: PASS (all 10).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/snapshot/column-order.ts packages/core/test/column-order.test.ts
git commit -m "feat(core): column-order oracle — parent order first, newcomers appended (D81)"
```

### Task 2: `SerializeContext` on `ObjectKind.serialize`

**Files:**
- Modify: `packages/core/src/kind/object-kind.ts:35–41`
- Modify: `packages/core/src/index.ts` (export `SerializeContext`, `ColumnOrderOracle`, `computeColumnOrder`, `noColumnOrder`)
- Test: `packages/core/test/snapshot.test.ts` (type-level: a kind with the 1-arg `serialize` still satisfies `ObjectKind`)

**Interfaces:**
- Produces:
  ```ts
  export type SerializeContext = { readonly columnOrder: ColumnOrderOracle };
  // on ObjectKind:
  serialize(declaration: TDeclaration, context?: SerializeContext): JsonValue;
  ```
  Additive and optional — the D74/D78 precedent (`emit`'s `siblingChanges?`/`nextSnapshot?`). Preset kinds (`@hejbro/supabase`'s `storageBucketKind`, `examples/preset-smoke`) keep compiling untouched.

- [ ] **Step 1: Write the failing type test**

Add to `packages/core/test/snapshot.test.ts`:

```ts
it("accepts a kind whose serialize ignores the context, and one that reads it", () => {
	const ignoring: ObjectKind<SchemaDeclaration> = { ...schemaKind, serialize: (declaration) => schemaKind.serialize(declaration) };
	const reading: ObjectKind<SchemaDeclaration> = {
		...schemaKind,
		serialize: (declaration, context) => ({
			...(schemaKind.serialize(declaration) as Record<string, unknown>),
			probe: context?.columnOrder({ schemaName: "x", tableName: "y" }) ?? null,
		}),
	};
	expect(ignoring.serialize(schema("a"))).toEqual(schemaKind.serialize(schema("a")));
	expect(reading.serialize(schema("a"), { columnOrder: () => ["k"] })).toMatchObject({ probe: ["k"] });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @hejbro/core exec vitest run test/snapshot.test.ts` — Expected: FAIL to type-check (`context` does not exist / `Expected 1 arguments`).

- [ ] **Step 3: Add the type**

In `object-kind.ts`, next to the interface:

```ts
import type { ColumnOrderOracle } from "../snapshot/column-order";

/** What `buildSnapshot` knows while serializing that a single declaration cannot: the physical column order of every table in this build (D81). Optional on `serialize` so kinds that never read it — and every preset kind written before it existed — are untouched. */
export type SerializeContext = {
	readonly columnOrder: ColumnOrderOracle;
};
```

and change line 41 to `serialize(declaration: TDeclaration, context?: SerializeContext): JsonValue;`. Export `SerializeContext` from `packages/core/src/index.ts` alongside the other kind types, plus `ColumnOrderOracle`, `computeColumnOrder`, `noColumnOrder` from `./snapshot/column-order`.

- [ ] **Step 4: Run the test + `pnpm --filter @hejbro/core check-types`** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): SerializeContext with a columnOrder oracle on ObjectKind.serialize (D81)"`

### Task 3: `buildSnapshot` takes the parent (and renames) and threads the context

**Files:**
- Modify: `packages/core/src/snapshot/snapshot.ts:60–148`
- Modify: `packages/core/src/engine/generate.ts:276`
- Modify: every test call site of `buildSnapshot(` (8 files, 20 calls — `grep -rln "buildSnapshot(" packages/*/test examples/*/test`): add `, emptySnapshot` as the third argument.
- Test: `packages/core/test/snapshot.test.ts`

**Interfaces:**
- Produces: `buildSnapshot(declarations, registry, previous: Snapshot, renames: ReadonlyArray<RenameSpec> = []): Snapshot` — `previous` **required** (D81: no call site may silently fall back to declaration order).

- [ ] **Step 1: Write the failing test**

```ts
it("hands every kind a columnOrder oracle computed from the parent", () => {
	const probe: ObjectKind<SchemaDeclaration> = {
		...schemaKind,
		serialize: (declaration, context) => ({
			...(schemaKind.serialize(declaration) as Record<string, unknown>),
			order: context?.columnOrder({ schemaName: "app", tableName: "projects" }) ?? null,
		}),
	};
	const registry = createKindRegistry();
	registry.register(probe);
	registry.register(tableKind); // `createKindRegistry` + `register` — packages/core/src/kind/registry.ts:174
	const parent = buildSnapshot([app, table(app, "projects", { id: uuid(), archivedAt: timestamptz() })], registry, emptySnapshot);
	const next = buildSnapshot(
		[app, table(app, "projects", { id: uuid(), description: text(), archivedAt: timestamptz() })],
		registry,
		parent,
	);
	expect(next.objects["schema:app"]).toMatchObject({ order: ["id", "archived_at", "description"] });
});
```

- [ ] **Step 2: Run it** — Expected: FAIL (`order: null`, and type error on the third argument).

- [ ] **Step 3: Implement**

```ts
export const buildSnapshot = (
	declarations: ReadonlyArray<HejbroDeclaration>,
	registry: KindRegistry,
	previous: Snapshot,
	renames: ReadonlyArray<RenameSpec> = [],
): Snapshot => {
	const context: SerializeContext = { columnOrder: computeColumnOrder(declarations, previous, renames) };
	const entries = declarations.map((declaration, declarationIndex) =>
		buildEntry(declaration, declarationIndex, registry, context),
	);
	// …unchanged from here (duplicate check, sort, assemble)
};
```

`buildEntry` gains a fourth parameter `context: SerializeContext` and calls `kind.serialize(declaration, context)` (line 91). Update the JSDoc on `buildSnapshot`: "…`previous` is the snapshot this build succeeds; D81 derives every table's physical column order from it. Pass `emptySnapshot` for a first build."

In `generate.ts:276`: `const snapshot = buildSnapshot(normalized, resolved.registry, options.previousSnapshot, options.renames ?? []);` (check how `resolveGenerateMigrationOptions` normalizes `renames`; use the normalized value).

Then the mechanical sweep: `grep -rln "buildSnapshot(" packages/*/test examples/*/test | xargs sed -i '' 's/buildSnapshot(\([^)]*\), registry)/buildSnapshot(\1, registry, emptySnapshot)/'` — **read every diff hunk**; fix by hand where the call spans lines or the registry variable is named differently. Every test file that gains `emptySnapshot` must import it.

- [ ] **Step 4: Run** — `pnpm --filter @hejbro/core test && pnpm --filter @hejbro/core check-types` — Expected: PASS. (Goldens: unchanged — the oracle only re-orders when the parent's order differs from declaration order, and no golden case inserts mid-declaration.)

- [ ] **Step 5: Commit** — `git commit -m "feat(core): buildSnapshot takes the parent snapshot and renames (D81)"`

### Task 4: the table kind orders `columns` by the oracle

**Files:**
- Modify: `packages/core/src/kinds/table-kind.ts:250–265, 445–453`
- Test: `packages/core/test/table-kind-diff.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("serializes columns in the oracle's order, declaration order when the oracle is silent", () => {
	const declaration = getTableMeta(table(app, "projects", { id: uuid(), description: text(), archivedAt: timestamptz() }));
	const silent = tableKind.serialize(declaration) as TableSnapshot;
	expect(silent.columns.map((c) => c.name)).toEqual(["id", "description", "archived_at"]);
	const ordered = tableKind.serialize(declaration, { columnOrder: () => ["id", "archived_at", "description"] }) as TableSnapshot;
	expect(ordered.columns.map((c) => c.name)).toEqual(["id", "archived_at", "description"]);
});

it("emits create table in the snapshot's column order", () => {
	// build `ordered` as above, then:
	const sql = emitTableSql({ kind: "table", identity: "app.projects", operation: "create", previous: null, next: ordered, notes: [] });
	expect(sql.join("\n")).toMatch(/"id" uuid[\s\S]*"archived_at" timestamp with time zone[\s\S]*"description" text/);
});
```

(Mirror the existing `emitTableSql` test call shape in `table-kind-emit.test.ts` for the `KindChange` object — copy an existing create case and swap `next`.)

- [ ] **Step 2: Run** — Expected: FAIL on the `ordered` expectations.

- [ ] **Step 3: Implement**

```ts
const orderByOracle = (
	columns: ReadonlyArray<ColumnSnapshot>,
	order: ReadonlyArray<string> | null,
): ReadonlyArray<ColumnSnapshot> => {
	if (order === null) {
		return columns;
	}
	const byName = new Map(columns.map((column) => [column.name, column] as const));
	return order.flatMap((name) => {
		const column = byName.get(name);
		return column === undefined ? [] : [column];
	});
};

const serializeColumns = (declaration: TableDeclaration, context?: SerializeContext): ReadonlyArray<ColumnSnapshot> =>
	orderByOracle(
		declaration.columns.map(/* unchanged mapping */),
		context?.columnOrder({ schemaName: declaration.schema.schemaName, tableName: declaration.tableName }) ?? null,
	);
```

and `serialize: (declaration, context) => ({ …, columns: serializeColumns(declaration, context), … })`. (The `order.flatMap` form avoids a ternary; the oracle's order always contains exactly the declared names, so the `undefined` branch is defensive only — cover it with one test where the oracle returns a stale name, asserting it is skipped.) Update the kind's doc comment (419–438): column order in the snapshot is physical order (D81), inherited through `SerializeContext.columnOrder`; the diff stays name-keyed.

- [ ] **Step 4: Run** `pnpm --filter @hejbro/core test` — PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): table snapshot columns follow the physical order oracle (D81)"`

### Task 5: function bodies re-resolve `allColumns` at serialize time

**Files:**
- Modify: `packages/core/src/plpgsql/render-body.ts:90–120, 193–222`
- Modify: `packages/core/src/kinds/function-kind.ts:135–151`
- Test: `packages/core/test/function-kind.test.ts` (or `plpgsql/render-body.test.ts`)

**Interfaces:**
- Produces: `renderFunctionSql(declaration: FunctionDeclaration, columnOrder: ColumnOrderOracle = noColumnOrder): string`.

- [ ] **Step 1: Failing test**

```ts
it("renders returning and select-all lists in the oracle's order", () => {
	const projects = table(app, "projects", { id: uuid().primaryKey(), description: text(), archivedAt: timestamptz() });
	const fn = defineFunction("app", "archive", { args: { projectId: uuid() }, returns: projects }, (ctx, { projectId }) => {
		ctx.return(update(projects).set({ archivedAt: now() }).where(eq(projects.id, projectId)).returning());
	});
	const oracle = () => ["id", "archived_at", "description"];
	const sql = (functionKind.serialize(fn, { columnOrder: oracle }) as FunctionSnapshot).bodySql;
	expect(sql).toContain('returning "id", "archived_at", "description"');
	const plain = (functionKind.serialize(fn) as FunctionSnapshot).bodySql;
	expect(plain).toContain('returning "id", "description", "archived_at"');
});
```

(`defineFunction`'s first argument is still a string here — PR B changes that; if PR B has landed first, pass `app`.) Add a sibling test for `ctx.return(select(projects))` asserting `select "id", "archived_at", "description" from "app"."projects"`.

- [ ] **Step 2: Run** — FAIL (oracle ignored).

- [ ] **Step 3: Implement**

In `render-body.ts`: give `RenderStatementHandlers` a fifth parameter `columnOrder: ColumnOrderOracle`, thread it through `renderStatementLines(statement, depth, identity, declaredAt, columnOrder)` (and the recursive calls in `if`/`forEach`), and apply it where a query node reaches the renderer:

```ts
selectInto: (statement, depth, _identity, _declaredAt, columnOrder) => [
	`${indent(depth)}${renderSelectInto(applyColumnOrderToSelect(statement.query, columnOrder), statement.intoVariables, { strict: statement.strict })};`,
],
returnQuery: (statement, depth, _identity, _declaredAt, columnOrder) => [
	`${indent(depth)}return query ${renderQuery(applyColumnOrderToQuery(statement.query, columnOrder))};`,
],
forEach: (statement, depth, identity, declaredAt, columnOrder) => {
	const headerLine = `${indent(depth)}for ${statement.loopName} in ${renderSelect(applyColumnOrderToSelect(statement.query, columnOrder))} loop`;
	…renderStatementLines(inner, depth + 1, identity, declaredAt, columnOrder)…
},
```

`renderFunctionSql(declaration, columnOrder = noColumnOrder)` passes it to `renderStatementLines`. `functionKind.serialize: (declaration, context) => { const bodySql = renderFunctionSql(declaration, context?.columnOrder ?? noColumnOrder); … }`. Check `grep -rn "renderStatementLines\|renderFunctionSql" packages/core/src` for other callers (the trigger path renders through the same function kind — it gets the context for free).

- [ ] **Step 4: Run** `pnpm --filter @hejbro/core test` — PASS (existing `render-body.test.ts` matches are regex/order-insensitive, per the code map; `corpus.expected.txt` and `mutate.test.ts` render with no oracle, so they are unchanged).

- [ ] **Step 5: Commit** — `git commit -m "feat(core): function bodies render allColumns lists in physical order (D81)"`

### Task 6: views re-resolve their projection

**Files:**
- Modify: `packages/core/src/kinds/view-kind.ts:179–188`
- Test: `packages/core/test/view-kind.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("serializes columns and the encoded query in the oracle's order", () => {
	const projects = table(app, "projects", { id: uuid(), description: text(), archivedAt: timestamptz() });
	const view = defineView(app, "projects_v", select(projects));
	const snapshot = viewKind.serialize(view, { columnOrder: () => ["id", "archived_at", "description"] }) as ViewSnapshot;
	expect(snapshot.columns).toEqual(["id", "archived_at", "description"]);
	expect(viewSelectSql(snapshot)).toBe('select "id", "archived_at", "description" from "app"."projects"');
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```ts
serialize: (declaration, context) => {
	const query = applyColumnOrderToSelect(declaration.query, context?.columnOrder ?? noColumnOrder);
	const snapshot: ViewSnapshot = {
		schema: declaration.schema.schemaName,
		name: declaration.viewName,
		columns: projectionColumns(query.projection),
		query: encodeSelectNode(query),
		...securityInvokerField(declaration.securityInvoker),
	};
	return snapshot;
},
```

Note in the kind's doc comment: with D81 a column added mid-declaration to the underlying table now arrives **last** in the view's list, so it is a prefix extension (`create or replace view`) rather than the D27 drop + recreate — add a test asserting exactly that across two `buildSnapshot` calls (parent → next with the mid-declaration column) and `viewKind.diff`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -m "feat(core): view snapshots resolve allColumns in physical order (D81)"`

### Task 7: the engine end to end — golden case + rename keeps position

**Files:**
- Create: `packages/core/test/golden/cases/column-insert-mid/steps.ts`, `declarations.ts`, `expected/` (recorded)
- Test: `packages/core/test/generate.test.ts`

- [ ] **Step 1: Write the golden case**

`declarations.ts`: `export const app = schema("app")`. `steps.ts` (mirror `cases/app-posts/steps.ts`'s shape exactly — `export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>>`, the shape `golden.test.ts`'s `StepsModule` type expects):

- step 1: `projects(id uuid pk default random, title text not null, archivedAt timestamptz)`, a `returns: projects` function `archive_project(projectId)` whose body is `ctx.return(update(projects).set({ archivedAt: now() }).where(eq(projects.id, projectId)).returning())`, and a view `projects_v = defineView(app, "projects_v", select(projects))`.
- step 2: same, with `description: text()` inserted **between** `title` and `archivedAt`.
- step 3: same, with `level: integer()` inserted between `description` and `archivedAt` **and** `note: text()` appended after `archivedAt`.

- [ ] **Step 2: Record and review**

Run: `UPDATE_GOLDEN=1 pnpm --filter @hejbro/core exec vitest run test/golden/golden.test.ts` then open `expected/`:
- `step-2.sql` must contain `alter table "app"."projects" add column "description" text;`, a `create or replace function` whose body ends `returning "id", "title", "archived_at", "description";`, and `create or replace view "app"."projects_v" as select "id", "title", "archived_at", "description" from "app"."projects";` (no `drop view` — prefix extension).
- `step-3.sql`: two `add column` statements (`level`, `note` — `diffByKey` sorts `added` alphabetically, so `level` then `note`, which is also declaration order here; keep it that way so the emitted order equals the snapshot order), `returning "id", "title", "archived_at", "description", "level", "note"`.
- `snapshot.json`: `columns` for `table:app.projects` in the order `id, title, archived_at, description, level, note`.
- `from-empty.sql`: `create table` in **declaration** order (`id, title, description, level, archived_at, note`) — the documented fresh-project behavior; leave it, and add a comment at the top of `steps.ts` saying so.

Commit the recorded files only after this review; the review is the test.

- [ ] **Step 3: Rename keeps position (unit)**

In `generate.test.ts`:

```ts
it("keeps a renamed column in place and appends a newcomer behind it", () => {
	const v1 = generateMigration({ declarations: [app, table(app, "projects", { id: uuid(), title: text(), archivedAt: timestamptz() })], previousSnapshot: emptySnapshot });
	const v2 = generateMigration({
		declarations: [app, table(app, "projects", { id: uuid(), name: text(), description: text(), archivedAt: timestamptz() })],
		previousSnapshot: v1.snapshot,
		renames: [{ target: "column", schemaName: "app", tableName: "projects", oldName: "title", newName: "name" }],
	});
	expect((v2.snapshot.objects["table:app.projects"] as TableSnapshot).columns.map((c) => c.name)).toEqual(["id", "name", "archived_at", "description"]);
	expect(v2.sql).toContain('rename column "title" to "name"');
	expect(v2.sql).toContain('add column "description" text');
});
```

Add the `--confirm-drop` twin: drop `title`, add `summary` in the same run with `confirmedDrops`, expect `["id", "archived_at", "summary"]`. Add the cross-table move twin (column leaves `a`, appears in `b` → last in `b`).

- [ ] **Step 4: Run** `pnpm --filter @hejbro/core test` — PASS. **Step 5: Commit** — `git commit -m "test(core): golden column-insert-mid and rename/confirm-drop ordering (D81)"`

### Task 8: CLI — `verify` and `restore` rebuild against the real parent

**Files:**
- Modify: `packages/cli/src/commands/verify.ts:387–406`
- Modify: `packages/cli/src/commands/restore.ts:379–399`
- Test: `packages/cli/test/verify.test.ts`, `packages/cli/test/restore-command.test.ts`, `examples/cli-smoke/test/e2e.test.ts`

- [ ] **Step 1: Failing CLI tests**

`verify.test.ts` — build a fixture by driving the **built** CLI twice as a
subprocess (the file's own pattern: `runCli`, `writeFixtureFile`,
`assertBuiltCli` from `./support/cli-runner`; its local `writeSchema(source)`
takes one argument; `stdout` is a string):

```ts
it("passes when the committed snapshot's column order differs from declaration order (D81)", async () => {
	await writeSchema(`…projects: id, title, archivedAt…`);
	await runCli(cwd, ["generate"]);
	await writeSchema(`…projects: id, title, description, archivedAt…`); // mid-declaration insert
	await runCli(cwd, ["generate"]);
	const snapshot = JSON.parse(await readFile(join(cwd, "hejbro.snapshot.json"), "utf8"));
	expect(snapshot.objects["table:app.projects"].columns.map((c: { name: string }) => c.name)).toEqual(["id", "title", "archived_at", "description"]);
	const result = await runCli(cwd, ["verify"]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("5 checks passed");
});
```

Before the fix this fails at check 2 with `snapshot-stale` (the rebuild from `emptySnapshot` is in declaration order). `restore-command.test.ts`: same two-generate history committed to the fixture's git repo, then `runCli(cwd, ["restore", "1"])` exits 0 and prints `verified: restored declarations reproduce migration 1's recorded snapshot`; and `runCli(cwd, ["restore", "2"])` (a no-op restore) also verifies — before the fix the step-2 rebuild hash would not match the banner. `examples/cli-smoke/test/e2e.test.ts`: insert a mid-declaration column step between the existing `generate` and `verify` steps of the single flow.

- [ ] **Step 2: Run** — FAIL as described.

- [ ] **Step 3: Implement**

`verify.ts` `runCheck2`:
```ts
const currentSnapshot = generateMigration({
	declarations,
	previousSnapshot: parseSnapshot(diskText, requiredKeysByKind(registry)),
	registry,
}).snapshot;
```
(`diskText` already parsed once in check 1 — if `runCheck1` returns the parsed `Snapshot`, pass that instead of re-parsing; either is fine, parsing is cheap and pure.)

`restore.ts` (after line 381, before the rebuild):
```ts
const targetSnapshot = parseSnapshot(targetSnapshotText, requiredKeysByKind(registry));
const rebuilt = generateMigration({ declarations, previousSnapshot: targetSnapshot, registry });
```
Mind the existing format-version guard at 382–390 — it must still run before `parseSnapshot` (an older format must produce the existing skip-and-note path, not a parse error).

- [ ] **Step 4: Run** `pnpm build --force && pnpm test` (CLI e2e tests spawn the built CLI — the AGENTS.md freshness note applies) — PASS. **Step 5: Commit** — `git commit -m "fix(cli): verify and restore rebuild the snapshot against the real parent (D81)"`

### Task 9: docs line, examples regen check, changeset, PR

- [ ] **Step 1: Docs** — `skills/hejbro/references/dsl-cheatsheet.md` near line 7 (`table(schema, name, columns, extras?)`): add
  > Column order: the declaration order is used when the table is created; a column added later lands at the **end** of the table in Postgres whatever position it has in the object literal, and hejbro's snapshot and generated SQL follow that physical order (reordering existing columns in TypeScript changes nothing).

  `docs/guide/renames.md` "expand–contract" step (line 85–86): append "(the new column is appended at the end of the table — Postgres has no "add column at position", and hejbro mirrors that in its snapshot)". Run `pnpm --filter @hejbro/skills test` (the links test).

- [ ] **Step 2: Examples unchanged** — `pnpm build --force && scripts/regen-examples.sh` then `git status --short examples/` must be **empty** (the code map established every example chain is appended-only; a diff here means the fix changed something it must not — stop and investigate, do not commit the diff).

- [ ] **Step 3: Changeset** — `pnpm changeset` → `patch` for `@hejbro/core` (the fixed group bumps all three). Text:

  > Fix: a function declared `returns: <table>` failed at call time (`structure of query does not match function result type`) once a column had been added to that table in the middle of its TypeScript declaration in a later migration. Snapshot column order is now the table's physical order: existing columns keep their order, new columns are appended, a renamed column keeps its position — the rule Postgres applies. `select(table)` / `.returning()` lists in function bodies and view definitions follow it. No snapshot format change; unchanged declarations render unchanged. Known limitation: a snapshot that already diverged from the database on 0.1.0 (a mid-declaration insert generated before this fix) is not repaired — hejbro has no database access by design; regenerate that table's functions by hand once, or drop and re-add the column.

- [ ] **Step 4: Gates** — `pnpm check && pnpm check-types && pnpm test && pnpm check:crap` — all green; paste the tails in the PR body.

- [ ] **Step 5: PR** — branch `phase9-column-order` → `upstream`, PR to `dev`, `Closes #261`, commits listed, the golden review notes from Task 7 Step 2 in the body.

---

## PR B — #269: `defineFunction` takes the schema object

### Task 10: accept `SchemaDeclaration`, keep the string (decision recorded in the PR)

**Files:**
- Modify: `packages/core/src/dsl/define-function.ts:116–130`
- Test: `packages/core/test/define-function.test.ts` (or wherever `defineFunction` is unit-tested — `grep -rln "defineFunction(" packages/core/test | head`)

**Interfaces:**
- Produces: `defineFunction(owner: SchemaDeclaration | string, functionName, config, body)`. The string branch is `@deprecated` in JSDoc ("pass the `schema(...)` object, as `table`/`defineView`/`grant` do; the string form is kept on 0.1.x and goes in 0.2.0"). **Owner decision at PR time:** drop the string now (then the changeset is `minor` and the next release is 0.2.0) or keep it (then `patch`, and the removal is a 0.2.0 item). This plan assumes *keep*; if the owner says *drop*, delete the string branch and the deprecated test, and change the changeset to `minor`.

- [ ] **Step 1: Failing tests**

```ts
it("accepts the declared schema object and derives the identity from it", () => {
	const app = schema("app");
	const fn = defineFunction(app, "f", { returns: text() }, (ctx) => { ctx.return(…); });
	expect(fn.schemaName).toBe("app");
	expect(functionKind.identify(functionKind.serialize(fn))).toBe("app.f");
});
it("still accepts the schema name as a string (deprecated on 0.1.x)", () => {
	const fn = defineFunction("app", "f", { returns: text() }, (ctx) => { … });
	expect(fn.schemaName).toBe("app");
});
```

- [ ] **Step 2: Run** — FAIL (type error on the object form).

- [ ] **Step 3: Implement**

```ts
const schemaNameOf = (owner: SchemaDeclaration | string): string => {
	if (typeof owner === "string") {
		return owner;
	}
	return owner.schemaName;
};

export const defineFunction = <TArgs extends Record<string, ColumnBuilder>>(
	/** The declared schema (`schema("app")`). @deprecated passing the name as a string is accepted on 0.1.x for compatibility and goes in 0.2.0. */
	owner: SchemaDeclaration | string,
	functionName: string,
	config: { … },
	body: …,
): FunctionDeclaration => {
	const schemaName = schemaNameOf(owner);
	const identity = `${schemaName}.${functionName}`;
	// …rest unchanged, using schemaName
```

- [ ] **Step 4: Call sites** — `README.md` 60-seconds block: `defineFunction(app, "archive_project", …)`; `docs/specs/2026-08-19-hejbro-design.md:217` (`publishPost`) — update the example (it is illustrative text, not a decision); `skills/hejbro/references/*.md` and `packages/cli/README.md` if they show the string form (`grep -rn 'defineFunction("' README.md docs skills packages/*/README.md examples`). Tests in `packages/core/test` that use the string form may stay (they pin the deprecated branch) except one per file switched to the object form so both are exercised.

- [ ] **Step 5: Run** `pnpm check && pnpm check-types && pnpm test` — PASS. Changeset `patch` (or `minor`, see above): "`defineFunction` now takes the declared schema object as its first argument, like `table`/`defineView`/`grant`; the string form is deprecated." **Commit, PR** `phase9-schema-arg`, `Closes #269`.

---

## PR C — #262, #263: docs after 0.1.0

### Task 11: `docs/guide/getting-started.md`

- [ ] Replace the opening paragraph and the `workspace:*` JSON block with the README's install block:
  ```md
  Install the user-facing package (and the Supabase preset if you use it):

  ```bash
  pnpm add hejbro
  # using the Supabase preset?
  pnpm add @hejbro/supabase
  ```
  ```
- [ ] Refresh both sample outputs from a real run in a scratch project on the released version (`pnpm add hejbro@latest` in a temp dir, `hejbro init`, the guide's `posts` schema, `hejbro generate`, `hejbro verify`): the `generate` banner gains `-- hejbro: <version>` as its second line; `verify` prints `verify: 5 checks passed (1 migrations, snapshot sha256:…)`. Paste exactly what the CLI printed (hashes included — they are deterministic for that schema).
- [ ] Commit: `docs(guide): getting-started reflects the published 0.1.x`.

### Task 12: README 60-seconds example warns

- [ ] In `README.md`'s `src/app.schema.ts` block add `grant` to the import list and, after `appReaderRole`:
  ```ts
  export const appUsage = grant(app).usage.to(appReaderRole);
  ```
- [ ] Regenerate the sample SQL block from a scratch project (same procedure as Task 11) so the banner lines and statements are real: the banner gains `-- + grant app.schema-usage.app_reader [new]` and the SQL gains `grant usage on schema "app" to "app_reader";`; keep the README's existing `…` elision style for the long tail.
- [ ] Run the snippet in the scratch project: `hejbro generate` prints **no** warning. Paste that fact (the exit line) in the PR body.
- [ ] Same edit anywhere the snippet is duplicated (`grep -rn "projects_read_all" README.md docs skills packages/*/README.md`).
- [ ] Commit: `docs(readme): the 60-seconds example grants schema usage so it generates warning-free`. PR `phase9-docs`, `Closes #262`, `Closes #263`; no changeset (docs only — `changeset status` will not ask).

---

## PR D — #264, #265: CLI help and the restore undo hint

### Task 13: `hejbro restore --help` documents `<n>`

**Files:** `packages/cli/src/commands/restore.ts:497–510`; test `packages/cli/test/help.test.ts`.

- [ ] **Failing test** (in `help.test.ts`, same `runHelp` helper):
  ```ts
  describe("hejbro restore --help", () => {
  	it("documents the migration number positional", async () => {
  		const result = await runHelp(cwd, ["restore", "--help"]);
  		expect(result.exitCode).toBe(0);
  		expect(result.stdout).toContain("hejbro restore [N]"); // citty renders a `required: false` positional as `[N]`
  		expect(result.stdout).toContain("the migration's number in `hejbro history` (1 = oldest)");
  	});
  });
  ```
- [ ] **Implement**: add to `restoreCommand`
  ```ts
  args: {
  	n: {
  		type: "positional",
  		name: "n",
  		description: "the migration's number in `hejbro history` (1 = oldest)",
  		required: false,
  	},
  },
  ```
  `required: false` keeps citty from throwing its own `Missing required positional argument` before `run` — `runRestore` keeps reading `ctx.rawArgs` and printing its owner-approved missing/out-of-range messages unchanged (verify with the existing `restore-command.test.ts` cases).
- [ ] Run `pnpm build --force && pnpm --filter hejbro test` — PASS.

### Task 14: `hejbro --help`'s COMMANDS table stays one line per command

**Files:** `packages/cli/src/cli.ts`, `packages/cli/src/main.ts`; test `help.test.ts`.

Context: citty 0.2.2's `renderUsage` puts each subcommand's full `meta.description` into the table (`node_modules/citty/dist/index.mjs:337`), and `generate`'s description is the owner-approved two-paragraph text (decision ④, pinned by `help.test.ts`) — so it must not change. `runMain(cmd, { showUsage })` accepts a replacement renderer (`index.mjs:384`: `opts.showUsage || showUsage`); `RunMainOptions` in `index.d.mts` is the type to satisfy — if it is narrower than the runtime, write a typed adapter, not a cast.

- [ ] **Failing test**:
  ```ts
  it("renders each subcommand on one line in COMMANDS", async () => {
  	const result = await runHelp(cwd, ["--help"]);
  	const commands = result.stdout.split("COMMANDS")[1] ?? "";
  	const generateRow = commands.split("\n").filter((line) => line.trimStart().startsWith("generate"));
  	expect(generateRow).toHaveLength(1);
  	expect(generateRow[0]).toContain("Diff your TypeScript declarations against the last snapshot and write a new migration file.");
  	expect(commands).not.toContain("Renames are never confirmed interactively");
  });
  ```
- [ ] **Implement** in `cli.ts`:
  ```ts
  import { renderUsage, runMain, showUsage, type CommandDef } from "citty";
  import { main } from "./main";

  /** First paragraph of a description, joined onto one line — what the root COMMANDS table shows; `<cmd> --help` still prints the full text. */
  const firstParagraph = (description: string): string =>
  	description.split("\n\n")[0]?.replace(/\n/g, " ") ?? "";

  const withOneLineSubcommands = (cmd: CommandDef): CommandDef => ({
  	...cmd,
  	subCommands: Object.fromEntries(
  		Object.entries(cmd.subCommands ?? {}).map(([name, sub]) => [
  			name,
  			{ ...sub, meta: { ...sub.meta, description: firstParagraph(String(sub.meta?.description ?? "")) } },
  		]),
  	),
  });

  runMain(main, {
  	showUsage: async (cmd, parent) => {
  		if (cmd === main) {
  			console.log(await renderUsage(withOneLineSubcommands(cmd), parent));
  			return;
  		}
  		await showUsage(cmd, parent);
  	},
  });
  ```
  (`subCommands` values may be lazy in citty — `resolveValue`; here they are all plain objects, assert that with a type, not a runtime branch. Check `CommandDef`'s exported name in citty's `.d.ts`; adjust if `meta` is a `Resolvable`.) The root's own description is untouched (still one line, still the pinned text).
- [ ] Run the help tests and the full CLI test suite — PASS.

### Task 15: `restore`'s undo block says the files are staged

**Files:** `packages/cli/src/restore-diff.ts:154–166` (`renderUndoBlock`); tests pinning its text (`grep -rn "restore never commits" packages/cli/test`).

- [ ] Change the first line of the block to (proposed wording; the owner's approval of this plan approves it):
  `restore never commits — the restored files are staged; everything above is undoable:`
  and update the pinned test strings. `git checkout HEAD -- <file>` (the existing commands) is already the right undo for a staged change, so the commands stay.
- [ ] Run tests; changeset `patch` for PR D: "`hejbro restore --help` documents the `<n>` positional; `hejbro --help` keeps each command on one line; `restore`'s undo hint notes that restored files are staged." Commit messages: `fix(cli): restore --help documents <n>`, `fix(cli): one-line subcommand rows in hejbro --help`, `fix(cli): restore undo hint says the files are staged`. PR `phase9-cli-help`, `Closes #264`, `Closes #265`.

---

## PR E — #266: `hejbro-dogfood` scenario set v1 (other repository)

The repository exists (`quickstart-now/hejbro-dogfood`, private; bootstrapped from the day-one scratch project whose git history is that pass). Restructure:

```
hejbro-dogfood/
  README.md
  package.json                 # "hejbro": "0.1.x" exact, "@hejbro/supabase": "0.1.x" — bump by hand per pass
  tsconfig.json                # strict, NodeNext, skipLibCheck false
  lib/
    run-scenario.sh            # <scenario-dir> [--supabase]: docker run postgres:17-alpine (or `supabase start`), then per step:
                               #   cp steps/step-N.schema.ts src/app.schema.ts; hejbro generate $(cat steps/step-N.flags 2>/dev/null);
                               #   psql -f <the new migration>; finally psql -v ON_ERROR_STOP=1 -f expect.sql; hejbro verify
  scenarios/
    01-npm-consumer/           # init, README schema, generate, verify, tsc --noEmit (the day-one first step)
    02-column-insert-mid/      # #261: step-2 inserts description mid-declaration; expect.sql calls archive_project and selects from the view
    03-many-columns-and-readd/ # two columns in one generate (one mid, one last); drop a column, re-add it two steps later
    04-rename-and-confirm-drop/# step flags: `--rename app.projects.title=name`, then a drop+add with `--confirm-drop`
    05-function-body-only/
    06-history-restore/        # git commits per step; `hejbro restore 2`, `git checkout HEAD -- src`, verify
    07-tampered-snapshot/      # sed the snapshot; expect `verify` exit 1 with snapshot-stale + chain-tip-mismatch
    08-supabase-preset/        # --supabase: authUsers FK, authUidCached() RLS; expect.sql reads as `authenticated` for two users inside one transaction (set local role + set_config(..., true)); storage bucket row; grants
```

Each `expect.sql` is the assertion: it **executes** (calls the function, selects as a restricted role) and fails the run on any error; assertions use `do $$ begin if not (…) then raise exception '…'; end if; end $$;`. The README lists the scenarios, the runner, and the rule: findings go to `quickstart-now/hejbro` issues, never here. First full pass on 0.1.0 (expected: 02 fails — that is the reproduction), second on 0.1.1 (expected: all pass). Record each pass as a dated section in the README.

---

## PR F — #267: TypeScript 7.0 evaluation

- [ ] In a worktree on dependabot's branch (or a fresh branch with the same bump): `pnpm install`, `pnpm check-types`, `pnpm build --force`, `pnpm test`, `pnpm check:crap`, `scripts/pack-install-smoke.sh`. Read the TS 7 release notes for the flags this repo uses (`grep -h '"[a-zA-Z]*":' tsconfig*.json packages/*/tsconfig.json | sort -u`). Land if all green and no behavior change in `dist` (diff a built `packages/cli/dist/cli.js` before/after for anything beyond formatting); otherwise pin 5.9 and close #258 with the failing output. Note in the PR body that the dogfood consumer already ran on TS 7.0.2 strict without `skipLibCheck`.

---

## Release 0.1.1 and #268 (owner)

After A, B, D (and F if it lands) are on `dev` and the Version Packages PR shows `0.1.1` (or `0.2.0` if PR B drops the string form): the owner's four touches from the Phase 8 plan's *Owner actions* — approve the bot PR's CI, merge it on `dev`, merge `dev` → `main` with a **merge commit**, approve the `npm` environment. Then #268: confirm the `release-publish` run published via OIDC (no `NODE_AUTH_TOKEN` in the job), delete the `NPM_TOKEN` repository secret, and fix the stale comment at `release-publish.yml` L93 when the file is next touched. Then PR E's second pass, on the published version.

---

## Verifications that land with the code

- Every PR: `pnpm check && pnpm check-types && pnpm test && pnpm check:crap` green; tails in the PR body.
- PR A additionally: `scripts/regen-examples.sh` leaves `examples/` byte-identical (Task 9 Step 2); the golden review notes (Task 7 Step 2) in the PR body.
- PR E: the day-one scratch scenario reproduces #261 on 0.1.0 and passes on 0.1.1 — both runs' tails in the dogfood README and linked from #266.

## Rules that apply to every PR in this phase

- **Whole-row `*` is never the fix** for a column-list defect (D81, owner). If a rendering shortcut tempts, fix the derivation.
- **Consumer conditions stay undiluted in the dogfood repository**: npm install, own tsconfig, own git history. Anything that links to the workspace or shares tooling is no longer a dogfood and goes somewhere else.
- **Owner-approved CLI texts are pinned for a reason**: change them only with the owner, and put the proposed wording in the plan or the PR body first.

---

## Landed (2026-08-22)

| Plan item | Landed as |
|-----------|-----------|
| plan | #270 |
| A — #261 (D81) | #277 (plus one review-found fix: the oracle maps column renames on a table renamed in the same run; same-type mid-insert regression test; fresh-build test) |
| B — #269 | #273 (string form kept as deprecated on 0.1.x, `patch` — owner decision) |
| C — #262, #263 | #276 (also fixed stale "four checks" wording in `docs/guide/ci.md` and the skills reference) |
| D — #264, #265 | #275 (Task 13: citty renders a `required: false` positional as `[OPTIONS] [N]`; Task 14: root detection via `parent === undefined`) |
| E — #266 | `hejbro-dogfood` PRs #1 (scenario set v1 + first pass on 0.1.0: 02/03 FAIL = #261), #2 (#220 same-second note), #3 (second pass on 0.1.1: 8/8 PASS, 0 warnings) |
| F — #267 | not landable (TS 7.0 has no Compiler API yet → `check:crap` crashes); #258 closed, #271/#272 dependabot ignore until 7.1 |
| G — #278 (added during the phase) | #280 |
| release — #268 | 0.1.1 via #274 + #279, OIDC publish verified, `NPM_TOKEN` deleted |

Plan deviations, all recorded in the PR bodies: Task 4 `KindChange.operation`, Task 8 CLI tests drive the built CLI (`runCli`), Task 7 golden filenames are 0-based (`from-empty`/`step-1`/`step-2`; the "fresh build keeps declaration order" point moved to a unit test), Task 13 `[N]`. #260 stays open by the owner's decision.

