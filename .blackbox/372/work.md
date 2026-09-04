# Work — quickstart-now/hejbro#372

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-policy-roots — the enumeration class, killed at the root (#372)

_2026-08-28T00:00Z_

Plain-cycle policy/tooling change, executed by the lead session in
worktree `fix-policy-roots` off dev `9963d04`, while the gc2/gc3 piece
teams ran in parallel (zero file overlap).

### The class and the kill

Four instances of one failure in a single week: the two diagnostic
gates each skipped query/pg (#361 widened their hardcoded lists),
`.claude/rules` never grew query/pg rules, and `skills/hejbro` never
learned the query layer exists. Root: cross-cutting infrastructure
enumerated its surfaces by hand, and nothing forced the enumeration to
grow when a package was born. The kill: `scripts/source-roots.mjs`
derives the roots from the workspace itself (`@manypkg/get-packages`,
already a devDependency — the CRAP gate's TARGET_PACKAGES derivation
was the in-repo precedent), filtered to `packages/*` members with a
`src` directory. Both gates now import it; there is no list left to
forget to widen.

Proof, both directions: the derived set matches the previous five
exactly (defined-code count stays 126, protecting the in-flight
pieces' pinned boundary), and a fake new package
(`packages/faketest/src` with a `Next:`-less error site) was scanned
and failed the gate with ZERO list edits — then removed, clean exit 0.

### The non-mechanical remainder

Where derivation cannot reach, policy lines now stand: the
done-checklist gains "public API changed → `skills/hejbro` updated in
the same PR" (the process-axis root of the skill blind spot); Hard
rules gain the comment budget ("comments state the constraint only" —
narratives go to the PR or blackbox, which D89 built for exactly
this); and `.claude/rules/` gains `query-purity.md` and
`pg-driver.md`, so the two packages' load-bearing constraints are
enforced where AGENTS.md only asserted them. The adversarial review
layer (#374) remains the standing backstop for whatever stays
non-mechanical.

### Gates

biome 415 clean · check-types 13/13 `Cached: 0` · test 14/14
`Cached: 0` · CRAP 0/1199 README unchanged · both diagnostic gates ok
with derived roots (126). No changeset: tooling/policy only.

Migrated from the single-file entry `.blackbox/2026-08-28-fix-policy-roots.md`, kept verbatim at `.blackbox/372/artifacts/2026-08-28-fix-policy-roots.md`.

