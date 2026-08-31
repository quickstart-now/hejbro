import { describe, expect, it, vi } from "vitest";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { HejbroError } from "../src/error";
import {
	emptySnapshot,
	HEJBRO_SNAPSHOT_VERSION,
} from "../src/snapshot/snapshot";
import {
	MANIFEST_FORMAT,
	MANIFEST_PAYLOAD_TERMINATOR,
	renderManifestStatements,
} from "../src/sql/manifest";
import { text, uuid } from "../src/types/column-builder-factories";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
const declarations = [app, getTableMeta(posts)];

const manifestOptions = {
	payload: '{"tables":[]}',
	snapshotHash: "sha256:aaaa",
};

describe("renderManifestStatements", () => {
	it("renders nothing when no payload is supplied", () => {
		expect(renderManifestStatements(undefined)).toEqual([]);
	});

	it("renders the exact bootstrap and insert text (D1.1/D1.2)", () => {
		const statements = renderManifestStatements(manifestOptions);
		expect(statements[0]).toBe(
			'create schema if not exists "hejbro";\n' +
				'create table if not exists "hejbro"."schema_manifest" (\n' +
				'\t"seq" bigint generated always as identity primary key,\n' +
				'\t"manifest_format" integer not null,\n' +
				'\t"snapshot_format" integer not null,\n' +
				'\t"snapshot_hash" text not null,\n' +
				'\t"manifest" text not null,\n' +
				'\t"applied_at" timestamptz not null default now()\n' +
				");",
		);
		expect(statements[1]).toBe(
			'insert into "hejbro"."schema_manifest" ' +
				'("manifest_format", "snapshot_format", "snapshot_hash", "manifest") ' +
				`values (${MANIFEST_FORMAT}, ${HEJBRO_SNAPSHOT_VERSION}, 'sha256:aaaa', ` +
				`${MANIFEST_PAYLOAD_TERMINATOR}${manifestOptions.payload}${MANIFEST_PAYLOAD_TERMINATOR});`,
		);
	});

	it("the bootstrap is idempotent and comes first", () => {
		const statements = renderManifestStatements(manifestOptions);
		expect(statements).toHaveLength(2);
		expect(statements[0] ?? "").toContain("create schema if not exists");
		expect(statements[0] ?? "").toContain("create table if not exists");
		expect(statements[1] ?? "").toContain("insert into");
	});

	it("refuses a payload containing its own terminator", () => {
		expect.assertions(3);
		try {
			renderManifestStatements({
				payload: `before ${MANIFEST_PAYLOAD_TERMINATOR} after`,
				snapshotHash: "sha256:aaaa",
			});
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("manifest-payload-unquotable");
			expect((error as HejbroError).message).toMatch(/\bNext:/);
		}
	});

	it("two renders with different clocks are byte-identical", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
			const first = renderManifestStatements(manifestOptions);
			vi.setSystemTime(new Date(Date.UTC(2030, 11, 31)));
			const second = renderManifestStatements(manifestOptions);
			expect(first).toEqual(second);
		} finally {
			vi.useRealTimers();
		}
	});

	it("the insert carries no timestamp and no file name", () => {
		const insert = renderManifestStatements(manifestOptions)[1] ?? "";
		expect(insert).not.toMatch(/\d{4}-\d{2}-\d{2}/);
		expect(insert).not.toContain(".sql");
		expect(insert).not.toContain("applied_at");
	});

	it("appends the bootstrap and insert after the change statements", () => {
		const result = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
			manifest: manifestOptions,
		});
		const statements = renderManifestStatements(manifestOptions);
		const bootstrap = statements[0] ?? "";
		const insert = statements[1] ?? "";
		const createTableIndex = result.sql.indexOf('create table "app"."posts"');
		expect(createTableIndex).toBeGreaterThan(-1);
		expect(result.sql.indexOf(bootstrap)).toBeGreaterThan(createTableIndex);
		expect(result.sql.indexOf(insert)).toBeGreaterThan(
			result.sql.indexOf(bootstrap),
		);
	});

	it("disabled emission changes nothing", () => {
		const withoutManifest = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		});
		expect(withoutManifest.sql).not.toContain("hejbro.schema_manifest");
		expect(withoutManifest.sql).not.toContain("-- hejbro-manifest:");
	});

	it("no difference records no manifest", () => {
		const first = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
			manifest: manifestOptions,
		});
		const second = generateMigration({
			declarations,
			previousSnapshot: first.snapshot,
			manifest: manifestOptions,
		});
		expect(second.hasChanges).toBe(false);
		expect(second.sql).toBe("");
	});
});

describe("MANIFEST_FORMAT", () => {
	// [design] pin, not a delta SHALL: `1` is the value settled by task 1.2's
	// [design] ratification (the `-- hejbro-manifest: 1` banner line), not a
	// spec-mandated constant.
	it("starts at 1", () => {
		expect(MANIFEST_FORMAT).toBe(1);
	});
});
