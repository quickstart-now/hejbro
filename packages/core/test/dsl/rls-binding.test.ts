import { describe, expect, it } from "vitest";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, isNotNull } from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import { tableKind } from "../../src/kinds/table-kind";
import { exists, jsonArrayFrom, select } from "../../src/query/select";
import { stableJson } from "../../src/snapshot/stable-json";
import {
	text,
	timestamptz,
	uuid,
} from "../../src/types/column-builder-factories";

const app = schema("app");

describe("binding rls to a table", () => {
	it("stamps schema/table onto every policy of a bound RlsDeclaration", () => {
		const posts = table(
			app,
			"posts",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
				publishedAt: timestamptz(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_published")
						.for("select")
						.to("anon")
						.using(isNotNull(t.publishedAt)),
				}),
			}),
		);

		const meta = getTableMeta(posts);
		expect(meta.rls).not.toBeNull();
		expect(meta.rls?.schemaName).toBe("app");
		expect(meta.rls?.tableName).toBe("posts");
		expect(meta.rls?.force).toBe(false);
		expect(meta.rls?.policies).toHaveLength(1);
		expect(meta.rls?.policies[0]).toMatchObject({
			declarationKind: "policy",
			schemaName: "app",
			tableName: "posts",
			policyName: "posts_read_published",
			command: "select",
			roles: ["anon"],
		});
	});

	it("a table without rls extras carries a null rls declaration", () => {
		const posts = table(app, "posts_bare", {
			id: uuid().primaryKey().defaultRandom(),
		});
		expect(getTableMeta(posts).rls).toBeNull();
	});

	it("serializes byte-identically whether or not a table declares rls (D25)", () => {
		const bare = table(app, "posts_compare", {
			id: uuid().primaryKey().defaultRandom(),
			status: text().notNull(),
			publishedAt: timestamptz(),
		});
		const secured = table(
			app,
			"posts_compare",
			{
				id: uuid().primaryKey().defaultRandom(),
				status: text().notNull(),
				publishedAt: timestamptz(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("posts_read_published")
						.for("select")
						.to("anon")
						.using(isNotNull(t.publishedAt)),
				}),
			}),
		);

		expect(stableJson(tableKind.serialize(getTableMeta(secured)))).toBe(
			stableJson(tableKind.serialize(getTableMeta(bare))),
		);
	});

	it("rejects two policies sharing one SQL policy name", () => {
		expect(() =>
			table(
				app,
				"posts_dup",
				{
					id: uuid().primaryKey().defaultRandom(),
					status: text().notNull(),
				},
				(t) => ({
					rls: rls.enabled({
						first: rls
							.policy("same_name")
							.for("select")
							.to("anon")
							.using(isNotNull(t.status)),
						second: rls
							.policy("same_name")
							.for("select")
							.to("authenticated")
							.using(isNotNull(t.status)),
					}),
				}),
			),
		).toThrowError(expect.objectContaining({ code: "duplicate-policy-name" }));
	});

	it("rejects a top-level reference to another table's column", () => {
		const comments = table(app, "comments_fc", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid().notNull(),
		});

		expect(() =>
			table(
				app,
				"posts_fc",
				{
					id: uuid().primaryKey().defaultRandom(),
				},
				(t) => ({
					rls: rls.enabled({
						read: rls
							.policy("bad")
							.for("select")
							.to("anon")
							.using(eq(comments.postId, t.id)),
					}),
				}),
			),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-foreign-column" }),
		);
	});

	// #154 ratchet-5: findExprScopeViolation's sqlTemplate handler
	// (an embedded ${...} expression inside a sql`` template) had zero
	// coverage -- every other scope-violation test above used a plain
	// comparison, never a raw-SQL template.
	it("rejects a foreign column reference embedded in a sql`` template", () => {
		const comments = table(app, "comments_sql_fc", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid().notNull(),
		});

		expect(() =>
			table(
				app,
				"posts_sql_fc",
				{
					id: uuid().primaryKey().defaultRandom(),
				},
				(t) => ({
					rls: rls.enabled({
						read: rls
							.policy("bad")
							.for("select")
							.to("anon")
							.using(sql`${t.id} = ${comments.postId}`),
					}),
				}),
			),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-foreign-column" }),
		);
	});

	it("allows a correlated exists() referencing another table", () => {
		const comments = table(app, "comments_ok", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid().notNull(),
		});

		expect(() =>
			table(
				app,
				"posts_ok",
				{
					id: uuid().primaryKey().defaultRandom(),
				},
				(t) => ({
					rls: rls.enabled({
						read: rls
							.policy("good")
							.for("select")
							.to("anon")
							.using(exists(select(comments).where(eq(comments.postId, t.id)))),
					}),
				}),
			),
		).not.toThrow();
	});

	// #160: a foreign ref buried inside exists() used to reach declaration
	// time unrejected -- assertOwnColumnsOnly (dsl/rls.ts) only checked
	// top-level refs, so this exact shape (a subquery correlating to a
	// third table that's neither its own from() nor the outer policy's
	// table) only ever got caught later, at generate/serialize time, by
	// policyKind.serialize's own (now-removed) renderExpr side effect.
	// findExprScopeViolation (expr/walk.ts) descends into exists() with
	// the subquery's own scope extended, so this is now rejected here,
	// at declaration time, like every other policy validation.
	it("rejects a column reference inside exists() to a table that's neither the subquery's own nor the outer policy's (#160)", () => {
		const comments = table(app, "comments_fc2", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid().notNull(),
		});
		const otherTable = table(app, "other_table_fc2", {
			id: uuid().primaryKey().defaultRandom(),
			flag: uuid().notNull(),
		});

		expect(() =>
			table(
				app,
				"posts_fc2",
				{ id: uuid().primaryKey().defaultRandom() },
				() => ({
					rls: rls.enabled({
						read: rls
							.policy("bad_cross_reference")
							.for("select")
							.to("anon")
							.using(
								exists(
									select(comments).where(eq(otherTable.flag, comments.id)),
								),
							),
					}),
				}),
			),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-foreign-column" }),
		);
	});
});

describe("nested reads inside policy expressions (add-relational-reads group 2 review F5)", () => {
	const app = schema("app");
	const comments = table(app, "comments", {
		id: uuid().primaryKey(),
		postId: uuid().notNull(),
	});
	const others = table(app, "others", { id: uuid().primaryKey() });

	it("a nested read referencing its own subselect table and the policy's table is legal", () => {
		const built = table(
			app,
			"posts_nested_ok",
			{ id: uuid().primaryKey().defaultRandom() },
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("nested_ok")
						.for("select")
						.to("anon")
						.using(
							sql`${jsonArrayFrom(
								select({ id: comments.id }, comments).where(
									eq(comments.postId, t.id),
								),
							)} is not null`,
						),
				}),
			}),
		);
		expect(getTableMeta(built).rls).not.toBeNull();
	});

	it("a nested read referencing a third table fails with rls-policy-foreign-column", () => {
		expect(() =>
			table(
				app,
				"posts_nested_bad",
				{ id: uuid().primaryKey().defaultRandom() },
				(t) => ({
					rls: rls.enabled({
						read: rls
							.policy("nested_bad")
							.for("select")
							.to("anon")
							.using(
								sql`${jsonArrayFrom(
									select({ id: comments.id }, comments).where(
										eq(others.id, t.id),
									),
								)} is not null`,
							),
					}),
				}),
			),
		).toThrowError(
			expect.objectContaining({ code: "rls-policy-foreign-column" }),
		);
	});
});
