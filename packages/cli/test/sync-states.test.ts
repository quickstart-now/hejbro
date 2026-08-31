import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HejbroInput } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	HEJBRO_SNAPSHOT_VERSION,
	schema,
	table,
	uuid,
} from "@hejbro/core";
import type {
	CompileResult,
	DriverCapabilities,
	DriverRow,
	DriverSession,
} from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../src/commands/sync";
import {
	buildManifestPayload,
	serializeManifestPayload,
} from "../src/manifest-payload";
import type { SyncDriverConnection } from "../src/sync/connection";
import {
	READER_MANIFEST_FORMAT,
	readManifestState,
} from "../src/sync/manifest-state";
import { SYNCED_MODULE_MARKER } from "../src/sync/write";

const app = schema("app");

const fakeCapabilities: DriverCapabilities = {
	"interactive-transactions": false,
	"session-state": false,
};

/** A row shaped exactly as `manifest-read.ts`'s own query aliases its columns -- built from a real declaration set, so the embedded manifest is a genuine `ManifestDocument`, not a synthetic stand-in. */
const buildFakeManifestRow = (
	seq: number,
): {
	readonly seq: number;
	readonly manifestFormat: number;
	readonly snapshotFormat: number;
	readonly snapshotHash: string;
	readonly manifest: string;
} => {
	const posts = table(app, "posts", { id: uuid().primaryKey() });
	const declarations: ReadonlyArray<HejbroInput> = [app, posts];
	const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
	const snapshot = generateMigration({
		declarations,
		previousSnapshot: emptySnapshot,
	}).snapshot;
	const sidecar = buildManifestPayload(declarations, exportNames);
	const payloadWithSnapshot = { ...sidecar, snapshot };
	return {
		seq,
		manifestFormat: 1,
		snapshotFormat: HEJBRO_SNAPSHOT_VERSION,
		snapshotHash: "sha256:test",
		manifest: serializeManifestPayload(payloadWithSnapshot),
	};
};

/**
 * Routes a fake `execute` by the query's own text -- `manifest-read.ts`'s
 * three real queries never overlap in shape (`select 1`, `count(*)`, a
 * `where "snapshot_hash"` search, and the plain newest-row select each
 * have a distinguishing substring), so a fake built this way answers
 * each targeted query correctly instead of returning the same canned
 * array regardless of what was asked -- required now that `sync`'s
 * reader issues more than one query shape (5.6/5.7 review: no full-table
 * fetch, targeted queries only).
 */
type FakeManifestAnswers = {
	readonly newest?: ReadonlyArray<Record<string, unknown>>;
	readonly byStamp?: ReadonlyArray<Record<string, unknown>>;
	readonly countAfter?: number;
};

const routedExecute =
	(answers: FakeManifestAnswers) =>
	async (compiled: CompileResult): Promise<ReadonlyArray<DriverRow>> => {
		if (compiled.sql === "select 1") {
			return [];
		}
		if (compiled.sql.includes("count(*)")) {
			return [{ count: answers.countAfter ?? 0 }];
		}
		if (compiled.sql.includes('where "snapshot_hash"')) {
			return answers.byStamp ?? [];
		}
		return answers.newest ?? [];
	};

/** `assertConnected`'s own probe and every real read go through this one `execute`, routed by query text. */
const buildFakeConnection = (
	execute: SyncDriverConnection["execute"],
): SyncDriverConnection => ({
	capabilities: fakeCapabilities,
	execute,
	transaction: async () => {
		throw new Error("transaction should not be called by sync");
	},
	setupSession: async () => {
		throw new Error("setupSession should not be called by sync");
	},
	client: { end: async () => {} },
});

const buildFakeImporterWithRows = (
	rows: ReadonlyArray<Record<string, unknown>>,
) => {
	const connection = buildFakeConnection(routedExecute({ newest: rows }));
	return async () => ({ pgDriver: () => connection });
};

const buildFakeImporter = () =>
	buildFakeImporterWithRows([buildFakeManifestRow(1)]);

/** Postgres's own SQLSTATE for "no such relation" -- what a real driver throws when `hejbro.schema_manifest` doesn't exist. */
const undefinedTableError = (): Error =>
	Object.assign(new Error('relation "hejbro.schema_manifest" does not exist'), {
		code: "42P01",
	});

/** `assertConnected`'s own connectivity probe (`select 1`) runs before any manifest read, so a fake that throws unconditionally would be reported as `sync-connection-failed` and never reach the manifest reader at all -- this one answers the probe normally and throws `error` only for the real query after it. */
const buildFakeImporterThatThrows = (error: unknown) => {
	const connection = buildFakeConnection(async (compiled) => {
		if (compiled.sql === "select 1") {
			return [];
		}
		throw error;
	});
	return async () => ({ pgDriver: () => connection });
};

/** A bare `DriverSession` (no pool to close), for the pure-reader tests below that call `readManifestState` directly rather than going through `runSync`/`withSyncConnection`. */
const fakeSessionWithAnswers = (
	answers: FakeManifestAnswers,
): DriverSession => ({
	execute: routedExecute(answers),
});

const fakeSessionThatThrows = (error: unknown): DriverSession => ({
	execute: async () => {
		throw error;
	},
});

const CONFIG_TEXT = `export default {
	entry: ["src/schema.ts"],
	presets: [],
};
`;

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "hejbro-sync-states-"));
	await writeFile(join(cwd, "hejbro.config.ts"), CONFIG_TEXT);
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("hejbro sync --check", () => {
	it("check mode writes nothing and exits non-zero", async () => {
		const destination = join(cwd, "schema.synced.ts");
		// Already a synced module (carries the marker `writeSyncedModule`
		// itself would happily overwrite without --force) but stale
		// content -- the refusal below has to come from the comparison
		// itself, not from the overwrite guard a disabled --check would
		// otherwise trip over.
		const staleContent = `${SYNCED_MODULE_MARKER}\n// stale\n`;
		await writeFile(destination, staleContent);

		const result = await runSync(
			cwd,
			["--url", "postgres://fake", "--out", destination, "--check"],
			buildFakeImporter(),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBeNull();
		expect(result.stdout.join("\n")).toContain(
			"is not what `hejbro sync` would write right now",
		);
		expect(await readFile(destination, "utf8")).toBe(staleContent);
	});

	it("exits zero and writes nothing when the destination already matches", async () => {
		const destination = join(cwd, "schema.synced.ts");
		// First, a real (non-check) run to produce the exact bytes a
		// current destination would hold.
		await runSync(
			cwd,
			["--url", "postgres://fake", "--out", destination],
			buildFakeImporter(),
		);

		const result = await runSync(
			cwd,
			["--url", "postgres://fake", "--out", destination, "--check"],
			buildFakeImporter(),
		);

		expect(result.exitCode).toBe(0);
	});
});

describe("hejbro sync --schema", () => {
	it("refuses the reserved schema filter", async () => {
		const result = await runSync(cwd, ["--schema", "app"], buildFakeImporter());

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-schema-filter-unsupported");
	});
});

/** A row whose `manifest_format` claims a value this test can force higher, lower, or non-integer -- everything else stays the same real, valid payload `buildFakeManifestRow` produces. */
const rowWithManifestFormat = (
	seq: number,
	manifestFormat: number,
): Record<string, unknown> => ({
	...buildFakeManifestRow(seq),
	manifestFormat,
});

/** The same row, but its `manifest` column replaced with `manifestText` -- everything about the row's own columns (format, hash) stays a real, valid value; only the payload text itself is broken. */
const rowWithManifestText = (
	seq: number,
	manifestText: string,
): Record<string, unknown> => ({
	...buildFakeManifestRow(seq),
	manifest: manifestText,
});

/** A row whose embedded snapshot's own `formatVersion` is replaced with `formatVersion` -- `parseSnapshot` refuses this on its own terms (`unsupported-snapshot-version`), which is exactly the situation format-skew (5.7) owns: a manifest_format this reader knows, wrapping a snapshot format it doesn't. */
const rowWithSnapshotFormatVersion = (
	seq: number,
	formatVersion: number,
): Record<string, unknown> => {
	const row = buildFakeManifestRow(seq);
	const payload = JSON.parse(row.manifest) as {
		readonly snapshot: { formatVersion: number };
	};
	const mutatedPayload = {
		...payload,
		snapshot: { ...payload.snapshot, formatVersion },
	};
	return { ...row, manifest: JSON.stringify(mutatedPayload) };
};

// Every scenario below is written against `readManifestState` -- the
// *reader* -- not against `runSync`: the schema-sync delta's own
// scenarios ("A reader of a manifest meets seven distinct situations")
// name a reader as their subject, and `sync` is only one of the two
// surfaces (group 6's `assertSchema` is the other) that meets it
// (ps-planner review).
describe("readManifestState (5.6, 5.7)", () => {
	it("distinguishes an absent manifest table", async () => {
		const state = await readManifestState(
			fakeSessionThatThrows(undefinedTableError()),
			null,
		);

		expect(state).toEqual({ situation: "missing" });
	});

	it("distinguishes an empty manifest table", async () => {
		const state = await readManifestState(fakeSessionWithAnswers({}), null);

		expect(state).toEqual({ situation: "empty" });
	});

	it("distinguishes a stamp with no matching row", async () => {
		const state = await readManifestState(
			fakeSessionWithAnswers({ byStamp: [] }),
			"sha256:does-not-exist",
		);

		expect(state).toEqual({ situation: "stamp-unmatched" });
	});

	it("refuses a higher manifest format without parsing the payload", async () => {
		const row = rowWithManifestFormat(1, READER_MANIFEST_FORMAT + 1);
		// A payload this reader would refuse to parse for an unrelated
		// reason (shape) -- if the format gate ran *after* parsing, this
		// would surface as payload-invalid instead.
		const brokenRow = { ...row, manifest: "not json at all" };

		const state = await readManifestState(
			fakeSessionWithAnswers({ newest: [brokenRow] }),
			null,
		);

		expect(state).toEqual({
			situation: "format-unsupported",
			rowFormat: READER_MANIFEST_FORMAT + 1,
		});
	});

	it("reads a lower manifest format whose snapshot format it accepts", async () => {
		const row = rowWithManifestFormat(1, READER_MANIFEST_FORMAT - 1);

		const state = await readManifestState(
			fakeSessionWithAnswers({ newest: [row] }),
			null,
		);

		expect(state.situation).toBe("found");
	});

	it("refuses a payload that does not answer its own format", async () => {
		const row = rowWithManifestText(1, "not json at all");

		const state = await readManifestState(
			fakeSessionWithAnswers({ newest: [row] }),
			null,
		);

		expect(state.situation).toBe("payload-invalid");
	});

	it("a refused embedded snapshot format carries this reader's remedy", async () => {
		const row = rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION + 1);

		const state = await readManifestState(
			fakeSessionWithAnswers({ newest: [row] }),
			null,
		);

		expect(state.situation).toBe("snapshot-format-refused");
	});

	it("a row whose manifest_format column is not an integer is refused as unknown, never read", async () => {
		const row = rowWithManifestFormat(1, 1.5);

		const state = await readManifestState(
			fakeSessionWithAnswers({ newest: [row] }),
			null,
		);

		expect(state).toEqual({ situation: "format-unsupported", rowFormat: null });
	});

	it("reports seven distinct codes, each with its own remedy", async () => {
		const matchedRow = buildFakeManifestRow(1);

		const situations = await Promise.all([
			readManifestState(fakeSessionThatThrows(undefinedTableError()), null),
			readManifestState(fakeSessionWithAnswers({}), null),
			readManifestState(
				fakeSessionWithAnswers({ byStamp: [] }),
				"sha256:does-not-exist",
			),
			readManifestState(
				fakeSessionWithAnswers({
					newest: [rowWithManifestFormat(1, READER_MANIFEST_FORMAT + 1)],
				}),
				null,
			),
			readManifestState(
				fakeSessionWithAnswers({
					newest: [rowWithManifestText(1, "not json at all")],
				}),
				null,
			),
			readManifestState(
				fakeSessionWithAnswers({
					newest: [
						rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION + 1),
					],
				}),
				null,
			),
			// The seventh: a stamp that matches, with rows after it.
			readManifestState(
				fakeSessionWithAnswers({ byStamp: [matchedRow], countAfter: 1 }),
				matchedRow.snapshotHash,
			),
		]);

		// The seventh (a matched stamp with newer rows after it) isn't its
		// own `situation` string -- it's `"found"` with `distance > 0`
		// (schema-sync delta: the freshness requirement gives this its own
		// vocabulary, group 6's own job; the mechanics are this reader's).
		const labels = situations.map((state) => {
			if (state.situation === "found" && state.distance > 0) {
				return "found-stale";
			}
			return state.situation;
		});

		expect(new Set(labels).size).toBe(7);
	});
});

describe("hejbro sync -- manifest states reach coded diagnostics", () => {
	it("an absent manifest table is a coded failure, not a raw crash", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterThatThrows(undefinedTableError()),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-manifest-missing");
	});

	it("an empty manifest table is a coded failure, not the raw Error a null row used to throw", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([]),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-manifest-empty");
		// The old uncoded path threw a plain Error with this exact text --
		// pinning its absence is what proves the raw-Error path is gone,
		// not merely that some coded path also exists.
		expect(result.stderr).not.toContain("no migration has emitted one yet");
	});

	it("a manifest format higher than this build knows is a coded failure", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([
				rowWithManifestFormat(1, READER_MANIFEST_FORMAT + 1),
			]),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-manifest-format-unsupported");
	});

	it("a payload that does not answer its own format is a coded failure", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([rowWithManifestText(1, "not json at all")]),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-manifest-payload-invalid");
	});

	it("a refused embedded snapshot format is a coded failure with this reader's own remedy", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([
				rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION + 1),
			]),
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("sync-snapshot-format-unsupported");
		// Never the snapshot reader's own file-oriented remedy -- the
		// consumer has no snapshot file on disk to delete or reset.
		expect(result.stderr).not.toContain("hejbro init");
	});

	it("format skew never advises re-syncing", async () => {
		const result = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([
				rowWithManifestFormat(1, READER_MANIFEST_FORMAT + 1),
			]),
		);

		expect(result.stderr).not.toContain("stale");
		expect(result.stderr).not.toContain("re-sync");
	});

	/** Extracts `error[<code>]` from a rendered diagnostic block -- the actual thrown *code string*, not the `ManifestState.situation` label a caller derived it from (those two can drift independently, e.g. two situations wired to the same code by mistake, which `situation` alone would never show). */
	const codeOf = (stderr: string | null): string | null =>
		stderr?.match(/error\[([a-z0-9-]+)\]/)?.[1] ?? null;

	it("raises a distinct code for each situation this command actually reaches", async () => {
		const scenarios: ReadonlyArray<
			readonly [string, ReturnType<typeof buildFakeImporterWithRows>]
		> = [
			["missing", buildFakeImporterThatThrows(undefinedTableError())],
			["empty", buildFakeImporterWithRows([])],
			[
				"format-unsupported",
				buildFakeImporterWithRows([
					rowWithManifestFormat(1, READER_MANIFEST_FORMAT + 1),
				]),
			],
			[
				"payload-invalid",
				buildFakeImporterWithRows([rowWithManifestText(1, "not json at all")]),
			],
			[
				"snapshot-format-refused",
				buildFakeImporterWithRows([
					rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION + 1),
				]),
			],
		];

		const codes = await Promise.all(
			scenarios.map(async ([, importer]) => {
				const result = await runSync(
					cwd,
					["--url", "postgres://fake"],
					importer,
				);
				return codeOf(result.stderr);
			}),
		);

		expect(codes.every((code) => code !== null)).toBe(true);
		expect(new Set(codes).size).toBe(scenarios.length);
	});

	it("never leaks core's own file-oriented remedy when a core error is forwarded unwrapped", async () => {
		// Guards against the exact regression ps-planner's review named:
		// wrapping `tryParseEmbeddedSnapshot`'s catch removed, so core's
		// raw `unsupported-snapshot-version` error would reach this
		// consumer verbatim under its own code and its own (disk-file-
		// oriented) wording. Checked both directions: a *lower* embedded
		// snapshot format is core's "older" message (the one that
		// actually says `hejbro init`/"delete"), and a *higher* one is a
		// differently-worded "newer" message that names neither word --
		// asserting on the code itself, not on wording specific to one
		// direction, is what makes this catch the regression regardless
		// of which direction produced it (a lower-only wording check
		// missed the higher-format case entirely on the first pass here).
		const higherResult = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([
				rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION + 1),
			]),
		);
		const lowerResult = await runSync(
			cwd,
			["--url", "postgres://fake"],
			buildFakeImporterWithRows([
				rowWithSnapshotFormatVersion(1, HEJBRO_SNAPSHOT_VERSION - 1),
			]),
		);

		expect(higherResult.stderr).not.toContain("unsupported-snapshot-version");
		expect(lowerResult.stderr).not.toContain("unsupported-snapshot-version");
		expect(lowerResult.stderr).not.toContain("hejbro init");
		expect(lowerResult.stderr).not.toContain("delete");
	});
});
