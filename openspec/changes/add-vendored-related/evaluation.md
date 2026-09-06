# D106 evaluation — add-vendored-related (round 1)

Context-free adversarial spec-only review of the delta
`openspec/changes/add-vendored-related/specs/schema-vendoring/spec.md`
(MODIFIED *An existing table crosses the boundary*, ADDED *The contract
names the relations the client can follow*, 9 scenarios) against the
built public surface at dev `3b7e0d60` (PR #1011 merged). Nothing under
`proposal.md`/`design.md`/`tasks.md`, `.blackbox/`, `packages/*/src`,
`packages/*/test`, PR or issue bodies, or git log messages was read.

## Method

Two real repositories and a real `postgres:17-alpine` (container
`d106-vr-pg`, host port 55710, removed afterwards), driven only through
the built CLI (`packages/cli/dist/cli.js`) and the built packages,
exactly as a user would. Inputs are left under `/private/tmp/d106-vr/`:

- `schema-a/` — the declaring repository (`hejbro init` → declarations →
  `generate --export` → `migrate`, two commits). Its declarations are
  the input table for every universal claim in the delta, one probe per
  rule: single-column FK whose key ends in `Id` (`posts.authorId`), one
  whose key does not (`comments.writer`), reverse edges from other
  carried tables, a composite FK (`memberships(org_id,user_id)` →
  `team_seats`), an FK onto a table the export does not carry
  (`events.auditId` → a non-exported `existingTable("audit","entries")`),
  a self-referential FK alone (`categories.parentId`) and beside another
  FK (`employees.managerId` + `employees.deptId`), a stripped key that
  names one of the table's own columns (`tags.ownerId` + column
  `owner`), a key that would be both forward and reverse (`a.bId` ↔
  `b.aId`), two FKs from one table onto one target (`reviews`),
  `Object.prototype` names as relation keys (a table named
  `constructor`; a column `valueOfId`), an exported
  `existingTable("auth","users")` referenced by `profiles.authUserId`,
  and — at commit 1 — a managed `app.users` beside that `auth.users`
  (renamed to `app.accounts` at commit 2 so the rest of the corpus
  compiles; see B1). RLS policies keyed on `current_setting('app.tenant')`
  for role `app_reader` on `posts` and `accounts`. A column key of exactly
  `Id` is unreachable: `table()` refuses its SQL name `_id`
  (`invalid-sql-name`) before any contract exists.
- `consumer-a/` — `hejbro link` + `hejbro vendor` of commit 2 (and,
  as evidence, commit 1), `tsc --strict --exactOptionalPropertyTypes`
  over `contract.ts`, 39 positive type assertions (`src/types-pass.ts`),
  25 isolated negative type probes (`src/neg/*.ts`, one file each so the
  exact TS code is observed), and `src/run-compare.ts`: 36 `related()`
  cases (13 spec shapes, `.where()`/`.orderBy()`/`.limit()` stages,
  three under `client.as({ role: app_reader, settings: { "app.tenant":
  "t1" } })`, 17 guard/edge cases) each compiled and executed against the
  seeded database. The identical 36 cases ran on the declaring side
  (`schema-a/src/run-compare.ts`, `db(...)` over the same tables) and
  the two JSON outputs (SQL text, parameters, rows, error codes and
  messages) were diffed: `evidence/consumer-compare.json` vs
  `evidence/declaring-compare.json`. Postgres `log_statement=all` was
  on during both runs; the per-side statement sequence for the scoped
  cases is in `evidence/*-scoped-statements.log`.
- `consumer-pre/` — the contract emitted by the pre-`Relations` CLI
  (a detached worktree at `0c972860`, built, used, removed) for the same
  commit 2, consumed by the current runtime.
- `consumer-pull-app/`, `consumer-pull-both/` — `hejbro pull --db-url …
  --schema app` (auth.users not carried) and `--schema app --schema auth`
  (carried), the same checks.
- `docs-illustrative/` — the illustrative contract block from
  `docs/guide/polyrepo.md` compiled verbatim; the `polyrepo.md` skill
  snippet compiled and run inside `consumer-a`.

Execution rows: **70 type-level rows** (39 positive assertions across
`types-pass.ts`/`pre-pass.ts`/declaring `probe-stages.ts`, 31 negative
or probe files) plus 6 whole-contract `tsc --strict` compiles; **16 CLI
invocations** (init, generate ×2, migrate ×2, link ×3, vendor ×5,
vendor --check, pull ×2); **84 server executions** (36 cases × 2 sides
+ 12 further scripted reads/guards).

## Blocking findings

### B1 — Two tables with one SQL name in two schemas: the existing table is not exposed, the contract does not compile, and the relation onto it throws

**Delta sentences contradicted** (MODIFIED requirement, paragraph 1
and 2; scenario *A consumer reads a platform-owned table*):
"The name-keyed client SHALL expose it for reading like any other
table, and a managed table's foreign key onto it SHALL resolve to a
relation in the contract exactly as one onto a managed table does";
"a managed table's relation onto an existing table SHALL be followable
exactly as one onto a managed table is". ADDED requirement: "`target`
the `Tables` key of the related table".

**Input** (`schema-a` commit `d24b1bf`, the `existingTable("auth",
"users")` of the delta's own scenario beside a managed `app.users` —
the everyday Supabase layout — with `profiles.authUserId → auth.users.id`
and `posts.authorId → app.users.id`). `hejbro vendor` succeeds and
writes `contract.ts`; saved as
`evidence/contract-a-commit1-dup-users.ts`.

**Actual output**:

- The `Database` interface carries `"users"` twice (lines 30 and 424)
  and `contractMetadata.tables` carries `"users"` twice (482, 658).
  `tsc --strict`: `TS2300: Duplicate identifier 'users'` ×2, `TS2717:
  Subsequent property declarations must have the same type`, `TS1117:
  An object literal cannot have multiple properties with the same
  name`. The contract does not compile — no consumer program can.
- At run time the object literal's last `"users"` wins:
  `Object.keys(contractMetadata.tables)` lists one `users`,
  `client.users.select().compile().sql` is `select … from
  "app"."users"`, and `auth.users` is reachable through no member of
  the client.
- `client.profiles.select().related({ authUser: true })` throws
  `HejbroError: the foreign key on "profiles" references
  "auth"."users", which is not in this db()'s schema map` — while the
  same contract's text names `authUser: { target: "users"; mode: "one" }`
  on `profiles` and `profiles: { target: "profiles"; mode: "many" }`
  on the *first* `users` entry (the existing one), so `target: "users"`
  identifies two tables.

**Provenance**: the pre-`Relations` CLI (`0c972860`) emits the same
duplicate keys for the same commit
(`evidence/contract-old-commit1-dup-users.ts`, two top-level `"users"`
entries), so the root is the `Tables`-keyed-by-SQL-name rule the base
spec documents ("`Tables` is keyed by the table's own SQL name",
`skills/hejbro/references/polyrepo.md`) and the base requirement
*Every emitted key compiles* ("so that a contract compiles whatever the
export carries") is already contradicted by this input. It is not
introduced by this change. It is reported as blocking because the
delta's MODIFIED requirement re-asserts the sentences above for exactly
this table (`auth.users`) and the ADDED requirement makes `target` the
sole way a consumer resolves a relation's table; if the lead rules that
same-SQL-name tables across schemas are outside this change (a
schema-vendoring keying defect to fix elsewhere), the delta should say so
in the requirement text, since its scenario reads as covering the usual
`auth.users` + `<app>.users` layout.

## Non-blocking findings

- **N1 — A prototype-named relation key makes every spec that omits it
  fail to type-check, on both sides.** With `constructor` in
  `accounts`'s map, `client.accounts.select().related({ posts: true })`
  is `TS2345 … Types of property 'constructor' are incompatible. Type
  'Function' is not assignable to type 'true'` (the same for
  `departments.related({ employees: true })`, and for `valueOf` on the
  `constructor` table: `Type '() => Object' is not assignable to type
  'true'`); `{ posts: true, constructor: true }` compiles. The declaring
  side's own `RelatedSpec` (`db({ constructor: ctor, … })`) fails
  identically (`schema-a/src/probe-ctor.ts`), so the "exactly the
  declaring side's" parity holds, but the sentence "SHALL offer
  `.related(spec)` on the whole-table select of every table whose map is
  non-empty" is overstated for such a map — the member exists, no spec
  short of naming every prototype key is accepted. TypeScript's own
  rule, the same family the skill already documents for insert/update
  literals on columns named `constructor`/`toString`/`hasOwnProperty`;
  extending that caveat to relation keys (i.e. table names and
  `<name>Id` column keys) in `polyrepo.md` would close the gap.
- **N2 — `unknown-relation` message text differs for an uncarried
  target.** Case 32 (`events.related({ audit: true })` past the types):
  both sides throw code `unknown-relation`; the consumer's message is
  `"audit" is not a derivable relation of "events" — …`, the declaring
  side's (a `db()` whose map lacks `audit.entries`) is `the foreign key
  on "events" references "audit"."entries", which is not in this db()'s
  schema map …`. The delta's "meets exactly the declaring side's own
  behaviour" holds at the code level only. This was the sole diff line
  between the two 36-case outputs.
- **N3 — A string spec type-checks on both sides.**
  `related("author")` compiles against both `RelatedSpec` shapes
  (`Partial<Record<K, true>>` accepts a primitive) and throws
  `unknown-relation: "0" is not a derivable relation` at run time. The
  delta is silent; parity holds.
- **N4 — `{ posts: false }` is refused by the types (`TS2322: Type
  'false' is not assignable to type 'true'`) but the runtime treats it
  as `true`** (rows carry `posts`), on both sides. Delta silent.
- **N5 — `hejbro link ../schema-a` (a relative local path, documented
  as first-class in `docs/guide/polyrepo.md` and the skill) fails at
  `hejbro vendor` with `error[vendor-remote-unreachable]`**: the fetch
  runs as `git -C <tmpdir> fetch … ../schema-a <sha>`, so the relative
  path is resolved against the temporary directory. An absolute path
  works. Vendoring neighbour, not this delta.
- **N6 — `docs/guide/polyrepo.md` still says "Not built here: a
  database-fallback path (`pull --db-url` …) is tracked separately
  (#604) and does not exist yet"** while `hejbro pull` exists and the
  skill's `polyrepo.md` documents it. Stale sentence, outside the
  delta.
- **N7 — Declaring-side neighbour**: two tables that `.references()`
  each other (`a.bId → b.id`, `b.aId → a.id`) make the declaring schema
  itself fail `tsc --strict` with `TS7022: 'a' implicitly has type
  'any' because it … is referenced directly or indirectly in its own
  initializer` (and `TS7024`). The export, contract and runtime are
  unaffected (the contract compiles and emits `{}` for both, as the
  delta requires).
- **N8 — `.d.ts` comment vs behaviour**: `NameKeyedRelatedResult`'s
  doc says a `target` outside `TTables` "yields no field"; the type
  yields a field of type `never`. Not reachable from an emitted contract.

## Scenarios verified

Evidence in `/private/tmp/d106-vr/evidence/` and the probe files named
above; "both sides" means the consumer's output was byte-identical to
the declaring side's for SQL, parameters, rows and error code.

1. **A consumer reads a platform-owned table** — commit 2: contract
   carries `profiles.authUser → users` (`auth.users`, marked `existing:
   true`) and `users.profiles`; `c.users.select()` rows type as
   `{ id: string; email: string | null }`; `c.profiles.select().related({
   authUser: true })` rows carry `authUser.email = "u1@auth"`, and
   `c.users.select().related({ profiles: true })` carries `["PR1","PR2"]`
   (cases 06/07, both sides). Same through `pull --schema app --schema
   auth`. **Fails for the same-name input — B1.**
2. **A consumer joins a platform-owned table** — case 06 SQL is the
   declaring side's correlated `row_to_json` subquery byte for byte;
   `authUser` types as `T["users"]["Row"] | null` (`types-pass.ts`).
3. **An undeclared table still has no relation** — `events` emits
   `Relations: {}` under `vendor` and under `pull --schema app`
   (`profiles` too, there); `.related` absent (`TS2339`).
4. **A forward relation reads one parent** — `author` types as
   `T["accounts"]["Row"] | null` and the row is `Row & { readonly
   author: … }`; three rows carry `a1@x`, `a2@x`, `a2@x` (case 01);
   `rows[0]!.author.email` is `TS2531` (nullability is real).
5. **A reverse relation reads many children** — `posts` types as
   `ReadonlyArray<T["posts"]["Row"]>`; `A1 → ["P1"]`, `A2 → ["P2","P3"]`
   (case 04); an empty collection arrives as `[]` (case 02).
6. **A key the contract does not name is refused** — type layer:
   misspelling `TS2561`, composite column `user` `TS2353`, composite
   reverse on `team_seats`/`memberships` `TS2339`/`TS2353`, uncarried
   `audit` `TS2339`, column collision `owner` `TS2339` (no member),
   non-`Id` key `writer` `TS2353`, valid+unknown `TS2322`, scoped
   handle on an empty-map table `TS2339`. Runtime past the types (both
   sides): `autor`/`user`/`team_seats`/`memberships`/`audit` →
   `unknown-relation`; `owner`/`writer`/`authorId` →
   `ambiguous-relation`; `a{b}`, `b{a}` resolve along the forward edge
   (`row_to_json`), `employees{manager}`/`{employees}`,
   `categories{parent}`/`{categories}` resolve along the declaring
   side's own self edge with the same SQL and the same rows (the
   uncorrelated self-join rows are #1003's, identical on both sides,
   not flagged).
7. **A self-referential foreign key names no relation** —
   `categories: {}`; `employees: { dept }` only, `dept` reads `D1` for
   both employees (case 13).
8. **A table with no relation has no member** — `tags`, `a`, `b`,
   `categories`, `events`, `team_seats` have no `related` key on their
   select chain (`Has<…>` = `false` ×6, `TS2339` when called); the
   pre-`Relations` contract (old CLI emission, no `Relations` key on any
   table) builds a client with 16 tables under the current runtime,
   `related` absent for `posts`/`accounts`/`users`/`profiles` at the
   type level, and a JS caller past the types gets the declaring chain:
   `{ author: true }` reads 3 rows, `autor` → `unknown-relation`,
   `owner`/`writer` → `ambiguous-relation`.
9. **The nested read is scoped like the row** — cases 17–19: the
   statement is byte-identical to the declaring side's; Postgres logged
   `BEGIN → set local role "app_reader" → select set_config($1, $2,
   true) → <the related() statement> → COMMIT` on both sides; under
   tenant `t1`, `posts` returns `P1` (author `a1@x`) and `P3` (author
   `null` — its author is tenant `t2`, filtered inside the nested read),
   and `accounts{posts}` returns only `A1 → ["P1"]`.

Also verified: the result chain's stages are exactly `then | compile |
where | orderBy | limit`, narrowing to `then | compile | orderBy |
limit` after `.where()`, `then | compile | limit` after `.orderBy()`,
`then | compile` after `.limit()` — identical to the declaring side's
`SelectChainRelated` family; `.offset()` after `related()`, a second
`.related()`, `.where()` twice, `.where()` after `.orderBy()` and
`.orderBy()` after `.limit()` are all `TS2339`. Emitted maps for the
whole input table match the derivation rules (`comments` omits the
non-`Id` `writer`; `tags` omits the colliding `owner`; `a`/`b` omit the
both-ways `b`/`a`; `memberships` carries only `sponsor`; `reviews`
carries `reviewer` and `reviewee`; `accounts` carries `reviews` once;
`constructor`/`valueOf` are carried as own keys and read rows at run
time). `vendor --check --strict` is up to date after `vendor`. The
`polyrepo.md` skill snippet compiles and prints `a1@x`; the guide's
illustrative contract block compiles verbatim and offers no `.related`
on its empty-map `posts`.

## Verdict

**BLOCKED** — one blocking finding (B1: the delta's `auth.users`
scenario and the MODIFIED requirement's "expose it … followable exactly
as one onto a managed table" are false whenever a managed table shares
the SQL name `users` in another schema; root pre-existing in the
`Tables` keying rule, reproduced with the pre-`Relations` CLI), eight
non-blocking findings (N1–N8). Every other delta sentence held on real
inputs, with consumer and declaring outputs byte-identical across all
36 runtime cases save one message text (N2).
