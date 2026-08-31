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
import type { DriverCapabilities } from "@hejbro/query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSync } from "../src/commands/sync";
import {
	buildManifestPayload,
	serializeManifestPayload,
} from "../src/manifest-payload";
import type { SyncDriverConnection } from "../src/sync/connection";
import { SYNCED_MODULE_MARKER } from "../src/sync/write";

const app = schema("app");

const fakeCapabilities: DriverCapabilities = {
	"interactive-transactions": false,
	"session-state": false,
};

/** A row shaped exactly as `manifest-read.ts`'s own query aliases its columns -- built from a real declaration set, so the embedded manifest is a genuine `ManifestDocument`, not a synthetic stand-in. */
const buildFakeManifestRow = (): {
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
		manifestFormat: 1,
		snapshotFormat: HEJBRO_SNAPSHOT_VERSION,
		snapshotHash: "sha256:test",
		manifest: serializeManifestPayload(payloadWithSnapshot),
	};
};

const buildFakeImporter = () => {
	const connection: SyncDriverConnection = {
		capabilities: fakeCapabilities,
		execute: async () => [buildFakeManifestRow()],
		transaction: async () => {
			throw new Error("transaction should not be called by sync");
		},
		setupSession: async () => {
			throw new Error("setupSession should not be called by sync");
		},
		client: { end: async () => {} },
	};
	return async () => ({ pgDriver: () => connection });
};

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
