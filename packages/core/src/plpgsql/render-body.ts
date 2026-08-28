import type { FunctionDeclaration } from "../dsl/define-function";
import { assertNever, throwHejbroError } from "../error";
import type { ExprNode } from "../expr/ast";
import {
	renderExpr,
	renderQuery,
	renderSelect,
	renderSelectInto,
} from "../expr/render-sql";
import type { ColumnOrderOracle } from "../snapshot/column-order";
import {
	applyColumnOrderToQuery,
	applyColumnOrderToSelect,
	noColumnOrder,
} from "../snapshot/column-order";
import { qualifyName, quoteIdentifier } from "../sql/identifier";
import { quoteStringLiteral } from "../sql/literal";
import { renderTypeNode } from "../types/type-node";
import type { BodyStatement, PlpgsqlVarDeclaration } from "./body-ast";

const indent = (depth: number): string => "\t".repeat(depth);

const renderRaiseArgs = (args: ReadonlyArray<ExprNode>): string =>
	args.map((arg) => renderExpr(arg)).join(", ");

const renderRaiseSuffix = (args: ReadonlyArray<ExprNode>): string => {
	if (args.length === 0) {
		return "";
	}
	return `, ${renderRaiseArgs(args)}`;
};

type IfStatement = Extract<BodyStatement, { readonly stmtKind: "if" }>;

const renderElseLines = (
	statement: IfStatement,
	depth: number,
	identity: string,
	declaredAt: string | null,
	columnOrder: ColumnOrderOracle,
): ReadonlyArray<string> => {
	if (statement.elseStatements === null) {
		return [];
	}
	return [
		`${indent(depth)}else`,
		...statement.elseStatements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt, columnOrder),
		),
	];
};

const renderIfLines = (
	statement: IfStatement,
	depth: number,
	identity: string,
	declaredAt: string | null,
	columnOrder: ColumnOrderOracle,
): ReadonlyArray<string> => {
	const [firstBranch, ...restBranches] = statement.branches;
	if (firstBranch === undefined) {
		return throwHejbroError(
			"empty-if-statement",
			`a recorded if statement in ${identity} has no branches — this indicates an internal hejbro bug.`,
			declaredAt,
		);
	}

	const ifLines = [
		`${indent(depth)}if ${renderExpr(firstBranch.condition)} then`,
		...firstBranch.statements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt, columnOrder),
		),
	];
	const elsifLines = restBranches.flatMap((branch) => [
		`${indent(depth)}elsif ${renderExpr(branch.condition)} then`,
		...branch.statements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt, columnOrder),
		),
	]);
	const elseLines = renderElseLines(
		statement,
		depth,
		identity,
		declaredAt,
		columnOrder,
	);

	return [...ifLines, ...elsifLines, ...elseLines, `${indent(depth)}end if;`];
};

/**
 * One handler per {@link BodyStatement} `stmtKind`, same technique used
 * across this phase's other tree-walker/renderer switches (#154
 * ratchet-5): a mapped type over the closed union, so a missing entry is
 * a compile error. The former `switch`'s `default: assertNever(statement)`
 * was structurally unreachable (`BodyStatement` has exactly these six
 * kinds), so no test could ever reach it. `forEach`'s handler recurses
 * into {@link renderStatementLines} — resolved lazily through the closure
 * at call time, so it's fine that this map is defined before that
 * function is (unlike a handler *value* like `if`'s, which must already
 * be initialized when this object literal itself runs).
 */
type RenderStatementHandlers = {
	readonly [K in BodyStatement["stmtKind"]]: (
		statement: Extract<BodyStatement, { readonly stmtKind: K }>,
		depth: number,
		identity: string,
		declaredAt: string | null,
		columnOrder: ColumnOrderOracle,
	) => ReadonlyArray<string>;
};

const renderStatementHandlers: RenderStatementHandlers = {
	selectInto: (statement, depth, _identity, _declaredAt, columnOrder) => [
		`${indent(depth)}${renderSelectInto(applyColumnOrderToSelect(statement.query, columnOrder), statement.intoVariables, { strict: statement.strict })};`,
	],
	raise: (statement, depth) => [
		`${indent(depth)}raise exception ${quoteStringLiteral(statement.message)}${renderRaiseSuffix(statement.args)};`,
	],
	returnRef: (statement, depth) => [
		`${indent(depth)}return ${statement.refName};`,
	],
	returnQuery: (statement, depth, _identity, _declaredAt, columnOrder) => [
		`${indent(depth)}return query ${renderQuery(applyColumnOrderToQuery(statement.query, columnOrder))};`,
	],
	returnExpr: (statement, depth) => [
		`${indent(depth)}return ${renderExpr(statement.expr)};`,
	],
	if: renderIfLines,
	forEach: (statement, depth, identity, declaredAt, columnOrder) => {
		const headerLine = `${indent(depth)}for ${statement.loopName} in ${renderSelect(applyColumnOrderToSelect(statement.query, columnOrder))} loop`;
		const bodyLines = statement.statements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt, columnOrder),
		);
		return [headerLine, ...bodyLines, `${indent(depth)}end loop;`];
	},
};

const renderStatementLines = (
	statement: BodyStatement,
	depth: number,
	identity: string,
	declaredAt: string | null,
	columnOrder: ColumnOrderOracle,
): ReadonlyArray<string> => {
	const handler = renderStatementHandlers[statement.stmtKind] as (
		statement: BodyStatement,
		depth: number,
		identity: string,
		declaredAt: string | null,
		columnOrder: ColumnOrderOracle,
	) => ReadonlyArray<string>;
	return handler(statement, depth, identity, declaredAt, columnOrder);
};

/** Renders a {@link FunctionDeclaration}'s `returns` clause text — `"trigger"`, `` `setof "schema"."table"` ``, or the scalar type. Shared by {@link renderFunctionSql} and `functionKind.serialize`'s snapshot `returns` field, so the two never drift apart. */
export const renderFunctionReturnsClause = (
	returns: FunctionDeclaration["returns"],
): string => {
	switch (returns.returnsKind) {
		case "trigger":
			return "trigger";
		case "setofTable":
			return `setof ${qualifyName(returns.schemaName, returns.tableName)}`;
		case "scalar":
			return renderTypeNode(returns.typeNode);
		default:
			return assertNever(returns);
	}
};

/** Renders one `declare` line: `<name> <typeNode>;` for a scalar row local, `<name> record;` for a `ctx.forEach()` loop variable. */
const renderDeclarationLine = (local: PlpgsqlVarDeclaration): string => {
	switch (local.declKind) {
		case "scalar":
			return `${indent(1)}${local.name} ${renderTypeNode(local.typeNode)};`;
		case "record":
			return `${indent(1)}${local.name} record;`;
		default:
			return assertNever(local);
	}
};

/**
 * Renders a {@link FunctionDeclaration} as a full, deterministic
 * `create or replace function …;` statement (spec §5.2/§6.4; exact text
 * format is normative — see the Phase 3 implementation plan). Throws
 * `body-contains-dollar-tag` if the rendered `declare`/`begin`/`end` body
 * contains the literal `$function$` dollar-quote tag.
 */
const renderSecurityLines = (
	declaration: FunctionDeclaration,
): ReadonlyArray<string> => {
	if (declaration.security === "definer") {
		return ["security definer"];
	}
	return [];
};

const renderDeclareLines = (
	declaration: FunctionDeclaration,
): ReadonlyArray<string> => {
	if (declaration.body.declarations.length === 0) {
		return [];
	}
	return [
		"declare",
		...declaration.body.declarations.map(renderDeclarationLine),
	];
};

export const renderFunctionSql = (
	declaration: FunctionDeclaration,
	columnOrder: ColumnOrderOracle = noColumnOrder,
): string => {
	const identity = `${declaration.schemaName}.${declaration.functionName}`;
	const argsSql = declaration.args
		.map((arg) => `${arg.argName} ${renderTypeNode(arg.typeNode)}`)
		.join(", ");
	const header = `create or replace function ${qualifyName(declaration.schemaName, declaration.functionName)}(${argsSql})`;
	const returnsLine = `returns ${renderFunctionReturnsClause(declaration.returns)}`;
	const securityLines = renderSecurityLines(declaration);
	const declareLines = renderDeclareLines(declaration);
	const bodyLines = declaration.body.statements.flatMap((stmt) =>
		renderStatementLines(
			stmt,
			1,
			identity,
			declaration.declaredAt,
			columnOrder,
		),
	);

	const innerLines = [...declareLines, "begin", ...bodyLines, "end;"];
	const innerText = innerLines.join("\n");
	if (innerText.includes("$function$")) {
		throwHejbroError(
			"body-contains-dollar-tag",
			`the function body's rendered SQL for ${identity} contains the literal $function$, which collides with the dollar-quote tag. Next: remove or rephrase that string.`,
			declaration.declaredAt,
		);
	}

	const lines = [
		header,
		returnsLine,
		...securityLines,
		"language plpgsql",
		"as $function$",
		...innerLines,
		"$function$;",
	];
	return lines.join("\n");
};

/** One event entry in a {@link TriggerSnapshotShape} — mirrors `TriggerDeclaration["events"][number]`. */
export type TriggerEventShape =
	| { readonly event: "insert" }
	| { readonly event: "delete" }
	| {
			readonly event: "update";
			readonly columns: ReadonlyArray<string> | null;
	  };

/** The plain-data shape {@link renderTriggerSql} consumes — a trigger's serialized snapshot node. */
export type TriggerSnapshotShape = {
	readonly schema: string;
	readonly table: string;
	readonly name: string;
	readonly timing: "before" | "after";
	readonly events: ReadonlyArray<TriggerEventShape>;
	readonly forEach: "row" | "statement";
	readonly function: string;
};

const renderTriggerEvent = (
	event: TriggerSnapshotShape["events"][number],
): string => {
	if (event.event === "update" && event.columns !== null) {
		return `update of ${event.columns.map(quoteIdentifier).join(", ")}`;
	}
	return event.event;
};

const dropTriggerGuardClause = (ifExists: boolean): string => {
	if (ifExists) {
		return "if exists ";
	}
	return "";
};

/**
 * Renders a trigger's own `drop trigger` statement (D75) — `ifExists`
 * true for a first-time create's idempotent guard text (nothing can
 * already depend on a trigger that doesn't exist yet), `false` for a
 * real alter/drop's own drop half, so an out-of-band removal fails
 * loudly at the next change instead of the `if exists` silently
 * tolerating it.
 */
export const renderTriggerDropSql = (
	t: TriggerSnapshotShape,
	ifExists: boolean,
): string =>
	`drop trigger ${dropTriggerGuardClause(ifExists)}${quoteIdentifier(t.name)} on ${qualifyName(t.schema, t.table)};`;

/** Renders a trigger's own `create trigger` statement, independent of the drop half. */
export const renderTriggerCreateSql = (t: TriggerSnapshotShape): string => {
	const eventsSql = t.events.map(renderTriggerEvent).join(" or ");
	return [
		`create trigger ${quoteIdentifier(t.name)}`,
		`${indent(1)}${t.timing} ${eventsSql} on ${qualifyName(t.schema, t.table)}`,
		`${indent(1)}for each ${t.forEach} execute function ${qualifyName(t.schema, t.function)}();`,
	].join("\n");
};

/**
 * Renders a trigger's `[dropTriggerIfExists, createTrigger]` statement
 * pair for a first-time create (spec §6.5) — `drop trigger if exists` is
 * idempotent guard text there, not a real drop. `trigger-kind.ts`'s
 * `alter`/`drop` cases render their own drop half via
 * {@link renderTriggerDropSql} directly (`ifExists: false`, D75) instead
 * of this pair.
 */
export const renderTriggerSql = (
	t: TriggerSnapshotShape,
): readonly [dropTriggerIfExists: string, createTrigger: string] => [
	renderTriggerDropSql(t, true),
	renderTriggerCreateSql(t),
];
