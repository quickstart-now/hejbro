import {
	index,
	jsonb,
	schema,
	table,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** The table-index-methods acceptance case (#284 US1, D85): non-btree access methods via `.using(method)` — opclass (US2) and expression (US3) columns are added to this same case by their own stories. */
export const app = schema("app");

export const docs = table(
	app,
	"docs",
	{
		id: uuid().primaryKey().defaultRandom(),
		data: jsonb(),
		createdAt: timestamptz(),
		ownerId: uuid(),
	},
	(t) => ({
		indexes: [
			index("docs_data_idx").using("gin").on(t.data),
			index("docs_created_at_idx").using("brin").on(t.createdAt),
			index("docs_owner_id_idx").using("hash").on(t.ownerId),
		],
	}),
);
