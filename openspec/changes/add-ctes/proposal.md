# Proposal: add-ctes

## Why

`add-window-functions` shipped `over(...)` and named what it could not
express:

> **Filtering on a window result** — that needs a subquery or CTE, which
> is #417.

There is no subquery to fall back on. `SelectNode.from` is a
`TableRefNode` and nothing else, and a derived table (`from (select …)
as t`) does not exist anywhere in this codebase — not in selects, not in
`update … from`, not in `delete … using`. So "take the top three rows per
category" has exactly one expression today: the `sql` escape hatch, which
returns `Expr<"unknown">` and skips every scope check the builder makes.

This change is the third of #299's three (owner brainstorm 2026-08-28),
deliberately last so its largest fork is settled over landed set-operation
and window terrain. It settles the parked fork — recorded as D5 in that
brainstorm, which is **not** the design spec's D5 (`Generic Postgres core
+ provider presets`) — and lands it as a new decision-log row.

## What Changes

- **`with()` becomes a builder root**, before `select()`. D102 reserved
  this exact name for this exact purpose: it named the relational sugar
  `related()` because "a chain method named `with` would collide with SQL
  `WITH` when #299 lands CTEs". The reservation is now spent.
- **One new statement node**: `WithNode` — a `QueryNode` variant carrying
  a list of named queries and a body (`SelectNode | SetOpNode`), snapshot
  token `with`. The list, not the entry, carries `recursive`, matching
  Postgres's own grammar. Each entry carries an optional `materialized`
  hint.
- **`from` widens into a `FromNode` union** — a table reference or a CTE
  reference — and so does a join's target. A CTE name is neither a schema
  nor a table, so it renders unqualified and scope-checks against the
  enclosing `WITH` list rather than against a declared table. Joining is
  not an extra: the motivating case rejoins the ranked CTE to its source
  table to carry detail columns, so a CTE usable only in `from` would
  close half of what this change exists for.
- **A named row environment.** A CTE reference exposes its own columns —
  including computed ones, which is the whole point: `over(rowNumber(),
  …) as rn` in the CTE, `where(rn <= 3)` outside it. The row type is
  computed by `SelectResult`, which already does this and already carries
  the `ReadAs` brands aggregates and window functions attach.
- **Recursive CTEs.** `with recursive` over a `UNION`, which is why this
  change was sequenced after set operations. Postgres's grammar is `UNION
  [ ALL | DISTINCT ]` — #417's own wording ("require union all") is
  narrower than the manual, and both forms work here because `SetOpNode`
  already carries `all` as a boolean. The anchor term fixes the row type;
  the recursive term receives a reference to the CTE being defined.
- **A view body may carry a WITH.** A view is a named select; if the
  select vocabulary has CTEs and `defineView` refuses them, the vocabulary
  is lying — the same asymmetry D103 rejected for set operations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `query-builder`: the `with()` root, CTE references as a from-source,
  `recursive`, the `materialized` hint, and the emitted SQL.
- `query-type-inference`: the named row environment — what a CTE
  reference's columns are typed as, and how the anchor term's type reaches
  the recursive term.
- `query-execution`: the chain surface's own `with()`, and result
  conversion for a statement whose result columns come from a body nested
  under a `WITH`.
- `snapshot-format`: a stored view body may contain a `with` node.

## Impact

- **Affected code**: `packages/core` (`expr/ast.ts`, `expr/render-sql.ts`,
  `expr/codec.ts`, `expr/walk.ts`, `expr/retarget.ts`,
  `expr/select-children.ts`, `query/select.ts`, a new `query/with.ts`,
  `kinds/view-kind.ts`, `dsl/define-view.ts`, `engine/rename/retarget.ts`,
  `snapshot/column-order.ts`, `index.ts`), `packages/query`
  (`compile/compile.ts`, `compile/params.ts`, `db/chain.ts`,
  `db/convert.ts`, `types/`), `packages/supabase`
  (`validators/view-security-invoker.ts`), `packages/pg` integration
  witness, `skills/hejbro`.
- **Breaking**: none — additive throughout. `from` widening into a union
  is source-compatible for every existing caller, which passes a table.
- **Snapshot**: format 8 extended in place, no bump. A new discriminator
  is vocabulary (D73), the `selectExpr` and `set-op` precedent. Existing
  declarations' serialization is expected to stay **byte-identical** — see
  below.
- **Decision log**: adds D105 (the D5 resolution).
- **Depends on**: nothing outstanding. Window functions are archived; set
  operations, which recursive CTEs build on, are archived.

## D105: why a statement node and a from union, not a select field

The fork as filed reads as one question. It is two: **where the WITH list
lives**, and **how a CTE reference reaches `from`**. Option B — a
`SelectNode.with` side-channel plus bare-name scope extension — answers
both with a field on `SelectNode`. It is rejected on three measured
grounds, and the sentinel-schema variant of option A is rejected on a
fourth.

**A field is enforced by nothing.** Measured on this worktree, an optional
`with?:` on `SelectNode` — the shape any real design would pick, since
almost no select declares a CTE — produces **zero** compile errors across
`@hejbro/core`, `@hejbro/query`, `@hejbro/supabase` and `hejbro`. Not one.
`SELECT_CLAUSE_TRAVERSALS` does not even ask for an entry: it is keyed by
`[K in keyof SelectNode]`, and a mapped type preserves the optional
modifier, so the one ratchet built to catch exactly this never fires. Made
required instead, the field yields **3** errors — all of them "you left a
key out of an object literal" (`decodeSelectNode`, the traversal table,
`select()`'s own constructor) and none of them asking what the CTE *means*
— plus 28 test fixtures to update, which is churn, not safety.

**And the one entry it could force would be a lie.** Every entry in the
traversal table returns `ReadonlyArray<ExprNode>`, and a CTE body is a
`SelectNode`, not an expression, so the only entry that type-checks is
`noExprs("…")`. The parameter numbering in `@hejbro/query` walks exactly
this table, so literals inside a CTE body would never be lifted to `$n`;
they would be inlined into the rendered SQL text. The file states this
limit about itself:

> **The ratchet's limit**: this table forces an *entry*, not a correct
> traversal. … The type-level guarantee is "you cannot forget to decide";
> it is not "you decided correctly".

This is the same defect class as #444's `having` literals, arriving
through the one ratchet built to prevent it. The ratchet is not at fault:
it guards the expression axis, and a CTE body is off that axis entirely.

**A field would round-trip a view into a different view.** This one was
measured rather than reasoned, and the measurement is worse than the
argument was. `encodeSelectNode` is a closed object literal returning
`JsonValue`, so omitting the new field is **not** a type error: in the
required-field probe the encoder stayed silent while only the *decoder*
turned red. A view declaring a CTE would serialize without it and come
back as a view that never had one — silent corruption of this project's
own artifact, the failure D104 named for window functions, reproduced here
by measurement. Writing the field into the encoder instead is the other
horn: it emits unconditionally, so every select ever stored changes shape
— goldens, example chains, migration banner hash lines.

**A field is enforced in zero places; the shapes we chose are enforced in
28.** Measured: the `FromNode` union produces **18** compile errors across
**7** files, and the `WithNode` variant **10** across **4**, with **zero**
test-fixture churn in both — existing fixtures build table references,
which stay assignable to a widened union. D104's ordering applies:
**unrepresentable beats detectable beats checked**, and only these two
shapes are even detectable.

**The union's errors land where the meaning lives.** The 18 are not
scattered: they are `renderTableRef` and the eight scope-carrying clause
renderers, `walk.ts`'s scope assembly, `retargetSelectNode`,
`applyColumnOrderToSelect`, `encodeSelectNode`, `convert.ts`'s result
column plan, and — the one that matters most — the Supabase preset's
`view-security-invoker`, which collects the tables a view reads to warn
about RLS bypass. Under the union that validator **cannot compile** until
it says whether a CTE body's tables count. Under a field it compiles
untouched while the case is reachable, so a view that reads an RLS-guarded
table inside a CTE slips past the warning in silence. That is the
difference between a shape that surfaces its own security question and one
that hides it.

**Why not reuse `TableRefNode` with a sentinel schema.** A CTE reference
could be a `TableRefNode` with an empty `schemaName`. It has one real
merit — the rename engine matches on `(schema, table)` together, and no
declared table can have an empty schema (`assertSqlName` refuses it), so a
table rename could never retarget a same-named CTE. It is still rejected:
unqualified rendering and scope checking become runtime special cases on a
magic value rather than arms the compiler demands, which is the bottom of
D104's ordering. The variant of this idea that uses a *plausible* schema
string instead is not merely weaker but actively unsafe — it is a live
path for a table rename to rewrite an unrelated CTE's column references.
That hazard is pinned by a test rather than described in prose.

**What the from union costs, honestly.** Eighteen call sites stop
compiling, and each one is a decision someone has to make rather than a
mechanical edit — what an unqualified name renders as, what scope a CTE
name is checked against, what a rename does with one, how it encodes. The
diagnostic text in `assertInScope` is written around `schema.table` and
reads wrong for a CTE. That is real work, and it is also the point: those
same sites would need finding **by hand** under any shape that hides a CTE
behind a table reference, and the measurement above says the hand-search
would start from zero compiler help.

**The two questions are independent, and both answers are measured.** The
`WithNode` variant and the `FromNode` union are not alternatives to each
other; the filed fork's option B is "side-channel *plus* bare names", and
its bare-name half has a third form worth naming — keep `from` as
`TableRefNode` and smuggle a CTE name through it. That form changes no
type at all, so its enforcement is zero by construction, and it is the
sentinel variant rejected next.

## Why CTEs are legal in view bodies

D103 settled this shape once already, for set operations: a capability
that exists in the query layer but is refused by `defineView` makes the
one-vocabulary promise false, and the asymmetry is not paid for by any
safety it buys. The same reasoning applies unchanged here, and the
practical case is ordinary — "top N per group" as a view is a window
function over a CTE.

Excluding data-modifying CTEs (below) is what keeps this clean. The
`WithNode` this change lands wraps a select or a set operation only, so
there is no half-storable node: every `WithNode` that can be built can be
serialized. D94's boundary rule — mutations never reach a snapshot — is
not approached, let alone split.

## Why recursive CTEs are in this change

The sequencing argument is the strongest one. #299 put CTEs last
*because* recursive CTEs need a `UNION`, which set operations landed. If
recursion moved to a follow-up, the ordering that shaped three changes
would have bought nothing. Beyond that: tree and graph traversal — org
charts, comment threads, category trees — is the case CTEs are known for,
and "hejbro supports CTEs" without it would be read as covering exactly
what it does not.

Recursion also costs something the non-recursive shape gets for free, and
it is worth stating rather than discovering. Without `RECURSIVE`, Postgres
lets an entry reference "only sibling `WITH` queries that are earlier in
the `WITH` list" — and in this builder that rule needs no enforcement at
all, because a later entry is written with only the earlier entries'
references in hand. Forward reference is *unrepresentable*, the top of
D104's ordering, at no cost. `RECURSIVE` makes forward references legal in
Postgres, so what was a structural guarantee becomes a capability this
change deliberately does not offer (see Out of scope).

The runtime cost is small: `SetOpNode` already carries `all`, and the
renderer already recurses through branches. The cost is concentrated in
the type layer. `select(projection, from)` resolves its projection
immediately and returns a stage whose type is already fixed, so there is
no position in that signature where "the CTE currently being defined"
could be injected. The shape that works is a two-stage callback: the
anchor term fixes the row type, and the recursive term is written inside a
callback that receives a reference typed from it.

Because that risk is real and local, recursion is sequenced last and the
non-recursive groups ship independently of it. If the two-stage callback
cannot be typed without degrading inference or error messages, that is
reported with its reason and the scope is renegotiated — not quietly
narrowed.

## Out of scope

- **Data-modifying CTEs** (`with x as (insert … returning …)`). Four
  reasons, in increasing order of weight: the mutation renderers have no
  shared prefix hook to hang a `WITH` on; the CTE's row type would gain a
  second producer (`ReturningNode` beside `ProjectionNode`); the body type
  would widen from `SelectNode | SetOpNode` to the whole `QueryNode`
  union, activating every consumer that currently cannot receive a
  mutation; and, decisively, it collides with D94 — the codec states that
  "mutations never reach a snapshot, so they have no snapshot form", so
  the node would split into a storable half and an unstorable one, and the
  view-body legality settled above would have to be qualified per entry.
  Postgres also restricts these to the top-level statement, and states
  plainly that "recursive data-modifying statements are not supported" —
  so the two capabilities this change would be combining have an empty
  intersection by the manual's own rule. They are a grammar of their own,
  not a widening of this one.
- **A `WITH` attached to a mutation** (`with x as (select …) insert into
  …`). Independent of the previous item and cheaper, but not needed by
  anything this change exists for. Because `WithNode` wraps a body, its
  body type can widen later without moving the node.
- **`SEARCH` and `CYCLE` clauses** on recursive CTEs. Postgres's own
  ordering and cycle-detection sugar; both are expressible by hand in the
  recursive term, and neither is needed to make recursion usable.
- **Forward references between entries, and mutual recursion.**
  `RECURSIVE` makes an entry referencing a later one legal in Postgres,
  but this builder hands each entry only the references declared before
  it, so a forward reference cannot be written. Mutual recursion is not
  offered either, and Postgres does not implement it ("circular
  references, or mutual recursion, are not implemented"). Neither is a
  rejection with a diagnostic; both are simply unexpressible, and the
  documentation is where that is recorded.
- **The output column alias list** — `with x (a, b) as (…)`. Postgres's
  grammar allows renaming a CTE's output columns at the declaration site;
  the same result is available by aliasing inside the entry's own
  projection, which is where this change's named row environment already
  reads its keys from. Supporting both would give one row shape two
  sources of truth for its key names.
- **Named `WITH` reuse across statements.** A CTE is scoped to the
  statement that declares it; nothing here caches or shares one.
