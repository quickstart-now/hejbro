import type { HejbroInput } from "@hejbro/core";
import { grant, schema, table, uuid } from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import { buildFixturePayload } from "./support/contract-fixture";

const app = schema("app");

const ORIGIN = { commit: "abc123", exportHash: "sha256:deadbeef" };

/**
 * Role names travelling with the contract (5.8) is a **metadata**
 * property in this group: `contractMetadata.roles` carries exactly what
 * the schema declares, as a value a consumer reads and passes on. Real
 * acceptance/rejection of a role happens where a role is actually
 * enforced — `@hejbro/query`'s own runtime, reached through the
 * name-keyed client this group's own 5.10 already defers to R2-G6 (no
 * client exists yet to accept or reject anything through). This test
 * therefore proves the metadata half only; the functional half is
 * R2-G6's own proof, the same split 5.10 already made explicit.
 */
describe("role names travel with the contract (5.8)", () => {
	it("the exported roles are exactly what the schema declares", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const grantSet = grant(app).usage.to("authenticated");
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, grantSet];

		const payload = buildFixturePayload(declarations);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain('roles: ["authenticated"] as const');
	});

	it("omitting every grant leaves the role list empty, not omitted", () => {
		const posts = table(app, "posts", {
			id: uuid().primaryKey().defaultRandom(),
		});
		const payload = buildFixturePayload([app, posts]);
		const source = emitContract(payload, ORIGIN);

		expect(source).toContain("roles: [] as const");
	});
});
