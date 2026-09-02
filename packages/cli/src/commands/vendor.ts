import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { defineCommand } from "citty";
import type { ContractOrigin } from "../contract/emit";
import { emitContract } from "../contract/emit";
import { fromHejbroError, renderDiagnostics } from "../diagnostics";
import { asHejbroError } from "../errors";
import { remoteHasCommit } from "../git";
import { sha256Hex } from "../hash";
import { identityFromMessage } from "../identity";
import { resolveExport } from "../vendor/fetch";
import { withGitDiagnostic } from "../vendor/git-diagnostic";
import type { LockResolvedBy, VendorLock } from "../vendor/lock";
import {
	assertLockNamesACommit,
	assertLockWritable,
	lockResolvedBy,
	readLock,
	vendorContractPath,
	vendorDirPath,
	vendorSchemaPath,
	vendorSqlPath,
	writeLock,
} from "../vendor/lock";
import { readSourceFile } from "../vendor/source-file";
import { assertBoundaryAtCheck, warnIfNonDefaultRef } from "../vendor/state";
import { assertContractDestinationWritable } from "../vendor/write";

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

const resolvedByFor = (ref: string | undefined): LockResolvedBy => {
	if (ref === undefined) {
		return "default-branch";
	}
	return "explicit-ref";
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
	assertLockNamesACommit(lock, "hejbro vendor --check");
	return lock;
};

/** `["${N} warning(s) — see below"]` when there are warnings, else `[]` — same O3 shape `generate` already uses, so a stdout-only consumer still learns a warning fired. */
const warningSummaryLines = (
	warnings: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (warnings.length === 0) {
		return [];
	}
	return [`${warnings.length} warning(s) — see below`];
};

const warningStderr = (warnings: ReadonlyArray<string>): string | null => {
	if (warnings.length === 0) {
		return null;
	}
	return warnings.join("\n\n");
};

const runVendorCheck = (
	cwd: string,
	strictFlag: boolean | undefined,
): VendorResult => {
	const lock = requireVendoredLock(cwd);
	const warnings: string[] = [];
	assertBoundaryAtCheck(lockResolvedBy(lock), strictFlag, (message: string) =>
		warnings.push(message),
	);
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
			stdout: ["vendor --check: up to date", ...warningSummaryLines(warnings)],
			stderr: warningStderr(warnings),
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
	source: "git",
	commit: fetched.commit,
	exportHash: sha256Hex(schemaText),
});

/**
 * Refuses to move an existing lock's commit forward when the remote no
 * longer has the commit it currently names (schema-vendoring spec, one
 * of the ten named failures: "The lock names a commit the remote no
 * longer has" — force-pushed, garbage-collected, or rewritten history). The
 * remedy is a decision, not a repair: `--force` is the same deliberate
 * override the destination-file guard already uses, reused here rather
 * than inventing a second one. Only reachable at `vendor` time (the
 * network is available); `--check` stays offline and never asks this
 * question, per the enumeration's own note.
 */
const assertLockCommitNotLost = (
	cwd: string,
	source: string,
	force: boolean,
): void => {
	if (force) {
		return;
	}
	const existingLock = readLock(cwd);
	if (existingLock === null || existingLock.commit === undefined) {
		return;
	}
	if (remoteHasCommit(source, existingLock.commit)) {
		return;
	}
	throwHejbroError(
		"vendor-lock-commit-lost",
		`hejbro.lock names commit ${existingLock.commit}, which "${source}" no longer has (force-pushed, garbage-collected, or rewritten history). Next: run \`hejbro vendor --force\` to deliberately move to the current commit, or find out why the schema repository's history changed before doing so.`,
	);
};

const runVendorUpdate = (
	cwd: string,
	source: string,
	ref: string | undefined,
	force: boolean,
): VendorResult => {
	// A non-default-ref lock is always advisory at `vendor` itself
	// ("advisory locally") -- an explicit --ref is the caller's own
	// deliberate choice on their own machine, never blocked here;
	// `vendor --check` (`assertBoundaryAtCheck`) is the boundary that can
	// actually fail on it.
	const resolvedBy = resolvedByFor(ref);
	// D106 M6: guards the one vendored destination the overwrite guard
	// originally missed, before any network work -- the same "guard
	// runs first" order the lock's own guard already follows in
	// `runVendor` below.
	assertContractDestinationWritable(vendorContractPath(cwd), force);
	const warnings: string[] = [];
	warnIfNonDefaultRef(resolvedBy, (message: string) => warnings.push(message));
	// Runs *after* `resolveExport` below succeeds, deliberately: that
	// call already proves the remote itself is reachable
	// (`vendor-remote-unreachable` would already have fired otherwise),
	// so a `false` from `remoteHasCommit` here can only mean the old
	// lock's own commit specifically is gone -- never a misdiagnosis of
	// "lost" for what is actually "the whole remote is down".
	const fetched = withGitDiagnostic("vendor", source, () =>
		resolveExport(cwd, source, ref),
	);
	assertLockCommitNotLost(cwd, source, force);
	const contractText = emitContract(
		fetched.payload,
		buildContractOrigin(fetched, fetched.schemaText),
	);
	mkdirSync(vendorDirPath(cwd), { recursive: true });
	writeFileSync(vendorSchemaPath(cwd), fetched.schemaText);
	writeFileSync(vendorSqlPath(cwd), fetched.sqlText);
	writeFileSync(vendorContractPath(cwd), contractText);
	writeLock(cwd, {
		generatedBy: "hejbro vendor",
		resolvedFrom: fetched.ref,
		resolvedBy,
		commit: fetched.commit,
		descriptionFormat: fetched.format.descriptionFormat,
		schemaHash: sha256Hex(fetched.schemaText),
		sqlHash: sha256Hex(fetched.sqlText),
		contractHash: sha256Hex(contractText),
	});
	return {
		exitCode: 0,
		stdout: [
			`vendored ${fetched.commit} (${fetched.ref})`,
			...warningSummaryLines(warnings),
		],
		stderr: warningStderr(warnings),
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

/** `--strict`/`--no-strict` always win; with neither, `resolveStrictMode`
 * (`tty.ts`) infers from the terminal. Named, not inferred from a `-`
 * prefix scan, since `--no-strict` must never be read as `strict: true`. */
const strictFlagValue = (argv: ReadonlyArray<string>): boolean | undefined => {
	if (argv.includes("--strict")) {
		return true;
	}
	if (argv.includes("--no-strict")) {
		return false;
	}
	return undefined;
};

export const runVendor = (
	cwd: string,
	argv: ReadonlyArray<string>,
): VendorResult => {
	const fallbackIdentity = "vendor";
	try {
		assertNoSchemaFilter(argv);
		const strictFlag = strictFlagValue(argv);
		if (argv.includes("--check")) {
			return runVendorCheck(cwd, strictFlag);
		}
		// `hejbro.lock` is entirely vendor's own file (4.13: `link` never
		// touches it) -- its guard runs first, before any dependent work
		// (reading the linked source, reaching the network), the same
		// order every destination file's own guard runs in this codebase.
		const force = argv.includes("--force");
		assertLockWritable(cwd, force);
		const source = requireLinkedSource(cwd);
		return runVendorUpdate(cwd, source, flagValue(argv, "--ref"), force);
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
		strict: {
			type: "boolean",
			description:
				"with --check, fail (rather than warn) on a non-default-branch lock; defaults to failing outside an interactive terminal",
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
