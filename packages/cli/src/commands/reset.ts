import type { KindRegistry, Snapshot } from "@hejbro/core";
import {
	generateMigration,
	parseSnapshot,
	requiredKeysByKind,
} from "@hejbro/core";
import type { Driver } from "@hejbro/query";
import { defineCommand } from "citty";
import {
	APPLY_CONNECTION_CODES,
	assertInteractiveTransactions,
} from "../apply/capability";
import { applyReset } from "../apply/reset";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import { requireConfigFields } from "../config-required";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";
import { loadConfig, loadDeclarations } from "../loader";
import { buildRegistry } from "../presets";
import { readSnapshotFileText } from "../snapshot-file";

const RESET_DESCRIPTION =
	"Destroy every object your declarations manage -- refuses without an exact confirmation naming what it would drop.";

const RESET_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
	"confirm-drop": {
		type: "string",
		description:
			"the exact confirmation reset's own refusal names (<database>:<count>)",
	},
} as const;

const RESET_COMMAND = "hejbro reset";

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

export type ResetResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

/** [D106 R1, B1, #753 reopened] Claims "cleared the ledger" only when {@link applyReset} actually did -- a ledger that never existed (every migration applied outside hejbro) is not cleared, and saying otherwise is exactly the false-success B1 reported. */
const successLine = (ledgerCleared: boolean): string => {
	if (ledgerCleared) {
		return "reset: dropped every object your declarations manage, and cleared the ledger.";
	}
	return "reset: dropped every object your declarations manage.";
};

const preconditionResult = (error: unknown): ResetResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, RESET_COMMAND)],
			null,
		),
	};
};

/**
 * The connected half of `hejbro reset`: refuse a transaction-incapable
 * driver (7.3), then `applyReset` (group 5) -- confirmation, refusal, and
 * "applies nothing unless confirmed" all live there, not re-implemented
 * here. Exported and tested directly against a fake `Driver` and a
 * snapshot built straight from `@hejbro/core`'s own DSL (no
 * `loadDeclarations`/jiti involved) -- `runReset` below is the only
 * caller that reads real declarations off disk, mirroring `check.ts`'s
 * own split (its own connected orchestration, `runCheck`, is likewise
 * "not tested directly ... group 8 proves the real findings").
 */
export const applyResetReport = async (
	driver: Driver,
	currentSnapshot: Snapshot,
	registry: KindRegistry,
	confirmed: string | undefined,
): Promise<ResetResult> => {
	assertInteractiveTransactions(driver, RESET_COMMAND);
	const { ledgerCleared } = await applyReset(
		driver,
		currentSnapshot,
		registry,
		confirmed,
	);
	return { exitCode: 0, stdout: [successLine(ledgerCleared)], stderr: null };
};

/**
 * `hejbro reset`'s own thin orchestration: build the currently-declared
 * snapshot exactly as `check`/`generate` do (the checked-in snapshot as
 * the D81 parent, so `planReset`'s drop order matches what `generate`
 * would have produced), then {@link applyResetReport}.
 */
export const runReset = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	importer?: CheckDriverImporter,
): Promise<ResetResult> => {
	const rawArgs = normalizeEqualsFlags(argv);
	const urlFlag = lastFlagValue(rawArgs, "--url");
	const confirmFlag = lastFlagValue(rawArgs, "--confirm-drop");
	try {
		const { config, configPath } = await loadConfig(cwd, undefined);
		requireConfigFields(config, "reset", ["snapshotPath"]);
		const declarations = await loadDeclarations(configPath, config);
		const registry = buildRegistry(config);
		const diskSnapshot = parseSnapshot(
			readSnapshotFileText(cwd, config, "reset"),
			requiredKeysByKind(registry),
		);
		const currentSnapshot = generateMigration({
			declarations,
			previousSnapshot: diskSnapshot,
			registry,
		}).snapshot;

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: RESET_COMMAND, codes: APPLY_CONNECTION_CODES },
			(driver) =>
				applyResetReport(driver, currentSnapshot, registry, confirmFlag),
			importer,
		);
	} catch (error) {
		return preconditionResult(error);
	}
};

/** The `hejbro reset` citty subcommand -- see {@link runReset}. */
export const resetCommand = defineCommand({
	meta: {
		name: "reset",
		description: RESET_DESCRIPTION,
	},
	args: RESET_ARGS,
	run: async (ctx) => {
		const result = await runReset(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
