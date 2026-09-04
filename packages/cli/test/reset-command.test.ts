import {
	buildSnapshot,
	createDefaultRegistry,
	emptySnapshot,
	getTableMeta,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type {
	CompileResult,
	Driver,
	DriverCapabilities,
	DriverSession,
} from "@hejbro/query";
import { describe, expect, it } from "vitest";
import { applyResetReport } from "../src/commands/reset";

// Declarations and the fake driver are built directly from `@hejbro/core`
// (no `loadDeclarations`/jiti fixture) -- exactly `apply-reset.test.ts`'s
// own approach, and for the same reason: a jiti-loaded fixture file
// resolves a *different* `@hejbro/core` module instance than this
// vitest-aliased one, which would make `isTable()` silently misclassify
// the fixture's own declarations (`test/support/cli-runner.ts`'s own
// documented finding). `applyResetReport` is `commands/reset.ts`'s own
// split for exactly this: the connected half, testable without touching
// the filesystem at all (`runReset` above it is the one caller that
// reads real declarations off disk, and is not tested directly here,
// mirroring `check.ts`'s own `runCheck`).
const registry = createDefaultRegistry();
const app = schema("app");
const managedSnapshot = buildSnapshot(
	[app, getTableMeta(table(app, "managed", { id: uuid().primaryKey() }))],
	registry,
	emptySnapshot,
);

/** The four bootstrap columns, exactly as `bootstrapLedger` creates them -- the fake's answer to the identity probe when `ledgerExists` is true. */
const LEDGER_PROBE_ROWS = [
	{ relkind: "r", name: "id", type: "bigint" },
	{ relkind: "r", name: "filename", type: "text" },
	{ relkind: "r", name: "origin", type: "text" },
	{ relkind: "r", name: "applied_at", type: "timestamp with time zone" },
];

/**
 * `ledgerExists` (D106 R1, B1, #753 reopened; harden-ledger-identity, 1.2):
 * answers `probeLedgerIdentity`'s own catalog statement -- `false` (the
 * default) mirrors a database whose migrations were all applied without
 * `hejbro migrate` ever running, so `applyReset` reports `ledgerCleared:
 * false` and `commands/reset.ts`'s own success line drops its "and
 * cleared the ledger" clause.
 */
const makeFakeDriver = (
	databaseName = "testdb",
	capabilities?: DriverCapabilities,
	ledgerExists = false,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select current_database()")) {
				return [{ name: databaseName }];
			}
			if (sql.startsWith("select c.relkind")) {
				if (ledgerExists) {
					return LEDGER_PROBE_ROWS;
				}
				return [];
			}
			return [];
		},
	};
	const driver: Driver = {
		capabilities: capabilities ?? {
			"interactive-transactions": true,
			"session-state": true,
		},
		execute: session.execute,
		transaction: async (callback) => callback(session),
		setupSession: async () => {},
	};
	return { driver, calls };
};

describe("applyResetReport / 7.7", () => {
	it("refuses without confirmation", async () => {
		const { driver } = makeFakeDriver();

		await expect(
			applyResetReport(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
	});

	it("succeeds with the exact database-and-count confirmation", async () => {
		const { driver } = makeFakeDriver("testdb");

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain("dropped");
	});

	// [task 4.1, D106 R1, B1, #753 reopened] The success line's own wording
	// pin, both directions: `commands/reset.ts` now builds it from
	// `applyReset`'s own `ledgerCleared`, never a fixed string, so both
	// outcomes need their own byte-exact assertion.
	it("does not claim the ledger was cleared when it never existed", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, false);

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.stdout).toEqual([
			"reset: dropped every object your declarations manage. There was no hejbro ledger to clear.",
		]);
	});

	it("claims the ledger was cleared when it existed", async () => {
		const { driver } = makeFakeDriver("testdb", undefined, true);

		const result = await applyResetReport(
			driver,
			managedSnapshot,
			registry,
			"testdb:2",
		);

		expect(result.stdout).toEqual([
			"reset: dropped every object your declarations manage, and cleared the ledger.",
		]);
	});

	it("refuses a driver without interactive transactions, before ever confirming", async () => {
		const { driver, calls } = makeFakeDriver("testdb", {
			"interactive-transactions": false,
			"session-state": false,
		});

		await expect(
			applyResetReport(driver, managedSnapshot, registry, "testdb:2"),
		).rejects.toMatchObject({ code: "apply-missing-capability" });
		// Refused before anything was even sent -- not even the
		// current_database() probe that a real confirmation check needs.
		expect(calls).toHaveLength(0);
	});
});

describe("applyResetReport / 18.1 (D106 M6)", () => {
	it("refuses a declaration set that exports nothing", async () => {
		const { driver, calls } = makeFakeDriver();

		await expect(
			applyResetReport(driver, emptySnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-declarations-empty" });
		// Not even current_database() went out -- a misconfigured entry
		// pattern refuses before the confirmation check that would need it.
		expect(calls).toHaveLength(0);
	});

	// Arrives green: `assertResetConfirmed` already throws before
	// `driver.transaction` ever runs whenever `changes.length > 0`, so
	// this is a pin (D106 M6 wants it named as a scenario), not a red.
	// Measured, not assumed: the branch-move mutant (moving `clearLedgerRows`
	// back outside the `changes.length > 0` branch) does NOT turn this
	// test red -- `assertResetConfirmed`'s refusal for a non-empty
	// `changes` set happens before the transaction runs regardless of
	// where `clearLedgerRows` sits inside it, so this scenario alone cannot
	// discriminate the branch move. See the completion report for what
	// does: `changes.length === 0` is unreachable from a non-empty
	// declaration set (every registered kind reports "drop" when an
	// object disappears), so the branch move is unreachable structural
	// invariant, not something an integration test through
	// `applyResetReport` can pin.
	it("clears no ledger row without confirmation", async () => {
		const { driver, calls } = makeFakeDriver("testdb");

		await expect(
			applyResetReport(driver, managedSnapshot, registry, undefined),
		).rejects.toMatchObject({ code: "reset-not-confirmed" });
		expect(
			calls.some((call) =>
				call.sql.toLowerCase().includes('delete from "hejbro"'),
			),
		).toBe(false);
	});
});
