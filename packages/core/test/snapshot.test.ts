import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { table } from "../src/dsl/table";
import { createDefaultRegistry } from "../src/kind/registry";
import {
	buildSnapshot,
	emptySnapshot,
	parseSnapshot,
	renderSnapshot,
} from "../src/snapshot/snapshot";
import { uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const registry = createDefaultRegistry();

describe("emptySnapshot", () => {
	it("has version 1, postgres dialect, and no objects", () => {
		expect(emptySnapshot).toEqual({
			hejbroSnapshot: 1,
			dialect: "postgres",
			objects: {},
		});
	});
});

describe("buildSnapshot", () => {
	it("routes declarations to their owning kind and keys objects by kind:identity", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([app, posts], registry);
		expect(Object.keys(snapshot.objects)).toEqual([
			"schema:app",
			"table:app.posts",
		]);
	});

	it("produces flat, byte-sorted keys regardless of declaration order", () => {
		const zebra = table(app, "zebra", { id: uuid().primaryKey() });
		const alpha = table(app, "alpha", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([zebra, alpha, app], registry);
		expect(Object.keys(snapshot.objects)).toEqual([
			"schema:app",
			"table:app.alpha",
			"table:app.zebra",
		]);
	});

	it("owns an enum declaration and keys it by schema.enumName", () => {
		const postStatus = pgEnum(app, "post_status", ["draft", "published"]);
		const snapshot = buildSnapshot([app, postStatus], registry);
		expect(Object.keys(snapshot.objects)).toEqual([
			"enum:app.post_status",
			"schema:app",
		]);
	});

	it("throws naming both declaration indexes when two declarations produce the same identity", () => {
		const first = table(app, "posts", { id: uuid().primaryKey() });
		const second = table(app, "posts", { id: uuid().primaryKey() });
		expect(() => buildSnapshot([first, second], registry)).toThrowError(
			/index 0.*index 1/i,
		);
	});
});

describe("renderSnapshot / parseSnapshot", () => {
	it("round-trips through render and parse", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([app, posts], registry);
		const rendered = renderSnapshot(snapshot);
		expect(parseSnapshot(rendered)).toEqual(snapshot);
	});

	it("rejects an unknown snapshot version with an actionable message", () => {
		const raw = JSON.stringify({
			hejbroSnapshot: 999,
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(/newer hejbro|upgrade/i);
	});

	it("rejects a snapshot with a missing objects map", () => {
		const raw = JSON.stringify({ hejbroSnapshot: 1, dialect: "postgres" });
		expect(() => parseSnapshot(raw)).toThrowError(/objects/i);
	});
});
