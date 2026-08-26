import { bigint, json, jsonb, schema, serial, table, text } from "@hejbro/core";
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

describe("insert-input (D1/D3/D8, task 3.11)", () => {
	it("field consumption matrix: notNull decides required-vs-optional, hasDefault overrides notNull to optional", () => {
		type Input = InsertInput<Posts>;

		// notNull, no default -> required key, non-null value type.
		expectTypeOf<Input>()
			.toHaveProperty("titleRequired")
			.toEqualTypeOf<string>();

		// notNull + default -> optional key (this is the field-consumption
		// proof for hasDefault: removing this branch would make slug
		// required, which the spec's own scenario forbids).
		expectTypeOf<Input["slug"]>().toEqualTypeOf<string | undefined>();

		// no notNull -> optional key, value accepts null explicitly.
		expectTypeOf<Input["title"]>().toEqualTypeOf<string | null | undefined>();
	});

	it("required vs optional keys, checked structurally (not just per-field value types)", () => {
		// A required key (titleRequired) must be present; every other
		// required key is supplied here so the error is specifically about
		// the omitted one, not "everything is missing".
		// @ts-expect-error titleRequired is missing (notNull, no default).
		const _missingRequired: InsertInput<Posts> = {
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: { kind: "widget" },
			payloadJsonRequired: { kind: "widget" },
		};

		// An optional key may be omitted.
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const omittedOptional: InsertInput<Posts> = {
			titleRequired: "t",
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: { kind: "widget" },
			payloadJsonRequired: { kind: "widget" },
			// slug, title, id, payload all omitted -- legal.
		};
	});

	it("json().$type<T>() brands the insert value exactly like jsonb().$type<T>() (planner addition 1)", () => {
		expectTypeOf<
			InsertInput<Posts>["payloadJsonRequired"]
		>().toEqualTypeOf<Payload>();
	});

	it("F7 settlement (insert side): serial().primaryKey() is optional despite its implied notNull (D66 hasDefault)", () => {
		expectTypeOf<InsertInput<Posts>["id"]>().toEqualTypeOf<
			number | undefined
		>();
	});

	it("composite cases: accumulated TMeta arrives intact for insert values too", () => {
		expectTypeOf<InsertInput<Posts>["tagsRequired"]>().toEqualTypeOf<
			ReadonlyArray<string>
		>();
		expectTypeOf<
			InsertInput<Posts>["amountRequired"]
		>().toEqualTypeOf<number>();
		expectTypeOf<
			InsertInput<Posts>["payloadRequired"]
		>().toEqualTypeOf<Payload>();
		// id (serial().primaryKey()) already covers the mode+notNull+hasDefault
		// combination in the F7 case above.
	});

	it("rejects an undeclared column key", () => {
		// biome-ignore lint/correctness/noUnusedVariables: type-only fixture.
		const withUnknownKey: InsertInput<Posts> = {
			titleRequired: "t",
			tagsRequired: ["a"],
			amountRequired: 1,
			payloadRequired: { kind: "widget" },
			payloadJsonRequired: { kind: "widget" },
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
			string | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["id"]>().toEqualTypeOf<
			number | undefined
		>();
	});

	it("3.11/3.12 boundary contrast pair: the identical declaration (notNull, no default) is required on insert but optional on update", () => {
		expectTypeOf<InsertInput<Posts>["titleRequired"]>().toEqualTypeOf<string>();
		expectTypeOf<UpdateInput<Posts>["titleRequired"]>().toEqualTypeOf<
			string | undefined
		>();
	});

	it("field consumption: mode/brand/element still shape the value type, only optionality changes", () => {
		expectTypeOf<UpdateInput<Posts>["amountRequired"]>().toEqualTypeOf<
			number | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["payloadRequired"]>().toEqualTypeOf<
			Payload | undefined
		>();
		expectTypeOf<UpdateInput<Posts>["tagsRequired"]>().toEqualTypeOf<
			ReadonlyArray<string> | undefined
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
