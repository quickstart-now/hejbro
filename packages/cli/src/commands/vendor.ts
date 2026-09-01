import { readFileSync, writeFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { resolveExport } from "../vendor/fetch";
import { withGitDiagnostic } from "../vendor/git-diagnostic";
import type { VendorLock } from "../vendor/lock";
import {
	readVendorLock,
	vendorSchemaPath,
	vendorSqlPath,
	writeVendorLock,
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

const requireLinkedSource = (cwd: string): VendorLock => {
	const lock = readVendorLock(cwd);
	if (lock === null) {
		return throwHejbroError(
			"vendor-source-not-linked",
			"hejbro vendor needs a linked source. Next: run `hejbro link <repository>` first.",
		);
	}
	return lock;
};

const runVendorCheck = (cwd: string, lock: VendorLock): VendorResult => {
	if (lock.commit === undefined) {
		return throwHejbroError(
			"vendor-not-yet-vendored",
			"hejbro vendor --check has nothing to compare against: this repository is linked but has never been vendored. Next: run `hejbro vendor` first.",
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
	lock: VendorLock,
	ref: string | undefined,
): VendorResult => {
	const fetched = withGitDiagnostic("vendor", lock.source, () =>
		resolveExport(cwd, lock.source, ref),
	);
	// No overwrite guard here: `requireLinkedSource` already read (and so
	// already validated) any pre-existing lock via `readVendorLock` --
	// once the directory's ownership is established, this run's own
	// schema.json/snapshot.sql/lock.json are always safe to overwrite.
	writeFileSync(vendorSchemaPath(cwd), fetched.schemaText);
	writeFileSync(vendorSqlPath(cwd), fetched.sqlText);
	writeVendorLock(cwd, {
		source: lock.source,
		ref: fetched.ref,
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

export const runVendor = (
	cwd: string,
	argv: ReadonlyArray<string>,
): VendorResult => {
	const fallbackIdentity = "vendor";
	try {
		const lock = requireLinkedSource(cwd);
		if (argv.includes("--check")) {
			return runVendorCheck(cwd, lock);
		}
		return runVendorUpdate(cwd, lock, flagValue(argv, "--ref"));
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
