import {
	bigint,
	defineFunction,
	insert,
	schema,
	select,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/db";
import { recordingTransactionalDriver } from "./recording-driver";

/**
 * #339: a column declared with a camelCase key produces a snake_case SQL
 * column, and every result row must arrive keyed by the DECLARED key —
 * the one the inferred row type promises — never the SQL name. Before
 * this fix, a whole-table select of `noteText` returned rows carrying
 * only `note_text`, so `row.noteText` read `undefined` with no error;
 * object projections lost the caller's alias the same way (core
 * snake_cased projection/returning aliases into the AST and the SQL).
 *
 * The driver rows below are keyed exactly as a real driver would key
 * them for the compiled SQL: SQL column names for the unaliased
 * whole-table/`returning()`/function column lists, and the rendered
 * alias for an object projection (post-fix, the caller's verbatim key —
 * `as "noteText"`).
 */

const app = schema("row_keys");

const notes = table(app, "notes", {
	id: uuid().primaryKey(),
	// two-word key: declared `noteText`, SQL `note_text` -- the defect's
	// trigger shape.
	noteText: text().notNull(),
	// conversion must still apply at the remapped key (mode 'number':
	// the driver's raw text becomes a number).
	wordCount: bigint({ mode: "number" }).notNull(),
});

const listNotes = defineFunction(
	app,
	"list_notes",
	{ returns: notes },
	(ctx) => {
		ctx.return(select(notes));
	},
);

const ID = "00000000-0000-0000-0000-000000000000";

/** One driver row keyed the way a real driver keys an UNALIASED column list: by SQL column name. */
const sqlNamedRow = {
	id: ID,
	// biome-ignore lint/style/useNamingConvention: note_text models the real driver row key for the snake_cased SQL column.
	note_text: "hi",
	// biome-ignore lint/style/useNamingConvention: word_count -- same as note_text above.
	word_count: "5",
};

/** The declared-shape row every surface must deliver: declared keys, converted values. */
const declaredRow = { id: ID, noteText: "hi", wordCount: 5 };

describe("result rows are keyed by declared column keys (#339)", () => {
	it("whole-table select: SQL-named driver keys arrive as declared keys, values converted", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [sqlNamedRow] });
		const handle = db({ notes }, driver);

		const rows = await handle.execute(select(notes));

		expect(rows).toEqual([declaredRow]);
		expect(rows[0]).not.toHaveProperty("note_text");
	});

	it("object projection: the caller's verbatim key is the row key, while the SQL label stays snake", async () => {
		const { driver } = recordingTransactionalDriver({
			// the rendered SQL label stays `as "note_text"` (snake, per
			// medium -- defineView derives view column names from the same
			// alias), so a real driver keys the raw row by it; the query
			// layer remaps to the caller's verbatim key.
			// biome-ignore lint/style/useNamingConvention: note_text models the real driver row key the snake_cased SQL label produces.
			rows: [{ note_text: "hi" }],
		});
		const handle = db({ notes }, driver);

		const rows = await handle.execute(
			select({ noteText: notes.noteText }, notes),
		);

		expect(rows).toEqual([{ noteText: "hi" }]);
	});

	it("whole-table returning(): SQL-named driver keys arrive as declared keys", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [sqlNamedRow] });
		const handle = db({ notes }, driver);

		const rows = await handle.execute(
			insert(notes)
				.values({ id: ID, noteText: "hi", wordCount: 5 })
				.returning(),
		);

		expect(rows).toEqual([declaredRow]);
		expect(rows[0]).not.toHaveProperty("word_count");
	});

	it("setof-table function call: SQL-named driver keys arrive as declared keys", async () => {
		const { driver } = recordingTransactionalDriver({ rows: [sqlNamedRow] });
		const handle = db({ notes, listNotes }, driver);

		const rows = await handle.fn.listNotes({});

		expect(rows).toEqual([declaredRow]);
	});
});
