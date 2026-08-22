import type { JsonValue } from "../snapshot/stable-json";
import { stableJson } from "../snapshot/stable-json";
import { compareKeys } from "../sort";
import type { KindChange } from "./object-kind";

/** The result of diffing two keyed collections of the same value type. */
export type KeyedDiff<TValue> = {
	readonly added: ReadonlyArray<{
		readonly key: string;
		readonly value: TValue;
	}>;
	readonly removed: ReadonlyArray<{
		readonly key: string;
		readonly value: TValue;
	}>;
	readonly changed: ReadonlyArray<{
		readonly key: string;
		readonly previous: TValue;
		readonly next: TValue;
	}>;
};

/** True when `a` and `b` are structurally equal JSON values (compared as stably serialized bytes). */
export const sameJson = (a: JsonValue, b: JsonValue): boolean =>
	stableJson(a) === stableJson(b);

/**
 * The result of {@link createOrDropDiff}: either the caller's `diff`
 * should return `changes` immediately (`done: true` — one of `previous`/
 * `next` is `null`), or both are genuinely present and the caller's own
 * kind-specific comparison decides what changed (`done: false`, carrying
 * `previous`/`next` narrowed to non-null so the caller never re-checks
 * them for `null`).
 */
export type DiffGuardResult =
	| { readonly done: true; readonly changes: ReadonlyArray<KindChange> }
	| {
			readonly done: false;
			readonly previous: JsonValue;
			readonly next: JsonValue;
	  };

/**
 * The create/drop/neither-exists guard every `ObjectKind`'s own `diff`
 * opened with — byte-identical across eight kind files (`table-kind.ts`,
 * `function-kind.ts`, `enum-kind.ts`, `view-kind.ts`, `trigger-kind.ts`,
 * `rls-kind.ts`, `policy-kind.ts`, `grant-kind.ts`) before this
 * extraction, differing only in the literal `kind` value passed in —
 * confirmed by diffing all eight against each other with that one value
 * normalized, not assumed from reading a few of them (#154 PR2, CRAP
 * refactor — the shared-guard opportunity the issue's own function-by-
 * function list didn't name, since only three of these eight functions
 * individually crossed the CRAP threshold; the other five stayed under
 * it only because the rest of their own `diff` has less to compare).
 *
 * Returns a {@link DiffGuardResult} rather than `ReadonlyArray<KindChange>
 * | null` so the caller's own `previous`/`next` locals narrow to non-null
 * through the `done` discriminant — a plain `null` sentinel can't carry
 * that narrowing back across a function-call boundary for two variables
 * at once.
 */
export const createOrDropDiff = (
	kind: string,
	previous: JsonValue | null,
	next: JsonValue | null,
	identity: string,
): DiffGuardResult => {
	if (previous === null && next !== null) {
		return {
			done: true,
			changes: [
				{
					kind,
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			],
		};
	}
	if (previous !== null && next === null) {
		return {
			done: true,
			changes: [
				{
					kind,
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			],
		};
	}
	if (previous === null || next === null) {
		return { done: true, changes: [] };
	}
	return { done: false, previous, next };
};

/**
 * Diffs two keyed collections into additions, removals, and changes.
 * Equality is `sameJson` byte equality. Entries present in both with equal
 * values are omitted from every list. Input order never affects the
 * result: outputs are always sorted by key.
 */
export const diffByKey = <TValue extends JsonValue>(
	previous: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
	next: ReadonlyArray<{ readonly key: string; readonly value: TValue }>,
): KeyedDiff<TValue> => {
	const previousByKey = new Map(
		previous.map((entry) => [entry.key, entry.value] as const),
	);
	const nextByKey = new Map(
		next.map((entry) => [entry.key, entry.value] as const),
	);

	const added = next
		.filter((entry) => !previousByKey.has(entry.key))
		.map((entry) => ({ key: entry.key, value: entry.value }))
		.sort((a, b) => compareKeys(a.key, b.key));

	const removed = previous
		.filter((entry) => !nextByKey.has(entry.key))
		.map((entry) => ({ key: entry.key, value: entry.value }))
		.sort((a, b) => compareKeys(a.key, b.key));

	const changed = previous
		.filter((entry) => nextByKey.has(entry.key))
		.flatMap((entry) => {
			const nextValue = nextByKey.get(entry.key);
			if (nextValue === undefined || sameJson(entry.value, nextValue)) {
				return [];
			}
			return [{ key: entry.key, previous: entry.value, next: nextValue }];
		})
		.sort((a, b) => compareKeys(a.key, b.key));

	return { added, removed, changed };
};
