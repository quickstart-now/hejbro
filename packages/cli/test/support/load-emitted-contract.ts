import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ContractMetadata } from "@hejbro/query";
import ts from "typescript";

/**
 * Actually loads a `contract/emit.ts` output as a real ES module and
 * returns its runtime exports — text assertions alone have missed a
 * module that parses fine as a string but throws (or silently carries
 * the wrong value) once a real JS engine evaluates it, so 3.1's own red
 * (add-unmanaged-objects) executes the generated source instead of
 * pattern-matching it. Written inside `packages/cli/` itself, never
 * under `node_modules/` or `/tmp` — Node's package self-reference walks
 * up from the importing file for the nearest `package.json`, and a
 * `node_modules` segment in that walk breaks the boundary detection
 * (measured: moving the temp dir under `node_modules/` made `import
 * "hejbro"` fail to resolve). Cleaned up after every call, never
 * committed.
 */
export const loadEmittedContract = async (
	source: string,
): Promise<{ readonly contractMetadata: ContractMetadata }> => {
	const { outputText } = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			target: ts.ScriptTarget.ES2022,
		},
	});
	const base = join(import.meta.dirname, "..", "..", ".uo-contract");
	mkdirSync(base, { recursive: true });
	const dir = mkdtempSync(join(base, "run-"));
	const file = join(dir, "contract.mjs");
	writeFileSync(file, outputText);
	try {
		return (await import(file)) as { contractMetadata: ContractMetadata };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};
