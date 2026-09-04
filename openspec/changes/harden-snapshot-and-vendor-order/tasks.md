# Tasks: harden-snapshot-and-vendor-order

One group, one team, one branch, one PR. Estimates are pure work
minutes; every task starts from its named red test, whose inputs are as
wide as the scenario's sentence (D110). Verification (the whole
`check:*` list, `openspec validate --strict`, `show --diff`) is the
definition of done, never a task. `[design]` details are settled by the
lead before the task starts; the settled choice is written into the
task line at that point.

## 1. Order and shape follow the declaration (#701, #740, #749)

- [ ] 1.1 (~8m) `[design — settled, 701/R2]` A table's indexes and
      checks are recorded in canonical order through design.md
      mechanism 2: an optional, additive `ObjectKind.canonicalize?(node)`
      hook, applied by `buildSnapshot` to every serialized node;
      `tableKind` sorts `indexes` and `checks` by `name` (`compareKeys`),
      an absent `checks` stays absent; `formatVersion` stays 8. Red:
      `packages/core/test/table-kind-diff.test.ts` — "indexes and checks
      serialize in canonical order and reordering them is not a change",
      an input table over one table declared twice: indexes reversed;
      checks reversed; both reversed; the control rows — an index's own
      column list reversed (a changed index, as before), foreign keys
      declared in another order (already canonical, bytes identical),
      columns declared in another order (physical order, as before).
      Each set row asserts byte-identical `stableJson` of the two
      `buildSnapshot` nodes and an empty `tableKind.diff`.
      Files: `packages/core/src/kinds/table-kind.ts`,
      `packages/core/src/kind/object-kind.ts`,
      `packages/core/src/snapshot/snapshot.ts`,
      `packages/core/test/table-kind-diff.test.ts`.
- [ ] 1.2 (~7m) `[design — settled, 701/R2]` A policy's roles and a
      trigger's events are recorded in canonical order through the same
      hook: `policyKind` sorts `roles` by name (`compareKeys`);
      `triggerKind` orders `events` by the fixed rank insert, update,
      delete and sorts an `update` event's `columns` by name. Rendering
      follows the canonical order for objects created or recreated from
      now on (701/R2, D3 accepted). Red: `packages/core/test/policy-kind.test.ts`
      — "roles serialize sorted and a reordered role list is not a
      change": roles `["b", "a"]` vs `["a", "b"]`, three roles rotated,
      and the control row — a role added (`alter`, `policy changed;
      recreating`, as before); `packages/core/test/trigger-kind.test.ts`
      — "events serialize in the fixed order and a reordered event list
      is not a change": `["update", "insert"]` vs `["insert", "update"]`,
      `["delete", "insert", "update"]` vs the fixed order, `{ update:
      ["b", "a"] }` vs `{ update: ["a", "b"] }`, and the control rows —
      an event added, a column added to `update of` (both `alter`,
      `trigger changed; recreating`). Each set row asserts byte-identical
      nodes and an empty diff; rendered `create policy … to …` and
      `create trigger …` are pinned in canonical order.
      Files: `packages/core/src/kinds/policy-kind.ts`,
      `packages/core/src/kinds/trigger-kind.ts`,
      `packages/core/test/policy-kind.test.ts`,
      `packages/core/test/trigger-kind.test.ts`.
- [ ] 1.3 (~8m) A previous snapshot in the old order compares equal and
      records nothing (design.md mechanism 2: `canonicalizeSnapshot`
      applied to both sides in `diffSnapshots` and in
      `snapshotChangedFrom`; `parseSnapshot` and the hash chain stay
      byte-based). Red: `packages/core/test/generate.test.ts`
      — "a previous snapshot carrying a set-shaped array in a
      non-canonical order generates nothing", a hand-written previous
      (never built by `buildSnapshot`) whose policy carries `roles:
      ["b", "a"]`, whose trigger carries `[update, insert]`, and whose
      table carries its indexes and checks reversed, against
      declarations listing the same members: `migrations: []`,
      `hasChanges: false`, `snapshotChanged: false`; the declaration-only
      reorder row (`buildSnapshot`-built previous, declarations
      reordered): `migrations: []`; and the control row — the same
      previous plus one added column: one migration carrying only that
      column's statement, and its snapshot canonical throughout.
      `packages/core/test/diff-engine.test.ts` — "diffSnapshots compares
      a set-shaped array as a set whichever side is uncanonical":
      uncanonical previous vs canonical next, and the reverse, both
      empty; a member added on either side, one alter.
      Files: `packages/core/src/engine/diff-engine.ts`,
      `packages/core/src/engine/generate.ts`,
      `packages/core/src/snapshot/snapshot.ts` (`canonicalizeSnapshot`),
      `packages/core/src/index.ts`,
      `packages/core/test/generate.test.ts`,
      `packages/core/test/diff-engine.test.ts`.
- [ ] 1.3b (~8m) `verify` matches the declarations through the canonical
      form, and the goldens carry it. Red: `packages/cli/test/verify.test.ts`
      — "a checked-in snapshot differing from the declarations only by a
      set's order passes" (a fixture whose committed snapshot lists two
      indexes, two checks and two policy roles in the non-canonical
      order and whose tip migration hashes that file: `generate` reports
      the no-change line and writes nothing, `verify` exits zero) and
      "a hand-reordered snapshot is still a tip mismatch" (the same
      fixture with the roles array reordered in the file after the tip
      was written: `chain-tip-mismatch`, naming the tip and the
      snapshot). Green: `buildCheck2Outcome` renders
      `canonicalizeSnapshot(parsed disk)` against the rebuilt snapshot.
      Files: `packages/cli/src/commands/verify.ts`,
      `packages/cli/test/verify.test.ts`.
- [ ] 1.3c (~8m) The committed goldens and examples carry the canonical
      order. Red: `packages/core/test/golden/golden.test.ts` and
      `examples/{postgres,supabase}/test/chain.test.ts` as they stand —
      their byte-exact snapshot comparisons go red the moment 1.1 lands
      for every case whose committed indexes or checks are in
      declaration order (measured: `table-index-methods`,
      `table-constraints`, both examples). Green: each such
      `expected/snapshot.json` and both examples' `hejbro.snapshot.json`
      plus every migration banner's two hash lines are replayed from
      the step declarations — the same replay the last format bump did
      (commit 9f58667e), never hand-edited — and each diff is read to be
      order-only (array members permuted, no other byte).
      Files: `packages/core/test/golden/cases/*/expected/snapshot.json`,
      `examples/postgres/{hejbro.snapshot.json,migrations/*.sql}`,
      `examples/supabase/{hejbro.snapshot.json,migrations/*.sql}`.
- [ ] 1.4 (~8m) `[design — settled, 740/R1]` The emitted client metadata
      lists columns in physical order as design.md shape A: `columns`
      becomes `ReadonlyArray<{ key, sqlName, typeNode, mode,
      notNullElements }>` in `entries` order, one entry per line, the
      key a plain string value; the column facts come from a
      hand-built export/snapshot pair (an export is foreign input, so
      the names below need no declaration to produce them). Red:
      `packages/cli/test/contract-emit.test.ts` — "client metadata lists
      columns in the snapshot's physical order for every column-name
      class", one table whose snapshot columns are, in this physical
      order, `id`, `0`, `label`, `2`, `__proto__`, `constructor`,
      `Zeta`, `user-id`; the emitted module is transpiled and imported
      through `test/support/load-emitted-contract.ts` (never
      text-matched) and the loaded `contractMetadata.tables.<t>`'s
      column keys are asserted equal to that order; a second row with
      the columns declared in the reverse physical order asserts the
      reverse. The existing `__proto__` own-property scenarios keep
      passing on the new shape.
      Files: `packages/cli/src/contract/tables.ts`,
      `packages/cli/src/contract/emit.ts`,
      `packages/cli/test/contract-emit.test.ts`.
- [ ] 1.5 (~6m) The name-keyed client reads the list and renders that
      order; the object-keyed map still builds. Red:
      `packages/query/test/client/synthesize.test.ts` — "a list-shaped
      columns metadata yields the table's columns in list order,
      integer-like keys included" (the same eight names as 1.4, asserted
      on `getTableMeta(table).columns.map(c => c.columnName)` and on the
      ref object's keys) and "the object-keyed map still builds a table"
      (the pre-list shape, its own order); `packages/query/test/client/select.test.ts`
      — "a select over a vendored table lists columns in physical order":
      rendered SQL names `"id", "0", "label", "2", …` in that order.
      Boundary (740/R1): these four files are the one `packages/query`
      exception granted to this team; `name-keyed-db.ts` is not touched.
      The reader accepts the list and the object-keyed map alike through
      one `columnEntries(meta)` helper.
      Files: `packages/query/src/client/contract-types.ts`,
      `packages/query/src/client/synthesize.ts`,
      `packages/query/test/client/synthesize.test.ts`,
      `packages/query/test/client/select.test.ts`.
- [ ] 1.6 (~9m) `[design — settled, 749/R1]` A setof body returns the
      declared table's whole row — design.md scope (a): every projection
      refused, complete and reordered ones included, and any query whose
      row source is another table; code `return-expects-whole-row`,
      message as drafted in design.md; the check runs after
      `assertReturnHasReturning` and before `markConsumed`; the
      `ReturnableQuery` narrowing is attempted and kept if it compiles
      cleanly. Red: `packages/core/test/plpgsql/body-context.test.ts`
      — "a setof body accepts only the declared table's whole row", an
      input table over `defineFunction(app, name, { returns: posts })`
      bodies with `posts` = `{ id, title, body }` and `others` a second
      table: refused rows — `insert(posts).values(…).returning({ id })`,
      `.returning({ id, title })`, `.returning({ id, title, body })`
      (every column, declared order), `.returning({ body, title, id })`
      (every column, another order), `.returning({ postId: posts.id })`
      (aliased), the same five on `update(posts)…` and
      `deleteFrom(posts)…`, `select({ id: posts.id }).from(posts)`,
      `select(others)`, `insert(others).values(…).returning()`; each
      asserted on the settled code and on the message naming the table
      and both whole-row forms; accepted rows — `select(posts)`,
      `select(posts).from(posts).where(…)`, `select(posts)` with a join
      to `others`, `insert(posts)…returning()`, `update(posts)…returning()`,
      `deleteFrom(posts)…returning()`, each rendering `return query …`
      with `posts`'s columns in physical order; precedence rows — a
      no-returning mutation with the type bypassed → `return-expects-returning`;
      a scalar body with a projected returning → `scalar-return-expects-expression`;
      a trigger body with a projected returning → `trigger-return-expects-row`.
      The refused rows are also compiled under `@ts-expect-error` for
      the narrowed `ReturnableQuery` (design.md); if a narrowing does not
      hold cleanly, the type is filed as a follow-up and the runtime rows
      stand. The shipped pin of the projected form —
      `packages/core/test/plpgsql/render-body.test.ts`, "renders a
      definer function with a projected returning" — flips to the
      refusal in the same commit, and the type-only control in
      `body-context.test.ts` ("the returning stage, a bare select, and an
      executed non-returning mutation still compile") drops its
      projected-returning member.
      Files: `packages/core/src/plpgsql/body-context.ts`,
      `packages/core/src/dsl/define-function.ts`,
      `packages/core/src/dsl/define-trigger.ts`,
      `packages/core/test/plpgsql/body-context.test.ts`,
      `packages/core/test/plpgsql/render-body.test.ts`.
- [ ] 1.7 (~6m) The rules reach the user-facing skill and the release
      carries all three fixes. Red: `pnpm check:diagnostic-xref` and
      `pnpm check:next-marker` over the new refusal's site, `pnpm
      --filter @hejbro/skills test` (link and snippet gates), and
      `changeset status` with no changeset present. Green:
      `skills/hejbro/references/function-builder-pitfalls.md` — the
      `ctx.return` table's setof row says "the whole row of that table:
      `select(<table>)…` or a mutation on it ending in a bare
      `.returning()`", and the projected-returning paragraph is replaced
      by the refusal and its code; `skills/hejbro/references/polyrepo.md`
      — one sentence that the client metadata lists columns in physical
      order; `skills/hejbro/references/extension-interface.md` — the
      `canonicalize` hook beside the other optional members; `.changeset/harden-snapshot-and-vendor-order.md`
      is one `patch` naming `@hejbro/core`, one paragraph per fix.
      Files: the three skill references,
      `.changeset/harden-snapshot-and-vendor-order.md`.

Every task's green includes `pnpm biome check <touched files>` clean,
so no style-only commit is needed at close.

Group close: the gate list is every `check:*` script in `package.json`
plus `pnpm check`, `check-types`, `test`, run with `TURBO_FORCE=1` in
the worktree; `pnpm build --force` before any suite that spawns the
built CLI; `openspec validate harden-snapshot-and-vendor-order --strict`
and `openspec show harden-snapshot-and-vendor-order --diff` read in
full. Ledger rows (`openspec/task-times.csv`) and the README badge/CRAP
stamps are the close-out commit.
