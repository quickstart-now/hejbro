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
until docker exec "$CONTAINER" pg_isready -U postgres -q; do sleep 1; done
psql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

psql -c 'create database chain;' -c 'create database fresh;'
if [ -n "$SEED_FILE" ]; then
  psql -d chain < "$SEED_FILE"
  psql -d fresh < "$SEED_FILE"
fi

echo "== applying committed chain to 'chain'"
for f in "$EXAMPLE_DIR"/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql -d chain < "$f"
done

echo "== generating one fresh migration from the live declarations"
cp -R "$EXAMPLE_DIR" "$WORK/example"
rm -rf "$WORK/example/migrations" "$WORK/example/node_modules"
cp "$EXAMPLE_DIR/hejbro.snapshot.json" "$WORK/final.snapshot.json"
(cd "$WORK/example" && mkdir -p node_modules && ln -s "$EXAMPLE_DIR/node_modules/hejbro" node_modules/hejbro \
  && node "$CLI" init >/dev/null && node "$CLI" generate >/dev/null)
FRESH="$(ls "$WORK"/example/migrations/*.sql)"
psql -d fresh < "$FRESH"
cmp -s "$WORK/final.snapshot.json" "$WORK/example/hejbro.snapshot.json" || { echo "snapshot from fresh generate differs from the committed snapshot" >&2; exit 1; }

dump() { docker exec "$CONTAINER" pg_dump -U postgres -d "$1" --schema-only --no-owner --schema=app \
  | grep -vE '^(SET |SELECT pg_catalog\.set_config|--|\\restrict|\\unrestrict|$)'; }
dump chain > "$WORK/chain.sql"
dump fresh > "$WORK/fresh.sql"

echo "== diff (chain vs fresh)"
if diff -u "$WORK/chain.sql" "$WORK/fresh.sql"; then
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
