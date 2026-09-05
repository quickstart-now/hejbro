#!/usr/bin/env bash
# Local round-trip (D48/D49): applies an example's committed migration chain
# to one database and a single fresh migration to another, then diffs the
# two schema dumps. Docker CLI only — psql/pg_dump run inside the container.
# Usage: scripts/roundtrip.sh <example-dir> [seed.sql]
set -euo pipefail

EXAMPLE_DIR="$(cd "$1" && pwd)"
SEED_FILE="${2:-}"
IMAGE="${HEJBRO_PG_IMAGE:-postgres:17-alpine}"
CONTAINER="hejbro-roundtrip-$$"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/packages/cli/dist/cli.js"
WORK="$(mktemp -d)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

[ -f "$CLI" ] || { echo "build the CLI first: pnpm build" >&2; exit 2; }
[ -e "$EXAMPLE_DIR/node_modules/hejbro" ] || { echo "run pnpm install first: $EXAMPLE_DIR/node_modules/hejbro is missing (pnpm workspace link)" >&2; exit 2; }

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
# Readiness is probed over TCP, not the unix socket: the image's entrypoint
# first runs a temporary server bound to the socket only (listen_addresses
# ''), then stops it and starts the real one. A socket probe can pass on the
# temporary server and the next psql then finds no socket at all (#375, seen
# on GitHub's runner). Only the final server answers on 127.0.0.1.
for _ in $(seq 1 120); do
  docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q || { echo "postgres container did not become ready" >&2; exit 2; }
psql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql -c 'create database chain;' -c 'create database fresh;'
if [ -n "$SEED_FILE" ]; then
  psql -d chain < "$SEED_FILE"
  psql -d fresh < "$SEED_FILE"
fi

# "|| true" keeps a missing/empty migrations dir from tripping set -e/pipefail
# before the guard below gets to print its own message.
CHAIN_COUNT="$(find "$EXAMPLE_DIR/migrations" -maxdepth 1 -name '*.sql' 2>/dev/null | wc -l | tr -d ' ' || true)"
[ "$CHAIN_COUNT" -ge 1 ] || { echo "no committed migrations in $EXAMPLE_DIR/migrations — nothing to compare" >&2; exit 2; }

echo "== applying committed chain to 'chain'"
for f in "$EXAMPLE_DIR"/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql -d chain < "$f"
done

# #212: the chain-vs-fresh dump diff below can only catch the two paths
# disagreeing with EACH OTHER -- a statement the generator silently never
# emits is missing from both, so they'd still agree. This checks each
# path against the snapshot instead, the one thing this harness never ran
# through the diff engine's "does it emit anything" logic.
echo "== checking 'chain' against the declared snapshot (#212)"
node "$REPO_ROOT/scripts/check-declared-vs-catalog.mjs" "$CONTAINER" chain "$EXAMPLE_DIR/hejbro.snapshot.json"

echo "== generating one fresh migration from the live declarations"
cp -R "$EXAMPLE_DIR" "$WORK/example"
# the fresh path must start from an empty snapshot (D48): keep the committed one
# out of the copy, so init creates a real one and generate has something to
# diff against — otherwise init skips it and generate silently reports zero
# changes, defeating the two-path comparison. Assumes the example's default
# `snapshotPath` (hejbro.snapshot.json); reading it from hejbro.config.ts is
# a follow-up if an example ever overrides it.
rm -rf "$WORK/example/migrations" "$WORK/example/node_modules" "$WORK/example/hejbro.snapshot.json"
cp "$EXAMPLE_DIR/hejbro.snapshot.json" "$WORK/final.snapshot.json"
# Relink every one of the example's own node_modules entries (not just
# "hejbro") with absolute targets — an example that imports a preset
# package (e.g. examples/supabase's "@hejbro/supabase") needs it resolvable
# too, and `cp -R`'s copies of pnpm's relative symlinks would otherwise
# point nowhere from $WORK's different directory depth. Scoped packages
# (`@scope/name`) get their own directory so each entry underneath still
# resolves.
mkdir -p "$WORK/example/node_modules"
for entry in "$EXAMPLE_DIR"/node_modules/*; do
  name="$(basename "$entry")"
  case "$name" in
    .*) continue ;;
  esac
  if [ "${name#@}" != "$name" ]; then
    mkdir -p "$WORK/example/node_modules/$name"
    for scoped in "$entry"/*; do
      ln -s "$scoped" "$WORK/example/node_modules/$name/$(basename "$scoped")"
    done
  else
    ln -s "$entry" "$WORK/example/node_modules/$name"
  fi
done
(cd "$WORK/example" && node "$CLI" init >/dev/null && node "$CLI" generate >/dev/null)
FRESH_COUNT="$(find "$WORK/example/migrations" -maxdepth 1 -name '*.sql' 2>/dev/null | wc -l | tr -d ' ' || true)"
[ "$FRESH_COUNT" -eq 1 ] || { echo "fresh generate produced $FRESH_COUNT migrations (expected exactly 1) — the two-path comparison did not run" >&2; exit 1; }
FRESH="$(ls "$WORK"/example/migrations/*.sql)"
echo "   fresh migration: $(basename "$FRESH")"
psql -d fresh < "$FRESH"
cmp -s "$WORK/final.snapshot.json" "$WORK/example/hejbro.snapshot.json" || { echo "snapshot from fresh generate differs from the committed snapshot" >&2; exit 1; }
echo "   snapshot reproduced"

echo "== checking 'fresh' against the declared snapshot (#212)"
node "$REPO_ROOT/scripts/check-declared-vs-catalog.mjs" "$CONTAINER" fresh "$EXAMPLE_DIR/hejbro.snapshot.json"

dump() { docker exec "$CONTAINER" pg_dump -U postgres -d "$1" --schema-only --no-owner --schema=app \
  | grep -vE '^(SET |SELECT pg_catalog\.set_config|--|\\restrict|\\unrestrict|$)'; }
dump chain > "$WORK/chain.sql"
dump fresh > "$WORK/fresh.sql"
grep -q 'CREATE TABLE' "$WORK/chain.sql" || { echo "chain dump contains no tables — the comparison would be vacuous" >&2; exit 1; }

# #121: sorts each *contiguous run* of GRANT/REVOKE lines among themselves,
# leaving every other line's position untouched. Postgres's own aclitem
# array order (pg_class.relacl, what pg_dump actually reads back) reflects
# grant *issuance* history for that object, not schema meaning -- a
# schema-wide grant re-issued for a table a later migration added (#121)
# can land a real, harmless pg_dump text reorder relative to a fresh
# single-migration database that issues every grant in one batch.
# information_schema.role_table_grants (check-declared-vs-catalog.mjs's own
# comparison, #212, order-insensitive by construction) is the authority
# for whether two databases actually agree on privileges; this
# normalization exists only so the line-by-line diff below stops flagging
# an artifact that check has already proven harmless, without hiding a
# genuine missing/extra grant (which still shows up as a real added/
# removed line even after sorting, and check-declared-vs-catalog.mjs would
# separately fail on it too, above).
normalize_grant_order() {
  awk '
    function is_grant(line) { return line ~ /^(GRANT|REVOKE) / }
    {
      cur = is_grant($0)
      if (NR == 1 || cur != prevcur || cur == 0) { group++ }
      prevcur = cur
      printf "%06d\t%s\n", group, $0
    }
  ' "$1" | sort -t "$(printf '\t')" -k1,1n -k2 | cut -f2-
}
normalize_grant_order "$WORK/chain.sql" > "$WORK/chain.normalized.sql"
normalize_grant_order "$WORK/fresh.sql" > "$WORK/fresh.normalized.sql"

echo "== diff (chain vs fresh, GRANT/REVOKE runs order-normalized)"
if diff -u "$WORK/chain.normalized.sql" "$WORK/fresh.normalized.sql"; then
  echo "round-trip OK: $(wc -l < "$WORK/chain.sql") dump lines identical"
else
  echo "round-trip FAILED: the migration chain and a fresh migration produce different schemas" >&2
  exit 1
fi

if [ -f "$EXAMPLE_DIR/roundtrip.rows.sql" ]; then
  echo "== row-data comparison ($EXAMPLE_DIR/roundtrip.rows.sql)"
  psql -d chain -At < "$EXAMPLE_DIR/roundtrip.rows.sql" > "$WORK/rows.chain"
  psql -d fresh -At < "$EXAMPLE_DIR/roundtrip.rows.sql" > "$WORK/rows.fresh"
  diff -u "$WORK/rows.chain" "$WORK/rows.fresh" && cat "$WORK/rows.chain"
fi
