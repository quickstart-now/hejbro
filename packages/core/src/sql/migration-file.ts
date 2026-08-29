import { assertNever } from "../error";
import type { ChangeOperation, KindChange } from "../kind/object-kind";
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
