// A standalone probe, run as its own `node` process per emitted file
// (#714 bc-1, commit 2/3's own "every entry order" assertion): mirrors
// `packages/cli/src/loader.ts`'s own `createJiti(configPath, { fsCache:
// false })` -> `jiti.import(filePath)` call shape exactly (loader.ts:119,
// :272) -- the production loader's own jiti path, not Node's built-in
// TypeScript stripping (which `examples/cli-smoke`'s own live-check
// script uses for an unrelated reason and would NOT exercise the same
// module-resolution code the CLI actually runs).
//
// A fresh OS process per file, not a loop of `jiti.import()` calls inside
// one process, is the point: Node's module cache would make every file
// after the first a no-op re-import from cache, silently proving nothing
// about starting the graph traversal from THAT file specifically
// (declare-emit/file-cycle.ts:61-66 -- a wrong back-edge choice on a
// chorded schema graph "leaves the real cycle untouched, and every entry
// order crashes"; catching that needs a genuinely uncached traversal from
// each candidate root).
import { createJiti } from "jiti";

const [, , rootPath, targetPath] = process.argv;
if (rootPath === undefined || targetPath === undefined) {
	throw new Error(
		"loader-probe.mjs: usage: node loader-probe.mjs <rootPath> <targetPath>",
	);
}

const jiti = createJiti(rootPath, { fsCache: false });
await jiti.import(targetPath);
console.log("loader-probe: ok");
