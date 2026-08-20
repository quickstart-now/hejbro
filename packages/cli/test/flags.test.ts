import { describe, expect, it } from "vitest";
import { parseConfirmDropFlag, parseRenameFlag } from "../src/flags";

describe("parseRenameFlag", () => {
	it("parses a column form (3 dot-segments + one =)", () => {
		expect(parseRenameFlag("app.posts.slug=handle")).toEqual({
			target: "column",
			schemaName: "app",
			tableName: "posts",
			oldName: "slug",
			newName: "handle",
		});
	});

	it("parses a table form (2 dot-segments + one =)", () => {
		expect(parseRenameFlag("app.posts=blog_posts")).toEqual({
			target: "table",
			schemaName: "app",
			oldName: "posts",
			newName: "blog_posts",
		});
	});

	it("throws invalid-rename-flag with the owner-approved text for an extra segment", () => {
		try {
			parseRenameFlag("app.posts.slug.extra=handle");
			throw new Error("expected parseRenameFlag to throw");
		} catch (error) {
			expect(error).toMatchObject({
				code: "invalid-rename-flag",
				message:
					'--rename value "app.posts.slug.extra=handle" isn\'t in the expected "<schema>.<table>.<old>=<new>" (column) or "<schema>.<old>=<new>" (table) form. Next: check for extra "." characters, and make sure the value contains exactly one "=".',
			});
		}
	});

	it("throws invalid-rename-flag when there's no =", () => {
		expect(() => parseRenameFlag("app.posts.slug")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});

	it("throws invalid-rename-flag when there are two =", () => {
		expect(() => parseRenameFlag("app.posts.slug=handle=extra")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});

	it("throws invalid-rename-flag for a single-segment left side", () => {
		expect(() => parseRenameFlag("posts=blog_posts")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});
});

describe("parseConfirmDropFlag", () => {
	it("parses a column form (3 dot-segments)", () => {
		expect(parseConfirmDropFlag("app.posts.slug")).toEqual({
			target: "column",
			schemaName: "app",
			tableName: "posts",
			columnName: "slug",
		});
	});

	it("parses a table form (2 dot-segments)", () => {
		expect(parseConfirmDropFlag("app.posts")).toEqual({
			target: "table",
			schemaName: "app",
			tableName: "posts",
		});
	});

	it("throws invalid-rename-flag (format errors reuse the same code) for an extra segment", () => {
		expect(() => parseConfirmDropFlag("app.posts.slug.extra")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});

	it("throws invalid-rename-flag for a single-segment value", () => {
		expect(() => parseConfirmDropFlag("app")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});

	it("throws invalid-rename-flag when the value contains =", () => {
		expect(() => parseConfirmDropFlag("app.posts=x")).toThrowError(
			expect.objectContaining({ code: "invalid-rename-flag" }),
		);
	});

	it("throws invalid-rename-flag with the owner-approved text (planner msg 00997dc7) for a malformed value", () => {
		expect(() => parseConfirmDropFlag("app.posts.slug.extra")).toThrowError(
			expect.objectContaining({
				code: "invalid-rename-flag",
				message:
					'--confirm-drop value "app.posts.slug.extra" isn\'t in the expected "<schema>.<table>.<column>" (column) or "<schema>.<table>" (table) form. Next: check for extra "." characters.',
			}),
		);
	});
});
