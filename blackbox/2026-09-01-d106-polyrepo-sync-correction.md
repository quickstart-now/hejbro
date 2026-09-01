Refs:
- openspec/changes/add-polyrepo-sync/specs/schema-vendoring/spec.md @ blob 7435ac8491f39d2b0d838cd4296a1b7105b74bf5
- packages/query/test/client/roles.test.ts @ blob 14aece3f06b59f67830d01affb1c54d00a6a44d8
- openspec/changes/add-polyrepo-sync/tasks.md @ blob 99942f7a329d0cf325b6bc6c5f709aeda06d8485
- packages/query/src/client/name-keyed-db.ts @ blob c82fea48ce34d3a0d90ab34708d9b85e24121ab6

(Pins cover the B2 finding specifically — the one requiring a
lead-level contract judgement rather than a narrowest-fix repair. The
other twenty findings in this round are FIX-disposed and their own
reasoning lives inline in tasks.md at each fix's own site, per this
repository's own "a comment records what the code cannot show" rule —
not restated here.)

# D106 isolated spec-only review of add-polyrepo-sync — 2 blocking / 8 major / 12 minor

`add-polyrepo-sync` (#314) merged to `dev` at 518dcdde (#606). A D106
isolated, detached-worktree, spec-only review of the merged change
found 22 findings: 2 blocking, 8 major, 12 minor. Full text:
`.agents/d106-dispositions.md` disposes every one (fix/rebut/defer);
the evaluator's own original document is not repo-committed (a
scratchpad path under the reviewing session's own temp directory).

## Why this entry exists

Twenty of the twenty-two findings are ordinary "the delta drifted from
the shipped code" repairs — narrowest-fix, no judgement call, each
documented at its own fix site in tasks.md. One (B2) is a genuine
contract judgement escalated to the lead, and it is the one worth a
blackbox entry: the fix is not "restore what the delta already claimed"
but "decide what the delta should claim, now that the shipped code has
made the original claim structurally impossible."

## B2: the roles requirement contracted an interaction the shipped factory forecloses

The delta's original text: "The contract SHALL export the role names
the schema declares, and a consumer SHALL pass them explicitly to
obtain the whitelist." The scenario this implied — a consumer holding a
vendored contract but choosing not to pass its role list, leaving
rejection in force — has no way to happen: `createDb = (conn) =>
createNameKeyedDb<Database>(conn, contractMetadata)` takes exactly one
parameter, and `contractMetadata.roles` is threaded into the internal
`db()` handle unconditionally at construction. There is no second
argument for a consumer to omit.

Two ways to close the gap existed: narrow the requirement to describe
"the metadata half only" (what R2-G5 5.8 itself narrowed to, per its
own task note — "self-determined, flagged for confirmation"), or
revise the requirement to describe what actually shipped and settle
where the real opt-in boundary is. The lead ruled the second — **(나),
revise to the shipped model** — with four conditions:

1. **Observer completeness.** Three claims need a witness: an in-list
   role is accepted at `client.as({role})`; an out-of-list role is
   rejected (already observed, `roles.test.ts:56` before this round);
   and — the one nobody had written — no role is active *without*
   calling `as()` at all. That third test was added and passed on its
   first run (`recordingTransactionalDriver({ contextRequired: true })`
   proves an unscoped call runs with no context, the same mechanism
   `context-required.test.ts` already established for `db()` itself) —
   the design already had this property; only the observer was
   missing.
2. **State the security boundary in the requirement's own prose**: the
   contract's role list is a *candidate set* the client is willing to
   accept, never permission — RLS and grants decide what an accepted
   role can do. Vendoring a schema grants nothing.
3. **Say plainly that this is a revision**, not a restatement — opt-in
   moved from construction time (what the original text described) to
   call time (what the shipped factory actually does). No silent
   rewrite: the requirement's own heading now says so ("Role names
   travel with the contract, and opting in is a call, not a
   configuration"), and this blackbox entry is the second place it is
   said in full.
4. **Record why the gap survived** from 5.8 to merge — this section.

## Why the gap survived from task 5.8 to the D106 finding

Task 5.8 narrowed its own two red tests to "metadata half only" at
write time, with an explicit note flagging the narrowing for
confirmation (mirroring 5.10's own precedent in the same group). What
should have happened next: the delta's own requirement text — which
still described the *runtime* interaction ("a consumer SHALL pass them
explicitly") — gets revised in the same commit, since the tests it was
supposed to be proven by no longer existed. What actually happened:
the test rename landed, the flag for confirmation was raised and
(implicitly) accepted by proceeding, and the delta text was never
revisited, because nothing in this change's own process forces a
task's local narrowing to propagate to the requirement prose it was
narrowing away from. R2-G6 later built the real client and its
whitelist logic against the *shipped* design (call-time opt-in) without
ever comparing that design back against the still-unrevised delta
sentence from R2-G5 — the two were written by the same hands, five
groups apart, and nothing structural connects a task's own scope note
to the requirement paragraph it quietly stopped proving.

This is the same shape as B1 (two REMOVED paragraphs whose behavior is
still shipped, never re-homed) and M3/M7/M8 elsewhere in this same
review: a local, well-reasoned decision (narrow the tests, fix a
branch, rename a flag) that never had a step forcing it back onto the
one document that makes an externally observable claim. The ownership-
audit test built earlier in this change (`vendor-code-ownership.test.ts`,
R2-G7 F-1c) closes exactly this shape for one axis (code ↔ requirement
ownership) but not for prose claims about *interaction shape* — there
is no mechanical gate for "does this requirement's own sentence still
match what the code that satisfies it actually does." D106's own
spec-only review is the check that catches this class, by design (the
lead's own words, recorded in tasks.md's F-1c note: "code-side drift is
stopped by the guard; spec-side drift is stopped by review").
