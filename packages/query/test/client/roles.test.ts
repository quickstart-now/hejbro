import { roleName } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
};

const METADATA: ContractMetadata = {
	source: "git",
	commit: "abc123",
	exportHash: "sha256:x",
	roles: ["authenticated"],
	tables: {
		posts: {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
};

/**
 * The role whitelist reaches the client from the contract's exported
 * list (R2-G6 6.7) — closes the runtime half R2-G5 5.8 deferred here
 * (that group proved only that `contractMetadata.roles` carries what the
 * schema declares; this is the functional accept/reject proof through a
 * real client, now that one exists).
 */
describe("the role whitelist reaches the client from the contract's exported list (R2-G6 6.7)", () => {
	it("accepts a role the contract exports", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ id: "p1" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const scoped = client.as({ role: roleName("authenticated") });
		await expect(scoped.posts.select()).resolves.toEqual([{ id: "p1" }]);
	});

	it("rejects a role the contract does not export", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		expect.assertions(1);
		try {
			client.as({ role: roleName("service_role") });
		} catch (error) {
			expect((error as { readonly code: string }).code).toBe("undeclared-role");
		}
	});

	/**
	 * D106 B2, condition ①'s own third observer: holding the contract
	 * carries the whitelist, but adopts nothing from it on its own.
	 * `contextRequired: true` makes any uncontexted statement fail loudly
	 * (the same mechanism `context-required.test.ts` uses) -- if this
	 * call silently picked a role for the caller, the statement would
	 * carry a context and this driver would accept it; it doesn't, so it
	 * fails the same way an ordinary `db()` handle's own unscoped call
	 * would against this driver.
	 */
	it("no role is active without calling as() -- an unscoped call runs uncontexted", async () => {
		const { driver } = recordingTransactionalDriver({ contextRequired: true });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		await expect(client.posts.select()).rejects.toMatchObject({
			code: "context-required",
		});
	});
});
