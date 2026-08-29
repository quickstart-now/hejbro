# 2026-08-29 — `@hejbro/neon`, the second provider preset

Refs — blob SHAs of this change's files in its final tree, generated with
`git rev-parse <commit>:<path>` at branch commit `c1eb7eb` and unchanged
since. That commit is provenance only: a squash merge does not preserve
it, while the blobs it names are the content of the merge commit's tree,
which is what a pin is for. The renamed rule file appears here only under
its surviving path — a deleted path carries no blob in the final tree, so
there is nothing to pin.

```
.changeset/add-neon-preset.md 082ea6227ed98d1a2bb18e7fbaf6e0f2a74ad6aa
.changeset/config.json 8fd471a60449382c211ee5dcfa7f8c2fa0849361
.claude/rules/provider-preset.md 8e2469d2e2713c0a779518eab3e080e65240001e
AGENTS.md a5584e2a86da047985b7fd18be9a51746d970433
openspec/changes/add-neon-preset/.openspec.yaml 50adc91034fafb883485599339d460729ea20b5c
openspec/changes/add-neon-preset/design.md cd19eb6b12da5d099118e6ffbf60bfb92ade649f
openspec/changes/add-neon-preset/proposal.md b98a25f6a8a1dbe1e227ff755141713b1b4f9ee4
openspec/changes/add-neon-preset/specs/driver-contract/spec.md 0929e895be7261acd6b59a06b230dbe20236cc6b
openspec/changes/add-neon-preset/specs/rls-execution-context/spec.md d708def0499ae5abe33161d8d2f744016b68b0f6
openspec/changes/add-neon-preset/tasks.md dce6b0381ff3cbe960c66e4b491be27368a17859
openspec/task-times.csv 032655ff288645f919e377fb003abb0083784c5e
packages/neon/LICENSE 91bfc8d3fd5f41a85ea969de60cb3253c9dc8377
packages/neon/README.md 97b2cfe2f3a17d4330690957edbd067e385906ce
packages/neon/package.json d2daf51dad969ec92b9b448f0009244ccf588053
packages/neon/src/auth.ts 659a1bb82713a76fd90b7b2cbf4dbec5fe58fd17
packages/neon/src/context.ts 4d9a5470493776fb54d77c51732618e73f4a0b54
packages/neon/src/driver.ts 9d73089e81a5ab0b575b8b2c927484f9672d1152
packages/neon/src/http.ts dd84a521bed1233768c1ee839cf5e0e92bc5deb4
packages/neon/src/index.ts 0e662226c24ed6f82d10a142200f4dc16823b400
packages/neon/src/roles.ts e5fce7777e1634679d01c2685a77868b6c6942fd
packages/neon/src/type-overrides.ts 940bbab4a438119644900e99bc0a531f8e50c32d
packages/neon/test/auth.test.ts e448aae0888a19930ff51801bf62575711ed2cf8
packages/neon/test/context.test.ts 167d1e5dffe07cc8f0ef589ac01d4de7894bf0f2
packages/neon/test/driver.test.ts ce9b3bffe6e6127430f168e5a41e99344920cb1a
packages/neon/test/entry.test.ts 410c4cbe41bf83f8c24fb81f83441c097e273f68
packages/neon/test/http-session.test.ts 72810b5b3e408a9c16e5bbbb3d219ff499bf36a5
packages/neon/test/integration/ws.integration.test.ts 7e4a9e1e1136c447a48f396211a197ae7adee8a7
packages/neon/test/roles.test.ts 096e8ad3222ba77acc06dd9131d9b59c7fbae9aa
packages/neon/tsconfig.json 736377c39eee2c5cb58d95037d1fac81d0f23aec
packages/neon/tsdown.config.ts 2c54079c897adf725ff778fb15dc13adce558d43
packages/neon/turbo.json 5368f20f33e7df2f7aa5d0e9df07b641f8fcf61d
packages/neon/vitest.config.ts 0ce449c7086e39631bffcfe575e42d74b10a94e7
packages/neon/vitest.integration.config.ts ada5a8e3b8b4aa05dc308142e70c24a86876fbff
packages/neon/vitest.shared.ts e8aff23756e2e4b44239c716919140d37a917a21
packages/skills/package.json 4e79cc6148ad11992fa2dd6f18c4789936e2ebf7
packages/skills/test/snippet-check.ts 5fb631b2cf0ae36f8d12eb867d10c85b38a53388
pnpm-lock.yaml 23d1890502969aa40ff80ac44bb3962015eefdf6
scripts/crap-report.mjs 7305f8ac99295f83eeabf4709da85707cf229d16
scripts/pack-install-smoke.sh 3af17ccd52c385498b776e1482dbfef1e8160bf3
skills/hejbro/references/neon-preset.md bfde5b9ef85759e970e7a1243cdd9737d22f98cb
README.md a02b3fabe2a2a0b5f4fa6a046552ca63c5278ffb
```

## Owner context

The owner was absent for this change. Two owner-set facts framed it, and a
standing delegation covered the rest.

**Fact one — the piece was already inside a gate the owner set.** The owner
had settled that 0.2.0 means every sub-issue of #282 closes. #300
(`@hejbro/neon` preset with driver) is one of them. That matters because
`@hejbro/neon` also appears under "Deferred" in the design spec's v1 cut
(D98), and building a Deferred item is an owner-approval hard gate. The two
statements are not in conflict: D98 deferred it *from v1* and parked it as
an issue; the owner then placed that issue inside the 0.2.0 gate. The lead
recorded this judgment explicitly rather than letting the team infer it, and
flagged it for owner confirmation on return.

**Fact two — the design spec already anticipated this package.** D95's
package map is written as `@hejbro/supabase|neon|nile`, and it names
`@neondatabase/serverless` as the client a Neon driver would wrap. So the
change applies three existing decisions (D95, D96, D98) and revisits none.

**Delegation.** In the owner's absence the lead held merge, planning, and
owner-decision authority for openspec artifacts, until the owner declares
return. Every decision below marked "ratified" was ratified by the lead
under that delegation, not by the owner directly.

## What was asked for, and what it turned into

The lead's instruction was a full OpenSpec cycle for #300: proposal →
approval → tasks → TDD → review → PR. Scope was settled early as **B+** —
"minimal but complete": preset, driver, honest capability declarations, and
as much RLS context as D96 dictates. Parity with `@hejbro/supabase` was
rejected explicitly, with the justification axis fixed as "what Neon
actually dictates" rather than "what the other preset has".

The piece's stated purpose was never the Neon feature set. It was this:

> `@hejbro/supabase` proved a preset could be written. It did not prove the
> preset *interface* works, because a single preset cannot: every shape it
> needs is a shape that was built for it.

That framing turned out to be load-bearing. Three contract gaps surfaced
during implementation, each of which required a *second* provider to
become visible:

- **#481** — `session-state` is declared by every driver and enforced by
  nothing. Found by grepping for the capability's readers: `driver.capabilities`
  is read in exactly one place, and only `interactive-transactions` is ever
  asserted.
- **#486** — the contract has no vocabulary for the ability Neon's HTTP path
  actually has. `Driver.transaction` takes an interactive callback; Neon HTTP
  runs a pre-assembled batch. `interactive-transactions: false` is therefore
  the honest declaration, but it describes a *callback shape*, not a missing
  ability.
- **#490** — the contract requires a capability-less driver to throw
  `driver-missing-capability`, and `@hejbro/query` exports no builder for that
  error. Every preset driver must therefore copy the user-facing message.
  Today the copies are byte-identical; nothing keeps them so.

## The decision sequence, including the reversals

Reversals are recorded with what was believed at the time, because the
record is worthless if it only shows the final answer.

### The HTTP-shipping fork — whether to ship the one-shot path at all

**First answer: no.** The planner recommended WebSocket only, on the
grounds that `session-state: false` is unenforced (#481), so an HTTP driver
would ship a silent divergence in `interval`/`bytea` arrival shape that no
gate could catch. The lead approved.

**Reversed to yes, with a third shape.** Two facts arrived after the
approval. First, the issue text — recovered only after the decision — reads
"the capability set must tell the truth **so missing-capability errors fire
correctly**", which is unsatisfiable if every capability is `true`.
WebSocket-only would have deleted the fork the piece exists to test.
Second, the divergence could be removed inside the driver: Neon's HTTP path
accepts a batch, so each execution can carry its own session pins. That is
not a faked capability — `session-state: false` stays true about
persistence *between* executions, and the driver only claims its own
statements run under its own pins.

The planner's own diagnosis of the first answer: the principle applied
("do not ship what no gate can hold") was right, but the recommendation
came before looking for a third option.

### The mode-surface fork — how the two authentication modes are exposed

`pg_session_jwt` resolves identity from `request.jwt.claims` when no JWK is
configured, and from `pg_session_jwt.jwt` — a raw token it verifies itself
— when one is. The two are mutually exclusive: in the second, the claims
setting is ignored outright. Both are ordinary `Userset` GUCs, so both are
expressible through the existing `{role, settings}` context; only the key
differs. (This retired an escalation: an earlier reading had the second
mode requiring a function call, `auth.jwt_session_init(jwt)`, which
`DbContext` cannot express. Reading the extension's source showed that
helper is a thin wrapper around `SET` on a `Userset` GUC — and that the
context mechanism's `set_config(..., true)` is *stricter* than the helper,
which uses session scope.)

**First answer: ship both builders side by side.** **Reversed** after the
reviewer set the bar: judge this not by "how do we express two modes
prettily" but by "can a wrong combination be made unrepresentable". Two
builders side by side leaves the wrong pairing expressible, and it cannot
be caught at run time either — detecting the database's mode means reading
database state, the probe this design refuses everywhere else.

**Final: the mode is stated once, at construction.** `neonAuth(mode)`
returns only that mode's builders. This is the driver's overload decision
applied a second time: a fact about the environment fixed as data at
construction, never discovered by a probe.

The planner then **weakened its own claim** for this shape. "The wrong
combination cannot compile" was an overstatement: a user can still declare
the mode their database does not run. What the factory actually removes is
*mixing* two modes inside one codebase — always a bug, since a database has
one mode — and it collapses the audit to one line.

### The mode literal — `"claims" | "jwt"`

Ratified as `"claims" | "jwk"`, implemented as `"claims" | "verifying"`,
and the substitution passed through a planner review marked "same as
proposed" — same as the *implementer's* proposal, not the *ratified* text.
The lead caught it.

The substantive correction matters more than the procedural one:
`"verifying"` fails the exact test that had already rejected
`asVerifyingUser` as a builder name — `neonAuth("verifying")` misattributes
verification to the preset at the call site. A name rejected for a builder
had been revived for the mode. `"jwk"` was retired too: a JWK is the thing
the *caller never touches*. `"claims" | "jwt"` names both modes on one axis
— what the caller hands across the boundary.

## Measurements

**The fallback trigger.** The HTTP driver shipped conditionally: the
committed test pins batch composition and order against a stub transport,
which can always be made green and is therefore not a trigger. The trigger
was a one-time manual measurement — `interval` and `bytea` read back over
the HTTP path against a real server and compared to `@hejbro/pg`. Both
matched, so group 2 stayed. The record states its own scope: both sides
carried the pins, so it shows *parity between the two paths*, not that the
pins caused it (`postgres:17`'s defaults already match).

A first run of that measurement read "mismatch" for `bytea` and was traced
to the measurement method, not the driver — a top-level `bytea` is never
the pinned hex form; that handling exists only for a nested JSON-aggregated
cell. Had the mismatch been taken at face value, the pre-approved fallback
would have fired and the HTTP path would have been dropped for a reason
that was not true.

**Three traps in the local stack**, none of them in vendor documentation,
each recorded because rediscovering one costs an hour: the open-source
wsproxy registers `/v1` while the client's default appends `/v2`;
`APPEND_PORT` is concatenated rather than substituted, so setting it as
community examples do produces a doubled address; and the HTTP proxy must
start after Postgres accepts connections or its mock control plane fails to
bootstrap and every later query dies with an error that names nothing.

**The type override, measured wrong first.** To let a skill snippet compile
without importing the client library, the planner proposed deriving the
type from our own surface: `Parameters<typeof neonDriver>[0]`. Measured, it
resolves to an overloaded function's *last* signature — the HTTP one — so a
WebSocket example would have been typed as HTTP. The dependency was made
real instead, in the skills package's own devDependencies, rather than
mixing a third-party path into a whitelist that means "hejbro packages".

## What the interface claim was tested against

The proposal stated the claim so it could fail:

> `driver.capabilities` is read in exactly one place in the repository,
> reached from exactly two. A driver that declares its capabilities as data
> therefore has no reason to touch `packages/query/src/db/`. If this
> change's diff touches it, the claim that the provider interface admits a
> second provider is false, and the right response is to fix the interface —
> not to special-case Neon.

Every group's review checked it. Through group 6 the diff touches no file
under `packages/core`, `packages/query`, `packages/cli`, `packages/pg`, or
`packages/supabase`. The claim held; the three gaps above were recorded as
issues rather than worked around.

## Process findings

These outlived their occasions and were adopted as repository rules. Each
is recorded with the failure that produced it, because the rule reads as
pedantry without it.

- **A gate that never sees a package is not a gate.** Registration lists
  are hardcoded in three places (CRAP targets, pack-install smoke, and the
  skill snippet compiler's import whitelist). Verifying registration means
  removing it and watching a planted defect pass — otherwise "we registered
  it" is an unverified claim.
- **A number is not evidence without the command that produced it.** A
  commit subject reported as 47 characters was 51; the planner had relayed
  the implementer's figure without measuring. Layers of relay make an
  unverified number look verified.
- **A surviving mutant means nothing until the mutation is known to have
  applied.** A `sed` pattern with the wrong indentation left a mutant
  unapplied and the suite green; the reviewer caught this before reporting
  a defect that did not exist.
- **A red result must be shown to be red for the intended reason.** A probe
  mutant failed with a connection error, which would have "passed" for the
  wrong reason; re-running it with the error swallowed showed the spy
  assertion failing instead, which is what the scenario claims.
- **An overclaimed sentence is usually a symptom of a gap.** Tightening one
  sentence about what `psql` stands in for exposed that no test anywhere
  observed the client-side parser half of arrival shape, which produced a
  new witness task.
- **What is not named does not exist.** Plans that do not name a mechanism
  do not get it implemented; prohibitions that name one action permit the
  other; gates that do not list a package do not check it. The prescription
  is not "read carefully" — it is to place a finished analogue alongside and
  compare item by item. Where no analogue exists, only early execution
  finds the gap.
- **Self-blame is a claim, and claims need evidence.** Two apologies here
  ("discard that judgment", "the waste is mine") were both wrong and cost
  the reviewer a verification round each. A wrong apology is more expensive
  than a wrong assertion: the other party has to find the evidence to
  refute it, and if uncorrected it enters the record.

## What the verification actually showed

Four observations carried the change. Each began as an argument and ended
as something watched.

**The pooling guarantee.** D96 chose transaction-local scope so an
identity cannot outlive the request that set it. Two tests were written
to hold that — one asserting the emitted statement's third argument,
one asserting a reused pooled connection is clean afterwards — on the
reasoning that either alone is insufficient: inside a single transaction
the two scopes are indistinguishable, so reading the value back cannot
tell them apart. With the local stack running, the reviewer mutated
`@hejbro/query` itself to emit session scope instead. Both went red, and
the behavioural one printed the leak:

```
× identity does not survive the scoped execution on a reused connection
   AssertionError: expected '{"sub":"aaaaaaaa-0000-4000-8000-00000…' to be falsy
```

The mismatched-mode test failed alongside it, unplanned: the leaked
identity reached the *next* test and admitted rows that scenario exists
to see denied. The failure mode spreading across requests is what
pooling leaks are, watched directly.

**The gate that could not see the package.** The proposal claimed that
hardcoded registration lists leave a new package unmeasured while CI
stays green. The reviewer planted one over-threshold function and ran
the gate twice — once with the registration removed, once restored:

```
registration removed → scanned 1434 functions across core, supabase, query, pg
                       check-crap: ok -- no violations
registration restored → scanned 1455 functions, incl. @hejbro/neon
                       30.00  complexity=5 coverage=0%  plantedComplexity
                       error[check-crap]: 1 function(s) exceed the threshold
```

The same defect, invisible and then caught. This is also where the
counterfactual discipline this change adopted proved its own premise.

**A gate list that was one entry short.** The task named six sites in the
pack smoke; the implementer judged a seventh belonged (every other
package had it) and added it. That seventh assertion is the one that
caught a deliberately emptied `files` field. Six would have passed.

**A criterion that measured nothing.** Group 8's acceptance test for the
fixed-group registration — that `changeset status` lists the package with
the other five rather than alone — was set in group 1, ratified, and
carried for eight groups. Run as a counterfactual it turned out to be
blind: the text output is identical with and without the registration,
because the changeset file declares the bump directly. The correct
observation is the resulting version (`0.2.0` alongside the others,
`0.1.0` alone), read from `--output` JSON. The registration was right;
the criterion had never been able to tell.

## The drift this change predicted, dated

`@hejbro/neon` copies the `driver-missing-capability` message text
because the contract requires that error and exports no builder for it
(#490). The copies were byte-identical when the issue was filed, with
nothing holding them so.

While this change was in review, `@hejbro/query` shipped an error-message
change. It turned out to touch a different error entirely —
`query-execution-failed`, in a different file — leaving the copied text's
own source untouched. So this was not a near miss: it was a reason to
look, and looking found the copies still identical, verified twice
(before and after the rebase) with a control showing the comparison
detects a one-character difference.

What that leaves is a dated left edge, not a resolution. The check
happened because a person read the issue and went to compare; nothing in
the repository would have said anything had the copied path been the one
that moved. When the copies do diverge, this record says when they had
not yet.

## Final state

Rebased onto `dev` at `f2e7781`, which had moved three commits past the
value announced when the rebase was planned — so the target was read at
the moment of the rebase rather than taken from the announcement. Two
files conflicted, both append-or-regenerate rather than semantic:
`README.md`'s two badge blocks (resolved by regenerating, not by hand-
editing numbers) and `openspec/task-times.csv`'s tail, where two changes
had each appended rows; both sides kept, this change's 47 rows confirmed
present afterwards. `.changeset/config.json` merged clean and still
carries the package in the fixed group.

Every figure quoted during the change is stale after that move, so all
were re-measured:

```
check          514 files, no fixes            (was 502)
check-types    15/15
test           16/16 — @hejbro/neon 36 tests
build          6/6
check:bans     170 source files               (was 167)
check:crap     0 of 1506 functions over CRAP 5, highest 5.00,
               across core, supabase, query, pg, neon        (was 1454)
check:tasktime 335 tasks / 14m avg / 1.69x / 28% overhead — idempotent on re-run
smoke          all assertions, six packages
```

The fixed-group registration was checked with the criterion that
replaced the blind one — resulting versions rather than the listing:
all six packages move `0.1.1 → 0.2.0` together, the new package among
them rather than alone at `0.1.0`.

The interface claim held to the end. Across all eight groups the diff
touches no file under `packages/core`, `packages/query`, `packages/cli`,
`packages/pg`, or `packages/supabase` — checked with a three-dot range
so a moving `dev` cannot contaminate it, and with the pattern shown to
match where it should before its silence was read as absence.
