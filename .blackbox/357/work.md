# Work — quickstart-now/hejbro#357

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — array-ergonomics group 2 — assertNoNulls, and the SHALL nobody was guarding

_2026-08-28T00:00Z_

Piece record for `add-array-ergonomics` task 2.1 (tracking #357), built
by the g2 piece team (planner opus / implementer sonnet / reviewer
opus) in worktree `array-g2-assert` off dev `1712bf2`, verdict PASS at
`1389136ab4681cc196a72ae5db93922450479734` (blocking 0). The lead's
closing commit on the same PR carries the change's single `minor`
changeset, the ledger rows, and the README metrics refresh — single
writer, per the owner-settled shared-file rule.

### What review actually bought

The first verdict (2 blocking, both test-only) found that the
utility's headline contracts were unfalsifiable:

- B1: the reviewer widened the return type to
  `ReadonlyArray<T | null>` and every gate stayed green — D99's
  "returning it typed `ReadonlyArray<T>`" had zero gates behind it.
  Fixed with an `expectTypeOf` pin that `check-types` enforces
  (core's tsconfig includes `test/`), proven by the mutation now
  failing as `TS2344` at compile time while runtime tests still pass.
- B2: replacing the return with `filter(Boolean)` also passed
  everything — "SHALL never drop elements" was equally unpinned.
  Fixed with a falsy-but-valid element case. The tempting
  reference-identity assertion was explicitly rejected: it passes
  today but would freeze an implementation detail (copying) into a
  permanent contract the spec never promises.

The final mutation set ran 8 red / 2 green — the two greens being the
structurally undetectable identity case (a null-filter is the identity
on a null-free array) and the deliberately unpinned `undefined` case.
The reviewer also invented M6c unprompted (substituting only the dots
in the remedy message) to prove the `toContain` → `toMatch` conversion
lost no strength, and refuted the planner's own claim that a
strengthened clean-path assertion could catch a filtering
implementation — the planner recorded the refutation as their error.
Honest cross-correction in both directions is the health signal here.

### Process record

Three message crossings, self-reported by the planner as their own:
two verdicts ran against superseded frozen SHAs (`bbc0c10e`,
`a8231d1`) because a new freeze was handed over while a verdict was
in flight. No wrong work shipped (the fixes were already in the newer
SHA both times), but roughly two verdict runs were spent re-proving.
The fix is a handshake protocol now standing for every piece: the
reviewer acks a SHA before starting, a new SHA aborts an in-flight
run, and the planner holds a rework SHA until the open verdict lands.
Ledger: est 7m → actual 30m, the overage being four planner-imposed
correction rounds (`Next:` marker, two ordered-but-missing cases, and
the two pins above); the red→green pass itself ran ~7m, so the
estimate was sound. Tokens: 492 requests / 348,504 output / 97.1%
cache hit, measured from the three team session transcripts.

Migrated from the single-file entry `.blackbox/2026-08-28-array-ergonomics-group2.md`, kept verbatim at `.blackbox/357/artifacts/2026-08-28-array-ergonomics-group2.md`.

