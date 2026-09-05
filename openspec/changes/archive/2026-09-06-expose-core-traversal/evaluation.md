# D106 evaluation — expose-core-traversal (round 1)

## Method

Context-free, spec-only. Inputs read: the delta
(`openspec/changes/expose-core-traversal/specs/package-surface/spec.md`),
the base spec (`openspec/specs/package-surface/spec.md`), the user-facing
docs (`skills/hejbro/references/extension-interface.md`,
`skills/hejbro/references/supabase-preset.md`, `query-layer.md`,
`dsl-cheatsheet.md`, `.changeset/expose-core-traversal.md`, `README.md`).
Not read: proposal/design/tasks, `.blackbox/`, any `packages/*/src` or
`packages/*/test`, PR/issue bodies, git log messages.

Worktree at dev `a2ae6036`, `pnpm install --frozen-lockfile` +
`TURBO_FORCE=1 pnpm build --force`. Probes lived in `/private/tmp/d106-ct/`
(deleted afterwards) as a stand-alone ESM package that resolves
`@hejbro/core`, `@hejbro/query`, `@hejbro/supabase` and `hejbro` through
symlinks to the built packages — i.e. the way a preset author imports them.
Types were probed with `tsc --strict` (signatures revealed by assigning
each export to type `1` and reading the error); runtime behaviour with
`node`. No database was needed.

Row counts: **43 type-level assertions** (tsc) / **194 runtime probe
executions** (node), plus the five pinned suites re-run without cache
(`@hejbro/core` 2255, `@hejbro/query` 1125, `@hejbro/supabase` 181,
`hejbro` 1396, `preset-smoke` 5 — all passing).

Every sentence of the delta was turned into inputs:

1. Registry coverage — one expression per node kind the delta lists
   (`comparison`, `logical`, `not`, `nullTest`, `inList`, `between`,
   `functionCall`, `sqlTemplate`, `window`, `aggregateFilter`, the four
   leaf kinds `literal`/`rawSql`/`columnRef`/`plpgsqlRef`, and
   `exists`/`selectExpr`) with a marker in every child position, at
   nesting depth ≥ 3, inside `exists`/`selectExpr` subqueries, in a
   `with` body, in CTE entries and across `union`/`unionAll` branches.
   Each was run through (a) `exprChildren`/`replaceExprChildren`
   directly, (b) `@hejbro/query`'s `compile()` (literals → `$n`), and
   (c) `@hejbro/supabase`'s validators (`auth.uid()` →
   `rls-uncached-auth-call`). Window/aggregate-filter positions cannot
   be placed in a policy through the DSL (`rls-policy-window-function`
   refuses at declaration time), so those were injected by patching the
   policy *declaration*'s `using` node before `buildSnapshot`.
2. `replaceExprChildren` with: the same references, structurally-equal
   copies, reversed order, one fewer, one more, all replaced, empty.
3. `requireNext`/`requirePrevious`/`requireBoth` on next-only,
   previous-only, both, neither, `undefined` sides, and falsy JSON sides
   (`0`, `""`, `false`); the same four shapes through
   `storageBucketKind.emit`, `preset-smoke`'s `schemaNoteKind.emit`, and
   core's own `table`/`schema`/`policy`/`view` kinds for the wording
   comparison the delta makes ("as core's own kinds do").
4. Barrel visibility: value import of the five from `hejbro` (tsc +
   `Object.keys(await import("hejbro"))`), `import type` + `typeof` from
   `hejbro`, value import from `@hejbro/core`.
5. Doc conformance: every signature and claim in
   `extension-interface.md` § "Traversal and kind-change helpers".

## Blocking findings

None.

## Non-blocking findings

Neighbours the delta is silent on, or wording that is true but wider
than what can be checked from outside. None contradicts a delta sentence.

**NB1 — `replaceExprChildren` accepts a wrong-length list silently.**
The delta promises "a function rebuilding a node from replacement
children in that order"; the doc adds "a same-length replacement list"
as a precondition. Neither says what happens otherwise, and nothing
refuses: `replaceExprChildren(eq(age,1), [ageRef])` returns
`{"nodeKind":"comparison","operator":"=","left":…}` with no `right`;
`[]` returns `{"nodeKind":"comparison","operator":"="}`; a longer list
drops the surplus. The malformed node only fails later, at render, as a
raw `TypeError: Cannot read properties of undefined (reading 'map')`
(`window`, `aggregateFilter`) or renders a wrong statement (a `between`
with one bound rendered from `undefined`). For an extension surface a
coded refusal (`invalid-expr-children-count` or similar, naming the kind
and both lengths) or a spec sentence declaring the precondition would
close this.

**NB2 — An unknown `nodeKind`, or a DSL `Expr` wrapper passed instead of
its `.exprNode`, throws a raw `TypeError`.** `exprChildren({nodeKind:
"bogus"})` → `TypeError: Cannot read properties of undefined (reading
'read')`; `replaceExprChildren(…)` → `(reading 'replace')`. The first
thing a preset author does is pass `eq(t.a, 1)` itself (the DSL value,
whose node is under `.exprNode`) — and gets the same TypeError, not a
`HejbroError` telling them which shape the registry takes. The delta is
silent on malformed input; the rest of core refuses with coded errors
(`malformed-snapshot-node` for the same discriminator in
`decodeExprNode`).

**NB3 — The guards refuse `null` but pass `undefined` through.**
`requireNext({…, next: undefined})` returns `undefined` with no refusal.
Unreachable from typed code (`KindChange.next` is `JsonValue`, and the
diff engine never produces `undefined`), so this is only a note for the
"refuses a change that carries none" wording: "none" is `null` in the
type, and the guard checks exactly that.

**NB4 — The storage-bucket kind's `drop` reads neither side, so the
scenario's "one that does not [carry the side it needs]" has no `drop`
instance for that kind.** `storageBucketKind.emit({operation:"drop",
previous:null, next:null})` → `[]` (its drop emits no SQL by design, per
`supabase-preset.md`). `create` with no `next` refuses as promised:
`invalid-kind-change` — `supabase-storage-bucket create change is missing
its next snapshot.` (kind token, matching core's `table create change is
missing its next snapshot.`). `preset-smoke`'s kind refuses on all three
operations with the same shape (`smoke-schema-note drop change is missing
its previous snapshot.`). Scenario holds; recorded only because a reader
may expect a drop refusal from the bucket kind.

**NB5 — "`hejbro`'s classification test names each as engine" is
verified deductively, not by a test title.** The suite's tests are
titled "classifies every runtime export of @hejbro/core exactly once",
"re-exports every vocabulary name and no engine name" and "pins the
barrel's runtime export set by set equality" — none names the five. From
outside: all 221 core runtime exports are classified exactly once (test
passes), the five are absent from `hejbro` at runtime (measured), so
they can only be in the engine list. True, but the scenario sentence
reads as if a test literally names them; a reader without the test
source cannot confirm that reading.

**NB6 — The validator detects the `auth.uid` *call node* only.** A
`` sql`${d.owner} = auth.uid()` `` fragment (text, not a `functionCall`
node) raises no `rls-uncached-auth-call`. Consistent with the traversal
contract (text is not a child) and with `supabase-preset.md`'s wording
("calls the plain `auth.uid()`/`auth.jwt()` instead of
`authUidCached()`"), but a user who writes the escape hatch gets no
warning. Outside this delta.

**NB7 — Out of scope, observed in passing:** `literal(7)` from
`@hejbro/core` builds `{"literalKind":"boolean","value":7}` and renders
`true` — the DSL's `literal` is typed boolean-only and an untyped caller
bypasses that. Not touched by this change; noted for whoever owns the
DSL.

## Scenarios verified

| Delta sentence | Input | Observed | Holds |
|---|---|---|---|
| Traversal returns children "in a fixed order" | 17 node kinds | `comparison` [left,right]; `logical` operands in order; `not`/`nullTest` [operand]; `inList` [operand, …values]; `between` [operand, lower, upper]; `functionCall` args; `sqlTemplate` interpolations in order; `window` [fn, …partitionBy, …orderBy exprs]; `aggregateFilter` [fn, where]; `literal`/`rawSql`/`columnRef`/`plpgsqlRef`/`exists`/`selectExpr` → `[]` | ✅ |
| Rebuild "from replacement children in that order" | reversed lists | `1 = "age"`, `9 between 1 and "age"`, `coalesce('n/a', "name")`, `f('x', "name")` — order is positional | ✅ |
| Doc: returns `node` itself when every child is reference-identical | same refs vs JSON copies | same refs → `===` true for all 17 kinds; copies → new node, equal JSON | ✅ |
| Guards yield next / previous / both, refuse with `invalid-kind-change` | 4 side combinations × 3 guards | 12/12 as specified; message `<kind> <op> change is missing its next|previous|previous or next snapshot.`; falsy JSON sides (`0`, `""`, `false`) pass through | ✅ |
| "names the change by its kind token, as core's own kinds do" | bucket / smoke / core kinds | `supabase-storage-bucket create change…`, `smoke-schema-note drop change…`, `table create change…`, `policy alter change…` | ✅ |
| "the refusal code is unchanged" | all refusals | every one `code === "invalid-kind-change"`, `HejbroError` | ✅ |
| Lifter reaches every child | literals at 12 positions, depth 3 | `$1…$12` in render order, params `[1,2,"three",…,12]` | ✅ |
| Lifter: window fn/partition/order, aggregate filter fn/where, filter-over-window | 7 literals | `$1…$7` in render order | ✅ |
| Query positions are not expression children but the lifter reaches them "through its own query walk" | literals inside `exists`, `selectExpr` (jsonObject/jsonArray), `union`/`unionAll` branches, `with` entries (incl. a set-op entry and an `exists` inside an entry), the `with` body | all lifted, `$n` numbered in render order across branches and CTE entries | ✅ |
| RLS validator reaches every child | `auth.uid()` at 21 positions incl. depth 3, `exists`, nested `exists`, `selectExpr`, window fn/partition/order, aggregate-filter fn/where (last six via declaration patch) | `rls-uncached-auth-call` at each; control (`authUidCached()`, or no auth call) → none | ✅ |
| "absent from the `hejbro` barrel at runtime" | `Object.keys(await import("hejbro"))` | 118 exports, none of the five | ✅ |
| "a value import … from `hejbro` … is a compile-time error" | 5 value imports | 5 × `TS1362: 'X' cannot be used as a value because it was exported using 'export type'` | ✅ |
| Base spec: engine name stays "visible to the type checker … usable in a `typeof` position" | `import type { … } from "hejbro"` + `typeof` ×5 | compiles under `--strict` | ✅ |
| "the second [import from `@hejbro/core`] resolves" | value import ×5, typed use of each | compiles; runtime `typeof === "function"` ×5 | ✅ |
| Signatures in `extension-interface.md` | tsc reveal | `(node: ExprNode) => readonly ExprNode[]`, `(node, children: readonly ExprNode[]) => ExprNode`, `(change: KindChange) => JsonValue` ×2, `(change) => { readonly previous: JsonValue; readonly next: JsonValue }` | ✅ |
| Doc: descend with `existsChildExprs`/`selectExprChildExprs` | exists / selectExpr nodes | `["logical"]`, `["columnRef","comparison"]` (query's where / projection + where) | ✅ |
| "the behaviour each site's own tests pin is unchanged" | forced re-run | core 2255 / query 1125 / supabase 181 / hejbro 1396 / preset-smoke 5 — all pass | ✅ |
| Changeset text | `.changeset/expose-core-traversal.md` | names the five, `minor` on `@hejbro/core`, states the bucket wording change and unchanged code — matches observed | ✅ |

Not verifiable from outside (recorded, not counted): "no package-local
table of child positions exists in either" and "neither kind holds an
inline guard" are source-structure claims; the observable consequence
(identical child order and identical refusal text across all consumers)
was checked instead.

## Verdict

**ARCHIVE.** 0 blocking, 7 non-blocking (NB1/NB2 are the two worth a
follow-up: a coded refusal for wrong-length replacement lists and for an
unregistered/undelegated node shape). Rows: 43 type assertions / 194
runtime executions, plus 4,962 pinned tests re-run green.
