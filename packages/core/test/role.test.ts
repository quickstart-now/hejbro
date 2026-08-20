import { describe, expect, it } from "vitest";
import type { Role } from "../src/index";
import { grant, roleName, schema } from "../src/index";

describe("branded Role", () => {
	it("roleName brands and grant().to() accepts Role and string mixed", () => {
		const app = schema("app");
		const anon: Role = roleName("anon");
		const set = grant(app).tables("select").to(anon, "authenticated");
		expect(set.grants.map((g) => g.role)).toEqual(["anon", "authenticated"]);
	});
});
