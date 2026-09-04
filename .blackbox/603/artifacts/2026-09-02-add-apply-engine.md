Refs:
- docs/specs/2026-08-19-hejbro-design.md @ blob a7200550b8114fcfb9abce0d1366887206bf3711
- openspec/changes/add-apply-engine/proposal.md @ blob 481e8941ff8d3ba69e4878314f7af9bd0bece370
- openspec/changes/add-apply-engine/tasks.md @ blob f376cd7a5d40cf1776e605c92d47274c8fdad993
- packages/core/src/engine/split.ts @ blob 6eb5d531cf9b6f684c5c7839a15140bf15883554
- packages/cli/src/apply/execute.ts @ blob cd3e0f05842e01a53cc5ea7a3e6dc3034063ca73
- packages/cli/src/apply/plan.ts @ blob 818651594fdb3ed96a4f45369e34725ca38d2b7c
- packages/cli/src/commands/migrate.ts @ blob 1c3324c60cfe67179dc9156dfb309151672714b2
- packages/core/src/sql/migration-file.ts @ blob d642455d5871e259f232d2bb5701de5bf04b2741
- skills/hejbro/references/brownfield-adoption.md @ blob 85b5c2ee97c9b7ee0853304aff827f9191d9fabe

(These nine are the files central to this entry's own narrative — the
design spec carries D12's amendment and the two new decisions; the
proposal and `tasks.md` carry the record of what was planned, found, and
corrected; the rest are where the corrections themselves landed. The
change touches far more files than these nine; the full diff is the
PR's own record, not repeated here.)

# add-apply-engine — hejbro owns applying a migration chain (#603)

A hejbro team-up piece (planner/implementer/researcher), not a live
owner exchange: the governing decision — D12 amended, applying
migrations becomes hejbro's own command surface, production included —
was made under the owner's standing delegation, by the lead session
(the same pattern D103–D106 already used), to be surfaced to the owner
on return. Two further decisions were made the same way while the
change ran: reading hejbro's own apply ledger is not database-shape
validation (D108), and the supported Postgres floor is a policy — the
lowest still-current major the shipped output actually requires,
currently 15, because the emitter writes `security_invoker` on views
(D109).

## What shipped

Four new commands (`migrate`, `status`, `reset`, `raise`), each backed
by the same mechanism: a migration applies inside its own transaction,
with a transaction-scoped advisory lock (`pg_advisory_xact_lock`)
serializing concurrent runs against the same database. A migration that
adds a value to an existing enum type and uses that value in the same
run is split across two migration files at the transaction boundary
Postgres itself requires — `generateMigrations`, `@hejbro/core`'s new
plural entry point, returns the split; `generateMigration` (singular)
keeps its old shape for its ~40 existing callers and refuses a run that
would need to split. A baseline migration (adopting a database hejbro
did not create) is registered in the ledger without its statements ever
reaching the database — a requirement that shipped in the delta but had
no code behind it until the change's own last group (below).

## What this change got wrong

The list is longer than the list of what it got right, on purpose — a
flight recorder that only records good flights is not one.

1. **An inherited premise was false.** The change was scoped around
   "`alter type … add value` cannot run inside a transaction block, so
   whole-run atomicity is impossible for any run that touches an enum."
   That is PostgreSQL 11's rule. Postgres 12 and later run it inside a
   transaction block and forbid only *using* the value before the
   transaction that added it commits. The correction came from reading
   two versions of one piece of documentation, and it reversed the
   design: the migration file became the atomic unit again, and a
   parser, a `psql` delegation, and a banner marker that the design had
   grown to work around the false premise all stopped being needed.
2. **A design was announced as settled and then found to break a
   migration that works today.** After "there is no partial
   application" was reported as the change's best property, measurement
   showed hejbro's own generator emits a file — an enum value added, a
   column defaulted to that value, both in one run — that applies
   cleanly under `psql` and fails inside a transaction. The generator
   now splits such a run into two migrations instead (`split.ts`,
   pinned above).
3. **The banner marker declaring a file transaction-unwrappable was
   drafted twice and reversed twice.** First deferred for want of a
   witness, then revived once the witness (finding 2) turned up. It is
   now rejected outright: the generator's own split makes it
   unnecessary, since no file is ever applied outside a transaction in
   the first place. Both reversals are left visible in the proposal on
   purpose — the second one is what found the actual answer.
4. **The proposal claimed core stayed untouched, after the ruling that
   touched it.** A stale `⟦MEASURE⟧` marker sitting beside that sentence
   hid that the sentence itself had become false once the split (finding
   2) landed inside `@hejbro/core`.
5. **The planner's own return-shape design was unworkable, and nobody
   had counted its cost before ruling on it.** Reshaping
   `generateMigration`'s result was decided without counting its
   callers; there are more than forty across the preset and driver
   packages. The implementer found this *before* writing any code, so
   the cost paid was a design round trip, not a rewrite.
6. **The planner reported on files it had not opened.** "No command
   names appear in the delta specs" was wrong — six do, in one file —
   and an interpretation was then built on top of the wrong observation.
7. **The planner manufactured a finding out of someone else's prose.** A
   comment was reported to the lead as claiming more than its own code
   did, on the strength of a sentence in a report rather than a direct
   measurement. Re-measured, the comment was accurate, and the finding
   was retracted.
8. **The planner framed a requirement more broadly than the spec
   actually states.** `raise` refusing "someone else's schema" was
   called a gap; the requirement only refuses a database already holding
   *declared* objects, and an object no declaration covers is exactly
   the kind of thing this product already reports elsewhere and
   otherwise leaves alone. The correction also caught a test that would
   have passed vacuously against the broader, wrong framing.
9. **A plan sentence was true when written and false by the time it
   mattered.** `tasks.md` said "rebase onto dev"; by the time that step
   was reached the branch had already been pushed nine times, and
   rebasing a pushed branch rewrites history other people have already
   fetched. Nobody re-read the sentence before acting on it — that is
   the actual failure, not the original wording, which was correct when
   written.
10. **Counting was wrong four separate times**, each time stated before
    its own members were actually listed: the scenario count (21 vs.
    20), the `[design]`-tagged task count (12 vs. 13 vs. 16), the number
    of fragments in `check`'s no-transaction argument (three vs. four),
    and the premise inventory itself (six vs. nine). Every time, the
    artifact being counted was right and the report about it was wrong.
11. **An unverified premise traveled two hops before anyone opened the
    file it was about.** The lead reported that a diagnostic-xref gate
    fix had landed on `dev` and warned that this branch's own CI would
    break if this change's own documentation cited the new error codes
    the fix now recognized. The planner accepted the warning and ordered
    a second merge of `dev` on that basis alone. Neither the lead nor
    the planner had actually opened the gate script to see what it
    scans: `packages/{core,cli,supabase}/src` only — never `skills/`,
    `docs/`, or `blackbox/`. The implementer opened the script while
    doing something else (confirming a documentation edit was safe) and
    the merge instruction was cancelled before it ran. Written as one
    person's mistake this is wrong: the lead made an unverified premise,
    the planner adopted it unverified, and the implementer caught both
    by reading the one file that actually settled the question. The
    cost of the near-miss was a cancelled instruction; the save was one
    merge commit and a tree that did not get moved for no reason while
    other work depended on it staying still.
12. **A requirement shipped in the delta with no implementation behind
    it, and a test's own name is what hid it.** The migration-apply
    delta's "A baseline is registered rather than run" requirement —
    with its own scenario, "no statement from that migration is sent,
    the ledger records it as applied" — had no caller anywhere for
    `parseBannerBaseline`, the exported parser the requirement itself
    names. It never did: `migrate` sent a baseline file's SQL exactly
    like any other pending file, and against an already-adopted database
    that DDL met the server's own already-exists refusal — the precise
    opposite of the scenario the delta had promised. Found in group 10,
    by the implementer checking whether a documentation sentence he was
    about to write — whether `migrate` now handles baseline registration
    — was actually true, before writing it. This is the same defect
    shape this change spent its whole life finding inside other people's
    tests and other people's specs (see "The shape this change kept
    finding" below); here it was inside this change's own plan, and it
    concealed a missing feature all the way to the last group before it
    was caught. Repaired in a dedicated group (#624) once found: the
    plan now carries which pending entries are baselines
    (`apply/plan.ts`), `applyMigration` skips sending a baseline file's
    SQL while still sharing the exact same lock-and-recheck concurrency
    guarantee an ordinary apply gets (`apply/execute.ts`), and `migrate`
    reports a baseline as "registered ... (statements not executed)",
    never "applied" (`commands/migrate.ts`).

    **The two reds this requirement produced, side by side, are this
    change's own most useful pair** — one is the failure this whole
    entry is about, the other is what a red test is supposed to look
    like instead:

    - **Group 1's red** (what hid the gap): named "registers a baseline
      without executing its statements". Its body proved only that
      `recordAppliedMigration` — the ledger's own recording function —
      takes no SQL parameter to send. A true fact about that one
      function's signature, and nothing at all about whether anything
      in the apply path ever read the baseline marker. The name claimed
      a behavior; the body proved a shape.
    - **Group 12's red** (what the repair was measured against, before
      it existed): the live witness run against the *unrepaired* code,
      against a database already holding the objects a baseline
      migration would create — verbatim server output, not paraphrased:

      ```
      error[apply-failed]: 20260901222511_add_app.sql
        applying "20260901222511_add_app.sql" failed (42P06): schema "app"
        already exists. Next: fix what the error above describes, then
        rerun `hejbro migrate`.
      ```

      This is the server itself refusing the exact thing the requirement
      says should never be sent — a red produced by the requirement
      actually breaking, not by a function's own shape standing in for
      it.

## The shape this change kept finding

Something claims more than it actually establishes, and the claim is
invisible because everything around it stays green. This change
measured the same shape on five different axes:

- **Subject** — a test's own name claims a property its body cannot
  establish. Three instances inside this change (including finding 12
  above); one already shipped elsewhere in the repository:
  `verify.test.ts`'s "hand-edited migration" test only ever edits a
  banner line, never the migration's own SQL.
- **Coverage** — `check-next-marker` walks only `throwHejbroError` call
  sites, not every way a diagnostic can be built; `check:diagnostic-xref`
  (before its own upstream fix, #619) matched one specific way a code
  could be written, not every way one actually was.
- **Observability** — a note in `history`'s own delta asserted a
  *cause* ("squash merge lost …") that `git` itself cannot show; a tool
  can report what happened, never confidently why.
- **Scope** — a change-level `openspec validate --strict` passing says
  nothing about whether the corpus as a whole still agrees with itself.
- **Detection form** — a diagnostic code assembled from a template
  literal rather than written as a literal string is invisible both to
  a gate that scans for literals and to a plain `grep` for the code name
  (#619, the fix that later closed this specific hole).
- And, found merging the sibling `add-polyrepo-sync` change in: git's
  own clean, conflict-free auto-merge broke six files semantically
  without raising a single conflict marker — the type-narrowing split
  between `HejbroInput` and `AnyInput`, and five files' worth of
  optional-config-field wiring, all merged silently wrong and had to be
  found and adapted by hand, gate by gate.

## What the finished code cannot say about itself

- **The concurrent-runner race was found only by running it, not by
  reasoning about it.** Two `migrate` runs against the same database:
  the loser's own pending plan is computed before it gets the advisory
  lock, so by the time it actually holds the lock the winner may already
  have applied and committed the very same file — the loser then
  re-sends already-applied DDL and meets the server's own refusal. The
  ledger itself stayed correct throughout every run that hit this, but
  only because the server's own already-exists refusal happened to catch
  it, never because the design had planned for it. The repair (group 11)
  rechecks the ledger inside the lock's own transaction, closing the gap
  structurally rather than relying on the server to catch it.
- **Three defenses against a double-applied migration sit at three
  different depths, and only one of them was actually designed for
  this.** The ledger's `filename` column is `not null unique` — added in
  group 1 for an unrelated reason (the key a row is found by), not as a
  race defense, but it would have caught a double-insert regardless. The
  server's own already-exists refusal on the DDL itself is what actually
  caught every occurrence of the group 11 race before the repair landed.
  The in-transaction recheck (group 11's own repair) is the only one of
  the three actually designed against this specific failure.
- **Predicting before measuring paid off twice, in opposite directions.**
  A predicted outcome for `verify --fix` was wrong, and the wrong
  prediction is exactly what taught the actual rule (`--fix` refuses an
  ambiguous group rather than guessing); a predicted outcome for the
  delta-landing byte comparison was exactly right (15 files matched, 3
  new), and being exactly right is what made that green result mean
  something rather than being an unfalsifiable pass.
- **Reusing the migration emitter is what made `reset` explainable at
  all.** `reset` is implemented as the migration that drops everything a
  project's declarations manage, run through the same emitter that
  builds every other migration — banner comments and all — rather than
  as a second, bespoke code path with its own reasoning to audit.
- **Structural proofs replaced live tests four separate times in this
  change's own history** (recorded, not re-derived here): a function
  with no parameter for a migration's SQL cannot possibly send one; a
  snapshot that stores a function body as a plain string cannot be
  walked into and mutated structurally; a `language` field typed as a
  single string literal cannot express a parsed, structured form; and a
  type referenced only by its shape, never re-declared by name, survived
  the sibling change's own redefinition of a related type untouched.

## Process facts worth keeping

- **Crossed messages were the dominant failure mode across this whole
  piece** — fourteen occurrences or more, most of them harmless once
  caught but two of them (findings 9 and 11 above) costly enough to
  matter. Two standing rules came out of it during the piece itself: a
  blocked question gets re-sent in full rather than assumed answered,
  even at the cost of repeating it; and a push approval is never sent in
  the same message as the next dispatch (the exact way one earlier push
  approval went temporarily missing).
- **Frozen estimates did not predict actual time for small, pure
  modules, consistently.** Four small modules estimated at 26–44 minutes
  each ran 9–10 minutes actual. Cross-cutting groups behaved
  differently and closer to their own estimates (one ran 77 estimated
  minutes down to 43 actual; another 58 down to at most 35). The
  learning is recorded for the next estimate; the frozen numbers
  themselves stayed frozen, by this repository's own D88 rule.
- **Reading a comparable change's own precedent before starting saved a
  known cliff.** A comparable earlier change had spent 35 minutes on its
  own Docker integration suite against an estimate of 9, entirely on
  container-readiness timing. This change's own two-image live witness
  (group 8) read that precedent first and ran both Postgres images in
  18 minutes total.
