import { throwHejbroError } from "../error";
import type { Expr } from "../expr/ast";
import { expr } from "../expr/ast";
import { familyOfTypeNode } from "../expr/type-family";
import type { FunctionBody } from "../plpgsql/body-ast";
import type { BodyContext } from "../plpgsql/body-context";
import { createRecordingContext } from "../plpgsql/body-context";
import { assertValidLocalName } from "../plpgsql/reserved";
import type { BuilderFamily, ColumnBuilder } from "../types/column-builder";
import type { TypeNode } from "../types/type-node";
import type { Table } from "./table";
import { getTableMeta, isTable, toSnakeCase } from "./table";

/** What a function can declare it returns — a table (`returns setof …`), the trigger sentinel (defineTrigger-only), or a scalar type. */
export type FunctionReturns =
	| Table
	| { readonly returnsKind: "trigger" }
	| TypeNode;

/** A recorded `defineFunction`/`defineTrigger`-internal function declaration. */
export type FunctionDeclaration = {
	readonly declarationKind: "function";
	readonly schemaName: string;
	readonly functionName: string;
	readonly args: ReadonlyArray<{
		readonly argName: string;
		readonly typeNode: TypeNode;
	}>;
	readonly returns:
		| { readonly returnsKind: "trigger" }
		| {
				readonly returnsKind: "setofTable";
				readonly schemaName: string;
				readonly tableName: string;
		  }
		| { readonly returnsKind: "scalar"; readonly typeNode: TypeNode };
	readonly security: "invoker" | "definer";
	readonly body: FunctionBody;
	readonly declaredAt: string | null;
};

/** Maps a `defineFunction` `args` config to the `Expr` refs its body callback receives. */
export type ArgRefs<TArgs extends Record<string, ColumnBuilder>> = {
	readonly [K in keyof TArgs]: Expr<BuilderFamily<TArgs[K]>>;
};

const resolveFunctionReturns = (
	identity: string,
	returns: Table | TypeNode | undefined,
): FunctionDeclaration["returns"] => {
	if (returns === undefined) {
		return throwHejbroError(
			"missing-function-returns",
			`defineFunction() "${identity}" requires a "returns" config — pass a table (for "returns setof …") or a TypeNode (for a scalar return).`,
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
	return { returnsKind: "scalar", typeNode: returns };
};

type ResolvedArgs<TArgs extends Record<string, ColumnBuilder>> = {
	readonly declarations: ReadonlyArray<{
		readonly argName: string;
		readonly typeNode: TypeNode;
	}>;
	readonly refs: ArgRefs<TArgs>;
};

const resolveArgs = <TArgs extends Record<string, ColumnBuilder>>(
	identity: string,
	declaredAt: string | null,
	args: TArgs | undefined,
): ResolvedArgs<TArgs> => {
	const resolved = Object.entries(args ?? {}).map(([key, builder]) => {
		const argName = toSnakeCase(key);
		assertValidLocalName(argName, identity, declaredAt);
		return {
			key,
			argName,
			typeNode: builder.columnState.typeNode,
			family: familyOfTypeNode(builder.columnState.typeNode),
		};
	});

	const declarations = resolved.map((entry) => ({
		argName: entry.argName,
		typeNode: entry.typeNode,
	}));

	const refs = Object.fromEntries(
		resolved.map((entry) => [
			entry.key,
			expr(entry.family, { nodeKind: "plpgsqlRef", path: [entry.argName] }),
		]),
	) as ArgRefs<TArgs>;

	return { declarations, refs };
};

/**
 * Declares a Postgres function: `config.args` becomes its typed parameter
 * list, `body` records its plpgsql (run once here — Task 3 adds the
 * double-run determinism guard around this same call).
 */
export const defineFunction = <TArgs extends Record<string, ColumnBuilder>>(
	schemaName: string,
	functionName: string,
	config: {
		readonly args?: TArgs;
		readonly returns?: Table | TypeNode;
		readonly security?: "invoker" | "definer";
	},
	body: (ctx: BodyContext, args: ArgRefs<TArgs>) => void,
): FunctionDeclaration => {
	const identity = `${schemaName}.${functionName}`;
	const declaredAt: string | null = null;
	const security = config.security ?? "invoker";
	const returns = resolveFunctionReturns(identity, config.returns);
	const { declarations: argDeclarations, refs } = resolveArgs(
		identity,
		declaredAt,
		config.args,
	);

	const { ctx, finish } = createRecordingContext(identity, declaredAt);
	body(ctx, refs);

	return {
		declarationKind: "function",
		schemaName,
		functionName,
		args: argDeclarations,
		returns,
		security,
		body: finish(),
		declaredAt,
	};
};
