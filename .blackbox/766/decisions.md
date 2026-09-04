# Decisions — quickstart-now/hejbro#766

Every decision on this work item, appended as it is made: owner decisions (`D#`, English rewrites of the owner's words) and AI rulings (`R#`, with kind, basis and ratification). Managed by `blackbox add`; append-only.

<a id="r1"></a>
## R1 — D3: nesting refused under init-path-conflict; D3b: generate refuses a directory snapshot with snapshot-not-a-file

_lead · extension · basis D1 · 2026-09-04T13:07Z · ratified: pending_

D3 (#766) — option A: the nesting refusal lives in `init` next to `checkNoDuplicatePaths`, under the existing code `init-path-conflict` (equality and nesting are one relation: one code, one neighbourhood, the pinned code stays). Rule: a planned *file* artifact that is a proper ancestor of another planned path is refused (separator-stripped, `relative`-judged); a snapshot inside the migrations directory is legal, as measured. Wording from design.md.
D3b — option β, narrowly: `generate` refuses a snapshot path that is a directory with the new code `snapshot-not-a-file` (stat before read in `readSnapshotFileText`), one small task and one ADDED sub-requirement in cli-commands. The symmetric case (migrationsDir is a file → raw ENOTDIR from `readdirSync`) belongs to the raw-stack class of the next batch (#767) and is filed as its own issue.

