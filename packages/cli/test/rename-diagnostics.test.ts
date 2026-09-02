import type { ColumnRenameAmbiguity, TableRenameAmbiguity } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { renderDiagnostics } from "../src/diagnostics";
import { buildAmbiguityDiagnostic } from "../src/rename-diagnostics";

// Reproduces diagnostics.test.ts's owner-approved terminal mockups
// (singlePairMockup/multiPairMockup/tableRenameMockup) byte-for-byte from
// buildAmbiguityDiagnostic's *generic* construction (wordWrap, per-item
// suggestion building) fed the same underlying data those mockups were
// hand-authored from — the strongest evidence the wrap width (70) and
// template wording are right, and that they generalize correctly to real
// (differently-named) ambiguities.

const AT = 'examples/shop/schema.ts (export "posts")';

describe("buildAmbiguityDiagnostic — column, single pair", () => {
	const ambiguity: ColumnRenameAmbiguity = {
		kind: "column",
		schemaName: "shop",
		tableName: "posts",
		identity: "shop.posts",
		dropped: ["slug"],
		added: ["handle"],
		declaredAt: AT,
	};

	it("matches the owner-approved single-pair mockup exactly", () => {
		const diagnostic = buildAmbiguityDiagnostic(ambiguity, [], AT);
		const rendered = renderDiagnostics([diagnostic], null);
		expect(rendered).toBe(
			[
				"error[ambiguous-column-rename]: shop.posts",
				'  column "slug" was dropped and column "handle" was added in the same',
				"  generate run — hejbro exited without writing SQL for this table; it",
				"  won't guess between two possible next steps.",
				"",
				"  → if this is a rename, rerun:",
				"      hejbro generate --rename shop.posts.slug=handle",
				"",
				"  → if these are unrelated changes, rerun:",
				"      hejbro generate --confirm-drop shop.posts.slug",
				"",
				'  at examples/shop/schema.ts (export "posts")',
			].join("\n"),
		);
	});

	it("preserves existing argv when assembling the rerun suggestions", () => {
		const diagnostic = buildAmbiguityDiagnostic(
			ambiguity,
			["--config", "db/hejbro.config.ts"],
			null,
		);
		expect(diagnostic.suggestions[0]?.lines).toEqual([
			"hejbro generate \\",
			"  --config db/hejbro.config.ts \\",
			"  --rename shop.posts.slug=handle",
		]);
	});
});

describe("buildAmbiguityDiagnostic — column, multiple pairs", () => {
	const ambiguity: ColumnRenameAmbiguity = {
		kind: "column",
		schemaName: "shop",
		tableName: "posts",
		identity: "shop.posts",
		dropped: ["slug", "seo_title"],
		added: ["handle", "meta_title"],
		declaredAt: AT,
	};

	it("matches the owner-approved multi-pair mockup's body, labels, and blank-line grouping", () => {
		const diagnostic = buildAmbiguityDiagnostic(ambiguity, [], AT);
		expect(diagnostic.body).toEqual([
			'2 columns were dropped ("slug", "seo_title") and 2 columns were added',
			'("handle", "meta_title") in the same generate run — hejbro exited',
			"without writing SQL for this table; it won't guess which pairs (if",
			"any) are renames.",
		]);
		expect(diagnostic.suggestions[0]).toEqual({
			label: "every dropped column needs one of:",
			lines: [
				"--rename shop.posts.slug=<new column, e.g. handle or meta_title>",
				"--confirm-drop shop.posts.slug",
				"",
				"--rename shop.posts.seo_title=<new column, e.g. handle or meta_title>",
				"--confirm-drop shop.posts.seo_title",
			],
		});
		expect(diagnostic.suggestions[1]?.label).toBe(
			"example rerun once you've decided (edit the <...> placeholders):",
		);
		// assembleRerunCommand sorts new flags by target identity
		// (byte order) independent of the pairing/listing order above —
		// "seo_title" < "slug" — see rerun.test.ts.
		expect(diagnostic.suggestions[1]?.lines).toEqual([
			"hejbro generate \\",
			"  --rename shop.posts.seo_title=meta_title \\",
			"  --rename shop.posts.slug=handle",
		]);
	});
});

describe("buildAmbiguityDiagnostic — table, 1:1", () => {
	const ambiguity: TableRenameAmbiguity = {
		kind: "table",
		schemaName: "shop",
		droppedTables: ["posts"],
		createdTables: ["blog_posts"],
		existingCreatedTables: [],
		declaredAt: 'examples/shop/schema.ts (export "blogPosts")',
	};

	it("matches the owner-approved table-rename mockup exactly, including the ⚠ callout hanging indent", () => {
		const diagnostic = buildAmbiguityDiagnostic(
			ambiguity,
			[],
			'examples/shop/schema.ts (export "blogPosts")',
		);
		const rendered = renderDiagnostics([diagnostic], null);
		expect(rendered).toBe(
			[
				"error[ambiguous-table-rename]: shop",
				'  table "posts" was dropped, table "blog_posts" was created.',
				"  ⚠ a table rename recreates every column, index, foreign key, RLS",
				"    policy, and trigger on it — hejbro will not guess.",
				"",
				"  → if this is a rename, rerun:",
				"      hejbro generate --rename shop.posts=blog_posts",
				"",
				"  → if these are unrelated tables, rerun:",
				"      hejbro generate --confirm-drop shop.posts",
				"",
				'  at examples/shop/schema.ts (export "blogPosts")',
			].join("\n"),
		);
	});
});

// #703: the created table is declared with existingTable() -- the
// ordinary "if this is a rename, rerun: --rename ..." suggestion above
// would itself be refused by unknown-rename-target, the exact "the
// remedy is the command that just failed" shape D106 R5-B1 was filed
// against. Never the same suggestion shape as the ordinary case.
describe("buildAmbiguityDiagnostic — table, 1:1, created side is existingTable() (#703)", () => {
	const ambiguity: TableRenameAmbiguity = {
		kind: "table",
		schemaName: "e3",
		droppedTables: ["widgets"],
		createdTables: ["gadgets"],
		existingCreatedTables: ["gadgets"],
		declaredAt: null,
	};

	it("never suggests --rename as a standalone rerun, and names the two-run path instead", () => {
		const diagnostic = buildAmbiguityDiagnostic(ambiguity, [], null);
		const rendered = renderDiagnostics([diagnostic], null);
		expect(rendered).not.toContain("if this is a rename, rerun:");
		// #703: "two runs" is the exact phrase core's own flat message
		// (ambiguousTableRenameMessage) uses too -- asserted on purpose so
		// this pin would catch the two messages drifting apart again.
		expect(rendered).toContain("two runs");
		expect(rendered).toContain("run this NOW, then hand it over");
		expect(rendered).toContain("hejbro generate --rename e3.widgets=gadgets");
		expect(rendered).toContain("if these are unrelated tables, rerun:");
		expect(rendered).toContain("hejbro generate --confirm-drop e3.widgets");
	});
});

describe("buildAmbiguityDiagnostic — table, N:M (reasonable extension, no owner mockup)", () => {
	const ambiguity: TableRenameAmbiguity = {
		kind: "table",
		schemaName: "app",
		droppedTables: ["comments", "reactions"],
		createdTables: ["reviews", "likes"],
		existingCreatedTables: [],
		declaredAt: null,
	};

	it("mirrors the column multi-pair pattern: counted-clause body + per-table option lines + example rerun", () => {
		const diagnostic = buildAmbiguityDiagnostic(ambiguity, [], null);
		expect(diagnostic.body[0]).toBe(
			'2 tables were dropped ("comments", "reactions") and 2 tables were',
		);
		expect(diagnostic.body.at(-2)).toBe(
			"⚠ a table rename recreates every column, index, foreign key, RLS",
		);
		expect(diagnostic.suggestions[0]?.label).toBe(
			"every dropped table needs one of:",
		);
		expect(diagnostic.suggestions[0]?.lines).toContain(
			"--rename app.comments=<new table, e.g. reviews or likes>",
		);
		expect(diagnostic.suggestions[1]?.lines).toEqual([
			"hejbro generate \\",
			"  --rename app.comments=reviews \\",
			"  --rename app.reactions=likes",
		]);
	});
});
