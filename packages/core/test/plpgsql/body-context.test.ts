import { describe, expect, it } from "vitest";
import {
	defineFunction,
	defineTrigger,
	eq,
	insert,
	isNotNull,
	isNull,
	schema,
	select,
	sql,
	table,
	uuid,
} from "../../src/index";

const app = schema("app");
const comments = table(app, "comments", {
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

// #445/R4: a column literally named after the internal expression field
// `isExpr` duck-types on -- the exact shape that made `ctx.return(ctx.new)`
// misfire down the expression path instead of the trigger-row path.
const tricky = table(app, "tricky", {
	id: uuid().primaryKey(),
	exprNode: uuid(),
});
const trickyTriggerConfig = {
	name: "tricky_guard",
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
			{
				declKind: "scalar",
				name: "parent_post_id",
				typeNode: { typeName: "uuid" },
			},
			{
				declKind: "scalar",
				name: "parent_parent_id",
				typeNode: { typeName: "uuid" },
			},
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

	it("calling .else() twice throws invalid-if-chain", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				const chain = ctx.if(isNull(row.parentId), () => {
					ctx.raise("branch one");
				});
				chain.else(() => {
					ctx.raise("branch two");
				});
				chain.else(() => {
					ctx.raise("branch three");
				});
				ctx.return(row);
			}),
		).toThrowError(/\.else\(\) more than once/);
	});

	it("calling .elseIf() after .else() throws invalid-if-chain", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				const chain = ctx.if(isNull(row.parentId), () => {
					ctx.raise("branch one");
				});
				chain.else(() => {
					ctx.raise("branch two");
				});
				chain.elseIf(isNotNull(row.postId), () => {
					ctx.raise("branch three");
				});
				ctx.return(row);
			}),
		).toThrowError(/\.elseIf\(\) after \.else\(\)/);
	});

	it("raise placeholder/arg mismatch throws raise-arg-count-mismatch (%% is literal)", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.raise("100%% done, parent=%", row.parentId, row.postId);
				ctx.return(row);
			}),
		).toThrowError(/placeholder\(s\) but received/);
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
				"app",
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

	it("a trigger row is returned as a ref even when the table has a column named exprNode (#445/R4)", () => {
		const declaration = defineTrigger(
			tricky,
			trickyTriggerConfig,
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const [returnStmt] = declaration.functionDeclaration.body.statements;
		expect(returnStmt).toEqual({ stmtKind: "returnRef", refName: "new" });
	});

	it("a trigger row returned from a scalar-returning declaration still fails with scalar-return-expects-expression (#445/R4, delta: shape errors survive the reordering)", () => {
		// #445/R4 review R-f: a trigger row has no type-legal path into a
		// scalar declaration's ctx.return() at all (hence the type-escape
		// directive a few lines down) -- capturing one via a trigger body
		// is the only way to reproduce this, so this fixture defends the
		// runtime guard for a consumer who bypasses the types, not a shape
		// a well-typed caller could ever construct.
		const captured: { row?: unknown } = {};
		defineTrigger(comments, triggerConfig, (_ctx, { new: row }) => {
			captured.row = row;
		});
		expect(() =>
			defineFunction(
				app,
				"bad_scalar_from_trigger_row",
				{ returns: { typeName: "integer" } },
				(ctx) => {
					// @ts-expect-error — a TriggerRow isn't a valid ctx.return() argument for a scalar function
					ctx.return(captured.row);
				},
			),
		).toThrowError(/received a query or trigger row/);
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
		).toThrowError(/lists unknown column/);
	});

	it("defineFunction args become ArgRefs with plpgsqlRef paths and snake_cased names", () => {
		const declaration = defineFunction(
			app,
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
			{
				key: "postId",
				argName: "post_id",
				typeNode: { typeName: "uuid" },
				mode: null,
				notNullElements: false,
			},
		]);
	});

	it("forEach records a record declaration and nested statements inside a forEach node", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
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
		expect(declaration.functionDeclaration.body.declarations).toEqual([
			{ declKind: "record", name: "child" },
		]);
		const [forEachStmt, returnStmt] =
			declaration.functionDeclaration.body.statements;
		if (forEachStmt?.stmtKind !== "forEach") {
			throw new Error("expected a forEach statement");
		}
		expect(forEachStmt.loopName).toBe("child");
		expect(forEachStmt.statements).toHaveLength(1);
		expect(forEachStmt.statements[0]).toMatchObject({ stmtKind: "raise" });
		expect(returnStmt).toEqual({ stmtKind: "returnRef", refName: "new" });
	});

	it("auto-names unnamed loops deterministically (loop_1, loop_2)", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {},
				);
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {},
				);
				ctx.return(row);
			},
		);
		const [first, second] = declaration.functionDeclaration.body.statements;
		expect(first).toMatchObject({ stmtKind: "forEach", loopName: "loop_1" });
		expect(second).toMatchObject({ stmtKind: "forEach", loopName: "loop_2" });
	});

	it("loop row fields record plpgsqlRef with a two-segment path", () => {
		defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
			ctx.forEach(
				select({ postId: comments.postId }, comments).where(
					eq(comments.parentId, row.id),
				),
				(child) => {
					expect(child.postId.exprNode).toEqual({
						nodeKind: "plpgsqlRef",
						path: ["loop_1", "post_id"],
					});
				},
				undefined,
			);
			ctx.return(row);
		});
	});

	it("duplicate loop name throws duplicate-local-name", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {},
					"dup",
				);
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {},
					"dup",
				);
				ctx.return(row);
			}),
		).toThrowError(/already declared/);
	});

	it("reserved loop name throws reserved-local-name", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {},
					"when",
				);
				ctx.return(row);
			}),
		).toThrowError(/reserved word/);
	});

	it("forEach over a derived-expression projection throws row-projection-not-column", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				const badProjection = select(
					{ hasParent: isNotNull(comments.parentId) },
					comments,
				).where(eq(comments.id, row.id));
				// @ts-expect-error — isNotNull(...) isn't a ColumnRef; this exercises the runtime-only guard
				ctx.forEach(badProjection, () => {});
				ctx.return(row);
			}),
		).toThrowError(/isn't a plain column reference/);
	});

	it("an executed insert with returning is refused", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.execute(
					insert(comments).values({ postId: row.postId }).returning(),
				);
				ctx.return(row);
			}),
		).toThrowError(/ctx\.execute\(\).*returning/);
	});

	it("an executed insert without returning is recorded as an execute statement", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx.execute(insert(comments).values({ postId: row.postId }));
				ctx.return(row);
			},
		);
		const [executeStmt] = declaration.functionDeclaration.body.statements;
		expect(executeStmt?.stmtKind).toBe("execute");
	});

	it("ctx.execute() of a value that isn't a statement builder throws execute-expects-statement", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				// @ts-expect-error — a trigger row isn't a valid ctx.execute() argument
				ctx.execute(row);
			}),
		).toThrowError(/isn't a select, insert, update or delete builder/);
	});

	it("a sql fragment is a body condition", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				ctx
					.if(sql`${row.postId} is not null`, () => {
						ctx.raise("has a post");
					})
					.elseIf(sql`${row.id} is not null`, () => {
						ctx.raise("has an id");
					});
				ctx.return(row);
			},
		);
		const [ifStmt] = declaration.functionDeclaration.body.statements;
		expect(ifStmt?.stmtKind).toBe("if");
	});

	it("a query returned from a trigger body is refused", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.return(select(comments).where(eq(comments.id, row.id)));
			}),
		).toThrowError(
			/must return a trigger row.*Next: run the statement with ctx\.execute/,
		);
	});
});
