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
import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "../../src/compile/compile";
import type { Db } from "../../src/db/db";
import { db } from "../../src/db/db";
import type { Driver, DriverSession } from "../../src/driver/contract";
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

describe("a context whose rendering produces nothing is refused (task 1.1, #590)", () => {
	it("refuses a mandatory context whose contributed rendering produces no statement", async () => {
		const { driver } = recordingTransactionalDriver({
			contextRequired: true,
			renderContext: () => [],
		});
		const handle = db(appSchema, driver);

		await expect(
			handle.as({ role: roleName("grant_reader") }).execute(select(posts)),
		).rejects.toMatchObject({ code: "context-rendering-empty" });
	});

	it("sends no caller statement and leaves the opened transaction carrying none", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			contextRequired: true,
			renderContext: () => [],
		});
		const handle = db(appSchema, driver);

		await expect(
			handle.as({ role: roleName("grant_reader") }).execute(select(posts)),
		).rejects.toMatchObject({ code: "context-rendering-empty" });

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction[0]).toEqual([]);
	});

	it("refuses an entirely empty context on a role-less, context-mandatory driver", async () => {
		const { driver } = recordingTransactionalDriver({
			contextRequired: true,
			roleLessPlatform: true,
		});
		const handle = db(appSchema, driver);

		await expect(handle.as({}).execute(select(posts))).rejects.toMatchObject({
			code: "context-rendering-empty",
		});
	});

	it("leaves a non-declaring driver's empty-rendering execution alone", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			roleLessPlatform: true,
		});
		const handle = db(appSchema, driver);

		await handle.as({}).execute(select(posts));

		expect(sentPerTransaction[0]).toHaveLength(1);
	});

	it("accepts a single unreadable statement — the layer counts, it does not read", async () => {
		let sessionCalls = 0;
		const poison = new Proxy(
			{},
			{
				get(): never {
					throw new Error(
						"the statement was read, not merely counted -- the layer must forward it opaquely",
					);
				},
			},
		) as unknown as CompileResult;
		const driver: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) => {
				const session: DriverSession = {
					execute: vi.fn(async () => {
						sessionCalls += 1;
						return [];
					}),
				};
				return callback(session);
			}),
			setupSession: vi.fn(async () => {}),
			contextRequired: true,
			renderContext: () => [poison],
		};
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("grant_reader") }).execute(select(posts));

		expect(sessionCalls).toBe(2); // the poisoned statement, then the caller's own
	});
});

describe("a refusal names the surface the caller invoked (task 1.7, #590)", () => {
	it("names the surface the caller invoked on each refusal", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "context-required",
			operation: "db.execute",
		});
		await expect(handle.select(posts)).rejects.toMatchObject({
			code: "context-required",
			operation: "db.select",
		});
		await expect(handle.fn.helloWorld({})).rejects.toMatchObject({
			code: "context-required",
			operation: "db.fn",
		});
		await expect(
			handle.transaction(async (tx) => {
				await tx.execute(select(posts));
			}),
		).rejects.toMatchObject({
			code: "context-required",
			operation: "transaction",
		});
	});
});

describe("a refusal names the surface on an empty rendering too (task 1.9, #590)", () => {
	it("names the surface on an empty-rendering refusal, scoped and provider alike", async () => {
		const { driver } = recordingTransactionalDriver({
			contextRequired: true,
			renderContext: () => [],
		});

		const scopedHandle = db(appSchema, driver);
		await expect(
			scopedHandle
				.as({ role: roleName("grant_reader") })
				.execute(select(posts)),
		).rejects.toMatchObject({
			code: "context-rendering-empty",
			operation: "db.execute",
		});
		await expect(
			scopedHandle.as({ role: roleName("grant_reader") }).select(posts),
		).rejects.toMatchObject({
			code: "context-rendering-empty",
			operation: "db.select",
		});

		const providerHandle = db(appSchema, driver, {
			context: () => ({ role: roleName("grant_reader") }),
		});
		await expect(providerHandle.execute(select(posts))).rejects.toMatchObject({
			code: "context-rendering-empty",
			operation: "db.execute",
		});
	});
});

describe("a refusal names the surface the caller invoked (task 1.5, #590)", () => {
	it("names each chain member separately", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const handle = db(appSchema, driver);

		const selectError = await Promise.resolve(handle.select(posts)).then(
			() => undefined,
			(error: unknown) => error,
		);
		const insertError = await Promise.resolve(
			handle.insert(posts).values({
				id: "22222222-2222-2222-2222-222222222222",
				status: "draft",
			}),
		).then(
			() => undefined,
			(error: unknown) => error,
		);

		expect(selectError).toMatchObject({
			code: "context-required",
			operation: "db.select",
		});
		expect(insertError).toMatchObject({
			code: "context-required",
			operation: "db.insert",
		});
	});
});
