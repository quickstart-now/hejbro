import { schema, table, uuid } from "@hejbro/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import {
	assertBuiltCli,
	createCliFixtureDir,
	removeCliFixtureDir,
	runCli,
	writeFixtureFile,
} from "./support/cli-runner";
import { buildFixturePayload } from "./support/contract-fixture";

beforeAll(assertBuiltCli);

const app = schema("app");

/** A real vendored contract's own source text — the same function
 * `vendor` itself calls, not a hand-written stand-in, so this proves
 * the refusal against what `hejbro vendor` actually writes. */
const buildRealContractSource = (): string => {
	const posts = table(app, "posts", { id: uuid().primaryKey() });
	const payload = buildFixturePayload([app, posts]);
	return emitContract(payload, {
		source: "git" as const,
		commit: "abc123",
		exportHash: "sha256:x",
	});
};

let cwd: string;

beforeEach(async () => {
	cwd = await createCliFixtureDir();
	await runCli(cwd, ["init"]);
});

afterEach(async () => {
	await removeCliFixtureDir(cwd);
});

describe("a vendored contract holds no declaration (schema-vendoring spec)", () => {
	it("nothing in the contract can be passed to generation", async () => {
		await writeFixtureFile(cwd, "src/app.schema.ts", buildRealContractSource());

		const result = await runCli(cwd, ["generate"]);

		// None of `Database`/`contractMetadata`/`createDb` were accepted as a
		// declaration -- generation fails rather than silently producing an
		// empty or partial migration from them.
		expect(result.exitCode).toBe(1);
	});

	it("refuses and names the owning repository", async () => {
		await writeFixtureFile(cwd, "src/app.schema.ts", buildRealContractSource());

		const result = await runCli(cwd, ["generate"]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("vendored-contract-declared");
		expect(result.stderr).toContain("the repository that owns it");
	});
});
