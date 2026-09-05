# Proposal: expose-core-traversal (#515)

## Why

Four sites outside `@hejbro/core` restate a fact core already owns.
`@hejbro/supabase`'s RLS validator and `@hejbro/query`'s parameter
lifter each keep their own table of every expression node's child
positions — the table `expr/expr-children.ts` closes over in core and
deliberately does not export. `@hejbro/supabase`'s storage-bucket kind
and `examples/preset-smoke`'s kind each keep an inline
`invalid-kind-change` guard that core's own kinds fold through
`kind/emit-helpers.ts`. When a node kind gains a child (the `SelectNode`
growth that #444 repaired at four hand-written sites), every copy has to
be found by hand, and the provider-preset rule says what that means: a
preset that needs a core special case is telling us the interface is
wrong. The interface is missing two things a preset can legitimately
need — how to walk an expression, and how to read a kind change's two
sides safely.

## What Changes

- **Core exports its traversal registry as extension surface.**
  `exprChildren(node)` and `replaceExprChildren(node, children)` become
  public exports of `@hejbro/core`, documented as the way a preset or
  sibling package walks and rebuilds an expression. Engine, not
  vocabulary: `hejbro`'s barrel does not re-export them.
- **Core exports its kind-change guards.** `requireNext`,
  `requirePrevious` and `requireBoth` become public, the way a kind's
  `emit` reads the side a change carries and refuses the side it does
  not, with the one `invalid-kind-change` refusal.
- **The four sites fold.** The supabase validator's `ChildrenOfHandlers`
  and the query lifter's per-kind handlers become calls over
  `exprChildren`/`replaceExprChildren`; the two kinds' inline guards
  become the helpers. Behaviour is byte-identical; the tests that pin
  each site stay.
- The extension-interface reference documents the five exports as
  extension surface; one `minor` changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`package-surface`** — ADDED requirement: *Core's traversal registry
  and kind-change guards are extension surface*.

## Impact

- `@hejbro/core`: `src/index.ts` (five exports), the exports pin.
- `hejbro`: the engine classification list (five names classified as
  engine, so the barrel's completeness test stays green).
- `@hejbro/query`: `compile/params.ts`.
- `@hejbro/supabase`: `validators/rls-uncached-auth-call.ts`,
  `storage/bucket-kind.ts`.
- `examples/preset-smoke`: `src/preset.ts`.
- `skills/hejbro`: `references/extension-interface.md`.
