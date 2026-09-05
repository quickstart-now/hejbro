#!/usr/bin/env node
// #652: the flag-less `changeset status` asks whether the repository holds
// a changeset covering the changed packages -- and with fifty unreleased
// changesets naming the fixed group, it always does. It never asks D59's
// question: does THIS pull request carry exactly one `.changeset/*.md`?
// This script does. It diffs the branch against its base (merge-base, so a
// stale branch is not blamed for dev's own changes): when any file under a
// published package's `src/` changed, exactly one changeset file must be
// added by the same diff; otherwise at most one (an explicit empty record
// is allowed, a second one is a mistake either way). The published set is
// read from the workspace, never listed here, so a new package joins the
// rule the day it drops `private`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_REF = process.argv[2] ?? "dev";

const git = (...args) =>
	execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();

const publishedPackageDirs = () =>
	readdirSync(join(REPO_ROOT, "packages"))
		.map((name) => ({
			name,
			manifest: join(REPO_ROOT, "packages", name, "package.json"),
		}))
		.filter(({ manifest }) => existsSync(manifest))
		.filter(
			({ manifest }) =>
				JSON.parse(readFileSync(manifest, "utf8")).private !== true,
		)
		.map(({ name }) => `packages/${name}/src/`);

const changedFiles = (range, ...extra) =>
	git("diff", "--name-only", ...extra, range)
		.split("\n")
		.filter((line) => line !== "");

const range = `${BASE_REF}...HEAD`;
const publishedSrc = publishedPackageDirs();
const changed = changedFiles(range);
const touchesPublishedSrc = changed.filter((file) =>
	publishedSrc.some((dir) => file.startsWith(dir)),
);
const addedChangesets = changedFiles(range, "--diff-filter=A").filter(
	(file) =>
		file.startsWith(".changeset/") &&
		file.endsWith(".md") &&
		!file.endsWith("README.md"),
);

const foldRemedy = (added) => {
	if (added > 1) {
		return ", and fold the extra changesets into one";
	}
	return "";
};

const fail = (message) => {
	console.error(`error[check-pr-changeset]: ${message}`);
	process.exit(1);
};

if (touchesPublishedSrc.length > 0 && addedChangesets.length !== 1) {
	const fold = foldRemedy(addedChangesets.length);
	fail(
		`this branch changes ${touchesPublishedSrc.length} file(s) under a published package's src/ (first: ${touchesPublishedSrc[0]}) but adds ${addedChangesets.length} changeset file(s); D59 requires exactly one. Next: run \`pnpm changeset\` (minor for a capability, patch for a fix) and commit the .changeset/*.md it writes${fold}.`,
	);
}
if (touchesPublishedSrc.length === 0 && addedChangesets.length > 1) {
	fail(
		`this branch changes no published src/ but adds ${addedChangesets.length} changeset files (${addedChangesets.join(", ")}); at most one is meaningful. Next: keep one (or none) and delete the rest.`,
	);
}
console.log(
	`check-pr-changeset: ok -- ${touchesPublishedSrc.length} published src file(s) changed against ${BASE_REF}, ${addedChangesets.length} changeset file(s) added`,
);
