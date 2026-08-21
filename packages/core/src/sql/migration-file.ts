import { assertNever } from "../error";
import type { ChangeOperation, KindChange } from "../kind/object-kind";

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

const renderPrefix = (options: MigrationFileNameOptions): string => {
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
	`${renderPrefix(options)}_${options.slug}.sql`;

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
 * No built-in kind currently reaches this empty case — each guards its own
 * alter notes — but nothing stopped a kind from doing so (the storage
 * bucket kind did, until #116's other fix), so the banner itself now
 * closes that gap too.
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

const PARENT_SNAPSHOT_PREFIX = "-- parent-snapshot: ";
const SNAPSHOT_PREFIX = "-- snapshot: ";

/**
 * Renders a one-line-per-change summary banner: `+` for creates, `~` for
 * alters (with notes bracketed), `-` for drops. When `hashes` is given,
 * appends the two banner hash-chain lines (D33) `hejbro verify` reads back
 * via {@link parseBannerHashes}.
 */
export const renderBanner = (
	changes: ReadonlyArray<KindChange>,
	hashes?: BannerHashes,
): string => {
	const lines = [
		"-- hejbro migration",
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
