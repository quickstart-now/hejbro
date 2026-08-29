# Tasks: add-neon-preset

Eight groups. Two files are shared between two groups — named below,
with the reason; every other file has exactly one owner. Everything new
lands in
`packages/neon`; outside it, only `scripts/` (two hardcoded gate lists),
`packages/skills` (a third hardcoded gate list plus the dev dependency
its snippet compiler needs to resolve a client library — both found
while writing the skill page rather than while planning), `.changeset/`,
`.claude/rules/`, `AGENTS.md`, and `skills/hejbro` are touched.
**No file under `packages/core`, `packages/query`,
`packages/cli`, `packages/pg`, or `packages/supabase` is edited** — if a
task appears to need one, that is the interface failing and it goes back
to the planner, not into the diff. Estimates are pure work minutes (D88).

**Task numbers are identifiers, not a running order.** Three tasks were
added after their group's earlier ones had already been cited in review
correspondence (3.6, 6.4, 6.5), and renumbering would have made those
citations point at different work. Each of the three says in its own text
when it runs; nothing else in this file promises that numbers ascend with
execution.

**Ordering.** Group 1 lands first: nothing resolves until the package
exists. Group 2's first task fixes the HTTP batch's composition and
order against a stub transport — a test that can always be made green,
and therefore not the fallback's trigger. **The trigger is the one-time
manual measurement 2.1 names**: an `interval` and a `bytea` read back
over the HTTP path against a real server and compared to `@hejbro/pg`.
If those differ, group 2 is dropped whole, the WebSocket path ships
alone, and the HTTP driver is reopened with #483 (pre-approved fallback,
no further approval round). The measurement's result is written into
`design.md`'s placeholder; until it is, group 2 is not finished. Group
3's
`contributedRoles` task consumes group 4's role constants, so group 4
lands before that one task. Group 6's entry-point task re-exports what
groups 2–5 produce, so it lands after them. Group 7 needs a driver, so
it lands last.

**The package never exists in an unbuildable state.** A `package.json`
carrying `build`/`test`/`test:coverage` scripts puts the package into
every unfiltered turbo run, whether or not any gate list names it — so a
package with those scripts and no `src/index.ts` and no test breaks
repo-wide `pnpm build`, `pnpm test`, and `pnpm check:crap` (which runs
`turbo run test:coverage` and exits on the first non-zero) for as long as
that state lasts. Group 1 therefore creates the entry module and its test
in the same group as the manifest, and the shared files are named here:
`packages/neon/src/index.ts` and `packages/neon/test/entry.test.ts` are
**created by 1.4 and extended by 6.1** — group 1 makes the entry resolve,
group 6 fills it with the public surface. That is the one intentional
overlap: one pair of groups, two files.

**Gate registration runs after the source exists** (group 8, not group
1). Registering an empty package in the CRAP list measures nothing, and
the reviewer's counterfactual for that task — remove the registration,
plant an over-threshold function, watch the gate stay green — has no
function to plant until groups 2–5 have landed. A registration whose
effect cannot be observed is not worth taking on faith.

A design probe is not an implementation: the reproduction in `design.md`
was run by hand and proves the shape is possible. Every task below still
starts from its own failing test.

## 1. Package scaffolding

- [x] 1.1 (~8m) [design] `packages/neon/package.json`: name, `version`
      `0.0.0` (the shape `@hejbro/query` and `@hejbro/pg` still carry —
      an unpublished package does not invent a version), `type: module`,
      `exports` with `types`+`import`, `files: ["dist"]`, `engines`
      `node >=22.18.0`, the six scripts `packages/pg` carries (build,
      check-types, test, test:coverage, test:integration, prepack),
      `dependencies` on
      `@hejbro/core`/`@hejbro/query` as `workspace:*`. The [design] part
      is the dependency form for `@neondatabase/serverless`:
      `peerDependencies` plus a same-version `devDependencies`, and
      **not** in `dependencies` — the client is constructed by the user
      and `neonConfig` is global to the module instance, so a second copy
      is a second global. Red: `pnpm --filter @hejbro/neon test` fails —
      there is no such workspace package. Files:
      `packages/neon/package.json`.
- [x] 1.2 (~6m) `tsconfig.json`, `tsdown.config.ts`, `turbo.json`, all
      three copied in shape from `packages/pg` (`extends` the base
      config, `noEmit`, `entry: ["src/index.ts"]`, `dts: true`,
      `dependsOn: ["^build"]`). Red: `pnpm check-types --filter
      @hejbro/neon` cannot run — the package has no `check-types` target.
      Files: those three.
- [x] 1.3 (~7m) `vitest.shared.ts` and `vitest.config.ts`: the
      `@hejbro/core`/`@hejbro/query` source aliases (#131) pointing at
      each package's **public index only, never a deep path** — the
      preset boundary applies to the test setup too. Red: `pnpm --filter
      @hejbro/neon test` fails — the package has no test target. Files:
      those two.
- [x] 1.4 (~7m) `src/index.ts` and `test/entry.test.ts`, together, so the
      package builds and tests from its first commit. The entry starts
      empty (`export {}`) and 6.1 fills it; the test asserts only that
      importing the package entry succeeds. This is not a placeholder
      invented for a gate — the entry module is required surface either
      way, and creating it late is what would leave every unfiltered
      `pnpm build` and `pnpm test` in the repository failing for the
      length of this change. Red: `pnpm --filter @hejbro/neon test` fails
      with "No test files found". Files: `packages/neon/src/index.ts`,
      `packages/neon/test/entry.test.ts`.
- [x] 1.5 (~6m) `README.md` and `LICENSE`. Not documentation polish: the
      pack smoke asserts both are present in the tarball, so their
      absence is a gate failure. Red (no unit test covers the smoke
      script; the check is the red): `pnpm smoke:pack-install` fails
      `assert_license_content` for `@hejbro/neon`. Files: those two.

## 2. The HTTP path and its per-request pins

- [x] 2.1 (~10m) **The batch shape, first and gating.** Each execution
      goes out as one batch built with the client's `sql.query(text,
      params)` form — the two session pins, then the caller's compiled
      statement — and the driver reads the **last** result entry. Pinned
      by a stub `fetchFunction` that captures what was sent, so this is a
      pure test inside the committed boundary: it fixes composition and
      ordering, which is what a later refactor can silently break. What
      it cannot prove is arrival shape over a real server; that is a
      one-time manual measurement recorded in `design.md`, and it is the
      fallback's trigger — **if that measurement shows an `interval` or a
      `bytea` arriving differently than over `@hejbro/pg`, group 2 is
      dropped whole.** Red: `packages/neon/test/http-session.test.ts` —
      "sends both pins and the caller's statement as one batch and
      returns the last result". Files: `packages/neon/src/http.ts`, that
      test.
- [x] 2.2 (~7m) A batch carries exactly one caller statement and its
      parameters through unchanged, and the driver returns that
      statement's rows only — the pins' empty result sets are never
      mistaken for the answer. Red: same file — "returns only the
      caller's rows from a pinned batch". Files:
      `packages/neon/src/http.ts`, that test.
- [x] 2.3 (~8m) [design] The HTTP capability declaration:
      `{"interactive-transactions": false, "session-state": false}`, as a
      constant on the value. The [design] part is that both read `false`
      and neither is softened — `session-state: false` is true about
      persistence between executions even though the pins hold *within*
      one, and `interactive-transactions: false` is true about this
      contract's callback shape even though the platform can run a
      pre-assembled batch (#486). Red: same file — "declares both
      capabilities false before any connection". Files:
      `packages/neon/src/http.ts`, that test.
- [x] 2.4 (~9m) `transaction()` and `setupSession()` on the HTTP driver.
      The contract requires both members of every driver; a driver
      lacking the capability implements `transaction` as one that
      **always throws the missing-capability error before sending
      anything**. This is the one place in this change where the driver
      could lie on its own — the query layer's guard only runs on paths
      that consult capabilities, so a `transaction` that quietly ran the
      callback against a session would pass every other test here while
      being exactly the "HTTP one-shot pretending to run transactions"
      D95 rejects by name. `setupSession` states what it does on a path
      with no session (the pins ride with each execution instead). Red:
      `packages/neon/test/http-session.test.ts` — "calling transaction
      directly throws the missing-capability error and sends nothing".
      Files: `packages/neon/src/http.ts`, that test.
- [x] 2.5 (~6m) The error a failed batch produces is passed through
      unchanged, and the documented boundary is that it carries no member
      index — a failing pin is indistinguishable from a failing caller
      statement. The pins are the two constant `SET`s `@hejbro/pg`
      already sends, so this is recorded, not defended against. Red: same
      file — "surfaces the database error from a failed batch". Files:
      `packages/neon/src/http.ts`, that test.

## 3. The WebSocket path and the driver entry

- [x] 3.1 (~9m) [design] `neonDriver`, overloaded on the client it is
      handed: a Neon `Pool` selects the WebSocket path, the `neon()`
      query function selects the HTTP path. The [design] part is that the
      overload — not an option flag and never a runtime probe — fixes the
      capability set, so the declaration is final before any connection
      exists. Red: `packages/neon/test/driver.test.ts` — "the client
      argument fixes the capability set". Files:
      `packages/neon/src/driver.ts`, that test.
- [x] 3.2 (~8m) WebSocket execution: a compiled statement's SQL and
      parameters reach the pool, and rows come back as the contract's row
      shape. Neon's `Pool` is **not** assignable to `pg`'s (measured: its
      `connect()` returns a different `PoolClient`), so this is written
      against Neon's own types rather than reusing `pgDriver`. Red: same
      file — "executes a compiled statement over the pool". Files:
      `packages/neon/src/driver.ts`, that test.
- [x] 3.3 (~9m) WebSocket interactive transactions over a checked-out
      client, with rollback on a thrown callback. Red: same file —
      "rolls back when the transaction callback throws". Files:
      `packages/neon/src/driver.ts`, that test.
- [x] 3.4 (~7m) `setupSession` applies the same pins `@hejbro/pg` applies,
      once per checkout, and the WebSocket capability declaration reads
      `{"interactive-transactions": true, "session-state": true}` —
      measured true against a local proxy, not assumed from the client's
      node-postgres compatibility. Red: same file — "pins the session at
      checkout and declares both capabilities". Files:
      `packages/neon/src/driver.ts`, that test.
- [x] 3.5 (~6m) `contributedRoles` carries `authenticated` and
      `anonymous`, so the context mechanism's fail-closed role allowlist
      admits them without a declaration that grants them. Consumes group
      4's constants. Red: same file — "contributes Neon's two Data API
      roles". Files: `packages/neon/src/driver.ts`, that test.
- [x] 3.6 (~8m) Every query carries the same `types` override
      `@hejbro/pg` sends — oids 1186/1187/1231 forced to raw text, every
      other type left to the client's own parser. **Runs with 3.2**; it
      is numbered last only so the tasks already cited in review
      correspondence keep their numbers. This is a different mechanism
      from 3.4's session pins and easy to conflate with them: the pins
      decide what the *server* renders, this decides whether the
      *client's* parser is bypassed. Neon's `Pool` ships its own bundled
      parsers, so without the override an `interval` arrives as a parsed
      object and a `numeric[]` as already-parsed numbers — the two
      outcomes the contract's arrival-shape requirement exists to
      forbid, one of them lossy. The HTTP driver carries this because
      2.1 named it; the WebSocket path had no task naming it until now.
      Red: `packages/neon/test/driver.test.ts` — "sends the raw-text type
      override with every query". Files: `packages/neon/src/driver.ts`,
      that test.

## 4. Roles and auth expressions

- [x] 4.1 (~6m) [design] `authenticatedRole` and `anonymousRole`. The
      [design] part is the second name: Neon's Data API creates
      `anonymous`, not Supabase's `anon`, and the constant emits the SQL
      identifier, so matching Supabase here would make it lie. Red:
      `packages/neon/test/roles.test.ts` — "names Neon's own roles".
      Files: `packages/neon/src/roles.ts`, that test.
- [x] 4.2 (~8m) `authUid()` and `authJwt()` over `pg_session_jwt`'s
      `auth.uid()` and `auth.jwt()`, rendering the same expression nodes
      the Supabase preset's helpers render — an agreement between two
      platforms that expose the same function names, not a copy. Red:
      `packages/neon/test/auth.test.ts` — "renders the extension's
      identity functions". Files: `packages/neon/src/auth.ts`, that test.

## 5. Context builders

- [x] 5.1 (~10m) [design] The auth surface factory: it takes the
      database's authentication mode once and returns only that mode's
      builders. The [design] part is the type shape — the return type
      must split on the mode argument such that asking a claims-mode
      surface for the JWT-mode builder does not compile, and a mode
      argument the type layer has not narrowed (an `as`-cast environment
      variable, say) exposes **neither** builder rather than both. The
      second half is the easy one to get backwards. The [design] part
      also settles the exported name of the factory and of the mode
      values — 6.1 re-exports them and the skill documents them, so they
      are public surface, not an internal detail. Red:
      `packages/neon/test/context.test.ts` — "a surface exposes only its
      own mode's builders", plus a type-level case asserting the
      cross-mode access is an error. Files:
      `packages/neon/src/context.ts`, that test.
- [x] 5.2 (~9m) `asUser(claims)` on the claims-mode surface: role
      `authenticated`, claims carried as the `request.jwt.claims`
      setting, `sub` required both by the parameter type and by a runtime
      guard, any caller-supplied `role` claim discarded — a caller's role
      is never trusted, as in the Supabase preset. Red: same file —
      "requires a subject, fixes the role, and ignores a supplied role
      claim". Files: `packages/neon/src/context.ts`, that test.
- [x] 5.3 (~8m) [design] The JWT-mode builder: role
      `authenticated`, the token carried opaquely as the
      `pg_session_jwt.jwt` setting, never decoded or validated by the
      preset. The [design] part is the name, which must say the mode it
      belongs to. Red: same file — "passes the token through untouched
      under the JWT mode's setting". Files:
      `packages/neon/src/context.ts`, that test.
- [x] 5.4 (~6m) `asAnonymous()` on both surfaces: role `anonymous`, no
      identity setting. Red: same file — "applies the anonymous role with
      no identity". Files: `packages/neon/src/context.ts`, that test.
- [x] 5.5 (~8m) Every context this preset produces is applied with
      transaction-local scope: the emitted `set_config` carries `true` as
      its third argument, pinned by an assertion on the statement itself
      rather than only on the value read back inside the transaction —
      inside one transaction, session scope and local scope are
      indistinguishable, so a test that only reads the value back cannot
      tell them apart. This is what makes the preset stricter than the
      extension's own `jwt_session_init` helper (a session-scoped `SET`
      that outlives the transaction on a pooled connection). D96 dictates
      this, not Neon. Red: same file — "applies identity settings with
      transaction-local scope". Files: `packages/neon/src/context.ts`,
      that test.

## 6. Public surface, rules, and user-facing docs

- [x] 6.1 (~6m) `packages/neon/src/index.ts` — created empty by 1.4, now
      re-exports the driver, the
      roles, the auth expressions, the auth-surface factory with its mode
      type, and the claims type its user builder accepts — and no
      `Preset` bundle, because there are no kinds and no validators to
      register. The claims type is this package's own, structurally like
      the Supabase preset's but not imported from it: presets do not
      reference each other, which is the same boundary that makes the oid
      constants a deliberate copy rather than an import.
      One assertion in `test/context.test.ts` moves with this task: the
      JWT builder's "exactly as given" is currently pinned with a token
      that has no leading or trailing space, so a `token.trim()` inserted
      into the builder survives (measured). Give that assertion a token
      with surrounding whitespace and the spec's own word — *untouched* —
      becomes what the test checks. `README.md` is brought in line with what is actually
      exported in the same task: it was written in 1.5 describing the
      finished package, and no gate compares it to the entry — the pack
      smoke checks that the file exists, not what it says. Red:
      `packages/neon/test/entry.test.ts` — "re-exports the public
      surface". Files: `packages/neon/src/index.ts`, that test,
      `packages/neon/README.md`.
- [x] 6.2 (~7m) Rename `.claude/rules/supabase-preset.md` to
      `provider-preset.md` with an explicit path list covering both
      preset packages, and update `AGENTS.md`'s two references to the old
      filename. A rule that does not load for the second preset is not a
      rule; a root document pointing at a filename that no longer exists
      is a broken reference in the one file every session reads. Red (no
      test covers rule loading; the check is the red): the `paths` glob
      in `.claude/rules/supabase-preset.md`'s front matter matches no
      file under `packages/neon`, and `AGENTS.md` names a filename that
      will not exist. Files: `.claude/rules/provider-preset.md`,
      `AGENTS.md`.
- [x] 6.3 (~9m) `skills/hejbro` gains a Neon reference page: the two
      connection paths and what each can do; the two authentication
      modes, the fact that the declared mode is never checked against the
      database, and **the route from symptom to cause** — when every row
      disappears under a context, compare the declared mode against
      whether the database has a JWK configured. Two more warnings that
      belong where users read rather than only in a spec: a policy keyed
      only on the role still admits under a mismatched mode, so access
      control that depends on identity must key on `auth.uid()` and its
      relatives explicitly; and an error from the HTTP path carries no
      batch member index, so a failure in the driver's own pins would
      read as the caller's statement failing. Also the note that the
      preset's transaction-local scope differs from the extension's own
      `jwt_session_init` helper. New reference file, not an edit to the
      shared `SKILL.md` tables. Red (no test covers the skill; the check
      is the red): no file under `skills/hejbro/references/` mentions
      `neonDriver`. Files: `skills/hejbro/references/neon-preset.md`.
- [x] 6.5 (~5m) Register `@hejbro/neon` in the snippet compiler's package
      map (`packages/skills/test/snippet-check.ts`). That map is the
      whitelist of hejbro packages a skill snippet may import, and it is
      the **third** hardcoded gate list this change has met (#484 lists
      two). Unlike the other two, this one is registered **now, not in
      group 8**: its subject is 6.3's own page, which exists as soon as
      6.3 lands, so the registration has an observable effect
      immediately — the reason group 8 exists does not apply. Runs before
      6.3's page carries any `ts` fence. Red: a fence importing
      `@hejbro/neon` fails `pnpm --filter @hejbro/skills test` with
      "Cannot find module '@hejbro/neon'". The snippet also imports the
      client library, which that map cannot supply: it is a whitelist of
      **hejbro** packages, and mixing a third-party path into it blurs
      the one thing it means. The dependency is made real instead —
      `@neondatabase/serverless` added to `packages/skills`'s own
      devDependencies, resolved like any other import. The type-only
      alternative was tried first and measured wrong:
      `Parameters<typeof neonDriver>[0]` resolves to an overloaded
      function's **last** signature, so a WebSocket example would have
      been typed as the HTTP one. Files:
      `packages/skills/test/snippet-check.ts`,
      `packages/skills/package.json`.
- [x] 6.4 (~6m) Move the raw-text type override into one module both
      drivers import, and delete the two copies. The duplication was
      correct while it existed — exporting it from `http.ts` would have
      meant a group-3 task editing a group-2 file — but that constraint
      is this change's own task partition, and **it does not survive the
      merge**. Its comment currently offers that reason alongside the
      package-boundary one; only the second is durable, and it justifies
      not importing from `@hejbro/pg`, never two copies inside one
      package. Red: `packages/neon/test/driver.test.ts` — "both drivers
      send the same override object" (fails while two literals exist).
      **Done means the oid set is still pinned afterwards**: dropping
      1231 from the shared module must still turn a test red. A refactor
      that leaves only "both drivers use the same object" asserted has
      traded a check of *what* the override contains for a check that
      it is *shared* — the same object, silently wrong, in two places
      instead of one. Files: `packages/neon/src/type-overrides.ts` (new),
      `packages/neon/src/driver.ts`, `packages/neon/src/http.ts`, that
      test.

## 7. Local witness

- [x] 7.1 (~8m) `vitest.integration.config.ts` that does **not** inherit
      the default config, so the local-only suite never enters the
      coverage gate — the pattern `packages/pg` established, and the
      reason `packages/supabase`'s integration test keeps its fixtures
      inside the test file. Red:
      `packages/neon/test/integration/ws.integration.test.ts` — "connects
      through the local proxy" (no runner target). Files:
      `packages/neon/vitest.integration.config.ts`.
- [x] 7.2 (~9m) The witness detects a missing stack and **fails loudly
      with the command to start it**, never skipping. Its proxy URL is
      overridable by environment variable. The route is `/v1` and
      `APPEND_PORT` is left unset — both measured, both contradicting the
      client's default and every community example. Red: same file —
      "names the command to start the stack when it is absent". Files:
      that test.
- [x] 7.3 (~9m) The witness proves the WebSocket capability declaration
      rather than asserting it: an interactive transaction commits across
      round trips, a transaction-local setting is gone after commit, and a
      session setting survives to the next statement. Red: same file —
      "the declared capabilities hold against a real server". Files: that
      test.
- [x] 7.4 (~8m) The witness runs a select under `asUser(claims)` against
      a table with a policy reading `auth.uid()`, and rows filter to the
      subject. This exercises the claims mode, which is what a local
      `pg_session_jwt` without a configured JWK uses; the JWT mode
      is stated in the spec as unverified locally rather than implied to
      be covered. Red: same file — "filters rows to the context's
      subject". Files: that test.
- [x] 7.5 (~8m) The dangerous half of a mode mismatch, witnessed. The
      local stack has no verification key configured, so it is in claims
      mode — which makes a context from the **JWT-mode** builder a
      genuine mismatch, with no extra infrastructure. Under it, a policy
      keyed on the identity function denies, and a policy keyed only on
      the role **admits with no identity resolved**. This is the only
      place in the change where the admitting half is observed rather
      than asserted, and it is what the skill's warning is about. Red:
      same file — "a role-keyed policy admits under a mismatched mode
      while an identity-keyed policy denies". Files: that test.
- [x] 7.6 (~8m) The identity a context applied does not survive it: after
      a scoped execution finishes, the same pooled connection reads no
      claims setting and the default role. Without this, the whole
      transaction-local claim rests on 5.5's statement assertion alone,
      and a connection that leaked identity into the next request would
      still pass every other test in this suite — which is the security
      failure D96's `SET LOCAL` choice exists to prevent. Red: same file
      — "identity does not survive the scoped execution on a reused
      connection". Files: that test.
- [x] 7.7 (~8m) Row arrival shapes, witnessed against a real server. The
      contract fixes what the vanilla driver's rows look like per type,
      and `@hejbro/query`'s conversion layer is written against those
      shapes — but `@neondatabase/serverless` ships its **own** bundled
      type parsers, not `pg-types`, so "the same shapes" is an assumption
      until something reads them. The one-time measurement covered
      `interval` and `bytea` only. This reads back the types whose
      parsers most plausibly differ — `numeric`, `int8`, `timestamptz`,
      and an array — and asserts each arrives as the vanilla driver's
      documented shape. Red: same file — "rows arrive in the vanilla
      driver's shapes for numeric, int8, timestamptz, and arrays". Files:
      that test.

## 8. Gate registration

Last, not first: every task here claims that a gate now sees this
package, and that claim is only observable once the package has source
and tests to be seen. Each red below is a defect deliberately planted —
absence is not a red.

- [ ] 8.1 (~8m) Register `@hejbro/neon` in `scripts/crap-report.mjs`'s
      `TARGET_PACKAGES` and refresh the README CRAP block, whose numbers
      move — CI compares that block by diff, so leaving it stale fails the
      build. This list is hardcoded, not derived from the workspace
      (#484), so a new package is simply not measured while the gate stays
      green — the failure mode #372 already named. Red: a function well
      over the CRAP threshold planted in `packages/neon/src` leaves `pnpm
      check:crap` passing. Files: `scripts/crap-report.mjs`, `README.md`.
- [ ] 8.2 (~9m) Register `@hejbro/neon` in `scripts/pack-install-smoke.sh`
      at all six existing sites: the `PACKAGES` array, the `NEON_TGZ`
      resolution, the consumer `package.json`, `assert_tarball_files_
      installed`, `assert_license_content`, and
      `assert_no_workspace_protocol` — the last is a **separate**
      hardcoded list from `PACKAGES`, so widening one does not widen the
      other. Red: removing `dist` from `packages/neon`'s `files` leaves
      `pnpm smoke:pack-install` passing. Files:
      `scripts/pack-install-smoke.sh`.
- [ ] 8.3 (~7m) [design] Make the smoke consumer **import**
      `@hejbro/neon`, not merely install it. Installed-but-unimported is
      the gap the script's own comment records as M6: a reviewer broke
      `@hejbro/supabase`'s `exports` and every assertion stayed green.
      The [design] part is what is imported — `@hejbro/neon` ships no
      `Preset` bundle (it registers no kinds and no validators, and an
      empty bundle would be surface invented to satisfy a gate), so the
      assertion references a real exported value instead. Red: breaking
      `packages/neon`'s `exports` field leaves `pnpm smoke:pack-install`
      green. Files: `scripts/pack-install-smoke.sh`.
- [ ] 8.4 (~6m) Add `@hejbro/neon` to `.changeset/config.json`'s `fixed`
      group (5 → 6) and add the change's single `.changeset/*.md`
      (`minor`). Approved as a release-surface decision; the first publish
      remains an owner gate. Red: `changeset status` treats
      `@hejbro/neon` as independently versioned. Files:
      `.changeset/config.json`, `.changeset/<name>.md`.
