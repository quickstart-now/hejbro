Refs:
- package.json @ blob 081e5cea17d627e39c5d9f0edc801996877dd84c
- scripts/crap-gate.mjs @ blob 074fb850bc284e58dc7a59c2e685493fb59c377a
- scripts/update-crap-readme.mjs @ blob c18b5789115ea964b5ec55a52f9f2e47a8a398b5

# fix-crap-gate — check:crap forwards its flags and gains --check (#336)

Plain-cycle tooling fix (root scripts only, no published package
touched, no changeset), executed by the lead session directly in
worktree `fix-crap-gate` off dev `ce43ab5`. First item of the
post-harden defect queue for the 0.2.0 gate.

## Owner inputs (English rewrites)

1. The owner asked whether the residual defect group of the #282 gate
   should be processed in the order #341 → #342 → #336/#337/#339.
2. The assistant answered that the only hard dependency in that set is
   #341 before #342 (stated in #341's own body; both harden groups have
   landed, so both are unblocked), that #336/#337/#339 are mutually
   independent and file-disjoint from the rest, and recommended pulling
   #336 to the front: a minutes-scale script fix whose effect — gate
   fidelity — benefits every subsequent piece's review runs, where the
   `TURBO_FORCE=1` form is only an effect-level workaround.
3. The owner approved: proceed as proposed.

## The defect and the fix

Root cause of the `--force` loss: pnpm appends extra CLI args to the
*last* command of a package.json `&&` chain. `check:crap` was a
three-command chain, so `pnpm check:crap --force` handed the flag to
`check-crap.mjs` (which ignores it) and the turbo invocation — the one
place it matters — never saw it. The fix replaces the chain with
`scripts/crap-gate.mjs`, which owns the sequence and forwards every
flag verbatim to `pnpm exec turbo run test:coverage`, consuming only
`--check` for itself.

The issue thread's second measured fact (hg2 verdict, 2026-08-27) —
merely running the gate rewrites README.md, which collides with
frozen-SHA review procedure — was folded into the same change as the
invited `--check` mode: `update-crap-readme.mjs --check` prints the
would-be block without writing, and the write path stays the default
because CI's `git diff --exit-code README.md` and the done-checklist
refresh depend on it. Folding it here (rather than filing a follow-up)
keeps the #282 gate from growing and honors the no-orphan-follow-ups
rule; the scope extension is stated in the PR for the owner's veto.

## Evidence shape

No committed unit test: the repo's `scripts/*.mjs` have no test
harness, and building one that spawns the full coverage suite to
observe a turbo summary line would dwarf the fix. Red/green were
instead live reproductions of the gate command itself, recorded
before/after:

- RED (--force): warm isolated cache (`TURBO_CACHE_DIR=$PWD/.turbo/
  cache-336`), `pnpm check:crap --force` → `Cached: 4 cached, 9 total`
  — the exact shape hg1's baseline reported (the 4 hits are the build
  dependencies; the 5 coverage tasks are `cache: false` by design).
- RED (--check): doctored the README block's violation count, ran
  `update-crap-readme.mjs --check` on pre-fix code → flag ignored,
  README rewritten, drift erased, sha restamped — the reviewer's
  incident reproduced on demand.
- GREEN: same warm cache, `pnpm check:crap --force` → `Cached: 0
  cached, 9 total`; doctored README + `--check` → "STALE (--check: not
  written)" with the would-be block printed and the doctored bytes
  intact; end-to-end `pnpm check:crap --check` on a clean tree →
  "current (--check: no write needed)", `git status` clean.
- Gates: biome 407 files clean · check-types 13/13 `Cached: 0` · test
  14/14 `Cached: 0` · crap 0/1182, README block unchanged.
