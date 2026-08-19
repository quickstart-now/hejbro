import { describe, expect, it } from "vitest";
import { schema } from "../src/dsl/schema";
import { createDefaultRegistry } from "../src/kind/registry";
import { schemaKind } from "../src/kinds/schema-kind";

const expectSingleChange = <T>(changes: ReadonlyArray<T>): T => {
	if (changes.length !== 1) {
		throw new Error(`expected exactly one change, got ${changes.length}`);
	}
	const [change] = changes;
	if (change === undefined) {
		throw new Error("expected a change");
	}
	return change;
};

describe("schemaKind", () => {
	it("owns schema declarations only", () => {
		expect(schemaKind.owns(schema("app"))).toBe(true);
		expect(schemaKind.owns({ declarationKind: "table" })).toBe(false);
	});

	it("serializes and identifies by schemaName", () => {
		const snapshot = schemaKind.serialize(schema("app"));
		expect(snapshot).toEqual({ schemaName: "app" });
		expect(schemaKind.identify(snapshot)).toBe("app");
	});

	it("diffs none -> some as a create", () => {
		const next = schemaKind.serialize(schema("app"));
		const changes = schemaKind.diff(null, next, "app");
		expect(changes).toEqual([
			{
				kind: "schema",
				operation: "create",
				identity: "app",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs some -> none as a drop", () => {
		const previous = schemaKind.serialize(schema("app"));
		const changes = schemaKind.diff(previous, null, "app");
		expect(changes).toEqual([
			{
				kind: "schema",
				operation: "drop",
				identity: "app",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("has no changes when unchanged", () => {
		const snapshot = schemaKind.serialize(schema("app"));
		expect(schemaKind.diff(snapshot, snapshot, "app")).toEqual([]);
	});

	it("emits exact create sql", () => {
		const next = schemaKind.serialize(schema("app"));
		const change = expectSingleChange(schemaKind.diff(null, next, "app"));
		expect(schemaKind.emit(change)).toEqual([
			{ sql: 'create schema "app";', stage: "main" },
		]);
	});

	it("emits exact drop sql", () => {
		const previous = schemaKind.serialize(schema("app"));
		const change = expectSingleChange(schemaKind.diff(previous, null, "app"));
		expect(schemaKind.emit(change)).toEqual([
			{ sql: 'drop schema "app";', stage: "main" },
		]);
	});
});

describe("createDefaultRegistry", () => {
	it("registers the schema kind", () => {
		expect(createDefaultRegistry().get("schema").kind).toBe("schema");
	});
});
