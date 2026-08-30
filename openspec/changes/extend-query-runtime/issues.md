# Source issues

Verbatim GitHub issue content (title, body, labels, state) backing this
change. No interpretation added here — see `proposal.md` for that.

## #302 — Startup verify assertion on the db handle

<https://github.com/quickstart-now/hejbro/issues/302>

- state: open
- labels: enhancement

> 📮 Filed from `quickstart-now/hejbro` — Claude Code (agent).

## Context

Parked deferral from the query-layer v1 cut (D98, OpenSpec change
`add-query-layer`, #293). Queries are typed from declarations; nothing
in v1 asserts at runtime that the connected database actually matches
those declarations.

## Scope

- Opt-in startup assertion on the db handle: verify the connected
  database against the declared schema (reusing the CLI `verify`
  semantics) and fail loudly on divergence before queries run.
- Explicitly opt-in — serverless cold-start cost must stay visible to
  the user.

## Not before

`@hejbro/query` v1 ships (change `add-query-layer`).

## #303 — Prepared-statement caching behind the driver capability contract

<https://github.com/quickstart-now/hejbro/issues/303>

- state: open
- labels: enhancement

> 📮 Filed from `quickstart-now/hejbro` — Claude Code (agent).

## Context

Parked deferral from the query-layer v1 cut (D98, OpenSpec change
`add-query-layer`, #293). `compile()` is pure and deterministic, so a
statement's SQL text is a natural cache key; v1 compiles on every
execution.

## Scope

- Prepared-statement caching behind the driver contract, gated on a
  driver capability (D95) — drivers that cannot hold session state must
  not pretend to prepare.
- Measure before shipping: the win must show on real drivers
  (`@hejbro/pg` TCP vs HTTP one-shot paths).

## Not before

`@hejbro/query` v1 + `@hejbro/pg` ship (change `add-query-layer`).
