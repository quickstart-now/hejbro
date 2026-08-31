Refs:
- .changeset/relicense-apache-2.md @ blob f0064149fa58e742713e50e2af40a0ca73dd9efd
- AGENTS.md @ blob 56a81a76372627805f15144b4e737e2620bdcf2a
- docs/specs/2026-08-19-hejbro-design.md @ blob 71767bcfcbd48f54062dbdf7544159084afbeb12
- LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/cli/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/cli/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/cli/package.json @ blob 4f84ccaf921869c817b9db9b646a80c631aed856
- packages/cli/README.md @ blob 5a21e68ac0594eb505ca711defda610974794d46
- packages/core/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/core/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/core/package.json @ blob 0d009e903cf2094c848389fbdf8eaa81b224828d
- packages/neon/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/neon/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/neon/package.json @ blob 450b6f32b648512624ce487fd9eb48a463ca64e2
- packages/pg/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/pg/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/pg/package.json @ blob 3ecaea36cfb331dac097a38a65367dd04acf8599
- packages/query/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/query/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/query/package.json @ blob 3923fe283dc541b8c366af00ac5ec22d54ebcd16
- packages/skills/package.json @ blob caaec7d51f97b9a6754d361a2efb46c490ab98f7
- packages/supabase/LICENSE @ blob d645695673349e3947e8e5ae42332d0ac3164cd7
- packages/supabase/NOTICE @ blob 9066b7c4d796cc6261529dfd6feca8e55ff06c20
- packages/supabase/package.json @ blob f188eedee7d6ca76364eb15d07e2f6c34beefe64
- README.md @ blob 5829a09f0647e91151277e0b29ea3a4985d3b4b3
- scripts/pack-install-smoke.sh @ blob d4e771ec5a3e1680e7d53826f268e08c96dbf9f7
- skills/hejbro/SKILL.md @ blob 295788626e38adc8f2d4d208a991b55a51f427ec

(Taken from `git hash-object <path>` on the working tree before the
single commit of this change; the blackbox file itself is not pinned.
Pins die three ways — squash preserves them, an archive kills the
path, a concurrent same-file edit on dev kills the blob — so every
later commit re-verifies all of them. The nile package's LICENSE,
NOTICE, and manifest join this change after #301 merges and are
pinned when that commit lands.)


# relicense-apache-2 — from MIT to the Apache License 2.0 (#570)

Lead-direct piece (no team; a one-shot reviewer at freeze, per the
cost-tiering rule for mechanical, documentation-shaped work). This
change is owner-driven in the direct sense: the owner, present in the
session, made the decision after asking for the background.

## Owner inputs (English rewrites)

1. "Add a work item to #282: change the license to the Apache License."
   (2026-08-31, in session) — filed as #570 with the measured inventory,
   defaults, and sequencing.
2. "Sorry — first explain the difference between MIT and Apache."
   — answered with the six practical differences (patent grant and
   retaliation, contribution terms in §5, NOTICE and modification
   notices, trademark, GPLv2 incompatibility, length), the project-side
   considerations, the dual-license alternative, and one measured fact:
   every commit on dev has a single human author, so relicensing needs
   no third-party consent.
3. "Let's go with Apache. Proceed with #570 as filed."

## What the decision rested on

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

## What landed

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

## Sequencing

Prepared on a branch off dev immediately; merged after #301
(`add-nile-preset`) so the seventh package's `LICENSE`, `NOTICE`,
manifest, and smoke line are covered in the same sweep instead of
breaking the nile branch's smoke in between.

## Method notes

Plain cycle, no OpenSpec proposal: nothing externally observable in
behavior changes — no API, SQL, CLI output, or file format. The
executable gates for this change are the pack-install smoke (tarball
contents and license text) and `changeset status` / `check:fixed-group`
(manifests); the rest is prose reviewed by eye and by a one-shot
reviewer at freeze.
