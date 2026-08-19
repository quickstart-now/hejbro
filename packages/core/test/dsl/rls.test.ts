import { describe, expect, it } from "vitest";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import { eq, isNotNull } from "../../src/expr/operators";
import {
	text,
	timestamptz,
	uuid,
} from "../../src/types/column-builder-factories";

const ddland = schema("ddland");
const posts = table(ddland, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("rls.policy chain", () => {
	it("builds a select policy with using", () => {
		const built = rls
			.policy("posts_read_published")
			.for("select")
			.to("anon")
			.using(isNotNull(posts.publishedAt));
		expect(built.policyInputKind).toBe("policy");
		expect(built.policyName).toBe("posts_read_published");
		expect(built.permissive).toBe(true);
		expect(built.command).toBe("select");
		expect(built.roles).toEqual(["anon"]);
		expect(built.using).not.toBeNull();
		expect(built.withCheck).toBeNull();
	});

	it("builds a restrictive insert policy with withCheck", () => {
		const built = rls
			.policy("insert_gate")
			.as("restrictive")
			.for("insert")
			.to("authenticated")
			.withCheck(eq(posts.status, "draft"));
		expect(built.permissive).toBe(false);
		expect(built.command).toBe("insert");
		expect(built.using).toBeNull();
		expect(built.withCheck).not.toBeNull();
	});

	it("builds an update policy with both clauses in either order", () => {
		const one = rls
			.policy("update_own")
			.for("update")
			.to("authenticated")
			.using(eq(posts.status, "draft"))
			.withCheck(eq(posts.status, "draft"));
		expect(one.using).not.toBeNull();
		expect(one.withCheck).not.toBeNull();
	});

	it("rejects .to() with no roles", () => {
		expect(() => rls.policy("p").for("select").to()).toThrowError(
			expect.objectContaining({ code: "rls-policy-missing-roles" }),
		);
	});

	it("select policies do not expose withCheck (type-level)", () => {
		const stage = rls.policy("p").for("select").to("anon");
		// @ts-expect-error select policies cannot take a with-check clause
		const bad = () => stage.withCheck;
		expect(bad).toBeDefined();
		const insertStage = rls.policy("p").for("insert").to("anon");
		// @ts-expect-error insert policies cannot take a using clause
		const alsoBad = () => insertStage.using;
		expect(alsoBad).toBeDefined();
	});
});

describe("rls.enabled", () => {
	it("wraps policies with force defaulting to false", () => {
		const input = rls.enabled({
			read: rls
				.policy("posts_read_published")
				.for("select")
				.to("anon")
				.using(isNotNull(posts.publishedAt)),
		});
		expect(input.rlsInputKind).toBe("rls");
		expect(input.force).toBe(false);
		expect(Object.keys(input.policies)).toEqual(["read"]);
	});

	it("accepts force: true", () => {
		expect(rls.enabled({}, { force: true }).force).toBe(true);
	});
});
