import { describe, expect, it } from "vitest";
import { check } from "../src/dsl/check";
import { defineFunction } from "../src/dsl/define-function";
import { defineTrigger } from "../src/dsl/define-trigger";
import { existingTable } from "../src/dsl/existing-table";
import { index } from "../src/dsl/index-builder";
import { pgEnum } from "../src/dsl/pg-enum";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration, generateMigrations } from "../src/engine/generate";
import { eq, isNotNull, literal, now } from "../src/expr/operators";
import { sql } from "../src/expr/sql-template";
import { createDefaultRegistry } from "../src/kind/registry";
import type { TableSnapshot } from "../src/kinds/table-snapshot";
import { update } from "../src/query/mutate";
import type { Snapshot } from "../src/snapshot/snapshot";
import { buildSnapshot, emptySnapshot } from "../src/snapshot/snapshot";
import {
	bigserial,
	integer,
	serial,
	text,
	timestamptz,
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
			'\tconstraint "comments_pkey" primary key ("id")\n' +
			");";
		const createPosts =
			'create table "app"."posts" (\n' +
			'\t"id" uuid not null default gen_random_uuid(),\n' +
			'\t"title" text not null,\n' +
			'\t"status" "app"."post_status" not null,\n' +
			'\tconstraint "posts_pkey" primary key ("id")\n' +
			");";

		expect(result.sql).toBe(
			[banner, createSchema, createEnum, createComments, createPosts].join(
				"\n\n",
			),
		);
	});

	it("returns hasChanges: false and an empty sql string when nothing changed", () => {
		const registry = createDefaultRegistry();
		const snapshot = buildSnapshot(declarations, registry, emptySnapshot);
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
			emptySnapshot,
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

	// D81 (#261): a renamed/dropped/moved column's *position* survives (or
	// doesn't) the same way its identity does — the oracle (`buildSnapshot`)
	// reads the same `renames`/`confirmedDrops` `generateMigration` already
	// validates.
	describe("column order across renames and drops (D81)", () => {
		it("keeps a renamed column in place and appends a newcomer behind it", () => {
			const v1 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						title: text(),
						archivedAt: timestamptz(),
					}),
				],
				previousSnapshot: emptySnapshot,
			});
			const v2 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						name: text(),
						description: text(),
						archivedAt: timestamptz(),
					}),
				],
				previousSnapshot: v1.snapshot,
				renames: [
					{
						target: "column",
						schemaName: "app",
						tableName: "projects",
						oldName: "title",
						newName: "name",
					},
				],
			});
			expect(
				(
					v2.snapshot.objects["table:app.projects"] as TableSnapshot
				).columns.map((c) => c.name),
			).toEqual(["id", "name", "archived_at", "description"]);
			expect(v2.sql).toContain('rename column "title" to "name"');
			expect(v2.sql).toContain('add column "description" text');
		});

		// D81 review fix (#277): the same rename combination end to end — a
		// table rename and a column rename in one run — through the full
		// generate pipeline (not just the oracle unit). The column-rename
		// spec's `tableName` is the table's *old* name ("items"), matching
		// what `--rename app.items.title=name` actually parses to (D81
		// review: `ColumnRenameSpec.tableName` is always old-table-relative,
		// resolved through rename-plan.ts's `tableNameByOldKey`).
		it("keeps a renamed column in place on a table renamed in the same run", () => {
			const v1 = generateMigration({
				declarations: [
					app,
					table(app, "items", {
						id: uuid(),
						title: text(),
						archivedAt: timestamptz(),
					}),
				],
				previousSnapshot: emptySnapshot,
			});
			const v2 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						name: text(),
						archivedAt: timestamptz(),
					}),
				],
				previousSnapshot: v1.snapshot,
				renames: [
					{
						target: "table",
						schemaName: "app",
						oldName: "items",
						newName: "projects",
					},
					{
						target: "column",
						schemaName: "app",
						tableName: "items",
						oldName: "title",
						newName: "name",
					},
				],
			});
			expect(
				(
					v2.snapshot.objects["table:app.projects"] as TableSnapshot
				).columns.map((c) => c.name),
			).toEqual(["id", "name", "archived_at"]);
			expect(v2.sql).toContain('rename column "title" to "name"');
		});

		it("appends a newcomer at the end after a confirmed drop+add pair", () => {
			const v1 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						title: text(),
						archivedAt: timestamptz(),
					}),
				],
				previousSnapshot: emptySnapshot,
			});
			const v2 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						archivedAt: timestamptz(),
						summary: text(),
					}),
				],
				previousSnapshot: v1.snapshot,
				confirmedDrops: [
					{
						target: "column",
						schemaName: "app",
						tableName: "projects",
						columnName: "title",
					},
				],
			});
			expect(
				(
					v2.snapshot.objects["table:app.projects"] as TableSnapshot
				).columns.map((c) => c.name),
			).toEqual(["id", "archived_at", "summary"]);
			expect(v2.sql).toContain('drop column "title"');
			expect(v2.sql).toContain('add column "summary" text');
		});

		it("a column that moves to a different table lands last in its new table", () => {
			const v1 = generateMigration({
				declarations: [
					app,
					table(app, "a", { id: uuid(), moved: text(), x: text() }),
					table(app, "b", { id: uuid(), y: text() }),
				],
				previousSnapshot: emptySnapshot,
			});
			const v2 = generateMigration({
				declarations: [
					app,
					table(app, "a", { id: uuid(), x: text() }),
					table(app, "b", { id: uuid(), y: text(), moved: text() }),
				],
				previousSnapshot: v1.snapshot,
			});
			expect(
				(v2.snapshot.objects["table:app.a"] as TableSnapshot).columns.map(
					(c) => c.name,
				),
			).toEqual(["id", "x"]);
			expect(
				(v2.snapshot.objects["table:app.b"] as TableSnapshot).columns.map(
					(c) => c.name,
				),
			).toEqual(["id", "y", "moved"]);
		});

		// D81/golden `column-insert-mid`: a brand-new project declaring the
		// widest (final) TypeScript shape directly from an empty snapshot
		// gets *declaration* order, not the physical order an incremental
		// migration chain to that same shape would have produced (the
		// golden case's own `from-empty.sql` only ever sees 3 columns, since
		// its first step is the narrowest declaration — this is the
		// "different but equally valid physical order" case D81's decision
		// log calls out, covered here instead).
		it("a fresh build of the widest declaration gets declaration order, not the incremental chain's physical order", () => {
			const projects = table(app, "projects", {
				id: uuid(),
				title: text(),
				description: text(),
				level: integer(),
				archivedAt: timestamptz(),
				note: text(),
			});
			const archiveProject = defineFunction(
				"app",
				"archive_project",
				{ args: { projectId: uuid() }, returns: projects },
				(ctx, { projectId }) => {
					ctx.return(
						update(projects)
							.set({ archivedAt: now() })
							.where(eq(projects.id, projectId))
							.returning(),
					);
				},
			);
			const result = generateMigration({
				declarations: [app, projects, archiveProject],
				previousSnapshot: emptySnapshot,
			});
			expect(
				(
					result.snapshot.objects["table:app.projects"] as TableSnapshot
				).columns.map((c) => c.name),
			).toEqual(["id", "title", "description", "level", "archived_at", "note"]);
			expect(result.sql).toContain(
				'"id" uuid,\n\t"title" text,\n\t"description" text,\n\t"level" integer,\n\t"archived_at" timestamp with time zone,\n\t"note" text',
			);
			expect(result.sql).toContain(
				'returning "id", "title", "description", "level", "archived_at", "note"',
			);
		});

		// D81 (dogfood first pass, #261 variant): when the mid-inserted
		// column shares a SQL type with the columns around it (here, both
		// `note` and the inserted `description` are `text`), `returns
		// setof <table>` doesn't error at all — Postgres accepts the
		// positional match silently and returns each value under the
		// *wrong* column name (`note`'s value would read back as
		// `description`, `description` as nothing). The type-mismatch case
		// (D81's original repro) at least fails loudly; this one doesn't,
		// so it's pinned on its own.
		it("orders a same-type column inserted mid-declaration behind the existing ones so returning lists cannot silently mislabel values (d81)", () => {
			const v1 = generateMigration({
				declarations: [
					app,
					table(app, "projects", {
						id: uuid(),
						title: text(),
						note: text(),
					}),
				],
				previousSnapshot: emptySnapshot,
			});
			const projectsV2 = table(app, "projects", {
				id: uuid(),
				title: text(),
				description: text(),
				note: text(),
			});
			const archiveProjectV2 = defineFunction(
				"app",
				"archive_project",
				{ args: { projectId: uuid() }, returns: projectsV2 },
				(ctx, { projectId }) => {
					ctx.return(
						update(projectsV2)
							.set({ title: "x" })
							.where(eq(projectsV2.id, projectId))
							.returning(),
					);
				},
			);
			const v2 = generateMigration({
				declarations: [app, projectsV2, archiveProjectV2],
				previousSnapshot: v1.snapshot,
			});
			expect(
				(
					v2.snapshot.objects["table:app.projects"] as TableSnapshot
				).columns.map((c) => c.name),
			).toEqual(["id", "title", "note", "description"]);
			expect(v2.sql).toContain(
				'returning "id", "title", "note", "description"',
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
				'\tconstraint "posts_pkey" primary key ("id")\n' +
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
	// Postgres for both). sequenceKind's own `drop default`/`drop sequence`
	// statements go out on the `predrop` stage (see sequence-kind.ts),
	// which always runs before every kind's `main`-stage statements
	// (generate.ts) -- so they always run *before* the table's own
	// `drop table`/`drop column`, structurally ahead of the cascade rather
	// than racing it. This three-point matrix pins the resulting statement
	// *order*: table drop and column drop both put the sequence's own
	// statements first, while a type transition that leaves the column
	// alive (serial() -> integer(), already covered above) keeps emitting
	// the same bare drop statements, just via the same predrop-first order.
	describe("#193: a sequence drop always clears before the cascade that could remove it", () => {
		it("dropping the whole table: drop default + drop sequence (predrop) before drop table (main)", () => {
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
			const dropDefaultIndex = result.sql.indexOf("drop default");
			const dropSequenceIndex = result.sql.indexOf("drop sequence");
			const dropTableIndex = result.sql.indexOf("drop table");
			expect(dropDefaultIndex).toBeGreaterThan(-1);
			expect(dropSequenceIndex).toBeGreaterThan(dropDefaultIndex);
			expect(dropTableIndex).toBeGreaterThan(dropSequenceIndex);
		});

		it("dropping just the serial column: drop default + drop sequence (predrop) before drop column (main)", () => {
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
			const dropDefaultIndex = result.sql.indexOf("drop default");
			const dropSequenceIndex = result.sql.indexOf("drop sequence");
			const dropColumnIndex = result.sql.indexOf("drop column");
			expect(dropDefaultIndex).toBeGreaterThan(-1);
			expect(dropSequenceIndex).toBeGreaterThan(dropDefaultIndex);
			expect(dropColumnIndex).toBeGreaterThan(dropSequenceIndex);
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

		// #154 ratchet-5: sortPredropStatements's identity tiebreak (two
		// predrop statements at the *same* kind-dependency rank, ordered by
		// compareKeys(a.change.identity, b.change.identity) rather than
		// encounter order) had no test of its own -- every case above drops
		// exactly one sequence, so the tiebreak branch never had two same-rank
		// entries to actually choose between. Dropping two serial columns at
		// once puts two "sequence"-kind predrop entries at the identical
		// rank; bValue is declared first, so encounter order alone would put
		// posts_b_value_seq ahead of posts_a_value_seq -- the identity
		// tiebreak is what puts them the other way around. diffSnapshots
		// already sorts changes by identity within a kind, so this branch
		// isn't reachable through a red-first mutation of the tiebreak itself
		// (the upstream sort produces the same final order either way) --
		// this test pins the observable order instead of proving the branch
		// load-bearing by mutation.
		it("two same-rank predrop statements (two dropped sequences) are ordered by identity, not declaration order", () => {
			const seqApp = schema("app");
			const before = table(seqApp, "posts", {
				id: uuid().primaryKey(),
				bValue: serial(),
				aValue: serial(),
			});
			const previous = generateMigration({
				declarations: [seqApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(seqApp, "posts", { id: uuid().primaryKey() });
			const result = generateMigration({
				declarations: [seqApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			const aIndex = result.sql.indexOf(
				'drop sequence "app"."posts_a_value_seq"',
			);
			const bIndex = result.sql.indexOf(
				'drop sequence "app"."posts_b_value_seq"',
			);
			expect(aIndex).toBeGreaterThan(-1);
			expect(bIndex).toBeGreaterThan(-1);
			expect(aIndex).toBeLessThan(bIndex);
		});

		// #154 ratchet-5, reviewer-2 finding: sortPredropStatements's
		// descending rank ordering (rankOf(b) - rankOf(a), #122's "a
		// dependent kind's drop must clear before the kind it depends on is
		// altered") had no test spanning two *different* kinds' predrop
		// statements -- every case above predrops only "sequence"-kind
		// entries, so a sign flip on the rank comparison alone (all 729 core
		// tests stay green) never surfaced. A policy's role changing (still
		// alive, but re-created) and a serial-to-uuid column type change in
		// the same migration both contribute a predrop statement: "policy"
		// depends (transitively, via "table") on "sequence", so it ranks
		// higher and must drop first.
		it("predrops a higher-rank kind (policy) before a lower-rank one (sequence) it transitively depends on (#122)", () => {
			const rankApp = schema("app");
			const before = table(
				rankApp,
				"posts",
				{ id: serial().primaryKey(), title: text() },
				() => ({
					rls: rls.enabled({
						read: rls.policy("p").for("select").to("anon").using(literal(true)),
					}),
				}),
			);
			const previous = generateMigration({
				declarations: [rankApp, before],
				previousSnapshot: emptySnapshot,
			}).snapshot;
			const after = table(
				rankApp,
				"posts",
				{ id: uuid().primaryKey(), title: text() },
				() => ({
					rls: rls.enabled({
						read: rls
							.policy("p")
							.for("select")
							.to("authenticated")
							.using(literal(true)),
					}),
				}),
			);
			const result = generateMigration({
				declarations: [rankApp, after],
				previousSnapshot: previous,
			});
			expect(result.errors).toEqual([]);
			const policyDropIndex = result.sql.indexOf('drop policy "p"');
			const sequenceDropIndex = result.sql.indexOf(
				'drop sequence "app"."posts_id_seq"',
			);
			expect(policyDropIndex).toBeGreaterThan(-1);
			expect(sequenceDropIndex).toBeGreaterThan(-1);
			expect(policyDropIndex).toBeLessThan(sequenceDropIndex);
		});
	});
});

describe("raw table declarations expand like whole tables (#408)", () => {
	it("a TableDeclaration input emits rls, policies, and serial sequences too", () => {
		const app = schema("gen408");
		const guarded = table(
			app,
			"guarded",
			{
				id: serial().primaryKey(),
				viewCount: integer().notNull(),
			},
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("read_low")
						.for("select")
						.to("r408")
						.using(sql`${t.viewCount} < 100`),
				}),
			}),
		);
		const viaTable = generateMigration({
			declarations: [app, guarded],
			previousSnapshot: emptySnapshot,
		});
		const viaMeta = generateMigration({
			declarations: [app, getTableMeta(guarded)],
			previousSnapshot: emptySnapshot,
		});
		// the two supported input forms must be EQUIVALENT -- before #408
		// the raw declaration silently dropped rls/policies/sequences.
		expect(viaMeta.sql).toBe(viaTable.sql);
		expect(JSON.stringify(viaMeta.snapshot)).toBe(
			JSON.stringify(viaTable.snapshot),
		);
		expect(viaMeta.warnings).toEqual(viaTable.warnings);
		expect(viaMeta.sql).toContain("enable row level security");
		expect(viaMeta.sql).toContain('create policy "read_low"');
	});

	it("an existingTable meta produces no migration through the raw path too (add-unmanaged-objects)", () => {
		const app = schema("gen408b");
		// The schema itself already exists (a prior run) -- isolates this
		// assertion to the existing table's own contribution.
		const baseline = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		const ref = existingTable("gen408b", "elsewhere", { id: uuid() });
		const result = generateMigration({
			declarations: [app, getTableMeta(ref)],
			previousSnapshot: baseline.snapshot,
		});
		expect(result.hasChanges).toBe(false);
		expect(result.sql).toBe("");
		expect(result.snapshot.objects["table:gen408b.elsewhere"]).toMatchObject({
			existing: true,
		});
	});
});

describe("an existing declaration emits nothing (add-unmanaged-objects, #605)", () => {
	it("an existing table produces no migration", () => {
		const app = schema("uo1");
		// The schema itself already exists (a prior run) -- isolates this
		// assertion to the existing table's own contribution, which must
		// be zero.
		const baseline = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		const authUsers = existingTable("uo1", "users", { id: uuid() });
		const result = generateMigration({
			declarations: [app, getTableMeta(authUsers)],
			previousSnapshot: baseline.snapshot,
		});
		expect(result.hasChanges).toBe(false);
		expect(result.sql).toBe("");
		expect(result.snapshot.objects["table:uo1.users"]).toMatchObject({
			existing: true,
			columns: [expect.objectContaining({ name: "id" })],
		});
	});

	// D106 R3, J14: `hasChanges` ("is there DDL") and `snapshotChanged`
	// ("does the snapshot differ from previousSnapshot at all") are two
	// facts, not one -- a run that only moves an existing-table marker
	// has to report `hasChanges: false` (nothing to diff into a
	// statement) while still reporting `snapshotChanged: true` (R3-B1's
	// own zero-statement migration exists to anchor exactly this case in
	// the chain). A caller that could only read `hasChanges` before this
	// field existed had no way to tell the two apart.
	it("generateMigrations states hasChanges and snapshotChanged separately (D106 R3, J14)", () => {
		const app = schema("uo1d");
		const baseline = generateMigrations({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		const repeat = generateMigrations({
			declarations: [app],
			previousSnapshot: baseline.snapshot,
		});
		expect(repeat.hasChanges).toBe(false);
		expect(repeat.snapshotChanged).toBe(false);
		expect(repeat.migrations).toEqual([]);

		const authUsers = existingTable("uo1d", "users", { id: uuid() });
		const withMarker = generateMigrations({
			declarations: [app, getTableMeta(authUsers)],
			previousSnapshot: baseline.snapshot,
		});
		expect(withMarker.hasChanges).toBe(false);
		expect(withMarker.snapshotChanged).toBe(true);
		expect(withMarker.migrations).toHaveLength(1);
		expect(withMarker.migrations[0]?.changes).toEqual([]);
	});

	// D106 R1, B1: `existingTable()` accepts any column builder, including
	// serial-family ones -- `resolveTableDeclarations` used to synthesize
	// that column's backing sequence (and, had `.rls` been set, its
	// policies too) for *any* table declaration, with no `meta.existing`
	// guard of its own. The fixture is the evaluator's own reproduction
	// (evaluation.md), replayed here as a pin.
	it("an existing table with a serial-family column produces no migration (D106 R1, B1)", () => {
		const app = schema("uo1b");
		const baseline = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		const legacy = existingTable("uo1b", "legacy", {
			id: serial(),
			name: text(),
		});
		const result = generateMigration({
			declarations: [app, getTableMeta(legacy)],
			previousSnapshot: baseline.snapshot,
		});
		expect(result.hasChanges).toBe(false);
		expect(result.sql).toBe("");
		expect(
			result.snapshot.objects["sequence:uo1b.legacy_id_seq"],
		).toBeUndefined();
	});

	// D106 R1, B1 removal: the scenario's own removal clause ("a later run
	// with the declaration changed or removed writes no migration
	// either") fails the identical way in evaluation.md's reproduction --
	// a synthesized sequence that should never have existed still had to
	// be dropped. Pinned so a fix that stops synthesizing the sequence
	// going forward, but forgets that one might already be sitting in an
	// older snapshot, can't pass silently.
	it("removing an existing table with a serial-family column produces no migration (D106 R1, B1 removal)", () => {
		const app = schema("uo1c");
		const baseline = generateMigration({
			declarations: [app],
			previousSnapshot: emptySnapshot,
		});
		const legacy = existingTable("uo1c", "legacy", {
			id: serial(),
			name: text(),
		});
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(legacy)],
			previousSnapshot: baseline.snapshot,
		});
		const secondResult = generateMigration({
			declarations: [app],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
	});

	it("changing an existing declaration produces no migration", () => {
		const app = schema("uo2");
		const first = existingTable("uo2", "users", { id: uuid() });
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(first)],
			previousSnapshot: emptySnapshot,
		});
		const changed = existingTable("uo2", "users", {
			id: uuid(),
			email: text(),
		});
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(changed)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(secondResult.snapshot.objects["table:uo2.users"]).toMatchObject({
			existing: true,
			columns: [
				expect.objectContaining({ name: "id" }),
				expect.objectContaining({ name: "email" }),
			],
		});
	});

	it("removing an existing declaration produces no migration", () => {
		const app = schema("uo3");
		const authUsers = existingTable("uo3", "users", { id: uuid() });
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(authUsers)],
			previousSnapshot: emptySnapshot,
		});
		const secondResult = generateMigration({
			declarations: [app],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(secondResult.sql).not.toContain("drop table");
	});

	it("a managed foreign key onto an existing table is emitted and the target untouched", () => {
		const app = schema("uo4");
		const authUsers = existingTable("uo4", "users", { id: uuid() });
		const profiles = table(
			app,
			"profiles",
			{ id: uuid().primaryKey(), userId: uuid().notNull() },
			(t) => ({
				foreignKeys: [
					{
						columns: [t.userId],
						references: { table: authUsers, columns: [authUsers.id] },
					},
				],
			}),
		);
		const result = generateMigration({
			declarations: [app, getTableMeta(authUsers), profiles],
			previousSnapshot: emptySnapshot,
		});
		expect(result.sql).toContain('references "uo4"."users"');
		expect(result.sql).not.toContain('create table "uo4"."users"');
		expect(result.snapshot.objects["table:uo4.users"]).toMatchObject({
			existing: true,
		});
	});

	it("a table changing hands emits nothing: managed to existing", () => {
		const app = schema("uo5");
		const managed = table(app, "widgets", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [app, managed],
			previousSnapshot: emptySnapshot,
		});
		const existing = existingTable("uo5", "widgets", {
			id: uuid().primaryKey(),
		});
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(existing)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(secondResult.snapshot.objects["table:uo5.widgets"]).toMatchObject({
			existing: true,
		});
	});

	it("a table changing hands emits nothing: existing to managed", () => {
		const app = schema("uo6");
		const existing = existingTable("uo6", "widgets", {
			id: uuid().primaryKey(),
		});
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(existing)],
			previousSnapshot: emptySnapshot,
		});
		const managed = table(app, "widgets", { id: uuid().primaryKey() });
		const secondResult = generateMigration({
			declarations: [app, managed],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(
			secondResult.snapshot.objects["table:uo6.widgets"],
		).not.toHaveProperty("existing");
	});

	// D106 R1, B2: the two tests above use a bare table (no RLS, no
	// policy, no serial column) — exactly the shape the evaluator found
	// "cannot reach the fan-out" (evaluation.md's own test-gap note).
	// These replay the evaluator's own reproduction fixture (RLS + one
	// policy + a `serial()` primary key) on both handover directions.
	it("a table changing hands emits nothing, including what it fans out into: managed (with RLS, a policy, and a serial column) to existing", () => {
		const app = schema("uo7");
		const managed = table(
			app,
			"widgets",
			{ id: serial().primaryKey() },
			() => ({
				rls: rls.enabled({
					readLow: rls
						.policy("read_low")
						.for("select")
						.to("anon")
						.using(literal(true)),
				}),
			}),
		);
		const firstResult = generateMigration({
			declarations: [app, managed],
			previousSnapshot: emptySnapshot,
		});
		const existing = existingTable("uo7", "widgets", {
			id: uuid().primaryKey(),
		});
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(existing)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(secondResult.snapshot.objects["table:uo7.widgets"]).toMatchObject({
			existing: true,
		});
	});

	it("an adopted table gains what the declaration manages: existing to managed (with RLS, a policy, and a serial column)", () => {
		const app = schema("uo8");
		const existing = existingTable("uo8", "widgets", {
			id: uuid().primaryKey(),
		});
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(existing)],
			previousSnapshot: emptySnapshot,
		});
		const managed = table(
			app,
			"widgets",
			{ id: serial().primaryKey() },
			() => ({
				rls: rls.enabled({
					readLow: rls
						.policy("read_low")
						.for("select")
						.to("anon")
						.using(literal(true)),
				}),
			}),
		);
		const secondResult = generateMigration({
			declarations: [app, managed],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		// No `create table` -- the table itself already exists. D106 R2's
		// own mutant (table-kind.ts's guard weakened to `next`-only,
		// matching the fan-out rule) measured that removing this half
		// doesn't leak a `create table` at all -- both sides being
		// present routes to the ALTER path instead -- so this line alone
		// is not what proves the table needs its own bidirectional guard;
		// the next line is.
		expect(secondResult.sql).not.toContain("create table");
		// The measured failure mode of that same mutant: an existing
		// declaration's own (unrelated) column shape gets diffed against
		// the managed declaration's, producing a spurious `alter column
		// … type …` -- arguably worse than a duplicate create, since nothing
		// about it looks wrong at a glance. The table's own bidirectional
		// guard exists specifically so the two declarations' shapes are
		// never compared to each other at all.
		expect(secondResult.sql).not.toContain('alter column "id" type');
		// ...but everything hejbro now manages ON that table is created as
		// it would be for any managed table -- this is the half of the
		// judgement that isn't "nothing": adoption is not silent about
		// what the declaration asks for.
		expect(secondResult.sql).toContain("create sequence");
		expect(secondResult.sql).toContain("enable row level security");
		expect(secondResult.sql).toContain("create policy");
		expect(
			secondResult.snapshot.objects["table:uo8.widgets"],
		).not.toHaveProperty("existing");
	});

	// D106 R1-04/R1-05: `existingTable()`'s own column list is a partial
	// claim, not a complete description -- `authUsers` declares only
	// `{id, email}`, not the platform's real full row shape. uo7/uo8
	// above use identical columns on both sides of the handover, which
	// is exactly the shape evaluation.md flagged for the pre-existing
	// `generate.test.ts:920-955` pins: it "cannot reach" a diff between
	// two genuinely different column lists for the same table identity.
	// These two replay uo7/uo8 with the lead's own fixture (existing
	// declares only `id`; managed declares `id`, `email`, `createdAt`,
	// plus RLS/a policy/a serial column) so the table's own column diff
	// has something real to (wrongly) find if the guard doesn't hold —
	// an `alter table` of any shape (`add column` on adoption, `drop
	// column` on handover) would mean the two declarations' shapes got
	// compared to each other, which must never happen for a table on
	// either side of an existing marker.
	const buildPartialWidgets = (
		schemaName: string,
	): {
		readonly app: ReturnType<typeof schema>;
		readonly existingPartial: ReturnType<typeof existingTable>;
		readonly managedFull: ReturnType<typeof table>;
	} => {
		const app = schema(schemaName);
		const existingPartial = existingTable(schemaName, "widgets", {
			id: uuid(),
		});
		const managedFull = table(
			app,
			"widgets",
			{
				id: serial().primaryKey(),
				email: text(),
				createdAt: timestamptz(),
			},
			() => ({
				rls: rls.enabled({
					readLow: rls
						.policy("read_low")
						.for("select")
						.to("anon")
						.using(literal(true)),
				}),
			}),
		);
		return { app, existingPartial, managedFull };
	};

	it("a table changing hands emits nothing, even when the existing declaration's own column list is a partial claim: managed (full columns, RLS, a policy, a serial column) to existing (id only)", () => {
		const { app, existingPartial, managedFull } = buildPartialWidgets("uo9");
		const firstResult = generateMigration({
			declarations: [app, managedFull],
			previousSnapshot: emptySnapshot,
		});
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(existingPartial)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		// Handover is silence in full, the same as uo7's bare-column
		// case: the table's own guard suppresses its own diff, and
		// `ownerIsExisting` (`diff-engine.ts`) suppresses the fan-out
		// objects' drops -- nothing for either declaration's column list
		// to be compared against, in either direction, so there is
		// nothing at all to emit.
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
		expect(secondResult.snapshot.objects["table:uo9.widgets"]).toMatchObject({
			existing: true,
		});
	});

	it("an adopted table gains what the declaration manages, even when the existing declaration's own column list is a partial claim: existing (id only) to managed (full columns, RLS, a policy, a serial column)", () => {
		const { app, existingPartial, managedFull } = buildPartialWidgets("uo10");
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(existingPartial)],
			previousSnapshot: emptySnapshot,
		});
		const secondResult = generateMigration({
			declarations: [app, managedFull],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		// Deliberately asymmetric with uo9's own `sql === ""`: adoption
		// legitimately DOES emit `alter table "uo10"."widgets"`
		// lines -- enabling RLS and wiring the new sequence's own
		// default are both real `alter table` statements, the fan-out
		// objects' own creation DDL, not a diff of the table's structure.
		// The guarantee under test is narrower and precise: no statement
		// that could only come from comparing the two declarations'
		// column lists to each other -- no `add column` (what a naive
		// diff would infer for `email`/`createdAt`, present in `managed`
		// but absent from the existing declaration's own partial list),
		// no `drop column`, no `alter column ... type` (uo8's own
		// probed-and-found leak, D106 R1-03).
		expect(secondResult.sql).not.toContain("add column");
		expect(secondResult.sql).not.toContain("drop column");
		expect(secondResult.sql).not.toContain('alter column "id" type');
		// ...but the objects hejbro now manages ON that table are still
		// created normally -- the two contracts (table: bidirectional
		// silence; fan-out: `next`-only) both hold in the same run.
		expect(secondResult.sql).toContain("create sequence");
		expect(secondResult.sql).toContain("enable row level security");
		expect(secondResult.sql).toContain("create policy");
		expect(
			secondResult.snapshot.objects["table:uo10.widgets"],
		).not.toHaveProperty("existing");
	});

	// D106 R2, R2-B1: `planRenames` runs before `diffSnapshots`, entirely
	// outside the table guard (`table-kind.ts:636`) and the fan-out rule
	// (`diff-engine.ts`'s `ownerIsExisting`) alike -- it built its own
	// working sets from every `table:` entry, with no existence filter
	// of its own, so it both refused otherwise-valid runs and prescribed
	// `alter table … rename …` against tables hejbro does not own. Four
	// tests replay the evaluator's own reproductions (A-D) verbatim.

	it("changing an existing declaration's own column name produces no migration and no rename ambiguity (D106 R2, R2-B1 repro A)", () => {
		const app = schema("c1");
		const first = existingTable("c1", "users", { id: uuid(), name: text() });
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(first)],
			previousSnapshot: emptySnapshot,
		});
		const changed = existingTable("c1", "users", {
			id: uuid(),
			title: text(),
		});
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(changed)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
	});

	it("renaming an existing declaration itself produces no migration and no rename ambiguity (D106 R2, R2-B1 repro B)", () => {
		const app = schema("e2");
		const first = existingTable("e2", "old_name", { id: uuid() });
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(first)],
			previousSnapshot: emptySnapshot,
		});
		const renamed = existingTable("e2", "new_name", { id: uuid() });
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(renamed)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.hasChanges).toBe(false);
		expect(secondResult.sql).toBe("");
	});

	it("removing an existing declaration never poisons an unrelated managed table added in the same run (D106 R2, R2-B1 repro C)", () => {
		const app = schema("e4");
		const legacy = existingTable("e4", "legacy", { id: uuid() });
		const firstResult = generateMigration({
			declarations: [app, getTableMeta(legacy)],
			previousSnapshot: emptySnapshot,
		});
		const fresh = table(app, "fresh", { id: uuid().primaryKey() });
		const secondResult = generateMigration({
			declarations: [app, fresh],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.sql).toContain('create table "e4"."fresh"');
		expect(secondResult.sql.toLowerCase()).not.toContain("legacy");
	});

	// D106 R2's own repro D read this as "a genuine, ordinary drop,
	// untouched by rename detection" -- correct DDL-wise (an existing
	// declaration never gets a `create table`), but silent about a real
	// hazard #703 restores: a managed table's own removal, paired with a
	// same-shaped existing declaration appearing under a different name
	// in the same schema and run, is exactly the shape a genuine
	// `--rename` would also produce. Recorded here as the closed
	// version of R2-B1's own repro D (#703, R5's own rename-guard piece).
	it("a managed table replaced by a same-shaped existing declaration is an ambiguous rename, not a silent drop (D106 R2/#703, R2-B1 repro D closed)", () => {
		const app = schema("e3");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
		});
		const gadgets = existingTable("e3", "gadgets", { id: uuid() });
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(gadgets)],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toHaveLength(1);
		expect(secondResult.errors[0]).toMatchObject({
			code: "ambiguous-table-rename",
		});
		// #703: the prescribed remedy must never suggest rerunning THIS
		// generate with --rename e3.widgets=gadgets as if it would apply
		// as-is -- that flag targets an existingTable() and the guard
		// above refuses it too, the exact "the remedy is the command that
		// just failed" shape D106 R5-B1 was filed against. The flag text
		// may still appear as step 1 of the two-run path (a legitimate,
		// different procedure), just never as a standalone "rerun with"
		// suggestion for the current declarations.
		expect(secondResult.errors[0]?.message).not.toContain(
			"rerun with `--rename e3.widgets=gadgets`",
		);
		expect(secondResult.errors[0]?.message).toContain("two runs");
		expect(secondResult.errors[0]?.message).toContain(
			"--confirm-drop e3.widgets",
		);
		// No DDL at all fires without confirmation -- not the managed
		// table's drop, and never anything naming the existing declaration.
		expect(secondResult.sql).toBe("");
	});

	// #703: a --rename that targets an identity the ambiguity above just
	// refused isn't "unknown" the way a genuine typo is -- it's declared,
	// just not DDL-owned. `unknown-rename-target` is reused (no new code),
	// with a message that says so and names the two-step remedy.
	it("--rename refuses a target that's declared with existingTable(), naming the two-step remedy (#703)", () => {
		const app = schema("e3");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
		});
		const gadgets = existingTable("e3", "gadgets", { id: uuid() });
		const secondResult = generateMigration({
			declarations: [app, getTableMeta(gadgets)],
			previousSnapshot: firstResult.snapshot,
			renames: [
				{
					target: "table",
					schemaName: "e3",
					oldName: "widgets",
					newName: "gadgets",
				},
			],
		});
		// Two errors, not one: the flag itself is refused (below) AND the
		// underlying drop+add pair stays unresolved -- an invalid --rename
		// spec never consumes the pairing it failed to validate, so the
		// same ambiguity R2-B1 repro D's own test pins fires too.
		expect(secondResult.errors).toHaveLength(2);
		const targetError = secondResult.errors.find(
			(error) => error.code === "unknown-rename-target",
		);
		expect(targetError).toBeDefined();
		expect(targetError?.message).toContain("existingTable()");
		expect(targetError?.message).toContain("two runs");
		expect(
			secondResult.errors.some(
				(error) => error.code === "ambiguous-table-rename",
			),
		).toBe(true);
		expect(secondResult.sql).toBe("");
	});

	// #703: the safe way to do what the two tests above both refuse --
	// rename while both sides are still managed, THEN hand the renamed
	// table over to existingTable() in a later run. Both steps green.
	it("the two-step path -- rename while both managed, then hand over -- applies cleanly (#703)", () => {
		const app = schema("e3");
		const widgets = table(app, "widgets", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [app, widgets],
			previousSnapshot: emptySnapshot,
		});

		const gadgetsManaged = table(app, "gadgets", { id: uuid().primaryKey() });
		const secondResult = generateMigration({
			declarations: [app, gadgetsManaged],
			previousSnapshot: firstResult.snapshot,
			renames: [
				{
					target: "table",
					schemaName: "e3",
					oldName: "widgets",
					newName: "gadgets",
				},
			],
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.sql).toContain(
			'alter table "e3"."widgets" rename to "gadgets"',
		);

		const gadgetsExisting = existingTable("e3", "gadgets", { id: uuid() });
		const thirdResult = generateMigration({
			declarations: [app, getTableMeta(gadgetsExisting)],
			previousSnapshot: secondResult.snapshot,
		});
		expect(thirdResult.errors).toEqual([]);
		expect(thirdResult.sql).toBe("");
		expect(thirdResult.snapshot.objects["table:e3.gadgets"]).toMatchObject({
			existing: true,
		});
	});

	// D106 R3, R3-B2: repros A-D above all keep a table existing (or
	// managed) on *both* sides of the run they measure -- `excludeExisting`
	// filtered `previousTables`/`nextTables` independently, so those never
	// reached the one case a filter run per-map cannot see: a table
	// managed on one side and existing on the other (a handover or an
	// adoption), in a run that *also* adds or drops a different table in
	// that same schema. Two reproductions replay the evaluator's own α/β
	// verbatim.

	it("a handover in a run that also adds an unrelated managed table in the same schema is not an ambiguous rename (D106 R3, R3-B2 repro α)", () => {
		const s2 = schema("s2");
		const widgets = table(s2, "widgets", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [s2, widgets],
			previousSnapshot: emptySnapshot,
		});
		const handedOver = existingTable("s2", "widgets", { id: uuid() });
		const gizmos = table(s2, "gizmos", { id: uuid().primaryKey() });
		const secondResult = generateMigration({
			declarations: [s2, getTableMeta(handedOver), gizmos],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.sql).toContain('create table "s2"."gizmos"');
		expect(secondResult.sql.toLowerCase()).not.toContain("widgets");
	});

	it("an adoption in a run that also drops an unrelated managed table in the same schema is not an ambiguous rename (D106 R3, R3-B2 repro β)", () => {
		const s4 = schema("s4");
		const legacy = existingTable("s4", "legacy", { id: uuid() });
		const old = table(s4, "old", { id: uuid().primaryKey() });
		const firstResult = generateMigration({
			declarations: [s4, getTableMeta(legacy), old],
			previousSnapshot: emptySnapshot,
		});
		const adopted = table(s4, "legacy", { id: uuid().primaryKey() });
		const secondResult = generateMigration({
			declarations: [s4, adopted],
			previousSnapshot: firstResult.snapshot,
		});
		expect(secondResult.errors).toEqual([]);
		expect(secondResult.sql).toContain('drop table "s4"."old"');
		// The adoption itself never renames a managed declaration onto
		// `legacy`'s identity -- no statement issues `alter table ...
		// rename to "legacy"`, the collision R2-B1's own repro D named,
		// reached through the adoption door instead of the handover one.
		expect(secondResult.sql).not.toContain('rename to "legacy"');
	});
});

// #701/D3: a previous snapshot's set-shaped arrays (a table's indexes and
// checks, a policy's roles, a trigger's events) reach `generateMigrations`
// in a non-canonical order two ways -- a hand-written or on-disk previous
// written before this order was canonical, and declarations that simply
// list the same members in another order -- and neither must ever produce
// a migration on its own.
describe("generateMigrations — a non-canonical previous generates nothing (#701)", () => {
	const setApp = schema("set_order_app");
	/** `{ note: text() }` when requested, else `{}` (no ternary, this codebase's own compact-field convention). */
	const noteColumnField = (
		withNote: boolean,
	): { readonly note?: ReturnType<typeof text> } => {
		if (!withNote) {
			return {};
		}
		return { note: text() };
	};
	const buildDocs = (options?: { readonly note?: true }) =>
		table(
			setApp,
			"docs",
			{
				id: uuid().primaryKey(),
				ownerId: uuid(),
				title: text().notNull(),
				...noteColumnField(options?.note === true),
			},
			(t) => ({
				indexes: [
					index("docs_owner_id_idx").on(t.ownerId),
					index("docs_title_idx").on(t.title),
				],
				checks: [
					check("a_check", isNotNull(t.ownerId)),
					check("b_check", isNotNull(t.title)),
				],
				rls: rls.enabled({
					read: rls
						.policy("docs_read")
						.for("select")
						.to("admin", "reader")
						.using(literal(true)),
				}),
			}),
		);
	const docs = buildDocs();
	const docsTrigger = defineTrigger(
		docs,
		{
			name: "docs_audit",
			timing: "after",
			events: ["insert", "update"],
			forEach: "row",
		},
		(ctx, { new: row }) => {
			ctx.return(row);
		},
	);
	const declarations = [setApp, docs, docsTrigger];

	const canonicalSnapshot = generateMigrations({
		declarations,
		previousSnapshot: emptySnapshot,
	}).snapshot;

	/** Deep-clones `snapshot` and reverses every set-shaped array this scenario's own kinds carry -- simulating a file on disk written before #701's canonical order existed, never `buildSnapshot`'s own output as-is. */
	const asNonCanonical = (snapshot: Snapshot): Snapshot =>
		({
			...snapshot,
			objects: Object.fromEntries(
				Object.entries(snapshot.objects).map(([key, node]) => {
					const clone = structuredClone(node) as Record<string, unknown>;
					if (key.startsWith("policy:")) {
						clone.roles = [...(clone.roles as ReadonlyArray<string>)].reverse();
					}
					if (key.startsWith("trigger:")) {
						clone.events = [
							...(clone.events as ReadonlyArray<unknown>),
						].reverse();
					}
					if (key.startsWith("table:")) {
						clone.indexes = [
							...(clone.indexes as ReadonlyArray<unknown>),
						].reverse();
						if (clone.checks !== undefined) {
							clone.checks = [
								...(clone.checks as ReadonlyArray<unknown>),
							].reverse();
						}
					}
					return [key, clone];
				}),
			),
		}) as Snapshot;

	it("a hand-written, non-canonical previous against the same declarations generates nothing", () => {
		const previousSnapshot = asNonCanonical(canonicalSnapshot);
		const result = generateMigrations({ declarations, previousSnapshot });
		expect(result.migrations).toEqual([]);
		expect(result.hasChanges).toBe(false);
		expect(result.snapshotChanged).toBe(false);
	});

	it("declarations reordered against a canonical previous generates nothing", () => {
		const reorderedDocs = table(
			setApp,
			"docs",
			{
				id: uuid().primaryKey(),
				ownerId: uuid(),
				title: text().notNull(),
			},
			(t) => ({
				indexes: [
					index("docs_title_idx").on(t.title),
					index("docs_owner_id_idx").on(t.ownerId),
				],
				checks: [
					check("b_check", isNotNull(t.title)),
					check("a_check", isNotNull(t.ownerId)),
				],
				rls: rls.enabled({
					read: rls
						.policy("docs_read")
						.for("select")
						.to("reader", "admin")
						.using(literal(true)),
				}),
			}),
		);
		const reorderedTrigger = defineTrigger(
			reorderedDocs,
			{
				name: "docs_audit",
				timing: "after",
				events: ["update", "insert"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const result = generateMigrations({
			declarations: [setApp, reorderedDocs, reorderedTrigger],
			previousSnapshot: canonicalSnapshot,
		});
		expect(result.migrations).toEqual([]);
	});

	it("control: a non-canonical previous plus one added column generates only that column's statement, canonically", () => {
		const previousSnapshot = asNonCanonical(canonicalSnapshot);
		const withNote = buildDocs({ note: true });
		const withNoteTrigger = defineTrigger(
			withNote,
			{
				name: "docs_audit",
				timing: "after",
				events: ["insert", "update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		const result = generateMigrations({
			declarations: [setApp, withNote, withNoteTrigger],
			previousSnapshot,
		});
		expect(result.migrations).toHaveLength(1);
		const [migration] = result.migrations;
		if (migration === undefined) {
			throw new Error("expected one migration");
		}
		expect(migration.sql).toContain(
			'alter table "set_order_app"."docs" add column "note" text;',
		);
		expect(migration.sql).not.toContain("restate");
		expect(migration.sql).not.toContain("create policy");
		expect(migration.sql).not.toContain("create trigger");
		expect(migration.sql).not.toContain("create index");

		const tableNode = result.snapshot.objects[
			"table:set_order_app.docs"
		] as TableSnapshot;
		expect(tableNode.indexes.map((i) => i.name)).toEqual([
			"docs_owner_id_idx",
			"docs_title_idx",
		]);
		expect((tableNode.checks ?? []).map((c) => c.name)).toEqual([
			"a_check",
			"b_check",
		]);
	});
});
