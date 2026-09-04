# Evaluation — harden-init-paths

Adversarial spec-only review (D106). Context-free: the delta scenarios and
the public surface they name were the only inputs; every input below was
constructed by the reviewer and run against the built CLI.

## Round 1

### Verdict

BLOCKING 0 / NON-BLOCKING 8 / OK 13

Every delta scenario's shipped behaviour matches its text. The eight
non-blocking findings are over-claims, a missing observer, misleading
wording, and neighbour inputs the scenarios leave unspecified — three of
them (NB2, NB3, NB6) are cases where two commands still answer one broken
layout two different ways, which is the class of defect this change exists
to end.

Stderr sweep over 63 failing runs: **0** absolute paths, **0** stack
frames, **0** uncoded `Error:` lines. The only non-`error[...]` stderr
lines were `verify`'s own `skipped:`/summary lines.

### Blocking

None.

### Non-blocking

**NB1 — the "honoured as spelled" sentence over-claims for `snapshotPath`.**
`openspec/changes/harden-init-paths/specs/cli-commands/spec.md:16`

> "A relative value SHALL be honoured as spelled, including a leading
> `./`, a trailing separator, and a `..` that leaves the working
> directory."

Universal over both fields, but a trailing separator on `snapshotPath` is
refused — by the *same delta's* MODIFIED init requirement (spec.md:110,
"A path a configuration spells as a directory SHALL be refused the same
way when the artifact is a file"). The scenario at spec.md:27 only
exercises `migrationsDir`, so the scenario is sound; the requirement
sentence above it is not.

```
# hejbro.config.ts: migrationsDir: "migrations", snapshotPath: "state.json/"
$ hejbro init
error[init-path-conflict]: state.json/
  "state.json/" names a directory (a trailing "/"), but snapshotPath needs a file.
  Next: drop the trailing slash from snapshotPath in hejbro.config.ts, or point it at a file path.
```

Fix: qualify the sentence ("...a trailing separator on a directory
field...") or point it at the init requirement.

---

**NB2 — the read side answers a trailing-separator `snapshotPath` with the
wrong remedy, and disagrees with `init` about the same configuration.**
`packages/cli/src/snapshot-file.ts:94-124`

`snapshotFsOutcome` stats the *stripped* path (line 95-96) and finds a
regular file, then `readFileSync` on line 117 uses the *unstripped*
`snapshotFsPath` — which can never succeed for a file — and the ENOTDIR is
relabelled as a permission problem.

```
# hejbro.config.ts: snapshotPath: "state.json/"; a regular file at state.json
$ hejbro generate
error[snapshot-unreadable]: state.json/
  "state.json/" is named by snapshotPath, but this process cannot read it (ENOTDIR).
  Next: check permissions on "state.json/", then rerun.

$ hejbro init      # same configuration, same tree
error[init-path-conflict]: state.json/
  "state.json/" names a directory (a trailing "/"), but snapshotPath needs a file.
  Next: drop the trailing slash from snapshotPath in hejbro.config.ts, or point it at a file path.
```

The letter of the ADDED requirement (spec.md:39-49) is met — coded, names
the configured path and the OS code, has a `Next:` — so this is not
blocking. But the `Next:` is unactionable (permissions are fine) and the
two commands give one file two answers. The requirement's own closing
sentence ("the read side SHALL say so in the same terms rather than fail
inside a read that was never going to succeed") is exactly what does not
happen here; it is scoped to a directory, so no scenario is contradicted.

---

**NB3 — a *file* ancestor on the `--config` path is named by the leaf, not
by the file that blocks it.** `packages/cli/src/commands/init.ts:846`

`checkPathKind(cwd, configArtifact)` runs at line 846, before the
`plannedArtifacts.forEach` that runs `checkAncestors` (line 881-884), so
the config artifact never reaches the ancestor walk when its own `lstat`
already fails ENOTDIR.

```
$ touch f
$ hejbro init --config f/h.ts
error[init-path-conflict]: f/h.ts
  "f/h.ts" could not be checked for hejbro.config.ts (ENOTDIR).
  Next: check what "f/h.ts" points at, then rerun `hejbro init`.

# same tree shape, migrationsDir: "f/mig"
$ hejbro init
error[init-path-conflict]: f
  "f" was expected to be a directory to hold migrationsDir, but a file is there.
  Next: move or remove the existing file at "f", then rerun `hejbro init`.
```

The `Next:` names `f/h.ts`, a path that does not exist — structurally the
defect the change fixes for permissions (#768: *"its `Next:` says check
permissions on `nx/mig/` — a path that does not exist"*), reintroduced on
this change's own new `--config` surface. Not blocking because two
requirement sentences both apply and neither is given priority: "The same
refusal SHALL cover a path an artifact would have to be created inside"
(spec.md:106) vs "A failure for any other reason SHALL name the path whose
inspection failed" (spec.md:148). A dangling-link ancestor on the same
flag *does* get the good message (`lstat` returns ENOENT there, so the
walk runs) — the inconsistency is invisible from the spec text.

Fix: say which rule wins, or move the config artifact's early kind check
behind its ancestor walk.

---

**NB4 — "message and `Next:` line name `nx` — not `nx/a`, not `nx/a/mig`"
is literally false of shipped output.**
`openspec/changes/harden-init-paths/specs/cli-commands/spec.md:278`

```
$ mkdir -p nx/a && chmod 000 nx      # migrationsDir: "nx/a/mig"
$ hejbro init
error[init-path-conflict]: nx/a/mig/
  "nx/a/mig/" could not be checked for migrationsDir (EACCES): "nx" does not let this
  process look inside it. Next: check permissions on "nx", then rerun `hejbro init`.
```

The intent — the node the user must act on is `nx` — is met in both the
message and the `Next:`. But the message also carries `nx/a/mig/` as the
artifact label, so a future reader who tests the sentence as written
(`expect(stderr).not.toContain("nx/a/mig")`) would judge shipped behaviour
wrong. Reword to "names `nx` as the directory to act on — never `nx/a` or
`nx/a/mig`".

---

**NB5 — the nesting refusal is generalized past its claim, and its fixed
wording then misstates the fault.** `packages/cli/src/commands/init.ts:195-205`

The delta scopes the check to "a planned snapshot file [that] would have
to hold another planned artifact — the migrations directory" (spec.md:107-113).
Shipped `checkNoNestedPaths` runs over every artifact pair, config file
included, with a hardcoded "— a file cannot hold a directory":

```
# hejbro.config.ts: snapshotPath: "hejbro.config.ts/s.json"
$ hejbro init
error[init-path-conflict]: hejbro.config.ts
  "hejbro.config.ts" is named by hejbro.config.ts, and snapshotPath ("hejbro.config.ts/s.json")
  would have to be created inside it — a file cannot hold a directory.
  Next: point hejbro.config.ts at a file outside snapshotPath, then rerun `hejbro init`.
```

Two problems the delta never had to answer because it never claimed this
input: the held artifact is a *file*, so "a file cannot hold a directory"
is wrong; and "point hejbro.config.ts at a file outside snapshotPath" is
unactionable — the configuration file's own path comes from `--config` or
the default, not from a field the user can edit in the file. The
generalization itself is welcome; the delta should name it and the wording
should follow the held artifact's kind.

---

**NB6 — a dangling link at `snapshotPath` sends the read side's user to a
command that refuses.** `packages/cli/src/snapshot-file.ts:25-39`

`snapshotFsOutcome` uses `statSync` only, so a dangling link reads as
absent:

```
$ ln -s nowhere state.json     # snapshotPath: "state.json"
$ hejbro generate
error[snapshot-not-found]: state.json
  ... Next: run `hejbro init` to scaffold an empty snapshot ...

$ hejbro init                   # the command it just recommended
error[init-path-conflict]: state.json
  "state.json" was expected to be a file for snapshotPath, but a dangling symbolic
  link is there, pointing at "nowhere". ...
```

The change taught `init` to judge a link by its target (spec.md:97-104);
the ADDED read-side requirement (spec.md:39-49) names only "a directory"
and "a file the process cannot read", so the read side keeps the old
`statSync`-only view. Missing observer: the read-side requirement should
say what it does with a link, given the sibling requirement now judges one.

---

**NB7 — a link's absolute target is silently re-rooted in the refusal.**
`packages/cli/src/path-probe.ts:32-38`

```
$ ln -s /private/tmp/d106-ip-nonexistent-target state.json
$ hejbro init
error[init-path-conflict]: state.json
  "state.json" was expected to be a file for snapshotPath, but a dangling symbolic
  link is there, pointing at "../d106-ip-nonexistent-target". ...
```

`ls -l` shows `/private/tmp/d106-ip-nonexistent-target`; the diagnostic
shows `../d106-ip-nonexistent-target`. This is the deliberate D57
no-absolute-paths rule, and it is the right call, but the scenario
(spec.md:295-302) says only "the target the link points at" — a reader
would expect the link's literal text. Say that an absolute target is
printed relative to the working directory.

---

**NB8 (minor) — `--config=` with an empty value refuses by telling the user
to delete the working directory.** `packages/cli/src/loader.ts:84-95`

```
$ hejbro init --config=
error[init-path-conflict]: ./
  "./" was expected to be a file for hejbro.config.ts, but a directory is there.
  Next: move or remove the existing directory at ".", then rerun `hejbro init`.
```

`resolveConfigPath` resolves `""` to `cwd`. Degenerate input, coded, no
absolute path, nothing created — but the `Next:` is destructive advice.
The `--config` paragraph (spec.md:84-95) says nothing about an empty
value. A neighbour worth one sentence, or an empty-value refusal of its
own.

### Verified scenarios

| Scenario | Verdict | What was run |
|---|---|---|
| An absolute-looking configured path is refused by every command | OK | `migrationsDir: "/db/migrations"`, `snapshotPath: "/state.json"`, `migrationsDir: "//x/mig"` — each refused `invalid-config` naming the field, by `init`, `generate`, `verify`, `check`, `baseline`, `history`, `status`; refused runs created nothing. Non-separator lookalikes (`C:\x`, `~/x`) are honoured as relative, which matches the requirement's "begins with a path separator" and creates nothing outside the project (a literal `~` directory under cwd). |
| A relative configured path is honoured as spelled | OK (see NB1) | `migrationsDir` = `./db/migrations`, `db/migrations/`, `a//b/mig`, `a/`, `../out/migrations` — all created at the spelled location, exit 0; `snapshotPath` = `./db/state.json`, `../up/state.json` likewise. |
| A directory at the snapshot path is refused with its own code | OK | Directory at `state.json` → `snapshot-not-a-file` from `generate`, `verify`, `check`, `baseline`; no raw `EISDIR`. A directory with mode 000 is still refused *as a directory* (kind decided first). A symlink→directory is refused the same way. With a pre-existing `migrations/0001_bad.sql`, that file is neither read nor rewritten. |
| A snapshot file the process cannot read is refused with its own code | OK | `chmod 000 state.json` → `snapshot-unreadable` naming `state.json` and `EACCES` with a `Next:`, from all four commands; no absolute path, no raw error. |
| A snapshot path that cannot be inspected names the directory that blocks it | OK | `snapshotPath: "parent/state.json"`, `chmod 000 parent` → `snapshot-unreadable ... (EACCES): "parent" does not let this process look inside it. Next: check permissions on "parent"` from all four commands; `hejbro init` on the same tree names `parent` too (same-terms parity confirmed). |
| The configuration named by `--config` is the one read | OK | `init --config sub/hejbro.config.ts` (config + declarations under `sub/`, naming `db/migrations`/`db/state.json`) → `skipped sub/hejbro.config.ts (exists)`, `created db/migrations/`, `created db/state.json`; nothing under `sub/`, nothing at the defaults. `generate --config sub/hejbro.config.ts` then wrote `db/migrations/0001_add_app.sql` and updated `db/state.json`. Parity re-run from a *sub*directory with `--config ../shared.config.ts`: both commands acted on `work/db/**`. |
| The configuration named by `--config` is the one written | OK | `init --config sub/hejbro.config.ts` on an empty project → `created sub/hejbro.config.ts` (parent created), defaults at `migrations/` + `hejbro.snapshot.json`, no `hejbro.config.ts` beside them. Also verified: `--config=sub/x.config.ts`, an absolute `--config` inside cwd, `--config ../shared.config.ts` (reported `created ../shared.config.ts`), an absolute `--config` outside cwd (reported `../d106-ip-cfgoutside/h.config.ts` — relative, never absolute), and `--config` given twice (last wins). |
| A snapshot path that would have to hold the migrations directory is refused | OK | `snapshotPath`/`migrationsDir` = `mig`/`mig/sub`, `mig/`/`mig/sub`, `./mig`/`./mig/sub`, `mig`/`mig/a/b/c/deep`, `../shared`/`../shared/mig` — every one `init-path-conflict` naming both fields, nothing created, no `skipped mig (exists)` line (#766). Still refused when `mig/sub` already exists on disk (the check precedes the disk pass). Equal paths (`mig`/`mig`, `mig`/`mig/`, `mig/`/`mig`) hit the duplicate refusal, same code. |
| A snapshot inside the migrations directory is honoured | OK | `migrationsDir: "mig"`, `snapshotPath: "mig/state.json"` → `created mig/`, `created mig/state.json`, exit 0. |
| A permission that blocks the check is reported at the directory that blocks it | OK (see NB4) | `chmod 000 nx` with `migrationsDir` = `nx/a/mig`, `nx/mig`, and `nx/mig` where `mig` already exists — all three named `nx` in the message and the `Next:`; nothing created. |
| A parent that cannot be written into stops the run before anything is created | OK | `chmod 555 ro`, `snapshotPath: "ro/state.json"`, `migrationsDir: "mig"` → `"ro" does not let this process write into it. Next: check permissions on "ro"`; `mig` was **not** created. Also `migrationsDir: "ro/mig"` (same shape) and a 555 cwd (names `./`). No stack, no absolute path. |
| A creation that fails after the checks leaves nothing behind | OK | `snapshotPath: "deep/<300-char component>/state.json"` — passes every check (the walk sees ENOENT, not ENAMETOOLONG), then `mkdirSync` creates `deep/` and fails. Run 1 (pre-existing populated `migrations/`): coded `ENAMETOOLONG` failure, `deep/` removed, `migrations/0001_pre.sql` intact. Run 2 (`migrationsDir: "a/b/newmig"` also created by the run, plus an untouched `keep/inner/file.txt`): both `a/` and `deep/` removed deepest-first, `keep/` intact, no `created ...` line on stdout. |
| A dangling symbolic link at an artifact path is refused | OK | Dangling link at `snapshotPath`, at `migrationsDir`, at an ancestor of both, and at the `--config` path — each `init-path-conflict` naming the path and the target, nothing created, nothing written through the link. Controls: link→file at `snapshotPath` and link→directory at `migrationsDir` are reported `skipped ... (exists)` and left byte-untouched; link→file where a directory is expected is the wrong-kind refusal; a symlink loop is `ELOOP`, coded, naming the leaf. |

Also exercised (context lines of the MODIFIED requirement, all matching):
re-running `init` over a complete project (three `skipped` lines, exit 0);
a repair run with one artifact missing; a configuration omitting one or
both path fields (`migrationsDir not configured` / `snapshotPath not
configured`, no default-path fallback); a directory at the `--config`
path; a permission-blocked ancestor on the `--config` path.
`skills/hejbro/references/generate-verify-workflow.md:9-31` documents
`--config`, the absolute-path refusal, `snapshot-not-a-file` and
`snapshot-unreadable` accurately, including the "relative to the working
directory, never to the configuration file's own directory" rule that
`entry` (config-dir-relative) makes non-obvious.

### Method

Detached worktree `_tmp-d106-ip` at `2b7fd901`, clean tree, running as
uid 501 (**not** root — every permission row below was therefore real; no
row was skipped).

Gates first, all with `TURBO_FORCE=1`, before any scenario ran:

```
pnpm build --force        Tasks: 7 successful, 7 total; Cached: 0 cached, 7 total
pnpm check                Checked 739 files in 497ms. No fixes applied.  (exit 0)
pnpm check-types          Tasks: 18 successful, 18 total; Cached: 0 cached, 18 total
pnpm test                 Tasks: 18 successful, 18 total (hejbro 92 files, core 100,
                          query 64, supabase 17, neon 6, nile 5, skills 5, pg 1,
                          example-postgres 3, example-supabase 4, cli-smoke 1,
                          preset-smoke 1) + test:types Tasks: 2 successful, 2 total
pnpm check:bans           check-bans: ok — no `let`/`var`/loop statements ... in 237 files
openspec validate harden-init-paths --strict
                          Change 'harden-init-paths' is valid
```

Scenarios: ~60 project directories under `/private/tmp/d106-ip-*`, each a
real project (`node_modules/hejbro` symlinked to `packages/cli`, a
`hejbro.config.ts`, a `*.schema.ts` where a command needed declarations),
driven through the built `packages/cli/dist/cli.js` by `node` from inside
the project directory — never in-process, never through vitest. The build
finished before the first scenario ran, so no run read a half-written
`dist`.

Input tables constructed for the universal claims: `--config`
inside/outside/above the cwd, absolute and relative, `--config=` form,
twice, empty, with no value, at a directory, at a dangling link, behind a
file ancestor and behind a 000 ancestor; absolute-looking values `/x`,
`//x` and the non-separator lookalikes `C:\x`, `~/x`; relative spellings
`./a`, `a/`, `a//b`, `../a`; nesting in both orientations at depths 1 and
5, plus equal paths under three spellings; symbolic links dangling, to a
file, to a directory, in an ancestor, and in a loop, with relative and
absolute targets; permissions parent 555, ancestor 000, file 000, cwd 555;
a post-check creation failure via a 300-character path component, with and
without a pre-existing populated migrations directory; a directory, an
unreadable file, an uninspectable path, a trailing-separator spelling and
a dangling link at the snapshot path for each of `generate`, `verify`,
`check`, `baseline`.

Leak sweep: all 63 failing runs re-run with stdout discarded and stderr
collected into one file, then scanned — `grep -E '/(Users|private|tmp|var|home)/'`
→ 0 hits, `grep -E '^\s+at '` (stack frames) → 0 hits, `grep -E '(^|[^[])Error:'`
→ 0 hits.

Every `chmod` was restored and the scratch removed after the run.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling in `.blackbox/741/`).

- **NB1, NB4, NB7** — wording repaired here: a trailing separator is honoured on a directory path and refused on a file path; the permission scenario says the reason and `Next:` name the blocking directory while the artifact label keeps the full path; a link's target is spelled relative to the working directory like every other reported path.
- **NB2, NB3, NB5, NB6, NB8** — tracked as #846, one next batch on the same files with #819, #820, #830 and #831 (read-side trailing separator, config ancestor order, nesting wording and `Next:`, dangling link on the read side, empty `--config`).

Archived at this disposition.

