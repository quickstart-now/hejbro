import { describe, expect, it } from "vitest";
import { validateExport } from "../src/vendor/validate-export";

const FORMAT_TEXT = '{"descriptionFormat":1,"snapshotFormat":8}';

const SNAPSHOT = '{"formatVersion":8,"dialect":"postgres","objects":{}}';

// One function per schemaText, deliberately: `z.array` fails the whole
// array on any one element's mismatch, so a shared fixture would turn
// every return kind red together under a mutant that drops only one
// union member -- these stay isolated so each kind's own fixture is the
// only one that can go red for that kind's own reason.
const buildSchemaText = (functionFact: unknown): string =>
	JSON.stringify({
		tables: [],
		functions: [functionFact],
		roles: [],
		snapshot: JSON.parse(SNAPSHOT),
	});

describe("validateExport", () => {
	it("keeps a scalar-returning function's carried facts", () => {
		const fact = {
			schemaName: "app",
			functionName: "total_posts",
			exportName: "totalPosts",
			args: [
				{
					key: "postId",
					sqlName: "post_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				{
					key: "weight",
					sqlName: "weight",
					typeNode: { typeName: "bigint" },
					mode: "number",
					notNullElements: false,
				},
				{
					key: "tags",
					sqlName: "tags",
					typeNode: { typeName: "array", element: { typeName: "text" } },
					mode: null,
					notNullElements: true,
				},
			],
			returns: {
				kind: "scalar",
				typeNode: { typeName: "bigint" },
				mode: "bigint",
			},
		};

		const validated = validateExport(FORMAT_TEXT, buildSchemaText(fact));

		expect(validated.payload.functions).toEqual([fact]);
	});

	it("keeps a table-returning function's carried facts", () => {
		const fact = {
			schemaName: "app",
			functionName: "posts_by_status",
			exportName: "postsByStatus",
			args: [
				{
					key: "status",
					sqlName: "status",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			],
			returns: { kind: "table", schemaName: "app", tableName: "posts" },
		};

		const validated = validateExport(FORMAT_TEXT, buildSchemaText(fact));

		expect(validated.payload.functions).toEqual([fact]);
	});

	it("refuses an argument missing its declared type", () => {
		const fact = {
			schemaName: "app",
			functionName: "total_posts",
			exportName: "totalPosts",
			args: [
				{
					key: "postId",
					sqlName: "post_id",
					mode: null,
					notNullElements: false,
				},
			],
			returns: null,
		};

		expect(() => validateExport(FORMAT_TEXT, buildSchemaText(fact))).toThrow(
			/does not answer its own format/,
		);
	});

	it("refuses a scalar return missing its declared type", () => {
		const fact = {
			schemaName: "app",
			functionName: "total_posts",
			exportName: "totalPosts",
			args: [],
			returns: { kind: "scalar", mode: "bigint" },
		};

		expect(() => validateExport(FORMAT_TEXT, buildSchemaText(fact))).toThrow(
			/does not answer its own format/,
		);
	});

	it("keeps a trigger-synthesized function's null return", () => {
		const fact = {
			schemaName: "app",
			functionName: "posts_touch",
			exportName: null,
			args: [],
			returns: null,
		};

		const validated = validateExport(FORMAT_TEXT, buildSchemaText(fact));

		expect(validated.payload.functions).toEqual([fact]);
	});
});

describe("validateExport — existing (add-unmanaged-objects, 2.1)", () => {
	it("a current export's existing table reads back as existing", () => {
		const schema = JSON.stringify({
			tables: [
				{
					schemaName: "auth",
					tableName: "users",
					exportName: null,
					columns: {},
					existing: true,
				},
			],
			functions: [],
			roles: [],
			snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
		});
		const { payload } = validateExport(FORMAT_TEXT, schema);
		expect(payload.tables[0]?.existing).toBe(true);
	});

	// Hand-written, not built by our own writer -- a schema.json this
	// package's own writer produces already carries the field one way or
	// the other, so it can never stand in for a file written before the
	// field existed (add-unmanaged-objects/1.3's own reasoning, applied
	// to the export instead of the snapshot).
	it("an export written before the marker reads as managed", () => {
		const olderSchema = JSON.stringify({
			tables: [
				{
					schemaName: "app",
					tableName: "posts",
					exportName: null,
					columns: {},
					// No `existing` key at all -- a real pre-add-unmanaged-
					// objects export.
				},
			],
			functions: [],
			roles: [],
			snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
		});
		const { payload } = validateExport(FORMAT_TEXT, olderSchema);
		expect(payload.tables[0]?.existing).toBe(false);
	});
});

/**
 * #657: a format-1 export written before the typed function surface
 * existed (pre-#587) has a `functions` entry carrying only `schemaName`/
 * `functionName`/`exportName` -- no `args`, no `returns` key at all
 * (confirmed against the real pre-#587 shape at git 518dcdde, not
 * assumed). Hand-written, not built by our own writer, the same
 * reasoning `existing`'s own pre-add-unmanaged-objects fixture above
 * already follows: a schema.json this writer produces always carries
 * both keys, one way or the other.
 */
describe("validateExport — a pre-functions export (#657)", () => {
	it("reads a pre-functions export and carries its tables", () => {
		const olderSchema = JSON.stringify({
			tables: [
				{
					schemaName: "app",
					tableName: "posts",
					exportName: "posts",
					columns: {
						id: { key: "id", mode: null, notNullElements: false },
					},
				},
			],
			functions: [
				{
					schemaName: "app",
					functionName: "total_posts",
					exportName: "totalPosts",
					// No `args`/`returns` key at all -- the pre-#587 shape.
				},
			],
			roles: [],
			snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
		});

		const { payload } = validateExport(FORMAT_TEXT, olderSchema);

		expect(payload.tables).toEqual([
			{
				schemaName: "app",
				tableName: "posts",
				exportName: "posts",
				columns: { id: { key: "id", mode: null, notNullElements: false } },
				existing: false,
			},
		]);
		expect(payload.functions).toEqual([
			{
				schemaName: "app",
				functionName: "total_posts",
				exportName: "totalPosts",
			},
		]);
		expect(payload.functions[0]).not.toHaveProperty("args");
		expect(payload.functions[0]).not.toHaveProperty("returns");
	});
});
