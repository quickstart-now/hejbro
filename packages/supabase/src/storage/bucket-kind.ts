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

/** `"fileSizeLimit"` -> `"file size limit"`. Generic camelCase-to-words split, not a lookup table -- a new snapshot field is readable in a note without adding an entry here. */
const humanizeFieldName = (key: string): string =>
	key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * Which top-level keys actually differ between two snapshot objects,
 * `sameJson`-compared (so an array field like `allowedMimeTypes` is
 * order-sensitive, matching the top-level `sameJson` check this kind's
 * `diff` already uses to decide there's a change at all). `name` is
 * excluded: it's the identity `diff` groups by, never itself an "alter".
 *
 * Each key is compared by wrapping it in a single-key object --
 * `{ [key]: previous[key] }` vs `{ [key]: next[key] }` -- rather than
 * defaulting an absent key to a sentinel value (`?? null`, `?? false`,
 * etc). A default like that is itself a normalization the top-level
 * `sameJson(previous, next)` decision doesn't do, so it can quietly
 * disagree with that decision for whatever value happens to collide with
 * the chosen sentinel -- `?? false` did for `public: false` vs an absent
 * key, and `?? null` doesn't fix that, it just moves the same problem to
 * `public: null` vs absent (previous snapshots can carry explicit
 * `null`s -- see e.g. `SelectNode.where`/`limit` -- and D33 means a
 * hand-edited or round-tripped one must behave like a freshly serialized
 * one). `JSON.stringify` (which `sameJson` is built on) drops
 * `undefined`-valued object properties on its own, so wrapping in an
 * object lets "key absent" and "key present with value `null`" fall out
 * differently without this function normalizing anything itself.
 *
 * Candidate order is `next`'s own key order (matching the compact
 * snapshot's declaration order, since `serialize` builds it as an object
 * literal) followed by any key present in `previous` but entirely absent
 * from `next` (a field unset back to its default) -- so notes read in a
 * stable, field-declaration-like order without hardcoding one.
 */
// An absent key (`value === undefined`) wraps to `{}`, a present one to
// `{ [key]: value }` -- written as an explicit branch, not
// `{ [key]: value } as JsonValue` relying on `JSON.stringify` dropping
// `undefined`-valued properties. Both produce the same comparison, but this
// way "absent" and "present" are a visible branch in this function, not a
// property of the serializer `sameJson` happens to be built on -- the kind
// of implicit normalization this whole fix exists to get rid of.
const wrapKey = (key: string, value: JsonValue | undefined): JsonValue => {
	if (value === undefined) {
		return {};
	}
	return { [key]: value };
};

const changedFieldNames = (
	previous: Record<string, JsonValue>,
	next: Record<string, JsonValue>,
): ReadonlyArray<string> => {
	const unsetKeys = Object.keys(previous).filter((key) => !(key in next));
	const orderedKeys = [...Object.keys(next), ...unsetKeys].filter(
		(key) => key !== "name",
	);
	return orderedKeys.filter(
		(key) => !sameJson(wrapKey(key, previous[key]), wrapKey(key, next[key])),
	);
};

/**
 * Field-level alter notes (#116) — the banner otherwise had nothing to
 * say about a bucket alter (`notes: []`, rendered as a bare `[]`, the
 * only kind that did). Derived generically from whichever snapshot keys
 * differ, not enumerated per field: a review probe showed that a
 * field-by-field version (`publicChangedNote`/etc., one function per
 * named field) still reaches `notes: []` the moment a snapshot carries a
 * key none of those functions know about — reintroducing #116's own bug
 * for the next field. Diffing the snapshots' own key sets instead means
 * "an alter always has non-empty notes" holds for any key difference,
 * present or future, without touching this function again.
 */
const bucketAlterNotes = (
	previous: StorageBucketSnapshot,
	next: StorageBucketSnapshot,
): ReadonlyArray<string> =>
	changedFieldNames(
		previous as unknown as Record<string, JsonValue>,
		next as unknown as Record<string, JsonValue>,
	).map((key) => `${humanizeFieldName(key)} changed`);

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
