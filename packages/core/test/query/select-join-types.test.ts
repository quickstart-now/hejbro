import { describe, expectTypeOf, it } from "vitest";
import type {
	SelectDistinctable,
	SelectJoinable,
	UntrackedJoins,
} from "../../src/index";
import { eq, schema, select, table, text, uuid } from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text(),
});

describe("left-joined tracking surface (narrow-join-nullability, task 1.1)", () => {
	it("UntrackedJoins is exported from core's public surface, and is the type top (corrected mid-group after a measured TS2379 -- see the file's own doc comment)", () => {
		expectTypeOf<UntrackedJoins>().toEqualTypeOf<unknown>();
	});
});

describe("core select stages thread the left-joined set (task 1.2)", () => {
	it("select() starts at never -- no table has been left-joined yet", () => {
		expectTypeOf(select(posts)).toEqualTypeOf<
			SelectDistinctable<typeof posts, never>
		>();
	});
});

const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

describe("leftJoin accumulates the joined table, innerJoin does not (task 1.3)", () => {
	it("leftJoin(comments) carries typeof comments in the left-joined set", () => {
		const joined = select(posts).leftJoin(
			comments,
			eq(posts.id, comments.postId),
		);
		expectTypeOf(joined).toEqualTypeOf<
			SelectJoinable<typeof posts, typeof comments>
		>();
	});

	it("innerJoin(comments) leaves the left-joined set at never", () => {
		const joined = select(posts).innerJoin(
			comments,
			eq(posts.id, comments.postId),
		);
		expectTypeOf(joined).toEqualTypeOf<SelectJoinable<typeof posts, never>>();
	});
});
