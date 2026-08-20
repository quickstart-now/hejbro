import { captureDeclarationSite, throwHejbroError } from "@hejbro/core";

const bucketNamePattern = /^[a-z0-9][a-z0-9._-]*$/;
const maxBucketNameLength = 100;

const bucketNameRuleMessage = (name: string): string =>
	`storage bucket name "${name}" is invalid — bucket names must match ^[a-z0-9][a-z0-9._-]*$ (lower-case letters, digits, dots, underscores, and dashes, starting with a letter or digit) and be at most ${maxBucketNameLength} characters. This is a Supabase/S3-compatible row value, not a SQL identifier, so hejbro's stricter table/column identifier rule does not apply here.`;

const assertValidBucketName = (
	name: string,
	declaredAt: string | null,
): string => {
	if (name.length > maxBucketNameLength || !bucketNamePattern.test(name)) {
		return throwHejbroError(
			"invalid-bucket-name",
			bucketNameRuleMessage(name),
			declaredAt,
		);
	}
	return name;
};

const fileSizeLimitRuleMessage = (value: number): string =>
	`storage bucket fileSizeLimit ${value} is invalid — it must be a positive integer number of bytes. NaN and Infinity cannot be stored in the underlying SQL column, and a fractional value would fail at apply time (the column is a bigint). Pass a positive whole number of bytes, e.g. 5242880 for 5 MiB.`;

const assertValidFileSizeLimit = (
	value: number,
	declaredAt: string | null,
): number => {
	if (!Number.isSafeInteger(value) || value <= 0) {
		return throwHejbroError(
			"invalid-bucket-file-size-limit",
			fileSizeLimitRuleMessage(value),
			declaredAt,
		);
	}
	return value;
};

const resolveFileSizeLimit = (
	value: number | undefined,
	declaredAt: string | null,
): number | null => {
	if (value === undefined) {
		return null;
	}
	return assertValidFileSizeLimit(value, declaredAt);
};

/** Options a storage bucket declaration may pass; all optional (D42 defaults: private, no size limit, no mime allowlist). */
export type StorageBucketOptions = {
	readonly public?: boolean;
	readonly fileSizeLimit?: number;
	readonly allowedMimeTypes?: ReadonlyArray<string>;
};

/**
 * A declared Supabase storage bucket (D42) — the first row-data object
 * kind: `create`/`alter` emit an idempotent upsert into
 * `storage.buckets`, `drop` emits no SQL (buckets hold user files, so
 * hejbro never auto-deletes one).
 */
export type StorageBucketDeclaration = {
	readonly declarationKind: "supabase-storage-bucket";
	readonly bucketName: string;
	readonly isPublic: boolean;
	readonly fileSizeLimit: number | null;
	readonly allowedMimeTypes: ReadonlyArray<string> | null;
	readonly declaredAt: string | null;
};

/**
 * Declares a Supabase storage bucket. `bucketName` must match
 * `^[a-z0-9][a-z0-9._-]*$` and be at most 100 characters — the
 * Supabase/S3-compatible bucket-naming rule, distinct from hejbro's SQL
 * identifier rule (D36), since a bucket name is a row value, not a SQL
 * identifier.
 */
export const storageBucket = (
	bucketName: string,
	options?: StorageBucketOptions,
): StorageBucketDeclaration => {
	const declaredAt = captureDeclarationSite();
	return {
		declarationKind: "supabase-storage-bucket",
		bucketName: assertValidBucketName(bucketName, declaredAt),
		isPublic: options?.public ?? false,
		fileSizeLimit: resolveFileSizeLimit(options?.fileSizeLimit, declaredAt),
		allowedMimeTypes: options?.allowedMimeTypes ?? null,
		declaredAt,
	};
};
