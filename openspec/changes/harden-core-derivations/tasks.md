# Tasks: harden-core-derivations

One group, one team, one branch, one PR. Estimates are pure work
minutes; every task starts from its named red test, whose inputs are as
wide as the scenario's sentence (D110). Verification (the whole
`check:*` list, `openspec validate --strict`, `show --diff`) is the
definition of done, never a task.

## 1. Core derivations refuse what the database would misread (#748, #751, #774)

- [x] 1.1 (~8m) `[design]` A name plpgsql declares itself is refused as
      a local. Red: `packages/core/test/define-function.test.ts` —
      "a name plpgsql declares itself is refused as an argument name",
      an input table over the derived name: `found`, `sqlstate`,
      `sqlerrm`, and all twelve `tg_*` names, each asserted on `code`
      `reserved-local-name`; the keyword rows `analyse`, `analyze`,
      `current_catalog`, `except`, `lateral`, `system_user` beside them;
      the control rows `found_at`, `row_found`, `tg`, `tg_ops`,
      `sqlstate_code`, `state` accepted with their own `argName`. And
      `packages/core/test/plpgsql/body-context.test.ts` — "a name
      plpgsql declares itself is refused as a loop name": loop names
      `found`, `FOUND`, `Found`, `tg_op`, `TG_OP`, each
      `reserved-local-name`; and the control row, a row read named
      `found` (`ctx.row(query, "found")`) accepted, its locals being
      `found_<column>`. Green: the list
      entries and the case fold in `assertValidLocalName`. Design detail
      settled by the lead: the list's scope (variables only / plus fully
      reserved keywords / plus type-and-function-name keywords), uniform
      refusal of `tg_*` in non-trigger functions, and the message prose.
      Files: `packages/core/src/plpgsql/reserved.ts`,
      `packages/core/test/define-function.test.ts`,
      `packages/core/test/plpgsql/body-context.test.ts`.
- [x] 1.2 (~7m) `[design]` Two argument keys deriving to one SQL name
      are refused. Red: `packages/core/test/define-function.test.ts` —
      "two argument keys deriving to one SQL name are refused", an input
      table: `{ userId, user_id }`, `{ user_id, userId }`, `{ v2Id,
      v2_id }`, `{ aB, a_b }`, `{ userId_, user_id_ }`, `{ userId,
      userID, user_id }` — each asserted on `code` `duplicate-argument`
      and on the message naming both colliding keys and the shared name
      (for the three-key row: `userId` and `user_id`, `user_id`); the
      control rows `{ postID, postId }` and `{ id, id_ }` accepted with
      two distinct `argName`s; the precedence rows `{ order, userId,
      user_id }` → `reserved-local-name` and `{ "my-arg", userId,
      user_id }` → `invalid-sql-name`. Green: a helper after the per-key
      map in `resolveArgs` (design.md). Design detail settled by the
      lead: the code name and the message sentence.
      Files: `packages/core/src/dsl/define-function.ts`,
      `packages/core/test/define-function.test.ts`.
- [x] 1.3 (~9m) `[design]` Every change a kind reports survives the
      same-kind refinement. Red: `packages/core/test/diff-engine.test.ts`
      — "every change a kind reports for one identity survives the
      same-kind refinement", built on a standalone registry with a test
      kind that implements `dependsOnIdentities` and whose `diff`
      returns what the row says: two creates for one identity; three
      alters; two drops; a create and a drop for one identity; two
      creates for `app.b` which depends on `app.c` (identity sorting
      `app.b` first) → expected `app.c`, then both `app.b` creates in
      reported order; and the control row, a test kind *without*
      `dependsOnIdentities` reporting two changes for one identity. Each
      row asserts the full `(identity, operation, notes)` sequence, so a
      dropped or duplicated entry fails by content, never by count
      alone. Green: group by identity, unique identity list into the
      waves, flatten (design.md). Design detail settled by the lead:
      preserve (reported order, adjacent) versus refuse with a coded
      error.
      Files: `packages/core/src/engine/diff-engine.ts`,
      `packages/core/test/diff-engine.test.ts`.
- [x] 1.4 (~6m) The new refusal and the widened reserved set reach the
      user-facing skill, and the release carries all three fixes. Red:
      `pnpm check:diagnostic-xref` and `pnpm check:next-marker` over the
      new code's site, plus `changeset status` with no changeset
      present. Green: `skills/hejbro/references/function-builder-pitfalls.md`
      gains, beside the argument-name section, one sentence that the
      reserved set covers the variables plpgsql declares itself (`found`,
      `sqlstate`, `sqlerrm`, `tg_*`) and one on `duplicate-argument`;
      `.changeset/harden-core-derivations.md` is one `patch` naming
      `@hejbro/core`, one paragraph per fix.
      Files: `skills/hejbro/references/function-builder-pitfalls.md`,
      `.changeset/harden-core-derivations.md`.

## 2. Piece-review round (review-born)

The spec-bound reviewer measured, on PostgreSQL 17.11, every keyword of
`pg_get_keywords()` category T as a rendered local: 22 of 23 fail at
creation with a syntax error. The requirement's owned-name sentence
already covered that class; the list did not. Two delta sentences were
tightened in the same round (the row-name control in scenario 5 now
states the projection condition; the reported pair is defined as the
first key whose derived name repeats an earlier key's).

- [ ] 2.1 (~5m) The keywords reserved for function and type names are
      refused. Red: `packages/core/test/define-function.test.ts` — "a
      keyword reserved for function and type names is refused as an
      argument name", an input table of the 23 category-T keywords
      (`authorization`, `binary`, `collation`, `concurrently`, `cross`,
      `current_schema`, `freeze`, `full`, `ilike`, `inner`, `is`,
      `isnull`, `join`, `left`, `like`, `natural`, `notnull`, `outer`,
      `overlaps`, `right`, `similar`, `tablesample`, `verbose`), each
      asserted on `code` `reserved-local-name`; the row-name control
      rows from scenario 5 beside it in
      `packages/core/test/plpgsql/body-context.test.ts` — `ctx.row(…,
      "tg")` over a projection `{ id }` accepted, over `{ op }` refused
      — and the four-key pair row `{ aB, xY, x_y, a_b }` in
      `define-function.test.ts` asserting the message names `xY` and
      `x_y`. Green: the 23 entries in `reservedPlpgsqlNames`,
      alphabetically; no other code.
      Files: `packages/core/src/plpgsql/reserved.ts`,
      `packages/core/test/define-function.test.ts`,
      `packages/core/test/plpgsql/body-context.test.ts`,
      `skills/hejbro/references/function-builder-pitfalls.md` (one
      clause naming the function-and-type-name keywords),
      `.changeset/harden-core-derivations.md` (same clause).

Group close: the gate list is every `check:*` script in `package.json`
plus `pnpm check`, `check-types`, `test`, run with `TURBO_FORCE=1` in
the worktree; a forced rebuild before any suite that spawns the built
CLI; `openspec validate harden-core-derivations --strict` and
`openspec show harden-core-derivations --diff` read in full. Ledger rows
(`openspec/task-times.csv`) and the README badge/CRAP stamps are the
close-out commit, written once after the dev rebase. The `snapshot-diff`
capability is created by this change; its Purpose (design.md) is
written into `openspec/specs/snapshot-diff/spec.md` in the archive
commit that first creates that file — `openspec validate --specs`
refuses a spec file whose Requirements section is still empty, so the
file cannot exist before the archive merges the requirement in.
