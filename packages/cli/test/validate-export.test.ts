import { describe, expect, it } from "vitest";
import { validateExport } from "../src/vendor/validate-export";

const VALID_FORMAT = '{"descriptionFormat":1,"snapshotFormat":8}';

describe("validateExport — unmanaged (add-unmanaged-objects, 2.1)", () => {
	it("a current export's unmanaged table reads back as unmanaged", () => {
		const schema = JSON.stringify({
			tables: [
				{
					schemaName: "auth",
					tableName: "users",
					exportName: null,
					columns: {},
					unmanaged: true,
				},
			],
			functions: [],
			roles: [],
			snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
		});
		const { payload } = validateExport(VALID_FORMAT, schema);
		expect(payload.tables[0]?.unmanaged).toBe(true);
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
					// No `unmanaged` key at all -- a real pre-add-unmanaged-
					// objects export.
				},
			],
			functions: [],
			roles: [],
			snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
		});
		const { payload } = validateExport(VALID_FORMAT, olderSchema);
		expect(payload.tables[0]?.unmanaged).toBe(false);
	});
});
