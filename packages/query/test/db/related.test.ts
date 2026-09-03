import {
	eq,
	jsonArrayFrom,
	jsonObjectFrom,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");
const users = table(app, "users", {
	id: uuid().primaryKey(),
	name: text().notNull(),
});
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	title: text().notNull(),
	authorId: uuid()
		.notNull()
		.references(() => users.id),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid()
		.notNull()
		.references(() => posts.id),
	body: text().notNull(),
});

describe("related() chain method (add-relational-reads task 3.3)", () => {
	it("compiles to exactly the explicit jsonArrayFrom/jsonObjectFrom formulation", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);

		const sugared = handle
			.select(posts)
			.related({ comments: true, author: true })
			.compile();

		const explicit = compile(
			select(
				{
					id: posts.id,
					title: posts.title,
					authorId: posts.authorId,
					comments: jsonArrayFrom(
						select(comments).where(eq(comments.postId, posts.id)),
					),
					author: jsonObjectFrom(
						select(users).where(eq(users.id, posts.authorId)),
					),
				},
				posts,
			),
		);
		expect(sugared.sql).toBe(explicit.sql);
		expect(sugared.params).toEqual(explicit.params);
	});

	it("keeps the chain: where/limit after related() still compile through core", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);
		const compiled = handle
			.select(posts)
			.related({ comments: true })
			.where(eq(posts.title, "hello"))
			.limit(3)
			.compile();
		expect(compiled.sql).toContain('where "app"."posts"."title" = $1');
		expect(compiled.sql).toContain("limit 3");
	});

	it("types the merged row and rejects an unknown key", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);
		const chain = handle.select(posts).related({ comments: true });
		type Row = Awaited<typeof chain>[number];
		expectTypeOf<Row["title"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly postId: string;
				readonly body: string;
			}>
		>();

		// The misspelled key is rejected on BOTH axes: the directive pins the
		// type-level rejection, and the runtime guard (the structural
		// false-positive backstop) throws unknown-relation eagerly.
		const misspell = () =>
			// @ts-expect-error a misspelled relation key is rejected at the type level
			handle.select(posts).related({ commets: true });
		expect(misspell).toThrowError();
		try {
			misspell();
			expect.unreachable("misspell() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("unknown-relation");
		}
	});
});

describe("related() under an rls context (task 3.5)", () => {
	it("a scoped related read compiles to exactly one statement", async () => {
		const { driver, topLevelSent, sentPerTransaction } =
			recordingTransactionalDriver({ rows: [] });
		const handle = db({ app, users, posts, comments }, driver, {
			roles: [roleName("viewer")],
		});
		await handle
			.as({ role: roleName("viewer") })
			.select(posts)
			.related({ comments: true });

		// one wrapping transaction; inside it: SET LOCAL ROLE + the single
		// related statement -- never a second data statement (no client-side
		// stitching, D102).
		expect(topLevelSent.length).toBe(0);
		const dataStatements = sentPerTransaction
			.flat()
			.filter((statement) => statement.sql.startsWith("select "))
			.filter((statement) => !statement.sql.includes("set_config"));
		expect(dataStatements).toHaveLength(1);
		expect(dataStatements[0]?.sql).toContain("json_agg");
	});
});

describe("collision and mixed-unknown rejection (g3 review F2/F3)", () => {
	const clashApp = schema("clash");
	const users2 = table(clashApp, "users2", { id: uuid().primaryKey() });
	const posts2 = table(clashApp, "posts2", {
		id: uuid().primaryKey(),
		author: text().notNull(),
		authorId: uuid()
			.notNull()
			.references(() => users2.id),
	});

	it("a mixed spec with an unknown key fails to type-check", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ app, users, posts, comments }, driver);
		const mixed = () =>
			handle
				.select(posts)
				// @ts-expect-error bogus is not a derivable relation, even mixed with a valid key
				.related({ comments: true, bogus: true });
		expect(mixed).toThrowError();
	});

	it("a colliding key is rejected on both axes -- never a silently dropped parent column", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db({ clashApp, users2, posts2 }, driver);
		const collide = () =>
			handle
				.select(posts2)
				// @ts-expect-error "author" collides with posts2's own column
				.related({ author: true });
		expect(collide).toThrowError();
		try {
			collide();
			expect.unreachable("collide() should have thrown");
		} catch (error) {
			expect((error as { code: string }).code).toBe("ambiguous-relation");
		}
	});
});

describe("related() inside transactions (g3 review F5)", () => {
	it("both directions type and compile inside db.transaction", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const handle = db({ app, users, posts, comments }, driver);
		await handle.transaction(async (tx) => {
			const forward = tx.select(posts).related({ author: true }).compile();
			const reverse = tx.select(posts).related({ comments: true }).compile();
			expect(forward.sql).toContain("row_to_json");
			expect(reverse.sql).toContain("json_agg");
		});
	});
});
