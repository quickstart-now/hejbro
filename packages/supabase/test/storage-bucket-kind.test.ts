import { createKindRegistry } from "@hejbro/core";
import { describe, expect, it } from "vitest";
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
});
