#!/usr/bin/env node
// #372: the shared source-root derivation for every gate that scans
// package sources. Four times in one week a cross-cutting tool silently
// skipped a package because its roots were a hardcoded list that nobody
// widened when the package was born (check-diagnostic-xref and
// check-next-marker both missed packages/query and packages/pg -- #361;
// the same class hit .claude/rules and skills/hejbro). Deriving the
// list from the workspace itself (the CRAP gate's TARGET_PACKAGES
// precedent) kills the class: the next package cannot be silently
// skipped, because there is no list to forget to widen.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackagesSync } from "@manypkg/get-packages";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every published-package source root: `packages/*` workspace members
 * that have a `src` directory (excludes `examples/*` and source-less
 * packages like `@hejbro/skills`), as repo-relative `<dir>/src` paths in
 * a stable order. */
export const sourceRoots = () =>
	getPackagesSync(REPO_ROOT)
		.packages.filter(
			(pkg) =>
				pkg.relativeDir.startsWith("packages/") &&
				existsSync(join(pkg.dir, "src")),
		)
		.map((pkg) => `${pkg.relativeDir}/src`)
		.sort();
