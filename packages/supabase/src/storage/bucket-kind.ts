import type { JsonValue, ObjectKind } from "@hejbro/core";
import { sameJson, throwHejbroError } from "@hejbro/core";
import type { StorageBucketDeclaration } from "./bucket";

/** A storage bucket's serialized snapshot node. **Compact**: `public` present only when `true` (default `false`); `fileSizeLimit`/`allowedMimeTypes` present only when set (default `null`, meaning "unset"). */
export type StorageBucketSnapshot = {
	readonly name: string;
	readonly public?: true;
	readonly fileSizeLimit?: number;
	readonly allowedMimeTypes?: ReadonlyArray<string>;
};

// Internal invariant: this shape is exactly what storageBucketKind.serialize below produces.
const asStorageBucketSnapshot = (snapshot: JsonValue): StorageBucketSnapshot =>
	snapshot as StorageBucketSnapshot;

const publicField = (value: boolean): Pick<StorageBucketSnapshot, "public"> => {
	if (!value) {
		return {};
	}
	return { public: true };
};

const fileSizeLimitField = (
	value: number | null,
): Pick<StorageBucketSnapshot, "fileSizeLimit"> => {
	if (value === null) {
		return {};
	}
	return { fileSizeLimit: value };
};

const allowedMimeTypesField = (
	value: ReadonlyArray<string> | null,
): Pick<StorageBucketSnapshot, "allowedMimeTypes"> => {
	if (value === null) {
		return {};
	}
	return { allowedMimeTypes: value };
};

const manualDeletionNote = (bucketName: string): string =>
	`bucket "${bucketName}" removed from declarations — buckets hold user files, so hejbro emits no delete; remove it manually in Supabase when ready.`;

/**
 * The Supabase preset's storage bucket object kind (D42) — the first
 * row-data kind: buckets are rows in Supabase's own `storage.buckets`
 * table, not DDL. Identity is the bucket name. `diff` reports a single
 * `create`/`drop`/`alter` change (D24-style); `drop`'s note carries the
 * manual-deletion guidance — auto-deleting a bucket would destroy user
 * files, beyond what a generated migration may do. `emit` lands in Task 16.
 */
export const storageBucketKind: ObjectKind<StorageBucketDeclaration> = {
	kind: "supabase-storage-bucket",
	dependsOn: [],
	owns: (declaration): declaration is StorageBucketDeclaration =>
		declaration.declarationKind === "supabase-storage-bucket",
	serialize: (declaration) => {
		const snapshot: StorageBucketSnapshot = {
			name: declaration.bucketName,
			...publicField(declaration.isPublic),
			...fileSizeLimitField(declaration.fileSizeLimit),
			...allowedMimeTypesField(declaration.allowedMimeTypes),
		};
		return snapshot;
	},
	identify: (snapshot) => asStorageBucketSnapshot(snapshot).name,
	diff: (previous, next, identity) => {
		if (previous === null && next !== null) {
			return [
				{
					kind: "supabase-storage-bucket",
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			];
		}
		if (previous !== null && next === null) {
			return [
				{
					kind: "supabase-storage-bucket",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [manualDeletionNote(identity)],
				},
			];
		}
		if (previous === null || next === null) {
			return [];
		}
		if (sameJson(previous, next)) {
			return [];
		}
		return [
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity,
				previous,
				next,
				notes: [],
			},
		];
	},
	// TASK-15-PLACEHOLDER: Task 16 replaces this with the real upsert emit.
	emit: () =>
		throwHejbroError(
			"not-implemented",
			"storage bucket emit lands in Task 16.",
		),
};
