import {
	createKindRegistry,
	emptySnapshot,
	generateMigration,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { registerSupabaseKinds } from "../src/index";
import { storageBucket } from "../src/storage/bucket";
import { storageBucketKind } from "../src/storage/bucket-kind";

describe("storageBucketKind.serialize / identify", () => {
	it("serializes a full-option bucket with every field present", () => {
		const bucket = storageBucket("avatars", {
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
		expect(storageBucketKind.serialize(bucket)).toEqual({
			name: "avatars",
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
	});

	it("serializes a minimal bucket omitting default fields (compact)", () => {
		const bucket = storageBucket("notes");
		expect(storageBucketKind.serialize(bucket)).toEqual({ name: "notes" });
	});

	it("identifies by bucket name", () => {
		const snapshot = storageBucketKind.serialize(storageBucket("avatars"));
		expect(storageBucketKind.identify(snapshot)).toBe("avatars");
	});
});

describe("storageBucketKind.diff", () => {
	it("diffs create when there is no previous snapshot", () => {
		const next = storageBucketKind.serialize(storageBucket("avatars"));
		expect(storageBucketKind.diff(null, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "create",
				identity: "avatars",
				previous: null,
				next,
				notes: [],
			},
		]);
	});

	it("diffs drop when there is no next snapshot, with the manual-deletion note", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		expect(storageBucketKind.diff(previous, null, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "drop",
				identity: "avatars",
				previous,
				next: null,
				notes: [
					'bucket "avatars" removed from declarations — buckets hold user files, so hejbro emits no delete; remove it manually in Supabase when ready.',
				],
			},
		]);
	});

	it("diffs no change for identical snapshots", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		const next = storageBucketKind.serialize(storageBucket("avatars"));
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([]);
	});

	it("diffs a config change as a single alter", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		const next = storageBucketKind.serialize(
			storageBucket("avatars", { public: true }),
		);
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: [],
			},
		]);
	});
});

describe("storageBucketKind registration", () => {
	it("registers cleanly into a fresh registry", () => {
		const registry = createKindRegistry();
		expect(() => registry.register(storageBucketKind)).not.toThrow();
		expect(registry.get("supabase-storage-bucket")).toBe(storageBucketKind);
	});

	it("registerSupabaseKinds registers storageBucketKind", () => {
		const registry = createKindRegistry();
		registerSupabaseKinds(registry);
		expect(registry.get("supabase-storage-bucket")).toBe(storageBucketKind);
	});
});

describe("storageBucketKind.emit", () => {
	it("emits an upsert for a full-option bucket create", () => {
		const next = storageBucketKind.serialize(
			storageBucket("avatars", {
				public: true,
				fileSizeLimit: 5242880,
				allowedMimeTypes: ["image/png", "image/jpeg"],
			}),
		);
		const statements = storageBucketKind.emit({
			kind: "supabase-storage-bucket",
			operation: "create",
			identity: "avatars",
			previous: null,
			next,
			notes: [],
		});
		expect(statements).toEqual([
			{
				sql: [
					`insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")`,
					`values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg']::text[])`,
					`on conflict ("id") do update set`,
					`  "public" = excluded."public",`,
					`  "file_size_limit" = excluded."file_size_limit",`,
					`  "allowed_mime_types" = excluded."allowed_mime_types";`,
				].join("\n"),
				stage: "main",
			},
		]);
	});

	it("emits an upsert with nulls/false for a minimal bucket create", () => {
		const next = storageBucketKind.serialize(storageBucket("notes"));
		const statements = storageBucketKind.emit({
			kind: "supabase-storage-bucket",
			operation: "create",
			identity: "notes",
			previous: null,
			next,
			notes: [],
		});
		expect(statements).toEqual([
			{
				sql: [
					`insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")`,
					`values ('notes', 'notes', false, null, null)`,
					`on conflict ("id") do update set`,
					`  "public" = excluded."public",`,
					`  "file_size_limit" = excluded."file_size_limit",`,
					`  "allowed_mime_types" = excluded."allowed_mime_types";`,
				].join("\n"),
				stage: "main",
			},
		]);
	});

	it("alter emits the same upsert shape (rendered from next alone, D24-style)", () => {
		const next = storageBucketKind.serialize(
			storageBucket("avatars", { public: true }),
		);
		const statements = storageBucketKind.emit({
			kind: "supabase-storage-bucket",
			operation: "alter",
			identity: "avatars",
			previous: storageBucketKind.serialize(storageBucket("avatars")),
			next,
			notes: [],
		});
		expect(statements).toHaveLength(1);
		expect(statements[0]?.sql).toContain(
			"values ('avatars', 'avatars', true, null, null)",
		);
	});

	it("drop emits no SQL", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		const statements = storageBucketKind.emit({
			kind: "supabase-storage-bucket",
			operation: "drop",
			identity: "avatars",
			previous,
			next: null,
			notes: [
				'bucket "avatars" removed from declarations — buckets hold user files, so hejbro emits no delete; remove it manually in Supabase when ready.',
			],
		});
		expect(statements).toEqual([]);
	});

	it("escapes embedded single quotes in allowedMimeTypes (quoteStringLiteral doubling)", () => {
		const next = storageBucketKind.serialize(
			storageBucket("avatars", { allowedMimeTypes: ["it's/bad", "image/png"] }),
		);
		const statements = storageBucketKind.emit({
			kind: "supabase-storage-bucket",
			operation: "create",
			identity: "avatars",
			previous: null,
			next,
			notes: [],
		});
		expect(statements[0]?.sql).toContain(
			"array['it''s/bad', 'image/png']::text[]",
		);
	});
});

describe("storageBucketKind end-to-end via generateMigration", () => {
	it("creates a bucket through the full pipeline with a registered registry", () => {
		const registry = createKindRegistry();
		registry.register(storageBucketKind);
		const bucket = storageBucket("avatars", {
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
		const result = generateMigration({
			declarations: [bucket],
			previousSnapshot: emptySnapshot,
			registry,
		});
		expect(result.hasChanges).toBe(true);
		expect(result.sql).toContain(
			"values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg']::text[])",
		);
		expect(result.snapshot.objects["supabase-storage-bucket:avatars"]).toEqual({
			name: "avatars",
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
	});

	it("drop end-to-end: no SQL, note captured on the KindChange", () => {
		const registry = createKindRegistry();
		registry.register(storageBucketKind);
		const bucket = storageBucket("avatars");
		const previousSnapshot = generateMigration({
			declarations: [bucket],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;
		const result = generateMigration({
			declarations: [],
			previousSnapshot,
			registry,
		});
		expect(result.hasChanges).toBe(true);
		expect(result.sql).not.toMatch(/insert into storage\.buckets/);
		expect(result.changes).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "drop",
				identity: "avatars",
				previous: { name: "avatars" },
				next: null,
				notes: [
					'bucket "avatars" removed from declarations — buckets hold user files, so hejbro emits no delete; remove it manually in Supabase when ready.',
				],
			},
		]);
		// Pin: core's banner renderer (sql/migration-file.ts) now joins a
		// drop's `notes` into its label too (`[dropped: <notes>]`), the
		// same `notes.join(", ")` mechanism the "alter" label already
		// used — resolved gap, flagged during this PR's implementation.
		expect(result.sql).toBe(
			'-- hejbro migration\n-- - supabase-storage-bucket avatars [dropped: bucket "avatars" removed from declarations — buckets hold user files, so hejbro emits no delete; remove it manually in Supabase when ready.]',
		);
	});
});
