import type {
	DuplicateVersionGroup,
	MigrationPrefixStrategy,
} from "../sql/migration-file";
import {
	migrationVersionOf,
	renderMigrationPrefix,
} from "../sql/migration-file";
import type { ChainEntry } from "./chain";

/** One rename `hejbro verify --fix` will perform for a resolvable duplicate-migration-version group (#220): `fileName` keeps its content untouched, only its version prefix (and therefore the whole filename) changes to `newFileName`. */
export type DuplicateVersionRename = {
	readonly fileName: string;
	readonly newFileName: string;
};

/** `planDuplicateVersionFix`'s output: the group's own chain order decided which member(s) are "later" and therefore need renaming — the earliest member is never renamed, so this is empty only for a 2-member group where `orderGroupByChain` still returns `null` (never actually reachable: a `DuplicateVersionGroup` always has 2+ members, so a resolvable order always yields at least one rename). */
export type DuplicateVersionFixPlan = ReadonlyArray<DuplicateVersionRename>;

/** `true` when nothing else in `entries` claims `entry`'s own parent hash as its *current* — i.e. `entry` has no predecessor within this group's own entries. Exactly one such entry means the group's chain order is well-defined from here (a linear walk, not a fork); more than one is what {@link orderGroupByChain}'s fork check below has already caught. */
const hasPredecessorInGroup = (
	entry: ChainEntry,
	entries: ReadonlyArray<ChainEntry>,
): boolean =>
	entries.some((other) => other !== entry && other.current === entry.parent);

/**
 * Walks `remaining` forward from `last`, one strict positional step at a
 * time (mirrors `chain.ts`'s `walkFromRoot`, scoped to just this group's own
 * entries rather than the whole migration history): the next entry is
 * whichever remaining one's `parent` equals `last.current`. `null` when no
 * such entry exists while `remaining` is still non-empty — which, given the
 * fork and single-root checks {@link orderGroupByChain} already ran, only
 * happens if the group's entries don't actually chain together at all
 * (never produced by a real duplicate-version collision, but not assumed
 * away here).
 */
const walkGroup = (
	remaining: ReadonlyArray<ChainEntry>,
	last: ChainEntry,
	ordered: ReadonlyArray<ChainEntry>,
): ReadonlyArray<ChainEntry> | null => {
	if (remaining.length === 0) {
		return ordered;
	}
	const next = remaining.find((entry) => entry.parent === last.current);
	if (next === undefined) {
		return null;
	}
	return walkGroup(
		remaining.filter((entry) => entry !== next),
		next,
		[...ordered, next],
	);
};

/**
 * Orders one duplicate-migration-version group's own chain-hash entries
 * earliest-first, using only their own `parent`/`current` links (never the
 * rest of the migration history — that's the very check this group's own
 * collision blocks from running at all). `null` when the group can't be
 * ordered this way, which `hejbro verify --fix` treats as "leave this group
 * alone, report it as before": either
 *
 * - 2+ members share the exact same `parent` hash — a genuine fork
 *   (diverged-migrations), not just a same-second version-string
 *   collision. Renaming a fork's files wouldn't resolve the fork, so
 *   `--fix` doesn't touch it. No separate check for this: a fork at the
 *   very root surfaces as 2+ entries with no predecessor of their own
 *   (caught by the root count below), and a fork further in surfaces as
 *   {@link walkGroup} running out of matching entries partway through
 *   (some group member's `parent` is claimed by two others, so only one
 *   of them is ever reachable by the single-step walk) — both already
 *   return `null` without a dedicated fork check (#154 ratchet-5;
 *   verified directly against this file's own fork tests, not assumed).
 * - the entries don't form one connected line at all (not producible by a
 *   real chain, but not assumed away).
 */
export const orderGroupByChain = (
	entries: ReadonlyArray<ChainEntry>,
): ReadonlyArray<ChainEntry> | null => {
	const roots = entries.filter(
		(entry) => !hasPredecessorInGroup(entry, entries),
	);
	const [root, ...extraRoots] = roots;
	if (root === undefined || extraRoots.length > 0) {
		return null;
	}
	return walkGroup(
		entries.filter((entry) => entry !== root),
		root,
		[root],
	);
};

/** {@link parseVersionAsInstant}'s `"unix"` case: `version` as whole seconds since the epoch. */
const parseUnixVersion = (version: string): Date | null => {
	const seconds = Number(version);
	if (!Number.isFinite(seconds)) {
		return null;
	}
	return new Date(seconds * 1000);
};

/** {@link parseVersionAsInstant}'s `"timestamp"` case: `version` as a fixed-width `YYYYMMDDHHmmss` string. */
const parseTimestampVersion = (version: string): Date | null => {
	if (version.length !== 14) {
		return null;
	}
	const year = Number(version.slice(0, 4));
	const month = Number(version.slice(4, 6));
	const day = Number(version.slice(6, 8));
	const hour = Number(version.slice(8, 10));
	const minute = Number(version.slice(10, 12));
	const second = Number(version.slice(12, 14));
	return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
};

/** `version` (as `renderMigrationPrefix` would render it) parsed back into the instant it names — `null` for `index` (no clock) or a version that doesn't parse as `strategy`'s shape. Mirrors `verify.ts`'s own `parseVersionAsDate` (CLI-side, for the `Next:` suggestion text) — kept separately here since core can't import from the CLI package, and this one only ever feeds a rename *plan*, never diagnostic text. */
const parseVersionAsInstant = (
	version: string,
	strategy: MigrationPrefixStrategy,
): Date | null => {
	if (strategy === "unix") {
		return parseUnixVersion(version);
	}
	if (strategy === "timestamp") {
		return parseTimestampVersion(version);
	}
	return null;
};

/** The instant one second after every migration's own version in `fileNames` — `null` when there's nothing to compare against, or `strategy` has no meaningful clock (`index`). */
const nextInstantAfterAll = (
	fileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): Date | null => {
	const instants = fileNames
		.map((name) => migrationVersionOf(name))
		.filter((version): version is string => version !== null)
		.map((version) => parseVersionAsInstant(version, strategy))
		.filter((instant): instant is Date => instant !== null);
	if (instants.length === 0) {
		return null;
	}
	const maxMs = Math.max(...instants.map((instant) => instant.getTime()));
	return new Date(maxMs + 1000);
};

/** The original slug half of a migration filename (`<version>_<slug>.sql`) — everything after the first `_`, extension included, so a rename keeps it byte-for-byte. */
const slugOf = (fileName: string): string =>
	fileName.slice(fileName.indexOf("_") + 1);

/**
 * `hejbro verify --fix`'s core planning step (#220): given one
 * duplicate-migration-version `group` and its members' own chain-hash
 * `groupEntries` (exactly one {@link ChainEntry} per `group.fileNames`,
 * caller-matched — a member with no parseable hash lines can't be ordered,
 * so the caller shouldn't call this at all for such a group), decides
 * which member is genuinely earliest (chain order, not filename sort) and
 * produces a rename for every other member: each renamed to "one second
 * after the latest version anywhere in `allFileNames`", staggered a further
 * second apart per renamed member so renaming more than one at once can't
 * recreate the collision among themselves.
 *
 * `null` when the group can't be resolved this way — {@link orderGroupByChain}
 * returned `null` (a genuine fork, or entries that don't chain together),
 * `groupEntries` doesn't exactly match `group.fileNames` (a member has no
 * hash lines), or `allFileNames` has nothing `strategy` can parse a clock
 * from (`index` strategy, which can't collide by construction anyway). The
 * caller (CLI) leaves an unresolved group untouched — same
 * `duplicate-migration-version` diagnostic as before `--fix` existed.
 */
export const planDuplicateVersionFix = (
	group: DuplicateVersionGroup,
	groupEntries: ReadonlyArray<ChainEntry>,
	allFileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): DuplicateVersionFixPlan | null => {
	if (groupEntries.length !== group.fileNames.length) {
		return null;
	}
	const ordered = orderGroupByChain(groupEntries);
	if (ordered === null) {
		return null;
	}
	const [, ...rest] = ordered;
	if (rest.length === 0) {
		return null;
	}
	const baseInstant = nextInstantAfterAll(allFileNames, strategy);
	if (baseInstant === null) {
		return null;
	}
	return rest.map((entry, index) => {
		const targetInstant = new Date(baseInstant.getTime() + index * 1000);
		const targetVersion = renderMigrationPrefix({
			strategy,
			generatedAt: targetInstant,
			previousCount: 0,
			slug: "",
		});
		return {
			fileName: entry.fileName,
			newFileName: `${targetVersion}_${slugOf(entry.fileName)}`,
		};
	});
};

/** One `hejbro verify --fix`-adjacent alternative offered when a group's chain order can't be determined: `renamed` is what running this option would do (rename exactly this one member past the directory's current latest version); `assumedEarlier` names every other group member, for the message's "if X came first" framing — the human picking an option is asserting they know `assumedEarlier` genuinely predates `renamed`. */
export type DuplicateVersionFallbackOption = {
	readonly renamed: DuplicateVersionRename;
	readonly assumedEarlier: ReadonlyArray<string>;
};

/**
 * The owner-principle-compliant fallback for a duplicate-migration-version
 * group `planDuplicateVersionFix` can't order (a genuine fork, or a member
 * with no readable hash-chain banner): rather than a prose "resolve this
 * yourself" (rejected — every diagnostic hands back a command already
 * typed out, never just an explanation), one full option per group member
 * — "assume *this* file is the later one; rename it past the current max;
 * rerun `hejbro verify`" — so a human who *does* know the real order (they
 * wrote the files) can just run the matching line. Every option targets
 * the exact same version (unlike {@link planDuplicateVersionFix}'s
 * staggered renames): only one option is ever meant to run, so there's no
 * risk of two *unrun* suggestions colliding with each other. `null` only
 * when `allFileNames` has nothing `strategy` can parse a clock from
 * (`index` strategy — unreachable in practice, see
 * `planDuplicateVersionFix`'s own doc comment for why).
 */
export const duplicateVersionFallbackOptions = (
	group: DuplicateVersionGroup,
	allFileNames: ReadonlyArray<string>,
	strategy: MigrationPrefixStrategy,
): ReadonlyArray<DuplicateVersionFallbackOption> | null => {
	const baseInstant = nextInstantAfterAll(allFileNames, strategy);
	if (baseInstant === null) {
		return null;
	}
	const targetVersion = renderMigrationPrefix({
		strategy,
		generatedAt: baseInstant,
		previousCount: 0,
		slug: "",
	});
	return group.fileNames.map((candidate) => ({
		renamed: {
			fileName: candidate,
			newFileName: `${targetVersion}_${slugOf(candidate)}`,
		},
		assumedEarlier: group.fileNames.filter((name) => name !== candidate),
	}));
};
