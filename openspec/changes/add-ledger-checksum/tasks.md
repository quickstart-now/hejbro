# Tasks: add-ledger-checksum

One group, one team, sequential. Estimates are pure work minutes (D88).
Every task is test-first: the named test goes red first (inputs as wide
as the scenario's sentence — a table, not one example, D110), then the
minimal green, then refactor. Every source rule of this repository
applies (`any`/`let`/`var`/`for`/`while`/ternary banned; comments state
the constraint only).

**Files edited**: `packages/cli/src/apply/ledger.ts`, `packages/cli/src/
apply/execute.ts`, `packages/cli/src/apply/raise.ts` and their tests
(1.1, 1.2, 1.3); `packages/cli/src/commands/status.ts` and its test
(1.4); `packages/cli/test/apply-live.integration.test.ts` (1.5);
`skills/hejbro/references/generate-verify-workflow.md`, one
`.changeset/*.md` (1.6). If a task appears to need any other file, that
goes back to the planner, not into the diff.

**Ordering.** 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7.

## 1. The body checksum

- [ ] 1.1 (~8m) **[design]** The column and the hash. Settles the
      column (`checksum text`, nullable) in the bootstrap's `create
      table` plus `alter table … add column if not exists`, and the hash
      function (`bodyChecksum(fileText)`: text after the banner block,
      `\r\n` → `\n`, SHA-256 hex; the whole text when no banner). Red:
      the ledger tests — the bootstrap SQL carries both statements; the
      identity judgement still requires exactly the four columns and
      accepts a ledger with or without the fifth; `bodyChecksum` over a
      table {banner+body, body with CRLF (equal to LF), body with a
      trailing space (different), no banner (whole file)}. Files:
      `ledger.ts`, tests.

- [ ] 1.2 (~8m) Recording. Red: the execute tests — an applied row and a
      registered (baseline) row carry the body checksum; a raised row
      carries the whole-file checksum; the ledger read returns it (`null`
      for an older row). Files: `execute.ts`, `raise.ts`, `ledger.ts`,
      tests.

- [ ] 1.3 (~9m) **[design]** The refusal. Settles the message of
      `apply-migration-body-changed`. Red: the migrate command tests, a
      table: {recorded file edited below the banner → refused naming the
      file and both checksums, pending not applied, ledger unchanged},
      {edited banner prose only → proceeds}, {CRLF checkout → proceeds},
      {older row with null checksum → not compared, pending applies with
      a checksum}, {recorded file missing → the existing disagreement,
      not this code}. Files: `execute.ts`, `migrate.ts`, tests.

- [ ] 1.4 (~6m) `status`. Red: the status tests — a changed body is its
      own line under the same code, exit non-zero; an older row is not
      reported. Files: `status.ts`, its test.

- [ ] 1.5 (~8m) Live witness on `postgres:17-alpine`: apply two, edit
      the first's body, `migrate` refuses before sending (the third's
      objects are absent), `status` reports it; a ledger created without
      the column is upgraded by the bootstrap and the next apply records
      a checksum. Files: the integration test.

- [ ] 1.6 (~8m) A filtered ledger is refused. Red: the ledger identity
      tests — a fake catalog row with `relrowsecurity` true, with
      `relforcerowsecurity` true, and with both false → the first two
      refused with `apply-ledger-filtered` naming ledger, role and the
      policies listed for it, before any read; the live witness adds a
      forced-RLS ledger against `status` and `migrate`. Files:
      `ledger.ts`, `ledger-identity.ts`, tests, the integration test.

- [ ] 1.7 (~5m) Docs and changeset. The reference states "verify: the
      chain; migrate/status: the bodies"; `pnpm changeset` → `minor`.
      Files: the reference, `.changeset/*.md`.
