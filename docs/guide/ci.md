# CI

`hejbro verify` is the pure, database-free check: it re-derives the migration chain from checked-out files and confirms it agrees with your declarations. Run it on every push and pull request.

## GitHub Actions

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter <your-app> exec hejbro verify
```

## Exit codes

`hejbro verify` exits `0` when every check passes, `1` if any fails. Five checks always run; two more join independently when they apply — an export-freshness check (once `generate --export` is in use) and a check for every registered preset's own validators (once the active config registers at least one) — so the total is five to seven. A failure prints every failing check as a diagnostic block plus a summary line:

```
error[snapshot-stale]: hejbro.snapshot.json
  the checked-in snapshot at "hejbro.snapshot.json" does not match your declarations — either the declarations changed without a new migration, or the snapshot file was hand-edited. Next: run `hejbro generate` and commit the result (or, if the snapshot is correct and the declarations are wrong, restore the declarations you meant).

verify: 1 of 5 checks failed — fix the errors above and rerun `hejbro verify`.
```

## No `--fail-on-warning`

`hejbro generate`'s preset warnings (e.g. "exposed table without RLS") are printed to stderr as `warning[<code>]: <identity>` blocks with a `N warning(s) — see below` line on stdout, but they never fail the run — `generate` exits `0` when it succeeds, warnings or not. There is no `--fail-on-warning` flag in v1. If you want CI to gate on a specific warning, grep for its code in `generate`'s stderr as your own step.

## The local round-trip is the deeper check

`hejbro verify` never touches a real database. The example projects' `pnpm roundtrip` script (Docker `postgres:17-alpine`; applies the migration chain to one database and a single fresh migration to another, then diffs the two `pg_dump` outputs) is what proves the SQL is valid Postgres. It runs locally, not in CI, by design (see the design spec's decision log). Run it before merging any schema change:

```bash
pnpm build && pnpm --filter example-postgres roundtrip
```
