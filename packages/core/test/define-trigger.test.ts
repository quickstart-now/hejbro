import { describe, expect, it } from "vitest";
import { defineTrigger, schema, table, uuid } from "../src/index";

const app = schema("app");
const comments = table(app, "comments", {
	id: uuid().primaryKey(),
	postId: uuid().notNull(),
});

// #154 ratchet-5: resolveEvent's unknown-trigger-column guard (a typo, or a
// column renamed since the trigger was written) was never exercised --
// every existing defineTrigger test's update-of event list only ever named
// real columns. Bare "delete" and bare (whole-row) "update" were likewise
// never used by any existing trigger test (every one used "insert" or the
// {update: [...]} column-scoped form).
describe("defineTrigger — update-of event column validation", () => {
	it("throws unknown-trigger-column when the update-of list names a column the table doesn't have", () => {
		expect(() =>
			defineTrigger(
				comments,
				{
					name: "comments_touch",
					timing: "before",
					events: [{ update: ["title"] }],
					forEach: "row",
				},
				(ctx, { new: row }) => {
					ctx.return(row);
				},
			),
		).toThrowError(
			'trigger "comments_touch" on "app.comments" lists unknown column "title" in its update-of event list. Next: use one of the columns declared on this table\'s table() call — this is usually a typo in "title", or a column that was renamed since this trigger was written.',
		);
	});

	it("accepts a bare delete event", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "comments_gc",
				timing: "after",
				events: ["delete"],
				forEach: "row",
			},
			(ctx, { old: row }) => {
				ctx.return(row);
			},
		);
		expect(trigger.events).toEqual([{ event: "delete" }]);
	});

	it("accepts a bare (whole-row) update event", () => {
		const trigger = defineTrigger(
			comments,
			{
				name: "comments_touch_any",
				timing: "before",
				events: ["update"],
				forEach: "row",
			},
			(ctx, { new: row }) => {
				ctx.return(row);
			},
		);
		expect(trigger.events).toEqual([{ event: "update", columns: null }]);
	});
});
