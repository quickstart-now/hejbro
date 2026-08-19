import { throwHejbroError } from "../error";
import type { SqlTypeFamily } from "../expr/type-family";
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
 * `ColumnBuilder` — the original is never mutated. `TFamily` carries the
 * column's coarse Postgres type family (D17) so `table()` can expose typed
 * `ColumnRef`s without a second declaration.
 */
export type ColumnBuilder<TFamily extends SqlTypeFamily = SqlTypeFamily> = {
	readonly columnState: ColumnState;
	notNull(): ColumnBuilder<TFamily>;
	/** implies `notNull` when the column is materialized at serialization (Task 10), not here */
	primaryKey(): ColumnBuilder<TFamily>;
	unique(): ColumnBuilder<TFamily>;
	default(value: string | number | boolean): ColumnBuilder<TFamily>;
	/** uuid columns only — throws an actionable error otherwise */
	defaultRandom(): ColumnBuilder<TFamily>;
	/** date/time-family columns only — throws an actionable error otherwise */
	defaultNow(): ColumnBuilder<TFamily>;
	array(): ColumnBuilder<"array">;
};

/** Extracts the {@link SqlTypeFamily} a {@link ColumnBuilder} carries. */
export type BuilderFamily<TBuilder> =
	TBuilder extends ColumnBuilder<infer TFamily> ? TFamily : never;

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
export const createColumnBuilder = <
	TFamily extends SqlTypeFamily = SqlTypeFamily,
>(
	columnState: ColumnState,
): ColumnBuilder<TFamily> => ({
	columnState,
	notNull: () =>
		createColumnBuilder<TFamily>({ ...columnState, notNull: true }),
	primaryKey: () =>
		createColumnBuilder<TFamily>({ ...columnState, primaryKey: true }),
	unique: () => createColumnBuilder<TFamily>({ ...columnState, unique: true }),
	default: (value) =>
		createColumnBuilder<TFamily>({
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
		return createColumnBuilder<TFamily>({
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
		return createColumnBuilder<TFamily>({
			...columnState,
			defaultValue: { defaultKind: "now" },
		});
	},
	array: () =>
		createColumnBuilder<"array">({
			...columnState,
			typeNode: { typeName: "array", element: columnState.typeNode },
		}),
});
