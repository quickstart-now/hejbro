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
// There is deliberately NO generic message-text exemption (#288): a
// substring like "internal hejbro bug" in a message waved the site
// through no matter what its code was, so a user-reachable diagnostic
// could hide behind the phrase. Every exemption is structural -- a code
// in EXEMPT_CODES, or a code-scoped message-shape pattern below for
// codes thrown from both user-facing and internal sites.
// - "empty-if-statement": render-body.ts's no-branches guard -- the
//   plpgsql if builder cannot produce a branchless statement, so the
//   only path in is a hand-built malformed node (internal invariant;
//   single site, classified for #288).
const EXEMPT_CODES = new Set([
	"empty-if-statement",
	"invalid-kind-change",
	"invalid-table-identity",
	"invalid-view-projection",
	"unreachable",
	"unreachable-type-node",
]);

/** Strips a single leading quote character (`"`, `'`, or `` ` ``) so an
 * inline string/template literal's text compares the same as a resolved
 * helper's plain text -- the mixed-reachability patterns below match
 * against the message's own wording, not its quoting. */
const stripLeadingQuote = (text) => text.replace(/^["'`]/, "");

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
// - "unowned-declaration": buildSnapshot's zero-owners case is
//   user-facing (an unregistered preset kind; carries Next:); the
//   second site fires only after the same declaration already matched
//   during grouping -- a pure invariant guard (#288 classification).
// - "unsupported-operation": schema-kind's emit-alter guard is
//   unreachable in practice (schema diff never produces an alter); the
//   code name is generic, so it is deliberately NOT in EXEMPT_CODES --
//   a future user-facing "unsupported-operation" still owes a Next:.
const MIXED_REACHABILITY_INTERNAL_PATTERNS = {
	"unknown-kind-dependency": /^change references unregistered kind /,
	"duplicate-identity": /^unreachable\b/,
	"unowned-declaration":
		/^declaration at index \$\{[^}]*\} matched no kind|^declaration at index \d+ matched no kind/,
	"unsupported-operation": /^schema kind never alters/,
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
import { sourceRoots } from "./source-roots.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// #372: derived from the workspace, never enumerated -- see
// scripts/source-roots.mjs for why (the #361 class, killed at the root).
const SOURCE_ROOTS = sourceRoots();

/** Every file in `root` containing a throwHejbroError/hejbroError call --
 * `packages/core/src/error.ts` (the factories' own definitions) is
 * excluded explicitly, not by pattern, so a future file named similarly
 * doesn't silently skip itself. */
const findCandidateFiles = (root) => {
	// #361: the second alternative catches the enriched-plain-Error idiom
	// (`throw Object.assign(new Error(...), { code })`) that packages/query
	// and packages/pg use instead of throwHejbroError -- without it, adding
	// those roots would have been a no-op (a never-fires probe, the exact
	// failure mode this script's own header warns about). grep exits 1 when
	// a root has no match at all (pg today) -- that is "no candidates", not
	// an error, so it must not crash the gate.
	const grepOut = () => {
		try {
			return execFileSync(
				"grep",
				[
					"-rl",
					String.raw`throwHejbroError(\|hejbroError(\|Object.assign(\|new HejbroError(\|code: "`,
					root,
					"--include=*.ts",
				],
				{ cwd: REPO_ROOT, encoding: "utf8" },
			).trim();
		} catch (error) {
			if (error.status === 1) {
				return "";
			}
			throw error;
		}
	};
	const out = grepOut();
	if (out === "") {
		return [];
	}
	// error.ts stays excluded: it is the factory's own implementation --
	// its `new HejbroError(...)` IS the factory body (dynamic code, would
	// be skipped anyway), and its docs restate call shapes that would
	// otherwise register as phantom sites. Any direct construction
	// elsewhere is now a candidate via the `new HejbroError(` alternative.
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
 * unknown-rename-target sites, #87 investigation). Comments between
 * arguments are dropped, not copied through (#454). */
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
		if (c === "/" && argsText[i + 1] === "/") {
			// A comment between arguments is not argument text (#454): a
			// comma inside one would split an argument in two, and a
			// "Next:" inside one would satisfy the check without being in
			// the message -- so comments are dropped entirely, at any
			// depth. Quote state is checked first, so a `//` inside a
			// string (a URL in a message) is never treated as a comment.
			while (i < argsText.length && argsText[i] !== "\n") {
				i++;
			}
			continue;
		}
		if (c === "/" && argsText[i + 1] === "*") {
			const end = argsText.indexOf("*/", i + 2);
			if (end === -1) {
				i = argsText.length;
			} else {
				i = end + 2;
			}
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
const extractCalls = (filePath, text, extraCallNames = []) => {
	const calls = [];
	// #361: extraCallNames carries same-file thrower helpers (the
	// (code, message) convention, e.g. compile.ts's throwQueryError) whose
	// own Object.assign site has a dynamic code and is therefore skipped --
	// the original messages live at their call sites, scanned here.
	const names = ["throwHejbroError", "hejbroError", ...extraCallNames];
	const callRe = new RegExp(`\\b(${names.join("|")})\\s*\\(`, "g");
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

/** #361: the enriched-plain-Error idiom packages/query and packages/pg
 * use -- `Object.assign(new Error(<message>), { code: "...", ... })` --
 * normalized into the same `{ filePath, lineNo, args }` shape as a
 * throwHejbroError call, so the one validation loop below (exemptions,
 * mixed-reachability patterns, message resolution) applies unchanged. A
 * site whose enrichment carries no literal `code:` string (the `{ code }`
 * shorthand inside a thrower helper, or a non-error Object.assign like
 * sql.ts's tag composition) is skipped exactly like a dynamic-code
 * throwHejbroError call: it is not an original message site. */
/** #461: direct `new HejbroError(code, message)` construction -- the
 * factory (`error.ts`) is the only legitimate site today and its code is
 * a parameter (dynamic -> skipped), but a future direct construction
 * with a literal code would otherwise bypass the gate entirely
 * (confirmed by mutation during the add-check-schema review). Normalized
 * into the same `{ filePath, lineNo, args }` shape as a thrower call. */
const extractConstructorSites = (filePath, text) => {
	const sites = [];
	const ctorRe = /\bnew\s+HejbroError\s*\(/g;
	let match = ctorRe.exec(text);
	while (match !== null) {
		const closeIndex = scanBalanced(
			text,
			match.index + match[0].length,
			"(",
			")",
		);
		const argsText = text.slice(match.index + match[0].length, closeIndex - 1);
		const lineNo = text.slice(0, match.index).split("\n").length;
		sites.push({ filePath, lineNo, args: splitTopLevelArgs(argsText) });
		match = ctorRe.exec(text);
	}
	return sites;
};

/** Walks backward from `index` to the `{` that opens the enclosing
 * object literal, balancing any closed pairs passed on the way. */
const findEnclosingBrace = (text, index) => {
	let depth = 0;
	let i = index - 1;
	while (i >= 0) {
		const c = text[i];
		if (c === "}") {
			depth++;
		} else if (c === "{") {
			if (depth === 0) {
				return i;
			}
			depth--;
		}
		i--;
	}
	return null;
};

/** #461: diagnostics minted as plain object literals -- `{ code: "...",
 * message: ... }` (loader.ts) and the structured Diagnostic shape
 * `{ code: "...", body: ..., suggestions: [...] }`
 * (rename-diagnostics.ts). The convention's substance is "state what to
 * do next": a `suggestions` array IS that statement in structured form
 * (each entry carries a label and concrete rerun lines), so a literal
 * carrying `suggestions` satisfies the convention by construction and
 * is not reduced to a message site. A literal carrying `message` or
 * `body` WITHOUT `suggestions` must say "Next:" like any thrower
 * message -- body text that lost its suggestions would otherwise leave
 * the user with a finding and no action. A literal with a code and
 * neither field (an Object.assign enrichment, a `{ code }` forward) is
 * not an original message site and is skipped, mirroring how
 * dynamic-code calls are skipped.
 *
 * Value-position detection is the comma after the string literal
 * (`code: "x",`): type positions end in `;` or continue with `|`, and
 * the house formatter always leaves trailing commas in multiline value
 * literals. */
const extractObjectLiteralSites = (filePath, text) => {
	const sites = [];
	const codeFieldRe = /\bcode:\s*"([^"]+)"\s*,/g;
	let match = codeFieldRe.exec(text);
	while (match !== null) {
		const open = findEnclosingBrace(text, match.index);
		if (open === null) {
			match = codeFieldRe.exec(text);
			continue;
		}
		const closeIndex = scanBalanced(text, open + 1, "{", "}");
		const objectText = text.slice(open + 1, closeIndex - 1);
		const fields = splitTopLevelArgs(objectText);
		const fieldValue = (name) => {
			const field = fields.find((candidate) =>
				candidate.startsWith(`${name}:`),
			);
			if (field === undefined) {
				return null;
			}
			return field.slice(field.indexOf(":") + 1).trim();
		};
		const hasSuggestions = fieldValue("suggestions") !== null;
		const content = fieldValue("message") ?? fieldValue("body");
		if (!hasSuggestions && content !== null) {
			const lineNo = text.slice(0, match.index).split("\n").length;
			sites.push({
				filePath,
				lineNo,
				args: [`"${match[1]}"`, content],
			});
		}
		match = codeFieldRe.exec(text);
	}
	return sites;
};

const extractAssignSites = (filePath, text) => {
	const sites = [];
	const assignRe = /\bObject\.assign\s*\(/g;
	let match = assignRe.exec(text);
	while (match !== null) {
		const closeIndex = scanBalanced(
			text,
			match.index + match[0].length,
			"(",
			")",
		);
		const argsText = text.slice(match.index + match[0].length, closeIndex - 1);
		const args = splitTopLevelArgs(argsText);
		const enrichment = args.slice(1).join(", ");
		const codeMatch = /\bcode:\s*"([^"]+)"/.exec(enrichment);
		if (codeMatch !== null) {
			const lineNo = text.slice(0, match.index).split("\n").length;
			const [target] = args;
			const targetText = target ?? "";
			const errorMatch = /^new Error\s*\(/.exec(targetText);
			const messageArg = () => {
				if (errorMatch === null) {
					return targetText;
				}
				return targetText.slice(errorMatch[0].length).replace(/\)\s*$/, "");
			};
			sites.push({
				filePath,
				lineNo,
				args: [`"${codeMatch[1]}"`, messageArg()],
			});
		}
		match = assignRe.exec(text);
	}
	return sites;
};

/** #361: same-file thrower helpers wrapping the enriched-plain-Error
 * idiom with a forwarded code -- `const throwX = (code, message) => {
 * throw Object.assign(new Error(message), { code }); }`. Their assign
 * site is dynamic (skipped above), so the helper NAME joins the call-site
 * scan instead, under the same (code, message) argument convention as
 * throwHejbroError.
 *
 * A declaration only qualifies when it actually attaches a `code` field
 * to the thrown error -- `{ code }`, `{ code: SOME_CONST }`, or `{ code,
 * ...rest }` all satisfy `/\bcode\b\s*[,:}]/` -- because a diagnostic
 * helper, by definition, mints a code somehow; a same-shape enrichment
 * that attaches no `code` at all (`throwPhaseTagged`'s own `{ resetPhase,
 * cause }`, #753 D106 R1 round 2) cannot be a `(code, message)` thrower no
 * matter how its body is written, and registering its name here reads its
 * call sites' first argument (a phase label, not a code) as a literal
 * diagnostic code -- the false positive CI measured. This requirement
 * narrows the gate, it does not widen the miss: a genuine thrower with a
 * *literal* `code: "..."` string is already caught by
 * {@link extractAssignSites} directly, which is exactly why the existing
 * `!/\bcode:\s*"/.test(declText)` exclusion stays -- the two conditions
 * together mean "attaches a code, but not as an inline literal string". */
const findLocalThrowerNames = (text) => {
	const names = [];
	const declRe = /\bconst ([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
	let match = declRe.exec(text);
	while (match !== null) {
		const declText = findDeclarationText(text, match[1]);
		if (
			declText?.includes("Object.assign(") &&
			declText.includes("new Error(") &&
			/\bcode\b\s*[,:}]/.test(declText) &&
			!/\bcode:\s*"/.test(declText)
		) {
			names.push(match[1]);
		}
		match = declRe.exec(text);
	}
	return names;
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
		const sites = [
			...extractCalls(filePath, fileText, findLocalThrowerNames(fileText)),
			...extractAssignSites(filePath, fileText),
			...extractConstructorSites(filePath, fileText),
			...extractObjectLiteralSites(filePath, fileText),
		];
		for (const call of sites) {
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
			if (!/Next:/.test(messageText)) {
				// Only claim "has no Next:" when the resolver actually saw
				// message content (some string/template literal). Otherwise
				// the site was located but its message was not -- a parser
				// miss, and asserting a content diagnosis for it misdirected
				// a fix twice before it was caught (#454).
				if (/["'`]/.test(messageText)) {
					problems.push(
						`${filePath}:${call.lineNo} — code "${code}" has no "Next:" and isn't on the exemption list`,
					);
				} else {
					problems.push(
						`${filePath}:${call.lineNo} — code "${code}": could not locate the message literal (the call's 2nd argument resolved to no string/template) — check for unusual formatting around the call's arguments, then verify the message's "Next:" clause by reading it, not this gate`,
					);
				}
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
	'check-next-marker: ok — every user-facing diagnostic site (thrower calls, Object.assign enrichments, direct constructions, object-literal diagnostics) states a "Next:" or carries structured suggestions (or is an explicitly justified internal-invariant exemption).',
);
