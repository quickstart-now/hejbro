import { assertSqlName } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { isExpressibleName } from "../src/infer/table";

/**
 * D106 R6-N2: `isExpressibleName` now asks `@hejbro/core`'s own
 * `isSqlName` directly instead of restating D36's pattern behind a
 * local `try`/`catch`. Each row is checked twice: once against the
 * literal this table names, and once against a `try`/`catch` around
 * `assertSqlName` built fresh in this file -- the second half is what
 * pins the equivalence the refactor rests on (CI-719-R6-01: `isSqlName`
 * and `assertSqlName` share the same underlying predicate for every
 * input). `a_` is a valid identifier (starts `[a-z]`, only
 * `[a-z0-9_]` after) even though it fails the *round-trip* predicate
 * `infer/table.ts`'s `isNameRoundTrippable` asks -- a different
 * question this file does not cover.
 */
const NAME_CASES: ReadonlyArray<readonly [string, boolean]> = [
	["users", true],
	["user_id", true],
	["widgets2", true],
	["a_", true],
	["Widgets", false],
	["_id", false],
	["createdAt", false],
	["9lives", false],
	["app.orders", false],
	["", false],
	["u$er", false],
];

const tryCatchIsSqlName = (name: string): boolean => {
	try {
		assertSqlName(name, "identifier", null);
		return true;
	} catch {
		return false;
	}
};

describe("isExpressibleName / D106 R6-N2", () => {
	it("answers exactly what core's own D36 rule answers", () => {
		NAME_CASES.forEach(([name, expected]) => {
			expect(
				isExpressibleName(name),
				`isExpressibleName(${JSON.stringify(name)})`,
			).toBe(expected);
			expect(
				isExpressibleName(name),
				`isExpressibleName(${JSON.stringify(name)}) vs try/catch assertSqlName`,
			).toBe(tryCatchIsSqlName(name));
		});
	});
});
