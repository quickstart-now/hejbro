# Tasks: add-nile-preset (#301)

Groups are parallel-safe by file, with the shared files declared below.
Estimates are pure work minutes. `[design]` tasks sit at the end of their
group and settle a contract detail before the code that depends on it.

**Shared, owned by no group** (the rule this repository settled while
landing #553): `packages/nile/src/index.ts` (the barrel),
`packages/nile/package.json`, and `packages/nile/src/preset.ts` — group 1
creates the bundle skeleton, group 4 attaches the validators to it. Each
is extended **additively**: a new export, a new script, a new validator in
the list — never a change to what an existing entry does.

Execution order (single implementer): **1 → 2 → 3 → 4 → 6 → 5 → 7**.
Group 5 (the live witness) runs late because it needs the finished
rendering; group 6 (docs) runs before it because the documentation
obligation the spec places on this preset is verified there.

Base: `c312410e`.

## 1. The seventh published package, and the gate that says so (#563)
Files: `packages/nile/{package.json,tsconfig.json,tsdown.config.ts,vitest.config.ts,LICENSE,README.md}`,
`packages/nile/src/{index.ts,preset.ts}`, `scripts/pack-install-smoke.sh`,
`.changeset/config.json`, `AGENTS.md`

- [x] 1.1 (9m) Package skeleton that builds and packs: manifest, tsconfig,
      tsdown config, LICENSE, README. Failing test: `pnpm build` produces
      `packages/nile/dist/index.js` and `dist/index.d.ts`.
- [x] 1.2 (6m) A minimal preset bundle exported from the barrel, so the
      package has a real value to register. Failing test: importing the
      preset from the package entry yields a registrable bundle.
- [x] 1.3 (10m) Extend the pack-install smoke's hand-enumerated blocks:
      tarball resolution, scratch dependencies, assertion 1a
      (`assert_tarball_contains`), 1b (`assert_tarball_files_installed`),
      1c (`assert_license_content`), assertion 2
      (`assert_no_workspace_protocol`), and the closing summary. Failing
      test: the smoke's dependency-count guard, which fails by design the
      moment a seventh published package exists. **The guard itself is not
      edited** — it is the tripwire, and its message names what to update.
- [x] 1.4 (8m) A nile-specific entry assertion that **registers the
      preset** in the scratch config and lets `generate` load it — not a
      bare value import. Neon's block imports one value *because* that
      preset ships no bundle to register; copying it here would substitute
      a weaker check. Failing test: break the package's `exports` map and
      watch this assertion, not another, fail.
- [x] 1.5 (5m) `.changeset/config.json`'s fixed group 6 → 7 and AGENTS.md's
      "six published packages". Failing test: `pnpm check:fixed-group`,
      which compares the group against the published set in both
      directions.

## 2. The decorator driver (#564)
Files: `packages/nile/src/driver.ts`, `packages/nile/test/driver.test.ts`

- [x] 2.1 (8m) `nileDriver(base)` returns a driver that forwards `execute`,
      `transaction`, and `setupSession` to the base. Failing test: a
      recording base sees exactly what the caller sent, and nothing else.
- [x] 2.2 (7m) Capabilities pass through unchanged. Failing test: a base
      declaring `interactive-transactions: false` still reads `false`
      through the decorator, and a context on it fails with the
      missing-capability error while the rendering is never invoked.
- [x] 2.3 (9m) The decorator sends nothing of its own before the caller's
      transaction callback, **and a base that pins at connection checkout
      stays supported**. Failing test: with a recording base whose
      `setupSession` applies its settings, the transcript inside the
      transaction starts with the tenant setting and carries no
      base-driver statement ahead of it (covers the delta's "A base that
      pins at checkout is supported").
- [x] 2.4 (9m) `roleLessPlatform` and `contextRequired` are declared, and
      what each one does is observed at execution level. Failing tests:
      both readable as data before any connection; a named role outside
      the union is still refused; an uncontexted execution is refused with
      `context-required`; **a role-less context actually runs** —
      `db(schema, nileDriver(base)).as(tenantContext).execute(...)`
      reaches the base; and **a catalog-shaped read issued through the
      handle's `driver` member still reaches the base**, which is what
      makes the mandatory context safe for the schema check.
- [x] 2.5 (6m) The manifest declares no Nile client dependency. Failing
      test: the package manifest carries no `@niledatabase/*` entry in any
      dependency field.
- [x] 2.6 (5m) `[design]` `nileDriver`'s signature — what it decorates and
      how the base is handed to it. **Settled: `nileDriver(driver: Driver):
      Driver`, no options argument** (lead ruling) — Nile has no known
      branching axis the way Supabase's session/transaction-pooler split
      does; an options bag with nothing to put in it would document a
      parameter with no first user. A second argument can be added
      additively if one is ever needed.

## 3. The tenant context and its rendering (#565)
Files: `packages/nile/src/context.ts`, `packages/nile/test/context.test.ts`,
`packages/nile/src/driver.ts` (additive — wires this group's rendering onto
the decorator built in group 2, lead-approved addition to this group's file
list)

- [x] 3.1 (8m) The context builder produces a role-less context carrying
      the tenant. Failing test: the returned context names no role and its
      settings identify the tenant.
- [x] 3.2 (9m) The rendering emits `SET LOCAL` for the tenant, first —
      **observed at execution level**, not only by calling the rendering
      — and wires this rendering onto `nileDriver`'s output
      (`packages/nile/src/driver.ts`, one `renderContext` property plus its
      import), since the driver owns its own rendering (#553's own
      contract) and group 2 built the decorator before this rendering
      existed to attach. Failing test: through a `db()` handle over a
      recording base, the transcript's first statement inside the
      transaction is the tenant setting in `SET LOCAL` form (a direct
      `renderContext` call alone would make "first inside the transaction"
      an inference rather than an observation).
- [x] 3.3 (7m) The user setting follows the tenant setting when a user is
      named, observed in the same transcript. Failing test: order mutant —
      swapping the two is caught.
- [x] 3.4 (6m) `set_config` appears nowhere in the rendering. Failing
      test: no returned statement is a `set_config` call, for either
      setting (mutation: reintroduce one and watch it fail).
- [x] 3.5 (9m) A value that is not a canonical UUID is refused before any
      statement exists, with a coded error. Failing test: an adversarial
      value produces the error, nothing is rendered, and the raw value
      never appears as a substring of any statement.
- [x] 3.6 (6m) A valid value is carried through the literal-quoting rule
      rather than raw concatenation. Failing test: quoting is applied to
      the rendered value.
- [x] 3.7 (5m) `[design]` The user axis of the builder — second argument
      or second builder — and the coded error's name for 3.5. **Settled:
      `asTenant(tenantId, userId?)`, a second (optional) argument, not a
      second builder** — the platform's own ordering rule (tenant before
      user) holds either way, and a second builder would need its own
      name and its own way of still requiring the tenant, for no
      behavioral gain over an optional parameter on the one builder
      already named for the mandatory axis. **Error code:
      `nile-context-value-invalid`, discriminated by a `field: "tenant" |
      "user"` property** — one code covers both axes (mirrors
      `context-required`'s own `operation` property, `driver-conformance-
      violation`'s `tier`), rather than two separate codes for what is the
      same failure shape on two settings. Implemented and tested
      (`packages/nile/src/context.ts`, `packages/nile/test/context.test.ts`,
      tasks 3.1-3.6) — reported for lead confirmation alongside 3.1-3.6's
      own completion.

## 4. The validators (#566)
Files: `packages/nile/src/validators.ts`, `packages/nile/test/validators.test.ts`,
`packages/nile/src/preset.ts` (shared, additive)
est_frozen: 9m (re-estimated at G3 close from observed 0.1-0.3x; original
estimates below are kept, not overwritten -- this line separates
estimating-habit error from execution error)

- [x] 4.1 (9m) RLS enablement and policies are refused at generate time
      with an explicit error naming the declaration **and attributing the
      limitation to the platform's published table**. Failing test:
      generating a schema with a policy fails, no SQL is written, and the
      message carries that attribution.
- [x] 4.2 (7m) Functions and triggers are refused, with the same
      documented attribution. Failing test: one declaration each.
- [x] 4.3 (7m) Grants are refused, **and the error states that this
      refusal rests on a measurement** rather than on the platform's
      published limitations. Failing test: the message carries that
      distinction. (Comments are deliberately absent: the DSL has no
      comment declaration, so a validator for them could never fire — the
      platform fact belongs in the skill instead, task 6.1.)
- [x] 4.4 (8m) `serial`, `smallserial`, and `bigserial` in a tenant-aware
      table are refused, with the measured attribution. Failing test: a
      table with `tenant_id uuid` and each serial-family column fails; the
      same column in a table without `tenant_id` passes.
- [x] 4.5 (8m) What the platform accepts is untouched, **and no other
      preset's output changes**. Failing tests: a tenant-aware table with
      no refused declaration generates exactly the SQL it generates with
      no preset registered; and the same declarations generated with the
      Supabase preset registered are unchanged by this capability
      existing.
- [x] 4.6 (5m) `[design]` Each validator's error text, including how it
      states its evidence grade. **Settled: one shared pair of verbatim
      clauses, appended to each declaration-specific message** —
      `PLATFORM_DOCUMENTED = "this is documented in the platform's
      published limitations"` (RLS/policy, function, trigger) and
      `MEASURED_ONLY = "this refusal rests on a measurement, not on the
      platform's published limitations"` (grant, serial-in-tenant-table),
      near-verbatim quotes of the spec's own two scenario sentences
      ("attributes the limitation to the platform" /
      "states that this refusal rests on a measurement"). Every message
      also names the declaration (schema/table/column/function/trigger
      name) and ends with a "Next:" remediation clause (repo convention).
      **Caveat reported, not resolved here**: the exact platform-doc
      citation text/URL for the RLS/function/trigger limitations table
      was not available to the implementer at this task's own scope —
      the messages state the *category* of evidence (platform-documented)
      without quoting the platform's own wording verbatim, unlike the
      tenant-column convention's citation in `proposal.md`. Flagged for
      lead/researcher: substitute the exact citation if one exists.
      Implemented and tested (`packages/nile/src/validators.ts`,
      `packages/nile/test/validators.test.ts`, tasks 4.1-4.5) — reported
      for lead confirmation alongside 4.1-4.5's own completion.

## 5. The live witness (#567)
Files: `packages/nile/test/integration/**`,
`packages/nile/vitest.integration.config.ts`, `packages/nile/package.json`
(one script line, additive)
est_frozen: 15m (re-estimated at G3 close from observed 0.1-0.3x, held
higher than the other groups -- Docker pull/boot and container round trips
run in real time and do not compress at agent speed)

- [x] 5.1 (8m) Integration wiring mirroring `packages/neon`: a separate
      vitest config, a `test:integration` script, excluded from the
      default `pnpm test` and from CI. Failing test: the default run does
      not execute the integration file.
- [x] 5.2 (7m) The image is pinned by full digest
      (`ghcr.io/niledatabase/testingcontainer@sha256:188a7230d9f39e615bc584d90e8ec6f4754d0ef298701a1d6811d394f3d35696`),
      with the measurement command and the floor-not-ceiling caveat in the
      file, and a comment stating that a digest change means
      re-measurement.
- [x] 5.3 (7m) Absent Docker is an explicit failure, never a silent pass.
      Failing test: with the daemon unreachable, the run fails and says
      why — a skip reporting success would reproduce, in our own suite,
      the failure mode this preset exists to prevent.
- [x] 5.4 (9m) Witness A, **pre-registered before the run**: an
      adversarial tenant value is refused by our own UUID check (our
      half, already asserted in 3.5), and a syntactically valid UUID that
      names no tenant produces **one of two outcomes** — the server
      refuses it, or it is accepted and scopes the query to nothing.
      Record which one occurs and assert that; do not promise the refusal
      in advance. Whichever it is, the claim under test is that a value we
      did not intend cannot silently widen the scope.
- [x] 5.5 (9m) Witness B: after a context transaction, the next
      transaction on the same connection does not observe the previous
      tenant — the server-side half of "leaves nothing behind".
- [x] 5.6 (8m) Witness C, if it stays cheap: rows are actually scoped to
      the tenant our rendering applied — the end-to-end proof of the
      first-statement constraint that motivated #553.

## 6. Documentation surfaces (#568)
Files: `skills/hejbro/references/nile-preset.md`, `skills/hejbro/SKILL.md`,
`.claude/rules/provider-preset.md`, `README.md`, `AGENTS.md`,
`packages/skills/test/nile-preset-doc.test.ts` (new)
est_frozen: 9m (re-estimated at G3 close from observed 0.1-0.3x)

- [x] 6.1 (10m) `references/nile-preset.md`: the context builder, the two
      declarations, the values it refuses and why (with each refusal's
      evidence grade), the platform's refusal of `COMMENT` recorded as a
      platform fact hejbro cannot currently declare, and the base-driver
      shape this decorator does **not** support.
- [x] 6.2 (7m) A repository test asserting the documentation obligation
      the spec states — that the unsupported base shape is stated where
      users read — in the shape `packages/skills/test/`'s existing
      documentation tests already use. Failing test: delete the sentence
      and watch it fail.
- [x] 6.3 (6m) `SKILL.md`'s References table gains the nile row — and the
      missing `neon-preset.md` row, which ships today with no index entry
      and is one line of the same table.
- [x] 6.4 (5m) `.claude/rules/provider-preset.md`: `packages/nile/**` joins
      the `paths:` frontmatter, or the boundary rule never loads for this
      package. Failing test: the rule's own path list names the package.
- [x] 6.5 (9m) `README.md`'s packages table gains the row, and the two
      "Nile planned" sentences — `README.md` (lines 137-138) and
      `AGENTS.md`'s project summary — stop being true when this preset
      ships.

## 7. Spec, release record, ledger (#569)
Files: `openspec/changes/add-nile-preset/**`, `.changeset/*.md`,
`openspec/task-times.csv`, `README.md` (task-time badge only)
est_frozen: 5m (re-estimated at G3 close from observed 0.1-0.3x; the
remaining 7.4-7.6 sum, not the whole group -- 7.1-7.3 already landed)

- [x] 7.1 (8m) `rls-execution-context` delta — the tenant rendering, its
      order, its value safety, its transaction-locality, and the two
      declarations. *Landed at change setup.*
- [x] 7.2 (8m) `driver-contract` delta — the decorator driver and the base
      shapes it supports. *Landed at change setup.*
- [x] 7.3 (8m) `preset-validation` delta (new capability) — a preset
      refusing what its platform rejects, and stating the evidence behind
      each refusal. *Landed at change setup.*
- [x] 7.4 (5m) One `minor` changeset.
- [x] 7.5 (5m) `openspec/task-times.csv` rows for every completed group and
      the README task-time badge refresh (`pnpm check:tasktime`).
- [ ] 7.6 (5m) Post-merge rounds are stamped too: the isolated spec-only
      review, its corrections, and the archive move each carry their own
      `date -u` stamps and their own ledger row, written when that round
      ends rather than estimated afterwards.

## Verification (definition of done, not a task)
`pnpm check`, `pnpm check-types`, `pnpm test` with `TURBO_FORCE=1` and the
`cached` count quoted; `pnpm check:crap`; `pnpm check:fixed-group`;
`scripts/pack-install-smoke.sh` after `pnpm build`; no file under
`packages/{core,query,cli,pg,supabase,neon}` in the diff.
