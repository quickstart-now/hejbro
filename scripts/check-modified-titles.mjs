#!/usr/bin/env node
// #510: `openspec validate --strict` never reads the base spec's own
// requirement titles, so a MODIFIED (or RENAMED-from, or REMOVED) heading
// that misspells the requirement it claims to replace validates clean and
// archives as a brand-new requirement beside the old one (measured on
// openspec 1.11.0: a `...databaseXX` typo in a MODIFIED title still prints
// "is valid", exit 0). This walks every active change's delta specs and
// holds each such title to an exact `### Requirement: <title>` line in
// `openspec/specs/<capability>/spec.md`; an ADDED title that already
// exists there is the mirror mistake and is refused too. Exit 1 lists
// every miss with its file; nothing else is checked here (validate --strict
// still owns scenario completeness and RFC 2119 wording).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const CHANGES_DIR = join(ROOT, "openspec", "changes");
const SPECS_DIR = join(ROOT, "openspec", "specs");

const REQUIREMENT_PREFIX = "### Requirement: ";
const SECTION_PREFIX = "## ";
const RENAMED_FROM_PREFIX = "- FROM: ### Requirement: ";

const activeChangeDirs = () => {
	if (!existsSync(CHANGES_DIR)) {
		return [];
	}
	return readdirSync(CHANGES_DIR)
		.filter((name) => name !== "archive")
		.map((name) => join(CHANGES_DIR, name))
		.filter((dir) => statSync(dir).isDirectory());
};

const deltaSpecFiles = (changeDir) => {
	const specsDir = join(changeDir, "specs");
	if (!existsSync(specsDir)) {
		return [];
	}
	return readdirSync(specsDir)
		.map((capability) => ({
			capability,
			file: join(specsDir, capability, "spec.md"),
		}))
		.filter(({ file }) => existsSync(file));
};

const baseTitles = (capability) => {
	const file = join(SPECS_DIR, capability, "spec.md");
	if (!existsSync(file)) {
		return null;
	}
	return new Set(
		readFileSync(file, "utf8")
			.split("\n")
			.filter((line) => line.startsWith(REQUIREMENT_PREFIX))
			.map((line) => line.slice(REQUIREMENT_PREFIX.length).trim()),
	);
};

// One entry per title the delta declares, tagged with the section it sits
// under: `modified`/`removed`/`renamed-from` must exist in the base,
// `added` must not. A `## RENAMED` block lists `- FROM:`/`- TO:` pairs;
// only the FROM half names a base title.
const declaredTitles = (deltaText) =>
	deltaText.split("\n").reduce(
		(state, line) => {
			if (line.startsWith(SECTION_PREFIX)) {
				const heading = line.slice(SECTION_PREFIX.length).trim().toLowerCase();
				return { ...state, section: heading.split(" ")[0] };
			}
			if (state.section === "renamed" && line.startsWith(RENAMED_FROM_PREFIX)) {
				const title = line.slice(RENAMED_FROM_PREFIX.length).trim();
				return { ...state, entries: [...state.entries, { section: "renamed-from", title }] };
			}
			if (line.startsWith(REQUIREMENT_PREFIX) && state.section !== "renamed") {
				const title = line.slice(REQUIREMENT_PREFIX.length).trim();
				return { ...state, entries: [...state.entries, { section: state.section, title }] };
			}
			return state;
		},
		{ section: "", entries: [] },
	).entries;

const problemsFor = (changeDir) =>
	deltaSpecFiles(changeDir).flatMap(({ capability, file }) => {
		const base = baseTitles(capability);
		const location = relative(ROOT, file);
		return declaredTitles(readFileSync(file, "utf8")).flatMap(({ section, title }) => {
			const mustExist = section === "modified" || section === "removed" || section === "renamed-from";
			if (mustExist && (base === null || !base.has(title))) {
				return [`${location}: ${section.toUpperCase()} title not found verbatim in openspec/specs/${capability}/spec.md: "${title}"`];
			}
			if (section === "added" && base !== null && base.has(title)) {
				return [`${location}: ADDED title already exists in openspec/specs/${capability}/spec.md (use MODIFIED): "${title}"`];
			}
			return [];
		});
	});

const changeDirs = activeChangeDirs();
const problems = changeDirs.flatMap(problemsFor);
if (problems.length > 0) {
	console.error(`error[check-modified-titles]: ${problems.length} delta title(s) do not match the base spec:`);
	for (const problem of problems) {
		console.error(`  ${problem}`);
	}
	console.error("Next: spell each MODIFIED/REMOVED/RENAMED-from title exactly as the base spec's `### Requirement:` line, and move an ADDED requirement that already exists to MODIFIED.");
	process.exit(1);
}
console.log(`check-modified-titles: ok -- ${changeDirs.length} active change(s), every delta title matches its base spec`);
