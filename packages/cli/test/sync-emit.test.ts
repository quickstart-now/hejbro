import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	emptySnapshot,
	generateMigration,
	pgEnum,
	schema,
	sql,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildManifestPayload } from "../src/manifest-payload";
import { buildSyncedModuleSource } from "../src/sync/emit";
import { writeSyncedModule } from "../src/sync/write";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

const app = schema("app");

describe("buildSyncedModuleSource", () => {
	it("reproduces the carried choices of the manifest", () => {
		const status = pgEnum(app, "post_status", ["draft", "published"]);
		const users = table(app, "users", {
			userId: uuid().primaryKey(),
		});
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			authorId: uuid()
				.notNull()
				.references(() => users.userId),
			viewCount: bigint({ mode: "bigint" }).notNull(),
			tags: text().array().notNullElements(),
			status: status.column().notNull(),
		});

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			users,
			posts,
			status,
		];
		const exportNames = new Map<HejbroInput, string>([
			[users, "users"],
			[posts, "posts"],
		]);

		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);
		const source = buildSyncedModuleSource({ ...sidecar, snapshot });

		// TS keys, not SQL names.
		expect(source).toContain("userId: uuid()");
		expect(source).toContain("authorId: uuid()");
		// numeric mode carried from the sidecar.
		expect(source).toContain('viewCount: bigint({ mode: "bigint" }).notNull()');
		// array + non-null elements.
		expect(source).toContain("tags: text().array().notNullElements()");
		// enum column, referencing a declared enum constant.
		expect(source).toContain("status: postStatus.column().notNull()");
		expect(source).toContain(
			'export const postStatus = pgEnum(appSchema, "post_status", ["draft", "published"]);',
		);
		// relation in both directions: the FK column resolves to the
		// target's own TS key.
		expect(source).toContain(".references(() => users.userId)");
		// export names travel from the sidecar.
		expect(source).toContain("export const users = syncedTable(");
		expect(source).toContain("export const posts = syncedTable(");
	});

	it("emits tables and enums and no function declaration", () => {
		const status = pgEnum(app, "post_status", ["draft", "published"]);
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			status: status.column().notNull(),
		});
		const countPosts = defineFunction(
			app,
			"count_posts",
			{ returns: bigint() },
			(ctx) => {
				ctx.return(sql`1`);
			},
		);

		const declarations: ReadonlyArray<HejbroInput> = [
			app,
			posts,
			status,
			countPosts,
		];
		const exportNames = new Map<HejbroInput, string>([
			[posts, "posts"],
			[countPosts, "countPosts"],
		]);

		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);
		const source = buildSyncedModuleSource({ ...sidecar, snapshot });

		expect(source).toContain("export const posts = syncedTable(");
		expect(source).toContain("export const postStatus = pgEnum(");
		expect(source).not.toContain("count_posts");
		expect(source).not.toContain("countPosts");
		expect(source).not.toContain("defineFunction");
	});

	it("is real, loadable TypeScript — jiti resolves it and its tables refuse migration authority", async () => {
		const status = pgEnum(app, "post_status", ["draft", "published"]);
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
			status: status.column().notNull(),
		});
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, status];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);
		const source = buildSyncedModuleSource({ ...sidecar, snapshot });

		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", source);
			const result = await runCli(cwd, ["generate"]);
			// A synced module's tables carry no migration authority
			// (schema-sync delta) -- jiti loading the generated file at all
			// (rather than a syntax-error crash) and hitting this specific
			// refusal is what proves the emitted source is real, working
			// TypeScript, not just text that happens to match assertions.
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("synced-table-declared");
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});

describe("writeSyncedModule", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "hejbro-sync-write-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("writes one module and nothing else", async () => {
		const destinationPath = join(cwd, "schema.synced.ts");

		writeSyncedModule(destinationPath, "// hello\n", false);

		const entries = await readdir(cwd);
		expect(entries).toEqual(["schema.synced.ts"]);
		expect(await readFile(destinationPath, "utf8")).toBe("// hello\n");
	});

	it("refuses to overwrite a file it did not write", async () => {
		const destinationPath = join(cwd, "schema.ts");
		await writeFile(destinationPath, "export const handWritten = 1;\n");

		expect(() =>
			writeSyncedModule(destinationPath, "// hello\n", false),
		).toThrowError(
			expect.objectContaining({ code: "sync-destination-not-synced" }),
		);
		// unchanged -- the refusal happens before any write.
		expect(await readFile(destinationPath, "utf8")).toBe(
			"export const handWritten = 1;\n",
		);
	});

	it("overwrites a previously synced module without --force", async () => {
		const destinationPath = join(cwd, "schema.synced.ts");
		await writeFile(
			destinationPath,
			"// Generated by `hejbro sync` — do not edit by hand.\n// stale\n",
		);

		expect(() =>
			writeSyncedModule(destinationPath, "// fresh\n", false),
		).not.toThrow();
		expect(await readFile(destinationPath, "utf8")).toBe("// fresh\n");
	});

	it("overwrites a hand-written file when --force is passed", async () => {
		const destinationPath = join(cwd, "schema.ts");
		await writeFile(destinationPath, "export const handWritten = 1;\n");

		expect(() =>
			writeSyncedModule(destinationPath, "// hello\n", true),
		).not.toThrow();
		expect(await readFile(destinationPath, "utf8")).toBe("// hello\n");
	});
});
