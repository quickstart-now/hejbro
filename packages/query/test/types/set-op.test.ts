import { bigint, schema, table, text, uuid } from "@hejbro/core";
import { describe, expectTypeOf, it } from "vitest";
import type { SetOpResult } from "../../src/types/set-op";
import type { SelectResult } from "../../src/types/select-result";

const app = schema("app");
const activeUsers = table(app, "active_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
	score: bigint().notNull(),
});
const archivedUsers = table(app, "archived_users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
	score: bigint(),
});
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
});

type Active = SelectResult<typeof activeUsers>;
type Archived = SelectResult<typeof archivedUsers>;
type Posts = SelectResult<typeof posts>;

describe("set-op result typing (add-set-operations task 3.2)", () => {
	it("identical shapes pass through; nullability widens; mismatched keys resolve never", () => {
		// identical branches: unchanged
		expectTypeOf<SetOpResult<Active, Active>>().toEqualTypeOf<Active>();
		// score notNull ∪ nullable = nullable
		expectTypeOf<SetOpResult<Active, Archived>["score"]>().toEqualTypeOf<
			bigint | null
		>();
		expectTypeOf<SetOpResult<Active, Archived>["name"]>().toEqualTypeOf<string>();
		// mismatched key sets: never (the combinator's parameter side uses
		// this to poison the call -- DB would reject the statement)
		expectTypeOf<SetOpResult<Active, Posts>>().toBeNever();
	});
});
