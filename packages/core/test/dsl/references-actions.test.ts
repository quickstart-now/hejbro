import { describe, expect, it } from "vitest";
import { schema } from "../../src/dsl/schema";
import type { ForeignKeyAction } from "../../src/dsl/table";
import { foreignKeyActions, getTableMeta, table } from "../../src/dsl/table";
import { diffSnapshots } from "../../src/engine/diff-engine";
import { generateMigration } from "../../src/engine/generate";
import { planRenames } from "../../src/engine/rename-plan";
import { createDefaultRegistry } from "../../src/kind/registry";
import {
	asTableSnapshot,
	foreignKeyOnDelete,
	foreignKeyOnUpdate,
} from "../../src/kinds/table-snapshot";
import type { Snapshot } from "../../src/snapshot/snapshot";
import {
	buildSnapshot,
	emptySnapshot,
	renderSnapshot,
} from "../../src/snapshot/snapshot";
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

describe("a second .references() call replaces the reference and its actions (add-references-actions B1, 514/R6)", () => {
	/** `pets.ownerId` calls `.references()` twice -- once targeting `p1` with an action, once targeting `p2` -- so the second call must fully replace the first (target and actions together), never leaving the first call's action to bleed through onto the second call's target. */
	const buildRepeatedReferenceDeclarations = (
		viaColumn: boolean,
		secondActions: ActionsInput | undefined,
	) => {
		const owner = schema("app");
		const p1 = table(owner, "p1", { id: uuid().primaryKey() });
		const p2 = table(owner, "p2", { id: uuid().primaryKey() });
		const pets = (() => {
			if (viaColumn) {
				const ownerId = uuid()
					.notNull()
					.references(() => p1.id, { onDelete: "cascade" });
				if (secondActions === undefined) {
					return table(owner, "pets", {
						id: uuid().primaryKey(),
						ownerId: ownerId.references(() => p2.id),
					});
				}
				return table(owner, "pets", {
					id: uuid().primaryKey(),
					ownerId: ownerId.references(() => p2.id, secondActions),
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
							references: { columns: [p2.id] },
							...(secondActions ?? {}),
						},
					],
				}),
			);
		})();
		return [owner, getTableMeta(p1), getTableMeta(p2), getTableMeta(pets)];
	};

	const rows = [
		{
			label: "second call without actions clears the first call's action",
			secondActions: undefined as ActionsInput | undefined,
		},
		{
			label:
				"second call with different actions replaces the first call's action",
			secondActions: { onUpdate: "restrict" } as ActionsInput,
		},
	];

	it.each(rows)("$label", ({ secondActions }) => {
		const viaColumn = generateMigration({
			declarations: buildRepeatedReferenceDeclarations(true, secondActions),
			previousSnapshot: emptySnapshot,
		});
		const viaExtras = generateMigration({
			declarations: buildRepeatedReferenceDeclarations(false, secondActions),
			previousSnapshot: emptySnapshot,
		});
		assertByteIdentical(viaColumn, viaExtras);
		assertClausePresence(viaColumn.sql, secondActions);
	});
});

describe("column-level references() action changes diff identically to extras (add-references-actions task 1.2)", () => {
	const actionStates: ReadonlyArray<ForeignKeyAction | undefined> = [
		...foreignKeyActions,
		undefined,
	];

	/** All ordered pairs of distinct states -- `states.length * (states.length - 1)`, never a same-to-same "change" (D110: the input table is every state transition a real edit can produce, not one example). */
	const orderedDistinctPairs = <T>(
		states: ReadonlyArray<T>,
	): ReadonlyArray<{ readonly from: T; readonly to: T }> =>
		states.flatMap((from) =>
			states.filter((to) => to !== from).map((to) => ({ from, to })),
		);

	const actionsFor = (
		key: "onDelete" | "onUpdate",
		value: ForeignKeyAction | undefined,
	): ActionsInput | undefined => {
		if (value === undefined) {
			return undefined;
		}
		if (key === "onDelete") {
			return { onDelete: value };
		}
		return { onUpdate: value };
	};

	const describeState = (value: ForeignKeyAction | undefined): string => {
		if (value === undefined) {
			return "none";
		}
		return value;
	};

	const diffRows = (["onDelete", "onUpdate"] as const).flatMap((key) =>
		orderedDistinctPairs(actionStates).map(({ from, to }) => ({
			label: `${key} ${describeState(from)} -> ${describeState(to)}`,
			key,
			from,
			to,
		})),
	);

	it.each(diffRows)(
		"$label emits the same drop-and-add for the column form and extras",
		({ key, from, to }) => {
			const fromActions = actionsFor(key, from);
			const toActions = actionsFor(key, to);

			const fromColumn = generateMigration({
				declarations: buildDeclarations(true, fromActions, "actions"),
				previousSnapshot: emptySnapshot,
			});
			const fromExtras = generateMigration({
				declarations: buildDeclarations(false, fromActions, "actions"),
				previousSnapshot: emptySnapshot,
			});

			const viaColumn = generateMigration({
				declarations: buildDeclarations(true, toActions, "actions"),
				previousSnapshot: fromColumn.snapshot,
			});
			const viaExtras = generateMigration({
				declarations: buildDeclarations(false, toActions, "actions"),
				previousSnapshot: fromExtras.snapshot,
			});

			assertByteIdentical(viaColumn, viaExtras);
			// Vacuous-green guard: two forms silently emitting no alter at all
			// would also satisfy byte-identity -- pin that a real drop-and-add
			// (D1's own precedent for a foreign key that cannot be ALTERed in
			// place) actually happened, carrying the new state's own clause.
			expect(viaColumn.sql).not.toBe("");
			expect(viaColumn.sql).toContain("drop constraint");
			expect(viaColumn.sql).toContain("add constraint");
			assertClausePresence(viaColumn.sql, toActions);
		},
	);
});

describe("column-level references() actions survive a table rename (add-references-actions task 1.2)", () => {
	const registry = createDefaultRegistry();
	const app = schema("app");

	/** Pulls `tableIdentity`'s single foreign key out of a snapshot's raw JSON object graph -- the same `table:<identity>` key shape `rename/snapshot-sets.ts`'s `TABLE_PREFIX` builds, its `onDelete`/`onUpdate` normalized through `foreignKeyOnDelete`/`foreignKeyOnUpdate` (the compact snapshot stores "unspecified" as an absent key, not a literal `null`). */
	const soleForeignKey = (snapshot: Snapshot, tableIdentity: string) => {
		const node = snapshot.objects[`table:${tableIdentity}`];
		if (node === undefined) {
			throw new Error(`expected a snapshot object for "${tableIdentity}"`);
		}
		const tableSnapshot = asTableSnapshot(node);
		const [foreignKey] = tableSnapshot.foreignKeys;
		if (foreignKey === undefined) {
			throw new Error(`expected a foreign key on "${tableIdentity}"`);
		}
		return {
			onDelete: foreignKeyOnDelete(foreignKey),
			onUpdate: foreignKeyOnUpdate(foreignKey),
		};
	};

	const buildRenameScenario = (viaColumn: boolean, postsTableName: string) => {
		const posts = table(app, postsTableName, { id: uuid().primaryKey() });
		const comments = (actions: ActionsInput) => {
			if (viaColumn) {
				return table(app, "comments", {
					id: uuid().primaryKey(),
					postId: uuid()
						.notNull()
						.references(() => posts.id, actions),
				});
			}
			return table(
				app,
				"comments",
				{ id: uuid().primaryKey(), postId: uuid().notNull() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.postId],
							references: { table: posts, columns: [posts.id] },
							...actions,
						},
					],
				}),
			);
		};
		return { posts, comments };
	};

	const renameRows = [
		...foreignKeyActions.map((onDelete) => ({
			label: `onDelete -- ${onDelete}`,
			actions: { onDelete } as ActionsInput,
		})),
		{
			label: "onDelete and onUpdate together -- cascade / restrict",
			actions: { onDelete: "cascade", onUpdate: "restrict" } as ActionsInput,
		},
	];

	it.each(renameRows)(
		"$label: renaming the target table retargets the column form exactly like extras, keeping the action",
		({ actions }) => {
			const runRename = (viaColumn: boolean) => {
				const previousScenario = buildRenameScenario(viaColumn, "posts");
				const nextScenario = buildRenameScenario(viaColumn, "articles");
				const previous = buildSnapshot(
					[previousScenario.posts, previousScenario.comments(actions)].map(
						getTableMeta,
					),
					registry,
					emptySnapshot,
				);
				const next = buildSnapshot(
					[nextScenario.posts, nextScenario.comments(actions)].map(
						getTableMeta,
					),
					registry,
					emptySnapshot,
				);
				const plan = planRenames({
					previous,
					next,
					renames: [
						{
							target: "table",
							schemaName: "app",
							oldName: "posts",
							newName: "articles",
						},
					],
					confirmedDrops: [],
					declaredAtByIdentity: new Map(),
				});
				return { plan, next };
			};

			const columnRun = runRename(true);
			const extrasRun = runRename(false);

			expect(columnRun.plan.errors).toEqual([]);
			expect(extrasRun.plan.errors).toEqual([]);
			expect(
				diffSnapshots(
					columnRun.plan.rewrittenPrevious,
					columnRun.next,
					registry,
				),
			).toEqual([]);
			expect(
				diffSnapshots(
					extrasRun.plan.rewrittenPrevious,
					extrasRun.next,
					registry,
				),
			).toEqual([]);
			expect(renderSnapshot(columnRun.plan.rewrittenPrevious)).toBe(
				renderSnapshot(extrasRun.plan.rewrittenPrevious),
			);

			// Vacuous-green guard: `diffSnapshots(...).toEqual([])` alone would
			// also pass if retargeting quietly reset the action to null on
			// both sides identically -- read the retargeted foreign key's own
			// fields back and pin them against the row's declared action.
			const retargeted = soleForeignKey(
				columnRun.plan.rewrittenPrevious,
				"app.comments",
			);
			if (actions.onDelete === undefined) {
				expect(retargeted.onDelete).toBeNull();
			} else {
				expect(retargeted.onDelete).toBe(actions.onDelete);
			}
			if (actions.onUpdate === undefined) {
				expect(retargeted.onUpdate).toBeNull();
			} else {
				expect(retargeted.onUpdate).toBe(actions.onUpdate);
			}
		},
	);
});
