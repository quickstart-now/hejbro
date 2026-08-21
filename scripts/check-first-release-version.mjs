#!/usr/bin/env node
// D60 guard: the first hejbro release is pinned at 0.1.0, not whatever an
// all-`patch` changeset set would silently produce (0.0.1) — changesets
// computes the next version from whatever `.changeset/*.md` files happen to
// be pending, and nothing else enforces D60's choice.
//
// Self-invalidating by construction: the check only means anything while
// all three published packages are still at their pre-release placeholder
// version (0.0.0). Once the real "Version Packages" PR merges and bumps
// them past that, the premise this check tests ("we are about to publish
// the first release") is false, so it skips instead of failing — no one
// has to remember to delete this once 0.1.0 ships.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_FIRST_VERSION = "0.1.0";

const PUBLISHED_PACKAGES = [
	{ name: "@hejbro/core", dir: "packages/core" },
	{ name: "hejbro", dir: "packages/cli" },
	{ name: "@hejbro/supabase", dir: "packages/supabase" },
];

const versionOf = (dir) =>
	JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"))
		.version;

const isPreFirstRelease = PUBLISHED_PACKAGES.every(
	({ dir }) => versionOf(dir) === "0.0.0",
);

if (!isPreFirstRelease) {
	console.log(
		"check-first-release-version: skipped — the first release has already happened (not all of @hejbro/core/hejbro/@hejbro/supabase are still at 0.0.0)",
	);
	process.exit(0);
}

const scratchDir = mkdtempSync(join(tmpdir(), "hejbro-changeset-status-"));
const statusPath = join(scratchDir, "status.json");
execFileSync("pnpm", ["changeset", "status", `--output=${statusPath}`], {
	cwd: REPO_ROOT,
	stdio: "ignore",
});
const status = JSON.parse(readFileSync(statusPath, "utf8"));
rmSync(scratchDir, { recursive: true, force: true });

const computedVersionFor = (release) => {
	if (release === undefined) {
		return "0.0.0 (no changeset covers it)";
	}
	return release.newVersion;
};

const problems = PUBLISHED_PACKAGES.flatMap(({ name }) => {
	const release = status.releases.find((entry) => entry.name === name);
	const computed = computedVersionFor(release);
	if (computed === EXPECTED_FIRST_VERSION) {
		return [];
	}
	return [`${name} -> ${computed}`];
});

if (problems.length > 0) {
	console.error(
		`error[first-release-version]: the pending changesets currently compute the first release to something other than ${EXPECTED_FIRST_VERSION}: ${problems.join(", ")}`,
	);
	console.error(
		"  D60 fixes the first hejbro release at 0.1.0 — an all-patch changeset set would silently publish 0.0.1 instead. Next: add a minor changeset (pnpm changeset) covering the published packages, or check whether an existing changeset was accidentally scoped as patch.",
	);
	process.exit(1);
}

console.log(
	`check-first-release-version: ok — pending changesets compute the first release at ${EXPECTED_FIRST_VERSION} for @hejbro/core, hejbro, and @hejbro/supabase`,
);
