import type { EnumDeclaration } from "../dsl/pg-enum";
import { assertNever, throwHejbroError } from "../error";
import type { KindChange, ObjectKind } from "../kind/object-kind";
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
 * or reordering values emits a drop+create pair instead, since Postgres
 * cannot remove or reorder enum values in place.
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
		if (previous === null && next !== null) {
			return [
				{
					kind: "enum",
					operation: "create",
					identity,
					previous: null,
					next,
					notes: [],
				},
			];
		}
		if (previous !== null && next === null) {
			return [
				{
					kind: "enum",
					operation: "drop",
					identity,
					previous,
					next: null,
					notes: [],
				},
			];
		}
		if (previous === null || next === null) {
			return [];
		}

		const previousValues = asEnumSnapshot(previous).values;
		const nextValues = asEnumSnapshot(next).values;
		const appendOnly = isAppendOnly(previousValues, nextValues);

		if (appendOnly && previousValues.length === nextValues.length) {
			return [];
		}
		if (appendOnly) {
			const addedValues = nextValues.slice(previousValues.length);
			const notes = addedValues.map((value) => `value "${value}" added`);
			return [
				{ kind: "enum", operation: "alter", identity, previous, next, notes },
			];
		}

		const recreateChanges: ReadonlyArray<KindChange> = [
			{
				kind: "enum",
				operation: "drop",
				identity,
				previous,
				next: null,
				notes: [REMOVED_VALUES_NOTE],
			},
			{
				kind: "enum",
				operation: "create",
				identity,
				previous: null,
				next,
				notes: [REMOVED_VALUES_NOTE],
			},
		];
		return recreateChanges;
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
				const previousValues = asEnumSnapshot(change.previous).values;
				const nextSnapshot = asEnumSnapshot(change.next);
				const addedValues = nextSnapshot.values.slice(previousValues.length);
				return addValueStatements(nextSnapshot, addedValues);
			}
			default:
				return assertNever(change.operation);
		}
	},
};
