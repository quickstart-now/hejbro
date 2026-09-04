import type { RenameSpec } from "../engine/rename-plan";
import { throwHejbroError } from "../error";
import type { HejbroDeclaration, SerializeContext } from "../kind/object-kind";
import type { KindRegistry } from "../kind/registry";
import { compareKeys } from "../sort";
import { computeColumnOrder } from "./column-order";
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
 * Bumped to `5` in Phase 8 (D68): opens the format for #110(b) (structured
 * expression nodes) and #24(iii) (primary key/unique constraint names
 * recorded in the snapshot), which land in this wave's later PRs
 * (`phase8-expr-nodes`, `phase8-constraint-names`) — this PR only moves
 * the version marker itself so those PRs' shape changes don't each need
 * their own bump. Bumped to `6` for add-generated-columns (D100): a
 * column snapshot node gains optional `generated` (a stored computed
 * column's own expression, encoded like `default`) and `identity` (an
 * identity column's kind and any explicit sequence options) fields — an
 * older reader must refuse a v6 snapshot loudly (the D73 diagnostic)
 * rather than silently diffing with those two fields ignored. Still
 * pre-publication, so no shim beyond the existing detection branch above.
 * Bumped to `7` for add-relational-reads (D102 amendment): a table
 * snapshot's foreign keys are recorded in canonical,
 * declaration-form-independent order — an older reader must refuse
 * rather than mis-diff over the uncanonical order. v6 was never
 * released (0.1.1 shipped v5). Bumped to `8` for #437: a view body's
 * `SelectNode` gains `offset` and `distinct`, so a v7 reader would
 * silently diff a paginated or de-duplicated view as if it were neither.
 * Still pre-publication — 0.1.1 shipped v5 and 0.2.0 has not shipped, so
 * whatever version 0.2.0 lands on is the first one any user sees, and a
 * pre-release field addition costs nothing externally. Any further
 * pre-release `SelectNode` growth (#416's `groupBy`/`having`) should
 * extend 8 in place rather than bump again; the first addition AFTER
 * 0.2.0 ships is the one that pays the real price (#413).
 */
export const HEJBRO_SNAPSHOT_VERSION = 8;

/** A deterministic, flat representation of every declared database object. */
export type Snapshot = {
	readonly formatVersion: 8;
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
	context: SerializeContext,
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
	const rawNode = kind.serialize(declaration, context);
	// #701/D3: canonicalize before identify, so every downstream reader
	// (identify, diff, snapshot-moved, verify's check 2) sees the same
	// byte form a declaration's set-shaped arrays produce, whatever order
	// they were declared in.
	const node = kind.canonicalize?.(rawNode) ?? rawNode;
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
 *
 * `previous` is the snapshot this build succeeds — D81 derives every
 * table's physical column order from it (parent order for surviving
 * columns, declaration order for newcomers) and hands that oracle to every
 * kind's `serialize` as {@link SerializeContext}. Pass {@link emptySnapshot}
 * for a first build. `renames` is the same `--rename` plan `generate`
 * already validates; it retargets the oracle's parent lookup so a renamed
 * column/table keeps its position.
 */
export const buildSnapshot = (
	declarations: ReadonlyArray<HejbroDeclaration>,
	registry: KindRegistry,
	previous: Snapshot,
	renames: ReadonlyArray<RenameSpec> = [],
): Snapshot => {
	const context: SerializeContext = {
		columnOrder: computeColumnOrder(declarations, previous, renames),
	};
	const entries = declarations.map((declaration, declarationIndex) =>
		buildEntry(declaration, declarationIndex, registry, context),
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

/**
 * Rewrites every object in `snapshot.objects` through its own kind's
 * `canonicalize` (#701, D3) — so a set-shaped array reaching this from any
 * source (a hand-written previous, a snapshot on disk written before the
 * canonical order existed, or one `buildSnapshot` already canonicalized)
 * compares equal to the same declarations' canonical form. Pure: never
 * writes the file, never mutates `snapshot`. A key with no `kind:identity`
 * separator, or naming a kind `registry` doesn't have registered, passes
 * through unchanged here — `diffSnapshots`'s own per-key resolution
 * (`engine/diff-engine.ts`) is what reports either shape as a real error,
 * not this pure rewrite.
 */
export const canonicalizeSnapshot = (
	snapshot: Snapshot,
	registry: KindRegistry,
): Snapshot => ({
	...snapshot,
	objects: Object.fromEntries(
		Object.entries(snapshot.objects).map(([key, node]) => {
			const kindName = kindOfObjectKey(key);
			if (kindName === null) {
				return [key, node];
			}
			const kind = registry
				.list()
				.find((candidate) => candidate.kind === kindName);
			if (kind === undefined) {
				return [key, node];
			}
			return [key, kind.canonicalize?.(node) ?? node];
		}),
	),
});

/** A short, human-readable name for why an `objects` entry isn't a valid
 * snapshot node (#26) — every real node is a JSON object, so `null`, an
 * array, or a JSON primitive all indicate a corrupted or hand-edited
 * entry rather than one hejbro itself ever wrote. */
const describeMalformedValue = (value: JsonValue): string => {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "an array";
	}
	return `a ${typeof value}`;
};

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

/**
 * `snapshot version <v> is older than this build supports …` — pre-1.0, no
 * format-migration path. Owner-approved verbatim (2026-08-21, #136,
 * phase8-snapshot-v5), superseding the original D51 addendum text
 * (owner-approved 2026-08-20).
 *
 * The previous text told the reader to delete the snapshot and regenerate,
 * which does not work: with prior migrations present, `hejbro generate`
 * refuses (`snapshot-lost`); routing around that via `hejbro init` first
 * produces a chain `hejbro verify` then rejects (`chain-tip-mismatch` or
 * `diverged-migrations`, depending on whether `generate` ran before
 * `verify`) — and *that* diagnostic's own advice ("restore the snapshot
 * from version control") leads straight back to this same older-version
 * error, a closed loop with no exit. Both dead ends and the loop were
 * confirmed by direct reproduction, not code-reading (see PR #136's
 * body). The text below states plainly that there is no automatic path
 * and that the snapshot/migrations pair can only be reset together.
 */
const olderVersionMessage = (version: number): string =>
	`snapshot version ${version} is older than this build supports (expects ${HEJBRO_SNAPSHOT_VERSION}) — hejbro is pre-1.0 and has no format-migration path yet. The snapshot and the migrations directory are a matched pair (their hashes chain together); regenerating one without the other breaks that chain. Next: if you have committed migrations, keep this snapshot as-is and pin hejbro to the version that wrote it (check your lockfile) until you're ready to reset. Deleting just this snapshot doesn't work: with prior migrations present, \`hejbro generate\` refuses to run (error[snapshot-lost]); working around that with \`hejbro init\` produces a chain \`hejbro verify\` then rejects (error[chain-tip-mismatch] or error[diverged-migrations], depending on whether you ran \`generate\` before \`verify\`). To deliberately adopt the new format, reset both together — delete the migrations directory and this snapshot, then run \`hejbro init\` and \`hejbro generate\` — and only do this if you can also recreate the database, since the regenerated chain starts from empty with no relationship to what's already applied.`;

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
 *
 * **Does not check that every `objects` entry's kind id is registered**
 * (that is `unknown-kind`, thrown later by {@link KindRegistry.get} —
 * `packages/core/src/kind/registry.ts` — the first time diffing actually
 * needs that kind). Checking it here, so a stale build fails at parse
 * time instead of mid-diff, was considered for #196/D73 and set aside:
 * this function takes no {@link KindRegistry}, and every real call site
 * builds its registry *after* parsing, not before — `packages/cli`'s
 * `generate.ts` calls `parseSnapshot` at line 361 and `buildRegistry` at
 * line 362; `verify.ts` calls `parseSnapshot` at lines 132/147, well
 * before its own `buildRegistry` call at line 270. Moving the check here
 * needs both a widened signature (an added parameter is non-breaking on
 * its own) *and* reordering three call sites across two CLI files to
 * build the registry first — a bigger, cross-package change than this
 * function's own format/shape validation, and out of this PR's scope.
 */
/** {@link parseSnapshot}'s first check: the parsed JSON is a plain object, not an array/`null`/primitive — narrows `unknown` to {@link ParsedSnapshotShape} (a cast, not yet shape-validated beyond that) or throws. */
const validateSnapshotIsObject = (parsed: unknown): ParsedSnapshotShape => {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return throwHejbroError(
			"invalid-snapshot",
			"snapshot is not a JSON object. Next: restore the snapshot from version control if it was corrupted, or delete it and run `hejbro init` then `hejbro generate` to rebuild it from your current declarations.",
		);
	}
	return parsed as ParsedSnapshotShape;
};

/**
 * {@link validateFormatVersion}'s `formatVersion === undefined` half — a
 * pre-D33 snapshot's legacy `hejbroSnapshot` number field, or a genuinely
 * malformed one. Split out to keep both halves' own complexity under
 * threshold (D71/#154 ratchet-5) rather than one function whose own
 * complexity the whole cascade dominates.
 */
const validateMissingFormatVersion = (candidate: ParsedSnapshotShape): void => {
	if (typeof candidate.hejbroSnapshot === "number") {
		throwHejbroError(
			"unsupported-snapshot-version",
			olderVersionMessage(candidate.hejbroSnapshot),
		);
	}
	throwHejbroError(
		"invalid-snapshot",
		`snapshot version ${JSON.stringify(candidate.hejbroSnapshot)} is not a valid version number. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
	);
};

/** {@link validateFormatVersion}'s `formatVersion !== undefined` half — matches current, malformed, older, or newer. See {@link validateMissingFormatVersion}. */
const validatePresentFormatVersion = (formatVersion: unknown): void => {
	if (formatVersion === HEJBRO_SNAPSHOT_VERSION) {
		return;
	}
	if (typeof formatVersion !== "number") {
		throwHejbroError(
			"invalid-snapshot",
			`snapshot version ${JSON.stringify(formatVersion)} is not a valid version number. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
		);
		return;
	}
	if (formatVersion < HEJBRO_SNAPSHOT_VERSION) {
		throwHejbroError(
			"unsupported-snapshot-version",
			olderVersionMessage(formatVersion),
		);
		return;
	}
	throwHejbroError(
		"unsupported-snapshot-version",
		newerVersionMessage(formatVersion),
	);
};

/**
 * {@link parseSnapshot}'s version check (see that function's own doc
 * comment for the three cases this covers) — the whole cascade lives
 * here so `parseSnapshot` itself stays a flat sequence of validator
 * calls, not a function whose own complexity this cascade dominates.
 */
const validateFormatVersion = (candidate: ParsedSnapshotShape): void => {
	if (candidate.formatVersion === undefined) {
		validateMissingFormatVersion(candidate);
		return;
	}
	validatePresentFormatVersion(candidate.formatVersion);
};

/** {@link parseSnapshot}'s dialect check — only `"postgres"` is supported. */
const validateDialect = (candidate: ParsedSnapshotShape): void => {
	if (candidate.dialect !== "postgres") {
		throwHejbroError(
			"invalid-snapshot",
			`snapshot dialect ${JSON.stringify(candidate.dialect)} is not supported — only "postgres" is. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
		);
	}
};

/** {@link parseSnapshot}'s `"objects"` shape check — narrows to {@link Snapshot}'s own `objects` type or throws. */
const validateObjectsShape = (
	candidate: ParsedSnapshotShape,
): Snapshot["objects"] => {
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
	return candidate.objects as Snapshot["objects"];
};

/** {@link parseSnapshot}'s per-entry check: every value in the `objects` map must itself be a plain object (the kind's own serialized snapshot node). */
const validateObjectEntries = (objects: Snapshot["objects"]): void => {
	const malformedEntry = Object.entries(objects).find(
		([, value]) =>
			typeof value !== "object" || value === null || Array.isArray(value),
	);
	if (malformedEntry === undefined) {
		return;
	}
	const [key, value] = malformedEntry;
	throwHejbroError(
		"invalid-snapshot",
		`snapshot entry "${key}" is ${describeMalformedValue(value)}, not an object. Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
	);
};

/** The `kind` half of a `"kind:identity"` object key, or `null` for a key with no `:` separator — a malformed key like that is {@link validateObjectEntries}'s sibling check `invalid-snapshot-key` (`engine/diff-engine.ts`) to catch, once diffing actually reaches it; this function's own job is narrower (which kind's `requiredKeys` apply, if any), so it stays silent on a shape it isn't the one responsible for reporting. */
const kindOfObjectKey = (key: string): string | null => {
	const colonIndex = key.indexOf(":");
	if (colonIndex === -1) {
		return null;
	}
	return key.slice(0, colonIndex);
};

/** The first `requiredKeys` entry missing from `node` (in declaration order), or `null` if every one is present. */
const firstMissingRequiredKey = (
	node: JsonValue,
	requiredKeys: ReadonlyArray<string>,
): string | null => {
	const record = node as Record<string, unknown>;
	const missing = requiredKeys.find((key) => record[key] === undefined);
	return missing ?? null;
};

type RequiredKeyGap = {
	readonly key: string;
	readonly kind: string;
	readonly missingKey: string;
};

/**
 * The required-key gap `[key, node]` reports, or `null` when it's fine:
 * `key` doesn't parse as `"kind:identity"`, its kind has no
 * `requiredKeys` of its own, or every required key is present. Split out
 * of {@link validateRequiredKeys} (D71/#154 ratchet-5) so this shape's
 * own three questions don't fold into that function's complexity.
 */
const requiredKeyGapFor = (
	key: string,
	node: JsonValue,
	requiredKeysByKind: ReadonlyMap<string, ReadonlyArray<string>>,
): RequiredKeyGap | null => {
	const kind = kindOfObjectKey(key);
	if (kind === null) {
		return null;
	}
	const requiredKeys = requiredKeysByKind.get(kind);
	if (requiredKeys === undefined) {
		return null;
	}
	const missingKey = firstMissingRequiredKey(node, requiredKeys);
	if (missingKey === null) {
		return null;
	}
	return { key, kind, missingKey };
};

/**
 * {@link parseSnapshot}'s optional per-kind required-key check (D79,
 * #159) — every kind's own `ObjectKind.requiredKeys`, looked up by this
 * entry's kind name in `requiredKeysByKind` ({@link requiredKeysByKind}
 * builds this from a real `KindRegistry`). Skipped entirely when
 * `requiredKeysByKind` is omitted (today's default for every existing
 * 1-argument call site, unaffected) or when a given entry's kind has no
 * `requiredKeys` of its own (every kind predating this field). Reports
 * the first missing key by name, before `identify`/`diff`/`emit` ever
 * run and crash on the `undefined` field instead.
 */
const validateRequiredKeys = (
	objects: Snapshot["objects"],
	requiredKeysByKind: ReadonlyMap<string, ReadonlyArray<string>> | undefined,
): void => {
	if (requiredKeysByKind === undefined) {
		return;
	}
	const gap = Object.entries(objects)
		.map(([key, node]) => requiredKeyGapFor(key, node, requiredKeysByKind))
		.find((candidate) => candidate !== null);
	if (gap === undefined || gap === null) {
		return;
	}
	throwHejbroError(
		"invalid-snapshot",
		`snapshot entry "${gap.key}" (kind "${gap.kind}") is missing required key "${gap.missingKey}". Next: restore the snapshot from version control if it was corrupted, or delete it and run \`hejbro init\` then \`hejbro generate\` to rebuild it from your current declarations.`,
	);
};

/**
 * Parses a rendered snapshot back into a {@link Snapshot}. `requiredKeysByKind`
 * (D79, #159) is optional and additive: pass {@link requiredKeysByKind}'s
 * own output (built from a real `KindRegistry`) to also check each
 * entry's kind-specific required keys; omit it to keep this function's
 * pre-#159 behavior exactly. Deliberately a plain map, not a
 * `KindRegistry` itself — see {@link requiredKeysByKind}'s own doc
 * comment for why.
 */
export const parseSnapshot = (
	raw: string,
	requiredKeysByKind?: ReadonlyMap<string, ReadonlyArray<string>>,
): Snapshot => {
	const parsed: unknown = parseJson(raw);
	const candidate = validateSnapshotIsObject(parsed);
	validateFormatVersion(candidate);
	validateDialect(candidate);
	const objects = validateObjectsShape(candidate);
	validateObjectEntries(objects);
	validateRequiredKeys(objects, requiredKeysByKind);
	return {
		formatVersion: HEJBRO_SNAPSHOT_VERSION,
		dialect: "postgres",
		objects,
	};
};
