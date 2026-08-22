import type { HejbroInput } from "../../../../src/index";
import {
	index,
	jsonb,
	op,
	table,
	text,
	timestamptz,
	uuid,
} from "../../../../src/index";
import { app, docs } from "./declarations";

// Step 0: from empty — non-btree access methods (gin/brin/hash, #284 US1)
// and per-column operator classes (jsonb_path_ops/gin_trgm_ops, #284 US2).

const fromEmpty: ReadonlyArray<HejbroInput> = [app, docs];

// Step 1: docs_data_idx's opclass is dropped (jsonb_path_ops -> none) under
// the same name and the same method (gin) — exercises the drop + create
// path for a same-name index whose opclass changed (R9). Matches
// contracts/sql.md's step-1 shape exactly (`using gin ("data")`, no
// opclass). The other three indexes are unchanged.

const docsOpclassChanged = table(
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
			index("docs_data_idx").using("gin").on(t.data),
			index("docs_created_at_idx").using("brin").on(t.createdAt),
			index("docs_owner_id_idx").using("hash").on(t.ownerId),
			index("docs_body_trgm_idx").using("gin").on(op(t.body, "gin_trgm_ops")),
		],
	}),
);

const opclassChanged: ReadonlyArray<HejbroInput> = [app, docsOpclassChanged];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	opclassChanged,
];
