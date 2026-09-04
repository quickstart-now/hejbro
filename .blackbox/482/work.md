# Work — quickstart-now/hejbro#482

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — enforce-driver-contract — four contract-observance defects the second provider surfaced

_2026-08-30T00:00Z_

(Re-pinned a second time: the README task-time badge refresh commit
(`docs: refresh readme task-time badges`) touched both `README.md` and
`tasks.md` after the previous pin was taken — the same class of
staleness the first re-pin closed, caught the same way, before handing
the SHA off rather than after.)

(Re-pinned a third time, after `git rebase upstream/dev` onto `9b9f943`
(#507/#509): `README.md` is the only path this rebase actually touched
in content (its own CRAP-block `measured at` SHA changed to this
branch's own rebased commit; the scanned-function count, 1521, did not
move). Verified with the reviewer's own `dc-blobs.sh` (31 ok, 1 stale,
0 missing before this fix), reproduced here rather than re-derived, to
close the loop with the same instrument that will re-verify it. No path
moved, so no pin needed re-targeting, only re-hashing.)

(Drafting note, recorded rather than silently omitted: this entry is
written by the implementer session from committed artifacts —
proposal.md, tasks.md, task-times.csv's notes, the archived issue
bodies (#481/#482/#490/#475) — not from a transcript of a raw
owner⟷lead exchange, which the implementer was never party to.
`proposal.md`'s own "Approval" line records this change as "Proposed by
the driver-contract piece's planner; the lead approves under the
owner's standing delegation... To be surfaced to the owner on return" —
there is no direct owner input to this piece beyond the standing
delegation itself and the four issues it closes, which were themselves
filed by the owner-authored account from the neon-preset piece's
review, not from a live exchange during this piece. If anything here
understates or misstates what the owner actually intended, the
lead/planner session should amend this entry.)



Piece work (planner + implementer, reviewer relayed through the
planner), worktree `driver-contract` off dev. Closes four defects that
share one shape: **a declared contract (a driver capability, a `check`
report's coverage claim) had nothing checking it**, found because the
Neon preset was the second real instrument to exercise interfaces the
first provider (`@hejbro/pg`/`@hejbro/supabase`) had never stressed.

### Where the four came from

All four were filed from the neon-preset piece's own review (2026-08-29),
under the owner's account, as the record of what a second provider's
construction exposed rather than a live owner exchange during this
piece:

- **#481** (`DriverCapabilityKey` has two members, one enforced):
  `assertCapability` is called only with `"interactive-transactions"`;
  no call anywhere passed `"session-state"`, so a driver honestly
  declaring `session-state: false` (Neon's HTTP path) was stopped by
  nothing.
- **#490** (presets must copy the missing-capability error text):
  `@hejbro/query` exported neither `assertCapability` nor its error
  builder, so `@hejbro/neon`'s HTTP driver reproduced the message text,
  code, and enriched fields wholesale — recorded in its own source as a
  deliberate copy ("kept byte-identical here rather than diverging just
  because this driver has no access to the original").
- **#482** (`check` hardcodes the Supabase bucket kind): the only
  preset-boundary leak into the CLI — `KIND_COMPARATORS` named
  `"supabase-storage-bucket"` directly, and any kind the CLI did not
  recognize was reported `check-object-differs` where the spec requires
  "not compared, with the reason."
- **#475** (cheatsheet has two `## Foreign keys` sections; `compare.ts`
  holds a four-row table as four functions): the 2026-08-29 UX/DX audit,
  bundled as the smallest finding riding along in the same files #482
  already touches.

### Decisions settled under the owner's standing delegation, by the lead session

Full text and each decision's rejected alternative live in
`proposal.md`'s "Decisions" section; summarized here with the two the
lead explicitly asked recorded as fought-for rejections:

- **One throwing helper, not three exports** (closes #490). A builder
  returning the `Error`, and exporting `assertCapability` itself, were
  both rejected as composable-from or redundant with the one export the
  spec scenario actually needs.
- **A conformance kit, not a runtime guard — rejected outright**
  (closes #481). An `assertCapability(driver, "session-state", …)` at
  the execute path was considered and rejected: the driver-contract spec
  does not merely permit a `session-state: false` driver, it *obliges*
  one to carry the settings with every statement — a guard there would
  refuse a driver that is honoring that obligation. The kit instead
  checks each declared tier's own obligation (order only, never pin SQL
  text — a deliberate limitation added to the spec delta after review,
  see "What review caught" below) and is repo-internal, deferring a
  public subpath export until an out-of-repo driver author needs one
  (additive to open later).
- **A data slot on the kind, not a comparator function — rejected
  outright** (closes #482). A function-valued comparator was rejected
  because it would drag the CLI's catalog/finding types across the
  preset boundary (a preset may use core's extension interface plus the
  query driver contract, nothing else) for a need no kind has yet —
  tracked as #508, filed under the post-0.2.0 umbrella, decided when a
  third provider actually asks for it. `noCatalogObjectReason` was named
  for what its *value* is (a reason, matching `requiredKeys`'/
  `siblingChanges`'s own naming-follows-the-value convention), not the
  predicate-shaped name (`notCatalogComparable`) first proposed — a
  predicate name paired with a prose value would have built a
  naming/value mismatch into the type itself.
- **Deliberately not added: query-owned session settings.**
  Centralizing the three copies of the session-pin SQL
  (`packages/pg/src/driver.ts`, `packages/neon/src/driver.ts`,
  `packages/neon/src/http.ts`) was considered and rejected: the
  conformance kit makes a drift between the copies observable, which was
  the actual reason to centralize; what would remain is the cost of
  modifying a standing requirement for no new benefit. Revisit at a
  fourth copy.
- **Two categories, not one, for what `check` did not compare** (closes
  #482, the `cli-commands` delta). A kind that declares itself
  uncomparable by design (the storage bucket) is stated in the report's
  coverage-boundary section and leaves the exit code unchanged; a
  comparison that should have run and could not (an unregistered kind, a
  missing privilege) stays `check-not-compared` and still forbids exit
  zero. Reading the spec's existing text as one category would have
  turned every clean Supabase run into an exit 2, which was never its
  intent.

### What review caught: the observation instrument's own guarantee was unverified

The conformance kit's job is to catch a driver whose behavior diverges
from its own declaration — but the kit's *own* test suite initially
proved less than it looked like it proved, in two ways the reviewer
found by mutation rather than by reading:

- **B1**: `assertSessionStateConformance` reads a driver's declared
  `capabilities` to pick which tier's obligation to check — never a
  choice the caller makes from the observation's own shape, which is
  exactly the forbidden move the spec forbids on the other side (never
  infer a *declaration* from observed behavior). A mutant that dispatched
  by observation shape instead survived every test: the one assertion
  guarding this case was `toThrowError(/session-state/)`, and the
  mutant's wrong dispatch also threw a message containing the literal
  substring "session-state" (via its own `tier` value), so the loose
  regex could not tell "the mismatch was rejected" from "the wrong
  obligation ran and happened to fail." Fixed by asserting the error's
  own identity (`code` + `tier`), not its message text.
- **B2**: the reverse-direction guard (a `session-state: false`
  declaration checked with a `true`-tier observation) had no test at
  all — disabling it in isolation left every existing test green. Fixed
  by adding the missing symmetric case.

Both fixes were verified by the same method that found the gap:
temporarily reintroducing each mutation, confirming the intended
assertion (and only that one) went red, then reverting and confirming a
clean `git status --porcelain`. A boundary sentence was also added to
the `driver-contract` delta making explicit what the kit was already
observed to do but had not stated: it checks order, never content — it
cannot tell a genuinely unrelated preceding statement from the driver's
actual settings, because it reads no driver's pin SQL text at all. This
is a stated limitation, not an oversight the kit is expected to close.

On the second review pass the reviewer replaced the crash-inducing form
of B2's reverse-direction mutant with a semantically faithful one (the
guard returns silently instead of throwing, rather than falling through
into an argument-shape crash) and confirmed B2 still fails for the
correct reason (the expected error object stays `undefined` — the
mismatch was never rejected — not a `TypeError` from mismatched
argument shapes). The B1/B2 `catch` blocks were also cleaned up in the
same pass: both originally paired a `try`/`expect.unreachable`/`catch`
shape, which on a miss raised `expect.unreachable`'s own
`AssertionError` *inside* the same `catch` that also runs the identity
assertion — nesting one `AssertionError` inside another correctly still
failed, but blurred the diagnostic. Replaced with capturing the thrown
value outside the assertion (`let caught: unknown` set in `catch`, then
asserted after the `try` block), so a miss reads as a plain "expected
`undefined` to match object" instead.

**G4** (group 2's own review axis, `compare.ts`'s 2.6 refactor): the
four-row `CONSTRAINT_KIND_DESCRIPTIONS` table task 2.6 introduced had no
test pinning which description reaches which constraint-type letter —
swapping the `u`/`f` rows (`"unique constraint"` and `"foreign key"`)
left the entire 258-test CLI suite green, because no existing assertion
read a finding's `message` text for any of the four constraint kinds,
only its `code`. This is a pre-existing gap the refactor concentrated
into one table rather than a regression the refactor introduced — no
assertion checked this before 2.6 either, spread invisibly across four
near-identical functions. Fixed by adding independent `message`
assertions (the four description strings written directly in the test,
never read from `compare.ts`'s own table — a table-driven test here
would make the check tautological, restating the same table it exists
to catch a defect in) to the three existing constraint-existence tests.
Verified by re-swapping the two rows: exactly the two tests naming
`"foreign key"`/`"unique constraint"` failed, all 13 others stayed
green; reverted, confirmed clean.

### What went wrong / self-corrections during implementation

- **A vitest alias ordering bug** (task 1.4/1.7): the repo-internal
  conformance kit's one deliberate exception to "public entry points
  only" (`@hejbro/query/testing/driver-conformance`) initially mangled
  into `.../index.ts/testing/driver-conformance` in three consuming
  packages' vitest configs, because Vite's string-alias matching treats
  a shorter key (`@hejbro/query`) as a prefix match and the shorter key
  was declared first. Reproduced with a scratch test, fixed by declaring
  the more specific key first, and the reason recorded as a one-line
  constraint comment rather than the measurement narrative (which lives
  here instead).
- **`tsc` cannot see a vitest-only alias** (task 1.7): wiring the same
  internal specifier into three packages' *test files* (not scratch
  files this time) surfaced that `tsc` (via `check-types`) resolves a
  package's published `exports` map, never a test runner's own
  `resolve.alias` — a gap invisible until a real, permanent import
  exercised it. Closed with a matching `tsconfig.json` `paths` entry
  (a repo-first pattern; no prior `paths` usage existed) pointing at the
  same single file, never a directory mapping.
- **`openspec validate --strict` does not cross-check a MODIFIED
  requirement's title against the base spec** (task 2.5): discovered by
  injecting a typo into a delta's own title and observing `valid`
  anyway. Filed as issue #510 (parent #412) rather than fixed inline —
  a general OpenSpec-tooling gap outside this change's own scope, with
  the substitute check's script body preserved in the issue since
  `/tmp` does not survive the session.
- **A pre-existing test coverage gap surfaced by a refactor task** (2.6):
  `compareUniqueConstraints`, one of the four constraint-comparison
  functions being collapsed into a data table, had no test anywhere in
  the CLI package before this change. A refactor's own safety net is
  "existing assertions stay green before and after" — with no assertion
  for that branch, the refactor's own correctness there would have gone
  unverified. A baseline test was written and confirmed green against
  the *pre-refactor* code first, then the refactor landed, then the same
  three assertions (primary key, unique, foreign key/check/index) were
  reconfirmed unchanged.
- **Message-crossing between planner and implementer**, repeatedly,
  once severely enough that the planner introduced an explicit rule
  mid-piece ("the first action after reading a message is checking
  whether an ordering instruction is present, and if so it overrides
  tasks.md's own order") after four consecutive crossed sequencing
  instructions during the review-blocker rework. No work was lost to
  this — every crossing was caught and reconciled by comparing commit
  SHAs and timestamps against what each side had actually already
  received — but it cost several redundant "I already did that, see SHA
  X" round trips recorded in the piece's own message history rather than
  in this entry.

Migrated from the single-file entry `.blackbox/2026-08-30-enforce-driver-contract.md`, kept verbatim at `.blackbox/482/artifacts/2026-08-30-enforce-driver-contract.md`.

