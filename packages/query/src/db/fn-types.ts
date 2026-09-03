import type {
	BaseTsType,
	ColumnBuilder,
	ColumnReadType,
	FunctionDeclaration,
	Table,
	TypeNode,
} from "@hejbro/core";
import type { ColumnTsType } from "../types/column-map";
import type { SelectResult } from "../types/select-result";
import type { Schema } from "./db";

/**
 * Adapts one declared-function scalar return's `TypeNode` into the shape
 * core's public `BaseTsType` expects — every `TypeNode` variant already
 * structurally satisfies that shape *except* `array`, whose own
 * `element` field is a full nested `TypeNode` (`BaseTsType`'s own
 * `TMeta["element"]` wants just the element's bare type name, the same
 * shape `column-map.ts`'s `ColumnTsType` already feeds it for a declared
 * `.array()` column). One level of array nesting only — matching this
 * whole area's own documented "one level of `element`" gap
 * (`ts-type-map.ts`), not a new one.
 */
type TypeNodeMeta<TNode extends TypeNode> = TNode extends {
	readonly typeName: "array";
	readonly element: infer TElement extends TypeNode;
}
	? { readonly typeName: "array"; readonly element: TElement["typeName"] }
	: TNode;

/**
 * The TypeScript type a `defineFunction({returns: <TypeNode>})` scalar
 * return resolves to (task 4.10, spec's "resolves to a value of the
 * mapped scalar type") — reuses core's public `BaseTsType` (the exact
 * same base mapping every declared column goes through, `ts-type-map.ts`,
 * D94), so a scalar `db.fn` return can never disagree with what a column
 * of the same declared type would read back as. No numeric `mode` is
 * resolvable from a bare `returns` config (`mode` is a column-builder
 * concept, task 3.4, never carried on a raw `TypeNode`), so `bigint`/
 * `numeric` fall back to `BaseTsType`'s own conservative defaults —
 * `fn.ts`'s own runtime conversion (`defaultNumericMode`) mirrors these
 * same two defaults so the type and the runtime value agree.
 */
export type ScalarReturnTsType<TNode extends TypeNode> = BaseTsType<
	TypeNodeMeta<TNode>
>;

/**
 * The named-argument object one `db.fn.*` call accepts (owner decision:
 * a direct translation of `TArgs`'s own named shape, not a positional
 * tuple) — one key per declared argument, each mapped through g3's own
 * `ColumnTsType` (the same base/brand mapping a declared column's own
 * read type uses). Deliberately **not** `Partial`/an index signature: a
 * missing key, an extra key, or a wrong-typed value must all be
 * `tsc` errors (typed-function-execution spec), and an index signature
 * or optional keys would each defeat one of the three (an index
 * signature accepts any extra key; optional keys accept a missing one).
 */
export type FnArgsInput<TArgs extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TArgs]: ColumnTsType<TArgs[K]>;
};

/**
 * The value/row type one `db.fn.*` call resolves to, derived from the
 * declaration's own `TReturns` (task 4.10, widened #433): a `Table`
 * target resolves through g3's `SelectResult<TTable>` (the exact
 * mechanism a whole-table `select()`/mutation `.returning()` already use,
 * task 4.11/4.11-mutation — one shared row-shape mechanism, not a fourth
 * independently-typed copy); a builder-declared scalar return resolves
 * through {@link ColumnReadType} — the exact same type `args` already
 * resolves every declared column through, so the two positions agree by
 * construction and nothing the builder carries (`jsonType`, `enumValues`,
 * an array's element type) is lost the way a `TypeNode`-only mapping
 * would lose it; a raw `TypeNode` return (still accepted, additive)
 * resolves through {@link ScalarReturnTsType} alone (spec: "resolves to a
 * value", not rows — `fn.ts`'s own runtime match this exactly since its
 * scalar-value fix, same task); the trigger sentinel resolves to `never`
 * — `db.fn` can never call one (`fn.ts`'s own
 * `function-return-kind-unsupported` runtime guard is the same rejection
 * enforced at the type level here, wherever `TReturns` is precise enough
 * to say so).
 *
 * The `TReturns extends Table` arm is checked before the `ColumnBuilder`
 * arm deliberately: the two are structurally disjoint (a `Table`'s own
 * columns are keyed by name, a `ColumnBuilder` carries `columnState`
 * directly), so order between them doesn't change which one a given
 * `TReturns` matches — kept in the same order the requirement itself
 * lists them (table, then the two scalar forms) for readability, not
 * because a mismatch is possible.
 */
export type FnResult<
	TReturns extends
		| Table
		| TypeNode
		| ColumnBuilder
		| { readonly returnsKind: "trigger" },
> = TReturns extends Table
	? ReadonlyArray<SelectResult<TReturns>>
	: TReturns extends ColumnBuilder
		? ColumnReadType<TReturns>
		: TReturns extends TypeNode
			? ScalarReturnTsType<TReturns>
			: never;

/**
 * One `db.fn.*` callable's exact signature, derived from its own
 * `FunctionDeclaration<TArgs, TReturns>` instantiation (task 4.10a's own
 * generic expansion is what makes `TArgs`/`TReturns` visible here at
 * all).
 */
export type FnCallerFor<TDeclaration extends FunctionDeclaration> =
	TDeclaration extends FunctionDeclaration<infer TArgs, infer TReturns>
		? (args: FnArgsInput<TArgs>) => Promise<FnResult<TReturns>>
		: never;

/**
 * Filters a `Schema` module down to just its function-shaped exports,
 * preserving each one's own precise `FunctionDeclaration<TArgs,
 * TReturns>` instantiation — a key-remapping mapped type (an `as`
 * clause), not the widened `Record<string, FunctionDeclaration>`
 * `db.ts`'s own `functionsOf` returns at runtime (that widened form is
 * exactly what would erase `TArgs`/`TReturns` before `db.fn` could ever
 * see them; the two disagree on purpose — one is a compile-time filter,
 * the other a runtime one, and `db()`'s own cast at its return boundary
 * is what reconciles them, same pattern as every other cast in this
 * group).
 */
export type FunctionsOf<TSchema extends Schema> = {
	readonly [K in keyof TSchema as TSchema[K] extends FunctionDeclaration
		? K
		: never]: TSchema[K] extends FunctionDeclaration ? TSchema[K] : never;
};

/**
 * `db.fn`'s own precisely-typed shape (task 4.10): one
 * {@link FnCallerFor} per declared function, keyed **exactly** to the
 * declarations record's own export names — owner decision ③'s static
 * pinning, done at the type level: `Record<string, FunctionDeclaration>`
 * (the loose runtime shape `fn.ts`'s own `FnApi` carries) would let
 * `db.fn.doesNotExist(...)` type-check; a mapped type over the real
 * `TFunctions` keys can't.
 */
export type TypedFnApi<TFunctions extends Record<string, FunctionDeclaration>> =
	{
		readonly [K in keyof TFunctions]: FnCallerFor<TFunctions[K]>;
	};
