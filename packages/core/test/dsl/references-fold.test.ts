import { describe, expect, it } from "vitest";
import type { ColumnRef } from "../../src/index";
import { getTableMeta, schema, table, uuid } from "../../src/index";

const app = schema("app");

// #669: a column-level `.references()` thunk used to be called
// synchronously, once, inside `table()` itself (`foldColumnReferences`,
// the fold's single evaluation point pre-#669) -- a same-file forward
// reference to a `const` declared later in the module hit real TDZ
// (`Cannot access '...' before initialization`) at that exact point. The
// thunk is now stored and only resolved on the declaration's first
// `foreignKeys` read, memoized after.
describe("column-level .references() thunk resolution (#669)", () => {
	it("two tables in one file that reference each other declare without a TDZ crash", () => {
		const declareBoth = () => {
			// `usersTable`'s own thunk names `postsTable`, a `const` declared
			// AFTER this statement -- under the old eager fold this line itself
			// would throw before `postsTable` ever gets assigned.
			const usersTable = table(app, "cycle_users", {
				id: uuid().primaryKey(),
				favoritePostId: uuid().references(
					(): ColumnRef<"uuid"> => postsTable.id,
				),
			});
			const postsTable = table(app, "cycle_posts", {
				id: uuid().primaryKey(),
				authorId: uuid().references((): ColumnRef<"uuid"> => usersTable.id),
			});
			return { usersTable, postsTable };
		};
		expect(declareBoth).not.toThrow();

		const { usersTable, postsTable } = declareBoth();
		expect(getTableMeta(usersTable).foreignKeys).toEqual([
			{
				columns: ["favorite_post_id"],
				references: {
					schemaName: "app",
					tableName: "cycle_posts",
					columns: ["id"],
				},
				onDelete: null,
				onUpdate: null,
			},
		]);
		expect(getTableMeta(postsTable).foreignKeys).toEqual([
			{
				columns: ["author_id"],
				references: {
					schemaName: "app",
					tableName: "cycle_users",
					columns: ["id"],
				},
				onDelete: null,
				onUpdate: null,
			},
		]);
	});

	it("the thunk resolves exactly once, however many times foreignKeys is read", () => {
		const target = table(app, "fold_once_target", { id: uuid().primaryKey() });
		const callCount = { current: 0 };
		const source = table(app, "fold_once_source", {
			id: uuid().primaryKey(),
			targetId: uuid().references(() => {
				callCount.current += 1;
				return target.id;
			}),
		});

		void getTableMeta(source).foreignKeys;
		void getTableMeta(source).foreignKeys;

		expect(callCount.current).toBe(1);
	});

	it("table() itself never resolves a reference thunk", () => {
		const callCount = { current: 0 };
		expect(() =>
			table(app, "never_called_source", {
				id: uuid().primaryKey(),
				targetId: uuid().references(() => {
					callCount.current += 1;
					throw new Error("thunk must not run during table()");
				}),
			}),
		).not.toThrow();
		expect(callCount.current).toBe(0);
	});
});
