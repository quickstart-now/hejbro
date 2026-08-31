Refs:
- .changeset/add-nile-preset.md @ blob 85a47b722ee51412ef0c2ee08d4850facf84e039
- .changeset/config.json @ blob e1a91a451d75eec6ebfaba9ff6e6f5410cfd77f7
- .claude/rules/provider-preset.md @ blob c312df80ad4bd03afbb4b7bdf9f837b80373fd38
- AGENTS.md @ blob 84804ea93660b1b860cf48c952dfa0735ac48c36
- openspec/changes/add-nile-preset/proposal.md @ blob 6b664707703087d20fc0892f720eb01eb0345978
- openspec/changes/add-nile-preset/specs/driver-contract/spec.md @ blob de611cab8426abccb5e1923bba2877d952fd98d4
- openspec/changes/add-nile-preset/specs/preset-validation/spec.md @ blob 87c0715e5e7d7a1807dcd0cc1596b74d2d1f3d9d
- openspec/changes/add-nile-preset/specs/rls-execution-context/spec.md @ blob 06383739c783f997e0eb35432e75bd635a1c177c
- openspec/changes/add-nile-preset/tasks.md @ blob 3a98544e27b406685fa718b3b4e5322e559ce954
- openspec/task-times.csv @ blob efbca6337719a0b479642a87c6c5eb0c313f5425
- packages/nile/LICENSE @ blob 91bfc8d3fd5f41a85ea969de60cb3253c9dc8377
- packages/nile/package.json @ blob 0bcebdc5021d91f9d3d2e8b1d656f314ce3ac669
- packages/nile/README.md @ blob dafb4e665b19ae81331c0e37ee921c8c1d4efa68
- packages/nile/src/context.ts @ blob 4e4aa6274ab2502655ba599fc8286f7dbd2c5744
- packages/nile/src/driver.ts @ blob af6c2ff39c08575883f985b7372edc93aa6bd449
- packages/nile/src/index.ts @ blob ebd64a886830ab3929b9b880d48d639838878d51
- packages/nile/src/preset.ts @ blob 3bbf568ce16a3f12e03110289e4d0cfe9df05f32
- packages/nile/src/validators.ts @ blob 8a6540f246b2314e788c2b06d92aa8b4199b2d77
- packages/nile/test/context.test.ts @ blob 8352f7ea52d04d4f6a2e685dc31561b7d25799f2
- packages/nile/test/driver.test.ts @ blob 61d564feb5b7004363fd32541c1c74e9d2f88bb2
- packages/nile/test/exports.test.ts @ blob 45cffb2bb91d040baa5b9474a3a31b0a9acceed9
- packages/nile/test/integration/nile.integration.test.ts @ blob 9e8c8eea9072b99da01075d39f14f2deae742ea4
- packages/nile/test/preset.test.ts @ blob c6935eb730505e76f566c5cf68970643a6d0d24b
- packages/nile/test/validators.test.ts @ blob 251cad8e7a1bebcae8e03f1005ea4b7cf2089392
- packages/nile/tsconfig.json @ blob aa088dcc2b5d56c3fb3265c3dc21dc67a2dc312c
- packages/nile/tsdown.config.ts @ blob 2c54079c897adf725ff778fb15dc13adce558d43
- packages/nile/vitest.config.ts @ blob d64031095d92c4104082384819fedcc2120d3fd4
- packages/nile/vitest.integration.config.ts @ blob 83aace3e1d8f96d5cae8d1936655ee5f2ee35fe1
- packages/nile/vitest.shared.ts @ blob bc9af68215e6e62d544f3ca4e476e355935c461b
- packages/skills/test/nile-preset-doc.test.ts @ blob 456ec1f50ff6237f9cb61bb8070d90b3877a5bed
- packages/skills/test/snippet-check.ts @ blob 7d7694d474452cedfe4a485023c0a54703a15fad
- pnpm-lock.yaml @ blob de48ad22db5756775e0f61f60ba11d4cbc75917c
- README.md @ blob e7e175dc652eedeaf66f1c1c99bd77cff3d9f489
- scripts/pack-install-smoke.sh @ blob 313b81f05e720af1dc966853b060959b634a1310
- skills/hejbro/references/nile-preset.md @ blob ab814981a26bb64a8865bd924accff3ef27cb105
- skills/hejbro/SKILL.md @ blob 5099d46542997d1f19a8fcb92117d261c57d22e4

(Taken from `git hash-object <path>` on the frozen tree at `b2dd6a5f`,
before the blackbox commit; every file the branch touched against dev
`c312410e`. The `openspec/changes/add-nile-preset/` paths will move when
this change archives; those pins are re-pathed in the archive PR, blobs
unchanged unless the D106 round corrects text — corrected files are
re-pinned and annotated, as the #553 archive did. Pins die three ways —
squash preserves them, an archive kills the path, a concurrent same-file
edit on dev kills the blob — so every later commit re-verifies all of
them, itemized by bucket rather than by count.)


# add-nile-preset — the third preset, and the test the contract was waiting for (#301)

nl piece team (planner opus, implementer sonnet, reviewer opus; the
researcher had finished in the #553 detour) off dev `c312410e`. This
change is owner-driven: the two rulings that shaped it were made by the
owner, in session, during the #553 detour, and are applied here rather
than revisited.

## Owner inputs (English rewrites)

1. **Direction D+A** (2026-08-31): generalize context application first
   (#553), then express `asTenant(...)` on the generalized mechanism.
   This change is the "A" half.
2. **The preset ships** despite Nile refusing RLS, policies, functions,
   triggers and `GRANT`: the preset's validators fail those early with
   explicit errors — detect, options, commands — never a silent rewrite.
   `GRANT` (and later the serial-family and primary-key rules) are
   measured refusals, not documented ones, and the errors say so.

Everything else in this change was settled under the owner's standing
delegation by the lead session and is listed for the owner's return.

## What the change proves

The preset touches no file under `packages/{core,query,cli,pg,supabase,
neon}`. That was the proposal's self-refuting clause: if any of the
three driver declarations #553 introduced (`renderContext`,
`roleLessPlatform`, `contextRequired`) had needed a query-layer change
to work here, the contract was still wrong and the piece would have
stopped. It did not stop. `.claude/rules/provider-preset.md` had said
"the next preset (Nile) is the test that matters"; this is that test
passing, and the sentence was retired in the same change.

## What landed

- `nileDriver(driver)` — a spread decorator over a base driver the
  caller built (the Supabase shape; Nile speaks plain Postgres on one
  path, so there is no client to wrap). It adds exactly a context
  rendering and two declarations and passes `execute`, `transaction`,
  `setupSession`, and `capabilities` through by reference — asserted,
  not assumed. A base without interactive transactions is still refused
  a context by the query layer's existing gate; the rendering is never
  invoked.
- `asTenant(tenantId, userId?)` — a role-less context. The driver's own
  rendering emits `SET LOCAL nile.tenant_id` first and `SET LOCAL
  nile.user_id` after it, never `set_config` (structurally unable to set
  the tenant; silently skips the membership check for the user).
  Validation lives in the rendering as a single source, so a context
  built by hand gets the same guarantee: a value that is not a
  canonical UUID is refused before any statement exists
  (`nile-context-value-invalid`, the value never echoed), and a valid
  one is still literal-quoted.
- `roleLessPlatform: true` and `contextRequired: true` — the second
  because Nile is fail-open without a context. The CLI's catalog read
  is unaffected because it goes through the driver session, not a
  `db()` execution surface; that causal claim is a scenario, not a
  remark.
- Five generate-time validators (`preset-validation`, a new capability
  written for the concept, not for Nile): RLS and policies, functions
  and triggers, grants, the serial family in a tenant-aware table, and
  a tenant-aware table whose primary key omits `tenant_id`. Each error
  names the declaration, what the platform does with it, its evidence
  grade (`PLATFORM_DOCUMENTED` or `MEASURED_ONLY`), and a `Next:` — and
  a loop test asserts the `Next:` clause on every refusal, so a sixth
  validator is covered the day it is added.
- A docker-gated live witness against Nile's official test container,
  pinned by full digest, wired like `packages/neon` (separate config,
  `test:integration`, out of the default run and CI). Absent Docker is
  an explicit failure, verified by injecting a fake `docker`. Witness A
  (our UUID gate, then the server's own refusal of an unknown tenant),
  B (a later transaction on the same connection sees no previous
  tenant), C (rows are scoped to the tenant the rendering applied).
- The seventh published package's gate registrations: the pack-install
  smoke's hand-enumerated blocks (with a nile-specific assertion that
  **registers** the preset rather than importing a value, and that
  imports `nileDriver`/`asTenant` from the installed tarball), the
  fixed changeset group (6 → 7), AGENTS.md, the skill reference and
  index (with the neon row that had been missing), the provider-preset
  rule's paths. The `DEP_COUNT` guard fired first and stays unmodified.

## What the measurements changed

- The live witness surfaced a platform rule the documentation does not
  state: a tenant-aware table's primary key must include `tenant_id`.
  It became the fifth validator — and when it was added, two of the
  piece's own fixtures failed it (a test schema and the smoke's scratch
  schema, both `id`-only keys next to `tenant_id`). The strongest
  evidence that a validator works arrived from the examples the team
  had been writing. The rule is stated only as measured: whether a
  tenant-aware table may have no primary key at all, and whether column
  order matters, were not measured and are not claimed.
- Witness A's server-side half was pre-registered with two outcomes
  (refusal, or acceptance with an empty scope). The server refused. The
  expectation had been the other one; the assertion follows the
  measurement, not the expectation.
- `COMMENT` is refused by the platform, but hejbro's DSL has no comment
  declaration, so no validator can ever fire. It is recorded in the
  skill as a platform fact, and the capability gained a general rule: a
  preset does not refuse what hejbro cannot express.

## What the reviews caught

The piece review passed in one round (five mutants killed, one of them
across the package boundary). Before it, three defects were caught
inside the piece and are recorded as such:

- **F1 recurred.** The package barrel never exported `nileDriver` or
  `asTenant` through two groups: the tests imported internal paths, no
  delta scenario named public reachability, and every gate was green.
  The skill's snippet-compile gate caught it by accident. The closure is
  the three layers #553 established — a delta scenario, an exports pin
  in the package's own tests, and an import from the installed tarball
  in the smoke (the workspace alias bypasses the `exports` map, so only
  the dist path proves it) — and the recurrence is the reason nl-Q3
  exists: a recorded lesson does not prevent a repeat until something
  structural requires it.
- A delta sentence over-claimed ("nothing reaches the driver") where the
  query layer opens the transaction before the rendering runs; the
  implementer narrowed its reading and continued, which was the exact
  tripwire moment. The sentence was corrected before archive; the
  procedural lesson — the moment you narrow a spec's reading to make it
  hold is the moment to stop — was recorded.
- The first "tenant first" scenario quantified over every base driver,
  including the in-transaction-pinning shape the same delta calls
  unsupported. Split into the general claim (first among what the query
  layer sends) and the supported-base claim (first inside the
  transaction).

The review's three non-blocking observations were settled without a
second round: `@hejbro/pg` sits in the package's `devDependencies` as the
live witness's base driver while the provider-preset rule names that
package as forbidden — the rule now says the prohibition is on what a
preset ships and imports at runtime, and that a concrete driver as the
base of a preset's own tests is how a decorator proves itself; the
`HEJBRO_NILE_IMAGE` override is kept, with the witness and the skill
stating that an overridden run no longer measures the digest the file
names; the third (a test asserting more than its name) was left as the
stronger check. Because the increment touched only a rule file, a
comment, and the skill, the reviewer verified it at reduced scope —
after independently confirming the classification from the diff paths
and the witness file's non-comment lines — instead of spending the
second of the two review rounds, which stays in reserve for a CI
failure. That operating rule for the round cap is recorded here for
reuse.

## Attribution

Decisions in the piece: the owner's two rulings above; the planner's
spec placement (driver requirements in the two existing capabilities,
per the Neon precedent; only the validators in a new capability); the
implementer's single-source validation and the choice not to echo
adversarial values; the reviewer's layer distinction between the
barrel pin and the `exports`-map proof. The lead ruled the [design]
items, the freeze exceptions, the fifth validator, and the tag freeze.

## Method notes

- Per-task `date -u` stamps replaced commit-timestamp reconstruction
  after the first ledger row measured a commit gap instead of work; one
  row was re-measured from file birth times rather than estimated.
- Frozen re-estimates (`est_frozen`) were recorded from group 4 on,
  because the observed ratio against human-scale estimates ran at
  0.1–0.3×; the original estimates stay so the two errors — estimation
  habit and execution — can be separated.
- The handoff tag for group 6 was force-moved three times in a crossing
  of instructions; the sequence is in the ledger from the push output,
  the tags were frozen, and the crossing was closed with a single token
  rather than a further ruling. Two rules came out of it: a question you
  asked is not answered until the answer arrives, and when correcting a
  low-harm state, compare the cost of the fix with the cost of leaving
  it.
