import { schema, select, table, uuid } from "@hejbro/core";
import type { Driver, DriverSession } from "@hejbro/query";
import { db } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { asAnon, asUser } from "../src/context";
import { supabaseDriver } from "../src/driver";

const app = schema("app");
const posts = table(app, "posts", { id: uuid().primaryKey() });
const appSchema = { posts };

/** Mirrors `driver.test.ts`'s own local copy (same package, same reasoning: no shared test-only fixture crosses `@hejbro/query`'s package boundary) -- models one BEGIN/COMMIT per `driver.transaction()` call and records every statement sent on that connection, in order. */
const recordingTransactionalDriver = (): {
	readonly driver: Driver;
	readonly sentPerTransaction: Array<
		Array<{ sql: string; params: ReadonlyArray<unknown> }>
	>;
} => {
	const sentPerTransaction: Array<
		Array<{ sql: string; params: ReadonlyArray<unknown> }>
	> = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": true, "session-state": true },
		execute: async () => [],
		transaction: async (callback) => {
			const sent: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
			sentPerTransaction.push(sent);
			const session: DriverSession = {
				execute: async (compiled) => {
					sent.push({ sql: compiled.sql, params: compiled.params });
					return [];
				},
			};
			return callback(session);
		},
		setupSession: async () => {},
	};
	return { driver, sentPerTransaction };
};

describe("db() context provider + Supabase context builders (add-context-provider, task 2.1)", () => {
	it("a Supabase provider applies authenticated and anonymous contexts with no preset-side mechanism", async () => {
		// the "provider" registered below is nothing but the existing
		// asUser/asAnon builders (task 6's own context.ts, unchanged) --
		// this task's whole point is that the preset needed no new
		// mechanism, only its existing context values passed through the
		// query layer's generic `context` option.
		const authed = recordingTransactionalDriver();
		const authedHandle = db(appSchema, supabaseDriver(authed.driver), {
			context: () => asUser({ sub: "user-1" }),
		});

		await authedHandle.execute(select(posts));

		expect(authed.sentPerTransaction[0]?.[0]).toEqual({
			sql: 'set local role "authenticated"',
			params: [],
		});
		expect(authed.sentPerTransaction[0]?.[1]).toEqual({
			sql: "select set_config($1, $2, true)",
			params: ["request.jwt.claims", '{"sub":"user-1","role":"authenticated"}'],
		});
		expect(authed.sentPerTransaction[0]?.[2]?.sql).toContain("posts");

		const anon = recordingTransactionalDriver();
		const anonHandle = db(appSchema, supabaseDriver(anon.driver), {
			context: () => asAnon(),
		});

		await anonHandle.execute(select(posts));

		expect(anon.sentPerTransaction[0]?.[0]).toEqual({
			sql: 'set local role "anon"',
			params: [],
		});
		expect(anon.sentPerTransaction[0]?.[1]).toEqual({
			sql: "select set_config($1, $2, true)",
			params: ["request.jwt.claims", '{"role":"anon"}'],
		});
		expect(anon.sentPerTransaction[0]?.[2]?.sql).toContain("posts");
	});
});
