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

const makeFakeDriver = (
	databaseName = "testdb",
	capabilities?: DriverCapabilities,
): { readonly driver: Driver; readonly calls: CompileResult[] } => {
	const calls: CompileResult[] = [];
	const session: DriverSession = {
		execute: async (compiled) => {
			calls.push(compiled);
			const sql = compiled.sql.trim().toLowerCase();
			if (sql.startsWith("select current_database()")) {
				return [{ name: databaseName }];
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
