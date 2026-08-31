Refs:
- .changeset/generalize-context-application.md @ blob 751680b8eac3f7240ff482543eddf8dede226aff (re-pinned, correction round: F5 export mention added)
- README.md @ blob ad87f4372793c5e39f4fa9b959dbde12465e417a
- openspec/changes/archive/2026-08-31-generalize-context-application/proposal.md @ blob f4410978b0901a5b023b85676a9755d75fadfc93 (re-pathed, archive; blob unchanged)
- openspec/changes/archive/2026-08-31-generalize-context-application/specs/driver-contract/spec.md @ blob 7791ef57b231bc3826e83ab002116dd66f775dc0 (re-pathed, archive; re-pinned, correction round: F1③④)
- openspec/changes/archive/2026-08-31-generalize-context-application/specs/rls-execution-context/spec.md @ blob 1e3c0c8ace1da93136e36fc9eaf4b1a2cb0269c6 (re-pathed, archive; re-pinned, correction round: F1①②/F2/F3b/F3c/F4)
- openspec/changes/archive/2026-08-31-generalize-context-application/tasks.md @ blob 90444d4389c444c30bb02f756a2c9e2ac1eacc05 (re-pathed, archive; re-pinned, correction round: 5.5 checked)
- openspec/task-times.csv @ blob f0e5514da13ff65c42904ae731a3b803f1d5cd76 (re-pinned, correction round: D106 + archive-round ledger rows)
- packages/neon/test/driver.test.ts @ blob edbb81f594ad112dbfb7cb38492231ae3b5d5b65
- packages/pg/test/driver.test.ts @ blob ed5c3cea081d8609ae757251eddff52cc4e5aca0
- packages/query/src/db/context.ts @ blob ab894816422c346430bbac5826963db0ffb91a28
- packages/query/src/db/db.ts @ blob 64fa922469745a7f747d67200472ce2a0caf0b8c
- packages/query/src/driver/contract.ts @ blob 95d828c09ca1096c510503dc8183a5d753791a09
- packages/query/src/index.ts @ blob 9bb143fd495749e5013f3fbd9d7c359c09ba1690
- packages/query/test/db/context-provider.test.ts @ blob 65c88edcc659d31f07ab78f5e365e2a0c4db1855
- packages/query/test/db/context-required.test.ts @ blob 374bf725f799b51cab069533fe8c863978d7d345
- packages/query/test/db/context.test.ts @ blob dce151b5751595f5e6695a3ae20dd05ca85bace0
- packages/query/test/db/recording-driver.ts @ blob 245f437a744534a0ca0f336c9792b3b837cb996d
- packages/query/test/driver/contract.test.ts @ blob 7dcb2d7f58352d81bf7f2d78be511bda73d28ad2
- packages/query/test/exports.test.ts @ blob 3b8db25d59f4dda21526fe91c05b56c095652370
- packages/supabase/test/driver.test.ts @ blob e985caf9fea2cd073b27ff81be59296d08811968
- skills/hejbro/references/query-layer.md @ blob e894a4e06a97febaccc78cc40ece15a808c2f3ec (re-pinned, correction round: F5/F8)

(Originally taken from `git hash-object <path>` on the frozen tree at
`5bcb5310`, before the blackbox commit. Re-pinned in the D106
correction + archive round (2026-08-31): the four
`openspec/changes/generalize-context-application/` paths moved to
`openspec/changes/archive/2026-08-31-generalize-context-application/`
on archive — `proposal.md`'s blob is unchanged by the move,
`specs/driver-contract/spec.md`/`specs/rls-execution-context/spec.md`
carry the D106 correction-round text, `tasks.md` carries the 5.5
checkbox. Three further paths kept their location but not their blob
this same round: `.changeset/generalize-context-application.md` (F5),
`skills/hejbro/references/query-layer.md` (F5/F8), and
`openspec/task-times.csv` (the D106 and archive-round ledger rows).
`README.md` and the remaining thirteen paths are unchanged, verified
against this file's own prior pins before the correction commit. Pins
die three ways — squash preserves them, an archive kills the path, a
concurrent same-file edit on dev kills the blob — so every later
commit re-verifies all twenty-one path-fixed, per the standing
pre-commit sweep rule.)


# generalize-context-application — the driver owns the sentence (#553)

nl piece team (planner opus, researcher opus, implementer sonnet,
reviewer opus) off dev `f9c16be`. This change is owner-driven in the
direct sense: the owner, present in the session, personally ruled the
direction — not the lead under delegation.

## Owner inputs (English rewrites)

The owner instructed processing of the remaining #282 sub-issues
(2026-08-31, in session), which discharged the roadmap's Deferred gate
for the Nile preset. The preset work then measured its way into a
contract collision, and the owner ruled twice, in session, from the
lead's four-option escalation:

1. **Direction D+A**: the generic context mechanism is generalized in
   a preceding change (this one, #553) that gates #301; the Nile
   preset then expresses `asTenant(...)` on the generalized mechanism.
2. **The preset ships** despite Nile refusing RLS, functions, triggers
   and GRANT — the preset validator fails those early with explicit
   errors (recorded here because it came from the same ruling session;
   it lands in #301).

## What the measurement found (why the contract had to move)

First-party evidence, three implementations cross-checked (the vendor
SDK, the nile-auth server, the forked pooler), plus the official
testing container:

- `set local role` on Nile is a silent no-op (a WARNING, not an
  error) that additionally blocks the tenant setting that follows it.
  The generic mechanism sends exactly that statement first.
- `select set_config('nile.tenant_id', …, true)` is structurally
  unable to succeed — the setting may only change before any query,
  and set_config is itself a query. The only working form is
  `SET LOCAL` as the first statement after `BEGIN` — the shape
  nile-auth, Nile's own server, uses.
- Nile has zero application roles, and its roadmap makes roles an
  HTTP-API concept, never SQL grants — `DbContext.role`'s
  requiredness was not a temporary gap but a permanent mismatch.
- The security half: the `set_config` path silently bypasses Nile's
  own tenant-authorization check (container-measured; no first-party
  source speaks to it either way — treated conservatively), and Nile
  is **fail-open** without context (doc + doc + SDK, triple-confirmed)
  — an unapplied context is a data-leak, not a no-op.

Why A (transaction-local, contract generalized) and not B′ (the
vendor's own connection-scoped pools): B′'s safety reduces entirely to
what the pooler's `LdbId` binds to, and that is `SOURCE-UNDECIDABLE`
— public sources are exhausted, permanently. A holds regardless of
that unknown. The deciding sentence: **this repository does not ship
an unverifiable safety claim.** The research also refuted its own
pessimistic hypothesis (parameterized statements work fine under a
tenant context; the vendor's inlining is a batching choice, not a
platform limit) — one round widened what is possible while every
other round narrowed it.

## What landed

The driver contributes how a context becomes statements — a pure
`DbContext → ordered CompileResult[]` mapping — and the query layer
keeps validation, ordering-preservation and transaction ownership,
sending the contributed statements first among its own. Today's
sequence is the exported default rendering, so the three existing
drivers are byte-identical by construction (pinned per-package before
the change was made — the piece reordered its groups so the
regression pins were a baseline, not post-hoc approval). `role`
became optional, gated by an explicit no-platform-roles driver
declaration; omitting a role is not a bypass. A driver may declare
context mandatory, and every execution surface then fails closed with
`context-required` at one chokepoint — the same seam the context
provider wraps, so a missed surface is structurally impossible rather
than individually tested. A named-role context still walks the
whitelist unchanged; the roleless failure got its own code
(`context-role-missing`) because `undeclared-role`'s "Declared
roles:" explanation is meaningless when no role was named. The
mid-piece measurement that the shipped supabase pooler sends its own
pins before the context statements produced one more contract
sentence: "first" means first among what the query layer sends, and a
platform that needs absolute-first must carry its session statements
inside its rendering — the exact path #301 will walk, answered in
spec text before D106 could ask.

## Attribution

The spec-reinforcement delta (the pin-ordering paragraph) was
authored by the planner and approved by the lead — one commit message
mis-attributes it to the lead and is corrected here rather than by
history rewrite. The direction and the ship-with-validator ruling are
the owner's, in session.

## Method notes the piece added

The premise-state convention (every instruction opens with the state
it assumes, so a stale instruction identifies itself) ended the
crossing tax by the third occurrence. The 0-cached rule made
TURBO_FORCE a claim with evidence ("the flag is the prescription;
0 cached is the proof it took"). The reviewer's mutant-scope rule —
**a mutant's red count is a coverage indicator, never a design
indicator; over-reach is judged only on unmutated code** — was
written before the verdict, from a corrected misreading. Shared test
fixtures got their rule (owned by no group, extended additively,
never behavior-changed) and both D88 refinements are queued for the
owner (nl-Q1, nl-Q2).

## The review round

Round 1 returned FAIL on the change's own purpose: the delta's SHALL
("the default rendering is reachable from a driver package") was
undelivered — the package exports map blocked it, a module-level
`export const` had been misread as package-boundary reachability, and
the tsdoc asserted a property that did not hold. The reviewer also
named how it passed every gate: **no scenario covered that SHALL, so
no test existed, so nothing failed** — the same
quantifier-versus-coverage chain the previous piece had just filed as
an owner-queue item, reproduced here within a day. The fix closed the
chain from both ends: the export plus a reachability scenario plus a
cross-package proof importing through the public specifier (an
internal-path import was explicitly forbidden as a re-creation of the
defect), and the reviewer re-verified by removing the export again —
three independent instruments (the exports pin, the pg runtime test,
pg's tsc) all fail without it. The second finding was a
deterministically stale README badge the CI diff-gate would have
caught. One non-blocking observation became a discrimination gain
worth recording: the neon boundary test could not tell which layer
refused (driver and gate share the error code), and after an
`operation` assertion the same gate-removal mutant went from
14-tests-blind to 1-failed — the test count did not move; its
discernment did. Twelve mutants stayed killed across both rounds;
every gate figure carries its `0 cached` evidence.
