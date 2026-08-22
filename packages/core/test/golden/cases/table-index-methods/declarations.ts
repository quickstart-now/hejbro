import {
	index,
	jsonb,
	op,
	schema,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";

/** The table-index-methods acceptance case (#284 US1/US2, D85): non-btree access methods via `.using(method)` and per-column operator classes via `op(...)` — expression columns (US3) are added to this same case by that story. */
export const app = schema("app");

export const docs = table(
	app,
	"docs",
	{
		id: uuid().primaryKey().defaultRandom(),
		data: jsonb(),
		createdAt: timestamptz(),
		ownerId: uuid(),
		body: text(),
	},
	(t) => ({
		indexes: [
			index("docs_data_idx").using("gin").on(op(t.data, "jsonb_path_ops")),
			index("docs_created_at_idx").using("brin").on(t.createdAt),
			index("docs_owner_id_idx").using("hash").on(t.ownerId),
			index("docs_body_trgm_idx").using("gin").on(op(t.body, "gin_trgm_ops")),
		],
	}),
);
