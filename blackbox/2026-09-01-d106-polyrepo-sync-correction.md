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

## A second round (PS-D106-FIX-02): archive silently applies zero REMOVED requirements

The reviewer who checked the first round's fixes went one step further
than the review itself had: ran `openspec archive add-polyrepo-sync -y`
for real, in an isolated worktree, reverted after. Result: `+ 24, ~ 1,
- 0`. Zero removals. Both REMOVED requirements this change carries
against a *shipped* baseline (`cli-commands`'s "The database driver is
an optional dependency", `query-type-inference`'s "No generated type
artifacts") would have survived archive sitting right next to their own
replacements — the corpus asserting a prohibition and its reversal at
once, silently, with no error from the tool.

**Root cause, established by observation, not assumed** — two probes,
both in a detached `/tmp` worktree, never the working one:
1. Grepped every other archived change in this repository for its own
   REMOVED entries. Every one heads them `### Requirement: <title>` —
   the same tag ADDED/MODIFIED entries use — and their removals took
   (`align-spec-corpus`'s "The baseline banner marker is
   machine-readable" is gone from the shipped `cli-commands` spec
   today). This change's own two REMOVED entries were headed
   `### Removed: <title>` instead — a format used nowhere else in this
   repository's history.
2. Changed only those two header lines (title text byte-identical) and
   re-ran the same archive against the same tree: `- 2 removed`, and
   the shipped specs then carried the new requirement alone, the old
   one gone. This is conclusive: the tool matches a REMOVED entry
   against the shipped spec by exact header shape, not by title text
   alone, and `### Removed:` — despite reading as perfectly clear
   prose — is not a shape it recognizes. No error is raised either way;
   an unrecognized REMOVED entry just contributes nothing to the diff.

`schema-export`/`schema-vendoring` were checked too and are unaffected
either way: both are first-time `create` capabilities with no shipped
baseline (`openspec/specs/` carries neither today), so the eleven
`### Removed:` entries inside those two files were never going to
remove anything regardless of header shape — `openspec archive`'s own
dry-run never lists a removal for either capability, before or after
this fix.

**Fixed at the source**, not worked around at archive time: both
headers corrected to `### Requirement: <title>` in this change's own
delta files, each carrying a one-line note. `openspec archive
add-polyrepo-sync -y` now removes both on its own; tasks.md's own
closing section records the two-line verification an archiver should
still perform (expect `- 2`, expect both old requirements absent from
`openspec/specs/` afterward) rather than trusting the fix silently.

## m8 and m12: the rebuttal evidence, inlined (it lived only in a gitignored file)

`.agents/d106-dispositions.md` disposes all twenty-two findings, but it
is gitignored — a working document, not part of the committed record.
For the two partial/full rebuttals specifically, that meant the actual
evidence a later reader would need to see *why* nothing was changed
existed nowhere in the repository. Inlined here, per D89's own point:
a decision record that isn't committed isn't a decision record.

**m8 (query-type-inference, partial rebut).** Three scenarios, three
different states, before this round: "Declaration edit is immediately
visible" is structural — carried over from the requirement this one
replaces, whose own extensive suite (`packages/query/test/types/**`)
already exercises it; restating it here asserted nothing new, so it
needed naming as an observer, not a new test. "A vendored contract
types a query … matches …" had *no* type-level observer at all —
`contract-types.test.ts` checks members one at a time and
`parity.test.ts` checks SQL identity, but nothing had ever compared the
two paths' actual TypeScript result types against each other. This is
the one genuinely missing piece, and it is now closed for real: a real
`tsc` type-check between a local `db()` handle and a vendored
`createDb()` handle, built from the same declarations
(`examples/cli-smoke/test/vendored-contract.test.ts`), with a
type-level equality assertion that fails to *compile* if the two
`select()` result types disagree — passed on its first run. "A schema
change arrives as a diff" has no observer in this change at all and
cannot: its own witness needs a live vendor-and-diff loop, which is
R2-G9's own scope, itself relocated in full to the apply-engine change
(#603, R2-G9's own header records that move). Named as such rather than
left silent.

**m12 (REBUT, but the first draft of the rebuttal itself overreached).**
The finding: `schema-export`/`schema-vendoring` do not exist under
`openspec/specs/` yet both deltas carry `## REMOVED Requirements`
naming requirements that exist only in this change's own R1 history —
structurally unusual, and the evaluator could not run the `openspec`
CLI to check whether `archive`/`validate` accept it, so it was flagged
as unverified rather than asserted either way. The disposition this
round first wrote back was **"structurally harmless"** — true for
those two specific, brand-new capabilities (confirmed above: no shipped
baseline exists for either, so their own REMOVED entries were always
going to contribute zero removals, harmless by construction), but
stated as if it answered the finding for the *whole* change. It did
not: the two REMOVED entries against *shipped* capabilities
(`cli-commands`, `query-type-inference`) were not harmless at all — the
same review round that first wrote "structurally harmless" is the one
that went on to discover, one message later, that those two entries
silently apply zero removals. The corrected statement: **`openspec
validate --strict` accepts a REMOVED section's presence, but `openspec
archive` does not apply one whose header doesn't match the shipped
title's own tag — confirmed by running archive for real, not assumed.**
Removal is therefore an explicit, verified step in this change's own
archive procedure (tasks.md's closing section), not a claim resting on
validate having passed.
