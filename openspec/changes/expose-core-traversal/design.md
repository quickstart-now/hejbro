# Design: expose-core-traversal

Settled by the lead under the owner's full delegation for this pass;
recorded as a ruling on the change's issue.

## Q1 — Export, or keep four copies

- (i) Keep the registry internal; keep the copies and their tests.
- (ii) Export the registry and the guards as extension surface; fold.
- **Ruling (ii).** The provider-preset rule decides it: a preset needing
  a core fact is a missing interface, not a reason for a copy. The
  registry is exactly the kind of closure the repository already
  exports for the same reason (`SELECT_CLAUSE_TRAVERSALS`). What is
  exported is the walk, never the node shapes' construction — a preset
  reads and rebuilds nodes it was given; it does not mint them.

## Q2 — Engine, not vocabulary

The five names are engine surface: importable from `@hejbro/core`,
classified as engine in `hejbro`'s curation, absent from the `hejbro`
barrel at runtime (types stay reachable, as every core type is).

## Q3 — Not folded on purpose

`expr/codec.ts`'s `NODE_KIND_TO_SNAPSHOT` and the test-side
`reachable-kinds.ts` stay separate ledgers (`.claude/rules/naming.md`
records the #110 defect that proved folding them unsafe). This change
touches neither.
