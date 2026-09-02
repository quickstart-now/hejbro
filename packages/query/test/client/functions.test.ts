import { roleName } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string; readonly title: string };
			readonly Insert: { readonly id?: string; readonly title: string };
			readonly Update: { readonly id?: string; readonly title?: string };
		};
	};
	readonly Functions: {
		readonly totalPosts: {
			readonly Args: Record<string, never>;
			readonly Returns: bigint;
		};
	};
};

const METADATA: ContractMetadata = {
	commit: "abc123",
	exportHash: "sha256:x",
	roles: [],
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
				title: {
					sqlName: "title",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
	},
	functions: {
		totalPosts: {
			schema: "app",
			name: "total_posts",
			args: [],
			returns: {
				kind: "scalar",
				typeNode: { typeName: "bigint" },
				mode: "bigint",
			},
		},
	},
};

describe("the client's fn (#587/G3)", () => {
	it("calls a vendored function, keyed by its export name", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "42" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const value = await client.fn.totalPosts({});

		expect(value).toBe(42n);
	});

	it("refuses an unknown function by name, naming the contract's own vendored list", async () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);
		const looseFn = client.fn as unknown as Record<
			string,
			(args: unknown) => Promise<unknown>
		>;

		try {
			await looseFn.doesNotExist?.({});
			expect.unreachable("should have refused an unknown function");
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-contract-function");
			expect((error as Error).message).toContain("totalPosts");
			expect((error as Error).message).toContain("Next:");
		}
	});

	it(".as(context).fn calls the same vendored function inside that context's transaction", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "7" }],
			contributedRoles: ["app_reader"],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const value = await client
			.as({ role: roleName("app_reader") })
			.fn.totalPosts({});

		expect(value).toBe(7n);
		expect(driver.transaction).toHaveBeenCalledTimes(1);
	});
});

/**
 * A function's export name can equal a table's own SQL name (two
 * independently-sourced namespaces, forced into one merged record so
 * `db()`'s own classification can wire `fn` without a second renderer,
 * #587/G3) — the collision this design exists to make impossible, not
 * merely unlikely. Both must survive: the table lookup and the function
 * call, and `fn`'s own public key stays the export name regardless of
 * which internal key the collision-avoidance gave the function.
 */
describe("a function export name equal to a table's SQL name (#587/G3)", () => {
	const CollidingMetadata: ContractMetadata = {
		commit: "abc123",
		exportHash: "sha256:x",
		roles: [],
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
		functions: {
			posts: {
				schema: "app",
				name: "count_posts",
				args: [],
				returns: {
					kind: "scalar",
					typeNode: { typeName: "bigint" },
					mode: "bigint",
				},
			},
		},
	};

	type CollidingDatabase = {
		readonly Tables: {
			readonly posts: {
				readonly Row: { readonly id: string };
				readonly Insert: { readonly id?: string };
				readonly Update: { readonly id?: string };
			};
		};
		readonly Functions: {
			readonly posts: {
				readonly Args: Record<string, never>;
				readonly Returns: bigint;
			};
		};
	};

	it("both the table lookup and the function call survive", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "5" }],
		});
		const client = createNameKeyedDb<CollidingDatabase>(
			driver,
			CollidingMetadata,
		);

		expect(client.posts.select).toBeInstanceOf(Function);
		const value = await client.fn.posts({});
		expect(value).toBe(5n);
	});
});

/**
 * The recursion's own observer (#587/G3): a table-returning function's
 * own `findTable` lookup (`db/fn.ts`) searches the merged schema record
 * by VALUE (schema+name identity), not by key -- so a table silently
 * evicted from that record by a colliding function key is genuinely
 * undetectable through a scalar-returning collision (a select/insert/
 * update/delete chain never looks the table up by name at all, and a
 * scalar function's own SQL never references a target table either --
 * both bypass the merged record's own key integrity entirely, which is
 * exactly why the first collision test above, built with a scalar
 * function, came back vacuous against both a no-avoidance and a
 * single-attempt-fallback mutant). A table-returning function makes the
 * eviction observable: `function-target-table-undeclared` fires the
 * moment its own target table's value is missing from the record.
 *
 * Two tables, two functions, so this observes BOTH failure shapes a
 * broken avoidance strategy can take, not just one:
 * - `posts` / `posts#1` -- `posts#1` is exactly the first fallback
 *   candidate `buildFunctionKeyMap`'s own suffix convention would try
 *   for a "posts"-exported function colliding with the `posts` table.
 * - function A, exported "posts", returns `setof posts` -- collides
 *   with the `posts` table directly (attempt 0).
 * - function B, exported "postsAlt", returns `setof posts#1`'s table
 *   (SQL name "posts_alt") -- never collides with anything itself, but
 *   sits exactly where A's own first fallback attempt would land.
 */
describe("recursive collision avoidance beyond one fallback attempt (#587/G3)", () => {
	const DoubleCollidingMetadata: ContractMetadata = {
		commit: "abc123",
		exportHash: "sha256:x",
		roles: [],
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
			// A synthetic key (an SQL identifier could never literally read
			// this way), on purpose: occupies exactly the first fallback
			// candidate `buildFunctionKeyMap`'s own suffix convention would
			// try for the colliding "posts" export.
			"posts#1": {
				schema: "app",
				name: "posts_alt",
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
		functions: {
			posts: {
				schema: "app",
				name: "posts_page",
				args: [],
				returns: { kind: "table", schema: "app", name: "posts" },
			},
			postsAlt: {
				schema: "app",
				name: "posts_alt_page",
				args: [],
				returns: { kind: "table", schema: "app", name: "posts_alt" },
			},
		},
	};

	type DoubleCollidingDatabase = {
		readonly Tables: {
			readonly posts: {
				readonly Row: { readonly id: string };
				readonly Insert: { readonly id?: string };
				readonly Update: { readonly id?: string };
			};
			readonly "posts#1": {
				readonly Row: { readonly id: string };
				readonly Insert: { readonly id?: string };
				readonly Update: { readonly id?: string };
			};
		};
		readonly Functions: {
			readonly posts: {
				readonly Args: Record<string, never>;
				readonly Returns: ReadonlyArray<{ readonly id: string }>;
			};
			readonly postsAlt: {
				readonly Args: Record<string, never>;
				readonly Returns: ReadonlyArray<{ readonly id: string }>;
			};
		};
	};

	it("both tables and both functions survive when the first fallback candidate is also occupied", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ id: "11111111-1111-1111-1111-111111111111" }],
		});
		const client = createNameKeyedDb<DoubleCollidingDatabase>(
			driver,
			DoubleCollidingMetadata,
		);

		expect(client.posts.select().compile().sql).toContain('from "app"."posts"');
		expect(client["posts#1"].select().compile().sql).toContain(
			'from "app"."posts_alt"',
		);

		const postsPage = await client.fn.posts({});
		const postsAltPage = await client.fn.postsAlt({});

		expect(postsPage).toEqual([{ id: "11111111-1111-1111-1111-111111111111" }]);
		expect(postsAltPage).toEqual([
			{ id: "11111111-1111-1111-1111-111111111111" },
		]);
	});
});
