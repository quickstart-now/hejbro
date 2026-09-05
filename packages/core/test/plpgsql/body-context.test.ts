import { describe, expect, expectTypeOf, it } from "vitest";
import type { BodyContext, ReturnableQuery } from "../../src/index";
import {
	defineFunction,
	defineTrigger,
	deleteFrom,
	eq,
	insert,
	isNotNull,
	isNull,
	schema,
	select,
	sql,
	table,
	text,
	update,
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

// #748/task 2.1: a row read's locals depend on its projection -- `id`
// derives no owned name, `op` derives the owned `tg_op` under a row named
// `tg`.
const events = table(app, "events", {
	id: uuid().primaryKey(),
	op: uuid(),
});

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
		).toThrowError(
			/collides with a name Postgres reserves or plpgsql declares itself/,
		);
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
		).toThrowError(
			/a value hejbro cannot return: pass a select over the declared table/,
		);
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
		).toThrowError(
			/collides with a name Postgres reserves or plpgsql declares itself/,
		);
	});

	const ownedLoopNameCases: ReadonlyArray<{ readonly loopName: string }> = [
		{ loopName: "found" },
		{ loopName: "FOUND" },
		{ loopName: "Found" },
		{ loopName: "tg_op" },
		{ loopName: "TG_OP" },
	];

	it.each(ownedLoopNameCases)(
		"a loop named $loopName -- a name plpgsql declares itself, in any letter case -- throws reserved-local-name (#748)",
		({ loopName }) => {
			expect(() =>
				defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
					ctx.forEach(
						select(comments).where(eq(comments.parentId, row.id)),
						() => {},
						loopName,
					);
					ctx.return(row);
				}),
			).toThrowError(
				/collides with a name Postgres reserves or plpgsql declares itself/,
			);
		},
	);

	// `pg_get_keywords()` catcode `C` on `postgres:17.11`; re-measurement SQL
	// lives in design.md's Measurement (1.1) section.
	const categoryCLoopNameCases: ReadonlyArray<{ readonly loopName: string }> = [
		{ loopName: "between" },
		{ loopName: "bigint" },
		{ loopName: "bit" },
		{ loopName: "boolean" },
		{ loopName: "char" },
		{ loopName: "character" },
		{ loopName: "coalesce" },
		{ loopName: "dec" },
		{ loopName: "decimal" },
		{ loopName: "exists" },
		{ loopName: "extract" },
		{ loopName: "float" },
		{ loopName: "greatest" },
		{ loopName: "grouping" },
		{ loopName: "inout" },
		{ loopName: "int" },
		{ loopName: "integer" },
		{ loopName: "interval" },
		{ loopName: "json" },
		{ loopName: "json_array" },
		{ loopName: "json_arrayagg" },
		{ loopName: "json_exists" },
		{ loopName: "json_object" },
		{ loopName: "json_objectagg" },
		{ loopName: "json_query" },
		{ loopName: "json_scalar" },
		{ loopName: "json_serialize" },
		{ loopName: "json_table" },
		{ loopName: "json_value" },
		{ loopName: "least" },
		{ loopName: "merge_action" },
		{ loopName: "national" },
		{ loopName: "nchar" },
		{ loopName: "none" },
		{ loopName: "normalize" },
		{ loopName: "nullif" },
		{ loopName: "numeric" },
		{ loopName: "out" },
		{ loopName: "overlay" },
		{ loopName: "position" },
		{ loopName: "precision" },
		{ loopName: "real" },
		{ loopName: "row" },
		{ loopName: "setof" },
		{ loopName: "smallint" },
		{ loopName: "substring" },
		{ loopName: "time" },
		{ loopName: "timestamp" },
		{ loopName: "treat" },
		{ loopName: "trim" },
		{ loopName: "values" },
		{ loopName: "varchar" },
		{ loopName: "xmlattributes" },
		{ loopName: "xmlconcat" },
		{ loopName: "xmlelement" },
		{ loopName: "xmlexists" },
		{ loopName: "xmlforest" },
		{ loopName: "xmlnamespaces" },
		{ loopName: "xmlparse" },
		{ loopName: "xmlpi" },
		{ loopName: "xmlroot" },
		{ loopName: "xmlserialize" },
		{ loopName: "xmltable" },
	];

	it.each(categoryCLoopNameCases)(
		"a loop named $loopName -- a category-C keyword -- throws reserved-local-name (#832)",
		({ loopName }) => {
			expect(() =>
				defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
					ctx.forEach(
						select(comments).where(eq(comments.parentId, row.id)),
						() => {},
						loopName,
					);
					ctx.return(row);
				}),
			).toThrowError(
				/collides with a name Postgres reserves or plpgsql declares itself/,
			);
		},
	);

	const neverRefusedLoopNameCases: ReadonlyArray<{
		readonly loopName: string;
	}> = [{ loopName: "exit" }, { loopName: "elsif" }];

	it.each(neverRefusedLoopNameCases)(
		"a loop named $loopName -- absent from every category and never refused -- is accepted (control, #832)",
		({ loopName }) => {
			const declaration = defineTrigger(
				comments,
				triggerConfig,
				(ctx, { new: row }) => {
					ctx.forEach(
						select(comments).where(eq(comments.parentId, row.id)),
						() => {},
						loopName,
					);
					ctx.return(row);
				},
			);
			const [forEachStmt] = declaration.functionDeclaration.body.statements;
			expect(forEachStmt).toMatchObject({ stmtKind: "forEach", loopName });
		},
	);

	it("a row read named found is accepted -- its locals are found_<column>, never a variable under found itself (#748 control)", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				const found = ctx.row(
					select({ postId: comments.postId }, comments).where(
						eq(comments.id, row.parentId),
					),
					"found",
				);
				ctx.if(isNull(found.postId), () => {
					ctx.raise("not found");
				});
				ctx.return(row);
			},
		);
		expect(declaration.functionDeclaration.body.declarations).toEqual([
			{
				declKind: "scalar",
				name: "found_post_id",
				typeNode: { typeName: "uuid" },
			},
		]);
	});

	it("a row read named tg is accepted when its projection derives no owned name (#748/task 2.1 control)", () => {
		const declaration = defineTrigger(
			comments,
			triggerConfig,
			(ctx, { new: row }) => {
				const tg = ctx.row(
					select({ id: events.id }, events).where(eq(events.id, row.id)),
					"tg",
				);
				ctx.if(isNull(tg.id), () => {
					ctx.raise("not found");
				});
				ctx.return(row);
			},
		);
		expect(declaration.functionDeclaration.body.declarations).toEqual([
			{
				declKind: "scalar",
				name: "tg_id",
				typeNode: { typeName: "uuid" },
			},
		]);
	});

	it("a row read named tg is refused when its projection derives an owned name -- tg_op (#748/task 2.1)", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.row(
					select({ op: events.op }, events).where(eq(events.id, row.id)),
					"tg",
				);
				ctx.return(row);
			}),
		).toThrowError(
			/collides with a name Postgres reserves or plpgsql declares itself/,
		);
	});

	// Of the 63 category-C keywords, only these 11 contain an underscore --
	// a row-declared local is always `<row>_<col>`, so only these can ever
	// equal one exactly. The other 52 can only ever appear as a substring of
	// a row-declared local, never as the whole name, and are covered at the
	// argument and loop positions instead. `pg_get_keywords()` catcode `C`
	// on `postgres:17.11`; re-measurement SQL lives in design.md's
	// Measurement (1.1) section.
	const categoryCRowLocalCases: ReadonlyArray<{
		readonly rowName: string;
		readonly key: string;
		readonly derivedName: string;
	}> = [
		{ rowName: "json", key: "array", derivedName: "json_array" },
		{ rowName: "json", key: "arrayagg", derivedName: "json_arrayagg" },
		{ rowName: "json", key: "exists", derivedName: "json_exists" },
		{ rowName: "json", key: "object", derivedName: "json_object" },
		{ rowName: "json", key: "objectagg", derivedName: "json_objectagg" },
		{ rowName: "json", key: "query", derivedName: "json_query" },
		{ rowName: "json", key: "scalar", derivedName: "json_scalar" },
		{ rowName: "json", key: "serialize", derivedName: "json_serialize" },
		{ rowName: "json", key: "table", derivedName: "json_table" },
		{ rowName: "json", key: "value", derivedName: "json_value" },
		{ rowName: "merge", key: "action", derivedName: "merge_action" },
	];

	it.each(categoryCRowLocalCases)(
		"a row-declared local $derivedName (row $rowName, column $key) -- a category-C keyword -- throws reserved-local-name (#832)",
		({ rowName, key }) => {
			expect(() =>
				defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
					ctx.row(
						select({ [key]: comments.postId }, comments).where(
							eq(comments.id, row.id),
						),
						rowName,
					);
					ctx.return(row);
				}),
			).toThrowError(
				/collides with a name Postgres reserves or plpgsql declares itself/,
			);
		},
	);

	const neverRefusedRowNameCases: ReadonlyArray<{ readonly rowName: string }> =
		[{ rowName: "exit" }, { rowName: "elsif" }];

	it.each(neverRefusedRowNameCases)(
		"a row read named $rowName -- absent from every category and never refused -- is accepted (control, #832)",
		({ rowName }) => {
			const declaration = defineTrigger(
				comments,
				triggerConfig,
				(ctx, { new: row }) => {
					ctx.row(
						select({ postId: comments.postId }, comments).where(
							eq(comments.id, row.parentId),
						),
						rowName,
					);
					ctx.return(row);
				},
			);
			expect(declaration.functionDeclaration.body.declarations).toEqual([
				{
					declKind: "scalar",
					name: `${rowName}_post_id`,
					typeNode: { typeName: "uuid" },
				},
			]);
		},
	);

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

const MOCK_ID = "00000000-0000-0000-0000-000000000000";

/**
 * #686: a type-only `BodyContext` handle -- never assigned, never called at
 * runtime (the same technique `chain-mutation-input.test.ts` uses for
 * `ChainApi`). Every "call" below lives inside an arrow that is
 * type-checked but never invoked, so nothing here reaches `recordReturn`/
 * `recordExecute` at runtime -- evidence is `pnpm check-types` across the
 * workspace, never `vitest` (it can't see a type claim) and never a
 * `--filter` (the stage brand `@hejbro/query`'s own chain reads lives in
 * `packages/query/src/db/chain.ts`).
 */
declare const returnCtx: BodyContext;

describe("ctx.return demands a returning clause (#686)", () => {
	it("a mutation stage before .returning() is not assignable to ctx.return (type pin — evidence is check-types, not this test)", () => {
		const rejectedInsert = () =>
			// @ts-expect-error an insert with no .returning() is not a ReturnableQuery (#686)
			returnCtx.return(insert(comments).values({ postId: MOCK_ID }));
		const rejectedUpdate = () =>
			// @ts-expect-error an update with no .returning() is not a ReturnableQuery (#686)
			returnCtx.return(update(comments).set({ postId: MOCK_ID }));
		const rejectedDelete = () =>
			// @ts-expect-error a delete with no .returning() is not a ReturnableQuery (#686)
			returnCtx.return(deleteFrom(comments));
		const rejectedConflict = () => {
			const conflictStage = insert(comments)
				.values({ postId: MOCK_ID })
				.onConflictDoNothing(comments.id);
			// @ts-expect-error onConflictDoNothing's own stage is still pre-returning (#686)
			returnCtx.return(conflictStage);
		};
		expectTypeOf(rejectedInsert).toBeFunction();
		expectTypeOf(rejectedUpdate).toBeFunction();
		expectTypeOf(rejectedDelete).toBeFunction();
		expectTypeOf(rejectedConflict).toBeFunction();
	});

	it("the returning stage, a bare select, and an executed non-returning mutation still compile (controls)", () => {
		const acceptedBareReturning = () =>
			returnCtx.return(
				insert(comments).values({ postId: MOCK_ID }).returning(),
			);
		const acceptedDeleteReturning = () =>
			returnCtx.return(deleteFrom(comments).returning());
		const acceptedSelect = () => returnCtx.return(select(comments));
		const acceptedExecute = () =>
			returnCtx.execute(insert(comments).values({ postId: MOCK_ID }));
		expectTypeOf(acceptedBareReturning).toBeFunction();
		expectTypeOf(acceptedDeleteReturning).toBeFunction();
		expectTypeOf(acceptedSelect).toBeFunction();
		expectTypeOf(acceptedExecute).toBeFunction();
	});

	// #749/D8: `ReturnableQuery`'s mutation members narrow back to a bare
	// `.returning()` (`TReturning = undefined`) -- a projected one no
	// longer type-checks here, the compile-time half of the runtime
	// refusal `assertReturnIsWholeRow` throws (`return-expects-whole-row`,
	// `body-context.test.ts`'s own "a setof body accepts only the declared
	// table's whole row" describe block covers the runtime side).
	it("a projected returning no longer type-checks (#749/D8)", () => {
		const projected = update(comments)
			.set({ postId: MOCK_ID })
			.returning({ id: comments.id });
		const rejectedProjectedReturning = () =>
			// @ts-expect-error a projected returning is not the declared table's whole row
			returnCtx.return(projected);
		expectTypeOf(rejectedProjectedReturning).toBeFunction();
	});
});

// #749/D6: under `returns setof <table>`, `ctx.return()` accepts only a
// query whose rows are that table's whole row -- a select of the table,
// or a mutation on the table ending in a bare `.returning()`. Every other
// shape is refused at declaration time, even a projection that lists
// every column (Postgres matches `return query`'s columns positionally,
// names ignored, so a complete-but-reordered projection is the silently
// wrong case a partial one at least fails loudly on).
describe("a setof body accepts only the declared table's whole row (#749/D6)", () => {
	const wholeRowPosts = table(app, "posts", {
		id: uuid().primaryKey(),
		title: text().notNull(),
		body: text().notNull(),
	});
	const others = table(app, "others", {
		id: uuid().primaryKey(),
	});

	/** Bypasses `ReturnableQuery`'s own type-level narrowing (#749/D8) -- these rows exist to prove the runtime chokepoint a caller who reaches it with the type bypassed still gets, the same convention `assertReturnHasReturning`'s own tests already use elsewhere in this file. */
	const asReturnable = (value: unknown): ReturnableQuery =>
		value as ReturnableQuery;

	type RefusedRow = {
		readonly label: string;
		readonly query: () => ReturnableQuery;
	};

	const insertValues = { title: "t", body: "b" };

	const refusedRows: ReadonlyArray<RefusedRow> = [
		{
			label: "insert returning one column",
			query: () =>
				asReturnable(
					insert(wholeRowPosts).values(insertValues).returning({
						id: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "insert returning two columns",
			query: () =>
				asReturnable(
					insert(wholeRowPosts).values(insertValues).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
					}),
				),
		},
		{
			label: "insert returning every column, declared order",
			query: () =>
				asReturnable(
					insert(wholeRowPosts).values(insertValues).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
						body: wholeRowPosts.body,
					}),
				),
		},
		{
			label: "insert returning every column, another order",
			query: () =>
				asReturnable(
					insert(wholeRowPosts).values(insertValues).returning({
						body: wholeRowPosts.body,
						title: wholeRowPosts.title,
						id: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "insert returning an aliased column",
			query: () =>
				asReturnable(
					insert(wholeRowPosts).values(insertValues).returning({
						postId: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "update returning one column",
			query: () =>
				asReturnable(
					update(wholeRowPosts).set({ title: "t" }).returning({
						id: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "update returning two columns",
			query: () =>
				asReturnable(
					update(wholeRowPosts).set({ title: "t" }).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
					}),
				),
		},
		{
			label: "update returning every column, declared order",
			query: () =>
				asReturnable(
					update(wholeRowPosts).set({ title: "t" }).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
						body: wholeRowPosts.body,
					}),
				),
		},
		{
			label: "update returning every column, another order",
			query: () =>
				asReturnable(
					update(wholeRowPosts).set({ title: "t" }).returning({
						body: wholeRowPosts.body,
						title: wholeRowPosts.title,
						id: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "update returning an aliased column",
			query: () =>
				asReturnable(
					update(wholeRowPosts).set({ title: "t" }).returning({
						postId: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "delete returning one column",
			query: () =>
				asReturnable(
					deleteFrom(wholeRowPosts).returning({ id: wholeRowPosts.id }),
				),
		},
		{
			label: "delete returning two columns",
			query: () =>
				asReturnable(
					deleteFrom(wholeRowPosts).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
					}),
				),
		},
		{
			label: "delete returning every column, declared order",
			query: () =>
				asReturnable(
					deleteFrom(wholeRowPosts).returning({
						id: wholeRowPosts.id,
						title: wholeRowPosts.title,
						body: wholeRowPosts.body,
					}),
				),
		},
		{
			label: "delete returning every column, another order",
			query: () =>
				asReturnable(
					deleteFrom(wholeRowPosts).returning({
						body: wholeRowPosts.body,
						title: wholeRowPosts.title,
						id: wholeRowPosts.id,
					}),
				),
		},
		{
			label: "delete returning an aliased column",
			query: () =>
				asReturnable(
					deleteFrom(wholeRowPosts).returning({ postId: wholeRowPosts.id }),
				),
		},
		{
			label: "select with a column projection over the declared table",
			query: () =>
				asReturnable(select({ id: wholeRowPosts.id }, wholeRowPosts)),
		},
		{
			label: "select over another table",
			query: () => asReturnable(select(others)),
		},
		{
			label: "insert on another table, whole row",
			query: () =>
				asReturnable(insert(others).values({ id: MOCK_ID }).returning()),
		},
	];

	it.each(refusedRows)("refuses: $label", ({ query }) => {
		expect.assertions(2);
		try {
			defineFunction(
				app,
				"posts_setof_fn",
				{ returns: wholeRowPosts },
				(ctx) => {
					ctx.return(query());
				},
			);
		} catch (error) {
			expect(
				(error as InstanceType<typeof Error> & { code: string }).code,
			).toBe("return-expects-whole-row");
			expect((error as Error).message).toContain('whole row of "app"."posts"');
		}
	});

	type AcceptedRow = {
		readonly label: string;
		readonly query: () => ReturnableQuery;
	};

	const acceptedRows: ReadonlyArray<AcceptedRow> = [
		{ label: "select(posts)", query: () => select(wholeRowPosts) },
		{
			label: "select(posts).where(...)",
			query: () =>
				select(wholeRowPosts).where(eq(wholeRowPosts.id, wholeRowPosts.id)),
		},
		{
			label: "select(posts) with a join to others",
			query: () =>
				select(wholeRowPosts).innerJoin(
					others,
					eq(others.id, wholeRowPosts.id),
				),
		},
		{
			label: "insert(posts)...returning()",
			query: () => insert(wholeRowPosts).values(insertValues).returning(),
		},
		{
			label: "update(posts)...returning()",
			query: () => update(wholeRowPosts).set({ title: "t" }).returning(),
		},
		{
			label: "deleteFrom(posts)...returning()",
			query: () => deleteFrom(wholeRowPosts).returning(),
		},
	];

	it.each(acceptedRows)(
		"accepts and renders physical order: $label",
		({ query }) => {
			const declaration = defineFunction(
				app,
				"posts_setof_fn",
				{ returns: wholeRowPosts },
				(ctx) => {
					ctx.return(query());
				},
			);
			const [statement] = declaration.body.statements;
			expect(statement?.stmtKind).toBe("returnQuery");
		},
	);

	it("precedence: a no-returning mutation with the type bypassed still fails with return-expects-returning first", () => {
		expect(() =>
			defineFunction(
				app,
				"posts_setof_fn",
				{ returns: wholeRowPosts },
				(ctx) => {
					ctx.return(asReturnable(insert(wholeRowPosts).values(insertValues)));
				},
			),
		).toThrowError(
			expect.objectContaining({ code: "return-expects-returning" }),
		);
	});

	it("precedence: a scalar body with a projected returning still fails with scalar-return-expects-expression", () => {
		expect(() =>
			defineFunction(
				app,
				"scalar_fn",
				{ returns: { typeName: "uuid" } },
				(ctx) => {
					ctx.return(
						asReturnable(
							insert(wholeRowPosts).values(insertValues).returning({
								id: wholeRowPosts.id,
							}),
						),
					);
				},
			),
		).toThrowError(
			expect.objectContaining({ code: "scalar-return-expects-expression" }),
		);
	});

	it("precedence: a trigger body with a projected returning still fails with trigger-return-expects-row", () => {
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx) => {
				ctx.return(
					asReturnable(
						update(comments).set({ postId: MOCK_ID }).returning({
							id: comments.id,
						}),
					),
				);
			}),
		).toThrowError(
			expect.objectContaining({ code: "trigger-return-expects-row" }),
		);
	});
});
