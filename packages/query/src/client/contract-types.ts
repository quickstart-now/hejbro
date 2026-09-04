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

/**
 * One column's vendored facts in the snapshot's physical order (#740/D4) —
 * {@link ContractColumnMeta} plus the TS key a JavaScript object's own
 * property could carry (an integer-like name, `__proto__`, `constructor`)
 * but never in a caller-visible, order-independent way. See
 * `contract/tables.ts`'s own `ContractColumnEntry` (the emitting side of
 * this same shape).
 */
export type ContractColumnEntry = ContractColumnMeta & { readonly key: string };

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
 *
 * `columns` (#740/D4) is a union: the physical-order list every contract
 * `hejbro vendor`/`hejbro generate --export` writes from now on, or the
 * pre-#740 object-keyed map a contract vendored before the list existed
 * still carries — `synthesize.ts`'s own `columnEntries` reads either
 * shape through one helper, so an older vendored contract still builds a
 * client (its statements keep the order that map's own JS key
 * enumeration yields, exactly as before).
 */
export type ContractTableMeta = {
	readonly schema: string;
	readonly name: string;
	readonly columns:
		| ReadonlyArray<ContractColumnEntry>
		| { readonly [tsKey: string]: ContractColumnMeta };
	readonly foreignKeys: ReadonlyArray<ContractForeignKeyMeta>;
	readonly existing?: true;
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

type ContractMetadataBase = {
	readonly roles: ReadonlyArray<string>;
	readonly tables: { readonly [tableName: string]: ContractTableMeta };
	/** Optional for the same reason `GitContractMetadata.source` is (#659): a contract vendored before the typed function surface existed (pre-#587) carries no `functions` key at all, and upgrading only the installed packages must not break it. */
	readonly functions?: { readonly [exportName: string]: ContractFunctionMeta };
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
