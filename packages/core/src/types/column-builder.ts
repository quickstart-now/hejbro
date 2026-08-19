import { throwHejbroError } from "../error";
import type { TypeNode } from "./type-node";

/** A column's default value, as one of the shapes hejbro supports until Phase 2's expression AST lands. */
export type ColumnDefault =
	| {
			readonly defaultKind: "literal";
			readonly value: string | number | boolean;
	  }
	// escape hatch until Phase 2 expressions
	| { readonly defaultKind: "raw"; readonly sql: string }
	// gen_random_uuid()
	| { readonly defaultKind: "random-uuid" }
	// now()
	| { readonly defaultKind: "now" };

/** The immutable state carried by a {@link ColumnBuilder}. */
export type ColumnState = {
	readonly typeNode: TypeNode;
	readonly notNull: boolean;
	readonly primaryKey: boolean;
	readonly unique: boolean;
	readonly defaultValue: ColumnDefault | null;
};

/**
 * An immutable, chainable column declaration. Every modifier returns a new
 * `ColumnBuilder` — the original is never mutated.
 */
export type ColumnBuilder = {
	readonly columnState: ColumnState;
	notNull(): ColumnBuilder;
	/** implies `notNull` when the column is materialized at serialization (Task 10), not here */
	primaryKey(): ColumnBuilder;
	unique(): ColumnBuilder;
	default(value: string | number | boolean): ColumnBuilder;
	/** uuid columns only — throws an actionable error otherwise */
	defaultRandom(): ColumnBuilder;
	/** date/time-family columns only — throws an actionable error otherwise */
	defaultNow(): ColumnBuilder;
	array(): ColumnBuilder;
};

const timeLikeTypeNames = [
	"date",
	"time",
	"timetz",
	"timestamp",
	"timestamptz",
] as const;

const isTimeLikeTypeNode = (typeNode: TypeNode): boolean =>
	timeLikeTypeNames.some((name) => name === typeNode.typeName);

/**
 * Builds a {@link ColumnBuilder} bound to `columnState`. Every chained
 * method calls this factory again with a shallow-updated state, so builders
 * are effectively immutable value objects.
 */
export const createColumnBuilder = (
	columnState: ColumnState,
): ColumnBuilder => ({
	columnState,
	notNull: () => createColumnBuilder({ ...columnState, notNull: true }),
	primaryKey: () => createColumnBuilder({ ...columnState, primaryKey: true }),
	unique: () => createColumnBuilder({ ...columnState, unique: true }),
	default: (value) =>
		createColumnBuilder({
			...columnState,
			defaultValue: { defaultKind: "literal", value },
		}),
	defaultRandom: () => {
		if (columnState.typeNode.typeName !== "uuid") {
			return throwHejbroError(
				"invalid-column-default",
				`defaultRandom() only applies to uuid columns, but this column is "${columnState.typeNode.typeName}" — use .default(...) or drop defaultRandom() here.`,
			);
		}
		return createColumnBuilder({
			...columnState,
			defaultValue: { defaultKind: "random-uuid" },
		});
	},
	defaultNow: () => {
		if (!isTimeLikeTypeNode(columnState.typeNode)) {
			return throwHejbroError(
				"invalid-column-default",
				`defaultNow() only applies to date/time columns, but this column is "${columnState.typeNode.typeName}" — use .default(...) instead.`,
			);
		}
		return createColumnBuilder({
			...columnState,
			defaultValue: { defaultKind: "now" },
		});
	},
	array: () =>
		createColumnBuilder({
			...columnState,
			typeNode: { typeName: "array", element: columnState.typeNode },
		}),
});
