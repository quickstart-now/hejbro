# Tasks: harden-catalog-inference-2

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only). This change's input is a catalog reading, so the
piece reviewer runs in constructor mode (D110).

**Files edited**: `packages/cli/src/check/catalog.ts`, `packages/cli/
src/infer/rest.ts` and tests (1.1); `packages/cli/src/infer/rest.ts`,
`packages/cli/src/infer/compose.ts`, `packages/cli/src/infer/
loss-report.ts` and tests (1.2); `packages/cli/test/infer-*.integration.test.ts`
(1.3); `skills/hejbro/references/brownfield-adoption.md`, one
`.changeset/*.md` (1.4). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 and 1.2 are independent; 1.3 after both; 1.4 last.

## 1. Catalog inference

- [ ] 1.1 (~7m) Roles from policies. Red: the infer tests over a fake
      catalog with a `policies` rows table {`to app_reader` only in a
      policy; `to public`; `to {a,b}` (two roles on one policy); a grant
      to `public`} → roles `a`, `app_reader`, `b`, plus the grant
      roles, never `public`. Green: the policies query selects `roles`;
      `inferRoleNames` unions them and drops `public`. Files:
      `catalog.ts`, `rest.ts`, tests.

- [ ] 1.2 (~10m) **[design]** Enum names under D36. Settles the
      omission's data shape (an `EnumNameOmission` carrying the enum and
      the columns typed by it) and the report line. Red: compose/loss
      tests over an input table of enum names {`Status`, `my-enum`,
      `2nd`, `_x` (passes the round trip, fails the rule), `status`
      (kept)} × {a column typed by it in the same schema; in another
      schema; none} → the enum and every column typed by it omitted, no
      surviving reference, one report line naming enum and columns with
      the `check` consequence; `status` and its column kept. Files:
      `rest.ts`, `compose.ts`, `loss-report.ts`, tests.

- [ ] 1.3 (~8m) Live witness on `postgres:17-alpine`: a database with
      `create type app."Status"`, a column of that type, a policy `to
      app_reader` — `hejbro import` writes declarations without the
      enum or its column, names both in the report, and the description
      carries `app_reader`; `hejbro check` afterwards lists the enum and
      the column as unmanaged. Files: the integration test.

- [ ] 1.4 (~5m) Docs and changeset. The brownfield reference's loss
      list gains the enum line and the roles sentence says "grants and
      policies"; `pnpm changeset` → `patch`. Files: the reference,
      `.changeset/*.md`.
