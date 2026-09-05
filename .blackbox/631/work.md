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

