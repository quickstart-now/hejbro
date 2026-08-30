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
import type { ContextProvider } from "../../src/db/context";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";
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

const listPublished = defineFunction(
	app,
	"list_published",
	{ returns: posts },
	(ctx) => {
		ctx.return(select(posts));
	},
);

const appSchema = { posts, readerGrant, listPublished };

const makeHandle = (driver: Driver, context: ContextProvider) =>
	db(appSchema, driver, { context });

type ProviderHandle = ReturnType<typeof makeHandle>;

describe("db() context provider -- 1.1 the option and its fail-closed floor", () => {
	it("a handle built without a provider issues no context statements", async () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle.execute(select(posts));

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});

	it("a resolver yielding nothing fails closed before any statement is sent", async () => {
		const { driver } = recordingTransactionalDriver();
		// simulates a caller who bypasses ContextProvider's non-nullable return
		// type (plain JS, an `any`) -- the type forbids this at compile time,
		// so the runtime guard is this test's whole subject.
		const emptyProvider = (async () => undefined) as unknown as ContextProvider;
		const handle = db(appSchema, driver, { context: emptyProvider });

		try {
			await handle.execute(select(posts));
			expect.unreachable("execute should have thrown");
		} catch (error) {
			expect(error).toHaveProperty("code", "context-provider-empty");
			expect((error as Error).message).toMatch(/Next:/);
		}

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("construction never rejects an undeclared resolver role -- there is no fallback field to check yet", () => {
		// (B) has no fallback field (owner decision, final) -- the resolved
		// role is only known once the resolver actually runs, so `db()`
		// itself never throws for the provider option alone; 1.2 below
		// covers the execution-time rejection of the same role.
		const { driver } = recordingTransactionalDriver();
		expect(() =>
			db(appSchema, driver, {
				context: () => ({ role: roleName("totally-undeclared-role") }),
			}),
		).not.toThrow();
	});
});

describe("db() context provider -- 1.2 the resolution primitive", () => {
	it("applies the resolved role and settings before the statement, in one transaction", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver, {
			context: () => ({
				role: roleName("grant_reader"),
				settings: { "app.claim": "value" },
			}),
		});

		await handle.execute(select(posts));

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]).toHaveLength(3); // role, setting, statement
		expect(sentPerTransaction[0]?.[0]?.sql).toBe(
			'set local role "grant_reader"',
		);
		expect(sentPerTransaction[0]?.[1]?.sql).toBe(
			"select set_config($1, $2, true)",
		);
		expect(sentPerTransaction[0]?.[2]?.sql).toContain("posts");
	});

	it("registering a provider leaves the statement's own sql and params byte-identical -- only the wrapping around it differs", async () => {
		// a real bound parameter (not an empty-params statement), so
		// "unchanged" is a meaningful claim about both fields, not a
		// vacuous pass on an always-empty params array.
		const statement = select(posts).where(eq(posts.status, "published"));

		const unprovided = recordingTransactionalDriver();
		await db(appSchema, unprovided.driver).execute(statement);

		const provided = recordingTransactionalDriver();
		await db(appSchema, provided.driver, {
			context: () => ({ role: roleName("grant_reader") }),
		}).execute(statement);

		// role only, no settings -- role statement then the statement itself.
		expect(provided.sentPerTransaction[0]).toHaveLength(2);
		expect(provided.sentPerTransaction[0]?.[1]).toEqual(
			unprovided.topLevelSent[0],
		);
	});

	it("an undeclared resolved role opens no transaction at all -- measured as driver.transaction's own call count, never by searching for begin text (recording-driver.ts records no begin/commit text at all)", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver, {
			context: () => ({ role: roleName("totally-undeclared-role") }),
		});

		await expect(handle.execute(select(posts))).rejects.toMatchObject({
			code: "undeclared-role",
		});

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(sentPerTransaction).toHaveLength(0);
	});
});

describe("db() context provider -- 1.3 surface coverage (eight execution entry points, measured not assumed)", () => {
	const draftRow = {
		id: "22222222-2222-2222-2222-222222222222",
		status: "draft",
	};

	const surfaces: ReadonlyArray<{
		readonly name: string;
		readonly run: (handle: ProviderHandle) => PromiseLike<unknown>;
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
		{ name: "execute", run: (handle) => handle.execute(select(posts)) },
		{
			name: "transaction",
			run: (handle) =>
				handle.transaction(async (tx) => tx.execute(select(posts))),
		},
		// fn.ts's own path (confirmed while doing this task, per tasks.md
		// 1.3): `createFnApi`'s `run` parameter fully abstracts over
		// "direct to driver" vs "context-scoped" the same way chain.ts's
		// `run` does (fn.ts:373-386), so wiring the same `providerChainRun`
		// primitive into both `createChainApi` and `createFnApi` (db.ts)
		// covers this surface with no fn.ts-specific code at all.
		{ name: "fn", run: (handle) => handle.fn.listPublished({}) },
	];

	it.each(surfaces)(
		"$name runs under the resolved context",
		async ({ run }) => {
			const { driver, sentPerTransaction } = recordingTransactionalDriver();
			const handle = makeHandle(driver, () => ({
				role: roleName("grant_reader"),
			}));

			await run(handle);

			expect(driver.transaction).toHaveBeenCalledTimes(1);
			expect(sentPerTransaction[0]?.[0]?.sql).toBe(
				'set local role "grant_reader"',
			);
		},
	);
});

describe("db() context provider -- 1.4 cadence: once per execution, never cached", () => {
	it("two executions call the resolver twice", async () => {
		const { driver } = recordingTransactionalDriver();
		const resolver = vi.fn(() => ({ role: roleName("grant_reader") }));
		const handle = makeHandle(driver, resolver);

		await handle.execute(select(posts));
		await handle.execute(select(posts));

		expect(resolver).toHaveBeenCalledTimes(2);
		expect(driver.transaction).toHaveBeenCalledTimes(2);
	});

	it("one transaction calls the resolver once, not once per statement inside it", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const resolver = vi.fn(() => ({ role: roleName("grant_reader") }));
		const handle = makeHandle(driver, resolver);

		await handle.transaction(async (tx) => {
			await tx.execute(select(posts));
			await tx.execute(select(posts));
		});

		expect(resolver).toHaveBeenCalledTimes(1);
		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction[0]).toHaveLength(3); // role + 2 statements
	});
});

describe("db() context provider -- 1.2 nested-transaction guard is not silently dropped", () => {
	it("a provider handle rejects a nested db.transaction the same way an unprovided one does", async () => {
		const { driver } = recordingTransactionalDriver();
		const handle = makeHandle(driver, () => ({
			role: roleName("grant_reader"),
		}));

		await expect(
			handle.transaction(async () => {
				// reaching back to the outer handle's own `transaction` member
				// from inside its already-open callback -- query-execution's
				// nested-transaction requirement names "the db handle", which a
				// registered provider does not change; reentry here would open
				// a second connection out of the pool exactly like the
				// unprovided path, so the same guard must fire.
				await handle.transaction(async () => {});
			}),
		).rejects.toMatchObject({ code: "nested-transaction-unsupported" });
	});
});

describe("db() context provider -- 1.5 precedence and the error path", () => {
	it("an explicit as() runs under exactly the context named at the call site, and never calls the resolver", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		// the resolver names a DIFFERENT role than the explicit call below --
		// a positive assertion on the role actually sent, not only "the
		// resolver wasn't called": a mutant that drops the explicit context
		// and runs the statement unscoped (never opening a transaction at
		// all) would still leave the resolver uncalled, so that negative
		// check alone cannot tell a fail-open apart from the correct
		// behavior (reviewer finding, 706/706 green under that mutant).
		const resolver = vi.fn(() => ({ role: roleName("grant_reader") }));
		const handle = makeHandle(driver, resolver);

		await handle.as({ role: roleName("policy_reader") }).execute(select(posts));

		expect(resolver).not.toHaveBeenCalled();
		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction[0]?.[0]?.sql).toBe(
			'set local role "policy_reader"',
		);
	});

	it("a throwing resolver opens no transaction, and its exact error propagates unchanged", async () => {
		const { driver } = recordingTransactionalDriver();
		const thrown = new Error("identity lookup failed");
		const handle = makeHandle(driver, () => {
			throw thrown;
		});

		await expect(handle.execute(select(posts))).rejects.toBe(thrown);

		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("db() context provider -- 1.6 capability ordering", () => {
	it("a missing capability fails before the resolver is called", async () => {
		const { driver } = recordingTransactionalDriver({
			interactiveTransactions: false,
		});
		const resolver = vi.fn(() => ({ role: roleName("grant_reader") }));
		const handle = makeHandle(driver, resolver);

		await expect(handle.execute(select(posts))).rejects.toThrow(
			/interactive-transactions/,
		);

		expect(resolver).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("db() context provider -- non-execution members stay uncontexted", () => {
	it("a provider handle's own driver member stays uncontexted", async () => {
		// `handle.driver` is not an execution surface (the survey's own
		// eight-surface count never included it) -- the schema assertion
		// takes exactly this path to read the catalog, and it must keep
		// doing so uncontexted: a resolved application role would make
		// catalog reads report divergence that reflects the role's own
		// visibility rather than the schema (rls-execution-context delta).
		const { driver, sentPerTransaction, topLevelSent } =
			recordingTransactionalDriver();
		const resolver = vi.fn(() => ({ role: roleName("grant_reader") }));
		const handle = makeHandle(driver, resolver);

		await handle.driver.execute({ sql: "select 1", params: [], kind: "sql" });

		expect(resolver).not.toHaveBeenCalled();
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(sentPerTransaction).toHaveLength(0);
		expect(topLevelSent).toHaveLength(1);
	});
});
