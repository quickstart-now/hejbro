import type { CompileResult, Driver, DriverRow } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type { LedgerIdentity } from "../src/apply/ledger-identity";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "../src/apply/ledger-identity";

/** One `pg_class`/`pg_attribute` row shape, as `probeLedgerIdentity`'s own statement returns it -- the fake driver's whole answer is a list of these. */
type CatalogRow = {
	readonly relkind: string;
	readonly name: string | null;
	readonly type: string | null;
};

/**
 * A driver whose `execute` answers `probeLedgerIdentity`'s one statement
 * with `rows` and records every call -- `transaction` throws, so a probe
 * that opens one fails loudly rather than silently passing (design.md:
 * "one catalog read that opens no transaction").
 */
const makeFakeCatalogDriver = (
	rows: ReadonlyArray<CatalogRow>,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": false, "session-state": false },
		execute: async (compiled) => {
			calls.push(compiled);
			return rows as unknown as ReadonlyArray<DriverRow>;
		},
		transaction: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		setupSession: async () => {},
	};
	return { driver, calls };
};

const LEDGER_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", name: "id", type: "bigint" },
	{ relkind: "r", name: "filename", type: "text" },
	{ relkind: "r", name: "origin", type: "text" },
	{ relkind: "r", name: "applied_at", type: "timestamp with time zone" },
];

const LEDGER_WITH_NOTE_ROWS: ReadonlyArray<CatalogRow> = [
	...LEDGER_ROWS,
	{ relkind: "r", name: "note", type: "text" },
];

const PARTIAL_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", name: "id", type: "bigint" },
	{ relkind: "r", name: "filename", type: "text" },
];

const WRONG_TYPE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", name: "id", type: "bigint" },
	{ relkind: "r", name: "filename", type: "integer" },
	{ relkind: "r", name: "origin", type: "text" },
	{ relkind: "r", name: "applied_at", type: "timestamp with time zone" },
];

const UNRELATED_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", name: "name", type: "text" },
	{ relkind: "r", name: "payload", type: "jsonb" },
];

const VIEW_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "v", name: "x", type: "integer" },
];

const VIEW_MATCHING_COLUMNS_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map(
	(row) => ({ ...row, relkind: "v" }),
);

const MATVIEW_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "m", name: "x", type: "integer" },
];

const FOREIGN_TABLE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "f", name: "x", type: "integer" },
];

const SEQUENCE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "S", name: "last_value", type: "bigint" },
	{ relkind: "S", name: "log_cnt", type: "bigint" },
	{ relkind: "S", name: "is_called", type: "boolean" },
];

const PARTITIONED_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map((row) => ({
	...row,
	relkind: "p",
}));

/** [2.1, review repair] A composite type carrying the ledger's own four columns -- `relkind` decides, not columns, same as the view/partitioned-table rows above. */
const COMPOSITE_TYPE_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map(
	(row) => ({ ...row, relkind: "c" }),
);

/** [2.1, review repair] An index -- `pg_attribute` lists an index's own indexed columns, one row per key column. */
const INDEX_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "i", name: "id", type: "bigint" },
];

/** [2.1, review repair] A partitioned index -- same shape as an ordinary index, `relkind` "I". */
const PARTITIONED_INDEX_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "I", name: "id", type: "bigint" },
];

/** [2.1, review repair] A TOAST table -- Postgres's own fixed three-column shape for any TOAST relation. */
const TOAST_TABLE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "t", name: "chunk_id", type: "oid" },
	{ relkind: "t", name: "chunk_seq", type: "integer" },
	{ relkind: "t", name: "chunk_data", type: "bytea" },
];

describe("probeLedgerIdentity / 1.1", () => {
	it.each<[string, ReadonlyArray<CatalogRow>, LedgerIdentity]>([
		["no row", [], { kind: "absent" }],
		[
			"ordinary table, exactly the four bootstrap columns",
			LEDGER_ROWS,
			{
				kind: "ledger",
			},
		],
		[
			"the four bootstrap columns plus note text",
			LEDGER_WITH_NOTE_ROWS,
			{
				kind: "ledger",
			},
		],
		[
			"id, filename only",
			PARTIAL_ROWS,
			{
				kind: "occupied",
				relation: "table",
				columns: ["id", "filename"],
			},
		],
		[
			"all four names but filename integer",
			WRONG_TYPE_ROWS,
			{
				kind: "occupied",
				relation: "table",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an unrelated table (name, payload)",
			UNRELATED_ROWS,
			{
				kind: "occupied",
				relation: "table",
				columns: ["name", "payload"],
			},
		],
		[
			"a view with one column",
			VIEW_ROWS,
			{
				kind: "occupied",
				relation: "view",
				columns: ["x"],
			},
		],
		[
			"a view whose four columns match the ledger's names and types exactly",
			VIEW_MATCHING_COLUMNS_ROWS,
			{
				kind: "occupied",
				relation: "view",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"a materialized view",
			MATVIEW_ROWS,
			{
				kind: "occupied",
				relation: "materialized view",
				columns: ["x"],
			},
		],
		[
			"a foreign table",
			FOREIGN_TABLE_ROWS,
			{
				kind: "occupied",
				relation: "foreign table",
				columns: ["x"],
			},
		],
		[
			"a sequence",
			SEQUENCE_ROWS,
			{
				kind: "occupied",
				relation: "sequence",
				columns: ["last_value", "log_cnt", "is_called"],
			},
		],
		[
			"a partitioned table with the four columns in the same order and types",
			PARTITIONED_ROWS,
			{
				kind: "occupied",
				relation: "partitioned table",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"a composite type carrying the ledger's four columns",
			COMPOSITE_TYPE_ROWS,
			{
				kind: "occupied",
				relation: "composite type",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an index",
			INDEX_ROWS,
			{
				kind: "occupied",
				relation: "index",
				columns: ["id"],
			},
		],
		[
			"a partitioned index",
			PARTITIONED_INDEX_ROWS,
			{
				kind: "occupied",
				relation: "partitioned index",
				columns: ["id"],
			},
		],
		[
			"a TOAST table",
			TOAST_TABLE_ROWS,
			{
				kind: "occupied",
				relation: "TOAST table",
				columns: ["chunk_id", "chunk_seq", "chunk_data"],
			},
		],
	])(
		"judges what sits at the ledger's name -- %s",
		async (_label, rows, expected) => {
			const { driver } = makeFakeCatalogDriver(rows);

			const identity = await probeLedgerIdentity(driver);

			expect(identity).toEqual(expected);
			// [2.1, review repair] Every occupied case names a kind of object
			// in words, never a bare catalog letter.
			if (identity.kind === "occupied") {
				expect(identity.relation).not.toContain("(");
			}
		},
	);

	it("sends exactly one catalog statement and opens no transaction", async () => {
		const { driver, calls } = makeFakeCatalogDriver(LEDGER_ROWS);

		await probeLedgerIdentity(driver);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql).toContain("pg_class");
		expect(calls[0]?.sql).not.toContain("information_schema");
		expect(calls[0]?.sql).not.toContain("to_regclass");
	});
});

describe("assertLedgerNotOccupied / 2.1, 783/R5 -- the (columns: ...) clause", () => {
	const messageFor = (identity: LedgerIdentity): string => {
		try {
			assertLedgerNotOccupied(identity, "hejbro status");
			throw new Error("expected assertLedgerNotOccupied to throw");
		} catch (error) {
			return (error as Error).message;
		}
	};

	it("names columns for a table (a kind that carries them)", () => {
		const message = messageFor({
			kind: "occupied",
			relation: "table",
			columns: ["name", "payload"],
		});

		expect(message).toContain("(columns: name, payload)");
	});

	it("names no columns clause for a sequence (its catalog columns are internal)", () => {
		const message = messageFor({
			kind: "occupied",
			relation: "sequence",
			columns: ["last_value", "log_cnt", "is_called"],
		});

		expect(message).not.toContain("(columns:");
		expect(message).not.toContain("no columns");
		expect(message).toContain(
			"is held by a sequence that is not hejbro's ledger. hejbro reads",
		);
	});

	it("names no columns clause for an index", () => {
		const message = messageFor({
			kind: "occupied",
			relation: "index",
			columns: ["id"],
		});

		expect(message).not.toContain("(columns:");
	});
});
