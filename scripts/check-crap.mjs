#!/usr/bin/env node
// #154: reports the CRAP score (complexity^2 * (1 - coverage)^3 + complexity)
// for every named function in @hejbro/core and @hejbro/supabase, and fails
// (non-zero exit) once any exceeds threshold 5 (D71). phase8-crap-tooling
// through phase8-crap-coverage brought the violation count to 0 at
// threshold 10, and phase8-crap-gate turned EXIT_NONZERO_ON_VIOLATION on;
// phase8-crap-ratchet-5 (this change) ratchets the threshold itself to 5,
// same phase, before 0.1.0 (#154's plan, D71).
//
// Deliberately package-scoped, not file-allowlisted: `hejbro` (the CLI) is
// excluded by never being in TARGET_PACKAGES below, not by excluding
// specific files from a list. `packages/cli/src/commands` measures ~7.6%
// in-process statement coverage, but those commands are exercised
// end-to-end through a spawned child process by examples/cli-smoke and
// examples/{postgres,supabase}/test/cli.test.ts -- in-process V8 coverage
// cannot observe a child process, so that number is a measurement
// artifact, not a real coverage gap. Gating on it would mean rewriting
// working end-to-end tests as in-process unit tests, which adds tests
// without adding verification. A package-level scope (this list) can't
// silently grow the way a per-file exemption list would -- there is
// nothing here to add to.
//
// Complexity is computed with the classic McCabe formula: 1 (base) + 1 per
// `if`, + 1 per non-default `case` label, + 1 per `&&`/`||`/`??`, + 1 per
// ternary, + 1 per loop (for/for-in/for-of/while/do-while), + 1 per
// `catch`. Verified against this repo's own baseline, not assumed: hand-
// counting `core/src/expr/walk.ts`'s `someExprNode` (1 base + 1 `if` + 13
// non-default case labels + 1 `||` (comparison) + 1 `||` (inList) + 2 `||`
// (between) + 1 `&&` (sqlTemplate) = 20) and `core/src/types/type-node.ts`'s
// `renderTypeNode` (1 base + 28 non-default case labels = 29) both match
// #154's baseline table exactly before writing a single line of the walker
// below -- the formula was derived from the cited numbers, then encoded,
// not the other way around.
//
// A function is anything with an identifiable name: a function
// declaration, a `const x = (...) => ...` / `const x = function () {}`, a
// `key: (...) => ...` property inside an object literal (this codebase's
// `ObjectKind<T>` records are exactly this shape --
// `kinds/table-kind.ts`'s `tableKind.diff`, etc.), a class method, or a
// get/set accessor -- as long as it is not itself lexically nested inside
// ANOTHER function-like node. Nesting is what actually decides whether
// something gets its own report entry, not anonymity: a named
// `const recordIf = (...) => {...}` declared inside
// `plpgsql/body-context.ts`'s `createRecordingContext` (which returns an
// object of ~15 such locally-named closures) is still merged into
// `createRecordingContext`'s own complexity, exactly like an anonymous
// inline callback would be -- the first version of this script treated
// every named nested `const` as its own unit instead, which hollowed
// `createRecordingContext` out to complexity 1 and scattered its real
// complexity across a dozen near-trivial entries, none of which crossed
// the threshold alone. Caught by cross-checking against #154's own
// baseline table (below), not assumed correct on the first attempt.
//
// Validated against #154's group-A table, function by function, before
// this script was considered done: all 9 cited (complexity, location)
// pairs match exactly --
// type-node.ts renderTypeNode (29), type-family.ts familyOfTypeNode (29),
// walk.ts someExprNode (20), body-context.ts createRecordingContext (17),
// render-sql.ts renderExpr (16), snapshot.ts parseSnapshot (16),
// render-sql.ts collectColumnRefs (15), rename-plan.ts
// validateRenameSpecTarget (12), table-kind.ts diff (11). Coverage
// percentages are close but not always identical to the issue's cited
// figures (within roughly 0-3 points; e.g. someExprNode measured 64.7%
// here against 62% cited) -- complexity is exact so the walker above is
// very unlikely to be the source, and the residual gap is most likely a
// different coverage definition (this script uses per-function statement
// coverage; the original may have used branch coverage or a blend).
// Total violation count measured here is 17, against the issue's stated
// 19 raw. Reconciled, not left open: 2 of the original 19 were nested
// closures v8's `fnMap` counts as separate functions (the exact pattern
// `createRecordingContext` above is made of) -- this script's unit of
// measurement merges a nested closure into its enclosing named function
// (see "Nesting is what actually decides..." below), which is the
// correct granularity for a CRAP score attached to a function someone
// would actually refactor, so those 2 were never missing violations, just
// counted at a different granularity by whatever produced the original
// 19. Group A's own 9 are all accounted for above; the remaining 8 found
// here are lower-complexity, coverage-driven entries the issue doesn't
// enumerate by name, so they can't be cross-checked the same way -- see
// the PR description for the full list.
//
// Two of those 8 sit closer to the threshold than this script's own
// coverage-percentage uncertainty (the 0-3-point gap noted above):
// `enum-kind.ts`'s `emit` (CRAP 10.27, 1.9 points of coverage away from
// dropping under 10) and `table-kind-emit.ts`'s `emitTableSql` (CRAP
// 10.37, 1.8 points away) -- both margins smaller than the unexplained
// discrepancy. Group A is categorically immune to this, by arithmetic
// rather than by re-checking each one: CRAP's minimum possible value (at
// 100% coverage) equals complexity itself, and every group-A complexity
// is >= 11, so no coverage measurement error of any size can put a
// group-A entry under threshold 10. These two group-B entries have no
// such floor -- treat their presence on the list as provisional until the
// coverage-definition question above is settled, not as settled fact the
// way group A is.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRAP_THRESHOLD = 5;

// phase8-crap-gate (D71): the violation count reached 0 on dev, so the gate
// is now live at CRAP_THRESHOLD = 5 (phase8-crap-ratchet-5).
const EXIT_NONZERO_ON_VIOLATION = true;

const TARGET_PACKAGES = [
	{
		name: "@hejbro/core",
		srcDir: join(REPO_ROOT, "packages/core/src"),
		coverageJson: join(REPO_ROOT, "packages/core/coverage/coverage-final.json"),
	},
	{
		name: "@hejbro/supabase",
		srcDir: join(REPO_ROOT, "packages/supabase/src"),
		coverageJson: join(
			REPO_ROOT,
			"packages/supabase/coverage/coverage-final.json",
		),
	},
];

const DECISION_LOOP_KINDS = new Set([
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.WhileStatement,
	ts.SyntaxKind.DoStatement,
]);

const LOGICAL_OPERATOR_KINDS = new Set([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

const isFunctionLike = (node) =>
	ts.isFunctionDeclaration(node) ||
	ts.isArrowFunction(node) ||
	ts.isFunctionExpression(node) ||
	ts.isMethodDeclaration(node) ||
	ts.isGetAccessorDeclaration(node) ||
	ts.isSetAccessorDeclaration(node) ||
	ts.isConstructorDeclaration(node);

// A "reportable" node is a function-like node this script gives its own
// name and location to. Anonymous function expressions/arrows (no name of
// their own, and not the initializer of a named `const`) are not
// reportable on their own -- see the file comment above.
const reportableInfo = (node) => {
	if (ts.isFunctionDeclaration(node) && node.name) {
		return { name: node.name.text, nameNode: node.name };
	}
	if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
		return { name: node.name.text, nameNode: node.name };
	}
	if (ts.isGetAccessorDeclaration(node) && ts.isIdentifier(node.name)) {
		return { name: `get ${node.name.text}`, nameNode: node.name };
	}
	if (ts.isSetAccessorDeclaration(node) && ts.isIdentifier(node.name)) {
		return { name: `set ${node.name.text}`, nameNode: node.name };
	}
	if (ts.isConstructorDeclaration(node)) {
		return { name: "constructor", nameNode: node };
	}
	return undefined;
};

// A `const x = (...) => ...` / `const x = function () {}` reports as `x`,
// and `key: (...) => ...` inside an object literal (this codebase's
// `ObjectKind<T>` records -- table-kind.ts's `tableKind.diff`, etc. -- are
// exactly this shape) reports as `key`. Both use the initializer (the
// function-like node) as the complexity-walk root but the name's own
// position for the reported location.
const namedVariableFunction = (node) => {
	if (
		ts.isVariableDeclaration(node) &&
		ts.isIdentifier(node.name) &&
		node.initializer &&
		(ts.isArrowFunction(node.initializer) ||
			ts.isFunctionExpression(node.initializer))
	) {
		return {
			name: node.name.text,
			nameNode: node.name,
			functionNode: node.initializer,
		};
	}
	if (
		ts.isPropertyAssignment(node) &&
		(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
		(ts.isArrowFunction(node.initializer) ||
			ts.isFunctionExpression(node.initializer))
	) {
		return {
			name: node.name.text,
			nameNode: node.name,
			functionNode: node.initializer,
		};
	}
	return undefined;
};

// Is `node` (a function-like node) lexically nested inside ANOTHER
// function-like node -- named or anonymous? If so, it is not
// independently reportable: it merges into whichever top-level function
// contains it. This is the distinction the first version of this script
// got wrong (caught by cross-checking against #154's baseline table, not
// assumed correct on the first try): `packages/core/src/plpgsql/
// body-context.ts`'s `createRecordingContext` returns an object whose
// properties are ~15 locally-named `const recordIf = (...) => {...}`
// closures. Treating each of those as its own reportable unit hollowed
// `createRecordingContext` out to complexity 1 and scattered its real
// complexity (17, per the baseline) across over a dozen near-trivial
// entries, none of which crossed the threshold alone. A class method
// (nested in a class, not in a function) is still independently
// reportable -- only nesting inside another function-like node merges a
// unit into its parent.
const isNestedInFunction = (node) => {
	let current = node.parent;
	while (current) {
		if (isFunctionLike(current)) {
			return true;
		}
		current = current.parent;
	}
	return false;
};

const collectReportableUnits = (sourceFile) => {
	const units = [];
	const visit = (node) => {
		const variableFn = namedVariableFunction(node);
		if (variableFn && !isNestedInFunction(variableFn.functionNode)) {
			units.push({
				name: variableFn.name,
				nameNode: variableFn.nameNode,
				functionNode: variableFn.functionNode,
			});
		} else if (isFunctionLike(node) && !isNestedInFunction(node)) {
			const info = reportableInfo(node);
			if (info) {
				units.push({
					name: info.name,
					nameNode: info.nameNode,
					functionNode: node,
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return units;
};

// Complexity of `unit`, walking its function-like node's full range,
// including anything nested inside it (named or not -- see
// isNestedInFunction above for why a nested named const is merged in
// rather than double-counted or excluded).
const computeComplexity = (unit) => {
	let complexity = 1;
	const visit = (node) => {
		if (node.kind === ts.SyntaxKind.IfStatement) {
			complexity += 1;
		} else if (node.kind === ts.SyntaxKind.ConditionalExpression) {
			complexity += 1;
		} else if (node.kind === ts.SyntaxKind.CaseClause) {
			complexity += 1;
		} else if (node.kind === ts.SyntaxKind.CatchClause) {
			complexity += 1;
		} else if (DECISION_LOOP_KINDS.has(node.kind)) {
			complexity += 1;
		} else if (
			ts.isBinaryExpression(node) &&
			LOGICAL_OPERATOR_KINDS.has(node.operatorToken.kind)
		) {
			complexity += 1;
		}
		ts.forEachChild(node, visit);
	};
	visit(unit.functionNode);
	return complexity;
};

const loadCoverage = (coverageJsonPath) => {
	if (!existsSync(coverageJsonPath)) {
		return undefined;
	}
	return JSON.parse(readFileSync(coverageJsonPath, "utf8"));
};

// Both sides of this comparison are put on the same (1-based) line
// numbering: istanbul's statementMap uses 1-based line/column, and
// `toLineSpan` below converts the TS compiler API's 0-based
// `getLineAndCharacterOfPosition` to 1-based to match it.
const owningUnitByLine = (units, line) => {
	const containing = units.filter(
		(unit) => line >= unit.span.startLine && line <= unit.span.endLine,
	);
	if (containing.length === 0) {
		return undefined;
	}
	// Innermost: smallest line span.
	return containing.reduce((smallest, candidate) => {
		if (
			candidate.span.endLine - candidate.span.startLine <
			smallest.span.endLine - smallest.span.startLine
		) {
			return candidate;
		}
		return smallest;
	});
};

// Per-function statement coverage: each statementMap entry (istanbul's
// coverage-final.json format, produced by @vitest/coverage-v8's "json"
// reporter) is assigned to the innermost reportable unit whose line range
// contains the statement's start line; a statement outside every unit
// (e.g. top-level imports) is not attributed to any function. Coverage %
// is covered-statements / total-statements owned by that unit -- 100% for
// a unit that owns zero statements (nothing to be uncovered).
//
// `fileCoverage` is REQUIRED here, not optional: a caller that can't find
// a scanned file's entry in coverage-final.json must treat that as fatal
// (see the missing-coverage check in the results loop below) rather than
// calling this with `undefined`. The two situations that used to look
// identical -- "this unit truly has zero statements" and "this file's
// coverage entry is missing entirely, so every unit here has zero
// observations" -- both produced `stats.total === 0`, and the fallback
// below silently reads that as 100% coverage either way. Reproduced
// without touching turbo's cache at all: rewriting coverage-final.json's
// path keys to a different (but otherwise byte-identical) absolute path
// made all of @hejbro/core report 100% coverage, 0 warnings, exit 0 --
// 17 real violations silently became 10, with @hejbro/supabase (whose
// keys weren't touched) as the giveaway control. `cache: false` on
// test:coverage only closes the one path that produces a *stale*
// coverage-final.json (a cross-worktree cache hit); it does nothing for
// a *missing* one (a renamed/moved file, a narrowed `coverage.include`, a
// different reporter, or any other reason a scanned file's key isn't in
// the report). Requiring `fileCoverage` here pushes that distinction back
// to where it can be caught loudly.
const computeCoverageByUnit = (units, fileCoverage) => {
	const byUnit = new Map(units.map((unit) => [unit, { covered: 0, total: 0 }]));
	for (const [id, loc] of Object.entries(fileCoverage.statementMap)) {
		const unit = owningUnitByLine(units, loc.start.line);
		if (!unit) {
			continue;
		}
		const hit = fileCoverage.s[id] > 0;
		const stats = byUnit.get(unit);
		stats.total += 1;
		if (hit) {
			stats.covered += 1;
		}
	}
	return byUnit;
};

// 100% for a unit that owns zero statements (nothing to be uncovered) --
// same convention as the file comment above ("Coverage % is covered-
// statements / total-statements owned by that unit -- 100% for a unit
// that owns zero statements").
const coverageRatioOf = (stats) => {
	if (stats.total === 0) {
		return 1;
	}
	return stats.covered / stats.total;
};

const toLineSpan = (sourceFile, unit) => {
	const start =
		sourceFile.getLineAndCharacterOfPosition(unit.functionNode.getStart())
			.line + 1;
	const end =
		sourceFile.getLineAndCharacterOfPosition(unit.functionNode.getEnd()).line +
		1;
	return { startLine: start, endLine: end };
};

const analyzeFile = (filePath, fileCoverage) => {
	const text = readFileSync(filePath, "utf8");
	const sourceFile = ts.createSourceFile(
		filePath,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const units = collectReportableUnits(sourceFile).map((unit) => ({
		...unit,
		span: toLineSpan(sourceFile, unit),
	}));
	const coverageByUnit = computeCoverageByUnit(units, fileCoverage);
	return units.map((unit) => {
		const complexity = computeComplexity(unit);
		const stats = coverageByUnit.get(unit);
		const coverageRatio = coverageRatioOf(stats);
		const crap = complexity ** 2 * (1 - coverageRatio) ** 3 + complexity;
		const line =
			sourceFile.getLineAndCharacterOfPosition(unit.nameNode.getStart()).line +
			1;
		return {
			name: unit.name,
			file: filePath,
			line,
			complexity,
			coveragePercent: Math.round(coverageRatio * 1000) / 10,
			crap: Math.round(crap * 100) / 100,
		};
	});
};

const walkTsFiles = (dir) => {
	const entries = ts.sys.readDirectory(dir, [".ts"], undefined, undefined);
	return entries.filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".test.ts"));
};

// Every scanned file MUST have its own entry in coverage-final.json.
// `loadCoverage` above already fails loudly (exit 2) when the coverage
// report is missing entirely; this is the same treatment for the
// narrower case of one scanned file's key being missing from an
// otherwise-present report -- a renamed/moved file, a narrowed
// `coverage.include`, a cross-worktree cache hit predating `cache:
// false`, or any other path mismatch. Collected across every package
// before failing (rather than exiting on the first miss) so one run
// reports the complete list, not just the first offender.
const missingCoverage = [];

const results = TARGET_PACKAGES.flatMap(({ name, srcDir, coverageJson }) => {
	const coverage = loadCoverage(coverageJson);
	if (!coverage) {
		console.error(
			`error[check-crap]: no coverage data at ${relative(REPO_ROOT, coverageJson)} -- run \`pnpm test:coverage\` first (or \`pnpm check:crap\`, which does this for you).`,
		);
		process.exit(2);
	}
	return walkTsFiles(srcDir).flatMap((filePath) => {
		const fileCoverage = coverage[filePath];
		if (!fileCoverage) {
			missingCoverage.push({ package: name, filePath });
			return [];
		}
		return analyzeFile(filePath, fileCoverage).map((entry) => ({
			...entry,
			package: name,
		}));
	});
});

if (missingCoverage.length > 0) {
	console.error(
		`error[check-crap]: ${missingCoverage.length} scanned file(s) have no matching entry in their package's coverage-final.json -- every function in them would otherwise silently report as 100% covered, which is exactly the failure this check exists to catch:`,
	);
	for (const { package: pkg, filePath } of missingCoverage) {
		console.error(`  [${pkg}] ${relative(REPO_ROOT, filePath)}`);
	}
	console.error(
		"  Next: confirm coverage.include in the package's vitest.config.ts still matches this file, that it hasn't been renamed/moved since the coverage report was generated, and re-run `pnpm test:coverage` for a fresh report.",
	);
	process.exit(3);
}

const violations = results
	.filter((entry) => entry.crap > CRAP_THRESHOLD)
	.sort((a, b) => b.crap - a.crap);

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
