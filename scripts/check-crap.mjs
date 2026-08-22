#!/usr/bin/env node
// #154: reports the CRAP score (complexity^2 * (1 - coverage)^3 +
// complexity) for every named function in @hejbro/core and
// @hejbro/supabase, and fails (non-zero exit) once any exceeds
// CRAP_THRESHOLD (D71). The walker, the package scope, and the full
// design history/validation notes live in `./crap-report.mjs` (split out
// in #278 so this file and `update-crap-readme.mjs` share one
// computation and can never report different numbers) -- this file is
// only the CLI report: print every violation, then gate.
import { relative } from "node:path";
import {
	CRAP_THRESHOLD,
	computeCrapReport,
	EXIT_NONZERO_ON_VIOLATION,
	REPO_ROOT,
	TARGET_PACKAGES,
} from "./crap-report.mjs";

const { results, violations } = computeCrapReport();

const formatEntry = (entry) =>
	`  ${entry.crap.toFixed(2)}  complexity=${entry.complexity} coverage=${entry.coveragePercent}%  ${relative(REPO_ROOT, entry.file)}:${entry.line}  ${entry.name}`;

console.log(
	`check-crap: scanned ${results.length} named functions across ${TARGET_PACKAGES.map((p) => p.name).join(", ")}`,
);
console.log(
	`check-crap: ${violations.length} function(s) exceed CRAP > ${CRAP_THRESHOLD}:`,
);
for (const entry of violations) {
	console.log(formatEntry(entry));
}

if (violations.length > 0 && EXIT_NONZERO_ON_VIOLATION) {
	console.error(
		`\nerror[check-crap]: ${violations.length} function(s) exceed the CRAP threshold of ${CRAP_THRESHOLD}. Next: reduce complexity (group A) or add tests (group B) -- see issue #154.`,
	);
	process.exit(1);
}

const summaryLine = () => {
	if (EXIT_NONZERO_ON_VIOLATION) {
		return "check-crap: ok -- no violations";
	}
	return "check-crap: reporting only (gate not yet wired -- see EXIT_NONZERO_ON_VIOLATION)";
};

console.log(summaryLine());
