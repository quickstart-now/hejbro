import { describe, expect, it } from "vitest";
import { storageBucket } from "../src/storage/bucket";

describe("storageBucket()", () => {
	it("defaults to private, no size limit, no mime allowlist", () => {
		const bucket = storageBucket("avatars");
		expect(bucket.declarationKind).toBe("supabase-storage-bucket");
		expect(bucket.bucketName).toBe("avatars");
		expect(bucket.isPublic).toBe(false);
		expect(bucket.fileSizeLimit).toBeNull();
		expect(bucket.allowedMimeTypes).toBeNull();
	});

	it("passes options through", () => {
		const bucket = storageBucket("avatars", {
			public: true,
			fileSizeLimit: 5242880,
			allowedMimeTypes: ["image/png", "image/jpeg"],
		});
		expect(bucket.isPublic).toBe(true);
		expect(bucket.fileSizeLimit).toBe(5242880);
		expect(bucket.allowedMimeTypes).toEqual(["image/png", "image/jpeg"]);
	});

	it("captures a declaration site", () => {
		const bucket = storageBucket("avatars");
		expect(
			typeof bucket.declaredAt === "string" || bucket.declaredAt === null,
		).toBe(true);
	});

	it("accepts dashed, dotted, and underscored names (S3-style, not D36)", () => {
		expect(() => storageBucket("profile-images")).not.toThrow();
		expect(() => storageBucket("profile.images")).not.toThrow();
		expect(() => storageBucket("profile_images")).not.toThrow();
		expect(() => storageBucket("2024-avatars")).not.toThrow();
	});

	it("rejects an invalid bucket name", () => {
		expect(() => storageBucket("My Bucket")).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-name" }),
		);
	});

	it("rejects a name over 100 characters", () => {
		expect(() => storageBucket("a".repeat(101))).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-name" }),
		);
	});

	it("accepts exactly 100 characters", () => {
		expect(() => storageBucket("a".repeat(100))).not.toThrow();
	});
});

describe("storageBucket() fileSizeLimit guard", () => {
	it("accepts a positive safe integer", () => {
		expect(() =>
			storageBucket("avatars", { fileSizeLimit: 5242880 }),
		).not.toThrow();
	});

	it("accepts 1 (the smallest positive integer)", () => {
		expect(() => storageBucket("avatars", { fileSizeLimit: 1 })).not.toThrow();
	});

	it("rejects NaN", () => {
		expect(() =>
			storageBucket("avatars", { fileSizeLimit: Number.NaN }),
		).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-file-size-limit" }),
		);
	});

	it("rejects Infinity", () => {
		expect(() =>
			storageBucket("avatars", { fileSizeLimit: Number.POSITIVE_INFINITY }),
		).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-file-size-limit" }),
		);
	});

	it("rejects a non-integer (fractional) value", () => {
		expect(() => storageBucket("avatars", { fileSizeLimit: 1.5 })).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-file-size-limit" }),
		);
	});

	it("rejects zero", () => {
		expect(() => storageBucket("avatars", { fileSizeLimit: 0 })).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-file-size-limit" }),
		);
	});

	it("rejects a negative value", () => {
		expect(() => storageBucket("avatars", { fileSizeLimit: -1 })).toThrowError(
			expect.objectContaining({ code: "invalid-bucket-file-size-limit" }),
		);
	});
});
