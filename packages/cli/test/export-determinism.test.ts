import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";

beforeAll(assertBuiltCli);

const SCHEMA_SOURCE = `import { bigint, defineFunction, schema, sql, table, text, uuid } from "hejbro";

export const app = schema("app");

export const posts = table(app, "posts", {
	id: uuid().primaryKey().defaultRandom(),
	title: text().notNull(),
});

export const totalPosts = defineFunction(
	app,
	"total_posts",
	{ args: { minId: uuid() }, returns: bigint() },
	(ctx) => {
		ctx.return(sql\`1\`);
	},
);
`;

const EXPORT_FILES = ["schema.json", "snapshot.sql", "format.json"];

const buildExport = async (): Promise<string> => {
	const cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
	await writeFixtureFile(cwd, "src/app.schema.ts", SCHEMA_SOURCE);
	await runCli(cwd, ["generate", "--export"]);
	return cwd;
};

const cwds: Array<string> = [];

afterEach(async () => {
	await Promise.all(cwds.splice(0).map((cwd) => removeCliFixtureDir(cwd)));
});

describe("export determinism", () => {
	it("two runs separated in time are byte-identical", async () => {
		const first = await buildExport();
		cwds.push(first);
		// A real gap, not a mocked clock: the export contains no timestamp
		// to begin with, so nothing here needs to fake `Date.now()`.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		const second = await buildExport();
		cwds.push(second);

		const readAll = (cwd: string): Promise<ReadonlyArray<string>> =>
			Promise.all(
				EXPORT_FILES.map((name) =>
					readFile(join(cwd, ".hejbro", "export", name), "utf8"),
				),
			);

		expect(await readAll(first)).toEqual(await readAll(second));
	});

	it("the export names no clock, no host name, and no absolute path", async () => {
		const cwd = await buildExport();
		cwds.push(cwd);

		const contents = await Promise.all(
			EXPORT_FILES.map((name) =>
				readFile(join(cwd, ".hejbro", "export", name), "utf8"),
			),
		);
		for (const content of contents) {
			expect(content).not.toContain(cwd);
			expect(content).not.toContain(hostname());
			// A plausible ISO-8601 timestamp, the shape a `Date` would render.
			expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		}
	});
});
