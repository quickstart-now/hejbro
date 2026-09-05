import {
	createKindRegistry,
	emptySnapshot,
	generateMigration,
	parseSnapshot,
	requiredKeysByKind,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { registerSupabaseKinds } from "../src/index";
import { storageBucket } from "../src/storage/bucket";
import { storageBucketKind } from "../src/storage/bucket-kind";

describe("storageBucketKind.noCatalogObjectReason (#482, task 2.2)", () => {
	it("the bucket kind declares itself uncomparable against a catalog, with the reason", () => {
		expect(storageBucketKind.noCatalogObjectReason).toBeDefined();
		expect(storageBucketKind.noCatalogObjectReason).toMatch(/Storage API/);
	});
});

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

	it("diffs no change when both previous and next are absent (#154, defensive -- no real caller passes this)", () => {
		expect(storageBucketKind.diff(null, null, "avatars")).toEqual([]);
	});

	it("diffs no change for identical snapshots", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		const next = storageBucketKind.serialize(storageBucket("avatars"));
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([]);
	});

	it("diffs a config change as a single alter, with a field-level note", () => {
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
				notes: ["public changed"],
			},
		]);
	});

	it("notes a file size limit change", () => {
		const previous = storageBucketKind.serialize(
			storageBucket("avatars", { fileSizeLimit: 1048576 }),
		);
		const next = storageBucketKind.serialize(
			storageBucket("avatars", { fileSizeLimit: 2097152 }),
		);
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["file size limit changed"],
			},
		]);
	});

	it("notes an allowed mime types change", () => {
		const previous = storageBucketKind.serialize(
			storageBucket("avatars", { allowedMimeTypes: ["image/png"] }),
		);
		const next = storageBucketKind.serialize(
			storageBucket("avatars", {
				allowedMimeTypes: ["image/png", "image/jpeg"],
			}),
		);
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["allowed mime types changed"],
			},
		]);
	});

	it("notes allowedMimeTypes as changed when the same values are reordered (order-sensitive, matching the kind's existing sameJson-based diff)", () => {
		const previous = storageBucketKind.serialize(
			storageBucket("avatars", {
				allowedMimeTypes: ["image/png", "image/jpeg"],
			}),
		);
		const next = storageBucketKind.serialize(
			storageBucket("avatars", {
				allowedMimeTypes: ["image/jpeg", "image/png"],
			}),
		);
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["allowed mime types changed"],
			},
		]);
	});

	it("notes every changed field, in declaration order, when several change at once", () => {
		const previous = storageBucketKind.serialize(storageBucket("avatars"));
		const next = storageBucketKind.serialize(
			storageBucket("avatars", {
				public: true,
				fileSizeLimit: 1048576,
				allowedMimeTypes: ["image/png"],
			}),
		);
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: [
					"public changed",
					"file size limit changed",
					"allowed mime types changed",
				],
			},
		]);
	});

	it("never reaches an alter with empty notes, for a field name bucketAlterNotes doesn't know about (#116 regression)", () => {
		// Mirrors the review probe that broke the first field-by-field
		// version of bucketAlterNotes: two snapshots differing only in a
		// field ("owner") that isn't part of StorageBucketSnapshot at all.
		// notes is derived from the snapshots' own key sets, not a fixed
		// list of known fields, so this stays non-empty no matter what key
		// changes -- if notes derivation ever regresses back to a
		// per-field enumeration, this is the first thing that goes red,
		// before a fourth real field has to be added to notice.
		const previous = { name: "avatars", owner: "team-a" };
		const next = { name: "avatars", owner: "team-b" };
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["owner changed"],
			},
		]);
	});

	it("notes public as changed when the value is explicitly false in previous but the key is entirely absent from next (#116 regression)", () => {
		// The prior publicChangedNote compared `(previous.public ?? false)
		// === (next.public ?? false)` -- both sides coalesce to `false`
		// here, so it produced no note. But the top-level alter decision
		// (sameJson(previous, next), gating whether diff emits an alter at
		// all) treats these as structurally different objects (one has a
		// "public" key, the other doesn't), so it emits an alter anyway:
		// an alter with an empty note for the very field that triggered
		// it, #116's bug surviving for an existing field, not just an
		// unenumerated future one. changedFieldNames uses the same
		// sameJson basis as that top-level decision, closing this gap by
		// construction rather than by coincidence.
		const previous = { name: "avatars", public: false };
		const next = { name: "avatars" };
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["public changed"],
			},
		]);
	});

	it("notes public as changed when the value is explicit null in previous and the key is absent from next (#116 regression: null vs absent)", () => {
		// changedFieldNames used to default an absent key to `null`
		// (`previous[key] ?? null`) -- the same shape of bug as the
		// `?? false` case above, just with the sentinel moved. A snapshot
		// loaded from disk can carry an explicit `null` (D33: a
		// hand-edited or round-tripped snapshot must behave like a freshly
		// serialized one; other snapshot fields already use `null` for
		// "unset", e.g. SelectNode.where/limit), so `public: null` vs an
		// absent `public` key are structurally different to the top-level
		// sameJson(previous, next) decision but coalesced to equal by
		// `?? null`. Fixed by comparing single-key-wrapped objects
		// instead of defaulting to any sentinel value at all.
		const previous = { name: "avatars", public: null };
		const next = { name: "avatars" };
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["public changed"],
			},
		]);
	});

	it("notes public as changed when the key is absent from previous and explicit null in next (#116 regression: absent vs null)", () => {
		// The mirror image of the above -- the field appearing (as an
		// explicit null) rather than disappearing.
		const previous = { name: "avatars" };
		const next = { name: "avatars", public: null };
		expect(storageBucketKind.diff(previous, next, "avatars")).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous,
				next,
				notes: ["public changed"],
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

	it("throws invalid-kind-change when a create carries no next snapshot (malformed input, #154)", () => {
		expect(() =>
			storageBucketKind.emit({
				kind: "supabase-storage-bucket",
				operation: "create",
				identity: "avatars",
				previous: null,
				next: null,
				notes: [],
			}),
		).toThrowError(
			"supabase-storage-bucket create change is missing its next snapshot.",
		);
	});

	it("throws invalid-kind-change when an alter carries no next snapshot (malformed input, #154)", () => {
		expect(() =>
			storageBucketKind.emit({
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "avatars",
				previous: storageBucketKind.serialize(storageBucket("avatars")),
				next: null,
				notes: [],
			}),
		).toThrowError(
			"supabase-storage-bucket alter change is missing its next snapshot.",
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
		// Full-string, banner included -- drop already pins its banner this
		// way (below) and alter does too (#166); create didn't, so a
		// regression in the "[new]" marker specifically had no test at the
		// preset-kind layer to catch it. See #167.
		expect(result.sql).toBe(
			[
				"-- hejbro migration",
				"-- + supabase-storage-bucket avatars [new]",
				"",
				`insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")`,
				`values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg']::text[])`,
				`on conflict ("id") do update set`,
				`  "public" = excluded."public",`,
				`  "file_size_limit" = excluded."file_size_limit",`,
				`  "allowed_mime_types" = excluded."allowed_mime_types";`,
			].join("\n"),
		);
		expect(result.snapshot.objects["supabase-storage-bucket:avatars"]).toEqual({
			name: "avatars",
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
	});

	it("alter end-to-end: banner lists the changed fields, not an empty bracket", () => {
		const registry = createKindRegistry();
		registry.register(storageBucketKind);
		const bucket = storageBucket("attachments", {
			allowedMimeTypes: ["image/png"],
		});
		const previousSnapshot = generateMigration({
			declarations: [bucket],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;
		const changed = storageBucket("attachments", {
			public: true,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
		const result = generateMigration({
			declarations: [changed],
			previousSnapshot,
			registry,
		});
		expect(result.hasChanges).toBe(true);
		expect(result.changes).toEqual([
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity: "attachments",
				previous: { name: "attachments", allowedMimeTypes: ["image/png"] },
				next: {
					name: "attachments",
					public: true,
					allowedMimeTypes: ["image/png", "image/jpeg"],
				},
				notes: ["public changed", "allowed mime types changed"],
			},
		]);
		// Before this test's fix, this banner line rendered a bare `[]` --
		// `notes: []` on every alter, regardless of what actually changed
		// (#116). Reproduced directly against this same scenario: the
		// pre-fix output was
		// `-- ~ supabase-storage-bucket attachments []`.
		expect(result.sql.split("\n")[1]).toBe(
			"-- ~ supabase-storage-bucket attachments [public changed, allowed mime types changed]",
		);
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

// D79/#159: ObjectKind is the shared extension interface, so a preset kind
// (not just a core one) opts into requiredKeys the same way -- checked
// through the exact same parseSnapshot(text, requiredKeysByKind) path a
// preset-registered kind's snapshot would really be parsed with.
describe("storageBucketKind.requiredKeys (D79, #159)", () => {
	const registryWithStorageBucket = () => {
		const registry = createKindRegistry();
		registerSupabaseKinds(registry);
		return registry;
	};

	it("declares name as its own required key", () => {
		expect(storageBucketKind.requiredKeys).toEqual(["name"]);
	});

	it("accepts a fully-populated node (negative control)", () => {
		const raw = JSON.stringify({
			formatVersion: 8,
			dialect: "postgres",
			objects: { "supabase-storage-bucket:avatars": { name: "avatars" } },
		});
		expect(() =>
			parseSnapshot(raw, requiredKeysByKind(registryWithStorageBucket())),
		).not.toThrow();
	});

	it("rejects a node missing name, by name", () => {
		const raw = JSON.stringify({
			formatVersion: 8,
			dialect: "postgres",
			objects: { "supabase-storage-bucket:avatars": {} },
		});
		expect(() =>
			parseSnapshot(raw, requiredKeysByKind(registryWithStorageBucket())),
		).toThrowError(
			expect.objectContaining({
				code: "invalid-snapshot",
				message: expect.stringContaining('missing required key "name"'),
			}),
		);
	});
});
