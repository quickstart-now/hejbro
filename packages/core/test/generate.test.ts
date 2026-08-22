import { describe, expect, it } from "vitest";
import { defineFunction } from "../src/dsl/define-function";
import { pgEnum } from "../src/dsl/pg-enum";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { eq, literal, now } from "../src/expr/operators";
import { createDefaultRegistry } from "../src/kind/registry";
import type { TableSnapshot } from "../src/kinds/table-snapshot";
import { update } from "../src/query/mutate";
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
