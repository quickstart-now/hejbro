import { throwHejbroError } from "../error";
import type { HejbroDeclaration } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { compareKeys } from "../sort";
import type { JsonValue } from "./stable-json";
import { stableJson } from "./stable-json";

/**
 * Snapshot format version emitted by this build of hejbro core. Bumped to
 * `2` when `ColumnSnapshot.default` changed shape from a structured
 * `ColumnDefault` object to a rendered SQL expression string (D16,
 * Phase 2 Task 10) — pre-publication, so `parseSnapshot`'s version check
 * is the entire migration story (no compatibility shim). Stays `2` for the
 * Phase 5 compact-format change (D33, Task 3 audit): declaration-default
 * fields (`ColumnSnapshot.notNull`/`primaryKey`/`unique`/`default`,
 * `IndexSnapshot.unique`, `ForeignKeySnapshot.onDelete`, `RlsSnapshot.force`,
 * `PolicySnapshot.permissive`/`using`/`withCheck`, `ViewSnapshot.
 * securityInvoker`) are now omitted rather than recorded at their default —
 * v1 hasn't shipped and there are zero real snapshot consumers yet, so this
 * is pre-publication cleanup, not a compatibility break. Once hejbro ships,
 * any further format change bumps the version. Bumped to `3` in Phase 7
 * (D51): `IndexSnapshot.columns` entries became objects (`{ name, desc?,
 * nulls? }`) and indexes gained `where`; tables gained the additive
 * `checks` field at the same time. Bumped to `4` in Phase 7 (D57): the
 * top-level version field itself was renamed `hejbroSnapshot` → `formatVersion`
 * (the D57 self/reference naming sweep reached the snapshot's own format
 * marker) — `parseSnapshot` still recognizes the old key so an old-format
 * file gets the normal "older" message instead of silently misparsing.
 * Pre-publication, no shim beyond that one detection branch.
 */
export const HEJBRO_SNAPSHOT_VERSION = 4;

/** A deterministic, flat representation of every declared database object. */
export type Snapshot = {
	readonly formatVersion: 4;
	readonly dialect: "postgres";
	/** keyed by `${kind}:${identity}` */
	readonly objects: { readonly [kindAndIdentity: string]: JsonValue };
};

/** The snapshot of an empty database: no declared objects. */
export const emptySnapshot: Snapshot = {
	formatVersion: HEJBRO_SNAPSHOT_VERSION,
	dialect: "postgres",
	objects: {},
};

type BuiltEntry = {
	readonly key: string;
	readonly node: JsonValue;
	readonly declarationIndex: number;
};

const buildEntry = (
	declaration: HejbroDeclaration,
	declarationIndex: number,
	registry: KindRegistry,
): BuiltEntry => {
	const matchingKinds = registry
		.list()
		.filter((kind) => kind.owns(declaration));
	if (matchingKinds.length === 0) {
		return throwHejbroError(
			"unowned-declaration",
			`declaration at index ${declarationIndex} (declarationKind "${declaration.declarationKind}") is not owned by any registered kind. Next: register a preset that provides a kind for "${declaration.declarationKind}" declarations in hejbro.config.ts's presets array, or remove this declaration if it isn't needed.`,
		);
	}
	if (matchingKinds.length > 1) {
		return throwHejbroError(
			"ambiguous-declaration",
			`declaration at index ${declarationIndex} (declarationKind "${declaration.declarationKind}") is owned by multiple kinds (${matchingKinds
				.map((kind) => kind.kind)
				.join(
					", ",
				)}). Next: check hejbro.config.ts's presets array for two presets that overlap, and remove one, or narrow one kind's owns() check if you're authoring it.`,
		);
	}
	const [kind] = matchingKinds;
	if (kind === undefined) {
		return throwHejbroError(
			"unowned-declaration",
			`declaration at index ${declarationIndex} matched no kind — this indicates an internal hejbro bug.`,
		);
	}
	const node = kind.serialize(declaration);
	const identity = kind.identify(node);
	return { key: `${kind.kind}:${identity}`, node, declarationIndex };
};

const findDuplicateKey = (
	entries: ReadonlyArray<BuiltEntry>,
): { readonly first: BuiltEntry; readonly second: BuiltEntry } | null => {
	const duplicate = entries.find(
		(entry, entryIndex) =>
			entries.findIndex((other) => other.key === entry.key) !== entryIndex,
	);
	if (duplicate === undefined) {
		return null;
	}
	const first = entries.find((entry) => entry.key === duplicate.key);
	if (first === undefined) {
		return throwHejbroError(
			"duplicate-identity",
			"unreachable — duplicate key had no first occurrence.",
		);
	}
	return { first, second: duplicate };
};

/**
 * Builds a {@link Snapshot} from a flat list of declarations, routing each
 * one to the registered kind whose `owns()` matches it. Throws if a
 * declaration is owned by zero or multiple kinds, or if two declarations
 * produce the same `kind:identity`.
 */
export const buildSnapshot = (
	declarations: ReadonlyArray<HejbroDeclaration>,
	registry: KindRegistry,
): Snapshot => {
	const entries = declarations.map((declaration, declarationIndex) =>
		buildEntry(declaration, declarationIndex, registry),
	);

	const duplicate = findDuplicateKey(entries);
	if (duplicate !== null) {
		return throwHejbroError(
			"duplicate-identity",
			`declarations at index ${duplicate.first.declarationIndex} and index ${duplicate.second.declarationIndex} both produce the identity "${duplicate.first.key}". Next: rename one of them.`,
		);
	}

	const sortedEntries = [...entries].sort((a, b) => compareKeys(a.key, b.key));
	const objects = Object.fromEntries(
		sortedEntries.map((entry) => [entry.key, entry.node]),
	);

	return {
		formatVersion: HEJBRO_SNAPSHOT_VERSION,
		dialect: "postgres",
		objects,
	};
};

/** Renders a {@link Snapshot} as deterministic JSON (see {@link stableJson}). */
export const renderSnapshot = (snapshot: Snapshot): string =>
	stableJson(snapshot);

type ParsedSnapshotShape = {
	readonly formatVersion?: unknown;
	/** @deprecated pre-v4 key name for {@link formatVersion} (D57) — read only to give an old-format file the normal "older" message instead of misparsing it. */
	readonly hejbroSnapshot?: unknown;
	readonly dialect?: unknown;
	readonly objects?: unknown;
};

/**
 * `JSON.parse` throws a raw `SyntaxError`, not a `HejbroError`, on
 * malformed input (e.g. an unresolved git merge-conflict marker left in
 * the file) — every other failure mode in {@link parseSnapshot} is a
 * `HejbroError`, so this normalizes that one too (found via a `hejbro
 * verify` golden test exercising exactly this scenario, Task 17).
 */
const parseJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return throwHejbroError(
			"invalid-snapshot",
			"snapshot is not valid JSON (check for corruption, an incomplete hand-edit, or an unresolved git merge-conflict marker). Next: restore the snapshot from version control if it was corrupted, or delete it and run `hejbro init` then `hejbro generate` to rebuild it from your current declarations.",
		);
	}
};

/** `snapshot version <v> is older than this build supports …` — pre-publication, no format-migration path (D51 addendum, owner-approved 2026-08-20). */
const olderVersionMessage = (version: number): string =>
	`snapshot version ${version} is older than this build supports (expects ${HEJBRO_SNAPSHOT_VERSION}) — hejbro is pre-publication and has no format-migration path yet. Next: delete the snapshot file (snapshotPath in hejbro.config.ts, hejbro.snapshot.json by default) and run \`hejbro generate\` to regenerate it from your current declarations (\`hejbro init\` recreates an empty one if needed) — your committed migration files are untouched.`;

/** `snapshot version <v> is newer than this build supports …` — most commonly generated by a newer hejbro (D51 addendum, owner-approved 2026-08-20). */
const newerVersionMessage = (version: number): string =>
	`snapshot version ${version} is newer than this build supports (expects ${HEJBRO_SNAPSHOT_VERSION}) — it was likely generated by a newer hejbro. Next: upgrade hejbro to a version that supports snapshot version ${version} and try again.`;

/**
 * Parses a rendered snapshot back into a {@link Snapshot}, validating its
 * version and shape. Three cases on the version field: (a) `formatVersion`
 * is present — compared numerically against {@link HEJBRO_SNAPSHOT_VERSION}
 * (older/newer get distinct `unsupported-snapshot-version` messages; a
 * non-numeric value is `invalid-snapshot`); (b) `formatVersion` is absent
 * but the pre-v4 key `hejbroSnapshot` is a number — that's an old-format
 * file (D57 renamed the key itself), so it gets the same "older" message,
 * carrying its own `hejbroSnapshot` value; (c) neither is a valid number —
 * `invalid-snapshot`, a malformed file.
 */
export const parseSnapshot = (raw: string): Snapshot => {
	const parsed: unknown = parseJson(raw);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return throwHejbroError(
			"invalid-snapshot",
			"snapshot is not a JSON object. Next: restore the snapshot from version control if it was corrupted, or delete it and run `hejbro init` then `hejbro generate` to rebuild it from your current declarations.",
		);
	}
	const candidate = parsed as ParsedSnapshotShape;
	if (candidate.formatVersion === undefined) {
		if (typeof candidate.hejbroSnapshot === "number") {
			return throwHejbroError(
				"unsupported-snapshot-version",
				olderVersionMessage(candidate.hejbroSnapshot),
			);
		}
		return throwHejbroError(
			"invalid-snapshot",
			`snapshot version ${JSON.stringify(candidate.hejbroSnapshot)} is not a valid version number. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
		);
	}
	if (candidate.formatVersion !== HEJBRO_SNAPSHOT_VERSION) {
		if (typeof candidate.formatVersion !== "number") {
			return throwHejbroError(
				"invalid-snapshot",
				`snapshot version ${JSON.stringify(candidate.formatVersion)} is not a valid version number. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
			);
		}
		if (candidate.formatVersion < HEJBRO_SNAPSHOT_VERSION) {
			return throwHejbroError(
				"unsupported-snapshot-version",
				olderVersionMessage(candidate.formatVersion),
			);
		}
		return throwHejbroError(
			"unsupported-snapshot-version",
			newerVersionMessage(candidate.formatVersion),
		);
	}
	if (candidate.dialect !== "postgres") {
		return throwHejbroError(
			"invalid-snapshot",
			`snapshot dialect ${JSON.stringify(candidate.dialect)} is not supported — only "postgres" is. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
		);
	}
	if (
		typeof candidate.objects !== "object" ||
		candidate.objects === null ||
		Array.isArray(candidate.objects)
	) {
		return throwHejbroError(
			"invalid-snapshot",
			`snapshot is missing a valid "objects" map. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
		);
	}
	return {
		formatVersion: HEJBRO_SNAPSHOT_VERSION,
		dialect: "postgres",
		objects: candidate.objects as Snapshot["objects"],
	};
};
