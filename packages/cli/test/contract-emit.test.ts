import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	defineTrigger,
	existingTable,
	interval,
	schema,
	select,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { createJiti } from "jiti";
import { describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import type {
	ExportColumnFact,
	ExportTableFact,
} from "../src/export/description";
import type { ExportPayload } from "../src/export/write";
import type {
	ValidatedExportPayload,
	ValidatedFunctionFact,
} from "../src/vendor/validate-export";
import { validateExport } from "../src/vendor/validate-export";
import { buildFixturePayload } from "./support/contract-fixture";
import { loadEmittedContract } from "./support/load-emitted-contract";

const app = schema("app");

const buildDeclarations = (): ReadonlyArray<HejbroInput> => {
	const posts = table(app, "posts", {
		id: uuid().primaryKey().defaultRandom(),
		title: text().notNull(),
	});
	return [app, posts];
};

describe("the metadata's runtime name map (5.1 follow-up, planner-confirmed)", () => {
	it("carries every table's schema, SQL name, and TS-key-to-SQL-name column map", () => {
		const postId = uuid().primaryKey().defaultRandom();
		const posts = table(app, "posts", { postId });
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, {
			source: "git",
			commit: "abc123",
			exportHash: "sha256:deadbeef",
		});

		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('schema: "app"');
		expect(metadataBlock).toContain('name: "posts"');
		expect(metadataBlock).toContain('{ key: "postId", sqlName: "post_id"');
		// The three facts `@hejbro/query`'s row conversion reads at runtime
		// (typeNode, mode, notNullElements) -- and only those (planner
		// condition ④: no primaryKey/unique/defaultValue, which never affect
		// query compilation or row conversion).
		expect(metadataBlock).toContain('typeNode: {"typeName":"uuid"}');
		expect(metadataBlock).toContain("mode: null");
		expect(metadataBlock).toContain("notNullElements: false");
		expect(metadataBlock).not.toContain("primaryKey");
		expect(metadataBlock).not.toContain("defaultValue");
	});

	it("carries a managed relation's foreign key facts for relation-following", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		const payload = buildFixturePayload([app, authors, posts]);
		const source = emitContract(payload, {
			source: "git",
			commit: "abc123",
			exportHash: "sha256:deadbeef",
		});

		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('referencesSchema: "app"');
		expect(metadataBlock).toContain('referencesTable: "authors"');
		expect(metadataBlock).toContain('columns: ["author_id"]');
	});
});

/**
 * #740/D4: a hand-built export/snapshot pair, never `table()` -- an
 * export is foreign input, so a column name that `assertSqlName` (D36)
 * would refuse a live declaration for (an integer-like name, `__proto__`,
 * `user-id`) needs no declaration to produce it here, only a snapshot
 * `columns` array (physical order) and an empty export column-fact map
 * (so `buildColumnEntries`'s own `columnFact?.key ?? column.name`
 * fallback makes each column's TS key its SQL name unchanged).
 */
const buildPhysicalOrderPayload = (
	order: ReadonlyArray<string>,
): ValidatedExportPayload => {
	const snapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {
			"table:app.docs": {
				schema: "app",
				name: "docs",
				columns: order.map((name) => ({
					name,
					typeNode: { typeName: "text" },
				})),
				indexes: [],
				foreignKeys: [],
			},
		},
	};
	const tableFact: ExportTableFact = {
		schemaName: "app",
		tableName: "docs",
		exportName: null,
		columns: {},
		existing: false,
	};
	return { tables: [tableFact], functions: [], roles: [], snapshot };
};

describe("client metadata lists columns in physical order (#740/D4)", () => {
	const PhysicalOrder = [
		"id",
		"0",
		"label",
		"2",
		"__proto__",
		"constructor",
		"Zeta",
		"user-id",
	];

	it("carries every column-name class in the snapshot's own physical order", async () => {
		const payload = buildPhysicalOrderPayload(PhysicalOrder);
		const source = emitContract(payload, ORIGIN);

		const loaded = await loadEmittedContract(source);
		const docsMeta = loaded.contractMetadata.tables.docs;
		if (docsMeta === undefined || !Array.isArray(docsMeta.columns)) {
			throw new Error("expected docs.columns to be a list");
		}
		expect(docsMeta.columns.map((column) => column.key)).toEqual(PhysicalOrder);
	});

	it("reverses when the snapshot's own physical order is reversed", async () => {
		const reversed = [...PhysicalOrder].reverse();
		const payload = buildPhysicalOrderPayload(reversed);
		const source = emitContract(payload, ORIGIN);

		const loaded = await loadEmittedContract(source);
		const docsMeta = loaded.contractMetadata.tables.docs;
		if (docsMeta === undefined || !Array.isArray(docsMeta.columns)) {
			throw new Error("expected docs.columns to be a list");
		}
		expect(docsMeta.columns.map((column) => column.key)).toEqual(reversed);
	});
});

const ORIGIN = {
	source: "git" as const,
	commit: "abc123",
	exportHash: "sha256:deadbeef",
};

describe("emitContract", () => {
	it("two runs against one commit are byte-identical", () => {
		const payload = buildFixturePayload(buildDeclarations());

		const first = emitContract(payload, ORIGIN);
		const second = emitContract(payload, ORIGIN);

		expect(first).toBe(second);
	});

	it("carries no timestamp", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it("the factory takes only a connection", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("export const createDb = (conn: Driver)");
		// No generic reaches the *caller* of createDb (proposal.md, "no type
		// parameter reaches the user") -- the factory's own signature line
		// carries no angle bracket. The generic binding happens one line
		// down, inside this module, where `createNameKeyedDb<Database>` is
		// called with the contract's own type -- that's 6.12's own wiring,
		// not something a caller of `createDb(conn)` ever writes.
		const factoryLine =
			source
				.split("\n")
				.find((line) => line.startsWith("export const createDb")) ?? "";
		expect(factoryLine).not.toContain("<");
	});

	it("R2-G6 6.12: createDb calls the real name-keyed client, bound to this module's own Database", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('import type { Driver } from "hejbro";');
		expect(source).toContain('import { createNameKeyedDb } from "hejbro";');
		expect(source).toContain(
			"createNameKeyedDb<Database>(conn, contractMetadata)",
		);
	});

	it("exports the commit and export identity", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('commit: "abc123"');
		expect(source).toContain('exportHash: "sha256:deadbeef"');
	});

	it("no relation is derived for an unmanaged target", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		// Only `posts` is exported -- `authors` exists as a declaration (so
		// the foreign key itself is valid) but never reaches the snapshot,
		// which is exactly "a table the export does not describe" (5.9):
		// the export step only ever sees what generation is handed.
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly authorId: string;");
		expect(source).not.toContain("app.authors");
		expect(source).toContain("readonly Relationships: readonly [];");
	});

	it("carries a relation to a managed target", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		const payload = buildFixturePayload([app, authors, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('referencedRelation: "app.authors"');
	});
});

describe("the Functions section (#587)", () => {
	it("emits a Functions entry per exported function", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		// Declared TS key differs from its SQL name (postStatus -> post_status)
		// and the second function's arg uses a non-default numeric mode
		// (bigint({mode:"number"})) -- a join keyed by sqlName, or an
		// implementation that ignores mode, both stay green on a fixture
		// where key===sqlName and mode is the default, so neither is used
		// here.
		const searchPosts = defineFunction(
			app,
			"search_posts",
			{ args: { postStatus: text() }, returns: posts },
			(ctx, args) => {
				ctx.return(
					select(posts).where(sql`${posts.title} = ${args.postStatus}`),
				);
			},
		);
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ args: { minWeight: bigint({ mode: "number" }) }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			posts,
			searchPosts,
			totalPosts,
		];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[searchPosts, "searchPosts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);
		const source = emitContract(payload, ORIGIN);

		// The Database interface's own Functions section.
		expect(source).toContain('"searchPosts": {');
		expect(source).toContain("readonly postStatus: string;");
		expect(source).toContain(
			'readonly Returns: ReadonlyArray<Database["Tables"]["posts"]["Row"]>;',
		);
		expect(source).toContain('"totalPosts": {');
		expect(source).toContain("readonly minWeight: number;");
		expect(source).toContain("readonly Returns: bigint;");

		// The runtime metadata's own functions map.
		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toContain('"searchPosts": {');
		expect(metadataBlock).toContain('key: "postStatus"');
		expect(metadataBlock).toContain('sqlName: "post_status"');
		expect(metadataBlock).toContain('"totalPosts": {');
		expect(metadataBlock).toContain('mode: "number"');
	});

	it("a function with no arguments emits Record<string, never>, not {}", () => {
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, totalPosts];
		const payload = buildFixturePayload(
			declarations,
			new Map([[totalPosts, "totalPosts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Args: Record<string, never>;");
	});

	it("an empty Functions section renders as {}, distinct from Views' own marker", () => {
		const payload = buildFixturePayload(buildDeclarations());
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
	});

	it("a trigger-synthesized function is absent", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		const trigger = defineTrigger(
			posts,
			{
				name: "posts_touch",
				timing: "before",
				events: ["update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, trigger];
		const payload = buildFixturePayload(
			declarations,
			new Map([[posts, "posts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
		expect(source).not.toContain("posts_touch");
	});

	it("a function returning a table the contract does not carry is absent", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const authorPosts = defineFunction(
			app,
			"author_posts",
			{ returns: authors },
			(ctx) => {
				ctx.return(select(authors));
			},
		);
		// Only `app` and `authorPosts` reach generation -- `authors` never
		// reaches the snapshot, the same pattern "no relation is derived for
		// an unmanaged target" above uses for a foreign key's target.
		const declarations: ReadonlyArray<HejbroInput> = [app, authorPosts];
		const payload = buildFixturePayload(
			declarations,
			new Map([[authorPosts, "authorPosts"]]),
		);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
		expect(source).not.toContain("authorPosts");
	});

	it("two runs against one commit are byte-identical with a function declared", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			title: text().notNull(),
		});
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ args: { minWeight: bigint({ mode: "number" }) }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, totalPosts];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const first = emitContract(payload, ORIGIN);
		const second = emitContract(payload, ORIGIN);

		expect(first).toBe(second);
	});
});

/**
 * The text between two markers, exclusive of both -- used to scope an
 * assertion to one rendered interface section (`Row`/`Insert`/`Update`)
 * so a mutant that only breaks one of the three sharing the same
 * literal text (e.g. a not-null, no-default column's `Row` and required
 * `Insert` entries render identically) is still caught by the section
 * it actually broke.
 */
const sectionBetween = (
	source: string,
	startMarker: string,
	endMarker: string,
): string => {
	const afterStart = source.split(startMarker)[1] ?? "";
	return afterStart.split(endMarker)[0] ?? "";
};

const requireTableFact = (
	payload: ExportPayload,
	tableName: string,
): ExportTableFact => {
	const fact = payload.tables.find((entry) => entry.tableName === tableName);
	if (fact === undefined) {
		throw new Error(`fixture: no table fact for "${tableName}"`);
	}
	return fact;
};

const requireColumnFact = (
	columns: ExportTableFact["columns"],
	sqlName: string,
): ExportColumnFact => {
	const fact = columns[sqlName];
	if (fact === undefined) {
		throw new Error(`fixture: no column fact for "${sqlName}"`);
	}
	return fact;
};

/**
 * #662/#679: both halves enter through the emitter's *other* input
 * contract, a hand-editable `schema.json` whose reader never checks a
 * key's shape (`columnFactSchema.key`/the function arg fact's `key` are
 * both `z.string()`) -- not through `table()`/`defineFunction()`, which
 * D36's `assertSqlName` makes structurally incapable of declaring a
 * non-identifier column key or argument key (every key that survives it
 * is already a valid TS identifier; tasks.md 1.4's own measurement for
 * columns, 1.1's for arguments). So the snapshot/description come from a
 * real declaration, and only the export facts' TS keys are hand-edited
 * afterward, standing in for a committed `schema.json` a person touched.
 */
describe("non-identifier keys are quoted in the emitted contract (#662)", () => {
	it("quotes a column key and an argument key that are not identifiers", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			myArg: text(),
			twoFa: text().notNull(),
		});
		const echoArg = defineFunction(
			app,
			"echo_arg",
			{ args: { myArg: uuid() }, returns: uuid() },
			(ctx, args) => {
				ctx.return(sql`${args.myArg}`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, echoArg];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[echoArg, "echoArg"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const myArgSqlName = "my_arg";
		const twoFaSqlName = "two_fa";
		const postsFact = requireTableFact(payload, "posts");
		const myArgFact = requireColumnFact(postsFact.columns, myArgSqlName);
		const twoFaFact = requireColumnFact(postsFact.columns, twoFaSqlName);
		const patchedTable: ExportTableFact = {
			...postsFact,
			columns: {
				...postsFact.columns,
				[myArgSqlName]: { ...myArgFact, key: "my-arg" },
				[twoFaSqlName]: { ...twoFaFact, key: "2fa" },
			},
		};
		const echoArgFact = requireFunctionFact(payload, "echoArg");
		const patchedFunction = {
			...echoArgFact,
			args: echoArgFact.args.map((arg) => {
				if (arg.sqlName !== myArgSqlName) {
					return arg;
				}
				return { ...arg, key: "my-arg" };
			}),
		};
		// `posts`/`echoArg` are the only declared table/function, so the
		// patched arrays replace `payload.tables`/`payload.functions`
		// outright rather than searching them back out.
		const patchedPayload: ExportPayload = {
			...payload,
			tables: [patchedTable],
			functions: [patchedFunction],
		};

		const source = emitContract(patchedPayload, ORIGIN);

		const rowSection = sectionBetween(
			source,
			"readonly Row: {",
			"readonly Insert: {",
		);
		const insertSection = sectionBetween(
			source,
			"readonly Insert: {",
			"readonly Update: {",
		);
		const updateSection = sectionBetween(
			source,
			"readonly Update: {",
			"readonly Relationships:",
		);

		// Row (tables.ts:131) -- the nullable column carries `| null`, the
		// not-null column does not.
		expect(rowSection).toContain('readonly "my-arg": string | null;');
		expect(rowSection).toContain('readonly "2fa": string;');
		// Insert -- the nullable/no-default column is optional (:141), the
		// not-null/no-default column is required (:143): two different code
		// paths, so each gets its own key.
		expect(insertSection).toContain('readonly "my-arg"?: string | null;');
		expect(insertSection).toContain('readonly "2fa": string;');
		// Update (:152) -- always optional, value type unchanged from Row.
		expect(updateSection).toContain('readonly "my-arg"?: string | null;');
		expect(updateSection).toContain('readonly "2fa"?: string;');
		// Args (functions.ts:158).
		expect(source).toContain('readonly Args: { readonly "my-arg": string; };');
	});
});

const requireFunctionFact = (
	payload: ExportPayload,
	exportName: string,
): ExportPayload["functions"][number] => {
	const fact = payload.functions.find(
		(entry) => entry.exportName === exportName,
	);
	if (fact === undefined) {
		throw new Error(`fixture: no function fact for "${exportName}"`);
	}
	return fact;
};

/**
 * #657: a format-1 export written before the typed function surface
 * existed carries a function fact with no `args`/`returns` key at all
 * (see `validate-export.test.ts`'s own reading observer for the
 * git-measured pre-#587 shape) — this is the other half of the delta,
 * the drop at contract-emission time. `posts`/`totalPosts`'s own
 * snapshot and table fact come from a real declaration (`buildFixturePayload`,
 * 1.4's own idiom) — only the function fact is hand-edited afterward to
 * the untyped shape, never this writer's own always-typed output.
 */
describe("a pre-functions fact drops out of the contract (#657)", () => {
	it("drops a pre-functions fact from the contract's Functions section and its metadata", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, totalPosts];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const totalPostsFact = requireFunctionFact(payload, "totalPosts");
		const untypedFact: ValidatedFunctionFact = {
			schemaName: totalPostsFact.schemaName,
			functionName: totalPostsFact.functionName,
			exportName: totalPostsFact.exportName,
			// No `args`/`returns` key at all -- the pre-#587 shape.
		};
		const patchedPayload = {
			...payload,
			functions: [untypedFact],
		};

		const source = emitContract(patchedPayload, ORIGIN);

		expect(source).toContain("readonly Functions: {};");
		expect(source).not.toContain("totalPosts");
		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).toMatch(/functions: \{\s*\},/);
		expect(metadataBlock).not.toContain("totalPosts");
	});

	it("drops a hand-edited fact carrying args but no returns, or returns but no args", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const totalPosts = defineFunction(
			app,
			"total_posts",
			{ args: { weight: bigint({ mode: "number" }) }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, totalPosts];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[totalPosts, "totalPosts"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const totalPostsFact = requireFunctionFact(payload, "totalPosts");
		// A hand-edited hybrid neither writer ever produces on its own --
		// exists only to prove the drop guard checks `args`/`returns`
		// independently, not "either implies both" (tasks.md 1.1's own m4).
		const argsOnlyFact: ValidatedFunctionFact = {
			schemaName: totalPostsFact.schemaName,
			functionName: totalPostsFact.functionName,
			exportName: totalPostsFact.exportName,
			args: totalPostsFact.args,
			// No `returns` key.
		};
		const returnsOnlyFact: ValidatedFunctionFact = {
			schemaName: totalPostsFact.schemaName,
			functionName: totalPostsFact.functionName,
			exportName: totalPostsFact.exportName,
			returns: totalPostsFact.returns,
			// No `args` key.
		};

		const argsOnlySource = emitContract(
			{ ...payload, functions: [argsOnlyFact] },
			ORIGIN,
		);
		const returnsOnlySource = emitContract(
			{ ...payload, functions: [returnsOnlyFact] },
			ORIGIN,
		);

		expect(argsOnlySource).toContain("readonly Functions: {};");
		expect(argsOnlySource).not.toContain("totalPosts");
		expect(returnsOnlySource).toContain("readonly Functions: {};");
		expect(returnsOnlySource).not.toContain("totalPosts");
	});
});

const INTERVAL_IMPORT = 'import type { IntervalValue } from "hejbro";';

/**
 * #661: `IntervalValue` is imported only when the emitted body actually
 * names it — decided structurally, over each fact's own `TypeNode`
 * (`typeNodeNamesInterval`), never a scan of the rendered body text (a
 * column keyed literally `IntervalValue` would false-positive that).
 * Three independent sources feed the decision (a column, a function
 * argument, a scalar function return), so each gets its own case; a
 * fourth pins the no-interval golden, and a fifth proves the database
 * (`pull`) header gets the same treatment as the git one.
 */
describe("the IntervalValue import is conditional on the contract actually naming it (#661)", () => {
	it("a column naming interval adds the import", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			checkIn: interval(),
		});
		const payload = buildFixturePayload([app, posts]);

		const source = emitContract(payload, ORIGIN);

		expect(source).toContain(INTERVAL_IMPORT);
	});

	it("a function argument naming interval adds the import", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const waitFor = defineFunction(
			app,
			"wait_for",
			{ args: { delay: interval() }, returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, waitFor];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[waitFor, "waitFor"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const source = emitContract(payload, ORIGIN);

		expect(source).toContain(INTERVAL_IMPORT);
	});

	it("a scalar function return naming interval adds the import", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const totalDuration = defineFunction(
			app,
			"total_duration",
			{ returns: interval() },
			(ctx) => {
				ctx.return(sql`interval '1 hour'`);
			},
		);
		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			posts,
			totalDuration,
		];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[totalDuration, "totalDuration"],
		]);
		const payload = buildFixturePayload(declarations, exportNames);

		const source = emitContract(payload, ORIGIN);

		expect(source).toContain(INTERVAL_IMPORT);
	});

	it("a contract with no interval fact anywhere carries no such import (golden)", () => {
		const payload = buildFixturePayload(buildDeclarations());

		const source = emitContract(payload, ORIGIN);

		expect(source).not.toContain(INTERVAL_IMPORT);
	});

	it("a database (pull) origin's header gets the same conditional import", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			checkIn: interval(),
		});
		const payload = buildFixturePayload([app, posts]);

		const source = emitContract(payload, {
			source: "database",
			database: "widgets_db",
			schemas: ["app"],
		});

		expect(source).toContain(INTERVAL_IMPORT);
	});
});

/**
 * A `ValidatedExportPayload`/`Snapshot` pair hand-written directly (never
 * run through the `table()`/`schema()` DSL, D110): the DSL's own object
 * literal would lose a `__proto__`-named field the exact same way the
 * emitter's own bug does, one layer earlier, so it cannot construct this
 * input at all. `key` names the table, its one column, and the one
 * exported function's export name all at once, at schema "app".
 */
const buildKeyNamePayload = (key: string): ValidatedExportPayload => {
	const snapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {
			[`table:app.${key}`]: {
				schema: "app",
				name: key,
				columns: [{ name: key, typeNode: { typeName: "uuid" } }],
				indexes: [],
				foreignKeys: [],
			},
		},
	};
	const tableFact: ExportTableFact = {
		schemaName: "app",
		tableName: key,
		exportName: null,
		columns: {},
		existing: false,
	};
	const functionFact: ValidatedFunctionFact = {
		schemaName: "app",
		functionName: "a_function",
		exportName: key,
		args: [],
		returns: { kind: "scalar", typeNode: { typeName: "uuid" }, mode: null },
	};
	return {
		tables: [tableFact],
		functions: [functionFact],
		roles: [],
		snapshot,
	};
};

/**
 * Extracts just the `export const contractMetadata = { … } as const;`
 * statement (self-contained, no imports) and imports it through jiti in
 * a scratch directory — proves the emitted *runtime value* carries a key,
 * not merely that the source text contains it, without needing "hejbro"
 * itself resolvable (the full generated module's `createNameKeyedDb`
 * import would need a built dist, same as a subprocess test; this
 * fragment carries no such import).
 */
const importEmittedMetadata = async (
	source: string,
): Promise<{ readonly contractMetadata: Record<string, unknown> }> => {
	const startMarker = "export const contractMetadata";
	const closeMarker = "} as const;";
	const start = source.indexOf(startMarker);
	const close = source.indexOf(closeMarker, start) + closeMarker.length;
	const standalone = `${source.slice(start, close)}\n`;
	const dir = await mkdtemp(join(tmpdir(), "hejbro-contract-emit-"));
	const filePath = join(dir, "metadata.ts");
	await writeFile(filePath, standalone);
	try {
		const jiti = createJiti(filePath, { fsCache: false });
		return (await jiti.import(filePath)) as {
			readonly contractMetadata: Record<string, unknown>;
		};
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};

describe("contractMetadata's emitted keys survive as own properties (#697, R2-N2)", () => {
	type KeyNameRow = {
		readonly label: string;
		readonly key: string;
	};

	// D110 input table: the defect itself, plus four names that only
	// *look* dangerous as controls -- each an own property of `Object`'s
	// own prototype, carried the same way an ordinary key is.
	const rows: ReadonlyArray<KeyNameRow> = [
		{ label: "__proto__ (the defect)", key: "__proto__" },
		{ label: "constructor (control)", key: "constructor" },
		{ label: "prototype (control)", key: "prototype" },
		{ label: "hasOwnProperty (control)", key: "hasOwnProperty" },
		{ label: "toString (control)", key: "toString" },
	];

	it.each(rows)(
		"carries $label at the table key, the column key, and the function export-name key",
		async ({ key }) => {
			const payload = buildKeyNamePayload(key);
			const source = emitContract(payload, ORIGIN);
			const { contractMetadata } = await importEmittedMetadata(source);

			const tables = contractMetadata.tables as Record<
				string,
				{ readonly columns: ReadonlyArray<{ readonly key: string }> }
			>;
			expect(Object.hasOwn(tables, key)).toBe(true);
			expect(Object.keys(tables)).toContain(key);

			// #740/D4: a column's key is a plain string value in a list now,
			// never an object-literal key -- so unlike the table/function
			// case above, there is no __proto__-as-key hazard left to prove
			// survival against here; this instead pins that the list-shaped
			// carrier keeps every column-name class as an ordinary list
			// member.
			expect(tables[key]?.columns.map((column) => column.key)).toContain(key);

			const functions = contractMetadata.functions as Record<string, unknown>;
			expect(Object.hasOwn(functions, key)).toBe(true);
			expect(Object.keys(functions)).toContain(key);
		},
	);
});

/**
 * #742 (constructor-review corpus): a hand-written export whose one
 * function argument is keyed by `argKey` -- the argument axis is a list,
 * so `__proto__` is the control here; the quoted-key axis (`a"b`, a
 * newline, `${danger}`) is what the emitter's escaping is measured on.
 */
const buildArgKeyPayload = (argKey: string): ValidatedExportPayload => {
	const snapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {},
	};
	const functionFact: ValidatedFunctionFact = {
		schemaName: "app",
		functionName: "a_function",
		exportName: "aFunction",
		args: [
			{
				key: argKey,
				sqlName: "arg",
				typeNode: { typeName: "uuid" },
				mode: null,
				notNullElements: false,
			},
		],
		returns: { kind: "scalar", typeNode: { typeName: "uuid" }, mode: null },
	};
	return { tables: [], functions: [functionFact], roles: [], snapshot };
};

describe("a function argument key survives the emitter's quoting (#742)", () => {
	type ArgKeyRow = {
		readonly label: string;
		readonly key: string;
		readonly quoted: boolean;
	};

	const rows: ReadonlyArray<ArgKeyRow> = [
		{
			label: "__proto__ (list carrier, control)",
			key: "__proto__",
			quoted: false,
		},
		{ label: "constructor (control)", key: "constructor", quoted: false },
		{ label: 'a"b (a double quote)', key: 'a"b', quoted: true },
		{ label: "a\\nb (a newline)", key: "a\nb", quoted: true },
		// Spelled in two halves so the test file itself carries no template
		// placeholder (Biome's noTemplateCurlyInString) -- the emitted key is
		// the joined text.
		{
			label: "a template hole",
			key: ["$", "{danger}"].join(""),
			quoted: true,
		},
	];

	it.each(rows)(
		"carries $label in the Args type and in contractMetadata",
		async ({ key, quoted }) => {
			const source = emitContract(buildArgKeyPayload(key), ORIGIN);
			const { contractMetadata } = await importEmittedMetadata(source);

			const functions = contractMetadata.functions as Record<
				string,
				{ readonly args: ReadonlyArray<{ readonly key: string }> }
			>;
			expect(functions.aFunction?.args.map((arg) => arg.key)).toEqual([key]);

			// The Args type names the key exactly once, JSON-quoted when it is
			// not an identifier -- a raw `a"b` or a raw newline would leave
			// the generated file unparseable.
			const argsLine = source
				.split("\n")
				.find((line) => line.includes("readonly Args:"));
			expect(argsLine).toBeDefined();
			if (quoted) {
				expect(argsLine).toContain(`readonly ${JSON.stringify(key)}:`);
			} else {
				expect(argsLine).toContain(`readonly ${key}:`);
			}
		},
	);
});

const VALIDATE_EXPORT_FORMAT_TEXT =
	'{"descriptionFormat":1,"snapshotFormat":8}';

/**
 * A hand-written `schema.json` naming a single column under `columnKey`
 * -- the description's own key/mode (`protoKey`/`"string"`) differ from
 * what a fallback would recover (the SQL name itself, and a `null`
 * mode), so the two are only indistinguishable if the description's own
 * fact survived `validateExport`'s reading (#697, R2-N2 sibling: the
 * loss lives in the reader, so this drives the real pipeline rather
 * than an in-memory payload).
 */
const buildSchemaTextWithColumnKey = (columnKey: string): string =>
	JSON.stringify({
		tables: [
			{
				schemaName: "app",
				tableName: "posts",
				exportName: "posts",
				columns: {
					[columnKey]: {
						key: "protoKey",
						mode: "string",
						notNullElements: false,
					},
				},
				existing: false,
			},
		],
		functions: [],
		roles: [],
		snapshot: {
			formatVersion: 8,
			dialect: "postgres",
			objects: {
				"table:app.posts": {
					schema: "app",
					name: "posts",
					columns: [
						{
							name: columnKey,
							typeNode: { typeName: "numeric", precision: null, scale: null },
						},
					],
					indexes: [],
					foreignKeys: [],
				},
			},
		},
	});

describe("a description's column fact reaches the contract under any column key (#697, R2-N2 sibling)", () => {
	type ColumnKeyRow = {
		readonly label: string;
		readonly columnKey: string;
	};

	// D110 input table: the defect, plus a look-alike and a plain
	// control -- each column fact's own key ("protoKey") and mode
	// ("string") differ from what column.name/null (the fallback) would
	// produce, so only a correct read produces them.
	const rows: ReadonlyArray<ColumnKeyRow> = [
		{ label: "__proto__ (the defect)", columnKey: "__proto__" },
		{ label: "constructor (control)", columnKey: "constructor" },
		{ label: "plain (control)", columnKey: "plain" },
	];

	it.each(rows)(
		"carries the description's own key and mode for a $label column key",
		async ({ columnKey }) => {
			const schemaText = buildSchemaTextWithColumnKey(columnKey);
			const { payload } = validateExport(
				VALIDATE_EXPORT_FORMAT_TEXT,
				schemaText,
			);

			const source = emitContract(payload, ORIGIN);
			const { contractMetadata } = await importEmittedMetadata(source);

			const tables = contractMetadata.tables as Record<
				string,
				{
					readonly columns: ReadonlyArray<{
						readonly key: string;
						readonly mode: unknown;
					}>;
				}
			>;
			const protoKeyColumn = tables.posts?.columns.find(
				(column) => column.key === "protoKey",
			);
			expect(protoKeyColumn).toBeDefined();
			expect(protoKeyColumn?.mode).toBe("string");
		},
	);
});

/**
 * 653/R3: one table's own rendered `Database["Tables"]` entry, isolated
 * by its unique opening key line through its own closing brace -- `Row`/
 * `Insert`/`Update` all close two tabs deep, so the table entry's own
 * one-tab close is what stops this slice at exactly one table.
 */
const tableEntrySection = (source: string, tableName: string): string =>
	sectionBetween(source, `\t${JSON.stringify(tableName)}: {`, "\n\t};");

/**
 * 653/R3, row 9: a hand-written export/snapshot pair (never `table()`,
 * D110) whose one foreign-key column's TS key is exactly `"Id"` -- the
 * one input `table()` itself cannot produce (D3, #653 measurement:
 * `assertSqlName` refuses the SQL name `toSnakeCase("Id")` would produce,
 * `"_id"`), reachable only because an export is foreign input (#740/D4).
 * `users` is the FK's target, carried in the same payload so the target
 * membership rule (R3/P6) does not itself exclude the relation for an
 * unrelated reason.
 */
const buildIdKeyRelationPayload = (): ValidatedExportPayload => {
	const snapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {
			"table:app.users": {
				schema: "app",
				name: "users",
				columns: [{ name: "id", typeNode: { typeName: "uuid" } }],
				indexes: [],
				foreignKeys: [],
			},
			"table:app.widgets": {
				schema: "app",
				name: "widgets",
				columns: [{ name: "id", typeNode: { typeName: "uuid" } }],
				indexes: [],
				foreignKeys: [
					{
						name: "widgets_id_fkey",
						columns: ["id"],
						referencesTable: "app.users",
						referencesColumns: ["id"],
					},
				],
			},
		},
	};
	const usersFact: ExportTableFact = {
		schemaName: "app",
		tableName: "users",
		exportName: null,
		columns: {},
		existing: false,
	};
	const widgetsFact: ExportTableFact = {
		schemaName: "app",
		tableName: "widgets",
		exportName: null,
		columns: {
			id: { key: "Id", mode: null, notNullElements: false },
		},
		existing: false,
	};
	return {
		tables: [usersFact, widgetsFact],
		functions: [],
		roles: [],
		snapshot,
	};
};

/**
 * 653/R3 P6: a hand-written payload whose snapshot carries the foreign
 * key's target while the export description does not describe it -- the
 * one state in which `Relationships` names a table the emitted `Tables`
 * has no entry for (`emit.ts` walks `payload.tables`, `buildRelationships`
 * walks the snapshot), so only the emitter can keep `target` pointing at
 * a key that exists.
 */
const buildUncarriedTargetPayload = (): ValidatedExportPayload => {
	const snapshot: Snapshot = {
		formatVersion: 8,
		dialect: "postgres",
		objects: {
			"table:app.users": {
				schema: "app",
				name: "users",
				columns: [{ name: "id", typeNode: { typeName: "uuid" } }],
				indexes: [],
				foreignKeys: [],
			},
			"table:app.gadgets": {
				schema: "app",
				name: "gadgets",
				columns: [
					{ name: "id", typeNode: { typeName: "uuid" } },
					{ name: "owner_id", typeNode: { typeName: "uuid" } },
				],
				indexes: [],
				foreignKeys: [
					{
						name: "gadgets_owner_id_fkey",
						columns: ["owner_id"],
						referencesTable: "app.users",
						referencesColumns: ["id"],
					},
				],
			},
		},
	};
	const ownerIdSqlName = "owner_id";
	const gadgetsFact: ExportTableFact = {
		schemaName: "app",
		tableName: "gadgets",
		exportName: null,
		columns: {
			[ownerIdSqlName]: { key: "ownerId", mode: null, notNullElements: false },
		},
		existing: false,
	};
	return { tables: [gadgetsFact], functions: [], roles: [], snapshot };
};

describe("the contract emits Relations (653/R2, R3)", () => {
	it("row 1: forward keys render in the table's own physical column order, then reverse keys, and the map comes after Relationships", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			editorId: uuid()
				.notNull()
				.references(() => users.id),
			authorId: uuid()
				.notNull()
				.references(() => users.id),
		});
		const comments = table(app, "comments", {
			id: uuid().primaryKey().defaultRandom(),
			postId: uuid()
				.notNull()
				.references(() => posts.id),
		});
		const payload = buildFixturePayload([app, users, posts, comments]);
		const source = emitContract(payload, ORIGIN);

		const postsSection = tableEntrySection(source, "posts");
		expect(postsSection).toContain(
			"\t\treadonly Relations: {\n" +
				'\t\t\treadonly editor: { readonly target: "users"; readonly mode: "one" };\n' +
				'\t\t\treadonly author: { readonly target: "users"; readonly mode: "one" };\n' +
				'\t\t\treadonly comments: { readonly target: "comments"; readonly mode: "many" };\n' +
				"\t\t};",
		);
		expect(postsSection.indexOf("readonly Relations:")).toBeGreaterThan(
			postsSection.indexOf("readonly Relationships:"),
		);
	});

	it("row 2: a FK column key not ending in Id renders no relation (self-collision)", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const docs = table(app, "docs", {
			id: uuid().primaryKey().defaultRandom(),
			owner: uuid()
				.notNull()
				.references(() => users.id),
		});
		const payload = buildFixturePayload([app, users, docs]);
		const source = emitContract(payload, ORIGIN);

		const docsSection = tableEntrySection(source, "docs");
		expect(docsSection).toContain("readonly Relations: {};");
	});

	it("row 3: a composite foreign key renders no relation on either side", () => {
		const projects = table(app, "projects", {
			tenantId: uuid(),
			id: uuid().primaryKey().defaultRandom(),
		});
		const tasks = table(
			app,
			"tasks",
			{ tenantId: uuid(), projectId: uuid() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.tenantId, t.projectId],
						references: {
							table: projects,
							columns: [projects.tenantId, projects.id],
						},
					},
				],
			}),
		);
		const payload = buildFixturePayload([app, projects, tasks]);
		const source = emitContract(payload, ORIGIN);

		const tasksSection = tableEntrySection(source, "tasks");
		expect(tasksSection).toContain("readonly Relations: {};");
		const projectsSection = tableEntrySection(source, "projects");
		expect(projectsSection).toContain("readonly Relations: {};");
	});

	it("row 4: two forward FKs to one table collapse to a single reverse key", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			editorId: uuid()
				.notNull()
				.references(() => users.id),
			authorId: uuid()
				.notNull()
				.references(() => users.id),
		});
		const payload = buildFixturePayload([app, users, posts]);
		const source = emitContract(payload, ORIGIN);

		const usersSection = tableEntrySection(source, "users");
		expect(usersSection).toContain(
			'readonly posts: { readonly target: "posts"; readonly mode: "many" };',
		);
		const occurrences = usersSection.split("readonly posts:").length - 1;
		expect(occurrences).toBe(1);
	});

	it("row 5: a managed FK onto an existing table renders forward on the managed table and reverse on the existing one (existingTable() cannot itself carry a FK, 653/R3 measurement)", () => {
		const accounts = existingTable("auth", "accounts", {
			id: uuid().primaryKey(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			accountId: uuid()
				.notNull()
				.references(() => accounts.id),
		});
		const payload = buildFixturePayload([app, accounts, posts]);
		const source = emitContract(payload, ORIGIN);

		const postsSection = tableEntrySection(source, "posts");
		expect(postsSection).toContain(
			'readonly account: { readonly target: "accounts"; readonly mode: "one" };',
		);
		const accountsSection = tableEntrySection(source, "accounts");
		expect(accountsSection).toContain(
			'readonly posts: { readonly target: "posts"; readonly mode: "many" };',
		);
	});

	it("row 6: a FK onto a table the export does not carry renders no relation", () => {
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => authors.id),
		});
		// Only `posts` is declared to the migration -- `authors` never
		// reaches the snapshot at all (contract-emit.test.ts's own
		// "carries no relation to an unmanaged target" fixture, reused
		// verbatim per 653/R3 instruction).
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, ORIGIN);

		const postsSection = tableEntrySection(source, "posts");
		expect(postsSection).toContain("readonly Relationships: readonly [];");
		expect(postsSection).toContain("readonly Relations: {};");
	});

	it("row 7: a forward strip colliding with a reverse schema-map key drops only that key, not the table it targets", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const notes = table(app, "notes", {
			id: uuid().primaryKey().defaultRandom(),
			authorsId: uuid()
				.notNull()
				.references(() => users.id),
		});
		const authors = table(app, "authors", {
			id: uuid().primaryKey().defaultRandom(),
			noteId: uuid()
				.notNull()
				.references(() => notes.id),
		});
		const payload = buildFixturePayload([app, users, notes, authors]);
		const source = emitContract(payload, ORIGIN);

		const notesSection = tableEntrySection(source, "notes");
		expect(notesSection).toContain("readonly Relations: {};");
		const authorsSection = tableEntrySection(source, "authors");
		expect(authorsSection).toContain(
			'readonly note: { readonly target: "notes"; readonly mode: "one" };',
		);
	});

	it("row 8: a relation key colliding with the table's own column key renders no relation", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts2 = table(app, "posts2", {
			id: uuid().primaryKey().defaultRandom(),
			author: text().notNull(),
			authorId: uuid()
				.notNull()
				.references(() => users.id),
		});
		const payload = buildFixturePayload([app, users, posts2]);
		const source = emitContract(payload, ORIGIN);

		const posts2Section = tableEntrySection(source, "posts2");
		expect(posts2Section).toContain("readonly Relations: {};");
	});

	it('row 9: a FK column whose TS key is exactly "Id" renders no relation, and never as a blank key (the endsWith("Id") mutant\'s own tell)', () => {
		const payload = buildIdKeyRelationPayload();
		const source = emitContract(payload, ORIGIN);

		const widgetsSection = tableEntrySection(source, "widgets");
		expect(widgetsSection).toContain("readonly Relations: {};");
		expect(widgetsSection).not.toContain('readonly ""');
	});

	it("row 10: a FK onto a table the snapshot carries but the contract does not emit renders no relation, though Relationships still names it", () => {
		const source = emitContract(buildUncarriedTargetPayload(), ORIGIN);

		const gadgetsSection = tableEntrySection(source, "gadgets");
		expect(gadgetsSection).toContain(
			'readonly referencedRelation: "app.users";',
		);
		expect(gadgetsSection).toContain("readonly Relations: {};");
		expect(source).not.toContain('\t"users": {');
	});

	it("row 11: a self-referential foreign key renders no relation in either direction", () => {
		// `.references()` cannot express a self-reference (the declaration
		// would reference its own initializer); `extras.foreignKeys` is the
		// documented path -- `packages/core/test/table-surface.test.ts`.
		const nodes = table(
			app,
			"nodes",
			{
				id: uuid().primaryKey().defaultRandom(),
				name: text().notNull(),
				parentId: uuid(),
			},
			(t) => ({
				foreignKeys: [
					{ columns: [t.parentId], references: { columns: [t.id] } },
				],
			}),
		);
		const payload = buildFixturePayload([app, nodes]);
		const source = emitContract(payload, ORIGIN);

		const nodesSection = tableEntrySection(source, "nodes");
		expect(nodesSection).toContain("readonly Relations: {};");
		// The raw list still names the edge -- only the derived view drops it.
		expect(nodesSection).toContain('readonly referencedRelation: "app.nodes";');
	});

	it("the runtime metadata carries no Relations member -- .related() forwards through the existing foreignKeys fact alone", () => {
		const users = table(app, "users", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
			authorId: uuid()
				.notNull()
				.references(() => users.id),
		});
		const payload = buildFixturePayload([app, users, posts]);
		const source = emitContract(payload, ORIGIN);

		const metadataBlock =
			source.split("export const contractMetadata")[1] ?? "";
		expect(metadataBlock).not.toContain("Relations");
	});
});
