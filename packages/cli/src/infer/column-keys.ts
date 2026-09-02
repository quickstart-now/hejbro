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

const capitalize = (run: string): string => {
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
 * suffix is always free.
 */
const nextFreeSuffix = (
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

const resolveKey = (base: string, assigned: ReadonlySet<string>): string => {
	if (assigned.has(base)) {
		return nextFreeSuffix(base, assigned);
	}
	return base;
};

/**
 * Resolves TypeScript identifiers for `namesInOrder`, seeded with
 * `reserved` (already-taken keys, e.g. a file's own import symbols,
 * 2.1/CI-G2-R1-06 Q2) -- the earliest name keeps its bare key unless
 * `reserved` already claims it, and each collision (with `reserved` or
 * an earlier name alike) is suffixed with the smallest free integer
 * from 2 upwards (catalog-inference delta's collision rule).
 * {@link inferColumnKeys} is this with an empty `reserved`.
 */
export const resolveIdentifierKeys = (
	namesInOrder: ReadonlyArray<string>,
	reserved: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> => {
	const resolved = namesInOrder.reduce<{
		readonly keys: ReadonlyArray<string>;
		readonly assigned: ReadonlySet<string>;
	}>(
		(state, sqlName) => {
			const key = resolveKey(baseTsKey(sqlName), state.assigned);
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
