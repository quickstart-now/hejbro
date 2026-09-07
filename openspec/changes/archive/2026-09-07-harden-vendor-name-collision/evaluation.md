# D106 evaluation — harden-vendor-name-collision (round 1)

Context-free adversarial spec-only review of the delta
`openspec/changes/harden-vendor-name-collision/specs/schema-vendoring/spec.md`
(ADDED *Two carried tables with one SQL name are refused at emission*,
4 scenarios; MODIFIED *An existing table crosses the boundary*, 3
scenarios, one changed sentence) against the built public surface at
dev `a5accf59`. Read: the delta; the replaced requirement in
`openspec/specs/schema-vendoring/spec.md` and the four requirements the
delta names by title (*The schema filter is reserved, not silently
ignored*, *Each way vendoring can fail is named separately*, *Every
emitted key compiles*, *The contract names the relations the client
can follow*); `skills/hejbro/SKILL.md`, `references/polyrepo.md`,
`references/dsl-cheatsheet.md`, the first section of
`references/query-layer.md`; the CLI `--help` output; the built `.d.ts`
files (`existingTable`, `pgDriver`); the format example
`changes/archive/2026-09-06-add-vendored-related/evaluation.md`. Not
read: `proposal.md`, `design.md`, `tasks.md`, `.blackbox/`,
`packages/*/src`, `packages/*/test`, `examples/*/test`, any archive
proposal or design, issues, PRs, git log messages, changesets,
`docs/guide/`. One accidental exposure: the `awk` range that extracted
the replaced requirement also printed the requirement that follows it
in the main spec (*A database-sourced contract is marked and refused by
the checks that need a commit*); nothing from it was used beyond what
the brief itself asks for (`vendor --check` and `outdated` runs). A
session hook printed a list of blackbox folder numbers; not used.

## Method

Everything ran as a user would, through the built CLI
(`packages/cli/dist/cli.js`, reached as `node_modules/hejbro/dist/cli.js`
from scratch projects whose `package.json` links `hejbro`,
`@hejbro/core`, `@hejbro/query` and `@hejbro/pg` to the worktree) and
a real `postgres:17-alpine` (container `d106-nc-pg`, host port 55780,
`log_statement=all`, removed afterwards). The "before" CLI is the tree
of `a5accf59^` (`git archive`, so no git write in the worktree),
installed and built under `/private/tmp/d106-nc/before/`; only its
built CLI was used. The input table was written before the first run
(`/private/tmp/d106-nc/INPUT-TABLE.md`); the corpus stays under
`/private/tmp/d106-nc/`:

- `schema-a/` (declaring repository, `hejbro init`, five tagged
  commits, each with `generate --export`, all five migrations applied
  to database `decl`):
  - `c1` unique layout: `existingTable("auth","users")`, managed
    `app.profiles` (`authUserId` -> `auth.users`), `app.posts`
    (`authorId` -> `profiles`), `app.events` (`auditId` -> an
    `existingTable("audit","entries")` that is not exported).
  - `c2` collisions: `c1` plus `zeta.users` (declared before
    `app.users`), `shop.widgets` (declared before `app.widgets`),
    `app.users`, `app.widgets`, `app.orders` whose only relationship
    is `widgetId` -> `app.widgets`, and `fA = defineFunction(app,"f")`,
    `fB = defineFunction(shop,"f")` (one SQL name, two export names).
    `users` is in three schemas (existing `auth` beside managed `app`
    and `zeta`), `widgets` in two.
  - `c2b` the delta's own shape and nothing else: existing
    `auth.users` beside managed `app.users`, `profiles` -> `auth.users`,
    `posts` -> `app.users`.
  - `c2c` order probe: `widgets` (`shop` then `app`, both managed)
    declared first, `accounts` (existing `auth.accounts` beside managed
    `app.accounts`) declared later, the reserved word `order` in `app`
    and `shop`, unique `app.profiles` and `shop.lines` beside them.
  - `c3` the remedy: `app.users` -> `app.accounts`, `zeta.users` ->
    `zeta.members`, `shop.widgets` -> `shop.gadgets`; everything else
    of `c2` kept, including `fA`/`fB` and `orders` -> `app.widgets`.
- `schema-dup/`: `table(app,"users")` twice; `table(app,"Users")`;
  tag `ee` = `existingTable("auth","users")` beside
  `existingTable("legacy","users")`.
- `consumer-a/` (`link` + `vendor` of `c1`, committed; then `vendor`
  at `c2` (default branch), `vendor --ref c2b`, `vendor --ref c2c`,
  `vendor --check --strict`, `outdated`, `pull` into it, then `vendor`
  of `c3`), `consumer-before/` (same commits through the before CLI),
  `consumer-fresh/` (never vendored: `vendor --ref c2`, `pull`,
  `vendor --ref ee`).
- `consumer-pull/`, `consumer-pull-before/`: `hejbro pull --db-url
  <pulldb> --schema ...` over database `pulldb`, built with `psql`:
  `users` in `a`, `b`, `c`; `widgets` in `a`, `b`, `d`; `"order"` in
  `a`, `b`; `"my table"` in `a`, `b`; `"Users"` in `c` and `e`;
  `a.orders` (`widget_id` -> `a.widgets`), `b.only_b`; functions `f`
  in `a`, `b`, `e`.
- `evidence/`: every refusal's stdout and stderr as separate files,
  the vendored layouts before and after each refusal, the two runtime
  outputs, the contracts the before CLI emitted for the colliding
  inputs.

Runtime: `consumer-a/src/run.mts` (`createDb(pgDriver(url))`) and
`schema-a/src/run.mts` (`db({...}, pgDriver(url))`) ran the same six
reads on `decl` after `c3` (existing table read, `profiles.related({
authUser })`, `users.related({ profiles })`, `orders.related({ widget
})`, `fn.fA()`, `fn.fB()`) and their JSON outputs (SQL text, rows,
results) were diffed. Type level: `consumer-a/src/types-pass.ts` (8
positive assertions, `tsc --strict --exactOptionalPropertyTypes`
exit 0) and `src/types-neg.ts` (one negative probe).

Rows: 28 CLI invocations of `vendor`/`pull`/`link`/`vendor --check`/
`outdated` (13 refusals, 9 emissions, 6 other), 7 `generate`, 3
`migrate`, 12 server executions in the two runtime scripts, 8 positive
and 1 negative type assertions, 5 whole-contract `tsc` compiles, 12
byte comparisons against the before CLI.

## Blocking findings

None.

## Non-blocking findings

- **N1 — The two diagnostics head differently, and vendor's heading
  names one table as if it alone were the problem.** `vendor` prints
  `error[vendor-table-name-collision]: app.users` for `c2` (three
  `users` and two `widgets`), `error[vendor-table-name-collision]:
  app.accounts` for `c2c`, `error[vendor-table-name-collision]:
  auth.users` for `ee`: the heading subject is the first qualified
  table of the first colliding name. `pull` prints
  `error[pull-table-name-collision]: Tables` for every input. Sibling
  diagnostics put the offending identity there
  (`error[duplicate-identity]: table:app.users`,
  `error[vendor-ref-not-found]: 2059a88`). The delta only asks that the
  message name every colliding name, which both do in the body; the
  vendor heading nonetheless reads as "`app.users` is wrong" when the
  fix may equally be `zeta.users`. Disposition: fix (heading = the
  colliding SQL names, or the same subject on both commands). Evidence:
  `evidence/vendor-c2.stderr`, `evidence/vendor-c2c.stderr`,
  `evidence/pull-ab.stderr`.
- **N2 — A refused `pull` prints no loss report.** `pull --schema a`
  (success) reports `Omitted: table "a.my table" -- its catalog name is
  not a valid hejbro SQL identifier ...`; `pull --schema a --schema b`
  (refused) prints only the collision, so the reader does not learn
  that a second same-named pair (`a."my table"`, `b."my table"`) was
  dropped from the payload before the collision was decided, nor that
  `e."Users"` is not carried (`--schema a --schema e` says so only on
  success). Consistent with "decided on the SQL name exactly as the
  payload carries it" (the payload does not carry them), and the loss
  surfaces on the next successful run. Disposition: docs or by design.
  Evidence: `evidence/pull-a.stdout`, `evidence/pull-ab.stdout` (empty),
  `evidence/pull-ae.stdout`.
- **N3 — "never on a normalized form" has no reachable counter-input.**
  Every name whose normalization could differ from its raw form is
  stopped before the emitter: `table(app, "Users")` fails declaration
  with `invalid-sql-name` (`^[a-z][a-z0-9_]*$`), and `pull` omits
  `c."Users"`, `e."Users"` and `"my table"` as not valid hejbro SQL
  identifiers. What could be observed: `a.users` + `c.users` is
  refused naming `("a"."users", "c"."users")` only, with `c."Users"`
  in the same schema list and absent from the message; `--schema a
  --schema e` emits `users` from `a` with `e."Users"` omitted. The
  sentence holds on every payload the two commands can build, but no
  input can tell "raw" from "normalized" apart. Disposition: by design
  (record that the identifier rule, not the emitter, is what makes the
  sentence vacuous). Evidence: `evidence/pull-ac.stderr`,
  `evidence/pull-ae.stdout`, `schema-dup` `generate --name upper`.
- **N4 — `pull --schema a --schema a` is accepted and recorded
  twice.** Exit 0, `pulled pulldb (a, a)`, `hejbro.lock` `schemas:
  ["a", "a"]`, `contractMetadata.schemas: ["a", "a"]`, one `users`
  carried (the same catalog table is read once, so no collision
  fires). "The same name in the same schema" is otherwise impossible:
  Postgres refuses `create table a.widgets` twice (`42P07`), and the
  DSL refuses two `table(app, "users")` with `duplicate-identity`.
  Outside the delta. Disposition: fix (dedupe or refuse the repeated
  flag) or won't fix. Evidence: `evidence/pull-aa.stdout`,
  `consumer-pull` run in the transcript.
- **N5 — `vendor --ref <commit sha>` does not resolve on a local-path
  source.** `--ref 2059a88` and the full 40-character sha both fail
  with `vendor-ref-not-found` ("does not resolve to anything on
  `/private/tmp/d106-nc/schema-a`"); a tag on the same commit works.
  `vendor --help` says "resolve one specific ref". Vendoring neighbour,
  not this delta. Disposition: docs (say "branch or tag") or fix.
  Evidence: transcript of `consumer-a` before the tags existed.
- **N6 — "Function keys are not affected" is vacuous for `pull`.**
  `pull` carries no functions at all (`Not inferred: 1 function(s) not
  inferred`, `Functions: {}`, `functions: {}`) for `a`, `b`, `e`. For
  `vendor` the sentence is real: `c3` carries `fA` (`app.f`) and `fB`
  (`shop.f`) side by side, `c2`'s refusal lists tables only, and both
  functions return `1` and `2` through the vendored client.
  Disposition: by design. Evidence: `evidence/pull-a.stdout`,
  `evidence/consumer-a-c3-vendor/contract.ts`,
  `evidence/consumer-c3-run.json`.
- **N7 — The collision list is one unwrapped line.** The body line is
  414 characters for `c2`, 474 for `c2c`, 388 for `pull --schema a
  --schema b --schema c`, all semicolon-separated; sibling diagnostics
  (`ambiguous-table-rename`, `ambiguous-column-rename`) wrap at ~72
  columns and put each item on its own line. Readable for two names,
  a wall for three names across three schemas. Disposition: fix
  (cosmetic) or won't fix. Evidence: `evidence/vendor-c2.stderr`,
  `evidence/vendor-c2c.stderr`, `evidence/pull-abc.stderr`.

## Scenarios verified

Unless stated, "refused" means exit code 1, an empty stdout, the
diagnostic on stderr, `ls` of `.hejbro/vendor/` and `hejbro.lock`
showing the same mtimes and sizes as before, `git status --short`
empty, and `cmp` of `contract.ts`, `schema.json`, `snapshot.sql` and
`hejbro.lock` against the copies taken before the run reporting no
difference.

1. **vendor refuses the Supabase layout** — `consumer-a`, `vendor
   --ref c2b` (existing `auth.users` beside managed `app.users`):
   refused with `vendor-table-name-collision`; body: `the carried
   tables hold more than one table named "users" ("app"."users",
   "auth"."users"). Next: --schema is reserved on vendor, so the export
   itself must carry one table per SQL name; that is the declaring
   repository's to change.` Names `users` with both qualified tables,
   says the filter is reserved, says one table per SQL name. The `c1`
   layout on disk stayed byte-identical and the lock unchanged. In
   `consumer-fresh` (never vendored) `vendor --ref c2` created no
   `.hejbro/` and no lock (`ls -a` shows only `hejbro.json` from
   `link`). Existing beside existing (`ee`: `auth.users` +
   `legacy.users`) is refused the same way.
2. **pull refuses and names its filter** — `consumer-pull`, `pull
   --db-url <pulldb> --schema a --schema b`: refused with
   `pull-table-name-collision`; body names `"widgets" ("a"."widgets",
   "b"."widgets")` (and `order`, `users`, which the database also
   holds in both), ends `Next: drop one of the schemas from --schema
   and rerun hejbro pull.` Nothing written in a fresh repository
   (`.hejbro/vendor: No such file or directory`), nothing modified in a
   repository that had pulled before (`consumer-pull`, clean tree
   before and after) or vendored before (`consumer-a`, `c1` layout
   byte-identical).
3. **Every collision is named at once** — `vendor` at `c2` (`users` in
   `app`, `auth`, `zeta`; `widgets` in `app`, `shop`): one diagnostic,
   `more than one table named "users" ("app"."users", "auth"."users",
   "zeta"."users"); more than one table named "widgets"
   ("app"."widgets", "shop"."widgets")`. `pull --schema a --schema b
   --schema c`: `"order" ("a"."order", "b"."order"); "users"
   ("a"."users", "b"."users", "c"."users"); "widgets" ("a"."widgets",
   "b"."widgets")`. Identity order is sorted order, not declaration or
   flag order: `c2` declares `zeta.users` first and the existing
   `auth.users` before both, yet prints `app, auth, zeta`; `c2c`
   declares `widgets` before `accounts` yet prints `accounts, order,
   widgets`; `--schema b --schema a` and `--schema c --schema b
   --schema a` print exactly the `a b (c)` text. The reserved word
   `order` collides and is named like any other.
4. **A unique-name layout is unchanged** — `c1` and `c3` vendored
   through the shipped CLI and the before CLI (`a5accf59^`):
   `contract.ts`, `schema.json`, `snapshot.sql`, `hejbro.lock` and
   `hejbro.json` all `cmp`-identical (`c3` carries nine tables, one
   existing, and two functions). `pull --schema a` and `pull --schema
   c --schema d` (unique across the named schemas) through both CLIs:
   the four files `cmp`-identical. The before CLI on the colliding
   inputs emits what the change now refuses: three top-level `"users"`
   entries for `c2`, two for `pull --schema a --schema b`
   (`evidence/before-vendor-c2-contract.ts`,
   `evidence/before-pull-ab-contract.ts`), so the refusal is new and
   the unchanged layouts are unchanged.
5. **"before any file is written" across a second commit** —
   `consumer-a` vendored `c1`, then the declaring repository moved to
   `c2`: `hejbro vendor` refused, the `c1` layout stayed
   byte-identical, `vendor --check --strict` printed `up to date`
   (exit 0), `outdated` printed `a newer commit is available: 1c22e29
   (main), vendored at 1d29656. Next: run hejbro vendor to update.`
   (exit 0).
6. **A collision the database holds but `--schema` does not name does
   not fire** — `pull --schema a` (with `b.widgets`, `d.widgets`,
   `b.users`, `c.users` in the database) and `pull --schema b`
   (with `a.widgets`, `d.widgets`) both exit 0 and write the layout.
7. **A table whose only relationship is a foreign key onto the
   colliding pair** — `app.orders` -> `app.widgets` at `c2` is refused
   with the rest; after the remedy (`c3`) `orders.related({ widget:
   true })` reads `{ id: 3000..., label: "W1" }` through the vendored
   client, SQL identical to the declaring side's.
8. **vendor's Next followed to the end** — the declaring repository
   renamed `app.users`, `zeta.users`, `shop.widgets` (`c3`, `generate
   --export`, committed); `hejbro vendor` in `consumer-a` then printed
   `vendored becdf44 (main)`, the contract compiled under `tsc
   --strict --exactOptionalPropertyTypes`, `vendor --check --strict`
   is `up to date`.
9. **pull's Next followed to the end** — after the `--schema a
   --schema b` refusal, `pull --schema a` printed `pulled pulldb (a)`
   and wrote the four files; `pull --schema a --schema e` likewise.
10. **Each command has its own code** — `vendor-table-name-collision`
    (5 inputs) vs `pull-table-name-collision` (7 inputs); never the
    other's code, never a member of the eleven (`polyrepo.md` and
    `SKILL.md` still say "eleven"; `polyrepo.md` documents both codes
    and both remedies in the words measured here).
11. **Function keys are not affected** — `c3` contract: `Functions`
    keys `fA`, `fB`, metadata `schema: "app", name: "f"` and `schema:
    "shop", name: "f"`; `fA()` = 1, `fB()` = 2 on both sides (N6 for
    `pull`).
12. **MODIFIED: A consumer reads a platform-owned table** — `c3`:
    `users` (`auth`, `existing: true` in the metadata) is a `Tables`
    entry with `Row { id: string; email: string | null }`
    (`types-pass.ts`), `c.users.select()` compiles to `select "id",
    "email" from "auth"."users"` and returns the two seeded rows;
    `profiles.Relations.authUser` is `{ target: "users"; mode: "one"
    }` and `users.Relations.profiles` is `{ target: "profiles"; mode:
    "many" }`.
13. **MODIFIED: A consumer joins a platform-owned table** —
    `c.profiles.select().related({ authUser: true })` types `authUser`
    as `T["users"]["Row"] | null`; rows: `pr1` carries `{ id: 0000...1,
    email: "u1@auth" }`, `pr2` carries `null`; the statement is the
    correlated `row_to_json` subquery and is byte-identical to the
    declaring side's (`diff evidence/consumer-c3-run.json
    evidence/declaring-c3-run.json` empty, all six reads).
14. **MODIFIED: An undeclared table still has no relation** —
    `events.Relations` is `{}` at `c1` and `c3`; `.related` is absent
    at the type level (`TS2339` in `types-neg.ts`) while the forwarded
    JS chain still has the member (`"related" in c.events.select()` is
    `true` on both sides), as the base requirement describes.
15. **MODIFIED: the changed sentence** — the pair it names (existing
    `auth.users` beside managed `app.users`) is refused before the
    contract is written (scenario 1), and the sentences it scopes hold
    for the unique-name existing table (12 to 14).

## Verdict

**ARCHIVE** — no blocking finding; seven non-blocking findings (N1 to
N7). Every delta sentence held on the input table: 13 refusals across
both commands with the right code, every colliding name and every
qualified table in sorted identity order, nothing written or modified
in fresh, vendored and pulled repositories, both `Next:` paths followed
to a successful emission, and the unique-name layouts byte-identical to
the pre-change CLI's output for `vendor` and `pull` alike.
