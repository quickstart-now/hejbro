import { hejbroError } from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../src/check/compare";
import { renderCheckReport } from "../src/commands/check";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
} from "./support/cli-runner";

const missingTableFinding: Finding = {
	identity: "app.posts",
	error: hejbroError(
		"check-object-missing",
		'declared table "app.posts" was not found in the database. Next: apply the migration that creates it.',
	),
};

const typeDiffersFinding: Finding = {
	identity: "app.posts.title",
	error: hejbroError(
		"check-object-differs",
		'declared column "app.posts.title" has type "text", but the database has "character varying(120)". Next: change the declaration to match the database.',
	),
};

describe("renderCheckReport / 4.2 report and exit codes", () => {
	it("exits non-zero and names the object when a column type differs", () => {
		const report = renderCheckReport([typeDiffersFinding]);

		expect(report.exitCode).toBe(1);
		expect(report.stderr).toContain("app.posts.title");
		expect(report.stderr).toContain("check-object-differs");
	});

	it("exits zero when everything agrees", () => {
		const report = renderCheckReport([]);

		expect(report.exitCode).toBe(0);
		expect(report.stderr).toBeNull();
	});

	it("emits no diff hunk markers (@@, +++, ---) anywhere in its report", () => {
		// A report can carry object identity *and* still dump a diff -- this
		// is the assertion that would fail if it did; every other test here
		// would still pass regardless.
		const report = renderCheckReport([missingTableFinding, typeDiffersFinding]);
		const wholeReport = [...report.stdout, report.stderr ?? ""].join("\n");

		expect(wholeReport).not.toContain("@@");
		expect(wholeReport).not.toContain("+++");
		expect(wholeReport).not.toContain("---");
	});
});

describe("renderCheckReport / 4.3 coverage boundary", () => {
	it("states what it does not compare even when it finds no differences", () => {
		const report = renderCheckReport([]);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("states what it does not compare when it does find differences", () => {
		const report = renderCheckReport([typeDiffersFinding]);
		const stdoutText = report.stdout.join("\n");

		expect(stdoutText).toContain("view bodies");
	});

	it("says its reads are not a single snapshot", () => {
		const report = renderCheckReport([]);
		const stdoutText = report.stdout.join("\n").toLowerCase();

		expect(stdoutText).toContain("not a single snapshot");
	});
});

describe("hejbro check --help", () => {
	beforeAll(assertBuiltCli);

	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("prints its flags", async () => {
		const result = await runCli(cwd, ["check", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--url");
	});
});
