import { join } from "node:path";
import { defineCommand } from "citty";
import { APPLY_CONNECTION_CODES } from "../apply/capability";
import { readLedger } from "../apply/ledger";
import type { PlanResult } from "../apply/plan";
import { planApply } from "../apply/plan";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
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

/** `plan.ok`'s own report (task 7.6) -- pending migrations named, in chain order, or the "caught up" line when there are none. */
export const renderStatusReport = (
	plan: Extract<PlanResult, { readonly ok: true }>,
): StatusResult => ({
	exitCode: 0,
	stdout: pendingLines(plan.pending),
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
		const migrationsDirPath = join(cwd, config.migrationsDir);
		const fileNames = listMigrationFiles(migrationsDirPath);
		const chain = readChainEntries(migrationsDirPath, fileNames);

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: STATUS_COMMAND, codes: APPLY_CONNECTION_CODES },
			async (driver) => {
				const ledgerState = await readLedger(driver);
				const plan = planApply(chain, ledgerState);
				if (!plan.ok) {
					return renderPlanFailure(plan);
				}
				return renderStatusReport(plan);
			},
			importer,
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
