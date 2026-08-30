Refs:
- openspec/config.yaml @ blob 0e9a3ed52ca538f09e049d1a6fe9d593a3180a5b
- AGENTS.md @ blob 8ae0060037c53e73cc2286c2a9c5157095af2c8b
- README.md @ blob ba91194c8bd32da2d0d8412eeb5a98c9b7ff0b07
- packages/core/src/query/mutate.ts @ blob 7e7f663880ed1b4ce26515266ecf4eb5688f4478
- packages/core/test/query/mutate.test.ts @ blob 6faacba4e99a200cc8d023585781512caf979681
- packages/query/test/db/chain.test.ts @ blob 4f85e2758104f4f80e8637357cd2d32b071e05f2
- packages/cli/test/generate-command.test.ts @ blob fe38e6b3958c6f187318c01822da9c3f1afc62c9
- packages/skills/test/neon-mode-mismatch.test.ts @ blob 0c1f5299ac786759bb1fd96fafcb96ac45a2fab1
- skills/hejbro/references/neon-preset.md @ blob adafd068b073e984f9f8c928d9267a929d489f29
- openspec/specs/cli-commands/spec.md @ blob af36bbf169732fccf907ea32498074d163a8c36b
- openspec/specs/query-builder/spec.md @ blob 538de73296633bfd36675e093ad5521764413350
- openspec/changes/align-spec-corpus/proposal.md @ blob 5e153d49c74c1036e6710598ffe786a25d14b6c3
- openspec/changes/align-spec-corpus/tasks.md @ blob 6beb922aa6fb43b36e4762abdeb12e544d507106

# align-spec-corpus: applying the external evaluation's 18 adoptions

## Owner input

The owner commissioned the change in an explicit three-step frame:
"I think we need an objective assessment of the openspec declared in
hejbro. This is an evaluation, not a change." Pressed on what objective
meant: "Not you evaluating it yourself. I want an isolated Fable model
that knows only what kind of project hejbro is to analyze at max effort
and propose an analysis document with improvements. Then I want the
process of you and me looking at the finished document together,
evaluating each item one by one and deciding whether to apply it." A
mid-run addition scoped the corpus: "Evaluate only what is declared in
openspec/specs — we need it to predict how to carry things forward."

The isolated evaluator (no project context beyond a one-paragraph
product description; corpus-only file access) returned 32 findings and
18 proposals; the full report is `evaluation.md` in the change
directory. The owner then settled every proposal serially through
AskUserQuestion rounds — all 18 adopted, with D2 (divergence detection:
execution tripwires + review binding, both) and D3 (codify in
config.yaml + the personal skill, dual) chosen as recommended — and
picked "one openspec change" as the application vehicle. The owner
invoked `/opsx:apply` as the approval to implement.

## The tripwire firing and the owner's ruling

Task 1.1 (`[design]`, on-conflict contract confirmation) measured that
a zero-target `onConflictDoNothing()` renders
`insert … on conflict () do nothing` — SQL Postgres rejects at parse
time; neither a refusal nor valid bare `on conflict do nothing`. Going
green on any honest spec of that surface required package-source
change, which the change's own Non-Goals forbade — the first live
firing of the divergence-tripwire rule this same day's #519 landed in
config.yaml. Escalated with three options; the owner ruled: "add the
guard in this change" (recommended option). Landed as
`resolveConflictTarget` guarding both conflict stages with the coded
`empty-conflict-target` failure (red test first), the change's single
deliberate behavior change, carried by a patch changeset.

## What the apply phase found

- **Bindings held almost everywhere.** The split query-execution
  requirements, the interval normalization contract
  (`canonicalizeInterval`), the migration-format banner scenarios
  (prefix-only parsing, unknown-line tolerance, prose-not-contract),
  and the diagnostics format (per-code test assertions plus
  `check:next-marker`) were all already test-bound; the corpus's
  scenario↔test pairing was real, not aspirational.
- **Two genuine gaps produced new tests**: no chain-level test existed
  for `offset`/`distinct`/`distinctOn` (two stage-parity
  compile-equality tests added — parity held), and no byte-determinism
  test existed for `generate` (double-fixture comparison added — held).
- **One delta was corrected against reality**: P18 pinned the Neon
  mode-mismatch documentation to the package README, but the repo's
  documented user contract lives in
  `skills/hejbro/references/neon-preset.md`, which already carried both
  halves of the warning; only the token-validity-timing fact was
  missing. The delta now names the skill reference; the doc test
  asserts the three facts; the missing sentence was added (red first).
- **README's package table had no `@hejbro/neon` row** — the provider
  staleness (F27/P4) ran deeper than the one sentence the evaluator
  could see from inside the corpus.

## Rationale

Execution followed the tiering precedent (lead-direct with piece
tracking issues #523/#524/#525 under change issue #522) rather than
three team summons: ten tasks totalling ~78 estimated minutes of
doc-and-test work. Durations landed per group in
`openspec/task-times.csv`; the delta-vs-reality corrections used the
fluid update-in-place path the owner adopted the same morning, and the
one scope expansion went through the tripwire protocol rather than
being absorbed silently.
