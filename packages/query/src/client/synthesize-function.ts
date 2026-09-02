import type { FunctionDeclaration } from "@hejbro/core";
import type { ContractFunctionMeta } from "./contract-types";

/** `ContractFunctionMeta["returns"]`'s own `kind` reads as `FunctionDeclaration["returns"]`'s own `returnsKind` union — never `"trigger"`, since `contract/functions.ts`'s own `computeFunctions` already drops a trigger-synthesized function before it ever reaches a vendored contract (schema-vendoring delta, "A synthesized trigger function is absent"), so there is no vendored fact to reconstruct that variant from. */
const synthesizeReturns = (
	returns: ContractFunctionMeta["returns"],
): FunctionDeclaration["returns"] => {
	if (returns.kind === "scalar") {
		return {
			returnsKind: "scalar",
			typeNode: returns.typeNode,
			mode: returns.mode,
		};
	}
	return {
		returnsKind: "setofTable",
		schemaName: returns.schema,
		tableName: returns.name,
	};
};

/**
 * Builds a real, callable `FunctionDeclaration` from one function's
 * vendored metadata (#587/G3) — the same reconstruction role
 * `synthesizeTable` (`synthesize.ts`) plays for a table, reused unchanged
 * by `db()`/`db.fn` (`createFnApi` reads only `schemaName`/`functionName`/
 * `args[].key`/`.argName`/`.typeNode`/`.mode`/`.notNullElements`/
 * `returns.*`, confirmed by reading `fn.ts` directly — none of the fields
 * below this comment ever reach a query). `security`/`body`/`declaredAt`
 * are honest, least-committal placeholders (the same convention
 * `synthesize.ts`'s own `synthesizeColumnState` already uses for a
 * column's own unread DDL facts) — a real declaration's `security` is
 * never read at query time, and there is no real plpgsql body behind a
 * vendored fact, only the type and call shape the contract actually
 * carries. A separate file from `synthesize.ts` on purpose (not grouped
 * with the table half): a parallel piece is editing that file's own
 * `synthesizeTable`, and this function has no dependency on it.
 *
 * **Deliberately no new rejection marker, and this is a narrower
 * guarantee than `synthesizeTable`'s `existing: true`, not the same one
 * relabeled** — `FunctionDeclaration` has no `existing`/`authority` field
 * at all (core has no "existing function" concept the way it has an
 * "existing table" one for `@hejbro/supabase`'s `authUsers`), so there is
 * no marker to reuse and nothing here refuses a synthesized function
 * handed to `generateMigration` — measured directly: it accepts one
 * silently and would emit a migration creating a function with an empty
 * plpgsql body. The actual boundary is structural, not an active guard:
 * `@hejbro/query` never imports `generateMigration` at all, so no code
 * path *this package* owns can reach that outcome — `no-fn-leak.test.ts`
 * proves the narrower, real claim (the client's public `fn` surface
 * carries no `FunctionDeclaration` shape), not migration-refusal.
 */
export const synthesizeFunction = (
	meta: ContractFunctionMeta,
): FunctionDeclaration => ({
	declarationKind: "function",
	schemaName: meta.schema,
	functionName: meta.name,
	args: meta.args.map((arg) => ({
		key: arg.key,
		argName: arg.sqlName,
		typeNode: arg.typeNode,
		mode: arg.mode,
		notNullElements: arg.notNullElements,
	})),
	returns: synthesizeReturns(meta.returns),
	security: "invoker",
	body: { declarations: [], statements: [] },
	declaredAt: null,
});
