#!/usr/bin/env bash
# #86 pack-install smoke: packs the three published packages
# (@hejbro/core, hejbro, @hejbro/supabase), installs the tarballs into a
# scratch project with plain `npm install` (no workspace, no pnpm — the
# closest simulation of a real consumer), and runs init/generate/verify
# there. Workspace-linked tests never exercise the packed `package.json`,
# so this is the only check that would catch `workspace:*` reaching a
# consumer, a missing `bin`, or a broken `exports`.
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
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_DIR="$(mktemp -d)"
SCRATCH_DIR="$(mktemp -d)"

cleanup() { rm -rf "$PACK_DIR" "$SCRATCH_DIR"; }
trap cleanup EXIT

# name:directory pairs for the three published packages.
PACKAGES=(
  "@hejbro/core:packages/core"
  "hejbro:packages/cli"
  "@hejbro/supabase:packages/supabase"
)

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
# package's own name/version, not the workspace path).
CORE_TGZ="$(ls "$PACK_DIR"/hejbro-core-*.tgz)"
CLI_TGZ="$(ls "$PACK_DIR"/hejbro-[0-9]*.tgz)"
SUPABASE_TGZ="$(ls "$PACK_DIR"/hejbro-supabase-*.tgz)"

echo "== scratch project: $SCRATCH_DIR"
cat > "$SCRATCH_DIR/package.json" <<EOF
{
  "name": "hejbro-pack-install-smoke-consumer",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@hejbro/core": "file:$CORE_TGZ",
    "hejbro": "file:$CLI_TGZ",
    "@hejbro/supabase": "file:$SUPABASE_TGZ"
  }
}
EOF

echo "== npm install (plain npm — no pnpm, no workspace lookup: SCRATCH_DIR is outside the repo tree)"
(cd "$SCRATCH_DIR" && npm install --no-audit --no-fund >/dev/null)

fail() { echo "FAILED: $1" >&2; exit 1; }

echo "== assertion 1a: each tarball packs its required files (dist, LICENSE, README, and package.json)"
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
assert_tarball_contains "$CORE_TGZ" package.json LICENSE README.md dist/index.js dist/index.d.ts
assert_tarball_contains "$CLI_TGZ" package.json LICENSE README.md dist/cli.js dist/index.js
assert_tarball_contains "$SUPABASE_TGZ" package.json LICENSE README.md dist/index.js dist/index.d.ts
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
echo "   ok"

echo "== assertion 1c: the installed LICENSE is real content, not a broken link"
# Existence alone would let a symlink that survived packing but doesn't
# resolve in the install tree pass silently — read the text instead.
assert_license_content() {
  install_dir="$1"
  license_file="$install_dir/LICENSE"
  [ -s "$license_file" ] || fail "$license_file is missing or empty"
  grep -q "MIT License" "$license_file" || fail "$license_file does not contain the expected MIT License text"
}
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/core"
assert_license_content "$SCRATCH_DIR/node_modules/hejbro"
assert_license_content "$SCRATCH_DIR/node_modules/@hejbro/supabase"
echo "   ok"

echo "== assertion 2: no installed dependency string still says workspace:"
assert_no_workspace_protocol() {
  pkg_json="$1"
  grep -q '"workspace:' "$pkg_json" && fail "$pkg_json still declares a workspace: dependency"
  return 0
}
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/hejbro/package.json"
assert_no_workspace_protocol "$SCRATCH_DIR/node_modules/@hejbro/supabase/package.json"
echo "   ok"

echo "== assertion 3: the hejbro binary runs init/generate/verify against a real declaration"
BIN="$SCRATCH_DIR/node_modules/.bin/hejbro"
[ -x "$BIN" ] || fail "no executable hejbro bin at $BIN"

mkdir -p "$SCRATCH_DIR/src"
cat > "$SCRATCH_DIR/src/app.schema.ts" <<'EOF'
import { schema, table, text, uuid } from "hejbro";

export const app = schema("app");

export const widgets = table(app, "widgets", {
	id: uuid().primaryKey().defaultRandom(),
	name: text().notNull(),
});
EOF

(cd "$SCRATCH_DIR" && "$BIN" init >/dev/null) || fail "hejbro init exited non-zero"
[ -f "$SCRATCH_DIR/hejbro.config.ts" ] || fail "hejbro init did not create hejbro.config.ts"
(cd "$SCRATCH_DIR" && "$BIN" generate >/dev/null) || fail "hejbro generate exited non-zero"
GENERATED_COUNT="$(find "$SCRATCH_DIR/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
[ "$GENERATED_COUNT" -eq 1 ] || fail "hejbro generate produced $GENERATED_COUNT migrations (expected 1)"
(cd "$SCRATCH_DIR" && "$BIN" verify >/dev/null) || fail "hejbro verify exited non-zero on its own output"
echo "   ok"

echo "pack-install smoke OK: @hejbro/core, hejbro, @hejbro/supabase install cleanly with npm and run init/generate/verify"
