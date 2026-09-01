import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import type { ContractOrigin } from "../contract/emit";
import { emitContract } from "../contract/emit";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { resolveExport } from "../vendor/fetch";
import { withGitDiagnostic } from "../vendor/git-diagnostic";
import type { VendorLock } from "../vendor/lock";
import {
	assertLockWritable,
	readLock,
	vendorContractPath,
	vendorDirPath,
	vendorSchemaPath,
	vendorSqlPath,
	writeLock,
} from "../vendor/lock";
import { readSourceFile } from "../vendor/source-file";

const VENDOR_DESCRIPTION =
	"Fetch the linked source's schema export and pin it (writes the description, the squashed SQL, the contract and the lock).";

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

const requireLinkedSource = (cwd: string): string => {
	const sourceFile = readSourceFile(cwd);
	if (sourceFile === null) {
		return throwHejbroError(
			"vendor-source-not-linked",
			"hejbro vendor needs a linked source. Next: run `hejbro link <repository>` first.",
		);
	}
	return sourceFile.source;
};

const requireVendoredLock = (cwd: string): VendorLock => {
	const lock = readLock(cwd);
	if (lock === null) {
		return throwHejbroError(
			"vendor-not-yet-vendored",
			"hejbro vendor --check has nothing to compare against: this repository has never been vendored. Next: run `hejbro vendor` first.",
		);
	}
	return lock;
};

const runVendorCheck = (cwd: string): VendorResult => {
	const lock = requireVendoredLock(cwd);
	const schemaText = readFileSync(vendorSchemaPath(cwd), "utf8");
	const sqlText = readFileSync(vendorSqlPath(cwd), "utf8");
	const contractText = readFileSync(vendorContractPath(cwd), "utf8");
	const matches =
		sha256Hex(schemaText) === lock.schemaHash &&
		sha256Hex(sqlText) === lock.sqlHash &&
		sha256Hex(contractText) === lock.contractHash;
	if (matches) {
		return {
			exitCode: 0,
			stdout: ["vendor --check: up to date"],
			stderr: null,
		};
	}
	return throwHejbroError(
		"vendor-check-mismatch",
		'the vendored files no longer match the lock — at least one of ".hejbro/vendor/schema.json"/".hejbro/vendor/snapshot.sql"/".hejbro/vendor/contract.ts" was edited after the last `hejbro vendor`. Next: run `hejbro vendor` to restore them, or revert the hand edit.',
	);
};

/** The contract is the easiest of the three vendored files for a
 * consumer to touch by hand (it's the one their own code imports), so
 * `--check`'s hash list covers it the same way it already covers the
 * description and the squashed SQL (5.11's own design note, `lock.ts`). */
const buildContractOrigin = (
	fetched: { readonly commit: string },
	schemaText: string,
): ContractOrigin => ({
	commit: fetched.commit,
	exportHash: sha256Hex(schemaText),
});

const runVendorUpdate = (
	cwd: string,
	source: string,
	ref: string | undefined,
): VendorResult => {
	const fetched = withGitDiagnostic("vendor", source, () =>
		resolveExport(cwd, source, ref),
	);
	const contractText = emitContract(
		fetched.payload,
		buildContractOrigin(fetched, fetched.schemaText),
	);
	mkdirSync(vendorDirPath(cwd), { recursive: true });
	writeFileSync(vendorSchemaPath(cwd), fetched.schemaText);
	writeFileSync(vendorSqlPath(cwd), fetched.sqlText);
	writeFileSync(vendorContractPath(cwd), contractText);
	writeLock(cwd, {
		resolvedFrom: fetched.ref,
		commit: fetched.commit,
		descriptionFormat: fetched.format.descriptionFormat,
		schemaHash: sha256Hex(fetched.schemaText),
		sqlHash: sha256Hex(fetched.sqlText),
		contractHash: sha256Hex(contractText),
	});
	return {
		exitCode: 0,
		stdout: [`vendored ${fetched.commit} (${fetched.ref})`],
		stderr: null,
	};
};

/** Refuses `--schema` outright rather than accepting and silently
 * ignoring it (schema-vendoring spec, "The schema filter is reserved,
 * not silently ignored") — a caller who believes it applied would ship
 * a contract describing more than they asked for. Reserved for a future
 * filtering feature; no such feature exists yet, so any value at all is
 * refused the same way. */
const assertNoSchemaFilter = (argv: ReadonlyArray<string>): void => {
	if (!argv.includes("--schema")) {
		return;
	}
	throwHejbroError(
		"vendor-schema-filter-reserved",
		"--schema is reserved for a future filtering feature and is refused rather than silently ignored. Next: remove --schema; every schema in the export is vendored.",
	);
};

export const runVendor = (
	cwd: string,
	argv: ReadonlyArray<string>,
): VendorResult => {
	const fallbackIdentity = "vendor";
	try {
		assertNoSchemaFilter(argv);
		if (argv.includes("--check")) {
			return runVendorCheck(cwd);
		}
		// `hejbro.lock` is entirely vendor's own file (4.13: `link` never
		// touches it) -- its guard runs first, before any dependent work
		// (reading the linked source, reaching the network), the same
		// order every destination file's own guard runs in this codebase.
		assertLockWritable(cwd, argv.includes("--force"));
		const source = requireLinkedSource(cwd);
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
			description: "overwrite a hejbro.lock this tool did not write",
		},
	},
	run: async (ctx) => {
		const result = runVendor(process.cwd(), ctx.rawArgs);
		result.stdout.map((line) => console.log(line));
		if (result.stderr !== null) {
			console.error(result.stderr);
		}
		process.exitCode = result.exitCode;
	},
});
