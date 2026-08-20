import { describe, expect, it } from "vitest";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { getTableMeta, table } from "../../src/dsl/table";
import { eq, isNotNull } from "../../src/expr/operators";
import { tableKind } from "../../src/kinds/table-kind";
import { exists, select } from "../../src/query/select";
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
});
