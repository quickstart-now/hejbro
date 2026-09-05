import { describe, expect, it } from "vitest";
import { schema } from "../../src/dsl/schema";
import type { ForeignKeyAction } from "../../src/dsl/table";
import { foreignKeyActions, getTableMeta, table } from "../../src/dsl/table";
import { generateMigration } from "../../src/engine/generate";
import { emptySnapshot } from "../../src/snapshot/snapshot";
import { uuid } from "../../src/types/column-builder-factories";

type ActionsInput = {
	readonly onDelete?: ForeignKeyAction;
	readonly onUpdate?: ForeignKeyAction;
};

type SecondArgMode = "omitted" | "empty-object" | "actions";

/** Builds the same `users` -> `pets.ownerId` foreign key both ways (add-references-actions task 1.1, precedent: table-kind-emit.test.ts's "column-level references emit identically to extras"). `secondArgMode` exercises `.references()`'s three call shapes; the extras form always carries exactly the keys `actions` sets, mirroring `ForeignKeyInput`'s own optional `onDelete`/`onUpdate`. */
const buildDeclarations = (
	viaColumn: boolean,
	actions: ActionsInput | undefined,
	secondArgMode: SecondArgMode,
) => {
	const owner = schema("app");
	const users = table(owner, "users", { id: uuid().primaryKey() });
	const pets = (() => {
		if (viaColumn) {
			const ownerId = uuid().notNull();
			if (secondArgMode === "omitted") {
				return table(owner, "pets", {
					id: uuid().primaryKey(),
					ownerId: ownerId.references(() => users.id),
				});
			}
			return table(owner, "pets", {
				id: uuid().primaryKey(),
				ownerId: ownerId.references(() => users.id, actions ?? {}),
			});
		}
		return table(
			owner,
			"pets",
			{ id: uuid().primaryKey(), ownerId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.ownerId],
						references: { columns: [users.id] },
						...(actions ?? {}),
					},
				],
			}),
		);
	})();
	return [owner, getTableMeta(users), getTableMeta(pets)];
};

const assertByteIdentical = (
	viaColumn: ReturnType<typeof generateMigration>,
	viaExtras: ReturnType<typeof generateMigration>,
) => {
	expect(viaColumn.sql).toBe(viaExtras.sql);
	expect(JSON.stringify(viaColumn.snapshot)).toBe(
		JSON.stringify(viaExtras.snapshot),
	);
};

/** Guards against a vacuous green: byte-identical SQL that both forms produce by *dropping* the action is not the claim under test — the rendered clause itself must be present (or, for "neither", absent) in the actually-generated SQL (`table-kind-emit-sql.ts`'s `foreignKeyActionClause` renders it as literally ` on delete <action>`/` on update <action>`). */
const assertClausePresence = (
	sql: string,
	actions: ActionsInput | undefined,
) => {
	if (actions?.onDelete === undefined) {
		expect(sql).not.toContain("on delete");
	} else {
		expect(sql).toContain(`on delete ${actions.onDelete}`);
	}
	if (actions?.onUpdate === undefined) {
		expect(sql).not.toContain("on update");
	} else {
		expect(sql).toContain(`on update ${actions.onUpdate}`);
	}
};

describe("column-level references() actions emit identically to extras (add-references-actions task 1.1)", () => {
	const onDeleteOnlyRows = foreignKeyActions.map((onDelete) => ({
		label: `onDelete only -- ${onDelete}`,
		actions: { onDelete } as ActionsInput,
	}));
	const onUpdateOnlyRows = foreignKeyActions.map((onUpdate) => ({
		label: `onUpdate only -- ${onUpdate}`,
		actions: { onUpdate } as ActionsInput,
	}));
	const bothRows = foreignKeyActions.flatMap((onDelete) =>
		foreignKeyActions.map((onUpdate) => ({
			label: `both -- onDelete=${onDelete}, onUpdate=${onUpdate}`,
			actions: { onDelete, onUpdate } as ActionsInput,
		})),
	);
	const actionRows = [...onDeleteOnlyRows, ...onUpdateOnlyRows, ...bothRows];

	it.each(actionRows)(
		"$label: .references(target, actions) matches extras byte-for-byte, including the rendered clause",
		({ actions }) => {
			const viaColumn = generateMigration({
				declarations: buildDeclarations(true, actions, "actions"),
				previousSnapshot: emptySnapshot,
			});
			const viaExtras = generateMigration({
				declarations: buildDeclarations(false, actions, "actions"),
				previousSnapshot: emptySnapshot,
			});
			assertByteIdentical(viaColumn, viaExtras);
			assertClausePresence(viaColumn.sql, actions);
		},
	);

	const neitherRows = [
		{
			label: ".references(target) -- no second argument",
			secondArgMode: "omitted" as const,
		},
		{
			label: ".references(target, {}) -- empty options object",
			secondArgMode: "empty-object" as const,
		},
	];

	it.each(neitherRows)(
		"$label matches extras with no action clause",
		({ secondArgMode }) => {
			const viaColumn = generateMigration({
				declarations: buildDeclarations(true, undefined, secondArgMode),
				previousSnapshot: emptySnapshot,
			});
			const viaExtras = generateMigration({
				declarations: buildDeclarations(false, undefined, secondArgMode),
				previousSnapshot: emptySnapshot,
			});
			assertByteIdentical(viaColumn, viaExtras);
			assertClausePresence(viaColumn.sql, undefined);
		},
	);
});
