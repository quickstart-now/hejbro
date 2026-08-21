import type { JsonValue, ObjectKind } from "@hejbro/core";
import {
	assertNever,
	quoteStringLiteral,
	sameJson,
	statement,
	throwHejbroError,
} from "@hejbro/core";
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

const publicChangedNote = (
	previous: StorageBucketSnapshot,
	next: StorageBucketSnapshot,
): ReadonlyArray<string> => {
	if ((previous.public ?? false) === (next.public ?? false)) {
		return [];
	}
	return ["public changed"];
};

const fileSizeLimitChangedNote = (
	previous: StorageBucketSnapshot,
	next: StorageBucketSnapshot,
): ReadonlyArray<string> => {
	if (previous.fileSizeLimit === next.fileSizeLimit) {
		return [];
	}
	return ["file size limit changed"];
};

const allowedMimeTypesChangedNote = (
	previous: StorageBucketSnapshot,
	next: StorageBucketSnapshot,
): ReadonlyArray<string> => {
	if (
		sameJson(previous.allowedMimeTypes ?? null, next.allowedMimeTypes ?? null)
	) {
		return [];
	}
	return ["allowed mime types changed"];
};

/**
 * Field-level alter notes (#116) — the banner otherwise had nothing to
 * say about a bucket alter (`notes: []`, rendered as a bare `[]`, the
 * only kind that did). Order matches the declaration order in
 * {@link StorageBucketSnapshot}. `allowedMimeTypes` compares by
 * `sameJson`, so it's order-sensitive like the rest of the snapshot diff
 * (matches the top-level `sameJson` check this diff already uses to
 * decide there's a change at all).
 */
const bucketAlterNotes = (
	previous: StorageBucketSnapshot,
	next: StorageBucketSnapshot,
): ReadonlyArray<string> => [
	...publicChangedNote(previous, next),
	...fileSizeLimitChangedNote(previous, next),
	...allowedMimeTypesChangedNote(previous, next),
];

const renderMimeTypesLiteral = (
	values: ReadonlyArray<string> | undefined,
): string => {
	if (values === undefined) {
		return "null";
	}
	const items = values.map((value) => quoteStringLiteral(value)).join(", ");
	return `array[${items}]::text[]`;
};

const renderFileSizeLimitLiteral = (value: number | undefined): string => {
	if (value === undefined) {
		return "null";
	}
	return String(value);
};

const renderPublicLiteral = (value: true | undefined): string => {
	if (value === true) {
		return "true";
	}
	return "false";
};

/** Renders the idempotent `insert ... on conflict (id) do update set ...` upsert (D42) — `id` and `name` are both the bucket name, matching Supabase's `storage.buckets` schema. */
const bucketUpsertSql = (snapshot: StorageBucketSnapshot): string => {
	const idLiteral = quoteStringLiteral(snapshot.name);
	const nameLiteral = quoteStringLiteral(snapshot.name);
	const publicLiteral = renderPublicLiteral(snapshot.public);
	const fileSizeLimitLiteral = renderFileSizeLimitLiteral(
		snapshot.fileSizeLimit,
	);
	const allowedMimeTypesLiteral = renderMimeTypesLiteral(
		snapshot.allowedMimeTypes,
	);
	return [
		`insert into storage.buckets ("id", "name", "public", "file_size_limit", "allowed_mime_types")`,
		`values (${idLiteral}, ${nameLiteral}, ${publicLiteral}, ${fileSizeLimitLiteral}, ${allowedMimeTypesLiteral})`,
		`on conflict ("id") do update set`,
		`  "public" = excluded."public",`,
		`  "file_size_limit" = excluded."file_size_limit",`,
		`  "allowed_mime_types" = excluded."allowed_mime_types";`,
	].join("\n");
};

/**
 * The Supabase preset's storage bucket object kind (D42) — the first
 * row-data kind: buckets are rows in Supabase's own `storage.buckets`
 * table, not DDL. Identity is the bucket name. `create`/`alter` both emit
 * the same idempotent upsert (rendered from the snapshot alone, D24-style
 * — the diff engine's single-`alter`-`KindChange` precedent). `drop` emits
 * no SQL and carries a manual-deletion note instead: auto-deleting a
 * bucket would destroy user files, beyond what a generated migration may
 * do.
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
		const previousSnapshot = asStorageBucketSnapshot(previous);
		const nextSnapshot = asStorageBucketSnapshot(next);
		return [
			{
				kind: "supabase-storage-bucket",
				operation: "alter",
				identity,
				previous,
				next,
				notes: bucketAlterNotes(previousSnapshot, nextSnapshot),
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create":
			case "alter": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						`storage bucket ${change.operation} change is missing its next snapshot.`,
					);
				}
				return [
					statement(bucketUpsertSql(asStorageBucketSnapshot(change.next))),
				];
			}
			case "drop":
				return [];
			default:
				return assertNever(change.operation);
		}
	},
};
