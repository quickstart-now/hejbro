import { captureDeclarationSite } from "../declaration-site";
import { throwHejbroError } from "../error";
import type { ColumnRef } from "../expr/ast";
import { expr, isExpr } from "../expr/ast";
import type { BodyContext, TriggerRow } from "../plpgsql/body-context";
import { recordBodyWithGuard, triggerRowMeta } from "../plpgsql/body-context";
import type { FunctionDeclaration } from "./define-function";
import type { Table } from "./table";
import { getTableMeta, toSnakeCase } from "./table";

/** One trigger event: a bare kind, or `update` scoped to specific (TypeScript-named) columns. */
export type TriggerEventInput =
	| "insert"
	| "update"
	| "delete"
	| { readonly update: ReadonlyArray<string> };

/** A recorded `defineTrigger` declaration: its own attachment config plus the function it creates. */
export type TriggerDeclaration = {
	readonly declarationKind: "trigger";
	readonly schemaName: string;
	readonly tableName: string;
	readonly triggerName: string;
	readonly timing: "before" | "after";
	readonly events: ReadonlyArray<
		| { readonly event: "insert" }
		| { readonly event: "delete" }
		| {
				readonly event: "update";
				readonly columns: ReadonlyArray<string> | null;
		  }
	>;
	readonly forEach: "row" | "statement";
	readonly functionName: string;
	readonly functionDeclaration: FunctionDeclaration;
	readonly declaredAt: string | null;
};

/**
 * `define-trigger.ts`'s one generic/runtime boundary crossing (mirrors
 * `dsl/table.ts`'s and `query/mutate.ts`'s equivalent casts): a table's own
 * enumerable keys are always its column `ColumnRef`s, a fact a generic
 * `TTable` can't trace back through a mapped type.
 */
const asRecord = (value: unknown): Record<string, unknown> =>
	value as Record<string, unknown>;

const isColumnRefValue = (value: unknown): value is ColumnRef =>
	isExpr(value) && "typeNode" in value;

const buildTriggerRow = <TTable extends Table>(
	target: TTable,
	refName: "new" | "old",
): TriggerRow<TTable> => {
	const record = asRecord(target);
	const fields = Object.entries(record)
		.filter((entry): entry is [string, ColumnRef] => isColumnRefValue(entry[1]))
		.map(([key, columnRef]) => [
			key,
			expr(columnRef.family, {
				nodeKind: "plpgsqlRef",
				path: [refName, columnRef.sqlName],
			}),
		]);

	return {
		...Object.fromEntries(fields),
		[triggerRowMeta]: refName,
	} as TriggerRow<TTable>;
};

const resolveEvent = (
	event: TriggerEventInput,
	knownColumnNames: ReadonlySet<string>,
	triggerName: string,
	schemaName: string,
	tableName: string,
	declaredAt: string | null,
): TriggerDeclaration["events"][number] => {
	if (event === "insert") {
		return { event: "insert" };
	}
	if (event === "delete") {
		return { event: "delete" };
	}
	if (event === "update") {
		return { event: "update", columns: null };
	}
	const columns = event.update.map((columnKey) => {
		const columnName = toSnakeCase(columnKey);
		if (!knownColumnNames.has(columnName)) {
			return throwHejbroError(
				"unknown-trigger-column",
				`trigger "${triggerName}" on "${schemaName}.${tableName}" lists unknown column "${columnKey}" in its update-of event list. Next: use one of the columns declared on this table's table() call — this is usually a typo in "${columnKey}", or a column that was renamed since this trigger was written.`,
				declaredAt,
			);
		}
		return columnName;
	});
	return { event: "update", columns };
};

/**
 * Declares a Postgres trigger and, in the same call, the function it
 * executes (`config.functionName ?? `${config.name}_fn``). `body` runs
 * **twice** with fresh recording contexts — the two recorded trees must be
 * structurally identical, or this throws `nondeterministic-body` (spec §6.2
 * decision A4).
 */
export const defineTrigger = <TTable extends Table>(
	target: TTable,
	config: {
		readonly name: string;
		readonly timing: "before" | "after";
		readonly events: ReadonlyArray<TriggerEventInput>;
		readonly forEach: "row" | "statement";
		readonly functionName?: string;
	},
	body: (
		ctx: BodyContext,
		rows: {
			readonly new: TriggerRow<TTable>;
			readonly old: TriggerRow<TTable>;
		},
	) => void,
): TriggerDeclaration => {
	const meta = getTableMeta(target);
	const schemaName = meta.schema.schemaName;
	const tableName = meta.tableName;
	const functionName = config.functionName ?? `${config.name}_fn`;
	const identity = `${schemaName}.${tableName}.${config.name}`;
	const declaredAt = captureDeclarationSite();

	const knownColumnNames = new Set(
		meta.columns.map((column) => column.columnName),
	);
	const events = config.events.map((event) =>
		resolveEvent(
			event,
			knownColumnNames,
			config.name,
			schemaName,
			tableName,
			declaredAt,
		),
	);

	const rows = {
		new: buildTriggerRow(target, "new"),
		old: buildTriggerRow(target, "old"),
	};
	const functionBody = recordBodyWithGuard(
		identity,
		declaredAt,
		"trigger",
		null,
		(ctx) => body(ctx, rows),
	);

	const functionDeclaration: FunctionDeclaration = {
		declarationKind: "function",
		schemaName,
		functionName,
		args: [],
		returns: { returnsKind: "trigger" },
		security: "invoker",
		body: functionBody,
		declaredAt,
	};

	return {
		declarationKind: "trigger",
		schemaName,
		tableName,
		triggerName: config.name,
		timing: config.timing,
		events,
		forEach: config.forEach,
		functionName,
		functionDeclaration,
		declaredAt,
	};
};
