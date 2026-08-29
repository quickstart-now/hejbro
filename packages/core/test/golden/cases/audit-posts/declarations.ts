import {
	defineTrigger,
	insert,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** A minimal schema for the #426 acceptance case: a table whose updates are audited into a log table via an executed insert. */
export const app = schema("app");
export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});
export const auditLog = table(app, "audit_log", {
	id: uuid().primaryKey().defaultRandom(),
	tableName: text().notNull(),
	changedAt: timestamptz().notNull().defaultNow(),
});

/**
 * The #426 acceptance case: a trigger body that executes a statement for
 * its side effect (`ctx.execute`) and then returns the trigger row — the
 * form the issue asks for (`insert(auditLog).values(...)` inside a
 * trigger body, without losing the statement the way the pre-#426 body
 * silently did). The first body in the repository to do so.
 */
export const auditPosts = defineTrigger(
	posts,
	{
		name: "audit_posts",
		timing: "after",
		events: ["update"],
		forEach: "row",
		functionName: "audit_posts_changes",
	},
	(ctx, { new: row }) => {
		ctx.execute(insert(auditLog).values({ tableName: "posts" }));
		ctx.return(row);
	},
);
