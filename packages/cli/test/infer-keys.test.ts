import { describe, expect, it } from "vitest";
import {
	inferColumnKeys,
	resolveIdentifierKeys,
} from "../src/infer/column-keys";

describe("inferColumnKeys / 1.1 casing", () => {
	it("lower-cases and joins runs between non-alphanumeric characters in camel case", () => {
		expect(inferColumnKeys(["USER_ID"])).toEqual(["userId"]);
	});

	it("treats a run of spaces the same as any other non-alphanumeric separator", () => {
		expect(inferColumnKeys(["created at"])).toEqual(["createdAt"]);
	});

	it("keeps a leading underscore rather than treating it as a separator", () => {
		expect(inferColumnKeys(["_id"])).toEqual(["_id"]);
	});

	it("prefixes an underscore when the result would otherwise start with a digit", () => {
		expect(inferColumnKeys(["2fa_enabled"])).toEqual(["_2faEnabled"]);
	});
});

describe("inferColumnKeys / 1.1 collisions", () => {
	it("leaves the earliest column its bare key and suffixes a later collision with 2", () => {
		expect(inferColumnKeys(["user_id", "USER_ID"])).toEqual([
			"userId",
			"userId2",
		]);
	});

	it("skips a suffix already taken and uses the next free integer", () => {
		expect(inferColumnKeys(["user_id", "USER_ID", "User Id"])).toEqual([
			"userId",
			"userId2",
			"userId3",
		]);
	});
});

describe("resolveIdentifierKeys / 2.1 (Q2, CI-G2-R1-06): the same casing+collision rule, seeded with reserved names", () => {
	it("behaves exactly like inferColumnKeys when nothing is reserved", () => {
		expect(resolveIdentifierKeys(["user_id", "USER_ID"])).toEqual(
			inferColumnKeys(["user_id", "USER_ID"]),
		);
	});

	it("suffixes even the earliest name when it collides with a reserved symbol", () => {
		// table/enum identifiers have no round-trip constraint (Q2): a bare
		// collision with an import (e.g. a table literally named `check`)
		// must be suffixed even though nothing earlier in its own list
		// claimed the bare key first.
		expect(
			resolveIdentifierKeys(["check"], new Set(["check", "table", "schema"])),
		).toEqual(["check2"]);
	});
});
