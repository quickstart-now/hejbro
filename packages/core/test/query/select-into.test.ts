import { describe, expect, it } from "vitest";
import {
	eq,
	expr,
	renderSelectInto,
	schema,
	select,
	table,
	uuid,
} from "../../src/index";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});
const refNewParent = expr("uuid", {
	nodeKind: "plpgsqlRef",
	path: ["new", "parent_id"],
});

describe("renderSelectInto", () => {
	const query = select(
		{ postId: comments.postId, parentId: comments.parentId },
		comments,
	).where(eq(comments.id, refNewParent));

	it("inserts into after the projection (non-strict)", () => {
		expect(
			renderSelectInto(
				query.selectQuery,
				["parent_post_id", "parent_parent_id"],
				{
					strict: false,
				},
			),
		).toBe(
			'select "app"."comments"."post_id" as "post_id", "app"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id',
		);
	});
	it("renders strict", () => {
		expect(
			renderSelectInto(query.selectQuery, ["v"], { strict: true }),
		).toContain("into strict v from");
	});
});

describe("select stage metadata", () => {
	it("keeps fromTable and projectionInput through the chain", () => {
		const staged = select(comments).where(eq(comments.id, refNewParent));
		expect(staged.fromTable).toBe(comments);
		expect(staged.projectionInput).toBe(comments);
	});
});
