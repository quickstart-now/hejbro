// #488: nothing gated the changeset fixed group against the workspace --
// a new published package could ship outside the group and version
// alone. The group must equal the published set exactly, both
// directions: a published package missing from the group splits
// versioning; a group entry with no workspace package is a stale name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedPackages, REPO_ROOT } from "./workspace-packages.mjs";

const config = JSON.parse(
	readFileSync(join(REPO_ROOT, ".changeset/config.json"), "utf8"),
);
const groups = config.fixed;
if (!Array.isArray(groups) || groups.length !== 1) {
	console.error(
		"error[check-fixed-group]: .changeset/config.json must carry exactly one fixed group. Next: keep the published packages in one fixed array.",
	);
	process.exit(1);
}
const fixed = [...groups[0]].sort();
const published = publishedPackages().map(({ name }) => name);
const missing = published.filter((name) => !fixed.includes(name));
const extra = fixed.filter((name) => !published.includes(name));
if (missing.length > 0 || extra.length > 0) {
	const clauses = [
		...missing
			.map(() => ` missing from the fixed group: ${missing.join(", ")}.`)
			.slice(0, 1),
		...extra
			.map(
				() =>
					` in the fixed group but not published in the workspace: ${extra.join(", ")}.`,
			)
			.slice(0, 1),
	];
	console.error(
		`error[check-fixed-group]:${clauses.join("")} Next: make .changeset/config.json's fixed group equal the published package set.`,
	);
	process.exit(1);
}
console.log(
	`check-fixed-group: ok -- ${published.length} published packages, fixed group matches exactly`,
);
