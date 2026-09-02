import { toSnakeCase } from "@hejbro/core";

/**
 * A column's TypeScript key, from its SQL name (catalog-inference delta,
 * "A catalog reading yields a snapshot and a marked description"):
 * lower-case, join the runs between non-alphanumeric characters in
 * camel case, keep a leading run of underscores as a literal prefix
 * rather than a separator, and prefix `_` when the result would
 * otherwise start with a digit.
 */
const LEADING_UNDERSCORES = /^_+/;
const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/g;
const STARTS_WITH_DIGIT = /^[0-9]/;

/** Exported so `declare-emit/emit.ts` can build a cross-file import alias's own Pascal-cased half the same way a camelCase run is capitalized here (D106 R2-B2) -- one capitalization rule, not two. */
export const capitalize = (run: string): string => {
	if (run.length === 0) {
		return run;
	}
	return `${run.charAt(0).toUpperCase()}${run.slice(1)}`;
};

const camelJoin = (runs: ReadonlyArray<string>): string =>
	runs
		.map((run, index) => {
			if (index === 0) {
				return run;
			}
			return capitalize(run);
		})
		.join("");

const baseTsKey = (sqlName: string): string => {
	const lower = sqlName.toLowerCase();
	const leading = lower.match(LEADING_UNDERSCORES)?.[0] ?? "";
	const rest = lower.slice(leading.length);
	const runs = rest.split(NON_ALPHANUMERIC_RUN).filter((run) => run.length > 0);
	const joined = `${leading}${camelJoin(runs)}`;
	if (STARTS_WITH_DIGIT.test(joined)) {
		return `_${joined}`;
	}
	return joined;
};

/**
 * The smallest integer from 2 upwards that, appended to `baseKey`, is not
 * already in `assigned` (catalog-inference delta's collision rule).
 * Recursive rather than looping (no `for`/`while` in this codebase); it
 * terminates because a SQL name is unique within its table, so some
 * suffix is always free. Exported so `declare-emit/emit.ts` can apply the
 * same rule to a cross-file import alias that still collides after its
 * first choice (D106 R2-B2) -- one suffix rule, not two.
 */
export const nextFreeSuffix = (
	baseKey: string,
	assigned: ReadonlySet<string>,
): string => {
	const tryFrom = (candidateSuffix: number): string => {
		const candidate = `${baseKey}${candidateSuffix}`;
		if (assigned.has(candidate)) {
			return tryFrom(candidateSuffix + 1);
		}
		return candidate;
	};
	return tryFrom(2);
};

/**
 * Which of `namesInOrder`'s members sharing `base` as their own key keeps
 * the bare key (D106 N2, corrected): never `reserved`'s to give (a plain
 * name is never a source spelling to round-trip); otherwise whichever
 * member's own name is what `base` round-trips back to via the DSL's own
 * `table()`-derives-a-column's-SQL-name-from-its-key rule -- the one
 * colliding name a declaration can still express -- so an exotic sibling
 * (quoted, differently cased, punctuated) sorting before an ordinary one
 * can never cost that ordinary column its own key. At most one member can
 * ever satisfy the round trip (it fixes one specific spelling), so this
 * is unambiguous whenever it fires; when none does (an exotic collision
 * with no round-trippable member at all), the earliest-in-`namesInOrder`
 * member is the fallback, matching this rule's own pre-D106 behavior for
 * that case unchanged.
 */
const bareKeyWinnerIndex = (
	namesInOrder: ReadonlyArray<string>,
	base: string,
	reserved: ReadonlySet<string>,
): number | null => {
	if (reserved.has(base)) {
		return null;
	}
	const indices = namesInOrder
		.map((name, index) => ({ name, index }))
		.filter(({ name }) => baseTsKey(name) === base)
		.map(({ index }) => index);
	const roundTrippableIndex = indices.find(
		(index) => toSnakeCase(base) === namesInOrder[index],
	);
	return roundTrippableIndex ?? indices[0] ?? null;
};

/** The bare key when `isWinner` still has it free, else the smallest free suffixed key -- no ternary (banned in this codebase). */
const keyFor = (
	isWinner: boolean,
	base: string,
	assigned: ReadonlySet<string>,
): string => {
	if (isWinner && !assigned.has(base)) {
		return base;
	}
	return nextFreeSuffix(base, assigned);
};

/**
 * Resolves TypeScript identifiers for `namesInOrder`, seeded with
 * `reserved` (already-taken keys, e.g. a file's own import symbols,
 * 2.1/CI-G2-R1-06 Q2) -- one member per colliding base key keeps the bare
 * key ({@link bareKeyWinnerIndex}) unless `reserved` already claims it,
 * and every other member (with `reserved` or a bare-key winner alike) is
 * suffixed with the smallest free integer from 2 upwards, in
 * `namesInOrder`'s own order (catalog-inference delta's collision rule,
 * D106 N2-corrected). {@link inferColumnKeys} is this with an empty
 * `reserved`.
 */
export const resolveIdentifierKeys = (
	namesInOrder: ReadonlyArray<string>,
	reserved: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> => {
	const winnerIndexByBase = new Map(
		[...new Set(namesInOrder.map(baseTsKey))].map(
			(base) =>
				[base, bareKeyWinnerIndex(namesInOrder, base, reserved)] as const,
		),
	);
	const resolved = namesInOrder.reduce<{
		readonly keys: ReadonlyArray<string>;
		readonly assigned: ReadonlySet<string>;
	}>(
		(state, sqlName, index) => {
			const base = baseTsKey(sqlName);
			const key = keyFor(
				winnerIndexByBase.get(base) === index,
				base,
				state.assigned,
			);
			return {
				keys: [...state.keys, key],
				assigned: new Set([...state.assigned, key]),
			};
		},
		{ keys: [], assigned: new Set(reserved) },
	);
	return resolved.keys;
};

/**
 * Resolves TypeScript keys for one table's columns, given in physical
 * order (`attnum` order) -- {@link resolveIdentifierKeys} with no
 * reserved names.
 */
export const inferColumnKeys = (
	sqlNamesInPhysicalOrder: ReadonlyArray<string>,
): ReadonlyArray<string> => resolveIdentifierKeys(sqlNamesInPhysicalOrder);
