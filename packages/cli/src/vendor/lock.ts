import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson, throwHejbroError } from "@hejbro/core";
import type { DestinationWritableCommand } from "./write";
import { assertVendorDestinationWritable, isVendorLockText } from "./write";

/** The consumer-side vendor directory for the two raw, byte-identical
 * copies — symmetric to the schema repository's own `.hejbro/export/`
 * (`export/write.ts`). The lock itself is NOT here (see {@link
 * LOCK_FILE_NAME}): it belongs at the repository root, the same place
 * `package-lock.json`/`go.sum` sit, so a reviewer sees a schema move in
 * a pull request's own file list rather than inside a hidden directory
 * (owner decision). */
export const VENDOR_DIR_NAME = ".hejbro/vendor";
export const VENDOR_SCHEMA_FILE = "schema.json";
export const VENDOR_SQL_FILE = "snapshot.sql";
export const VENDOR_CONTRACT_FILE = "contract.ts";

/** `vendor`'s own file, at the repository root — `link` never touches
 * it (owner decision, 4.13): the source lives in the sibling
 * `hejbro.json` (`source-file.ts`) instead, so the two files are always
 * a pair the way `package.json`/`package-lock.json` are, and `hejbro.lock`
 * is truth alone, with no intent mixed in. */
export const LOCK_FILE_NAME = "hejbro.lock";

export const vendorDirPath = (cwd: string): string =>
	join(cwd, VENDOR_DIR_NAME);
export const vendorSchemaPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SCHEMA_FILE);
export const vendorSqlPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_SQL_FILE);
export const vendorContractPath = (cwd: string): string =>
	join(vendorDirPath(cwd), VENDOR_CONTRACT_FILE);
export const lockPath = (cwd: string): string => join(cwd, LOCK_FILE_NAME);

/**
 * `vendor`'s own resolution record, rewritten every run: the commit,
 * the ref it was resolved from, the description's format version, and
 * all three vendored files' content hashes (what lets `vendor --check`
 * compare against the lock with no network at all — R2-G5 5.11 adds
 * `contractHash` alongside `schemaHash`/`sqlHash` so a hand-edited
 * contract is caught the same way: it is the easiest of the three to
 * touch, being the one file a consumer's own code imports). Carries no
 * source — that is the sibling `hejbro.json`'s own, single fact.
 */
/**
 * Whether the lock's commit came from the remote's default branch or
 * from an explicit `--ref` (member 11 of the eleven: "the lock was
 * resolved from somewhere other than the default branch"). A
 * discriminant string, not a boolean — a boolean can only say "pinned",
 * this says *what happened*.
 */
export type LockResolvedBy = "default-branch" | "explicit-ref";

/**
 * `generatedBy` widens to `"hejbro pull"` (CI-G4-R1-01): a pull lock
 * carries `database`/`schemas` in place of `commit` (mirroring
 * `ContractOrigin`'s own two shapes), never a discriminated union of its
 * own -- every other field stays optional-and-absent for a pull lock
 * (`resolvedFrom`/`resolvedBy`/hashes) the same way an old, pre-hash
 * vendor lock already tolerates an absent field (member 6's own
 * format-skew rule), rather than inventing a second lock shape a reader
 * has to branch on.
 */
export type VendorLock = {
	readonly generatedBy: "hejbro vendor" | "hejbro pull";
	readonly resolvedFrom?: string;
	readonly resolvedBy?: LockResolvedBy;
	readonly commit?: string;
	readonly descriptionFormat?: number;
	readonly schemaHash?: string;
	readonly sqlHash?: string;
	readonly contractHash?: string;
	readonly database?: string;
	readonly schemas?: ReadonlyArray<string>;
};

/** Asymmetric-tolerant, matching the format-skew rule (member 6): a lock
 * written before this field existed carries no opinion, and an absent
 * opinion reads as `"default-branch"` rather than breaking. */
export const lockResolvedBy = (lock: VendorLock): LockResolvedBy =>
	lock.resolvedBy ?? "default-branch";

/** `vendor`'s own guard: refuses to claim `hejbro.lock` when it already
 * exists and isn't one this tool wrote, unless `force`. `commandName`
 * (D106 R3-N2) picks the remedy text that actually applies to whichever
 * command is asking -- `pull` shares this guard but has no `--force`. */
export const assertLockWritable = (
	cwd: string,
	force: boolean,
	commandName: DestinationWritableCommand,
): void => assertVendorDestinationWritable(lockPath(cwd), force, commandName);

/**
 * `null` when nothing has been vendored yet. Refuses (never silently
 * trusts) a `hejbro.lock` that exists but doesn't carry this tool's own
 * mark — the same guard {@link assertLockWritable} applies before a
 * write, applied here before a read ever treats foreign content as a
 * real lock. Reclaim the file with `hejbro vendor --force` first if
 * that's genuinely what's wanted; there is no force-to-read here, only
 * force-to-overwrite.
 */
export const readLock = (cwd: string): VendorLock | null => {
	const path = lockPath(cwd);
	if (!existsSync(path)) {
		return null;
	}
	const text = readFileSync(path, "utf8");
	if (!isVendorLockText(text)) {
		return throwHejbroError(
			"vendor-destination-not-vendored",
			`"${path}" already exists and doesn't look like a file \`hejbro vendor\` wrote. Next: remove it, or pass --force to \`hejbro vendor\` if overwriting it is what you want.`,
		);
	}
	return JSON.parse(text) as VendorLock;
};

/**
 * `generatedBy` is now a required field on `lock` itself (CI-G4-R1-01),
 * not hardcoded here -- `vendor` and `pull` each write their own mark,
 * and a default would have silently kept minting `"hejbro vendor"` the
 * moment a second writer appeared, exactly the risk `check/driver.ts`'s
 * own required `codes` parameter already guards against elsewhere in
 * this codebase.
 */
export const writeLock = (cwd: string, lock: VendorLock): void => {
	writeFileSync(lockPath(cwd), stableJson(lock));
};

/**
 * Refuses with `vendor-origin-not-a-commit` when `lock` names no commit
 * because it came from `pull` (schema-vendoring spec: "`vendor --check`
 * and `outdated` SHALL refuse to run against it... naming `link` as the
 * way to a commit-anchored contract") -- the operation stops because
 * there is no commit to compare against, not because a database was
 * involved, so the code names the missing fact rather than the source.
 * `commandName` is the caller's own name (`hejbro outdated`/
 * `hejbro vendor --check`), matching every other connection/precondition
 * diagnostic in this codebase.
 */
export const assertLockNamesACommit = (
	lock: VendorLock,
	commandName: string,
): void => {
	if (lock.generatedBy !== "hejbro pull") {
		return;
	}
	throwHejbroError(
		"vendor-origin-not-a-commit",
		`${commandName} has nothing to compare against: this repository's contract was inferred from a database (\`hejbro pull\`, "${lock.database}"), which carries no commit. Next: run \`hejbro link <repository>\` to point at a schema repository, then \`hejbro vendor\`, then rerun ${commandName}.`,
	);
};
