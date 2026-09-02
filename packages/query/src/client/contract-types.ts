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

type ContractMetadataBase = {
	readonly roles: ReadonlyArray<string>;
	readonly tables: { readonly [tableName: string]: ContractTableMeta };
};

/**
 * A `vendor`-written contract's own origin fields (CI-G5-R1-02) — see
 * `contract/emit.ts`'s `GitContractOrigin`, the emitting side of this
 * same shape. `source` is optional here, unlike the database variant's
 * own required literal (schema-vendoring spec: "A contract vendored
 * before the origin was named ... SHALL still type-check against the
 * client that reads it") — a contract a pre-#604 `hejbro vendor`
 * already wrote and committed carries no `source` key at all, and
 * upgrading only the installed packages must not break it.
 */
export type GitContractMetadata = ContractMetadataBase & {
	readonly source?: "git";
	readonly commit: string;
	readonly exportHash: string;
};

/** A `pull`-written contract's own origin fields (CI-G5-R1-02) — see `contract/emit.ts`'s `DatabaseContractOrigin`. No `commit`: this shape is how a reader that forgets a database-sourced contract fails to compile rather than at run time. */
export type DatabaseContractMetadata = ContractMetadataBase & {
	readonly source: "database";
	readonly database: string;
	readonly schemas: ReadonlyArray<string>;
};

/** `contractMetadata`'s own full shape — see `contract/emit.ts`'s `renderMetadata`. A discriminated union on `source` (CI-G5-R1-02): `vendor` and `pull` write two different origin shapes into the exact same constant name, and this package restates both here rather than one, the same reason it restates the shape at all -- a reader (this package's own `createNameKeyedDb`, or any code consuming a vendored contract's `contractMetadata`) that forgets the database-sourced case fails to compile, not at run time. */
export type ContractMetadata = GitContractMetadata | DatabaseContractMetadata;
