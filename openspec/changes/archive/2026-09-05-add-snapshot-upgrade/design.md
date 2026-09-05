# Design: add-snapshot-upgrade

Open decisions, each as background → options → ruling. Settled by the
lead under the owner's full delegation for this pass and recorded as
rulings on the change's issue; the settled answer is what the delta
specs state.

## Q1 — What "reading an older format" means

**Background.** Every format change since the first release was
additive or an ordering canonicalization: 5→6 added optional
`generated`/`identity` column fields; 6→7 fixed the foreign-key order
to a declaration-form-independent canonical order; 7→8 added `offset`
and `distinct` to a stored select, and the in-place additions since
(`groupBy`/`having`, the window and `with` node kinds) decode absence as
the empty value. The current decoder already reads those shapes
leniently; only the version gate stops it.

- (i) One decoder per released version (a v5 reader, a v6 reader, …).
- (ii) The current decoder's lenient rules plus the canonical form,
  gated by a floor (5): read, canonicalize, render.
- **Ruling (ii).** Per-version decoders would restate shapes the
  lenient rules already cover, and would have to be written for every
  future bump on the day of the bump. The rule that pays for future
  bumps is: a format change is either additive (absence decodes to the
  empty value) or a canonicalization (the canonical form absorbs it);
  a change that is neither gets its own step in the re-encoding, which
  is where a future change's own tasks land. Whether the current rules
  cover every released shape is **measured, not assumed** (task 1.1's
  input table is the 0.1.1 release's own twelve format-5 snapshots); a
  field the current shape requires that an older shape lacks and that
  cannot be derived the way the writer derives it is a tripwire.

**Oracle.** The strongest oracle is the writer itself: for a golden
case whose declarations are unchanged since 0.1.1, re-encoding the
tag's format-5 expected snapshot must equal the current expected
snapshot byte for byte. Task 1.1 measures which cases qualify (the
declarations file at the tag versus today's); the remaining cases and
the two example snapshots are held to idempotence (re-encoding twice
equals once), identity on a current-format file, and every object key
surviving with its kind. The re-encoded fixtures are committed as
reviewed goldens.

## Q2 — Where the upgrade runs: a command, or inside `generate`?

- (i) `generate` upgrades silently when it meets an older format.
- (ii) An explicit `hejbro upgrade`; every other command keeps refusing
  the older format, and the refusal names the command.
- **Ruling (ii).** The step rewrites a committed migration file's
  banner — a change a user must see in their diff and commit knowingly,
  not a side effect of generating something else. It also keeps
  `generate` byte-identical in what it does today.

## Q3 — Re-chaining the tip

**Background.** The tip's `-- snapshot:` line is the sha256 of the
snapshot file's bytes; `verify`'s first check compares them
byte-exactly. Every earlier migration's hashes name historical
snapshots that live only in git blobs, and `verify`'s chain check
compares the lines between files without re-hashing anything — so only
the tip is bound to the file on disk.

- The command rewrites the tip's `-- snapshot:` value to the new hash
  and adds `-- upgraded-from: <old hash>` directly under it. Nothing
  else in the file moves; the `parent-snapshot` line stays, so the chain
  before the tip is untouched.
- Precondition, checked before any write: the tip's recorded hash
  equals the hash of the snapshot as stored. Otherwise the chain is
  already broken, and the command refuses with `verify`'s own
  `chain-tip-mismatch` code and guidance — upgrading over a broken chain
  would hide the break.
- A file that carries `-- upgraded-from:` already and is upgraded again
  (a second bump later) keeps one line, the original hash: the commit
  that added the file has the original bytes, and that is what
  `history` needs.

## Q4 — `history` and `restore` after an upgrade

- `history` resolves a migration's state by hashing the snapshot blob
  at the commit that added the file and comparing with the banner's
  current hash. After an upgrade that blob is the old format, so it
  matches the `-- upgraded-from:` hash instead: `history` compares
  against both and reports `ok`.
- `restore` rebuilds the snapshot from the declarations at the
  candidate commit **under the current hejbro** and compares the
  rendered bytes with the banner's current hash — after the upgrade that
  is the new hash, and the rebuild renders the current format. The
  rebuild is not declarations alone, though: D81 has it parse that
  commit's own stored snapshot as the parent, so an old-format blob
  stops the comparison before it runs. When the tip's banner carries
  `upgraded-from`, that blob is re-encoded through `upgradeSnapshot` in
  memory (no file is written) and used as the parent; when it does not,
  the existing format guard and its note stay. The trigger is the
  presence of `upgraded-from`, never the format alone — a migration that
  was never upgraded has a banner hash in the old format, and rebuilding
  it under the current one would report drift that is not there.
  Measured in task 1.5, not assumed.

## Q5 — The command's surface

- `hejbro upgrade`, no flags. Reads `snapshotPath` and `migrationsDir`
  from the configuration (`--config` honoured like every command).
- Output on success: one line per file written (`upgraded <snapshot>:
  format 5 → 8`, `re-chained <tip file>`); on a current-format
  snapshot: `snapshot is already at format 8`, exit 0; with no
  migrations: the snapshot line only.
- Refusals reuse existing codes: `unsupported-snapshot-version` for a
  newer format or one below the floor, `chain-tip-mismatch` for the
  precondition, `snapshot-lost` when migrations exist and no snapshot
  does.

## Q6 — The decision log

D101 already states that the upgrade path supersedes its "no command
exists" sentence once it ships. The row is amended to record the
shipped shape (lead, under delegation; surfaced to the owner on
return).

## Q7 — Every advertised command against a real format-5 project (1.8, B1)

Measured, not sampled: every one of the 17 subcommands `hejbro --help`
lists, run against `packages/cli/test/fixtures/project-0.1.1/commit-3/`
(the 0.1.1 tag's own real, committed format-5 project) vendored into a
fresh git repository, plus a throwaway `postgres:17` container for the
commands that need one (removed after measuring; no other team's
container touched). Baseline reason: R5's B1 finding — the review's own
delta scenario claimed `generate`, `verify`, `status` and `history` all
refuse a format-5 snapshot, but a real run shows `status` and `history`
exit 0 (neither ever parses the snapshot's content).

| command | reads the snapshot? | exit | names `upgrade`? | files/state changed |
|---|---|---|---|---|
| `init` | no (only checks existence) | 0 | — | 0 (every target already existed) |
| `import` | no | 1 (`import-nothing-to-infer`, empty test schema — unrelated) | no | 0 |
| `pull` | no | 0 | — | writes `.hejbro/`, `hejbro.lock` (its own destination, never this project's snapshot) |
| `baseline` | yes | 1 (`unsupported-snapshot-version`) | **yes** | 0 |
| `generate` | yes | 1 (`unsupported-snapshot-version`) | **yes** | 0 |
| `verify` | yes | 1 (`unsupported-snapshot-version`) | **yes** | 0 |
| `check` | yes | 1 (`unsupported-snapshot-version`) | **yes** | 0 |
| `history` | no (reads git blobs' hashes only, never parses content) | 0 | no | 0 |
| `restore` | yes, but only after a hash match | 0 for the tip (7); 1 for a squashed migration (1, `restore-state-lost` — unrelated) | no (a plain note: "generated under an older snapshot format ... review the diff manually", no code, no `Next:`) | stages the declaration file only |
| `migrate` | no (applies migration SQL files directly, never the snapshot) | 1 (`apply-failed`, a missing role in the throwaway database — unrelated) | no | 0 (the failed statement's own transaction rolled back) |
| `status` | no (reads the ledger and the migration file list only) | 0 | — | 0 |
| `reset` | yes | 1 (`unsupported-snapshot-version`) | **yes** | 0 |
| `upgrade` | yes (that is its job) | 0 | — (it *is* the upgrade) | 2 (snapshot + tip migration) |
| `raise` | no (applies a separately-vendored SQL file named by `--file`, never this project's snapshot) | 0 | — | 0 repo files (writes the ledger row only) |
| `link` | no | 0 | — | 1 (`hejbro.json`) |
| `vendor` | no | 1 (`vendor-export-missing`, no linked source exports one — unrelated) | no | 0 |
| `outdated` | no | 1 (`vendor-not-yet-vendored` — unrelated) | no | 0 |

No command refuses for being an older released format without naming
`hejbro upgrade` as the next step — the conditional the corrected delta
scenario states holds over the full command surface, not a sample of
it. Four commands refuse this way: `generate`, `verify`, `check`,
`reset` (and `baseline`, which shares `generate`'s read path) — a fifth
member the original, uncorrected scenario never named. `history`,
`status`, `init`, `import`, `pull`, `migrate`, `raise`, `link`,
`vendor` and `outdated` never parse this project's own snapshot content
at all, so the conditional never applies to them; `restore` sits
between the two groups (reads the snapshot's *bytes* to check a hash,
never its *content*, so it can verify a tip without decoding a format
it doesn't understand) and reports the mismatch as an advisory note
rather than a refusal.
