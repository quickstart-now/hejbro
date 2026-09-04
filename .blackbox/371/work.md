# Work — quickstart-now/hejbro#371

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — generated-columns group 3 — the keys that must not exist, and the pin that guards it

_2026-08-28T00:00Z_

Piece record for `add-generated-columns` task 3.1 (tracking #371),
built by the gc3 piece team (planner opus / implementer sonnet /
reviewer opus) in worktree `gen-g3-typing` off dev `9963d04`, verdict
PASS at `748dd6a…`, rebased blob-identical onto `3037e30`. Ran in
parallel with gc2 (zero file overlap; the one incursion temptation —
chain.ts — was resolved in-file instead).

### What landed

ALWAYS-family keys (stored generated, identity always) are absent from
`InsertInput` and `UpdateInput` — not optional, not `never`-valued;
by-default identity flows through the existing `hasDefault`
optionality with both directions pinned (supply green, omit green).
`UpdateInput`'s key-domain filtering needed a compiler workaround
(`& Record<never, never>`) to keep the #351 chain wiring assignable —
load-bearing proven by removal (TS2345 at `src/db/chain.ts` 296,59 and
413,58, implementer and reviewer matching independently on all four
coordinates file/line/column/code), with zero effect on the key
surface (removal breaks no test). The tsdoc for it was trimmed to its
constraint under the comment-budget rule that landed mid-piece (#380);
the measurement lines live in the piece PR body.

### Verdict strength — the highlights worth keeping

1. Six mutants, six kills, every kill attributed to `check-types`;
   vitest measured as zero-information for this piece (a
   check-types-failing tree runs 33/560 green under vitest).
2. **Mutant 5 identified the sole guardian of an owner decision**:
   swapping absence for `key?: never` silences all four
   `@ts-expect-error` directives (consumed by value errors) — only the
   two `keyof` equality pins die. D100 decision 5's "absent, not
   never-valued" is held by the keyof pins alone; directive assertions
   cannot see that axis at all.
3. Coverage partitioned with zero overlap and zero free riders: the
   five red directives split exactly across the generated arm (M1) and
   the identity-always arm (M2), and M4 kills only the Update side —
   the delta's "both input types" proven, not assumed.
4. The dead-directive trap (found during this piece's own planning:
   a directive whose value arm is type-wrong gets consumed by the
   VALUE error and never proves key exclusion — before or after
   implementation) was defended structurally: every directive's value
   arm is `` sql`1` `` (`Expr<"unknown">`, valid for every column), so
   directive removal surfaces TS2353 unknown-property — the delta's
   own wording.
5. The comment-only follow-up commit was carried constructively:
   test files shasum-identical, source identical on all 61 non-comment
   lines — the verdict transfers to the new SHA without re-running.
6. Reviewer-built harness reliability: pristine enforcement (exit 92,
   no ghost mutations) and no-op rejection (exit 93, no false
   accusations), self-verified before use.

### Process record

One planner frame error ("the directive is green pre-implementation")
was challenged by the lead's own calculation, corrected by the planner
in one round — and the digging surfaced the dead-directive trap above,
turning a wrong claim into the piece's second-best artifact. A first
implementation predating the terminal contract was caught by the
planner reading the tree (the gc1 corrective — pre-gate contract
re-read — was briefed and the reimplementation came back clean,
including withdrawing an earlier fixture deviation). The two
same-check-list escalations (skills obligation) from gc2 and gc3
arrived independently — cross-team silence working as designed, with
the lead deduplicating: the obligation attaches at change level and
the lead lands the cheatsheet section in the archive PR. Ledger: 25m
pure (implementation within estimate; overage = evidence rounds) +
15m evidence re-collection + 8m comment trim; tokens 567 requests /
524,661 output / 97.5% cache.

Migrated from the single-file entry `.blackbox/2026-08-28-generated-columns-group3.md`, kept verbatim at `.blackbox/371/artifacts/2026-08-28-generated-columns-group3.md`.

