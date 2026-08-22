import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, HejbroInput } from "../src";
import {
	buildSnapshot,
	check,
	createDefaultRegistry,
	defineView,
	desc,
	diffSnapshots,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	getTableMeta,
	gt,
	index,
	integer,
	isNotNull,
	isTable,
	planRenames,
	renderSnapshot,
	rls,
	schema,
	select,
	serial,
	table,
	text,
	uuid,
	varchar,
} from "../src";
import type { PolicySnapshot } from "../src/kinds/policy-kind";
import { policyUsing } from "../src/kinds/policy-kind";
import type { ViewSnapshot } from "../src/kinds/view-kind";
import { viewSelectSql } from "../src/kinds/view-kind";

const app = schema("app");
const registry = createDefaultRegistry();
// table() returns a column-ref proxy (D15); unwrap to its declaration the
// same way generate.ts's resolveDeclarations does before snapshotting.
const unwrap = (input: HejbroInput): HejbroDeclaration => {
	if (isTable(input)) {
		return getTableMeta(input);
	}
	return input;
};
const snap = (...decls: ReadonlyArray<HejbroInput>) =>
	buildSnapshot(decls.map(unwrap), registry);
const noDeclSites = new Map<string, string | null>();

describe("planRenames", () => {
	it("flags a same-table drop+add pair as ambiguous (rule A) with the owner-approved message verbatim", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "ambiguous-column-rename",
				message:
					'table "app.posts" has an ambiguous column change: column "slug" was dropped and column "handle" was added in the same generate run, and hejbro cannot tell whether this is a rename. Next: rerun with `--rename app.posts.slug=handle` (if this is a rename) or `--confirm-drop app.posts.slug` (if these are unrelated changes).',
			}),
		]);
		expect(plan.ambiguities).toEqual([
			{
				kind: "column",
				schemaName: "app",
				tableName: "posts",
				identity: "app.posts",
				dropped: ["slug"],
				added: ["handle"],
				declaredAt: null,
			},
		]);
	});

	it("flags a multi-pair ambiguous column change with the owner-approved multi-item message", () => {
		const previous = snap(
			app,
			table(app, "posts", { slug: text(), seoTitle: text() }),
		);
		const next = snap(
			app,
			table(app, "posts", { handle: text(), metaTitle: text() }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "ambiguous-column-rename",
				message:
					'table "app.posts" has an ambiguous column change: 2 columns were dropped ("seo_title", "slug") and 2 columns were added ("handle", "meta_title") in the same generate run, and hejbro cannot infer which pairs (if any) are renames. Next: resolve each dropped column with --rename or --confirm-drop and rerun — see the flags to add below.',
			}),
		]);
		expect(plan.ambiguities).toEqual([
			{
				kind: "column",
				schemaName: "app",
				tableName: "posts",
				identity: "app.posts",
				dropped: ["seo_title", "slug"],
				added: ["handle", "meta_title"],
				declaredAt: null,
			},
		]);
	});

	it("partial resolution: resolving one pair of a multi-pair ambiguity leaves only the residual pair exposed", () => {
		const previous = snap(
			app,
			table(app, "posts", { slug: text(), seoTitle: text() }),
		);
		const next = snap(
			app,
			table(app, "posts", { handle: text(), metaTitle: text() }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
		]);
		expect(plan.ambiguities).toEqual([
			{
				kind: "column",
				schemaName: "app",
				tableName: "posts",
				identity: "app.posts",
				dropped: ["seo_title"],
				added: ["meta_title"],
				declaredAt: null,
			},
		]);
	});

	it("a --rename spec resolves the pair into a RENAME statement", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
		]);
		// rewrittenPrevious now matches next → no further diff changes
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a --confirm-drop spec silences the ambiguity and keeps the drop", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { handle: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					columnName: "slug",
				},
			],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([]);
	});

	it("collects all ambiguities across tables in one run (batch)", () => {
		const previous = snap(
			app,
			table(app, "posts", { slug: text() }),
			table(app, "users", { nick: text() }),
		);
		const next = snap(
			app,
			table(app, "posts", { handle: text() }),
			table(app, "users", { alias: text() }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toHaveLength(2);
		expect(plan.ambiguities).toHaveLength(2);
		expect(plan.ambiguities.map((a) => a.kind)).toEqual(["column", "column"]);
	});

	it("table drop+create in one schema is ambiguous; --rename rewrites identity", () => {
		const previous = snap(app, table(app, "posts", { id: text() }));
		const next = snap(app, table(app, "blog_posts", { id: text() }));
		const ambiguous = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(ambiguous.errors).toEqual([
			expect.objectContaining({
				code: "ambiguous-table-rename",
				message:
					'schema "app" has an ambiguous table change: table "posts" was dropped and table "blog_posts" was created in the same generate run — a table rename recreates every column, index, foreign key, RLS policy, and trigger attached to it, so hejbro refuses to guess. Next: rerun with `--rename app.posts=blog_posts` (if this is a rename) or `--confirm-drop app.posts` (if these are unrelated tables).',
			}),
		]);
		expect(ambiguous.ambiguities).toEqual([
			{
				kind: "table",
				schemaName: "app",
				droppedTables: ["posts"],
				createdTables: ["blog_posts"],
				declaredAt: null,
			},
		]);
		const renamed = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "blog_posts",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(renamed.errors).toEqual([]);
		expect(renamed.renameStatements).toEqual([
			`alter table "app"."posts" rename to "blog_posts";`,
		]);
	});

	// #154 ratchet-5: ambiguousTableRenameMessage's exact-1:1 branch (above)
	// was the only one exercised -- the generic count-based fallback (2+
	// dropped or created tables in the same schema) never ran.
	it("2 tables dropped + 2 created in one schema uses the generic count-based ambiguity message", () => {
		const previous = snap(
			app,
			table(app, "posts", { id: text() }),
			table(app, "comments", { id: text() }),
		);
		const next = snap(
			app,
			table(app, "articles", { id: text() }),
			table(app, "replies", { id: text() }),
		);
		const ambiguous = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(ambiguous.errors).toEqual([
			expect.objectContaining({
				code: "ambiguous-table-rename",
				message:
					'schema "app" has an ambiguous table change: 2 tables were dropped ("comments", "posts") and 2 tables were created ("articles", "replies") in the same generate run — a table rename recreates every column, index, foreign key, RLS policy, and trigger attached to it, so hejbro refuses to guess. Next: resolve each dropped table with --rename or --confirm-drop and rerun — see the flags to add below.',
			}),
		]);
	});

	it("rename + type change yields RENAME plus a residual alter", () => {
		// previous: slug text; next: handle varchar(64) — after rewrite the
		// diff sees handle text→varchar, so emit produces the ALTER TYPE.
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(
			app,
			table(app, "posts", { handle: varchar({ length: 64 }) }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
		]);
		const changes = diffSnapshots(plan.rewrittenPrevious, next, registry);
		expect(changes).toEqual([
			expect.objectContaining({
				kind: "table",
				operation: "alter",
				identity: "app.posts",
				notes: [`column "handle" changed`],
			}),
		]);
	});

	it("renaming an indexed column also renames its derived index", () => {
		// previous: posts(slug text) + index on slug → posts_slug_idx
		// next: posts(handle text) + index on handle → posts_handle_idx
		// --rename app.posts.slug=handle ⇒ renameStatements are exactly:
		//   alter table "app"."posts" rename column "slug" to "handle";
		//   alter index "app"."posts_slug_idx" rename to "posts_handle_idx";
		// and diffSnapshots(plan.rewrittenPrevious, next, registry) is empty.
		const previous = snap(
			app,
			table(app, "posts", { slug: text() }, (t) => ({
				indexes: [index().on(t.slug)],
			})),
		);
		const next = snap(
			app,
			table(app, "posts", { handle: text() }, (t) => ({
				indexes: [index().on(t.handle)],
			})),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
			`alter index "app"."posts_slug_idx" rename to "posts_handle_idx";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("keeps desc/nulls on the renamed entry of an ordered index (D51)", () => {
		const previous = snap(
			app,
			table(app, "posts", { slug: text(), publishedAt: text() }, (t) => ({
				indexes: [index().on(t.slug, desc(t.publishedAt, { nulls: "first" }))],
			})),
		);
		const next = snap(
			app,
			table(app, "posts", { handle: text(), publishedAt: text() }, (t) => ({
				indexes: [
					index().on(t.handle, desc(t.publishedAt, { nulls: "first" })),
				],
			})),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		const rewrittenTable = plan.rewrittenPrevious.objects[
			"table:app.posts"
		] as {
			readonly indexes: ReadonlyArray<{
				readonly columns: ReadonlyArray<{
					readonly name: string;
					readonly desc?: true;
					readonly nulls?: string;
				}>;
			}>;
		};
		expect(rewrittenTable.indexes[0]?.columns).toEqual([
			{ name: "handle" },
			{ name: "published_at", desc: true, nulls: "first" },
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("unknown-rename-target when old is not dropped or new is not added", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { slug: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "unknown-rename-target",
				message:
					'--rename "app.posts.slug=handle" doesn\'t match this run: table "app.posts" has no dropped column named "slug" (or no added column named "handle"). Next: check both names for typos — --rename\'s left side must be a column this run drops, the right side a column this run adds.',
			}),
		]);
	});

	// The table-target counterpart of the column-target case just above --
	// validateTableRenameTarget's own branch (rename-plan.ts) had no direct
	// test before this one; every existing table-rename test only ever
	// exercised the valid path (both dropped and added true). This pins
	// "dropped, but nothing by the claimed new name was added" specifically
	// -- the exact shape an `&&`-to-`||` slip in that check would pass
	// silently (a residual --rename left over from an unrelated table
	// simply being dropped, not renamed, is the real scenario this guards
	// against).
	it("unknown-rename-target (table) when old is dropped but no table by the new name was added", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "unknown-rename-target",
				message:
					'--rename "app.posts=articles" doesn\'t match this run: schema "app" has no dropped table named "posts" (or no added table named "articles"). Next: check both names for typos — --rename\'s left side must be a table this run drops, the right side a table this run adds.',
			}),
		]);
	});

	it("duplicate-rename-target when two specs claim the same old or new", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "posts", { slug: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "alias",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({ code: "duplicate-rename-target" }),
		]);
	});

	it("duplicate-rename-target for two specs claiming the same new name (human-readable message)", () => {
		const previous = snap(
			app,
			table(app, "posts", { slug: text(), title: text() }),
		);
		const next = snap(
			app,
			table(app, "posts", { slug: text(), title: text() }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "title",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toHaveLength(1);
		const [error] = plan.errors;
		expect(error?.code).toBe("duplicate-rename-target");
		expect(error?.message).toContain('"app.posts.handle"');
		expect(error?.message).not.toContain(".new.");
	});

	it("M1: a table rename + a column rename on the same table combine into one migration", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "blog_posts", { handle: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "blog_posts",
				},
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename to "blog_posts";`,
			`alter table "app"."blog_posts" rename column "slug" to "handle";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("M1: a table-rename-only flag still surfaces the table's own column ambiguity", () => {
		const previous = snap(app, table(app, "posts", { slug: text() }));
		const next = snap(app, table(app, "blog_posts", { handle: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "blog_posts",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({ code: "ambiguous-column-rename" }),
		]);
	});

	it("preserves the compact snapshot format through a rewrite (D33) — no declaration-default keys reappear", () => {
		// posts.id has no notNull/primaryKey/unique/default set — its rewritten
		// node must stay exactly as compact as a freshly serialized one, and
		// the untouched sibling table's node must be byte-identical (object
		// spread, not reconstruction, is what rename-plan.ts must do).
		const previous = snap(
			app,
			table(app, "posts", { id: text(), slug: text() }),
			table(app, "users", { id: text() }),
		);
		const next = snap(
			app,
			table(app, "posts", { id: text(), handle: text() }),
			table(app, "users", { id: text() }),
		);
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		const rendered = renderSnapshot(plan.rewrittenPrevious);
		expect(rendered).not.toContain('"notNull"');
		expect(rendered).not.toContain('"primaryKey"');
		expect(rendered).not.toContain('"unique"');
		expect(rendered).not.toContain('"default"');
		// byte-identical to a freshly built snapshot of the post-rename state
		expect(rendered).toBe(renderSnapshot(next));
	});

	// #154 ratchet-5: every existing --confirm-drop test used target:
	// "column" -- target: "table" had zero coverage (neither the valid nor
	// the unknown-confirm-drop-target path).
	it("a --confirm-drop target: table spec silences a table drop+create ambiguity", () => {
		const previous = snap(app, table(app, "posts", { id: text() }));
		const next = snap(app, table(app, "articles", { id: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [
				{ target: "table", schemaName: "app", tableName: "posts" },
			],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
	});

	it("unknown-confirm-drop-target for a table this run does not drop", () => {
		const previous = snap(app, table(app, "posts", { title: text() }));
		const next = snap(app, table(app, "posts", { title: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [
				{ target: "table", schemaName: "app", tableName: "posts" },
			],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "unknown-confirm-drop-target",
				message:
					'--confirm-drop "app.posts" doesn\'t match this run: schema "app" has no dropped table named "posts". Next: check the name for typos — --confirm-drop\'s target must be a column (or table) this run actually drops.',
			}),
		]);
	});

	it("unknown-confirm-drop-target for a column this run does not drop", () => {
		const previous = snap(app, table(app, "posts", { title: text() }));
		const next = snap(app, table(app, "posts", { title: text() }));
		const plan = planRenames({
			previous,
			next,
			renames: [],
			confirmedDrops: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					columnName: "title",
				},
			],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([
			expect.objectContaining({
				code: "unknown-confirm-drop-target",
				message:
					'--confirm-drop "app.posts.title" doesn\'t match this run: table "app.posts" has no dropped column named "title". Next: check the name for typos — --confirm-drop\'s target must be a column (or table) this run actually drops.',
			}),
		]);
	});

	// #26: a malformed on-disk snapshot node reaching an unguarded internal
	// field access used to crash with a raw TypeError ("Cannot read
	// properties of undefined (reading 'map')" from computeTableColumnSets),
	// not a diagnostic. planRenames now wraps its whole body in
	// guardSnapshotRead, converting that crash into a malformed-snapshot-node
	// HejbroError that points at `hejbro verify` to tell a corrupted
	// snapshot apart from a hejbro bug (they're indistinguishable from here).
	it("wraps a raw crash from a malformed table node into malformed-snapshot-node, not a raw TypeError", () => {
		const previous = snap(app, table(app, "posts", { title: text() }));
		const corruptedPrevious = {
			...previous,
			objects: {
				...previous.objects,
				"table:app.posts": { schema: "app", name: "posts" }, // missing columns/indexes/foreignKeys
			},
		};
		const next = snap(app, table(app, "posts", { title: text() }));
		expect(() =>
			planRenames({
				previous: corruptedPrevious,
				next,
				renames: [],
				confirmedDrops: [],
				declaredAtByIdentity: noDeclSites,
			}),
		).toThrowError(
			expect.objectContaining({
				code: "malformed-snapshot-node",
				message: expect.stringContaining("hejbro verify"),
			}),
		);
	});
});

// #110 item 18: "measure first" -- proves the cross-table retargeting gap
// exists TODAY, before any expression-node work lands, using the exact
// pattern the DSL itself teaches (rls.ts:267's "reach other tables through
// exists()" guidance). A table's policy can `exists()` into another table;
// today expressions are pre-rendered strings at build time, so nothing
// rewrites that text on a rename -- this pins the current (broken) shape
// so the fix later in this PR has a before/after to point at.
describe("planRenames — cross-table exists() retargeting (#110, item 7/18)", () => {
	it("retargets a cross-table exists()-embedded policy reference on a table rename", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const comments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("comments_read_visible")
						.for("select")
						.to("anon")
						.using(exists(select(posts).where(eq(posts.id, t.postId)))),
				}),
			}),
		);
		// resolveDeclarations (generateMigration's own) is what expands a
		// table's rls/policies into the snapshot -- snap()/buildSnapshot
		// alone does not, so this test builds both snapshots via
		// generateMigration against an empty previous, matching how every
		// other RLS-bearing fixture in this codebase constructs one
		// (existing-table.test.ts, policy-kind.test.ts).
		const previous = generateMigration({
			declarations: [app, posts, comments],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;

		const renamedPosts = table(app, "articles", { id: uuid().primaryKey() });
		const renamedComments = table(
			app,
			"comments",
			{ id: uuid().primaryKey(), postId: uuid().notNull() },
			(t) => ({
				rls: rls.enabled({
					read: rls
						.policy("comments_read_visible")
						.for("select")
						.to("anon")
						.using(
							exists(select(renamedPosts).where(eq(renamedPosts.id, t.postId))),
						),
				}),
			}),
		);
		const next = generateMigration({
			declarations: [app, renamedPosts, renamedComments],
			previousSnapshot: emptySnapshot,
			registry,
		}).snapshot;

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);

		const policyNode =
			plan.rewrittenPrevious.objects[
				"policy:app.comments.comments_read_visible"
			];
		expect(policyNode).toBeDefined();

		// Fixed behavior (was broken before rewriteExpressionReferences
		// landed, see this file's git history and the PR body's
		// before/after): the policy's `using` -- a structured node
		// (D67/D70), decoded and rendered back to SQL text via the same
		// accessor emit uses -- follows the rename to "articles", even
		// though the policy itself is declared on a *different* table
		// (comments) and only reaches "posts" through exists().
		const usingSql = policyUsing(policyNode as PolicySnapshot);
		expect(usingSql).toContain('"articles"');
		expect(usingSql).not.toContain('"posts"');
	});
});

// #110 items 6/7: same-table retargeting -- the point D67 was adopted for.
// Proof shape matches the file's own existing convention (e.g. "a --rename
// spec resolves the pair into a RENAME statement" above): after a valid
// rename, rewrittenPrevious must diff to *no changes* against next -- any
// leftover stale identifier inside a default/check/where expression would
// show up as a spurious diff (a drop+add pair the rename should have
// prevented), which diffSnapshots would catch by comparing the two
// snapshots' full structural content (sameJson), not just field presence.
describe("planRenames — same-table expression retargeting (#110 items 6/7)", () => {
	it("a table rename retargets its own CHECK expression and partial index where predicate, with no leftover diff", () => {
		const buildPosts = (tableName: string) =>
			table(
				app,
				tableName,
				{ id: uuid().primaryKey(), price: integer(), publishedAt: uuid() },
				(t) => ({
					checks: [check("posts_price_check", gt(t.price, 0))],
					indexes: [
						index("posts_published_idx")
							.on(t.publishedAt)
							.where(isNotNull(t.publishedAt)),
					],
				}),
			);
		const previous = snap(app, buildPosts("posts"));
		const next = snap(app, buildPosts("articles"));

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename retargets a CHECK expression referencing that column, with no leftover diff", () => {
		const previous = snap(
			app,
			table(
				app,
				"posts",
				{ id: uuid().primaryKey(), price: integer() },
				(t) => ({
					checks: [check("posts_price_check", gt(t.price, 0))],
				}),
			),
		);
		const next = snap(
			app,
			table(
				app,
				"posts",
				{ id: uuid().primaryKey(), cost: integer() },
				(t) => ({
					checks: [check("posts_price_check", gt(t.cost, 0))],
				}),
			),
		);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "price",
					newName: "cost",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	// #154 ratchet-5: retargetForeignKeyReferenceColumn's two early-return
	// branches (a foreign key referencing a different table; a foreign key
	// referencing the same table but a different column) only run for real
	// when the *same* table has one foreign key that matches the rename and
	// at least one that doesn't -- rewriteForeignKeyReferenceColumn's own
	// table-level hasMatch guard skips a table with no matching foreign key
	// at all, so a single-foreign-key table can never exercise them. "orders"
	// below carries three, one per branch (including the happy path).
	it("a column rename retargets only the matching foreign key, leaving foreign keys to a different table or a different column untouched", () => {
		const previousPosts = table(app, "posts", {
			id: uuid().primaryKey(),
			slug: text(),
		});
		const previousUsers = table(app, "users", { id: uuid().primaryKey() });
		const previousOrders = table(
			app,
			"orders",
			{
				id: uuid().primaryKey(),
				postId: uuid().notNull(),
				userId: uuid().notNull(),
				postSlug: text().notNull(),
			},
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: previousPosts, columns: [previousPosts.id] },
					},
					{
						columns: [t.userId],
						references: { table: previousUsers, columns: [previousUsers.id] },
					},
					{
						columns: [t.postSlug],
						references: {
							table: previousPosts,
							columns: [previousPosts.slug],
						},
					},
				],
			}),
		);
		const previous = snap(app, previousPosts, previousUsers, previousOrders);

		const nextPosts = table(app, "posts", {
			pid: uuid().primaryKey(),
			slug: text(),
		});
		const nextUsers = table(app, "users", { id: uuid().primaryKey() });
		const nextOrders = table(
			app,
			"orders",
			{
				id: uuid().primaryKey(),
				postId: uuid().notNull(),
				userId: uuid().notNull(),
				postSlug: text().notNull(),
			},
			(t) => ({
				foreignKeys: [
					{
						columns: [t.postId],
						references: { table: nextPosts, columns: [nextPosts.pid] },
					},
					{
						columns: [t.userId],
						references: { table: nextUsers, columns: [nextUsers.id] },
					},
					{
						columns: [t.postSlug],
						references: { table: nextPosts, columns: [nextPosts.slug] },
					},
				],
			}),
		);
		const next = snap(app, nextPosts, nextUsers, nextOrders);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "id",
					newName: "pid",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});
});

// #157/D72: a view's own `query` is a structured SelectNode (D67/D70's
// codec, reused as-is) -- the same class of gap item 18 measured first for
// policies applies here too, so it's measured the same way: a real
// before/after through planRenames, not just unit coverage of
// retargetSelectNode in isolation (retarget.test.ts's own #157 loop
// already covers that; this proves the wiring in rename-plan.ts).
describe("planRenames — view query retargeting (#157/D72)", () => {
	it("a table rename retargets a view's own from/where, with no leftover diff", () => {
		const buildPosts = (tableName: string) =>
			table(app, tableName, {
				id: uuid().primaryKey(),
				publishedAt: uuid(),
			});
		const buildView = (postsTableName: string, viewTableName: string) => {
			const posts = buildPosts(postsTableName);
			return defineView(
				app,
				viewTableName,
				select(posts).where(isNotNull(posts.publishedAt)),
			);
		};

		const previous = snap(
			app,
			buildPosts("posts"),
			buildView("posts", "published_posts"),
		);
		const next = snap(
			app,
			buildPosts("articles"),
			buildView("articles", "published_posts"),
		);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);

		const viewNode = plan.rewrittenPrevious.objects[
			"view:app.published_posts"
		] as ViewSnapshot;
		expect(viewNode).toBeDefined();
		const selectSql = viewSelectSql(viewNode);
		expect(selectSql).toContain('"articles"');
		expect(selectSql).not.toContain('"posts"');
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename retargets a view's own where clause referencing that column, with no leftover diff", () => {
		const postsBefore = table(app, "posts", {
			id: uuid().primaryKey(),
			price: integer(),
		});
		const postsAfter = table(app, "posts", {
			id: uuid().primaryKey(),
			cost: integer(),
		});
		const viewBefore = defineView(
			app,
			"cheap_posts",
			select(postsBefore).where(gt(postsBefore.price, 0)),
		);
		const viewAfter = defineView(
			app,
			"cheap_posts",
			select(postsAfter).where(gt(postsAfter.cost, 0)),
		);

		const previous = snap(app, postsBefore, viewBefore);
		const next = snap(app, postsAfter, viewAfter);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "price",
					newName: "cost",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("returns the exact same view object reference when a rename doesn't touch it (cheap no-op check)", () => {
		const posts = table(app, "posts", { id: uuid().primaryKey() });
		const otherTable = table(app, "other_table", { id: uuid().primaryKey() });
		const view = defineView(app, "all_posts", select(posts));

		const previous = snap(app, posts, otherTable, view);
		const renamedOtherTable = table(app, "renamed_other_table", {
			id: uuid().primaryKey(),
		});
		const next = snap(app, posts, renamedOtherTable, view);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "other_table",
					newName: "renamed_other_table",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.rewrittenPrevious.objects["view:app.all_posts"]).toBe(
			previous.objects["view:app.all_posts"],
		);
	});
});

// #23/D66: a serial-family column's backing sequence keeps its derived
// name in step with a table/column rename -- measured against a real
// Postgres first (not assumed): a table/column rename does NOT rename the
// sequence on its own, so without this the sequence silently drifts from
// what a fresh build of the same (renamed) declaration would produce.
// Uses generateMigration (not this file's own snap() helper) to build
// previous/next, since the sequence declaration is synthesized by
// generate.ts's resolveDeclarations, which snap()'s buildSnapshot-direct
// path deliberately bypasses (same reason #157's view tests didn't need
// this: a view is declared directly, nothing to synthesize).
describe("planRenames — sequence rename drift guard (#23/D66)", () => {
	it("a table rename renames the sequence to match, with no leftover diff", () => {
		const buildPosts = (tableName: string) =>
			table(app, tableName, { id: serial().primaryKey() });

		const previous = generateMigration({
			declarations: [app, buildPosts("posts")],
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const next = generateMigration({
			declarations: [app, buildPosts("articles")],
			previousSnapshot: emptySnapshot,
		}).snapshot;

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toContain(
			'alter sequence "app"."posts_id_seq" rename to "articles_id_seq";',
		);
		expect(
			plan.rewrittenPrevious.objects["sequence:app.articles_id_seq"],
		).toBeDefined();
		expect(
			plan.rewrittenPrevious.objects["sequence:app.posts_id_seq"],
		).toBeUndefined();
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename renames the sequence to match, with no leftover diff", () => {
		const buildPosts = (columnKey: "id" | "postId") =>
			table(app, "posts", { [columnKey]: serial().primaryKey() });

		const previous = generateMigration({
			declarations: [app, buildPosts("id")],
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const next = generateMigration({
			declarations: [app, buildPosts("postId")],
			previousSnapshot: emptySnapshot,
		}).snapshot;

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "id",
					newName: "post_id",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toContain(
			'alter sequence "app"."posts_id_seq" rename to "posts_post_id_seq";',
		);
		expect(
			plan.rewrittenPrevious.objects["sequence:app.posts_post_id_seq"],
		).toBeDefined();
		expect(
			plan.rewrittenPrevious.objects["sequence:app.posts_id_seq"],
		).toBeUndefined();
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("returns the exact same sequence object reference when a rename doesn't touch it (cheap no-op check)", () => {
		const posts = table(app, "posts", { id: serial().primaryKey() });
		const otherTable = table(app, "other_table", { id: uuid().primaryKey() });

		const previous = generateMigration({
			declarations: [app, posts, otherTable],
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const renamedOtherTable = table(app, "renamed_other_table", {
			id: uuid().primaryKey(),
		});
		const next = generateMigration({
			declarations: [app, posts, renamedOtherTable],
			previousSnapshot: emptySnapshot,
		}).snapshot;

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "other_table",
					newName: "renamed_other_table",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.rewrittenPrevious.objects["sequence:app.posts_id_seq"]).toBe(
			previous.objects["sequence:app.posts_id_seq"],
		);
	});

	// #193 review: the DSL has no way to author a sequence with a
	// non-derived name (generate.ts's resolveDeclarations only ever
	// synthesizes deriveSequenceName(...)), but rewriteSequencesForRename
	// reads the *snapshot*, not the DSL -- and D33 makes a hand-edited or
	// round-tripped snapshot on disk behave exactly like a freshly built
	// one. So a non-derived sequence name is reachable today, through a
	// hand-built snapshot fixture exactly like this one, and the
	// wasDerived guard must leave it alone on a table rename: only its
	// `table`/`column` references follow, never its own name. (Reviewer
	// mutation-proof: `if (!wasDerived)` -> `if (false)` made this go red
	// with the old "hypothetical future" framing untested against it.)
	it("leaves a non-derived sequence name untouched on a table rename (hand-built snapshot, D33)", () => {
		const previousBase = snap(app, table(app, "posts", { id: integer() }));
		const previous = {
			...previousBase,
			objects: {
				...previousBase.objects,
				"sequence:app.legacy_counter": {
					schema: "app",
					name: "legacy_counter",
					table: "posts",
					column: "id",
					baseType: "integer",
				},
			},
		};
		const nextBase = snap(app, table(app, "articles", { id: integer() }));
		const next = {
			...nextBase,
			objects: {
				...nextBase.objects,
				"sequence:app.legacy_counter": {
					schema: "app",
					name: "legacy_counter",
					table: "articles",
					column: "id",
					baseType: "integer",
				},
			},
		};

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});

		expect(plan.errors).toEqual([]);
		expect(
			plan.renameStatements.some((s) => s.includes("legacy_counter")),
		).toBe(false);
		expect(
			plan.rewrittenPrevious.objects["sequence:app.legacy_counter"],
		).toEqual({
			schema: "app",
			name: "legacy_counter",
			table: "articles",
			column: "id",
			baseType: "integer",
		});
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});
});

// #24: primary key and unique constraint names are recorded in the
// snapshot (D68) but derived independently -- derivePrimaryKeyName depends
// only on the table name, deriveUniqueName on both table and column name
// (measured against pg_dump, table-kind.ts's own doc comments) -- so a
// table rename can drift either, but a column rename can only ever drift
// the unique one. Mirrors the index/FK wasDerived pattern exactly, and the
// sequence describe block above for hand-built-snapshot coverage.
describe("planRenames — primary key and unique-name rename drift guard (#24)", () => {
	it("a table rename renames the primary key constraint to match, with no leftover diff", () => {
		const previous = snap(
			app,
			table(app, "posts", { id: uuid().primaryKey() }),
		);
		const next = snap(app, table(app, "articles", { id: uuid().primaryKey() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename to "articles";`,
			`alter table "app"."articles" rename constraint "posts_pkey" to "articles_pkey";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename leaves the primary key constraint name untouched (column-independent by design)", () => {
		const previous = snap(
			app,
			table(app, "posts", { id: uuid().primaryKey() }),
		);
		const next = snap(app, table(app, "posts", { pkId: uuid().primaryKey() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "id",
					newName: "pk_id",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "id" to "pk_id";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a table rename renames a unique column's constraint name to match, with no leftover diff", () => {
		const previous = snap(app, table(app, "posts", { slug: text().unique() }));
		const next = snap(app, table(app, "articles", { slug: text().unique() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename to "articles";`,
			`alter table "app"."articles" rename constraint "posts_slug_key" to "articles_slug_key";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename renames its own unique constraint name to match, with no leftover diff", () => {
		const previous = snap(app, table(app, "posts", { slug: text().unique() }));
		const next = snap(app, table(app, "posts", { handle: text().unique() }));
		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
			`alter table "app"."posts" rename constraint "posts_slug_key" to "posts_handle_key";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	// D33: no DSL surface authors a custom primary-key name directly, but
	// the snapshot on disk is the ground truth regardless (a hand-edited or
	// round-tripped snapshot behaves exactly like a freshly built one) --
	// so a non-derived name is reachable, and the wasDerived guard must
	// leave it alone on a table rename. (Mutation-proof the same way the
	// sequence guard's own hand-built test is: `if (!wasDerived) -> if
	// (false)` would go red here.)
	it("leaves a non-derived primary key name untouched on a table rename (hand-built snapshot, D33)", () => {
		const previousBase = snap(
			app,
			table(app, "posts", { id: uuid().primaryKey() }),
		);
		const previous = {
			...previousBase,
			objects: {
				...previousBase.objects,
				"table:app.posts": {
					...(previousBase.objects["table:app.posts"] as object),
					primaryKeyName: "legacy_posts_pk",
				},
			},
		};
		const nextBase = snap(
			app,
			table(app, "articles", { id: uuid().primaryKey() }),
		);
		const next = {
			...nextBase,
			objects: {
				...nextBase.objects,
				"table:app.articles": {
					...(nextBase.objects["table:app.articles"] as object),
					primaryKeyName: "legacy_posts_pk",
				},
			},
		};

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});

		expect(plan.errors).toEqual([]);
		expect(
			plan.renameStatements.some((s) => s.includes("legacy_posts_pk")),
		).toBe(false);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	// @see the primary-key hand-built test above -- same reasoning, for
	// ColumnSnapshot.uniqueName.
	it("leaves a non-derived unique name untouched on a table rename (hand-built snapshot, D33)", () => {
		const previousBase = snap(
			app,
			table(app, "posts", { slug: text().unique() }),
		);
		const previousTable = previousBase.objects["table:app.posts"] as {
			readonly columns: ReadonlyArray<{ readonly name: string }>;
		};
		const previous = {
			...previousBase,
			objects: {
				...previousBase.objects,
				"table:app.posts": {
					...previousTable,
					columns: previousTable.columns.map((column) => {
						if (column.name !== "slug") {
							return column;
						}
						return { ...column, uniqueName: "legacy_slug_unique" };
					}),
				},
			},
		};
		const nextBase = snap(
			app,
			table(app, "articles", { slug: text().unique() }),
		);
		const nextTable = nextBase.objects["table:app.articles"] as {
			readonly columns: ReadonlyArray<{ readonly name: string }>;
		};
		const next = {
			...nextBase,
			objects: {
				...nextBase.objects,
				"table:app.articles": {
					...nextTable,
					columns: nextTable.columns.map((column) => {
						if (column.name !== "slug") {
							return column;
						}
						return { ...column, uniqueName: "legacy_slug_unique" };
					}),
				},
			},
		};

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});

		expect(plan.errors).toEqual([]);
		expect(
			plan.renameStatements.some((s) => s.includes("legacy_slug_unique")),
		).toBe(false);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});
});

// #154 ratchet-5: rewriteForeignKeysForRename mirrors rewriteIndexesForRename
// exactly (same wasDerived / newDerivedName-unchanged / renamed three-way
// split) but ran on 0 of its 27 dev-suite calls before this block -- every
// existing rename test's *renamed* table happened to carry no foreign keys
// of its own (the FK-bearing table in the retargetForeignKeyReferenceColumn
// tests above is a bystander, not the one being renamed). deriveForeignKeyName
// depends on both table name and columns (table-kind.ts's own doc comment),
// so unlike the primary-key case above, a *column* rename can drift it too
// when the renamed column is one of the FK's own.
describe("planRenames — foreign key constraint rename drift guard (#154)", () => {
	it("a table rename renames a derived foreign key constraint to match, with no leftover diff", () => {
		const previousUsers = table(app, "users", { id: uuid().primaryKey() });
		const previous = snap(
			app,
			previousUsers,
			table(
				app,
				"posts",
				{ id: uuid().primaryKey(), authorId: uuid().notNull() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: previousUsers, columns: [previousUsers.id] },
						},
					],
				}),
			),
		);
		const nextUsers = table(app, "users", { id: uuid().primaryKey() });
		const next = snap(
			app,
			nextUsers,
			table(
				app,
				"articles",
				{ id: uuid().primaryKey(), authorId: uuid().notNull() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: nextUsers, columns: [nextUsers.id] },
						},
					],
				}),
			),
		);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename to "articles";`,
			`alter table "app"."articles" rename constraint "posts_author_id_fk" to "articles_author_id_fk";`,
			`alter table "app"."articles" rename constraint "posts_pkey" to "articles_pkey";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	it("a column rename involving an unrelated column leaves a derived foreign key constraint untouched (newDerivedName === entry.name)", () => {
		const previousUsers = table(app, "users", { id: uuid().primaryKey() });
		const previous = snap(
			app,
			previousUsers,
			table(
				app,
				"posts",
				{
					id: uuid().primaryKey(),
					authorId: uuid().notNull(),
					slug: text(),
				},
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: previousUsers, columns: [previousUsers.id] },
						},
					],
				}),
			),
		);
		const nextUsers = table(app, "users", { id: uuid().primaryKey() });
		const next = snap(
			app,
			nextUsers,
			table(
				app,
				"posts",
				{
					id: uuid().primaryKey(),
					authorId: uuid().notNull(),
					handle: text(),
				},
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: nextUsers, columns: [nextUsers.id] },
						},
					],
				}),
			),
		);

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "column",
					schemaName: "app",
					tableName: "posts",
					oldName: "slug",
					newName: "handle",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});
		expect(plan.errors).toEqual([]);
		expect(plan.renameStatements).toEqual([
			`alter table "app"."posts" rename column "slug" to "handle";`,
		]);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});

	// @see the primary-key/unique hand-built tests above -- same reasoning,
	// for ForeignKeySnapshot.name.
	it("leaves a non-derived foreign key constraint name untouched on a table rename (hand-built snapshot, D33)", () => {
		const previousUsers = table(app, "users", { id: uuid().primaryKey() });
		const previousBase = snap(
			app,
			previousUsers,
			table(
				app,
				"posts",
				{ id: uuid().primaryKey(), authorId: uuid().notNull() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: previousUsers, columns: [previousUsers.id] },
						},
					],
				}),
			),
		);
		const previousTable = previousBase.objects["table:app.posts"] as {
			readonly foreignKeys: ReadonlyArray<{ readonly name: string }>;
		};
		const previous = {
			...previousBase,
			objects: {
				...previousBase.objects,
				"table:app.posts": {
					...previousTable,
					foreignKeys: previousTable.foreignKeys.map((foreignKey) => ({
						...foreignKey,
						name: "legacy_posts_author_fk",
					})),
				},
			},
		};
		const nextUsers = table(app, "users", { id: uuid().primaryKey() });
		const nextBase = snap(
			app,
			nextUsers,
			table(
				app,
				"articles",
				{ id: uuid().primaryKey(), authorId: uuid().notNull() },
				(t) => ({
					foreignKeys: [
						{
							columns: [t.authorId],
							references: { table: nextUsers, columns: [nextUsers.id] },
						},
					],
				}),
			),
		);
		const nextTable = nextBase.objects["table:app.articles"] as {
			readonly foreignKeys: ReadonlyArray<{ readonly name: string }>;
		};
		const next = {
			...nextBase,
			objects: {
				...nextBase.objects,
				"table:app.articles": {
					...nextTable,
					foreignKeys: nextTable.foreignKeys.map((foreignKey) => ({
						...foreignKey,
						name: "legacy_posts_author_fk",
					})),
				},
			},
		};

		const plan = planRenames({
			previous,
			next,
			renames: [
				{
					target: "table",
					schemaName: "app",
					oldName: "posts",
					newName: "articles",
				},
			],
			confirmedDrops: [],
			declaredAtByIdentity: noDeclSites,
		});

		expect(plan.errors).toEqual([]);
		expect(
			plan.renameStatements.some((s) => s.includes("legacy_posts_author_fk")),
		).toBe(false);
		expect(diffSnapshots(plan.rewrittenPrevious, next, registry)).toEqual([]);
	});
});
