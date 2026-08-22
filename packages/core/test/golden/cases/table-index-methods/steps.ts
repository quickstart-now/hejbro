import type { HejbroInput } from "../../../../src/index";
import { index, jsonb, table, timestamptz, uuid } from "../../../../src/index";
import { app, docs } from "./declarations";

// Step 0: from empty — three non-btree indexes (gin/brin/hash, #284 US1).

const fromEmpty: ReadonlyArray<HejbroInput> = [app, docs];

// Step 1: docs_data_idx's method changes (gin -> hash) under the same
// name — exercises the drop + create path for a same-name index whose
// method changed (R9). The other two indexes are unchanged.

const docsMethodChanged = table(
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
			index("docs_data_idx").using("hash").on(t.data),
			index("docs_created_at_idx").using("brin").on(t.createdAt),
			index("docs_owner_id_idx").using("hash").on(t.ownerId),
		],
	}),
);

const methodChanged: ReadonlyArray<HejbroInput> = [app, docsMethodChanged];

export const steps: ReadonlyArray<ReadonlyArray<HejbroInput>> = [
	fromEmpty,
	methodChanged,
];
