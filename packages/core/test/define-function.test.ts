import { describe, expect, expectTypeOf, it } from "vitest";
import type { ColumnBuilder, FunctionDeclaration } from "../src/index";
import {
	bigint,
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
	timestamptz,
	uuid,
	varchar,
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
			{
				key: "status",
				argName: "status",
				typeNode: { typeName: "text" },
				mode: null,
				notNullElements: false,
			},
		]);
	});
});

describe("resolved args carry the declared key (#587)", () => {
	it("keeps each argument's declared key beside its SQL name", () => {
		const fn = defineFunction(
			app,
			"touch_post",
			{
				args: { postId: uuid(), createdAt: timestamptz() },
				returns: posts,
			},
			(ctx) => {
				ctx.return(select(posts));
			},
		);
		expect(fn.args).toEqual([
			{
				key: "postId",
				argName: "post_id",
				typeNode: { typeName: "uuid" },
				mode: null,
				notNullElements: false,
			},
			{
				key: "createdAt",
				argName: "created_at",
				typeNode: { typeName: "timestamptz" },
				mode: null,
				notNullElements: false,
			},
		]);
	});

	it("keeps an argument's declared mode and element nullability", () => {
		const fn = defineFunction(
			app,
			"adjust_score",
			{
				args: {
					amount: bigint({ mode: "number" }),
					tags: text().array().notNullElements(),
				},
				returns: posts,
			},
			(ctx) => {
				ctx.return(select(posts));
			},
		);
		expect(fn.args).toEqual([
			{
				key: "amount",
				argName: "amount",
				typeNode: { typeName: "bigint" },
				mode: "number",
				notNullElements: false,
			},
			{
				key: "tags",
				argName: "tags",
				typeNode: { typeName: "array", element: { typeName: "text" } },
				mode: null,
				notNullElements: true,
			},
		]);
	});
});

describe("returns as a column builder (#433)", () => {
	it("a parameterized type declared as a builder keeps its detail", () => {
		const fn = defineFunction(
			app,
			"short_status",
			{ returns: varchar({ length: 10 }) },
			(ctx) => {
				ctx.return(sql`'ok'`);
			},
		);
		expect(renderFunctionSql(fn)).toContain("returns varchar(10)");
	});

	it("keeps the builder's own type on the phantom generic, not a node reconstructed from TMeta", () => {
		const fn = defineFunction(
			app,
			"short_status_typed",
			{ returns: varchar({ length: 10 }) },
			(ctx) => {
				ctx.return(sql`'ok'`);
			},
		);
		type Returns =
			typeof fn extends FunctionDeclaration<infer _A, infer R> ? R : never;
		expectTypeOf<Returns>().toEqualTypeOf<ReturnType<typeof varchar>>();
	});

	it("a type node stays a valid return declaration (the builder form is additive)", () => {
		const fn = defineFunction(
			app,
			"legacy_style",
			{ returns: { typeName: "integer" } },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		expect(renderFunctionSql(fn)).toContain("returns integer");
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

describe("an argument key whose derived name is not a hejbro SQL name is refused (#679)", () => {
	const rejectedCases: ReadonlyArray<{
		readonly label: string;
		readonly args: Record<string, ColumnBuilder>;
	}> = [
		{ label: "a hyphen", args: { "my-arg": uuid() } },
		{ label: "a leading digit", args: { "2nd": uuid() } },
		// biome-ignore lint/style/useNamingConvention: adversarial upper-case key under test.
		{ label: "an upper-case first letter", args: { Weight: uuid() } },
		{ label: "a space", args: { "my arg": uuid() } },
		{ label: "a double quote", args: { 'q"k': uuid() } },
		// biome-ignore lint/style/useNamingConvention: adversarial non-ASCII key under test.
		{ label: "a non-ASCII letter", args: { café: uuid() } },
		{
			label: "__proto__ as a computed own key",
			args: { ["__proto__"]: uuid() },
		},
		{ label: "the empty string", args: { "": uuid() } },
	];

	it.each(rejectedCases)(
		"refuses an argument key with $label with invalid-sql-name",
		({ args }) => {
			expect(
				codeOf(() =>
					defineFunction(
						app,
						"echo_arg",
						{ args, returns: { typeName: "uuid" } },
						(ctx) => {
							ctx.return(sql`null`);
						},
					),
				),
			).toBe("invalid-sql-name");
		},
	);

	it("names the function, the declared key and the derived name in the refusal", () => {
		expect(() =>
			defineFunction(
				app,
				"echo_arg",
				// biome-ignore lint/style/useNamingConvention: adversarial upper-case key under test.
				{ args: { Weight: uuid() }, returns: { typeName: "uuid" } },
				(ctx) => {
					ctx.return(sql`null`);
				},
			),
		).toThrowError(
			/argument "Weight" of function app\.echo_arg name "_weight" is not a valid hejbro SQL identifier.*Next: rename the argument "Weight" of function app\.echo_arg to snake_case\./s,
		);
	});

	it("a camelCase key still declares its snake_case argument (control)", () => {
		const fn = defineFunction(
			app,
			"touch_post_delay",
			{
				args: { postId: uuid(), delay: bigint({ mode: "number" }) },
				returns: posts,
			},
			(ctx) => {
				ctx.return(select(posts));
			},
		);
		expect(fn.args).toEqual([
			{
				key: "postId",
				argName: "post_id",
				typeNode: { typeName: "uuid" },
				mode: null,
				notNullElements: false,
			},
			{
				key: "delay",
				argName: "delay",
				typeNode: { typeName: "bigint" },
				mode: "number",
				notNullElements: false,
			},
		]);
	});

	it("a reserved word keeps its own refusal, not the SQL-name refusal (control)", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"echo_order",
					{ args: { order: uuid() }, returns: { typeName: "uuid" } },
					(ctx) => {
						ctx.return(sql`null`);
					},
				),
			),
		).toBe("reserved-local-name");
	});
});

describe("a literal __proto__ key replaces the args object's prototype instead of declaring an argument (#679, D106 review B1)", () => {
	it("a literal __proto__: key is refused with args-prototype-key, and no declaration is produced", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"echo_proto",
					{ args: { __proto__: uuid() }, returns: { typeName: "uuid" } },
					(ctx) => {
						ctx.return(sql`null`);
					},
				),
			),
		).toBe("args-prototype-key");
	});

	it("a computed __proto__ key is still refused as an invalid SQL name (no regression)", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"echo_proto_computed",
					{ args: { ["__proto__"]: uuid() }, returns: { typeName: "uuid" } },
					(ctx) => {
						ctx.return(sql`null`);
					},
				),
			),
		).toBe("invalid-sql-name");
	});

	it("a spread of a computed __proto__ key copies it as an own property, still refused as invalid-sql-name", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"echo_proto_spread",
					{
						args: { ...{ ["__proto__"]: uuid() } },
						returns: { typeName: "uuid" },
					},
					(ctx) => {
						ctx.return(sql`null`);
					},
				),
			),
		).toBe("invalid-sql-name");
	});

	it("args built with Object.create(null) is accepted (control)", () => {
		const nullProtoArgs = Object.assign(Object.create(null) as object, {
			status: text(),
		}) as { readonly status: ReturnType<typeof text> };
		expect(Object.getPrototypeOf(nullProtoArgs)).toBeNull();
		const fn = defineFunction(
			app,
			"echo_null_proto",
			{ args: nullProtoArgs, returns: { typeName: "text" } },
			(ctx, args) => {
				ctx.return(args.status);
			},
		);
		expect(fn.args[0]?.argName).toBe("status");
	});

	it("a literal __proto__ key beside a real argument is still refused, and the message never claims no key declares an argument", () => {
		let caught: unknown;
		try {
			defineFunction(
				app,
				"echo_proto_with_real_arg",
				{
					args: { __proto__: uuid(), realArg: text() },
					returns: { typeName: "uuid" },
				},
				(ctx) => {
					ctx.return(sql`null`);
				},
			);
		} catch (error) {
			caught = error;
		}
		expect((caught as { code?: string } | undefined)?.code).toBe(
			"args-prototype-key",
		);
		expect((caught as { message?: string } | undefined)?.message).not.toMatch(
			/no key on it declares an argument/,
		);
	});
});

describe("a returns builder with notNullElements is refused (#433)", () => {
	it("rejects notNullElements at a returns position", () => {
		expect(
			codeOf(() =>
				defineFunction(
					app,
					"tag_list",
					{ returns: text().array().notNullElements() },
					(ctx) => {
						ctx.return(sql`array[]::text[]`);
					},
				),
			),
		).toBe("returns-not-null-elements-unsupported");
	});

	it("names why dropping the flag loses nothing", () => {
		expect(() =>
			defineFunction(
				app,
				"tag_list_2",
				{ returns: text().array().notNullElements() },
				(ctx) => {
					ctx.return(sql`array[]::text[]`);
				},
			),
		).toThrowError(
			/returns clause derives no constraint.*Next:.*drop \.notNullElements\(\)/s,
		);
	});

	it("a plain array return (no notNullElements) is unaffected", () => {
		const fn = defineFunction(
			app,
			"tag_list_3",
			{ returns: text().array() },
			(ctx) => {
				ctx.return(sql`array[]::text[]`);
			},
		);
		expect(renderFunctionSql(fn)).toContain("returns text[]");
	});

	it("notNullElements is still legitimate as an argument or a column -- the refusal fires only at a returns position", () => {
		const fn = defineFunction(
			app,
			"tag_filter",
			{ args: { tags: text().array().notNullElements() }, returns: posts },
			(ctx) => {
				ctx.return(select(posts));
			},
		);
		expect(fn.args[0]?.argName).toBe("tags");

		const tableWithArray = table(app, "articles", {
			id: uuid().primaryKey(),
			tags: text().array().notNullElements(),
		});
		expect(tableWithArray.tags).toBeDefined();
	});
});
