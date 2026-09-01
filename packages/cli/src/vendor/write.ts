import { existsSync, readFileSync } from "node:fs";
import { throwHejbroError } from "@hejbro/core";
import { CONTRACT_MARKER } from "../contract/emit";

/** The textual mark every lock this tool writes carries — checked as a
 * substring, never by parsing the existing file as JSON first (schema-
 * vendoring spec, "Vendoring never overwrites a file it did not write" /
 * "The check SHALL be textual"). Adopted from the schema-sync capability's
 * own `SYNCED_MODULE_MARKER` (D87 polyrepo-sync, R2-G4, 4.7): same
 * mechanism, renamed for the vendor world, where the guarded file is
 * `hejbro.lock` rather than a generated TS module — `hejbro.lock` is
 * always a hejbro-only format, unlike `schema.json`/`snapshot.sql`,
 * which are kept as byte-identical copies of what the schema repository
 * published (so a consumer can diff them directly against the upstream
 * export) and therefore carry no mark of their own. */
export const VENDOR_LOCK_MARKER = '"generatedBy": "hejbro vendor"';

/** Whether `text` carries a vendor lock's own mark. */
export const isVendorLockText = (text: string): boolean =>
	text.includes(VENDOR_LOCK_MARKER);

/**
 * Refuses to write over `lockPath` when it already exists and doesn't
 * carry this tool's own mark — naming the path and both ways forward,
 * per the delta's own text — unless `force` is given. Writing nothing
 * and refusing loudly is the same silent-wrong-answer risk this whole
 * capability exists to remove, moved from a type to a working tree
 * (carried over from the schema-sync capability's own
 * `writeSyncedModule`). Takes the path as a value, not a `cwd`, so this
 * module has no dependency on `./lock`'s own path conventions.
 */
export const assertVendorDestinationWritable = (
	lockPath: string,
	force: boolean,
): void => {
	if (!existsSync(lockPath) || force) {
		return;
	}
	const existingText = readFileSync(lockPath, "utf8");
	if (isVendorLockText(existingText)) {
		return;
	}
	throwHejbroError(
		"vendor-destination-not-vendored",
		`"${lockPath}" already exists and doesn't look like a file \`hejbro vendor\` wrote. Next: remove it, or pass --force if overwriting it is what you want.`,
	);
};

/**
 * D106 M6: `contract.ts` is the one vendored destination the overwrite
 * guard originally left unprotected — unlike `schema.json`/
 * `snapshot.sql` (byte-identical upstream copies whose integrity the
 * lock's own hashes already cover, `--check`'s job, not this guard's),
 * `contract.ts` is generated *by this tool*, carries its own header
 * marker, and is the one file a consumer's own code imports — the
 * destination the delta's "never loading the existing file as code"
 * reasoning was actually written for. Same shape as
 * {@link assertVendorDestinationWritable}, checked against
 * `CONTRACT_MARKER` instead of the lock's own mark.
 */
export const assertContractDestinationWritable = (
	contractPath: string,
	force: boolean,
): void => {
	if (!existsSync(contractPath) || force) {
		return;
	}
	const existingText = readFileSync(contractPath, "utf8");
	if (existingText.includes(CONTRACT_MARKER)) {
		return;
	}
	throwHejbroError(
		"vendor-destination-not-vendored",
		`"${contractPath}" already exists and doesn't look like a file \`hejbro vendor\` wrote. Next: remove it, or pass --force if overwriting it is what you want.`,
	);
};
