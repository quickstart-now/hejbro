import { HejbroError, parseSnapshot } from "@hejbro/core";
import type { DriverSession } from "@hejbro/query";
import { z } from "zod";
import type { ManifestRowWithSeq } from "../manifest-read";
import { readManifestRows } from "../manifest-read";
import type { ManifestDocument } from "./emit";

/**
 * The format `sync`'s own reader knows how to interpret (`sql/manifest.ts`'s
 * `MANIFEST_FORMAT`, restated here) -- not yet exported from core's public
 * surface (flagged, pending owner confirmation), so this is a second copy
 * of the same fact rather than a re-export. If core's own value ever
 * changes without this one moving too, a real manifest row would compare
 * against the wrong number.
 */
export const READER_MANIFEST_FORMAT = 1;

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
			readonly detail: string;
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

const tryParseEmbeddedSnapshot = (
	snapshotValue: unknown,
):
	| { readonly ok: true; readonly snapshot: ManifestDocument["snapshot"] }
	| {
			readonly ok: false;
			readonly reason: "shape" | "snapshot-format";
			readonly detail: string;
	  } => {
	try {
		const snapshot = parseSnapshot(JSON.stringify(snapshotValue));
		return { ok: true, snapshot };
	} catch (error) {
		if (isSnapshotFormatError(error)) {
			return {
				ok: false,
				reason: "snapshot-format",
				detail: error.message,
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
 * All seven situations a manifest reader meets (schema-sync delta) --
 * `"found"` carries `distance` (how many rows this session read follow
 * the matched one) so a caller owning the freshness-by-comparison
 * requirement (group 6) can tell a current module (`distance === 0`)
 * from a stale one without a second classifier: the mechanics are the
 * same reader's, only the vocabulary a caller puts on `distance > 0`
 * differs. `sync`'s own five (missing/empty/stamp-unmatched/format-
 * unsupported/payload-invalid) and the format-skew requirement's
 * embedded-snapshot refusal are each their own variant so a caller gives
 * each its own code and remedy.
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
	| { readonly situation: "snapshot-format-refused"; readonly detail: string }
	| {
			readonly situation: "found";
			readonly document: ManifestDocument;
			readonly distance: number;
	  };

/** The row matching `expectedStamp`, or the newest row when `expectedStamp` is `null` -- a plain (write) `sync` run has no prior stamp to match, so it always reads the newest; a caller that does (not yet wired into any command this round) searches every row instead. */
const targetRow = (
	rows: ReadonlyArray<ManifestRowWithSeq>,
	expectedStamp: string | null,
): ManifestRowWithSeq | undefined => {
	if (expectedStamp === null) {
		return rows.at(-1);
	}
	return rows.find((row) => row.snapshotHash === expectedStamp);
};

/**
 * Classifies an already-fetched set of manifest rows into one of the
 * seven situations a manifest reader meets (schema-sync delta) -- pure,
 * so every situation but "missing" (which needs the query itself to have
 * thrown, `readManifestState`'s own job) is unit-testable with no
 * database at all. `manifest_format` is checked before the payload is
 * ever parsed (schema-sync delta, "A manifest format higher than the
 * reader knows is refused"): a format higher than {@link
 * READER_MANIFEST_FORMAT} is refused without calling {@link
 * parseManifestPayload} at all, so a payload this reader cannot
 * understand is never interpreted.
 */
export const classifyManifestRows = (
	rows: ReadonlyArray<ManifestRowWithSeq>,
	expectedStamp: string | null,
): ManifestState => {
	if (rows.length === 0) {
		return { situation: "empty" };
	}
	const target = targetRow(rows, expectedStamp);
	if (target === undefined) {
		return { situation: "stamp-unmatched" };
	}
	if (target.manifestFormat > READER_MANIFEST_FORMAT) {
		return {
			situation: "format-unsupported",
			rowFormat: target.manifestFormat,
		};
	}
	const payloadResult = parseManifestPayload(target.manifest);
	if (!payloadResult.ok) {
		if (payloadResult.reason === "snapshot-format") {
			return {
				situation: "snapshot-format-refused",
				detail: payloadResult.detail,
			};
		}
		return { situation: "payload-invalid", detail: payloadResult.detail };
	}
	const distance = rows.filter((row) => row.seq > target.seq).length;
	return {
		situation: "found",
		distance,
		document: { ...payloadResult.document, snapshotHash: target.snapshotHash },
	};
};

/** Postgres's own SQLSTATE for "no such relation" -- the one way `readManifestRows` throwing means "no manifest table", as opposed to a genuinely unexpected driver failure (a dropped connection mid-query, say), which this rethrows rather than misreport as "missing". */
const isUndefinedTableError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "42P01";

/**
 * Reads every manifest row through the handed session and classifies the
 * result -- the one place `readManifestRows`'s own two ways of throwing
 * (the table doesn't exist; a row's own columns don't validate) become
 * two of the seven named situations, alongside every situation {@link
 * classifyManifestRows} derives from the rows themselves.
 */
export const readManifestState = async (
	session: DriverSession,
	expectedStamp: string | null,
): Promise<ManifestState> => {
	try {
		const rows = await readManifestRows(session);
		return classifyManifestRows(rows, expectedStamp);
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
