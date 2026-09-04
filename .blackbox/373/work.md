# Work — quickstart-now/hejbro#373

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — skills overhaul — the user-facing surface catches up, and learns to prove itself (#373)

_2026-08-28T00:00Z_

Piece record for the skills-overhaul improvement (tracking #373, one of
the eight issues adopted from the owner-supplied external AI review),
built by the sk piece team (planner opus / implementer sonnet / reviewer
opus) in worktree `skills-overhaul` off dev `17b9b3e`, verdict PASS at
`ee281ad3690189548c35f6341f59a227bb6ed7d2`, rebased blob-identical onto
`90a75b4`. Ten commits, +1428/−25 over 19 files, review verdict
PASS(conditional) closed to PASS with zero unresolved defects.

### What landed

The four #373 gaps closed: `references/query-layer.md` (nine compiled
snippet blocks over select/insert/update/delete, RLS execution context,
`$type` branding, `sql` escape); `references/brownfield-adoption.md`
(the honest (c)-style guide — hejbro has no introspection, so the guide
says what exists, citing #385 rather than pretending a path); an apply-
failure section in `generate-verify-workflow.md`; and a two-axis
routing rewrite of `SKILL.md` (v0.2.0). The snippet-compile harness:
every ```ts fence in the skill is extracted with its `prelude=`
directive, compiled by the real packages, and `expect-error=` demands
the exact numeric TS code; the `no-check` allowlist ships EMPTY (the
three previously broken blocks were repaired, not exempted);
```typescript fences are rejected so the gate cannot be dodged by
mislabeling. `packages/skills/README.md` was scope-extended into the
piece by lead ruling: the package must describe its own artifacts.

### What the harness caught while being built

- **#386**: a draft snippet putting the `sql` hatch in a condition
  position failed TS2322 — writes accept `unknown`, conditions demand
  `boolean`; a real product asymmetry, filed.
- **#385**: the brownfield investigation proved gap ③ was a missing
  product path, not missing prose — no introspection, no baseline
  registration; filed, and the guide cites it.
- **#389**: the D1 supplement copied
  `query-type-inference/spec.md:152-154` faithfully ("branded type
  flows through results and inputs") and became wrong documentation —
  the spec sentence contradicts the same file's :59-61 and the code
  (`mutate.ts` `UnwritableFamily`). The reviewer's code cross-check and
  the harness (write red, read green) caught it; the spec fix is filed.

### The two boundaries worth keeping

1. **The harness's machine verification ends at snippet types, path
   existence, and fence labels. Prose claims are guarded by human
   review alone** — proven by the reviewer planting a fake API in
   prose and watching the suite stay green. The compensating procedure
   used here (issue numbers checked number+title+state, error codes
   checked against source strings and the `Next:` convention, API names
   against the public export list, coordinates down to line ranges) is
   now a standing review item for documentation pieces.
2. **A docs piece's final authority is the code, not the spec** — the
   implementer invented nothing and still produced a wrong sentence,
   because the spec itself was stale (#389). Spec citations in
   documentation require a code cross-check.

Also recorded: the harness source itself sits outside the tsc gate
(`packages/skills` has no check-types task; vitest transpiles, biome
lints without types). Its effective guarantee is the nine standing
meta-tests plus the review's mutation evidence — do not mistake it for
tsc-guarded.

### Verdict strength

Contract 12/12; coverage of the 43 query-layer requirements: 37
mentioned / 5 deliberately omitted (driver-author-facing) / 0 missing.
Cross-checks: 12 issue references, 6 error codes, 25 coordinates — zero
false. Nine mutations planted in isolation, all caught or (for prose
plants) correctly demonstrating the boundary above. Gates independently
reproduced at the frozen SHA: build/check-types/test all Cached: 0,
labels identical to baseline, biome 415→421 matching the six new .ts
files exactly, CRAP clean, frozen lockfile. Scope: skills docs +
`packages/skills` + three lockfile lines, nothing else.

### Process record

Review ran one full round plus three supplement rounds (D1–D5, then a
D1 correction whose root cause was #389, above). The D5 scope extension
(package README) was a lead ruling mid-review. Ledger: implementation
~3h30m pure (harness 55m; query-layer draft 30m + contract-driven
rewrite 60m; brownfield 20m; apply-failure 20m; routing 10m; gates and
corrections ~35m) plus three supplement rounds of review process.

Migrated from the single-file entry `.blackbox/2026-08-28-skills-overhaul.md`, kept verbatim at `.blackbox/373/artifacts/2026-08-28-skills-overhaul.md`.

