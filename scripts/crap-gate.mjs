#!/usr/bin/env node
// #336: `pnpm check:crap <flags>` must forward those flags to the turbo
// invocation. pnpm appends extra CLI args to the *last* command of a
// package.json `&&` chain, so as a chain the flags landed on
// `check-crap.mjs` (which ignores them) and `--force` never reached
// turbo -- review gates could not cite `Cached: 0` for this gate the way
// they do for every other turbo-backed gate. This wrapper owns the chain
// instead: `--check` is consumed here (the README step goes read-only,
// see `update-crap-readme.mjs`), every other flag is forwarded to turbo
// verbatim.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./crap-report.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const readmeCheckOnly = args.includes("--check");
const turboArgs = args.filter((flag) => flag !== "--check");

const run = (command, commandArgs) => {
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		cwd: REPO_ROOT,
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
};

const readmeArgs = () => {
	if (readmeCheckOnly) {
		return ["--check"];
	}
	return [];
};

run("pnpm", ["exec", "turbo", "run", "test:coverage", ...turboArgs]);
run(process.execPath, [
	join(SCRIPTS_DIR, "update-crap-readme.mjs"),
	...readmeArgs(),
]);
run(process.execPath, [join(SCRIPTS_DIR, "check-crap.mjs")]);
