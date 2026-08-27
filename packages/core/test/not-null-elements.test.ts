import { describe, expectTypeOf, it } from "vitest";
import { schema } from "../src/dsl/schema";
import type { Table } from "../src/dsl/table";
import { table } from "../src/dsl/table";
import type { ColumnReadType } from "../src/types/column-builder";
import { jsonb, text } from "../src/types/column-builder-factories";

/**
 * task 1.2 (add-array-ergonomics): read/write element narrowing under
 * `.array().notNullElements()`. `ColumnReadType` is the single source both
 * `@hejbro/query`'s `ColumnTsType` (select-result reads) and this package's
 * own `MutationValue` (write-acceptance) narrow through (see its own tsdoc,
 * `column-builder.ts`), so pinning it here at the type level covers both —
 * write-side `@ts-expect-error` coverage lives alongside the rest of
 * `MutationValue`'s own tests, `test/query/mutate.test.ts`.
 */

const app = schema("app");

/** Extracts a {@link Table}'s own `TColumns` type parameter. */
type ColumnsOf<T> = T extends Table<infer TColumns> ? TColumns : never;

describe("notNullElements read narrowing (add-array-ergonomics, task 1.2)", () => {
	it("text().array() still reads ReadonlyArray<string | null> (#349, unchanged)", () => {
		const t = table(app, "not_null_elements_plain", {
			tags: text().array(),
		});
		type Columns = ColumnsOf<typeof t>;
		expectTypeOf<ColumnReadType<Columns["tags"]>>().toEqualTypeOf<
			ReadonlyArray<string | null>
		>();
	});

	it("text().array().notNullElements() reads ReadonlyArray<string>, no null", () => {
		const t = table(app, "not_null_elements_strict", {
			labels: text().array().notNullElements(),
		});
		type Columns = ColumnsOf<typeof t>;
		expectTypeOf<ColumnReadType<Columns["labels"]>>().toEqualTypeOf<
			ReadonlyArray<string>
		>();
	});

	it("the brand-array branch (.$type<T>().array()) narrows the same way", () => {
		type Payload = { readonly kind: "widget" };
		const t = table(app, "not_null_elements_brand", {
			payloads: jsonb().$type<Payload>().array(),
			strictPayloads: jsonb().$type<Payload>().array().notNullElements(),
		});
		type Columns = ColumnsOf<typeof t>;
		expectTypeOf<ColumnReadType<Columns["payloads"]>>().toEqualTypeOf<
			ReadonlyArray<Payload | null>
		>();
		expectTypeOf<ColumnReadType<Columns["strictPayloads"]>>().toEqualTypeOf<
			ReadonlyArray<Payload>
		>();
	});
});
