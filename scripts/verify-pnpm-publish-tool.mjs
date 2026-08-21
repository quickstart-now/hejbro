#!/usr/bin/env node
// #86's pack-install smoke (phase8-packaging) proves a *pnpm-packed* tarball
// installs cleanly with a plain `npm install`. It does not prove the real
// release actually packs with pnpm: `changeset publish` auto-detects the
// package manager per workspace (D59/D63) and only resolves the
// `workspace:*` protocol (see packages/cli and packages/supabase's
// `dependencies`) when it picks pnpm. If that detection ever silently
// resolved to "npm" instead, this smoke would stay green -- it never
// exercises detection -- while the real published tarball still carried a
// literal `workspace:*` string, which `npm install` rejects with
// EUNSUPPORTEDPROTOCOL (npm burns the version number even if the broken
// package is unpublished afterward).
//
// So this script asserts on the actual decision @changesets/cli makes,
// rather than re-implementing a guess at it: `changeset publish`'s
// `getPublishTool()` (packages/@changesets/cli/src/commands/publish/
// getPublishTool.ts, compiled into dist/getPublishPlan.mjs) picks the pnpm
// publish path when `packages.tool.type === "pnpm"`, where `packages` comes
// from `@manypkg/get-packages` -- the exact same dependency, called the same
// way, is used below. `@manypkg/get-packages` detects "pnpm" from
// `pnpm-workspace.yaml` (via `@manypkg/tools`), so this also guards against
// that file ever going missing or misplaced.
import { getPackages } from "@manypkg/get-packages";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const { tool } = await getPackages(REPO_ROOT);

if (tool.type !== "pnpm") {
	console.error(
		`error[publish-tool-mismatch]: @changesets/cli would detect "${tool.type}" as this workspace's package manager, not "pnpm" -- \`changeset publish\` would then shell out to \`${tool.type} publish\`, which does not resolve pnpm's \`workspace:\` protocol and would ship a broken tarball.`,
	);
	console.error(
		"  Next: confirm pnpm-workspace.yaml is present and committed at the repository root -- @manypkg/get-packages detects the tool from it.",
	);
	process.exit(1);
}

console.log(
	'verify-pnpm-publish-tool: ok -- @changesets/cli will use "pnpm publish" for this workspace (detected via the same @manypkg/get-packages call getPublishTool() itself makes)',
);
