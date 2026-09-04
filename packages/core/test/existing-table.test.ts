import { describe, expect, it } from "vitest";
import {
	buildSnapshot,
	createDefaultRegistry,
	defineView,
	emptySnapshot,
	eq,
	existingTable,
	exists,
	generateMigration,
	getTableMeta,
	rls,
	schema,
	select,
	table,
	uuid,
} from "../src/index";
import type { TableSnapshot } from "../src/kinds/table-snapshot";
import { tableExisting } from "../src/kinds/table-snapshot";

describe("existingTable", () => {
	const authUsers = existingTable("auth", "users", { id: uuid() });
	const app = schema("app");

	it("serves as an FK target without entering the snapshot", () => {
		const profiles = table(
			app,
			"profiles",
			{ id: uuid().primaryKey() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.id],
						references: { table: authUsers, columns: [authUsers.id] },
					},
				],
			}),
		);
		const result = generateMigration({
			declarations: [app, profiles],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('references "auth"."users"');
		expect(result.sql).not.toContain('create schema "auth"');
		expect(Object.keys(result.snapshot.objects)).not.toContain(
			"table:auth.users",
		);
	});

	it("produces no migration when passed as a declaration (add-unmanaged-objects)", () => {
		const result = generateMigration({
			declarations: [authUsers],
			previousSnapshot: emptySnapshot,
		});
		expect(result.hasChanges).toBe(false);
		expect(result.sql).toBe("");
		expect(result.snapshot.objects["table:auth.users"]).toMatchObject({
			existing: true,
		});
	});

	it("records an existing table as such, with its declared columns", () => {
		const registry = createDefaultRegistry();
		const snapshot = buildSnapshot(
			[app, getTableMeta(authUsers)],
			registry,
			emptySnapshot,
		);
		const node = snapshot.objects["table:auth.users"];
		expect(node).toMatchObject({
			schema: "auth",
			name: "users",
			columns: [expect.objectContaining({ name: "id" })],
			existing: true,
		});

		const profiles = table(app, "profiles", { id: uuid().primaryKey() });
		const managedSnapshot = buildSnapshot(
			[app, getTableMeta(profiles)],
			registry,
			emptySnapshot,
		);
		const managedNode = managedSnapshot.objects["table:app.profiles"];
		expect(managedNode).not.toHaveProperty("existing");
		expect(tableExisting(node as TableSnapshot)).toBe(true);
	});
});

describe("existingTable in exists() and view from/joins (Task 7 regression pins)", () => {
	const authUsers = existingTable("auth", "users", { id: uuid() });
	const app = schema("app");

	it("an rls.policy using() wrapping exists(select(authUsers)...) renders auth.users in the policy SQL", () => {
		const accounts = table(
			app,
			"accounts",
			{
				id: uuid().primaryKey().defaultRandom(),
				userId: uuid().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					readOwnAccount: rls
						.policy("accounts_read_own")
						.for("select")
						.to("authenticated")
						.using(exists(select(authUsers).where(eq(authUsers.id, t.userId)))),
				}),
			}),
		);
		const result = generateMigration({
			declarations: [app, accounts],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain(
			'exists (select 1 from "auth"."users" where "users"."id" = "accounts"."user_id")',
		);
		expect(result.sql).not.toContain('create schema "auth"');
		expect(Object.keys(result.snapshot.objects)).not.toContain(
			"table:auth.users",
		);
	});

	it("a defineView over a managed table joined to authUsers renders and snapshots without an auth object", () => {
		const accounts = table(app, "profiles_view_src", {
			id: uuid().primaryKey().defaultRandom(),
			userId: uuid().notNull(),
		});
		const view = defineView(
			app,
			"accounts_with_email",
			select(accounts).innerJoin(authUsers, eq(accounts.userId, authUsers.id)),
		);
		const result = generateMigration({
			declarations: [app, accounts, view],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('inner join "auth"."users" on');
		expect(result.sql).not.toContain('create schema "auth"');
		expect(Object.keys(result.snapshot.objects)).not.toContain(
			"table:auth.users",
		);
	});
});
