import {
	defineView,
	emptySnapshot,
	eq,
	generateMigration,
	grant,
	rls,
	schema,
	select,
	table,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { supabaseValidators } from "../src/index";
import { rlsUncachedAuthCallValidator } from "../src/validators/rls-uncached-auth-call";
import { viewSecurityInvokerValidator } from "../src/validators/view-security-invoker";

describe("viewSecurityInvokerValidator", () => {
	const app = schema("app");
	const posts = table(app, "posts", { id: uuid().primaryKey() }, (t) => ({
		rls: rls.enabled({
			read: rls
				.policy("posts_read")
				.for("select")
				.to("anon")
				.using(eq(t.id, t.id)),
		}),
	}));
	const comments = table(app, "comments", { id: uuid().primaryKey() });
	// posts's own RLS policy targets "anon" -- #203's schema-usage check
	// would otherwise also warn here, which isn't what these tests exercise.
	const usageGrant = grant(app).usage.to("anon");

	it("warns when a view's from-table is RLS-protected and omits security_invoker", () => {
		const view = defineView(app, "recent_posts", select(posts));
		const result = generateMigration({
			declarations: [app, posts, usageGrant, view],
			previousSnapshot: emptySnapshot,
			validators: [viewSecurityInvokerValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe(
			"view-over-rls-without-security-invoker",
		);
		expect(result.warnings[0]?.message).toContain('"app"."recent_posts"');
		expect(result.warnings[0]?.message).toContain('"app"."posts"');
	});

	it("does not warn when securityInvoker: true is passed", () => {
		const view = defineView(app, "recent_posts", select(posts), {
			securityInvoker: true,
		});
		const result = generateMigration({
			declarations: [app, posts, usageGrant, view],
			previousSnapshot: emptySnapshot,
			validators: [viewSecurityInvokerValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("does not warn when the from-table has no RLS", () => {
		const view = defineView(app, "all_comments", select(comments));
		const result = generateMigration({
			declarations: [app, comments, view],
			previousSnapshot: emptySnapshot,
			validators: [viewSecurityInvokerValidator],
		});
		expect(result.warnings).toEqual([]);
	});

	it("warns when a joined (not from) table is RLS-protected", () => {
		const view = defineView(
			app,
			"comments_with_post",
			select(comments).innerJoin(posts, eq(comments.id, posts.id)),
		);
		const result = generateMigration({
			declarations: [app, posts, comments, usageGrant, view],
			previousSnapshot: emptySnapshot,
			validators: [viewSecurityInvokerValidator],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]?.code).toBe(
			"view-over-rls-without-security-invoker",
		);
	});
});

describe("supabaseValidators", () => {
	it("runs the reserved-schema, exposed-table, view-security-invoker, and rls-uncached-auth-call validators, in that order", () => {
		expect(supabaseValidators).toHaveLength(4);
		expect(supabaseValidators[2]).toBe(viewSecurityInvokerValidator);
		expect(supabaseValidators[3]).toBe(rlsUncachedAuthCallValidator);
	});
});
