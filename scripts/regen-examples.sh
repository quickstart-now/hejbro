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
# read `git status` afterward.
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
  # A multi-pair ambiguity instead prints a backslash-continued command
  # with <...> placeholders a human has to fill in — reject that instead
  # of running it verbatim.
  confirm_drop_target="$(grep -o 'hejbro generate --confirm-drop [^[:space:]]*' <<< "$stderr_output" | tail -1 | awk '{print $NF}')"
  if [ -z "$confirm_drop_target" ] || grep -q '<' <<< "$stderr_output"; then
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
  # their own. Recorded before wiping anything below.
  committed_count="$(find "$example_dir/migrations" -maxdepth 1 -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')"

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
    exit 1
  fi
}

for dir in "${EXAMPLE_DIRS[@]}"; do
  regen_one "$dir"
done

echo "regen-examples.sh: done — examples/{postgres,supabase}/migrations and hejbro.snapshot.json regenerated from src/steps/"
