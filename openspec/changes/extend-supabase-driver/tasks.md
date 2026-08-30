# Tasks: extend-supabase-driver

Three groups. Every file has exactly one owner — no file appears in two
groups. Everything lands in `packages/supabase`, except group 3
(`skills/hejbro/references/supabase-preset.md`, `.changeset/`).
**No file under `packages/core`, `packages/query`, `packages/cli`, or
`packages/pg` is edited** — if a task appears to need one, that is the
interface failing and it goes back to the planner, not into the diff.
Estimates are pure work minutes (D88).

**Ordering.** Group 1 builds the pooler path as its own module and can
start immediately. Group 2 wires it into the factory and therefore lands
after group 1 — the two share no file, so the dependency is on group 1's
exported function existing, not on an edit in flight. Group 3 documents
what groups 1 and 2 settle and lands last.

**Group 1 records at two levels, deliberately.** What the conformance
kit is handed (1.7) is the statements that pass the contract's `execute`
— not the `BEGIN`/`COMMIT` the underlying driver sends around them;
`design.md` states that boundary, why the domain argues for it, and why
no shipped driver is a precedent for it. Everything the narrowing stops
showing is then covered by 1.6, which records at the level where the
envelope **is** visible. The two levels are the division of labor, not a
redundancy: neither check subsumes the other.

## 1. The pooled-transaction path

- [ ] 1.1 (~7m) [design] `poolerDriver(driver)` in a new module, returning
      the wrapped driver with its capability declaration replaced by an
      explicit constant naming both keys (`interactive-transactions:
      true`, `session-state: false`) — no spread of the wrapped driver's
      own capabilities, so a future key is a type error here rather than
      a silent inheritance. **[design]**: the exported function's name and
      whether it is exported from the package entry at all, or reachable
      only through the factory option (group 2). Red: `pooler.test.ts`
      asserts the returned driver's `capabilities` equals that pair and
      fails — the module does not exist. Files:
      `packages/supabase/src/pooler.ts`,
      `packages/supabase/test/pooler.test.ts`.
- [ ] 1.2 (~8m) [design] The transaction-local pin statements, as an
      explicit constant in this module. **[design]**: whether the preset
      restates the pins (`set local intervalstyle …`, `set local
      bytea_output …`) or delegates to the wrapped driver's own
      session-setup member. Delegation reuses the wrapped driver's
      knowledge but sends session-scoped `SET`, which is the failure this
      path exists to remove; restating them duplicates a list the vanilla
      driver also owns, which is what the other `session-state: false`
      driver already does. Decide before code. Red: `pooler.test.ts`
      asserts the exact pin statements sent for one execution, in order,
      and fails — nothing sends them. Files: those two.
- [ ] 1.3 (~8m) `transaction(callback)`: the pins are sent as the
      transaction's **first** statements, on the same session the
      callback receives, and the driver opens no second transaction
      around the caller's. Red: `pooler.test.ts` asserts the recorded
      session statements for one `transaction()` call begin with the pins
      and that the wrapped driver's `transaction` was entered exactly
      once; it fails because the pins are absent. Files: those two.
- [ ] 1.4 (~8m) `execute(compiled)`: opens its own transaction through
      the wrapped driver, sends the pins, then the caller's statement,
      and returns the caller's rows — never the pins' own empty results.
      Red: `pooler.test.ts` asserts a single `execute` returns the rows
      the stub gave the last statement, and fails because `execute`
      currently passes straight through unpinned. Files: those two.
- [ ] 1.5 (~6m) The session-setup member on this path. Whatever 1.2
      decides, the vanilla driver still invokes this member once per
      checked-out client, late-bound, so its content on this path is a
      deliberate choice and is asserted rather than left incidental. Red:
      `pooler.test.ts` asserts what `setupSession` sends on this path and
      fails against the inherited implementation. Files: those two.
- [ ] 1.6 (~10m) The two properties the conformance kit cannot see,
      asserted against a fixture that records the transaction control
      too — the level the kit's observation deliberately excludes. The
      assertion is **positional against the envelope**: for one
      execution, the pins are recorded **after** the statement that opens
      the transaction and **before** the caller's own. Both halves earn
      their place: a pin in a *different* transaction is worthless, and a
      pin sent *before* `BEGIN` is discarded by the database with a
      warning and no effect — and neither is visible where 1.7 looks,
      because the opening statement is not among the statements 1.7
      records. Red: a fixture that emits the pins before `BEGIN` passes
      1.7 and fails this test; that contrast is the test's whole reason
      to exist, so check it holds before moving on — if both go green or
      both go red, this test is guarding nothing and that is a report,
      not a fix to improvise. Files: those two.
- [ ] 1.7 (~6m) The conformance kit, called for this path's declared
      tier, with the observation taken at the driver-session surface.
      Red: `pooler.test.ts` calls `assertSessionStateConformance` with
      this driver's capabilities and one execution's recorded statements
      and fails — the settings are not yet carried per execution. Files:
      those two.

## 2. The factory option

- [ ] 2.1 (~7m) [design] `supabaseDriver`'s second parameter. **[design]**:
      the option key's spelling and its value type — a string union
      naming the endpoint kind, or a boolean flag — and what an unknown
      value does (a type error only, or a runtime rejection with a code
      and a `Next:` clause). Red: `driver.test.ts` asserts the pooler
      option produces the pooled-transaction capability pair and fails —
      the factory takes one argument. Files:
      `packages/supabase/src/driver.ts`,
      `packages/supabase/test/driver.test.ts`.
- [ ] 2.2 (~6m) The one-argument call is unchanged: same contributed
      roles, same capability declaration as before this change, same
      pass-through of every other member. Red: `driver.test.ts` pins the
      existing behavior against the new signature and fails if the option
      object is made required or the default path's declaration moves.
      Files: those two.
- [ ] 2.3 (~6m) Supabase's three contributed roles survive the pooler
      path — the preset's own contribution is not lost by the capability
      replacement. Red: `driver.test.ts` asserts `contributedRoles` on
      the pooler-path driver and fails if the pooler module returns
      before the roles are applied. Files: those two.
- [ ] 2.4 (~5m) The package entry exports whatever 1.1 and 2.1 decided is
      public, and nothing more. Red: `test/entry.test.ts`-style import
      assertion fails for the newly public name. Files:
      `packages/supabase/src/index.ts`,
      `packages/supabase/test/exports.test.ts`.

## 3. What users read

- [ ] 3.1 (~9m) The endpoint-to-capability mapping in the Supabase skill
      reference: which connection path maps to which capability values,
      and the one-line construction each takes. Red: no unit test covers
      prose; the check is that the reference currently documents one
      construction and would leave a pooler user with no correct answer.
      Files: `skills/hejbro/references/supabase-preset.md`.
- [ ] 3.2 (~8m) The failure a wrong declaration produces, in the two
      halves a reader needs: declaring the session path on a
      transaction-mode endpoint loses the pins intermittently — under
      load, in a value's shape, with no error — and declaring the pooler
      path on a session endpoint costs one extra statement per execution
      and nothing else. The asymmetry is the actionable part: one
      direction is a silent data-shape bug, the other is a small cost.
      Files: that file.
- [ ] 3.3 (~5m) The changeset: `minor`, naming this package, one file.
      Red: `pnpm changeset status` fails the PR gate without it. Files:
      `.changeset/<name>.md`.

## Open contract details for the owner

Raised before code, per the [design] marks above:

1. **1.1 / 2.4** — is the pooled-transaction driver a public export in
   its own right, or reachable only through the factory option? A public
   export is a second way to build the same thing; an option keeps one
   entry point but makes the driver harder to test in isolation.
2. **1.2** — restate the pins in the preset, or delegate to the wrapped
   driver's session-setup member? Delegation inherits the wrong scope
   (`SET`, not `SET LOCAL`); restating duplicates a list the vanilla
   driver owns, exactly as the other `session-state: false` driver
   already does.
3. **2.1** — the option key's spelling and value type, and whether an
   unknown value fails at compile time only or also at run time with a
   coded error.
