import { roleName } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import type { ContractMetadata } from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { recordingTransactionalDriver } from "../db/recording-driver";

// A type deliberately wider than `METADATA` actually vendors -- the
// shape a stale `Database` type (edited or generated against a
// different commit than `contractMetadata`) could disagree with at
// runtime, which is exactly the situation 6.8 names.
type TestDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
		readonly comments: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
	readonly Functions: Record<string, never>;
};

const METADATA: ContractMetadata = {
	source: "git",
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
	functions: {},
};

/**
 * Errors name the contract, not internals (R2-G6 6.8): a table absent
 * from the contract fails with a coded, contract-naming error rather
 * than a raw "Cannot read properties of undefined" crash — the same
 * failure-naming discipline `undeclared-role` (6.7) already applies to
 * roles, applied here to table names.
 */
describe("errors name the contract, not internals (R2-G6 6.8)", () => {
	it("names a table absent from the contract", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		expect.assertions(2);
		try {
			// `comments` is in `TestDatabase`'s own type but never vendored
			// (`METADATA.tables` carries only `posts`) -- exactly the drift
			// this scenario names.
			client.comments.select();
		} catch (error) {
			expect((error as { readonly code: string }).code).toBe(
				"unknown-contract-table",
			);
			expect((error as Error).message).toContain("comments");
		}
	});

	it("a table the contract does carry works normally", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<TestDatabase>(driver, METADATA);

		await expect(client.posts.select()).resolves.toEqual([]);
	});

	it("names '(none vendored)' when the contract carries no tables at all", () => {
		const { driver } = recordingTransactionalDriver();
		const emptyMetadata: ContractMetadata = {
			commit: "abc123",
			exportHash: "sha256:x",
			roles: [],
			tables: {},
			functions: {},
		};
		const client = createNameKeyedDb<{
			readonly Tables: Record<string, never>;
			readonly Functions: Record<string, never>;
		}>(driver, emptyMetadata);

		expect.assertions(1);
		try {
			(
				client as unknown as { readonly posts: { select: () => void } }
			).posts.select();
		} catch (error) {
			expect((error as Error).message).toContain("(none vendored)");
		}
	});
});

/**
 * `"__proto__" in {}` is `true` (inherited from `Object.prototype`), so
 * a guard deciding "unknown" with `prop in obj` cannot refuse a lookup
 * of a name `Object.prototype` itself carries when the contract vendors
 * nothing under that exact name (D106 R1 N8) -- `client.fn.__proto__`
 * returned `Object.prototype` instead of refusing, and calling it threw
 * an uncoded `TypeError` instead of `unknown-contract-function`.
 */
describe("the guard refuses an inherited name the contract does not vendor (D106 R1 N8)", () => {
	type ProtoTestDatabase = {
		readonly Tables: {
			readonly posts: {
				readonly Row: { readonly id: string };
				readonly Insert: { readonly id?: string };
				readonly Update: { readonly id?: string };
			};
		};
		readonly Functions: {
			readonly add: {
				readonly Args: Record<string, never>;
				readonly Returns: bigint;
			};
		};
	};

	const ProtoMetadata: ContractMetadata = {
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
			add: {
				schema: "app",
				name: "add",
				args: [],
				returns: {
					kind: "scalar",
					typeNode: { typeName: "bigint" },
					mode: "bigint",
				},
			},
		},
	};

	it("refuses client.fn.__proto__ when the contract vendors no function named __proto__", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ProtoTestDatabase>(driver, ProtoMetadata);
		const looseFn = client.fn as unknown as Record<string, unknown>;

		expect.assertions(1);
		try {
			void Reflect.get(looseFn, "__proto__");
			expect.unreachable("should have refused __proto__");
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-contract-function");
		}
	});

	it("refuses client.__proto__ when the contract vendors no table named __proto__", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ProtoTestDatabase>(driver, ProtoMetadata);
		const looseClient = client as unknown as Record<string, unknown>;

		expect.assertions(1);
		try {
			void Reflect.get(looseClient, "__proto__");
			expect.unreachable("should have refused __proto__");
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-contract-table");
		}
	});

	it("refuses client.fn.hasOwnProperty, an inherited name the contract does not vendor", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ProtoTestDatabase>(driver, ProtoMetadata);
		const looseFn = client.fn as unknown as Record<string, unknown>;

		expect.assertions(1);
		try {
			void looseFn.hasOwnProperty;
			expect.unreachable("should have refused hasOwnProperty");
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-contract-function");
		}
	});

	it("a vendored table and function lookup is unaffected (control)", () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ProtoTestDatabase>(driver, ProtoMetadata);

		expect(client.posts).toBeDefined();
		expect(typeof client.fn.add).toBe("function");
	});

	it("client.fn.__proto__ resolves to the vendored callable when the contract does vendor a function named __proto__ (control -- the own property wins)", async () => {
		const { driver } = recordingTransactionalDriver({
			rows: [{ result: "5" }],
		});
		// A literal `{ __proto__: ... }` key sets the prototype instead of
		// creating an own property -- built with Object.fromEntries, the
		// same construction the emitter itself uses for this exact name
		// (contract/emit.ts's own renderMetadataKey).
		const protoFnMetadata: ContractMetadata = {
			...ProtoMetadata,
			functions: Object.fromEntries([
				...Object.entries(ProtoMetadata.functions ?? {}),
				[
					"__proto__",
					{
						schema: "app",
						name: "proto_fn",
						args: [],
						returns: {
							kind: "scalar",
							typeNode: { typeName: "bigint" },
							mode: "bigint",
						},
					},
				],
			]),
		};
		const client = createNameKeyedDb<ProtoTestDatabase>(
			driver,
			protoFnMetadata,
		);
		const looseFn = client.fn as unknown as Record<
			string,
			(args: unknown) => Promise<unknown>
		>;

		const protoFn = Reflect.get(looseFn, "__proto__") as (
			args: unknown,
		) => Promise<unknown>;
		const value = await protoFn({});

		expect(value).toBe(5n);
	});

	it("the names the language itself reads off the client stay readable, not refused (control)", async () => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ProtoTestDatabase>(driver, ProtoMetadata);

		await expect(Promise.resolve(client)).resolves.toBe(client);
		expect(() => String(client)).not.toThrow();
		expect(() => JSON.stringify(client)).not.toThrow();
	});
});

type ScopedContractDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
	readonly Functions: {
		readonly add: {
			readonly Args: Record<string, never>;
			readonly Returns: bigint;
		};
	};
};

const SCOPED_METADATA: ContractMetadata = {
	commit: "abc123",
	exportHash: "sha256:x",
	roles: ["app_reader"],
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
		add: {
			schema: "app",
			name: "add",
			args: [],
			returns: {
				kind: "scalar",
				typeNode: { typeName: "bigint" },
				mode: "bigint",
			},
		},
	},
};

/**
 * The scoped handle `client.as(context)` returns was a plain spread
 * object, never passed through `wrapWithTableGuard` -- an unvendored
 * lookup silently resolved `undefined` there while the same lookup on
 * the unscoped client already refused with a coded error (#769). Every
 * row below runs against both surfaces so the unscoped rows stand as
 * the control: whatever the client already does correctly, the scoped
 * handle must do too.
 */
describe("the scoped handle refuses exactly what the unscoped handle refuses (#769)", () => {
	const buildSurfaces = (): {
		readonly client: Record<string, unknown>;
		readonly scoped: Record<string, unknown>;
	} => {
		const { driver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<ScopedContractDatabase>(
			driver,
			SCOPED_METADATA,
		);
		const scoped = client.as({ role: roleName("app_reader") });
		return {
			client: client as unknown as Record<string, unknown>,
			scoped: scoped as unknown as Record<string, unknown>,
		};
	};

	type Expectation =
		| { readonly refuse: string; readonly names?: string }
		| { readonly readable: true };

	type Row = {
		readonly label: string;
		readonly onFn: boolean;
		readonly prop: string;
		readonly onClient: Expectation;
		readonly onScoped: Expectation;
	};

	const ROWS: ReadonlyArray<Row> = [
		{
			label: "nope",
			onFn: false,
			prop: "nope",
			onClient: { refuse: "unknown-contract-table", names: "posts" },
			onScoped: { refuse: "unknown-contract-table", names: "posts" },
		},
		{
			label: "__proto__",
			onFn: false,
			prop: "__proto__",
			onClient: { refuse: "unknown-contract-table" },
			onScoped: { refuse: "unknown-contract-table" },
		},
		{
			label: "hasOwnProperty",
			onFn: false,
			prop: "hasOwnProperty",
			onClient: { refuse: "unknown-contract-table" },
			onScoped: { refuse: "unknown-contract-table" },
		},
		{
			label: "fn.__proto__",
			onFn: true,
			prop: "__proto__",
			onClient: { refuse: "unknown-contract-function" },
			onScoped: { refuse: "unknown-contract-function" },
		},
		{
			label: "constructor",
			onFn: false,
			prop: "constructor",
			onClient: { readable: true },
			onScoped: { readable: true },
		},
		{
			label: "then",
			onFn: false,
			prop: "then",
			onClient: { readable: true },
			onScoped: { readable: true },
		},
		{
			label: "toJSON",
			onFn: false,
			prop: "toJSON",
			onClient: { readable: true },
			onScoped: { readable: true },
		},
		{
			label: "posts",
			onFn: false,
			prop: "posts",
			onClient: { readable: true },
			onScoped: { readable: true },
		},
		{
			label: "fn.add",
			onFn: true,
			prop: "add",
			onClient: { readable: true },
			onScoped: { readable: true },
		},
		{
			label: "as",
			onFn: false,
			prop: "as",
			onClient: { readable: true },
			onScoped: { refuse: "unknown-contract-table" },
		},
	];

	const SURFACES = ["client", "scoped"] as const;

	const pickHolder = (
		target: Record<string, unknown>,
		onFn: boolean,
	): Record<string, unknown> => {
		if (onFn) {
			return target.fn as Record<string, unknown>;
		}
		return target;
	};

	const pickExpectation = (
		row: Row,
		surface: (typeof SURFACES)[number],
	): Expectation => {
		if (surface === "client") {
			return row.onClient;
		}
		return row.onScoped;
	};

	const expectedAssertionCount = (expectation: Expectation): number => {
		if ("readable" in expectation) {
			return 0;
		}
		if (expectation.names !== undefined) {
			return 2;
		}
		return 1;
	};

	type CaseTuple = readonly [(typeof SURFACES)[number], string, Row];

	const CASES: ReadonlyArray<CaseTuple> = SURFACES.flatMap((surface) =>
		ROWS.map((row) => [surface, row.label, row] as const),
	);

	it.each(CASES)("%s: %s", (surface, _label, row) => {
		const surfaces = buildSurfaces();
		const target = surfaces[surface];
		const holder = pickHolder(target, row.onFn);
		const expectation = pickExpectation(row, surface);

		if ("readable" in expectation) {
			expect(() => Reflect.get(holder, row.prop)).not.toThrow();
			return;
		}

		expect.assertions(expectedAssertionCount(expectation));
		try {
			Reflect.get(holder, row.prop);
			expect.unreachable(`should have refused ${row.label} on ${surface}`);
		} catch (error) {
			expect(error).toHaveProperty("code", expectation.refuse);
			if (expectation.names !== undefined) {
				expect((error as Error).message).toContain(expectation.names);
			}
		}
	});

	it("scoped.nope.select() throws the coded error at the lookup, never a TypeError", () => {
		const { scoped } = buildSurfaces();
		const looseScoped = scoped as unknown as {
			readonly nope: { select: () => void };
		};

		expect.assertions(1);
		try {
			looseScoped.nope.select();
			expect.unreachable("should have refused nope before .select()");
		} catch (error) {
			expect(error).toHaveProperty("code", "unknown-contract-table");
		}
	});

	it("the names the language reads stay readable on the scoped handle (control)", async () => {
		const { scoped } = buildSurfaces();

		await expect(Promise.resolve(scoped)).resolves.toBe(scoped);
		expect(() => String(scoped)).not.toThrow();
		expect(() => JSON.stringify(scoped)).not.toThrow();
	});
});
