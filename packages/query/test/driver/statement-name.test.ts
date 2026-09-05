import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preparedStatementName } from "../../src/driver/statement-name";

describe("preparedStatementName (task 1.5, #891)", () => {
	it("names a select statement's text with the exact golden both drivers already pinned (#891 -- a divergence here means a driver's own copy drifted before the merge)", () => {
		// The literal golden `@hejbro/pg`'s and `@hejbro/neon`'s own
		// driver.test.ts each pinned against their (soon-to-be-removed) own
		// copy of this rule -- restated here so this export is provably the
		// same function, not a fresh implementation that merely produces
		// output of the right shape.
		expect(preparedStatementName("select 1")).toBe(
			"hejbro_822ae07d4783158bc1912bb623e5107c",
		);
	});

	it("is `hejbro_` + 32 hex digits of sha256 over the text -- 39 bytes, inside Postgres's 63-byte identifier limit", () => {
		expect(preparedStatementName("select 1")).toMatch(/^hejbro_[0-9a-f]{32}$/);
		expect(preparedStatementName("select 1")).toHaveLength(39);
	});

	it("is a pure function of the text alone -- the same text yields the same name on repeated calls", () => {
		const first = preparedStatementName('select * from "app"."widgets"');
		const second = preparedStatementName('select * from "app"."widgets"');
		expect(first).toBe(second);
	});

	it("two different texts practically never collide -- distinct inputs give distinct names", () => {
		expect(preparedStatementName("select 1")).not.toBe(
			preparedStatementName("select 2"),
		);
	});
});

/** Every `.ts` file directly under `dir` (non-recursive is not enough here -- both drivers keep their own logic in nested files too), read as UTF-8 text. */
const readSourceFiles = (dir: string): ReadonlyArray<string> => {
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			return readSourceFiles(fullPath);
		}
		if (entry.name.endsWith(".ts")) {
			return [readFileSync(fullPath, "utf8")];
		}
		return [];
	});
};

/** `packages/{pg,neon}/src` if present in this checkout (both packages are siblings of `packages/query`) -- absent in a partial checkout, in which case there is nothing to grep and the test trivially holds. */
const siblingSrcDir = (packageName: string): string | undefined => {
	const path = join(import.meta.dirname, "../../..", packageName, "src");
	try {
		statSync(path);
		return path;
	} catch {
		return undefined;
	}
};

describe("no driver package derives its own hejbro_ prepared-statement name (task 1.5, #891 -- the duplication this task removes)", () => {
	it.each(["pg", "neon"])(
		"packages/%s/src defines no hejbro_ prefix of its own (the savepoint naming in query/src/db/transaction.ts, hejbro_sp_, is a different thing and out of scope here)",
		(packageName) => {
			const dir = siblingSrcDir(packageName);
			if (dir === undefined) {
				return;
			}
			const sources = readSourceFiles(dir);
			const offendingFile = sources.find((text) => text.includes("hejbro_"));
			expect(offendingFile).toBeUndefined();
		},
	);
});
