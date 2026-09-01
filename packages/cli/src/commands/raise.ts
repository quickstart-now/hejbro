import { readFileSync } from "node:fs";
import { join } from "node:path";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import {
	APPLY_CONNECTION_CODES,
	assertInteractiveTransactions,
} from "../apply/capability";
import type { SnapshotFile } from "../apply/raise";
import { applyRaise } from "../apply/raise";
import type { CheckDriverImporter } from "../check/driver";
import { withCheckConnection } from "../check/driver";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { normalizeEqualsFlags } from "../flags";

const RAISE_DESCRIPTION =
	"Stand an empty database up from a vendored snapshot SQL file.";

const RAISE_ARGS = {
	url: {
		type: "string",
		description: "database connection string (default: DATABASE_URL)",
	},
	file: {
		type: "string",
		description: "path to the snapshot SQL file to apply",
	},
} as const;

const RAISE_COMMAND = "hejbro raise";

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

export type RaiseResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const successLine = (fileName: string): string =>
	`raise: applied "${fileName}" to an empty database, and recorded it in the ledger.`;

/**
 * `--file` is required (spec: "a snapshot SQL file and an empty
 * database") -- `raise` has no declarations to fall back to the way
 * `generate` falls back to `hejbro.config.ts`'s `entry`; there is no
 * default file this command could guess.
 */
const assertFileFlagGiven = (fileFlag: string | undefined): string => {
	if (fileFlag !== undefined && fileFlag !== "") {
		return fileFlag;
	}
	return throwHejbroError(
		"raise-file-missing",
		"hejbro raise needs a snapshot SQL file, but --file was not given. Next: pass --file <path-to-snapshot.sql>, then rerun `hejbro raise`.",
	);
};

const preconditionResult = (error: unknown): RaiseResult => {
	const hejbroErr = asHejbroError(error);
	return {
		exitCode: 1,
		stdout: [],
		stderr: renderDiagnostics(
			[fromHejbroError(hejbroErr, RAISE_COMMAND)],
			null,
		),
	};
};

/**
 * `hejbro raise`'s own thin orchestration: read `--file` from disk
 * (opaque text, never parsed -- proposal: "It does not parse SQL"),
 * refuse a transaction-incapable driver (7.3), then `applyRaise` (group
 * 6) -- the ledger precheck, the already-exists translation, and "applies
 * nothing" all live there, not re-implemented here. The ledger row it
 * writes uses `--file`'s own value verbatim (relative to `cwd`, matching
 * every other path this CLI prints), never resolved to an absolute path
 * (Task 14's own "no absolute paths in output" rule).
 */
export const runRaise = async (
	cwd: string,
	argv: ReadonlyArray<string> = [],
	importer?: CheckDriverImporter,
): Promise<RaiseResult> => {
	const rawArgs = normalizeEqualsFlags(argv);
	const urlFlag = lastFlagValue(rawArgs, "--url");
	const fileFlag = lastFlagValue(rawArgs, "--file");
	try {
		const fileName = assertFileFlagGiven(fileFlag);
		const sql = readFileSync(join(cwd, fileName), "utf8");
		const snapshotFile: SnapshotFile = { fileName, sql };

		return await withCheckConnection(
			urlFlag,
			process.env,
			{ commandName: RAISE_COMMAND, codes: APPLY_CONNECTION_CODES },
			async (driver) => {
				assertInteractiveTransactions(driver, RAISE_COMMAND);
				await applyRaise(driver, snapshotFile, RAISE_COMMAND);
				return { exitCode: 0, stdout: [successLine(fileName)], stderr: null };
			},
			importer,
		);
	} catch (error) {
		return preconditionResult(error);
	}
};

/** The `hejbro raise` citty subcommand -- see {@link runRaise}. */
export const raiseCommand = defineCommand({
	meta: {
		name: "raise",
		description: RAISE_DESCRIPTION,
	},
	args: RAISE_ARGS,
	run: async (ctx) => {
		const result = await runRaise(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
