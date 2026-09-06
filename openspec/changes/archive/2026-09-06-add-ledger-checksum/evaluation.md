# D106 evaluation — add-ledger-checksum (round 1)

Context-free adversarial spec-only review of the delta at
`openspec/changes/add-ledger-checksum/specs/migration-apply/spec.md`
(4 MODIFIED requirements, 2 ADDED, 24 scenarios) against the built
public surface at dev `36dd132b`. Nothing under `proposal.md`,
`design.md`, `tasks.md`, `.blackbox/`, `packages/*/src`, `packages/*/test`,
PR/issue bodies or commit messages was read. The MODIFIED titles were
checked verbatim against the base spec's `### Requirement:` lines (all
four match).

## Method

- Worktree built with `pnpm install --frozen-lockfile && TURBO_FORCE=1 pnpm build --force`.
- Real server: `postgres:17-alpine` container `d106-lc-pg`, host port
  55700, started with `-c log_statement=all` so every statement the CLI
  sends could be read back from the server log.
- Real projects: `hejbro init` (prefixStrategy `index`) plus a three-step
  TypeScript declaration history, `hejbro generate` ×3, giving the chain
  `0001_add_app.sql`, `0002_alter_projects.sql`, `0003_add_tags.sql`.
  Every probe is a copy of that project (`/private/tmp/d106-lc/p*`)
  against its own database; boundary inputs (banner variants, line
  endings, an old 4-column ledger, RLS states, roles, foreign relations at
  the ledger's name) were constructed by hand on top of the CLI's own
  output. Expected checksums were computed independently from the delta's
  own banner/body definition (`awk` / Python `hashlib`), never from
  hejbro.
- Run counts: **133 CLI runs** (`init`/`generate`/`migrate`/`status`/
  `reset`/`raise`/`verify`/`baseline`/`history`), **82 psql queries**
  (ledger reads, DDL for boundary states, catalog checks), plus ~50
  `createdb`/`dropdb` and four server-log extracts.
- Constructed inputs are left under `/private/tmp/d106-lc/` (see
  `inputs/README.md` there) for the corpus.

## Blocking findings

None.

## Non-blocking findings

Ordered by how likely a user is to meet them; none contradicts a delta
sentence under its natural reading, but N1 and N2 sit close enough to
one that the lead should read them before archiving.

**N1 — Scenario "A line-ending change is not an edit": a *mixed* tree is refused by the chain walk, not by the checksum.**
Recorded `0001`/`0002` with LF; converted only `0001` to CRLF; `0003`
pending. `migrate` → `error[broken-chain] … does not verify at
0002_alter_projects.sql`, exit 2; `verify` → `broken-chain` at `0002`;
`status` → same, exit 1. The chain walk compares `0002`'s
`parent-snapshot:` line byte-for-byte against `0001`'s `snapshot:` line,
which now ends in `\r`. The delta's own claim holds in every checkout
git actually produces: whole tree CRLF (recorded LF) → checksums match,
`0003` applied, recorded checksum `a8a1d76f786e` identical to the LF
recording (pC4); recorded from CRLF files, then checked out LF → proceeds
(pC2). So "its checksum matches" is true; "the run proceeds" is true only
when the whole checkout shares one line ending. The refusal comes from a
sentence the delta does not touch (the chain walk's), so this is filed as
a neighbour; the scenario could say "checked out (as a tree)" or the
walk could trim `\r`. Side note: under `status` the broken-chain text
still reads "so nothing is applied … rerun `hejbro migrate`" — migrate's
sentence printed by a read-only command.
Inputs: `/private/tmp/d106-lc/inputs/mixed-crlf/`.

**N2 — Scenario "A raised database records the whole file's checksum": the whole file is hashed *after* line-ending normalization.**
`raise --file snapshot-crlf.sql` (the export re-encoded CRLF) recorded
`7e55389f…9764`, which is `sha256` of the LF-normalized text, not of the
file's bytes (`692045b7…c943`). For the LF file `generate --export`
writes, the row equals `shasum -a 256 snapshot.sql` exactly. The
requirement sentence ("the SHA-256 of the body with line endings
normalized, or of the whole file for a raised snapshot") admits both
readings; the scenario's "SHA-256 of the whole file" does not. Suggest
"of the whole file, line endings normalized the same way". No behaviour
rides on it: raised rows are never compared (verified: editing the
raised file changes nothing in `status`, and `migrate` over a raised
database reports `apply-failed` on the chain, never `body-changed`).

**N3 — `raise --file` with an absolute path is re-rooted under the working directory and dies with a raw stack trace.**
`hejbro raise --url … --file /private/tmp/d106-lc/pG/snapshot.sql` from
`/private/tmp/d106-lc/pG` → `Error: ENOENT … open
'/private/tmp/d106-lc/pG/private/tmp/d106-lc/pG/snapshot.sql'` with a
Node stack, exit 1. Outside this delta (the raise requirement predates
it) but it is the command the delta's scenario 22 exercises, and every
other path diagnostic in the CLI is coded.

**N4 — "blank" means empty: a whitespace-only separator line is body.**
`h14`: banner, then a line of three spaces, then the body → recorded
`6e3a5a104213` = sha256(`"   \n" + body`), not the original
`5fc0f18d4eb9`. So trailing whitespace accidentally saved on the blank
line after the banner is a "body change" (`migrate` exit 2). Consistent
with the delta's words if "blank" is read as "empty"; worth saying so.

**N5 — A file whose first line is not the `-- hejbro migration` literal is hashed whole.**
`h05` (first line removed, otherwise identical) → recorded
`6693cb328111` = sha256(whole file), although the delta's body rule
("everything from the first line that is neither blank nor `--`") would
give `5fc0f18d4eb9`. The delta's banner definition presupposes the
literal; `generate` always writes it, so only a hand-made file reaches
this. State the no-literal case explicitly (whole file, like a raised
snapshot) or leave as is.

**N6 — The final newline is part of the body.**
`h09` (trailing `\n` stripped) → `2b63e1d7b0d0` ≠ `5fc0f18d4eb9`, so an
editor that strips or appends the final newline triggers
`apply-migration-body-changed`. Exactly what "line endings normalized"
promises (a newline *style* change, not a newline count change); listed
because it is the likeliest accidental trigger after N4.

**N7 — A stored checksum that is not a hash is printed as-is, and the comparison is case-sensitive.**
Ledger `checksum` hand-set to `not-a-hash` → "(recorded not-a-hash, on
disk 5fc0f18d4eb9)"; to `''` → "(recorded , on disk …)"; to the upper-case
hex of the true value → refused as changed. Only a hand-edited ledger
reaches this; the "twelve hex digits" sentence describes hejbro's own
writes.

**N8 — A UTF-8 BOM at the start of a migration fails to apply.**
`h17` → `apply-failed … (42601): syntax error at or near "﻿"`. The file
is sent whole (banner included) as one statement, so the BOM reaches the
server. Pre-existing, outside the delta.

**N9 — Bare-`\r` line endings are not a "line ending" here.**
A recorded file re-encoded with `\r` only is no longer listed as a
migration at all → `apply-ledger-orphan-row` for its own name. The delta
says `\r\n`; classic-Mac endings are out of scope, noted for completeness.

**N10 — `migrate` with nothing pending still adds the checksum column to a pre-column ledger.**
Server log for that run: identity read, row read, then
`alter table "hejbro"."migration_ledger" add column if not exists
"checksum" text` — no row written. Consistent with "the bootstrap SHALL
add it" and "run once per apply run"; the sentence "the first command
that records a row … SHALL add the column before that write" is a lower
bound, not the only trigger. `status` and `reset` on the same ledger
leave it at four columns (verified).

**N11 — `reset` does not compare bodies.** An edited tip body is cleared
along with everything else (`reset … --confirm-drop n4:3` → exit 0, rows
0). The delta only binds `migrate` and `status`; fine for a destructive
command, recorded so the silence is deliberate.

**N12 — "forced" without "enabled" is refused too.** `force row level
security` with `relrowsecurity = f` filters nothing in Postgres, yet the
delta's "enabled or forced" makes it a refusal, and the text says "has
row-level security forced" — a true statement, a conservative choice.
Observation, not a defect.

**N13 — A `checksum` column of another type passes identity and fails at the write.**
`checksum integer` → `apply-ledger-unwritable … (22P02) invalid input
syntax for type integer`, naming the row being recorded and the rollback;
`status` on it reads fine. Consistent with "a column beyond those four
does not disqualify it"; the checksum column's type is not part of the
identity judgement.

Docs: `skills/hejbro/references/generate-verify-workflow.md` §"verify and
the checksum" and the `apply-ledger-filtered` / `apply-migration-body-changed`
paragraphs match measured wording (enabled / forced / enabled and forced;
"carries no policy at all"; every changed file named; twelve hex digits;
the remedy sentence). `.changeset/add-ledger-checksum.md` (`hejbro`
minor) describes exactly the four behaviours measured. README makes no
claim about the ledger or checksums (nothing stale).

## Scenarios verified

Legend: ✓ measured as stated · ✓* measured as stated, with a neighbour noted above.

| # | Scenario | Evidence (probe) |
|---|----------|------------------|
| 1 | Pending migrations are applied in chain order | pM1: ledger held 1–2 of 4; `migrate` applied 3 then 4; ids 1..4 in order ✓ |
| 2 | The bootstrap is idempotent | db a: `migrate` twice, second run "nothing to apply", 3 rows, no failure ✓ |
| 3 | An absent ledger and an empty ledger are told apart | m3: "no ledger table exists yet" vs "the ledger table exists and records no migrations yet" ✓ |
| 4 | The ledger is told from another relation at its name | m4: view (5 cols) / unlogged table / table missing `origin` / sequence each refused naming the kind in words, columns listed where carried, none for the sequence; a 6-column table (extra `note`) judged the ledger and written ✓ |
| 5 | migrate refuses a relation that is not the ledger before bootstrapping | m4: view → `apply-ledger-occupied` exit 2, unlogged → exit 2, relation untouched ✓ |
| 6 | A ledger the connected role may not read is reported in hejbro's own terms | m6: role `ro` without `select` / without schema `usage` → `apply-ledger-unreadable` naming ledger, role, 42501 + server message, `Next:` with both remedies; `status` exit 1, `migrate` exit 2; no stack ✓ (raise not re-run — carried scenario) |
| 7 | A ledger write the database refuses is attributed to the ledger | m7: `id` identity dropped → `apply-ledger-unwritable` naming ledger, role, "the row recording 0003…", 23502, rollback stated; `tags` absent, no row ✓ (reset/raise legs carried) |
| 8 | A failed migration leaves nothing behind | m8: `0002` body = create table + `select 1/0` → `first` absent, no row ✓ |
| 9 | A run stops at the first failing migration | m8: `0001` recorded, `0003` not applied, report names `0002` ✓ |
| 10 | The statements carry no parameters | server log s10: `BEGIN` · advisory lock · `statement: -- hejbro migration…` (simple query, whole file) · `execute <unnamed>: insert into … values ($1,$2,$3)` with the checksum as `$3` · `COMMIT` ✓ |
| 11 | The half that failed decides which artifact is named | m8 (`apply-failed` names the file) + m7 (`apply-ledger-unwritable` names the ledger and states the rollback), objects absent and no row after either ✓ |
| 12 | A baseline migration is recorded without being executed | pBL: `baseline` from a live DB, `migrate` → "registered 1 baseline migration(s) (statements not executed)", origin `registered`, checksum `3f11a2671ad3` = independent body hash; editing that body → `apply-migration-body-changed` on the next pending run ✓ |
| 13 | Pending migrations are reported without being applied | pB/pC: `status` lists recorded and pending buckets; ledger unchanged after ✓ |
| 14 | A disagreement is reported by status too | f1: orphan row → `apply-ledger-orphan-row`, `status` exit 1, `migrate` exit 2 (same code) ✓ |
| 15 | status refuses a relation that is not the ledger at the ledger's name | m4: view → `apply-ledger-occupied`, kind + columns, `Next:`, exit 1, no raw error ✓ |
| 16 | status reports a ledger it may not read | m6: `apply-ledger-unreadable`, ledger/role/code/message, `Next:`, exit 1 ✓ |
| 17 | A changed body is reported by status | pB: `error[apply-migration-body-changed]: 0001_add_app.sql … (recorded 5fc0f18d4eb9, on disk c130806aa889)`, exit 1, `0001` absent from the applied bucket ✓ |
| 18 | A disagreement is reported before bodies are compared | f1 (orphan + edited `0001`) → orphan alone; after deleting the orphan row → body-changed reported. f2 (out-of-order + edited) → `apply-ledger-out-of-order` alone ✓ |
| 19 | An edited applied body refuses the run before anything is sent | pB: statement appended to `0001`, `0003` pending → exit 2, both checksums 12 hex, `0003` not applied, `extra` absent, ledger unchanged. f3: two edited bodies → both named in one run ✓ |
| 20 | A line-ending change is not an edit | pC4 whole tree CRLF → proceeds, checksums equal; pC2 recorded from CRLF, checked out LF → proceeds ✓* (N1: a single CRLF file among LF trips the chain walk) |
| 21 | A row without a checksum is not compared | pD: 4-column ledger, edited `0001`, `status` → no column added, no comparison; `migrate` with `0003` pending → column added, old rows null, `0003` row `a8a1d76f786e`; `status` after → still not compared ✓. pD3: `reset` on a 4-column ledger clears without adding the column; the next `migrate` adds it before its first record ✓ |
| 22 | A raised database records the whole file's checksum | pG: LF export → row = `shasum -a 256` of the file; bannered file → whole file (not the body); raise onto an old empty 4-column ledger adds the column and records the whole-file hash ✓* (N2: CRLF file → normalized hash) |
| 23 | A run with nothing pending compares nothing | s23: `0002` edited, nothing pending → `migrate` exit 0 "nothing to apply"; `status` reports it (exit 1); after `generate` adds `0004` → `migrate` refuses with `apply-migration-body-changed`, `0004` not recorded ✓ |
| 24 | A ledger under forced row-level security is refused before it is read | e: forced + `hide_all` → `status` exit 1 / `migrate` exit 2 with `apply-ledger-filtered`, naming the ledger, role `postgres`, policy `"hide_all"`, `Next:` with both ways out; server log shows the identity read (carrying `relrowsecurity`/`relforcerowsecurity`) and the `pg_policies` read only — no `select … from "hejbro"."migration_ledger"`; rows intact; a clean run never sends the `pg_policies` statement ✓. Also measured: enabled-only/no policy (`it carries no policy at all, so every row may be hidden`), two policies listed in order, non-owner role named, `reset` and `raise` refused the same way, RLS disabled with policies left → passes ✓ |

Banner boundary corpus (`/private/tmp/d106-lc/banner-corpus/`, 18
variants of `0001`, each recorded on a fresh database and compared with
an independent hash of the delta's own definition): no blank line after
the banner, an extra `--` line at column 0, `--glued` without a space, a
banner comment edited, the `-- hejbro:` line — all hash to the original
body (`5fc0f18d4eb9`); an indented `  --`, a tab-indented `\t--`, a
`/* block */`, an inner `-- comment` plus blank line, a trailing `--`
line inside the body, trailing whitespace, a UTF-8 comment, no trailing
newline, a banner-only file (`e3b0c442…`, applied as an empty body) and
banner plus trailing blank lines (same) — all hash exactly as the
definition predicts. The four that do not are N1 (mixed CRLF), N4
(whitespace-only line), N5 (no literal) and N8 (BOM).

## Verdict

**ARCHIVE** — 0 blocking, 13 non-blocking (N1–N13). Every one of the
24 scenarios reproduced as written on a real Postgres 17 ledger; the
checksum boundary matches the delta's banner definition on every input
the definition actually covers, and the two places it is loose (a
whitespace-only "blank" line, a file without the banner literal) are
wording, not behaviour. N1 and N2 are the ones to read before deciding:
each is a sentence that holds under its natural reading and fails under
a literal one, and each fix is a clause, not a change.
