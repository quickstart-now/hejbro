import { describe, expect, it } from "vitest";
import {
	defineTrigger,
	eq,
	schema,
	select,
	table,
	uuid,
} from "../../src/index";

const ddland = schema("ddland");
const comments = table(ddland, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
	parentId: uuid(),
});

const triggerConfig = {
	name: "comments_single_depth",
	timing: "before" as const,
	events: ["insert"] as const,
	forEach: "row" as const,
};

describe("double-execution determinism guard", () => {
	it("accepts a deterministic body (runs it exactly twice)", () => {
		const runs: Array<number> = [];
		defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
			runs.push(1);
			ctx.return(row);
		});
		expect(runs).toHaveLength(2);
	});

	it("throws nondeterministic-body when the two trees differ", () => {
		const flips: Array<number> = [];
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				flips.push(1);
				if (flips.length === 1) {
					ctx.raise("only on the first run");
				}
				ctx.return(row);
			}),
		).toThrowError(/produced two different recorded ASTs/);
	});

	it("throws nondeterministic-body when a forEach body varies across runs", () => {
		const flips: Array<number> = [];
		expect(() =>
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.forEach(
					select(comments).where(eq(comments.parentId, row.id)),
					() => {
						flips.push(1);
						if (flips.length === 1) {
							ctx.raise("only on the first run");
						}
					},
				);
				ctx.return(row);
			}),
		).toThrowError(/produced two different recorded ASTs/);
	});

	it("attaches identity and best-effort declaredAt to the error", () => {
		try {
			defineTrigger(comments, triggerConfig, (ctx, { new: row }) => {
				ctx.raise(`${Math.random()}`);
				ctx.return(row);
			});
			throw new Error("expected defineTrigger to throw");
		} catch (error) {
			expect(error).toMatchObject({ code: "nondeterministic-body" });
			expect((error as { message: string }).message).toContain(
				"ddland.comments.comments_single_depth",
			);
			const declaredAt = (error as { declaredAt: string | null }).declaredAt;
			if (declaredAt !== null) {
				expect(declaredAt).toContain("guard.test.ts");
			}
			expect(declaredAt === null || typeof declaredAt === "string").toBe(true);
		}
	});
});
