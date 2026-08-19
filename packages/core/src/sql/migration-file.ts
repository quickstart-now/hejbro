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

const bannerLabel = (change: KindChange): string => {
	switch (change.operation) {
		case "create":
			return "[new]";
		case "drop":
			return "[dropped]";
		case "alter":
			return `[${change.notes.join(", ")}]`;
		default:
			return assertNever(change.operation);
	}
};

const renderBannerLine = (change: KindChange): string =>
	`-- ${bannerMarker(change.operation)} ${change.kind} ${change.identity} ${bannerLabel(change)}`;

/**
 * Renders a one-line-per-change summary banner: `+` for creates, `~` for
 * alters (with notes bracketed), `-` for drops.
 */
export const renderBanner = (changes: ReadonlyArray<KindChange>): string =>
	[
		"-- hejbro migration",
		...changes.map((change) => renderBannerLine(change)),
	].join("\n");

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
