import type { DriverCapabilities } from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRaise } from "../src/commands/raise";
import {
	createCliFixtureDir,
	removeCliFixtureDir,
	writeFixtureFile,
} from "./support/cli-runner";

const capabilities: DriverCapabilities = {
	"interactive-transactions": true,
	"session-state": true,
};

type FakeCompiled = {
	readonly sql: string;
	readonly params: ReadonlyArray<unknown>;
};
type FakeRow = Record<string, unknown>;

/** A fake importer whose driver's `select "filename"` answers from a seeded ledger, and whose DDL/insert statements are recorded but not otherwise interpreted -- mirrors `apply-raise.test.ts`'s own fake driver. One `execute` implementation, reused for both the bare-driver reads (`bootstrapLedger`/`readLedger`) and the transaction session (`applyMigration`), so the two paths can never see a different world. */
const makeImporter = (options?: {
	readonly seededLedgerRows?: ReadonlyArray<string>;
}) => {
	const ledgerRows: string[] = [...(options?.seededLedgerRows ?? [])];
	const execute = async (
		compiled: FakeCompiled,
	): Promise<ReadonlyArray<FakeRow>> => {
		const sql = compiled.sql.trim().toLowerCase();
		if (sql.startsWith("create schema") || sql.startsWith("create table")) {
			return [];
		}
		if (sql.startsWith("insert into")) {
			ledgerRows.push(String(compiled.params[0]));
			return [];
		}
		if (sql.startsWith('select "filename"')) {
			return ledgerRows.map((filename) => ({ filename }));
		}
		return [];
	};
	return async () => ({
		pgDriver: () => ({
			capabilities,
			execute,
			transaction: async <T>(
				callback: (session: { execute: typeof execute }) => Promise<T>,
			): Promise<T> => callback({ execute }),
			setupSession: async () => {},
			client: { end: async () => {} },
		}),
	});
};

describe("runRaise / 7.7", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("applies a snapshot file to an empty database", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain("vendor/schema.sql");
	});

	it("refuses a non-empty database (ledger already has history)", async () => {
		await writeFixtureFile(
			cwd,
			"vendor/schema.sql",
			'create schema "app";\ncreate table "app"."t" (id integer);',
		);

		const result = await runRaise(
			cwd,
			["--url", "postgres://fake", "--file", "vendor/schema.sql"],
			makeImporter({ seededLedgerRows: ["0001_init.sql"] }),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[raise-not-empty]");
	});

	it("refuses when --file is not given", async () => {
		const result = await runRaise(
			cwd,
			["--url", "postgres://fake"],
			makeImporter(),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[raise-file-missing]");
		expect(result.stderr).toContain("hejbro raise");
	});
});
