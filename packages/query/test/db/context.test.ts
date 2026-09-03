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
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DbContext } from "../../src/db/context";
import { defaultContextRendering } from "../../src/db/context";
import { db } from "../../src/db/db";
import type {
	ContextRendering,
	Driver,
	DriverSession,
} from "../../src/driver/contract";
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

describe("defaultContextRendering (task 2.1, #555 -- extracted from applyContext, byte-identical to today's sequence)", () => {
	it("returns the role statement, then one set_config per setting, in declaration order", () => {
		const statements = defaultContextRendering({
			role: roleName("grant_reader"),
			settings: { "app.claim1": "v1", "app.claim2": "v2" },
		});

		expect(statements).toEqual([
			{ sql: 'set local role "grant_reader"', params: [], kind: "sql" },
			{
				sql: "select set_config($1, $2, true)",
				params: ["app.claim1", "v1"],
				kind: "sql",
			},
			{
				sql: "select set_config($1, $2, true)",
				params: ["app.claim2", "v2"],
				kind: "sql",
			},
		]);
	});

	it("returns just the role statement when there are no settings", () => {
		expect(defaultContextRendering({ role: roleName("grant_reader") })).toEqual(
			[{ sql: 'set local role "grant_reader"', params: [], kind: "sql" }],
		);
	});
});

describe("a contributing driver's own rendering replaces the default (task 2.2, #555)", () => {
	it("sends the driver's own rendering's statements first, in its order, and no default statement is sent at all", async () => {
		const customRendering: ContextRendering = () => [
			{ sql: "custom pin one", params: [], kind: "sql" },
			{ sql: "custom pin two", params: [], kind: "sql" },
		];
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			renderContext: customRendering,
		});
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("grant_reader") }).execute(select(posts));

		const sqlSent = sentPerTransaction[0]?.map((sent) => sent.sql);
		expect(sqlSent?.[0]).toBe("custom pin one");
		expect(sqlSent?.[1]).toBe("custom pin two");
		expect(sqlSent?.[2]).toContain("posts");
		// no default statement anywhere -- the driver's own rendering fully
		// replaces the default, never runs alongside it.
		expect(sqlSent).not.toContain('set local role "grant_reader"');
	});
});

describe("the rendering is a pure value, not an effect (task 2.3, #555)", () => {
	it("is called with only the context -- no session in scope -- and the statements it returns are exactly what the query layer sends, never something the rendering sent itself", async () => {
		const calls: Array<unknown> = [];
		const rendering: ContextRendering = (context) => {
			calls.push(context);
			return [{ sql: "custom pin", params: [], kind: "sql" }];
		};
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			renderContext: rendering,
		});
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("grant_reader") }).execute(select(posts));

		expect(calls).toEqual([{ role: roleName("grant_reader") }]);
		expect(sentPerTransaction[0]?.[0]).toEqual({
			sql: "custom pin",
			params: [],
		});
	});
});

describe("a role-less context (task 2.4, #555)", () => {
	it("fails before any I/O on an ordinary driver -- no transaction opens", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		try {
			handle.as({});
			expect.unreachable("db.as should have thrown for a role-less context");
		} catch (error) {
			expect(error).toHaveProperty("code", "context-role-missing");
		}

		expect(driver.transaction).not.toHaveBeenCalled();
	});

	it("proceeds on a role-less driver, and no role statement is emitted", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			roleLessPlatform: true,
		});
		const handle = db(appSchema, driver);

		await handle.as({}).execute(select(posts));

		const sqlSent = sentPerTransaction[0]?.map((sent) => sent.sql) ?? [];
		expect(sqlSent.some((sql) => sql.includes("set local role"))).toBe(false);
	});
});

describe("a named role stays validated even on a role-less driver (task 2.5, #555)", () => {
	it("an undeclared role is refused on a role-less driver too -- the declaration grants no exemption from the whitelist", () => {
		const { driver } = recordingTransactionalDriver({ roleLessPlatform: true });
		const handle = db(appSchema, driver);

		try {
			handle.as({ role: roleName("totally-undeclared-role") });
			expect.unreachable("db.as should have thrown");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
		}

		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("contributed statements are sent one at a time, in the rendering's own order (task 2.6, #555 -- order mutant, not a value mutant)", () => {
	it("each statement is only sent after the previous one resolves -- a Promise.all-style send would let a faster later statement finish first and record out of order", async () => {
		const order: Array<unknown> = [];
		const driver: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) => {
				const session: DriverSession = {
					execute: vi.fn(async (compiled) => {
						// the first setting resolves slower than the second -- a
						// sequential (awaited) send preserves order regardless of
						// each call's own delay; a concurrent send would let the
						// second (faster) resolve, and be recorded, first.
						const delays: Readonly<Record<string, number>> = {
							"app.claim1": 20,
						};
						const delay = delays[String(compiled.params[0])] ?? 0;
						await new Promise((resolve) => setTimeout(resolve, delay));
						order.push(compiled.params[0] ?? compiled.sql);
						return [];
					}),
				};
				return callback(session);
			}),
			setupSession: vi.fn(async () => {}),
		};
		const handle = db(appSchema, driver);

		await handle
			.as({
				role: roleName("grant_reader"),
				settings: { "app.claim1": "v1", "app.claim2": "v2" },
			})
			.execute(select(posts));

		expect(order[0]).toBe('set local role "grant_reader"');
		expect(order[1]).toBe("app.claim1");
		expect(order[2]).toBe("app.claim2");
	});
});

describe("the capability gate does not move for a contributing driver (task 2.7, #555)", () => {
	it("a driver that contributes a rendering but declares interactive-transactions false is still refused with missing-capability, and the rendering is never invoked", async () => {
		const renderCalls: Array<unknown> = [];
		const rendering: ContextRendering = (context) => {
			renderCalls.push(context);
			return [];
		};
		const { driver } = recordingTransactionalDriver({
			interactiveTransactions: false,
			renderContext: rendering,
		});
		const handle = db(appSchema, driver);

		await expect(
			handle.as({ role: roleName("grant_reader") }).execute(select(posts)),
		).rejects.toThrow(/interactive-transactions/);

		expect(renderCalls).toHaveLength(0);
		expect(driver.transaction).not.toHaveBeenCalled();
	});
});

describe("DbContext and the rendering's context type are the same type (task 2.10, #554/#555 -- the type merge)", () => {
	it("the rendering's parameter type, extracted with infer, is DbContext -- never a whole-object compare", () => {
		type RenderingParam<T> = T extends (context: infer C) => unknown
			? C
			: never;
		expectTypeOf<RenderingParam<ContextRendering>>().toEqualTypeOf<DbContext>();
	});

	it("the temporary ContextValue alias from #554/task 1.1 is gone -- exactly one context type name survives the merge", () => {
		// @ts-expect-error ContextValue was removed by task 2.10's merge -- DbContext (re-exported from db/context) is the package's only context type now.
		const _neverImported: import("../../src/driver/contract").ContextValue =
			undefined as never;
		void _neverImported;
	});

	it("a DbContext value is assignable straight to a driver's renderContext, with no cast", () => {
		const context: DbContext = { role: roleName("grant_reader") };
		const driver: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: async () => [],
			transaction: async (callback) => callback({ execute: async () => [] }),
			setupSession: async () => {},
			renderContext: (renderedContext) => {
				expectTypeOf(renderedContext).toEqualTypeOf<DbContext>();
				return [];
			},
		};
		driver.renderContext?.(context);
	});
});

describe("db.as(context) -- UX scenario (2): an existing declared role (grant) works with no db() options set", () => {
	it("applies SET LOCAL ROLE for a grant-declared role and runs the statement in the same transaction", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("grant_reader") }).execute(select(posts));

		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]?.[0]?.sql).toBe(
			'set local role "grant_reader"',
		);
		expect(sentPerTransaction[0]?.[1]?.sql).toContain("posts");
	});
});

describe("db.as(context) -- UX scenario (2b): an existing declared role (RLS policy) also works", () => {
	it("applies SET LOCAL ROLE for a policy-declared role", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("policy_reader") }).execute(select(posts));

		expect(sentPerTransaction[0]?.[0]?.sql).toBe(
			'set local role "policy_reader"',
		);
	});
});

describe("db.as(context) -- UX scenario (1): a driver/preset-contributed role works on a minimal schema with no grant/policy for it", () => {
	it("fails without the driver contributing the role (the trap this exists to prevent)", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		try {
			handle.as({ role: roleName("service_role") });
			expect.unreachable("db.as should have thrown");
		} catch (error) {
			// asserting the code (not just a thrown message) rules out this
			// rejection coming from a different path that happens to throw a
			// similarly-worded error (e.g. quoteIdentifier's own
			// invalid-identifier) -- the 7th-pattern check (batch C).
			expect(error).toHaveProperty("code", "undeclared-role");
		}
	});

	it("succeeds once the driver contributes the role, even with no matching grant/policy", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			contributedRoles: ["service_role"],
		});
		const handle = db(appSchema, driver);

		await handle.as({ role: roleName("service_role") }).execute(select(posts));

		expect(sentPerTransaction[0]?.[0]?.sql).toBe(
			'set local role "service_role"',
		);
	});
});

describe("db.as(context) -- UX scenario (3): the roles option's Role value works", () => {
	it("succeeds for a role only present via db()'s roles option", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver, {
			roles: [roleName("app_admin")],
		});

		await handle.as({ role: roleName("app_admin") }).execute(select(posts));

		expect(sentPerTransaction[0]?.[0]?.sql).toBe('set local role "app_admin"');
	});
});

describe("db.as(context) -- UX scenario (4): a typo/adversarial role is rejected immediately, fail-closed, no escape hatch", () => {
	it("rejects a role that appears nowhere in any fixture, before any driver call", () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		try {
			handle.as({ role: roleName("totally-made-up-role-xyz") });
			expect.unreachable("db.as should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("code", "undeclared-role");
			expect((error as Error).message).toMatch(/Next:/);
			// the declared roles are listed, so the caller knows what IS valid.
			expect((error as Error).message).toContain("grant_reader");
			expect((error as Error).message).toContain("policy_reader");
		}

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it('"public" is rejected exactly like any other undeclared role -- no special-casing', () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		try {
			handle.as({ role: roleName("public") });
			expect.unreachable("db.as should have thrown for an undeclared role");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
		}
	});
});

describe("db.as(context) -- adversarial identifiers/settings never reach SQL text raw", () => {
	it("a role containing a double quote is rendered through quoteIdentifier's escaping, never as raw text", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const weirdRole = roleName('a"b');
		const handle = db(appSchema, driver, { roles: [weirdRole] });

		await handle.as({ role: weirdRole }).execute(select(posts));

		const roleStatement = sentPerTransaction[0]?.[0]?.sql ?? "";
		expect(roleStatement).toBe('set local role "a""b"');
		// the raw, unescaped form never appears as its own substring.
		expect(roleStatement).not.toContain('a"b"');
		expect(roleStatement.replace('"a""b"', "")).not.toContain('"');
	});

	it("an adversarial setting value only ever reaches the driver as a bound parameter, never inlined into SQL text", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);
		const marker = 'a"; drop table x --\n\0';

		await handle
			.as({
				role: roleName("grant_reader"),
				settings: { "app.claim": marker },
			})
			.execute(select(posts));

		const settingStatement = sentPerTransaction[0]?.[1];
		expect(settingStatement?.sql).toBe("select set_config($1, $2, true)");
		expect(settingStatement?.sql).not.toContain(marker);
		expect(settingStatement?.params).toEqual(["app.claim", marker]);
	});
});

describe("db.as(context) -- everything runs inside the one wrapping transaction", () => {
	it("role, settings, and the actual statement are all on the same connection (one driver.transaction() call)", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle
			.as({
				role: roleName("grant_reader"),
				settings: { "app.claim": "value" },
			})
			.execute(select(posts));

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction).toHaveLength(1);
		expect(sentPerTransaction[0]).toHaveLength(3); // role, setting, statement
	});

	it("db.as(ctx).transaction(cb) is not a nested transaction -- one begin, context applied once, every tx.execute() call shares it", async () => {
		const { driver, sentPerTransaction } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		await handle
			.as({ role: roleName("grant_reader") })
			.transaction(async (tx) => {
				await tx.execute(select(posts));
				await tx.execute(select(posts));
			});

		expect(driver.transaction).toHaveBeenCalledTimes(1);
		expect(sentPerTransaction[0]).toHaveLength(3); // role + 2 statements
	});
});

describe("db.as(context) -- the original, unscoped handle is never mutated", () => {
	it("executing through the original db handle after calling db.as() sends no role/setting statements at all", async () => {
		const { driver } = recordingTransactionalDriver();
		const handle = db(appSchema, driver);

		// build (but don't have to use) a scoped handle first.
		handle.as({ role: roleName("grant_reader") });
		await handle.execute(select(posts));

		// the unscoped path never opens a transaction at all.
		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).toHaveBeenCalledTimes(1);
	});
});

describe("db.as(context) -- a failing set_config stops the chain (fail-stop, not fail-continue)", () => {
	it("a second set_config failure prevents the actual statement from ever being sent, and the call rejects", async () => {
		const sent: Array<{ sql: string }> = [];
		let callIndex = 0;
		const driver: Driver = {
			capabilities: { "interactive-transactions": true, "session-state": true },
			execute: vi.fn(async () => []),
			transaction: vi.fn(async (callback) => {
				const session: DriverSession = {
					execute: vi.fn(async (compiled) => {
						callIndex += 1;
						// call 1 = role, call 2 = first setting, call 3 = second
						// setting -- fail exactly there, before the real statement
						// (what would be call 4) ever gets a turn.
						if (callIndex === 3) {
							throw new Error("simulated set_config failure");
						}
						sent.push({ sql: compiled.sql });
						return [];
					}),
				};
				return callback(session);
			}),
			setupSession: vi.fn(async () => {}),
		};
		const handle = db(appSchema, driver);

		await expect(
			handle
				.as({
					role: roleName("grant_reader"),
					settings: { "app.claim1": "v1", "app.claim2": "v2" },
				})
				.execute(select(posts)),
		).rejects.toThrow();

		// role + first setting were sent; the second setting's attempt threw
		// (never recorded); the actual statement never got a turn at all --
		// a fail-continue chain would have let it run anyway (3 entries, the
		// failed setting skipped) or even sent all 4 (retried past it).
		expect(sent).toHaveLength(2);
	});
});

describe("db.as(context) -- the empty-declared-role-set message (#315 deferred branch)", () => {
	it("an empty declared-role set renders the explicit none-declared message", () => {
		// a schema with no grant, no RLS policy, and db() called with no
		// `roles` option and no driver-contributed roles -- declaredRoles is
		// genuinely empty, exercising declaredRolesList's own `sorted.length
		// === 0` branch directly (every other test in this file has at least
		// one declared role, so that branch was never reached before).
		const bareApp = schema("bare_app");
		const bareTable = table(bareApp, "widgets", {
			id: uuid().primaryKey(),
		});
		const { driver } = recordingTransactionalDriver();
		const handle = db({ bareTable }, driver);

		try {
			handle.as({ role: roleName("anything") });
			expect.unreachable("db.as should have thrown for an undeclared role");
		} catch (error) {
			expect(error).toHaveProperty("code", "undeclared-role");
			expect((error as Error).message).toContain("(none declared)");
		}
	});
});

describe("db.as(context) -- capability check before any send", () => {
	it("fails with driver-missing-capability when the driver doesn't declare interactive-transactions, before any send", async () => {
		const { driver } = recordingTransactionalDriver({
			interactiveTransactions: false,
		});
		const handle = db(appSchema, driver);

		await expect(
			handle.as({ role: roleName("grant_reader") }).execute(select(posts)),
		).rejects.toThrow(/interactive-transactions/);

		expect(driver.transaction).not.toHaveBeenCalled();
		expect(driver.execute).not.toHaveBeenCalled();
	});
});

describe("db.as(context) -- the operation named on a missing-capability refusal (task 1.6, #590)", () => {
	it("names the caller's surface on the scoped path", async () => {
		const { driver } = recordingTransactionalDriver({
			interactiveTransactions: false,
		});
		const handle = db(appSchema, driver);
		const scoped = handle.as({ role: roleName("grant_reader") });

		await expect(scoped.execute(select(posts))).rejects.toMatchObject({
			operation: "db.execute",
		});
		await expect(scoped.select(posts)).rejects.toMatchObject({
			operation: "db.select",
		});
		await expect(scoped.fn.helloWorld({})).rejects.toMatchObject({
			operation: "db.fn",
		});
	});
});
