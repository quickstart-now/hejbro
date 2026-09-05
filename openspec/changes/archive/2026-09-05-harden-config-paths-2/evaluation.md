# D106 round 1 — harden-config-paths-2

## Method

Context-free adversarial review of the delta contract
(`pnpm exec openspec show harden-config-paths-2 --diff`, capability
`cli-commands`, ADDED 2 / MODIFIED 3) against the built CLI only. No
proposal, design, tasks, `.blackbox/`, git history, `packages/*/src` or
test file was read; the public surface consulted was
`skills/hejbro/references/generate-verify-workflow.md` and
`hejbro <command> --help`. Everything else below was produced by
constructing filesystem trees and running the built binary.

- Worktree: `_tmp-d106-cp`, detached at `11aea7992fff2c11b1cabbf562dc20d6ec30519d`.
- Build: `TURBO_FORCE=1 pnpm build --force` — 7/7 tasks, 0 cached.
- Binary: `packages/cli/dist/cli.js`, `hejbro v0.2.0-pre.1`.
- Node v26.7.0, pnpm 10.19.0, darwin 25.6.0.
- **uid 501 (non-root)** — every `chmod 000` / `chmod 500` row below is a
  real refusal, not a root bypass.
- Scratch root `/private/tmp/d106-cp/`, with
  `/private/tmp/d106-cp/node_modules/hejbro -> <worktree>/packages/cli`
  so fixture configs and declarations resolve the `"hejbro"` import.
- **72 constructed trees, ≈320 CLI invocations.** Every command in the
  brief was exercised: `init`, `generate`, `verify`, `check`, `baseline`,
  `history`, `status`, `migrate`, `restore`.
- All `chmod` changes were restored; `find /private/tmp/d106-cp -perm 000`
  is empty. The scratch root is removed after this report.

Fixture shape (`mkproj`): `hejbro.config.ts` with
`entry: ["src/**/*.schema.ts"]` and the `migrationsDir`/`snapshotPath`
under test, plus `src/a.schema.ts` declaring one schema and one table.

## Summary

**BLOCKING 2 / NON-BLOCKING 3 / OK 14**

---

## BLOCKING

### B1 — `hejbro generate` never judges `migrationsDir` when the snapshot already matches

**Scenario sentences judged against** (ADDED: *A migrations directory that
cannot be listed is refused before it is read*):

> **WHEN** a regular file sits at the configured `migrationsDir` and
> `hejbro generate`, `hejbro verify`, `hejbro baseline` or `hejbro
> history` runs
> **THEN** it fails with the error code `migrations-dir-not-a-directory`
> naming that path and a `Next:` line …

and

> **WHEN** the configured `migrationsDir` is `nx/mig` and the directory
> `nx` exists with no permission to look inside it, or `nx` is a regular
> file, and `hejbro generate` runs
> **THEN** it fails with the error code `migrations-dir-unreadable` …

Neither `WHEN` carries a precondition about pending changes. The sibling
scenario in the same requirement (*An absent migrations directory is
still no migrations*) does state one — "against an existing empty
snapshot" — so the absence of a qualifier here is deliberate, not
shorthand.

**Tree** (`/private/tmp/d106-cp/b1`):

```sh
mkproj b1 '"migrations"' '"hejbro.snapshot.json"'      # default config
( cd b1 && node dist/cli.js init && node dist/cli.js generate )  # snapshot now matches
rm -rf b1/migrations && echo "not a directory" > b1/migrations
```

**Commands and observed output:**

```
$ cd b1 && node .../dist/cli.js generate
no changes — snapshot already matches your declarations.
exit=0

$ cd b1 && node .../dist/cli.js verify
error[migrations-dir-not-a-directory]: migrations
  "migrations" is named by migrationsDir, but a file is there — the migrations
  directory holds the migration files hejbro writes. Next: move or remove that
  file, then rerun `hejbro init` to create the directory.
exit=1
```

The same short-circuit was reproduced for every `migrationsDir` fault
kind, always with a matching snapshot:

| tree | fault | `generate` | `verify` |
|---|---|---|---|
| `b1`, `t1` | regular file at `migrations` | `exit 0`, "no changes" | `migrations-dir-not-a-directory`, exit 1 |
| `t6` | dangling link at `migrations` | `exit 0`, "no changes" | (same code, exit 1) |
| `t7b` | `migrationsDir: "nx/mig"`, `chmod 000 nx` | `exit 0`, "no changes" | `migrations-dir-unreadable` (EACCES), exit 1 |
| `t8` | `migrationsDir: "nx/mig"`, `nx` a regular file | `exit 0`, "no changes" | `migrations-dir-unreadable`, exit 1 |

With pending changes (`t9eaccess`, `t9file`, `t9dangling`) `generate`
refuses correctly on all three, so the judgement exists — it is simply
placed after the "no changes" exit.

**Verdict: BLOCKING.** The scenario says `generate` fails; shipped
behaviour exits 0 and prints a success line. This is also a direct
instance of the fault the change exists to end: one tree, two answers —
`generate` reports the project healthy while `verify` refuses it, and
"no changes — snapshot already matches your declarations" is the least
true thing hejbro can say about a project whose migrations directory is a
file. `generate` with no pending changes is the ordinary case (running
`generate` twice), not a corner.

Either the code must judge `migrationsDir` before the "no changes" exit,
or both scenarios must state the precondition the sibling scenario
already states.

### B2 — the third input in the init nesting scenario cannot hold, and the tree it names exits 0

**Scenario sentence judged against** (MODIFIED: *init scaffolds what is
missing, where the configuration says*):

> **WHEN** `hejbro init` runs with `snapshotPath: "hejbro.config.ts/state.json"`,
> or with `migrationsDir: "hejbro.config.ts/mig"`, or with
> `--config state.json/hejbro.config.ts` and `snapshotPath: "state.json"`,
> **nothing existing**
> **THEN** the run fails with the one-path-for-two code … and nothing is
> created

**Tree** (`/private/tmp/d106-cp/n3d`) — the third input, exactly as
written, nothing existing:

```sh
rm -rf n3d && mkdir -p n3d/src
cd n3d && node .../dist/cli.js init --config state.json/hejbro.config.ts
```

**Observed:**

```
created state.json/hejbro.config.ts
created migrations/
created hejbro.snapshot.json
exit=0
```

and the created configuration carries `snapshotPath: "hejbro.snapshot.json"`,
not `"state.json"` — because with nothing existing there is no
configuration for `snapshotPath: "state.json"` to come from. The `WHEN`
is unsatisfiable as written: the flagged configuration file must exist
for its `snapshotPath` to be read at all.

The first two inputs pass (`n1`, `n2`):

```
error[init-path-conflict]: hejbro.config.ts
  "hejbro.config.ts" is the configuration path, and snapshotPath
  ("hejbro.config.ts/state.json") would have to be created inside it — a file
  cannot hold a file. Next: point snapshotPath outside "hejbro.config.ts", …
error[init-path-conflict]: hejbro.config.ts
  "hejbro.config.ts" is the configuration path, and migrationsDir
  ("hejbro.config.ts/mig") would have to be created inside it — a file cannot
  hold a directory. Next: point migrationsDir outside "hejbro.config.ts", …
```

The behaviour the third input *intends* is shipped and correct, but only
with the configuration file present (`n3b`):

```sh
mkdir -p n3b/state.json n3b/src
cat > n3b/state.json/hejbro.config.ts   # snapshotPath: "state.json"
cd n3b && node .../dist/cli.js init --config state.json/hejbro.config.ts
```

```
error[init-path-conflict]: state.json
  "state.json" is named by snapshotPath, and the configuration path
  ("state.json/hejbro.config.ts") would have to be created inside it — a file
  cannot hold a file. Next: name a configuration file outside snapshotPath with
  --config, or point snapshotPath elsewhere, then rerun `hejbro init`.
exit=1
```

— the `Next:` names `--config`, exactly as the requirement demands.

**Verdict: BLOCKING** on the scenario text, not on the code. The
sentence as written contradicts shipped behaviour (`exit 0`, three
artifacts created) and would mislead anyone regression-testing from it.
The repair is in the scenario: the third input needs "with that
configuration file present" rather than "nothing existing". No code
change is implied.

---

## NON-BLOCKING

### N1 — `--config .` produces the very remedy the requirement forbids

The ADDED `--config` requirement refuses an empty value specifically so
that no user is told to delete their working directory:

> it SHALL never be resolved to the working directory, since the refusal
> that would follow tells the user to remove the directory they are
> standing in.

Empty values honour this on all four commands (see OK-8). A *typed* `.`
does not:

```sh
rm -rf k5 && mkdir -p k5/src
cd k5 && node .../dist/cli.js generate --config .
```

```
error[config-not-a-file]: ./
  "./" is the configuration path, but a directory is there — the configuration
  is a file hejbro reads. Next: move or remove the existing directory at "./",
  or name another file with --config, then rerun.
```

Identical on `init`, `baseline`, `history`, and for `--config ..`
(`"move or remove the existing directory at ".."`, tree `k10`). The code
and the kind judgement are right; the `Next:` is the sentence the
requirement calls out as the reason the empty case exists at all.
Uncovered by any scenario, hence non-blocking, but the remedy is
actively wrong advice.

### N2 — an unreadable configuration *file* is still an import-resolution diagnostic

The requirement enumerates what `config-unreadable` covers — "a
permission on the way, a file on the way, a link on the way whose target
does not exist" — and does not include a regular, unreadable file at the
path itself. Shipped behaviour for that input (tree `k11`, `chmod 000
hejbro.config.ts`):

```
error[config-load-failed]: hejbro.config.ts
  failed to load "hejbro.config.ts": EACCES: permission denied, open
  'hejbro.config.ts'. Next: check that every import in hejbro.config.ts
  resolves — a package that isn't installed, or an installed package whose
  "exports" field doesn't resolve, both surface here. Install it, or check the
  package's own "exports" if it's already installed.
```

Same on `init`, so `init`/read-side parity holds. But the same fault at
`snapshotPath` is answered properly (tree `s5`):

```
error[snapshot-unreadable]: hejbro.snapshot.json
  "hejbro.snapshot.json" is named by snapshotPath, but this process cannot read
  it (EACCES). Next: check permissions on "hejbro.snapshot.json", then rerun.
```

A permission problem is reported as an import-resolution problem and the
`Next:` sends the user to check their `node_modules`. This is the same
class the proposal fixed for a *directory* at the configuration path;
the file-permission case was left behind. No absolute path or stack
frame leaks, so it is not a raw-error violation.

### N3 — the `--config` echo is unquoted, so a path with a space yields a remedy that scaffolds the wrong project

The requirement makes the echo a deliberate, single exception:

> The value that `Next:` echoes is the one the user typed, as typed … the
> one place an absolute path may appear in a report.

The value is echoed verbatim, but bare, so the surrounding command is not
runnable when the value contains whitespace (tree `z2`):

```sh
rm -rf z2 && mkdir -p "z2/my dir"
cd z2 && node .../dist/cli.js generate --config "my dir/h.ts"
```

```
error[config-not-found]: my dir/h.ts
  no configuration file was found at "my dir/h.ts". Next: run `hejbro init
  --config my dir/h.ts` to scaffold it there, …
```

Running that `Next:` command verbatim:

```
$ cd z2 && node .../dist/cli.js init --config my dir/h.ts
created my
created migrations/
created hejbro.snapshot.json
```

— a file named `my`, a project the user did not ask for, exit 0. The same
applies to an absolute value with a space. Paths with spaces are ordinary
on macOS, and every *other* path in these messages is quoted (`"my
dir/h.ts"` in the header and the sentence); only the `Next:` command is
not.

---

## OK — verified, with inputs

1. **`migrationsDir` kind refusals, every listing command.** Trees
   `w_md_file`, `w_md_dangling`, `w_md_loop`, each run against `init`,
   `generate`, `verify`, `baseline`, `check`, `history`, `status`,
   `migrate`, `restore 1` (with pending changes, so B1 does not mask
   them). A regular file and a dangling link →
   `migrations-dir-not-a-directory`; the dangling link names its target
   (`pointing at "nowhere"`); a symlink loop → `migrations-dir-unreadable
   (ELOOP)`. Identical message body on all seven listing commands.
2. **`migrationsDir` ancestor judgement and node naming.** `nx/mig` with
   `chmod 000 nx` → `migrations-dir-unreadable`, "could not be checked
   (EACCES): "nx" does not let this process look inside it", `Next:`
   names `nx`; `init` on the same tree also names `nx`. `nx` a regular
   file → `migrations-dir-unreadable`, ""nx" is a file and cannot hold
   it", **no OS code** — exactly the "judgement of kind … with no code to
   report" sentence; `init` names `nx` too (`t7b`, `t8`).
3. **The migrations directory itself unreadable.** `chmod 000
   migrations` → `migrations-dir-unreadable`, "this process cannot list
   it (EACCES)", `Next:` names `migrations` (`m1`).
4. **A symbolic link to a directory is that directory.** `migrations ->
   realmig` → `generate` writes through it and `verify` passes 5 checks
   (`t5`).
5. **Nothing at `migrationsDir` is not a fault.** Absent directory →
   `generate` writes and creates it; `verify`/`baseline` proceed
   (`t10`, `m2`).
6. **Snapshot kind judgements.** Directory → `snapshot-not-a-file`;
   symlink to a directory → the same, judged by its target; dangling link
   → `snapshot-not-a-file` naming the target, **never**
   `snapshot-not-found` (`s1`, `s2`, `s4`); symlink to a real file →
   read normally (`v2`). Identical on `generate`, `verify`, `baseline`,
   `check`; `init` refuses the same trees naming the same node and
   target.
7. **Snapshot ancestor and permission judgements.** `f/state.json` with
   `f` a regular file → `snapshot-unreadable`, ""f" is a file and cannot
   hold it", `Next:` names `f`, and `init` names `f` — never
   `f/state.json` as a thing to check permissions on (`s3`).
   `parent/state.json` with `chmod 000 parent` → `snapshot-unreadable
   (EACCES)`, `Next:` names `parent` (`s6`). `dl/state.json` with `dl` a
   dangling link → `snapshot-unreadable`, names `dl`, no OS code (`s7`).
   Symlink loop → `(ELOOP)` (`s8`). Unreadable regular file → `EACCES` +
   "check permissions" (`s5`).
8. **`snapshotPath` spelled as a directory, refused at read by every
   command.** `""`, `"."`, `".."`, `"db/.."`, `"a/b/."`, `"state.json/"`,
   `"state.json//"` × `init`, `generate`, `verify`, `baseline`, `check`,
   `history`, `status`, `migrate` (56 runs, `sp*`). All →
   `error[invalid-config]: snapshotPath` with the same sentence and a
   `Next:` naming the spelling to drop. Exit 1 everywhere (`migrate`
   exits 2, its own convention). Nothing is created or read: after all
   eight commands the tree still holds only `hejbro.config.ts` and
   `src/` (`spx`).
9. **`migrationsDir` keeps every directory spelling.** `"mig/"`,
   `"./db/migrations"`, `"../out-d106/migrations"`, `"db/migrations//"` →
   `init` creates and `generate` writes at each; none is refused, and
   `"mig/"` is not refused even in the same configuration whose
   `snapshotPath` is (OK-8's trees all carry `migrationsDir: "mig/"`).
10. **Empty `--config`, every command that takes the flag.** `--config=`,
    `--config ""`, `--config "   "`, a bare trailing `--config`, and a
    tab-only value × `init`, `generate`, `baseline`, `history` (17 runs,
    `c1`, `z1`). All → `error[invalid-config-flag]: --config`, "was given
    an empty value", `Next:` showing the flag's form and that dropping it
    means `./hejbro.config.ts`. No message mentions the working
    directory, and the tree is unchanged afterwards.
11. **`config-not-found` naming and echo.** Flagless: `no hejbro.config.ts
    was found. Next: run `hejbro init`` — byte-unchanged. With the flag:
    names the path looked up and `hejbro init --config <same value>`, on
    `generate`, `baseline` and `history` alike. The header is always
    relative to the working directory while the `Next:` echoes the typed
    value: from `c3` the header is `sub/hejbro.config.ts`, from
    `c3/deep/deeper` it is `../../sub/hejbro.config.ts`, and from `/` it
    is `private/tmp/d106-cp/c3/sub/hejbro.config.ts` — the absolute value
    appears only inside the `Next:` command, at every depth. `--config
    ./sub/h.ts` echoes `./sub/h.ts` while the header reads `sub/h.ts`
    (`c2`, `c3`).
12. **Configuration path kinds.** Directory at the path (flagless, and
    via `--config sub`, `--config sub/`) → `config-not-a-file`, naming
    the path once as "the configuration path" — the label and the
    filename are no longer the same word — with a `Next:` naming the node
    to move *and* `--config`. Dangling link → `config-not-a-file` naming
    its target. `f/h.ts` with `f` a file → `config-unreadable`, `Next:`
    names `f`, and `init` names `f`. `nx/h.ts` with `chmod 000 nx` →
    `config-unreadable (EACCES)`, `Next:` names `nx`. Symlink loop →
    `(ELOOP)`. Dangling link on the way → names the link, no code.
    `init` refuses every one of these trees under `init-path-conflict`
    with the same sentence (`k1`–`k10`, `z1`).
13. **Nesting refusals.** `snapshotPath: "hejbro.config.ts/state.json"` →
    "a file cannot hold a **file**"; `migrationsDir:
    "hejbro.config.ts/mig"` → "a file cannot hold a **directory**" — the
    held artifact's kind is stated, and each `Next:` names the field the
    user can move. `migrationsDir` inside `snapshotPath`, at depth and
    under `./` spellings, still refuses (`n4`, `n5`). One path for two
    artifacts → `"same" is named by both migrationsDir and snapshotPath`.
    A snapshot **inside** the migrations directory is correctly *not* a
    conflict: `init` creates both and `generate` writes (`n6`).
14. **Leak sweep and untouched paths.** Across the 63-run fault sweep
    (`w_*`, 7 trees × 9 commands) plus every run above, `grep` for
    `/private/`, `/Users/`, `/tmp/` found **no absolute path**; `grep` for
    `at `/`node:internal`/`file.js:L:C` found **no stack frame**; every
    `ENOENT`/`EACCES`/`ELOOP`/`ENOTDIR` occurrence sits inside a coded
    `error[...]` diagnostic with a `Next:` line. The single permitted
    absolute-path echo — the typed `--config` value in `Next:` — is a
    verified single hit per message and never appears in a header or
    label. A plain valid project still exits 0 on `init`, `generate`,
    `verify`, `history` and `restore 1`; `check`/`status`/`migrate` fail
    only on the missing database connection (`v3`).

### Observations, not findings

- **Header label on `status`/`migrate`.** For the same tree, `generate`,
  `verify`, `baseline`, `history` and `restore` head the diagnostic with
  the configured path (`migrations`), while `status` and `migrate` head it
  with the command (`hejbro status`). The message body and `Next:` are
  byte-identical, so the node named and the remedy are the same; this
  follows those two commands' existing subject-header convention
  (`apply-connection-missing` heads the same way). No scenario constrains
  the header, and the two commands are not named in the scenario that
  says "naming that path".
- **A tree with two faults names two different nodes.** With a regular
  file at `migrations` *and* a directory at `hejbro.snapshot.json`
  (`w_both`), `init` names `migrations/`, `generate`/`baseline`/`check`
  name `hejbro.snapshot.json`, and `verify`/`history`/`status`/`migrate`/
  `restore` name `migrations`. Each answer is true and actionable, and no
  delta sentence orders the two artifacts, so this is not a defect — but
  it is the one place where "the same tree yields the same named node on
  every command" does not hold literally.
- **`init` does not refuse an existing but unreadable snapshot.** With
  `chmod 000 hejbro.snapshot.json`, `init` reports `skipped
  hejbro.snapshot.json (exists)` and exits 0 while every read side
  refuses it (`s5`). The claim is true — the file does exist and `init`
  only creates what is missing — and no delta sentence requires `init` to
  read it.
- **`--config` is still silently ignored by `verify`, `check`, `migrate`,
  `status`, `reset`, `restore`** (`v1`): `verify --config x.ts` runs
  against `./hejbro.config.ts` with no unknown-flag error. The proposal
  defers this explicitly (#819) and the ADDED requirement scopes the flag
  to `init`, `generate`, `baseline`, `history`, so it is out of scope for
  this gate — recorded only so the next reviewer does not re-derive it.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling `.blackbox/846/` R7).

- **B1** — repaired here (tasks.md 3.1): `generate` lists the migrations directory before the first pass, so the same tree answers the same way whether or not there is anything to write; two rows pinned (regular file, dangling link) after a `generate` that left nothing to do.
- **B2** — repaired in the scenario: the third input of the nesting scenario states that the flagged configuration file already exists and names `snapshotPath: "state.json"`; the shipped behaviour on that tree was already right.
- **N1** — repaired here: a `--config` value naming the working directory or its parent is refused with the file to pass, never "remove the directory".
- **N3** — repaired here: the echoed value is shell-quoted when a shell would split or expand it; a plain value stays bare.
- **N2** — an unreadable configuration file still answers `config-load-failed` with import advice → #875.

Archived at this disposition.

