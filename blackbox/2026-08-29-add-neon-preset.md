# 2026-08-29 — `@hejbro/neon`, the second provider preset

Refs: _(blob SHAs pinned at the recorded state — filled before the PR, see
"Pinning" at the end)_

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
