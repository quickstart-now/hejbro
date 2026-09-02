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

/**
 * One table's vendored facts — see `contract/tables.ts`'s own
 * `TableClientMeta`. `existing` (add-unmanaged-objects, 3.1) is
 * **compact** — present (`true`) only for an existing table, absent for
 * a managed one, matching the emitting side's own convention — no code
 * in this package reads it today; it is carried for the reader of the
 * generated file and for tooling built on it.
 */
export type ContractTableMeta = {
	readonly schema: string;
	readonly name: string;
	readonly columns: { readonly [tsKey: string]: ContractColumnMeta };
	readonly foreignKeys: ReadonlyArray<ContractForeignKeyMeta>;
	readonly existing?: true;
};

/** `contractMetadata`'s own full shape — see `contract/emit.ts`'s `renderMetadata`. */
export type ContractMetadata = {
	readonly commit: string;
	readonly exportHash: string;
	readonly roles: ReadonlyArray<string>;
	readonly tables: { readonly [tableName: string]: ContractTableMeta };
};
