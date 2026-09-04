import type { CompileResult, DriverRow, DriverSession } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type {
	LedgerAccessDirection,
	LedgerAccessSite,
} from "../src/apply/ledger";
import {
	asLedgerAccessFailure,
	bootstrapLedger,
	clearLedgerRows,
	isMigrationRecorded,
	readLedger,
	recordAppliedMigration,
} from "../src/apply/ledger";

/** One statement's answer: `rows` on success, or `throws` for the server failure `session.execute` raises -- `undefined` for `rows` on a throwing entry keeps each fixture down to the one field it actually uses. */
type StatementAnswer =
	| { readonly rows: ReadonlyArray<DriverRow> }
	| { readonly throws: unknown };

/** A fake `DriverSession` that answers each `execute` call from `answers`, one per call in order -- exhausting the list is a bug in the test, not a silent empty-rows fallback, so the test itself fails loudly rather than a later assertion failing for an unrelated reason. */
const makeScriptedSession = (
	answers: ReadonlyArray<StatementAnswer>,
): { readonly session: DriverSession; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			const answer = answers[calls.length];
			calls.push(compiled);
			if (answer === undefined) {
				throw new Error(
					`makeScriptedSession: no answer scripted for call ${calls.length} (${compiled.sql})`,
				);
			}
			if ("throws" in answer) {
				throw answer.throws;
			}
			return answer.rows;
		},
	};
	return { session, calls };
};

/** Postgres's own code for "the relation named in this statement does not exist" -- measured identical for a missing schema and a missing table (batch A2-4/A2-5). */
const permissionDeniedTable = () =>
	Object.assign(new Error("permission denied for table migration_ledger"), {
		code: "42501",
	});

const permissionDeniedSchema = () =>
	Object.assign(new Error("permission denied for schema hejbro"), {
		code: "42501",
	});

const undefinedTable = () =>
	Object.assign(
		new Error('relation "hejbro.migration_ledger" does not exist'),
		{ code: "42P01" },
	);

const bareError = () => new Error("connection reset by peer");

const permissionDeniedDatabase = () =>
	Object.assign(new Error("permission denied for database ldtest"), {
		code: "42501",
	});

const notNullViolation = () =>
	Object.assign(
		new Error(
			'null value in column "id" of relation "migration_ledger" violates not-null constraint',
		),
		{
			code: "23502",
			detail: "Failing row contains (null, 0001_init.sql, applied, now()).",
			column: "id",
		},
	);

const uniqueViolation = () =>
	Object.assign(
		new Error(
			'duplicate key value violates unique constraint "migration_ledger_filename_key"',
		),
		{ code: "23505" },
	);

const checkViolation = () =>
	Object.assign(
		new Error(
			'new row for relation "migration_ledger" violates check constraint "migration_ledger_filename_check"',
		),
		{ code: "23514" },
	);

const triggerRefusal = () =>
	Object.assign(new Error("ledger insert refused by policy trigger"), {
		code: "P0001",
	});

describe("a failed ledger statement says which statement failed / 1.1", () => {
	describe("readLedger", () => {
		it.each<[string, unknown, LedgerAccessDirection, LedgerAccessSite]>([
			["42501, select withheld", permissionDeniedTable(), "read", "read"],
			[
				"42501, schema usage withheld",
				permissionDeniedSchema(),
				"read",
				"read",
			],
			["a bare error with no code", bareError(), "read", "read"],
		])("%s -> tagged %s/%s", async (_label, error, direction, site) => {
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(readLedger(session)).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === direction &&
					tag.site === site &&
					tag.cause === error
				);
			});
		});

		it("42P01 keeps its {exists: false} leniency, not a failure", async () => {
			const { session } = makeScriptedSession([{ throws: undefinedTable() }]);

			await expect(readLedger(session)).resolves.toEqual({ exists: false });
		});

		it("success control: an ordinary read is not tagged at all", async () => {
			const { session } = makeScriptedSession([
				{ rows: [{ filename: "0001_init.sql", origin: "applied" }] },
			]);

			await expect(readLedger(session)).resolves.toEqual({
				exists: true,
				applied: [{ filename: "0001_init.sql", origin: "applied" }],
			});
		});
	});

	describe("isMigrationRecorded", () => {
		it("42501 is a tagged read failure at the recheck site", async () => {
			const error = permissionDeniedTable();
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(
				isMigrationRecorded(session, "0001_init.sql"),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "read" &&
					tag.site === "recheck" &&
					tag.cause === error
				);
			});
		});

		it("42P01 keeps its false leniency, not a failure", async () => {
			const { session } = makeScriptedSession([{ throws: undefinedTable() }]);

			await expect(isMigrationRecorded(session, "0001_init.sql")).resolves.toBe(
				false,
			);
		});

		it("success control: an ordinary recheck is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(isMigrationRecorded(session, "0001_init.sql")).resolves.toBe(
				false,
			);
		});
	});

	describe("bootstrapLedger", () => {
		it("42501 on create schema is a tagged write failure at the bootstrap site", async () => {
			const error = permissionDeniedDatabase();
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(bootstrapLedger(session)).rejects.toSatisfy(
				(thrown: unknown) => {
					const tag = asLedgerAccessFailure(thrown);
					return (
						tag !== null &&
						tag.direction === "write" &&
						tag.site === "bootstrap" &&
						tag.cause === error
					);
				},
			);
		});

		it("42501 on create table is a tagged write failure at the bootstrap site", async () => {
			const error = permissionDeniedSchema();
			const { session } = makeScriptedSession([
				{ rows: [] },
				{ throws: error },
			]);

			await expect(bootstrapLedger(session)).rejects.toSatisfy(
				(thrown: unknown) => {
					const tag = asLedgerAccessFailure(thrown);
					return (
						tag !== null &&
						tag.direction === "write" &&
						tag.site === "bootstrap" &&
						tag.cause === error
					);
				},
			);
		});

		it("success control: an ordinary bootstrap is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }, { rows: [] }]);

			await expect(bootstrapLedger(session)).resolves.toBeUndefined();
		});
	});

	describe("recordAppliedMigration", () => {
		it.each<[string, unknown]>([
			["23502, id has no identity or default", notNullViolation()],
			["42501, insert withheld", permissionDeniedTable()],
			["23505, filename already recorded", uniqueViolation()],
			["23514, a check constraint on the ledger", checkViolation()],
			["P0001, a trigger refuses the row", triggerRefusal()],
		])("%s -> tagged write failure at the row site", async (_label, error) => {
			const { session } = makeScriptedSession([{ throws: error }]);

			await expect(
				recordAppliedMigration(session, "0001_init.sql", "applied"),
			).rejects.toSatisfy((thrown: unknown) => {
				const tag = asLedgerAccessFailure(thrown);
				return (
					tag !== null &&
					tag.direction === "write" &&
					tag.site === "row" &&
					tag.cause === error
				);
			});
		});

		it("success control: an ordinary record is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(
				recordAppliedMigration(session, "0001_init.sql", "applied"),
			).resolves.toBeUndefined();
		});
	});

	describe("clearLedgerRows", () => {
		it.each<[string, unknown]>([
			["42501, delete withheld", permissionDeniedTable()],
			[
				"42P01, no leniency for clear -- the one caller already probed identity",
				undefinedTable(),
			],
		])(
			"%s -> tagged write failure at the clear site",
			async (_label, error) => {
				const { session } = makeScriptedSession([{ throws: error }]);

				await expect(clearLedgerRows(session)).rejects.toSatisfy(
					(thrown: unknown) => {
						const tag = asLedgerAccessFailure(thrown);
						return (
							tag !== null &&
							tag.direction === "write" &&
							tag.site === "clear" &&
							tag.cause === error
						);
					},
				);
			},
		);

		it("success control: an ordinary clear is not tagged at all", async () => {
			const { session } = makeScriptedSession([{ rows: [] }]);

			await expect(clearLedgerRows(session)).resolves.toBeUndefined();
		});
	});
});
