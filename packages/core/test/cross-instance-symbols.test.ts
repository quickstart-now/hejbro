import { describe, expect, it } from "vitest";
import { defineTrigger } from "../src/dsl/define-trigger";
import { schema } from "../src/dsl/schema";
import { isTable, table } from "../src/dsl/table";
import { uuid } from "../src/types/column-builder-factories";
import { withDuplicateCoreInstance } from "./support/cross-instance";

// phase8-symbol-for (#138): tableMeta/triggerRowMeta are `Symbol("...")`,
// unique per module instance even with identical descriptions — two
// installed copies of @hejbro/core (a real, if rare, package-manager
// outcome, e.g. a version-conflict-driven nested install) produce two
// different symbols for the "same" hidden key. `withDuplicateCoreInstance`
// reproduces this precisely (physically distinct dist/index.js copies —
// confirmed two symlinks to the *same* file do NOT reproduce it, since
// Node's module cache dedupes by resolved real path).

describe("cross-instance symbol identity (#138)", () => {
	it("core's own isTable() fails to recognize a table built by a different core instance (pre-Symbol.for)", async () => {
		await withDuplicateCoreInstance((duplicateCore) => {
			const app = duplicateCore.schema("app");
			const posts = duplicateCore.table(app, "posts", {
				id: duplicateCore.uuid().primaryKey(),
			});
			// This is core's OWN isTable, not the CLI loader's fallback —
			// exercised directly, independent of any loader-side workaround.
			expect(isTable(posts)).toBe(true);
		});
	});

	it("a foreign key referencing a cross-instance existingTable (the authUsers shape) does not crash with a raw TypeError", async () => {
		await withDuplicateCoreInstance((duplicateCore) => {
			// Stands in for `@hejbro/supabase`'s authUsers: built via a
			// different core instance than the table that references it,
			// exactly like a peer-dependency-driven duplicate install would
			// produce in practice.
			const authUsers = duplicateCore.existingTable("auth", "users", {
				id: duplicateCore.uuid().primaryKey(),
			});

			const app = schema("app");
			expect(() =>
				table(app, "posts", { userId: uuid() }, (t) => ({
					foreignKeys: [
						{
							columns: [t.userId],
							references: { table: authUsers, columns: [authUsers.id] },
						},
					],
				})),
			).not.toThrow();
		});
	});

	// Reproduces as a tableMeta failure, not a triggerRowMeta one:
	// defineTrigger reads the target's meta before any row reference
	// exists, so the earlier (unguarded) getTableMeta lookup fails first
	// and louder — triggerRowMeta's own check is never reached. Locked in
	// here anyway because it's the closest thing to a "trigger path"
	// regression guard this API surface allows; triggerRowMeta's own
	// conversion is defensive, not a fix for a demonstrated independent
	// bug — see the comment on its declaration in body-context.ts.
	it("defineTrigger on a cross-instance table does not crash with a raw TypeError", async () => {
		await withDuplicateCoreInstance((duplicateCore) => {
			const app = duplicateCore.schema("app");
			const posts = duplicateCore.table(app, "posts", {
				id: duplicateCore.uuid().primaryKey(),
			});
			expect(() =>
				defineTrigger(
					posts,
					{
						name: "t",
						timing: "before",
						events: ["insert"],
						forEach: "row",
					},
					(ctx, rows) => {
						ctx.return(rows.new);
					},
				),
			).not.toThrow();
		});
	});
});
