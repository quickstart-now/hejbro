import { describe, expect, it } from "vitest";
import type { TriggerSnapshotShape } from "../../src/index";
import {
	defineFunction,
	defineTrigger,
	eq,
	isNull,
	now,
	renderFunctionSql,
	renderTriggerSql,
	schema,
	select,
	table,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const ddland = schema("ddland");
const comments = table(ddland, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});
const posts = table(ddland, "posts", {
	id: uuid().primaryKey(),
	publishedAt: timestamptz(),
});

describe("renderFunctionSql", () => {
	it("renders the exact comments-single-depth trigger function", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "comments_single_depth",
				timing: "before",
				events: ["insert"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.if(isNull(row.parentId), () => {
					ctx.return(row);
				});
				const parent = ctx.rowOrNull(
					select(
						{ postId: comments.postId, parentId: comments.parentId },
						comments,
					).where(eq(comments.id, row.parentId)),
					"parent",
				);
				ctx.if(isNull(parent.postId), () => {
					ctx.raise("부모 댓글을 찾을 수 없다 (parent_id=%)", row.parentId);
				});
				ctx.return(row);
			},
		);

		expect(renderFunctionSql(trigger.functionDeclaration)).toBe(
			[
				'create or replace function "ddland"."comments_single_depth_fn"()',
				"returns trigger",
				"language plpgsql",
				"as $function$",
				"declare",
				"\tparent_post_id uuid;",
				"\tparent_parent_id uuid;",
				"begin",
				"\tif new.parent_id is null then",
				"\t\treturn new;",
				"\tend if;",
				'\tselect "ddland"."comments"."post_id" as "post_id", "ddland"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "ddland"."comments" where "ddland"."comments"."id" = new.parent_id;',
				"\tif parent_post_id is null then",
				"\t\traise exception '부모 댓글을 찾을 수 없다 (parent_id=%)', new.parent_id;",
				"\tend if;",
				"\treturn new;",
				"end;",
				"$function$;",
			].join("\n"),
		);
	});

	it("renders a definer function with args and a return-query statement", () => {
		const declaration = defineFunction(
			"ddland",
			"publish_post",
			{ args: { postId: uuid() }, returns: posts, security: "definer" },
			(ctx, { postId }) => {
				ctx.return(
					update(posts)
						.set({ publishedAt: now() })
						.where(eq(posts.id, postId))
						.returning(),
				);
			},
		);

		const sql = renderFunctionSql(declaration);
		expect(sql).toContain(
			'create or replace function "ddland"."publish_post"(post_id uuid)',
		);
		expect(sql).toContain('returns setof "ddland"."posts"');
		expect(sql).toContain("security definer");
		expect(sql).toMatch(/\treturn query update .*returning .*;/);
	});

	it("guards against a body whose rendered SQL contains the dollar-quote tag", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "bad_body",
				timing: "before",
				events: ["insert"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.raise("this message contains $function$ literally");
				ctx.return(row);
			},
		);

		expect(() => renderFunctionSql(trigger.functionDeclaration)).toThrowError(
			/collides with the dollar-quote tag/,
		);
	});
});

describe("renderTriggerSql", () => {
	it("renders the drop-if-exists + create pair", () => {
		const snapshot: TriggerSnapshotShape = {
			schema: "ddland",
			table: "comments",
			name: "comments_single_depth",
			timing: "before",
			events: [
				{ event: "insert" },
				{ event: "update", columns: ["parent_id", "post_id"] },
			],
			forEach: "row",
			functionName: "comments_single_depth_fn",
		};

		expect(renderTriggerSql(snapshot)).toEqual([
			'drop trigger if exists "comments_single_depth" on "ddland"."comments";',
			[
				'create trigger "comments_single_depth"',
				'\tbefore insert or update of "parent_id", "post_id" on "ddland"."comments"',
				'\tfor each row execute function "ddland"."comments_single_depth_fn"();',
			].join("\n"),
		]);
	});
});
