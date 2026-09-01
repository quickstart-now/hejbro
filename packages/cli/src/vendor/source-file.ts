import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableJson, throwHejbroError } from "@hejbro/core";
import { z } from "zod";

/**
 * `link`'s own file, at the repository root — a single committed fact
 * (the schema source), not configuration (owner decision: distinct from
 * `hejbro.config.ts`, which stays untouched, and from `hejbro.lock`,
 * which `vendor` alone writes). Mirrors the real ecosystems this design
 * is modelled on, where an intent file and a lock file are always a
 * pair (`package.json`/`package-lock.json`, `go.mod`/`go.sum`) — never a
 * lock alone.
 */
export const SOURCE_FILE_NAME = "hejbro.json";

export const sourceFilePath = (cwd: string): string =>
	join(cwd, SOURCE_FILE_NAME);

export type SourceFile = {
	readonly source: string;
};

/** No `generatedBy` mark here: `hejbro.json` is `{ source }` and nothing
 * else, and the schema itself is the guard — a file that ever grew an
 * extra key, or isn't `{ source: string }` at all, is not one `link`
 * would have written (schema-vendoring spec, "Linking records the
 * repository alone"). */
const sourceFileSchema = z.object({ source: z.string() }).strict();

const parseSourceFile = (text: string): SourceFile | null => {
	try {
		const value: unknown = JSON.parse(text);
		const result = sourceFileSchema.safeParse(value);
		if (!result.success) {
			return null;
		}
		return result.data;
	} catch {
		return null;
	}
};

/** `link`'s own guard: refuses to claim `hejbro.json` when it already
 * exists and doesn't parse as exactly `{ source: string }`, unless
 * `force`. */
export const assertSourceFileWritable = (cwd: string, force: boolean): void => {
	const path = sourceFilePath(cwd);
	if (!existsSync(path) || force) {
		return;
	}
	if (parseSourceFile(readFileSync(path, "utf8")) !== null) {
		return;
	}
	throwHejbroError(
		"vendor-destination-not-vendored",
		`"${path}" already exists and doesn't look like a file \`hejbro link\` wrote. Next: remove it, or pass --force if overwriting it is what you want.`,
	);
};

/**
 * `null` when nothing is linked yet. Refuses (never silently trusts) a
 * `hejbro.json` that exists but doesn't parse as exactly
 * `{ source: string }` — the same guard {@link assertSourceFileWritable}
 * applies before a write, applied here before a read ever treats
 * foreign content as a real source. Reclaim the file with `hejbro link
 * --force` first if that's genuinely what's wanted.
 */
export const readSourceFile = (cwd: string): SourceFile | null => {
	const path = sourceFilePath(cwd);
	if (!existsSync(path)) {
		return null;
	}
	const parsed = parseSourceFile(readFileSync(path, "utf8"));
	if (parsed === null) {
		return throwHejbroError(
			"vendor-destination-not-vendored",
			`"${path}" already exists and doesn't look like a file \`hejbro link\` wrote. Next: remove it, or run \`hejbro link --force <repository>\` if overwriting it is what you want.`,
		);
	}
	return parsed;
};

export const writeSourceFile = (cwd: string, source: string): void => {
	writeFileSync(sourceFilePath(cwd), stableJson({ source }));
};
