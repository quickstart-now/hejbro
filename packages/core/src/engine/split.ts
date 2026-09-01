import type { KindChange } from "../kind/object-kind";
import type { Snapshot } from "../snapshot/snapshot";
import type { JsonValue } from "../snapshot/stable-json";

/**
 * [task 13.1, #625] `value` narrowed to a plain JSON object, or `null` for
 * anything else (a JSON scalar, an array, `null`, or `undefined` itself)
 * -- the one "is this a plain object" test this file needed three times
 * (`enumValuesOf`, `isMatchingLiteral`, `referencesAnyLiteral`), each
 * previously writing out the same three-way check
 * (`null`/`typeof !== "object"`/`Array.isArray`) inline and then casting
 * the result by hand. Extracted once, as a narrowing helper rather than a
 * bare boolean predicate: a boolean answer would still leave every caller
 * casting the value itself, which is the reason the guards were written
 * inline in the first place (the cast site and the check site stayed
 * next to each other on purpose) -- a narrowing return removes the cast
 * along with the check, at every call site at once.
 *
 * [task 13.5, #625] Still a three-way test, not four, even though the
 * parameter accepts `undefined` (a caller reads an optional record key
 * under `noUncheckedIndexedAccess` and hands the result straight through)
 * -- a fourth, explicit `value === undefined` arm would only restate what
 * `typeof value !== "object"` already covers: `typeof undefined` is the
 * string `"undefined"`, never `"object"`, so that branch already returns
 * `null` for it. Writing the redundant arm out anyway was this task's own
 * false start, measured and reverted rather than kept for symmetry with
 * the type signature -- a fourth guard that duplicates a fact the second
 * one already states is not "the same test done four ways" becoming
 * clearer by being spelled out; it is one more term for a reader (and for
 * this file's own complexity walker) to confirm changes nothing.
 */
const asJsonRecord = (
	value: JsonValue | null | undefined,
): Record<string, JsonValue> | null => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, JsonValue>;
};

/** `EnumSnapshot`'s own shape (`kinds/enum-kind.ts`, not exported there) -- read structurally here rather than imported, the same "don't own a second copy of a private shape" reasoning `enum-kind.ts` itself states for its own `asEnumSnapshot`. */
const enumValuesOf = (
	value: JsonValue | null,
): ReadonlyArray<string> | null => {
	const record = asJsonRecord(value);
	if (record === null) {
		return null;
	}
	if (!Array.isArray(record.values)) {
		return null;
	}
	return record.values as ReadonlyArray<string>;
};

/** `true` when `next` is `previous` with zero or more values appended -- mirrors `enum-kind.ts`'s own `isAppendOnly`, which is not exported (kept private to that file's own diff/emit pairing); duplicated here rather than exported across a kind-module boundary for one predicate. */
const isAppendOnly = (
	previousValues: ReadonlyArray<string>,
	nextValues: ReadonlyArray<string>,
): boolean =>
	nextValues.length >= previousValues.length &&
	previousValues.every((value, index) => value === nextValues[index]);

/** `true` when `change` is an `alter` on an `enum` -- the one kind/operation pair {@link addedEnumValues} has anything to say about; named so that check reads as one fact at its call site instead of two comparisons. */
const isEnumAlterChange = (change: KindChange): boolean =>
	change.kind === "enum" && change.operation === "alter";

/**
 * [task 13.4, #625] The values `nextValues` appends onto `previousValues`,
 * or `[]` when it is not append-only (shorter, reordered, or otherwise
 * not `previousValues` with zero or more values on the end) -- the
 * "does `next` extend `previous`, and if so what's new" half of
 * {@link addedEnumValues}, split out on its own so that function's
 * remaining job is finding the two value lists and handing them here.
 */
const appendedValues = (
	previousValues: ReadonlyArray<string>,
	nextValues: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (nextValues.length <= previousValues.length) {
		return [];
	}
	if (!isAppendOnly(previousValues, nextValues)) {
		return [];
	}
	return nextValues.slice(previousValues.length);
};

/**
 * The values `change` adds to an *existing* enum type -- `[]` for
 * anything else, including a brand-new enum's own `create` (spec: "using
 * its values in the same run" that creates the type "does not satisfy it
 * either"; `create` has no `previous` to append onto) and an `alter` that
 * removes or reorders values (not append-only, `enum-kind.ts`'s own
 * `emitAlter` renders those as `drop type`/`create type`, never `add
 * value` -- nothing this run adds a *new* value to, so nothing that
 * could trigger a split either).
 */
const addedEnumValues = (change: KindChange): ReadonlyArray<string> => {
	if (!isEnumAlterChange(change)) {
		return [];
	}
	const previousValues = enumValuesOf(change.previous);
	const nextValues = enumValuesOf(change.next);
	if (previousValues === null || nextValues === null) {
		return [];
	}
	return appendedValues(previousValues, nextValues);
};

/**
 * [task 13.2, #625] `literalRecord`'s own string value, when it encodes a
 * string literal (`literalKind === "string"`, `value` actually a
 * `string`) -- `null` otherwise. Split out of `isMatchingLiteral` so that
 * function's own remaining job is one comparison against `targets`, not
 * also reading the literal's shape apart from its value.
 */
const stringLiteralValue = (
	literalRecord: Record<string, JsonValue>,
): string | null => {
	if (literalRecord.literalKind !== "string") {
		return null;
	}
	if (typeof literalRecord.value !== "string") {
		return null;
	}
	return literalRecord.value;
};

/**
 * `true` when `value` (a raw JSON node, not yet known to be an `ExprNode`)
 * is an encoded string-literal node naming one of `targets` -- the leaf
 * `expr/codec.ts`'s own `encodeLiteralNode` produces
 * (`{ nodeKind: "literal", literal: { literalKind: "string", value } }`).
 */
const isMatchingLiteral = (
	value: Record<string, JsonValue>,
	targets: ReadonlySet<string>,
): boolean => {
	if (value.nodeKind !== "literal") {
		return false;
	}
	const literalRecord = asJsonRecord(value.literal);
	if (literalRecord === null) {
		return false;
	}
	const literalValue = stringLiteralValue(literalRecord);
	return literalValue !== null && targets.has(literalValue);
};

/**
 * [design, task 4.1] Structural, not by field name: recurses through
 * `value` (any JSON shape a snapshot node can hold) and reports `true`
 * the moment it meets an encoded literal naming one of `targets` --
 * `nodeKind`/`literalKind` are the *only* vocabulary this function knows,
 * so it reaches a column default, a generated column, a check
 * constraint, an index predicate, a policy's `using`/`with check`, or a
 * view body identically, without being told any of their field names
 * (`expr/codec.ts` encodes all of them the same way). A kind added later
 * that stores an expression the same way is covered automatically; one
 * this file's author never thought of is exactly the gap a hand-written
 * list of "expression-bearing slots" would have left (this delta's own
 * proposal: the specs' own such list is missing view bodies, measured
 * failing).
 *
 * A function body costs no separate exception here. `kinds/function-kind.ts`'s
 * `FunctionSnapshot` stores its body as `bodySql: string` -- already-
 * rendered SQL text, never a `nodeKind`-bearing node -- so this walk
 * never descends into one: a plain string has no `nodeKind` to match,
 * and `Object.values` on a string index-walks its characters, none of
 * which are objects. "Outside a function body" is therefore not
 * something this function checks; it is a fact about the snapshot's own
 * shape that leaves nothing here to check.
 *
 * [design] Matches the literal's own spelling, never its type. An
 * encoded literal carries no cast/type information (measured: an enum
 * column default renders `default 'value'` with no `::type` -- the
 * column's own declared type supplies it), so "this string is the added
 * enum value" cannot be told apart from "this string merely reads the
 * same" without inferring every expression's type, which this project
 * declines to build. This over-approximates on purpose and the two
 * failure directions are not symmetric (spec, "Migrations are generated
 * deterministically from declarations"): an unrelated match splits a run
 * that did not need it -- one extra migration, still clean; a missed
 * match ships a migration that fails against a real database after
 * passing every check hejbro has.
 */
const referencesAnyLiteral = (
	value: JsonValue,
	targets: ReadonlySet<string>,
): boolean => {
	if (Array.isArray(value)) {
		return value.some((entry) => referencesAnyLiteral(entry, targets));
	}
	const record = asJsonRecord(value);
	if (record === null) {
		return false;
	}
	if (isMatchingLiteral(record, targets)) {
		return true;
	}
	return Object.values(record).some((child) =>
		referencesAnyLiteral(child, targets),
	);
};

/**
 * [task 4.1] `planSplit`'s result: either the run does not need to split
 * (`split: false`), or it does, with the triggering enum change(s)
 * separated from everything else this run emits.
 */
export type SplitDecision =
	| { readonly split: false }
	| {
			readonly split: true;
			readonly enumChanges: ReadonlyArray<KindChange>;
			readonly restChanges: ReadonlyArray<KindChange>;
	  };

/**
 * Decides whether `changes` (one `generate` run's whole diff) SHALL split
 * (spec: "A run SHALL be split where it adds a value to an existing enum
 * type and also emits that value into an expression the database
 * resolves while executing the statement that carries it"). `false` when
 * no change adds a value to an existing enum, or when every added value
 * only ever appears inside a change this function excludes from the walk
 * (nothing today; see {@link referencesAnyLiteral}'s function-body note).
 */
export const planSplit = (
	changes: ReadonlyArray<KindChange>,
): SplitDecision => {
	const enumChanges = changes.filter(
		(change) => addedEnumValues(change).length > 0,
	);
	if (enumChanges.length === 0) {
		return { split: false };
	}
	const addedValues = new Set(enumChanges.flatMap(addedEnumValues));
	const restChanges = changes.filter((change) => !enumChanges.includes(change));
	const triggers = restChanges.some(
		(change) =>
			change.next !== null && referencesAnyLiteral(change.next, addedValues),
	);
	if (!triggers) {
		return { split: false };
	}
	return { split: true, enumChanges, restChanges };
};

/**
 * [task 4.2] The previous snapshot with only `enumChanges` applied -- the
 * state the first migration's own `snapshot:` banner hash names, and the
 * `parent-snapshot:` the second migration's banner chains onto.
 * `Snapshot.objects` is a plain keyed record (`${kind}:${identity}`), so
 * this is a shallow merge, never a rebuild through the declaration
 * pipeline.
 */
export const applySplitChangesOnly = (
	previousSnapshot: Snapshot,
	changesToApply: ReadonlyArray<KindChange>,
): Snapshot => {
	const entries = changesToApply
		.filter(
			(change): change is KindChange & { readonly next: JsonValue } =>
				change.next !== null,
		)
		.map(
			(change) => [`${change.kind}:${change.identity}`, change.next] as const,
		);
	return {
		...previousSnapshot,
		objects: {
			...previousSnapshot.objects,
			...Object.fromEntries(entries),
		},
	};
};
