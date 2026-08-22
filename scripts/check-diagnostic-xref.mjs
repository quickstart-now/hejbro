#!/usr/bin/env node
// #216: every error/warning code quoted inside a diagnostic message --
// `error[<code>]`/`warning[<code>]`, matching the header format
// `packages/cli/src/diagnostics.ts` renders -- must name a code this
// codebase can actually throw or emit. A message that tells a user "run
// `hejbro generate`, which fails with `error[snapshot-lost]`" is making a
// falsifiable claim about another diagnostic; if that code is renamed or
// removed, the claim silently goes stale and points the user at a dead
// end. Today there is exactly one such site
// (`packages/core/src/snapshot/snapshot.ts:213`, three citations, all
// real) -- this is a regression gate on it, not a fix for a live defect.
//
// Two passes over the same three source roots (core/cli/supabase `src`,
// `.test.ts` excluded): a citation or a definition living only in a test
// fixture proves nothing about what a real user sees (confirmed by
// grepping the same bracket pattern across `test/` -- it also matches
// dozens of `renderDiagnostics` output assertions and at least one
// deliberately fake code, `warning[demo-warning]` in
// `generate-command.test.ts`, neither of which is a cross-reference to
// check).
//
// 1. DEFINED codes -- every code this codebase can attach to a real
//    HejbroError/Diagnostic, from the three literal-only shapes that
//    actually originate one:
//      - `hejbroError("code", ...)` / `throwHejbroError("code", ...)`
//        (`packages/core/src/error.ts`'s factories)
//      - `diagnostic("error"|"warning", "code", ...)`
//        (`packages/core/src/engine/validate.ts`'s factory, used by
//        every preset validator)
//      - `code: "code"` inside an object literal or type position --
//        the three sites that build a `{ code, ... }` result directly
//        rather than through either factory (`chain.ts`, `cli/loader.ts`,
//        `cli/rename-diagnostics.ts`), plus the type unions that restate
//        the same strings (a harmless duplicate capture, not a second
//        source of truth)
//    A call that *forwards* an existing code through a variable --
//    `hejbroError(report.code, ...)`, `hejbroError(d.code, ...)` -- is
//    deliberately not a definition: it reuses a code defined at its
//    origin, which is already covered by that origin's own literal.
//
// 2. CITED codes -- every `error[...]`/`warning[...]` bracket inside any
//    string/template literal in the same three roots.
//
// A citation with no matching definition is the violation this script
// exists to catch, reported with file:line so the message that made the
// false claim is easy to find.
//
// Self-check: both DEFINED and CITED must be non-empty, or the run fails
// loudly (exit 2) instead of silently reporting "0 violations" -- a
// regex that stops matching either pattern (a helper renamed, an import
// path that moves the factories) would otherwise look identical to a
// genuinely clean tree, the same failure mode #154's coverage check
// exists to refuse (a probe that never reaches its subject reports the
// same `[]`/`0` a clean tree does).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_ROOTS = [
	"packages/core/src",
	"packages/cli/src",
	"packages/supabase/src",
];

const CODE = "[a-z][a-z0-9-]*";

const isScannable = (name) =>
	name.endsWith(".ts") && !name.endsWith(".test.ts");

/** Every scannable `.ts` file under `dir`, recursively. */
const walk = (dir) => {
	const entries = readdirSync(dir, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			return walk(fullPath);
		}
		if (entry.isFile() && isScannable(entry.name)) {
			return [fullPath];
		}
		return [];
	});
};

const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));

// Each pattern's single capture group is the code literal. `\s` already
// matches newlines with no extra flag, so a call whose code argument
// sits on its own line (the prevailing style in this codebase) is still
// matched by a single whole-file regex -- no balanced-paren scanning
// needed, unlike check-next-marker.mjs's job of extracting a *message*
// argument that can itself contain arbitrary nested punctuation.
const DEFINE_PATTERNS = [
	new RegExp(`\\b(?:throwHejbroError|hejbroError)\\s*\\(\\s*"(${CODE})"`, "g"),
	new RegExp(
		`\\bdiagnostic\\s*\\(\\s*"(?:error|warning)"\\s*,\\s*"(${CODE})"`,
		"g",
	),
	new RegExp(`\\bcode\\??:\\s*"(${CODE})"`, "g"),
];

const CITE_PATTERN = new RegExp(`\\b(error|warning)\\[(${CODE})\\]`, "g");

const allMatches = (text, pattern) => Array.from(text.matchAll(pattern));

const definedCodes = new Set(
	sourceFiles.flatMap((filePath) => {
		const text = readFileSync(filePath, "utf8");
		return DEFINE_PATTERNS.flatMap((pattern) =>
			allMatches(text, pattern).map((match) => match[1]),
		);
	}),
);

const citations = sourceFiles.flatMap((filePath) => {
	const text = readFileSync(filePath, "utf8");
	return allMatches(text, CITE_PATTERN).map((match) => {
		const lineNo = text.slice(0, match.index).split("\n").length;
		return {
			file: relative(REPO_ROOT, filePath),
			line: lineNo,
			severity: match[1],
			code: match[2],
		};
	});
});

if (definedCodes.size === 0) {
	console.error(
		"error[check-diagnostic-xref]: found 0 defined codes across " +
			`${SOURCE_ROOTS.join(", ")} -- this almost certainly means the ` +
			"DEFINE_PATTERNS regexes stopped matching (a factory renamed, an " +
			"import path moved), not that the codebase defines no codes. Fix " +
			"the pattern before trusting this check's output.",
	);
	process.exit(2);
}

if (citations.length === 0) {
	console.error(
		"error[check-diagnostic-xref]: found 0 cross-referenced codes -- " +
			"packages/core/src/snapshot/snapshot.ts is currently expected to " +
			"cite 3 (chain-tip-mismatch, diverged-migrations, snapshot-lost). " +
			"An empty result means CITE_PATTERN stopped matching, not that " +
			"every citation was removed. Fix the pattern before trusting this " +
			"check's output.",
	);
	process.exit(2);
}

const violations = citations.filter(
	(citation) => !definedCodes.has(citation.code),
);

console.log(
	`check-diagnostic-xref: ${citations.length} cross-reference(s) checked ` +
		`against ${definedCodes.size} defined code(s)`,
);

if (violations.length > 0) {
	console.error(
		`\nerror[check-diagnostic-xref]: ${violations.length} citation(s) name a code that is not defined anywhere in ${SOURCE_ROOTS.join(", ")}:`,
	);
	violations.forEach((violation) => {
		console.error(
			`  ${violation.file}:${violation.line}  ${violation.severity}[${violation.code}]`,
		);
	});
	console.error(
		"\nNext: fix the code name in the message (a typo or a stale rename), or add the definition the message claims exists.",
	);
	process.exit(1);
}

console.log("check-diagnostic-xref: ok -- every cited code is defined");
