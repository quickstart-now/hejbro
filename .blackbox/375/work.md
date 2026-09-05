# Work — quickstart-now/hejbro#375

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Both example round-trips pass on dev fffea4dc under colima

_2026-09-05T04:33Z_

Measured 2026-09-05 13:33 KST in worktree ci-roundtrip (dev fffea4dc, dist built): `pnpm --filter example-postgres roundtrip` -> "round-trip OK: 185 dump lines identical", 10 s; `pnpm --filter example-supabase roundtrip` -> "round-trip OK: 68 dump lines identical" plus the row-data comparison line, 8 s. Image postgres:17-alpine already cached locally; CI adds one pull. The CI job was not yet run when this was recorded -- its first real run is the PR's own check.

