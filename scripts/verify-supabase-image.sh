#!/usr/bin/env bash
# D69: verifies the Supabase preset against a real `supabase/postgres` image
# -- a second local-Docker script alongside scripts/roundtrip.sh, not in CI
# (D49 stands). The two answer different questions and neither replaces the
# other (see examples/README.md's "why the round-trip can't replace this"
# table, added alongside this script):
#
#   roundtrip.sh:              is the generator deterministic -- does a
#                              chain-built schema equal a freshly built one?
#                              (compares our output against our output)
#   verify-supabase-image.sh:  does the preset match the platform it targets?
#                              (compares our assumptions against the real thing)
#
# `examples/supabase`'s round-trip runs on plain `postgres:17-alpine` against
# a role/storage.buckets/auth.users/auth.uid() stub `seed/supabase.sql` wrote
# ourselves -- a chain-vs-fresh comparison can't see an error both sides
# make, which is exactly the blind spot that let `serial` pass for two
# phases (Phase 7). This script runs the *committed migration chain* (not a
# fresh generate -- there is nothing to diff against here, only something to
# apply) directly against the real image, with zero stub objects of our own:
# every schema/role/table/function this script checks is either created by
# the migrations themselves or already present in the image before this
# script touches it. Seeding our own storage.buckets/auth.users/auth.uid()
# here, the way the round-trip's seed does, would be exactly the circularity
# this script exists to avoid.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE_DIR="$REPO_ROOT/examples/supabase"
CONTAINER="hejbro-verify-supabase-image-$$"
WORK="$(mktemp -d)"

# supabase/postgres publishes new tags constantly (the .164 and .165 builds
# landed the same day) -- pinned to the current PG17 multi-arch tag, matching
# the PG17 major scripts/roundtrip.sh already uses.
IMAGE="supabase/postgres:17.6.1.165"
# The pinned digest is checked, not commented: a comment only works if
# someone reads it, and nothing breaks when it goes stale -- exactly the
# failure mode this repo's SHA-pinning convention (release-version.yml,
# release-publish.yml, #155) bans elsewhere. Recorded via
# `docker inspect supabase/postgres:17.6.1.165 -f '{{index .RepoDigests 0}}'`
# after a fresh pull, 2026-08-22 -- the *manifest-list* digest, not a local
# image ID: this tag is multi-arch (confirmed via `docker manifest inspect`:
# separate amd64/arm64 per-platform manifests, each with its own digest,
# neither equal to this one), and a local image ID can differ by
# architecture even when the tag hasn't moved. `RepoDigests` is the field
# that reflects the pulled manifest-list digest regardless of storage
# backend -- some configurations happen to also set the local image ID to
# the same value, but nothing about that is guaranteed, so this script never
# reads `.Id`.
RECORDED_DIGEST="sha256:2d9b76f84fe086da090dac9b3c75518240d3099c85d54b4def282a4e14f2f04d"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

verify_digest() {
  echo "== pinned image: $IMAGE"
  docker pull "$IMAGE" >/dev/null
  actual="$(docker inspect "$IMAGE" -f '{{index .RepoDigests 0}}' | sed 's/^.*@//')"
  if [ "$actual" != "$RECORDED_DIGEST" ]; then
    echo "verify-supabase-image.sh: $IMAGE's digest no longer matches what this script recorded." >&2
    echo "  recorded: $RECORDED_DIGEST" >&2
    echo "  actual:   $actual" >&2
    echo "  A re-tag changed what \"$IMAGE\" resolves to since this was last verified -- what this" >&2
    echo "  script checks below may no longer hold against the new image. Update RECORDED_DIGEST" >&2
    echo "  in this script to the value above, in its own PR, after re-running the checks below" >&2
    echo "  against the new image and confirming they still pass." >&2
    exit 1
  fi
  echo "   digest matches recorded value ($RECORDED_DIGEST)"
}

# Not a comment: this is the runtime-visible statement of what this script
# does NOT check, printed on every run, not just written once where it can
# go stale silently.
skip_storage_kind() {
  echo "== skip: the storage kind (storage.buckets) is not verified against the real image by this script"
  echo "   Reason: storage.buckets is created by Supabase's separate Storage API service's own"
  echo "   migrations, not by this Postgres-only image -- measured directly (2026-08-22): a"
  echo "   freshly started $IMAGE container has a 'storage' schema but zero tables in it."
  echo "   Verifying this here would mean creating storage.buckets ourselves first, comparing"
  echo "   our assumption about its shape against a stub we just wrote -- the exact circularity"
  echo "   this script exists to avoid (see examples/README.md)."
}

skip_extension_coverage() {
  echo "== skip: extension coverage (pg_cron, pg_net, pgsodium, ...) is not checked by this script"
  echo "   Reason: deliberately not checked, and not simply omitted -- a naive '\\dx diff' would be"
  echo "   a false baseline. Observed directly (2026-08-22): a fresh container's boot log shows"
  echo "   'pg_net 0.20.4 worker' and 'pg_cron scheduler' running as background workers, but"
  echo "   '\\dx' in the postgres database lists only pg_stat_statements/pgcrypto/plpgsql/"
  echo "   supabase_vault/uuid-ossp -- pg_net and pg_cron are absent from that list despite"
  echo "   visibly running. Cause not investigated (a shared_preload_libraries-loaded worker not"
  echo "   registered via CREATE EXTENSION in this database is one candidate, not confirmed)."
  echo "   Recorded as an open question, not treated as 'no extension there' -- a real check would"
  echo "   have to resolve this before it could trust '\\dx' as a complete list."
}

# The committed migrations' one INSERT INTO storage.buckets (the bucket
# kind's upsert) is the one statement class this script does not apply --
# see skip_storage_kind above. Stripped before applying so the rest of each
# migration (schema/table/policy/grant changes, which this script DOES
# verify) can be checked without failing on a table this image doesn't ship.
# The migrations are hejbro-generated SQL, whose statements are always
# blank-line-separated and semicolon-terminated on their own closing line
# (verified against both occurrences below) -- not a general SQL parser.
strip_storage_bucket_statements() {
  awk '
    /^insert into storage\.buckets/ { skipping = 1 }
    skipping { if ($0 ~ /;[[:space:]]*$/) skipping = 0; next }
    { print }
  ' "$1"
}

# Unlike plain postgres (scripts/roundtrip.sh's single pg_isready wait),
# this image's own entrypoint runs a round of migrations against a
# temporary postmaster, shuts it down, and starts the real one --
# measured directly (2026-08-22): container logs show two "database
# system is ready to accept connections" lines about a second apart, the
# first from a postmaster that then receives its own shutdown request. A
# single pg_isready/psql success can land in that first, short-lived
# window and then lose the connection mid-script when the real shutdown
# happens -- reproduced once while writing this script. Waiting for a
# connection to survive an extra few seconds after first succeeding is
# what actually distinguishes the two.
wait_for_ready() {
  tries=0
  until docker exec "$CONTAINER" psql -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || { echo "verify-supabase-image.sh: $IMAGE never accepted a connection within 60s" >&2; exit 1; }
    sleep 1
  done
  sleep 3
  tries=0
  until docker exec "$CONTAINER" psql -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || { echo "verify-supabase-image.sh: $IMAGE's connection did not survive its own internal restart within 60s" >&2; exit 1; }
    sleep 1
  done
}

apply_chain() {
  echo "== applying the committed migration chain to a fresh $IMAGE container"
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
  wait_for_ready

  # Applied directly to the "postgres" database, not a freshly created one:
  # measured (2026-08-22) that the auth/storage schemas this image ships
  # exist only in "postgres" -- a database created afterwards with `create
  # database` does not inherit them. This matches how a real Supabase
  # project actually runs: a single "postgres" database, never several.
  for f in "$EXAMPLE_DIR"/migrations/*.sql; do
    echo "   $(basename "$f")"
    strip_storage_bucket_statements "$f" |
      docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
  done
}

# `\du`-equivalent, output printed (not just asserted on) so a failure here
# names exactly which expectation the real image didn't meet.
verify_roles() {
  echo "== roles (anon/authenticated/service_role)"
  docker exec "$CONTAINER" psql -U postgres -d postgres -c \
    "select rolname, rolcanlogin, rolinherit, rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname;"
}

verify_auth_uid_definition() {
  echo "== auth.uid() definition, as shipped by the image"
  docker exec "$CONTAINER" psql -U postgres -d postgres -c "\sf auth.uid"
}

# The one check this script exists to make RED before the fix and GREEN
# after it (see this PR's history): querying app.profiles as `authenticated`
# fails with "permission denied for schema app" unless something has
# granted USAGE on schema "app" to that role -- a real Supabase project
# grants this as a platform action (adding "app" to the dashboard's exposed
# schemas), not part of any migration, so a fresh image plus this repo's own
# migrations is exactly what surfaces whether hejbro's own declarations
# still assume that platform step happened. Two auth.users/app.profiles
# rows are inserted here as test fixtures to exercise the row-filtering
# predicate itself, not as stand-ins for anything the real platform is
# supposed to provide (auth.users and app.profiles both already exist from
# the applied migrations before this function runs) -- unlike
# skip_storage_kind above, this is not the circularity that function names.
verify_rls_as_authenticated() {
  echo "== RLS: app.profiles as \"authenticated\", filtered by authUidCached()"
  docker exec "$CONTAINER" psql -U postgres -d postgres -c "
    insert into auth.users (id) values
      ('11111111-1111-1111-1111-111111111111'),
      ('22222222-2222-2222-2222-222222222222');
    insert into app.profiles (user_id, display_name) values
      ('11111111-1111-1111-1111-111111111111', 'Alice'),
      ('22222222-2222-2222-2222-222222222222', 'Bob');
  " >/dev/null

  alice="$(docker exec "$CONTAINER" psql -U postgres -d postgres -Atq -c "
    set role authenticated;
    set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
    select string_agg(display_name, ',') from app.profiles;
  ")"
  echo "   as Alice (11111111-...): sees [$alice]"
  [ "$alice" = "Alice" ] || {
    echo "verify-supabase-image.sh: expected Alice to see only her own profile, got [$alice]" >&2
    exit 1
  }

  bob="$(docker exec "$CONTAINER" psql -U postgres -d postgres -Atq -c "
    set role authenticated;
    set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
    select string_agg(display_name, ',') from app.profiles;
  ")"
  echo "   as Bob (22222222-...): sees [$bob]"
  [ "$bob" = "Bob" ] || {
    echo "verify-supabase-image.sh: expected Bob to see only his own profile, got [$bob]" >&2
    exit 1
  }
  echo "   RLS filters correctly for both rows"
}

# #212: catches a statement the generator silently never emitted -- this
# script's own applied-chain-against-a-real-image approach can run clean
# with a gap the same way scripts/roundtrip.sh's chain-vs-fresh dump diff
# can (see that script's own #212 comment); checking against the declared
# snapshot is what actually closes it.
check_declared_vs_catalog() {
  echo "== checking the applied chain against the declared snapshot (#212)"
  node "$REPO_ROOT/scripts/check-declared-vs-catalog.mjs" "$CONTAINER" postgres "$EXAMPLE_DIR/hejbro.snapshot.json"
}

verify_digest
apply_chain
check_declared_vs_catalog
verify_roles
verify_auth_uid_definition
verify_rls_as_authenticated
skip_storage_kind
skip_extension_coverage
echo "verify-supabase-image.sh: done"
