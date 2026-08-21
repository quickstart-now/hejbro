import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { createDefaultRegistry } from "../src/kind/registry";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import {
	bigserial,
	integer,
	serial,
	text,
	uuid,
} from "../src/types/column-builder-factories";

const app = schema("app");
const postStatus = pgEnum(app, "post_status", ["draft", "published"]);
const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
	status: postStatus.column().notNull(),
});
const comments = table(app, "comments", {
	id: uuid().primaryKey().defaultRandom(),
	body: text().notNull(),
});
const declarations = [
	app,
	postStatus,
	getTableMeta(posts),
	getTableMeta(comments),
];

describe("generateMigration", () => {
	it("generates the full sql text from an empty snapshot over a two-table + enum declaration set", () => {
		const result = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		});

		expect(result.hasChanges).toBe(true);
		expect(
			result.changes.map(
				(change) => `${change.operation} ${change.kind} ${change.identity}`,
			),
		).toEqual([
			"create schema app",
			"create enum app.post_status",
			"create table app.comments",
			"create table app.posts",
		]);

		const banner =
			"-- hejbro migration\n" +
			"-- + schema app [new]\n" +
			"-- + enum app.post_status [new]\n" +
			"-- + table app.comments [new]\n" +
			"-- + table app.posts [new]";
		const createSchema = 'create schema "app";';
		const createEnum = `create type "app"."post_status" as enum ('draft', 'published');`;
		const createComments =
			'create table "app"."comments" (\n' +
			'\t"id" uuid not null default gen_random_uuid(),\n' +
			'\t"body" text not null,\n' +
			'\tprimary key ("id")\n' +
			");";
		const createPosts =
			'create table "app"."posts" (\n' +
			'\t"id" uuid not null default gen_random_uuid(),\n' +
			'\t"title" text not null,\n' +
			'\t"status" "app"."post_status" not null,\n' +
			'\tprimary key ("id")\n' +
			");";

		expect(result.sql).toBe(
			[banner, createSchema, createEnum, createComments, createPosts].join(
				"\n\n",
			),
		);
	});

	it("returns hasChanges: false and an empty sql string when nothing changed", () => {
		const registry = createDefaultRegistry();
		const snapshot = buildSnapshot(declarations, registry);
		const result = generateMigration({
			declarations,
			previousSnapshot: snapshot,
			registry,
		});

		expect(result.hasChanges).toBe(false);
		expect(result.sql).toBe("");
		expect(result.changes).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	describe("rename flags (Phase 5)", () => {
		const renameApp = schema("app");
		const previousPosts = table(renameApp, "posts", { slug: text() });
		const nextPosts = table(renameApp, "posts", { handle: text() });
		const previousSnapshot = buildSnapshot(
			[renameApp, getTableMeta(previousPosts)],
			createDefaultRegistry(),
		);

		it("returns errors and empty sql for an ambiguous drop+add pair", () => {
			const result = generateMigration({
				declarations: [renameApp, getTableMeta(nextPosts)],
				previousSnapshot,
			});

			expect(result.errors).toEqual([
				expect.objectContaining({ code: "ambiguous-column-rename" }),
			]);
			expect(result.ambiguities).toEqual([
				expect.objectContaining({ kind: "column" }),
			]);
			expect(result.sql).toBe("");
			expect(result.hasChanges).toBe(false);
		});

		it("resolves the pair with a matching --rename spec into a RENAME-led migration", () => {
			const result = generateMigration({
				declarations: [renameApp, getTableMeta(nextPosts)],
				previousSnapshot,
				renames: [
					{
						target: "column",
						schemaName: "app",
						tableName: "posts",
						oldName: "slug",
						newName: "handle",
					},
				],
			});

			expect(result.errors).toEqual([]);
			expect(result.hasChanges).toBe(true);
			expect(result.sql.startsWith("-- hejbro migration\n")).toBe(true);
			expect(result.sql).toContain(
				'-- ~ table app.posts [column "slug" renamed to "handle"]',
			);
			const [, firstStatement] = result.sql.split("\n\n");
			expect(firstStatement).toBe(
				'alter table "app"."posts" rename column "slug" to "handle";',
			);
		});
	});

	// #23/D66: resolveDeclarations synthesizes one SequenceDeclaration per
	// serial-family column -- verified end to end against a real Postgres
	// (this exact SQL, applied to a scratch database, then compared via
	// pg_dump against a native `serial primary key` column: structurally
	// identical modulo the `::regclass` cast Postgres adds on its own
	// read-back and the role-ownership statement this PR deliberately
	// skips, matching the rest of hejbro's role-agnostic stance).
	describe("serial-family columns synthesize a sequence declaration (#23/D66)", () => {
		it("create: sequence (main), table (main), owned-by + set-default (deferred)", () => {
			const seqApp = schema("app");
			const posts = table(seqApp, "posts", {
				id: serial().primaryKey(),
				title: text(),
			});
			const result = generateMigration({
				declarations: [seqApp, posts],
				previousSnapshot: emptySnapshot,
			});

			expect(result.errors).toEqual([]);
			expect(
				result.changes.map(
					(change) => `${change.operation} ${change.kind} ${change.identity}`,
				),
			).toEqual([
				"create schema app",
				"create sequence app.posts_id_seq",
				"create table app.posts",
			]);

			const banner =
				"-- hejbro migration\n" +
				"-- + schema app [new]\n" +
				"-- + sequence app.posts_id_seq [new]\n" +
				"-- + table app.posts [new]";
			const createSchema = 'create schema "app";';
			const createSequence = 'create sequence "app"."posts_id_seq" as integer;';
			const createTable =
				'create table "app"."posts" (\n' +
				'\t"id" integer not null,\n' +
				'\t"title" text,\n' +
				'\tprimary key ("id")\n' +
				");";
			const ownedBy =
				'alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";';
			const setDefault =
				'alter table "app"."posts" alter column "id" set default nextval(\'app.posts_id_seq\');';

			expect(result.sql).toBe(
				[
					banner,
					createSchema,
					createSequence,
					createTable,
					ownedBy,
					setDefault,
				].join("\n\n"),
			);
		});

		it("no sequence declaration for a table with no serial-family column", () => {
			const seqApp = schema("app");
			const posts = table(seqApp, "posts", {
				id: uuid().primaryKey(),
				title: text(),
			});
			const result = generateMigration({
				declarations: [seqApp, posts],
				previousSnapshot: emptySnapshot,
			});
			expect(result.changes.some((change) => change.kind === "sequence")).toBe(
				false,
			);
		});

		it("integer() -> serial(): create sequence, owned-by, set-default -- no invalid alter column type serial", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", { id: integer().primaryKey() });
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { id: serial().primaryKey() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(result.sql).not.toContain("type serial");
			expect(result.sql).toContain('create sequence "app"."posts_id_seq"');
			expect(result.sql).toContain(
				'alter sequence "app"."posts_id_seq" owned by "app"."posts"."id";',
			);
			expect(result.sql).toContain("set default nextval(");
		});

		it("serial() -> integer(): drop default, then drop sequence -- the omission #23/D66 recorded", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", { id: serial().primaryKey() });
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { id: integer().primaryKey() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(result.sql).toContain(
				'alter table "app"."posts" alter column "id" drop default;',
			);
			expect(result.sql).toContain('drop sequence "app"."posts_id_seq";');
		});

		it("serial() -> bigserial(): alter sequence as bigint + alter column type bigint, sequence identity unchanged", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", { id: serial().primaryKey() });
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { id: bigserial().primaryKey() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(
				result.changes.map(
					(change) => `${change.operation} ${change.kind} ${change.identity}`,
				),
			).toEqual(["alter sequence app.posts_id_seq", "alter table app.posts"]);
			expect(result.sql).toContain(
				'alter sequence "app"."posts_id_seq" as bigint;',
			);
			expect(result.sql).toContain(
				'alter table "app"."posts" alter column "id" type bigint;',
			);
		});

		it("no-op: re-declaring the same serial column produces zero changes", () => {
			const seqApp = schema("app");
			const declareTable = () =>
				table(seqApp, "posts", { id: serial().primaryKey(), title: text() });
			const previous = generateMigration({
				declarations: [seqApp, declareTable()],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const result = generateMigration({
				declarations: [seqApp, declareTable()],
				previousSnapshot: previous,
			});
			expect(result.hasChanges).toBe(false);
			expect(result.changes).toEqual([]);
		});
	});

	// #193 review: a serial column's sequence is `owned by` its column, so
	// Postgres already cascades the sequence away the moment the owning
	// table *or* column is dropped (confirmed directly against a real
	// Postgres for both). If sequenceKind still emitted its own
	// `drop default`/`drop sequence` statements for that change, they'd run
	// against a target the cascade already removed, and fail. This three-
	// point matrix pins the fix (generate.ts's sequenceDropIsCascaded):
	// table drop and column drop both suppress the sequence's own SQL
	// (banner only), while a type transition that leaves the column alive
	// (serial() -> integer(), already covered above) keeps emitting bare
	// drop statements normally.
	describe("#193: a sequence drop cascaded by Postgres emits no SQL of its own", () => {
		it("dropping the whole table emits only `drop table`, no drop default/drop sequence", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", { id: serial().primaryKey() });
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const result = generateMigration({
				declarations: [seqApp],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(result.changes.map((c) => `${c.operation} ${c.kind}`)).toEqual([
				"drop table",
				"drop sequence",
			]);
			expect(result.sql).toContain('drop table "app"."posts";');
			expect(result.sql).not.toContain("drop default");
			expect(result.sql).not.toContain("drop sequence");
		});

		it("dropping just the serial column emits only `drop column`, no drop default/drop sequence", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", {
				id: serial().primaryKey(),
				title: text(),
			});
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { title: text() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(result.sql).toContain(
				'alter table "app"."posts" drop column "id";',
			);
			expect(result.sql).not.toContain("drop default");
			expect(result.sql).not.toContain("drop sequence");
		});

		it("a type transition that keeps the column alive (serial -> integer) still emits bare drop statements", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", { id: serial().primaryKey() });
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { id: integer().primaryKey() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			expect(result.sql).toContain(
				'alter table "app"."posts" alter column "id" drop default;',
			);
			expect(result.sql).toContain('drop sequence "app"."posts_id_seq";');
		});
	});
});
