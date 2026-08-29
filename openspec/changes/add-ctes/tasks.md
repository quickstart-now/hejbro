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

**And for `retarget.ts` even that overstates it** (found at group 2
review). There is no mapped-type registry over `queryKind` there — unlike
`render-sql.ts`'s `RenderQueryHandlers` — and `REACHABLE_NODE_KINDS` is a
list of `ExprNode` kinds that does not contain `with`. So today **nothing
forces `retargetWithNode` to exist at all**, and 2.3's dedicated test is
not a supplement to a registry: it is the only defence there is. That
changes when 4.3 wires `retargetViewQuery` to it and 4.5 puts `with` into
the reachable-kinds fixture. Until then, deleting that test removes the
last thing standing between this node and a silent regression.

**Every new public symbol carries a one-line justification** (owner
directive, 2026-08-29, via the UX/DX audit): why it cannot be expressed by
composing what already exists, and how its name is symmetric with its
siblings. This applies to exports and to chain methods, and it is recorded
where the symbol is added — reconstructing it later at task 7.7 is how a
surface grows by accident. `hejbro`'s barrel re-exports core with
`export *`, so a core export is a user-facing symbol whether or not it was
meant as one.

## 1. The WithNode, the from union, and their rendering

- [x] 1.1 (~9m) [design] `WithNode` as a `QueryNode` variant, plus its
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
- [x] 1.2 (~8m) [design] `FromNode` union and unqualified rendering.
      Settled here: the union's discriminator, how a CTE reference renders
      (bare, quoted as an identifier, never schema-qualified), and how a
      column reference belonging to one qualifies. The four readers that
      assume a qualified name are `renderColumnRefNode`, `renderTableRef`,
      `isInScope` and `assertInScope`; each must say what it does with a
      CTE reference rather than inherit table behaviour. Red: same file —
      "a select whose from-source is a CTE reference renders the name
      unqualified". Files: `packages/core/src/expr/ast.ts`,
      `packages/core/src/expr/render-sql.ts`, that test.
- [x] 1.2b (~7m) A join may target a CTE reference, not only a table —
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
- [x] 1.2c (~7m) [design] A CTE column reference reaching a **declaration
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
- [x] 1.2d (~5m) Close 1.2c's remaining opening: an index's **column**
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
- [x] 1.3 (~8m) [design] Scope: the enclosing `WITH` list is the set of
      available names. A column belonging to a CTE the statement does not
      declare is refused at build time. Settled here: whether this reuses
      `foreign-column-ref` or takes its own code, and the message — the
      existing diagnostic names `schema.table`, which is wrong text for a
      CTE. Red: `packages/core/test/expr/with-scope.test.ts` — "a column
      of an undeclared CTE is refused, naming the statement's available
      sources". Files: `packages/core/src/expr/render-sql.ts`, that test.
- [x] 1.3b (~9m) The same rule one level down: a CTE reference inside a
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
- [x] 1.3c (~4m) A CTE reference rendered with **no enclosing `WITH` at
      all** is refused. 1.3b's check skips when the render carries no
      outer scope, which is right for an ordinary bare select and wrong
      for one whose from-source is a CTE reference: nothing declares it,
      so the rendered SQL names a relation that does not exist. Reachable
      from group 3 onward, where a caller holds a reference object and can
      use it outside the statement that declared it. Gate the skip on
      **"are there CTE references to check"** rather than on the presence
      of an outer scope; the existing bare-select tests use table
      references and stay green either way. The code is `undeclared-cte`
      unchanged — declared nowhere is exactly what this is. Red:
      `packages/core/test/expr/with-scope.test.ts` — "a select rendered
      outside any WITH refuses a CTE from-source". Files:
      `packages/core/src/expr/render-sql.ts`, that test.
- [x] 1.4 (~8m) [design] Entry visibility within the list. The manual:
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

- [x] 1.5 (review-born; no estimate — overhead) The eight findings from
      group 1's review, in the reviewer's priority order. Three are
      substantive and five are hygiene:
      (a) **`check:crap` is red** — `columnPlanForResult` and
      `applyColumnOrderToQuery` fell below threshold because group 1's own
      unreachable throws are uncovered, and `validateIndexPredicates`
      crossed on complexity alone. Fix by **asserting the stubs**
      (hand-built `WithNode` → `"unreachable"`), which lowers CRAP and
      pins stub criterion 1 in the same stroke; extract 1.2c's branch in
      the third. The README CRAP block goes in the same commit.
      (b) **`encodeColumnRef` writes `schema: null` silently** for a CTE
      column while `decodeColumnRef` throws on it — an encode/decode
      asymmetry that commits an unreadable snapshot. Guard it in the
      shape `encodeFromNode` already uses, one function away in the same
      file.
      (c) **`orderedProjection` returns silently** where every other
      deferral throws; its own comment admits it. Make it throw.
      (d) `dsl/rls.ts`'s policy diagnostic interpolates `null.x.y` for a
      CTE column — the fifth declaration site of the class 1.2c closed.
      (e) `renderWith`'s visibility narrowing carries no group-6 deferral
      marker, so it reads as a finished rule.
      (f) `index-builder.ts`'s `#TBD` is `#464`; `render-sql.ts:250` defers
      wording to task 1.3, which is done — settle the text or drop the
      comment. Its `Next:` still tells a CTE subject to "join that table".
      (g) `assertCtesVisible`'s ~30-line comment block violates the
      comments rule — keep the content, move it to `design.md`, leave the
      invariant.
      Files: `packages/core/src/{expr/render-sql,expr/codec,dsl/rls,dsl/index-builder,snapshot/column-order,dsl/table}.ts`,
      `packages/query/src/db/convert.ts`, their tests, `README.md`.

- [x] 1.6 (~15m) Separate "declared" from "in scope". Found while writing
      1.5(f)'s test: `with a as (…), b as (…) select b.id from a` — `b`
      declared but never joined — **builds cleanly**, and Postgres rejects
      it (`missing FROM-clause entry for table "b"`), exactly as it
      rejects the same shape for a real table. This is a regression 1.3b
      introduced: to reach nested subqueries it injects every declared CTE
      name into `outerScope`, and `outerScope` feeds **two different
      questions** — `assertCtesVisible` asks "is this name declared
      anywhere in the WITH list" (the whole list is right) and
      `assertInScope` asks "was this column's source actually joined at
      this level" (the whole list is wrong). One channel, two meanings,
      and the second one silently answers yes to everything.
      Fix by making the two meanings structurally distinct: a render-time
      `DeclaredCteMarker` (`{ declaredCte }`) that lives in
      `render-sql.ts`, **not** in `ast.ts` — it is a rendering concept,
      not IR, and giving it a different key from `CteRefNode`'s
      `cteName` is what stops the two being confused again.
      `isInScope` ignores markers; `assertCtesVisible` accepts both.
      Measured: `OuterScope` is a type alias 18 sites already share, so
      widening the alias carries them; 5 literal spellings and the
      `scope` parameter of `isInScope`/`assertInScope`/
      `findForeignColumnRef` are the manual edits, all inside this one
      file. Red: `packages/core/test/expr/with-scope.test.ts` — "a column
      of a declared but unjoined CTE is refused". Files:
      `packages/core/src/expr/render-sql.ts`, that test.

## 2. Serialization and traversal — after group 1

- [x] 2.1 (~9m) Codec: the `with` token in the query-kind mapping plus
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
- [x] 2.2 (~7m) The traversal arms: `walk.ts`'s handler maps and
      `retarget.ts`'s arm, for the new node **and** for the widened `from`
      **and `JoinNode.table`** — a CTE reached through a join is reached
      through a different field than one in `from`, and only one of the
      two is exercised by 2.3's test unless both are written. The two walk
      maps carry different meanings — decide each;
      sharing one type does not mean they want the same answer. Red: the
      existing walker tests plus `packages/core/test/expr/walk.test.ts` —
      "a walk reaches an expression inside a CTE body". Files:
      `packages/core/src/expr/{walk,retarget}.ts`, that test.
- [x] 2.3 (~7m) Positive descent proof. The registries force a handler to
      be *written*, not to *descend*; `with: (node) => node` compiles and
      passes `retarget.test.ts`'s reference-identity loop. Red:
      `packages/core/test/expr/retarget.test.ts` — "a column referenced
      only inside a CTE body is rewritten by a rename". Files: that test
      only.
- [x] 2.4 (~6m) The negative pin, which is the sentinel-schema hazard the
      proposal rejects an alternative over: a table rename does **not**
      rewrite a same-named CTE reference or its columns. Prose in the
      proposal is not the form this claim ships in. Red: same file — "a
      table rename leaves a same-named CTE alone". Files: that test only.
- [~] 2.5 **moved to 4.5** — mis-sequenced here. The producer this task
      asks for is *a view whose body declares a CTE*, and `defineView`
      cannot accept one until 4.1 widens `ViewDeclaration.query`. The
      three ways out were: widen that type from group 2 (breaks 4.1's file
      ownership), cast around it in the fixture (defeats the fixture's
      whole point — it exists to prove the *type* accepts the value), or
      move the task. Moved. The window-function precedent that made this
      look possible is not the same shape: there, the hand-built node sat
      *inside* a `SelectNode`'s projection, and the view's own `query`
      field never changed type.

## 3. The builder surface — after groups 1–2

**Cross-team boundary.** `packages/core/src/query/select.ts` (task 3.3) is
shared: the fn team holds a narrow exception on it for #423 — one import
and one registration call at each of six factory sites, no logic. Signal
the lead when this group starts and when it lands, so the two edits are
sequenced; whichever reaches `dev` second rebases. The regions differ (a
factory body versus the `with()` entry point), so a conflict is unlikely
rather than impossible.

- [x] 3.1 (~10m) [design] `withCte()` as a statement root and the CTE
      reference it hands back. **The name is settled (lead, 2026-08-29)**:
      core's standalone export is `withCte`, the chain's method stays
      `with` (5.4). `with` cannot be a standalone export at all — it is a
      JS reserved word (`TS1389` on declaration, `TS1003` on a bare named
      import), and `deleteFrom` is the same escape for the same reason.
      D102 reserved a **chain method** named `with`, which is a property
      name and therefore legal; this task's earlier wording widened that
      reservation to a surface D102 never spoke about.
      **The shape is settled too (lead, 2026-08-29): a callback.**
      `withCte((w) => { const ranked = w.as("ranked", …); return
      select(…).from(ranked); })`. Chosen over a declarative entry array
      because a reference is then an ordinary local: `select()` needs no
      further signature work beyond 3.3, and **Postgres's earlier-siblings
      rule holds by construction** — you can only pass a reference you
      already hold, so a forward reference is unrepresentable rather than
      rejected. Group 6's two-stage callback extends the same object
      (`w.asRecursive(name, anchor, (self) => term)`). The accumulator
      inside `w` is push-only into a local const, the shape
      `plpgsql/body-context.ts` already uses; a `w` smuggled out of its
      callback is the same class as a smuggled reference and is caught by
      1.3c. Still settled here: what the reference exposes — one column
      per **projected** field, keyed by that field's key. Red:
      `packages/core/test/query/with.test.ts` — "a statement declares a
      named query and selects from it". Files:
      `packages/core/src/query/with.ts` (new), that test.
- [x] 3.2 (~8m) [design] The named row environment at the type level.
      **Settled (lead, 2026-08-29)**: a projected field's reference is
      `Omit<TValue, "exprNode"> & { exprNode: ColumnRefNode }` — **and
      `typeNode`/`sqlName` come off too**, uniformly, whatever the
      projection's shape. Taken literally the `Omit` above only weakens a
      *computed* field, because a whole-table or pass-through projection
      starts from a real `ColumnRef` and keeps its `typeNode`; that would
      make "a CTE reference cannot reach a declaration site" true of some
      fields and false of others — a rule that leaks is the shape this
      change argues against. Those two fields buy a CTE reference nothing
      on the query side (operators read `exprNode`/`family`), and what
      they buy on the declaration side is exactly what must not happen.
      Condition on this: confirm the read types of a whole-table CTE
      projection are unchanged by the strip — if `SelectResult` turns out
      to lean on `typeNode` for those, the cost is real and the uniform
      rule is renegotiated rather than paid silently.
      **Measured, and the prediction was wrong.** The strip itself is
      safe — `SelectResult` reads neither field. But the check surfaced
      two real defects, and one of them invalidates the mechanism this
      task was approved with:
      **⚠️ DISPUTED — this claim did not reproduce under independent
      review (group 3) and may not be written anywhere until it does.**
      The reviewer built a synthetic probe, evaluated the real type, and
      **reverted `CteFieldRef` to the `Omit` form and ran every gate**:
      `check-types` 13/13, the new pin tests 17/17, all green. The pins
      added for this defect instantiate `CteRowEnvironment` with a
      *concrete* type argument, which is the case that works under either
      form — so they cannot tell the two apart. The bar is one line:
      **reverting to `Omit` must turn a gate red.** Until it does, the
      remap form stays (it is not wrong, and it is more explicit) but its
      justification is "deliberate and explicit", not "measured TS
      defect", and nothing about it goes into the D105 row. The original
      claim, kept for the record:
      **`Omit` silently drops optional `unique symbol` keys when it is
      applied to a generic type parameter.** It compiles clean; the
      brands are simply gone. So `Omit<TValue, "exprNode">` does **not**
      preserve `ReadAs`/the origin brand "for free" — that claim was true
      of the intent and false of the code. The working form is a
      key-remapping mapped type (`as`-clause), verified against an
      isolated probe: `Omit` over a *concrete* type keeps the brands, over
      a generic it does not. **This is what the D105 row must say** — the
      brands are preserved, but by a specific device chosen after
      measurement, not by `Omit`.
      **RESOLVED, against the implementer — neither defect reproduces.**
      Re-tested both under the review's own bar (revert, force-rebuild
      `@hejbro/core`, run every gate) rather than defending the original
      claim: `CteFieldRef` reverted to `Omit<TValue, "exprNode" |
      "typeNode" | "sqlName">`, `check-types` clean, all pin tests green.
      `CteRowEnvironment`'s whole-table branch reverted to plain
      `CteFieldRef<TProjection[K]>` (no `ColumnRef & OriginBrand<...>`
      reconstruction), same result — `TProjection[K]` for `TProjection
      extends Table<TColumns>` already *is* `TableColumns<TColumns>[K]`
      (branded), so there was nothing to reconstruct. Root cause: the
      earlier "measured" session diagnosed a stale `packages/core/dist/
      index.d.ts` (fixed with `pnpm build --force`) *midway*, after
      already concluding both defects from readings taken against that
      same stale build, and never re-ran either claim cleanly afterward —
      an #448-class trap, this time against this package's own `dist`
      rather than a sibling worktree's. `CteFieldRef` **keeps** the
      key-remap form regardless (the reviewer's own call: behaviorally
      identical, states its own reduction directly) — its doc no longer
      says "measured", it says "written this way on purpose".
      `CteRowEnvironment` **reverts** to the simpler `TProjection[K]`
      form (no reason to keep the more complex one once it is not doing
      anything). The two `select-result.test.ts` tests stay — not as
      regression pins (nothing regresses on revert), but as ordinary
      correctness assertions worth having regardless. Two
      consequences, both load-bearing and both worth stating in the D105
      row: every type-level brand the projected value carried (`ReadAs`,
      the column-origin brand) is **preserved for free**, so no brand
      recovery logic is written; and the reference has **no `typeNode`**,
      so it is structurally not a `ColumnRef` and cannot reach a foreign
      key target or an index `.on(...)` **at the type level** — which
      demotes 1.2c/1.2d's runtime guards to a second line and promotes the
      first to unrepresentable, the ordering this change argues for in
      D105, realised on the user-facing surface. The premise was verified
      before the design: every comparison and filter operator reads only
      `.exprNode` and `.family` from its operand, and `.typeNode` is
      required only at declaration sites.
      **Measured after implementation — the claim holds for three of the
      six guards, not all six.** The type layer closes a site only where
      the parameter is typed `ColumnRef`: the foreign-key target, the
      foreign-key local column list, and `.references()`'s sugar. The
      other three take an expression (`Expr<"boolean">` / `Condition`) —
      an index predicate, an index's own column list, an RLS policy's
      `using`/`with check` — so a reference without `typeNode` still
      type-checks there and the **runtime guard remains the first line**.
      (`.on()` additionally splits on `isColumnRef`'s `sqlName`
      duck-typing and lands on a different code,
      `index-expression-foreign-column-ref`.) Say this per site rather
      than once, because it is not uniform; the first draft of those
      comments claimed closure at a site that is not closed, and the audit
      caught it.
      **One consequence to mark in the code** (review, group 2): where the
      type layer *does* close the builder path, that guard becomes
      unreachable from any builder — their tests already
      hand-assemble a null-schema reference. That is the intended
      ordering, but what it leaves behind reads like dead code: a guard no
      caller can reach, kept alive by a hand-built test. Leave one line at
      each guard saying the type layer is the first line and this is the
      **artifact path's** second (a decoded snapshot, a hand-assembled
      node), so the next reader deletes neither. Then: a
      computed field keeps its read brand outside the CTE (an
      `over(rowNumber(), …) as rn` is a `bigint` there, not `unknown`),
      and a column the CTE does **not** project is not reachable even
      though its source table declares it. This is the pair that makes the
      change's own motivating case work; nothing else pins it. Red: same
      file — "a projected window alias is filterable outside the CTE" and
      "an unprojected source column is not reachable". Files:
      `packages/core/src/query/with.ts`, that test.
- [x] 3.3 (~6m) `select()` accepts a CTE reference as its from-source, so
      the builder can express what group 1 can render. **Lands in the same
      commit as 3.1** (times and ticks stay separate): 3.1's red test says
      "declares a named query and **selects from it**", and until `from`
      is widened that test does not merely fail — it fails to type-check,
      taking `check-types` with it. The weaker test that compiles (using
      the reference only in `where`) is refused by 1.3/1.6's scope guard,
      correctly, so there is no honest intermediate state. Red: same file —
      "select(…, cteRef) builds a select whose from is the reference".
      Files: `packages/core/src/query/select.ts`, that test.
- [x] 3.4 (~6m) [design] The `materialized` hint on the builder surface,
      both values and the absent case. **Where it goes is this task's to
      settle** — `w.as(name, query, options?)` reads naturally now that
      3.1's shape is fixed, but decide it rather than inherit it, and
      remember 6.5: a `not materialized` hint on a **recursive** entry is
      accepted, because Postgres ignores it there rather than erroring. Red: same file — "an entry declares
      materialized, not materialized, or neither". Files:
      `packages/core/src/query/with.ts`, that test.

- [x] 3.5 (~4m) `assertNoForeignIndexExpressionColumn`'s message renders
      a CTE reference's schema as the string `"null"` — `null.ranked.id`.
      The guard's *decision* is right; only its text is wrong. This is
      the same defect 1.5(d) fixed in `rls.ts`, at a site that was
      unreachable with a null schema until this change made one, so it is
      **our exposure to close** — the general shape of the site is not
      ours to redesign. Red: `packages/core/test/dsl/cte-column-ref.test.ts`
      — "an index expression naming a CTE column names the CTE, not
      `null`". Files: that guard's home, that test.

- [x] 3.6 (~7m) Two diagnostics the builder can give and currently does
      not (group 3 review). Both are the failure class 1.3c exists to
      close — a statement that builds cleanly and fails on the server:
      (a) **a duplicate entry name.** `w.as("dup", …)` twice renders
      `with "dup" as (…), "dup" as (…)`, which Postgres refuses with
      `42712`, and the second reference silently shadows the first, so
      the statement that runs is not the one that was written. `entries`
      is a push-only local, so checking it inside `w.as` is immediate.
      Code: **`duplicate-cte-name`**, joining the existing family
      (`duplicate-identity`, `duplicate-index-name` — naming rule 2).
      (b) **no entries at all.** A callback that never calls `w.as`
      renders `with  select …`, a syntax error. Code:
      **`empty-with-list`**. Both messages carry a `Next:` clause.
      Red: `packages/core/test/query/with.test.ts` — "a duplicate entry
      name is refused" and "a with list with no entries is refused".
      Files: `packages/core/src/query/with.ts`, that test.

## 4. Views, column order, rename engine, preset validator — after group 3

- [x] 4.1 (~8m) `defineView` accepts a body that declares CTEs, and
      `view-kind`'s `leftmostSelect`/`viewQueryColumns` answer for one —
      a view's column list comes from the **body**, not from an entry.
      D103's one-vocabulary rule is the reason this group exists at all.
      Red: `packages/core/test/kinds/view-with.test.ts` — "a view whose
      body declares a CTE reports the body's columns". Files:
      `packages/core/src/dsl/define-view.ts`,
      `packages/core/src/kinds/view-kind.ts`, that test.
- [x] 4.2 (~7m) Column order: `applyColumnOrderToQuery` and the view path
      reach through the wrapper to the body. The oracle returns null for
      an unknown table, so a CTE reference is inert by construction —
      assert that rather than assume it. Red: same file — "column order
      applies to a CTE-declaring view's body, and a CTE reference is left
      alone". Files: `packages/core/src/snapshot/column-order.ts`, that
      test.
- [x] 4.3 (~7m) The rename engine's view path (`retargetViewQuery`)
      descends through a `WITH`. This is a different registry from 2.3's
      and gets its own red test for the same reason 2.3 exists. Red:
      `packages/core/test/engine/rename-with.test.ts` — "a rename rewrites
      a column referenced only inside a stored view's CTE body". Files:
      `packages/core/src/engine/rename/retarget.ts`, that test.
- [x] 4.5 (~7m, was 2.5) A `reachable-kinds` producer — a view whose body
      declares a CTE — so D70's completeness assertion sees the new
      vocabulary. **Runs after 4.1**, which is what makes such a view
      constructible at all. The producer lives in the in-memory fixture,
      **not** in `test/golden/cases/`: the goldens stay unchanged (see
      Verification). Also confirm here what group 1 deferred on the
      strength of this task: `encodeQueryNode` deliberately does not take
      a `WithNode`, classified as a documented boundary rather than a stub
      **because this assertion was expected to force the question**. If it
      does not go red for that boundary, the classification was wrong and
      the boundary needs its own marker. Red:
      `packages/core/test/naming-conventions.test.ts` completeness. Files:
      `packages/core/test/expr/reachable-kinds.ts`, that test.
- [x] 4.4 (~8m) The Supabase preset's `view-security-invoker` validator,
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
- [ ] 5.4 (~9m) [design] The chain's own `with()` — **this one keeps the
      bare name**: a chain method is a property, so the reserved word is
      legal there, and D102 reserved exactly this slot. The asymmetry with
      core's `withCte` is deliberate and gets one line in the skill, so
      the next reader does not rediscover it. Settled here: that it
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
      Files: `packages/core/src/query/with-recursive.ts` (new),
      **`packages/core/src/expr/render-sql.ts`** (the visibility narrowing
      lives there and must learn about `recursive` — review found the
      original file list could not have satisfied this task's own
      precondition), that test.
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
      entry is **accepted and ignored**, not an error (6.5's premise); the
      two shapes 3.6 refuses at build time are refused by the server too,
      both now measured — a duplicate entry name at `42712`, an empty
      `WITH` at `42601` (measured at group 3 review, closing the one place
      this change had written a diagnostic from a rendering it only read);
      and
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
- [ ] 7.3 (~5m) Also settle one shape review flagged at group 1:
      `DeclaredCteMarker` is unexported yet appears in the signatures of
      the public `renderQuery`/`renderSelect`/`renderSelectInto`. Builds
      and type-checks pass (the dts inlines it) and callers can still
      pass `FromNode[]`, but they cannot name that parameter's type.
      Export it or narrow the public wrappers — decide, do not inherit.
      Then the published-surface assertion block in
      `packages/cli/test/exports.test.ts`. **No longer gated** — the team
      that held that file finished and dissolved (lead, 2026-08-29), so
      its final version is on `dev` and this change meets it at the last
      rebase like any other file. `packages/cli/src/index.ts` needs no
      edit: it re-exports core with `export *`.
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
- [ ] 7.7 (~6m) The **surface delta**, in the standard five-part form
      (lead, 2026-08-29): ① each added symbol with its "not expressible by
      composing what exists" + "name symmetric with its siblings"
      argument; ② widened parameters classified **separately** — those are
      asymmetry removed, not surface added (`from`/`JoinNode.table`
      accepting a CTE reference, `ColumnRefNode.schemaName` going
      nullable); ③ the count of new top-level exports backed by a
      machine check (`exports.test.ts`), not by hand; ④ new diagnostic
      codes with whether each follows an existing naming family
      (`undeclared-cte` took its own; the declaration-site guards joined
      `foreign-column-ref`'s — say **why one change went both ways**, at
      the entry itself); ⑤ one sentence of overall judgement on
      consistency-for-surface; ⑥ the **deliberate non-additions** and
      their reasons.
      The justifications are **collected, not invented here** — each was
      recorded where the symbol landed (standing note above). This change
      adds more symbols than most, so ① carries real weight: `withCte`
      (reserved word forces the name; the callback shape removed a second
      change to `select()`'s signature), `w.as`, the chain's `with`, and
      group 1's node types, which reach users through `hejbro`'s
      `export *` whether or not they were meant to. Note the deliberate
      *non*-additions too — the output column alias list was excluded to
      keep one source of truth for a row's key names. Goes in the PR body
      and the merge declaration.
- [ ] 7.8 (~5m) The **probe recipe**, for #476. The `Omit`-over-a-generic
      brand loss found at 3.2 is not local to this change: a repo-wide
      sweep found the same shape at `expr/window.ts`'s
      `WindowFunctionCall` and `expr/aggregate.ts`'s `Aggregated`. Write
      down, in `design.md`, how the isolated probe distinguished the two
      cases (`Omit` over a **concrete** type keeps optional `unique
      symbol` keys; over a **generic parameter** it drops them, silently
      and with a clean compile) and where the regression tests that pin
      the fixed behaviour live, so #476's handler reuses the method
      instead of rediscovering it. Point the PR body at that section.

- [ ] 7.6 (~10m) The `blackbox/` entry (D89) — an owner-driven change
      carries one in the same PR: what was asked, what was built, why, and
      the internal processing, with per-file git blob SHA pins per
      `blackbox/README.md`. Include what went wrong on the way; a record
      that lists only what worked is not a flight recorder. Known already:
      the planner's own mis-instruction to quote the design log's D5 when
      the parked D5 is #299's internal number (caught by the lead before
      any work was based on it), and the fact that the filed fork read as
      one question but was two. The running list, kept here so it is
      collected rather than reconstructed:
      **Planner errors.** The D5 mix-up. A handoff sent at a stale SHA
      twice, the second time making the reviewer report a defect
      (unticked checkboxes) that was already fixed — the cost of sending
      a correction while messages crossed, closed by confirming "no more
      commits + clean status" before fixing a SHA. A claim in this file's
      own header — "the registry forces this handler" — that was false
      for `retarget.ts` and was copied from here into a source comment;
      both had to be fixed, and fixing only the source would have let the
      next task spread it again. Task 6.1's file list omitting the file
      its own precondition lives in. Task 2.5 placed in group 2 on a
      surface resemblance to add-window-functions, where the hand-built
      node sat *inside* a `SelectNode` and the view's own field never
      changed type — **the lesson is that a resemblance is not a
      precedent unless the layer that changes is the same one**. Stub
      totals miscounted twice by hand, fixed by taking the count from the
      list's own length.
      **Caught before code, seven times.** Two files outside any group's
      list; a test 1.3c would have broken; 2.5's sequencing; the reserved
      word `with`; a red test that could not compile without 3.3; and the
      one that differs in kind — the `typeNode` strip, which corrected a
      claim the planner had **already reported upward**, so a false
      sentence was on its way into the D105 row rather than into code.
      **The one that got furthest before it was caught.** A "measured"
      type-system defect — `Omit` dropping brands through a generic — was
      reported up, believed, and acted on: the lead swept the repo, found
      two more sites of the same shape, and filed them. Independent review
      then failed to reproduce it four ways, including the only test that
      matters (revert to `Omit`, run the gates — all green). Root cause: a
      **stale `packages/core/dist/index.d.ts`**. The staleness was
      correctly diagnosed mid-investigation, but the two findings made
      *before* that diagnosis were never re-derived from a clean build.
      The standing rule this earns: **a stale-artifact diagnosis
      invalidates every measurement taken before it — re-run them, do not
      reason about which ones were affected.** Two more: the regression
      tests added for the "defect" instantiated the type with concrete
      arguments, so they passed under both forms and pinned nothing —
      **a pin that stays green when you restore the bug is not a pin**;
      and the amplification path (implementer → planner → lead → issue →
      memory) had no verification step at any hop, each trusting the one
      before.
      **What the process caught that review would not have.** 1.6's
      regression surfaced while writing the red test for an unrelated
      review finding: `select b.id from a` with `b` declared but unjoined
      had been passing since 1.3b, because one channel was answering two
      questions. And the `cli` failures that took six exchanges before
      anyone ran the documented remedy — the lesson there is that "it
      fails the same way every time" is an observation, not a diagnosis.

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
