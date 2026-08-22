import { describe, expect, it } from "vitest";
import { pgEnum } from "../src/dsl/pg-enum";
import { rls } from "../src/dsl/rls";
import { schema } from "../src/dsl/schema";
import { getTableMeta, table } from "../src/dsl/table";
import { generateMigration } from "../src/engine/generate";
import { literal } from "../src/expr/operators";
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
