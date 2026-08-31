import { HejbroError, MANIFEST_FORMAT, parseSnapshot } from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { z } from "zod";
import type { ManifestRow } from "../manifest-read";
import {
	countManifestRowsAfter,
	findManifestRowByStamp,
	readNewestManifestRow,
} from "../manifest-read";
import type { ManifestDocument } from "./emit";

const manifestColumnFactSchema = z.object({
	key: z.string(),
	mode: z.enum(["bigint", "number", "string"]).nullable(),
	notNullElements: z.boolean(),
});

const manifestTableFactSchema = z.object({
	schemaName: z.string(),
	tableName: z.string(),
	exportName: z.string().nullable(),
	columns: z.record(z.string(), manifestColumnFactSchema),
});

const manifestFunctionFactSchema = z.object({
	schemaName: z.string(),
	functionName: z.string(),
	exportName: z.string().nullable(),
});

/**
 * The payload's own shape (`manifest-payload.ts`'s `ManifestPayload`,
 * restated here rather than imported as a schema -- that file exports
 * only the TypeScript type, and validating a value arriving from a
 * database column is this reader's own job, same reasoning as
 * `EnumSnapshot`/object-key parsing staying local to `sync/` rather than
 * growing core or group 3's own surface). The embedded `snapshot` field
 * is checked only for "is an object" here -- its own deep validation is
 * `parseSnapshot`'s job (reuse first), run separately once this shape
 * passes.
 */
const manifestPayloadShapeSchema = z.object({
	tables: z.array(manifestTableFactSchema),
	functions: z.array(manifestFunctionFactSchema),
	roles: z.array(z.string()),
	snapshot: z.record(z.string(), z.unknown()),
});

type PayloadParseResult =
	| {
			readonly ok: true;
			readonly document: Omit<ManifestDocument, "snapshotHash">;
	  }
	| { readonly ok: false; readonly reason: "shape"; readonly detail: string }
	| {
			readonly ok: false;
			readonly reason: "snapshot-format";
			readonly embeddedFormatVersion: number | null;
	  };

const tryParseJson = (
	text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false };
	}
};

/** `unsupported-snapshot-version` is core's own code for a snapshot format this reader is too old or too new for -- distinct from every other way `parseSnapshot` can fail (`invalid-snapshot`, a genuine shape problem), which folds into the same "payload does not answer its own format" situation as every other shape mismatch here. */
const isSnapshotFormatError = (error: unknown): error is HejbroError =>
	error instanceof HejbroError && error.code === "unsupported-snapshot-version";

/** The embedded snapshot's own claimed `formatVersion`, read directly rather than through core's error text -- `unknown` when the value isn't even a number, which the caller still has enough to report ("an unrecognized format") without needing the exact figure. */
const embeddedFormatVersionOf = (snapshotValue: unknown): number | null => {
	if (typeof snapshotValue !== "object" || snapshotValue === null) {
		return null;
	}
	const version = (snapshotValue as { readonly formatVersion?: unknown })
		.formatVersion;
	if (typeof version !== "number") {
		return null;
	}
	return version;
};

const tryParseEmbeddedSnapshot = (
	snapshotValue: unknown,
):
	| { readonly ok: true; readonly snapshot: ManifestDocument["snapshot"] }
	| {
			readonly ok: false;
			readonly reason: "shape";
			readonly detail: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "snapshot-format";
			readonly embeddedFormatVersion: number | null;
	  } => {
	try {
		const snapshot = parseSnapshot(JSON.stringify(snapshotValue));
		return { ok: true, snapshot };
	} catch (error) {
		if (isSnapshotFormatError(error)) {
			// Never `error.message` here: core's own text is written for a
			// snapshot *file on disk* (it says `hejbro init`/"delete this
			// file"), which this consumer has no such file to act on
			// (ps-planner review) -- the caller builds its own remedy from
			// the version number alone.
			return {
				ok: false,
				reason: "snapshot-format",
				embeddedFormatVersion: embeddedFormatVersionOf(snapshotValue),
			};
		}
		return {
			ok: false,
			reason: "shape",
			detail:
				"the embedded snapshot does not match the shape this manifest format promises",
		};
	}
};

/**
 * Parses and validates a manifest row's `manifest` column against the
 * shape it claims (schema-manifest delta, `PAYLOAD-READ-FINAL=validated`):
 * a row whose own `manifest_format` this reader recognizes can still hold
 * a payload that is not what that format promises -- hand-edited,
 * truncated, or written by another tool -- and an unchecked cast turns
 * exactly that into a module whose types look sound. Never asserts a
 * cause (which field, whether it was edited or truncated is not observed
 * here); only reports that the shape didn't match, and, separately, when
 * the trouble is specifically the embedded snapshot's own format (a
 * different situation this reader's own format-skew requirement owns,
 * never folded into "invalid").
 */
export const parseManifestPayload = (
	manifestText: string,
): PayloadParseResult => {
	const parsedJson = tryParseJson(manifestText);
	if (!parsedJson.ok) {
		return {
			ok: false,
			reason: "shape",
			detail: "the manifest column is not valid JSON",
		};
	}
	const shapeResult = manifestPayloadShapeSchema.safeParse(parsedJson.value);
	if (!shapeResult.success) {
		const [firstIssue] = shapeResult.error.issues;
		const path = firstIssue?.path.join(".") ?? "(root)";
		return {
			ok: false,
			reason: "shape",
			detail: `"${path}" does not match the shape this manifest format promises`,
		};
	}
	const snapshotResult = tryParseEmbeddedSnapshot(shapeResult.data.snapshot);
	if (!snapshotResult.ok) {
		return snapshotResult;
	}
	return {
		ok: true,
		document: {
			tables: shapeResult.data.tables,
			functions: shapeResult.data.functions,
			roles: shapeResult.data.roles,
			snapshot: snapshotResult.snapshot,
		},
	};
};

/**
 * All seven situations a manifest reader meets (schema-sync delta) --
 * `"found"` carries `distance` (how many rows follow the matched one) so
 * a caller owning the freshness-by-comparison requirement (group 6) can
 * tell a current module (`distance === 0`) from a stale one without a
 * second classifier: the mechanics are the same reader's, only the
 * vocabulary a caller puts on `distance > 0` differs. `sync`'s own five
 * (missing/empty/stamp-unmatched/format-unsupported/payload-invalid) and
 * the format-skew requirement's embedded-snapshot refusal are each their
 * own variant so a caller gives each its own code and remedy.
 */
export type ManifestState =
	| { readonly situation: "missing" }
	| { readonly situation: "empty" }
	| { readonly situation: "stamp-unmatched" }
	| {
			readonly situation: "format-unsupported";
			readonly rowFormat: number | null;
	  }
	| { readonly situation: "payload-invalid"; readonly detail: string }
	| {
			readonly situation: "snapshot-format-refused";
			readonly embeddedFormatVersion: number | null;
	  }
	| {
			readonly situation: "found";
			readonly document: ManifestDocument;
			readonly distance: number;
	  };

/**
 * Classifies a single already-found row's own format and payload -- pure,
 * and shared by both entry points below (a newest-row read and a
 * stamp-matched read reach the exact same format/payload rules once a
 * row is in hand). `manifest_format` is checked before the payload is
 * ever parsed (schema-sync delta, "A manifest format higher than the
 * reader knows is refused"): a format higher than {@link
 * MANIFEST_FORMAT} is refused without calling {@link
 * parseManifestPayload} at all, so a payload this reader cannot
 * understand is never interpreted.
 */
const classifyFoundRow = (
	row: ManifestRow,
	distance: number,
): ManifestState => {
	if (row.manifestFormat > MANIFEST_FORMAT) {
		return { situation: "format-unsupported", rowFormat: row.manifestFormat };
	}
	const payloadResult = parseManifestPayload(row.manifest);
	if (!payloadResult.ok) {
		if (payloadResult.reason === "snapshot-format") {
			return {
				situation: "snapshot-format-refused",
				embeddedFormatVersion: payloadResult.embeddedFormatVersion,
			};
		}
		return { situation: "payload-invalid", detail: payloadResult.detail };
	}
	return {
		situation: "found",
		distance,
		document: { ...payloadResult.document, snapshotHash: row.snapshotHash },
	};
};

/** Postgres's own SQLSTATE for "no such relation" -- the one way either read below throwing means "no manifest table", as opposed to a genuinely unexpected driver failure (a dropped connection mid-query, say), which this rethrows rather than misreport as "missing". */
const isUndefinedTableError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "42P01";

/**
 * Reads the manifest through the handed session and classifies the
 * result into one of the seven situations a manifest reader meets
 * (schema-sync delta) -- `expectedStamp: null` (a plain `sync` write,
 * which has no prior stamp to match) reads the newest row and never
 * counts a distance (there is nothing to be after the newest); a real
 * stamp (not yet wired into any command this round -- group 6's own
 * job) searches for the matching row and counts what follows it.
 * Targeted queries throughout ({@link findManifestRowByStamp}, {@link
 * countManifestRowsAfter}), never a full-table fetch: the manifest is an
 * append-only history with no row-count ceiling.
 *
 * A table that is genuinely empty reports as `"stamp-unmatched"` rather
 * than `"empty"` when `expectedStamp` is given (distinguishing the two
 * would need an extra existence check this reader doesn't make) --
 * `"empty"` is reserved for the `expectedStamp: null` path, where it is
 * exactly what a `null` result means.
 */
export const readManifestState = async (
	session: DriverSession,
	expectedStamp: string | null,
): Promise<ManifestState> => {
	try {
		if (expectedStamp === null) {
			const row = await readNewestManifestRow(session);
			if (row === null) {
				return { situation: "empty" };
			}
			return classifyFoundRow(row, 0);
		}
		const row = await findManifestRowByStamp(session, expectedStamp);
		if (row === null) {
			return { situation: "stamp-unmatched" };
		}
		const distance = await countManifestRowsAfter(session, row.seq);
		return classifyFoundRow(row, distance);
	} catch (error) {
		if (isUndefinedTableError(error)) {
			return { situation: "missing" };
		}
		if (error instanceof z.ZodError) {
			return { situation: "format-unsupported", rowFormat: null };
		}
		throw error;
	}
};
