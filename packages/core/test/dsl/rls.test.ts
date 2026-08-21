import { describe, expect, it } from "vitest";
import { rls } from "../../src/dsl/rls";
import { schema } from "../../src/dsl/schema";
import { table } from "../../src/dsl/table";
import { eq, isNotNull, literal } from "../../src/expr/operators";
import { sql } from "../../src/expr/sql-template";
import {
	text,
	timestamptz,
	uuid,
} from "../../src/types/column-builder-factories";

const app = schema("app");
const posts = table(app, "posts", {
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
		expect(built.usingExpr).not.toBeNull();
		expect(built.withCheckExpr).toBeNull();
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
		expect(built.usingExpr).toBeNull();
		expect(built.withCheckExpr).not.toBeNull();
	});

	it("builds an update policy with both clauses in either order", () => {
		const one = rls
			.policy("update_own")
			.for("update")
			.to("authenticated")
			.using(eq(posts.status, "draft"))
			.withCheck(eq(posts.status, "draft"));
		expect(one.usingExpr).not.toBeNull();
		expect(one.withCheckExpr).not.toBeNull();
	});

	// Regression for a bug caught in review: `PolicyBothStage`'s stage
	// methods used to be `Object.assign`-ed onto the built `PolicyInput`
	// under the *same* names as its clause data fields (`using`/`withCheck`),
	// so ending an update/all chain after only one clause silently replaced
	// the other clause's `null` with a function. The data fields are now
	// `usingExpr`/`withCheckExpr` so they can never collide with the chain
	// method names.
	describe("update/all chains ended after a single clause (D26 regression)", () => {
		it.each([{ command: "update" as const }, { command: "all" as const }])(
			"$command: ending on .using() leaves withCheckExpr null, not a function",
			({ command }) => {
				const built = rls
					.policy("only_using")
					.for(command)
					.to("authenticated")
					.using(eq(posts.status, "draft"));
				expect(built.usingExpr).not.toBeNull();
				expect(built.withCheckExpr).toBeNull();
				expect(typeof built.withCheckExpr).not.toBe("function");
			},
		);

		it.each([{ command: "update" as const }, { command: "all" as const }])(
			"$command: ending on .withCheck() leaves usingExpr null, not a function",
			({ command }) => {
				const built = rls
					.policy("only_check")
					.for(command)
					.to("authenticated")
					.withCheck(eq(posts.status, "draft"));
				expect(built.withCheckExpr).not.toBeNull();
				expect(built.usingExpr).toBeNull();
				expect(typeof built.usingExpr).not.toBe("function");
			},
		);
	});

	// D50/D51 adopted `Expr<"boolean"> | Expr<"unknown">` for check()/.where()
	// so the sql template's Expr<"unknown"> result could be used directly;
	// #113 applies the same union here, a third time, not a new design.
	it("accepts an sql-template (Expr<unknown>) using/withCheck clause", () => {
		const built = rls
			.policy("posts_all_rows")
			.for("all")
			.to("authenticated")
			.using(sql`true`)
			.withCheck(sql`${posts.status} <> 'archived'`);
		expect(built.usingExpr).not.toBeNull();
		expect(built.withCheckExpr).not.toBeNull();
	});

	// #113: the boolean literal helper this issue adds -- reads as intent
	// ("allow every row") rather than the isNotNull(t.id) workaround it
	// replaces in examples/postgres.
	it("accepts literal(true) as a using/withCheck clause", () => {
		const built = rls
			.policy("posts_allow_all")
			.for("select")
			.to("anon")
			.using(literal(true));
		expect(built.usingExpr).not.toBeNull();
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
