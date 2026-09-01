import type { ChainEntry, ChainReport, HejbroError } from "@hejbro/core";
import { checkChain, hejbroError } from "@hejbro/core";
import type { LedgerState } from "./ledger";

/**
 * `chain`'s array order IS chain order (root first), the same contract
 * `checkChain` itself assumes and `verify.ts`'s own `readChainEntries`
 * already satisfies (directory-sorted, which in a healthy repository
 * coincides with chain order). This function does not independently
 * re-thread `chain` from its `parent`/`current` links -- `@hejbro/core`
 * already has that walk (`orderGroupByChain`), but it is scoped to
 * resolving one duplicate-version *group* (2+ files sharing a version
 * prefix, `verify --fix`'s own narrow job); reusing it here for a whole
 * migration chain would be a second, drifting re-implementation of the
 * same idea rather than the one this task asks to reuse (`checkChain`).
 * The obligation this function owns instead is narrower and cheaper: given
 * an order, never silently re-derive a different one (e.g. by sorting on
 * filename) when filtering it down to the pending set.
 */

/**
 * One place the chain on disk and the ledger disagree -- `identity` is
 * the migration filename this disagreement is *about* (never a raw diff:
 * same shape as `check`'s own `Finding`, `packages/cli/src/check/compare.ts`),
 * `error` is the coded, `Next:`-bearing diagnostic the report renders.
 */
export type Disagreement = {
	readonly identity: string;
	readonly error: HejbroError;
};

/**
 * [design, task 2.2] Returned, never thrown -- and returned as a *batch*,
 * following `check`'s own precedent (`compare.ts`'s `Finding[]`): a user
 * who fixes one disagreement and reruns `migrate` should not meet a
 * second one `planApply` already knew about. `"chain-invalid"` is kept as
 * its own branch rather than folded into `disagreements`, because it is a
 * different kind of failure, not a different member of the same
 * enumeration: `checkChain` itself reports at most one problem (its own
 * contract, `chain.ts`), and once the chain doesn't verify, "which
 * migrations are pending" has no meaning to compute -- there is nothing
 * left to batch it with. `"chain-invalid"` SHALL be checked before any
 * ledger comparison (spec: "verify ... before applying anything"), so a
 * broken chain is reported as `"chain-invalid"` even when the ledger also
 * disagrees with it.
 */
export type PlanResult =
	| { readonly ok: true; readonly pending: ReadonlyArray<string> }
	| {
			readonly ok: false;
			readonly reason: "chain-invalid";
			readonly error: HejbroError;
	  }
	| {
			readonly ok: false;
			readonly reason: "ledger-disagreement";
			readonly disagreements: ReadonlyArray<Disagreement>;
	  };

/**
 * Reuses `checkChain`'s own code (`"diverged-migrations"` |
 * `"broken-chain"`) rather than minting a `migrate-`-prefixed one --
 * `verify.ts` already does the same (`hejbroError(report.code, ...)`),
 * and a second code for the same failure would be a second truth for one
 * fact.
 */
const chainInvalidMessage = (
	report: Extract<ChainReport, { readonly ok: false }>,
): string => {
	const artifacts = report.details.join(", ");
	return `the migration chain does not verify at ${artifacts} -- these bytes are not what hejbro's own hash chain vouches for, so nothing is applied. Next: run \`hejbro verify\` for the full diagnosis, fix the affected file(s), then rerun \`hejbro migrate\`.`;
};

const orphanRowFinding = (filename: string): Disagreement => ({
	identity: filename,
	error: hejbroError(
		"apply-ledger-orphan-row",
		`the ledger records "${filename}" as applied, but no migration of that name exists on disk. Next: restore the file from version control if it was deleted by mistake, or resolve the mismatch by hand -- hejbro will not guess -- before rerunning \`hejbro migrate\`.`,
	),
});

/** `ledger.exists` narrows which arm carries `applied` -- no ternary (banned house style): an absent ledger has recorded nothing. */
const appliedFileNames = (ledger: LedgerState): ReadonlyArray<string> => {
	if (ledger.exists) {
		return ledger.applied;
	}
	return [];
};

const outOfOrderFinding = (
	filename: string,
	unrecorded: string,
): Disagreement => ({
	identity: filename,
	error: hejbroError(
		"apply-ledger-out-of-order",
		`the ledger records "${filename}" as applied, but the chain orders it after "${unrecorded}", which the ledger does not record. Next: investigate how "${filename}" was applied without "${unrecorded}" -- hejbro's own \`migrate\` never does this -- before rerunning \`hejbro migrate\`.`,
	),
});

/**
 * The nearest migration *before* `index` in chain order that the ledger
 * does not record, or `null` when everything before it is recorded --
 * `.at(-1)` (not `.findLast`, ES2023 -- this package's `tsconfig` targets
 * ES2022) over the *earlier* slice's unrecorded entries, so the last
 * match in file order is the nearest one. `undefined` is also "not
 * found", so an unapplied migration that happens to be the earliest is
 * indistinguishable from "there is none": both correctly mean this
 * position has no preceding gap to name.
 */
const nearestPrecedingUnrecorded = (
	chain: ReadonlyArray<ChainEntry>,
	applied: ReadonlySet<string>,
	index: number,
): string | null => {
	const earlier = chain
		.slice(0, index)
		.filter((entry) => !applied.has(entry.fileName))
		.at(-1);
	if (earlier === undefined) {
		return null;
	}
	return earlier.fileName;
};

/**
 * Walks the chain once, in its own order: every recorded migration that
 * has an unrecorded one somewhere before it in chain order is reported
 * against the nearest such gap. This is the same state a ledger that
 * skipped a migration entirely (0001, 0003 recorded, 0002 not) produces
 * -- tasks.md's own "gap" was this member under a second name (2.2's own
 * note) -- so no separate case exists for it here. No accumulator spread
 * (`lint/performance/noAccumulatingSpread`): each position's answer is
 * computed from `chain` itself, not carried forward through a reduce.
 */
const outOfOrderDisagreements = (
	chain: ReadonlyArray<ChainEntry>,
	applied: ReadonlySet<string>,
): ReadonlyArray<Disagreement> =>
	chain.flatMap((entry, index) => {
		if (!applied.has(entry.fileName)) {
			return [];
		}
		const unrecorded = nearestPrecedingUnrecorded(chain, applied, index);
		if (unrecorded === null) {
			return [];
		}
		return [outOfOrderFinding(entry.fileName, unrecorded)];
	});

/**
 * The chain on disk and the ledger's own rows in, a plan out: which
 * migrations are pending (in chain order, never re-sorted by filename)
 * when the two agree, or every way they disagree when they don't. No
 * filesystem, no driver -- `chain` and `ledger` are already read by the
 * caller (group 7's job); this function only compares what it is given.
 */
export const planApply = (
	chain: ReadonlyArray<ChainEntry>,
	ledger: LedgerState,
): PlanResult => {
	const chainReport = checkChain(chain);
	if (!chainReport.ok) {
		return {
			ok: false,
			reason: "chain-invalid",
			error: hejbroError(chainReport.code, chainInvalidMessage(chainReport)),
		};
	}

	// Past this point, `chain`'s array order is not merely assumed to be
	// chain order -- it is proven to be: `checkChain` (above) fails on any
	// array whose order isn't the true positional chain (each entry's
	// `parent` must match the *immediately preceding* entry's `current`),
	// and a failure already returned. So nothing below may re-sort `chain`
	// (e.g. by filename) without silently substituting a different order
	// for the one just verified -- filter/map only, never `.sort()`.
	const applied = new Set(appliedFileNames(ledger));
	const chainFileNames = new Set(chain.map((entry) => entry.fileName));

	const orphanRows = Array.from(applied)
		.filter((filename) => !chainFileNames.has(filename))
		.map(orphanRowFinding);
	const outOfOrder = outOfOrderDisagreements(chain, applied);
	const disagreements = [...orphanRows, ...outOfOrder];

	if (disagreements.length > 0) {
		return { ok: false, reason: "ledger-disagreement", disagreements };
	}

	return {
		ok: true,
		pending: chain
			.filter((entry) => !applied.has(entry.fileName))
			.map((entry) => entry.fileName),
	};
};
