# Tasks: extend-supabase-driver

Three groups. Every file has exactly one owner — no file appears in two
groups. Everything lands in `packages/supabase`, except group 3
(`skills/hejbro/references/supabase-preset.md`, one line in
`skills/hejbro/references/query-layer.md`, `.changeset/`).
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

- [x] 1.1 (~7m) `poolerDriver(driver)` in a new module — **module-internal,
      not exported from the package entry**: the factory option (group 2)
      is the single way a caller reaches this path, and this package's own
      tests import the module directly, which is why isolation testing is
      not an argument for a public export. It returns the wrapped driver
      with its capability declaration replaced by an explicit constant
      naming both keys (`interactive-transactions: true`, `session-state:
      false`) — never a spread of the wrapped driver's own capabilities,
      so a future key added to the contract is a type error here rather
      than a silently inherited value. Red: `pooler.test.ts` asserts the
      returned driver's `capabilities` equals that pair and fails — the
      module does not exist. Files: `packages/supabase/src/pooler.ts`,
      `packages/supabase/test/pooler.test.ts`.
- [x] 1.2 (~8m) The transaction-local pin statements, as an explicit
      constant in this module — **restated here, not delegated** to the
      wrapped driver's session-setup member, because that member sends
      session-scoped `SET`, which is the failure this path exists to
      remove and which leaks state onto a pooled backend besides. The
      restatement duplicates a list the vanilla driver also owns, so the
      drift trigger is named rather than assumed: if this list stops
      matching what the value conversion needs, **1.4's value-shape
      assertions go red** — an `interval` read back as the client
      library's default shape instead of the pinned one, and a `bytea`
      read back in the unpinned encoding. That is the test to look at
      when this constant is edited. Red: `pooler.test.ts` asserts the
      exact pin statements sent for one execution, in order, and fails —
      nothing sends them. Files: those two.
- [x] 1.3 (~8m) `transaction(callback)`: the pins are sent as the
      transaction's **first** statements, on the same session the
      callback receives, and the driver opens no second transaction
      around the caller's. Red: `pooler.test.ts` asserts the recorded
      session statements for one `transaction()` call begin with the pins
      and that the wrapped driver's `transaction` was entered exactly
      once; it fails because the pins are absent. Files: those two.
- [x] 1.4 (~9m) `execute(compiled)`: opens its own transaction through
      the wrapped driver, sends the pins, then the caller's statement,
      and returns the caller's rows — never the pins' own empty results.
      Carries the **value-shape assertions 1.2 names as its drift
      trigger**: an `interval` and a `bytea` read back through this path
      arrive in the shapes the pinned settings produce, so a pin list
      that stops matching what the conversion layer needs fails here by
      name rather than somewhere downstream. Red: `pooler.test.ts`
      asserts both the returned rows and those two shapes, and fails
      because `execute` currently passes straight through unpinned.
      Files: those two.
- [x] 1.5 (~6m) The session-setup member on this path. Whatever 1.2
      decides, the vanilla driver still invokes this member once per
      checked-out client, late-bound, so its content on this path is a
      deliberate choice and is asserted rather than left incidental. Red:
      `pooler.test.ts` asserts what `setupSession` sends on this path and
      fails against the inherited implementation. Files: those two.
- [x] 1.6 (~10m) The two properties the conformance kit cannot see,
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
- [x] 1.7 (~6m) The conformance kit, called for this path's declared
      tier, with the observation taken at the driver-session surface.
      Red: `pooler.test.ts` calls `assertSessionStateConformance` with
      this driver's capabilities and one execution's recorded statements
      and fails — the settings are not yet carried per execution. Files:
      those two.

## 2. The factory option

- [x] 2.1 (~7m) `supabaseDriver`'s optional second parameter: an options
      object whose endpoint key takes a **string union naming the
      endpoint kind**, never a boolean — a boolean's name becomes a lie
      the moment a third endpoint exists, and the union reads at the call
      site as the fact it states. Both kinds are namable (the
      session-keeping one and the transaction-mode pooler); omitting the
      option means the session-keeping one, so an existing caller is
      unaffected. Red: `driver.test.ts` asserts the pooler value produces
      the pooled-transaction capability pair and fails — the factory
      takes one argument. Files: `packages/supabase/src/driver.ts`,
      `packages/supabase/test/driver.test.ts`.
- [x] 2.2 (~6m) The one-argument call is unchanged: same contributed
      roles, same capability declaration as before this change, same
      pass-through of every other member. Red: `driver.test.ts` pins the
      existing behavior against the new signature and fails if the option
      object is made required or the default path's declaration moves.
      Files: those two.
- [x] 2.3 (~6m) Supabase's three contributed roles survive the pooler
      path — the preset's own contribution is not lost by the capability
      replacement. Red: `driver.test.ts` asserts `contributedRoles` on
      the pooler-path driver and fails if the pooler module returns
      before the roles are applied. Files: those two.
- [x] 2.4 (~6m) An unrecognized endpoint value is refused **where the
      driver is constructed**, with a coded error (`unknown-pooler-mode`)
      whose `Next:` clause lists the values that are recognized. This is
      not a redundant check on top of the type: it is the only check a
      caller without type checking gets, and without it a misspelling
      falls through to the session path — reproducing, for the caller who
      tried hardest to be explicit, exactly the silent wrong-value-shape
      failure this change exists to remove. The comparison happens once,
      at construction, never on the execution path. Red: `driver.test.ts`
      asserts the code and the listed values for a misspelled value and
      fails — the value currently falls through to the default. Files:
      those two.
- [x] 2.5 (~5m) The package entry exports the option's own type where a
      caller needs to name it, and nothing else new — the pooler driver
      itself stays module-internal (1.1). Red: `tsc` fails the entry's
      type-export assertion (`TS2305`/`TS2724`) — vitest alone stays
      green, because the assertion is type-level; the query package's own
      exports test carries the same asymmetry. Files:
      `packages/supabase/src/index.ts`,
      `packages/supabase/test/smoke.test.ts` — this package's existing
      entry test, extended rather than replaced by a new file.

## 3. What users read

Two repository gates own this group's correctness, and both are reasons
it lands last: `packages/skills/test/links.test.ts` checks every source
path a reference page cites, and
`packages/skills/test/snippet-compile.test.ts` type-checks every `ts`
block on the page against this repository's real source — so a snippet
showing the new option is red until group 2 has landed.

- [ ] 3.1 (~9m) A new "Connecting" section in the Supabase preset
      reference — the page that currently documents this preset and says
      nothing about drivers or endpoints. It carries the
      endpoint-to-capability mapping: which Supabase connection path maps
      to which capability values, and the construction each takes, as a
      `ts` block. Red: `pnpm --filter @hejbro/skills test` fails
      `snippet-compile` for the new block until group 2 lands, and the
      section is otherwise unverifiable prose — that failure is the
      signal the page and the code agree. Files:
      `skills/hejbro/references/supabase-preset.md`.
- [ ] 3.2 (~8m) The failure a wrong declaration produces, in the two
      halves a reader needs, in the same section: declaring the session
      path on a transaction-mode endpoint loses the pins intermittently —
      under load, in a value's shape, with no error — while declaring the
      pooler path on a session endpoint costs one extra statement per
      execution and nothing else. The asymmetry is the actionable part:
      one direction is a silent data-shape bug, the other is a small
      cost. Closes with what this change deliberately does not do
      (detect the endpoint; change prepared-statement behavior), so a
      reader meets those at their source rather than as a surprise.
      Files: that file.
- [ ] 3.3 (~5m) One pointer line in the query-layer reference, where the
      driver surface is actually documented today, sending a reader to
      the section 3.1 creates. Without it a reader who starts from the
      driver's own page has no route to the mapping. Red: no test covers
      a missing cross-reference; the check is that the page introduces
      `supabaseDriver` and would leave its options unexplained. Files:
      `skills/hejbro/references/query-layer.md` — **the one file in this
      change outside this package's ownership; keep the diff to that
      single line.**
- [ ] 3.4 (~5m) The changeset: `minor`, naming this package, one file.
      Red: `pnpm changeset status` fails the PR gate without it. Files:
      `.changeset/<name>.md`.

## Settled contract details

The three details raised before code, and how they were settled:

1. **Reachability (1.1, 2.5)** — the pooled-transaction driver is
   module-internal; the factory option is the one entry point. Testing
   it in isolation is not a reason to export it, because this package's
   own tests import the module directly.
2. **The pins (1.2)** — restated in the preset, not delegated. Delegation
   would send session-scoped `SET`, which is the failure this path
   removes, and would leave that state on a pooled backend afterwards.
   The duplication's drift trigger is named in 1.2 and lives in 1.4.
3. **The option (2.1, 2.4)** — a string union naming the endpoint kind,
   plus a construction-time rejection of an unrecognized value with a
   coded error. The runtime check is not doubling the type check: it is
   the only check an untyped caller gets, and the failure it prevents is
   a silent downgrade to the session path.
