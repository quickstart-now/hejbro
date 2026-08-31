import { throwHejbroError } from "../error";
import { HEJBRO_SNAPSHOT_VERSION } from "../snapshot/snapshot";
import { qualifyName, quoteIdentifier } from "./identifier";
import { quoteStringLiteral } from "./literal";

/**
 * The schema-manifest capability's own format number — independent of
 * {@link HEJBRO_SNAPSHOT_VERSION}, which the embedded snapshot payload
 * carries as a separate value (they move independently).
 */
export const MANIFEST_FORMAT = 1;

const MANIFEST_SCHEMA = "hejbro";
const MANIFEST_TABLE = "schema_manifest";
const manifestTableRef = qualifyName(MANIFEST_SCHEMA, MANIFEST_TABLE);

/**
 * The dollar-quote tag wrapping a manifest row's payload. Fixed (never
 * content-derived), so a payload containing it as a substring is refused
 * rather than emitted as a statement that could parse differently from how
 * it reads.
 */
export const MANIFEST_PAYLOAD_TERMINATOR = "$hejbro_manifest$";

/**
 * What a caller supplies to emit a manifest row: the already-serialized
 * payload string and the already-computed snapshot hash. Core neither
 * serializes nor hashes — both are the CLI's job (`engine/chain.ts`'s
 * hash/serialize-ownership boundary).
 */
export type ManifestOptions = {
	readonly payload: string;
	readonly snapshotHash: string;
};

/**
 * `create schema if not exists`/`create table if not exists` for the
 * manifest table — idempotent so a chain applied from any of its
 * migrations creates the table before writing to it. `seq` is an identity
 * column (server-assigned) and `applied_at` a column default (server-
 * evaluated): neither is ever supplied by the insert, which is what keeps
 * this statement's own text free of any per-run value.
 */
const bootstrapStatement = (): string =>
	[
		`create schema if not exists ${quoteIdentifier(MANIFEST_SCHEMA)};`,
		`create table if not exists ${manifestTableRef} (`,
		`\t${quoteIdentifier("seq")} bigint generated always as identity primary key,`,
		`\t${quoteIdentifier("manifest_format")} integer not null,`,
		`\t${quoteIdentifier("snapshot_format")} integer not null,`,
		`\t${quoteIdentifier("snapshot_hash")} text not null,`,
		`\t${quoteIdentifier("manifest")} text not null,`,
		`\t${quoteIdentifier("applied_at")} timestamptz not null default now()`,
		");",
	].join("\n");

const MANIFEST_INSERT_COLUMNS = [
	"manifest_format",
	"snapshot_format",
	"snapshot_hash",
	"manifest",
] as const;

/**
 * The insert's own fail-closed guard (the payload is embedded so that it
 * cannot be misread): a payload containing the fixed dollar-quote tag
 * would terminate the quoting early, so generation refuses rather than
 * emit a statement whose parsed meaning differs from its text.
 */
const guardPayload = (payload: string): void => {
	if (payload.includes(MANIFEST_PAYLOAD_TERMINATOR)) {
		throwHejbroError(
			"manifest-payload-unquotable",
			`the manifest payload contains its own quoting terminator (${MANIFEST_PAYLOAD_TERMINATOR}), so it cannot be embedded safely. Next: this is an internal hejbro invariant — please file an issue with hejbro including the declarations that produced it.`,
		);
	}
};

const insertStatement = (options: ManifestOptions): string => {
	guardPayload(options.payload);
	const columns = MANIFEST_INSERT_COLUMNS.map(quoteIdentifier).join(", ");
	const values = [
		String(MANIFEST_FORMAT),
		String(HEJBRO_SNAPSHOT_VERSION),
		quoteStringLiteral(options.snapshotHash),
		`${MANIFEST_PAYLOAD_TERMINATOR}${options.payload}${MANIFEST_PAYLOAD_TERMINATOR}`,
	].join(", ");
	return `insert into ${manifestTableRef} (${columns}) values (${values});`;
};

/**
 * Renders the manifest bootstrap and insert, in that order, or `[]` when
 * `options` is absent — a migration then carries no manifest trace at all,
 * byte-identical to the capability being absent. Pure: no clock, no file
 * name; `options` already carries both values `bootstrapStatement`/
 * `insertStatement` would otherwise have needed to derive.
 */
export const renderManifestStatements = (
	options: ManifestOptions | undefined,
): ReadonlyArray<string> => {
	if (options === undefined) {
		return [];
	}
	return [bootstrapStatement(), insertStatement(options)];
};
