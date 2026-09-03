# @hejbro/pg

## 0.2.0-pre.0

### Minor Changes

- aad5078: Fixes from an adversarial review of the day's nested-transaction and
  `hejbro baseline` merges (#445).
  
  A second nested transaction started on the same `tx` while the first is
  still in flight now fails fast with `concurrent-nested-transaction`,
  before any savepoint statement is sent — concurrent siblings used to
  interleave one `SAVEPOINT` sequence on a single connection, silently
  discarding one sibling's work or aborting the whole transaction
  depending on the interleaving. A `RELEASE` that fails after a swallowed
  statement error now attempts `ROLLBACK TO` and surfaces
  `savepoint-release-failed` advising rethrow over swallow, instead of a
  bare `query-execution-failed`. A synchronously throwing nested callback
  now rolls back like a rejected one, and a rolled-back savepoint is
  released too, so no savepoint outlives the nested transaction that
  created it on any exit path. `savepoint-rollback-failed`'s message no
  longer asserts a false outcome.
  
  `hejbro baseline` over declarations that load but export nothing now
  fails with `baseline-nothing-to-adopt` instead of reporting a false "no
  changes" success and writing nothing; `--rename`/`--confirm-drop` are
  dropped from its `--help` and refused pre-parse with
  `baseline-flag-not-applicable`, since a baseline diffs against an empty
  snapshot and has nothing to rename or drop. `parseBannerBaseline` joins
  `parseBannerHashes`/`parseBannerVersion` as a public parser for the
  `-- baseline:` banner marker, matching its own prefix only.
  
  `ctx.return()` inside a plpgsql function/trigger body now dispatches by
  brand before duck-typing, so a table with a column literally named
  `exprNode` no longer misroutes `ctx.return(ctx.new)` down the expression
  path.

### Patch Changes

- 94445e9: integration harness only: the container readiness probe asks over TCP (`pg_isready -h 127.0.0.1`) instead of the unix socket, closing the cold-start window where the image's temporary init server answers on the socket while the host pool's TCP path has no listener. No runtime behavior change.
- Updated dependencies [ef12376]
- Updated dependencies [99b659e]
- Updated dependencies [1f459d1]
- Updated dependencies [f2e7781]
- Updated dependencies [aad5078]
- Updated dependencies [32a8f11]
- Updated dependencies [19e7aeb]
- Updated dependencies [16e1c92]
- Updated dependencies [fec58f9]
- Updated dependencies [43bbebd]
  - @hejbro/query@0.2.0-pre.0
