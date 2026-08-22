import type { FunctionDeclaration } from "../dsl/define-function";
import { assertNever, throwHejbroError } from "../error";
import type { ExprNode } from "../expr/ast";
import {
	renderExpr,
	renderQuery,
	renderSelect,
	renderSelectInto,
} from "../expr/render-sql";
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
): ReadonlyArray<string> => {
	if (statement.elseStatements === null) {
		return [];
	}
	return [
		`${indent(depth)}else`,
		...statement.elseStatements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt),
		),
	];
};

const renderIfLines = (
	statement: IfStatement,
	depth: number,
	identity: string,
	declaredAt: string | null,
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
			renderStatementLines(inner, depth + 1, identity, declaredAt),
		),
	];
	const elsifLines = restBranches.flatMap((branch) => [
		`${indent(depth)}elsif ${renderExpr(branch.condition)} then`,
		...branch.statements.flatMap((inner) =>
			renderStatementLines(inner, depth + 1, identity, declaredAt),
		),
	]);
	const elseLines = renderElseLines(statement, depth, identity, declaredAt);

	return [...ifLines, ...elsifLines, ...elseLines, `${indent(depth)}end if;`];
};

const renderStatementLines = (
	statement: BodyStatement,
	depth: number,
	identity: string,
	declaredAt: string | null,
): ReadonlyArray<string> => {
	switch (statement.stmtKind) {
		case "selectInto":
			return [
				`${indent(depth)}${renderSelectInto(statement.query, statement.intoVariables, { strict: statement.strict })};`,
			];
		case "raise":
			return [
				`${indent(depth)}raise exception ${quoteStringLiteral(statement.message)}${renderRaiseSuffix(statement.args)};`,
			];
		case "returnRef":
			return [`${indent(depth)}return ${statement.refName};`];
		case "returnQuery":
			return [`${indent(depth)}return query ${renderQuery(statement.query)};`];
		case "if":
			return renderIfLines(statement, depth, identity, declaredAt);
		case "forEach": {
			const headerLine = `${indent(depth)}for ${statement.loopName} in ${renderSelect(statement.query)} loop`;
			const bodyLines = statement.statements.flatMap((inner) =>
				renderStatementLines(inner, depth + 1, identity, declaredAt),
			);
			return [headerLine, ...bodyLines, `${indent(depth)}end loop;`];
		}
		default:
			return assertNever(statement);
	}
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

export const renderFunctionSql = (declaration: FunctionDeclaration): string => {
	const identity = `${declaration.schemaName}.${declaration.functionName}`;
	const argsSql = declaration.args
		.map((arg) => `${arg.argName} ${renderTypeNode(arg.typeNode)}`)
		.join(", ");
	const header = `create or replace function ${qualifyName(declaration.schemaName, declaration.functionName)}(${argsSql})`;
	const returnsLine = `returns ${renderFunctionReturnsClause(declaration.returns)}`;
	const securityLines = renderSecurityLines(declaration);
	const declareLines = renderDeclareLines(declaration);
	const bodyLines = declaration.body.statements.flatMap((stmt) =>
		renderStatementLines(stmt, 1, identity, declaration.declaredAt),
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
