import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HejbroError } from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import {
	APPLY_CONNECTION_CODES,
	assertInteractiveTransactions,
} from "../apply/capability";
import type { Migration } from "../apply/execute";
import { applyMigration } from "../apply/execute";
import type { LedgerAccessDirection, LedgerOrigin } from "../apply/ledger";
import {
	asLedgerAccessFailure,
	bootstrapLedger,
	LEDGER_SCHEMA,
	LEDGER_TABLE,
	readLedger,
} from "../apply/ledger";
import {
	throwLedgerReadFailure,
	throwLedgerWriteFailure,
} from "../apply/ledger-diagnostics";
import {
	assertLedgerNotOccupied,
	probeLedgerIdentity,
} from "../apply/ledger-identity";
import type { PlanResult } from "../apply/plan";
import { checkChainOffline, planApply } from "../apply/plan";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import { requireConfigFields } from "../config-required";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { loadConfig } from "../loader";
import { listMigrationFiles } from "../snapshot-file";
import { readBaselineFileNames, readChainEntries } from "./verify";

const MIGRATE_DESCRIPTION =
	"Apply the migrations on disk that the database's ledger does not yet record, in chain order.";

const MIGRATE_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
} as const;

const MIGRATE_COMMAND = "hejbro migrate";

/** [task 1.5, harden-ledger-diagnostics] The identity a ledger-failure diagnostic's header names -- the ledger itself, never a migration file: `applyFrom`'s own generic failure path (`failureResult`) already uses the failing file for the migration's own failures, so this is deliberately a different label, never reused for both. */
const LEDGER_IDENTITY = `"${LEDGER_SCHEMA}"."${LEDGER_TABLE}"`;

/**
 * [task 1.5, harden-ledger-diagnostics, design.md D4] Turns a tagged
 * ledger-statement failure into its coded diagnostic -- called only after
 * the transaction that failed has already rolled back (either
 * `driver.transaction`'s own catch, inside `applyMigration`, or here
 * directly for `bootstrapLedger`/`readLedger`, neither of which opens a
 * transaction), so the classifier's own role read runs on a connection
 * that can still answer (D2, measured `25P02` otherwise). `rowFilename`
 * is read only when the tag's own site is `"row"`.
 */
const classifyLedgerFailure = async (
	driver: Driver,
	direction: LedgerAccessDirection,
	rawFailure: unknown,
	rowFilename: string | undefined,
): Promise<HejbroError> => {
	try {
		if (direction === "read") {
			await throwLedgerReadFailure(driver, rawFailure, MIGRATE_COMMAND);
		} else {
			await throwLedgerWriteFailure(
				driver,
				rawFailure,
				MIGRATE_COMMAND,
				rowFilename,
			);
		}
	} catch (classified) {
		return asHejbroError(classified);
	}
	throw new Error(
		"unreachable: a ledger diagnostic classifier resolved instead of throwing",
	);
};

/** [task 16.1, D106 M7] The ledger origin `fileName` records under, given `plan.baselineFileNames` -- no ternary (house style): a chain-applied file is `"applied"`, a baseline file is `"registered"` (the same word this file's own report line already uses for it, below); `migrate` never writes `"raised"` (that origin is `raise`'s own). */
const originFor = (
	fileName: string,
	baselineFileNames: ReadonlySet<string>,
): LedgerOrigin => {
	if (baselineFileNames.has(fileName)) {
		return "registered";
	}
	return "applied";
};

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

/** Names each migration this run itself applied, in the order it applied them (task 7.5) -- callers only reach this with a non-empty list; the 0-pending case has its own line above. */
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

/**
 * [task 11.2, #620] Names each migration this run found already recorded
 * by another run, by the time it got the advisory lock (`execute.ts`'s
 * own `"already-applied"` outcome, task 11.1) -- a separate bucket from
 * {@link appliedReportLines}, not folded into it: this run sent no DDL
 * and wrote no ledger row for these, so calling them "applied" here
 * would claim credit this run's own transaction never took. Silence
 * about this bucket would leave a user staring at a pending file that
 * both runs agreed on and wondering why the report never mentions it.
 */
const alreadyAppliedReportLines = (
	alreadyApplied: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (alreadyApplied.length === 0) {
		return [];
	}
	return [
		`migrate: ${alreadyApplied.length} migration(s) another run already applied while this one waited:`,
		...alreadyApplied.map((fileName) => ` - ${fileName}`),
	];
};

/**
 * [task 12.2, #624] Names each baseline migration this run itself
 * registered -- its own bucket, separate from {@link appliedReportLines}:
 * no statement of this file's ever reached the database (`execute.ts`'s
 * own `baseline` skip, task 12.2), so calling it "applied" would tell the
 * user something false about a file that was only ever run once, by
 * whatever adopted the database in the first place.
 */
const registeredReportLines = (
	registered: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (registered.length === 0) {
		return [];
	}
	return [
		`migrate: registered ${registered.length} baseline migration(s) (statements not executed):`,
		...registered.map((fileName) => ` - ${fileName}`),
	];
};

/** [task 12.2, #624] {@link alreadyAppliedReportLines}'s own counterpart for a baseline file another run registered first -- kept as its own bucket for the same reason {@link registeredReportLines} is: "applied" would still be false for a file whose statements were never sent, by either run. */
const alreadyRegisteredReportLines = (
	alreadyRegistered: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (alreadyRegistered.length === 0) {
		return [];
	}
	return [
		`migrate: ${alreadyRegistered.length} baseline migration(s) another run already registered while this one waited:`,
		...alreadyRegistered.map((fileName) => ` - ${fileName}`),
	];
};

/** The four report buckets, in their fixed order -- shared by every `MigrateResult` builder below (a clean finish, a migration's own failure, and a ledger failure) so the three never drift apart on what "so far" means. */
const bucketLines = (
	appliedSoFar: ReadonlyArray<string>,
	registeredSoFar: ReadonlyArray<string>,
	alreadyAppliedSoFar: ReadonlyArray<string>,
	alreadyRegisteredSoFar: ReadonlyArray<string>,
): ReadonlyArray<string> => [
	...appliedSoFarLines(appliedSoFar),
	...registeredReportLines(registeredSoFar),
	...alreadyAppliedReportLines(alreadyAppliedSoFar),
	...alreadyRegisteredReportLines(alreadyRegisteredSoFar),
];

const failureResult = (
	appliedSoFar: ReadonlyArray<string>,
	alreadyAppliedSoFar: ReadonlyArray<string>,
	registeredSoFar: ReadonlyArray<string>,
	alreadyRegisteredSoFar: ReadonlyArray<string>,
	failedFileName: string,
	error: unknown,
): MigrateResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 1,
		stdout: bucketLines(
			appliedSoFar,
			registeredSoFar,
			alreadyAppliedSoFar,
			alreadyRegisteredSoFar,
		),
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, failedFileName)],
			null,
		),
	};
};

/**
 * [task 1.5, harden-ledger-diagnostics, D5] A ledger failure is never the
 * migration's own failure (#823): exit two (a run that could not act,
 * proven by the rollback -- nothing was applied that this diagnostic
 * doesn't already account for in `appliedSoFar` and its siblings), and
 * the header names the ledger (`LEDGER_IDENTITY`), never `next.fileName`.
 */
const ledgerFailureResult = async (
	driver: Driver,
	appliedSoFar: ReadonlyArray<string>,
	alreadyAppliedSoFar: ReadonlyArray<string>,
	registeredSoFar: ReadonlyArray<string>,
	alreadyRegisteredSoFar: ReadonlyArray<string>,
	direction: LedgerAccessDirection,
	rawFailure: unknown,
	rowFilename: string | undefined,
): Promise<MigrateResult> => {
	const classified = await classifyLedgerFailure(
		driver,
		direction,
		rawFailure,
		rowFilename,
	);
	return {
		exitCode: 2,
		stdout: bucketLines(
			appliedSoFar,
			registeredSoFar,
			alreadyAppliedSoFar,
			alreadyRegisteredSoFar,
		),
		stderr: renderDiagnostics(
			[fromHejbroError(classified, LEDGER_IDENTITY)],
			null,
		),
	};
};

/**
 * [task 7.5; two buckets since task 11.2, #620; four since task 12.2,
 * #624] Applies `remaining` in chain order, recursively (house style
 * bans loops): a failure stops the run immediately, leaving every
 * migration applied before it applied and recorded (`applyMigration`'s
 * own per-file transaction already committed each one, so "stops at the
 * first failure" is this function's own control flow, not a rollback of
 * work already done) -- this is the run-level property the delta
 * scenario asks for and that only this loop can express (no other task
 * owns it, per tasks.md's own note on where the gap was). Takes
 * `Migration[]`, already read from disk -- this function itself touches
 * no filesystem (mirrors `execute.ts`'s own `Migration` doc comment), so
 * it is testable directly with a fake `Driver`, no temp directory
 * needed.
 *
 * Four accumulators, not one: `applyMigration`'s own per-file outcome
 * (task 11.1) says whether this call did the work or found it already
 * done, and `next.origin` (read from the same `Migration` the caller
 * already built via `originFor`, task 12.1/16.1) says whether that work
 * was sending DDL or registering without it. The cross product
 * of those two facts is exactly four buckets, and all four are reported
 * (tasks 11.2/12.2) when the run finishes, whether it finishes by
 * exhausting `remaining` or by failing partway through.
 */
export const applyFrom = async (
	driver: Driver,
	remaining: ReadonlyArray<Migration>,
	appliedSoFar: ReadonlyArray<string>,
	alreadyAppliedSoFar: ReadonlyArray<string> = [],
	registeredSoFar: ReadonlyArray<string> = [],
	alreadyRegisteredSoFar: ReadonlyArray<string> = [],
): Promise<MigrateResult> => {
	const [next, ...rest] = remaining;
	if (next === undefined) {
		return {
			exitCode: 0,
			stdout: bucketLines(
				appliedSoFar,
				registeredSoFar,
				alreadyAppliedSoFar,
				alreadyRegisteredSoFar,
			),
			stderr: null,
		};
	}
	try {
		const outcome = await applyMigration(driver, next, MIGRATE_COMMAND);
		if (outcome === "already-applied" && next.origin === "registered") {
			return applyFrom(
				driver,
				rest,
				appliedSoFar,
				alreadyAppliedSoFar,
				registeredSoFar,
				[...alreadyRegisteredSoFar, next.fileName],
			);
		}
		if (outcome === "already-applied") {
			return applyFrom(
				driver,
				rest,
				appliedSoFar,
				[...alreadyAppliedSoFar, next.fileName],
				registeredSoFar,
				alreadyRegisteredSoFar,
			);
		}
		if (next.origin === "registered") {
			return applyFrom(
				driver,
				rest,
				appliedSoFar,
				alreadyAppliedSoFar,
				[...registeredSoFar, next.fileName],
				alreadyRegisteredSoFar,
			);
		}
		return applyFrom(
			driver,
			rest,
			[...appliedSoFar, next.fileName],
			alreadyAppliedSoFar,
			registeredSoFar,
			alreadyRegisteredSoFar,
		);
	} catch (error) {
		const tag = asLedgerAccessFailure(error);
		if (tag !== null) {
			return ledgerFailureResult(
				driver,
				appliedSoFar,
				alreadyAppliedSoFar,
				registeredSoFar,
				alreadyRegisteredSoFar,
				tag.direction,
				error,
				next.fileName,
			);
		}
		return failureResult(
			appliedSoFar,
			alreadyAppliedSoFar,
			registeredSoFar,
			alreadyRegisteredSoFar,
			next.fileName,
			error,
		);
	}
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
		const fileNames = listMigrationFiles(cwd, config.migrationsDir);
		const chain = readChainEntries(migrationsDirPath, fileNames);
		const baselineFileNames = readBaselineFileNames(
			migrationsDirPath,
			fileNames,
		);

		// [task 17.1, D106 M3] Verified before any connection opens --
		// `bootstrapLedger` below sends DDL, so refusing after that ran
		// would already have broken the delta's "no statement is sent"
		// promise on an unverifiable chain.
		const chainFailure = checkChainOffline(chain);
		if (chainFailure !== null) {
			return planFailureResult(chainFailure);
		}

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: MIGRATE_COMMAND, codes: APPLY_CONNECTION_CODES },
			async (driver) => {
				assertInteractiveTransactions(driver, MIGRATE_COMMAND);
				const identity = await probeLedgerIdentity(driver);
				assertLedgerNotOccupied(identity, MIGRATE_COMMAND);
				// [task 1.5, harden-ledger-diagnostics] Neither statement here
				// opens a transaction, so a tagged failure from either one is
				// classified right where it's caught -- the same driver, no
				// rollback to wait for (unlike applyMigration's own ledger
				// writes, task 1.4).
				try {
					await bootstrapLedger(driver);
					const ledgerState = await readLedger(driver);
					const plan = planApply(chain, ledgerState, baselineFileNames);
					if (!plan.ok) {
						return planFailureResult(plan);
					}
					if (plan.pending.length === 0) {
						return {
							exitCode: 0,
							stdout: [NOTHING_TO_APPLY_LINE],
							stderr: null,
						};
					}
					const migrations: ReadonlyArray<Migration> = plan.pending.map(
						(fileName) => ({
							fileName,
							sql: readFileSync(join(migrationsDirPath, fileName), "utf8"),
							origin: originFor(fileName, plan.baselineFileNames),
						}),
					);
					return await applyFrom(driver, migrations, []);
				} catch (error) {
					const tag = asLedgerAccessFailure(error);
					if (tag === null) {
						throw error;
					}
					return ledgerFailureResult(
						driver,
						[],
						[],
						[],
						[],
						tag.direction,
						error,
						undefined,
					);
				}
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
