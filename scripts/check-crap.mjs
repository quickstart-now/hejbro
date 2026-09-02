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

// #627: a function at exactly the threshold (complexity == CRAP_THRESHOLD,
// fully covered) is green only while its coverage stays perfect -- one
// added-and-uncovered branch turns the gate red for whoever touches it
// next. Listed so the perch is known, not discovered. Exact equality is
// safe here: at 100% coverage the formula collapses to the integer
// complexity, so a sitter's score is CRAP_THRESHOLD exactly, never 5.0001.
const atThreshold = results.filter((entry) => entry.crap === CRAP_THRESHOLD);
if (atThreshold.length > 0) {
	console.log(
		`check-crap: ${atThreshold.length} function(s) sit at exactly CRAP ${CRAP_THRESHOLD} (complexity ${CRAP_THRESHOLD}, fully covered) -- one uncovered branch in any of them fails the gate:`,
	);
	for (const entry of atThreshold) {
		console.log(formatEntry(entry));
	}
}

// #626: CRAP = complexity^2 * (1 - coverage)^3 + complexity, so at full
// coverage CRAP equals complexity -- a function whose complexity alone
// exceeds the threshold can never pass through tests, and offering "add
// tests" for it sends the reader to write tests that cannot help.
const remedyLine = () => {
	const beyondByComplexity = violations.filter(
		(entry) => entry.complexity > CRAP_THRESHOLD,
	);
	const underCovered = violations.filter(
		(entry) => entry.complexity <= CRAP_THRESHOLD,
	);
	const parts = [];
	if (beyondByComplexity.length > 0) {
		parts.push(
			`reduce complexity for ${beyondByComplexity.length} function(s) whose complexity alone exceeds ${CRAP_THRESHOLD} (tests cannot bring these under the threshold: at full coverage CRAP equals complexity)`,
		);
	}
	if (underCovered.length > 0) {
		parts.push(
			`add tests or reduce complexity for ${underCovered.length} function(s) whose complexity is within the threshold but whose coverage is not`,
		);
	}
	return `Next: ${parts.join("; ")} -- see issue #154.`;
};

if (violations.length > 0 && EXIT_NONZERO_ON_VIOLATION) {
	console.error(
		`\nerror[check-crap]: ${violations.length} function(s) exceed the CRAP threshold of ${CRAP_THRESHOLD}. ${remedyLine()}`,
	);
	process.exit(1);
}

const summaryLine = () => {
	if (EXIT_NONZERO_ON_VIOLATION) {
		return `check-crap: ok -- no violations, ${atThreshold.length} at the threshold`;
	}
	return "check-crap: reporting only (gate not yet wired -- see EXIT_NONZERO_ON_VIOLATION)";
};

console.log(summaryLine());
