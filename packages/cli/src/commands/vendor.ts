import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { loadConfig } from "../loader";
import { resolveExport } from "../vendor/fetch";
import { withGitDiagnostic } from "../vendor/git-diagnostic";
import {
	assertLockWritable,
	readLock,
	vendorDirPath,
	vendorSchemaPath,
	vendorSqlPath,
	writeLock,
} from "../vendor/lock";

const VENDOR_DESCRIPTION =
	"Fetch the linked source's schema export and pin it (writes the description, the squashed SQL and the lock).";

export type VendorResult = {
	readonly exitCode: 0 | 1;
	readonly stdout: ReadonlyArray<string>;
	readonly stderr: string | null;
};

const flagValue = (
	argv: ReadonlyArray<string>,
	flag: string,
): string | undefined => {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return undefined;
	}
	return argv[index + 1];
};

/** `hejbro.config.ts`'s own field (schema-vendoring spec) — intent,
 * committed, distinct from `hejbro.lock`'s resolved commit. */
const requireSchemaSource = async (
	cwd: string,
	configFlag: string | undefined,
): Promise<string> => {
	const { config } = await loadConfig(cwd, configFlag);
	if (config.schemaSource === undefined) {
		return throwHejbroError(
			"vendor-source-not-linked",
			'hejbro vendor needs a source. Next: run `hejbro link <repository>` (or add "schemaSource" to hejbro.config.ts yourself).',
		);
	}
	return config.schemaSource;
};

const runVendorCheck = (cwd: string): VendorResult => {
	const lock = readLock(cwd);
	if (lock === null) {
		return throwHejbroError(
			"vendor-not-yet-vendored",
			"hejbro vendor --check has nothing to compare against: this repository has never been vendored. Next: run `hejbro vendor` first.",
		);
	}
	const schemaText = readFileSync(vendorSchemaPath(cwd), "utf8");
	const sqlText = readFileSync(vendorSqlPath(cwd), "utf8");
	const matches =
		sha256Hex(schemaText) === lock.schemaHash &&
		sha256Hex(sqlText) === lock.sqlHash;
	if (matches) {
		return {
			exitCode: 0,
			stdout: ["vendor --check: up to date"],
			stderr: null,
		};
	}
	return throwHejbroError(
		"vendor-check-mismatch",
		'the vendored files no longer match the lock — at least one of ".hejbro/vendor/schema.json"/".hejbro/vendor/snapshot.sql" was edited after the last `hejbro vendor`. Next: run `hejbro vendor` to restore them, or revert the hand edit.',
	);
};

const runVendorUpdate = (
	cwd: string,
	source: string,
	ref: string | undefined,
): VendorResult => {
	const fetched = withGitDiagnostic("vendor", source, () =>
		resolveExport(cwd, source, ref),
	);
	mkdirSync(vendorDirPath(cwd), { recursive: true });
	writeFileSync(vendorSchemaPath(cwd), fetched.schemaText);
	writeFileSync(vendorSqlPath(cwd), fetched.sqlText);
	writeLock(cwd, {
		resolvedFrom: fetched.ref,
		commit: fetched.commit,
		descriptionFormat: fetched.format.descriptionFormat,
		schemaHash: sha256Hex(fetched.schemaText),
		sqlHash: sha256Hex(fetched.sqlText),
	});
	return {
		exitCode: 0,
		stdout: [`vendored ${fetched.commit} (${fetched.ref})`],
		stderr: null,
	};
};

export const runVendor = async (
	cwd: string,
	argv: ReadonlyArray<string>,
): Promise<VendorResult> => {
	const fallbackIdentity = "vendor";
	try {
		if (argv.includes("--check")) {
			return runVendorCheck(cwd);
		}
		// The lock guard runs before config even loads: a foreign lock
		// file blocks everything, regardless of whether a source is
		// configured yet.
		assertLockWritable(cwd, argv.includes("--force"));
		const source = await requireSchemaSource(cwd, flagValue(argv, "--config"));
		return runVendorUpdate(cwd, source, flagValue(argv, "--ref"));
	} catch (error) {
		const hejbroError = asHejbroError(error);
		const diagnostic = fromHejbroError(
			hejbroError,
			identityFromMessage(hejbroError.message, fallbackIdentity),
		);
		return {
			exitCode: 1,
			stdout: [],
			stderr: renderDiagnostics([diagnostic], null),
		};
	}
};

export const vendorCommand = defineCommand({
	meta: {
		name: "vendor",
		description: VENDOR_DESCRIPTION,
	},
	args: {
		ref: {
			type: "string",
			description:
				"resolve one specific ref instead of the default branch (does not persist)",
		},
		check: {
			type: "boolean",
			description:
				"compare the vendored files against the lock and write nothing",
		},
		force: {
			type: "boolean",
			description: "overwrite a lock this tool did not write",
		},
	},
	run: async (ctx) => {
		const result = await runVendor(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
