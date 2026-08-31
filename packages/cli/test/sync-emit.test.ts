import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import {
	bigint,
	defineFunction,
	emptySnapshot,
	existingTable,
	generateMigration,
	grant,
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

const TEST_SNAPSHOT_HASH = "sha256:0123456789abcdef";

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
		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

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
		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

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
		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

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

	it("exports the identity of its manifest row", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);

		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		// Restated verbatim -- never recomputed by re-hashing the embedded
		// snapshot, which would be a second way to derive the same fact.
		expect(source).toContain(
			`export const hejbroStamp = "${TEST_SNAPSHOT_HASH}";`,
		);
	});

	it("exports the manifest's role names in branded form", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const grantSet = grant(app).usage.to("anon", "authenticated");
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, grantSet];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);

		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		expect(source).toContain(
			'export const hejbroRoles = [roleName("anon"), roleName("authenticated")];',
		);
	});

	it("two syncs of the same row write byte-identical modules", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const document = {
			...buildManifestPayload(declarations, exportNames),
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		};

		const first = buildSyncedModuleSource(document);
		const second = buildSyncedModuleSource(document);

		expect(first).toBe(second);
	});

	it("the module carries no timestamp", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);

		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		expect(source).not.toContain("Date");
		expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it("derives no relation for a reference to an unmanaged table", () => {
		const authUsers = existingTable("auth", "users", { id: uuid() });
		const posts = table(
			app,
			"posts",
			{
				id: uuid().primaryKey(),
				authorId: uuid().notNull(),
			},
			(t) => ({
				foreignKeys: [
					{
						columns: [t.authorId],
						references: { table: authUsers, columns: [authUsers.id] },
					},
				],
			}),
		);
		const declarations: ReadonlyArray<HejbroInput> = [app, posts];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);

		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		// The column and its constraint are still reconstructed at the
		// type level; only the derived relation is absent (schema-sync
		// delta, "A reference to a table the schema does not own has no
		// relation") -- `auth.users` never enters this manifest
		// (existingTable is never passed to generateMigration), so there
		// is no target to resolve a relation key against.
		expect(source).toContain("authorId: uuid().notNull(),");
		expect(source).not.toContain(".references(");
	});

	it("attaches each column fact to the column it names, not the one at its position", () => {
		const postsV1 = table(app, "posts", {
			id: uuid().primaryKey(),
			amount: bigint({ mode: "bigint" }).notNull(),
			tags: text().array().notNullElements(),
		});
		const v1 = generateMigration({
			declarations: [app, postsV1],
			previousSnapshot: emptySnapshot,
		});

		const postsV2 = table(app, "posts", {
			id: uuid().primaryKey(),
			amount: bigint({ mode: "bigint" }).notNull(),
		});
		const v2 = generateMigration({
			declarations: [app, postsV2],
			previousSnapshot: v1.snapshot,
			confirmedDrops: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					columnName: "tags",
				},
			],
		});

		// Re-added, and declared *first* in TS this time (D81 still
		// appends a re-added column physically last, since its old slot
		// is gone) -- a position-based join would zip "tags"'s fact
		// against "id"'s snapshot slot instead of its own.
		const postsV3 = table(app, "posts", {
			tags: text().array().notNullElements(),
			id: uuid().primaryKey(),
			amount: bigint({ mode: "bigint" }).notNull(),
		});
		const v3 = generateMigration({
			declarations: [app, postsV3],
			previousSnapshot: v2.snapshot,
		});
		const exportNames = new Map<HejbroInput, string>([[postsV3, "posts"]]);
		const sidecar = buildManifestPayload([app, postsV3], exportNames);

		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot: v3.snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		expect(source).toContain("id: uuid()");
		expect(source).toContain('amount: bigint({ mode: "bigint" })');
		expect(source).toContain("tags: text().array().notNullElements()");
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
		// A comment of its own, like a real hand-written schema almost
		// always carries (a license header, a note) -- proves the refusal
		// rests on the synced-module mark itself, not merely on "this file
		// has no comments at all" (review: weakening the mark to a single
		// "//" left every existing fixture here, comment-free, still
		// correctly refused, while a realistic commented file would not
		// have been).
		await writeFile(
			destinationPath,
			"// my own schema\nexport const handWritten = 1;\n",
		);

		expect(() =>
			writeSyncedModule(destinationPath, "// hello\n", false),
		).toThrowError(
			expect.objectContaining({ code: "sync-destination-not-synced" }),
		);
		// unchanged -- the refusal happens before any write.
		expect(await readFile(destinationPath, "utf8")).toBe(
			"// my own schema\nexport const handWritten = 1;\n",
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
