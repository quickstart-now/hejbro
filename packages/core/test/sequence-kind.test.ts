import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/kind/registry";
import type { SequenceDeclaration } from "../src/kinds/sequence-kind";
import { sequenceKind } from "../src/kinds/sequence-kind";

const schemaDeclaration = {
	declarationKind: "schema",
	schemaName: "app",
} as const;

const declaration = (
	overrides?: Partial<SequenceDeclaration>,
): SequenceDeclaration => ({
	declarationKind: "sequence",
	schema: schemaDeclaration,
	sequenceName: "posts_id_seq",
	tableName: "posts",
	columnName: "id",
	baseType: "integer",
	...overrides,
});

describe("sequenceKind.owns", () => {
	it("owns sequence declarations only", () => {
		expect(sequenceKind.owns(declaration())).toBe(true);
		expect(sequenceKind.owns({ declarationKind: "table" })).toBe(false);
	});
});

describe("sequenceKind.serialize / identify", () => {
	it("serializes schema/name/table/column/baseType", () => {
		const snapshot = sequenceKind.serialize(declaration());
		expect(snapshot).toEqual({
			schema: "app",
			name: "posts_id_seq",
			table: "posts",
			column: "id",
			baseType: "integer",
		});
	});

	it("identifies as schema.name", () => {
		expect(sequenceKind.identify(sequenceKind.serialize(declaration()))).toBe(
			"app.posts_id_seq",
		);
	});
});

describe("sequenceKind.diff", () => {
	it("diffs create when there is no previous snapshot", () => {
		const next = sequenceKind.serialize(declaration());
		expect(sequenceKind.diff(null, next, "app.posts_id_seq")).toEqual([
			{
				kind: "sequence",
				operation: "create",
				identity: "app.posts_id_seq",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = sequenceKind.serialize(declaration());
		expect(sequenceKind.diff(previous, null, "app.posts_id_seq")).toEqual([
			{
				kind: "sequence",
				operation: "drop",
				identity: "app.posts_id_seq",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change when baseType is identical", () => {
		const previous = sequenceKind.serialize(declaration());
		const next = sequenceKind.serialize(declaration());
		expect(sequenceKind.diff(previous, next, "app.posts_id_seq")).toEqual([]);
	});

	it("diffs alter when baseType changes (serial-family transition)", () => {
		const previous = sequenceKind.serialize(
			declaration({ baseType: "integer" }),
		);
		const next = sequenceKind.serialize(declaration({ baseType: null }));
		expect(sequenceKind.diff(previous, next, "app.posts_id_seq")).toEqual([
			{
				kind: "sequence",
				operation: "alter",
				identity: "app.posts_id_seq",
				previous,
				next,
				notes: ["base type changed"],
			},
		]);
	});
});

describe("sequenceKind.emit", () => {
	it("create: create sequence (main), then owned-by and set-default (both deferred)", () => {
		const next = sequenceKind.serialize(declaration());
		const statements = sequenceKind.emit({
			kind: "sequence",
			operation: "create",
			identity: "app.posts_id_seq",
			previous: null,
			next,
			notes: [],
		});
		expect(statements).toEqual([
			{
				sql: 'create sequence "app"."posts_id_seq" as integer;',
				stage: "main",
			},
			{
				sql: 'alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";',
				stage: "deferred",
			},
			{
				sql: `alter table "app"."posts" alter column "id" set default nextval('app.posts_id_seq');`,
				stage: "deferred",
			},
		]);
	});

	it("create: bigserial-derived sequence (baseType null) has no as clause", () => {
		const next = sequenceKind.serialize(declaration({ baseType: null }));
		const statements = sequenceKind.emit({
			kind: "sequence",
			operation: "create",
			identity: "app.posts_id_seq",
			previous: null,
			next,
			notes: [],
		});
		expect(statements[0]?.sql).toBe('create sequence "app"."posts_id_seq";');
	});

	// D74/#23: a serial column added to an *existing* table inlines its
	// default into the table's own `add column` statement
	// (table-kind-emit.ts), so this kind's own `set default` would either
	// duplicate it or (worse, on a table with rows) be the only place
	// carrying it while `add column` runs bare -- exactly the defect #23
	// closes. Detected via a sibling `table` "alter" change with the
	// matching identity in siblingChanges.
	it("create: suppresses set-default when the owning table's sibling change is alter (column added to an existing table)", () => {
		const next = sequenceKind.serialize(declaration());
		const change = {
			kind: "sequence" as const,
			operation: "create" as const,
			identity: "app.posts_id_seq",
			previous: null,
			next,
			notes: [],
		};
		const siblingChanges = [
			change,
			{
				kind: "table" as const,
				operation: "alter" as const,
				identity: "app.posts",
				previous: {},
				next: {},
				notes: [],
			},
		];
		const statements = sequenceKind.emit(change, siblingChanges);
		expect(statements).toEqual([
			{
				sql: 'create sequence "app"."posts_id_seq" as integer;',
				stage: "main",
			},
			{
				sql: 'alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";',
				stage: "deferred",
			},
		]);
	});

	// Control/contrast: a sibling table "create" change (a brand-new table)
	// keeps all three statements -- table-kind-emit.ts's own createTableSql
	// never inlines a serial column's default (see that file's own doc
	// comment), so this kind must still carry it.
	it("create: keeps set-default when the owning table's sibling change is create (brand-new table)", () => {
		const next = sequenceKind.serialize(declaration());
		const change = {
			kind: "sequence" as const,
			operation: "create" as const,
			identity: "app.posts_id_seq",
			previous: null,
			next,
			notes: [],
		};
		const siblingChanges = [
			change,
			{
				kind: "table" as const,
				operation: "create" as const,
				identity: "app.posts",
				previous: null,
				next: {},
				notes: [],
			},
		];
		const statements = sequenceKind.emit(change, siblingChanges);
		expect(statements).toHaveLength(3);
		expect(statements[2]?.sql).toBe(
			`alter table "app"."posts" alter column "id" set default nextval('app.posts_id_seq');`,
		);
	});

	it("create: keeps set-default when no siblingChanges are given at all (backward-compatible default)", () => {
		const next = sequenceKind.serialize(declaration());
		const statements = sequenceKind.emit({
			kind: "sequence",
			operation: "create",
			identity: "app.posts_id_seq",
			previous: null,
			next,
			notes: [],
		});
		expect(statements).toHaveLength(3);
	});

	// #23/D66. This kind's own emit always produces bare statements — no
	// `if exists` — and a drop's statements go out on `predrop`, not
	// `main` (#193 review): `predrop` runs before every kind's `main`-stage
	// statements (generate.ts), so this always clears before the owning
	// table's own `drop table`/`drop column` could otherwise race it via
	// Postgres's `owned by` cascade -- the same stage `policyKind`/
	// `triggerKind` already use for their own drops, for the identical
	// reason (#122). A drift between that structural guarantee and reality
	// should fail loudly, which is exactly what a bare (non-`if exists`)
	// statement does.
	it("drop: drop default, then drop sequence, both predrop stage, both bare (no if exists)", () => {
		const previous = sequenceKind.serialize(declaration());
		const statements = sequenceKind.emit({
			kind: "sequence",
			operation: "drop",
			identity: "app.posts_id_seq",
			previous,
			next: null,
			notes: [],
		});
		expect(statements).toEqual([
			{
				sql: 'alter table "app"."posts" alter column "id" drop default;',
				stage: "predrop",
			},
			{
				sql: 'drop sequence "app"."posts_id_seq";',
				stage: "predrop",
			},
		]);
	});

	it("alter: alter sequence as <basetype>, defaulting to bigint when baseType is null", () => {
		const previous = sequenceKind.serialize(
			declaration({ baseType: "integer" }),
		);
		const next = sequenceKind.serialize(declaration({ baseType: null }));
		const statements = sequenceKind.emit({
			kind: "sequence",
			operation: "alter",
			identity: "app.posts_id_seq",
			previous,
			next,
			notes: ["base type changed"],
		});
		expect(statements).toEqual([
			{ sql: 'alter sequence "app"."posts_id_seq" as bigint;', stage: "main" },
		]);
	});

	it("is registered by createDefaultRegistry, depending on schema only", () => {
		const registry = createDefaultRegistry();
		expect(registry.get("sequence")).toBe(sequenceKind);
		expect(sequenceKind.dependsOn).toEqual(["schema"]);
	});
});
