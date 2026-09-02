import { describe, expect, it } from "vitest";
import { inferColumnKeys } from "../src/infer/column-keys";

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
