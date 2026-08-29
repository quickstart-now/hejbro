import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

/** Repo root, computed from this file's own location — never `process.cwd()`, so the gate works the same whether vitest is invoked from the repo root or from `packages/skills`. */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const PRELUDE_DIR = join(REPO_ROOT, "packages/skills/test/fixtures/preludes");

/** Every user-facing package a snippet is allowed to import from (#131 policy: source entries, never `dist`). Deliberately hand-curated — the map's meaning is "allowed imports", not "packages that exist", so deriving it from the workspace would silently widen the allowed surface with every new package (#484's design note). The guard below keeps it from dangling instead: every key and target must exist in the workspace, so the list can under-approve but never rot. */
const allowedImportPaths: Record<string, string[]> = {
	hejbro: ["packages/cli/src/index.ts"],
	"@hejbro/core": ["packages/core/src/index.ts"],
	"@hejbro/query": ["packages/query/src/index.ts"],
	"@hejbro/pg": ["packages/pg/src/index.ts"],
	"@hejbro/supabase": ["packages/supabase/src/index.ts"],
	"@hejbro/neon": ["packages/neon/src/index.ts"],
};

Object.entries(allowedImportPaths).forEach(([name, targets]) => {
	targets.forEach((target) => {
		const entry = join(REPO_ROOT, target);
		const manifestPath = join(
			REPO_ROOT,
			target.split("/src/")[0] ?? "",
			"package.json",
		);
		if (!existsSync(entry) || !existsSync(manifestPath)) {
			throw new Error(
				`snippet-check: allowed-import entry "${name}" points at a path that does not exist (${target}). Next: fix or remove the entry — a dangling allow-list key fails no gate on its own.`,
			);
		}
		const manifestName: unknown = JSON.parse(
			readFileSync(manifestPath, "utf8"),
		).name;
		if (manifestName !== name) {
			throw new Error(
				`snippet-check: allowed-import key "${name}" resolves to a package named "${String(manifestName)}" (${target}). Next: the key must match the package's own name.`,
			);
		}
	});
});

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
	paths: { ...allowedImportPaths },
};

export type SnippetDirectives = {
	readonly prelude?: string;
	/** The TS diagnostic code (e.g. `"2322"`) `expect-error=<code>` names — undefined when the block carries no `expect-error=` directive at all. A bare `expect-error` with no code is rejected at parse time (see `isKnownDirectiveToken`): *any* diagnostic passing as "the mistake" would let an unrelated failure (a typo'd import) masquerade as the documented one. */
	readonly expectErrorCode?: string;
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

/** Splits a fence's directive text (e.g. `prelude=demo expect-error=2322`) into the three recognized tokens. An unrecognized token fails loudly rather than being silently ignored — a typo'd directive (a bare `expect-error` with no `=<code>` included, per TERMINAL v1.5) must never pass through the gate unnoticed. */
const isKnownDirectiveToken = (token: string): boolean =>
	token.startsWith("expect-error=") ||
	token.startsWith("prelude=") ||
	token.startsWith("no-check=");

/** Reads a `key=` token's value out of `tokens`, undefined when absent — the entry-filter step below (never a ternary) is what keeps an absent directive from ever landing as an explicit `undefined` property. */
const tokenValue = (
	tokens: ReadonlyArray<string>,
	key: string,
): string | undefined =>
	tokens.find((token) => token.startsWith(key))?.slice(key.length);

/** `prelude`/`expectErrorCode`/`noCheck` as a spreadable partial — only the directives actually present in `tokens`, so `parseDirectives` needs one spread, not a branch per optional field. */
const optionalDirectiveFields = (
	tokens: ReadonlyArray<string>,
): Partial<SnippetDirectives> =>
	Object.fromEntries(
		[
			["prelude", tokenValue(tokens, "prelude=")],
			["expectErrorCode", tokenValue(tokens, "expect-error=")],
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
			`${docPath}:${fenceLine}: unknown snippet directive "${unknown}" — expected "prelude=<name>", "expect-error=<ts-diagnostic-code>", or "no-check=<reason-slug>" (a bare "expect-error" with no code is rejected — name the exact TS code the block must raise)`,
		);
	}
	return optionalDirectiveFields(tokens);
};

/** An opening fence line: three backticks then the language token (no leading space allowed before the backticks, matching CommonMark's own fenced-code-block rule). */
const OPEN_FENCE_RE = /^```(\S+)/gm;

/** `true` when `token` reads as an attempt to label a TypeScript example — `typescript`, `tsx`, `TS`, `ts-check`, … (case-insensitive) — but isn't the exact literal `ts` this harness type-checks (TERMINAL v1.5: closes the fence-label bypass). A prefix-only rule (`/^ts/i`) would also catch unrelated tags like `tsql`; matching the known synonyms plus a `ts-`/`ts_` prefix avoids that false positive. */
const isMislabeledTsFence = (token: string): boolean => {
	if (token === "ts") {
		return false;
	}
	const lower = token.toLowerCase();
	return (
		lower === "ts" ||
		lower === "typescript" ||
		lower === "tsx" ||
		lower.startsWith("ts-") ||
		lower.startsWith("ts_")
	);
};

/** Scans `text` for a fenced block whose language token looks like TypeScript but isn't exactly ` ```ts ` — the one label `extractSnippets`'s `FENCE_RE` actually type-checks. A `sql`/`bash`/bare-``` fence is untouched; this only flags an author's typo/synonym that would otherwise silently skip the gate. */
export const findMislabeledFences = (
	text: string,
	docPath: string,
): ReadonlyArray<Violation> =>
	[...text.matchAll(OPEN_FENCE_RE)]
		.filter((match) => isMislabeledTsFence(match[1] ?? ""))
		.map((match) => ({
			docPath,
			line: text.slice(0, match.index ?? 0).split("\n").length,
			message: `fence labeled \`\`\`${match[1]} looks like TypeScript but is never type-checked — use \`\`\`ts so the snippet is type-checked.`,
		}));

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

/** Describes an `expect-error=<code>` block's mismatch — either it raised nothing at all, or it raised diagnostics none of which carry the expected code (TERMINAL v1.5: a bare "any diagnostic" match would let an unrelated failure, e.g. a typo'd import, masquerade as the documented mistake). */
const describeObservedCodes = (
	observedCodes: ReadonlyArray<number>,
): string => {
	if (observedCodes.length === 0) {
		return "none (compiled cleanly)";
	}
	return observedCodes.join(", ");
};

const expectErrorViolation = (
	unit: Unit,
	expectedCode: string,
	observedCodes: ReadonlyArray<number>,
): Violation => {
	const observed = describeObservedCodes(observedCodes);
	return {
		docPath: unit.snippet.docPath,
		line: unit.snippet.fenceLine,
		message: `expect-error="${expectedCode}" expected TS${expectedCode}, but observed: ${observed}`,
	};
};

/**
 * Type-checks every checkable snippet (every one without `no-check=`) in a
 * single `ts.Program`, then reduces the result to a flat violation list:
 * - a no-token snippet reports every diagnostic raised against it
 * - an `expect-error=<code>` snippet reports a violation unless at least one
 *   of its diagnostics carries exactly that TS code
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
	// Only the snippet files' own diagnostics are ever reported (the filter
	// below has always dropped everything else), but
	// `ts.getPreEmitDiagnostics(program)` computes semantic diagnostics for
	// EVERY file the program pulled in -- all five packages' src trees,
	// which `pnpm check-types` already gates -- before the filter throws
	// that work away. Asking the checker for exactly the snippet files
	// keeps the reported set identical (#436, measured: same diagnostic
	// set, ~40% less wall clock at 23 snippets) while leaving package
	// sources to the gate that owns them.
	const snippetSourceFiles = units.flatMap((unit) => {
		const sourceFile = program.getSourceFile(unit.fileName);
		if (sourceFile === undefined) {
			return [];
		}
		return [sourceFile];
	});
	const diagnostics = snippetSourceFiles
		.flatMap((sourceFile) => [
			...program.getSyntacticDiagnostics(sourceFile),
			...program.getSemanticDiagnostics(sourceFile),
		])
		.filter((diagnostic) => unitFileNames.has(diagnostic.file?.fileName ?? ""));
	const diagnosticsByFile = groupDiagnosticsByFile(diagnostics);

	const compileViolations = units.flatMap((unit) => {
		const fileDiagnostics = diagnosticsByFile.get(unit.fileName) ?? [];
		const expectedCode = unit.snippet.expectErrorCode;
		if (expectedCode !== undefined) {
			const observedCodes = fileDiagnostics.map(
				(diagnostic) => diagnostic.code,
			);
			if (observedCodes.includes(Number(expectedCode))) {
				return [];
			}
			return [expectErrorViolation(unit, expectedCode, observedCodes)];
		}
		return fileDiagnostics.map((diagnostic) =>
			diagnosticToViolation(diagnostic, unit),
		);
	});

	return [...allowlistViolations, ...compileViolations];
};
