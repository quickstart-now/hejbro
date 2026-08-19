import { describe, expect, it } from "vitest";
import {
	defineFunction,
	defineTrigger,
	eq,
	isNotNull,
	isNull,
	schema,
	select,
	table,
	uuid,
} from "../../src/index";

const ddland = schema("ddland");
const comments = table(ddland, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});

const triggerConfig = {
	name: "comments_single_depth",
	timing: "before" as const,
	events: ["insert"] as const,
	forEach: "row" as const,
};

describe("body-context recording", () => {
	it("records rowOrNull as non-strict selectInto with derived scalar names", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				const parent = ctx.rowOrNull(
					select(
						{ postId: comments.postId, parentId: comments.parentId },
						comments,
					).where(eq(comments.id, row.parentId)),
					"parent",
				);
				ctx.if(isNull(parent.postId), () => {
					ctx.raise("parent missing (parent_id=%)", row.parentId);
				});
				ctx.return(row);
			},
		);
		expect(declaration.functionDeclaration.body.declarations).toEqual([
			{ name: "parent_post_id", typeNode: { typeName: "uuid" } },
			{ name: "parent_parent_id", typeNode: { typeName: "uuid" } },
		]);
		const [selectInto, ifStmt, returnStmt] =
			declaration.functionDeclaration.body.statements;
		expect(selectInto).toMatchObject({
			stmtKind: "selectInto",
			strict: false,
			intoVariables: ["parent_post_id", "parent_parent_id"],
		});
		expect(ifStmt?.stmtKind).toBe("if");
		expect(returnStmt).toEqual({ stmtKind: "returnRef", refName: "new" });
	});

	it("auto-names unnamed rows deterministically (row_1, row_2)", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx.rowOrNull(select(comments).where(eq(comments.id, row.parentId)));
				ctx.rowOrNull(select(comments).where(eq(comments.id, row.id)));
				ctx.return(row);
			},
		);
		const [first, second] = declaration.functionDeclaration.body.statements;
		expect(first).toMatchObject({
			intoVariables: ["row_1_id", "row_1_post_id", "row_1_parent_id"],
		});
		expect(second).toMatchObject({
			intoVariables: ["row_2_id", "row_2_post_id", "row_2_parent_id"],
		});
	});

	it("ctx.row records strict: true", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx.row(
					select({ postId: comments.postId }, comments).where(
						eq(comments.id, row.parentId),
					),
					"parent",
				);
				ctx.return(row);
			},
		);
		const [selectInto] = declaration.functionDeclaration.body.statements;
		expect(selectInto).toMatchObject({ stmtKind: "selectInto", strict: true });
	});

	it("new/old proxies record plpgsqlRef paths with snake_cased fields", () => {
		defineTrigger(comments, triggerConfig, (ctx, { new: row, old }) => {
			expect(row.parentId.exprNode).toEqual({
				nodeKind: "plpgsqlRef",
				path: ["new", "parent_id"],
			});
			expect(old.parentId.exprNode).toEqual({
				nodeKind: "plpgsqlRef",
				path: ["old", "parent_id"],
			});
			ctx.return(row);
		});
	});

	it("elseIf/else chain records ordered branches", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx
					.if(isNull(row.parentId), () => {
						ctx.raise("branch one");
					})
					.elseIf(isNotNull(row.postId), () => {
						ctx.raise("branch two");
					})
					.else(() => {
						ctx.raise("branch three");
					});
				ctx.return(row);
			},
		);
		const [ifStmt] = declaration.functionDeclaration.body.statements;
		if (ifStmt?.stmtKind !== "if") {
			throw new Error("expected an if statement");
		}
		expect(ifStmt.branches).toHaveLength(2);
		expect(ifStmt.elseStatements).toHaveLength(1);
	});

	it("raise placeholder/arg mismatch throws raise-arg-count-mismatch (%% is literal)", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.raise("100%% done, parent=%", row.parentId, row.postId);
				ctx.return(row);
			}),
		).toThrowError(/counts must match/);
	});

	it("duplicate row name throws duplicate-local-name", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.rowOrNull(
					select({ postId: comments.postId }, comments).where(
						eq(comments.id, row.parentId),
					),
					"dup",
				);
				ctx.rowOrNull(
					select({ postId: comments.postId }, comments).where(
						eq(comments.id, row.id),
					),
					"dup",
				);
				ctx.return(row);
			}),
		).toThrowError(/already declared/);
	});

	it("reserved local name throws reserved-local-name", () => {
		expect(() =>
			defineFunction(
				"ddland",
				"reserved_name_fn",
				{ args: { when: uuid() }, returns: comments },
				() => {},
			),
		).toThrowError(/reserved word/);
	});

	it("derived-expression projection throws row-projection-not-column", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				const badProjection = select(
					{ hasParent: isNotNull(comments.parentId) },
					comments,
				).where(eq(comments.id, row.id));
				// @ts-expect-error — isNotNull(...) isn't a ColumnRef; this exercises the runtime-only guard
				ctx.rowOrNull(badProjection);
				ctx.return(row);
			}),
		).toThrowError(/isn't a plain column reference/);
	});

	it("ctx.return of a RowColumns object throws unsupported-return-value", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				const parent = ctx.rowOrNull(
					select({ postId: comments.postId }, comments).where(
						eq(comments.id, row.parentId),
					),
				);
				// @ts-expect-error — a RowColumns object isn't a valid ctx.return() argument
				ctx.return(parent);
			}),
		).toThrowError(/isn't a trigger row/);
	});

	it("unknown update-of column throws unknown-trigger-column", () => {
		expect(() =>
			defineTrigger(
				comments,
				{ ...triggerConfig, events: [{ update: ["doesNotExist"] }] },
				(ctx, { new: row }) => {
					ctx.return(row);
				},
			),
		).toThrowError(/isn't a column of table/);
	});

	it("defineFunction args become ArgRefs with plpgsqlRef paths and snake_cased names", () => {
		const declaration = defineFunction(
			"ddland",
			"publish_post",
			{ args: { postId: uuid() }, returns: comments },
			(ctx, { postId }) => {
				expect(postId.exprNode).toEqual({
					nodeKind: "plpgsqlRef",
					path: ["post_id"],
				});
				ctx.raise("noop=%", postId);
			},
		);
		expect(declaration.args).toEqual([
			{ argName: "post_id", typeNode: { typeName: "uuid" } },
		]);
	});
});
