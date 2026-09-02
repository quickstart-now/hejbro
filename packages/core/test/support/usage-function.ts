import type { FunctionDeclaration } from "../../src/dsl/define-function";
import { defineFunction } from "../../src/dsl/define-function";
import { schema } from "../../src/dsl/schema";
import { sql } from "../../src/expr/sql-template";
import { bigint } from "../../src/types/column-builder-factories";

/**
 * A hand-assembled `"usage"`-authority function, the sibling of
 * `usage-table.ts`'s `buildUsageTable` (#587/G3): `defineFunction()` never
 * sets `authority` itself (it's a marker only a vendored/synthesized
 * declaration carries — see `@hejbro/query`'s `synthesizeFunction`), so
 * reaching the runtime chokepoint here requires building one by hand,
 * exactly as that synthesis path does.
 */
export const buildUsageFunction = (
	schemaName: string,
	functionName: string,
): FunctionDeclaration => {
	const declared = defineFunction(
		schema(schemaName),
		functionName,
		{ returns: bigint({ mode: "number" }) },
		(ctx) => {
			ctx.return(sql`1`);
		},
	);
	return { ...declared, authority: "usage" };
};
