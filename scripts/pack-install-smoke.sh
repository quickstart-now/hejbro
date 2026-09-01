#!/usr/bin/env bash
# #86 pack-install smoke: packs the seven published packages
# (@hejbro/core, hejbro, @hejbro/supabase, @hejbro/query, @hejbro/pg,
# @hejbro/neon -- @hejbro/query/@hejbro/pg promoted here in task 7.10
# once 7.6/7.7 gave them real dist packaging; @hejbro/neon added in
# add-neon-preset's task 8.2; @hejbro/nile added in add-nile-preset's
# task 1.3, the seventh-package tripwire #484/#553 named), installs the
# tarballs into a scratch project
# with plain `npm install` (no workspace, no pnpm — the closest
# simulation of a real consumer), and runs init/generate/verify there,
# with the Supabase preset registered so more than just hejbro actually
# gets loaded (assertion 3). Workspace-linked tests never exercise the
# packed `package.json`, so this is the only check exercising what a real
# install actually produces.
#
# What this catches, precisely (measured during review, M4-M6): a
# missing package-level file, a missing `bin`, and a broken `exports` in
# any of the packages assertions 1a-1c cover — plus a `workspace:` string
# left in a `devDependencies` entry. A `workspace:` in
# `dependencies`/`peer`/`optionalDependencies` is actually caught
# earlier, by `npm install` itself refusing with `EUNSUPPORTEDPROTOCOL`
# (see below) — assertion 2 is the narrower guard for the
# `devDependencies` case npm's own install doesn't resolve for us.
#
# Packing uses `pnpm pack`, not `npm pack`: the release path is
# `changeset publish` (D59/D63), which detects this is a pnpm workspace
# and runs `pnpm publish` under the hood — the tarball a real user
# installs is one `pnpm` produced. `npm pack` does not understand pnpm's
# `workspace:` protocol and leaves it in the tarball verbatim; installing
# such a tarball with `npm install` fails immediately with
# `EUNSUPPORTEDPROTOCOL` (reproduced once while developing this script —
# not a hypothetical). Testing that path here would be grading an
# artifact we never ship, and "fixing" it would mean dropping the
# `workspace:` protocol or rewriting dependency strings in `prepack`,
# both against D59's direction (which keeps `workspace:*` on the
# assumption pnpm resolves it at publish time).
#
# That leaves a real gap this script cannot close: it proves "a tarball
# pnpm produces installs cleanly", not "the release actually runs
# pnpm". `changeset publish`'s pnpm detection is automatic — if it stops
# detecting, or a later workflow change swaps in `npm publish`, this
# script stays green while the real release ships the broken
# `EUNSUPPORTEDPROTOCOL` tarball above (and npm burns the version number
# even if it's unpublished afterward). `phase8-release-workflows` is
# where that gap gets closed, by confirming at publish time which tool
# actually packed.
#
# Assertions 2 and 3 (workspace: absence, bin/CLI behavior) already pass
# today on the pnpm-packed tarball — they are regression guards, not a
# defect this PR fixes. What IS red before this PR is assertion 1a: the
# `hejbro` tarball packs no README.md (packages/core and
# packages/supabase already carry one; packages/cli did not).
#
# CI: this script runs on one matrix leg in ci.yml, after `pnpm build` —
# not just on release. Packaging can drift on any PR between here and
# the actual release workflow; a regression guard nobody runs until
# release time isn't a guard at release time, npm has already burned the
# version number.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_DIR="$(mktemp -d)"
SCRATCH_DIR="$(mktemp -d)"

cleanup() { rm -rf "$PACK_DIR" "$SCRATCH_DIR"; }
trap cleanup EXIT

# name:directory pairs for every published package, derived from the
# workspace (#484 -- the risk was demonstrated with a planted
# counterfactual during the neon review, not suffered). Derivation
# covers the dist check and the packing loop below; the install
# dependencies and the per-package assertion blocks further down are
# still hand-enumerated -- the dependency-count guard after the scratch
# install keeps the biggest gap (a packed but never-installed package)
# from passing silently.
PACKAGES=()
while IFS= read -r pair; do PACKAGES+=("$pair"); done < <(
  node -e 'import(process.argv[1]).then(m => console.log(m.publishedPackages().map(p => p.name + ":" + p.dir).join("\n")))' "$REPO_ROOT/scripts/workspace-packages.mjs"
)
[ "${#PACKAGES[@]}" -gt 0 ] || { echo "error[pack-install-smoke]: derived package list is empty -- workspace-packages.mjs failed" >&2; exit 2; }

for entry in "${PACKAGES[@]}"; do
  dir="${entry#*:}"
  [ -d "$REPO_ROOT/$dir/dist" ] || { echo "build first: pnpm build ($dir/dist is missing)" >&2; exit 2; }
done

echo "== packing (pnpm pack)"
for entry in "${PACKAGES[@]}"; do
  dir="${entry#*:}"
  (cd "$REPO_ROOT/$dir" && pnpm pack --pack-destination "$PACK_DIR" >/dev/null)
done
ls "$PACK_DIR"

# Resolve each tarball's actual filename (pnpm names it from the
# package's own name/version, not the workspace path). `hejbro-pg-*`
# and `hejbro-query-*` are matched before the bare `hejbro-[0-9]*`
# pattern could ever collide with them (neither starts with a digit
# right after `hejbro-`).
CORE_TGZ="$(ls "$PACK_DIR"/hejbro-core-*.tgz)"
CLI_TGZ="$(ls "$PACK_DIR"/hejbro-[0-9]*.tgz)"
SUPABASE_TGZ="$(ls "$PACK_DIR"/hejbro-supabase-*.tgz)"
QUERY_TGZ="$(ls "$PACK_DIR"/hejbro-query-*.tgz)"
PG_TGZ="$(ls "$PACK_DIR"/hejbro-pg-*.tgz)"
NEON_TGZ="$(ls "$PACK_DIR"/hejbro-neon-*.tgz)"
NILE_TGZ="$(ls "$PACK_DIR"/hejbro-nile-*.tgz)"

echo "== scratch project: $SCRATCH_DIR"
cat > "$SCRATCH_DIR/package.json" <<EOF
{
  "name": "hejbro-pack-install-smoke-consumer",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@hejbro/core": "file:$CORE_TGZ",
    "hejbro": "file:$CLI_TGZ",
    "@hejbro/supabase": "file:$SUPABASE_TGZ",
    "@hejbro/query": "file:$QUERY_TGZ",
    "@hejbro/pg": "file:$PG_TGZ",
    "@hejbro/neon": "file:$NEON_TGZ",
    "@hejbro/nile": "file:$NILE_TGZ"
  }
}
EOF

# #484 follow-through: the dependencies object above is hand-enumerated
# while PACKAGES is derived, so a seventh published package would pack
# but never install -- and every assertion below would silently skip it.
# This count guard turns that silence into a failure at the seam.
DEP_COUNT="$(node -p "Object.keys(require('$SCRATCH_DIR/package.json').dependencies).length")"
if [ "$DEP_COUNT" -ne "${#PACKAGES[@]}" ]; then
  echo "error[pack-install-smoke]: scratch dependencies list ${DEP_COUNT} packages but the workspace publishes ${#PACKAGES[@]}. Next: add the missing package to the scratch dependencies and to each assertion block below." >&2
  exit 2
fi

# @hejbro/pg declares `pg` as a peerDependency; npm 7+ auto-installs an
# unmet peer, so this install resolves `pg@8.23.0` (and its transitive
# deps -- @hejbro/pg -> pg -> pg-pool@3.14.0 -> pg, deduped) from the
# registry/cache rather than from the local tarballs alone. Measured
# with this script's own five tarballs: `npm install` here adds 25
# packages (a narrower repro packing only core/query/pg tarballs added
# 17 -- cited only to show the count is sensitive to which tarballs are
# in the scratch project, not as this script's own figure).
# Accepted deliberately, not overlooked: real-consumer fidelity is this
# script's whole purpose (its own header above), and a real consumer's
# `npm install` fetches this exact same peer the exact same way --
# sealing it off here would make the smoke verify a different install
# than the one that ships. Air-gapped CI is not a current constraint
# (GitHub Actions has registry access); if that changes, switch to a
# vendored `pg` tarball instead of silently tolerating a new failure
# mode here.
echo "== npm install (plain npm — no pnpm, no workspace lookup: SCRATCH_DIR is outside the repo tree)"
(cd "$SCRATCH_DIR" && npm install --no-audit --no-fund >/dev/null)

fail() { echo "FAILED: $1" >&2; exit 1; }

echo "== assertion 1a: each tarball packs its required files (dist, LICENSE, NOTICE, README, and package.json)"
# `<<<` (here-string), not a `|` pipe: the while loop stays in the current
# shell, so `fail`'s `exit 1` aborts the whole script instead of just a
# pipeline subshell.
assert_tarball_contains() {
  tgz="$1"
  shift
  packed="$(tar -tzf "$tgz" | sed 's#^package/##')"
  for rel in "$@"; do
    grep -qxF "$rel" <<< "$packed" || fail "$tgz does not pack '$rel'"
  done
}
assert_tarball_contains "$CORE_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$CLI_TGZ" package.json LICENSE NOTICE README.md dist/cli.js dist/cli.d.ts dist/index.js
assert_tarball_contains "$SUPABASE_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$QUERY_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$PG_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$NEON_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$NILE_TGZ" package.json LICENSE NOTICE README.md dist/index.js dist/index.d.ts
echo "   ok"

echo "== assertion 1b: every file the tarball packed exists in the install tree"
assert_tarball_files_installed() {
  tgz="$1"
  install_dir="$2"
  entries="$(tar -tzf "$tgz")"
  while IFS= read -r line; do
    rel="${line#package/}"
    [ -z "$rel" ] && continue
    [ -e "$install_dir/$rel" ] || fail "$tgz packed '$rel' but it is missing from $install_dir"
  done <<< "$entries"
}
assert_tarball_files_installed "$CORE_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/core"
assert_tarball_files_installed "$CLI_TGZ" "$SCRATCH_DIR/node_modules/hejbro"
assert_tarball_files_installed "$SUPABASE_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/supabase"
assert_tarball_files_installed "$QUERY_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/query"
assert_tarball_files_installed "$PG_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/pg"
assert_tarball_files_installed "$NEON_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/neon"
assert_tarball_files_installed "$NILE_TGZ" "$SCRATCH_DIR/node_modules/@hejbro/nile"
echo "   ok"

echo "== assertion 1c: the installed LICENSE is real content, not a broken link"
# Existence alone would let a symlink that survived packing but doesn't
# resolve in the install tree pass silently — read the text instead.
assert_license_content() {
  install_dir="$1"
  license_file="$install_dir/LICENSE"
  [ -s "$license_file" ] || fail "$license_file is missing or empty"
  grep -q "Apache License" "$license_file" || fail "$license_file does not contain the expected Apache License text"
  notice_file="$install_dir/NOTICE"
  [ -s "$notice_file" ] || fail "$notice_file is missing or empty (Apache-2.0 section 4(d) obligation travels with the tarball)"
}
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/core"
assert_license_content "$SCRATCH_DIR/node_modules/hejbro"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/supabase"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/query"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/pg"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/neon"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/nile"
echo "   ok"

echo "== assertion 2: no installed dependency string still says workspace:"
assert_no_workspace_protocol() {
  pkg_json="$1"
  grep -q '"workspace:' "$pkg_json" && fail "$pkg_json still declares a workspace: dependency"
  return 0
}
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/hejbro/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/supabase/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/query/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/pg/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/neon/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/nile/package.json"
echo "   ok"

echo "== assertion 3: the hejbro binary runs init/generate/verify, with @hejbro/supabase's preset registered so more than just hejbro actually loads (hejbro's own dist re-exports @hejbro/core and @hejbro/query, and the registered preset loads @hejbro/supabase directly)"
BIN="$SCRATCH_DIR/node_modules/.bin/hejbro"
[ -x "$BIN" ] || fail "no executable hejbro bin at $BIN"

mkdir -p "$SCRATCH_DIR/src"
# RLS is declared (not because the Supabase preset's exposed-table
# validator would otherwise fire — it only warns when a schema carries an
# explicit anon/authenticated grant, which this declaration doesn't have
# — but because it's free coverage: it exercises hejbro's own `rls`/`eq`
# re-exports on the same path assertion 3 already runs).
cat > "$SCRATCH_DIR/src/app.schema.ts" <<'EOF'
import { eq, rls, schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(
	app,
	"widgets",
	{
		id: uuid().primaryKey().defaultRandom(),
		name: text().notNull(),
	},
	(t) => ({
		rls: rls.enabled({
			read: rls.policy("widgets_read").for("select").to("anon").using(eq(t.id, t.id)),
		}),
	}),
);
EOF

(cd "$SCRATCH_DIR" && "$BIN" init >/dev/null) || fail "hejbro init exited non-zero"
[ -f "$SCRATCH_DIR/hejbro.config.ts" ] || fail "hejbro init did not create hejbro.config.ts"

# Overwrite init's default config to register the Supabase preset. Without
# this, @hejbro/supabase is installed but never imported by anything this
# script runs — a broken `exports` or missing entry point there would pass
# unnoticed (M6 in review: reviewer broke supabase's exports and every
# assertion below still stayed green). Registering the preset forces
# module resolution of @hejbro/supabase, exercises the D55 preset
# registration path, and exercises hejbro's own `defineConfig` re-export,
# all in one file.
#
# What a broken @hejbro/supabase entry actually produces here: `hejbro
# generate` crashes with a secondary `TypeError` from the CLI's own
# diagnostic formatting (`asHejbroError`'s duck-typing wrongly treats
# Node's ERR_MODULE_NOT_FOUND as a HejbroError — #125/phase8-loader-
# diagnostics, not this PR's job to fix), so the crash text alone doesn't
# name the package. Confirmed independently, outside this script, that
# the underlying error is exactly what's expected: `node -e
# "import('@hejbro/supabase')"` against the same broken tarball reports
# `ERR_MODULE_NOT_FOUND: Cannot find module
# '.../node_modules/@hejbro/supabase/dist/nonexistent.js'` — i.e. the
# failure this assertion catches is @hejbro/supabase's own entry point,
# not an unrelated crash. This mutation (a broken preset package import)
# doubles as a ready-made phase8-loader-diagnostics test case: today it
# crashes, and that PR should turn it into a clean diagnostic instead.
cat > "$SCRATCH_DIR/hejbro.config.ts" <<'EOF'
import { defineConfig } from "hejbro";
import { supabasePreset } from "@hejbro/supabase";

export default defineConfig({
	entry: ["src/**/*.schema.ts"],
	migrationsDir: "migrations",
	snapshotPath: "hejbro.snapshot.json",
	prefixStrategy: "timestamp",
	presets: [supabasePreset],
});
EOF

(cd "$SCRATCH_DIR" && "$BIN" generate >/dev/null) || fail "hejbro generate exited non-zero"
GENERATED_COUNT="$(find "$SCRATCH_DIR/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
[ "$GENERATED_COUNT" -eq 1 ] || fail "hejbro generate produced $GENERATED_COUNT migrations (expected 1)"
(cd "$SCRATCH_DIR" && "$BIN" verify >/dev/null) || fail "hejbro verify exited non-zero on its own output"
echo "   ok"

echo "== assertion 4: @hejbro/neon's own exports resolve -- installed-but-unimported is the M6 gap (a broken exports field would otherwise pass every assertion above silently, same as the reviewer-broke-supabase-exports finding assertion 3's own comment records). @hejbro/neon ships no Preset bundle to register (no kinds, no validators; proposal.md's Out of scope) -- an empty bundle would be surface invented only to satisfy this gate, so a direct import of a real exported value is the equivalent check instead"
(cd "$SCRATCH_DIR" && node --input-type=module -e "
import { neonAuth } from '@hejbro/neon';
if (typeof neonAuth !== 'function') {
  throw new Error('@hejbro/neon exported neonAuth is not a function: ' + typeof neonAuth);
}
") || fail "@hejbro/neon's own exports did not resolve (neonAuth import failed)"
echo "   ok"

echo "== assertion 5: @hejbro/nile's preset is REGISTERED, not merely imported -- generate loads it through its own config, so a broken entry point fails here specifically (task 1.4, #563). Unlike @hejbro/neon (assertion 4), @hejbro/nile ships a real Preset bundle to register (proposal.md: not out of scope) -- a bare value import would be a weaker check than what this package actually offers, so this mirrors assertion 3's registration shape instead. A dedicated schema file, entry glob, migrations dir, and snapshot path (never app.schema.ts/migrations/hejbro.snapshot.json, assertion 3's own) keep this independent of assertion 3 and of whatever group 4 later teaches the preset's validators to refuse -- a tenant-aware table with a composite (id, tenant_id) primary key and no RLS/function/trigger/grant declaration stays valid regardless (the fifth validator added after G5's own live-witness measurement refuses a lone id primary key on a tenant-aware table, so this fixture's own primary key had to become composite)"
cat > "$SCRATCH_DIR/src/nile.schema.ts" <<'EOF'
import { schema, table, text, uuid } from "hejbro";

export const nileApp = schema("nile_app");

export const items = table(nileApp, "items", {
	id: uuid().primaryKey().defaultRandom(),
	tenant_id: uuid().primaryKey(),
	name: text().notNull(),
});
EOF

cat > "$SCRATCH_DIR/hejbro.config.ts" <<'EOF'
import { defineConfig } from "hejbro";
import { nilePreset } from "@hejbro/nile";

export default defineConfig({
	entry: ["src/nile.schema.ts"],
	migrationsDir: "nile-migrations",
	snapshotPath: "hejbro.nile-snapshot.json",
	prefixStrategy: "timestamp",
	presets: [nilePreset],
});
EOF

# `hejbro init` always scaffolds the *standard* config/paths (its own
# hardcoded content) -- rerunning it here would overwrite the custom
# config just written. The empty-snapshot/migrations-dir half of what
# `init` does is recreated directly instead, at this config's own paths.
mkdir -p "$SCRATCH_DIR/nile-migrations"
(cd "$SCRATCH_DIR" && node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { emptySnapshot, renderSnapshot } from '@hejbro/core';
writeFileSync('hejbro.nile-snapshot.json', renderSnapshot(emptySnapshot));
") || fail "could not seed hejbro.nile-snapshot.json (an empty snapshot) before the nile-preset generate run"

(cd "$SCRATCH_DIR" && "$BIN" generate >/dev/null) || fail "hejbro generate exited non-zero with @hejbro/nile's preset registered"
NILE_GENERATED_COUNT="$(find "$SCRATCH_DIR/nile-migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
[ "$NILE_GENERATED_COUNT" -eq 1 ] || fail "hejbro generate produced $NILE_GENERATED_COUNT migrations with @hejbro/nile's preset registered (expected 1)"
(cd "$SCRATCH_DIR" && "$BIN" verify >/dev/null) || fail "hejbro verify exited non-zero on the nile-preset output"
# The registration checks above prove @hejbro/nile's preset (kinds/
# validators) is reachable through the installed exports map -- this line
# proves nileDriver/asTenant are too, through the exports map specifically
# (F1 recurrence, #553): a workspace alias in driver.test.ts/context.test.ts
# resolving "../src/driver"/"../src/context" directly would never catch a
# broken/narrowed "exports" field the way importing through the installed
# package's own resolution here does (mirrors assertion 4's own node -e
# form, applied to two names instead of one).
(cd "$SCRATCH_DIR" && node --input-type=module -e "
import { nileDriver, asTenant } from '@hejbro/nile';
if (typeof nileDriver !== 'function') {
  throw new Error('@hejbro/nile exported nileDriver is not a function: ' + typeof nileDriver);
}
if (typeof asTenant !== 'function') {
  throw new Error('@hejbro/nile exported asTenant is not a function: ' + typeof asTenant);
}
") || fail "@hejbro/nile's own nileDriver/asTenant exports did not resolve through the installed package"
echo "   ok"

echo "== assertion 6: link/vendor/vendor --check/outdated (add-polyrepo-sync, #314) are reachable through the installed hejbro binary, entirely without a database or network -- none of these four commands needs either to report a coded failure, so this is the database-free reachability check #601 asks for rather than a full vendoring round trip (that needs a real git remote, covered by R2-G9's own integration suite instead)"
(cd "$SCRATCH_DIR" && "$BIN" link /no/such/schema-repo >/dev/null) || fail "hejbro link exited non-zero"
[ -f "$SCRATCH_DIR/hejbro.json" ] || fail "hejbro link did not create hejbro.json"

# `set -e` would otherwise abort the script the moment one of these two
# commands exits non-zero, which is exactly the outcome being asserted --
# capture the exit code explicitly instead of letting a `||`-guarded
# command substitution's own subshell swallow it.
set +e
CHECK_OUTPUT="$(cd "$SCRATCH_DIR" && "$BIN" vendor --check 2>&1)"
CHECK_EXIT=$?
OUTDATED_OUTPUT="$(cd "$SCRATCH_DIR" && "$BIN" outdated 2>&1)"
OUTDATED_EXIT=$?
set -e

[ "$CHECK_EXIT" -ne 0 ] || fail "hejbro vendor --check unexpectedly exited 0 with nothing vendored yet"
grep -q "vendor-not-yet-vendored" <<< "$CHECK_OUTPUT" || fail "hejbro vendor --check's own coded failure (vendor-not-yet-vendored) did not reach stderr through the installed binary: $CHECK_OUTPUT"
[ "$OUTDATED_EXIT" -ne 0 ] || fail "hejbro outdated unexpectedly exited 0 with nothing vendored yet"
grep -q "vendor-not-yet-vendored" <<< "$OUTDATED_OUTPUT" || fail "hejbro outdated's own coded failure (vendor-not-yet-vendored) did not reach stderr through the installed binary: $OUTDATED_OUTPUT"
echo "   ok"

echo "pack-install smoke OK: @hejbro/core, hejbro, @hejbro/supabase, @hejbro/query, @hejbro/pg, @hejbro/neon, @hejbro/nile install cleanly with npm and run init/generate/verify"
