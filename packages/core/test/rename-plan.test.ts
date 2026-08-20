import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, HejbroInput } from "../src";
import {
	buildSnapshot,
	createDefaultRegistry,
	desc,
	diffSnapshots,
	getTableMeta,
	index,
	isTable,
	planRenames,
	renderSnapshot,
	schema,
	table,
	text,
	varchar,
} from "../src";

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
});
