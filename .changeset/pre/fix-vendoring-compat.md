---
"hejbro": patch
---

Fixes vendoring compatibility with older exports and closes several
contract-compilation gaps:

- `hejbro vendor` reads an export written before the typed function
  surface existed (pre-#587) without refusing it; the untyped function
  is simply not carried into the contract's `Functions` section.
- `createNameKeyedDb` accepts a contract vendored before functions were
  carried at all (no `functions` member in `contractMetadata`) and
  builds a client whose `fn` carries no callables.
- A vendored client's bare `insert()`/`update()`/`delete()` now types
  as resolving to `ReadonlyArray<never>` — no statement it sends
  carries a `RETURNING` clause, so it never resolves the table's row
  type.
- A table column key or function argument key that is not a valid
  TypeScript identifier is quoted in the emitted contract instead of
  breaking compilation.
- An `interval` column or function argument/return compiles in a
  vendored contract; `IntervalValue` is imported only when the
  contract actually names it.
