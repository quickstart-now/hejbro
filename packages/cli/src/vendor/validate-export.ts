import type { Snapshot, TypeNode } from "@hejbro/core";
import { parseSnapshot, simpleTypeNames, throwHejbroError } from "@hejbro/core";
import { z } from "zod";
import type {
	ExportFunctionArgFact,
	ExportFunctionReturnsFact,
	ExportTableFact,
} from "../export/description";
import type { ExportFormatRecord } from "../export/format";
import { EXPORT_DESCRIPTION_FORMAT } from "../export/format";

/** Mirrors `@hejbro/core`'s own `TypeNode` union (`types/type-node.ts`) — restated here rather than imported as a schema, since core exports the type but not a runtime validator for it (the same constraint `read-snapshot.ts`'s own doc comment already names for the table snapshot). `z.lazy` handles the one recursive member (`array`'s `element`). */
const typeNodeSchema: z.ZodType<TypeNode> = z.lazy(() =>
	z.union([
		z.object({ typeName: z.enum([...simpleTypeNames]) }),
		z.object({ typeName: z.literal("varchar"), length: z.number().nullable() }),
		z.object({ typeName: z.literal("char"), length: z.number() }),
		z.object({
			typeName: z.literal("numeric"),
			precision: z.number().nullable(),
			scale: z.number().nullable(),
		}),
		z.object({
			typeName: z.literal("enum"),
			enumSchema: z.string(),
			enumName: z.string(),
		}),
		z.object({ typeName: z.literal("array"), element: typeNodeSchema }),
	]),
);

const numericModeSchema = z.enum(["bigint", "number", "string"]).nullable();

/** Mirrors `export/description.ts`'s own `ExportColumnFact` — the sidecar facts a description carries per column. */
const columnFactSchema = z.object({
	key: z.string(),
	mode: numericModeSchema,
	notNullElements: z.boolean(),
});

/** `Object.entries` before zod ever builds a record from `value`, so a
 * key with object-literal meaning (`__proto__`) is read from the raw
 * JSON value's own real own-property (measured: `JSON.parse` carries it
 * correctly) rather than through `z.record`'s own internal per-key
 * assignment, which silently drops that one key (#697, R2-N2 sibling —
 * `z.record({...}).parse({"__proto__": ...})` measured directly:
 * `Object.hasOwn` on its result is `false`). Non-object input passes
 * through unchanged so the array schema below reports its own ordinary
 * type-mismatch error. */
const toEntries = (value: unknown): unknown => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return value;
	}
	return Object.entries(value);
};

/** A column-facts map read as `[key, fact]` entries and reassembled with
 * `Object.fromEntries` — which, unlike plain property assignment,
 * always creates an own data property, so every key the description
 * named (including `__proto__`) survives into `ExportColumns`. */
const columnFactsSchema = z
	.preprocess(toEntries, z.array(z.tuple([z.string(), columnFactSchema])))
	.transform((entries) => Object.fromEntries(entries));

const tableFactSchema = z.object({
	schemaName: z.string(),
	tableName: z.string(),
	exportName: z.string().nullable(),
	columns: columnFactsSchema,
	// add-unmanaged-objects: additive, no description-format bump -- an
	// export written before this field existed carries no `existing` key
	// at all, and MUST read as `false` (managed), never as a rejection.
	// `descriptionFormat` stays 1 either way (`export/format.ts`); a
	// reader that instead required the key would refuse an older,
	// perfectly valid export for a fact it never claimed to carry.
	existing: z.boolean().default(false),
});

const functionArgFactSchema = z.object({
	key: z.string(),
	sqlName: z.string(),
	typeNode: typeNodeSchema,
	mode: numericModeSchema,
	notNullElements: z.boolean(),
});

/** `null` for a trigger-synthesized function's return — neither a scalar value nor a row (schema-export delta). A scalar return carries no `notNullElements` — core refuses `.notNullElements()` at a `returns` position, so there is no such fact to carry. */
const functionReturnsFactSchema = z
	.union([
		z.object({
			kind: z.literal("scalar"),
			typeNode: typeNodeSchema,
			mode: numericModeSchema,
		}),
		z.object({
			kind: z.literal("table"),
			schemaName: z.string(),
			tableName: z.string(),
		}),
	])
	.nullable();

/**
 * `args`/`returns` are optional here, unlike `export/description.ts`'s
 * own always-present write side (#657, format-1's earlier shape): a
 * `schema.json` a pre-#587 `hejbro generate --export` wrote carries
 * neither key at all -- the writer never regresses, only a reader must
 * still parse what an older one produced.
 */
const functionFactSchema = z.object({
	schemaName: z.string(),
	functionName: z.string(),
	exportName: z.string().nullable(),
	args: z.array(functionArgFactSchema).optional(),
	returns: functionReturnsFactSchema.optional(),
});

/**
 * `ExportDescription`'s own top-level shape (`tables`/`functions`/
 * `roles`), plus the embedded `snapshot` — validated separately below
 * via `parseSnapshot` (the one function that already knows that shape's
 * own rules) rather than restated here as a second copy that could
 * drift from core's own.
 */
const descriptionShapeSchema = z.object({
	tables: z.array(tableFactSchema),
	functions: z.array(functionFactSchema),
	roles: z.array(z.string()),
	snapshot: z.unknown(),
});

const formatSchema = z.object({
	descriptionFormat: z.number(),
	snapshotFormat: z.number(),
});

/**
 * Refuses a `format.json` newer than this toolchain knows, naming both
 * versions and the upgrade command (schema-vendoring spec, member 6 of
 * the eleven — "A description format newer than the reader is refused").
 * An older format is read as-is (the description schema below has only
 * ever grown by additive fields since format 1 shipped, `EXPORT_
 * DESCRIPTION_FORMAT`'s own history) — this branch guards the format-
 * number axis only; format 1's own shape axis (its two function-fact
 * shapes, #657) is `functionFactSchema`'s own concern, above.
 */
const assertDescriptionFormatSupported = (format: ExportFormatRecord): void => {
	if (format.descriptionFormat <= EXPORT_DESCRIPTION_FORMAT) {
		return;
	}
	throwHejbroError(
		"vendor-export-format-unsupported",
		`the vendored export declares description format ${format.descriptionFormat}, newer than this toolchain's ${EXPORT_DESCRIPTION_FORMAT}. Next: run \`npm install -g hejbro@latest\` (or your package manager's equivalent) to read it.`,
	);
};

/**
 * A function fact exactly as it may be read (#657) — `args`/`returns`
 * optional, unlike `export/description.ts`'s own always-present write
 * side: a format-1 export written before the typed function surface
 * existed carries neither key, and reads as "present, untyped" rather
 * than refusing or guessing a value neither key ever had.
 */
export type ValidatedFunctionFact = {
	readonly schemaName: string;
	readonly functionName: string;
	readonly exportName: string | null;
	readonly args?: ReadonlyArray<ExportFunctionArgFact>;
	readonly returns?: ExportFunctionReturnsFact;
};

/**
 * `ExportPayload`'s own read-side counterpart (`export/write.ts`): every
 * field but `functions` is unchanged (a table fact's own shape has not
 * moved since format 1), and `functions` carries {@link
 * ValidatedFunctionFact} instead of the write side's always-typed one. A
 * value typed `ExportPayload` (every writer's own output, `pull`'s
 * included) already satisfies this — required fields satisfy an optional
 * one — so nothing downstream that only ever sees a current writer's
 * output has to change.
 */
export type ValidatedExportPayload = {
	readonly tables: ReadonlyArray<ExportTableFact>;
	readonly functions: ReadonlyArray<ValidatedFunctionFact>;
	readonly roles: ReadonlyArray<string>;
	readonly snapshot: Snapshot;
};

export type ValidatedExport = {
	readonly format: ExportFormatRecord;
	readonly payload: ValidatedExportPayload;
};

/**
 * Validates `format.json`'s own shape and version (member 6), then
 * `schema.json`'s shape against what that format promises (member 5,
 * "The export is present but does not answer its own format") — never
 * a blind cast (`fetch.ts`'s own prior behavior). The embedded
 * `snapshot` field is validated by `@hejbro/core`'s own `parseSnapshot`,
 * re-serialized to text first so this reuses that real validation
 * rather than restating it (the same "one parser, not two" reasoning
 * `stableJson` serialization already follows elsewhere in this
 * codebase).
 */
export const validateExport = (
	formatText: string,
	schemaText: string,
): ValidatedExport => {
	// D106 M3: a format.json that fails its own shape parse is "the
	// export does not answer its own format" (member 5) -- distinct from
	// member 6's "the format this toolchain knows is older than the one
	// declared", which only applies once the shape parses and its
	// version number can actually be read. Coding this branch as member
	// 6 sent readers to upgrade their own hejbro for a problem that
	// lives in the schema repository -- the delta's own stated harm.
	const formatParsed = formatSchema.safeParse(JSON.parse(formatText));
	if (!formatParsed.success) {
		return throwHejbroError(
			"vendor-export-invalid",
			"the vendored export's format.json does not answer its own format (schema-export spec) -- hand-edited, truncated, or written by something else. Next: ask the owner of the schema repository to regenerate it with `hejbro generate --export`.",
		);
	}
	assertDescriptionFormatSupported(formatParsed.data);

	const descriptionParsed = descriptionShapeSchema.safeParse(
		JSON.parse(schemaText),
	);
	if (!descriptionParsed.success) {
		return throwHejbroError(
			"vendor-export-invalid",
			"the vendored export's schema.json does not answer its own format (schema-export spec) -- hand-edited, truncated, or written by something else. Next: ask the owner of the schema repository to regenerate it with `hejbro generate --export`.",
		);
	}
	// Re-parses the embedded snapshot through core's own real validator --
	// `descriptionParsed.data` only proved `snapshot` is *some* JSON value.
	parseSnapshot(JSON.stringify(descriptionParsed.data.snapshot));

	return {
		format: formatParsed.data,
		payload: descriptionParsed.data as unknown as ValidatedExportPayload,
	};
};
