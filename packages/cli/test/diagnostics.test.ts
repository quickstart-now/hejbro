import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostics";
import { fromHejbroError, renderDiagnostics } from "../src/diagnostics";

// NOTE (implementer, PR B): the exact wording of the ambiguous-column-rename
// terminal mockup (body phrasing, suggestion labels) referenced by the
// implementation plan as "owner-approved" was not present in the plan
// document reachable from this session. This test pins the *grammar*
// (decision ③, given verbatim in the plan) with representative content;
// the batch summary lines below ARE the plan's verbatim owner-approved
// text. Flagged to planner — content may need a follow-up commit once the
// real mockup is confirmed, before Task 14 (PR C) locks in the goldens.
const ambiguousColumnRename: Diagnostic = {
	code: "ambiguous-column-rename",
	identity: "app.posts",
	body: [
		'table "app.posts" both drops (slug) and adds (handle) columns in this generate run — hejbro can\'t tell whether this is a rename or an unrelated drop+add.',
	],
	suggestions: [
		{
			label: "if this is a rename",
			lines: ["hejbro generate --rename app.posts.slug=handle"],
		},
		{
			label: "if this is unrelated",
			lines: ["hejbro generate --confirm-drop app.posts.slug"],
		},
	],
	at: 'src/schema.ts (export "posts")',
};

describe("renderDiagnostics", () => {
	it("renders the error[code]: identity header, indented body, → suggestion blocks, and the at tail", () => {
		const rendered = renderDiagnostics([ambiguousColumnRename], null);
		expect(rendered).toBe(
			[
				"error[ambiguous-column-rename]: app.posts",
				'  table "app.posts" both drops (slug) and adds (handle) columns in this generate run — hejbro can\'t tell whether this is a rename or an unrelated drop+add.',
				"  → if this is a rename",
				"    hejbro generate --rename app.posts.slug=handle",
				"  → if this is unrelated",
				"    hejbro generate --confirm-drop app.posts.slug",
				'  at src/schema.ts (export "posts")',
			].join("\n"),
		);
	});

	it("omits the at line when the location is unknown", () => {
		const rendered = renderDiagnostics(
			[{ ...ambiguousColumnRename, at: null }],
			null,
		);
		expect(rendered.endsWith("--confirm-drop app.posts.slug")).toBe(true);
	});

	it("separates multiple diagnostic blocks with a blank line", () => {
		const second: Diagnostic = {
			code: "ambiguous-table-rename",
			identity: "app",
			body: ['schema "app" both drops (posts) and adds (blog_posts) tables.'],
			suggestions: [],
			at: null,
		};
		const rendered = renderDiagnostics([ambiguousColumnRename, second], null);
		expect(rendered).toContain("\n\nerror[ambiguous-table-rename]: app\n");
	});

	it("appends the owner-approved single-kind batch summary line verbatim", () => {
		const rendered = renderDiagnostics(
			[ambiguousColumnRename],
			"2 ambiguous column renames — resolve and rerun `hejbro generate`.",
		);
		expect(
			rendered.endsWith(
				"2 ambiguous column renames — resolve and rerun `hejbro generate`.",
			),
		).toBe(true);
	});

	it("appends the owner-approved mixed batch summary line verbatim", () => {
		const rendered = renderDiagnostics(
			[ambiguousColumnRename],
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
