#!/usr/bin/env bash
# Regenerates examples/{postgres,supabase}'s committed migration chains and
# snapshots from `src/steps/step-*.schema.ts`, by driving the *built* CLI
# (dist/cli.js) exactly the way a user would: `init` once, then `generate`
# once per step, copying each step's declarations into the live entry point
# (`src/app.schema.ts`) before every run. D33: core never hashes migrations,
# only the CLI does — so reproducing the committed banner hash lines
# requires actually running the CLI, not calling `generateMigration`
# in-process (that's what each example's `test/chain.test.ts` does,
# read-only, as a second, independent check on the same claim).
#
# Steps are enumerated from the directory (`find … | sort -V`), never
# hard-coded as "4 steps" — the chain grows in phase8-constraint-names and
# phase8-grant-sync, and a hard-coded count would silently regenerate fewer
# steps the moment a new one is added and this script isn't updated for it.
#
# The script also refuses to *shrink* a chain on its own: it records how
# many migrations were committed before wiping anything, and fails if
# regeneration produces fewer than that. The step history is append-only
# in practice, so fewer migrations after a run almost always means a step
# file was deleted or misnamed — this must be a loud failure of the
# script itself, not something that only shows up if someone happens to
# read `git status` afterward. Growing the chain is not blocked: the
# check compares `<`, so e.g. 5 step files against 4 committed migrations
# passes — phase8-constraint-names and phase8-grant-sync both add steps
# and will not trip it.
#
# The shrink check and the no-op-step check below it are complementary,
# not redundant: a deleted step keeps `steps == migrations` (both drop by
# one, so `regenerated < committed` fires but `regenerated != steps`
# wouldn't), and a no-op step (one whose declarations don't differ from
# the previous step, so `generate` writes nothing) keeps the migration
# count unchanged (so `regenerated != steps` fires but `regenerated <
# committed` wouldn't, since nothing actually shrank). Neither check sees
# the other's failure mode.
#
# The shrink check reads its baseline from `git ls-files`, not the
# working tree — deliberately, and re-derived once already the hard way.
# An earlier version counted the working tree via `find`, which the
# script's own `rm -rf` (below) then edits mid-run: on a real shrink, the
# first invocation correctly failed, but a second invocation (the first
# thing anyone tries after a failing script) counted the *already-
# shrunk* tree against itself and passed. `git ls-files` reads the
# index, which nothing in this script ever touches, so it can't be
# laundered by a retry. Generalizes: a guard must read its baseline from
# something it cannot itself change.
#
# Ambiguous drop+add pairs (e.g. a column renamed alongside an unrelated
# schema change, as the postgres/supabase chains' step 4 both are) are
# resolved generically: on an `ambiguous-column-rename` diagnostic, this
# script extracts the exact `--confirm-drop` rerun command the CLI's own
# diagnostic prints ("if these are unrelated changes, rerun: …") and
# reruns with it — never a hard-coded table/column name. A new step that
# introduces the same *kind* of single-pair ambiguity is handled
# automatically, the same way a human reads the diagnostic and reruns. A
# genuinely different failure (a real error, a multi-pair ambiguity whose
# suggested command has unfillable `<…>` placeholders, a table-rename
# ambiguity) is not something this script can safely resolve on its own —
# it stops and says so, rather than guessing.
#
# Where the "is this an ambiguity at all" line is drawn: only a `stderr`
# containing the literal diagnostic code prefix `error[ambiguous-column-
# rename]` (the CLI's own §7 grammar, not prose that changes casually)
# is ever treated as one; anything else — a real error, or a future
# reworded diagnostic that no longer matches — hard-stops with the raw
# CLI output printed, never silently proceeds without `--confirm-drop`.
# One real boundary worth naming: this script always resolves a
# single-pair ambiguity as a drop+add (`--confirm-drop`), never as a
# rename (`--rename`), because that's what every ambiguity in this
# chain actually is today. A future step that's a genuine rename would
# still match this path and get the wrong resolution silently — that
# case needs a human reading the regenerated migration's content, not
# this script. That is safe because the interpretation doesn't end
# here: a step with an ambiguity cannot be committed without also
# writing it into `test/chain.test.ts`'s `confirmedDropsForStep`
# (in-process, using `generateMigration` directly — not this script),
# and that test fails first if it's missing, with the CLI's own
# diagnostic offering *both* `--rename` and `--confirm-drop` side by
# side (verified: removing a `confirmedDropsForStep` entry reproduces
# exactly that "hejbro cannot tell whether this is a rename" failure).
# A genuine rename gets caught there, by a human reading the same
# diagnostic this script parses. This script's guess is a convenience;
# the decision is recorded by hand, in source, one gate later — not a
# reason to build a list of known-safe ambiguities here, which would
# just be the same information kept in two places, able to drift apart.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.js"
[ -f "$CLI" ] || { echo "build first: pnpm build ($CLI is missing)" >&2; exit 2; }

EXAMPLE_DIRS=("$REPO_ROOT/examples/postgres" "$REPO_ROOT/examples/supabase")

# Runs `hejbro generate` in $1; on an ambiguous-column-rename diagnostic
# whose suggested resolution is a single, directly-runnable
# `--confirm-drop` command, reruns with it. Anything else is a hard stop.
run_generate() {
  example_dir="$1"
  stderr_file="$(mktemp)"
  if (cd "$example_dir" && node "$CLI" generate >/dev/null 2>"$stderr_file"); then
    rm -f "$stderr_file"
    return 0
  fi

  stderr_output="$(cat "$stderr_file")"
  rm -f "$stderr_file"

  if ! grep -q '^error\[ambiguous-column-rename\]' <<< "$stderr_output"; then
    echo "$stderr_output" >&2
    echo "regen-examples.sh: generate failed in $example_dir for a reason this script doesn't resolve automatically — see the diagnostic above and update the script (or the step) once you've read it" >&2
    exit 1
  fi

  # The CLI prints the exact rerun command on its own line, e.g.:
  #   hejbro generate --confirm-drop app.tasks.due_at
  # A multi-pair ambiguity's example rerun is backslash-continued across
  # several lines instead (packages/cli/src/rename-diagnostics.ts,
  # buildColumnAmbiguityDiagnostic's multi-pair branch), so the single-
  # line grep below never matches it — confirm_drop_target comes back
  # empty on its own, verified in isolation against a synthetic
  # multi-pair stderr. The `grep -q 'placeholders'` alongside it is
  # belt-and-suspenders for that diagnostic's own "edit the <...>
  # placeholders" label, not the primary signal — scanning for a bare
  # `<` instead (an earlier version of this check did) would risk
  # hard-stopping an unrelated, perfectly resolvable single-pair case if
  # some future diagnostic happened to contain that character elsewhere.
  confirm_drop_target="$(grep -o 'hejbro generate --confirm-drop [^[:space:]]*' <<< "$stderr_output" | tail -1 | awk '{print $NF}')"
  if [ -z "$confirm_drop_target" ] || grep -q 'placeholders' <<< "$stderr_output"; then
    echo "$stderr_output" >&2
    echo "regen-examples.sh: ambiguous-column-rename didn't offer a single directly-runnable --confirm-drop command (likely a multi-pair ambiguity) — resolve it by hand and update this script" >&2
    exit 1
  fi

  echo "   ambiguous rename resolved: generate --confirm-drop $confirm_drop_target"
  (cd "$example_dir" && node "$CLI" generate --confirm-drop "$confirm_drop_target" >/dev/null)
}

# Rewrites $1 in place so its own `-- hejbro: <version>` banner line
# matches $2 exactly: $2 non-empty replaces (or inserts, directly below
# `-- hejbro migration`) the line; $2 empty strips any version line the
# regenerated file has. Pure `awk`, not `sed -i`, so this runs
# identically under macOS's BSD sed-less toolchain and Linux CI alike.
rewrite_banner_version_line() {
  file="$1"
  desired_line="$2"
  tmp="$(mktemp)"
  awk -v desired="$desired_line" '
    /^-- hejbro: / { next }
    {
      print
      if ($0 == "-- hejbro migration" && desired != "") {
        print desired
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# #229 landed *after* this script existed: driving the current CLI
# through every step (including old ones) means every regenerated file
# reflects *this build's* version, not whatever version it was actually
# committed under -- so running this script after any version bump
# would touch every already-committed migration's banner line, on its
# own, contradicting "existing steps are history, unchanged" (#229)
# merely by being re-run (measured, not assumed: confirmed empirically
# against this repo's own two example chains -- all 10 previously
# committed files gained a `+-- hejbro: 0.0.0` line with no code change
# of their own). This restores each pre-existing step's own version
# line to exactly what HEAD had (present or absent) by filename match;
# a brand new step (no HEAD blob under that name) is left exactly as
# generated -- getting the current version is what "new steps carry
# the line" means.
restore_committed_banner_versions() {
  example_dir="$1"
  example_rel="$2"
  git -C "$REPO_ROOT" ls-tree -r --name-only HEAD -- "$example_rel/migrations" 2>/dev/null |
    while IFS= read -r committed_path; do
      name="$(basename "$committed_path")"
      regenerated_path="$example_dir/migrations/$name"
      [ -f "$regenerated_path" ] || continue
      committed_version_line="$(git -C "$REPO_ROOT" show "HEAD:$committed_path" | grep '^-- hejbro: ' || true)"
      rewrite_banner_version_line "$regenerated_path" "$committed_version_line"
    done
}

regen_one() {
  example_dir="$1"
  name="$(basename "$example_dir")"
  entry="$example_dir/src/app.schema.ts"
  [ -f "$entry" ] || { echo "$example_dir has no src/app.schema.ts" >&2; exit 2; }

  steps=()
  while IFS= read -r step; do
    steps+=("$step")
  done < <(find "$example_dir/src/steps" -maxdepth 1 -name 'step-*.schema.ts' | sort -V)
  [ "${#steps[@]}" -ge 1 ] || { echo "$example_dir/src/steps has no step-*.schema.ts files" >&2; exit 2; }

  # The step history is append-only in practice — a chain only ever grows
  # (phase8-constraint-names, phase8-grant-sync add steps; none remove
  # one). A regeneration that produces *fewer* migrations than were
  # already committed is therefore almost always a mistake (a step file
  # deleted or misnamed), not an intentional shrink — and it must not
  # pass by only leaving a smaller `git diff` for someone to notice on
  # their own. Recorded before wiping anything below.
  #
  # The baseline comes from the index (`git ls-files`), not the
  # filesystem, for two separate reasons a `find`-based count gets both
  # wrong: (1) a `find` count includes files this script itself just
  # wrote, so a failed run launders itself on a retry — the first thing
  # anyone does after a failure; (2) it also includes untracked leftovers
  # from earlier experiments, which is how this was found: a stray
  # `0005_*.sql` left over from a test run made the guard fail against a
  # chain that was actually intact. Notably, a `find`-based count would
  # *not* have caught either failure — untracked files inflate its count
  # the same way committed ones do, so switching to the stricter, more
  # correct source (the index) is exactly what surfaced both problems.
  # `git ls-files` fails outside a git checkout; falls back to 0 (no
  # shrink to compare against) rather than aborting the whole script —
  # the no-op check below doesn't depend on this value.
  committed_count="$(git -C "$example_dir" ls-files 'migrations/*.sql' 2>/dev/null | wc -l | tr -d ' ')" || committed_count=0

  echo "== $name (${#steps[@]} steps, ${committed_count} committed migrations)"

  rm -rf "$example_dir/migrations"
  rm -f "$example_dir/hejbro.snapshot.json"
  (cd "$example_dir" && node "$CLI" init >/dev/null)

  for step in "${steps[@]}"; do
    echo "   $(basename "$step")"
    cp "$step" "$entry"
    run_generate "$example_dir"
  done

  regenerated_count="$(find "$example_dir/migrations" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
  if [ "$regenerated_count" -lt "$committed_count" ]; then
    echo "regen-examples.sh: $name regenerated only $regenerated_count migration(s), but $committed_count were committed before this run — a step file was likely deleted or renamed under src/steps/. If the chain is genuinely meant to shrink, that's not something this script does automatically; resolve it by hand." >&2
    echo "regen-examples.sh: the working tree has already been rewritten to this shorter state — restore with \`git checkout -- examples/$name\` before retrying, or the next run will compare against this reduced state instead of what was actually committed." >&2
    exit 1
  fi

  # A step file existing is not the same as a step file *doing* anything.
  # If a new step's declarations don't actually differ from the previous
  # step's, `generate` reports no changes and writes nothing — the step
  # count above (${#steps[@]}) is then higher than the migration count
  # here, silently, because nothing else looks at that relationship.
  # `examples/README.md` states "every step defends at least one defect
  # class" as a rule; this is what enforces it. Complementary to the
  # shrink check above, not redundant with it: a deleted step keeps
  # `steps == migrations` (both drop by one), and a no-op step keeps
  # `migrations >= committed` (the count never goes down) — each check
  # is blind to the other's failure mode.
  if [ "$regenerated_count" -ne "${#steps[@]}" ]; then
    echo "regen-examples.sh: $name has ${#steps[@]} step file(s) but produced $regenerated_count migration(s) — a step whose declarations don't differ from the previous one generates nothing. Every step must change something (examples/README.md: each step defends a defect class)." >&2
    exit 1
  fi

  restore_committed_banner_versions "$example_dir" "examples/$name"
}

for dir in "${EXAMPLE_DIRS[@]}"; do
  regen_one "$dir"
done

echo "regen-examples.sh: done — examples/{postgres,supabase}/migrations and hejbro.snapshot.json regenerated from src/steps/"
