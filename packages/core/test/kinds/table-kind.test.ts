import { describe, expect, it } from "vitest";
import { tableKind } from "../../src/kinds/table-kind";
import type { JsonValue } from "../../src/snapshot/stable-json";

const fkTaskId = {
	name: "comments_task_id_fk",
	columns: ["task_id"],
	referencesTable: "app.tasks",
	referencesColumns: ["id"],
};
const fkParentId = {
	name: "comments_parent_id_fk",
	columns: ["parent_id"],
	referencesTable: "app.comments",
	referencesColumns: ["id"],
};

const tableNode = (foreignKeys: ReadonlyArray<JsonValue>): JsonValue => ({
	schema: "app",
	name: "comments",
	columns: [],
	indexes: [],
	foreignKeys,
});

const canonicalizeTable = (node: JsonValue): JsonValue => {
	const canonicalize = tableKind.canonicalize;
	if (canonicalize === undefined) {
		throw new Error("tableKind has no canonicalize");
	}
	return canonicalize(node);
};

/**
 * #413, 1.1c: `parent_id` sorts before `task_id` under the local-columns-
 * first key (D1) -- either declared order must canonicalize to the same
 * result, which is the whole point of a declaration-form-independent
 * order: converting between two edges' declaration order is
 * snapshot-invariant.
 */
describe("canonicalizeTable's foreignKeys order (#413, 1.1c)", () => {
	it.each([
		["declared task-then-parent", [fkTaskId, fkParentId]],
		["declared parent-then-task", [fkParentId, fkTaskId]],
	])(
		"%s canonicalizes to the same, declaration-form-independent order",
		(_label, foreignKeys) => {
			const result = canonicalizeTable(tableNode(foreignKeys)) as {
				readonly foreignKeys: ReadonlyArray<JsonValue>;
			};
			expect(result.foreignKeys).toEqual([fkParentId, fkTaskId]);
		},
	);
});
