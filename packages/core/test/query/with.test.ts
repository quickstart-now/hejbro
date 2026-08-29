import { describe, expect, it } from "vitest";
import type { ColumnRef, Expr, ReadAs } from "../../src/index";
import {
	eq,
	gt,
	over,
	renderQuery,
	rowNumber,
	schema,
	select,
	table,
	text,
	timestamptz,
	uuid,
	withCte,
} from "../../src/index";

const app = schema("app");
const posts = table(app, "posts", {
	id: uuid().primaryKey(),
	status: text().notNull(),
	publishedAt: timestamptz(),
});

describe("withCte() as a statement root (add-ctes task 3.1)", () => {
	it("a statement declares a named query and selects from it", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id }, ranked);
		});
		expect(renderQuery(stage.withQuery)).toBe(
			'with "ranked" as (select "id", "status", "published_at" from "app"."posts") select "ranked"."id" as "id" from "ranked"',
		);
	});

	it("a later entry can reference an earlier one, by holding its actual reference (Postgres's earlier-siblings rule, held by construction)", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			const filtered = w.as(
				"filtered",
				select({ id: ranked.id }, ranked).where(eq(ranked.id, ranked.id)),
			);
			return select({ id: filtered.id }, filtered);
		});
		expect(stage.withQuery.ctes.map((entry) => entry.name)).toEqual([
			"ranked",
			"filtered",
		]);
		expect(renderQuery(stage.withQuery)).toContain(
			'"filtered" as (select "ranked"."id" as "id" from "ranked" where "ranked"."id" = "ranked"."id")',
		);
	});
});

describe("select() accepts a CTE reference as its from-source (add-ctes task 3.3)", () => {
	it("select(…, cteRef) builds a select whose from is the reference", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id }, ranked);
		});
		expect(stage.withQuery.body).toMatchObject({
			from: { cteName: "ranked" },
		});
	});
});

describe("the named row environment (add-ctes task 3.2)", () => {
	it("a projected window alias keeps its read brand outside the CTE, and is filterable there", () => {
		const stage = withCte((w) => {
			const ranked = w.as(
				"ranked",
				select(
					{
						id: posts.id,
						rn: over(rowNumber(), { orderBy: [posts.publishedAt] }),
					},
					posts,
				),
			);
			return select({ id: ranked.id, rn: ranked.rn }, ranked).where(
				gt(ranked.rn, 1),
			);
		});
		// still a numeric family carrying ReadAs<bigint> -- not decayed to a
		// bare Expr<"unknown"> the way a hand-assembled columnRef would be.
		// This assignment only compiles if the brand survived the reference.
		const rn: Expr<"numeric"> & ReadAs<bigint> = stage.projectionInput.rn;
		expect(rn.family).toBe("numeric");
		expect(renderQuery(stage.withQuery)).toContain('where "ranked"."rn" > 1');
	});

	it("a column the entry's projection never mentions is not reachable, even though its source table declares it", () => {
		// Absent at both layers: the type has no `status` key (@ts-expect-error
		// below), and the runtime object has no such key either -- `eq()`
		// throws reading `.exprNode` off `undefined`, rather than silently
		// building a comparison against nothing.
		expect(() =>
			withCte((w) => {
				const ranked = w.as("ranked", select({ id: posts.id }, posts));
				return select({ id: ranked.id }, ranked).where(
					// @ts-expect-error `status` was projected by `posts`, but never
					// by `ranked`'s own entry query -- the row environment only
					// carries the keys the projection actually declared.
					eq(ranked.status, "draft"),
				);
			}),
		).toThrow(TypeError);
	});

	// add-ctes group 3: 1.2c's guard reached through a REAL withCte()
	// reference, not the hand-built one `cte-column-ref.test.ts` already
	// pins -- self-pinning against the type layer eroding silently (same
	// precedent as add-window-functions task 4.0b).
	it("a with() reference cannot spell a foreign key target -- unrepresentable at the type level, and the runtime guard still refuses a bypassed one", () => {
		const stage = withCte((w) => {
			const ranked = w.as("ranked", select(posts));
			return select({ id: ranked.id }, ranked);
		});
		const leaked = stage.projectionInput.id;
		// @ts-expect-error a with() reference carries no `typeNode`, so it
		// cannot structurally satisfy ColumnRef -- this is what "closes the
		// builder path" means (task 3.2). The cast below is the only way
		// past it, proving the runtime guard (1.2c) is still there to catch
		// exactly that bypass.
		const asColumnRef: ColumnRef<"uuid"> = leaked;
		expect(() =>
			table(app, "comments", {
				id: uuid().primaryKey(),
				postId: uuid()
					.notNull()
					.references(() => asColumnRef),
			}),
		).toThrow(
			expect.objectContaining({
				code: "foreign-column-ref",
				message: expect.stringContaining("ranked"),
			}),
		);
	});
});

describe("the materialized hint (add-ctes task 3.4)", () => {
	it("an entry declares materialized, not materialized, or neither", () => {
		const stage = withCte((w) => {
			const yes = w.as("yes", select(posts), { materialized: true });
			w.as("no", select(posts), { materialized: false });
			w.as("neither", select(posts));
			return select({ id: yes.id }, yes);
		});
		expect(stage.withQuery.ctes.map((entry) => entry.materialized)).toEqual([
			true,
			false,
			null,
		]);
		const rendered = renderQuery(stage.withQuery);
		expect(rendered).toContain('"yes" as materialized (');
		expect(rendered).toContain('"no" as not materialized (');
		expect(rendered).toContain('"neither" as (');
	});
});
