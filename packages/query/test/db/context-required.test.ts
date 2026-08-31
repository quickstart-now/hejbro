import {
	defineFunction,
	eq,
	grant,
	rls,
	roleName,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/db";
import type { Db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

const app = schema("app");

const posts = table(
	app,
	"posts",
	{
		id: uuid().primaryKey(),
		status: text().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			read: rls
				.policy("posts_read_published")
				.for("select")
				.to("policy_reader")
				.using(eq(t.status, "published")),
		}),
	}),
);

const readerGrant = grant(app).usage.to("grant_reader");

const helloWorld = defineFunction(
	app,
	"hello_world",
	{ returns: posts },
	(ctx) => {
		ctx.return(select(posts));
	},
);

const appSchema = { posts, readerGrant, helloWorld };

describe("uncontexted execute is refused on a context-mandatory driver (task 3.1, #556)", () => {
	it("fails with context-required, and nothing reaches the driver", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "context-required",
		});

		expect(driver.execute).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("every thenable chain member is refused alike (task 3.2, #556)", () => {
	const draftRow = {
		id: "22222222-2222-2222-2222-222222222222",
		status: "draft",
	};

	const surfaces: ReadonlyArray<{
		readonly name: string;
		readonly run: (handle: Db) => PromiseLike<unknown>;
	}> = [
		{ name: "select", run: (handle) => handle.select(posts) },
		{ name: "insert", run: (handle) => handle.insert(posts).values(draftRow) },
		{
			name: "update",
			run: (handle) => handle.update(posts).set({ status: "archived" }),
		},
		{ name: "deleteFrom", run: (handle) => handle.deleteFrom(posts) },
		{
			name: "with",
			run: (handle) =>
				handle.with((w) => {
					const ranked = w.as("ranked", select(posts));
					return select({ id: ranked.id }, ranked);
				}),
		},
	];

	it.each(surfaces)("$name is refused", async ({ run }) => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await expect(run(handle)).rejects.toMatchObject({
			code: "context-required",
		});

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});
});

describe("every declared-function call is refused alike (task 3.3, #556)", () => {
	it("db.fn.* is refused, and nothing reaches the driver", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await expect(handle.fn.helloWorld({})).rejects.toMatchObject({
			code: "context-required",
		});

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});
});

describe("the transaction API is refused alike (task 3.4, #556)", () => {
	it("db.transaction is refused, and no transaction opens", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await expect(
			handle.transaction(async (tx) => {
				await tx.execute(select(posts));
			}),
		).rejects.toMatchObject({ code: "context-required" });

		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("non-execution members are unaffected (task 3.5, #556 -- reverse evidence the chokepoint isn't too wide)", () => {
	it("handle.driver still reaches the database uncontexted -- the schema-assertion path", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await handle.driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(driver.execute).toHaveBeenCalledTimes(1);
	});
});

describe("a context satisfies the requirement (task 3.6, #556)", () => {
	it("an explicit db.as(context) proceeds", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			contextRequired: true,
		});
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("grant_reader") }).execute(select(posts));

		expect(sentPerTransaction).toHaveLength(1);
	});

	it("a provider handle on the same driver proceeds", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			contextRequired: true,
		});
		const handle = db(appSchema, driver, {
			context: () => ({ role: roleName("grant_reader") }),
		});

		await handle.execute(select(posts));

		expect(sentPerTransaction).toHaveLength(1);
	});
});

describe("a driver without the declaration is unchanged (task 3.7, #556 -- second regression axis alongside group 4's pins)", () => {
	it("uncontexted execution on an ordinary driver sends no context statement and opens no transaction", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle.execute(select(posts));

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(topLevelSent).toHaveLength(1);
	});
});
