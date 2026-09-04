# Work — quickstart-now/hejbro#301

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — add-nile-preset — the third preset, and the test the contract was waiting for (#301)

_2026-08-31T00:00Z_

(Originally taken from `git hash-object <path>` on the frozen tree at
`b2dd6a5f`, before the blackbox commit; every file the branch touched
against dev `c312410e`. Re-pinned in the D106 correction + archive round
(2026-08-31): the five `openspec/changes/add-nile-preset/` paths moved
to `openspec/changes/archive/2026-08-31-add-nile-preset/` on archive —
`proposal.md`'s blob is unchanged by the move, its three sibling spec
deltas (`driver-contract`, `preset-validation`, `rls-execution-context`)
carry the D106 correction-round text, `tasks.md` carries the 7.6
checkbox. Eight further paths kept their location but not their blob
this same round from this piece's own D106 corrections:
`.changeset/add-nile-preset.md` (F6), `packages/nile/src/context.ts`
(F3), `packages/nile/src/validators.ts` (F8/F10),
`packages/nile/test/context.test.ts` (F3),
`packages/nile/test/integration/nile.integration.test.ts` (F11),
`packages/nile/test/validators.test.ts` (F8/F10),
`skills/hejbro/references/nile-preset.md` (F2/F4/F5/F9 + the round-2
runtime-refusal paragraph), and `openspec/task-times.csv` (the D106
review, correction, and archive-round ledger rows). Six more paths kept
their location but not their blob from `#571`'s relicense, which edited
them on `dev` after `#572` merged and before this branch's own base —
a concurrent-edit pin death, not a content change of this piece:
`AGENTS.md`, `packages/nile/LICENSE`, `packages/nile/package.json`,
`scripts/pack-install-smoke.sh`, `skills/hejbro/SKILL.md`, and
`README.md` (mixed: `#571`'s license text plus this piece's own two
badge-refresh commits). One path is a genuinely new pin, not a
re-pin: `skills/hejbro/references/query-layer.md` was never touched by
the piece before archive, only by this same D106 correction round
(F1/F2-doc) — it was absent from the original 36-item list entirely.
The remaining seventeen paths are unchanged, verified against this
file's own prior pins before the correction commit. Pins die three
ways — squash preserves them, an archive kills the path, a concurrent
same-file edit on dev kills the blob — so every later commit
re-verifies all thirty-seven, itemized by bucket rather than by count.)




nl piece team (planner opus, implementer sonnet, reviewer opus; the
researcher had finished in the #553 detour) off dev `c312410e`. This
change is owner-driven: the two rulings that shaped it were made by the
owner, in session, during the #553 detour, and are applied here rather
than revisited.

### What the change proves

The preset touches no file under `packages/{core,query,cli,pg,supabase,
neon}`. That was the proposal's self-refuting clause: if any of the
three driver declarations #553 introduced (`renderContext`,
`roleLessPlatform`, `contextRequired`) had needed a query-layer change
to work here, the contract was still wrong and the piece would have
stopped. It did not stop. `.claude/rules/provider-preset.md` had said
"the next preset (Nile) is the test that matters"; this is that test
passing, and the sentence was retired in the same change.

### What landed

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

### What the measurements changed

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

### What the reviews caught

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

### The D106 gate (PASS, with corrections before archive)

The isolated spec-only review returned PASS — 0 blocking, 3 major, 8
minor. No delta scenario contradicted shipped behavior; every one the
evaluator could drive, it drove (25 rows). The findings were gaps
between the spec, the public surface, and the corpus, and eleven of
them were closed before archive rather than filed.

The one that mattered was F3. The rendering *projected* the context
instead of mapping it: a role that passed the declared-role whitelist
was dropped without a `SET LOCAL ROLE`, and any setting outside the
two Nile keys vanished without a statement or an error. That is the
shape the corpus forbids for the role-less case — running under
whatever role the connection already holds — reached through a named
role instead. Applying the role is not an option on this platform (the
role statement is ignored and blocks the tenant setting behind it), so
the rendering now refuses what it cannot apply, before producing any
statement, with `nile-context-unsupported` and a `field` naming the
part; the value is never echoed. The piece review had not asked this
question because the delta had not: every axis was about what the
rendering *does* with the tenant and user keys, none about what it
does with the rest of the context. A reader with only the spec asked
"and the rest?" — which is what the stage exists for. The fix was
mutated on both branches separately (role, foreign key): removing
either refusal turns its own tests red, so "one of the two still
holds" cannot pass.

The other corrections: the query-layer skill still listed the Nile
preset as unsupported (F1, a sweep this piece missed while editing the
same file); none of the seven error codes was on the public surface
(F2 — the skill's refusal table gained a code column and the delta pins
each code, the same convention #553's correction round applied); the
mandatory-context rationale named `hejbro check`, which builds its own
`@hejbro/pg` driver and never sees this one (F4, below); "before any
statement is sent" overstated what the scenario states precisely (F5);
the changeset said "any driver" where the delta restricts the base
(F6); the first-statement platform claim carried no evidence grade
(F7 — measured, like the validator refusals); a trigger produced a
second diagnostic for its own synthesized function with a `Next:`
naming a declaration the user never wrote (F8, fixed by excluding
trigger-owned functions by reference, not by name); identity columns
are sequence-backed and unmeasured (F9, stated as such in the skill and
queued as #573); the primary-key refusal now names the key's columns
(F10); witness B now asserts `pg_backend_pid()` is unchanged, so it can
no longer pass for the wrong reason (F11). The review ran the
correction as the second of the two rounds because it touched source;
a later text-only increment (pinning the new code in the delta, one
skill sentence stating why a role is refused rather than ignored) was
verified at reduced scope after the reviewer independently confirmed
the classification from the diff.

### Attribution

Decisions in the piece: the owner's two rulings above; the planner's
spec placement (driver requirements in the two existing capabilities,
per the Neon precedent; only the validators in a new capability); the
implementer's single-source validation and the choice not to echo
adversarial values; the reviewer's layer distinction between the
barrel pin and the `exports`-map proof. The lead ruled the [design]
items, the freeze exceptions, the fifth validator, and the tag freeze.

### Method notes

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

Six of this entry's pins died before archive without this piece
changing a byte: the relicense (#571) merged after #572 and edited
`AGENTS.md`, `README.md`, the skill index, the smoke script, and the
nile package's `LICENSE` and manifest. A pin proves content, not order;
when two pieces touch the same file on the same day, the later merge
kills the earlier pins, and re-pinning them with the cause annotated is
the normal procedure. The lead pre-announced the six so the archive
round's sweep would read them as expected rather than as an alarm.

F4 was a joint error. The planner and the lead both concluded that a
mandatory context does not block the CLI's schema check, and both cited
`packages/cli/src/check/catalog.ts` as the reason. The conclusion was
right; the reason was wrong: `hejbro check` builds its own `@hejbro/pg`
driver and never sees a decorated one, so `contextRequired` is not in
play there at all. The surface the reasoning fits is `assertSchema`
reading through a handle's `driver` member, which the corpus already
exempts. A correct conclusion on a wrong basis would have misled the
next reader; the requirement and the scenario now name the right
surface, and the internal path citation is gone from the skill.

Two more operating rules came out of the last hour. The reviewer runs a
text-only increment at reduced scope only after confirming the
classification independently from the diff paths and, for a test file,
from its non-comment lines — the classification sets the verification
strength, so the verifier checks the premise. And the whitelist that
defines an increment's scope travels in the same message as the tip
SHA it applies to; anything sent earlier is an estimate. The second
rule replaced two consecutive omissions in which instructions widened
the scope after the list had gone out — the list was stale from the
moment it was sent, and memory was the only thing keeping it current.

Migrated from the single-file entry `.blackbox/2026-08-31-add-nile-preset.md`, kept verbatim at `.blackbox/301/artifacts/2026-08-31-add-nile-preset.md`.

