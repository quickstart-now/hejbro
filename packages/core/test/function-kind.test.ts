import { describe, expect, it } from "vitest";
import type { ColumnBuilder } from "../src/index";
import {
	createDefaultRegistry,
	defineFunction,
	functionKind,
	schema,
	select,
	table,
	text,
	uuid,
} from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
});

const makeDeclaration = (message: string, argBuilder: () => ColumnBuilder) =>
	defineFunction(
		app,
		"publish_post",
		{ args: { postId: argBuilder() }, returns: posts, security: "definer" },
		(ctx, { postId }) => {
			ctx.raise(message, postId);
			ctx.return(select(posts));
		},
	);

describe("functionKind", () => {
	it("serializes the expected shape", () => {
		const declaration = makeDeclaration("noop=%", uuid);
		const snapshot = functionKind.serialize(declaration) as {
			schema: string;
			name: string;
			args: ReadonlyArray<{ name: string; type: string }>;
			returns: string;
			security: string;
			language: string;
			bodyHash: string;
			bodySql: string;
		};
		expect(snapshot.schema).toBe("app");
		expect(snapshot.name).toBe("publish_post");
		expect(snapshot.args).toEqual([{ name: "post_id", type: "uuid" }]);
		expect(snapshot.returns).toBe('setof "app"."posts"');
		expect(snapshot.security).toBe("definer");
		expect(snapshot.language).toBe("plpgsql");
		expect(snapshot.bodyHash).toMatch(/^[0-9a-f]{8}$/);
		expect(snapshot.bodySql).toContain(
			'create or replace function "app"."publish_post"',
		);
	});

	it("identifies as schema.name", () => {
		const declaration = makeDeclaration("noop=%", uuid);
		const snapshot = functionKind.serialize(declaration);
		expect(functionKind.identify(snapshot)).toBe("app.publish_post");
	});

	it("diffs create when there is no previous snapshot", () => {
		const next = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const changes = functionKind.diff(null, next, "app.publish_post");
		expect(changes).toEqual([
			{
				kind: "function",
				operation: "create",
				identity: "app.publish_post",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const changes = functionKind.diff(previous, null, "app.publish_post");
		expect(changes).toEqual([
			{
				kind: "function",
				operation: "drop",
				identity: "app.publish_post",
				previous,
				next: null,
				notes: [],
			},
		]);
	});

	it("diffs no change for identical declarations", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const next = functionKind.serialize(makeDeclaration("noop=%", uuid));
		expect(functionKind.diff(previous, next, "app.publish_post")).toEqual([]);
	});

	it("diffs a body-only change as a single alter with a body-changed note", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const next = functionKind.serialize(makeDeclaration("changed=%", uuid));
		const changes = functionKind.diff(previous, next, "app.publish_post");
		expect(changes).toEqual([
			{
				kind: "function",
				operation: "alter",
				identity: "app.publish_post",
				previous,
				next,
				notes: ["body changed"],
			},
		]);
	});

	it("diffs an arg-type change as a single alter with a signature-changed note", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const next = functionKind.serialize(makeDeclaration("noop=%", text));
		const changes = functionKind.diff(previous, next, "app.publish_post");
		expect(changes).toEqual([
			{
				kind: "function",
				operation: "alter",
				identity: "app.publish_post",
				previous,
				next,
				notes: ["signature changed; recreating"],
			},
		]);
	});

	it("emits the stored bodySql for create and alter", () => {
		const next = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const createSql = functionKind.emit({
			kind: "function",
			operation: "create",
			identity: "app.publish_post",
			previous: null,
			next,
			notes: [],
		});
		expect(createSql).toHaveLength(1);
		expect(createSql[0]?.sql).toBe((next as { bodySql: string }).bodySql);

		const alterSql = functionKind.emit({
			kind: "function",
			operation: "alter",
			identity: "app.publish_post",
			previous: next,
			next,
			notes: ["body changed"],
		});
		expect(alterSql[0]?.sql).toBe((next as { bodySql: string }).bodySql);
	});

	it("emits drop-then-create for a signature-changed alter, in that order", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const next = functionKind.serialize(makeDeclaration("noop=%", text));
		const statements = functionKind.emit({
			kind: "function",
			operation: "alter",
			identity: "app.publish_post",
			previous,
			next,
			notes: ["signature changed; recreating"],
		});
		expect(statements).toEqual([
			{ sql: 'drop function "app"."publish_post"(uuid);', stage: "main" },
			{ sql: (next as { bodySql: string }).bodySql, stage: "main" },
		]);
	});

	it("emits a drop function statement with the argument type list", () => {
		const previous = functionKind.serialize(makeDeclaration("noop=%", uuid));
		const dropSql = functionKind.emit({
			kind: "function",
			operation: "drop",
			identity: "app.publish_post",
			previous,
			next: null,
			notes: [],
		});
		expect(dropSql).toEqual([
			{ sql: 'drop function "app"."publish_post"(uuid);', stage: "main" },
		]);
	});

	it("is registered by createDefaultRegistry", () => {
		const registry = createDefaultRegistry();
		expect(registry.get("function")).toBe(functionKind);
	});
});
