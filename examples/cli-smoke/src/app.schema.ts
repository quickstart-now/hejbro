// Task 18 acceptance fixture: exercises the DSL entirely through the
// `hejbro` re-export (never `@hejbro/core` directly) — a schema, two
// tables, a foreign key, and an index, the shape `test/e2e.test.ts`
// drives `init`/`generate`/`verify` against.
import { index, schema, table, text, timestamp, uuid } from "hejbro";

export const shop = schema("shop");

export const customers = table(shop, "customers", {
	id: uuid().primaryKey().defaultRandom(),
	email: text().notNull(),
	createdAt: timestamp().notNull().defaultNow(),
});

export const orders = table(
	shop,
	"orders",
	{
		id: uuid().primaryKey().defaultRandom(),
		customerId: uuid().notNull(),
		placedAt: timestamp().notNull().defaultNow(),
	},
	(t) => ({
		foreignKeys: [
			{
				columns: [t.customerId],
				references: { table: customers, columns: [customers.id] },
				onDelete: "cascade",
			},
		],
		indexes: [index().on(t.customerId)],
	}),
);
