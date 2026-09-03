import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput, Snapshot } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	defineTrigger,
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
import { buildFixturePayload } from "./support/contract-fixture";

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
		expect(metadataBlock).toContain('"postId": { sqlName: "post_id"');
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
 * #662: the column half enters through the emitter's *other* input
 * contract, a hand-editable `schema.json` whose reader never checks a
 * key's shape (`columnFactSchema.key` is `z.string()`) -- not through
 * `table()`, which D36's `assertSqlName` makes structurally incapable of
 * declaring a non-identifier column key (every key that survives it is
 * already a valid TS identifier; tasks.md 1.4's own measurement). So the
 * snapshot/description come from a real declaration, and only the export
 * table fact's TS keys are hand-edited afterward, standing in for a
 * committed `schema.json` a person touched. The function argument half
 * has no such D36 check (`defineFunction` validates reserved words only)
 * and rides the real DSL directly.
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
			{ args: { "my-arg": uuid() }, returns: uuid() },
			(ctx, args) => {
				ctx.return(sql`${args["my-arg"]}`);
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
		// `posts` is the only declared table, so the patched array replaces
		// `payload.tables` outright rather than searching it back out.
		const patchedPayload: ExportPayload = {
			...payload,
			tables: [patchedTable],
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
				{ readonly columns: Record<string, unknown> }
			>;
			expect(Object.hasOwn(tables, key)).toBe(true);
			expect(Object.keys(tables)).toContain(key);

			expect(Object.hasOwn(tables[key]?.columns ?? {}, key)).toBe(true);
			expect(Object.keys(tables[key]?.columns ?? {})).toContain(key);

			const functions = contractMetadata.functions as Record<
				string,
				unknown
			>;
			expect(Object.hasOwn(functions, key)).toBe(true);
			expect(Object.keys(functions)).toContain(key);
		},
	);
});
