#!/usr/bin/env node
// #154: reports the CRAP score (complexity^2 * (1 - coverage)^3 + complexity)
// for every named function in @hejbro/core and @hejbro/supabase, and fails
// (non-zero exit) once any exceeds threshold 10 -- disabled for now (see
// EXIT_NONZERO_ON_VIOLATION below): phase8-crap-tooling only reports, the
// gate itself is wired on in a later PR once the violation count is 0
// (#154's plan).
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
// 19 raw (18 after its one documented group-B exclusion) -- group A's own
// 9 are all accounted for above; the remaining 8 found here are
// lower-complexity, coverage-driven entries the issue doesn't enumerate
// by name (it only describes group B in aggregate), so they can't be
// cross-checked the same way. This gap is reported rather than papered
// over: see the PR description for the full list of what was found.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRAP_THRESHOLD = 10;

// Set to true once #154's plan reaches phase8-crap-gate (violation count 0).
const EXIT_NONZERO_ON_VIOLATION = false;

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
	return containing.reduce((smallest, candidate) =>
		candidate.span.endLine - candidate.span.startLine <
		smallest.span.endLine - smallest.span.startLine
			? candidate
			: smallest,
	);
};

// Per-function statement coverage: each statementMap entry (istanbul's
// coverage-final.json format, produced by @vitest/coverage-v8's "json"
// reporter) is assigned to the innermost reportable unit whose line range
// contains the statement's start line; a statement outside every unit
// (e.g. top-level imports) is not attributed to any function. Coverage %
// is covered-statements / total-statements owned by that unit -- 100% for
// a unit that owns zero statements (nothing to be uncovered).
const computeCoverageByUnit = (units, fileCoverage) => {
	const byUnit = new Map(units.map((unit) => [unit, { covered: 0, total: 0 }]));
	if (!fileCoverage) {
		return byUnit;
	}
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

const toLineSpan = (sourceFile, unit) => {
	const start =
		sourceFile.getLineAndCharacterOfPosition(unit.functionNode.getStart())
			.line + 1;
	const end =
		sourceFile.getLineAndCharacterOfPosition(unit.functionNode.getEnd()).line +
		1;
	return { startLine: start, endLine: end };
};

const analyzeFile = (filePath, coverage) => {
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
	const fileCoverage = coverage?.[filePath];
	const coverageByUnit = computeCoverageByUnit(units, fileCoverage);
	return units.map((unit) => {
		const complexity = computeComplexity(unit);
		const stats = coverageByUnit.get(unit);
		const coverageRatio = stats.total === 0 ? 1 : stats.covered / stats.total;
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

const results = TARGET_PACKAGES.flatMap(({ name, srcDir, coverageJson }) => {
	const coverage = loadCoverage(coverageJson);
	if (!coverage) {
		console.error(
			`error[check-crap]: no coverage data at ${relative(REPO_ROOT, coverageJson)} -- run \`pnpm test:coverage\` first (or \`pnpm check:crap\`, which does this for you).`,
		);
		process.exit(2);
	}
	return walkTsFiles(srcDir).flatMap((filePath) =>
		analyzeFile(filePath, coverage).map((entry) => ({
			...entry,
			package: name,
		})),
	);
});

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

console.log(
	EXIT_NONZERO_ON_VIOLATION
		? "check-crap: ok -- no violations"
		: "check-crap: reporting only (gate not yet wired -- see EXIT_NONZERO_ON_VIOLATION)",
);
