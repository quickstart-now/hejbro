import { describe, expect, it } from "vitest";
import type { TriggerSnapshotShape } from "../../src/index";
import {
	defineFunction,
	defineTrigger,
	deleteFrom,
	eq,
	fnv1aHex,
	insert,
	isNull,
	now,
	renderFunctionSql,
	renderTriggerSql,
	schema,
	select,
	table,
	text,
	timestamptz,
	update,
	uuid,
} from "../../src/index";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	publishedAt: timestamptz(),
});
const auditLog = table(app, "audit_log", {
	id: uuid().primaryKey(),
	tableName: text().notNull(),
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
					ctx.raise("Parent comment not found (parent_id=%)", row.parentId);
				});
				ctx.return(row);
			},
		);

		expect(renderFunctionSql(trigger.functionDeclaration)).toBe(
			[
				'create or replace function "app"."comments_single_depth_fn"()',
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
				'\tselect "app"."comments"."post_id" as "post_id", "app"."comments"."parent_id" as "parent_id" into parent_post_id, parent_parent_id from "app"."comments" where "app"."comments"."id" = new.parent_id;',
				"\tif parent_post_id is null then",
				"\t\traise exception 'Parent comment not found (parent_id=%)', new.parent_id;",
				"\tend if;",
				"\treturn new;",
				"end;",
				"$function$;",
			].join("\n"),
		);
	});

	it("renders a definer function with args and a return-query statement", () => {
		const declaration = defineFunction(
			app,
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
			'create or replace function "app"."publish_post"(post_id uuid)',
		);
		expect(sql).toContain('returns setof "app"."posts"');
		expect(sql).toContain("security definer");
		expect(sql).toMatch(/\treturn query update .*returning .*;/);
	});

	// #154 ratchet-5: recordReturn's insertQuery and deleteQuery branches
	// (ctx.return(insert(...).returning()) / ctx.return(deleteFrom(...)
	// .returning())) were never exercised -- only the trigger-row and
	// update-query forms had a test, above.
	it("renders a definer function with an insert-returning-query statement", () => {
		const declaration = defineFunction(
			"app",
			"create_post",
			{ args: {}, returns: posts, security: "definer" },
			(ctx) => {
				ctx.return(insert(posts).values({ publishedAt: now() }).returning());
			},
		);

		const sql = renderFunctionSql(declaration);
		expect(sql).toMatch(/\treturn query insert into .*returning .*;/);
	});

	it("renders a definer function with a delete-returning-query statement", () => {
		const declaration = defineFunction(
			"app",
			"remove_published_posts",
			{ args: {}, returns: posts, security: "definer" },
			(ctx) => {
				ctx.return(
					deleteFrom(posts).where(isNull(posts.publishedAt)).returning(),
				);
			},
		);

		const sql = renderFunctionSql(declaration);
		expect(sql).toMatch(/\treturn query delete from .*returning .*;/);
	});

	it("renders a forEach loop with an indented body and a record declaration", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "loop_demo",
				timing: "before",
				events: ["insert"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.forEach(
					select({ postId: comments.postId }, comments).where(
						eq(comments.parentId, row.id),
					),
					(child) => {
						ctx.raise("child post=%", child.postId);
					},
					"child",
				);
				ctx.return(row);
			},
		);

		expect(renderFunctionSql(trigger.functionDeclaration)).toBe(
			[
				'create or replace function "app"."loop_demo_fn"()',
				"returns trigger",
				"language plpgsql",
				"as $function$",
				"declare",
				"\tchild record;",
				"begin",
				'\tfor child in select "app"."comments"."post_id" as "post_id" from "app"."comments" where "app"."comments"."parent_id" = new.id loop',
				"\t\traise exception 'child post=%', child.post_id;",
				"\tend loop;",
				"\treturn new;",
				"end;",
				"$function$;",
			].join("\n"),
		);
	});

	it("runs an audit insert for effect, then returns the trigger row (#426)", () => {
		const trigger = defineTrigger(
			posts,
			{
				name: "audit_posts",
				timing: "after",
				events: ["update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.execute(insert(auditLog).values({ tableName: "posts" }));
				ctx.return(row);
			},
		);

		expect(renderFunctionSql(trigger.functionDeclaration)).toBe(
			[
				'create or replace function "app"."audit_posts_fn"()',
				"returns trigger",
				"language plpgsql",
				"as $function$",
				"begin",
				'\tinsert into "app"."audit_log" ("table_name") values (\'posts\');',
				"\treturn new;",
				"end;",
				"$function$;",
			].join("\n"),
		);
	});

	it("a select executed for effect becomes perform", () => {
		const trigger = defineTrigger(
			posts,
			{
				name: "notify_posts",
				timing: "after",
				events: ["update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.execute(
					select({ id: posts.id }, posts).where(eq(posts.id, row.id)),
				);
				ctx.return(row);
			},
		);

		const sql = renderFunctionSql(trigger.functionDeclaration);
		expect(sql).toContain(
			'\tperform "app"."posts"."id" as "id" from "app"."posts" where "app"."posts"."id" = new.id;',
		);
		expect(sql).not.toMatch(/\n\tselect /);
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

// #120 translated the golden reference examples' `raise` messages from
// Korean to English (AGENTS.md requires GitHub-facing text to be English),
// which removed the only place in the test suite that happened to prove
// hejbro carries arbitrary multibyte user data through `bodySql`/`bodyHash`
// unchanged -- that property used to ride along on a reference example's
// language choice rather than being tested on its own. This makes it an
// explicit test instead.
describe("multibyte body content", () => {
	it("preserves a Korean raise message byte-for-byte and produces a stable bodyHash", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "multibyte_probe",
				timing: "before",
				events: ["insert"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.raise("부모 댓글을 찾을 수 없다 (parent_id=%)", row.parentId);
				ctx.return(row);
			},
		);

		const bodySql = renderFunctionSql(trigger.functionDeclaration);
		expect(bodySql).toBe(
			[
				'create or replace function "app"."multibyte_probe_fn"()',
				"returns trigger",
				"language plpgsql",
				"as $function$",
				"begin",
				"\traise exception '부모 댓글을 찾을 수 없다 (parent_id=%)', new.parent_id;",
				"\treturn new;",
				"end;",
				"$function$;",
			].join("\n"),
		);

		// bodyHash is what function-kind.ts's diff engine actually compares
		// (spec §6.4) -- pinning it to a literal, not just bodySql, is what
		// proves the hash function treats the UTF-8 bytes deterministically
		// rather than e.g. silently normalizing or mis-counting multibyte
		// code points: a run that hashed differently would fail this
		// literal comparison, on any run, not just this one. (An earlier
		// version of this test also asserted
		// `fnv1aHex(bodySql) === fnv1aHex(bodySql)` -- calling the same
		// pure function twice in one process can't fail, so it proved
		// nothing beyond what the literal pin below already does; removed
		// during #167.)
		expect(fnv1aHex(bodySql)).toMatch(/^[0-9a-f]{8}$/);
		expect(fnv1aHex(bodySql)).toBe("61e17272");
	});
});

describe("renderTriggerSql", () => {
	it("renders the drop-if-exists + create pair", () => {
		const snapshot: TriggerSnapshotShape = {
			schema: "app",
			table: "comments",
			name: "comments_single_depth",
			timing: "before",
			events: [
				{ event: "insert" },
				{ event: "update", columns: ["parent_id", "post_id"] },
			],
			forEach: "row",
			function: "comments_single_depth_fn",
		};

		expect(renderTriggerSql(snapshot)).toEqual([
			'drop trigger if exists "comments_single_depth" on "app"."comments";',
			[
				'create trigger "comments_single_depth"',
				'\tbefore insert or update of "parent_id", "post_id" on "app"."comments"',
				'\tfor each row execute function "app"."comments_single_depth_fn"();',
			].join("\n"),
		]);
	});
});
