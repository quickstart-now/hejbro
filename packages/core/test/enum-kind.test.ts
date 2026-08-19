import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { createDefaultRegistry } from "../src/kind/registry";
import { enumKind } from "../src/kinds/enum-kind";

const app = schema("app");

const expectChanges = <T>(
	changes: ReadonlyArray<T>,
	count: number,
): ReadonlyArray<T> => {
	if (changes.length !== count) {
		throw new Error(
			`expected exactly ${count} change(s), got ${changes.length}`,
		);
	}
	return changes;
};

describe("enumKind", () => {
	it("owns enum declarations only", () => {
		expect(enumKind.owns(pgEnum(app, "post_status", ["draft"]))).toBe(true);
		expect(enumKind.owns({ declarationKind: "table" })).toBe(false);
	});

	it("serializes and identifies as schema.name", () => {
		const snapshot = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		expect(snapshot).toEqual({
			schema: "app",
			name: "post_status",
			values: ["draft", "published"],
		});
		expect(enumKind.identify(snapshot)).toBe("app.post_status");
	});

	it("diffs none -> some as a create", () => {
		const next = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const changes = enumKind.diff(null, next, "app.post_status");
		expect(changes).toEqual([
			{
				kind: "enum",
				operation: "create",
				identity: "app.post_status",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs some -> none as a drop", () => {
		const previous = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const changes = enumKind.diff(previous, null, "app.post_status");
		expect(changes).toEqual([
			{
				kind: "enum",
				operation: "drop",
				identity: "app.post_status",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("has no changes when unchanged", () => {
		const snapshot = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		expect(enumKind.diff(snapshot, snapshot, "app.post_status")).toEqual([]);
	});

	it("diffs an appended value as a single alter change", () => {
		const previous = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const next = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published", "archived"]),
		);
		const changes = enumKind.diff(previous, next, "app.post_status");
		expect(changes).toEqual([
			{
				kind: "enum",
				operation: "alter",
				identity: "app.post_status",
				previous,
				next,
				notes: ['value "archived" added'],
			},
		]);
	});

	it("diffs a removed value as a drop+create pair with a note", () => {
		const previous = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const next = enumKind.serialize(pgEnum(app, "post_status", ["draft"]));
		const changes = expectChanges(
			enumKind.diff(previous, next, "app.post_status"),
			2,
		);
		expect(changes[0]).toEqual({
			kind: "enum",
			operation: "drop",
			identity: "app.post_status",
			previous,
			next: null,
			notes: ["enum values removed; recreating type"],
		});
		expect(changes[1]).toEqual({
			kind: "enum",
			operation: "create",
			identity: "app.post_status",
			previous: null,
			next,
			notes: ["enum values removed; recreating type"],
		});
	});

	it("diffs a reordered value list as a drop+create pair with a note", () => {
		const previous = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const next = enumKind.serialize(
			pgEnum(app, "post_status", ["published", "draft"]),
		);
		const changes = expectChanges(
			enumKind.diff(previous, next, "app.post_status"),
			2,
		);
		expect(changes[0]?.operation).toBe("drop");
		expect(changes[1]?.operation).toBe("create");
	});

	it("emits exact create sql", () => {
		const next = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const [change] = enumKind.diff(null, next, "app.post_status");
		if (change === undefined) {
			throw new Error("expected a change");
		}
		expect(enumKind.emit(change)).toEqual([
			{
				sql: `create type "app"."post_status" as enum ('draft', 'published');`,
				stage: "main",
			},
		]);
	});

	it("emits exact drop sql", () => {
		const previous = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published"]),
		);
		const [change] = enumKind.diff(previous, null, "app.post_status");
		if (change === undefined) {
			throw new Error("expected a change");
		}
		expect(enumKind.emit(change)).toEqual([
			{ sql: 'drop type "app"."post_status";', stage: "main" },
		]);
	});

	it("emits one add value statement per appended value, in order", () => {
		const previous = enumKind.serialize(pgEnum(app, "post_status", ["draft"]));
		const next = enumKind.serialize(
			pgEnum(app, "post_status", ["draft", "published", "archived"]),
		);
		const [change] = enumKind.diff(previous, next, "app.post_status");
		if (change === undefined) {
			throw new Error("expected a change");
		}
		expect(enumKind.emit(change)).toEqual([
			{
				sql: `alter type "app"."post_status" add value 'published';`,
				stage: "main",
			},
			{
				sql: `alter type "app"."post_status" add value 'archived';`,
				stage: "main",
			},
		]);
	});

	it("escapes embedded single quotes in enum values", () => {
		const next = enumKind.serialize(pgEnum(app, "post_status", ["it's draft"]));
		const [change] = enumKind.diff(null, next, "app.post_status");
		if (change === undefined) {
			throw new Error("expected a change");
		}
		expect(enumKind.emit(change)).toEqual([
			{
				sql: `create type "app"."post_status" as enum ('it''s draft');`,
				stage: "main",
			},
		]);
	});
});

describe("createDefaultRegistry", () => {
	it("registers the enum kind", () => {
		expect(createDefaultRegistry().get("enum").kind).toBe("enum");
	});
});
