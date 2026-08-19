import { describe, expect, it } from "vitest";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { createDefaultRegistry } from "../src/kind/registry";
import { rlsKind } from "../src/kinds/rls-kind";

const ddland = schema("ddland");

const buildPosts = (force: boolean) => {
	const declared = table(ddland, "posts", {}, () => ({
		rls: rls.enabled({}, { force }),
	}));
	const meta = getTableMeta(declared);
	if (meta.rls === null) {
		throw new Error("expected rls declaration");
	}
	return meta.rls;
};

const bareRls = () => buildPosts(false);
const forcedRls = () => buildPosts(true);

describe("rlsKind", () => {
	it("serializes to schema/table, without policies (force omitted at its false default — compact snapshot)", () => {
		const declaration = bareRls();
		expect(rlsKind.serialize(declaration)).toEqual({
			schema: "ddland",
			table: "posts",
		});
	});

	it("identifies as schema.table", () => {
		const snapshot = rlsKind.serialize(bareRls());
		expect(rlsKind.identify(snapshot)).toBe("ddland.posts");
	});

	it("diffs create when there is no previous snapshot", () => {
		const next = rlsKind.serialize(bareRls());
		const identity = "ddland.posts";
		expect(rlsKind.diff(null, next, identity)).toEqual([
			{
				kind: "rls",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = rlsKind.serialize(bareRls());
		const identity = "ddland.posts";
		expect(rlsKind.diff(previous, null, identity)).toEqual([
			{
				kind: "rls",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical force values", () => {
		const previous = rlsKind.serialize(bareRls());
		const next = rlsKind.serialize(bareRls());
		expect(rlsKind.diff(previous, next, "ddland.posts")).toEqual([]);
	});

	it("diffs a force flip as a single alter", () => {
		const previous = rlsKind.serialize(bareRls());
		const next = rlsKind.serialize(forcedRls());
		const identity = "ddland.posts";
		expect(rlsKind.diff(previous, next, identity)).toEqual([
			{
				kind: "rls",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["force row level security"],
			},
		]);
	});

	it("diffs an unforce flip as a single alter", () => {
		const previous = rlsKind.serialize(forcedRls());
		const next = rlsKind.serialize(bareRls());
		const identity = "ddland.posts";
		expect(rlsKind.diff(previous, next, identity)).toEqual([
			{
				kind: "rls",
				operation: "alter",
				identity,
				previous,
				next,
				notes: ["no force row level security"],
			},
		]);
	});

	it("emits enable (and force) for a bare create", () => {
		const next = rlsKind.serialize(bareRls());
		const statements = rlsKind.emit({
			kind: "rls",
			operation: "create",
			identity: "ddland.posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter table "ddland"."posts" enable row level security;',
		]);
	});

	it("emits enable and force for a forced create", () => {
		const next = rlsKind.serialize(forcedRls());
		const statements = rlsKind.emit({
			kind: "rls",
			operation: "create",
			identity: "ddland.posts",
			previous: null,
			next,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter table "ddland"."posts" enable row level security;',
			'alter table "ddland"."posts" force row level security;',
		]);
	});

	it("emits only the force statement for a force-flip alter", () => {
		const previous = rlsKind.serialize(bareRls());
		const next = rlsKind.serialize(forcedRls());
		const statements = rlsKind.emit({
			kind: "rls",
			operation: "alter",
			identity: "ddland.posts",
			previous,
			next,
			notes: ["force row level security"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter table "ddland"."posts" force row level security;',
		]);
	});

	it("emits only the no-force statement for an unforce alter", () => {
		const previous = rlsKind.serialize(forcedRls());
		const next = rlsKind.serialize(bareRls());
		const statements = rlsKind.emit({
			kind: "rls",
			operation: "alter",
			identity: "ddland.posts",
			previous,
			next,
			notes: ["no force row level security"],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter table "ddland"."posts" no force row level security;',
		]);
	});

	it("emits disable for a drop", () => {
		const previous = rlsKind.serialize(bareRls());
		const statements = rlsKind.emit({
			kind: "rls",
			operation: "drop",
			identity: "ddland.posts",
			previous,
			next: null,
			notes: [],
		});
		expect(statements.map((s) => s.sql)).toEqual([
			'alter table "ddland"."posts" disable row level security;',
		]);
	});

	it("is registered by createDefaultRegistry, depending on table", () => {
		const registry = createDefaultRegistry();
		expect(registry.get("rls")).toBe(rlsKind);
		expect(rlsKind.dependsOn).toEqual(["table"]);
	});
});
