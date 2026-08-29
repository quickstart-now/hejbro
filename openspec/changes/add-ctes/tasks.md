# Tasks: add-ctes

Groups are parallel-safe slices (no file overlap). They are also
sequentially dependent: group 2 after 1 (it serializes the node group 1
defines), 3 after 1–2, 4 after 3, 5 after 3, 6 after 5, 7 after 1–6.
Estimates are pure work minutes (D88).

**Standing constraint for every group.** Every traversal this change needs
goes through an existing exhaustive registry or an existing helper. What
it must not do is stand up **a new traversal function or loop of its own**
— #444's defect came from hand-written traversal sites, and this change
adds a node with child *queries*, which is the same trap one level up.

**The registries force a handler to exist; they do not force it to
descend.** `with: (node) => node` compiles and passes a
reference-identity loop. Tasks 2.3 and 2.4 exist because of this and must
not be dropped.

## 1. The WithNode, the from union, and their rendering

- [ ] 1.1 (~9m) [design] `WithNode` as a `QueryNode` variant, plus its
      renderer. Settled here: the node's field names (`ctes`, `body`,
      `recursive`), each entry's shape (`name`, `query`, `materialized`),
      the snapshot token (`with`), the body type (`SelectNode |
      SetOpNode` — deliberately not the whole `QueryNode` union, see the
      proposal's Out of scope), and the exact emitted text: entries
      comma-separated in declaration order ahead of the body, `with
      recursive` when the list is recursive, `as materialized` / `as not
      materialized` when an entry carries a hint and neither token when
      it does not. Red: `packages/core/test/expr/with-node.test.ts` —
      "renders a with list ahead of its body, comma-separated in
      declaration order". Files: `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.2 (~8m) [design] `FromNode` union and unqualified rendering.
      Settled here: the union's discriminator, how a CTE reference renders
      (bare, quoted as an identifier, never schema-qualified), and how a
      column reference belonging to one qualifies. The four readers that
      assume a qualified name are `renderColumnRefNode`, `renderTableRef`,
      `isInScope` and `assertInScope`; each must say what it does with a
      CTE reference rather than inherit table behaviour. Red: same file —
      "a select whose from-source is a CTE reference renders the name
      unqualified". Files: `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.2b (~7m) A join may target a CTE reference, not only a table —
      the second half of "top N per group" rejoins the ranked CTE to carry
      detail columns. The fan-out is **measured, not to be re-measured**:
      widening `from` alone is 18 errors over 7 files, widening both is
      22 over the same 7, so the join costs **+4 and opens no new file**.
      All four are the join-side sibling of a call the `from` widening
      already opens — `renderTableRef` in the joins loop, `retargetJoin`,
      `encodeJoin`, and the preset validator's join collection — so each
      reuses the answer written one argument over. If reality disagrees
      with that, stop and report; do not absorb a surprise. Red:
      `packages/core/test/expr/with-node.test.ts` — "a select joins a CTE
      reference, resolving the join condition against both sources".
      Files: `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.2c (~7m) [design] A CTE column reference reaching a **declaration
      site** is refused, not cast away. Widening `ColumnRefNode.schemaName`
      to `string | null` (1.2) makes three sites in `dsl/table.ts` stop
      compiling — the foreign-key reference target and the two
      `foreign-column-ref` guards — and the tempting fix is a non-null
      assertion, on the reasoning that a declared table's column always
      has a schema. That reasoning is exactly what D105 rejects one file
      over: a CTE reference object hands out `ColumnRef`s, so a user *can*
      pass `cte.col` to an index or a foreign key, and the cast would turn
      a diagnosable mistake into `"null"."x"` in a rendered constraint.
      Settled here: the error code, joining the existing family
      (`foreign-column-ref`'s siblings) rather than inventing a new shape,
      and its message. Red: `packages/core/test/dsl/cte-column-ref.test.ts`
      — "a foreign key and an index each refuse a CTE column reference,
      naming the site". The test hand-builds the null-schema reference at
      this stage; group 3 reaches the same guard through a real
      `with()` reference once one exists. Files:
      `packages/core/src/dsl/table.ts`, that test.
- [ ] 1.2d (~5m) Close 1.2c's remaining opening: an index's **column**
      list (`.on(...)`), which 1.2c does not cover — it guards index
      *predicates*. `declarationColumnSelf` reads a `ColumnRef`'s
      `sqlName` and nothing else, so a CTE column passed there becomes an
      index on a bare name with no owner. Guard the CTE case only (a null
      schema), with 1.2c's error family. The **general** weakness behind
      it — that any other table's column passes the same way, CTEs
      aside — is pre-existing, is not this change's to fix, and is filed
      as **#464**. A guard that covers three of four
      declaration sites is the shape a reviewer is right to reject. Red:
      `packages/core/test/dsl/cte-column-ref.test.ts` — "an index column
      list refuses a CTE column reference". Files:
      `packages/core/src/dsl/index-builder.ts`, that test.
- [ ] 1.3 (~8m) [design] Scope: the enclosing `WITH` list is the set of
      available names. A column belonging to a CTE the statement does not
      declare is refused at build time. Settled here: whether this reuses
      `foreign-column-ref` or takes its own code, and the message — the
      existing diagnostic names `schema.table`, which is wrong text for a
      CTE. Red: `packages/core/test/expr/with-scope.test.ts` — "a column
      of an undeclared CTE is refused, naming the statement's available
      sources". Files: `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.3b (~9m) The same rule one level down: a CTE reference inside a
      **nested subquery** is checked against the declared entries too.
      1.3 validates the body's and each entry's own from/join targets, and
      scope checking does not cover the gap — it answers "does this column
      belong to an available source", not "does this name exist". A
      subquery's columns resolve happily against its own `from`, so
      `exists (select 1 from z …)` with `z` declared nowhere builds
      cleanly and fails on the server, which is precisely what 1.4 exists
      to prevent one level up. Not a new traversal: the declared-name set
      rides the render recursion the way `outerScope` already does, and
      `renderFromNode` checks a CTE reference against it where it already
      renders one. Red: `packages/core/test/expr/with-scope.test.ts` — "a
      CTE reference inside an exists subquery is refused when undeclared,
      and accepted when it names an earlier entry". Files:
      `packages/core/src/expr/render-sql.ts`, that test.
- [ ] 1.4 (~8m) [design] Entry visibility within the list. The manual:
      "Without `RECURSIVE`, `WITH` queries can only reference sibling
      `WITH` queries that are earlier in the `WITH` list." Scope for entry
      *n* is therefore the entries before it, not the whole list, and that
      is what the renderer builds. Settled here: the error code for a node
      that violates it — which the builder cannot produce (it hands each
      entry only the earlier references, making forward reference
      unrepresentable) but a hand-assembled or decoded node can, so the
      check guards the artifact path, not the builder path. Red: same
      file — "an entry may reference an earlier entry; a node referencing
      a later one is refused". Files:
      `packages/core/src/expr/render-sql.ts`, that test.

## 2. Serialization and traversal — after group 1

- [ ] 2.1 (~9m) Codec: the `with` token in the query-kind mapping plus
      encode/decode handlers, round-tripping entry order, the `recursive`
      flag, each entry's `materialized` hint, and a nested body — plus a
      CTE reference in **both** positions it can occupy, `from` and a
      join, since `encodeJoin` encodes its target through its own path and
      a round-trip test that only exercises `from` would leave that path
      unproven. Leniency
      follows #444's R4: a missing field is tolerated only where an older
      version actually wrote it out, and `with` is new in this format — a
      stored node missing its body is corruption and throws rather than
      decoding into something plausible. Red:
      `packages/core/test/expr/codec.test.ts` — "a with node round-trips
      with entry order and hints" and "a with node without a body is
      rejected, not repaired". Files: `packages/core/src/expr/codec.ts`,
      that test.
- [ ] 2.2 (~7m) The traversal arms: `walk.ts`'s handler maps and
      `retarget.ts`'s arm, for the new node **and** for the widened `from`
      **and `JoinNode.table`** — a CTE reached through a join is reached
      through a different field than one in `from`, and only one of the
      two is exercised by 2.3's test unless both are written. The two walk
      maps carry different meanings — decide each;
      sharing one type does not mean they want the same answer. Red: the
      existing walker tests plus `packages/core/test/expr/walk.test.ts` —
      "a walk reaches an expression inside a CTE body". Files:
      `packages/core/src/expr/{walk,retarget}.ts`, that test.
- [ ] 2.3 (~7m) Positive descent proof. The registries force a handler to
      be *written*, not to *descend*; `with: (node) => node` compiles and
      passes `retarget.test.ts`'s reference-identity loop. Red:
      `packages/core/test/expr/retarget.test.ts` — "a column referenced
      only inside a CTE body is rewritten by a rename". Files: that test
      only.
- [ ] 2.4 (~6m) The negative pin, which is the sentinel-schema hazard the
      proposal rejects an alternative over: a table rename does **not**
      rewrite a same-named CTE reference or its columns. Prose in the
      proposal is not the form this claim ships in. Red: same file — "a
      table rename leaves a same-named CTE alone". Files: that test only.
- [ ] 2.5 (~7m) A `reachable-kinds` producer — a view whose body declares
      a CTE — so D70's completeness assertion sees the new vocabulary. The
      producer lives in the in-memory fixture, **not** in
      `test/golden/cases/`: the goldens stay unchanged (see Verification).
      Red: `packages/core/test/naming-conventions.test.ts` completeness,
      red the moment the discriminator exists unproduced. Files:
      `packages/core/test/expr/reachable-kinds.ts`, that test.

## 3. The builder surface — after groups 1–2

**Cross-team boundary.** `packages/core/src/query/select.ts` (task 3.3) is
shared: the fn team holds a narrow exception on it for #423 — one import
and one registration call at each of six factory sites, no logic. Signal
the lead when this group starts and when it lands, so the two edits are
sequenced; whichever reaches `dev` second rebases. The regions differ (a
factory body versus the `with()` entry point), so a conflict is unlikely
rather than impossible.

- [ ] 3.1 (~10m) [design] `with()` as a statement root and the CTE
      reference it hands back. Settled here: the signature (how entries are
      named and how the body stage is reached), and what the reference
      exposes — one column per **projected** field, keyed by that field's
      key. Red: `packages/core/test/query/with.test.ts` — "a statement
      declares a named query and selects from it". Files:
      `packages/core/src/query/with.ts` (new), that test.
- [ ] 3.2 (~8m) [design] The named row environment at the type level: a
      computed field keeps its read brand outside the CTE (an
      `over(rowNumber(), …) as rn` is a `bigint` there, not `unknown`),
      and a column the CTE does **not** project is not reachable even
      though its source table declares it. This is the pair that makes the
      change's own motivating case work; nothing else pins it. Red: same
      file — "a projected window alias is filterable outside the CTE" and
      "an unprojected source column is not reachable". Files:
      `packages/core/src/query/with.ts`, that test.
- [ ] 3.3 (~6m) `select()` accepts a CTE reference as its from-source, so
      the builder can express what group 1 can render. Red: same file —
      "select(…, cteRef) builds a select whose from is the reference".
      Files: `packages/core/src/query/select.ts`, that test.
- [ ] 3.4 (~6m) The `materialized` hint on the builder surface, both
      values and the absent case. Red: same file — "an entry declares
      materialized, not materialized, or neither". Files:
      `packages/core/src/query/with.ts`, that test.

## 4. Views, column order, rename engine, preset validator — after group 3

- [ ] 4.1 (~8m) `defineView` accepts a body that declares CTEs, and
      `view-kind`'s `leftmostSelect`/`viewQueryColumns` answer for one —
      a view's column list comes from the **body**, not from an entry.
      D103's one-vocabulary rule is the reason this group exists at all.
      Red: `packages/core/test/kinds/view-with.test.ts` — "a view whose
      body declares a CTE reports the body's columns". Files:
      `packages/core/src/dsl/define-view.ts`,
      `packages/core/src/kinds/view-kind.ts`, that test.
- [ ] 4.2 (~7m) Column order: `applyColumnOrderToQuery` and the view path
      reach through the wrapper to the body. The oracle returns null for
      an unknown table, so a CTE reference is inert by construction —
      assert that rather than assume it. Red: same file — "column order
      applies to a CTE-declaring view's body, and a CTE reference is left
      alone". Files: `packages/core/src/snapshot/column-order.ts`, that
      test.
- [ ] 4.3 (~7m) The rename engine's view path (`retargetViewQuery`)
      descends through a `WITH`. This is a different registry from 2.3's
      and gets its own red test for the same reason 2.3 exists. Red:
      `packages/core/test/engine/rename-with.test.ts` — "a rename rewrites
      a column referenced only inside a stored view's CTE body". Files:
      `packages/core/src/engine/rename/retarget.ts`, that test.
- [ ] 4.4 (~8m) The Supabase preset's `view-security-invoker` validator,
      which the `FromNode` union makes stop compiling until it answers.
      **Both halves of the answer carry a test**, because the proposal
      argues this shape is safer than the alternative and an argument that
      ships as prose is the form #87 rejected: (a) a table read **only
      inside a CTE body** IS collected, so a view reading an RLS-guarded
      table through a CTE still raises the bypass warning — under a
      side-channel field this case compiles untouched and warns about
      nothing, which is exactly why the union was chosen; (b) the CTE
      *name itself* is NOT reported as a table, since it is
      statement-local and has no schema, and reporting it would name an
      object that does not exist. Red: that validator's own test — "a
      table read inside a CTE body is reported" and "a CTE name is not
      reported as a referenced table". Files:
      `packages/supabase/src/validators/view-security-invoker.ts`, that
      test.

## 5. The query layer — after group 3

**Cross-team boundary.** `packages/query/src/db/fn.ts` and
`db/fn-types.ts` belong to the fn team (#433). They are outside this
group's file list; if an edit here starts to spread into either, stop and
route it through the lead rather than absorbing it.

- [ ] 5.1 (~7m) `compileHandlers`' arm and what `CompileKind` says for a
      statement wrapped in a `WITH` — the kind is the **body's**, since
      that is what determines how rows are read. Red:
      `packages/query/test/compile/with.test.ts` — "a with statement
      compiles and reports its body's kind". Files:
      `packages/query/src/compile/compile.ts`, that test.
- [ ] 5.2 (~8m) The parameter lifter: entry bodies are lifted in
      declaration order, then the body statement, so `$n` numbering
      matches rendered order. This is the defect the proposal rejects
      option B over; it must be proven here, not assumed. Red: same file —
      "literals inside a CTE body are bound before the body statement's,
      and no literal is inlined". Files:
      `packages/query/src/compile/params.ts`, that test.
- [ ] 5.3 (~6m) `columnPlanForResult` reads the body's projection through
      the wrapper, so conversions apply exactly as they would unwrapped.
      Red: `packages/query/test/db/with.test.ts` — "a field needing
      conversion arrives converted through a with wrapper". Files:
      `packages/query/src/db/convert.ts`, that test.
- [ ] 5.4 (~9m) [design] The chain's own `with()`. Settled here: that it
      takes the core-built list rather than growing a parallel builder, so
      **group 6 adds no chain surface of its own** — if that turns out
      wrong, say so before writing group 6 rather than adding a second
      entry point. Red: same file — "a chain-built CTE statement compiles
      byte-identically to the core builder formulation". Files:
      `packages/query/src/db/chain.ts`, that test.

## 6. Recursive CTEs — after group 5

- [ ] 6.1 (~10m) [design] `withRecursive` and the two-stage callback: the
      anchor term fixes the row type, and the recursive term is written
      inside a callback receiving a reference typed from it. Settled here:
      the callback's shape and where `union all` is spelled.
      **Precondition found in group 1**: 1.4's visibility rule says an
      entry cannot see itself, and it does not except `recursive: true` —
      deliberately, since the manual sentence it implements is scoped to
      "Without `RECURSIVE`". So this task must widen that check before a
      self-reference can be written at all; a recursive entry sees the
      earlier entries **and itself**. **If this
      cannot be typed without degrading inference or error messages, stop
      and report** — the proposal commits to renegotiating scope rather
      than narrowing quietly. Red:
      `packages/core/test/query/with-recursive.test.ts` — "a recursive CTE
      anchors and self-references, rendering with recursive … union all".
      Files: `packages/core/src/query/with-recursive.ts` (new), that test.
- [ ] 6.2 (~7m) The recursive term is typed from the anchor: the
      reference's columns are the anchor's projected fields, and a
      recursive term whose shape disagrees does not type-check. Red: same
      file — "the recursive term sees the anchor's columns" and "a
      mismatched recursive term is refused". Files: that test only.
- [ ] 6.3 (~9m) [design] The four violations **this builder can actually
      construct**, measured on postgres:17 rather than recalled. The
      recalled list ("no aggregates, no window functions, no `distinct`,
      no `group by`") was measured and is **half wrong** — see 6.6 — so it
      is not what gets enforced. What the probe found reachable from our
      own surface is:
      `SetOpNode` carries whole-set `orderBy`/`limit`/`offset`, and each
      of the three is `0A000 … in a recursive query is not implemented`;
      and `intersect`/`except`, which `SetOpCombinators` exposes beside
      `union`, is `42P19 recursive query "r" does not have the form
      non-recursive-term UNION [ALL] recursive-term`.
      **Direction pre-approved (lead, 2026-08-29): maximise
      unrepresentability.** Narrow the recursive branch's combinator
      surface to `union`/`unionAll` and withhold the whole-set clauses, so
      the violations cannot be built rather than being caught. This is not
      "stricter than Postgres" — all four are measured server rejections
      (`42P19`, `0A000`), so making them unbuildable only moves Postgres's
      own rule to build time, at the top of D104's ordering. Settled here:
      the exact shape that achieves it, and which residue the shape cannot
      close. A build-time check backed by a measured SQLSTATE is the
      fallback for that residue only. No round trip is needed for the
      direction; escalate only if the shape degrades inference or error
      messages (same trigger as 6.1). Where a diagnostic is
      written, the two SQLSTATE families stay **separate codes** —
      `42P19` is a recursion-structure violation and `0A000` is an
      unimplemented feature, and collapsing them describes one rule where
      Postgres has two. Red:
      `packages/core/test/query/with-recursive.test.ts` — "a recursive
      branch refuses order by, limit and offset" and "intersect and except
      are not offered on a recursive branch". Files:
      `packages/core/src/query/with-recursive.ts`, that test.
- [ ] 6.5 (~7m) The **accept** list, which is longer than the refuse list
      and is the half that protects this change from itself. Measured
      accepted on postgres:17, therefore not refused here: a window
      function in the recursive term (refusing this would block **this
      change's own motivating case** one room over), `distinct`,
      `distinct on`, `group by`/`having`, an aggregate in the *anchor*
      term (the ban is recursive-term-only), `union` as well as `union
      all`, and both `materialized` and `not materialized` on a recursive
      entry. Two more the follow-up probes added, both of which a
      carelessly written guard would break: an **aggregate inside a scalar
      subquery** in the recursive term (the rule is about the term's own
      select level — a deep walk over-rejects, and the shallow boundary is
      the one `collectColumnRefs` already draws for `exists`), and a
      self-reference on an outer join's **non-nullable** side (`r left
      join t`), which Postgres accepts. Each carries an assertion; a list
      like this is exactly where one silent over-rejection hides. Red:
      same file — "a recursive term accepts a window function, distinct,
      group by and an anchor aggregate", "an aggregate inside a scalar
      subquery in the recursive term is accepted", and "a recursive entry
      accepts both materialization hints". Files: that test only.
- [ ] 6.6 (~5m) Record the correction where it will be read. The manual
      states no restriction list, and the widely-recalled one is wrong on
      four counts by measurement. That fact belongs in the proposal's
      recursion section and in the skill, not only in a test name — the
      next person to reach for a build-time guard here will reach for the
      recalled list. Files: `openspec/changes/add-ctes/proposal.md`,
      `skills/hejbro/references/query-layer.md` (the same edit 7.2 makes,
      done once).
- [ ] 6.4 (~6m) One `with recursive` covers a list containing both a
      recursive and a non-recursive entry — the flag is the list's, not
      the entry's. Red: same file — "one recursive keyword covers the
      list". Files: that test only.

## 7. Live witness and the paperwork — after groups 1–6

- [ ] 7.1 (~10m) Docker postgres:17: the motivating case end to end (a
      window function in a CTE, filtered outside it — assert the row
      *values*, since a row count is unchanged even if the filter
      degenerates), a recursive tree walk returning every descendant, an
      entry referencing an earlier entry, and both `materialized` tokens
      accepted. Also assert a parameter actually arrived as a parameter:
      the CTE-body literal test in 5.2 proves the numbering, and this
      proves the server agrees. Two more the documentation could not
      settle, so the server does: a `not materialized` hint on a recursive
      entry is **accepted and ignored**, not an error (6.5's premise), and
      a window function inside a recursive term is accepted — the two
      claims 6.5 rests on that no committed test would otherwise exercise
      against a real server. **Every recursive case carries a depth guard
      or a `statement_timeout`**, not only the `r left join t` one that
      provably does not terminate: today's fixture is a tree, so
      termination is a property of the *data*, and the first fixture with
      a cycle in it brings the hang back silently. An unguarded witness
      hangs CI rather than failing it. Run with `pnpm --filter @hejbro/pg
      test:integration` — `pnpm test` excludes this file and would report
      green having run none of it. Files:
      `packages/pg/test/integration.test.ts`.
- [ ] 7.2 (~8m, docs) `skills/hejbro/references/query-layer.md`: a CTE
      section, and the "not supported" line updated — that line names CTEs
      by issue number, and this change closes it. Do not describe
      behaviour the witness did not exercise; a "verified live" badge
      without the measurement is worse than an unbadged guess.
- [ ] 7.3 (~5m) The published-surface assertion block in
      `packages/cli/test/exports.test.ts`. **Signal the lead immediately
      before starting this task** — that file is inside another team's
      slice and the lead sequences it. `packages/cli/src/index.ts` needs
      no edit: it re-exports core with `export *`.
- [ ] 7.4 (~6m) Changeset (D59, `minor`), `openspec/task-times.csv` rows
      from **measured** durations, README task-time and CRAP badges.
- [ ] 7.5 (~8m) The D105 rows in `docs/specs/2026-08-19-hejbro-design.md`.
      The numbers the row cites are **re-measured on the implemented
      branch**, never transcribed from the design round's scratch
      measurement. If the branch was rebased after the wording was
      approved, re-verify before transcribing; if any cited number moved,
      **stop and request re-approval** rather than editing the approved
      text. Summary-table row and decision-log row go in **one commit**,
      as D103 and D104 did.
- [ ] 7.6 (~10m) The `blackbox/` entry (D89) — an owner-driven change
      carries one in the same PR: what was asked, what was built, why, and
      the internal processing, with per-file git blob SHA pins per
      `blackbox/README.md`. Include what went wrong on the way; a record
      that lists only what worked is not a flight recorder. Known already:
      the planner's own mis-instruction to quote the design log's D5 when
      the parked D5 is #299's internal number (caught by the lead before
      any work was based on it), and the fact that the filed fork read as
      one question but was two.

## Verification

- **Everything `.github/workflows/ci.yml` runs**, read off that file at the
  commit under test — not a list kept here, and not the `package.json`
  scripts whose names start with `check:`. The prefix is a naming habit,
  not the CI contract.
- Load-bearing for this change specifically: `check:next-marker` and
  `check:diagnostic-xref`, because groups 1, 4 and 6 introduce error
  codes; and `smoke:pack-install`, because task 7.3 widens the published
  export surface.
- Run the gates with turbo's cache disabled (`TURBO_FORCE=1`). The cache is
  content-addressed and shared across worktrees: a detached review
  checkout replays the *implementer's* logs and reports green having run
  nothing.
- `check:crap` and `check:tasktime` are **not** judged by exit code. Both
  rewrite `README.md`, and the verdict is `git diff --exit-code --
  README.md` after each, in that order.
- `pnpm --filter @hejbro/pg test:integration` against a real postgres:17,
  with the executed test names listed and zero skipped.
- Goldens and example chains are expected to be **unchanged**: a new
  `QueryNode` variant leaves existing declarations' encoding
  byte-identical, and the from union adds no key to an encoded table
  reference. A diff there means something else moved and is investigated,
  not regenerated.
