Refs:
- openspec/changes/add-check-schema/proposal.md @ blob d7a171b454881017c7f34ec45d0ca90278b51262
- openspec/changes/add-check-schema/tasks.md @ blob 237fc97ab625419f6594a498f214fefb3c78f16f
- openspec/changes/add-check-schema/specs/cli-commands/spec.md @ blob 976e93fd78ec464586feff2088525b593a0eaf4a
- packages/cli/src/check/driver.ts @ blob b27320fe02dd4a47ca12a6448d8da6a95f229b34
- packages/cli/src/check/catalog.ts @ blob 1460fdf19ef8e00c07bd6df4ba11f096094bc422
- packages/cli/src/check/compare.ts @ blob 9ce57a50ea69f6cd71c049a7a0d62f6709eb0928
- packages/cli/src/check/expression.ts @ blob c50b179524ff2cc736b00810cc6488563f7489a1
- packages/cli/src/check/error-message.ts @ blob ef81feda8b6f0d7503427f0dc1ce00833fed838a
- packages/cli/src/check/inventory.ts @ blob 9d734afad1487f302c48c9e35a9f343abb62a047
- packages/cli/src/commands/check.ts @ blob 2ee4c0efb20104c72935460a0c6fe3448a4d8c14
- packages/cli/src/flags.ts @ blob 44f6f48fafb03c48f8623573af5c4e42e643d683
- packages/cli/test/check-command.test.ts @ blob c8142a2ae88d53b01508ebc401a53f7e262a5ea0
- packages/cli/test/check-live.integration.test.ts @ blob 7407a342d4e15e119ddd8f1aa4ad7c8e387969fa
- skills/hejbro/references/brownfield-adoption.md @ blob e47737b34e70526b8c9fb823ae0f5c2b11cb5f79
- skills/hejbro/SKILL.md @ blob f0360abf42aba67548c03ab3148642fcd8a4f498
- .changeset/add-check-schema.md @ blob 712d49d19cee9f502924292f1534691a47c9a375
- openspec/task-times.csv @ blob 657ea529798d60040fabd5c8b9fea969bdc27862
- README.md @ blob 120000966e61ffc1828d6e4c2205e9bb8b090c66

# add-check-schema — `hejbro check` (#442)

Piece record for the whole `add-check-schema` change, built by the cs
team (planner sonnet / implementer opus / reviewer) in worktree
`check-schema` off dev `8f7d3d1`.

## Owner input

No owner exchange specific to `check` — #442 was filed by the assistant
("Claude Code (agent)") against a gap `hejbro baseline` (#441) left open
on purpose. Every owner-level call this change makes (the live-connection
decision, the driver's dependency-declaration shape) was made under a
standing delegation, not a direct ruling on this piece, and `blackbox/
README.md`'s own rule governs how that delegation is recorded here: a
faithful English rewrite, complete in content and natural in form, never
a word-for-word translation of the owner's Korean.

Before stepping away for a period, the owner delegated every decision
this class of work would otherwise need — merge decisions, planning
decisions, and anything that would normally require an explicit
`openspec` owner ruling — to be made directly, judged against one
standing criterion: this project is an ORM, and specifically an ORM for
Postgres and Postgres-based services, never a generic multi-database
tool. The owner's own instruction authorized forming a team and
following the existing process where that process already calls for
one. Reserved from the delegation: the npm publish gate itself (approving
the actual release) stays the owner's alone, unaffected by this
delegation. The delegation's own return rule, given the same day: an
owner message arriving mid-session does not end it — only an explicit
return declaration does. Every owner-level call this piece makes (the
live-connection decision below, and the driver's dependency-declaration
shape) was made inside a lead session operating under that delegation,
not directly by the owner, and is therefore something the owner's return
should confirm rather than something already settled by them.

## What was measured, and decided instead

The issue named `hejbro check --schema <dump>` as one candidate shape.
Measurement said a dump file cannot be the input:

- **Replaying a dump loses data silently.** A `pg_dump --schema-only` of
  `examples/postgres` restored into a database whose roles do not exist
  produced 40 errors, **exit code 0**, and a database missing **12 of 12
  RLS policies and 48 of 104 grants**. A check run against that database
  would report every policy as absent — the tool confidently wrong about
  the one feature this product leads with. `ON_ERROR_STOP=1` inverts the
  failure rather than fixing it: the restore stops at the first grant and
  nothing is compared at all.
- **Parsing the dump text is version-sensitive**, not just its headers:
  the same schema dumped by pg15 and pg16/17 differs in the body of a
  view, because PG16 changed `pg_get_viewdef` to drop unnecessary table
  qualification — six lines of pure false positive per view on an
  identical schema. hejbro controls neither the version nor the flags a
  user's dump was made with.
- **A live connection has neither problem** — the same three server
  versions returned byte-identical results for the fields this command
  compares.

Decided instead — under the delegation, not by the owner directly:
`hejbro check --url <connection-string>` (or `DATABASE_URL`), a
read-only connection to the real database, never a dump. A second
measurement then shaped how expressions are compared: comparing our own
rendered expression text to the catalog's text
produced 14 false positives across 23 expression-bearing fields in
`examples/postgres`, including 8 of 8 check constraints — Postgres
rewrites expressions on write (`in (...)` becomes `= ANY(...)`, a cast
lands inside the expression, not at its end). Sending both sides through
the *same server in the same session* cancels the rewrite (measured, 8
of 8 match) without swallowing real differences (measured, 6 of 6
genuine changes still reported). Compared as a query predicate rather
than an output expression, two more hazards surfaced and were measured
away: the planner moves a predicate depending on which indexes exist,
and row-security rewriting deletes it outright for a role with no
policy, both producing false agreement a checker must never produce.

## Reopening condition

`--schema <dump>` stays out of scope for the measured reasons above.
Reopen as a new issue if organizations that only ever receive a dump
(never a live connection) turn out to be a primary adoption scenario —
the cost is a real SQL parser, which does not exist anywhere in this
repository today (every SQL path here runs in the emit direction only),
and that decision should be made against that price, not by inheriting
the phrasing of #442's own title.

The second owner-level call this piece makes, also under the delegation
rather than a direct ruling: `@hejbro/pg` is declared as no dependency
kind of `hejbro` at all — not a runtime dependency, and not a peer,
optional or otherwise. Installing `hejbro` therefore never pulls in a
Postgres client for the commands that never connect, and the package
manager is never asked to reason about a package only `check` uses. The
implementer's own first phrasing of this same decision, in this change's
own skill doc and changeset, called it "an optional peer" — a
`package.json` field this repository's tooling does not recognize for
this dependency at all. Caught while writing this entry, against the
actual `package.json` (see "What this change got wrong" below).

## What this change got wrong

A flight recorder that only records good flights is not one:

- **The planner's own query defect (R4).** Task 1.4 correctly moved
  table grants off `information_schema.role_table_grants` (role-filtered
  by definition — a limited role would read a real grant as absent).
  The planner's own replacement query, `aclexplode(pg_class.relacl)`
  with no fallback, would have reintroduced the identical wrong
  "missing" through the other door: an empty `relacl` means "the
  owner's default privileges," not "no privileges," and
  `aclexplode(NULL)` returns zero rows. The reviewer caught it before it
  landed; `aclexplode(coalesce(relacl, acldefault('r', relowner)))` is
  the fix.
- **A directed fix went missing for one round.** The reviewer's own
  instruction to replace the `--url=` regression guard's "accept either
  of two downstream codes" with "assert equals-form and space-form reach
  the identical result" was acknowledged but not applied in the commit
  that followed — caught again in the next review round, applied then.
- **tasks.md's own text was narrower than what the product needed
  twice.** No task named "wire the expression comparison into
  `runCheck`" — group 3 built the comparison, group 4's task list named
  the report and the flags but never the connection between them, and
  it sat unreached for a group and a half. Separately, comparing the
  objects declared *inside* a table (primary key, unique constraints,
  foreign keys, indexes) was first read as out of scope for this piece,
  narrower than the spec's own "existence by identity for every declared
  kind" — corrected to task 2.5 once the gap was noticed.
- **A TDD deviation, self-reported.** `catalog.ts`'s first draft was
  written before its test in one sitting, not after — caught by the
  implementer, not the reviewer, and confirmed red the only way that
  matters: the file was deleted and the test suite run again to see it
  actually fail, rather than trusted from memory that it would have.
  Treated the same as every other fix in this change: a mutation-based
  check, not a promise.
- **A test that verified the opposite of its own name (M1).**
  "reports a matching constraint the database does not enforce"
  asserted `convalidated: true`, a matching expression, and zero
  findings — the exact green result the real bug (a `NOT VALID`
  constraint silently treated as fine) would also produce. Deleting the
  guard clause it was meant to protect left all ten tests in the file
  green. Fixed by flipping the fixture to `convalidated: false` and
  adding a true positive control (`convalidated: true`, matching, zero
  findings) alongside it, so the axis this test claims to cover is
  actually exercised in both directions.
- **Two instructions this entry's own author gave, both wrong, both
  caught by the implementer asking instead of complying.** Writing this
  entry, the planner first instructed that the owner-request section
  above quote the delegation verbatim in the owner's own Korean. The
  implementer asked rather than writing it that way: `blackbox/
  README.md`'s own rule (owner rule, 2026-08-26) is a faithful English
  rewrite, never a word-for-word translation, and the nearest precedent
  entry in this same directory follows exactly that rule. The lead's
  own ruling, once asked: the implementer's catch was correct and the
  instruction was wrong — a Korean quote is neither a rewrite nor
  compliant with this repository's own English-only rule for
  GitHub-facing text. Separately, the planner instructed labelling this
  piece's own delegated decisions `D2` and the `D3` amendment. The
  implementer asked again rather than writing them that way: those
  labels belong to the design spec's own global decision log, where
  `D2`/`D3` already name an unrelated subject (the plpgsql function-body
  compiler, v1's scope), and reusing them here would collide. The
  lead's ruling: correct again, written in prose instead, no local
  labels at all. Neither instruction was followed because it came from
  above the implementer; both were followed only after being asked
  about and confirmed wrong.

## Reviewer's own contribution: #461

Auditing which gates would actually cover `check`'s new diagnostics, the
reviewer read `scripts/check-next-marker.mjs` directly rather than
trusting what it claims to scan, and found it never visits a diagnostic
built as a plain `{ code, message }` object literal (the shape
`chain.ts`/`cli/loader.ts`/`rename-diagnostics.ts` already use) — only
`throwHejbroError`/`hejbroError` calls and same-file thrower helpers.
Confirmed by mutation: a code minted that way passes `check:next-marker`
with no `Next:` clause at all. This change's own new codes all go
through the factory (mandated in task 2.1), so its own surface is
unaffected, but the gate gap itself is real and pre-existing — three
sites already use the unvisited shape. Filed as its own issue (#461,
gate gap, not this piece's defect) rather than folded into this change,
with the fix direction the reviewer proposed: either teach the scanner
the object-literal shape, or assert that every code `check-diagnostic-
xref` counts as defined is also visited by `check-next-marker`'s own
scan, so the two gates can never silently drift apart again.

## Process observations

Six, none of which survive in the finished code — recorded here because
each one changed how a later piece of this same change (or a future one)
should be built, not because any one of them is still visible in a diff:

- **The grant read's own mistake, opposite direction** (see "What this
  change got wrong" above for the specific defect) — the general lesson
  is that a fix for a role-dependence bug can reintroduce the identical
  bug through the fallback case it forgot, and the two look nothing
  alike in a diff.
- **The order that found it.** The 1.4 trap above was surfaced by asking
  "where would a 'this read was refused' signal even come from?" *before*
  building any plumbing to carry one through `compareCatalog`'s pure
  functions — answering that question exposed that no catalog read in
  this command depends on the connected role at all except through that
  one role-filtered view, so removing the dependency removed the blind
  spot at its source, cheaper than any signal-plumbing design.
- **Unit tests here fix a shape; only the live witness fixes a
  meaning.** It happened four separate times, each with the same
  structure — a mutation that kept the text (or the count, or the
  session) identical while breaking what it was supposed to mean still
  passed: the catalog query text (`acldefault('r', ...)` vs `('s', ...)`,
  a one-character mutation with a completely different real-world
  meaning, both compile and both pass a naive assertion), the expression
  probe's own form (the first "same session" test asserted one session
  object was passed to two `execute()` calls, which is structurally
  always true regardless of which physical connection a pool hands
  back), whether Postgres folds two identical target-list entries into
  one `Output` element (a fact about a server, unknowable from a fake
  session no matter how it's written), and the grant source itself (the
  entry above — `information_schema` and `pg_catalog` agree completely
  under superuser, the only role every unit test ran as). The convention
  that came out of it: a test whose name claims a semantic property
  ("compares identically," "same session," "role-independent") must
  either prove that property directly or say in a comment exactly where
  it is proved — group 6's live witness is where three of these four
  finally are.
- **Cutting a comparison short makes the happy test pass harder, not
  easier.** Stubbing `declaredCheckConstraints` to return nothing
  (mutation test, group 6) left the live "reports no differences"
  witness green — fewer comparisons means fewer findings means a
  cleaner report. Only the witness that separately asserted *how many*
  objects were compared (`toHaveLength(8)`) turned red, with
  `expected [] to have length 8 but got 0`. A test that checks for the
  absence of complaints cannot notice that nothing was inspected; this
  is the precise, measured reason the reviewer required a count
  assertion in task 6.2, not a preference.
- **A comparison nobody calls is worse than one that is missing.**
  Group 3 built the full expression comparison and the task list moved
  on; nothing in group 4 called it for a group and a half. Every test in
  both groups passed the entire time, and the report simply said
  nothing about check constraints — silence that reads exactly like
  agreement to a user who has no way to tell "compared, no differences"
  from "never looked." Found by re-reading the task list against what
  `runCheck` actually called, not by a test failing.
- **The repository predicted its own defect.** `flags.ts`'s own comment
  on `VALUE_TAKING_FLAGS` stated, before `check` ever existed: "Adding a
  5th value-taking flag means adding it here too, or it silently keeps
  requiring the space form." `--url` was that fifth flag, and
  `hejbro check --url=postgres://...` answered that no `--url` was
  given — with `DATABASE_URL` also set, it would have silently checked
  a *different* database and reported a confident result about the
  wrong server. Found independently twice, by two different readers, in
  the same review round: once by re-reading `tasks.md`'s own updated
  4.1 text before being told, once by a reviewer running the built CLI
  directly. The warning had been sitting in the file the whole change
  touched, unread, until the code it predicted was written.

## Process record

Fourteen commits, `feat-check-schema` off dev `8f7d3d1`, one per closed
review round (never amended): `4219cd8` (group 1, connection + catalog
reads) → `9fe2ad5` (error-code rename to subject-predicate order) →
`d422e06` (group 2, the pure comparison function) → `536470d` (review
round 1: role-independent grants via `aclexplode`/`acldefault`, table
sub-object existence) → `1e05dd3` (group 3, expression comparison
through the server's own rendering) → `37a2d81` (review round on group
1/2's own findings) → `e35081e` (group 4, the command surface and its
report) → `a82330a` (review round 2 on the expression comparison: M1's
inverted-assertion test, M2's single-statement redesign) →
`a688a2b` (4.4: wiring the expression comparison into `runCheck`, found
unreached) → `4bcf686` (pinning the single-statement probe to exactly
two select-list expressions) → `b496180` (group 5, unmanaged inventory,
plus the `--url=` equals-form defect found independently) →
`9877b90` (N2: closing the connection pool on every exit path) →
`6e28241` (1.5's `check-connection-failed`, 4.5's three-way exit code,
group 6's hybrid live witness) → `1424785` (strengthening the `--url=`
regression guard to an equals/space-form parity assertion, adding the
live exit-2 witness).

Red observed directly for essentially every fix in this change via
mutation: the fix reverted, the specific test(s) run to confirm they
fail for the *stated* reason (not merely fail), then restored and
confirmed green, with a `diff` against the pre-mutation file confirming
exact restoration. The heaviest instances: M2's single-statement probe
redesign was measured against a real `docker run postgres:17-alpine`
before being trusted (a real risk — if Postgres folded two identical
target-list entries into one `Output` slot, the whole design would have
silently broken with no unit test able to see it, and it does not
fold), and group 6's own constraint-count witness was proven live by
temporarily making `declaredCheckConstraints` return `[]` in source and
watching the witness fail against a real database with `expected [] to
have length 8 but got 0` — a live witness catching a real product
defect, not only a fixture's, independently reproduced by the reviewer
in the same review round with the same result.
