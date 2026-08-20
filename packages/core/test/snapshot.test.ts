import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
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
	it("has version 3, postgres dialect, and no objects", () => {
		expect(emptySnapshot).toEqual({
			hejbroSnapshot: 3,
			dialect: "postgres",
			objects: {},
		});
	});

	it("renders with the v3 version marker (D51)", () => {
		expect(renderSnapshot(emptySnapshot)).toContain(`"hejbroSnapshot": 3`);
	});
});

describe("buildSnapshot", () => {
	it("routes declarations to their owning kind and keys objects by kind:identity", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([app, getTableMeta(posts)], registry);
		expect(Object.keys(snapshot.objects)).toEqual([
			"schema:app",
			"table:app.posts",
		]);
	});

	it("produces flat, byte-sorted keys regardless of declaration order", () => {
		const zebra = table(app, "zebra", { id: uuid().primaryKey() });
		const alpha = table(app, "alpha", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot(
			[getTableMeta(zebra), getTableMeta(alpha), app],
			registry,
		);
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
		expect(() =>
			buildSnapshot([getTableMeta(first), getTableMeta(second)], registry),
		).toThrowError(/index 0.*index 1/i);
	});
});

describe("renderSnapshot / parseSnapshot", () => {
	it("round-trips through render and parse", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const snapshot = buildSnapshot([app, getTableMeta(posts)], registry);
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

	it("rejects a v2 snapshot as unsupported-snapshot-version with the older-version wording (D51 format break)", () => {
		const raw = JSON.stringify({
			hejbroSnapshot: 2,
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({
				code: "unsupported-snapshot-version",
				message: expect.stringContaining("is older than this build supports"),
			}),
		);
	});

	it("rejects a snapshot from a newer build with the newer-version wording", () => {
		const raw = JSON.stringify({
			hejbroSnapshot: 99,
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({
				code: "unsupported-snapshot-version",
				message: expect.stringContaining("is newer than this build supports"),
			}),
		);
	});

	it("rejects a non-numeric snapshot version as invalid-snapshot, not a version mismatch", () => {
		const raw = JSON.stringify({
			hejbroSnapshot: "2",
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({ code: "invalid-snapshot" }),
		);
	});

	it("rejects a snapshot with a missing objects map", () => {
		const raw = JSON.stringify({ hejbroSnapshot: 3, dialect: "postgres" });
		expect(() => parseSnapshot(raw)).toThrowError(/objects/i);
	});

	it("rejects malformed JSON (e.g. an unresolved git conflict marker) as invalid-snapshot, not a raw SyntaxError", () => {
		const raw = "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n";
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({ code: "invalid-snapshot" }),
		);
	});
});
