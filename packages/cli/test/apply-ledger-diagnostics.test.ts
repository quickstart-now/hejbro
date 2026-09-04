import { HejbroError } from "@hejbro/core";
import type { CompileResult, Driver, DriverRow } from "@hejbro/query";
import { describe, expect, it } from "vitest";
import type {
	LedgerAccessDirection,
	LedgerAccessSite,
} from "../src/apply/ledger";
import {
	throwLedgerReadFailure,
	throwLedgerWriteFailure,
} from "../src/apply/ledger-diagnostics";

/** The exact shape `ledger.ts`'s own internal `exec` wrapper attaches on failure (task 1.1) -- built directly here rather than driven through a real `ledger.ts` call, since this module's own classifiers only ever need the tag's shape, never `ledger.ts`'s own statements or fake session. */
const taggedFailure = (
	direction: LedgerAccessDirection,
	site: LedgerAccessSite,
	cause: unknown,
): unknown =>
	Object.assign(new Error("ledger statement failed"), {
		direction,
		site,
		cause,
	});

/** One statement's answer: `rows` on success, or `throws` for the server failure `driver.execute` raises. */
type StatementAnswer =
	| { readonly rows: ReadonlyArray<DriverRow> }
	| { readonly throws: unknown };

/**
 * A fake `Driver` whose `execute` answers each call from `answers`, one per
 * call in order -- `transaction` throws if called at all, since neither
 * classifier under test may open one (design.md D4: the role read runs
 * only after the caller's own transaction has already rolled back, on the
 * driver's own top-level `execute`, never inside a fresh one this module
 * opens itself).
 */
const makeScriptedDriver = (
	answers: ReadonlyArray<StatementAnswer>,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const driver: Driver = {
		capabilities: { "interactive-transactions": false, "session-state": false },
		execute: async (compiled) => {
			const answer = answers[calls.length];
			calls.push(compiled);
			if (answer === undefined) {
				throw new Error(
					`makeScriptedDriver: no answer scripted for call ${calls.length} (${compiled.sql})`,
				);
			}
			if ("throws" in answer) {
				throw answer.throws;
			}
			return answer.rows;
		},
		transaction: async () => {
			throw new Error(
				"a ledger diagnostic classifier must never open a transaction",
			);
		},
		setupSession: async () => {},
	};
	return { driver, calls };
};

const permissionDeniedTable = () =>
	Object.assign(new Error("permission denied for table migration_ledger"), {
		code: "42501",
	});

const permissionDeniedSchema = () =>
	Object.assign(new Error("permission denied for schema hejbro"), {
		code: "42501",
	});

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

const notNullViolationNoColumn = () =>
	Object.assign(
		new Error(
			'null value in column "id" of relation "migration_ledger" violates not-null constraint',
		),
		{ code: "23502" },
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

const causeOf = (thrown: unknown): unknown =>
	(thrown as { readonly cause: unknown }).cause;

describe("a ledger read the server refuses is a coded diagnostic / 1.2", () => {
	const commandName = "hejbro status";

	it.each<[string, unknown, LedgerAccessSite]>([
		[
			"readLedger's own read, 42501 select withheld",
			permissionDeniedTable(),
			"read",
		],
		[
			"readLedger's own read, 42501 schema usage withheld",
			permissionDeniedSchema(),
			"read",
		],
		["readLedger's own read, a bare error with no code", bareError(), "read"],
		[
			"isMigrationRecorded's in-transaction recheck, 42501",
			permissionDeniedTable(),
			"recheck",
		],
	])(
		"%s -> apply-ledger-unreadable naming the role",
		async (_label, error, site) => {
			const failure = taggedFailure("read", site, error);
			const { driver } = makeScriptedDriver([
				{ rows: [{ currentUser: "ld_noselect" }] },
			]);

			await expect(
				throwLedgerReadFailure(driver, failure, commandName),
			).rejects.toSatisfy((thrown: unknown) => {
				if (!(thrown instanceof HejbroError)) {
					return false;
				}
				const code = (error as { readonly code?: unknown }).code;
				return (
					thrown.code === "apply-ledger-unreadable" &&
					thrown.message.includes('"hejbro"."migration_ledger"') &&
					thrown.message.includes('as the role "ld_noselect"') &&
					(code === undefined || thrown.message.includes(String(code))) &&
					thrown.message.includes((error as Error).message) &&
					/Next:/.test(thrown.message) &&
					thrown.message.includes(commandName) &&
					causeOf(thrown) === error
				);
			});
		},
	);

	it("omits the role clause, never fails twice, when select current_user itself fails", async () => {
		const error = permissionDeniedTable();
		const failure = taggedFailure("read", "read", error);
		const { driver } = makeScriptedDriver([
			{ throws: new Error("connection reset by peer") },
		]);

		await expect(
			throwLedgerReadFailure(driver, failure, commandName),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unreadable" &&
				// The fixed "connect as the role that applied" clause always
				// appears -- only the *naming* clause is conditional, so this
				// checks that specific clause, not the bare substring.
				!thrown.message.includes("could not be read as the role") &&
				thrown.message.includes("grant the connecting role") &&
				thrown.message.includes('"hejbro"."migration_ledger"') &&
				/Next:/.test(thrown.message) &&
				causeOf(thrown) === error
			);
		});
	});

	it("the classifier's own role read never opens a transaction (D4)", async () => {
		const failure = taggedFailure("read", "read", permissionDeniedTable());
		const { driver, calls } = makeScriptedDriver([
			{ rows: [{ currentUser: "ld_noselect" }] },
		]);

		await expect(
			throwLedgerReadFailure(driver, failure, commandName),
		).rejects.toBeInstanceOf(HejbroError);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql.toLowerCase()).toContain("current_user");
	});
});

describe("a ledger write the database refuses names the ledger and what was being written / 1.3", () => {
	const commandName = "hejbro migrate";

	it("bootstrap site, 42501 -> apply-ledger-unwritable naming the bootstrap, no migration mentioned", async () => {
		const error = permissionDeniedDatabase();
		const failure = taggedFailure("write", "bootstrap", error);
		const { driver } = makeScriptedDriver([
			{ rows: [{ currentUser: "ld_nocreatedb" }] },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, commandName),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unwritable" &&
				thrown.message.includes('"hejbro"."migration_ledger"') &&
				thrown.message.includes('as the role "ld_nocreatedb"') &&
				thrown.message.includes("42501") &&
				thrown.message.includes(error.message) &&
				thrown.message.includes("the ledger's own bootstrap") &&
				thrown.message.includes("no migration statement was sent.") &&
				/Next:/.test(thrown.message) &&
				causeOf(thrown) === error
			);
		});
	});

	it.each<[string, unknown]>([
		["42501, insert withheld", permissionDeniedTable()],
		["23505, filename already recorded", uniqueViolation()],
		["23514, a check constraint on the ledger", checkViolation()],
		["P0001, a trigger refuses the row", triggerRefusal()],
	])(
		"row site, %s -> apply-ledger-unwritable naming the row, generic branch (no 23502 sentence)",
		async (_label, error) => {
			const failure = taggedFailure("write", "row", error);
			const { driver } = makeScriptedDriver([
				{ rows: [{ currentUser: "ld_noinsert" }] },
			]);

			await expect(
				throwLedgerWriteFailure(driver, failure, commandName, "0001_init.sql"),
			).rejects.toSatisfy((thrown: unknown) => {
				if (!(thrown instanceof HejbroError)) {
					return false;
				}
				return (
					thrown.code === "apply-ledger-unwritable" &&
					thrown.message.includes('the row recording "0001_init.sql"') &&
					thrown.message.includes(
						'the migration ran in the same transaction and rolled back with it, so nothing from "0001_init.sql" is applied and the ledger records nothing new.',
					) &&
					!thrown.message.includes("no identity and no default") &&
					/Next:/.test(thrown.message) &&
					causeOf(thrown) === error
				);
			});
		},
	);

	it("row site, 23502 with .column -> the identity/default sentence, naming the column", async () => {
		const error = notNullViolation();
		const failure = taggedFailure("write", "row", error);
		const { driver } = makeScriptedDriver([
			{ rows: [{ currentUser: "postgres" }] },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, commandName, "0001_init.sql"),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unwritable" &&
				thrown.message.includes(
					'The ledger\'s "id" column has no identity and no default',
				) &&
				thrown.message.includes("generated always as identity") &&
				thrown.message.includes('the row recording "0001_init.sql"') &&
				causeOf(thrown) === error
			);
		});
	});

	it("row site, 23502 with no .column field -> the generic identity/default sentence, no column name claimed", async () => {
		const error = notNullViolationNoColumn();
		const failure = taggedFailure("write", "row", error);
		const { driver } = makeScriptedDriver([
			{ rows: [{ currentUser: "postgres" }] },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, commandName, "0001_init.sql"),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unwritable" &&
				thrown.message.includes("has no identity and no default") &&
				thrown.message.includes("generated always as identity") &&
				!thrown.message.includes('The ledger\'s "id" column') &&
				causeOf(thrown) === error
			);
		});
	});

	it("clear site, 42501 -> apply-ledger-unwritable naming the clearing, drops-rolled-back sentence", async () => {
		const error = permissionDeniedTable();
		const failure = taggedFailure("write", "clear", error);
		const { driver } = makeScriptedDriver([
			{ rows: [{ currentUser: "ld_noinsert" }] },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, "hejbro reset"),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unwritable" &&
				thrown.message.includes("the clearing of the ledger's rows") &&
				thrown.message.includes(
					"the drops ran in the same transaction and rolled back with it, so every declared object is still standing.",
				) &&
				/Next:/.test(thrown.message) &&
				causeOf(thrown) === error
			);
		});
	});

	it("omits the role clause, never fails twice, when select current_user itself fails", async () => {
		const error = permissionDeniedTable();
		const failure = taggedFailure("write", "clear", error);
		const { driver } = makeScriptedDriver([
			{ throws: new Error("connection reset by peer") },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, "hejbro reset"),
		).rejects.toSatisfy((thrown: unknown) => {
			if (!(thrown instanceof HejbroError)) {
				return false;
			}
			return (
				thrown.code === "apply-ledger-unwritable" &&
				!thrown.message.includes("was refused as the role") &&
				thrown.message.includes("was refused (42501)") &&
				/Next:/.test(thrown.message)
			);
		});
	});

	it("the classifier's own role read never opens a transaction (D4)", async () => {
		const failure = taggedFailure("write", "clear", permissionDeniedTable());
		const { driver, calls } = makeScriptedDriver([
			{ rows: [{ currentUser: "ld_noinsert" }] },
		]);

		await expect(
			throwLedgerWriteFailure(driver, failure, "hejbro reset"),
		).rejects.toBeInstanceOf(HejbroError);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.sql.toLowerCase()).toContain("current_user");
	});
});
