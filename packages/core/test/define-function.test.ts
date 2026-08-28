import { describe, expect, expectTypeOf, it } from "vitest";
import type { ColumnBuilder, FunctionDeclaration } from "../src/index";
import {
	defineFunction,
	defineTrigger,
	eq,
	functionKind,
	renderFunctionSql,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
} from "../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
});

describe("defineFunction", () => {
	it("accepts the declared schema object and derives the identity from it", () => {
		const fn = defineFunction(app, "f", { returns: posts }, (ctx) => {
			ctx.return(select(posts));
		});
		expect(fn.schemaName).toBe("app");
		expect(functionKind.identify(functionKind.serialize(fn))).toBe("app.f");
	});

	it("still accepts the schema name as a string (deprecated on 0.1.x)", () => {
		const fn = defineFunction("app", "g", { returns: posts }, (ctx) => {
			ctx.return(select(posts));
		});
		expect(fn.schemaName).toBe("app");
	});

	it("both forms produce the same snapshot for the same function", () => {
		const fromObject = functionKind.serialize(
			defineFunction(app, "publish_post", { returns: posts }, (ctx) => {
				ctx.return(select(posts));
			}),
		);
		const fromString = functionKind.serialize(
			defineFunction("app", "publish_post", { returns: posts }, (ctx) => {
				ctx.return(select(posts));
			}),
		);
		expect(fromObject).toEqual(fromString);
	});
});

describe("FunctionDeclaration<TArgs, TReturns> generics (task 4.10)", () => {
	const searchByStatus = defineFunction(
		app,
		"search_by_status",
		{ args: { status: text() }, returns: posts },
		(ctx, args) => {
			ctx.return(select(posts).where(eq(posts.status, args.status)));
		},
	);

	type ExtractedArgs<T> =
		T extends FunctionDeclaration<infer A, infer _R> ? A : never;
	type ExtractedReturns<T> =
		T extends FunctionDeclaration<infer _A, infer R> ? R : never;
	type SearchArgs = ExtractedArgs<typeof searchByStatus>;
	type SearchReturns = ExtractedReturns<typeof searchByStatus>;

	it("FunctionDeclaration<A> and FunctionDeclaration<B> are not mutually assignable -- the phantom anchor actually narrows, not a false pass", () => {
		type FnA = FunctionDeclaration<{ readonly a: ColumnBuilder<"text"> }>;
		type FnB = FunctionDeclaration<{ readonly b: ColumnBuilder<"uuid"> }>;

		// @ts-expect-error FnB's args shape ({b}) can't stand in for FnA's ({a}).
		const _bAsA: FnA = {} as FnB;
		// @ts-expect-error FnA's args shape ({a}) can't stand in for FnB's ({b}).
		const _aAsB: FnB = {} as FnA;
	});

	it("the declared args shape is recoverable via the anchor -- exactly the declared key, not widened to every string (proof the anchor is actually load-bearing, not just present)", () => {
		expectTypeOf<keyof SearchArgs>().toEqualTypeOf<"status">();
		// @ts-expect-error "statuz" is a typo -- only "status" was declared.
		type _Typo = SearchArgs["statuz"];
	});

	it("a declared arg's own ColumnBuilder shape is preserved exactly, not widened to a bare family string", () => {
		expectTypeOf<SearchArgs["status"]>().toEqualTypeOf<
			ReturnType<typeof text>
		>();
		// @ts-expect-error a uuid() builder can't stand in for the declared text() arg.
		const _wrongFamily: SearchArgs["status"] = uuid();
	});

	it("the returns-table type is preserved with its own columns still typed -- not the {schemaName, tableName} string erasure task 4.10 fixes", () => {
		expectTypeOf<SearchReturns>().toEqualTypeOf<typeof posts>();
		// the actual point: a declared column of the returned table is still
		// reachable and typed, which {schemaName, tableName} alone never was.
		expectTypeOf<SearchReturns["id"]>().toEqualTypeOf<(typeof posts)["id"]>();
	});

	it("runtime carries no trace of the generic -- the phantom key is never actually set on the declared value", () => {
		const bare: FunctionDeclaration = searchByStatus;
		expect(Object.getOwnPropertySymbols(bare)).toHaveLength(0);
		expect(bare.args).toEqual([
			{ argName: "status", typeNode: { typeName: "text" } },
		]);
	});
});

/** The `code` of the HejbroError `run` throws — the codes are the stable contract, the prose is not. */
const codeOf = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		return (error as { code: string }).code;
	}
	return "(did not throw)";
};

describe("scalar-returning functions (#424)", () => {
	it("returns a scalar expression", () => {
		const fn = defineFunction(
			app,
			"post_count",
			{ returns: { typeName: "integer" } },
			(ctx) => {
				ctx.return(sql`(select count(*) from "app"."posts")`);
			},
		);
		expect(renderFunctionSql(fn)).toContain(
			'return (select count(*) from "app"."posts");',
		);
		expect(renderFunctionSql(fn)).toContain("returns integer");
	});

	it("returns an argument reference", () => {
		const fn = defineFunction(
			app,
			"echo_status",
			{ args: { status: text() }, returns: { typeName: "text" } },
			(ctx, args) => {
				ctx.return(args.status);
			},
		);
		expect(renderFunctionSql(fn)).toContain("return status;");
	});

	it("rejects a query return -- Postgres refuses RETURN QUERY in a non-SETOF function", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"bad_count",
					{ returns: { typeName: "integer" } },
					(ctx) => {
						ctx.return(select(posts));
					},
				),
			),
		).toBe("scalar-return-expects-expression");
	});

	it("rejects a body that never returns", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"silent",
					{ returns: { typeName: "integer" } },
					() => {},
				),
			),
		).toBe("scalar-return-missing");
	});

	it("rejects a scalar expression from a setof function", () => {
		expect(
			codeOf(() =>
				defineFunction(app, "wrong_way", { returns: posts }, (ctx) => {
					ctx.return(sql`1`);
				}),
			),
		).toBe("scalar-return-in-non-scalar-function");
	});

	it("rejects a scalar expression from a trigger body", () => {
		expect(
			codeOf(() =>
				defineTrigger(
					posts,
					{
						name: "bad_trigger",
						timing: "before",
						events: ["insert"],
						forEach: "row",
					},
					(ctx) => {
						ctx.return(sql`1`);
					},
				),
			),
		).toBe("scalar-return-in-non-scalar-function");
	});
});
