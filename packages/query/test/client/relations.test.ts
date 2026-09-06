import type { Expr } from "@hejbro/core";
import { eq, jsonObjectFrom, roleName, select } from "@hejbro/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	ContractMetadata,
	ContractTableMeta,
} from "../../src/client/contract-types";
import { createNameKeyedDb } from "../../src/client/name-keyed-db";
import { synthesizeTable } from "../../src/client/synthesize";
import type { CompileResult } from "../../src/compile/compile";
import { compile } from "../../src/compile/compile";
import { db } from "../../src/db/db";
import type { Driver } from "../../src/driver/contract";
import { recordingTransactionalDriver } from "../db/recording-driver";

/**
 * Relations, where the contract carries them (R2-G6 6.6) — proven at the
 * same internal seam 6.5's parity test uses: `synthesizeTable`'s own
 * reconstructed `foreignKeys` (from the contract's vendored
 * `Relationships`) feed `@hejbro/query`'s already-shipped `related()`
 * chain method unchanged. Exposing `.related()` on the public per-table
 * client is part of the richer query surface awaiting the lead's filter-
 * syntax ruling (same open point as `.where()`) — this test proves the
 * *mechanism* the eventual public surface will delegate to already
 * works, the same split 6.5's own test makes.
 *
 * `synthesizeTable`'s own return type is deliberately the widest
 * `DeclaredTable` (no per-column literal typing reaches it, matching
 * "no type parameter reaches the user"), so every column ref and the
 * `.related()` sugar are read off it through a narrow, test-local cast
 * rather than by fighting that generic inference — this test's own
 * assertions are about runtime wiring, not about re-typing a
 * deliberately untyped reconstruction.
 */
describe("relations follow the contract's own vendored foreign keys (R2-G6 6.6)", () => {
	it("a synthesized foreign key drives related() exactly like a declared one", () => {
		const authorsMeta: ContractTableMeta = {
			schema: "app",
			name: "authors",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		};
		const postsMeta: ContractTableMeta = {
			schema: "app",
			name: "posts",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				authorId: {
					sqlName: "author_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [
				{
					name: "posts_author_id_fk",
					columns: ["author_id"],
					referencesSchema: "app",
					referencesTable: "authors",
					referencedColumns: ["id"],
				},
			],
		};
		const authors = synthesizeTable(authorsMeta);
		const posts = synthesizeTable(postsMeta);
		type Refs = { readonly id: Expr; readonly authorId: Expr };
		const authorsRefs = authors as unknown as Refs;
		const postsRefs = posts as unknown as Refs;

		const { driver } = recordingTransactionalDriver();
		const handle = db({ authors, posts }, driver);

		type Related = (spec: Readonly<Record<string, true>>) => {
			compile(): CompileResult;
		};
		const sugared = (handle.select(posts) as unknown as { related: Related })
			.related({ author: true })
			.compile();
		const explicit = compile(
			select(
				{
					id: postsRefs.id,
					authorId: postsRefs.authorId,
					author: jsonObjectFrom(
						select(authors).where(eq(authorsRefs.id, postsRefs.authorId)),
					),
				},
				posts,
			),
		);

		expect(sugared.sql).toBe(explicit.sql);
	});
});

/**
 * 653, task 1.2 -- `.related()` on the public name-keyed client's own
 * type. Reuses `fn-types.test.ts`'s inert `Driver` stub + `expectTypeOf`/
 * `@ts-expect-error` style for the type layer (T1-T6), `parity.test.ts`'s
 * declared-vs-client byte-compare style for the runtime layer (R1-R2, via
 * `synthesizeTable` over the same metadata this file's own 6.6 test
 * above already uses to build an internal comparison handle), and
 * `roles.test.ts`'s `.as(context)` construction plus `db/related.test.ts`'s
 * own RLS-scoped-related probe (`sentPerTransaction`, one data statement)
 * for the scoped read (R3). No `.related` member exists on the public
 * type yet (`name-keyed-db.ts`'s own `NameKeyedSelectChain` carries none),
 * so every access below is behind a runtime-only cast until that lands.
 */
type RelDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: {
				readonly id: string;
				readonly title: string;
				readonly authorId: string;
			};
			readonly Insert: {
				readonly id?: string;
				readonly title: string;
				readonly authorId: string;
			};
			readonly Update: {
				readonly id?: string;
				readonly title?: string;
				readonly authorId?: string;
			};
			readonly Relations: {
				readonly author: { readonly target: "users"; readonly mode: "one" };
				readonly comments: {
					readonly target: "comments";
					readonly mode: "many";
				};
			};
		};
		readonly users: {
			readonly Row: { readonly id: string; readonly email: string };
			readonly Insert: { readonly id?: string; readonly email: string };
			readonly Update: { readonly id?: string; readonly email?: string };
			readonly Relations: {
				readonly posts: { readonly target: "posts"; readonly mode: "many" };
			};
		};
		readonly comments: {
			readonly Row: {
				readonly id: string;
				readonly body: string;
				readonly postId: string;
			};
			readonly Insert: {
				readonly id?: string;
				readonly body: string;
				readonly postId: string;
			};
			readonly Update: {
				readonly id?: string;
				readonly body?: string;
				readonly postId?: string;
			};
			readonly Relations: {
				readonly post: { readonly target: "posts"; readonly mode: "one" };
			};
		};
		readonly tags: {
			readonly Row: { readonly id: string; readonly label: string };
			readonly Insert: { readonly id?: string; readonly label: string };
			readonly Update: { readonly id?: string; readonly label?: string };
			// 653/R3, task 1.1: an empty Relations map is emitted as a bare
			// `{}`, never `Record<string, never>` (`tables.ts`'s own
			// `renderRelations`) -- `keyof` must resolve to `never` here for
			// the "no .related member" guard to work, which `Record<string,
			// never>`'s index signature (`keyof` = `string`) would not.
			readonly Relations: Record<never, never>;
		};
	};
	readonly Functions: Record<string, never>;
};

/** A contract emitted before `Relations` existed (design Q2) -- no such key on any table at all, not an empty one. */
type LegacyDatabase = {
	readonly Tables: {
		readonly posts: {
			readonly Row: { readonly id: string };
			readonly Insert: { readonly id?: string };
			readonly Update: { readonly id?: string };
		};
	};
	readonly Functions: Record<string, never>;
};

/** The metadata `relClient` below is built from, and R1/R2's own byte-compare target -- `posts` (forward FK onto `users`), `users`, `comments` (forward FK onto `posts`, i.e. `posts`'s own reverse). Real, non-empty tables: T1/T2/T5 actually execute `relClient.posts...` (unlike T3/T4/T6's unexecuted closures), so a real underlying object is required or the table guard (`name-keyed-db.ts`'s `unknown-contract-table`) throws for a reason that has nothing to do with `.related()`. */
const buildRelationsMetadata = (): ContractMetadata => ({
	source: "git",
	commit: "abc123",
	exportHash: "sha256:x",
	roles: ["viewer"],
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
				authorId: {
					sqlName: "author_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [
				{
					name: "posts_author_id_fk",
					columns: ["author_id"],
					referencesSchema: "app",
					referencesTable: "users",
					referencedColumns: ["id"],
				},
			],
		},
		users: {
			schema: "app",
			name: "users",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				email: {
					sqlName: "email",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [],
		},
		comments: {
			schema: "app",
			name: "comments",
			columns: {
				id: {
					sqlName: "id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
				body: {
					sqlName: "body",
					typeNode: { typeName: "text" },
					mode: null,
					notNullElements: false,
				},
				postId: {
					sqlName: "post_id",
					typeNode: { typeName: "uuid" },
					mode: null,
					notNullElements: false,
				},
			},
			foreignKeys: [
				{
					name: "comments_post_id_fk",
					columns: ["post_id"],
					referencesSchema: "app",
					referencesTable: "posts",
					referencedColumns: ["id"],
				},
			],
		},
	},
	functions: {},
});

/** `legacyClient`'s own metadata -- one real `posts` table, no foreign keys, matching `LegacyDatabase`'s own shape (no `Relations` field anywhere). */
const LEGACY_METADATA: ContractMetadata = {
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

/** Mirrors `fn-types.test.ts`'s own inert stub -- T3/T4/T6 (below) only ever reach this driver through an unexecuted `_neverCalled` closure, exactly like that file's own convention; T1/T2/T5 execute for real, against a recording driver instead (declared right after). */
const inertDriver: Driver = {
	capabilities: {
		"interactive-transactions": true,
		"session-state": true,
		"prepared-statements": false,
		"batched-transactions": false,
	},
	execute: async () => [],
	transaction: async (callback) => callback({ execute: async () => [] }),
	batch: async () => [],
	setupSession: async () => {},
};
const { driver: relDriver } = recordingTransactionalDriver({ rows: [] });
const relClient = createNameKeyedDb<RelDatabase>(
	relDriver,
	buildRelationsMetadata(),
);
const legacyClient = createNameKeyedDb<LegacyDatabase>(
	inertDriver,
	LEGACY_METADATA,
);

describe("the type layer offers .related() from the contract's own Relations map (653, task 1.2)", () => {
	it("T1: a forward key types the nested field as the target's Row or null", () => {
		const chain = relClient.posts.select().related({ author: true });
		type Row = Awaited<typeof chain>[number];
		expectTypeOf<Row["author"]>().toEqualTypeOf<{
			readonly id: string;
			readonly email: string;
		} | null>();
	});

	it("T2: a reverse key types the nested field as ReadonlyArray<target's Row>", () => {
		const chain = relClient.posts.select().related({ comments: true });
		type Row = Awaited<typeof chain>[number];
		expectTypeOf<Row["comments"]>().toEqualTypeOf<
			ReadonlyArray<{
				readonly id: string;
				readonly body: string;
				readonly postId: string;
			}>
		>();
	});

	it("T3: a key outside the table's Relations map is rejected statically", () => {
		const _neverCalled = () =>
			// @ts-expect-error "nope" is not a key of posts.Relations.
			relClient.posts.select().related({ nope: true });
		void _neverCalled;
	});

	it("T4: a table with an empty Relations map, and any table on a pre-Relations contract, have no .related member at all -- not even for an empty spec", () => {
		const _neverCalledA = () =>
			// @ts-expect-error tags.Relations is empty -- no .related member.
			relClient.tags.select().related({ anything: true });
		void _neverCalledA;
		const _neverCalledB = () =>
			// @ts-expect-error a pre-Relations contract's client has no .related member anywhere.
			legacyClient.posts.select().related({ anything: true });
		void _neverCalledB;
		// Absence, not "a callable that could only ever take `{}`" -- the
		// same reason `db/chain.ts`'s own `RelatedCapable` collapses to
		// `unknown`: an empty spec must fail too, or the member is merely
		// useless rather than absent.
		const _neverCalledC = () =>
			// @ts-expect-error tags has no .related member at all, not even for an empty spec.
			relClient.tags.select().related({});
		void _neverCalledC;
		const _neverCalledD = () =>
			// @ts-expect-error a pre-Relations contract's client has no .related member at all.
			legacyClient.posts.select().related({});
		void _neverCalledD;
	});

	it("T5: .related() keeps the chain -- where/orderBy/limit compose after it (653/R4: exactly the declaring side's own stages, no .offset()), and the row keeps every own column plus the nested one", () => {
		const chain = relClient.posts
			.select()
			.related({ author: true })
			.where(eq(relClient.posts.columns.title, "hello") as never)
			.orderBy()
			.limit(1);
		type Row = Awaited<typeof chain>[number];
		expectTypeOf<Row["id"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["title"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["authorId"]>().toEqualTypeOf<string>();
		expectTypeOf<Row["author"]>().toEqualTypeOf<{
			readonly id: string;
			readonly email: string;
		} | null>();
	});

	it("T6: a mixed spec with one valid and one invalid key is rejected statically", () => {
		const _neverCalled = () =>
			relClient.posts.select().related({
				author: true,
				// @ts-expect-error "nope" is not a key of posts.Relations, even mixed with a valid key.
				nope: true,
			});
		void _neverCalled;
	});
});

/** Reads `.related` off a select chain the public type does not (yet) expose it on -- the same runtime-only cast this file's own 6.6 test above uses. */
type Related = (spec: Readonly<Record<string, true>>) => PromiseLike<
	ReadonlyArray<Record<string, unknown>>
> & {
	compile(): CompileResult;
	where: (condition: never) => ReturnType<Related>;
	orderBy: (...terms: ReadonlyArray<never>) => ReturnType<Related>;
	limit: (count: number) => ReturnType<Related>;
};
const asRelated = (chain: unknown): { readonly related: Related } =>
	chain as unknown as { readonly related: Related };

const buildInternalHandle = (
	metadata: ContractMetadata,
	driver: ReturnType<typeof recordingTransactionalDriver>["driver"],
) => {
	const postsMeta = metadata.tables.posts as ContractTableMeta;
	const usersMeta = metadata.tables.users as ContractTableMeta;
	const commentsMeta = metadata.tables.comments as ContractTableMeta;
	const posts = synthesizeTable(postsMeta);
	const users = synthesizeTable(usersMeta);
	const comments = synthesizeTable(commentsMeta);
	return { handle: db({ posts, users, comments }, driver), posts };
};

describe("the client's .related() compiles to exactly the internal handle's own statement (653, task 1.2)", () => {
	it("R1: a spec mixing a forward and a reverse key compiles byte-identically", () => {
		const metadata = buildRelationsMetadata();

		const { driver: clientDriver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<RelDatabase>(clientDriver, metadata);
		const sugared = asRelated(client.posts.select())
			.related({ author: true, comments: true })
			.compile();

		const { driver: internalDriver } = recordingTransactionalDriver();
		const { handle, posts } = buildInternalHandle(metadata, internalDriver);
		const explicit = asRelated(handle.select(posts))
			.related({ author: true, comments: true })
			.compile();

		expect(sugared.sql).toBe(explicit.sql);
		expect(sugared.params).toEqual(explicit.params);
	});

	it("R2: where/orderBy/limit after .related() compile byte-identically too (653/R4: exactly the declaring side's own stages, no .offset())", () => {
		const metadata = buildRelationsMetadata();

		const { driver: clientDriver } = recordingTransactionalDriver();
		const client = createNameKeyedDb<RelDatabase>(clientDriver, metadata);
		const sugared = asRelated(client.posts.select())
			.related({ author: true, comments: true })
			.where(eq(client.posts.columns.title, "hello") as never)
			.orderBy()
			.limit(1)
			.compile();

		const { driver: internalDriver } = recordingTransactionalDriver();
		const { handle, posts } = buildInternalHandle(metadata, internalDriver);
		type PostsRefs = { readonly title: Expr };
		const postsRefs = posts as unknown as PostsRefs;
		const explicit = asRelated(handle.select(posts))
			.related({ author: true, comments: true })
			.where(eq(postsRefs.title, "hello") as never)
			.orderBy()
			.limit(1)
			.compile();

		expect(sugared.sql).toBe(explicit.sql);
		expect(sugared.params).toEqual(explicit.params);
	});
});

describe("a scoped related read runs under the same context as the row (653, task 1.2)", () => {
	it("R3: .as(context)'s related read sends set_config before the one data statement", async () => {
		const metadata = buildRelationsMetadata();
		const { driver, sentPerTransaction, topLevelSent } =
			recordingTransactionalDriver({ rows: [] });
		const client = createNameKeyedDb<RelDatabase>(driver, metadata);

		// `settings` shape copied from `packages/query/test/db/chain.test.ts:634`
		// -- a claim needs a real `set_config` call to witness (a bare
		// `role` alone sends only `set local role`, `context.ts:193-206`).
		const scoped = client.as({
			role: roleName("viewer"),
			settings: { "app.claim": "v" },
		});
		await asRelated(scoped.posts.select()).related({ author: true });

		expect(topLevelSent.length).toBe(0);
		const flatSent = sentPerTransaction.flat();
		const dataStatements = flatSent.filter(
			(statement) =>
				statement.sql.startsWith("select ") &&
				!statement.sql.includes("set_config"),
		);
		expect(dataStatements).toHaveLength(1);
		expect(dataStatements[0]?.sql).toContain("row_to_json");
		const setConfigStatements = flatSent.filter((statement) =>
			statement.sql.includes("set_config"),
		);
		expect(setConfigStatements.length).toBeGreaterThan(0);
		const dataIndex = flatSent.indexOf(dataStatements[0] as never);
		const contextStatements = flatSent.slice(0, dataIndex);
		expect(
			setConfigStatements.every((statement) =>
				contextStatements.includes(statement),
			),
		).toBe(true);
		expect(
			contextStatements.some(
				(statement) => statement.sql === 'set local role "viewer"',
			),
		).toBe(true);
	});
});
