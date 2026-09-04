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
