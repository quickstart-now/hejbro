#!/usr/bin/env node
// phase8-next-marker (#87), spec §7: every user-facing HejbroError states
// why it failed AND what to do, as a pair -- the "what to do" half is
// marked with a literal "Next:" by convention throughout this repo. This
// script makes that a checked invariant instead of a one-time sweep: it
// scans every throwHejbroError(...)/hejbroError(...) call site across the
// three source packages and fails if a site is missing "Next:" and isn't
// on the explicit internal-invariant exemption list below.
//
// Exempted by CODE, not by file:line -- a line-based allowlist would drift
// silently the moment a file is edited above the recorded line. Codes are
// stable identifiers; a code exempted here is exempted everywhere it's
// used, which is correct for every current internal-invariant code except
// two ("duplicate-identity" and "unknown-kind-dependency" are each thrown
// from both a user-facing site and an internal one -- split further below
// by message shape, not line number).
//
// Why each code is exempt (established during #87's classification --
// see docs/plans/2026-08-21-phase8-implementation.md and PR #87's body
// for the full reasoning and reproduction evidence):
// - "invalid-kind-change": the diff-engine/kind-emit contract -- a
//   `change` object is always built by the engine itself from paired
//   previous/next snapshots, never from user input; no declaration
//   content can violate it.
// - "invalid-table-identity": `splitTableIdentity`'s only call site
//   (table-kind-emit-sql.ts) always receives freshly-built DSL data for
//   the "next" side of a diff; a hand-edited "previous" snapshot's stale
//   value is only ever used for diff comparison, never re-emitted --
//   confirmed by direct reproduction (#87 report to planner, item 17).
// - "invalid-view-projection": the shape it guards against is "only
//   produced by exists()/notExists(), which defineView() never accepts"
//   per the message's own text -- defineView()'s own validation already
//   blocks this earlier.
// - "unreachable" / "unreachable-type-node": the CODE itself names the
//   guard (body-context.ts's frame-stack invariants, type-node.ts's
//   assertNever fallthrough) -- these throw from closures with no
//   `declaration`/user-input path in, so there's nothing a user could
//   have done differently.
// Any message that contains "internal hejbro bug" or starts with
// "unreachable" is exempted generically too (self-describing by the
// message's own admission) -- see MESSAGE_SELF_DESCRIBES_INTERNAL below,
// for codes whose reasoning lives in the message text rather than the
// code name.
const EXEMPT_CODES = new Set([
	"invalid-kind-change",
	"invalid-table-identity",
	"invalid-view-projection",
	"unreachable",
	"unreachable-type-node",
]);

/** Strips a single leading quote character (`"`, `'`, or `` ` ``) so an
 * inline string/template literal's text compares the same as a resolved
 * helper's plain text -- both `MESSAGE_SELF_DESCRIBES_INTERNAL` and the
 * mixed-reachability patterns below match against the message's own
 * wording, not its quoting. */
const stripLeadingQuote = (text) => text.replace(/^["'`]/, "");

/** A message that says outright it's an internal-only guard -- "internal
 * hejbro bug" (schema-kind's unsupported-operation, snapshot.ts's second
 * unowned-declaration site) or starts with "unreachable" (the internal
 * duplicate-identity site). Checked on the RESOLVED message text, not the
 * raw call-site args. */
const MESSAGE_SELF_DESCRIBES_INTERNAL = (messageText) =>
	/internal hejbro bug/.test(messageText) ||
	/^unreachable\b/.test(stripLeadingQuote(messageText));

// Two codes are thrown from both a user-facing site and an internal one;
// distinguished by message shape (stable across edits), not line number:
// - "unknown-kind-dependency": diff-engine.ts's dependsOn-cycle check is
//   user-facing (reachable via two presets' conflicting dependsOn
//   arrays); rankKinds's internal closure is not (every kindName it sees
//   already passed registry.get() successfully -- confirmed by direct
//   reproduction and by reading every rankKinds call site, #87 item 13).
// - "duplicate-identity": buildSnapshot's real duplicate-key case is
//   user-facing; findDuplicateKey's "no first occurrence" branch is a
//   pure invariant guard (its own message says "unreachable").
const MIXED_REACHABILITY_INTERNAL_PATTERNS = {
	"unknown-kind-dependency": /^change references unregistered kind /,
	"duplicate-identity": /^unreachable\b/,
};

/** Tests a mixed-reachability code's pattern against the message with its
 * quoting normalized away first (see {@link stripLeadingQuote}) -- the
 * pattern is authored against the message's own wording. */
const matchesInternalPattern = (pattern, messageText) =>
	pattern.test(stripLeadingQuote(messageText));

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_ROOTS = [
	"packages/core/src",
	"packages/cli/src",
	"packages/supabase/src",
];

/** Every file in `root` containing a throwHejbroError/hejbroError call --
 * `packages/core/src/error.ts` (the factories' own definitions) is
 * excluded explicitly, not by pattern, so a future file named similarly
 * doesn't silently skip itself. */
const findCandidateFiles = (root) => {
	const out = execFileSync(
		"grep",
		[
			"-rl",
			String.raw`throwHejbroError(\|hejbroError(`,
			root,
			"--include=*.ts",
		],
		{ cwd: REPO_ROOT, encoding: "utf8" },
	).trim();
	if (out === "") {
		return [];
	}
	return out.split("\n").filter((file) => !file.endsWith("/error.ts"));
};

/** Scans forward from `startIndex` (just past an opening bracket) and
 * returns the index just past the matching close, balancing `open`/
 * `close` characters. Used for both call-argument extraction and
 * declaration-body extraction so both handle nested brackets/braces the
 * same way. */
const scanBalanced = (text, startIndex, open, close) => {
	let depth = 1;
	let i = startIndex;
	while (depth > 0 && i < text.length) {
		const c = text[i];
		if (c === open) depth++;
		else if (c === close) depth--;
		i++;
	}
	return i;
};

/** Splits a call's raw argument text into top-level, comma-separated
 * arguments -- respecting nested parens/brackets/braces and quoted
 * strings/template literals (including a template's own `${...}`
 * interpolation, copied through verbatim without re-entering the
 * bracket-depth counter). Without this, a naive "find `, IDENT` anywhere
 * in the args" scan can mistake the call's *third* argument (`declaredAt`)
 * for its message, if a same-file local happens to also be named
 * `declaredAt` (confirmed false positive: rename-plan.ts's
 * unknown-rename-target sites, #87 investigation). */
const splitTopLevelArgs = (argsText) => {
	const args = [];
	let depth = 0;
	let current = "";
	let quote = null; // null | '"' | "'" | "`"
	let i = 0;
	while (i < argsText.length) {
		const c = argsText[i];
		if (quote !== null) {
			current += c;
			if (c === "\\" && i + 1 < argsText.length) {
				i++;
				current += argsText[i];
			} else if (c === quote) {
				quote = null;
			}
			i++;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			current += c;
			i++;
			continue;
		}
		if (c === "(" || c === "[" || c === "{") {
			depth++;
			current += c;
			i++;
			continue;
		}
		if (c === ")" || c === "]" || c === "}") {
			depth--;
			current += c;
			i++;
			continue;
		}
		if (c === "," && depth === 0) {
			args.push(current);
			current = "";
			i++;
			continue;
		}
		current += c;
		i++;
	}
	if (current.trim() !== "") {
		args.push(current);
	}
	return args.map((arg) => arg.trim());
};

/** Extracts every `throwHejbroError(...)`/`hejbroError(...)` call's
 * top-level argument list via balanced-paren scanning -- robust to
 * multi-line template literals and nested calls inside the message,
 * unlike a line-oriented grep. */
const extractCalls = (filePath, text) => {
	const calls = [];
	const callRe = /\b(throwHejbroError|hejbroError)\s*\(/g;
	let match = callRe.exec(text);
	while (match !== null) {
		const closeIndex = scanBalanced(
			text,
			match.index + match[0].length,
			"(",
			")",
		);
		const argsText = text.slice(match.index + match[0].length, closeIndex - 1);
		const lineNo = text.slice(0, match.index).split("\n").length;
		calls.push({ filePath, lineNo, args: splitTopLevelArgs(argsText) });
		match = callRe.exec(text);
	}
	return calls;
};

/** The call's `code` argument, if it's a literal string; `null` for a
 * dynamic/forwarded code (pass-through sites, e.g. rendering an
 * already-built HejbroError's own fields -- never an original message,
 * so never checked here) or a call with no code argument at all. */
const extractCode = (args) => {
	const [first] = args;
	if (first === undefined) {
		return null;
	}
	const match = /^"([^"]+)"$/.exec(first);
	if (match === null) {
		return null;
	}
	return match[1];
};

/** Finds `const NAME = <anything>;` (a top-level or block-scoped
 * declaration, single-expression arrow OR block-bodied function -- both
 * shapes exist in this codebase) and returns its full source text,
 * balancing braces/parens so a multi-branch function body is captured
 * whole, not truncated at the first `}`. `null` if not found. */
const findDeclarationText = (fileText, name) => {
	const declRe = new RegExp(`const ${name}\\s*=`);
	const match = declRe.exec(fileText);
	if (match === null) {
		return null;
	}
	let i = match.index + match[0].length;
	// Walk forward tracking paren/brace/backtick depth until the
	// statement-terminating `;` at depth 0.
	let parenDepth = 0;
	let braceDepth = 0;
	let inTemplate = false;
	while (i < fileText.length) {
		const c = fileText[i];
		if (c === "`") {
			inTemplate = !inTemplate;
		} else if (!inTemplate) {
			if (c === "(") parenDepth++;
			else if (c === ")") parenDepth--;
			else if (c === "{") braceDepth++;
			else if (c === "}") braceDepth--;
			else if (c === ";" && parenDepth === 0 && braceDepth === 0) {
				return fileText.slice(match.index, i + 1);
			}
		}
		i++;
	}
	return null;
};

/** The declaration's body might build its text by calling another
 * same-file helper -- a single-expression forward (`snapshotStaleMessage
 * (path)`), or buried in a chain (config.ts's `message` local, built via
 * `.map(describeIssue).join(" ")`). Rather than assuming one specific
 * call shape, scan every `name(` token in the body and check each
 * same-file declaration it names for "Next:" -- the first one found wins. */
const resolveViaCalledHelpers = (declText, fileText, depth) => {
	if (depth >= 2) {
		return declText;
	}
	const calleeNames = [
		...declText.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g),
	].map((m) => m[1]);
	for (const name of calleeNames) {
		const candidateText = findDeclarationText(fileText, name);
		if (candidateText !== null && /Next:/.test(candidateText)) {
			return candidateText;
		}
	}
	return declText;
};

/** Resolves the call's message argument (its 2nd top-level argument) to
 * searchable text. An inline literal (string/template) is returned as-is.
 * A bare identifier or `name(...)` call referencing a same-file `const`
 * (function or plain value) resolves to that declaration's full text; if
 * that text itself has no "Next:", one more level is tried via
 * {@link resolveViaCalledHelpers} before giving up. */
const resolveMessageText = (messageArg, fileText, depth = 0) => {
	if (messageArg === undefined) {
		return "";
	}
	const identMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(|$)/.exec(messageArg);
	if (identMatch === null) {
		// An inline string/template literal (or some other non-identifier
		// expression) -- nothing further to resolve.
		return messageArg;
	}
	const name = identMatch[1];
	const declText = findDeclarationText(fileText, name);
	if (declText === null) {
		return messageArg;
	}
	if (/Next:/.test(declText) || depth >= 2) {
		return declText;
	}
	return resolveViaCalledHelpers(declText, fileText, depth + 1);
};

const problems = [];

for (const root of SOURCE_ROOTS) {
	for (const filePath of findCandidateFiles(root)) {
		const fileText = readFileSync(join(REPO_ROOT, filePath), "utf8");
		for (const call of extractCalls(filePath, fileText)) {
			const code = extractCode(call.args);
			if (code === null) {
				// A dynamic/forwarded code -- not an original message site.
				continue;
			}
			if (EXEMPT_CODES.has(code)) {
				continue;
			}
			const messageText = resolveMessageText(call.args[1], fileText);
			const mixedPattern = MIXED_REACHABILITY_INTERNAL_PATTERNS[code];
			if (
				mixedPattern !== undefined &&
				matchesInternalPattern(mixedPattern, messageText)
			) {
				continue;
			}
			if (MESSAGE_SELF_DESCRIBES_INTERNAL(messageText)) {
				continue;
			}
			if (!/Next:/.test(messageText)) {
				problems.push(
					`${filePath}:${call.lineNo} — code "${code}" has no "Next:" and isn't on the exemption list`,
				);
			}
		}
	}
}

if (problems.length > 0) {
	console.error(
		'check-next-marker: every user-facing HejbroError must state what to do next (spec §7), marked with a literal "Next:" — see docs/plans/2026-08-21-phase8-implementation.md and PR #87 for the convention and the exemption list\'s reasoning (scripts/check-next-marker.mjs).\n',
	);
	for (const problem of problems) {
		console.error(`  ${problem}`);
	}
	console.error(
		'\nEither add a "Next:" clause naming a concrete action (not just a restated rule -- "paste it after Next: and check for a verb"), or, if this is a genuine internal invariant unreachable by any user action, add its code to EXEMPT_CODES (or a message pattern) in this script with the same reproduction-based reasoning the existing entries have.',
	);
	process.exit(1);
}

console.log(
	'check-next-marker: ok — every user-facing HejbroError call site has a "Next:" clause (or is an explicitly justified internal-invariant exemption).',
);
