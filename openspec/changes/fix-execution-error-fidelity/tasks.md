# Tasks

## 1. Message fidelity

- [x] 1.1 [design] `~6m` Driver reason enters the message, ahead of the
      SQL. Red: `packages/query/test/db/errors.test.ts` »
      "the driver's own message leads the failure message" (fails
      because today's message contains only the SQL). What breaks makes
      it red: revert the message template to the SQL-first,
      reason-absent shape and the new assertion fails on `toContain`.
      Settles: message order (reason → statement → Next), the
      no-usable-message fallback text, and the `Next:` rewording.
      Files either way: `packages/query/src/db/execute.ts`,
      `packages/query/test/db/errors.test.ts`.
- [x] 1.2 `~4m` Non-Error causes don't interpolate garbage. Red: same
      file » "a non-error cause is named, not interpolated" (throws a
      string, a message-less object; message names the absence, never
      contains `undefined`/`[object Object]`). Files: same two.
- [x] 1.3 `~5m` Spec delta transcribed; the value guarantee scoped to
      this layer's own writes with an echo-carry scenario. Red:
      the delta file's scenario "A server-echoed value is carried, not
      scrubbed" is exercised by a unit test (driver error message
      contains a value-like token; the wrapper carries it verbatim) —
      red before 1.1 lands the carry. Files:
      `openspec/changes/fix-execution-error-fidelity/specs/query-execution/spec.md`,
      `packages/query/test/db/errors.test.ts`.
