# Phase 1 Implementation Plan — Core Object Model + Snapshot + Diff

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@hejbro/core`'s object-kind plugin interface and its first
consumers (schemas, enums, tables/columns/indexes/FKs), producing
deterministic snapshot JSON and migration SQL, proven by a golden-file test
harness.

**Architecture:** Every database object kind implements one explicit
contract — `serialize → identify → diff → emit` — registered in a kind
registry. A pure pipeline turns declarations into a normalized snapshot,
diffs it against the previous snapshot per kind, and emits ordered SQL with
a banner summary. Core never touches fs or DB; the test harness owns all
I/O.

**Tech Stack:** TypeScript (strict, ESM-only), tsdown (build), vitest
(tests), pnpm + turbo, Biome, GitHub Actions.

**Spec:** `docs/specs/2026-08-19-hejbro-design.md` (esp. §4.1, §6, D13,
D14). Roadmap: `docs/plans/2026-08-19-roadmap.md` Phase 1.

## Global Constraints

- `@hejbro/core` is PURE: no fs, no DB, no `Date.now()`; zero runtime deps.
- TypeScript style (owner's global rules): no `any`, no `let`/`var`, no
  `for`/`while` (use `map`/`filter`/`reduce`/`flatMap`), no ternary, no
  `enum` (use `as const` + union), no magic values, JSDoc on every public
  export, files ≤ 300 lines, no `.js` import specifiers.
- Formatting: Biome, tabs, double quotes (`pnpm check` must pass).
- Conventional commits, lower-case subject, ≤ 72 chars.
- All GitHub-facing text in English.
- Determinism: identical declarations must produce byte-identical snapshot
  JSON and SQL, every time.
- ESM only: `"type": "module"`, exports map with `types` + `import` only.

## File Structure (target)

```
packages/core/
├── package.json            # @hejbro/core: tsdown build, vitest, ESM exports
├── tsconfig.json           # extends ../../tsconfig.base.json
├── vitest.config.ts
├── src/
│   ├── index.ts            # public API (user DSL + extension interface)
│   ├── sql/
│   │   ├── statement.ts    # SqlStatement type + stages
│   │   ├── identifier.ts   # quoteIdentifier, qualifyName
│   │   └── migration-file.ts # banner rendering + file naming (D14)
│   ├── snapshot/
│   │   ├── stable-json.ts  # deterministic stringify (sorted keys)
│   │   └── snapshot.ts     # Snapshot type, buildSnapshot, parseSnapshot
│   ├── kind/
│   │   ├── object-kind.ts  # ObjectKind + KindChange contracts
│   │   ├── registry.ts     # createKindRegistry
│   │   └── diff-helpers.ts # diffByKey (A+C shared helpers)
│   ├── engine/
│   │   ├── diff-engine.ts  # diffSnapshots (per-kind matching + ordering)
│   │   └── generate.ts     # generateMigration orchestration
│   ├── types/
│   │   ├── type-node.ts    # structured column type nodes (~25 pg types)
│   │   └── column-builder.ts # uuid(), text(), varchar()… + modifiers
│   ├── dsl/
│   │   ├── schema.ts       # schema()
│   │   ├── pg-enum.ts      # pgEnum()
│   │   └── table.ts        # table() + index()/foreignKey() extras
│   └── kinds/
│       ├── schema-kind.ts
│       ├── enum-kind.ts
│       ├── table-kind.ts        # serialize/identify/diff
│       └── table-kind-emit.ts   # create/alter/drop emission (kept separate for the 300-line rule)
└── test/
    ├── golden/
    │   ├── golden.test.ts  # harness runner (fs lives HERE, not in core)
    │   └── cases/…         # per-case declarations + expected outputs
    └── *.test.ts           # unit tests colocated per module below
.github/workflows/ci.yml
```

Executors create `test/<name>.test.ts` files as named in each task.

---

### Task 1: Package tooling — tsdown, vitest, ESM wiring, CI

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts` (placeholder export)
- Create: `packages/core/test/smoke.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: root `package.json` (devDeps), `turbo.json` (test outputs none)

**Interfaces:**
- Produces: a building, testing `@hejbro/core` package every later task
  extends. `pnpm --filter @hejbro/core test|build|check-types` all green.

- [ ] **Step 1: Write the failing smoke test**

```ts
// packages/core/test/smoke.test.ts
import { describe, expect, it } from "vitest";
import { HEJBRO_SNAPSHOT_VERSION } from "../src/index";

describe("package wiring", () => {
	it("exposes the snapshot version constant", () => {
		expect(HEJBRO_SNAPSHOT_VERSION).toBe(1);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @hejbro/core test`
Expected: FAIL (vitest missing / export missing).

- [ ] **Step 3: Wire the package**

`packages/core/package.json`:

```json
{
	"name": "@hejbro/core",
	"version": "0.0.0",
	"type": "module",
	"license": "MIT",
	"repository": { "type": "git", "url": "https://github.com/quickstart-now/hejbro", "directory": "packages/core" },
	"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
	"files": ["dist"],
	"scripts": {
		"build": "tsdown src/index.ts --dts",
		"check-types": "tsc --noEmit",
		"test": "vitest run"
	},
	"devDependencies": { "tsdown": "catalog:", "typescript": "catalog:", "vitest": "catalog:" }
}
```

Add a pnpm catalog to `pnpm-workspace.yaml` (single place for versions):

```yaml
catalog:
	tsdown: ^0.22.14
	typescript: ^5.9.3
	vitest: ^4.1.11
```

(Confirmed values as of 2026-08-19, following the Node ≥ 22 floor raise —
D13 amended. tsdown requires Node ≥ 22.18.0; the catalog entry is the
single source.)

`packages/core/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": { "moduleResolution": "bundler", "module": "esnext", "rootDir": "src", "noEmit": true },
	"include": ["src", "test", "vitest.config.ts"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`packages/core/src/index.ts`:

```ts
/** Snapshot format version emitted by this build of hejbro core. */
export const HEJBRO_SNAPSHOT_VERSION = 1;
```

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [dev, main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm check-types
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 4: Run test + build to verify pass**

Run: `pnpm install && pnpm --filter @hejbro/core test && pnpm --filter @hejbro/core build && pnpm check-types`
Expected: PASS; `dist/index.js` + `dist/index.d.ts` exist.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "build(core): wire tsdown, vitest, esm exports and ci"
```

---

### Task 2: SQL primitives — statements and identifier quoting

**Files:**
- Create: `packages/core/src/sql/statement.ts`, `packages/core/src/sql/identifier.ts`
- Test: `packages/core/test/sql-identifier.test.ts`

**Interfaces:**
- Produces:
  - `type SqlStage = "main" | "deferred"` and
    `type SqlStatement = { readonly sql: string; readonly stage: SqlStage }`
  - `statement(sql: string): SqlStatement` (stage "main"),
    `deferredStatement(sql: string): SqlStatement`
  - `quoteIdentifier(name: string): string` — always double-quotes,
    doubles embedded quotes (`a"b` → `"a""b"`), rejects empty/`\0` names
    with a `HejbroError`
  - `qualifyName(schema: string, name: string): string` →
    `"schema"."name"`
  - `type HejbroError = { readonly code: string; readonly message: string; readonly declaredAt: string | null }`
    via `hejbroError(code, message)` factory + `throwHejbroError` helper
    (spec §7: every message states why AND what to do)

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/test/sql-identifier.test.ts
import { describe, expect, it } from "vitest";
import { quoteIdentifier, qualifyName } from "../src/sql/identifier";

describe("quoteIdentifier", () => {
	it("always double-quotes", () => {
		expect(quoteIdentifier("posts")).toBe('"posts"');
	});
	it("escapes embedded double quotes", () => {
		expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
	});
	it("rejects empty names with actionable message", () => {
		expect(() => quoteIdentifier("")).toThrowError(/empty.*give the object a name/i);
	});
});

describe("qualifyName", () => {
	it("joins quoted parts", () => {
		expect(qualifyName("app", "posts")).toBe('"app"."posts"');
	});
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @hejbro/core test` → FAIL.

- [ ] **Step 3: Implement** (`statement.ts` and `identifier.ts` per the
  Produces block; quoting via `name.replaceAll('"', '""')`; validation
  throws `hejbroError("invalid-identifier", …)`).

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** — `feat(core): add sql statement and identifier primitives`

---

### Task 3: Deterministic JSON — stable stringify

**Files:**
- Create: `packages/core/src/snapshot/stable-json.ts`
- Test: `packages/core/test/stable-json.test.ts`

**Interfaces:**
- Produces: `stableJson(value: JsonValue): string` — recursively sorts
  object keys, 2-space (tab) indent, trailing newline; and
  `type JsonValue = string | number | boolean | null | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue }`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { stableJson } from "../src/snapshot/stable-json";

describe("stableJson", () => {
	it("sorts keys recursively", () => {
		expect(stableJson({ b: 1, a: { d: 2, c: 3 } }))
			.toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
	});
	it("preserves array order", () => {
		const rendered = stableJson({ values: ["b", "a"] });
		expect(rendered.indexOf('"b"')).toBeLessThan(rendered.indexOf('"a"'));
	});
	it("ends with a newline", () => {
		expect(stableJson({})).toMatch(/\n$/);
	});
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — recursive sort via
  `Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))`
  … wait: use plain `<`/`>` byte comparison, NOT `localeCompare`
  (locale-dependent = nondeterministic across machines). Then
  `JSON.stringify(sorted, null, "\t") + "\n"`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add deterministic json serialization`

---

### Task 4: Object kind contract + registry

**Files:**
- Create: `packages/core/src/kind/object-kind.ts`, `packages/core/src/kind/registry.ts`
- Test: `packages/core/test/kind-registry.test.ts`

**Interfaces:**
- Produces (the extension interface — spec §4.1; exact shapes):

```ts
export const changeOperations = ["create", "drop", "alter"] as const;
export type ChangeOperation = (typeof changeOperations)[number];

export type KindChange = {
	readonly kind: string;
	readonly operation: ChangeOperation;
	readonly identity: string;
	readonly previous: JsonValue | null;
	readonly next: JsonValue | null;
	/** extra banner notes, e.g. ["column slug added"] */
	readonly notes: ReadonlyArray<string>;
};

export interface ObjectKind<TDeclaration> {
	readonly kind: string;
	/** kinds whose creates must precede this kind's creates (drops reverse) */
	readonly dependsOn: ReadonlyArray<string>;
	/** narrow an unknown declaration to this kind (used by buildSnapshot) */
	owns(declaration: HejbroDeclaration): declaration is TDeclaration;
	serialize(declaration: TDeclaration): JsonValue;
	identify(snapshot: JsonValue): string;
	diff(previous: JsonValue | null, next: JsonValue | null, identity: string): ReadonlyArray<KindChange>;
	emit(change: KindChange): ReadonlyArray<SqlStatement>;
}

export type HejbroDeclaration = { readonly declarationKind: string };

export type KindRegistry = {
	readonly register: (kind: ObjectKind<never>) => void;
	readonly get: (kindName: string) => ObjectKind<never>;
	readonly list: () => ReadonlyArray<ObjectKind<never>>;
};
export const createKindRegistry: () => KindRegistry;
export const createDefaultRegistry: () => KindRegistry; // built-ins pre-registered (grows in later tasks)
```

- [ ] **Step 1: Write failing tests** — register a toy kind, `get` returns
  it, duplicate registration throws (`duplicate-kind`, message names the
  kind and says presets must use unique prefixed names), `get` of unknown
  kind throws (`unknown-kind`).

```ts
import { describe, expect, it } from "vitest";
import { createKindRegistry } from "../src/kind/registry";

const toyKind = {
	kind: "toy",
	dependsOn: [],
	owns: (d: { declarationKind: string }): d is { declarationKind: string } => d.declarationKind === "toy",
	serialize: () => ({ name: "toy" }),
	identify: () => "toy",
	diff: () => [],
	emit: () => [],
};

describe("kind registry", () => {
	it("registers and retrieves kinds", () => {
		const registry = createKindRegistry();
		registry.register(toyKind);
		expect(registry.get("toy").kind).toBe("toy");
	});
	it("rejects duplicate kind names", () => {
		const registry = createKindRegistry();
		registry.register(toyKind);
		expect(() => registry.register(toyKind)).toThrowError(/already registered/i);
	});
	it("throws an actionable error for unknown kinds", () => {
		expect(() => createKindRegistry().get("nope")).toThrowError(/no kind named "nope"/i);
	});
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — registry over a `Map` captured in closure
  (mutation is internal; no `let`).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add object kind contract and registry`

---

### Task 5: Shared diff helpers (the "+C")

**Files:**
- Create: `packages/core/src/kind/diff-helpers.ts`
- Test: `packages/core/test/diff-helpers.test.ts`

**Interfaces:**
- Produces:

```ts
export type KeyedDiff<TValue> = {
	readonly added: ReadonlyArray<{ readonly key: string; readonly value: TValue }>;
	readonly removed: ReadonlyArray<{ readonly key: string; readonly value: TValue }>;
	readonly changed: ReadonlyArray<{ readonly key: string; readonly previous: TValue; readonly next: TValue }>;
};
/** Diff two keyed collections; equality = stableJson byte equality. */
export const diffByKey: <TValue extends JsonValue>(
	previous: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
	next: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
) => KeyedDiff<TValue>;
export const sameJson: (a: JsonValue, b: JsonValue) => boolean;
```

- [ ] **Step 1: Write failing tests** — added/removed/changed detection;
  unchanged entries appear nowhere; key order of inputs does not affect
  results (outputs sorted by key).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with `Map` lookups + `filter`/`flatMap`;
  `sameJson = (a, b) => stableJson(a) === stableJson(b)`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add shared keyed diff helpers`

---

### Task 6: Column type nodes (~25 Postgres types)

**Files:**
- Create: `packages/core/src/types/type-node.ts`
- Test: `packages/core/test/type-node.test.ts`

**Interfaces:**
- Produces: a discriminated union `TypeNode` + `renderTypeNode(node): string`.
  Parameterless types via one list; parameterized types explicit:

```ts
export const simpleTypeNames = [
	"uuid", "text", "boolean", "smallint", "integer", "bigint", "real",
	"double precision", "date", "time", "timetz", "timestamp", "timestamptz",
	"interval", "json", "jsonb", "bytea", "inet", "cidr", "macaddr", "serial",
	"bigserial",
] as const;
export type SimpleTypeName = (typeof simpleTypeNames)[number];

export type TypeNode =
	| { readonly typeName: SimpleTypeName }
	| { readonly typeName: "varchar"; readonly length: number | null }
	| { readonly typeName: "char"; readonly length: number }
	| { readonly typeName: "numeric"; readonly precision: number | null; readonly scale: number | null }
	| { readonly typeName: "enum"; readonly enumSchema: string; readonly enumName: string }
	| { readonly typeName: "array"; readonly element: TypeNode };
```

  `renderTypeNode` renders SQL: `varchar(255)`, `numeric(10,2)`,
  `"app"."status"` for enums, `text[]` for arrays.

- [ ] **Step 1: Write failing tests** — render one of each shape incl.
  `numeric` with/without precision, enum qualification, nested array.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — exhaustive rendering via a `switch` on
  `typeName` with a `never` default guard (no ternary).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add structured column type nodes`

---

### Task 7: Column builders (user DSL for columns)

**Files:**
- Create: `packages/core/src/types/column-builder.ts` (+
  `column-builder-factories.ts` if the file nears 300 lines)
- Test: `packages/core/test/column-builder.test.ts`

**Interfaces:**
- Produces: factories `uuid()`, `text()`, `varchar(config?)`,
  `boolean()`, `integer()`, `bigint()`, `numeric(config?)`, `timestamptz()`,
  … (one per TypeNode shape; enum columns come from `pgEnum` in Task 8;
  `.array()` modifier wraps any builder). Each returns an immutable
  `ColumnBuilder`:

```ts
export type ColumnDefault =
	| { readonly defaultKind: "literal"; readonly value: string | number | boolean }
	| { readonly defaultKind: "raw"; readonly sql: string }        // escape hatch until Phase 2 expressions
	| { readonly defaultKind: "random-uuid" }                       // gen_random_uuid()
	| { readonly defaultKind: "now" };                              // now()

export type ColumnState = {
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly defaultValue: ColumnDefault | null;
};

export type ColumnBuilder = {
	readonly columnState: ColumnState;
	notNull(): ColumnBuilder;
	primaryKey(): ColumnBuilder;      // implies notNull in serialization
	unique(): ColumnBuilder;
	default(value: string | number | boolean): ColumnBuilder;
	defaultRandom(): ColumnBuilder;   // uuid only (throws otherwise, actionable)
	defaultNow(): ColumnBuilder;      // timestamp/date kinds only
	array(): ColumnBuilder;
};
```

- [ ] **Step 1: Write failing tests** — chaining is immutable (calling
  `.notNull()` does not mutate the original), `uuid().primaryKey()`
  state, `defaultRandom()` on `text()` throws with guidance, `.array()`
  wraps the type node.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — a `createColumnBuilder(state)` factory
  returning methods that call itself with `{ ...state, … }`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add immutable column builders`

---

### Task 8: Declaration DSL — schema(), pgEnum(), table()

**Files:**
- Create: `packages/core/src/dsl/schema.ts`, `packages/core/src/dsl/pg-enum.ts`, `packages/core/src/dsl/table.ts`
- Test: `packages/core/test/dsl.test.ts`

**Interfaces:**
- Produces (all satisfy `HejbroDeclaration`):

```ts
export type SchemaDeclaration = { readonly declarationKind: "schema"; readonly schemaName: string };
export const schema: (schemaName: string) => SchemaDeclaration;

export type EnumDeclaration = {
	readonly declarationKind: "enum";
	readonly schema: SchemaDeclaration;
	readonly enumName: string;
	readonly values: ReadonlyArray<string>;
	/** use as a column type: status: appStatus.column().notNull() */
	column(): ColumnBuilder;
};
export const pgEnum: (owner: SchemaDeclaration, enumName: string, values: ReadonlyArray<string>) => EnumDeclaration;

export type IndexDeclaration = { readonly columns: ReadonlyArray<string>; readonly unique: boolean; readonly indexName: string | null };
export type ForeignKeyDeclaration = {
	readonly columns: ReadonlyArray<string>;
	readonly references: { readonly table: TableDeclaration; readonly columns: ReadonlyArray<string> };
	readonly onDelete: ForeignKeyAction | null;   // "cascade" | "restrict" | "set null" | "no action" (as const union)
};
export type TableDeclaration = {
	readonly declarationKind: "table";
	readonly schema: SchemaDeclaration;
	readonly tableName: string;
	readonly columns: ReadonlyArray<{ readonly columnName: string; readonly columnState: ColumnState }>; // declaration order preserved
	readonly indexes: ReadonlyArray<IndexDeclaration>;
	readonly foreignKeys: ReadonlyArray<ForeignKeyDeclaration>;
};
export const table: (
	owner: SchemaDeclaration,
	tableName: string,
	columns: Record<string, ColumnBuilder>,
	extras?: (helpers: TableExtrasHelpers) => TableExtras,
) => TableDeclaration;
// TableExtrasHelpers gives typed column name refs; TableExtras = { indexes?, foreignKeys? }
```

  Column property names are camelCase in TS and snake_cased in SQL
  (`publishedAt` → `published_at`) via exported `toSnakeCase(name)` —
  matching the drizzle convention users know. Validation at declaration
  time: duplicate column names after snake_casing, FK column refs that
  don't exist, index refs that don't exist → `HejbroError` naming the
  table and the fix.

- [ ] **Step 1: Write failing tests** — the dd.land-style `posts` table
  declares; column order preserved; snake_casing applied; FK to another
  table records target identity; bad index column ref throws with table
  name in message.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add schema, enum and table declaration dsl`

---

### Task 9: Schema + enum kinds

**Files:**
- Create: `packages/core/src/kinds/schema-kind.ts`, `packages/core/src/kinds/enum-kind.ts`
- Modify: `packages/core/src/kind/registry.ts` (createDefaultRegistry registers them)
- Test: `packages/core/test/schema-kind.test.ts`, `packages/core/test/enum-kind.test.ts`

**Interfaces:**
- Consumes: ObjectKind contract (Task 4), diff helpers (Task 5), DSL (Task 8).
- Produces: `schemaKind` (identity `schemaName`; create → `create schema
  "app";`, drop → `drop schema "app";`, never alters),
  `enumKind` (identity `"app.status"`; value list append-only: added
  values → `alter type … add value …` (each as its own statement, in
  order); removed/reordered values → drop+create with a note, since
  Postgres cannot remove enum values).

- [ ] **Step 1: Write failing tests** (schema kind: serialize/identify;
  diff none→some = create; emit SQL exact strings. enum kind: value
  append emits `add value`; value removal emits drop+create with note
  "enum values removed; recreating type").
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** `diff` composes `sameJson`; keep each kind
  self-contained and readable.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add schema and enum object kinds`

---

### Task 10: Table kind — serialize + diff

**Files:**
- Create: `packages/core/src/kinds/table-kind.ts`
- Test: `packages/core/test/table-kind-diff.test.ts`

**Interfaces:**
- Consumes: `diffByKey` (Task 5), `TableDeclaration` (Task 8).
- Produces: `tableKind` with `dependsOn: ["schema", "enum"]`.
  Snapshot node (all defaults materialized — spec brainstorm decision):

```jsonc
{
	"schema": "app",
	"name": "posts",
	"columns": [
		{ "name": "id", "typeNode": { "typeName": "uuid" }, "notNull": true,
		  "primaryKey": true, "unique": false, "default": { "defaultKind": "random-uuid" } }
	],
	"indexes": [ { "name": "posts_published_at_idx", "columns": ["published_at"], "unique": false } ],
	"foreignKeys": [ { "name": "comments_post_id_fk", "columns": ["post_id"],
	  "referencesTable": "app.posts", "referencesColumns": ["id"], "onDelete": "cascade" } ]
}
```

  Index/FK names auto-derived deterministically
  (`<table>_<cols>_idx` / `<table>_<cols>_fk`) unless user-provided.
  `diff` produces: one `create`/`drop` change for whole tables, and for
  survivors a single `alter` change whose `notes` list every column/
  index/FK delta (via `diffByKey` on name-keyed entries — **column order
  changes alone produce no diff**).

- [ ] **Step 1: Write failing tests** — add column → alter change with
  note `column "slug" added`; drop column; column type change; index
  added; FK added; reorder-only → zero changes; unchanged → zero changes.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement serialize/identify/diff** (emit throws
  `not-implemented` until Task 11 — keeps this task reviewable alone).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add table kind serialization and diff`

---

### Task 11: Table kind — SQL emission

**Files:**
- Create: `packages/core/src/kinds/table-kind-emit.ts`
- Modify: `packages/core/src/kinds/table-kind.ts` (delegate emit)
- Test: `packages/core/test/table-kind-emit.test.ts`

**Interfaces:**
- Consumes: `KindChange` from Task 10's diff, sql primitives (Task 2).
- Produces exact SQL shapes (golden-tested again in Task 14):
  - create: `create table "app"."posts" (…);` — columns in declaration
    order, then table-level constraints; **FK constraints emitted as
    `deferred` statements**: `alter table … add constraint … foreign key …`
    so cross-table creates never race; indexes as separate
    `create [unique] index "name" on …;` statements.
  - alter (from notes): `alter table … add column …`, `drop column`,
    `alter column … type …` / `set not null` / `drop not null` /
    `set default …` / `drop default`; index add/drop; FK add/drop
    (constraint drops before adds).
  - drop: `drop table "app"."posts";`

- [ ] **Step 1: Write failing tests** — exact-string assertions for each
  shape above, incl. FK statements carrying `stage: "deferred"`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): emit table create, alter and drop sql`

---

### Task 12: Snapshot build/parse + diff engine

**Files:**
- Create: `packages/core/src/snapshot/snapshot.ts`, `packages/core/src/engine/diff-engine.ts`
- Test: `packages/core/test/snapshot.test.ts`, `packages/core/test/diff-engine.test.ts`

**Interfaces:**
- Consumes: registry (Task 4), all kinds (Tasks 9–11), stableJson (Task 3).
- Produces:

```ts
export type Snapshot = {
	readonly hejbroSnapshot: 1;
	readonly dialect: "postgres";
	readonly objects: { readonly [kindAndIdentity: string]: JsonValue }; // key `${kind}:${identity}`
};
export const emptySnapshot: Snapshot;
export const buildSnapshot: (declarations: ReadonlyArray<HejbroDeclaration>, registry: KindRegistry) => Snapshot;
export const renderSnapshot: (snapshot: Snapshot) => string;            // stableJson
export const parseSnapshot: (raw: string) => Snapshot;                  // validates version: unknown → actionable error ("generated by a newer hejbro; upgrade")
export const diffSnapshots: (previous: Snapshot, next: Snapshot, registry: KindRegistry) => ReadonlyArray<KindChange>;
```

  `buildSnapshot` routes each declaration to the kind whose `owns()`
  matches (none/multiple → error); duplicate identities → error naming
  both declarations. `diffSnapshots` orders changes: creates/alters in
  kind dependency order (topological over `dependsOn`, name-sorted within
  a kind), drops in reverse kind order.

- [ ] **Step 1: Write failing tests** — build produces flat sorted keys;
  duplicate table identity throws; render→parse round-trips; unknown
  version rejected; ordering test: enum table's create precedes table
  create, drops reversed.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (topo sort via reduce over resolved deps —
  kinds are few; cycle → `HejbroError`).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `feat(core): add snapshot pipeline and diff engine`

---

### Task 13: Migration rendering — banner + file name (D14)

**Files:**
- Create: `packages/core/src/sql/migration-file.ts`, `packages/core/src/engine/generate.ts`
- Modify: `packages/core/src/index.ts` (export the full public API surface)
- Test: `packages/core/test/migration-file.test.ts`, `packages/core/test/generate.test.ts`

**Interfaces:**
- Produces:

```ts
export const migrationPrefixStrategies = ["timestamp", "index", "unix"] as const;
export type MigrationPrefixStrategy = (typeof migrationPrefixStrategies)[number];
/** clock and previous index injected — core stays pure (no Date.now). */
export const migrationFileName: (options: {
	readonly strategy: MigrationPrefixStrategy;
	readonly generatedAt: Date;
	readonly previousCount: number;
	readonly slug: string;
}) => string;   // timestamp → "20260819143052_add_profiles.sql" (UTC)
export const renderBanner: (changes: ReadonlyArray<KindChange>) => string;
// "-- hejbro migration\n-- + table app.posts [new]\n-- ~ table app.posts [column \"slug\" added]\n-- - view app.old [dropped]"
export const generateMigration: (options: {
	readonly declarations: ReadonlyArray<HejbroDeclaration>;
	readonly previousSnapshot: Snapshot;
	readonly registry?: KindRegistry; // default: createDefaultRegistry()
}) => {
	readonly snapshot: Snapshot;
	readonly changes: ReadonlyArray<KindChange>;
	readonly sql: string;      // banner + main statements + deferred statements, "\n\n"-joined, or "" when no changes
	readonly hasChanges: boolean;
};
```

  Banner markers: `+` create, `~` alter (notes joined in brackets), `-`
  drop. Slug auto-derivation (`deriveSlug(changes)`: first change →
  `add_posts` / `alter_posts` / `drop_posts`, fallback `migration`) also
  lives here for Phase 5 reuse.

- [ ] **Step 1: Write failing tests** — file name for each strategy with a
  fixed `new Date(Date.UTC(2026, 7, 19, 14, 30, 52))`; index strategy pads
  (`0007_`); banner exact string for a create+alter+drop mix; end-to-end
  `generateMigration` from empty snapshot over a two-table + enum
  declaration set asserts full SQL text; `hasChanges === false` yields
  empty sql.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement; wire every public symbol through `src/index.ts` with JSDoc.**
- [ ] **Step 4: Run to verify pass (`pnpm --filter @hejbro/core test`, `pnpm check-types`, `pnpm build`).**
- [ ] **Step 5: Commit** — `feat(core): add migration banner, file naming and generate pipeline`

---

### Task 14: Golden-file harness + dd.land acceptance + determinism

**Files:**
- Create: `packages/core/test/golden/golden.test.ts`
- Create: `packages/core/test/golden/cases/ddland-posts/declarations.ts`
- Create: `packages/core/test/golden/cases/ddland-posts/steps.ts`
- Expected outputs (generated then reviewed by hand):
  `cases/ddland-posts/expected/{snapshot.json,from-empty.sql,step-1.sql,…}`

**Interfaces:**
- Consumes: the full public API via `../src/index` only (dogfoods the
  export surface).
- Produces: the repo's testing pattern for every later phase.

- [ ] **Step 1: Write the harness + case (failing: no expected files yet)**

```ts
// test/golden/golden.test.ts  (fs allowed HERE — this is the test layer)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptySnapshot, generateMigration, renderSnapshot } from "../../src/index";

const casesDirectory = join(import.meta.dirname, "cases");
const shouldUpdate = process.env.UPDATE_GOLDEN === "1";

const readOrRecord = (filePath: string, actual: string) => {
	if (shouldUpdate) {
		mkdirSync(join(filePath, ".."), { recursive: true });
		writeFileSync(filePath, actual);
	}
	if (!existsSync(filePath)) {
		throw new Error(`missing golden file ${filePath} — run UPDATE_GOLDEN=1 pnpm test, then review the diff`);
	}
	return readFileSync(filePath, "utf8");
};

describe("golden cases", () => {
	const caseNames = readdirSync(casesDirectory);
	caseNames.map((caseName) =>
		it(`${caseName}: from empty and per step`, async () => {
			const caseDirectory = join(casesDirectory, caseName);
			const { steps } = await import(join(caseDirectory, "steps.ts"));
			const outcome = steps.reduce(
				(state, declarations, stepIndex) => {
					const generated = generateMigration({ declarations, previousSnapshot: state.snapshot });
					const label = stepIndex === 0 ? "from-empty" : `step-${stepIndex}`;
					expect(generated.sql).toBe(readOrRecord(join(caseDirectory, "expected", `${label}.sql`), generated.sql));
					return { snapshot: generated.snapshot };
				},
				{ snapshot: emptySnapshot },
			);
			const rendered = renderSnapshot(outcome.snapshot);
			expect(rendered).toBe(readOrRecord(join(caseDirectory, "expected", "snapshot.json"), rendered));
		}),
	);
});

describe("determinism", () => {
	it("two runs produce byte-identical snapshot and sql", async () => {
		const { steps } = await import(join(casesDirectory, "ddland-posts", "steps.ts"));
		const runOnce = () => generateMigration({ declarations: steps[0], previousSnapshot: emptySnapshot });
		expect(renderSnapshot(runOnce().snapshot)).toBe(renderSnapshot(runOnce().snapshot));
		expect(runOnce().sql).toBe(runOnce().sql);
	});
});
```

`declarations.ts` ports the dd.land posts family (posts + comments with a
self-FK for parent, post_status enum, published_at index — mirrors the
spec §5.1 example); `steps.ts` exports `steps: [initial, addSlugColumn,
dropIndexAddFk]` — three evolution stages built from the DSL.

- [ ] **Step 2: Run to verify failure** — missing golden files error with
  the actionable message.
- [ ] **Step 3: Generate goldens** — `UPDATE_GOLDEN=1 pnpm --filter @hejbro/core test`,
  then **manually read every generated .sql/.json and verify it is SQL we
  would ship** (this review is the point of golden files).
- [ ] **Step 4: Run to verify pass** — plain `pnpm --filter @hejbro/core test`.
- [ ] **Step 5: Full gate + commit**

```bash
pnpm check && pnpm check-types && pnpm test && pnpm build
git add -A && git commit -m "test(core): add golden-file harness with ddland acceptance case"
```

---

### Task 15: Roadmap + docs close-out

**Files:**
- Modify: `docs/plans/2026-08-19-roadmap.md` (mark Phase 1 ✅ with PR link)
- Modify: `packages/core/README.md` (create: one-paragraph status + pointer to spec; no API docs yet)

- [ ] **Step 1: Update roadmap Phase 1 heading to ✅ with a one-line summary of what landed.**
- [ ] **Step 2: Run `pnpm check` (docs formatting).**
- [ ] **Step 3: Commit** — `docs: mark roadmap phase 1 complete`

---

## Self-Review Notes

- Spec coverage: §4.1 four-stage kind contract → Tasks 4/9–11; snapshot
  normalization + versioning → Tasks 3/12; diff strategies table (§6.5,
  tables via alter) → Tasks 10/11; banner (§6.6) + D14 naming → Task 13;
  error principles (§7) → HejbroError from Task 2 onward; testing layer 1
  (§8) → Task 14. Rename detection intentionally deferred to Phase 5 per
  roadmap.
- Out of scope here (explicit): RLS/views/grants (Phase 4), expressions
  (`isNotNull` etc. — Phase 2; column defaults limited to
  literal/random-uuid/now/raw until then), functions/triggers (Phase 3),
  CLI/file I/O (Phase 5).
- Type consistency pass done: `ColumnState`/`ColumnBuilder` (7→8→10),
  `KindChange` (4→9–13), `Snapshot` (12→13→14) names match across tasks.
