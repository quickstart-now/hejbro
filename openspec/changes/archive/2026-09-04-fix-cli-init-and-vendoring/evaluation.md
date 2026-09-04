# Evaluation — `fix-cli-init-and-vendoring`

## Round 1

Context-free adversarial spec review (D106). Read: the two delta specs
against `openspec/specs/cli-commands/spec.md` and
`openspec/specs/schema-vendoring/spec.md`, the public surface they name
(`packages/cli/src/commands/init.ts`, `config.ts`, `loader.ts`,
`vendor/*`, `contract/*`, `packages/query/src/db/fn.ts`,
`packages/query/src/client/name-keyed-db.ts`, `skills/hejbro/`), and the
test suite as evidence. Not read: proposal, design, tasks, PR bodies,
git log messages, `blackbox/`, `.agents/`.

### Verdict

BLOCKING 1 / NON-BLOCKING 8 / OK 13

(14 delta scenarios: 6 ADDED in cli-commands, 3 ADDED + 5 MODIFIED in
schema-vendoring. One scenario has an input inside its WHEN whose
shipped behaviour contradicts its THEN; the other 13 match. The
non-blocking items are adjacent inputs, over-claims in requirement prose
the scenarios do not cover, one skill gap, and pre-existing behaviour the
round surfaced.)

### Blocking

**B1 — "A path holding the wrong kind of node stops the run": a
migrations directory spelled with a trailing slash that holds a file
crashes with a raw Node stack instead of the coded refusal.**

- Input: `migrationsDir: "mig/"`, `snapshotPath: "snap.json"`, a
  regular file at `<project>/mig`, `hejbro init`.
- Scenario text (delta, cli-commands): *WHEN … the configured migrations
  directory holds a file — THEN the run fails naming that path and the
  kind expected there, nothing is created, and the run does not report
  the artifact as already present.* Requirement text: *A path holding
  the other kind SHALL stop the run with a coded failure naming that
  path and the kind expected there, creating nothing.*
- Shipped (built `dist/cli.js` at 75f0bbe0): exit 1, stderr is
  `Error: ENOTDIR: not a directory, mkdir '<absolute>/proj/mig/'` plus a
  nine-frame Node stack with absolute paths. No `error[init-path-conflict]`
  line, no "expected to be a directory for migrationsDir", and an
  absolute path in a CLI diagnostic. Nothing was created (the crash
  happens on the first artifact after the config skip), and nothing was
  reported as present — so two of the three THEN clauses hold; the
  first ("fails naming that path and the kind expected there", coded)
  does not.
- The trailing-slash spelling is inside the WHEN: the same run with no
  file at `mig` accepts `"mig/"`, creates `mig/`, and `generate` then
  writes `mig/0001_add_app.sql` (measured), so `"mig/"` is an honoured
  spelling of "the configured migrations directory", not a refused one.
- Root cause (measured, `packages/cli/src/commands/init.ts:108-127`):
  `checkPathKind` calls `existsSync(artifact.path)` on the joined path
  `…/mig/`; `stat("mig/")` on a regular file fails with `ENOTDIR`, so
  `existsSync` returns `false`, the kind check is skipped as "nothing
  there", and `createArtifact`'s `mkdirSync("…/mig/", { recursive: true })`
  throws the raw error. (`node -e` in the probe project:
  `existsSync("mig")` → `true`, `existsSync("mig/")` → `false`,
  `statSync("mig/")` → `ENOTDIR`.) The file-field guard
  (`throwSpelledAsDirectory`) covers the snapshot's trailing slash but
  there is no equivalent normalisation for a directory field before the
  stat. `init.test.ts:301` covers the file-at-migrations case only with
  the plain spelling `"db/migrations"`.

### Non-blocking

**N1 — An ancestor that is a file leaks a raw stack and leaves a
partial run.** `snapshotPath: "db/snap.json"` (or `migrationsDir:
"db/mig"`) with a regular file at `db`: `existsSync` on the leaf is
`false`, so the kind check passes, and `mkdirSync(dirname, {recursive})`
throws `EEXIST`/`ENOTDIR` with a Node stack and absolute paths. In the
snapshot variant `migrations/` had already been created before the
crash — a failed `init` that created something. Adjacent to B1's WHEN
(the leaf holds nothing; its parent is the wrong kind), so not a
scenario contradiction, but the requirement's "stop the run … creating
nothing" and D57's no-absolute-path rule both miss here. Same
`existsSync`-on-a-non-directory root as B1.

**N2 — The same path named for both fields reports the snapshot as
present after `init` itself created a directory there.**
`migrationsDir: "migrations"`, `snapshotPath: "migrations"`: output is
`created migrations/` then `skipped migrations (exists)`, exit 0. The
kind check runs once, before any creation; the directory `init` just
made is then found by `applyArtifact`'s plain `existsSync` and reported
as the snapshot being present — the "tells a repair run that a broken
project is whole" the requirement forbids. Self-inflicted configuration
(`generate` would then fail reading a directory as the snapshot), so a
follow-up, not a contradiction of a scenario's own WHEN.

**N3 — A directory sitting at `hejbro.config.ts` does not get the
"kind expected there" the requirement promises for the configuration.**
The requirement lists the configuration among the artifacts whose
wrong-kind path "SHALL stop the run with a coded failure naming that
path and the kind expected there". Shipped: `error[config-load-failed]:
hejbro.config.ts — failed to load "hejbro.config.ts": Cannot find module
'hejbro.config.ts'. Next: check that every import … resolves`. Coded,
names the path, creates nothing, exit 1 — but the kind is never named
and the `Next:` line sends the user to import resolution. The scenario
"A path holding the wrong kind of node stops the run" names only the
snapshot and migrations paths, so this is requirement-prose over-claim.
(The same loader `Next:` also fronts a configuration that throws at
module top level — `config-load-failed … boom …. Next: check that every
import resolves` — pre-existing loader wording.)

**N4 — The `invalid-config` diagnostic carries the absolute
configuration path.** `export default { entry: 5, … }` → `config field
"entry" in /…/proj/hejbro.config.ts is missing or the wrong shape`.
`init` and `generate` print byte-identical text (measured both), so the
scenario's "that file's own coded diagnostic" holds exactly; the
absolute path is `parseConfig(value, configPath)`'s pre-existing
behaviour in every command, not delta-introduced. Recorded because the
round was asked whether any diagnostic carries an absolute path.

**N5 — `generate`'s success line for an absolute-looking configured
value names a path that is not where the artifact is.** `migrationsDir:
"/abs/mig"`: `init` resolves via `join(cwd, value)` exactly as
`generate` does, creates `<project>/abs/mig/` and reports `created
abs/mig/` (correct). `generate` then writes to the same place but prints
`wrote /abs/mig/0001_add_app.sql` — a path that does not exist.
`init`'s own line is right, and the delta's "init cannot create a
directory generate will not read" holds; the misleading line is
`generate`'s pre-existing `join(migrationsDir, fileName)` label. Out of
the delta; noted per the round's question.

**N6 — Column keys `constructor` / `toString` / `hasOwnProperty` make
every fresh `Insert`/`Update` literal fail to type-check.** Scenario "A
key that only looks dangerous is carried the same way" holds for what it
names — each is an own property of the emitted metadata, `select` lists
them, runtime `insert`/`update` carry them — but under `tsc --strict`
`c.posts.insert({ title: "x" })` is refused: `Types of property
'constructor' are incompatible. Type 'Function' is not assignable to
type 'string'` (then the same for `hasOwnProperty`, `toString`).
Reproduced with zero hejbro types (`type A = { title: string;
constructor?: string | null }; const a: A = { title: "x" }` → same
error): TypeScript resolves `Object.prototype` members as apparent
properties of every object type, so any optional property with one of
those three names is unsatisfiable by a literal that omits it.
`prototype`, `__proto__` and `"42"` are unaffected. TS-inherent and
equally true of a declaring repository's own insert input; a
follow-up for the skill (name the three keys as ones a schema should not
use for a column) rather than for the emitter.

**N7 — Skill gap: the new runtime refusal code is undocumented.**
`skills/hejbro/references/query-layer.md`'s Errors table (§ "Errors",
line ~1051 on) carries no row for `function-argument-unknown`, nor for
the pre-existing `function-argument-count-mismatch`; the only `db.fn`
entries are `driver-missing-capability` and `context-required`.
AGENTS.md's "public API surface changed → `skills/hejbro` updated in the
same PR" was not met for the new code. (The `init` side is covered:
`generate-verify-workflow.md:9` describes `init` honouring an existing
configuration and creating only what is missing.)

**N8 — The name-keyed client's guard cannot refuse a lookup of
`__proto__` when nothing is named that.** `wrapWithTableGuard` /
`wrapWithFunctionGuard` (`name-keyed-db.ts`) decide "unknown" with
`!(prop in obj)`; `"__proto__" in {}` is `true` (inherited), so on a
contract with no `__proto__` table or function, `client.fn.__proto__`
returns `Object.prototype` instead of the `unknown-contract-function`
refusal, and calling it is a `TypeError`. When something *is* named
`__proto__` (this round's contract) the own property wins and the
lookup is correct (measured). Pre-existing guard shape; the delta's
"own property at run time" claim is unaffected. Code-reading plus the
`in` semantics; not driven through a contract without a `__proto__`
key in this round.

### Verified scenarios

cli-commands (ADDED — "init scaffolds what is missing, where the configuration says")

- **An empty project is scaffolded** — OK. No config: `created
  hejbro.config.ts` / `created migrations/` / `created
  hejbro.snapshot.json`, exit 0; `generate` then wrote
  `migrations/2026…_add_app.sql` and `verify` passed 5 checks, so every
  artifact `init` made is read by the next command. `init.test.ts:27`.
- **A configured location is honoured** — OK. `db/migrations` +
  `db/state/snapshot.json`: both created, nothing at `migrations/` or
  `hejbro.snapshot.json`, lines name the configured paths; `generate`
  wrote `db/migrations/0001_add_app.sql`; second `init` reports three
  skips and the snapshot bytes are unchanged (sha `d369ef9a…` before and
  after). Also honoured: `"mig/"` (label `mig/`), `../escaped-mig`
  (created and later written outside the project, label
  `../escaped-mig/`), `db/../migrations` (label `migrations/`),
  `/abs/mig` (label `abs/mig/`, see N5). `init.test.ts:111-210`.
- **A configuration that names neither field gets neither artifact** —
  OK. `migrationsDir not configured` / `snapshotPath not configured` /
  `skipped hejbro.config.ts (exists)`, exit 0, tree unchanged; `generate`
  and `verify` then refuse by field name (`invalid-config: migrationsDir`).
  One-field variants: the named field is created, the other reported not
  configured, and `generate` refuses naming exactly the missing one.
  `init.test.ts:443-470`.
- **Only the absent piece is created** — OK. Existing `db/migrations/`
  → `skipped db/migrations/ (exists)`, `created db/state/snapshot.json`,
  exit 0. Also no-config + existing `migrations/`: config and snapshot
  created, directory skipped. `init.test.ts:252`.
- **A path holding the wrong kind of node stops the run** — BLOCKING
  (B1) for `migrationsDir: "mig/"` + file at `mig`. Plain spellings
  match: file at `migrations` (no config) → `error[init-path-conflict]:
  migrations/ … expected to be a directory for migrationsDir, but a file
  is there`, exit 1, no config file and no snapshot created; directory
  at `hejbro.snapshot.json` → `expected to be a file … but a directory is
  there`; file at configured `db/migrations` → same; a symlink to a
  directory at the snapshot path → refused as a directory; `snapshotPath:
  ""` / `"."` → `"./" was expected to be a file for snapshotPath`;
  `snapshotPath: "snap/"` (with or without a `snap` directory) →
  `names a directory (a trailing "/"), but snapshotPath needs a file`.
  In every refused run nothing was created. `init.test.ts:284-395`.
- **A configuration that cannot be read stops the run** — OK.
  Unresolvable import → `error[config-load-failed]: hejbro.config.ts …
  Cannot find module 'nope-pkg-xyz'`, byte-identical to `generate`'s,
  exit 1, nothing created; invalid shape (`entry: 5`, and a module with
  no default export) → `error[invalid-config]: entry`, identical to
  `generate`'s, exit 1, nothing created (see N4 for the absolute path
  in that text). `init.test.ts:212-250`.

schema-vendoring (ADDED — "An emitted key survives as data, whatever it is named")

- **A column whose name is meaningful in an object literal is carried**
  — OK. Description key `c2` → `{ key: "__proto__" }`: emitted
  `["__proto__"]: { sqlName: "c2", … }` in `contractMetadata.tables.posts.columns`;
  loaded module: `Object.hasOwn(columns, "__proto__") === true`,
  `Object.keys` lists it; `client.posts.select().compile().sql` lists
  `"c2"` among the explicit columns; `where(eq(client.posts.columns["__proto__"], "v"))`
  renders `"app"."posts"."c2" = $1`; `insert({ title, ["__proto__"]: "pv" })`
  renders `("title", "c2", …)`, `update({ ["__proto__"]: "pv" })` renders
  `set "c2" = $1`. Same at the table position (`["__proto__"]` table:
  `select "id", "note" from "app"."__proto__"`, `Object.hasOwn(client,
  "__proto__")`) and the function-export position (`["__proto__"]`
  function: `client.fn["__proto__"]({ x })` → `select "app"."f2"($1) as
  "result"`). `contract-emit.test.ts:798,891`.
- **What the description says under such a key reaches the contract** —
  OK. Description record key `"__proto__": { key: "protoAlias", mode:
  "number" }` for a `bigint` snapshot column named `__proto__`: emitted
  `"protoAlias": { sqlName: "__proto__", typeNode: bigint, mode: "number" }`,
  `Row.protoAlias: number | null`; `select` lists `"__proto__"`. Reader
  path is the real one (`validate-export.ts:50-63`, `Object.entries` →
  `Object.fromEntries`), driven through `git` + `hejbro vendor`.
  `validate-export.test.ts` passes at this build.
- **A key that only looks dangerous is carried the same way** — OK for
  what the scenario names (`constructor`, `prototype`, `hasOwnProperty`,
  `toString`, plus `"42"` as an integer-like control): each is a plain
  quoted own property in the emitted metadata, present in `Object.keys`
  of the loaded module and of `client.posts.columns`, and listed by
  `select` (`"c3"`, `"c4"`, `"c5"`, `"c6"`, `"42"`). See N6 for the
  TypeScript write-literal consequence of three of them.

schema-vendoring (MODIFIED — "The contract carries a typed function surface")

- **A scalar function crosses the boundary** — OK. `client.fn.add({ a: 1, b: 2 })`
  → `select "app"."add"($1, $2) as "result"`, params `[1, 2]`, resolves
  to the driver's `result`; `tsc --strict` accepts `const r1: Promise<number> = c.fn.add(...)`.
  Through `.as({ settings })` on a role-less driver: `select set_config($1, $2, true)`
  then the same invocation.
- **A table-returning function crosses the boundary** — OK.
  `client.fn.listPosts({})` → `select "42", "id", "title", "amount",
  "__proto__", "c2", "c3", "c4", "c5", "c6" from "app"."list_posts"()` —
  explicit list, no `*`; `tsc` accepts the rows typed as
  `Database["Tables"]["posts"]["Row"]`.
- **A mismatched call fails the type check** — OK. `tsc --strict`
  (5.9.3, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`):
  missing argument, extra property on a fresh literal, wrongly typed
  argument each consumed a `@ts-expect-error` (no unused-directive
  error). Runtime, from JavaScript with no type check, 0 statements sent
  in every refusal (recording driver): `{ a, c }` →
  `function-argument-unknown`, `db.fn call to "add" was given the
  argument "c", which it does not declare. Next: pass exactly the
  declared arguments: "a", "b".`; `JSON.parse('{"a":1,"bee":2}')` → same
  code naming `"bee"`; `{ a, b, c }` and `{ a }` →
  `function-argument-count-mismatch`, message text unchanged (`was given
  3 argument(s), but it declares 2. Next: pass exactly 2 value(s), in
  the function's declared argument order.`); count check runs first
  (`fn.ts:319-320`). Symbol-keyed, non-enumerable and inherited keys
  are invisible to `Object.keys` and fall to the count check
  (`{ a, [sym] }` → count 1); `{ a, b, [sym] }` and `{ a, b }` with a
  non-enumerable extra are accepted and send `[1, 2]`. Through
  `.as(context)`: identical codes and messages, and no `set_config` is
  sent before the refusal. `packages/query/test/client/functions.test.ts:243-300`.
- **A function returning an uncarried table is absent** — OK
  (unchanged from the main spec; `contract-emit.test.ts:311`, passing at
  this build; not re-measured end-to-end).
- **A synthesized trigger function is absent** — OK (unchanged;
  `contract-emit.test.ts:283`, passing at this build).

### Method

- Build: `packages/cli/dist/cli.js` in this worktree at commit
  `75f0bbe0`, mtime 21:16 today (the lead's `pnpm build --force`); not
  rebuilt during the round. Node v26.7.0, pnpm 10.19.0, TypeScript 5.9.3
  from the worktree's `node_modules`. No `pnpm install`/`build`/full
  `test`/`check-types`/`check:crap`. No Postgres and no Docker: every
  `db.fn`/`select`/`insert` measurement used an in-memory recording
  driver (`execute` pushes the compiled statement; `transaction` runs
  the callback; `roleLessPlatform: true` for the `.as()` probes), so
  "before any SQL is sent" is the recorded statement count.
- Throwaway projects under `<worktree>/_r1probe-*` (deleted at the end;
  `git status --short` shows only this file): each had
  `node_modules/hejbro → <worktree>/packages/cli`, so `hejbro.config.ts`,
  declaration files and the vendored `contract.ts` resolved `"hejbro"`
  to the built `dist`.
- Vendoring path: a real `hejbro generate --export` (format
  `descriptionFormat: 1`, `snapshotFormat: 8`) from a declaring project
  with `posts`, `t2`, `add`, `list_posts`, `f2`; `schema.json` then
  hand-edited with a Node script (`Object.fromEntries`, never a literal
  `__proto__:` key) to: column record key `__proto__` → `{ key:
  "protoAlias", mode: "number" }` on a `bigint` snapshot column named
  `__proto__`; `c2 → key "__proto__"`; `c3..c6 → constructor /
  prototype / hasOwnProperty / toString`; `c7 → "42"` (SQL name and
  key); table `t2 → "__proto__"` (snapshot node key and `name`, fact
  `tableName`); function `f2`'s `exportName → "__proto__"`. Committed to
  a local `git init` repository; consumer ran `hejbro link <path>` then
  `hejbro vendor` twice (both exit 0, `contract.ts` sha256
  `b06eecc1…` both times) and `hejbro vendor --check` (up to date). The
  emitted module was **loaded**, not string-matched: `node` imported
  `.hejbro/vendor/contract.ts` directly (native type stripping) and
  inspected `Object.keys`/`Object.hasOwn` on `contractMetadata`, the
  client, `client.fn`, `client.posts.columns` and the scoped handle,
  and executed `select`/`insert`/`update`/`fn` calls against the
  recording driver. `tsc --noEmit --strict` ran over `contract.ts`, a
  typed probe (`@ts-expect-error` for missing/extra/wrong-typed
  arguments, `__proto__` and `"42"` row fields, `.as()` call) and a
  pure-TypeScript isolation file for N6.
- `init` matrix (31 projects; each followed by a `find` of the tree, and
  where artifacts were created by `generate`/`verify`/`status` with a
  minimal declaration file): no configuration; nested paths; trailing
  slashes on both fields, on the directory field only, on the file field
  with and without a directory there; `""` and `"."` for each field;
  `../escaped-*`; `/abs/*`; `db/../*`; only `migrationsDir`; only
  `snapshotPath`; neither; unresolvable import; invalid shape; no
  default export; module that throws; file where the migrations
  directory belongs (with and without a configuration, with and without
  a trailing slash); directory where the snapshot belongs (plain and via
  symlink); directory at `hejbro.config.ts`; existing configured
  migrations directory only; same path for both fields; file at the
  parent of a configured nested path (both fields); `init` twice on a
  configured project; `init` on a no-config project with an existing
  `migrations/`. Exit codes were re-measured directly per case.
- Targeted tests run at this build: `packages/cli`
  `init.test.ts` + `contract-emit.test.ts` + `validate-export.test.ts`
  (70 passed), `packages/query` `test/client/functions.test.ts` (10
  passed).
- Docs sweep: `grep` over `*.md` (excluding `node_modules`,
  `openspec/changes/`, `blackbox/`) for the superseded "counts keys /
  does not inspect their names" wording finds it only in the main spec
  the delta replaces (`openspec/specs/schema-vendoring/spec.md:397`);
  `skills/hejbro` and both READMEs carry no stale `init` claim.

## Round 1 disposition

- **B1** — `57b36f7d`: `checkPathKind` stats the configured path with
  its trailing separators stripped, so a directory-style spelling
  (`"mig/"`) can no longer make `existsSync` report a file as absent;
  any non-`ENOENT` stat failure becomes `init-path-conflict` naming the
  OS error code, never a raw Node stack. The `Next:` clause's own
  wording (naming the real node, not the directory-style spelling) was
  refined in `90409e2b` and, extended to the ancestor case below, in
  `de65fe41`.
- **N1** — `b1744634`: `checkAncestors` walks each planned artifact's
  ancestor chain upward — past both `ENOENT` and `ENOTDIR` (a `stat`
  below a file ancestor fails with `ENOTDIR` too) — before anything is
  created and before the leaf's own kind check, refusing naming the
  ancestor that actually blocks it.
- **N2** — `23b77eb8`: `checkNoDuplicatePaths` compares every planned
  artifact's resolved path pairwise, after stripping trailing
  separators, before anything is created; a repeat refuses naming both
  fields and the shared path. Delta spec gained the prose clause and
  scenario covering this and N1.
- **N3** — `616a63ea`: the configuration artifact's own kind is checked
  before `loadConfig` runs, so a directory sitting at
  `hejbro.config.ts` refuses as `init-path-conflict` instead of
  reaching the loader's `config-load-failed`.
- **N4** — filed `#745`, untouched this round (owner-directed, not in
  scope for a D106 correction pass).
- **N5** — filed `#743`, untouched this round (same reasoning as N4).
- **N6** — `9e76e83b`: `skills/hejbro/references/polyrepo.md` gains one
  sentence naming the TypeScript-inherent write-literal constraint on
  `constructor`/`toString`/`hasOwnProperty`-named columns.
- **N7** — `9e76e83b`: `skills/hejbro/references/query-layer.md`'s
  Errors table gains rows for `function-argument-unknown`,
  `function-argument-count-mismatch`, `unknown-contract-table` and
  `unknown-contract-function`.
- **N8** — `a8fa1e59`: both `wrapWithTableGuard` and
  `wrapWithFunctionGuard` decide "unknown" with `Object.hasOwn` instead
  of `prop in obj`, passing through only the names the language itself
  reads off any value (`then`, `toString`, `valueOf`, `constructor`,
  `toJSON`) — an own property still wins over that list. No
  specification anywhere states what a name-keyed lookup of an
  unvendored name does (`unknown-contract-*` appears in no
  `openspec/specs/**`), so this landed as a plain fix with no delta — a
  gap for whenever the client surface gets a capability spec.

## Round 2

Context-free adversarial spec review (D106), second round, at `d5cda781`
(the merged change plus its round-1 correction). Read: the two delta
specs against the main specs, the public surface they name
(`packages/cli/src/commands/init.ts`, `errors.ts`, `diagnostics.ts`,
`vendor/validate-export.ts`, `packages/query/src/db/fn.ts`,
`packages/query/src/client/name-keyed-db.ts`, `skills/hejbro/`, the two
`.changeset/*.md` entries), and the test suite as evidence. Round 1's
findings and disposition were read as claims to verify. Not read:
proposal, design, tasks, PR bodies, git log messages, `blackbox/`,
`.agents/`.

### Verdict

BLOCKING 0 / NON-BLOCKING 4 / OK 15

(15 delta scenarios: 7 ADDED in cli-commands — one new since round 1,
"A path that cannot hold the artifact stops the run before anything is
created" — 3 ADDED + 5 MODIFIED in schema-vendoring. Every scenario's
own WHEN produced its THEN at this build. The four non-blocking items
are inputs adjacent to the scenarios' WHENs where the requirement prose
still over-claims, plus one residue of round 1's N8 fix.)

### Round-1 findings re-checked

- **B1** — closed. `migrationsDir: "mig/"` (and `"mig//"`) with a file at
  `mig` → `error[init-path-conflict]: mig/` / `"mig/" was expected to be a
  directory for migrationsDir, but a file is there. Next: move or remove
  the existing file at "mig"`, exit 1, tree unchanged; the `Next:` path
  exists. `init.ts:80-81,325`; `init.test.ts:488-571`.
- **N1** — closed. File at `a` with `migrationsDir: "a/b/mig"` or
  `snapshotPath: "a/b/snap.json"` → `"a" was expected to be a directory
  to hold migrationsDir|snapshotPath, but a file is there`, exit 1,
  nothing created (the other field's own usable path included).
  `init.ts:230-271`; `init.test.ts:573-667`.
- **N2** — closed for equal paths; residue below (R2-N1). `"same"`/`"same"`
  → `"same" is named by both migrationsDir and snapshotPath`;
  `snapshotPath: "hejbro.config.ts"` and `migrationsDir:
  "hejbro.config.ts"` → `named by both hejbro.config.ts and
  snapshotPath|migrationsDir`; exit 1, nothing created. `init.ts:289-306`;
  `init.test.ts:669-746`.
- **N3** — closed. Directory at `hejbro.config.ts` → `"hejbro.config.ts"
  was expected to be a file for hejbro.config.ts, but a directory is
  there`, exit 1, nothing created, loader never reached. `init.ts:502`;
  `init.test.ts:748-760`.
- **N4** — still open, tracked (#745). `export default { entry: 5, … }` →
  `config field "entry" in /…/_r2probe/i23/hejbro.config.ts is missing or
  the wrong shape`; `init` and `generate` stderr byte-identical (diffed),
  so the scenario holds and the absolute path is the shared loader's.
- **N5** — still open, tracked (#743). `migrationsDir: "/abs/mig"`: `init`
  reports `created abs/mig/` (correct), `generate` then prints `wrote
  /abs/mig/0001_add_app.sql` while writing `<project>/abs/mig/…`.
- **N6** — closed. `skills/hejbro/references/polyrepo.md:55-60` names the
  `constructor`/`toString`/`hasOwnProperty` write-literal constraint as
  TypeScript's own; reproduced this round (`tsc --strict` on a fresh
  `insert` literal against the `__proto__`-contract: `Types of property
  'constructor' are incompatible`).
- **N7** — closed. `skills/hejbro/references/query-layer.md:1063-1064`
  (`function-argument-count-mismatch`, `function-argument-unknown`) and
  `:1070-1071` (`unknown-contract-table`, `unknown-contract-function`).
- **N8** — closed for the unscoped client and for `fn` on both handles;
  residue below (R2-N4) for the scoped handle's table surface. On a
  contract vendoring nothing named `__proto__`: `client.fn.__proto__`,
  `client.__proto__`, `client.fn.hasOwnProperty`, `client.hasOwnProperty`,
  `client.fn.isPrototypeOf`, `client.nope` → `unknown-contract-function`
  / `unknown-contract-table`; `then`/`toString`/`valueOf`/`constructor`/
  `toJSON` pass through, so `await client === client`, `String(client)`
  → `[object Object]`, `JSON.stringify(client)` and `util.inspect` all
  work. `name-keyed-db.ts:223-241`; `errors.test.ts:165-260`.

### Blocking

None.

### Non-blocking

**R2-N1 — Two configured fields nested one inside the other: `init`
creates the directory, then reports the file artifact as present, and
`generate` crashes raw.** `migrationsDir: "mig/sub"`, `snapshotPath:
"mig"` (both absent): `created mig/sub/` then `skipped mig (exists)`,
exit 0; `generate` then dies with `Error: EISDIR: illegal operation on a
directory, read` plus a Node stack with absolute paths. Mirror image
`migrationsDir: "snap.json/mig"`, `snapshotPath: "snap.json"`: `created
snap.json/mig/` then `skipped snap.json (exists)`; a second `init` on
that tree refuses (`"snap.json" was expected to be a file … but a
directory is there`) — the run before it made the broken project it
now refuses. `checkNoDuplicatePaths` (`init.ts:289-306`) compares for
equality only, so a planned file that is a planned directory's ancestor
(or vice versa) passes every pre-creation check and is found by
`applyArtifact`'s bare `existsSync` (`:354`) after `init` itself created
it — the "tells a repair run that a broken project is whole" the
requirement forbids, and the requirement's "a path an artifact would
have to be created inside" read against a planned rather than an
existing node. Neither scenario's WHEN names nested fields (the new
scenario says "a regular file sits where a directory … would have to
be, or … one path for both"), so an over-claim of the requirement
prose, not a contradiction. (When the file already exists at the
ancestor the ancestor check catches it correctly — that is N1.)

**R2-N2 — An unwritable parent still ends in a raw Node stack with
absolute paths, and in one variant a partial run.** `ro` chmod 555:
`migrationsDir: "ro/mig"` → `Error: EACCES: permission denied, mkdir
'/…/i12/ro/mig'` + nine-frame stack, exit 1; `snapshotPath:
"ro/snap.json"` with `migrationsDir: "mig"` → same shape at
`writeFileSync`, **after `mig/` was created** (tree: `mig`, `ro`). The
round-1 disposition's "any non-`ENOENT` stat failure becomes
`init-path-conflict`" holds for `stat` only (`init.ts:196-206`; a parent
with mode 000 → `"nx/mig/" could not be checked for migrationsDir
(EACCES)`, coded); the create step (`:342-351`) has no equivalent, and
`asHejbroError` (`errors.ts:15-20`) rethrows anything that is not a
`HejbroError`. Adjacent to the requirement's "coded failure … creating
nothing" and to D57's no-absolute-path rule; no scenario names
permissions, so non-blocking. The correction changeset's "instead of a
raw filesystem crash" reads wider than what shipped.

**R2-N3 — The stat-failure refusal's `Next:` names a path that does not
exist.** `nx` chmod 000, `migrationsDir: "nx/mig"` → `"nx/mig/" could
not be checked for migrationsDir (EACCES). Next: check permissions on
"nx/mig/"`. The node whose permissions block the check is `nx`;
`nx/mig` does not exist. `checkAncestors` walks `dirname` and stops at
`nx` as "ok" because `stat(nx)` itself succeeds (`init.ts:230-248`),
then `checkPathKind`'s own stat of the leaf fails and is labelled with
the leaf (`:330`). Wording only; coded and exit 1.

**R2-N4 — The scoped handle's table surface is not guarded; only its
`fn` is.** `createDb(conn).as(context)` returns the plain spread object
(`name-keyed-db.ts:478-484`), never passed through `wrapWithTableGuard`
(only `createNameKeyedDb`'s own return is, `:486`). Measured on the
plain contract: `s.nope` → `undefined` and `s.nope.select()` → uncoded
`TypeError: Cannot read properties of undefined (reading 'select')`;
`s.__proto__` → `Object.prototype`; `s.hasOwnProperty` → the inherited
function — while `s.fn.nope`/`s.fn.__proto__` refuse with
`unknown-contract-function` and the unscoped `client.nope` refuses with
`unknown-contract-table`. The delta's `.as(context)` clause is about
`fn` (which holds); the table-lookup refusal is specified nowhere (the
round-1 disposition already notes `unknown-contract-*` has no spec), so
this is the same gap N8's fix half-closed, not a scenario contradiction.

### Verified scenarios

cli-commands (ADDED — "init scaffolds what is missing, where the configuration says")

- **An empty project is scaffolded** — OK. `created hejbro.config.ts` /
  `created migrations/` / `created hejbro.snapshot.json`, exit 0; second
  `init` → three `skipped … (exists)`, exit 0; `generate` wrote
  `migrations/20260903151400_add_app.sql`, `verify` passed 5 checks,
  `status` refused only for the missing connection — every artifact
  `init` made is read by the next command. `init.test.ts:27-109`.
- **A configured location is honoured** — OK. `../esc/mig` +
  `../esc/snap.json` (escaping the project): `created ../esc/mig/`,
  `created ../esc/snap.json`, nothing under the project, `generate`
  wrote `../esc/mig/0001_add_app.sql`. `mig` + `mig/snap.json` (snapshot
  inside the migrations directory): both created, `generate` wrote
  `mig/0001_add_app.sql` beside it. `"."` for `migrationsDir` → `skipped
  ./ (exists)`. `init.test.ts:111-210`.
- **A configuration that names neither field gets neither artifact** —
  OK. `migrationsDir not configured` / `snapshotPath not configured` /
  `skipped hejbro.config.ts (exists)`, exit 0, tree unchanged;
  `generate` then refuses `invalid-config: migrationsDir`.
  `init.test.ts:443-470`.
- **Only the absent piece is created** — OK. `init.test.ts:252-282`
  (passing at this build); round 1's measurement not repeated.
- **A path holding the wrong kind of node stops the run** — OK,
  including round 1's B1 input. File at `mig` with `"mig/"`, `"mig//"`;
  a symlink to a file at `mig` → refused as a file; a symlink to a
  directory at `snap.json` → refused as a directory (`"snap.json" was
  expected to be a file for snapshotPath, but a directory is there`);
  `"db/snap.json/"` → `names a directory (a trailing "/"), but
  snapshotPath needs a file`; directory at `hejbro.config.ts` (N3). In
  every refusal nothing was created and no `skipped` line printed.
  `init.test.ts:284-441,488-571,748-760`.
- **A path that cannot hold the artifact stops the run before anything
  is created** — OK. File two levels up (`a` under `a/b/mig`,
  `a/b/snap.json`) → ancestor refusal naming `a`, nothing created though
  the other field's path was usable; same path for both fields, and
  either field naming `hejbro.config.ts` → duplicate refusal naming both
  fields, nothing created. `init.test.ts:573-746`. (Nested planned
  fields: R2-N1.)
- **A configuration that cannot be read stops the run** — OK.
  Unresolvable import → `error[config-load-failed]: hejbro.config.ts`;
  invalid shape → `error[invalid-config]: entry`; each byte-identical to
  `generate`'s stderr (diffed), exit 1, tree unchanged.
  `init.test.ts:212-250,774-785`.

schema-vendoring (ADDED — "An emitted key survives as data, whatever it is named")

- **A column whose name is meaningful in an object literal is carried**
  — OK. Vendored through real `git` + `hejbro link` + `hejbro vendor`
  (twice, plus `vendor --check: up to date`); loaded module:
  `Object.hasOwn(contractMetadata.tables.posts.columns, "__proto__")
  === true` (emitted as `["__proto__"]: { sqlName: "c2", … }`);
  `select` lists `"c2"`; `where(eq(columns["__proto__"], "v"))` renders
  `"app"."posts"."c2" = $1`; `insert` renders `("title", "c2", "c5",
  "c6", "c4")`; `update` renders `set "42" = $1, "c2" = $2, "c3" = $3`.
  Same at the table position (`Object.hasOwn(tables, "__proto__")`,
  `select "id", "note" from "app"."__proto__"`) and the function-export
  position (`client.fn["__proto__"]({ x: 7 })` → `select "app"."f2"($1)
  as "result"`, `[7]`) — with a table and a function both named
  `__proto__` in one contract. `contract-emit.test.ts` (passing).
- **What the description says under such a key reaches the contract** —
  OK. Description key `"__proto__": { key: "protoAlias", mode: "number"
  }` on a `bigint` column named `__proto__` → emitted `"protoAlias": {
  sqlName: "__proto__", typeNode: bigint, mode: "number" }`, `Row.
  protoAlias: number | null`, `where(eq(columns.protoAlias, 1))` →
  `"app"."posts"."__proto__" = $1`. `validate-export.ts:50-63`;
  `validate-export.test.ts` (passing).
- **A key that only looks dangerous is carried the same way** — OK.
  `constructor`, `prototype`, `hasOwnProperty`, `toString` (and `"42"`)
  each `Object.hasOwn === true` on the loaded metadata and on
  `client.posts.columns`; `select` lists `"c3"`, `"c4"`, `"c5"`, `"c6"`,
  `"42"`; `insert`/`update` carry them (above). The TypeScript
  write-literal consequence is now in the skill (N6).

schema-vendoring (MODIFIED — "The contract carries a typed function surface")

- **A scalar function crosses the boundary** — OK. `c.fn.add({ a: 1, b: 2
  })` → `select "app"."add"($1, $2) as "result"`, `[1, 2]`, resolves to
  the driver's `result`; `{ b: 2, a: 1 }` still sends `[1, 2]`
  (declared order, `fn.ts:249-262`). `tsc --strict` accepts `const r:
  Promise<number> = c.fn.add(…)`. Through `.as({ settings })` on a
  role-less driver: `select set_config($1, $2, true)` then the same
  invocation, for `add` and for `["__proto__"]`.
- **A table-returning function crosses the boundary** — OK. `select
  "42", "id", "title", "__proto__", "c2", … from "app"."list_posts"()`
  — explicit list, no `*` — resolving to the driver's rows; `tsc`
  accepts the rows typed with `protoAlias: number | null` and `"42":
  string | null`. Same through `.as()`.
- **A mismatched call fails the type check** — OK. `tsc --strict`
  (5.9.3, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`):
  missing argument, extra property on a fresh literal, wrongly typed
  argument, misspelled key on a fresh literal, and a scoped-handle
  missing argument each consumed a `@ts-expect-error`; a widened
  pre-built `{ a, b, c }` compiles (as the text says) and is the runtime
  check's job. From JavaScript, 0 statements sent across every refusal
  (recording driver): `{ a, c }` → `function-argument-unknown` naming
  `"c"` and `"a", "b"`; `JSON.parse('{"a":1,"bee":2}')` → same naming
  `"bee"`; `{ A, b }` → naming `"A"`; `JSON.parse('{"a":1,"__proto__":2}')`
  → naming `"__proto__"`; `{ a, b, c }` / `{ a }` / `{ a, [sym] }` /
  inherited `b` → `function-argument-count-mismatch`, text unchanged;
  `{ a, b, [sym] }` and a non-enumerable extra are accepted and send
  `[1, 2]`. Identical codes and messages through `.as(context)`, with no
  `set_config` sent before a refusal. `fn.ts:183-222`;
  `functions.test.ts` (passing).
- **A function returning an uncarried table is absent** — OK
  (`contract-emit.test.ts:311`, passing at this build; not re-measured
  end-to-end).
- **A synthesized trigger function is absent** — OK
  (`contract-emit.test.ts:283`, passing at this build).

### Method

- Build: `packages/cli/dist/cli.js` at `d5cda781`, mtime 23:13 the
  evening before (the lead's `pnpm build --force`); nothing rebuilt, no
  `pnpm install`/`build`/full `test`/`check-types`/`check:crap`. Node
  v26.7.0 (native type stripping loaded the vendored `contract.ts`
  directly), TypeScript 5.9.3 from the worktree's `node_modules`. No
  Postgres: `db.fn`/`select`/`insert`/`update` measurements used an
  in-memory recording driver (`execute` pushes the compiled statement
  and returns `[{ result: 3 }]`, or `[]` for the table-returning call;
  `transaction` runs the callback; `roleLessPlatform: true`), so "before
  any SQL is sent" is the recorded statement count.
- Throwaway projects under `<worktree>/_r2probe/` (deleted at the end;
  `git status --short` shows only this file), each with
  `node_modules/hejbro → <worktree>/packages/cli` and
  `node_modules/@hejbro/supabase → <worktree>/packages/supabase`, driven
  through the built CLI as a child process from the project directory.
- `init` matrix (25 projects, each followed by a `find` of the tree,
  exit code captured directly): trailing separators on both fields
  (single and double) with a file at the un-slashed path; a file two
  levels up for each field; both fields one path; each field naming
  `hejbro.config.ts`; a directory at `hejbro.config.ts`; a symlink to a
  file where the directory belongs; a symlink to a directory where the
  file belongs; a dangling symlink where the file belongs (`created
  snap.json`, written through to the symlink's target — noted, not a
  finding); a read-only parent for each field; a mode-000 parent;
  `../esc/*`; `/abs/mig`; `"."`; no configuration run twice then
  `generate`/`status`/`verify`; snapshot inside the migrations
  directory; the two nested-field orders; neither field; unresolvable
  import and invalid shape (each diffed against `generate`'s stderr).
- Vendoring: one declaring project (`posts` with `id`/`title`/`amount
  bigint`/`c2..c7`, `t2`, `add(a, b)`, `list_posts()`, `f2(x)`) →
  `hejbro init` + `generate --export` → committed to a local `git init`
  repository (plain contract); a copy whose `.hejbro/export/schema.json`
  was rewritten by a Node script (`Object.fromEntries`, never a literal
  `__proto__:` key): description key `__proto__` → `{ key: "protoAlias",
  mode: "number" }` on the snapshot column renamed `__proto__`; `c2` →
  key `__proto__`; `c3..c6` → `constructor`/`prototype`/`hasOwnProperty`/
  `toString`; `c7` → `"42"` (SQL name and key); table `t2` → `__proto__`
  (snapshot node key, `name`, and fact `tableName`); `f2`'s `exportName`
  → `__proto__`. Each consumer ran `hejbro link <path>` then `hejbro
  vendor` (the `__proto__` one twice, plus `vendor --check`). The emitted
  module was **loaded**, not string-matched: `node` imported
  `.hejbro/vendor/contract.ts` and inspected `Object.hasOwn`/`Object.keys`
  on `contractMetadata`, the client, `client.fn`, `client.posts.columns`
  and the scoped handle, then executed statements against the recording
  driver. `tsc --noEmit` ran over a typed probe importing the contract
  (`@ts-expect-error` for missing/extra/wrong-typed/misspelled arguments
  on both handles, a widened pre-built value, `__proto__`/`"42"` row
  fields, and a fresh `insert` literal against the `constructor` column).
- Targeted tests run at this build: `packages/cli` `init.test.ts` +
  `contract-emit.test.ts` + `validate-export.test.ts` (91 passed);
  `packages/query` `test/client/errors.test.ts` +
  `test/client/functions.test.ts` (19 passed).
