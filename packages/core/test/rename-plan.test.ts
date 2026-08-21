import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, HejbroInput } from "../src";
import {
	buildSnapshot,
	createDefaultRegistry,
	desc,
	diffSnapshots,
	emptySnapshot,
	eq,
	exists,
	generateMigration,
	getTableMeta,
	index,
	isTable,
	planRenames,
	renderSnapshot,
	rls,
	schema,
	select,
	table,
	text,
	uuid,
	varchar,
} from "../src";
import type { PolicySnapshot } from "../src/kinds/policy-kind";
import { policyUsing } from "../src/kinds/policy-kind";

const app = schema("app");
const registry = createDefaultRegistry();
// table() returns a column-ref proxy (D15); unwrap to its declaration the
// same way generate.ts's resolveDeclarations does before snapshotting.
const unwrap = (input: HejbroInput): HejbroDeclaration =>
	isTable(input) ? getTableMeta(input) : input;
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
describe("planRenames — cross-table exists() retargeting (#110, currently broken)", () => {
	it("renaming the exists()-referenced table leaves a comments-table policy's `using` text pointing at the old name", () => {
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

		// Current (broken) behavior: the policy's `using` -- now a
		// structured node (D67/D70), decoded and rendered back to SQL
		// text via the same accessor emit uses -- still says "posts",
		// not "articles". rename-plan.ts never touches policy nodes yet.
		// This assertion documents the gap; #110's fix (later in this
		// PR) makes it say "articles" instead, and this test is updated
		// alongside that fix (see PR body for before/after).
		const usingSql = policyUsing(policyNode as PolicySnapshot);
		expect(usingSql).toContain('"posts"');
		expect(usingSql).not.toContain('"articles"');
	});
});
