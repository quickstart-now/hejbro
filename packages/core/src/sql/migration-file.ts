import { assertNever, throwHejbroError } from "../error";
import { sameJson } from "../kind/diff-helpers";
import type { ChangeOperation, KindChange } from "../kind/object-kind";
import type { TableSnapshot } from "../kinds/table-snapshot";
import { asTableSnapshot, tableExisting } from "../kinds/table-snapshot";
import type { Snapshot } from "../snapshot/snapshot";
import type { JsonValue } from "../snapshot/stable-json";
import { compareKeys } from "../sort";

/** The supported migration filename prefix strategies (D14). */
export const migrationPrefixStrategies = [
	"timestamp",
	"index",
	"unix",
] as const;

/** @see migrationPrefixStrategies */
export type MigrationPrefixStrategy =
	(typeof migrationPrefixStrategies)[number];

const padTwoDigits = (value: number): string => String(value).padStart(2, "0");

const formatUtcTimestamp = (date: Date): string =>
	`${date.getUTCFullYear()}${padTwoDigits(date.getUTCMonth() + 1)}${padTwoDigits(date.getUTCDate())}${padTwoDigits(
		date.getUTCHours(),
	)}${padTwoDigits(date.getUTCMinutes())}${padTwoDigits(date.getUTCSeconds())}`;

type MigrationFileNameOptions = {
	readonly strategy: MigrationPrefixStrategy;
	readonly generatedAt: Date;
	readonly previousCount: number;
	readonly slug: string;
};

/** @see migrationFileName — exported (not just `migrationFileName`-internal) so a caller building a *suggested* filename (verify's `duplicate-migration-version` diagnostic, #220) can render just the prefix half, keeping the original file's own slug. */
export const renderMigrationPrefix = (
	options: MigrationFileNameOptions,
): string => {
	switch (options.strategy) {
		case "timestamp":
			return formatUtcTimestamp(options.generatedAt);
		case "index":
			return String(options.previousCount + 1).padStart(4, "0");
		case "unix":
			return String(Math.floor(options.generatedAt.getTime() / 1000));
		default:
			return assertNever(options.strategy);
	}
};

/**
 * Renders a migration filename: `<prefix>_<slug>.sql`. The clock
 * (`generatedAt`) and the count of prior migrations (`previousCount`) are
 * injected by the caller — core never calls `Date.now()` or reads the
 * filesystem.
 */
export const migrationFileName = (options: MigrationFileNameOptions): string =>
	`${renderMigrationPrefix(options)}_${options.slug}.sql`;

/** The substring of `fileName` before its first `_`, or `null` if that substring isn't a plain non-negative integer — every `migrationFileName` strategy renders one; a hand-written legacy file with a non-numeric prefix is `null` and drops out of the comparison rather than crashing it. */
export const migrationVersionOf = (fileName: string): string | null => {
	const version = fileName.split("_", 1)[0] ?? "";
	if (!/^\d+$/.test(version)) {
		return null;
	}
	return version;
};

/** One group of 2+ migration files that all render the exact same version prefix — Supabase (and any tool that tracks *applied* migrations by this prefix, not by full filename) can only ever apply one of them; the rest silently never run. */
export type DuplicateVersionGroup = {
	readonly version: string;
	readonly fileNames: ReadonlyArray<string>;
};

/**
 * Groups `fileNames` by their version prefix (`migrationVersionOf`),
 * keeping only groups with 2 or more members — the collision
 * `hejbro verify`'s `duplicate-migration-version` check reports (#220).
 * Deterministically ordered: groups sorted by version, each group's
 * `fileNames` sorted by name. Files with no version at all (a legacy,
 * hand-written prefix) never collide with anything here, matching
 * `checkChain`'s own "caller filters what it can't classify" contract.
 *
 * Pure and strategy-agnostic on purpose: `index`-strategy prefixes can't
 * collide by construction (`previousCount + 1`, always the very next
 * integer no other file has claimed), so this never fires for them in
 * practice — but the check itself doesn't need to know which strategy a
 * project uses to say "these two files claim the same version."
 */
export const findDuplicateVersionGroups = (
	fileNames: ReadonlyArray<string>,
): ReadonlyArray<DuplicateVersionGroup> => {
	const byVersion = fileNames.reduce((acc, fileName) => {
		const version = migrationVersionOf(fileName);
		if (version === null) {
			return acc;
		}
		const existing = acc.get(version) ?? [];
		return acc.set(version, [...existing, fileName]);
	}, new Map<string, ReadonlyArray<string>>());
	return Array.from(byVersion.entries())
		.filter(([, names]) => names.length > 1)
		.map(([version, names]) => ({
			version,
			fileNames: [...names].sort(compareKeys),
		}))
		.sort((a, b) => compareKeys(a.version, b.version));
};

const bannerMarker = (operation: ChangeOperation): string => {
	switch (operation) {
		case "create":
			return "+";
		case "alter":
			return "~";
		case "drop":
			return "-";
		default:
			return assertNever(operation);
	}
};

/** `[dropped]`, or `[dropped: <notes>]` when `notes` is non-empty (D42 — e.g. the storage bucket kind's manual-deletion guidance) — joined exactly like the `alter` label, via `notes.join(", ")`. */
const dropLabel = (notes: ReadonlyArray<string>): string => {
	if (notes.length === 0) {
		return "[dropped]";
	}
	return `[dropped: ${notes.join(", ")}]`;
};

/**
 * `[<notes>]` when `notes` is non-empty, else `""` (#116) — unlike
 * {@link dropLabel}, whose empty case still says something (`[dropped]`,
 * since "dropped" is itself the note), an alter has no such fallback word:
 * a kind whose alter notes are empty means the caller has nothing to
 * report, so the bracket is omitted entirely rather than rendered empty.
 * This isn't a hypothetical gap: the storage bucket kind did reach it —
 * see `examples/supabase`'s `migrations/0002_alter_attachments.sql`
 * before #116, which committed a `-- ~ supabase-storage-bucket
 * attachments []` banner line. #116 also fixed the storage bucket kind's
 * own notes derivation to read from the snapshot's own changed keys
 * instead of a per-field list, so it always populates notes for any
 * field, current or future, without relying on that kind's author
 * remembering to update a list. Nothing in the type system enforces that
 * discipline for every kind, though (a differently-written kind could
 * still hand-list its fields and miss one), so the banner guards the
 * empty case independently of any one kind's implementation choice.
 */
const alterLabel = (notes: ReadonlyArray<string>): string => {
	if (notes.length === 0) {
		return "";
	}
	return `[${notes.join(", ")}]`;
};

const bannerLabel = (change: KindChange): string => {
	switch (change.operation) {
		case "create":
			return "[new]";
		case "drop":
			return dropLabel(change.notes);
		case "alter":
			return alterLabel(change.notes);
		default:
			return assertNever(change.operation);
	}
};

const renderBannerLine = (change: KindChange): string => {
	const head = `-- ${bannerMarker(change.operation)} ${change.kind} ${change.identity}`;
	const label = bannerLabel(change);
	if (label === "") {
		return head;
	}
	return `${head} ${label}`;
};

/** The banner's tamper-evident hash-chain lines (decision D33, Phase 5): the normalized-snapshot sha256 before and after this migration, opaque `"sha256:<hex>"` strings computed by the CLI (core never hashes). */
export type BannerHashes = {
	readonly parent: string;
	readonly current: string;
};

/** The machine-readable half of the baseline marker -- everything up to and including the colon. {@link parseBannerBaseline} matches on this alone, never the full {@link BASELINE_LINE}: the guidance prose after the colon is for humans and may reword, and a parser keyed to the whole sentence would silently start reporting `false` for every already-written migration the moment that prose changed -- exactly backwards for a marker whose only job is telling an apply tool not to run a migration. */
const BASELINE_PREFIX = "-- baseline:";
const BASELINE_LINE = `${BASELINE_PREFIX} these objects already exist — register this migration as applied, do not run it`;
const PARENT_SNAPSHOT_PREFIX = "-- parent-snapshot: ";
const SNAPSHOT_PREFIX = "-- snapshot: ";
const VERSION_PREFIX = "-- hejbro: ";

/**
 * Renders a one-line-per-change summary banner: `+` for creates, `~` for
 * alters (with notes bracketed), `-` for drops. When `version` is given,
 * inserts the `-- hejbro: <version>` line (#229) directly below the
 * `-- hejbro migration` line — the CLI reads its own `package.json` for
 * this string; core never does. When `hashes` is given, appends the two
 * banner hash-chain lines (D33) `hejbro verify` reads back via
 * {@link parseBannerHashes}.
 */
const versionLines = (version: string | undefined): ReadonlyArray<string> => {
	if (version === undefined) {
		return [];
	}
	return [`${VERSION_PREFIX}${version}`];
};

/** The `-- baseline:` line, when this migration describes objects a brownfield database already has (#385). One line, directly under the version line, so it is the first thing anyone reading the file sees. */
const baselineLines = (
	baseline: boolean | undefined,
): ReadonlyArray<string> => {
	if (baseline !== true) {
		return [];
	}
	return [BASELINE_LINE];
};

export const renderBanner = (
	changes: ReadonlyArray<KindChange>,
	hashes?: BannerHashes,
	version?: string,
	baseline?: boolean,
): string => {
	const lines = [
		"-- hejbro migration",
		...versionLines(version),
		...baselineLines(baseline),
		...changes.map((change) => renderBannerLine(change)),
	];
	if (hashes === undefined) {
		return lines.join("\n");
	}
	return [
		...lines,
		`${PARENT_SNAPSHOT_PREFIX}${hashes.parent}`,
		`${SNAPSHOT_PREFIX}${hashes.current}`,
	].join("\n");
};

/**
 * Parses a migration file's `parent-snapshot:`/`snapshot:` banner lines
 * (pure text parsing — the sha256 hashing itself is CLI-owned). Returns
 * `null` when either line is missing, e.g. a pre-Phase-5 migration file
 * with no hash chain.
 */
export const parseBannerHashes = (fileContent: string): BannerHashes | null => {
	const lines = fileContent.split("\n");
	const parentLine = lines.find((line) =>
		line.startsWith(PARENT_SNAPSHOT_PREFIX),
	);
	const currentLine = lines.find((line) => line.startsWith(SNAPSHOT_PREFIX));
	if (parentLine === undefined || currentLine === undefined) {
		return null;
	}
	return {
		parent: parentLine.slice(PARENT_SNAPSHOT_PREFIX.length),
		current: currentLine.slice(SNAPSHOT_PREFIX.length),
	};
};

/**
 * Reads a migration file's `-- hejbro: <version>` line (#229), or `null`
 * when the line is absent — every pre-#229 migration file, and the only
 * signal that lets `hejbro restore`'s `restore-state-mismatch` diagnostic
 * name the exact hejbro version a migration was generated with. Unknown
 * banner lines are otherwise ignored by every parser here (each one
 * scans for its own known prefix only), so an older hejbro reading a
 * newer file with this line stays unaffected.
 */
export const parseBannerVersion = (fileContent: string): string | null => {
	const versionLine = fileContent
		.split("\n")
		.find((line) => line.startsWith(VERSION_PREFIX));
	if (versionLine === undefined) {
		return null;
	}
	return versionLine.slice(VERSION_PREFIX.length);
};

/**
 * Reads a migration file's `-- baseline:` marker (#385, #445/R5): `true`
 * when present, `false` otherwise — the only consumer is an apply tool
 * deciding whether to run a migration or register it as already applied,
 * so absence is a meaningful answer, not a missing value (`T | null`, the
 * shape {@link parseBannerHashes}/{@link parseBannerVersion} use, would be
 * wrong here: there is no third state). Reads by {@link BASELINE_PREFIX}
 * only, never the full {@link BASELINE_LINE} — see that constant's own
 * comment for why matching the human-facing prose too would be wrong.
 * Unrelated banner lines are never mistaken for it, and an older hejbro
 * reading a newer file's other unknown lines stays unaffected.
 */
export const parseBannerBaseline = (fileContent: string): boolean =>
	fileContent.split("\n").some((line) => line.startsWith(BASELINE_PREFIX));

const changeVerb = (operation: ChangeOperation): string => {
	switch (operation) {
		case "create":
			return "add";
		case "alter":
			return "alter";
		case "drop":
			return "drop";
		default:
			return assertNever(operation);
	}
};

const lastIdentitySegment = (identity: string): string => {
	const dotIndex = identity.lastIndexOf(".");
	if (dotIndex === -1) {
		return identity;
	}
	return identity.slice(dotIndex + 1);
};

/**
 * Derives a migration slug from its first change: `add_posts`,
 * `alter_posts`, `drop_posts`. Falls back to `"migration"` when there are
 * no changes. Kept here (not in `generate.ts`) for reuse by Phase 5's CLI.
 */
export const deriveSlug = (changes: ReadonlyArray<KindChange>): string => {
	const [firstChange] = changes;
	if (firstChange === undefined) {
		return "migration";
	}
	return `${changeVerb(firstChange.operation)}_${lastIdentitySegment(firstChange.identity)}`;
};

const TABLE_KEY_PREFIX = "table:";

/**
 * D106 R3/R4 (J13, R4-B1): the five ways a no-DDL, snapshot-changed run
 * can move (identity unchanged — a rename produces two separate
 * identities, each its own appear/disappear, not a sixth case). Of the
 * nine `previous:next` side pairings `sideOf` can produce, four are
 * unreachable here BY CONSTRUCTION, not by omission: `absent:absent` is
 * no movement at all; `absent:managed`/`managed:absent`/`managed:managed`
 * (when the two sides' content actually differs) are exactly the cases
 * `tableKind.diff` (`kinds/table-kind.ts`) still emits a real
 * `KindChange` for, so a run reaching this function (`hasChanges: false`)
 * can never carry one. The fifth reachable case, `existing:existing`,
 * is a transition only when the two sides' JSON differs (`sideOf` alone
 * can't see that — most `existing:existing` pairs are simply unchanged,
 * some other key is the run's real mover); see `reshapedOrNull`.
 */
const existingTransitionVerbs: Record<
	"appeared" | "disappeared" | "released" | "adopted" | "reshaped",
	string
> = {
	appeared: "record",
	disappeared: "forget",
	// A managed table handed to the platform "releases" it; the reverse
	// "adopts" one -- both words this same change's own delta/skill prose
	// already uses for these two directions ("hands the table to the
	// platform", "adopts it"), so the slug names the same transition a
	// reader already has words for, not a new pair invented for this.
	released: "release",
	adopted: "adopt",
	// D106 R4, R4-B1: both sides are already existing declarations, but
	// the declared *shape* itself moved (a column added/renamed/retyped).
	// "Shape" is this requirement's own word for what an existing
	// declaration is declared for (its title: "An existing table is
	// declared for its shape"), so the slug uses the matching verb rather
	// than inventing one.
	reshaped: "reshape",
};

/** `asTableSnapshot`, guarding the one input it doesn't accept (a key absent from this snapshot) -- the guard clause `sideOf`'s own call site would otherwise need as a ternary. */
const asTableSnapshotOrUndefined = (
	node: JsonValue | undefined,
): TableSnapshot | undefined => {
	if (node === undefined) {
		return undefined;
	}
	return asTableSnapshot(node);
};

type ExistingSide = "absent" | "existing" | "managed";

/** Which of the three states one side of a `table:` key is in -- absent from that snapshot entirely, present and marked existing, or present and managed. */
const sideOf = (node: TableSnapshot | undefined): ExistingSide => {
	if (node === undefined) {
		return "absent";
	}
	if (tableExisting(node)) {
		return "existing";
	}
	return "managed";
};

/**
 * Table-driven, not a branch per transition (#154's own CRAP ratchet: a
 * sequential if-chain over four independently-computed booleans measured
 * complexity 13, nowhere near the CRAP <= 5 budget even at full coverage
 * -- `sideOf` narrows each side to one of three states first, so this is
 * a single lookup over the 9 possible `previous:next` pairings). Four of
 * the five reachable transitions resolve by side-category alone; the
 * fifth (`existing:existing`, D106 R4) needs the two sides' own content
 * too, so it isn't in this table at all -- `classifyExistingTransition`
 * falls through to `reshapedOrNull` for it, keeping this table's own
 * lookup (and its complexity) unchanged from R3.
 */
const existingTransitionsBySideChange: Readonly<
	Record<string, keyof typeof existingTransitionVerbs>
> = {
	"absent:existing": "appeared",
	"existing:absent": "disappeared",
	"managed:existing": "released",
	"existing:managed": "adopted",
};

/**
 * D106 R4, R4-B1: `existing:existing` is a transition only when the two
 * sides' own JSON differs -- unlike the other four, `sideOf` alone can't
 * tell a reshaped table from an unmoved one (most `existing:existing`
 * pairs reaching here are unmoved; some other `table:` key is the run's
 * real mover, and `deriveExistingTransitionSlug`'s scan keeps looking
 * past a `null`). Split out rather than folded into
 * `classifyExistingTransition` itself so neither function's own
 * complexity risks the CRAP-13 mistake `sideOf` was already extracted to
 * avoid (#154).
 */
const reshapedOrNull = (
	previousNode: TableSnapshot,
	nextNode: TableSnapshot,
): "reshaped" | null => {
	if (sameJson(previousNode as JsonValue, nextNode as JsonValue)) {
		return null;
	}
	return "reshaped";
};

const classifyExistingTransition = (
	previousNode: TableSnapshot | undefined,
	nextNode: TableSnapshot | undefined,
): keyof typeof existingTransitionVerbs | null => {
	const sideChange = `${sideOf(previousNode)}:${sideOf(nextNode)}`;
	const knownTransition = existingTransitionsBySideChange[sideChange];
	if (knownTransition !== undefined) {
		return knownTransition;
	}
	if (sideChange !== "existing:existing") {
		return null;
	}
	// Internal invariant: `sideOf` returns `"existing"` only for a
	// defined, existing-marked node (its own definition above) -- both
	// sides are guaranteed present on this path, the same cast
	// `asTableSnapshot` itself already makes from a known-shaped
	// `JsonValue`.
	return reshapedOrNull(
		previousNode as TableSnapshot,
		nextNode as TableSnapshot,
	);
};

/**
 * Derives a migration slug for a run whose only movement is one or more
 * tables' own existing marker, declared shape, or (D106 R3/R4/R5,
 * J13/R4-B1/R5-B1) plain declared *record* -- `deriveSlug` cannot see
 * this run at all, by construction: none of those ever produce a
 * `KindChange`, so `changes` is always `[]` here, and `deriveSlug([])`
 * falls back to the generic `"migration"` the lead ruled out for this
 * case. Mirrors `deriveSlug`'s own shape exactly (verb + `_` + the
 * identity's last dot-segment, first difference only, no third part)
 * rather than inventing a new one, in two tiers:
 *
 * 1. `classifyExistingTransition` names the five existing-marker/shape
 *    transitions (`record`/`forget`/`release`/`adopt`/`reshape`).
 * 2. **`restate` (D106 R5, R5-B1, J17)**: when tier 1 finds nothing, the
 *    same scan runs again comparing each `table:` key's raw content
 *    (`rawContentDiffers`, no side-category lookup) -- any table whose
 *    own record changed at all, for a reason tier 1 doesn't name (an
 *    ordinary managed table's `indexes`/`checks` reordering, R5-B1's
 *    own repro; or any other cause), is `restate_<table>`, deliberately
 *    naming the fact a table's record moved without claiming *why* --
 *    `reorder` was considered and rejected precisely because it would
 *    be wrong the moment tier 2 is reached for a reason that isn't
 *    reordering, repeating this same requirement's own R4 mistake (a
 *    verb whose truth was narrower than its coverage) one layer up.
 *
 * "First difference" is made deterministic the same way `stableJson`
 * is in both tiers: both snapshots' `table:`-prefixed keys, unioned and
 * sorted with `compareKeys` (plain string order, matching every other
 * deterministic-output guarantee in this codebase) -- exactly
 * `deriveSlug`'s own "first change in the array" rule, applied to a
 * deterministically-ordered set instead of an array a caller already
 * built in one order. Never falls through to a generic default: a
 * caller only reaches this function when the two snapshots are already
 * known to differ (`R3-B1`'s own `snapshotChanged` gate) with no
 * `KindChange` at all, and tier 2 is total over every remaining
 * `table:`-domain movement (the exhaustive sweep the R5-B1 finding
 * demanded: of the nine `previous:next` side pairings a `table:` key
 * can be in, four are unreachable here by construction -- they'd have
 * produced a real `KindChange` instead -- and the fifth,
 * `existing:existing`, is `reshape` or unmoved; tier 2 catches every
 * remaining shape a table's own JSON node can differ in). So a run that
 * reaches the final throw has NO `table:` key whose raw content differs
 * at all -- the movement is outside the table domain entirely, a
 * genuine bug, not a state to default through -- reported as a coded
 * `HejbroError`, not a raw `Error` (D106 R4, R4-B1), so it reaches the
 * user as a diagnostic with a `Next:` step rather than an unhandled
 * stack trace.
 */
/** D106 R5, R5-B1: tier 2's own per-key test -- any raw content difference at all, independent of `sideOf`/side-category (an appear/disappear would already be `true` here too, but tier 1 always names those first, so tier 2 only ever supplies the naming for a case tier 1's five verbs don't cover). */
const rawContentDiffers = (
	previousRaw: JsonValue | undefined,
	nextRaw: JsonValue | undefined,
): boolean => {
	if (previousRaw === undefined || nextRaw === undefined) {
		return true;
	}
	return !sameJson(previousRaw, nextRaw);
};

export const deriveExistingTransitionSlug = (
	previous: Snapshot,
	next: Snapshot,
): string => {
	const keys = Array.from(
		new Set([
			...Object.keys(previous.objects).filter((key) =>
				key.startsWith(TABLE_KEY_PREFIX),
			),
			...Object.keys(next.objects).filter((key) =>
				key.startsWith(TABLE_KEY_PREFIX),
			),
		]),
	).sort(compareKeys);
	const transition = keys
		.map((key) => ({
			key,
			kind: classifyExistingTransition(
				asTableSnapshotOrUndefined(previous.objects[key]),
				asTableSnapshotOrUndefined(next.objects[key]),
			),
		}))
		.find(
			(
				entry,
			): entry is { key: string; kind: NonNullable<(typeof entry)["kind"]> } =>
				entry.kind !== null,
		);
	if (transition !== undefined) {
		const identity = transition.key.slice(TABLE_KEY_PREFIX.length);
		return `${existingTransitionVerbs[transition.kind]}_${lastIdentitySegment(identity)}`;
	}
	const restated = keys.find((key) =>
		rawContentDiffers(previous.objects[key], next.objects[key]),
	);
	if (restated !== undefined) {
		const identity = restated.slice(TABLE_KEY_PREFIX.length);
		return `restate_${lastIdentitySegment(identity)}`;
	}
	return throwHejbroError(
		"existing-transition-not-found",
		`hejbro found a snapshot that changed with nothing to write, but no table's own record explains why -- internal invariant violated. Next: this is a hejbro bug -- file an issue with the declarations that produced it; \`hejbro verify\` can confirm whether your existing snapshot and migration chain still agree in the meantime.`,
	);
};
