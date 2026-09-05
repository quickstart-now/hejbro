# Work — quickstart-now/hejbro#375

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Both example round-trips pass on dev fffea4dc under colima

_2026-09-05T04:33Z_

Measured 2026-09-05 13:33 KST in worktree ci-roundtrip (dev fffea4dc, dist built): `pnpm --filter example-postgres roundtrip` -> "round-trip OK: 185 dump lines identical", 10 s; `pnpm --filter example-supabase roundtrip` -> "round-trip OK: 68 dump lines identical" plus the row-data comparison line, 8 s. Image postgres:17-alpine already cached locally; CI adds one pull. The CI job was not yet run when this was recorded -- its first real run is the PR's own check.

<a id="w2"></a>
## W2 — First CI run failed: dash refuses set -o pipefail; the script is invoked as sh

_2026-09-05T04:38Z_

Run 33944930577 job roundtrip: "../../scripts/roundtrip.sh: 6: set: Illegal option -o pipefail", exit 2, before any container started. Cause: examples/{postgres,supabase}/package.json run `sh ../../scripts/roundtrip.sh`; on ubuntu `sh` is dash, on macOS it is bash, so the local witness never saw it. The script's own shebang is bash and `pipefail` guards the dump | grep pipelines, so the fix is the invocation (`bash …`), not dropping pipefail. The CI job itself is the recurrence guard.

<a id="w3"></a>
## W3 — roundtrip readiness probe races the postgres image's init restart

_2026-09-05T07:58Z_

CI roundtrip job: the examples/supabase step failed on the runner with psql `connection to server on socket … failed: No such file or directory` before the script's first echo (the postgres step had passed).

Measured locally (postgres:17-alpine, probe every 0.1s): unix-socket `pg_isready` flips to ready at 2.03s while the entrypoint's temporary init server is up; the container log then shows `shutting down` → `PostgreSQL init process complete` → the final `ready to accept connections`; TCP `pg_isready -h 127.0.0.1` first passes at 2.36s, after the final server. The temporary server runs with `listen_addresses=''`, so it never answers TCP.

Fix: probe readiness over TCP, bounded to 120 s, instead of the socket. psql itself stays on the socket (only valid once the final server is up, which the probe now guarantees).

