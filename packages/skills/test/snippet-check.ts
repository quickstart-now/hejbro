import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

/** Repo root, computed from this file's own location — never `process.cwd()`, so the gate works the same whether vitest is invoked from the repo root or from `packages/skills`. */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const PRELUDE_DIR = join(REPO_ROOT, "packages/skills/test/fixtures/preludes");

/** Every user-facing package a snippet is allowed to import from (#131 policy: source entries, never `dist`). */
const compilerOptions: ts.CompilerOptions = {
	strict: true,
	noEmit: true,
	module: ts.ModuleKind.ESNext,
	target: ts.ScriptTarget.ES2022,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	skipLibCheck: true,
	noUnusedLocals: false,
	noUnusedParameters: false,
	baseUrl: REPO_ROOT,
	paths: {
		hejbro: ["packages/cli/src/index.ts"],
		"@hejbro/core": ["packages/core/src/index.ts"],
		"@hejbro/query": ["packages/query/src/index.ts"],
		"@hejbro/pg": ["packages/pg/src/index.ts"],
		"@hejbro/supabase": ["packages/supabase/src/index.ts"],
	},
};

export type SnippetDirectives = {
	readonly prelude?: string;
	readonly expectError: boolean;
	readonly noCheck?: string;
};

export type Snippet = SnippetDirectives & {
	/** Repo-root-relative path of the markdown file the snippet came from, e.g. `skills/hejbro/references/dsl-cheatsheet.md`. */
	readonly docPath: string;
	/** 1-indexed line of the opening ` ```ts ` fence in `docPath`. */
	readonly fenceLine: number;
	/** The code between the fences, not including the fence lines themselves. */
	readonly code: string;
};

export type Violation = {
	readonly docPath: string;
	readonly line: number;
	readonly message: string;
};

export type AllowlistEntry = {
	readonly doc: string;
	readonly slug: string;
};

/** Matches an opening ` ```ts ` fence (optionally followed by directive tokens) through the matching closing ` ``` ` line. Deliberately narrow to ```ts``` — a plain ``` ``` ``` or ```` ```json ```` fence (e.g. the migration banner example in generate-verify-workflow.md) is never a compile target. */
const FENCE_RE =
	/^```ts(?:[ \t]+(\S.*?))?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\r?$/gm;

/** Splits a fence's directive text (e.g. `prelude=demo expect-error`) into the three recognized tokens. An unrecognized token fails loudly rather than being silently ignored — a typo'd directive must never pass through the gate unnoticed. */
const isKnownDirectiveToken = (token: string): boolean =>
	token === "expect-error" ||
	token.startsWith("prelude=") ||
	token.startsWith("no-check=");

/** Reads a `key=` token's value out of `tokens`, undefined when absent — the entry-filter step below (never a ternary) is what keeps an absent directive from ever landing as an explicit `undefined` property. */
const tokenValue = (
	tokens: ReadonlyArray<string>,
	key: string,
): string | undefined =>
	tokens.find((token) => token.startsWith(key))?.slice(key.length);

/** `prelude`/`noCheck` as a spreadable partial — only the directives actually present in `tokens`, so `parseDirectives` needs one spread, not a branch per optional field. */
const optionalDirectiveFields = (
	tokens: ReadonlyArray<string>,
): Partial<Pick<SnippetDirectives, "prelude" | "noCheck">> =>
	Object.fromEntries(
		[
			["prelude", tokenValue(tokens, "prelude=")],
			["noCheck", tokenValue(tokens, "no-check=")],
		].filter((entry): entry is [string, string] => entry[1] !== undefined),
	);

const parseDirectives = (
	directiveText: string,
	docPath: string,
	fenceLine: number,
): SnippetDirectives => {
	const tokens = directiveText.trim().split(/\s+/).filter(Boolean);
	const unknown = tokens.find((token) => !isKnownDirectiveToken(token));
	if (unknown !== undefined) {
		throw new Error(
			`${docPath}:${fenceLine}: unknown snippet directive "${unknown}" — expected "prelude=<name>", "expect-error", or "no-check=<reason-slug>"`,
		);
	}
	return {
		expectError: tokens.includes("expect-error"),
		...optionalDirectiveFields(tokens),
	};
};

/** Extracts every ` ```ts ` fenced block from `text` (a markdown doc's own content), `docPath` used only to attribute directive-parse errors and later diagnostics back to the source file. */
export const extractSnippets = (
	text: string,
	docPath: string,
): ReadonlyArray<Snippet> =>
	[...text.matchAll(FENCE_RE)].map((match) => {
		const fenceLine = text.slice(0, match.index ?? 0).split("\n").length;
		const directives = parseDirectives(match[1] ?? "", docPath, fenceLine);
		return { docPath, fenceLine, code: match[2] ?? "", ...directives };
	});

const relativeToRepoRoot = (absPath: string): string =>
	relative(REPO_ROOT, absPath).split("\\").join("/");

const preludePath = (name: string): string => join(PRELUDE_DIR, `${name}.ts`);

/** One snippet's compiled form: the prelude (if any) plus the snippet's own code, concatenated into a single virtual file so both type-check together in the same program (`prelude=` contract, point 1). */
type Unit = {
	readonly snippet: Snippet;
	readonly fileName: string;
	readonly content: string;
	/** Number of lines contributed by the prelude — 0 when there is none. A diagnostic at or below this line originates in the prelude file, not the doc. */
	readonly preludeLineCount: number;
};

const sanitizeForFileName = (docPath: string): string =>
	docPath.split("/").join("__");

/** Loads `snippet`'s prelude fixture (empty/zero when it declares none) — isolated here so `buildUnit` reads as one straight-line assembly, no branch. */
const loadPrelude = (
	snippet: Snippet,
): { readonly text: string; readonly lineCount: number } => {
	if (snippet.prelude === undefined) {
		return { text: "", lineCount: 0 };
	}
	const text = readFileSync(preludePath(snippet.prelude), "utf8");
	return { text, lineCount: text.split("\n").length };
};

const withPrelude = (snippet: Snippet, preludeText: string): string => {
	if (snippet.prelude === undefined) {
		return snippet.code;
	}
	return `${preludeText}\n${snippet.code}`;
};

const buildUnit = (snippet: Snippet, index: number): Unit => {
	const prelude = loadPrelude(snippet);
	const preludeLineCount = prelude.lineCount;
	const codeWithPrelude = withPrelude(snippet, prelude.text);
	// A snippet with no import/export of its own is otherwise a TS "script",
	// not a module — every such virtual file would then share one global
	// scope with every other one in the same program, so an unrelated pair
	// of snippets declaring the same top-level name (e.g. two `const rows`)
	// would collide with a spurious "Cannot redeclare" diagnostic that has
	// nothing to do with either snippet's own correctness. Appending this
	// after the real content never shifts a diagnostic's reported line.
	const content = `${codeWithPrelude}\nexport {};\n`;
	const fileName = join(
		REPO_ROOT,
		"packages/skills/test/.snippet-check",
		`${sanitizeForFileName(snippet.docPath)}.${index}.ts`,
	);
	return { snippet, fileName, content, preludeLineCount };
};

/** Builds one `ts.Program` compiling every `unit`'s virtual file, real repo source resolved through the default host for everything else — `paths`' targets (each package's own `src/index.ts`) included. */
const buildProgram = (units: ReadonlyArray<Unit>): ts.Program => {
	const virtualFiles = new Map(
		units.map((unit) => [unit.fileName, unit.content]),
	);
	const baseHost = ts.createCompilerHost(compilerOptions);
	const host: ts.CompilerHost = {
		...baseHost,
		fileExists: (fileName) =>
			virtualFiles.has(fileName) || baseHost.fileExists(fileName),
		readFile: (fileName) =>
			virtualFiles.get(fileName) ?? baseHost.readFile(fileName),
		getSourceFile: (
			fileName,
			languageVersionOrOptions,
			onError,
			shouldCreateNewSourceFile,
		) => {
			const virtual = virtualFiles.get(fileName);
			if (virtual !== undefined) {
				return ts.createSourceFile(
					fileName,
					virtual,
					ts.ScriptTarget.ES2022,
					true,
				);
			}
			return baseHost.getSourceFile(
				fileName,
				languageVersionOrOptions,
				onError,
				shouldCreateNewSourceFile,
			);
		},
	};
	return ts.createProgram({
		rootNames: units.map((unit) => unit.fileName),
		options: compilerOptions,
		host,
	});
};

const groupDiagnosticsByFile = (
	diagnostics: ReadonlyArray<ts.Diagnostic>,
): ReadonlyMap<string, ReadonlyArray<ts.Diagnostic>> =>
	diagnostics.reduce<Map<string, ts.Diagnostic[]>>((map, diagnostic) => {
		const fileName = diagnostic.file?.fileName;
		if (fileName === undefined) {
			return map;
		}
		const existing = map.get(fileName) ?? [];
		map.set(fileName, [...existing, diagnostic]);
		return map;
	}, new Map());

/** Maps one diagnostic on `unit`'s virtual file back to its real coordinate — the prelude fixture file when the diagnostic falls inside the prepended prelude text, the doc's own fence line otherwise. */
const diagnosticToViolation = (
	diagnostic: ts.Diagnostic,
	unit: Unit,
): Violation => {
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
	if (diagnostic.file === undefined || diagnostic.start === undefined) {
		return {
			docPath: unit.snippet.docPath,
			line: unit.snippet.fenceLine,
			message,
		};
	}
	const virtualLine =
		diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
	if (
		unit.snippet.prelude !== undefined &&
		virtualLine <= unit.preludeLineCount
	) {
		return {
			docPath: relativeToRepoRoot(preludePath(unit.snippet.prelude)),
			line: virtualLine,
			message,
		};
	}
	const relativeCodeLine = virtualLine - unit.preludeLineCount;
	return {
		docPath: unit.snippet.docPath,
		line: unit.snippet.fenceLine + relativeCodeLine,
		message,
	};
};

/** `no-check=<slug>` is a documented escape hatch (point 1), never a silent one: `slug` must appear in `allowlist` under this exact `docPath`, or the exclusion itself is reported as a violation. */
const checkAllowlist = (
	snippet: Snippet,
	allowlist: ReadonlyArray<AllowlistEntry>,
): ReadonlyArray<Violation> => {
	if (snippet.noCheck === undefined) {
		return [];
	}
	const allowed = allowlist.some(
		(entry) => entry.doc === snippet.docPath && entry.slug === snippet.noCheck,
	);
	if (allowed) {
		return [];
	}
	return [
		{
			docPath: snippet.docPath,
			line: snippet.fenceLine,
			message: `no-check="${snippet.noCheck}" is not in the allowlist for "${snippet.docPath}" — add { doc: "${snippet.docPath}", slug: "${snippet.noCheck}" } to NO_CHECK_ALLOWLIST, or fix the snippet instead of excluding it.`,
		},
	];
};

/**
 * Type-checks every checkable snippet (every one without `no-check=`) in a
 * single `ts.Program`, then reduces the result to a flat violation list:
 * - a no-token snippet reports every diagnostic raised against it
 * - an `expect-error` snippet reports a violation only when it raised *no*
 *   diagnostic at all (it was supposed to fail and didn't)
 * - a `no-check=` snippet is never compiled; it is checked against
 *   `allowlist` instead
 */
export const checkSnippets = (
	snippets: ReadonlyArray<Snippet>,
	allowlist: ReadonlyArray<AllowlistEntry>,
): ReadonlyArray<Violation> => {
	const allowlistViolations = snippets.flatMap((snippet) =>
		checkAllowlist(snippet, allowlist),
	);

	const units = snippets
		.filter((snippet) => snippet.noCheck === undefined)
		.map((snippet, index) => buildUnit(snippet, index));

	if (units.length === 0) {
		return allowlistViolations;
	}

	const program = buildProgram(units);
	const unitFileNames = new Set(units.map((unit) => unit.fileName));
	const diagnostics = ts
		.getPreEmitDiagnostics(program)
		.filter((diagnostic) => unitFileNames.has(diagnostic.file?.fileName ?? ""));
	const diagnosticsByFile = groupDiagnosticsByFile(diagnostics);

	const compileViolations = units.flatMap((unit) => {
		const fileDiagnostics = diagnosticsByFile.get(unit.fileName) ?? [];
		if (unit.snippet.expectError) {
			if (fileDiagnostics.length > 0) {
				return [];
			}
			return [
				{
					docPath: unit.snippet.docPath,
					line: unit.snippet.fenceLine,
					message:
						"expect-error block compiled cleanly — no type error was raised, so this snippet no longer demonstrates a mistake",
				},
			];
		}
		return fileDiagnostics.map((diagnostic) =>
			diagnosticToViolation(diagnostic, unit),
		);
	});

	return [...allowlistViolations, ...compileViolations];
};
