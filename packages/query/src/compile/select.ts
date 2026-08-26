import type { SelectNode } from "@hejbro/core";
import { renderSelect } from "@hejbro/core";
import { liftSelectNode } from "./params";

/** A rendered `SelectNode`: SQL text plus the bind parameters its literals lifted to. */
export type CompiledSelect = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};

/**
 * Compiles a {@link SelectNode} to parameterized SQL: every literal lifts to
 * a `$n` bind parameter in render order (projection → from → joins → where
 * → orderBy), then core's `renderSelect` renders the substituted node
 * unchanged — inheriting its identifier quoting, keyword rendering, and
 * `foreign-column-ref` scope validation for free.
 */
export const compileSelect = (node: SelectNode): CompiledSelect => {
	const lifted = liftSelectNode(node, 1);
	return { sql: renderSelect(lifted.node), params: lifted.params };
};
