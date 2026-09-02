import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitContract } from "../src/contract/emit";
import { assertContractDestinationWritable } from "../src/vendor/write";

/**
 * CI-G4-R1-03: `assertContractDestinationWritable` widened to accept
 * either marker so a second `pull` run does not refuse its own prior
 * output -- `pull` and `vendor` write to the exact same destination
 * (schema-vendoring spec, "pull writes where vendor writes").
 */
let cwd = "";
let contractPath = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "hejbro-vendor-write-markers-test-"));
	contractPath = join(cwd, "contract.ts");
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("assertContractDestinationWritable / pull-marked contract", () => {
	it("does not refuse a second pull run over its own prior output", () => {
		const priorContract = emitContract(
			{
				tables: [],
				functions: [],
				roles: [],
				snapshot: { formatVersion: 8, dialect: "postgres", objects: {} },
			},
			{ source: "database", database: "widgets_db", schemas: ["app"] },
		);
		writeFileSync(contractPath, priorContract);

		expect(() =>
			assertContractDestinationWritable(contractPath, false, "hejbro vendor"),
		).not.toThrow();
	});

	it("still refuses a file that carries neither marker", () => {
		writeFileSync(contractPath, "// hand-written, not this tool's own\n");

		expect(() =>
			assertContractDestinationWritable(contractPath, false, "hejbro vendor"),
		).toThrow(
			expect.objectContaining({ code: "vendor-destination-not-vendored" }),
		);
	});
});
