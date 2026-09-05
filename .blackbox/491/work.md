# Work — quickstart-now/hejbro#491

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — pnpm pack resolves catalog: ranges in the packed manifest

_2026-09-05T05:00Z_

Worktree chore-client-ranges, pnpm 10.19.0, 2026-09-05: with pg/@types/pg/@neondatabase/serverless set to catalog: in packages/{pg,supabase,neon,skills}, `pnpm --filter @hejbro/pg pack` and `--filter @hejbro/neon pack` produced manifests carrying peer pg ^8.23.0 / dev @types/pg ^8.23.1 / peer+dev @neondatabase/serverless ^1.1.0 -- no `catalog:` string survives into the tarball. check:client-ranges positive control (packages/supabase pg spelled ^8.23.0) exits 1 naming the field; negative control exits 0.

