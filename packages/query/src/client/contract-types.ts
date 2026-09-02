import type { NumericMode, TypeNode } from "@hejbro/core";

/**
 * The runtime shape `hejbro`'s own `contract/emit.ts` writes into every
 * vendored contract's `contractMetadata` constant — restated here rather
 * than imported, the same boundary `@hejbro/core`'s own internal snapshot
 * shapes are restated across (this package has no dependency on
 * `hejbro`/`@hejbro/cli` at all, and never should: the CLI is the only
 * place that touches the filesystem, `AGENTS.md`'s own repo map). This is
 * a structural contract between the two packages, proven by
 * `query/test/client/*`'s own fixtures matching what `emitContract`
 * actually produces (not a hand-typed guess) rather than by a shared
 * import.
 */
export type ContractColumnMeta = {
	readonly sqlName: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/** A vendored foreign key, target schema/name already split out — see `contract/tables.ts`'s own `ContractForeignKeyMeta` (the emitting side of this same shape). */
export type ContractForeignKeyMeta = {
	readonly name: string;
	readonly columns: ReadonlyArray<string>;
	readonly referencesSchema: string;
	readonly referencesTable: string;
	readonly referencedColumns: ReadonlyArray<string>;
};

/** One table's vendored facts — see `contract/tables.ts`'s own `TableClientMeta`. */
export type ContractTableMeta = {
	readonly schema: string;
	readonly name: string;
	readonly columns: { readonly [tsKey: string]: ContractColumnMeta };
	readonly foreignKeys: ReadonlyArray<ContractForeignKeyMeta>;
};

/** One function argument's vendored facts — see `contract/functions.ts`'s own `FunctionArgMeta`. */
export type ContractFunctionArgMeta = {
	readonly key: string;
	readonly sqlName: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/** A function's vendored return shape — see `contract/functions.ts`'s own `FunctionReturnsMeta`. A table return names the returned table's SQL identity, never its export name (`Database["Tables"]` is itself SQL-name-keyed). */
export type ContractFunctionReturnsMeta =
	| {
			readonly kind: "scalar";
			readonly typeNode: TypeNode;
			readonly mode: NumericMode | null;
	  }
	| { readonly kind: "table"; readonly schema: string; readonly name: string };

/** One function's vendored facts — see `contract/functions.ts`'s own `FunctionClientMeta`. */
export type ContractFunctionMeta = {
	readonly schema: string;
	readonly name: string;
	readonly args: ReadonlyArray<ContractFunctionArgMeta>;
	readonly returns: ContractFunctionReturnsMeta;
};

/** `contractMetadata`'s own full shape — see `contract/emit.ts`'s `renderMetadata`. */
export type ContractMetadata = {
	readonly commit: string;
	readonly exportHash: string;
	readonly roles: ReadonlyArray<string>;
	readonly tables: { readonly [tableName: string]: ContractTableMeta };
	readonly functions: { readonly [exportName: string]: ContractFunctionMeta };
};
