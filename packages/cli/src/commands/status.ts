import { join } from "node:path";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import { APPLY_CONNECTION_CODES } from "../apply/capability";
import type { LedgerState } from "../apply/ledger";
import { asLedgerAccessFailure, readLedger } from "../apply/ledger";
import {
	LEDGER_DIAGNOSTIC_IDENTITY,
	throwLedgerReadFailure,
} from "../apply/ledger-diagnostics";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "../apply/ledger-identity";
import type { PlanResult } from "../apply/plan";
import { planApply } from "../apply/plan";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import { requireConfigFields } from "../config-required";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { loadConfig } from "../loader";
import { listMigrationFiles } from "../snapshot-file";
import { readChainEntries } from "./verify";

const STATUS_DESCRIPTION =
	"Report what the ledger records, what is pending, and where the chain on disk and the ledger disagree.";

const STATUS_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
} as const;

const STATUS_COMMAND = "hejbro status";

const lastFlagValue = (
	rawArgs: ReadonlyArray<string>,
	flagName: string,
): string | undefined => {
	const values = rawArgs.flatMap((token, index) => {
		if (token !== flagName) {
			return [];
		}
		const value = rawArgs[index + 1];
		if (value === undefined) {
			return [];
		}
		return [value];
	});
	return values.at(-1);
};

/**
 * [design, task 7.6] `status` never sends DDL -- it only reads
 * (`readLedger`/`readChainEntries`), so its own three-answer question is
 * simpler than `migrate`'s: `0` the chain and the ledger agree (whether
 * or not anything is pending -- pending is the ordinary, expected state
 * between two `migrate` runs, never itself a problem this command flags);
 * `1` they disagree, or the chain itself does not verify -- both are
 * something a human needs to look at, so both share the non-zero answer
 * rather than a `check`-style third bucket this read-only report has no
 * use for (there is no "could not find out": a read either succeeds or
 * this command's own precondition failures apply, same as any other
 * command's connection/config failures).
 */
export type StatusResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const pendingLines = (
	pending: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (pending.length === 0) {
		return [
			"status: nothing pending -- the ledger is caught up with the chain.",
		];
	}
	return [
		`status: ${pending.length} migration(s) pending:`,
		...pending.map((fileName) => ` - ${fileName}`),
	];
};

/**
 * [task 16.3, D106 M1/M2] The ledger's own absent-vs-empty distinction
 * (spec: "A ledger table that does not exist and a ledger table that
 * holds no rows are different facts and SHALL be reported differently"),
 * printed only when there is nothing else to say about applied rows --
 * once a ledger holds even one row, which of the two states produced it
 * is no longer ambiguous to a reader.
 */
const ledgerAbsenceLines = (
	ledgerState: LedgerState,
): ReadonlyArray<string> => {
	if (!ledgerState.exists) {
		return [
			"status: no ledger table exists yet -- this database has never been touched by hejbro.",
		];
	}
	if (ledgerState.applied.length === 0) {
		return ["status: the ledger table exists and records no migrations yet."];
	}
	return [];
};

/** [task 16.3, D106 M1] The migrations the ledger records as applied -- chain-linked rows only (`origin !== "raised"`); a raised row is named by {@link raisedLines} instead, never folded in here (spec: "names the migrations the ledger records as applied", which a raised row -- never applied by `migrate` -- is not). */
const appliedLines = (ledgerState: LedgerState): ReadonlyArray<string> => {
	if (!ledgerState.exists) {
		return [];
	}
	const chainLinked = ledgerState.applied.filter(
		(row) => row.origin !== "raised",
	);
	if (chainLinked.length === 0) {
		return [];
	}
	return [
		`status: ${chainLinked.length} migration(s) recorded as applied:`,
		...chainLinked.map((row) => ` - ${row.filename}`),
	];
};

/** [task 16.4, D106 M7] Names a raised database as raised, from the file it was raised from -- never listed as a pending migration nobody has (task 16.2 already keeps `planApply` from treating it as an orphan; this is the positive half, saying what it actually is). */
const raisedLines = (ledgerState: LedgerState): ReadonlyArray<string> => {
	if (!ledgerState.exists) {
		return [];
	}
	return ledgerState.applied
		.filter((row) => row.origin === "raised")
		.map((row) => `status: this database was raised from "${row.filename}".`);
};

/** `plan.ok`'s own report (task 7.6; applied/raised sections since task 16.3/16.4, D106 M1/M2/M7) -- the ledger's own absence-vs-empty state, the migrations it records as applied, which file (if any) raised it, then pending migrations named in chain order, or the "caught up" line when there are none. */
export const renderStatusReport = (
	plan: Extract<PlanResult, { readonly ok: true }>,
	ledgerState: LedgerState,
): StatusResult => ({
	exitCode: 0,
	stdout: [
		...ledgerAbsenceLines(ledgerState),
		...appliedLines(ledgerState),
		...raisedLines(ledgerState),
		...pendingLines(plan.pending),
	],
	stderr: null,
});

/** `plan.ok === false`'s own report -- a chain that does not verify, or every ledger/chain disagreement group 2 computed (task 7.6: "reports a ledger row with no file" is exactly `apply-ledger-orphan-row` here). */
export const renderPlanFailure = (
	plan: Extract<PlanResult, { readonly ok: false }>,
): StatusResult => {
	if (plan.reason === "chain-invalid") {
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(
				[fromHejbroError(plan.error, STATUS_COMMAND)],
				null,
			),
		};
	}
	const diagnostics = plan.disagreements.map((disagreement) =>
		fromHejbroError(disagreement.error, disagreement.identity),
	);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics(diagnostics, null),
	};
};

/**
 * [task 1.6, harden-ledger-diagnostics] `readLedger`'s own tagged read
 * failure becomes `apply-ledger-unreadable` -- `status` never writes, so
 * this is the only ledger classification it ever needs (unlike
 * `migrate`/`raise`, which also classify a write).
 *
 * [task 2.4, harden-ledger-diagnostics review repair] The header names
 * the ledger (`LEDGER_DIAGNOSTIC_IDENTITY`), never `STATUS_COMMAND` --
 * `migrate` already used the ledger's own identity for this code; every
 * command now agrees, so the same code never prints two different
 * headers depending on which one raised it.
 */
const readFailureResult = async (
	driver: Driver,
	rawFailure: unknown,
): Promise<StatusResult> => {
	try {
		await throwLedgerReadFailure(driver, rawFailure, STATUS_COMMAND);
	} catch (classified) {
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics(
				[
					fromHejbroError(
						asHejbroError(classified),
						LEDGER_DIAGNOSTIC_IDENTITY,
					),
				],
				null,
			),
		};
	}
	throw new Error(
		"unreachable: throwLedgerReadFailure resolved instead of throwing",
	);
};

const preconditionResult = (error: unknown): StatusResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, STATUS_COMMAND)],
			null,
		),
	};
};

/**
 * `hejbro status`'s own thin orchestration: read the chain and the
 * ledger, plan (group 2's `planApply`, shared with `migrate`), report --
 * no transaction, no capability check (7.3's own note: this command only
 * reads).
 */
export const runStatus = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	importer?: CheckDriverImporter,
): Promise<StatusResult> => {
	const urlFlag = lastFlagValue(normalizeEqualsFlags(argv), "--url");
	try {
		const { config } = await loadConfig(cwd, undefined);
		requireConfigFields(config, "status", ["migrationsDir"]);
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(cwd, config.migrationsDir);
		const chain = readChainEntries(migrationsDirPath, fileNames);

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: STATUS_COMMAND, codes: APPLY_CONNECTION_CODES },
			async (driver) => {
				const identity = await probeLedgerIdentity(driver, STATUS_COMMAND);
				assertLedgerNotOccupied(identity, STATUS_COMMAND);
				try {
					const ledgerState = await readLedger(driver);
					const plan = planApply(chain, ledgerState);
					if (!plan.ok) {
						return renderPlanFailure(plan);
					}
					return renderStatusReport(plan, ledgerState);
				} catch (error) {
					if (asLedgerAccessFailure(error) === null) {
						throw error;
					}
					return readFailureResult(driver, error);
				}
			},
			importer,
			config.driver,
		);
	} catch (error) {
		return preconditionResult(error);
	}
};

/** The `hejbro status` citty subcommand -- see {@link runStatus}. */
export const statusCommand = defineCommand({
	meta: {
		name: "status",
		description: STATUS_DESCRIPTION,
	},
	args: STATUS_ARGS,
	run: async (ctx) => {
		const result = await runStatus(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
