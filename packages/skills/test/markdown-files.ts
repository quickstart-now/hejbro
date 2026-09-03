import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Recursively lists every `.md` file under `dir` — shared by links.test.ts and snippet-compile.test.ts so both walk the skill's docs the same way. */
export const markdownFiles = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			return markdownFiles(full);
		}
		if (entry.name.endsWith(".md")) {
			return [full];
		}
		return [];
	});
