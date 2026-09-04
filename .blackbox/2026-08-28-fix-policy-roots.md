Refs:
- scripts/source-roots.mjs @ blob 1d67c413920bf276be42101b3f1a5b52053897dc
- scripts/check-diagnostic-xref.mjs @ blob b2462aa7879f3e663b2ab08798c8ed5db9c7ae4c
- scripts/check-next-marker.mjs @ blob 7dc2f2b6c9f0c41e0ab4f53b27bd25f17094818d
- AGENTS.md @ blob 5c97705c868bf992e4c8aea5ac4afcb3416dac51
- .claude/rules/query-purity.md @ blob 8051afb91e883e20b9d73ef8b7b21b306b1cfe8c
- .claude/rules/pg-driver.md @ blob 1b40c2b853c8ce210f29e4f5d00e42afec3111e6

# fix-policy-roots — the enumeration class, killed at the root (#372)

Plain-cycle policy/tooling change, executed by the lead session in
worktree `fix-policy-roots` off dev `9963d04`, while the gc2/gc3 piece
teams ran in parallel (zero file overlap).

## Owner inputs (English rewrites)

1. The owner supplied an external AI review of the repo's agent
   tooling (13 findings) and asked what the lead thought of it. The
   lead verified each claim against the repo before answering: ten
   confirmed outright; finding 5 ("the reviewer is the author") was
   factually wrong about the current piece-team process but right
   about the missing framing-independent layer; finding 10 (a
   `snapshot upgrade` command) was partially misdiagnosed under the
   declaration-is-truth model (snapshots regenerate; the real need is
   a written format-stability policy). The meta-diagnosis — dense on
   production, holes in independent verification and the user-facing
   surface — was endorsed with the lead's own evidence (#361 as the
   pattern's prior instance).
2. Asked where the adopted items should live, the owner ruled: into
   the #282 gate — "0.2.0 slipping is fine." Eight issues filed
   (#372–#379).
3. The owner then set the orientation: "I prefer root-cause
   solutions." This issue (#372) was upgraded on that direction from
   three policy one-liners to a class-level fix.

## The class and the kill

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

## The non-mechanical remainder

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

## Gates

biome 415 clean · check-types 13/13 `Cached: 0` · test 14/14
`Cached: 0` · CRAP 0/1199 README unchanged · both diagnostic gates ok
with derived roots (126). No changeset: tooling/policy only.
