import { describe, expect, it } from "vitest";
import type { HejbroDeclaration, HejbroInput } from "../src";
import {
	buildSnapshot,
	createDefaultRegistry,
	diffSnapshots,
	getTableMeta,
	index,
	isTable,
	planRenames,
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
	it("flags a same-table drop+add pair as ambiguous (rule A)", () => {
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
			expect.objectContaining({ code: "ambiguous-column-rename" }),
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
			expect.objectContaining({ code: "ambiguous-table-rename" }),
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
			expect.objectContaining({ code: "unknown-rename-target" }),
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
		expect(error?.message).toContain('new column name "handle"');
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
			expect.objectContaining({ code: "unknown-confirm-drop-target" }),
		]);
	});
});
