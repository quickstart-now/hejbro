import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import {
	createDefaultRegistry,
	requiredKeysByKind,
} from "../src/kind/registry";
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
	it("has version 5, postgres dialect, and no objects", () => {
		expect(emptySnapshot).toEqual({
			formatVersion: 5,
			dialect: "postgres",
			objects: {},
		});
	});

	it("renders with the v5 version marker (D68)", () => {
		expect(renderSnapshot(emptySnapshot)).toContain(`"formatVersion": 5`);
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

	it("rejects a v4 snapshot (the immediately prior format) as older, not misparsed as current (D68)", () => {
		const raw = JSON.stringify({
			formatVersion: 4,
			dialect: "postgres",
			objects: {},
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({
				code: "unsupported-snapshot-version",
				message: expect.stringContaining(
					"snapshot version 4 is older than this build supports",
				),
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
		const raw = JSON.stringify({ formatVersion: 5, dialect: "postgres" });
		expect(() => parseSnapshot(raw)).toThrowError(/objects/i);
	});

	// #26: a corrupted (but JSON-valid) entry used to reach kind.diff()/
	// planRenames unguarded, where it either crashed with a raw exception
	// or, in the more common case, was silently coerced by JS's forgiving
	// property access into wrong-but-not-crashing behavior. Catching it
	// here, at parse time, gives it the same treatment as every other
	// invalid-snapshot case instead of relying on it happening to crash
	// somewhere downstream.
	it.each([
		["null", null],
		["an array", ["not", "an", "object"]],
		["a string", "not an object"],
		["a number", 42],
	])("rejects a snapshot entry that is %s, not an object", (_label, value) => {
		const raw = JSON.stringify({
			formatVersion: 5,
			dialect: "postgres",
			objects: { "table:app.posts": value },
		});
		expect(() => parseSnapshot(raw)).toThrowError(
			expect.objectContaining({
				code: "invalid-snapshot",
				message: expect.stringContaining('"table:app.posts"'),
			}),
		);
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

// D79/#159: parseSnapshot's optional per-kind requiredKeys check. Every
// fixture here is hand-built JSON (D33 -- never derived from buildSnapshot),
// each missing exactly one of its own kind's requiredKeys (see each core
// kind's own requiredKeys array for where these lists come from), so the
// error names the exact missing key rather than a coincidental downstream
// crash. requiredKeysByKind(createDefaultRegistry()) is the plain map
// parseSnapshot's second argument accepts -- built from a real registry,
// never hand-duplicated here.
describe("parseSnapshot requiredKeys (D79, #159)", () => {
	const requiredKeys = requiredKeysByKind(registry);

	const validNodeByKind: Record<string, Record<string, unknown>> = {
		schema: { name: "app" },
		enum: { schema: "app", name: "status", values: ["a", "b"] },
		sequence: {
			schema: "app",
			name: "posts_id_seq",
			table: "posts",
			column: "id",
			baseType: "integer",
		},
		table: {
			schema: "app",
			name: "posts",
			columns: [],
			indexes: [],
			foreignKeys: [],
		},
		function: {
			schema: "app",
			name: "fn",
			args: [],
			returns: "void",
			security: "invoker",
			language: "plpgsql",
			bodyHash: "abc",
			bodySql: "begin end;",
		},
		trigger: {
			schema: "app",
			table: "posts",
			name: "trg",
			timing: "before",
			events: ["insert"],
			forEach: "row",
			function: "fn",
		},
		rls: { schema: "app", table: "posts" },
		policy: {
			schema: "app",
			table: "posts",
			name: "pol",
			command: "select",
			roles: ["anon"],
		},
		view: { schema: "app", name: "v", columns: [], query: {} },
		grant: {
			schema: "app",
			grantKind: "all-tables-privileges",
			role: "anon",
			privileges: ["select"],
		},
	};

	const rawSnapshotWith = (
		kind: string,
		node: Record<string, unknown>,
	): string =>
		JSON.stringify({
			formatVersion: 5,
			dialect: "postgres",
			objects: { [`${kind}:fixture`]: node },
		});

	it("every core kind's own requiredKeys array is exercised by this test's own fixture table (no kind silently skipped)", () => {
		const kindsWithRequiredKeys = registry
			.list()
			.filter((kind) => kind.requiredKeys !== undefined)
			.map((kind) => kind.kind)
			.sort();
		expect(Object.keys(validNodeByKind).sort()).toEqual(kindsWithRequiredKeys);
	});

	it.each(Object.entries(validNodeByKind))(
		"accepts a fully-populated %s node (negative control)",
		(kind, node) => {
			expect(() =>
				parseSnapshot(rawSnapshotWith(kind, node), requiredKeys),
			).not.toThrow();
		},
	);

	it.each(
		Object.entries(validNodeByKind).flatMap(([kind, node]) =>
			Object.keys(node).map((missingKey) => [kind, missingKey] as const),
		),
	)(
		"rejects a %s node missing its own required key %s, by name",
		(kind, missingKey) => {
			const node = validNodeByKind[kind];
			if (node === undefined) {
				throw new Error(`unreachable -- no fixture node for kind "${kind}"`);
			}
			const { [missingKey]: _omitted, ...withoutKey } = node;
			expect(() =>
				parseSnapshot(rawSnapshotWith(kind, withoutKey), requiredKeys),
			).toThrowError(
				expect.objectContaining({
					code: "invalid-snapshot",
					message: expect.stringContaining(
						`missing required key "${missingKey}"`,
					),
				}),
			);
		},
	);

	it("omitting requiredKeysByKind entirely keeps parseSnapshot's pre-#159 behavior (a missing key is not reported)", () => {
		const validEnum = validNodeByKind.enum;
		if (validEnum === undefined) {
			throw new Error('unreachable -- no fixture node for kind "enum"');
		}
		const { schema: _omitted, ...withoutSchema } = validEnum;
		const raw = rawSnapshotWith("enum", withoutSchema);
		expect(() => parseSnapshot(raw)).not.toThrow();
	});
});
