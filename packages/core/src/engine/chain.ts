import { compareKeys } from "../sort";

/**
 * One migration file's banner hash-chain lines (D33), as parsed by the
 * CLI's `parseBannerHashes` — `fileName` is whatever the caller wants
 * reported back in a `ChainReport`'s `details` (typically a repo-relative
 * path). Files with no hash lines at all (pre-Phase-5 history,
 * `parseBannerHashes` → `null`) are filtered out by the caller before
 * building this array — `checkChain` only ever sees already-hashed
 * entries, in the same order the caller read them (directory-sorted).
 */
export type ChainEntry = {
	readonly fileName: string;
	readonly parent: string;
	readonly current: string;
};

/**
 * The result of {@link checkChain}: `tip` is the last entry's `current`
 * hash (`null` for an empty chain — nothing to check yet). A failure
 * names exactly one problem (`diverged-migrations` takes priority over
 * `broken-chain` when both exist in the same entry set) — `hejbro verify`
 * (Task 17) dresses this in diagnostic grammar with a `Next:` suggestion.
 */
export type ChainReport =
	| { readonly ok: true; readonly tip: string | null }
	| {
			readonly ok: false;
			readonly code: "diverged-migrations" | "broken-chain";
			readonly details: ReadonlyArray<string>;
	  };

type ParentGroup = {
	readonly parent: string;
	readonly fileNames: ReadonlyArray<string>;
};

/** Every `parent` value claimed by 2+ entries (a fork), sorted deterministically by parent hash — the first is the one `checkChain` reports. */
const findDivergentGroups = (
	entries: ReadonlyArray<ChainEntry>,
): ReadonlyArray<ParentGroup> => {
	const byParent = entries.reduce((acc, entry) => {
		const existing = acc.get(entry.parent) ?? [];
		acc.set(entry.parent, [...existing, entry.fileName]);
		return acc;
	}, new Map<string, ReadonlyArray<string>>());
	return Array.from(byParent.entries())
		.filter(([, fileNames]) => fileNames.length > 1)
		.map(([parent, fileNames]) => ({
			parent,
			fileNames: [...fileNames].sort(compareKeys),
		}))
		.sort((a, b) => compareKeys(a.parent, b.parent));
};

type WalkState =
	| { readonly kind: "ok"; readonly knownCurrents: ReadonlySet<string> }
	| { readonly kind: "broken"; readonly fileName: string };

/** Walks the entries after the root, confirming each one's `parent` matches some already-seen `current` — the first that doesn't is the broken link `hejbro verify` reports. */
const walkFromRoot = (
	root: ChainEntry,
	rest: ReadonlyArray<ChainEntry>,
): WalkState =>
	rest.reduce<WalkState>(
		(state, entry) => {
			if (state.kind === "broken") {
				return state;
			}
			if (!state.knownCurrents.has(entry.parent)) {
				return { kind: "broken", fileName: entry.fileName };
			}
			return {
				kind: "ok",
				knownCurrents: new Set([...state.knownCurrents, entry.current]),
			};
		},
		{ kind: "ok", knownCurrents: new Set([root.current]) },
	);

/**
 * Validates that `entries` (already filtered to hash-bearing files,
 * caller-ordered) form one linked list: the first entry's `parent` is
 * accepted unconditionally as the chain root (core can't compute the
 * empty-snapshot hash itself, and a legacy prefix's first hashed file's
 * parent isn't that hash anyway) — from there, every entry's `parent`
 * must match some earlier entry's `current`. Two entries sharing a
 * `parent` (a fork) is `diverged-migrations`; a `parent` matching no
 * prior `current` is `broken-chain`. Pure — no fs, no hashing (both
 * CLI-owned).
 */
export const checkChain = (entries: ReadonlyArray<ChainEntry>): ChainReport => {
	const [root, ...rest] = entries;
	if (root === undefined) {
		return { ok: true, tip: null };
	}

	const [divergentGroup] = findDivergentGroups(entries);
	if (divergentGroup !== undefined) {
		return {
			ok: false,
			code: "diverged-migrations",
			details: divergentGroup.fileNames,
		};
	}

	const walked = walkFromRoot(root, rest);
	if (walked.kind === "broken") {
		return { ok: false, code: "broken-chain", details: [walked.fileName] };
	}

	const lastEntry = entries[entries.length - 1];
	return { ok: true, tip: lastEntry?.current ?? root.current };
};
