import type { SelectNode, SetOpNode, WithNode } from "@hejbro/core";
import { renderQuery, renderSelect, renderSetOp } from "@hejbro/core";
import { liftSelectNode, liftSetOpNode, liftWithNode } from "./params";

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

/** Compiles a {@link SetOpNode} the same way — lift both branches and the whole-set orderBy, render the substituted node through core's own `renderSetOp` (add-set-operations). */
export const compileSetOp = (node: SetOpNode): CompiledSelect => {
	const lifted = liftSetOpNode(node, 1);
	return { sql: renderSetOp(lifted.node), params: lifted.params };
};

/**
 * Compiles a {@link WithNode} (add-ctes, task 5.1): every entry's own
 * query lifts in declaration order, then the body, matching the rendered
 * text's own left-to-right order (`with "a" as (...), "b" as (...)
 * <body>`) so `$n` numbering follows it. Rendered through core's own
 * `renderQuery` — unlike `renderSelect`/`renderSetOp` above, there is no
 * `renderWith` export; `renderQuery` is the public entry point that
 * dispatches on `queryKind`, "with" included.
 */
export const compileWith = (node: WithNode): CompiledSelect => {
	const lifted = liftWithNode(node, 1);
	return { sql: renderQuery(lifted.node), params: lifted.params };
};
