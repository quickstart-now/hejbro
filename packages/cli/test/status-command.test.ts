import { hejbroError } from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LedgerState } from "../src/apply/ledger";
import type { PlanResult } from "../src/apply/plan";
import { planFailureResult } from "../src/commands/migrate";
import {
	renderPlanFailure,
	renderStatusReport,
	runStatus,
} from "../src/commands/status";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	writeFixtureFile,
} from "./support/cli-runner";

const EMPTY_LEDGER: LedgerState = { exists: true, applied: [] };
const NO_LEDGER: LedgerState = { exists: false };

describe("renderStatusReport / 7.6", () => {
	it("reports pending migrations, in chain order", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: ["0001_a.sql", "0002_b.sql"],
			baselineFileNames: new Set(),
		};

		const result = renderStatusReport(plan, EMPTY_LEDGER);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 2 migration(s) pending:",
			" - 0001_a.sql",
			" - 0002_b.sql",
		]);
	});

	it("reports nothing pending when the ledger is caught up", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: [],
			baselineFileNames: new Set(),
		};

		const result = renderStatusReport(plan, EMPTY_LEDGER);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderStatusReport / 16.3 (D106 M1)", () => {
	const caughtUp: Extract<PlanResult, { readonly ok: true }> = {
		ok: true,
		pending: [],
		baselineFileNames: new Set(),
	};

	it("tells an absent ledger from an empty one", () => {
		const absent = renderStatusReport(caughtUp, NO_LEDGER);
		const empty = renderStatusReport(caughtUp, EMPTY_LEDGER);

		expect(absent.stdout[0]).toBe(
			"status: no ledger table exists yet -- this database has never been touched by hejbro.",
		);
		expect(empty.stdout[0]).toBe(
			"status: the ledger table exists and records no migrations yet.",
		);
	});

	it("names the migrations the ledger records as applied", () => {
		const ledger: LedgerState = {
			exists: true,
			applied: [
				{ filename: "0001_a.sql", origin: "applied" },
				{ filename: "0002_b.sql", origin: "applied" },
			],
		};

		const result = renderStatusReport(caughtUp, ledger);

		expect(result.stdout).toEqual([
			"status: 2 migration(s) recorded as applied:",
			" - 0001_a.sql",
			" - 0002_b.sql",
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderStatusReport / 16.4 (D106 M7)", () => {
	it("says the database was raised from that file", () => {
		const plan: Extract<PlanResult, { readonly ok: true }> = {
			ok: true,
			pending: [],
			baselineFileNames: new Set(),
		};
		const ledger: LedgerState = {
			exists: true,
			applied: [{ filename: "vendor/schema.sql", origin: "raised" }],
		};

		const result = renderStatusReport(plan, ledger);

		expect(result.stdout).toEqual([
			'status: this database was raised from "vendor/schema.sql".',
			"status: nothing pending -- the ledger is caught up with the chain.",
		]);
	});
});

describe("renderPlanFailure / 7.6", () => {
	it("reports a ledger row with no file", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "ledger-disagreement",
			disagreements: [
				{
					identity: "0003_missing.sql",
					error: hejbroError(
						"apply-ledger-orphan-row",
						'the ledger records "0003_missing.sql" as applied, but no migration of that name exists on disk.',
					),
				},
			],
		};

		const result = renderPlanFailure(plan);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[apply-ledger-orphan-row]");
		expect(result.stderr).toContain("0003_missing.sql");
	});

	it("reports a chain that does not verify", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "chain-invalid",
			error: hejbroError("diverged-migrations", "the chain does not verify"),
		};

		const result = renderPlanFailure(plan);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("error[diverged-migrations]");
	});

	// [spec: "A disagreement is reported by status too"] The exact same
	// `PlanResult` fed to `migrate`'s own report-builder and `status`'s
	// own -- both must name the identical code, because both read it off
	// the identical `Disagreement.error` group 2's `planApply` produced.
	// This is what makes the ledger-disagreement codes (`apply-ledger-
	// orphan-row`/`apply-ledger-out-of-order`) `apply-*`-prefixed rather
	// than `migrate-*`: two commands report them, not one.
	it("reports the identical code migrate itself would refuse with, for the same disagreement", () => {
		const plan: Extract<PlanResult, { readonly ok: false }> = {
			ok: false,
			reason: "ledger-disagreement",
			disagreements: [
				{
					identity: "0003_missing.sql",
					error: hejbroError(
						"apply-ledger-orphan-row",
						'the ledger records "0003_missing.sql" as applied, but no migration of that name exists on disk.',
					),
				},
			],
		};

		const statusResult = renderPlanFailure(plan);
		const migrateResult = planFailureResult(plan);

		expect(statusResult.stderr).toContain("error[apply-ledger-orphan-row]");
		expect(migrateResult.stderr).toContain("error[apply-ledger-orphan-row]");
	});
});

const CONFIG_SOURCE = `import { defineConfig } from "hejbro";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
});
`;

// [spec: "Pending migrations are reported without being applied"] `status`
// never opens a transaction and sends no DDL at all -- proved here by
// recording every statement a fake driver ever receives and asserting
// none of them is a write. A test that only reads `result.stdout`'s
// pending list would pass even if `status` had quietly applied
// something first; this is the assertion that would catch that.
describe("runStatus / 7.6, database unchanged", () => {
	// This fixture's hejbro.config.ts imports "hejbro" -- real Node
	// resolution, so it needs a built dist.
	beforeAll(assertBuiltCli);

	let cwd: string;

	beforeEach(async () => {
		cwd = await createCliFixtureDir();
		await writeFixtureFile(cwd, "hejbro.config.ts", CONFIG_SOURCE);
		// A real chain-shaped file on disk (hand-fabricated hash chain --
		// `checkChain` only needs consistent parent/current links, never
		// real sha256 output, matching this suite's siblings). Nothing in
		// the fake ledger below records it applied, so `planApply` reports
		// it pending, not disagreeing.
		await writeFixtureFile(
			cwd,
			"migrations/0001_a.sql",
			[
				"-- hejbro migration",
				"-- parent-snapshot: sha256:aaaa",
				"-- snapshot: sha256:bbbb",
				'create table "app"."a" (id integer);',
			].join("\n"),
		);
	});

	afterEach(async () => {
		await removeCliFixtureDir(cwd);
	});

	it("sends no write statement while reporting pending migrations", async () => {
		const calls: string[] = [];
		const importer = async () => ({
			pgDriver: () => ({
				capabilities: {
					"interactive-transactions": false,
					"session-state": false,
				},
				execute: async (compiled: { readonly sql: string }) => {
					calls.push(compiled.sql);
					const sql = compiled.sql.trim().toLowerCase();
					if (sql.startsWith('select "filename"')) {
						return [];
					}
					return [];
				},
				transaction: async () => {
					throw new Error("status must never open a transaction");
				},
				setupSession: async () => {},
				client: { end: async () => {} },
			}),
		});

		const result = await runStatus(cwd, ["--url", "postgres://fake"], importer);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			"status: the ledger table exists and records no migrations yet.",
			"status: 1 migration(s) pending:",
			" - 0001_a.sql",
		]);
		expect(
			calls.some((sql) =>
				/^\s*(insert|update|delete|create|drop|alter)\b/i.test(sql),
			),
		).toBe(false);
	});
});
