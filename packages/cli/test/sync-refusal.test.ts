import type { HejbroInput } from "@hejbro/core";
import {
	emptySnapshot,
	generateMigration,
	pgEnum,
	schema,
	table,
	text,
	uuid,
} from "@hejbro/core";
import { beforeAll, describe, expect, it } from "vitest";
import { buildManifestPayload } from "../src/manifest-payload";
import { buildSyncedModuleSource } from "../src/sync/emit";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

const app = schema("app");
const TEST_SNAPSHOT_HASH = "sha256:0123456789abcdef";

describe("generating from an emitted module (5.9)", () => {
	it("names the manifest row it came from", async () => {
		const status = pgEnum(app, "post_status", ["draft", "published"]);
		const posts = table(app, "posts", {
			id: uuid().primaryKey(),
			title: text().notNull(),
			status: status.column().notNull(),
		});
		const declarations: ReadonlyArray<HejbroInput> = [app, posts, status];
		const exportNames = new Map<HejbroInput, string>([[posts, "posts"]]);
		const snapshot = generateMigration({
			declarations,
			previousSnapshot: emptySnapshot,
		}).snapshot;
		const sidecar = buildManifestPayload(declarations, exportNames);
		const source = buildSyncedModuleSource({
			...sidecar,
			snapshot,
			snapshotHash: TEST_SNAPSHOT_HASH,
		});

		const cwd = await createCliFixtureDir();
		try {
			await runCli(cwd, ["init"]);
			await writeFixtureFile(cwd, "src/app.schema.ts", source);
			const result = await runCli(cwd, ["generate"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("synced-table-declared");
			// The half group 2 could not reach (D87 polyrepo-sync, 5.9):
			// the refusal names *which* manifest row this table carries no
			// authority from, not merely that it has none.
			expect(result.stderr).toContain(TEST_SNAPSHOT_HASH);
		} finally {
			await removeCliFixtureDir(cwd);
		}
	});
});
