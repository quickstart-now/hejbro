# Work — quickstart-now/hejbro#846

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — Read side judges paths as init does; config artifact ancestors first; nesting wording; empty --config refused

_2026-09-04T22:28Z_

Read side judges paths as init does; config artifact ancestors first; nesting wording; empty --config refused

Built on `path-probe.ts`'s `probePath(cwd, leafPath)` (D2): walks ancestors first (a file, a dangling link, or a permission-blocked directory on the way is named as that node), then judges the leaf itself, including through a symbolic link. `init`'s own `checkAncestors` + `checkPathKind` were folded into one `checkArtifactPath` over `probePath`, run for the configuration artifact before the loader runs and for every planned artifact after — this is the fix for NB3 (`--config f/h.ts` with `f` a file used to name the non-existent leaf `f/h.ts` with a bare `ENOTDIR` instead of the ancestor `f`).

`snapshot-file.ts`'s `readSnapshotFileText` (NB2, NB6) and `listMigrationFiles` (see #820) now consume the same `probePath` outcome instead of their own `statSync`-only probes, so a dangling link at `snapshotPath`/`migrationsDir` is refused by name instead of being read as absent, and a file/link ancestor on the way is named instead of reported as an unrelated permissions failure.

`loader.ts` gained `configFlagFrom` (a trailing `--config` with no value, or `--config=`, is `""`, refused with `invalid-config-flag` before any path is resolved — NB8: this used to resolve silently to the working directory and refuse it as an existing "directory") and `resolveConfigPath`/`loadConfig` now judge the resolved configuration path with `probePath` before ever handing it to jiti, so a directory or a dangling link there is refused with `config-not-a-file`/`config-unreadable` naming the real node instead of surfacing as `config-load-failed` with a leaked absolute path (measured: `generate --config=` on dev 2b7fd901 produced `error[config-load-failed]: Cannot find module '/private/var/.../hejbro-cli-XXXXXX'`).

`init.ts`'s own refusal for the configuration artifact now opens with `"<path>" is the configuration path` (shared sentence with `loader.ts`'s exported `configNotAFileMessage`, different tail) instead of repeating the field's own name a second time; ancestor conflicts on the configuration artifact keep `init`'s existing sentence shape with the subject "the configuration file". `throwNestedPathConflict` (NB5) now states the held artifact's real kind ("a file cannot hold a file", not always "a file cannot hold a directory") and, when the configuration artifact is one of the two, names `--config` in its `Next:`.

Commits: d2de22f7, cdfdfc86, ee456592, e8126845, 47ea44d6, f4f46d24, 9dcf170f, d9b7624f.

Representative test cases (packages/cli/test): config.test.ts "refuses a snapshotPath whose spelling names a directory, naming the field"; init.test.ts "judges the --config path by its ancestors before its own node", "the configuration path's own messages"; generate-command.test.ts "the snapshot path judged as init does"; loader.test.ts "loadConfig / resolveConfigPath — --config names a file".

<a id="w2"></a>
## W2 — Review round 1: header identity, ancestor OS codes, next-marker gate, config subject on every init branch

_2026-09-05T00:09Z_

Review round 1: header identity, ancestor OS codes, next-marker gate, config subject on every init branch

Constructor review (a92dc54b) found 4 blocking + 3 non-blocking issues in the group 1 work; group 2 (tasks 2.1-2.4) repairs the four blocking findings the lead ruled in-scope (B1, B2/B3 as ratified in R5, B4) plus the two non-blocking wording findings (N1, N2). One finding (B3's own initial framing) was superseded mid-implementation by R5 — see the R4->R5 correction below, discovered and reported before any conflicting code was committed.

2.1 (B1, commit 73bafa39): `identity.ts`'s `ADJACENT_QUOTED_PAIR` regex (`"([^"]+)"\."([^"]+)"`) let a "pair" span whitespace and parentheses. For a message quoting a lone "." value (`config field "snapshotPath" names a directory (".")...`), the field name's own closing quote and the "."'s closing quote were close enough (through "names a directory (") that the regex paired them, and `identityFromMessage` returned the prose fragment between them as the header instead of "snapshotPath" -- reproduced on 6 of 9 commands. Tightened to `[^"\s()]+` so a group is two bare identifiers only; a pre-existing "a b"."c"" edge case (a quoted group containing a space) no longer pairs either, pinned as an accepted fact, not a requirement.

2.2 (B2/B3, commit fe6ce4e5): two related but distinct corrections, discovered in sequence.
- First attempt (reverted before commit, never shipped): added the operating-system code to the three ancestor-file/ancestor-dangling sentences (migrationsDir and snapshotPath in snapshot-file.ts, the configuration path in loader.ts), per the initial review framing. Implemented, tested, and about to be committed when a concurrent tasks.md/design.md update (lead ruling R4->R5, recorded while this was in flight) reversed the direction: an ancestor that is a file or a dangling link is a judgement of kind, not an operating-system refusal, so it carries no code on any side (read side or init) -- the code belongs only to a genuine OS-refused look-up (permission, loop, listing failure). Caught before commit; the four touched files (loader.ts, snapshot-file.ts, generate-command.test.ts, loader.test.ts) were reverted via `git checkout` and the discrepancy reported before continuing.
- What actually shipped: `config-not-found`'s `Next:` now echoes the `--config` value the user typed, verbatim, from any working directory and whether the value is relative (with `./`/`../` kept exactly as spelled) or absolute -- D57's "never an absolute path" rule protects a path hejbro discovered on the machine, not a value the user handed back to themselves; the header and the "found at" body clause stay cwd-relative like every other report line, so an absolute `--config` value is the one documented place an absolute path may appear in a diagnostic, and only in `Next:`.

2.3 (B4, commit c5b5e917): `check:next-marker` flagged `init.ts:448`/`:468` (the configuration artifact's directory and dangling-link refusals, both composed via `loader.ts`'s exported `configNotAFileMessage`) as carrying no `Next:` -- the scanner resolves a message argument that's a bare function call by looking for that function's declaration in the *same file*, and `configNotAFileMessage` is declared in `loader.ts`, not `init.ts`. Fix: the shared builders (`configNotAFileMessage`, `configUnreadableMessage`) now return `{ reason, next }` instead of one pre-joined string; every throw site, in both `loader.ts` and `init.ts`, composes its own literal `` `${reason} Next: ${next} ${tail}` `` at the call site -- so the scanner sees a literal "Next:" in the file it's scanning regardless of which file built the pieces. Rendered output is byte-unchanged (the 1.6 parity pins and the full regression suite are the guard); the gate now passes with zero exemption-list entries added.

2.4 (N1/N2, commit cab81325): two wording repairs, both non-blocking findings from the same review.
- N1: `throwNotWritable`/`throwCreateDiskFailed` (the write-permission and create-failure branches) took the artifact's raw `fieldName` the way `throwStatFailed` used to before 1.6 -- for the configuration artifact this produced `"hejbro.config.ts" cannot be created for hejbro.config.ts (EACCES): ...`, the label's own name doubled, and it named the literal default field even when `--config` pointed elsewhere. Both now take a `writeSubjectClauseFor(artifact)` clause: `"for ${fieldName}"` unchanged for `migrationsDir`/`snapshotPath`, `"as the configuration file"` for the configuration artifact.
- N2: `invalid-config-flag`'s message ("--config was given an empty value...") had no quoted substring at all, so `identityFromMessage` fell through to the caller's own fallback identity instead of "--config" -- the header varied by command instead of reading `error[invalid-config-flag]: --config` everywhere. Fixed by quoting the flag name at the start of the message.

Representative test cases (packages/cli/test): identity.test.ts "does not read a quoted dot between two quoted words as a schema.table pair"; generate-command.test.ts "snapshotPath: \".\" reports a clean header on every command", "echoes an absolute --config value verbatim in Next:", "reports error[invalid-config-flag]: --config as the header"; loader.test.ts "config-not-found echoes --config as typed in Next:"; init.test.ts "names the configuration path once on the write-permission and create-failure branches".

Gates: `pnpm build --force`, `pnpm check`, `pnpm check-types`, `pnpm test` (1132+ tests), `pnpm check:bans`, `pnpm check:next-marker` (now green with zero new exemptions) all pass under `TURBO_FORCE=1` in the worktree.

