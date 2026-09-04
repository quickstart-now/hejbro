import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { Expr } from "../expr/ast";
import { expr } from "../expr/ast";
import type { SqlTypeFamily } from "../expr/type-family";
import { familyOfTypeNode } from "../expr/type-family";
import type { FunctionBody } from "../plpgsql/body-ast";
import type { BodyContext } from "../plpgsql/body-context";
import { recordBodyWithGuard } from "../plpgsql/body-context";
import { assertValidLocalName } from "../plpgsql/reserved";
import { assertSqlName } from "../sql/identifier-rules";
import type {
	BuilderFamily,
	ColumnBuilder,
	NumericMode,
} from "../types/column-builder";
import type { TypeNode } from "../types/type-node";
import type { SchemaDeclaration } from "./schema";
import type { Table, TableAuthority } from "./table";
import { getTableMeta, isTable, toSnakeCase } from "./table";

/** What a function can declare it returns — a table (`returns setof …`), the trigger sentinel (defineTrigger-only), or a scalar type, written as a raw `TypeNode` or a column builder (#433 — the same form `args` already accepts). */
export type FunctionReturns =
	| Table
	| { readonly returnsKind: "trigger" }
	| TypeNode
	| ColumnBuilder;

/**
 * Hides {@link FunctionDeclaration}'s type-only `TArgs`/`TReturns` marker
 * behind a unique symbol (same technique as `column-builder.ts`'s
 * `columnMetaBrand`, D15/g3 precedent). Never assigned at runtime: every
 * `FunctionDeclaration` (`defineFunction`'s own return, and
 * `defineTrigger`'s directly-constructed literal) only ever sets the
 * plain runtime fields, so without this a non-recursive mention of
 * `TArgs`/`TReturns` would exist nowhere at all — `args`/`returns` are
 * plain, already-resolved runtime shapes (`ReadonlyArray<{key, argName,
 * typeNode, mode, notNullElements}>`, a `returnsKind` union) that never
 * reference the generic
 * parameters, not even recursively through another method the way
 * `ColumnBuilder`'s own chain methods do. Without this anchor,
 * `FunctionDeclaration<A>` and `FunctionDeclaration<B>` would be
 * structurally identical for any `A`/`B` and mutually assignable —
 * task 4.10's own `@ts-expect-error` probes would all pass regardless
 * of whether the generic actually did anything.
 *
 * Plain `Symbol()`, not `Symbol.for(...)`, and not exported (D90-era
 * default for a phantom anchor with no cross-instance runtime lookup —
 * nothing ever reads `declaration[functionDeclarationBrand]`; exporting
 * would only grow the public surface, and this repo's changeset scope
 * with it, for no benefit `columnMetaBrand`'s own tsdoc didn't already
 * rule out for the identical reason).
 */
const functionDeclarationBrand: unique symbol = Symbol(
	"hejbro:function-declaration-meta",
);

/**
 * A recorded `defineFunction`/`defineTrigger`-internal function
 * declaration. `TArgs`/`TReturns` default to the widest shape either
 * call site can produce, so every existing non-generic consumer
 * (`function-kind.ts`'s `ObjectKind<FunctionDeclaration>`,
 * `define-trigger.ts`'s directly-constructed literal, `render-body.ts`)
 * keeps compiling unchanged against the bare `FunctionDeclaration` name
 * — task 4.10, mirroring task 3.x's own `ColumnBuilder<TFamily, TMeta>`
 * defaults.
 */
export type FunctionDeclaration<
	TArgs extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
	TReturns extends
		| Table
		| TypeNode
		| ColumnBuilder
		| { readonly returnsKind: "trigger" } =
		| Table
		| TypeNode
		| ColumnBuilder
		| { readonly returnsKind: "trigger" },
> = {
	readonly declarationKind: "function";
	readonly schemaName: string;
	readonly functionName: string;
	readonly args: ReadonlyArray<{
		readonly key: string;
		readonly argName: string;
		readonly typeNode: TypeNode;
		readonly mode: NumericMode | null;
		readonly notNullElements: boolean;
	}>;
	readonly returns:
		| { readonly returnsKind: "trigger" }
		| {
				readonly returnsKind: "setofTable";
				readonly schemaName: string;
				readonly tableName: string;
		  }
		| {
				readonly returnsKind: "scalar";
				readonly typeNode: TypeNode;
				/** The declared numeric mode (#433) — `null` for a raw `TypeNode` return, which carries no mode of its own; `db.fn`'s conversion reads this instead of re-deriving a default from `typeNode` alone, so a builder-declared `bigint({ mode: "number" })` return arrives as `number`, not `bigint`. */
				readonly mode: NumericMode | null;
		  };
	readonly security: "invoker" | "definer";
	readonly body: FunctionBody;
	readonly declaredAt: string | null;
	/**
	 * Absent for every `defineFunction()`/`defineTrigger()` call (real,
	 * migration-owning declarations never set this) — reuses
	 * {@link TableAuthority}'s own name and values so both families read as
	 * one convention. Only a synthesized declaration built outside this
	 * function (`@hejbro/query`'s `synthesizeFunction`, standing in for the
	 * deleted `syncedTable()`-era constructor's function sibling) sets
	 * `"usage"`, which `engine/generate.ts`'s runtime chokepoint refuses —
	 * unlike a table, there is no `existing`-style flag or type-level
	 * narrowing for a function, so this field is the only guard.
	 */
	readonly authority?: TableAuthority;
	/** Type-only marker, never assigned — see {@link functionDeclarationBrand}. */
	readonly [functionDeclarationBrand]?: {
		readonly args: TArgs;
		readonly returns: TReturns;
	};
};

/** Maps a `defineFunction` `args` config to the `Expr` refs its body callback receives. */
export type ArgRefs<TArgs extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TArgs]: Expr<BuilderFamily<TArgs[K]>>;
};

/** `true` for a column builder — the same runtime discriminator `resolveArgs` relies on implicitly (no `isColumnBuilder` exists elsewhere in the codebase; `columnState` is the one field every `ColumnBuilder` instantiation carries and a `Table`/`TypeNode` never does). */
const isColumnBuilder = (value: object): value is ColumnBuilder =>
	"columnState" in value;

/** {@link resolveFunctionReturns}'s builder-scalar half — split out to keep the caller's own branch count under the CRAP gate (#154 ratchet-5) now that a builder return also has its own rejection to check. */
const resolveScalarBuilderReturns = (
	identity: string,
	declaredAt: string | null,
	returns: ColumnBuilder,
): FunctionDeclaration["returns"] => {
	if (returns.columnState.notNullElements === true) {
		return throwHejbroError(
			"returns-not-null-elements-unsupported",
			`defineFunction() "${identity}" declares "returns" with .notNullElements(), but a returns clause derives no constraint the way a column's backing CHECK does — Postgres would still be free to return an array with a null element, so the flag would promise something nothing enforces. Next: drop .notNullElements() from the "returns" builder; the same builder stays legitimate as an arg or a table column.`,
			declaredAt,
		);
	}
	return {
		returnsKind: "scalar",
		typeNode: returns.columnState.typeNode,
		mode: returns.columnState.mode,
	};
};

const resolveFunctionReturns = (
	identity: string,
	declaredAt: string | null,
	returns: Table | TypeNode | ColumnBuilder | undefined,
): FunctionDeclaration["returns"] => {
	if (returns === undefined) {
		return throwHejbroError(
			"missing-function-returns",
			`defineFunction() "${identity}" requires a "returns" config. Next: pass a table (for "returns setof …"), a column builder, or a TypeNode (for a scalar return).`,
			declaredAt,
		);
	}
	if (isTable(returns)) {
		const meta = getTableMeta(returns);
		return {
			returnsKind: "setofTable",
			schemaName: meta.schema.schemaName,
			tableName: meta.tableName,
		};
	}
	if (isColumnBuilder(returns)) {
		return resolveScalarBuilderReturns(identity, declaredAt, returns);
	}
	return { returnsKind: "scalar", typeNode: returns, mode: null };
};

type ResolvedArgs<TArgs extends Record<string, ColumnBuilder>> = {
	readonly declarations: ReadonlyArray<{
		readonly key: string;
		readonly argName: string;
		readonly typeNode: TypeNode;
		readonly mode: NumericMode | null;
		readonly notNullElements: boolean;
	}>;
	readonly refs: ArgRefs<TArgs>;
};

/**
 * A literal `__proto__:` key in an object literal (unlike a computed
 * `["__proto__"]` key) replaces the object's prototype instead of
 * defining an own property, so that one key never reaches
 * `Object.entries` at all — a caller who wrote it gets a function that
 * silently declares no argument under it, not a name to validate.
 * `Object.getPrototypeOf` only observes "the prototype was replaced", not
 * "the caller wrote `__proto__:`" (a caller passing a custom prototype
 * object never wrote that key either), so the message states the
 * observation and its most common cause separately, never the other way
 * around. `null` is legitimate (`Object.create(null)`), and `args` itself
 * being `undefined` (no `args` config at all) is not this check's
 * concern.
 */
const assertArgsPrototypeNotReplaced = (
	identity: string,
	declaredAt: string | null,
	args: object,
): void => {
	const argsPrototype = Object.getPrototypeOf(args);
	if (argsPrototype === Object.prototype || argsPrototype === null) {
		return;
	}
	throwHejbroError(
		"args-prototype-key",
		`defineFunction() "${identity}" received an "args" object whose prototype is neither Object.prototype nor null. This is what a literal __proto__: key in an object literal does — it replaces the prototype instead of declaring an argument. Next: declare it as a computed key ["__proto__"] (which is then refused as an invalid SQL name), rename the argument, or pass a plain object literal.`,
		declaredAt,
	);
};

/**
 * The first pair of resolved args whose `argName` collides, in
 * declaration order — `null` when every `argName` is unique. Mirrors
 * `buildColumnEntries`'s duplicate-column search, but a column only ever
 * needs the shared name, while an argument's message names both
 * declaration-order keys behind it.
 */
const findDuplicateArgName = (
	resolved: ReadonlyArray<{ readonly key: string; readonly argName: string }>,
): { readonly firstKey: string; readonly secondKey: string; readonly argName: string } | null => {
	const duplicateIndex = resolved.findIndex((entry, index) =>
		resolved
			.slice(0, index)
			.some((earlier) => earlier.argName === entry.argName),
	);
	if (duplicateIndex === -1) {
		return null;
	}
	const duplicate = resolved[duplicateIndex] as {
		key: string;
		argName: string;
	};
	const firstIndex = resolved.findIndex(
		(entry) => entry.argName === duplicate.argName,
	);
	const first = resolved[firstIndex] as { key: string; argName: string };
	return {
		firstKey: first.key,
		secondKey: duplicate.key,
		argName: duplicate.argName,
	};
};

/**
 * Throws `duplicate-argument` when two `args` keys derive to the same SQL
 * name — the argument-side counterpart of `buildColumnEntries`'s
 * `duplicate-column` refusal, over the whole list at once, after every
 * key's own per-key refusals already ran.
 */
const assertNoDuplicateArgName = (
	identity: string,
	declaredAt: string | null,
	resolved: ReadonlyArray<{ readonly key: string; readonly argName: string }>,
): void => {
	const duplicate = findDuplicateArgName(resolved);
	if (duplicate === null) {
		return;
	}
	throwHejbroError(
		"duplicate-argument",
		`defineFunction() "${identity}" declares arguments "${duplicate.firstKey}" and "${duplicate.secondKey}" that both derive to the SQL name "${duplicate.argName}". Next: rename one of the two keys so their snake_case names differ.`,
		declaredAt,
	);
};

const resolveArgs = <TArgs extends Record<string, ColumnBuilder>>(
	identity: string,
	declaredAt: string | null,
	args: TArgs | undefined,
): ResolvedArgs<TArgs> => {
	if (args !== undefined) {
		assertArgsPrototypeNotReplaced(identity, declaredAt, args);
	}
	const resolved = Object.entries(args ?? {}).map(([key, builder]) => {
		const argName = toSnakeCase(key);
		assertSqlName(
			argName,
			`argument "${key}" of function ${identity}`,
			declaredAt,
		);
		assertValidLocalName(argName, identity, declaredAt);
		return {
			key,
			argName,
			typeNode: builder.columnState.typeNode,
			mode: builder.columnState.mode,
			notNullElements: builder.columnState.notNullElements === true,
			family: familyOfTypeNode(builder.columnState.typeNode),
		};
	});
	assertNoDuplicateArgName(identity, declaredAt, resolved);

	const declarations = resolved.map((entry) => ({
		key: entry.key,
		argName: entry.argName,
		typeNode: entry.typeNode,
		mode: entry.mode,
		notNullElements: entry.notNullElements,
	}));

	const refs = Object.fromEntries(
		resolved.map((entry) => [
			entry.key,
			expr(entry.family, { nodeKind: "plpgsqlRef", path: [entry.argName] }),
		]),
	) as ArgRefs<TArgs>;

	return { declarations, refs };
};

/** The declared `returns` family `ctx.return(<expr>)` is cross-checked against — `null` for a setof or trigger declaration, which returns no scalar expression. */
const scalarReturnFamilyOf = (
	returns: FunctionDeclaration["returns"],
): SqlTypeFamily | null => {
	if (returns.returnsKind === "scalar") {
		return familyOfTypeNode(returns.typeNode);
	}
	return null;
};

/** The schema name a `defineFunction` owner argument resolves to, whichever form it was given. */
const schemaNameOf = (owner: SchemaDeclaration | string): string => {
	if (typeof owner === "string") {
		return owner;
	}
	return owner.schemaName;
};

/**
 * Declares a Postgres function: `config.args` becomes its typed parameter
 * list, `body` records its plpgsql. `body` runs **twice** with fresh
 * recording contexts — the two recorded trees must be structurally
 * identical, or this throws `nondeterministic-body` (spec §6.2 decision A4).
 */
export const defineFunction = <
	TArgs extends Record<string, ColumnBuilder>,
	TReturns extends Table | TypeNode | ColumnBuilder =
		| Table
		| TypeNode
		| ColumnBuilder,
>(
	/**
	 * The declared schema (`schema("app")`), like `table`/`defineView`/`grant`.
	 * @deprecated Passing the schema name as a string is accepted on 0.1.x
	 * for compatibility and is removed in 0.2.0 — pass the `schema(...)`
	 * object instead.
	 */
	owner: SchemaDeclaration | string,
	functionName: string,
	config: {
		readonly args?: TArgs;
		readonly returns?: TReturns;
		readonly security?: "invoker" | "definer";
	},
	body: (ctx: BodyContext, args: ArgRefs<TArgs>) => void,
): FunctionDeclaration<TArgs, TReturns> => {
	const schemaName = schemaNameOf(owner);
	const identity = `${schemaName}.${functionName}`;
	const declaredAt = captureDeclarationSite();
	const security = config.security ?? "invoker";
	const returns = resolveFunctionReturns(identity, declaredAt, config.returns);
	const { declarations: argDeclarations, refs } = resolveArgs(
		identity,
		declaredAt,
		config.args,
	);

	const functionBody = recordBodyWithGuard(
		identity,
		declaredAt,
		returns.returnsKind,
		scalarReturnFamilyOf(returns),
		(ctx) => body(ctx, refs),
	);

	return {
		declarationKind: "function",
		schemaName,
		functionName,
		args: argDeclarations,
		returns,
		security,
		body: functionBody,
		declaredAt,
	};
};
