import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { fromHejbroError, renderDiagnostics } from "../src/diagnostics";

// Owner-approved terminal mockups (designer-confirmed golden, relayed via
// planner) for decision ③'s grammar — pinned here verbatim; Task 14 (PR C)
// holds the same standard for the real CLI-integrated golden corpus. The
// rerun commands shown are the "no flags yet" default-invocation case —
// real rerun commands are assembled dynamically (preserving existing
// argv) per Task 13's rerun.ts, not reproduced by this renderer.

const singlePairMockup: Diagnostic = {
	code: "ambiguous-column-rename",
	identity: "app.posts",
	body: [
		'column "slug" was dropped and column "handle" was added in the same',
		"generate run — hejbro exited without writing SQL for this table; it",
		"won't guess between two possible next steps.",
	],
	suggestions: [
		{
			label: "if this is a rename, rerun:",
			lines: ["hejbro generate --rename app.posts.slug=handle"],
		},
		{
			label: "if these are unrelated changes, rerun:",
			lines: ["hejbro generate --confirm-drop app.posts.slug"],
		},
	],
	at: 'examples/app/schema.ts (export "posts")',
};

const SINGLE_PAIR_RENDERED = [
	"error[ambiguous-column-rename]: app.posts",
	'  column "slug" was dropped and column "handle" was added in the same',
	"  generate run — hejbro exited without writing SQL for this table; it",
	"  won't guess between two possible next steps.",
	"",
	"  → if this is a rename, rerun:",
	"      hejbro generate --rename app.posts.slug=handle",
	"",
	"  → if these are unrelated changes, rerun:",
	"      hejbro generate --confirm-drop app.posts.slug",
	"",
	'  at examples/app/schema.ts (export "posts")',
].join("\n");

const multiPairMockup: Diagnostic = {
	code: "ambiguous-column-rename",
	identity: "app.posts",
	body: [
		'2 columns were dropped ("slug", "seo_title") and 2 columns were added',
		'("handle", "meta_title") in the same generate run — hejbro exited',
		"without writing SQL for this table; it won't guess which pairs (if",
		"any) are renames.",
	],
	suggestions: [
		{
			label: "every dropped column needs one of:",
			lines: [
				"--rename app.posts.slug=<new column, e.g. handle or meta_title>",
				"--confirm-drop app.posts.slug",
				"",
				"--rename app.posts.seo_title=<new column, e.g. handle or meta_title>",
				"--confirm-drop app.posts.seo_title",
			],
		},
		{
			label: "example rerun once you've decided (edit the <...> placeholders):",
			lines: [
				"hejbro generate \\",
				"  --rename app.posts.slug=handle \\",
				"  --rename app.posts.seo_title=meta_title",
			],
		},
	],
	at: 'examples/app/schema.ts (export "posts")',
};

const MULTI_PAIR_RENDERED = [
	"error[ambiguous-column-rename]: app.posts",
	'  2 columns were dropped ("slug", "seo_title") and 2 columns were added',
	'  ("handle", "meta_title") in the same generate run — hejbro exited',
	"  without writing SQL for this table; it won't guess which pairs (if",
	"  any) are renames.",
	"",
	"  → every dropped column needs one of:",
	"      --rename app.posts.slug=<new column, e.g. handle or meta_title>",
	"      --confirm-drop app.posts.slug",
	"",
	"      --rename app.posts.seo_title=<new column, e.g. handle or meta_title>",
	"      --confirm-drop app.posts.seo_title",
	"",
	"  → example rerun once you've decided (edit the <...> placeholders):",
	"      hejbro generate \\",
	"        --rename app.posts.slug=handle \\",
	"        --rename app.posts.seo_title=meta_title",
	"",
	'  at examples/app/schema.ts (export "posts")',
].join("\n");

const tableRenameMockup: Diagnostic = {
	code: "ambiguous-table-rename",
	identity: "app",
	body: [
		'table "posts" was dropped, table "blog_posts" was created.',
		"⚠ a table rename recreates every column, index, foreign key, RLS",
		"  policy, and trigger on it — hejbro will not guess.",
	],
	suggestions: [
		{
			label: "if this is a rename, rerun:",
			lines: ["hejbro generate --rename app.posts=blog_posts"],
		},
		{
			label: "if these are unrelated tables, rerun:",
			lines: ["hejbro generate --confirm-drop app.posts"],
		},
	],
	at: 'examples/app/schema.ts (export "blogPosts")',
};

const TABLE_RENAME_RENDERED = [
	"error[ambiguous-table-rename]: app",
	'  table "posts" was dropped, table "blog_posts" was created.',
	"  ⚠ a table rename recreates every column, index, foreign key, RLS",
	"    policy, and trigger on it — hejbro will not guess.",
	"",
	"  → if this is a rename, rerun:",
	"      hejbro generate --rename app.posts=blog_posts",
	"",
	"  → if these are unrelated tables, rerun:",
	"      hejbro generate --confirm-drop app.posts",
	"",
	'  at examples/app/schema.ts (export "blogPosts")',
].join("\n");

describe("renderDiagnostics — owner-approved terminal mockups", () => {
	it("renders the single-pair ambiguous-column-rename mockup exactly", () => {
		expect(renderDiagnostics([singlePairMockup], null)).toBe(
			SINGLE_PAIR_RENDERED,
		);
	});

	it("renders the multi-pair ambiguous-column-rename mockup exactly (blank line inside one suggestion's lines, backslash-continued rerun example)", () => {
		expect(renderDiagnostics([multiPairMockup], null)).toBe(
			MULTI_PAIR_RENDERED,
		);
	});

	it("renders the ambiguous-table-rename mockup exactly (⚠ callout hanging indent)", () => {
		expect(renderDiagnostics([tableRenameMockup], null)).toBe(
			TABLE_RENAME_RENDERED,
		);
	});

	it("separates multiple diagnostic blocks with a blank line", () => {
		const rendered = renderDiagnostics(
			[singlePairMockup, tableRenameMockup],
			null,
		);
		expect(rendered).toBe(
			`${SINGLE_PAIR_RENDERED}\n\n${TABLE_RENAME_RENDERED}`,
		);
	});

	it("appends the owner-approved single-kind batch summary line verbatim", () => {
		const rendered = renderDiagnostics(
			[singlePairMockup],
			"2 ambiguous column renames — resolve and rerun `hejbro generate`.",
		);
		expect(rendered).toBe(
			`${SINGLE_PAIR_RENDERED}\n\n2 ambiguous column renames — resolve and rerun \`hejbro generate\`.`,
		);
	});

	it("appends the owner-approved mixed batch summary line verbatim", () => {
		const rendered = renderDiagnostics(
			[singlePairMockup],
			"3 ambiguous renames (2 columns, 1 table) — resolve and rerun `hejbro generate`.",
		);
		expect(
			rendered.endsWith(
				"3 ambiguous renames (2 columns, 1 table) — resolve and rerun `hejbro generate`.",
			),
		).toBe(true);
	});

	it("renders nothing but the summary when there are no diagnostics", () => {
		expect(renderDiagnostics([], "no changes.")).toBe("no changes.");
	});
});

describe("fromHejbroError", () => {
	it("carries code, message (as the body), declaredAt, and the given identity — no suggestions by default", () => {
		const diagnostic = fromHejbroError(
			{
				code: "invalid-config",
				message: 'config field "entry" is missing.',
				declaredAt: null,
			},
			"/repo/hejbro.config.ts",
		);
		expect(diagnostic).toEqual({
			code: "invalid-config",
			identity: "/repo/hejbro.config.ts",
			body: ['config field "entry" is missing.'],
			suggestions: [],
			at: null,
		});
	});

	it("passes declaredAt through as the at field verbatim", () => {
		const diagnostic = fromHejbroError(
			{
				code: "invalid-sql-name",
				message: "bad name.",
				declaredAt: "/repo/src/schema.ts:3:1",
			},
			"app",
		);
		expect(diagnostic.at).toBe("/repo/src/schema.ts:3:1");
	});
});
