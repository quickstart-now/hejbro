# D106 evaluation — add-references-actions (round 1)

## Method

Context-free, spec-only. The only contract text read was the delta
`openspec/changes/add-references-actions/specs/table-declaration/spec.md`
compared line by line against the base requirement in
`openspec/specs/table-declaration/spec.md` (`### Requirement: Column-level
foreign keys are declared with references`). No proposal, design, tasks,
`.blackbox/`, package `src/` or `test/`, PR or issue text was read. The
worktree is dev `6ff7b7fb`, built fresh (`pnpm install --frozen-lockfile
&& TURBO_FORCE=1 pnpm build --force`); the public surface was exercised
as a user — `hejbro` / `@hejbro/core` imports resolved through
`examples/postgres/node_modules`, the built `hejbro` CLI, `skills/hejbro`
and `examples/postgres`. (The repo's `Read` deny rule on `dist/` was
respected; the type axis was read through `tsc` error output instead of
the `.d.ts` files.)

Two axes, every delta sentence turned into an input table:

1. **Type axis** — `tsc --strict` with `exactOptionalPropertyTypes` and
   `noUncheckedIndexedAccess` (the repo's own base settings), probe files
   asserting accept/reject per row.
2. **Artifact + server axis** — the same intent declared through the
   column form and the `extras.foreignKeys` form, then `generateMigration`
   SQL, `renderSnapshot` JSON, diff transitions and `--rename` retargets
   compared **byte for byte**; every rendered DDL applied to a fresh
   `postgres:17` (container `d106-ra-pg`, port 55620) and read back from
   `pg_constraint.confdeltype`/`confupdtype`. The CLI path
   (`hejbro init` + `hejbro generate`) was run on two throwaway projects,
   one per form, and their migration files and snapshots diffed.

Row counts: **36 type-axis assertions** (14 accept, 22 reject — incl. 3
on the `extras` form for symmetry, 2 type-equality, 3 `related()`
derivation); **180 server executions** (36 initial applies + 140 live
action transitions + 1 cross-schema apply + 3 out-of-vocabulary strings)
plus the example's full round trip; **~5,300 in-process byte
comparisons** (36 initial parity rows, 1,296 transition pairs × 4 form
pairings = 5,184, 12 rename rows, 9 repeated-call rows, 15 runtime edge
rows, 2 mixed-order rows, 3 thunk rows, 2 circular-import rows, 1
committed-snapshot row, 3 CLI rows).

## Blocking findings

None.

## Non-blocking findings

1. **Stale user-facing doc line (`skills/hejbro/SKILL.md:20`).** It still
   reads "the foreign keys `.references()` cannot express (self-referencing,
   composite, `onDelete`/`onUpdate` actions) are declared inline on
   `table(...)`'s extras". The delta ("`.references()` SHALL accept an
   optional second argument naming the referential actions") and the
   cheatsheet (`dsl-cheatsheet.md:92,104-107`) say the opposite. The
   skill is the documented user contract; this line contradicts it.
2. **No runtime vocabulary check on either form (neighbor, symmetric).**
   With types bypassed (plain JS caller), an out-of-vocabulary string is
   rendered verbatim into DDL by both forms: `onDelete: "CASCADE"` →
   `on delete CASCADE` (server accepts — keyword is case-insensitive,
   catalog `c`); `"set-null"` → server `ERROR:  syntax error at or near
   "-"`; `""` → `on delete ;` → `ERROR:  syntax error at or near ";"`;
   `0` → `on delete 0`; `null` is treated as absent. The `extras` form
   behaves identically, so the delta's "same action vocabulary the
   `extras` form accepts" holds on both axes (the type axis refuses every
   such row on both forms with the same TS2322/TS2820 message). Recorded
   because the delta names a vocabulary and the runtime enforces none.
3. **Column-form self-reference is not refused, only unsupported.**
   `parent: uuid().references(() => selfRef.id, {...})` is rejected by
   TypeScript with TS7022/TS7024 (implicit `any` from a self-referencing
   initializer) — a TypeScript inference artifact, not a hejbro-authored
   refusal — and at runtime it emits a valid self-referencing foreign key
   with its actions (`references "app"."s" ("id") on delete cascade`).
   The delta says self-referencing keys "live on the `extras` path", not
   that the column form refuses them, so no contradiction; the sentence
   could say which it means.
4. **Explicit `undefined` is refused at the type level under
   `exactOptionalPropertyTypes`** — `{ onDelete: undefined }` fails
   TS2379 on the column form and TS2345 on the `extras` form alike
   (symmetric); at runtime an explicit `undefined` equals absence and
   both forms stay byte-identical. Consistent with `{ onDelete?,
   onUpdate? }`; noted only because the delta writes the options with
   `?` and a user on the repo's own tsconfig cannot pass `undefined`.
5. **"Quoted identifiers" is not a reachable input class.** `schema("Core
   Data")` fails at declaration with `invalid-sql-name` (names must match
   `^[a-z][a-z0-9_]*$`), so the brief's quoted-identifier row collapsed to
   a snake_case cross-schema row (verified, see below).
6. **Contract prose carries an issue pointer.** The scenario "A repeated
   reference replaces target and actions together" ends with "whether a
   repeated call should be refused instead is open in #972". Harmless,
   but it is the only scenario in the file whose THEN clause is
   conditional on an open issue.

## Scenarios verified

**A column-level reference carries referential actions** — input table
`{onDelete, onUpdate} ∈ {absent, cascade, restrict, set null, set default,
no action}²` (36 rows): column form vs `extras` form → identical `sql`
bytes, identical `renderSnapshot` bytes, the `on delete`/`on update`
clauses present exactly when named (absent key → no clause). Snapshot
tokens are `"onDelete"`/`"onUpdate"` with the action string verbatim.
All 36 DDLs applied to `postgres:17`; `confdeltype||confupdtype` matched
the expected code (`a`/`r`/`c`/`n`/`d`) on every row; absent and
`no action` both read back `a`. **Transitions**: every ordered pair of
the 36 combos (1,296), generated four ways (column→column,
extras→extras, extras-snapshot→column, column-snapshot→extras): all four
SQL strings identical, snapshots identical, same-combo pairs report
`hasChanges: false` on every pairing (so converting a form changes
nothing), and every differing pair renders exactly `drop constraint
"posts_owner_id_fk"` + `add constraint … foreign key …`. 140 of those
transitions were applied live (each combo → 4 targets) and the catalog
reflected the new actions every time; 0 server errors.

**A repeated reference replaces target and actions together** — rows:
actions→none across targets (`a`→`b`), none→actions, different actions on
the same target, the same call twice, a builder call (`.notNull()`)
between two calls, three calls, `{}`/explicit-`undefined` arguments. In
every row the emitted key targets the last call's column and carries
exactly the last call's actions, byte-identical to the `extras` form
written from the last call alone; "actions→none" leaves no clause.

**The example's foreign keys convert without moving a byte** —
`hejbro verify`: `5 checks passed (10 migrations, snapshot
sha256:88394459665c…)`; live `src/app.schema.ts` declarations against the
committed `hejbro.snapshot.json`: `hasChanges: false`, re-rendered
snapshot equals the committed file byte for byte (26,357 bytes, 8 action
lines); `examples/postgres` vitest (chain/cli/query): 4 passed; round
trip (`scripts/roundtrip.sh . seed/roles.sql`, `HEJBRO_PG_IMAGE=postgres:17`):
`round-trip OK: 195 dump lines identical`, exit 0; `git status
--porcelain` clean apart from this file.

**Same DDL as extras / mixed-form canonical order** (with actions on
both keys): a table with `teamId` (`restrict`) and `ownerId`
(`cascade`/`set null`) declared column+column, column+extras, and
extras+extras → identical SQL and snapshots, keys emitted sorted by local
column (`owner_id` before `team_id`). Cross-schema target
(`app_v2.order_items.owner_ref` → `core_data.user_accounts.user_id`,
`set null`/`cascade`): both forms identical, applied, catalog
`order_items_owner_ref_fk:nc:core_data.user_accounts`.

**Renames retarget identically** (`renames:` on `generateMigration`, all
four form pairings byte-identical, actions preserved in the snapshot):
target table `users→accounts` (rename + `users_pkey→accounts_pkey`,
snapshot key keeps `set null`/`cascade`); local column
`owner_id→author_id` (`rename column` + constraint rename to
`posts_author_id_fk`, actions preserved); referencing table
`posts→articles` (constraint renamed `articles_owner_id_fk`).

**The reference survives to the type level** — the table type with
`{ onDelete: "cascade", onUpdate: "set null" }` is type-identical to the
one without actions and to the one after a repeated call (mutual
assignability check), and `db(...).select(comments).related({ post: true })`
/ `.select(posts).related({ comments: true })` type the nested rows over
an FK column carrying actions, while an unknown relation key is a
compile error (`tsc` exit 0 with the `@ts-expect-error` consumed).

**Type-axis accept/reject** — accepted: no second argument, `{}`,
`onDelete` alone, `onUpdate` alone, both, `foreignKeyActions[0]`, a
`const` object, `undefined` literal argument, chaining before/after
`.notNull()`/`.unique()`. Rejected with the printed vocabulary
`"cascade" | "restrict" | "set null" | "set default" | "no action"`:
`"CASCADE"`, `"set-null"`, `"setNull"`, `"delete"`, an extra property,
`null` argument, a bare string argument, `onDelete: null`, a third
argument (TS2554 "Expected 1-2 arguments"), a `string`-typed value,
`name:` in the options, target of another type family (`text` → `uuid`,
`uuid` → `integer`), a non-thunk target, an array target.
`foreignKeyActions` is `readonly ["cascade", "restrict", "set null",
"set default", "no action"]`.

**Thunk laziness with an actions argument** — thunk count after
`table()`: 0; after three generate reads: 1; a throwing first read
followed by a retry: 2 (nothing cached), and the retry emits the key
with its `on update cascade`. **Circular imports with actions** — two
files referencing each other (`a.bId → b.id set null`, `b.aId → a.id
cascade`) generate the same two keys under either load order.

**Duplicate declaration with actions on both sides** — throws at
`table()`: `table "d" column "o" declares .references() and is also
named in an extras foreign key — the constraint would emit twice. Next:
keep exactly one of the two declarations for "o".`

**CLI path** — two throwaway projects (`hejbro init`, `hejbro generate`),
column form vs `extras` with `set default`/`no action`: migration files
and snapshots byte-identical (same snapshot hash
`sha256:f47bb9d2…`); dropping the actions from the column form and
generating again wrote `0002_alter_posts.sql` with the drop-and-add pair.

## Verdict

**ARCHIVE** — 0 blocking findings, 6 non-blocking (one stale doc line in
`skills/hejbro/SKILL.md:20` worth fixing before or at archive; the rest
are neighbors the delta is silent on or wording notes).
