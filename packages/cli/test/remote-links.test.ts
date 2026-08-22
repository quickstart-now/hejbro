import { describe, expect, it } from "vitest";
import { deriveRemoteLinks, osc8Link } from "../src/remote-links";

describe("deriveRemoteLinks", () => {
	it("github https remote", () => {
		expect(
			deriveRemoteLinks(
				"https://github.com/example/repo.git",
				"abc1234",
				"migrations/0001.sql",
			),
		).toEqual({
			migrationUrl:
				"https://github.com/example/repo/blob/abc1234/migrations/0001.sql",
			commitUrl: "https://github.com/example/repo/commit/abc1234",
		});
	});

	it("github ssh remote", () => {
		expect(
			deriveRemoteLinks(
				"git@github.com:example/repo.git",
				"abc1234",
				"migrations/0001.sql",
			),
		).toEqual({
			migrationUrl:
				"https://github.com/example/repo/blob/abc1234/migrations/0001.sql",
			commitUrl: "https://github.com/example/repo/commit/abc1234",
		});
	});

	it("gitlab https remote", () => {
		expect(
			deriveRemoteLinks(
				"https://gitlab.com/example/repo.git",
				"abc1234",
				"migrations/0001.sql",
			),
		).toEqual({
			migrationUrl:
				"https://gitlab.com/example/repo/-/blob/abc1234/migrations/0001.sql",
			commitUrl: "https://gitlab.com/example/repo/-/commit/abc1234",
		});
	});

	it("an unrecognized host returns null (silently plain)", () => {
		expect(
			deriveRemoteLinks(
				"https://bitbucket.org/example/repo.git",
				"abc1234",
				"migrations/0001.sql",
			),
		).toBeNull();
	});
});

describe("osc8Link", () => {
	it("wraps text in an OSC8 hyperlink escape, leaving the visible text unchanged", () => {
		const wrapped = osc8Link(
			"abc1234",
			"https://github.com/example/repo/commit/abc1234",
		);
		expect(wrapped).toContain("abc1234");
		expect(wrapped.startsWith("\x1b]8;;")).toBe(true);
	});
});
