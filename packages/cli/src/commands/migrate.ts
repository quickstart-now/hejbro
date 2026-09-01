import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import {
	APPLY_CONNECTION_CODES,
	assertInteractiveTransactions,
} from "../apply/capability";
import type { Migration } from "../apply/execute";
import { applyMigration } from "../apply/execute";
import { bootstrapLedger, readLedger } from "../apply/ledger";
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

const MIGRATE_DESCRIPTION =
	"Apply the migrations on disk that the database's ledger does not yet record, in chain order.";

const MIGRATE_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
} as const;

const MIGRATE_COMMAND = "hejbro migrate";

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
 * Three answers (task 7.4, `[design]`): `0` there was nothing pending;
 * `1` the database refused a migration (`execute.ts`'s own coded
 * failures -- `apply-failed`/`apply-unsafe-new-enum-value`, or the
 * transaction-control precondition, all reported the same way this
 * command's own red test names it: "a migration failed"); `2` the run
 * never got to send DDL at all -- a broken chain, a ledger disagreement,
 * a missing connection/driver/capability. `check`'s own three answers
 * (0/1/2) are not reused as a template beyond the *count*: an engine's
 * third answer is "could not act", never `check`'s "could not fully
 * compare".
 */
export type MigrateResult = {
	readonly exitCode: 0 | 1 | 2;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

export const NOTHING_TO_APPLY_LINE =
	"migrate: nothing to apply -- the ledger already records every migration on disk.";

/** Names each migration this run applied, in the order it applied them (task 7.5) -- callers only reach this with a non-empty list; the 0-pending case has its own line above. */
const appliedReportLines = (
	applied: ReadonlyArray<string>,
): ReadonlyArray<string> => [
	`migrate: applied ${applied.length} migration(s):`,
	...applied.map((fileName) => ` - ${fileName}`),
];

/** `[]` when nothing applied before the failure -- `appliedReportLines` assumes non-empty, so this is the guard, not a defensive duplicate of its own base case. */
const appliedSoFarLines = (
	appliedSoFar: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (appliedSoFar.length === 0) {
		return [];
	}
	return appliedReportLines(appliedSoFar);
};

const failureResult = (
	appliedSoFar: ReadonlyArray<string>,
	failedFileName: string,
	error: unknown,
): MigrateResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 1,
		stdout: appliedSoFarLines(appliedSoFar),
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, failedFileName)],
			null,
		),
	};
};

/**
 * [task 7.5] Applies `remaining` in chain order, recursively (house style
 * bans loops): a failure stops the run immediately, leaving every
 * migration applied before it applied and recorded (`applyMigration`'s
 * own per-file transaction already committed each one, so "stops at the
 * first failure" is this function's own control flow, not a rollback of
 * work already done) -- this is the run-level property the delta scenario
 * asks for and that only this loop can express (no other task owns it,
 * per tasks.md's own note on where the gap was). Takes `Migration[]`,
 * already read from disk -- this function itself touches no filesystem
 * (mirrors `execute.ts`'s own `Migration` doc comment), so it is testable
 * directly with a fake `Driver`, no temp directory needed.
 */
export const applyFrom = async (
	driver: Driver,
	remaining: ReadonlyArray<Migration>,
	appliedSoFar: ReadonlyArray<string>,
): Promise<MigrateResult> => {
	const [next, ...rest] = remaining;
	if (next === undefined) {
		return {
			exitCode: 0,
			stdout: appliedReportLines(appliedSoFar),
			stderr: null,
		};
	}
	try {
		await applyMigration(driver, next, MIGRATE_COMMAND);
	} catch (error) {
		return failureResult(appliedSoFar, next.fileName, error);
	}
	return applyFrom(driver, rest, [...appliedSoFar, next.fileName]);
};

/** Every way `planApply` refuses (chain-invalid or a ledger disagreement) answers `2` -- neither is the database refusing a migration; both are hejbro's own precondition that there is nothing yet to safely send. */
export const planFailureResult = (
	plan: Extract<PlanResult, { readonly ok: false }>,
): MigrateResult => {
	if (plan.reason === "chain-invalid") {
		return {
			exitCode: 2,
			stdout: [],
			stderr: renderDiagnostics(
				[fromHejbroError(plan.error, MIGRATE_COMMAND)],
				null,
			),
		};
	}
	const diagnostics = plan.disagreements.map((disagreement) =>
		fromHejbroError(disagreement.error, disagreement.identity),
	);
	return {
		exitCode: 2,
		stdout: [],
		stderr: renderDiagnostics(diagnostics, null),
	};
};

const preconditionResult = (error: unknown): MigrateResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 2,
		stdout: [],
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, MIGRATE_COMMAND)],
			null,
		),
	};
};

/**
 * `hejbro migrate`'s own thin orchestration: read the chain and the
 * ledger, plan (group 2's `planApply`), refuse before connecting a
 * transaction-incapable driver (7.3), apply what is pending in order
 * (7.5), report. `importer` is test-only DI, mirroring `runCheck`'s own.
 */
export const runMigrate = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	importer?: CheckDriverImporter,
): Promise<MigrateResult> => {
	const urlFlag = lastFlagValue(normalizeEqualsFlags(argv), "--url");
	try {
		const { config } = await loadConfig(cwd, undefined);
		requireConfigFields(config, "migrate", ["migrationsDir"]);
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(migrationsDirPath);
		const chain = readChainEntries(migrationsDirPath, fileNames);

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: MIGRATE_COMMAND, codes: APPLY_CONNECTION_CODES },
			async (driver) => {
				assertInteractiveTransactions(driver, MIGRATE_COMMAND);
				await bootstrapLedger(driver);
				const ledgerState = await readLedger(driver);
				const plan = planApply(chain, ledgerState);
				if (!plan.ok) {
					return planFailureResult(plan);
				}
				if (plan.pending.length === 0) {
					return { exitCode: 0, stdout: [NOTHING_TO_APPLY_LINE], stderr: null };
				}
				const migrations: ReadonlyArray<Migration> = plan.pending.map(
					(fileName) => ({
						fileName,
						sql: readFileSync(join(migrationsDirPath, fileName), "utf8"),
					}),
				);
				return await applyFrom(driver, migrations, []);
			},
			importer,
		);
	} catch (error) {
		return preconditionResult(error);
	}
};

/** The `hejbro migrate` citty subcommand -- see {@link runMigrate}. */
export const migrateCommand = defineCommand({
	meta: {
		name: "migrate",
		description: MIGRATE_DESCRIPTION,
	},
	args: MIGRATE_ARGS,
	run: async (ctx) => {
		const result = await runMigrate(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
