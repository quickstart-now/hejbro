import { HejbroError } from "@hejbro/core";
import type { CompileResult, Driver, DriverRow } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { LEDGER_SCHEMA, LEDGER_TABLE } from "../src/apply/ledger";
import type { LedgerIdentity } from "../src/apply/ledger-identity";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "../src/apply/ledger-identity";

/** `probeLedgerIdentity` has no one real caller here -- stands in for whichever of `status`/`migrate`/`reset`/`raise` actually calls it, the same convention `apply-execute.test.ts`'s own `NEXT_COMMAND` follows. */
const PROBE_COMMAND = "hejbro status";

/** One `pg_class`/`pg_attribute` row shape, as `probeLedgerIdentity`'s own statement returns it -- the fake driver's whole answer is a list of these. `persistence` (2.2, 783/R5) is `c.relpersistence`, repeated on every row the same way `relkind` is. */
type CatalogRow = {
	readonly relkind: string;
	readonly persistence: string;
	readonly name: string | null;
	readonly type: string | null;
	/** D106 round 1 NB1: `c.relispartition` and an existence check on `pg_inherits` -- a leaf partition and an inheritance child are `relkind = 'r'` yet never a table hejbro created; absent means false. */
	readonly partition?: boolean;
	readonly inherited?: boolean;
	/** [1.6, 631/R14] `c.relrowsecurity as "rls"`/`c.relforcerowsecurity as "forcedRls"` -- properties of the relation itself, repeated on every row the same way `relkind` is; absent means false. */
	readonly rls?: boolean;
	readonly forcedRls?: boolean;
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
		capabilities: {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async (compiled) => {
			calls.push(compiled);
			return rows as unknown as ReadonlyArray<DriverRow>;
		},
		transaction: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		batch: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		setupSession: async () => {},
	};
	return { driver, calls };
};

const LEDGER_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", persistence: "p", name: "id", type: "bigint" },
	{ relkind: "r", persistence: "p", name: "filename", type: "text" },
	{ relkind: "r", persistence: "p", name: "origin", type: "text" },
	{
		relkind: "r",
		persistence: "p",
		name: "applied_at",
		type: "timestamp with time zone",
	},
];

const LEDGER_WITH_NOTE_ROWS: ReadonlyArray<CatalogRow> = [
	...LEDGER_ROWS,
	{ relkind: "r", persistence: "p", name: "note", type: "text" },
];

/** [task 1.1, 631/R2] The bootstrap's own fifth column -- a ledger that already carries it (upgraded, or freshly bootstrapped) is still the ledger, exactly like any other extra column {@link LEDGER_WITH_NOTE_ROWS} already proves. */
const LEDGER_WITH_CHECKSUM_ROWS: ReadonlyArray<CatalogRow> = [
	...LEDGER_ROWS,
	{ relkind: "r", persistence: "p", name: "checksum", type: "text" },
];

const PARTIAL_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", persistence: "p", name: "id", type: "bigint" },
	{ relkind: "r", persistence: "p", name: "filename", type: "text" },
];

const WRONG_TYPE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", persistence: "p", name: "id", type: "bigint" },
	{ relkind: "r", persistence: "p", name: "filename", type: "integer" },
	{ relkind: "r", persistence: "p", name: "origin", type: "text" },
	{
		relkind: "r",
		persistence: "p",
		name: "applied_at",
		type: "timestamp with time zone",
	},
];

const UNRELATED_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", persistence: "p", name: "name", type: "text" },
	{ relkind: "r", persistence: "p", name: "payload", type: "jsonb" },
];

const VIEW_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "v", persistence: "p", name: "x", type: "integer" },
];

const VIEW_MATCHING_COLUMNS_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map(
	(row) => ({ ...row, relkind: "v" }),
);

const MATVIEW_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "m", persistence: "p", name: "x", type: "integer" },
];

const FOREIGN_TABLE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "f", persistence: "p", name: "x", type: "integer" },
];

const SEQUENCE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "S", persistence: "p", name: "last_value", type: "bigint" },
	{ relkind: "S", persistence: "p", name: "log_cnt", type: "bigint" },
	{ relkind: "S", persistence: "p", name: "is_called", type: "boolean" },
];

const PARTITIONED_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map((row) => ({
	...row,
	relkind: "p",
	persistence: "p",
}));

/** [2.1, review repair] A composite type carrying the ledger's own four columns -- `relkind` decides, not columns, same as the view/partitioned-table rows above. */
const COMPOSITE_TYPE_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map(
	(row) => ({ ...row, relkind: "c" }),
);

/** [2.1, review repair] An index -- `pg_attribute` lists an index's own indexed columns, one row per key column. */
const INDEX_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "i", persistence: "p", name: "id", type: "bigint" },
];

/** [2.1, review repair] A partitioned index -- same shape as an ordinary index, `relkind` "I". */
const PARTITIONED_INDEX_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "I", persistence: "p", name: "id", type: "bigint" },
];

/** [2.1, review repair] A TOAST table -- Postgres's own fixed three-column shape for any TOAST relation. */
const TOAST_TABLE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "t", persistence: "p", name: "chunk_id", type: "oid" },
	{ relkind: "t", persistence: "p", name: "chunk_seq", type: "integer" },
	{ relkind: "t", persistence: "p", name: "chunk_data", type: "bytea" },
];

/** [2.2, 783/R5] `relkind = 'r'` but `relpersistence = 'u'` -- the exact four bootstrap columns, but unlogged: rows vanish on a crash, so hejbro never creates one and it is not the ledger. */
const UNLOGGED_LEDGER_SHAPE_ROWS: ReadonlyArray<CatalogRow> = LEDGER_ROWS.map(
	(row) => ({ ...row, persistence: "u" }),
);

/** [2.2, 783/R5] A partitioned table that is also unlogged -- the prefix and the base word are independent facts; neither may swallow the other. */
const UNLOGGED_PARTITIONED_ROWS: ReadonlyArray<CatalogRow> =
	PARTITIONED_ROWS.map((row) => ({ ...row, persistence: "u" }));

/** [2.2, 783/R5] An ordinary table (`relkind = 'r'`, logged) with every column dropped -- `create table x ()`, or every column since dropped. `pg_attribute` returns no attribute rows at all; the one `pg_class` row survives the left join with a null `name`, filtered out by {@link isColumnRow}'s own counterpart in `ledger-identity.ts`. */
const ZERO_COLUMN_TABLE_ROWS: ReadonlyArray<CatalogRow> = [
	{ relkind: "r", persistence: "p", name: null, type: null },
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
			"the four bootstrap columns plus the checksum column (631/R2) -- a fifth column is still a ledger",
			LEDGER_WITH_CHECKSUM_ROWS,
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
		[
			"an unlogged table with the exact four bootstrap columns",
			UNLOGGED_LEDGER_SHAPE_ROWS,
			{
				kind: "occupied",
				relation: "unlogged table",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an unlogged partitioned table",
			UNLOGGED_PARTITIONED_ROWS,
			{
				kind: "occupied",
				relation: "unlogged partitioned table",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"a leaf partition carrying the four bootstrap columns (D106 round 1 NB1)",
			LEDGER_ROWS.map((row) => ({ ...row, partition: true })),
			{
				kind: "occupied",
				relation: "leaf partition",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an inheritance child carrying the four bootstrap columns (D106 round 1 NB1)",
			LEDGER_ROWS.map((row) => ({ ...row, inherited: true })),
			{
				kind: "occupied",
				relation: "inheritance child",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an unlogged inheritance child",
			LEDGER_ROWS.map((row) => ({
				...row,
				persistence: "u",
				inherited: true,
			})),
			{
				kind: "occupied",
				relation: "unlogged inheritance child",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"a partitioned table that is itself a partition (a middle level) keeps its own word",
			PARTITIONED_ROWS.map((row) => ({ ...row, partition: true })),
			{
				kind: "occupied",
				relation: "partitioned table",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"a relation kind this version does not name (D106 round 1 NB2): no catalog letter in the word",
			LEDGER_ROWS.map((row) => ({ ...row, relkind: "z" })),
			{
				kind: "occupied",
				relation: "relation of a kind this version does not name",
				columns: ["id", "filename", "origin", "applied_at"],
			},
		],
		[
			"an ordinary table with every column dropped",
			ZERO_COLUMN_TABLE_ROWS,
			{
				kind: "occupied",
				relation: "table",
				columns: [],
			},
		],
	])(
		"judges what sits at the ledger's name -- %s",
		async (_label, rows, expected) => {
			const { driver } = makeFakeCatalogDriver(rows);

			const identity = await probeLedgerIdentity(driver, PROBE_COMMAND);

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

		await probeLedgerIdentity(driver, PROBE_COMMAND);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql).toContain("pg_class");
		expect(calls[0]?.sql).not.toContain("information_schema");
		expect(calls[0]?.sql).not.toContain("to_regclass");
	});
});

/** A driver whose catalog read fails with `failError`, and whose `select current_user` (the classifier's own role read, D2) succeeds with a fixed role -- `transaction` still throws, matching {@link makeFakeCatalogDriver}'s own invariant. */
const makeFailingCatalogDriver = (
	failError: unknown,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async (compiled) => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select c.relkind")) {
				throw failError;
			}
			if (sql.startsWith("select current_user")) {
				return [
					{ currentUser: "ld_role" },
				] as unknown as ReadonlyArray<DriverRow>;
			}
			return [];
		},
		transaction: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		batch: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		setupSession: async () => {},
	};
	return { driver, calls };
};

describe("a refused catalog read is a coded diagnostic / 1.8 (harden-ledger-diagnostics)", () => {
	it.each<[string, unknown]>([
		[
			"42501, permission denied",
			Object.assign(new Error("permission denied for table pg_class"), {
				code: "42501",
			}),
		],
		["a bare error with no code", new Error("connection reset by peer")],
	])(
		"%s -> apply-ledger-unreadable naming the catalog read, not the ledger table itself",
		async (_label, failError) => {
			const { driver } = makeFailingCatalogDriver(failError);

			const error: unknown = await probeLedgerIdentity(
				driver,
				PROBE_COMMAND,
			).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(HejbroError);
			const hejbroErr = error as HejbroError;
			expect(hejbroErr.code).toBe("apply-ledger-unreadable");
			expect(hejbroErr.message).toContain("the catalog read that judges");
			expect(hejbroErr.message).toContain('"hejbro"."migration_ledger"');
			expect(hejbroErr.message).toMatch(/Next:/);
			expect(hejbroErr.message).toContain(PROBE_COMMAND);
			expect((hejbroErr as unknown as { readonly cause: unknown }).cause).toBe(
				failError,
			);
		},
	);

	it("regression: the four commands' existing probe rows still answer as today (absent/ledger/occupied unaffected)", async () => {
		const { driver: absentDriver } = makeFakeCatalogDriver([]);
		const { driver: ledgerDriver } = makeFakeCatalogDriver(LEDGER_ROWS);
		const { driver: occupiedDriver } = makeFakeCatalogDriver(UNRELATED_ROWS);

		await expect(
			probeLedgerIdentity(absentDriver, PROBE_COMMAND),
		).resolves.toEqual({ kind: "absent" });
		await expect(
			probeLedgerIdentity(ledgerDriver, PROBE_COMMAND),
		).resolves.toEqual({ kind: "ledger" });
		await expect(
			probeLedgerIdentity(occupiedDriver, PROBE_COMMAND),
		).resolves.toEqual({
			kind: "occupied",
			relation: "table",
			columns: ["name", "payload"],
		});
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

	it("names columns for an unlogged table, the prefix does not hide the clause", () => {
		const message = messageFor({
			kind: "occupied",
			relation: "unlogged table",
			columns: ["id", "filename", "origin", "applied_at"],
		});

		expect(message).toContain("(columns: id, filename, origin, applied_at)");
	});

	it('says "(no columns)" for a column-bearing kind with none found', () => {
		const message = messageFor({
			kind: "occupied",
			relation: "table",
			columns: [],
		});

		expect(message).toContain("(no columns)");
	});
});

describe("assertLedgerNotOccupied / 2.3, review repair of 8f44e927 -- the article agrees with the relation word", () => {
	const messageFor = (identity: LedgerIdentity): string => {
		try {
			assertLedgerNotOccupied(identity, "hejbro status");
			throw new Error("expected assertLedgerNotOccupied to throw");
		} catch (error) {
			return (error as Error).message;
		}
	};

	it('says "an index" (vowel-initial word)', () => {
		const message = messageFor({
			kind: "occupied",
			relation: "index",
			columns: ["id"],
		});

		expect(message).toContain("is held by an index");
	});

	it('says "an unlogged table" (vowel-initial prefix)', () => {
		const message = messageFor({
			kind: "occupied",
			relation: "unlogged table",
			columns: ["id", "filename", "origin", "applied_at"],
		});

		expect(message).toContain("is held by an unlogged table");
	});

	it('says "a partitioned index" (consonant-initial word, control)', () => {
		const message = messageFor({
			kind: "occupied",
			relation: "partitioned index",
			columns: ["id"],
		});

		expect(message).toContain("is held by a partitioned index");
	});
});

/**
 * [1.6, 631/R14] Answers the probe statement with `probeRows` and, only
 * when a second statement is sent (the policy list, matched on `pg_
 * policies` per {@link PROBE_SQL}'s own left-join convention), answers it
 * with one row per policy, `{ role, policy }` -- and one row with `policy:
 * null` when there is none, the same shape `PROBE_SQL`'s own left join
 * onto `pg_attribute` uses to keep the relation's own row even when it
 * has no columns. A single aggregated row (`array_agg`) was rejected: a
 * text-mode driver can hand an array back as text, and a quoted policy
 * name can itself contain a comma, so joining names into one string is
 * not reversible.
 */
/** [1.6, 631/R14] One `{ role, policy }` row per policy, or one row with `policy: null` when there is none -- mirrors the fake's own row shape for the second statement, never an aggregated array. */
const buildPolicyRows = (
	role: string,
	policyNames: ReadonlyArray<string>,
): ReadonlyArray<{ readonly role: string; readonly policy: string | null }> => {
	if (policyNames.length === 0) {
		return [{ role, policy: null }];
	}
	return policyNames.map((policy) => ({ role, policy }));
};

const makeFakeRlsDriver = (
	probeRows: ReadonlyArray<CatalogRow>,
	policies: {
		readonly policies: ReadonlyArray<string>;
		readonly role: string;
	},
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const policyRows = buildPolicyRows(policies.role, policies.policies);
	const driver: Driver = {
		capabilities: {
			"interactive-transactions": false,
			"session-state": false,
			"prepared-statements": false,
			"batched-transactions": false,
		},
		execute: async (compiled) => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select c.relkind")) {
				return probeRows as unknown as ReadonlyArray<DriverRow>;
			}
			if (sql.includes("pg_policies")) {
				return policyRows as unknown as ReadonlyArray<DriverRow>;
			}
			throw new Error(`unexpected statement sent to the fake: ${compiled.sql}`);
		},
		transaction: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		batch: async () => {
			throw new Error("probeLedgerIdentity must never open a transaction");
		},
		setupSession: async () => {},
	};
	return { driver, calls };
};

/** [1.6, 631/R14] {@link LEDGER_ROWS} with row-level security enabled, forced, or both -- everything else about the relation (shape, columns) is unchanged, since the filtered judgement only ever applies to a relation that already has the ledger's shape (R14(e), row 4 below). */
const rlsRows = (rls: boolean, forcedRls: boolean): ReadonlyArray<CatalogRow> =>
	LEDGER_ROWS.map((row) => ({ ...row, rls, forcedRls }));

describe("probeLedgerIdentity / 1.6, 631/R14 (filtered ledger)", () => {
	it("row 1: relrowsecurity alone -> filtered, state enabled, policies and role from the second statement", async () => {
		const { driver, calls } = makeFakeRlsDriver(rlsRows(true, false), {
			policies: ["p1", "p2"],
			role: "ld_role",
		});

		await expect(probeLedgerIdentity(driver, PROBE_COMMAND)).resolves.toEqual({
			kind: "filtered",
			state: "enabled",
			role: "ld_role",
			policies: ["p1", "p2"],
		});
		expect(calls).toHaveLength(2);
	});

	it("row 2: relforcerowsecurity alone -> filtered, state forced", async () => {
		const { driver } = makeFakeRlsDriver(rlsRows(false, true), {
			policies: ["p1"],
			role: "ld_role",
		});

		await expect(probeLedgerIdentity(driver, PROBE_COMMAND)).resolves.toEqual({
			kind: "filtered",
			state: "forced",
			role: "ld_role",
			policies: ["p1"],
		});
	});

	it("row 2b: both flags -> filtered, state 'enabled and forced'", async () => {
		const { driver } = makeFakeRlsDriver(rlsRows(true, true), {
			policies: ["p1"],
			role: "ld_role",
		});

		await expect(probeLedgerIdentity(driver, PROBE_COMMAND)).resolves.toEqual({
			kind: "filtered",
			state: "enabled and forced",
			role: "ld_role",
			policies: ["p1"],
		});
	});

	it("row 3 (control): neither flag -> ledger, unaffected", async () => {
		const { driver, calls } = makeFakeRlsDriver(rlsRows(false, false), {
			policies: [],
			role: "ld_role",
		});

		await expect(probeLedgerIdentity(driver, PROBE_COMMAND)).resolves.toEqual({
			kind: "ledger",
		});
		expect(calls).toHaveLength(1);
	});

	it("row 4: not the ledger's shape, RLS true -> occupied wins (631/R14(e))", async () => {
		const notLedgerShape = UNRELATED_ROWS.map((row) => ({
			...row,
			rls: true,
			forcedRls: false,
		}));
		const { driver } = makeFakeRlsDriver(notLedgerShape, {
			policies: ["p1"],
			role: "ld_role",
		});

		await expect(probeLedgerIdentity(driver, PROBE_COMMAND)).resolves.toEqual({
			kind: "occupied",
			relation: "table",
			columns: ["name", "payload"],
		});
	});

	it("row 7: neither flag -> no second statement is ever sent", async () => {
		const { driver, calls } = makeFakeRlsDriver(rlsRows(false, false), {
			policies: ["p1"],
			role: "ld_role",
		});

		await probeLedgerIdentity(driver, PROBE_COMMAND);

		expect(calls).toHaveLength(1);
		expect(calls.some((call) => call.sql.includes("pg_policies"))).toBe(false);
	});
});

describe("assertLedgerNotOccupied / 1.6, 631/R14 (apply-ledger-filtered message)", () => {
	const messageFor = (identity: LedgerIdentity): string => {
		try {
			assertLedgerNotOccupied(identity, "hejbro status");
			throw new Error("expected assertLedgerNotOccupied to throw");
		} catch (error) {
			return (error as Error).message;
		}
	};

	it("row 5: with policies -> the message names schema, table, state, role and each policy, verbatim", () => {
		const message = messageFor({
			kind: "filtered",
			state: "enabled",
			role: "ld_role",
			policies: ["p1", "p2"],
		});

		expect(message).toBe(
			`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" has row-level security enabled, and hejbro never turns it on for its own ledger. Rows this role cannot see read as a ledger that recorded nothing, and the next \`migrate\` would re-apply the chain from the start. The connecting role is "ld_role"; the policies on it are "p1", "p2". Next: disable row-level security on the ledger, or connect as the role that applied the chain, then rerun \`hejbro status\`.`,
		);
	});

	it("row 6: no policies -> the message states the default-deny sentence, verbatim", () => {
		const message = messageFor({
			kind: "filtered",
			state: "enabled and forced",
			role: "ld_role",
			policies: [],
		});

		expect(message).toBe(
			`"${LEDGER_SCHEMA}"."${LEDGER_TABLE}" has row-level security enabled and forced, and hejbro never turns it on for its own ledger. Rows this role cannot see read as a ledger that recorded nothing, and the next \`migrate\` would re-apply the chain from the start. The connecting role is "ld_role"; it carries no policy at all, so every row is hidden from that role. Next: disable row-level security on the ledger, or connect as the role that applied the chain, then rerun \`hejbro status\`.`,
		);
	});

	it("apply-ledger-filtered carries the code, same as apply-ledger-occupied's own convention", () => {
		try {
			assertLedgerNotOccupied(
				{ kind: "filtered", state: "enabled", role: "ld_role", policies: [] },
				"hejbro status",
			);
			throw new Error("expected assertLedgerNotOccupied to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(HejbroError);
			expect((error as HejbroError).code).toBe("apply-ledger-filtered");
		}
	});
});
