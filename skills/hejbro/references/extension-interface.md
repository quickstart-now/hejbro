# Object-kind extension interface

Read this when writing or reading a custom `ObjectKind` (a preset's own
kind, e.g. `packages/supabase`'s storage bucket kind).

`ObjectKind` (`packages/core/src/kind/object-kind.ts`) is the extension
interface itself. Beyond `owns`/`serialize`/`identify`/`diff`/`emit`, it
carries these narrower members:

- `dependsOn: ReadonlyArray<string>` — other kinds whose creates must
  land before this kind's own (drops reverse); every kind sets this.
- `dependsOnIdentities?(node): ReadonlyArray<string>` — the identities of
  *other objects of the same kind* a node depends on existing (a table's
  own foreign-key targets, self-reference excluded, duplicates
  collapsed); refines create/drop order within one kind. Only `tableKind`
  implements it.
- `ownerTableIdentity?(node): string` — the table identity a node
  belongs to, for a kind scoped to one table.
- `requiredKeys?: ReadonlyArray<string>` — top-level snapshot keys this
  kind's own `serialize` always produces, checked at parse time.
- `noCatalogObjectReason?: string` — states that no catalog object ever
  backs this kind's declared objects, and why.
- `canonicalize?(node: JsonValue): JsonValue` — reorders a serialized
  node's set-shaped arrays into their canonical order (#701); implement
  it when a kind's snapshot carries an array whose element order isn't
  semantically meaningful (`policy.roles`, `trigger.events`, `table.
  indexes`/`checks` are the built-in cases). `buildSnapshot` applies it
  right after `serialize`, and `diffSnapshots`/`snapshotChangedFrom`/
  `verify`'s check 2 apply it again before every comparison, so a kind
  that skips it is compared exactly as it always was.

## Traversal and kind-change helpers

`@hejbro/core` also exports five names a preset legitimately needs: the
walk over an expression, and the guards a kind's `emit` reads a change's
two sides with. They are engine surface — import them from
`@hejbro/core`; the `hejbro` barrel does not re-export them as runtime
values. They stay visible to the type checker there as type-only
re-exports: usable in a `typeof` position, never as a value.

- `exprChildren(node): ReadonlyArray<ExprNode>` — a node's direct child
  expressions, in render order. `exists`/`selectExpr` report none: their
  `query` is a `SelectNode`, not an expression, so descend into it with
  `existsChildExprs`/`selectExprChildExprs` when that is what you mean.
- `replaceExprChildren(node, children): ExprNode` — rebuilds `node` from
  a same-length replacement list in that same order, preserving every
  non-expression part, and returns `node` itself when every replacement
  child is reference-identical.
- `requireNext(change): JsonValue` — the change's next snapshot, or an
  `invalid-kind-change` refusal naming the change's kind and operation.
- `requirePrevious(change): JsonValue` — the same for the previous side.
- `requireBoth(change)` — both sides at once, with one refusal when
  either is missing.

Keeping your own table of child positions, or your own inline null
check, is what these replace: a node kind gaining a child is then
absorbed in core, not in your preset.
