import type { EnumDeclaration } from "../dsl/pg-enum";
import { assertNever, throwHejbroError } from "../error";
import { createOrDropDiff } from "../kind/diff-helpers";
import type { ObjectKind } from "../kind/object-kind";
import type { JsonValue } from "../snapshot/stable-json";
import { qualifyName } from "../sql/identifier";
import { quoteStringLiteral } from "../sql/literal";
import { statement } from "../sql/statement";

type EnumSnapshot = {
	readonly schema: string;
	readonly name: string;
	readonly values: ReadonlyArray<string>;
};

// Internal invariant: this shape is exactly what enumKind.serialize below produces.
const asEnumSnapshot = (snapshot: JsonValue): EnumSnapshot =>
	snapshot as EnumSnapshot;

const enumIdentity = (schemaName: string, enumName: string): string =>
	`${schemaName}.${enumName}`;

/** True when `nextValues` is `previousValues` with zero or more values appended at the end. */
const isAppendOnly = (
	previousValues: ReadonlyArray<string>,
	nextValues: ReadonlyArray<string>,
): boolean =>
	nextValues.length >= previousValues.length &&
	previousValues.every((value, index) => value === nextValues[index]);

const REMOVED_VALUES_NOTE = "enum values removed; recreating type";

const createTypeSql = (snapshot: EnumSnapshot): string => {
	const valueList = snapshot.values
		.map((value) => quoteStringLiteral(value))
		.join(", ");
	return `create type ${qualifyName(snapshot.schema, snapshot.name)} as enum (${valueList});`;
};

const dropTypeSql = (snapshot: EnumSnapshot): string =>
	`drop type ${qualifyName(snapshot.schema, snapshot.name)};`;

const addValueStatements = (
	snapshot: EnumSnapshot,
	addedValues: ReadonlyArray<string>,
) =>
	addedValues.map((value) =>
		statement(
			`alter type ${qualifyName(snapshot.schema, snapshot.name)} add value ${quoteStringLiteral(value)};`,
		),
	);

/**
 * The built-in object kind for Postgres enum types. Identity is
 * `"<schema>.<name>"`. Value lists are append-only: appended values emit
 * one `alter type … add value …` statement per value, in order. Removing
 * or reordering values emits a single `alter` change instead (**not** a
 * separate drop + create pair — the diff engine's global create/
 * alter-before-drop ordering would otherwise hoist a same-identity create
 * ahead of its own drop, recreating the type with the stale values; see
 * #55), whose `emit` renders `drop type` followed by `create type` in that
 * order, since Postgres cannot remove or reorder enum values in place.
 */
export const enumKind: ObjectKind<EnumDeclaration> = {
	kind: "enum",
	dependsOn: ["schema"],
	owns: (declaration): declaration is EnumDeclaration =>
		declaration.declarationKind === "enum",
	serialize: (declaration) => ({
		schema: declaration.schema.schemaName,
		name: declaration.enumName,
		values: declaration.values,
	}),
	identify: (snapshot) => {
		const enumSnapshot = asEnumSnapshot(snapshot);
		return enumIdentity(enumSnapshot.schema, enumSnapshot.name);
	},
	diff: (previous, next, identity) => {
		const guard = createOrDropDiff("enum", previous, next, identity);
		if (guard.done) {
			return guard.changes;
		}

		const previousValues = asEnumSnapshot(guard.previous).values;
		const nextValues = asEnumSnapshot(guard.next).values;
		const appendOnly = isAppendOnly(previousValues, nextValues);

		if (appendOnly && previousValues.length === nextValues.length) {
			return [];
		}
		if (appendOnly) {
			const addedValues = nextValues.slice(previousValues.length);
			const notes = addedValues.map((value) => `value "${value}" added`);
			return [
				{
					kind: "enum",
					operation: "alter",
					identity,
					previous: guard.previous,
					next: guard.next,
					notes,
				},
			];
		}

		return [
			{
				kind: "enum",
				operation: "alter",
				identity,
				previous: guard.previous,
				next: guard.next,
				notes: [REMOVED_VALUES_NOTE],
			},
		];
	},
	emit: (change) => {
		switch (change.operation) {
			case "create": {
				if (change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"enum create change is missing its next snapshot.",
					);
				}
				return [statement(createTypeSql(asEnumSnapshot(change.next)))];
			}
			case "drop": {
				if (change.previous === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"enum drop change is missing its previous snapshot.",
					);
				}
				return [statement(dropTypeSql(asEnumSnapshot(change.previous)))];
			}
			case "alter": {
				if (change.previous === null || change.next === null) {
					return throwHejbroError(
						"invalid-kind-change",
						"enum alter change is missing its previous or next snapshot.",
					);
				}
				const previousSnapshot = asEnumSnapshot(change.previous);
				const nextSnapshot = asEnumSnapshot(change.next);
				if (isAppendOnly(previousSnapshot.values, nextSnapshot.values)) {
					const addedValues = nextSnapshot.values.slice(
						previousSnapshot.values.length,
					);
					return addValueStatements(nextSnapshot, addedValues);
				}
				return [
					statement(dropTypeSql(previousSnapshot)),
					statement(createTypeSql(nextSnapshot)),
				];
			}
			default:
				return assertNever(change.operation);
		}
	},
};
