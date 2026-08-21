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
	it("has version 4, postgres dialect, and no objects", () => {
		expect(emptySnapshot).toEqual({
			formatVersion: 4,
			dialect: "postgres",
			objects: {},
		});
	});

	it("renders with the v4 version marker (D57)", () => {
		expect(renderSnapshot(emptySnapshot)).toContain(`"formatVersion": 4`);
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
			formatVersion: 999,
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(/newer hejbro|upgrade/i);
	});

	it("rejects a v2 snapshot as unsupported-snapshot-version with the older-version wording (D51 format break)", () => {
		const raw = JSON.stringify({
			formatVersion: 2,
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
			formatVersion: 99,
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
			formatVersion: "2",
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({ code: "invalid-snapshot" }),
		);
	});

	it("rejects a snapshot with a missing objects map", () => {
		const raw = JSON.stringify({ formatVersion: 4, dialect: "postgres" });
		expect(() => parseSnapshot(raw)).toThrowError(/objects/i);
	});

	it("rejects malformed JSON (e.g. an unresolved git conflict marker) as invalid-snapshot, not a raw SyntaxError", () => {
		const raw = "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n";
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({ code: "invalid-snapshot" }),
		);
	});

	// D57: the version field itself was renamed hejbroSnapshot -> formatVersion
	// (v3 -> v4). parseSnapshot still recognizes the old key so a pre-v4 file
	// gets the normal "older" message instead of misparsing (case (b) — see
	// parseSnapshot's own doc comment for all three cases).
	describe("pre-v4 files (old `hejbroSnapshot` key, no `formatVersion`)", () => {
		it("a numeric hejbroSnapshot with no formatVersion is treated as an older format, carrying its own version number", () => {
			const raw = JSON.stringify({
				hejbroSnapshot: 3,
				dialect: "postgres",
				objects: {},
			});
			expect(() => parseSnapshot(raw)).toThrowError(
				expect.objectContaining({
					code: "unsupported-snapshot-version",
					message: expect.stringContaining(
						"snapshot version 3 is older than this build supports",
					),
				}),
			);
		});

		it("neither formatVersion nor a numeric hejbroSnapshot is invalid-snapshot, not a version mismatch", () => {
			const raw = JSON.stringify({ dialect: "postgres", objects: {} });
			expect(() => parseSnapshot(raw)).toThrowError(
				expect.objectContaining({ code: "invalid-snapshot" }),
			);
		});

		it("a non-numeric hejbroSnapshot is invalid-snapshot and echoes the actual bad value, not `undefined`", () => {
			const raw = JSON.stringify({
				hejbroSnapshot: "abc",
				dialect: "postgres",
				objects: {},
			});
			expect(() => parseSnapshot(raw)).toThrowError(
				expect.objectContaining({
					code: "invalid-snapshot",
					message: expect.stringContaining('"abc"'),
				}),
			);
		});
	});
});
