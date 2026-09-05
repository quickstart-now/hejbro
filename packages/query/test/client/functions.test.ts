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
		const { driver, sentPerTransaction } = recordingTransactionalDriver({
			rows: [{ result: "7" }],
			contributedRoles: ["app_reader"],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const value = await client
			.as({ role: roleName("app_reader") })
			.fn.totalPosts({});

		expect(value).toBe(7n);
		expect(driver.transaction).toHaveBeenCalledTimes(1);

		// #663: the context SQL itself, observed at the vendored surface --
		// the role statement first, then the very invocation the unscoped
		// call sends, inside the one transaction.
		const { driver: unscopedDriver, topLevelSent } =
			recordingTransactionalDriver({ rows: [{ result: "7" }] });
		await createNameKeyedDb<TestDatabase>(
			unscopedDriver,
			METADATA,
		).fn.totalPosts({});
		const inTransaction = sentPerTransaction[0] ?? [];
		expect(inTransaction.map((statement) => statement.sql)).toEqual([
			'set local role "app_reader"',
			topLevelSent[0]?.sql,
		]);
		expect(inTransaction[1]?.params).toEqual(topLevelSent[0]?.params);
	});
});

/**
 * D106 round 1, N3: the rewritten mismatched-call scenario's runtime
 * clause ("a pre-built value carrying an extra property is refused at
 * runtime by the argument-count check, never sent") had no observer —
 * `fn-types.test.ts` only proves the compile-time excess-property check,
 * which fires on a fresh object literal and never runs at all for a
 * pre-built value. This is the missing runtime half: a *variable*, not a
 * fresh literal, carrying one property the declaration doesn't name.
 */
describe("a pre-built value with an extra property is refused at runtime, before any SQL is sent (D106 round 1, N3)", () => {
	const ExtraArgMetadata: ContractMetadata = {
		commit: "abc123",
		exportHash: "sha256:x",
		roles: [],
		tables: {},
		functions: {
			searchPosts: {
				schema: "app",
				name: "search_posts",
				args: [
					{
						key: "status",
						sqlName: "status",
						typeNode: { typeName: "text" },
						mode: null,
						notNullElements: false,
					},
				],
				returns: {
					kind: "scalar",
					typeNode: { typeName: "bigint" },
					mode: "bigint",
				},
			},
		},
	};

	type ExtraArgDatabase = {
		readonly Tables: Record<string, never>;
		readonly Functions: {
			readonly searchPosts: {
				readonly Args: { readonly status: string };
				readonly Returns: bigint;
			};
		};
	};

	it("rejects with function-argument-count-mismatch and never reaches the driver", async () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ExtraArgDatabase>(
			driver,
			ExtraArgMetadata,
		);

		// A pre-built value, not a fresh object literal -- TypeScript's
		// excess-property check only fires on a literal at the call site
		// (`fn-types.test.ts`'s own compile-time observer), so a variable
		// carrying an extra key is exactly the shape this runtime guard
		// exists for.
		const args = { status: "published", extra: "not declared" };

		expect.assertions(3);
		try {
			await client.fn.searchPosts(args as never);
			expect.unreachable("should have refused the extra property");
		} catch (error) {
			expect(error).toHaveProperty("code", "function-argument-count-mismatch");
			expect((error as Error).message).toContain("search_posts");
		}
		expect(driver.execute).not.toHaveBeenCalled();
	});
});

/**
 * The runtime guard's key-set check (#697, R2-N1): a pre-built value
 * whose key *count* matches but names an argument the declaration
 * doesn't (a caller-side typo, unreachable from a type-checked call
 * site) used to pass `assertArgCount` and be sent with the misspelled
 * argument silently missing. Named exactly the declared two-argument
 * shape (`userId`, `limit`) so both the count check and the name check
 * have a real, non-trivial declaration to run against.
 */
describe("assertArgNames refuses an unknown argument key (#697, R2-N1)", () => {
	const TwoArgMetadata: ContractMetadata = {
		commit: "abc123",
		exportHash: "sha256:x",
		roles: [],
		tables: {},
		functions: {
			searchPosts: {
				schema: "app",
				name: "search_posts",
				args: [
					{
						key: "userId",
						sqlName: "user_id",
						typeNode: { typeName: "text" },
						mode: null,
						notNullElements: false,
					},
					{
						key: "limit",
						sqlName: "limit",
						typeNode: { typeName: "text" },
						mode: null,
						notNullElements: false,
					},
				],
				returns: { kind: "scalar", typeNode: { typeName: "text" }, mode: null },
			},
		},
	};

	type TwoArgDatabase = {
		readonly Tables: Record<string, never>;
		readonly Functions: {
			readonly searchPosts: {
				readonly Args: { readonly userId: string; readonly limit: string };
				readonly Returns: string;
			};
		};
	};

	it("sends the declared arguments in declared order, whatever order the caller wrote them", async () => {
		const { driver, topLevelSent } = recordingTransactionalDriver({
			rows: [{ result: "ok" }],
		});
		const client = createNameKeyedDb<TwoArgDatabase>(driver, TwoArgMetadata);

		const value = await client.fn.searchPosts({ limit: "10", userId: "a" });

		expect(value).toBe("ok");
		expect(topLevelSent[0]?.params).toEqual(["a", "10"]);
	});

	it("refuses a right-sized argument object naming an argument the function does not declare, and never reaches the driver", async () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TwoArgDatabase>(driver, TwoArgMetadata);
		const looseFn = client.fn as unknown as {
			readonly searchPosts: (args: unknown) => Promise<unknown>;
		};

		// A pre-built value, not a fresh object literal -- the compile-time
		// excess/missing-property checks never run for one (same reasoning
		// as the count-mismatch case above).
		const args = { user_id: "a", limit: "10" };

		expect.assertions(4);
		try {
			await looseFn.searchPosts(args);
			expect.unreachable("should have refused the unknown key");
		} catch (error) {
			expect(error).toHaveProperty("code", "function-argument-unknown");
			expect((error as Error).message).toContain("search_posts");
			expect((error as Error).message).toContain('"user_id"');
		}
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("still refuses with function-argument-count-mismatch, unchanged, for too many or too few keys", async () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TwoArgDatabase>(driver, TwoArgMetadata);
		const looseFn = client.fn as unknown as {
			readonly searchPosts: (args: unknown) => Promise<unknown>;
		};

		const tooMany = { userId: "a", limit: "10", extra: "not declared" };
		const tooFew = { userId: "a" };

		expect.assertions(3);
		await Promise.all(
			[tooMany, tooFew].map(async (args) => {
				try {
					await looseFn.searchPosts(args);
					expect.unreachable("should have refused the count mismatch");
				} catch (error) {
					expect(error).toHaveProperty(
						"code",
						"function-argument-count-mismatch",
					);
				}
			}),
		);
		expect(driver.execute).not.toHaveBeenCalled();
	});

	it("an empty argument object is sent against a no-argument function", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "42" }],
		});
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		const value = await client.fn.totalPosts({});

		expect(value).toBe(42n);
		expect(driver.execute).toHaveBeenCalledTimes(1);
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
