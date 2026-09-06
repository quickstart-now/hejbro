# Work — quickstart-now/hejbro#631

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the ledger's body checksum, and the live witness that found the gap the fakes could not

_2026-09-05T20:52Z_

Built. A fifth ledger column `checksum`, created by the bootstrap and
added to an older ledger by an idempotent `alter`. `bodyChecksum` hashes
the text below the banner block with `\r\n` normalised to `\n` and
nothing else; `wholeFileChecksum` hashes the whole normalised file and
never consults the banner, which is what a raised row records.
`recordAppliedMigration` takes the checksum as a required argument for
the reason `origin` is required: no default would be correct. `migrate`
compares every recorded chain file present on disk before it applies
anything and refuses the whole run with `apply-migration-body-changed`,
naming every changed file with both checksums abbreviated to twelve hex
digits; `status` reports the same finding as one diagnostic per file and
exits non-zero, on a run whose plan has no disagreement.

Measured, and worth keeping.

1. A mutation exposed a test, not the code. The first `\r` case replaced
   a space with a lone `\r`, so a cr-preserving and a cr-stripping
   implementation both differed from the original and the `not.toBe`
   assertion could not separate them. Two rules came out of it: an
   inequality is never a falsifier, and an instruction that names a
   falsifying input also names the mutation that turns it red. Every
   later task carried a mutation per claim; three of them found defective
   tests rather than defective code.

2. The `String(...)` trap was real, not hypothetical. Mutating
   `readLedger`'s mapping printed `"checksum": "null"` and
   `"checksum": "undefined"` -- an older row would have stopped meaning
   "never compared" and started meaning "matches nothing".

3. A fake is never more permissive than production. The in-memory ledger
   fake gained an `alter table` branch that throws 42P01 when not
   bootstrapped and never sets the bootstrapped flag, because a fake with
   a second way to be bootstrapped invites tests that lean on it.
   `apply-reset.test.ts`'s fake identified statements by falling through
   to a default it called "the DROP DDL", so the new bootstrap statement
   was mistaken for the drop; it gained one branch above that fallback
   and a comment saying every ledger statement must match above it.

4. A fixture must not approximate production. The old-ledger witness
   builds its state by running `migrate` normally and then dropping the
   column, not by hand-inserting a ledger row, because a hand-written row
   can diverge from what hejbro actually writes.

5. The live witness found what no fake could. Every ledger-touching
   command reads the ledger before it bootstraps, and once the read
   selected `"checksum"` a ledger created before the column failed with
   42703 -- not the 42P01 `readLedger` tolerated -- so the bootstrap's
   `alter` was unreachable and such a ledger was refused on every run.
   No unit layer could see it: the fakes never interpret the SQL's column
   list, so only a real server raises 42703. The repair belongs to task
   1.2 and was made in 1.5, the task that found it.

6. One defect hid another. The witness's own fixture flaw only surfaced
   once the read bug stopped blocking earlier. The point where a failure
   first surfaces is not the extent of the defect.

7. Touching and reverting a source file raises its mtime, so `dist`
   reads as stale even when the content is identical; a mutation round is
   followed by a forced rebuild before any full run.

8. The green commit for task 1.1 carried fifteen red cases in an
   out-of-boundary fixture; the next commit repaired them under 631/R5.
   A ruling body was once recorded under the wrong number because the
   tool numbers by count and earlier rulings had not been executed yet;
   it was reverted before the commit and re-recorded in order (#943).

9. Docker is shared. One integration run collapsed with "container never
   became ready" for twelve of fourteen files, caused by zombie
   containers plus another piece team's `review-sf-pg`; clearing them
   fixed it.

10. Filed while working here: #969 (a `git remote get-url origin` probe
    leaking stderr into every test run), #978 (`parseBannerHashes` splits
    on `\n` only, so a CRLF checkout leaves `\r` on the parsed banner
    hashes -- this piece's CRLF witness therefore claims only the body
    checksum and keeps every chain file in CRLF), #981 (two integration
    failures that reproduce on clean dev).

11. Shelf life. These live witnesses sit in a suite CI never runs. The
    defect at (5) was caught because someone ran it by hand, and #981
    shows the suite does rot when nobody does.

Cost. Estimates and measurements per task are in
`openspec/task-times.csv`. The overruns have five sources: a new field or
argument reaching existing tests; a mutation witness for every control
row; recording rulings and editing the delta; re-sent instructions after
a message crossing (eleven before 631/R12 was adopted); and a defect only
the live layer could surface.

<a id="w2"></a>
## W2 — what two constructor-mode reviews found, and what the repairs cost

_2026-09-06T01:12Z_

Two review rounds, both in constructor mode: 36 constructed inputs and
914 observed server statements in the first, 26 and 643 in the second,
with no implementation source read either time. Round one returned three
blocking findings and four notes; round two returned none blocking and
one note, and confirmed every earlier finding closed by measurement.

What the reviews found, and where it came from.

1. Two of the three blocking findings trace to the planner reading a
   contract sentence too narrowly, not to the implementation drifting.
   B1: the delta says a changed body is "reported as its own line, never
   as 'applied'", and `status` kept listing it in stdout's applied bucket
   while the diagnostic went to stderr -- a caller parsing stdout saw it
   as plainly applied. The prohibition was in the sentence; task 1.4
   verified "own line, same code, non-zero exit" and never looked at the
   bucket. B3: R2's body predicate ("everything after the first blank
   line") meant a hand-written migration whose banner is not followed by
   a blank line had its executed statements outside the checksum, and an
   edit to them afterwards was invisible to both `migrate` and `status`.
   The alternative had been rejected for an ambiguity that was in fact
   resolvable. Neither could have been caught by a mutation: they are
   misreadings of the first of D110's three layers, and the layer a
   constructor-mode review reads directly.

2. The final predicate, and why the tempting fix was refused. The banner
   is the first line plus the leading run of blank lines and lines that
   begin with `--` at the start of the line; the body begins at the first
   line that is neither. An indented `--` and a `/* ... */` block are
   therefore body. Making "a comment" true in SQL's terms would pull in
   block comments, which span lines and nest, and the checksum boundary
   would then depend on parsing SQL -- the one thing this boundary has
   avoided since R2, whose design goal was two mechanically decidable
   predicates. The deviation is in the safe direction: coverage widens,
   and executed text can never fall outside the hash. Two rows pin the
   consequence and two mutations give them falsification power -- `trim()`
   before the check reddens the indented case, and treating `/*` as a
   banner prefix reddens the block case. That second mutation is the
   direct guard against a later attempt at the refused fix.

3. Recorded plainly, as the lead asked: the lead's R15 formulation of B3
   flipped twice across three messages, and the final is the first one.
   The planner had warned that replacing R2's predicate would invalidate
   every recorded checksum; under the final formulation it does not, and
   the second review verified it from outside -- the generated file's
   checksum is `6aa6634f8a7f` in both rounds.

4. B2 was closed by correcting a sentence rather than code. R13 said "the
   first command that writes"; `reset` writes (it deletes rows) and did
   not add the column. The reason a command must add the column first is
   that its write carries a checksum, and a `delete` does not, so the
   true invariant is "the first command that records a row". `reset` was
   left outside the piece, and the reviewer's own input became a witness
   that the corrected sentence holds: `reset` succeeds and the column is
   still absent.

5. N3 was an alignment, not a discovery. The delta already said a
   filtered ledger's rows "may be hidden"; the message asserted they are
   hidden, which is false for the ledger's owner and for a `BYPASSRLS`
   role. The message had drifted from the spec's own hedge.

What the reviews confirmed from outside. The input that passed at exit 0
in round one now fails with `apply-migration-body-changed` and exit 2. A
normal run still sends exactly one catalog statement, counted from the
server's `log_statement=all` rather than from our own test, in both
rounds. The integration suite's pass count rose from 105 to 107, so the
new live witnesses really run.

How the work was done. The implementer implemented one repair before its
red, caught it himself before committing, reverted, and re-ran the cycle
in order -- and reported it. Every revert in the rework was proved rather
than asserted: `git diff <pre-ruling commit> -- <file>` empty for each
file, with `check:pr-changeset` falling from six published source files
to five as independent corroboration. One wording change moved the
message and its equality test together and so never went red at that
spot; no extra mutation was demanded because task 1.6's fourth mutation
had already proved that same equality can falsify, and the reasoning is
recorded rather than assumed.

One planner rule came out of this round. A message to a reviewer carries
the commit range, the spec, the finding names and the known boundaries,
and nothing else. A list of "inputs the reviewer might construct" was
drafted for the lead's briefing and would have destroyed the property
that made the first review worth its cost: B3 exists because the reviewer
asked "what if there is no blank line after the banner?" unprompted, and
a list of what to try becomes the boundary of what gets tried.

Cost. The rework took 85 minutes on top of the group's 561, plus 20 for
the last repair. The overrun sources are now six: a new field or argument
reaching existing tests; a mutation witness for every control row;
recording rulings and editing the delta; (d1) re-sent instructions after
a message crossing, thirteen of them; (d2) re-instruction after a ruling
was revised, which is the lead's own line; and a defect only the live
layer could surface.

