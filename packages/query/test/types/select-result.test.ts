import {
	bigint,
	json,
	jsonb,
	pgEnum,
	schema,
	serial,
	table,
	type tableMeta,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { SelectResult } from "../../src/types/select-result";

const shop = schema("shop");
const postStatus = pgEnum(shop, "post_status", ["draft", "published"]);

type Payload = { readonly kind: "widget" };

const posts = table(shop, "posts", {
	// F7 case 1: primaryKey() implies notNull (task 3.16) -- select side.
	id: uuid().primaryKey(),
	title: text(),
	titleRequired: text().notNull(),
	status: postStatus.column(),
	tags: text().array(),
	// composite 1: notNull + array together.
	tagsRequired: text().notNull().array(),
	amount: bigint({ mode: "number" }),
	// composite 2: mode + notNull together.
	amountRequired: bigint({ mode: "number" }).notNull(),
	payload: jsonb().$type<Payload>(),
	// composite 3: $type brand + notNull together.
	payloadRequired: jsonb().$type<Payload>().notNull(),
	payloadUnbranded: jsonb(),
	// json brand case (planner addition 1) -- json must behave like jsonb.
	payloadJson: json().$type<Payload>(),
	payloadJsonUnbranded: json(),
	// F7 case 2 / composite 4: serial's implied notNull (task 3.16) -- select side.
	sn: serial().primaryKey(),
});

type Posts = typeof posts;

describe("select-result (D1/D3/D5, task 3.10) -- whole-table projection", () => {
	it("field consumption matrix: each TMeta field the result type actually reads", () => {
		// typeName.
		expectTypeOf<SelectResult<Posts>["title"]>().toEqualTypeOf<string | null>();

		// notNull: same typeName, notNull flips null away (positive/negative contrast).
		expectTypeOf<
			SelectResult<Posts>["titleRequired"]
		>().toEqualTypeOf<string>();

		// element: array() wraps the base mapping (nullable since `tags` isn't notNull).
		expectTypeOf<
			SelectResult<Posts>["tags"]
		>().toEqualTypeOf<ReadonlyArray<string> | null>();

		// mode: bigint({mode:'number'}) reads as number, not the 'bigint' default.
		expectTypeOf<SelectResult<Posts>["amount"]>().toEqualTypeOf<
			number | null
		>();

		// jsonType (brand): jsonb().$type<Payload>() reads as Payload, not unknown.
		expectTypeOf<
			SelectResult<Posts>["payload"]
		>().toEqualTypeOf<Payload | null>();
		expectTypeOf<SelectResult<Posts>["payloadUnbranded"]>().toEqualTypeOf<
			unknown | null
		>();

		// hasDefault: not applicable to select (see select-result.ts's own
		// tsdoc) -- deliberately no case here; it's task 3.11's matrix entry.
	});

	it("json().$type<T>() brands exactly like jsonb().$type<T>() (planner addition 1 -- catches any leftover json-is-special-cased-unbranded artifact from the pre-relocation implementation)", () => {
		expectTypeOf<
			SelectResult<Posts>["payloadJson"]
		>().toEqualTypeOf<Payload | null>();
		expectTypeOf<SelectResult<Posts>["payloadJsonUnbranded"]>().toEqualTypeOf<
			unknown | null
		>();
	});

	it("enum column consumption (planner addition 4): pgEnum().column() reads as string", () => {
		expectTypeOf<SelectResult<Posts>["status"]>().toEqualTypeOf<
			string | null
		>();
	});

	it("F7 settlement (select side): uuid().primaryKey() and serial().primaryKey() are not null", () => {
		expectTypeOf<SelectResult<Posts>["id"]>().toEqualTypeOf<string>();
		expectTypeOf<SelectResult<Posts>["sn"]>().toEqualTypeOf<number>();
	});

	it("composite cases: accumulated TMeta arrives intact, not just one field at a time", () => {
		expectTypeOf<SelectResult<Posts>["tagsRequired"]>().toEqualTypeOf<
			ReadonlyArray<string>
		>();
		expectTypeOf<
			SelectResult<Posts>["amountRequired"]
		>().toEqualTypeOf<number>();
		expectTypeOf<
			SelectResult<Posts>["payloadRequired"]
		>().toEqualTypeOf<Payload>();
		// sn (serial().primaryKey()) already covers composite 4 in the F7 case above.
	});

	it("every declared column is present -- the whole-table form never drops or adds a key", () => {
		// keyof Posts also carries the hidden tableMeta symbol (Table's own
		// declaration-metadata key, D15) -- excluded here since
		// SelectResult only ever reflects declared columns.
		expectTypeOf<keyof SelectResult<Posts>>().toEqualTypeOf<
			Exclude<keyof Posts, typeof tableMeta>
		>();
	});
});

describe("select-result -- object projection (task 3.10)", () => {
	it("projection accuracy: only the projected keys exist on the result", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.title }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
		// @ts-expect-error "email" was never projected -- not a key of Proj.
		type _Rejected = Proj["email"];
	});

	it("honest widening: notNull is unknown from an Expr alone, so even a notNull-sourced column widens to nullable (contrast with the whole-table form's own titleRequired: string above)", () => {
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
	});

	it("family-only fallback: mode/brand/element are not visible through an Expr", () => {
		type AmountProj = SelectResult<{ readonly a: typeof posts.amountRequired }>;
		// family "numeric" covers every mode -- widest honest type, not just 'number'.
		expectTypeOf<AmountProj>().toEqualTypeOf<{
			readonly a: number | bigint | string | null;
		}>();

		type PayloadProj = SelectResult<{
			readonly p: typeof posts.payloadRequired;
		}>;
		// family "json" carries no brand -- unknown, even though the source column is branded.
		expectTypeOf<PayloadProj>().toEqualTypeOf<{ readonly p: unknown | null }>();
	});
});
