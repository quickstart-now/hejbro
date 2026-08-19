import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { diffSnapshots } from "../src/engine/diff-engine";
import { createDefaultRegistry } from "../src/kind/registry";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import { uuid } from "../src/types/column-builder-factories";

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
