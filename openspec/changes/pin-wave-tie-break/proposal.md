# Proposal: pin-wave-tie-break (#798)

## Why

The same-kind dependency refinement places objects by waves: every
object whose references are satisfied is placed in the current wave, in
identity order, then the next wave. Every dependency sentence in the
generation-order requirement holds, and migration names follow the
pre-refinement order — but neither the requirement nor a unit test pins
where an *unconstrained* object lands: `p_parent, q_child(→p_parent),
self_ref` emits `p_parent, self_ref, q_child`, and nothing says that is
the rule rather than an accident of the implementation.

## What Changes

- The requirement states the tie-break: among objects whose references
  are satisfied, identity order decides, and an object with no unmet
  reference is placed in the earliest wave — so an object that references
  nothing may precede an object that sorts before it but references a
  later one. A scenario carries the three-table shape in both
  directions.
- A unit row pins it. No code moves; no changeset (behaviour unchanged).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`cli-commands`** — MODIFIED requirement: *Migrations are generated
  deterministically from declarations* (the tie-break sentence and its
  scenario).

## Impact

- `@hejbro/core`: `test/diff-engine.test.ts` only.
