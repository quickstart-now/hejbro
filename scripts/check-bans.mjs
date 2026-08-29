#!/usr/bin/env node
// #447: the house TypeScript bans (AGENTS.md: no `let`/`var`, no
// `for`/`while`) held by review habit alone until a `let` survived
// `pnpm check` -- Biome's shipped rules cover `var` (noVar) and ternary
// (noTernary), but have no "no let at all" or "no loops" rule, and its
// GritQL plugin subset (measured on 2.5.9) cannot express `for..of`,
// `for..in`, or `do..while` at all: node names for them fail to
// compile and statement snippets silently match nothing. A gate with
// silent holes is worse than a habit, so this is a TypeScript-AST walk
// instead: every loop form and every non-const declaration kind is a
// named SyntaxKind, no pattern language in between.
//
// Scope is the published packages' `src` trees only (derived, not
// listed -- #372): tests keep their latitude and `scripts/` itself is
// plain-JS tooling, both by the issue's own scoping decision.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { REPO_ROOT, sourceRoots } from "./source-roots.mjs";

const tsFilesUnder = (dir) =>
	readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap(
		(entry) => {
			const rel = `${dir}/${entry.name}`;
			if (entry.isDirectory()) {
				return tsFilesUnder(rel);
			}
			if (entry.name.endsWith(".ts")) {
				return [rel];
			}
			return [];
		},
	);

/** The declaration keyword actually written at a VariableDeclarationList
 * site. `const` is the only allowed one; `using`/`await using` are
 * treated like `const` (single-assignment, not a reassignment hazard). */
const declarationKeyword = (node) => {
	if ((node.flags & ts.NodeFlags.Let) !== 0) {
		return "let";
	}
	if ((node.flags & ts.NodeFlags.Const) !== 0) {
		return "const";
	}
	if ((node.flags & (ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) !== 0) {
		return "using";
	}
	return "var";
};

const LOOP_KINDS = new Map([
	[ts.SyntaxKind.ForStatement, "for"],
	[ts.SyntaxKind.ForInStatement, "for..in"],
	[ts.SyntaxKind.ForOfStatement, "for..of"],
	[ts.SyntaxKind.WhileStatement, "while"],
	[ts.SyntaxKind.DoStatement, "do..while"],
]);

const problems = [];

const report = (sourceFile, filePath, node, label) => {
	const { line } = ts.getLineAndCharacterOfPosition(
		sourceFile,
		node.getStart(sourceFile),
	);
	problems.push(`${filePath}:${line + 1} — banned \`${label}\``);
};

const visit = (sourceFile, filePath) => (node) => {
	const loopLabel = LOOP_KINDS.get(node.kind);
	if (loopLabel !== undefined) {
		report(sourceFile, filePath, node, loopLabel);
	}
	if (ts.isVariableDeclarationList(node)) {
		const keyword = declarationKeyword(node);
		if (keyword === "let" || keyword === "var") {
			report(sourceFile, filePath, node, keyword);
		}
	}
	ts.forEachChild(node, visit(sourceFile, filePath));
};

const files = sourceRoots().flatMap(tsFilesUnder);
files.forEach((filePath) => {
	const text = readFileSync(join(REPO_ROOT, filePath), "utf8");
	const sourceFile = ts.createSourceFile(
		filePath,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	ts.forEachChild(sourceFile, visit(sourceFile, filePath));
});

if (problems.length > 0) {
	console.error(
		"check-bans: package source declares with `const` only and iterates with expressions (AGENTS.md's house bans; enforcement gap measured in #447 -- a `let` survived `pnpm check` for months).\n",
	);
	problems.forEach((problem) => {
		console.error(`  ${problem}`);
	});
	console.error(
		"\nRewrite the site (const + array/iterator methods or recursion). There is deliberately no exemption list; if a site genuinely cannot be expressed without a ban, that is an owner conversation, not an allowlist entry.",
	);
	process.exit(1);
}

console.log(
	`check-bans: ok — no \`let\`/\`var\`/loop statements in ${files.length} package source files`,
);
