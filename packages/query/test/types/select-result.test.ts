import type { Expr } from "@hejbro/core";
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

		// element: array() wraps the base mapping (nullable since `tags` isn't
		// notNull); elements themselves carry `| null` (#349 -- Postgres
		// arrays are element-nullable regardless of the column's own notNull).
		expectTypeOf<SelectResult<Posts>["tags"]>().toEqualTypeOf<ReadonlyArray<
			string | null
		> | null>();

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

	it("enum column consumption (#422): pgEnum().column() reads as its declared values", () => {
		// Was `string | null` (planner addition 4, add-query-layer): pgEnum
		// took `ReadonlyArray<string>` and was not generic, so the values
		// sitting at the call site never reached the type system and every
		// string type-checked as a status. #422 carries them through.
		expectTypeOf<SelectResult<Posts>["status"]>().toEqualTypeOf<
			"draft" | "published" | null
		>();
	});

	it("F7 settlement (select side): uuid().primaryKey() and serial().primaryKey() are not null", () => {
		expectTypeOf<SelectResult<Posts>["id"]>().toEqualTypeOf<string>();
		expectTypeOf<SelectResult<Posts>["sn"]>().toEqualTypeOf<number>();
	});

	it("composite cases: accumulated TMeta arrives intact, not just one field at a time", () => {
		expectTypeOf<SelectResult<Posts>["tagsRequired"]>().toEqualTypeOf<
			ReadonlyArray<string | null>
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

	it("a projected table column keeps its declared type (#311)", () => {
		// Was the family-only fallback: "numeric" covers every mode, so a
		// mode-'number' bigint read back as number|bigint|string. The origin
		// brand TableColumns already stamps on every column ref carries the
		// declaring column map and key, so the declared type is recoverable
		// without a name match.
		type AmountProj = SelectResult<{ readonly a: typeof posts.amountRequired }>;
		expectTypeOf<AmountProj>().toEqualTypeOf<{ readonly a: number | null }>();

		type PayloadProj = SelectResult<{
			readonly p: typeof posts.payloadRequired;
		}>;
		expectTypeOf<PayloadProj>().toEqualTypeOf<{ readonly p: Payload | null }>();

		type TagsProj = SelectResult<{ readonly t: typeof posts.tags }>;
		expectTypeOf<TagsProj>().toEqualTypeOf<{
			readonly t: ReadonlyArray<string | null> | null;
		}>();
	});

	it("nullability stays widened until #307 -- a left join can null any projected column", () => {
		// The one axis a projection still cannot know: the projection type is
		// fixed at select() time, before .leftJoin() is chained, so a
		// notNull-sourced column must still read as nullable. Narrowing this
		// without tracking left-joined tables would be the first type in this
		// package to lie.
		type Proj = SelectResult<{ readonly t: typeof posts.titleRequired }>;
		expectTypeOf<Proj>().toEqualTypeOf<{ readonly t: string | null }>();
	});

	it("a non-column expression still falls back to its family", () => {
		type Proj = SelectResult<{ readonly n: Expr<"numeric"> }>;
		expectTypeOf<Proj>().toEqualTypeOf<{
			readonly n: number | bigint | string | null;
		}>();
	});
});
