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
# this script.
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
  # their own. Recorded before wiping anything below, from `git ls-files`
  # rather than a filesystem `find`: a stray *untracked* .sql file left
  # over from an earlier interrupted run must not inflate the baseline
  # and mask a real shrink (or, as happened once while developing this
  # script, cause a false failure by disappearing on the next wipe).
  committed_count="$(git -C "$example_dir" ls-files 'migrations/*.sql' | wc -l | tr -d ' ')"

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
}

for dir in "${EXAMPLE_DIRS[@]}"; do
  regen_one "$dir"
done

echo "regen-examples.sh: done — examples/{postgres,supabase}/migrations and hejbro.snapshot.json regenerated from src/steps/"
