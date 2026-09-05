# Tasks: pin-wave-tie-break

One task; lead-direct (single test file, no code). Estimates are pure
work minutes (D88).

## 1. The tie-break

- [x] 1.1 (~6m) Pin the wave tie-break. Red: `packages/core/test/
      diff-engine.test.ts`, a new case in *"diffSnapshots — same-kind
      dependency ordering"*: `p_parent`, `q_child` (foreign key to
      `p_parent`), `self_ref` (a self-referencing foreign key only) —
      create order exactly `["app.p_parent", "app.self_ref",
      "app.q_child"]`, drop order exactly `["app.q_child",
      "app.self_ref", "app.p_parent"]`. Files: the test.
