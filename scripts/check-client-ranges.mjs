#!/usr/bin/env node
// #491: the third-party client libraries a published package wraps (`pg`,
// `@neondatabase/serverless`) and their type packages are declared in
// more than one manifest -- a preset's peer range, the same preset's dev
// range, the skills package's snippet-compilation range. Those ranges
// live once, in pnpm-workspace.yaml's `catalog:`, and every manifest
// spells `catalog:` for them; this script refuses a manifest that spells
// a range of its own, which is the only way the ranges can drift while
// every gate stays green. Measured before adopting the catalog: `pnpm
// pack` writes the resolved range into the published manifest for peer
// and dev entries alike (pnpm 10.19, @hejbro/pg and @hejbro/neon).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_PACKAGES = ["pg", "@types/pg", "@neondatabase/serverless"];
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

const catalogNames = () => {
	const workspace = readFileSync(
		join(REPO_ROOT, "pnpm-workspace.yaml"),
		"utf8",
	);
	const catalogSection = workspace.split(/^catalog:\s*$/m)[1] ?? "";
	return new Set(
		catalogSection
			.split("\n")
			.filter((line) => /^\s+\S/.test(line))
			.map((line) => line.trim().split(":")[0].replace(/^"|"$/g, "")),
	);
};

const manifestPaths = () =>
	["packages", "examples"].flatMap((group) => {
		const groupDir = join(REPO_ROOT, group);
		if (!existsSync(groupDir)) {
			return [];
		}
		return readdirSync(groupDir)
			.map((name) => join(groupDir, name, "package.json"))
			.filter((path) => existsSync(path));
	});

const problemsIn = (manifestPath, catalog) => {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const location = manifestPath.slice(REPO_ROOT.length + 1);
	return DEPENDENCY_FIELDS.flatMap((field) =>
		Object.entries(manifest[field] ?? {})
			.filter(([name]) => CLIENT_PACKAGES.includes(name))
			.flatMap(([name, range]) => {
				if (range !== "catalog:") {
					return [
						`${location}: ${field}.${name} is "${range}" -- spell it "catalog:" and keep the range in pnpm-workspace.yaml`,
					];
				}
				if (!catalog.has(name)) {
					return [
						`${location}: ${field}.${name} points at the catalog, but pnpm-workspace.yaml's catalog has no "${name}" entry`,
					];
				}
				return [];
			}),
	);
};

const catalog = catalogNames();
const problems = manifestPaths().flatMap((path) => problemsIn(path, catalog));
if (problems.length > 0) {
	console.error(
		`error[check-client-ranges]: ${problems.length} client range(s) declared outside the catalog:`,
	);
	for (const problem of problems) {
		console.error(`  ${problem}`);
	}
	console.error(
		"Next: set the range once under `catalog:` in pnpm-workspace.yaml and spell `catalog:` in every manifest that names the package.",
	);
	process.exit(1);
}
console.log(
	`check-client-ranges: ok -- ${CLIENT_PACKAGES.join(", ")} declared through the catalog everywhere`,
);
