import type { NumericMode, TypeNode } from "@hejbro/core";
import type {
	ExportDescription,
	ExportFunctionArgFact,
} from "../export/description";
import type { ExportPayload } from "../export/write";
import type { ContractEnumFact } from "./read-snapshot";
import type { TableComputation } from "./tables";
import { renderKey } from "./tables";
import { columnTsType } from "./ts-type";

/** `ExportDescription`'s own `functions` element type, restated via indexed access rather than a named import — `ExportFunctionFact` itself is description.ts's own internal type, not exported (G1's own file boundary). */
type ExportFunctionFact = ExportDescription["functions"][number];

type EnumLookup = (schema: string, name: string) => ContractEnumFact | null;

/**
 * One argument's full computed facts — the declared key beside its SQL
 * name (schema-export delta: a typed call names its arguments by the
 * key, never the SQL name), its rendered TS type (5.1's own mapping,
 * `columnTsType` reused unchanged: an argument *is* a column for the
 * purpose of typing a call — same type, mode, and element-nullability
 * rules), and the structured facts the runtime metadata carries
 * (`typeNode`/`mode`/`notNullElements`) for a client to reconstruct a
 * real argument at call time.
 */
export type FunctionArgComputation = {
	readonly key: string;
	readonly sqlName: string;
	readonly tsType: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

/**
 * A scalar return carries no `| null` (planner-confirmed: parity with the
 * owner's own `db.fn`, whose scalar return type carries none either — a
 * defensive `| null` here would diverge from the declaring repository's
 * own type). A table return names the returned table's SQL identity, not
 * its export name — matching `Database["Tables"]`'s own SQL-name keying.
 */
export type FunctionReturnsComputation =
	| {
			readonly kind: "scalar";
			readonly tsType: string;
			readonly typeNode: TypeNode;
			readonly mode: NumericMode | null;
	  }
	| { readonly kind: "table"; readonly schema: string; readonly name: string };

export type FunctionComputation = {
	readonly exportName: string;
	readonly schema: string;
	readonly name: string;
	readonly args: ReadonlyArray<FunctionArgComputation>;
	readonly returns: FunctionReturnsComputation;
};

const argComputation = (
	arg: ExportFunctionArgFact,
	enumLookup: EnumLookup,
): FunctionArgComputation => ({
	key: arg.key,
	sqlName: arg.sqlName,
	tsType: columnTsType(arg.typeNode, arg.mode, arg.notNullElements, enumLookup),
	typeNode: arg.typeNode,
	mode: arg.mode,
	notNullElements: arg.notNullElements,
});

/**
 * `null` when the fact's return is itself `null` (a trigger-synthesized
 * function — never reached here, since {@link functionComputation} drops
 * those before this runs, but typed defensively rather than asserted
 * away) or a table return whose table the contract does not carry (5.9's
 * own rule, extended to functions: a reference to a table the export does
 * not carry has no relation to report, so the whole function fact is
 * absent, not a partial one — `computeFunctions` checks this against the
 * exact array `computeTables` already built, so a table missing from
 * `Tables` structurally cannot appear as a function's return either).
 */
const returnsComputation = (
	fact: ExportFunctionFact,
	tables: ReadonlyArray<TableComputation>,
	enumLookup: EnumLookup,
): FunctionReturnsComputation | null => {
	const returns = fact.returns;
	if (returns === null) {
		return null;
	}
	if (returns.kind === "scalar") {
		return {
			kind: "scalar",
			tsType: columnTsType(returns.typeNode, returns.mode, false, enumLookup),
			typeNode: returns.typeNode,
			mode: returns.mode,
		};
	}
	const table = tables.find(
		(candidate) =>
			candidate.table.schema === returns.schemaName &&
			candidate.table.name === returns.tableName,
	);
	if (table === undefined) {
		return null;
	}
	return { kind: "table", schema: table.table.schema, name: table.table.name };
};

const functionComputation = (
	fact: ExportFunctionFact,
	tables: ReadonlyArray<TableComputation>,
	enumLookup: EnumLookup,
): FunctionComputation | null => {
	// A trigger-synthesized function was never a module export (schema-export
	// delta: "A declaration that was never a module export has no export name
	// to carry") -- there is no key to emit an entry under.
	if (fact.exportName === null) {
		return null;
	}
	const returns = returnsComputation(fact, tables, enumLookup);
	if (returns === null) {
		return null;
	}
	return {
		exportName: fact.exportName,
		schema: fact.schemaName,
		name: fact.functionName,
		args: fact.args.map((arg) => argComputation(arg, enumLookup)),
		returns,
	};
};

/**
 * Every exported function fact computed exactly once, mirroring
 * `emit.ts`'s own `computeTables` (6.1's condition ②): `tables` is the
 * exact array `computeTables` already built for the `Tables` section, so
 * a function returning a table the contract does not carry is dropped by
 * construction, not by a second reachability check that could drift from
 * the first.
 */
export const computeFunctions = (
	payload: ExportPayload,
	tables: ReadonlyArray<TableComputation>,
	enumLookup: EnumLookup,
): ReadonlyArray<FunctionComputation> =>
	payload.functions
		.map((fact) => functionComputation(fact, tables, enumLookup))
		.filter((entry): entry is FunctionComputation => entry !== null);

const renderFunctionArgsType = (
	args: ReadonlyArray<FunctionArgComputation>,
): string => {
	if (args.length === 0) {
		return "Record<string, never>";
	}
	const fields = args
		.map((arg) => `readonly ${renderKey(arg.key)}: ${arg.tsType};`)
		.join(" ");
	return `{ ${fields} }`;
};

const renderFunctionReturnsType = (
	returns: FunctionReturnsComputation,
): string => {
	if (returns.kind === "scalar") {
		return returns.tsType;
	}
	return `ReadonlyArray<Database["Tables"][${JSON.stringify(returns.name)}]["Row"]>`;
};

/** One `Database["Functions"][exportName]` entry's own source text, keyed by the function's export name (schema-vendoring spec: `Functions` is keyed by export name, unlike `Tables`' own SQL-name keying — a function is called the way the declaring repository calls it). */
export const renderFunctionEntry = (fn: FunctionComputation): string =>
	`\t\t${JSON.stringify(fn.exportName)}: {
\t\t\treadonly Args: ${renderFunctionArgsType(fn.args)};
\t\t\treadonly Returns: ${renderFunctionReturnsType(fn.returns)};
\t\t};`;

/** The runtime metadata's own per-argument fact — mirrors `export/description.ts`'s own `ExportFunctionArgFact`, structured for a client to reconstruct a real argument at call time (the same three facts `ContractColumnMeta` already carries per column, plus the key). */
export type FunctionArgMeta = {
	readonly key: string;
	readonly sqlName: string;
	readonly typeNode: TypeNode;
	readonly mode: NumericMode | null;
	readonly notNullElements: boolean;
};

export type FunctionReturnsMeta =
	| {
			readonly kind: "scalar";
			readonly typeNode: TypeNode;
			readonly mode: NumericMode | null;
	  }
	| { readonly kind: "table"; readonly schema: string; readonly name: string };

/**
 * A function's schema-qualified SQL identity, its ordered argument facts,
 * and its return shape — the runtime fact `contractMetadata.functions`
 * carries (mirroring `TableClientMeta`'s own reasoning): without it, a
 * client would have to read `schema.json` at runtime to render a call at
 * all.
 */
export type FunctionClientMeta = {
	readonly schema: string;
	readonly name: string;
	readonly args: ReadonlyArray<FunctionArgMeta>;
	readonly returns: FunctionReturnsMeta;
};

const functionReturnsMeta = (
	returns: FunctionReturnsComputation,
): FunctionReturnsMeta => {
	if (returns.kind === "scalar") {
		return { kind: "scalar", typeNode: returns.typeNode, mode: returns.mode };
	}
	return { kind: "table", schema: returns.schema, name: returns.name };
};

export const buildFunctionClientMeta = (
	fn: FunctionComputation,
): FunctionClientMeta => ({
	schema: fn.schema,
	name: fn.name,
	args: fn.args.map((arg) => ({
		key: arg.key,
		sqlName: arg.sqlName,
		typeNode: arg.typeNode,
		mode: arg.mode,
		notNullElements: arg.notNullElements,
	})),
	returns: functionReturnsMeta(fn.returns),
});
