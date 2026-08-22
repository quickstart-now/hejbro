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
 * names exactly one problem — the first one met walking `entries` in file
 * order, whichever of `diverged-migrations`/`broken-chain` it is (#129;
 * not "diverged-migrations always wins regardless of position") —
 * `hejbro verify` (Task 17) dresses this in diagnostic grammar with a
 * `Next:` suggestion.
 */
export type ChainReport =
	| { readonly ok: true; readonly tip: string | null }
	| {
			readonly ok: false;
			readonly code: "diverged-migrations" | "broken-chain";
			readonly details: ReadonlyArray<string>;
	  };

type WalkState =
	| { readonly kind: "ok"; readonly lastCurrent: string }
	| { readonly kind: "failed"; readonly index: number };

/**
 * Walks `entries` after the root by strict positional adjacency: does
 * *this* entry's `parent` match the *immediately preceding* entry's
 * `current`? (Not "does it match any current seen so far" — that looser
 * rule is what let a rollback and a genuine fork look identical, #129.)
 * A rollback entry's own `current` returning to an earlier state is what
 * makes the *next* entry's `parent` match immediately, so a legitimate
 * "rewind by re-declaring" history never even reaches a failure here —
 * only a real positional gap does. Stops at the first failure (`index`,
 * into the full `entries` array) for {@link classifyFailure} to inspect.
 */
const walkFromRoot = (
	root: ChainEntry,
	rest: ReadonlyArray<ChainEntry>,
): WalkState =>
	rest.reduce<WalkState>(
		(state, entry, restIndex) => {
			if (state.kind === "failed") {
				return state;
			}
			if (entry.parent !== state.lastCurrent) {
				return { kind: "failed", index: restIndex + 1 };
			}
			return { kind: "ok", lastCurrent: entry.current };
		},
		{ kind: "ok", lastCurrent: root.current },
	);

type Failure =
	| { readonly kind: "fork"; readonly fileNames: ReadonlyArray<string> }
	| { readonly kind: "broken"; readonly fileName: string };

/**
 * Classifies why `entries[failIndex]` failed the positional walk (#129):
 * a **fork**, if its `parent` is also claimed by some earlier entry's own
 * `parent` (two — or more — entries genuinely racing for the same
 * unrepeated slot, since a legitimate rollback's re-occurrence of a state
 * would have satisfied {@link walkFromRoot}'s immediate-adjacency check
 * and never reached here); otherwise a **broken** link (the parent
 * matches nothing at all). `fileNames` collects *every* entry across the
 * whole array sharing that parent value (detection is positional; the
 * report is complete — a 3+-way fork names every participant, not just
 * the first pair `walkFromRoot` happened to trip on).
 */
const classifyFailure = (
	entries: ReadonlyArray<ChainEntry>,
	failIndex: number,
): Failure => {
	const failing = entries[failIndex];
	if (failing === undefined) {
		return { kind: "broken", fileName: "" };
	}
	const earlierSameParent = entries
		.slice(0, failIndex)
		.some((entry) => entry.parent === failing.parent);
	if (!earlierSameParent) {
		return { kind: "broken", fileName: failing.fileName };
	}
	const fileNames = entries
		.filter((entry) => entry.parent === failing.parent)
		.map((entry) => entry.fileName)
		.sort(compareKeys);
	return { kind: "fork", fileNames };
};

/**
 * Validates that `entries` (already filtered to hash-bearing files,
 * caller-ordered) form one linked list: the first entry's `parent` is
 * accepted unconditionally as the chain root (core can't compute the
 * empty-snapshot hash itself, and a legacy prefix's first hashed file's
 * parent isn't that hash anyway) — from there, every entry's `parent`
 * must match the *immediately preceding* entry's `current` (#129: not
 * "any earlier current", which couldn't tell a rollback from a fork).
 * The first entry (in file order) that fails this reports the problem:
 * `diverged-migrations` when it's genuinely racing another entry for the
 * same parent (a fork), `broken-chain` when its parent matches nothing
 * at all. This is "whichever problem is encountered first", not
 * "diverged-migrations always wins regardless of position" — the old
 * global fork pre-scan made the latter look like a rule, but it was
 * never a declared one (#129 review; main-confirmed). Pure — no fs, no
 * hashing (both CLI-owned).
 *
 * One known limitation, left as `it.todo` in chain.test.ts rather than
 * solved here: a deleted middle file (e.g. a rollback entry, removed
 * after the fact) is provably indistinguishable from a genuine fork
 * using the hash chain alone — deleting a file removes every trace of
 * it. Confirmed not a regression: the pre-#129 algorithm classified the
 * same shape as `diverged-migrations` too.
 */
export const checkChain = (entries: ReadonlyArray<ChainEntry>): ChainReport => {
	const [root, ...rest] = entries;
	if (root === undefined) {
		return { ok: true, tip: null };
	}

	const walked = walkFromRoot(root, rest);
	if (walked.kind === "failed") {
		const failure = classifyFailure(entries, walked.index);
		if (failure.kind === "fork") {
			return {
				ok: false,
				code: "diverged-migrations",
				details: failure.fileNames,
			};
		}
		return { ok: false, code: "broken-chain", details: [failure.fileName] };
	}

	const lastEntry = entries[entries.length - 1];
	return { ok: true, tip: lastEntry?.current ?? root.current };
};
