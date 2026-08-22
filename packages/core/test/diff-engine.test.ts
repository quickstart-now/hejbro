import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { diffSnapshots } from "../src/engine/diff-engine";
import { generateMigration } from "../src/engine/generate";
import {
	createDefaultRegistry,
	createKindRegistry,
} from "../src/kind/registry";
import { enumKind } from "../src/kinds/enum-kind";
import { schemaKind } from "../src/kinds/schema-kind";
import { sequenceKind } from "../src/kinds/sequence-kind";
import { tableKind } from "../src/kinds/table-kind";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import { serial, uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const registry = createDefaultRegistry();

describe("diffSnapshots — kind dependency ordering", () => {
	it("orders creates: schema, then enum, then table", () => {
		const postStatus = pgEnum(app, "post_status", ["draft"]);
		const posts = table(app, "posts", { status: postStatus.column() });
		const next = buildSnapshot(
			[app, postStatus, getTableMeta(posts)],
			registry,
		);
		const changes = diffSnapshots(emptySnapshot, next, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"enum",
			"table",
		]);
		expect(changes.every((change) => change.operation === "create")).toBe(true);
	});

	it("orders drops in reverse: table, then enum, then schema", () => {
		const postStatus = pgEnum(app, "post_status", ["draft"]);
		const posts = table(app, "posts", { status: postStatus.column() });
		const previous = buildSnapshot(
			[app, postStatus, getTableMeta(posts)],
			registry,
		);
		const changes = diffSnapshots(previous, emptySnapshot, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"table",
			"enum",
			"schema",
		]);
		expect(changes.every((change) => change.operation === "drop")).toBe(true);
	});

	// D74/#23: table-kind.ts's add-column rendering inlines a serial
	// column's sequence-backed default (`nextval('…')`), which requires
	// the sequence to already exist -- so `sequence` creates must sort
	// *before* `table` creates. Before tableKind.dependsOn declared
	// "sequence", this held only because registry.ts happens to register
	// sequenceKind ahead of tableKind (confirmed by measurement during
	// #193 review: no dependsOn edge, no pinning test, `grep -rln
	// "rankKinds|topoSortKindNames" packages/core/test/` returned nothing)
	// -- a by-product of registration order, not a declared dependency.
	it("orders creates: sequence, then table, for a serial-family column", () => {
		const posts = table(app, "posts", { id: serial().primaryKey() });
		// generateMigration, not buildSnapshot directly -- buildSnapshot takes
		// already-resolved declarations and has no synthesis step of its own;
		// only generateMigration's resolveDeclarations synthesizes the
		// sequence declaration a raw serial() column implies.
		const next = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;
		const changes = diffSnapshots(emptySnapshot, next, registry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"sequence",
			"table",
		]);
	});

	// The structural half of the claim above: this order must survive a
	// registry that registers `table` *before* `sequence` -- the exact
	// registration-order flip that would have silently broken the old,
	// undeclared ordering. Built as a standalone registry (not a mutation
	// of registry.ts itself) so this test exercises the real risk directly
	// rather than asserting registry.ts's current line order stays put.
	it("keeps sequence-before-table even when a registry registers table first (registration-order independence)", () => {
		const reorderedRegistry = createKindRegistry();
		reorderedRegistry.register(schemaKind);
		reorderedRegistry.register(enumKind);
		reorderedRegistry.register(tableKind);
		reorderedRegistry.register(sequenceKind);

		const posts = table(app, "posts", { id: serial().primaryKey() });
		const next = generateMigration({
			declarations: [app, posts],
			previousSnapshot: emptySnapshot,
			registry: reorderedRegistry,
		}).snapshot;
		const changes = diffSnapshots(emptySnapshot, next, reorderedRegistry);
		expect(changes.map((change) => change.kind)).toEqual([
			"schema",
			"sequence",
			"table",
		]);
	});

	it("sorts changes by identity (byte order) within the same kind", () => {
		const zebra = table(app, "zebra", { id: uuid().primaryKey() });
		const alpha = table(app, "alpha", { id: uuid().primaryKey() });
		const next = buildSnapshot(
			[app, getTableMeta(zebra), getTableMeta(alpha)],
			registry,
		);
		const changes = diffSnapshots(emptySnapshot, next, registry).filter(
			(change) => change.kind === "table",
		);
		expect(changes.map((change) => change.identity)).toEqual([
			"app.alpha",
			"app.zebra",
		]);
	});
});

describe("diffSnapshots — no-op", () => {
	it("has no changes between identical snapshots", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([app, getTableMeta(posts)], registry);
		expect(diffSnapshots(snapshot, snapshot, registry)).toEqual([]);
	});
});

describe("diffSnapshots — malformed snapshot node (#26)", () => {
	it("wraps a raw crash from a malformed table node into malformed-snapshot-node, naming the entry", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const next = buildSnapshot([app, getTableMeta(posts)], registry);
		const corruptedPrevious = {
			...next,
			objects: {
				...next.objects,
				"table:app.posts": { schema: "app", name: "posts" }, // missing columns/indexes/foreignKeys
			},
		};
		expect(() => diffSnapshots(corruptedPrevious, next, registry)).toThrowError(
			expect.objectContaining({
				code: "malformed-snapshot-node",
				message: expect.stringContaining('"table:app.posts"'),
			}),
		);
	});
});
