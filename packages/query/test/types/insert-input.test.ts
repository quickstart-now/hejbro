import type { Expr } from "@hejbro/core";
import {
	bigint,
	json,
	jsonb,
	schema,
	serial,
	sql,
	table,
	text,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { InsertInput, UpdateInput } from "../../src/types/insert-input";

const shop = schema("shop");

type Payload = { readonly kind: "widget" };

const posts = table(shop, "posts", {
	// F7 case (insert side): serial's implied hasDefault (task 3.16, D66)
	// makes this optional despite the implied notNull.
	id: serial().primaryKey(),
	// notNull, no default -> required.
	titleRequired: text().notNull(),
	// notNull + default -> optional (the spec's own "Defaulted column is
	// optional on insert" scenario).
	slug: text().notNull().default("untitled"),
	// no notNull -> optional, value accepts null.
	title: text(),
	tagsRequired: text().notNull().array(),
	amountRequired: bigint({ mode: "number" }).notNull(),
	payloadRequired: jsonb().$type<Payload>().notNull(),
	payloadJsonRequired: json().$type<Payload>().notNull(),
	payload: jsonb().$type<Payload>(),
});

type Posts = typeof posts;

/**
 * Concrete expected value unions (#337): since the chains consume
 * `InsertInput`/`UpdateInput`, the value arm is core's own
 * `MutationValue` — the declared read type, a matching-family `Expr`,
 * and the `sql` escape hatch (`Expr<"unknown">`); `json`/`jsonb` have
 * no raw-value arm at all. Spelled out literally here (never via
 * `MutationValue` itself — an assertion whose both sides route through
 * the same symbol cannot verify that symbol).
 */
type TextWrite = string | Expr<"text"> | Expr<"unknown">;
type NumericNumberWrite = number | Expr<"numeric"> | Expr<"unknown">;
type JsonWrite = Expr<"json"> | Expr<"unknown">;
type TextArrayWrite =
	| ReadonlyArray<string | null>
	| Expr<"array">
	| Expr<"unknown">;

/** The `sql` escape hatch value the unwritable (`json`/`jsonb`) columns use in every valid-row fixture below. */
const payloadExpr = sql`'{"kind":"widget"}'::jsonb`;

describe("insert-input (D1/D3/D8, task 3.11; value arm = MutationValue since #337)", () => {
	it("field consumption matrix: notNull decides required-vs-optional, hasDefault overrides notNull to optional", () => {
		type Input = InsertInput<Posts>;

		// notNull, no default -> required key, no null and no undefined arm.
		expectTypeOf<Input>()
			.toHaveProperty("titleRequired")
			.toEqualTypeOf<TextWrite>();

		// notNull + default -> optional key (this is the field-consumption
		// proof for hasDefault: removing this branch would make slug
		// required, which the spec's own scenario forbids).
		expectTypeOf<Input["slug"]>().toEqualTypeOf<TextWrite | undefined>();

		// no notNull -> optional key, value accepts null explicitly.
		expectTypeOf<Input["title"]>().toEqualTypeOf<
			TextWrite | null | undefined
		>();
	});

	it("required vs optional keys, checked structurally (not just per-field value types)", () => {
		// A required key (titleRequired) must be present; every other
		// required key is supplied here so the error is specifically about
		// the omitted one, not "everything is missing".
		// @ts-expect-error titleRequired is missing (notNull, no default).
		const _missingRequired: InsertInput<Posts> = {
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: payloadExpr,
			payloadJsonRequired: payloadExpr,
		};

		// An optional key may be omitted.
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const omittedOptional: InsertInput<Posts> = {
			titleRequired: "t",
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: payloadExpr,
			payloadJsonRequired: payloadExpr,
			// slug, title, id, payload all omitted -- legal.
		};
	});

	it("json().$type<T>() and jsonb().$type<T>() write arms are identical: Expr only, the brand narrows reads, never raw writes (#337)", () => {
		expectTypeOf<
			InsertInput<Posts>["payloadJsonRequired"]
		>().toEqualTypeOf<JsonWrite>();
		expectTypeOf<
			InsertInput<Posts>["payloadRequired"]
		>().toEqualTypeOf<JsonWrite>();
	});

	it("F7 settlement (insert side): serial().primaryKey() is optional despite its implied notNull (D66 hasDefault)", () => {
		expectTypeOf<InsertInput<Posts>["id"]>().toEqualTypeOf<
			NumericNumberWrite | undefined
		>();
	});

	it("composite cases: accumulated TMeta arrives intact for insert values too", () => {
		expectTypeOf<
			InsertInput<Posts>["tagsRequired"]
		>().toEqualTypeOf<TextArrayWrite>();
		expectTypeOf<
			InsertInput<Posts>["amountRequired"]
		>().toEqualTypeOf<NumericNumberWrite>();
		// id (serial().primaryKey()) already covers the mode+notNull+hasDefault
		// combination in the F7 case above.
	});

	it("rejects an undeclared column key", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const withUnknownKey: InsertInput<Posts> = {
			titleRequired: "t",
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: payloadExpr,
			payloadJsonRequired: payloadExpr,
			// @ts-expect-error "email" was never declared on posts.
			email: "nope@example.com",
		};
	});
});

describe("update-input (D1/D3, task 3.12)", () => {
	it("every declared column is optional, regardless of notNull/hasDefault", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const empty: UpdateInput<Posts> = {};
		expectTypeOf<UpdateInput<Posts>["titleRequired"]>().toEqualTypeOf<
			TextWrite | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["id"]>().toEqualTypeOf<
			NumericNumberWrite | undefined
		>();
	});

	it("3.11/3.12 boundary contrast pair: the identical declaration (notNull, no default) is required on insert but optional on update", () => {
		expectTypeOf<
			InsertInput<Posts>["titleRequired"]
		>().toEqualTypeOf<TextWrite>();
		expectTypeOf<UpdateInput<Posts>["titleRequired"]>().toEqualTypeOf<
			TextWrite | undefined
		>();
	});

	it("field consumption: mode/brand/element still shape the value type, only optionality changes", () => {
		expectTypeOf<UpdateInput<Posts>["amountRequired"]>().toEqualTypeOf<
			NumericNumberWrite | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["payloadRequired"]>().toEqualTypeOf<
			JsonWrite | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["tagsRequired"]>().toEqualTypeOf<
			TextArrayWrite | undefined
		>();
	});

	it("notNull still forbids an explicit null value, even though the key itself is optional (contrast with a nullable column)", () => {
		// @ts-expect-error titleRequired is notNull -- null is not a legal value, only omission is.
		const _nullOnNotNull: UpdateInput<Posts> = { titleRequired: null };
		// A nullable column accepts an explicit null (positive control).
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const nullOnNullable: UpdateInput<Posts> = { title: null };
	});

	it("rejects an undeclared column key", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const withUnknownKey: UpdateInput<Posts> = {
			titleRequired: "t",
			// @ts-expect-error "email" was never declared on posts.
			email: "nope@example.com",
		};
	});
});
