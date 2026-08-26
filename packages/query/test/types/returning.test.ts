import { bigint, jsonb, schema, serial, table, text } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { ReturningRow } from "../../src/types/returning";
import type { SelectResult } from "../../src/types/select-result";

const shop = schema("shop");

type Payload = { readonly kind: "widget" };

const posts = table(shop, "posts", {
	id: serial().primaryKey(),
	title: text(),
	titleRequired: text().notNull(),
	amount: bigint({ mode: "number" }),
	payload: jsonb().$type<Payload>(),
});

type Posts = typeof posts;

describe("returning (D1/D3, task 3.13)", () => {
	it("no-arg returning() is every declared column, typed exactly like the whole-table select projection", () => {
		type NoArgRow = ReturningRow<Posts>;
		expectTypeOf<NoArgRow>().toEqualTypeOf<SelectResult<Posts>>();
		// each field's own nullability/mode/brand still applies -- not a
		// widened or unknown fallback.
		expectTypeOf<NoArgRow["titleRequired"]>().toEqualTypeOf<string>();
		expectTypeOf<NoArgRow["amount"]>().toEqualTypeOf<number | null>();
		expectTypeOf<NoArgRow["payload"]>().toEqualTypeOf<Payload | null>();
	});

	it("an object projection returns exactly like the same projection through select()", () => {
		type Proj = { readonly t: typeof posts.title };
		type ProjectedRow = ReturningRow<Posts, Proj>;
		expectTypeOf<ProjectedRow>().toEqualTypeOf<SelectResult<Proj>>();
	});

	it("used from an insert()'s returning() (planner addition 3, path 1 of 2)", () => {
		// insert() always returns every column when called with no
		// projection (core's InsertReturnable.returning(projection?)).
		type InsertedRow = ReturningRow<Posts>;
		expectTypeOf<InsertedRow["id"]>().toEqualTypeOf<number>();
	});

	it("used from a delete()'s returning() (planner addition 3, path 2 of 2)", () => {
		// delete()'s returning() shares the identical ReturningProjection
		// shape as insert()/update() (core's DeleteReturnable.returning) --
		// exercising it here with an object projection proves ReturningRow
		// has nothing insert/update-specific baked in.
		type DeletedRow = ReturningRow<
			Posts,
			{ readonly deletedTitle: typeof posts.title }
		>;
		expectTypeOf<DeletedRow>().toEqualTypeOf<{
			readonly deletedTitle: string | null;
		}>();
	});
});
