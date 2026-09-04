# Work — quickstart-now/hejbro#570

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — relicense-apache-2 — from MIT to the Apache License 2.0 (#570)

_2026-08-31T00:00Z_

(Taken from `git hash-object <path>` on the working tree before each
commit of this change and re-verified before the next; the blackbox file
itself is not pinned.
Pins die three ways — squash preserves them, an archive kills the
path, a concurrent same-file edit on dev kills the blob — so every
later commit re-verifies all of them. The nile package's LICENSE,
NOTICE, and manifest joined this change once #301 had merged, in the
commit that rebased the branch onto dev `72a99e93`.)




Lead-direct piece (no team; a one-shot reviewer at freeze, per the
cost-tiering rule for mechanical, documentation-shaped work). This
change is owner-driven in the direct sense: the owner, present in the
session, made the decision after asking for the background.

### What the decision rested on

D9 had chosen MIT for "widest adoption, genre norm" and listed
Apache-2.0 as the rejected alternative. Re-examined, the genre does not
have one norm: Drizzle, Prisma and the Supabase platform repository are
Apache-2.0; Kysely, TypeORM, supabase-js and Neon's serverless driver
are MIT. What Apache-2.0 adds is specific to a tool of this shape — a
compiler-like piece of infrastructure that presents its approach as
novel: an explicit patent license with a retaliation clause, and
contribution terms carried by the license itself for a project that
expects outside pull requests. Its costs (longer text, a `NOTICE`
obligation downstream, GPLv2 incompatibility) rarely bind a TypeScript
library. The owner chose the single license over the `MIT OR
Apache-2.0` pairing.

### What landed

- The verbatim Apache-2.0 text as `LICENSE` at the root and in each
  published package; a minimal `NOTICE` (`hejbro` / the copyright line /
  a pointer to `LICENSE`), added to every published package's `files` —
  npm packs `LICENSE` on its own but not `NOTICE`.
- `"license": "Apache-2.0"` (SPDX) in all seven package manifests,
  including the private `@hejbro/skills`.
- The pack-install smoke now asserts the Apache text in each installed
  `LICENSE` and packs `NOTICE` alongside it (assertions 1a and 1c).
- Prose: README, the CLI README, AGENTS.md, and the hejbro skill's
  frontmatter. OpenSpec's own skill files under `.claude/skills/` keep
  their `license: MIT` — that is OpenSpec's metadata, not ours.
- Decision log: D9 marked amended; D107 records the ruling and the
  reasoning. One `patch` changeset, so the next release — the pending
  0.2.0 — ships under Apache-2.0 while 0.1.x stays MIT.
- Not done, by decision: no per-file license headers (the appendix
  header is optional and the repository never carried per-file
  headers).

### Sequencing

Prepared on a branch off dev immediately; merged after #301
(`add-nile-preset`) so the seventh package's `LICENSE`, `NOTICE`,
manifest, and smoke line are covered in the same sweep instead of
breaking the nile branch's smoke in between. The rebase onto
`72a99e93` met two conflicts, both expected — the AGENTS.md sentence
that #301 had changed from "Nile planned" to "Nile shipped" and that
this change had changed from MIT to Apache-2.0, and the smoke's tarball
assertion block where #301 added the nile line and this change added
the NOTICE column — and was resolved by keeping both edits. The seven
packages then passed the smoke together. Two more files — README.md and the
skill index — had been edited by #301 as well and auto-merged without a
conflict, so their blobs moved silently; the pre-commit pin sweep caught
both and they were re-pinned. The first re-pin commit was made before
that sweep ran clean, which is the sweep's own rule broken once; the
commit gate now requires zero mismatches.

### The one-shot review

PASS with one optional MINOR, adopted: assertion 1c now also requires the
installed `NOTICE` to be non-empty — the file is a downstream Apache
obligation, and until then a zero-byte `NOTICE` would have passed every
assertion. The reviewer also caught a defect in the review brief itself:
the residual-`MIT` sweep was specified as `git grep -E '\bMIT\b'`, and
git's POSIX-ERE engine does not support `\b`, so that axis would have
passed vacuously; re-run with `-w` it found 27 hits on the base and 10 at
the head, all intended. Every factual claim in D107 was checked against
the registries rather than assumed.
The reviewer also disclosed that its first `npm pack --dry-run` ran the
packages' `prepack` build and rewrote the gitignored `dist/` before it
added `--ignore-scripts`; no tracked file or git state changed, and the
reported pack results come from the clean re-run.

### Method notes

Plain cycle, no OpenSpec proposal: nothing externally observable in
behavior changes — no API, SQL, CLI output, or file format. The
executable gates for this change are the pack-install smoke (tarball
contents and license text) and `changeset status` / `check:fixed-group`
(manifests); the rest is prose reviewed by eye and by a one-shot
reviewer at freeze.

Migrated from the single-file entry `.blackbox/2026-08-31-relicense-apache-2.md`, kept verbatim at `.blackbox/570/artifacts/2026-08-31-relicense-apache-2.md`.

