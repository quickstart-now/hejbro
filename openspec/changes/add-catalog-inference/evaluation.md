# D106 evaluation — add-catalog-inference

## Round 1

### Verdict

BLOCKING 1 / NON-BLOCKING 7 / OK 10

(15 delta scenarios across `catalog-inference`, `cli-commands`,
`schema-vendoring`; the seven NON-BLOCKING entries include three that do
not attach to a scenario but contradict or under-serve requirement prose.)

### Blocking

**B1 — `cli-commands` › "Declaration files never import each other in a
cycle": a cross-schema *enum* reference is never counted as a file-graph
edge, so two starter files can import each other, and loading crashes
under either order.**

The cycle graph is built from foreign keys only
(`packages/cli/src/declare-emit/emit.ts:1114-1132` — `schemaCrossings`
is `tables.flatMap(... table.foreignKeys ...)`), but a file also imports
another file when one of its tables uses an enum type declared in the
other schema (`emit.ts:1372-1374` `referencedEnumIdentities`, rendered as
a real `import { … } from "./<other>.schema"` at `emit.ts:1402-1408`).
An enum crossing in one direction plus a foreign-key crossing in the
other therefore produces a genuine import cycle, and the schema DFS finds
no back edge to sever because it never saw the enum edge.

Concrete input (drove `emitDeclarationFiles` directly, throwaway test,
deleted): schema `app` with `app.users(id uuid pk, kind audit.event_kind)`,
schema `audit` with enum `audit.event_kind` and
`audit.logs(id uuid pk, user_id uuid references app.users)`. Emitted:

```
app.schema.ts   → import { eventKind } from "./audit.schema";
audit.schema.ts → import { users } from "./app.schema";
```

Both references are evaluated eagerly: `eventKind.column()` sits in
`app.users`' columns object, and `references: { table: users, … }` sits in
`audit.logs`' extras callback, which `table()` invokes eagerly
(`packages/core/src/dsl/table.ts:1322`, `const resolvedExtras =
extras?.(refsObject)`). Reproduced the crash with the two emitted files
verbatim against a stub `hejbro` whose `table()` calls `extras` the same
way:

- loader reaches `app` first → `ReferenceError: Cannot access 'users' before initialization`
- loader reaches `audit` first → `ReferenceError: Cannot access 'eventKind' before initialization`

This contradicts both the requirement ("The starter files' imports SHALL
never form a cycle") and the scenario's THEN ("the files' imports form no
cycle … loading does not depend on which file the loader reaches first").
`declare-emit-file-cycle.test.ts` only ever feeds the graph FK crossings,
so nothing in the suite observes this.

### Non-blocking

**N1 — `catalog-inference` › "Tables and enums are inferred": nothing in
the description "marks" a key as guessed.** `DescribedColumn` is
`{ sqlName, tsKey }` (`packages/cli/src/infer/description.ts:6-9`) —
there is no per-key or per-fact marker anywhere in `CatalogDescription`.
The only marking that ships is one blanket loss-report line
(`infer/loss-report.ts:87-96`, "Guessed: TypeScript keys from SQL names,
the default numeric mode, and unknown array-element nullability"). Both
commands always print it, so the user-visible claim is honoured; the
scenario's "the description marks every TypeScript key as guessed" is an
over-claim about the data structure. A consumer reading
`contractMetadata` cannot tell a guessed key from a declared one.

**N2 — `catalog-inference` › "Two SQL names that collide on one key are
both described": the scenario's "the loss report names *the* column that
cannot be declared" holds for only one of the two physical orders the
WHEN allows.** The key rule is applied exactly as written (earliest
physical column keeps the bare key). With physical order
(`USER_ID`, `user_id`): `inferColumnKeys(["USER_ID","user_id"])` →
`["userId","userId2"]`; round-tripping through the DSL's own rule
(`toSnakeCase`, `infer/compose.ts:108-109`) gives `user_id` and
`user_id2`, neither of which equals its source name — so
`tablesExcludingUndeclarableNames` drops **both** columns from the
snapshot and the loss report names two columns. The perfectly ordinary
`user_id` column then reaches neither the starter file nor the pulled
contract, purely because an exotic sibling sorted before it. With the
reverse physical order exactly one is dropped, as the scenario says. The
requirement's key rule and the scenario's "only one of the two" clause
are mutually inconsistent; shipped code follows the requirement.

**N3 — `cli-commands` › "A second import writes the same bytes":
byte-identity rests on Postgres returning catalog rows in the same order
twice; nothing in the pipeline sorts them.** Snapshot *object keys* are
sorted (`packages/core/src/snapshot/snapshot.ts:172`) and table order is
topologically sorted with an identity tie-break, so the declaration bodies
are stable. But (a) the loss report embedded in every file header follows
catalog row order — `detectUniqueIndexApproximations` maps
`catalog.constraints`, `standaloneSequences` filters `catalog.sequences`,
`typeLosses`/`undeclarableNameColumns` follow `catalog.tables` — and
(b) a table's `indexes`/`foreignKeys`/`checks` arrays are never sorted
(no `sort` in `infer/table.ts` or `core/src/kinds/table-kind.ts` for
these). None of `CHECK_CATALOG_QUERIES` carries an `order by`
(`packages/cli/src/check/catalog.ts:94-200`). The claim is absolute
("identical byte for byte"); the only observer is the Docker-gated
`declare-emit.integration.test.ts:264`, which reads one quiescent
database twice. A `VACUUM FULL`, a catalog rewrite, or a different server
can reorder these rows.

**N4 — `schema-vendoring` › "outdated refuses a database-sourced
contract": in the scenario's own repository shape the code is
`vendor-source-not-linked`, not `vendor-origin-not-a-commit`.**
`runOutdated` reads the source file first
(`packages/cli/src/commands/outdated.ts:28-35`) and only then reaches
`assertLockNamesACommit` (`:43`). A consumer who ran `pull --db-url`
because it *cannot* use the git channel has no `hejbro.json`, so it
refuses one guard earlier. Both messages name `hejbro link`, so the
scenario's "names `link`" holds, but "the coded diagnostic" does not.
The test reaches the intended code only because it calls
`writeSourceFile` in `beforeEach`
(`outdated-database-origin.test.ts:20`). `vendor --check` is unaffected —
it dispatches to `runVendorCheck` before `requireLinkedSource`
(`commands/vendor.ts:265` vs `:273`), so it does raise
`vendor-origin-not-a-commit`.

**N5 — requirement prose (`catalog-inference`): role names are inferred
from grants only, never from policies.** The requirement says "role names
from the grants and policies present". `inferRoleNames`
(`packages/cli/src/infer/rest.ts:73-83`) unions `tableGrants`,
`schemaUsageGrants` and `defaultTableGrants` only; `PolicyRow` is
`{schema, table, name}` and the policies query selects
`schemaname, tablename, policyname` from `pg_policies`
(`check/catalog.ts:60-65`, `:167-170`) — `pg_policies.roles` is never
read. A role named only in a policy's `TO <role>` clause and in no grant
is missing from the description and from the pulled contract's `roles`.
`infer-description.test.ts:164` pins the shipped behaviour ("from the
grants present"), so the spec sentence is the thing that is wrong.

**N6 — `import` can silently write two schemas into one file.**
`safeFileBaseName` (`declare-emit/emit.ts:101-107`) folds every character
outside `[A-Za-z0-9_-]` to `_`, so schemas `a.b` and `a b` both become
`a_b`; on a case-insensitive filesystem (macOS default) `Users` and
`users` collide too. `throwIfAnyFileExists`
(`commands/import.ts:104-119`) only checks prospective paths against
*disk*, never against each other, and `writeFiles` then writes them in
sequence — the second silently overwrites the first, while stdout prints
`created …` twice for the same path. Contradicts "one starter declaration
file per schema" and "refusing to overwrite any existing file"; exotic
input, hence non-blocking. `phase1ImportedNameFor`
(`emit.ts:1255-1267`) also compares files by `fileBaseName`, so the two
colliding schemas would additionally share an identifier namespace.

**N7 — a named schema that yields nothing produces no file and no
message.** `hasInferredObjects` (`commands/import.ts:89-92`) is a global
test over the whole snapshot, and `emitDeclarationFiles` only emits for
schemas present in `tablesBySchema`/`enumsBySchema`
(`emit.ts:1171-1176`). `hejbro import --schema app --schema billing`
where `billing` is empty writes one file and says nothing about
`billing` — no line in the loss report, no diagnostic. The requirement's
"writes one starter declaration file per schema" and its own
nothing-to-infer code both read as if the empty case is always announced.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — NON-BLOCKING (N1). Snapshot/enum half is right (`infer/compose.ts:167-205`, `import-command.test.ts:117`); the "marks every key as guessed" half has no data-level marker.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — NON-BLOCKING (N2). Description half OK (`infer/description.ts:34-52`, `infer-description.test.ts:101`); "the column" (singular) is order-dependent.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredSummary`/`standaloneSequences` (`infer/rest.ts:99-130`), rendered by `notInferredLines` (`infer/loss-report.ts:115-140`); `infer-loss-report.test.ts:29` ("names exactly the delta's not-inferred elements when every kind is present").
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. `wayOutLine`/`guessedLine`/`approximationLines` (`infer/loss-report.ts:87-197`), printed by `runPull` (`commands/pull.ts:183-187`); `infer-loss-report.test.ts:165`, `:83`, `:65`, `:96`.
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — BLOCKING (B1).
- `cli-commands` › … › **A second import writes the same bytes** — NON-BLOCKING (N3). No clock/machine value anywhere in the header (`emit.ts:892-905`) and `declare-emit-emit.test.ts:151` pins same-input determinism; cross-*reading* determinism is unguarded.
- `cli-commands` › … › **A database is imported into starter files** — OK. `import-command.test.ts:117` (two schemas, two files, loss report on stdout); the `generate`-against-empty half is carried by `result.sql` from `generateMigration({previousSnapshot: emptySnapshot})` (`infer/compose.ts:198-211`) and only Docker-verified (`live-witness.integration.test.ts`, not run here).
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — OK. `isNameRoundTrippable`/`tablesExcludingUndeclarableNames` (`infer/compose.ts:108-127`) and `undeclarableNameLineForImport` (`infer/loss-report.ts:155-158`), which states the `check`-keeps-reporting consequence verbatim; `import-command.test.ts:151`, `infer-loss-report.test.ts:116`.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `throwMissingSchema` (`commands/import.ts:74-79`) names `--schema` and "most commonly --schema public", raised before any connection; `import-command.test.ts:243`.
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK for the all-empty case. `hasInferredObjects`/`throwNothingToInfer` (`commands/import.ts:89-99`) fires before `emitDeclarationFiles`, so no file is written; `import-command.test.ts:271`. See N7 for the partially-empty case.
- `cli-commands` › … › **import never overwrites** — OK. `throwIfAnyFileExists` (`commands/import.ts:104-119`) checks every prospective file against the resolved `outDir` before the first write and names them all; `import-command.test.ts:177` proves it over two schemas where only one file pre-exists.
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — OK. `runPull` (`commands/pull.ts:124-192`): `--schema` required (`throwMissingSchema`, `pull-command.test.ts:214`), `DATABASE_HEADER` says "inferred from a database catalog, not vendored from a schema repository" (`contract/emit.ts:102-107`), `Tables` come from the description's guessed keys via `exportPayloadFromCatalog` (`contract/from-catalog.ts:33-47`), loss report on stdout; `pull-command.test.ts:109`.
- `schema-vendoring` › **pull writes where vendor writes** — OK. Same paths and same two guards as `vendor` with `force: false` (`commands/pull.ts:136-137`, `vendor/lock.ts:85-86`, `vendor/write.ts:70-88`), lock marked `"hejbro pull"` (`vendor/lock.ts:120-122`); `pull-command.test.ts:169` (overwrites a git-vendored repo, lock ends pull-marked) and `:227` (foreign contract file still refused, no `--force` exists).
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. `renderOriginFields` (`contract/emit.ts:252-262`) emits `source: "database"`, `database`, sorted `schemas`, no `commit`, no connection string; `contract-origin.test.ts:111`, `:126`, `:142`. Backward compatibility of the git shape is held by `GitContractMetadata.source?: "git"` (`packages/query/src/client/contract-types.ts:88-93`) and `contract-origin.test.ts:91`'s one-inserted-line golden.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — NON-BLOCKING (N4).

## Round 1 disposition

Every finding was accepted; none was rebutted. Three were specification
defects (the delta claimed what the code does not do, or claimed two
inconsistent things), five were code defects, and one — B1 — was both:
the rule was right and the graph it ran on was missing a whole class of
edge.

- **B1 — enum crossings were not file-graph edges.** Fixed in the code.
  The schema graph now carries both crossing kinds, and a back edge is
  severed by the mechanism its kind allows: a table crossing by the
  unexported `existingTable` handle already in use, an enum crossing by
  an unexported local `pgEnum` copy (same schema, name and values, used
  only as a column's type). Foreign-key edges are preferred when a cycle
  offers both, so real imports survive where they can; an enum-only
  cycle is still severed. Measured before it was built — the copy is
  never collected (collection reads a module namespace, which cannot
  hold an unexported binding), the emitted DDL is unchanged, and the
  importing file stops importing. Observed by the reviewer's own fixture
  loaded in both orders, an enum-only cycle in both orders, the
  acyclic-import assertion extended to enum crossings, and a
  back-edge-choice determinism pin. The delta now says an enum reference
  counts as an import, so the scenario itself would catch a relapse.
- **N1 — "the description marks every key as guessed".** Specification
  defect: there is no per-key marker and none was intended; the loss
  report's blanket line is what ships. The scenario now says what the
  report says.
- **N2 — the collision rule and its scenario disagreed.** Specification
  defect with a code consequence: the rule as written let an exotic
  column cost an ordinary one its own key, dropping both. The rule is
  now "the colliding column whose SQL name the bare key produces back
  keeps it"; the code follows, and both physical orders are pinned.
- **N3 — byte-identity rested on Postgres's row order.** Code defect:
  every catalog query now orders by its own natural key, and the arrays
  and report lines that survived into the output are sorted. Pinned by
  feeding reversed rows and expecting the same output.
- **N4 — `outdated` refused one guard too early.** Code defect: the
  origin check now runs before the linked-source check, which is the
  order the situation calls for — a consumer that pulled from a database
  has no source file by definition. Pinned without a source file, the
  shape the scenario actually describes.
- **N5 — roles come from grants, never from policies.** Specification
  defect: the sentence claimed both. It now claims grants; inferring a
  policy's roles is a separate piece of work.
- **N6 — two schemas could fold onto one file name.** Code defect:
  prospective paths are now compared against each other, case-insensitively,
  before anything is written, and a collision refuses with its own code.
- **N7 — a named schema that yields nothing said nothing.** Code defect:
  the report now names each such schema. The all-empty case keeps its
  own refusal.

### Method

- Read `openspec show add-catalog-inference --diff` for the three capabilities' deltas. (The command prints `proposal.md` ahead of the deltas; that prose was not used as evidence — every judgement below is against delta requirement/scenario text and shipped code.)
- Read the named surface: `packages/cli/src/{commands/import.ts,commands/pull.ts,infer/*,declare-emit/*,contract/{emit,from-catalog,read-snapshot}.ts,vendor/{lock,write,state}.ts,check/catalog.ts,main.ts,flags.ts}`, `packages/query/src/client/{contract-types,name-keyed-db}.ts`, `packages/core/src/dsl/table.ts`, `packages/core/src/snapshot/snapshot.ts`.
- Ran the change's own unit suites green: 16 files / 97 tests (`import-command`, `pull-command`, `contract-origin`, `vendor-lock-origin`, `outdated-database-origin`, `declare-emit-{emit,file-cycle,topo-order}`, `infer-{keys,description,loss-report,tables,rest,adapter,constraints,catalog-read}`).
- Constructed B1 in a throwaway `packages/cli/test/*.test.ts` driving `emitDeclarationFiles` directly (deleted afterwards; `git status` clean apart from this file), then reproduced the load-order crash in `/tmp` with the two emitted files verbatim against a stub `hejbro` package that calls `extras` the way `core/src/dsl/table.ts:1322` does. Both entry orders raise `ReferenceError`.
- Checked N2 by evaluating `inferColumnKeys` on both physical orders of (`USER_ID`, `user_id`) and round-tripping the results through `toSnakeCase`, the same predicate `infer/compose.ts` uses.
- Docker-gated `*.integration.test.ts` were not run (`live-witness`, `declare-emit.integration`, `infer-catalog-read.integration`, `declare-emit-roundtrip.integration`), so the "generate against empty matches the database" and cross-reading determinism claims are read, not executed.
- The full `packages/cli` unit run shows 23 further failing files; 22 are the `dist`-freshness guard (`test/support/cli-runner.ts:61`, remedy `pnpm build --force`, out of scope here) and `assert-schema.test.ts` fails because `@hejbro/supabase` resolves to a stale `dist` (it is not in `vitest.shared.ts`'s source alias). Neither touches this change's surface.
- No repository file was modified except this report.

## Round 2

### Verdict

BLOCKING 2 / NON-BLOCKING 3 / OK 13

(the same 15 delta scenarios across `catalog-inference`, `cli-commands`,
`schema-vendoring`; every round-1 finding is closed, but two new
BLOCKING defects sit in `declare-emit/`, one of them re-opening B1's own
scenario through the correction that closed it. The three NON-BLOCKING
entries attach to requirement prose and to the shipped user-facing
skill, not to a scenario.)

### Round-1 findings re-checked

- **B1 — enum crossings were not file-graph edges — STILL OPEN (narrowed;
  re-opened by its own fix in one shape).** The widening is real and
  correct (`declare-emit/emit.ts:1320-1350` builds enum crossings;
  `file-cycle.ts:59-72` keys them by kind), and the two-schema fixtures
  the disposition names do load (`declare-emit-enum-cycle-load.test.ts`,
  4 tests green). But the FK-preference step added on top
  (`file-cycle.ts:90-122`) swaps an enum back edge for the mirror FK
  edge without checking that the mirror lies on the cycle the back edge
  closed, and on a chorded three-schema graph it hands the cut to an
  edge that is on no cycle at all — see R2-B1 below, measured, all three
  entry orders crash.
- **N1 — "the description marks every key as guessed" — CLOSED
  (specification).** The delta now reads "a schema description whose
  declaration-time facts are guessed by the rules stated here, and whose
  guessing the loss report announces", and the scenario's THEN is "the
  loss report says the TypeScript keys were guessed" — which is exactly
  what `guessedLine` prints (`infer/loss-report.ts:87-96`), on both
  commands (`commands/import.ts:294`, `commands/pull.ts:186`). No
  per-key marker is claimed any more.
- **N2 — the collision rule and its scenario disagreed — CLOSED (spec +
  code).** The rule is now round-trip-anchored
  (`infer/column-keys.ts:80-96`, `bareKeyWinnerIndex`). Driven directly:
  `inferColumnKeys(["USER_ID","user_id"])` → `["userId2","userId"]` and
  `inferColumnKeys(["user_id","USER_ID"])` → `["userId","userId2"]` —
  the ordinary column keeps `userId` under **both** physical orders, and
  exactly one of the two is dropped from the snapshot
  (`toSnakeCase("userId") === "user_id"`, `infer/compose.ts:108-127`).
  Pinned by `infer-keys.test.ts`/`infer-description.test.ts:101`.
- **N3 — byte-identity rested on Postgres's row order — CLOSED (code).**
  All 15 `CHECK_CATALOG_QUERIES` (`check/catalog.ts:98-228`) and all 6
  `INFERENCE_CATALOG_QUERIES` (`infer/catalog.ts:139-227`) now carry an
  `order by` on their own natural key, including the inner
  `json_agg(... order by ord.n)` column lists; the surviving arrays are
  sorted in JS as well (`infer/adapter.ts:129-241` for
  checks/FKs/indexes/physical column order, `infer/loss-report.ts:106-110`
  `sortedBy` on every per-instance report line, `infer/rest.ts:79` on
  role names, `contract/emit.ts:258` on the origin's schemas). Pinned by
  `infer-adapter.test.ts:540` (reversed rows) and
  `infer-loss-report.test.ts:181`.
- **N4 — `outdated` refused one guard too early — CLOSED (code).**
  `assertLockNamesACommit` now runs at `commands/outdated.ts:42`, before
  `readSourceFile` at `:49`; pinned in the shape the scenario actually
  describes (a pull lock, no `hejbro.json`) by
  `outdated-database-origin.test.ts:74`. `vendor --check` is unchanged
  and still raises the same code (`commands/vendor.ts:75`).
- **N5 — roles come from grants, never from policies — CLOSED
  (specification).** The delta now says "role names from the grants
  present"; `inferRoleNames` (`infer/rest.ts:73-83`) unions the three
  grant arrays and nothing else. (The shipped *skill* still claims
  policies — R2-N1 below.)
- **N6 — two schemas could fold onto one file name — CLOSED (code).**
  `throwIfPlannedFilesCollide` (`commands/import.ts:146-189`) groups
  prospective paths case-insensitively and refuses with
  `import-destination-collision` before any write; pinned by
  `import-command.test.ts:221`.
- **N7 — a named schema that yields nothing said nothing — CLOSED
  (code), with one residue.** `emptySchemaLines`
  (`commands/import.ts:122-133`) names each empty schema, and the
  all-empty case still refuses (`:284`, `import-command.test.ts:306`);
  pinned by `import-command.test.ts:332`. Residue: those lines never
  reach the file header — R2-N3 below.

### Blocking

**R2-B1 — `cli-commands` › "Declaration files never import each other in
a cycle": the FK-preference step cuts an edge that is not on the cycle,
so a three-schema file cycle survives and every entry order crashes.**

`preferForeignKeyBackEdges` (`declare-emit/file-cycle.ts:90-122`) takes
a raw back edge `u -> v` of kind `enum` and, whenever *any* foreign-key
crossing `v -> u` exists that is not itself a back edge, removes the
enum edge from the cut set and cuts that FK instead. The mirror is only
required to be the exact reverse pair — never to lie on the cycle the
back edge closed. When the DFS path from `v` to `u` is longer than one
hop, the mirror is a chord, and cutting it leaves the cycle intact.

Concrete input (drove `buildSchemaFileGraph` and then
`emitDeclarationFiles` directly; throwaway test, deleted, `git status`
clean): schemas `a`, `b`, `c` —

- `a.ta(id uuid pk, b_id uuid references b.tb)` → FK crossing `a -> b`
- `a.ta2(id uuid pk, c_id uuid references c.tc)` → FK crossing `a -> c`
- `b.tb(id uuid pk, c_id uuid references c.tc)` → FK crossing `b -> c`
- `c.tc(id uuid pk, kind a.category)` → enum crossing `c -> a`

`buildSchemaFileGraph` reports exactly one back edge, and it is the
wrong one:

```
a->b foreignKey: false   b->c foreignKey: false
c->a enum:       false   a->c foreignKey: true
```

The plain DFS had it right — its raw back edge was `c -> a` (enum), and
cutting that alone leaves `a->b`, `b->c`, `a->c`: acyclic. The
preference step swaps in `a -> c`, which is on no cycle, and restores
`a -> b -> c -> a`. The emitted files import in that cycle
(`a.schema.ts: import { tb } from "./b.schema"`, `b.schema.ts: import
{ tc } from "./c.schema"`, `c.schema.ts: import { category } from
"./a.schema"`), and the unnecessary handle lands on the wrong edge
(`const cTcAT2CFkeyRef = existingTable("c", "tc", { id: uuid() });`).
Loaded through the same `jiti` the production loader uses
(`src/loader.ts`), from each of the three files in turn:

- entry `a` → `TypeError: Cannot read properties of undefined (reading 'column')`
- entry `b` → `TypeError: Cannot read properties of undefined (reading 'id')`
- entry `c` → `TypeError: Cannot read properties of undefined (reading 'id')`

This contradicts the requirement ("The starter files' imports SHALL
never form a cycle") and the scenario's THEN ("the files' imports form
no cycle … loading does not depend on which file the loader reaches
first"). Nothing in the suite observes it:
`declare-emit-file-cycle.test.ts` and
`declare-emit-enum-cycle-load.test.ts` only ever feed two-schema mutual
pairs or a chordless three-cycle. Note the direction of the damage —
the round-1 correction's own preference step is what re-opens B1 here;
the widened graph without it would have cut correctly.

**R2-B2 — `cli-commands` › "A database is imported into starter files":
the cross-file identifier reservation is one phase stale, so a starter
file can declare its own table under the very name it imports —
`Duplicate declaration`, and the file does not parse.**

`emitDeclarationFiles` resolves each file's identifier namespace twice
(`declare-emit/emit.ts:1508-1580`). Phase 2 reserves, for every symbol
this file imports, the name that symbol's owner got **in phase 1**
(`phase1ImportedNameFor`, `:1524-1536`), but the import statement is
rendered from the owner's **phase-2** name
(`:1673-1701`, `fileOfTable.get(identity)?.tableIdentifiers`). A file
whose own name shifted between the phases — because it, in turn,
reserved an import — is therefore imported under a name nobody
reserved.

Concrete input (same throwaway harness, no cycle anywhere): three
schemas `a`, `b`, `c`, each holding a table named `users`, chained by
foreign keys `a.users -> b.users -> c.users`. Emitted `a.schema.ts`:

```ts
import { users2 } from "./b.schema";
export const a = schema("a");
export const users2 = table(a, "users", { … });
```

(`b` reserved phase-1 `users` from `c` and became `users2`; `a`
reserved phase-1 `users` from `b`, so its own table also became
`users2`, while the import renders `b`'s phase-2 `users2`.) Loading
`a.schema.ts`: `Duplicate declaration "users2"` — it is not valid
TypeScript, so the file cannot be loaded, `hejbro generate` after
`import` cannot run, and the scenario's THEN ("a following `generate`
against an empty snapshot emits a migration whose objects match the
database's") is unreachable. `b` and `c` load fine. Three schemas with a
same-named table in a reference chain is an ordinary shape, not an
exotic one; the suite's own fixtures never exceed two files with a
shifted name, so nothing observes it.

### Non-blocking

**R2-N1 — the shipped skill still claims policy-derived role names,
which N5 removed from the spec and which the code has never done.**
`skills/hejbro/references/brownfield-adoption.md:211` reads "plus any
role name a grant **or policy** names". The delta now says "role names
from the grants present" and `inferRoleNames` (`infer/rest.ts:73-83`)
reads `tableGrants`/`schemaUsageGrants`/`defaultTableGrants` only —
`pg_policies.roles` is never selected (`check/catalog.ts:167-170`). The
user-facing contract (AGENTS.md: "a stale skill is a broken user
contract") still over-claims.

**R2-N2 — the same skill's cycle paragraph documents only the
foreign-key half of the mechanism, and asserts the guarantee R2-B1
breaks.** `brownfield-adoption.md:227-234` says `import` breaks the
cycle "using an unexported reference-only handle (`existingTable`) for
the foreign keys that cross it — the starter files always load
regardless of which one a loader reaches first". The delta now states
that "a reference to another file's enum counts as an import" and that
such a crossing is severed by "a local copy of the enum", which the
code implements (`emit.ts:795-813`) and the doc never mentions; and the
absolute load guarantee is false in the R2-B1 shape.

**R2-N3 — N7's own new report lines never reach the file header, so the
header does not carry "the loss report in full".** `emptySchemaLines`
(`commands/import.ts:122-133`) is concatenated onto `stdout` at `:296`,
after `result.lossReport`, but the header is rendered from
`result.lossReport` alone (`emit.ts:1713`, `renderHeader`). The
requirement says "Each file SHALL open with a header carrying the loss
report in full", and the determinism scenario says "each file's header
carries the loss report" — a reader of the committed file sees a report
that is strictly smaller than the one the run printed. Byte-determinism
is unaffected (the lines are stdout-only and follow the flag order).

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — OK. Snapshot/enum half `infer/compose.ts:167-205`; the guessed-keys announcement is `guessedLine` (`infer/loss-report.ts:87-96`), printed by both commands; `import-command.test.ts:117`, `infer-loss-report.test.ts:29`. (N1's over-claim is gone from the text.)
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — OK. `bareKeyWinnerIndex` (`infer/column-keys.ts:80-96`) is order-independent — driven on both physical orders of (`USER_ID`, `user_id`), `user_id` keeps `userId` in both, and exactly one column is excluded from the snapshot (`infer/compose.ts:119-141`); `infer-keys.test.ts`, `infer-description.test.ts:101`.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredSummary`/`standaloneSequences` (`infer/rest.ts:99-130`) rendered by `notInferredLines` (`infer/loss-report.ts:129-153`); `infer-loss-report.test.ts:29`.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. Four bands plus `wayOutLine` (`infer/loss-report.ts:87-231`), printed by `runPull` (`commands/pull.ts:184-187`); `infer-loss-report.test.ts:65`, `:83`, `:96`, `:165`.
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — BLOCKING (R2-B1).
- `cli-commands` › … › **A second import writes the same bytes** — OK. No clock- or machine-derived value in the header (`emit.ts:1035-1047`); every catalog query orders (`check/catalog.ts`, `infer/catalog.ts`) and every surviving array is sorted (see N3 above); `declare-emit-emit.test.ts:128`, `infer-adapter.test.ts:540`, `infer-loss-report.test.ts:181`. The cross-*reading* half remains Docker-only (`declare-emit.integration.test.ts:264`, not run).
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R2-B2). The two-schema case is green (`import-command.test.ts:117`); the three-file same-name chain emits a file that does not parse.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — OK. `isNameRoundTrippable`/`tablesExcludingUndeclarableNames` (`infer/compose.ts:108-127`) and `undeclarableNameLineForImport` (`infer/loss-report.ts:182-185`), which states the `check`-keeps-reporting consequence verbatim; `import-command.test.ts:151`, `infer-loss-report.test.ts:116`. Driven directly: a quoted `"createdAt"` guesses `createdat`, which round-trips to `createdat ≠ createdAt`, so it is excluded.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `throwMissingSchema` (`commands/import.ts:79-83`) names `--schema` and "most commonly --schema public", raised before any connection; `import-command.test.ts:278`. (`--out` has its own code, `:292`.)
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK. `schemasWithInferredObjects`/`throwNothingToInfer` (`commands/import.ts:99-112`, `:284`) fires before `emitDeclarationFiles`, so no directory is created; `import-command.test.ts:306`. A schema holding only a sequence no column owns counts as empty, which is what the delta's WHEN describes.
- `cli-commands` › … › **import never overwrites** — OK, and now also against the run's own other files. `throwIfPlannedFilesCollide` then `throwIfAnyFileExists` (`commands/import.ts:172-207`), both before the first write; `import-command.test.ts:177`, `:221`, `:248` (unwritable destination, `import-destination-unwritable`).
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — OK. `runPull` (`commands/pull.ts:124-192`): `--schema` required (`pull-command.test.ts:214`), `DATABASE_HEADER` says "inferred from a database catalog, not vendored from a schema repository" (`contract/emit.ts:96-107`), `Tables` from the description's guessed keys via `exportPayloadFromCatalog`, loss report on stdout; `pull-command.test.ts:109`, `:140`.
- `schema-vendoring` › **pull writes where vendor writes** — OK. Same destination and the same two guards `vendor` applies, both with `force: false` (`commands/pull.ts:136-137` vs `commands/vendor.ts:186`, `:272`); lock marked `"hejbro pull"` and recognized by `isVendorLockText` (`vendor/write.ts:22-27`), so a later `link` + `vendor` is not blocked by the pull lock — the way out the diagnostic names actually works. `pull-command.test.ts:169`, `:227`. A repository that never linked is fine too: `runPull` never reads `hejbro.json`.
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. `renderOriginFields` (`contract/emit.ts:252-262`) emits `source: "database"`, `database`, sorted `schemas`, no `commit`, no connection string; `contract-origin.test.ts:111`, `:126`, `:142`. The git golden still proves the origin key is the *only* difference (it rebuilds `expected` from the pre-union capture by one insertion and asserts the insertion matched, then compares full text — `contract-origin.test.ts:91`). All three metadata shapes were type-checked against the reader for real (throwaway file under `packages/query/test`, `tsc -p packages/query/tsconfig.json`, deleted): legacy `{commit, exportHash}` with no `source`, `{source:"git",…}`, and `{source:"database",…}` all satisfy `ContractMetadata` and `createNameKeyedDb`, which touches only `roles`/`tables`/`functions` (`client/name-keyed-db.ts:403-423`).
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK (N4 closed). `commands/outdated.ts:42` before `:49`; `outdated-database-origin.test.ts:29`, `:74`.

## Round 2 disposition

All five accepted; none rebutted. Both blocking defects were in code,
and one of them was in code this change's own round-1 correction added.

- **R2-B1 — the FK-preference step cut an edge off the cycle.**
  `preferForeignKeyBackEdges` is deleted. The graph now cuts the back
  edges the traversal itself found, whatever kind they are — an enum
  crossing by the unexported local copy, a table crossing by the
  unexported handle. **Round 1's "foreign-key edges are preferred" is
  withdrawn**: it bought one real import per cycle and cost this
  scenario twice, and a chord is enough to make the swap cut an edge no
  cycle contains. Cutting every back edge the traversal reports is
  acyclic by construction, so there is nothing left to prefer. Observed
  by the reviewer's own chorded graph in all three entry orders, by an
  enum-only cycle, by the two-schema pairs that already existed, and —
  the one that generalises — by a property test that rebuilds the
  residual graph for several shapes (chorded three-cycle, four-schema
  mixed, two overlapping two-cycles) and walks it for cycles with a
  second, independent traversal.
- **R2-B2 — the identifier reservation was one phase stale.** The two
  phases are gone. A file's own identifiers are settled with no
  knowledge of any other file; only then are its imports named, and an
  imported symbol that collides with something already in this file is
  aliased (`users` from schema `b` as `bUsers`, a further collision
  taking the suffix rule the keys use). Nothing a file reserves can
  therefore go stale, because nothing it reserves depends on another
  file's later decisions. Observed by the reviewer's three-schema
  same-name chain, loaded for real, plus a determinism pin.
- **R2-N1, R2-N2 — the skill over-claimed.** The policy clause is gone
  and the cycle paragraph now carries both severing mechanisms. The
  absolute load guarantee is restated as what the delta says and what
  the property test holds: the files' imports form no cycle, so loading
  does not depend on which file the loader reaches first. **Neither
  sentence has an automated observer** — nothing in the suite asserts
  the skill's prose — and that is worth saying plainly rather than
  implying a red exists.
- **R2-N3 — the header lost the empty-schema lines.** Those lines are
  now merged into the loss report *before* emission, so the header and
  the printed report are the same array rather than two lists that have
  to be kept equal.

### Method
- Read the named surface: `packages/cli/src/{commands/{import,pull,outdated,vendor}.ts,infer/*,declare-emit/*,contract/emit.ts,contract/from-catalog.ts,vendor/{lock,write}.ts,check/catalog.ts}`, `packages/query/src/client/{contract-types,name-keyed-db}.ts`, plus `skills/hejbro/`.
- Ran the change's own unit suites green: 17 files / 115 tests (`import-command`, `pull-command`, `contract-origin`, `contract-from-catalog`, `outdated-database-origin`, `declare-emit-{emit,file-cycle,topo-order,enum-cycle-load}`, `infer-{keys,description,loss-report,tables,rest,adapter,constraints,catalog-read}`).
- Constructed R2-B1 in a throwaway `packages/cli/test/*.test.ts`: first against `buildSchemaFileGraph` alone (back-edge report above), then through `emitDeclarationFiles`, writing the emitted files into a real directory inside the package and loading each as an entry point with the same `jiti` the production loader uses. Three entry orders, three crashes.
- Constructed R2-B2 in the same harness with no cycle at all (linear FK chain over three same-named tables); `a.schema.ts` fails to parse.
- Drove `inferColumnKeys` + `toSnakeCase` directly on both physical orders of the N2 fixture and on three further collision shapes.
- Type-checked the three `contractMetadata` shapes against `createNameKeyedDb` with `tsc` (see the origin scenario above).
- Docker-gated `*.integration.test.ts` were not run (`live-witness`, `declare-emit.integration`, `declare-emit-roundtrip.integration`, `infer-catalog-read.integration`), so "generate against empty matches the database" and cross-reading determinism are read, not executed. `pnpm build`/`pnpm install` were not run; the `dist`-freshness CLI subprocess suites were not exercised.
- Every throwaway file was deleted; `git status` is clean apart from this report.

## Round 3

### Verdict

BLOCKING 3 / NON-BLOCKING 4 / OK 12

(the same 15 delta scenarios across `catalog-inference`, `cli-commands`,
`schema-vendoring`. Every round-2 finding is closed — both blocking
defects verifiably so, each with a real-load observer in the suite. The
three new BLOCKING entries are older than round 2's: two are exotic-name
shapes in `infer/`+`declare-emit/` that no round has probed, and one —
a foreign key's own catalog name — is not exotic at all and defeats the
whole `import` → `generate` → `baseline` → `check` flow on any database
hejbro did not itself create.)

### Round-2 findings re-checked

- **R2-B1 — the FK-preference step cut an edge off the cycle — CLOSED
  (code + observers).** `preferForeignKeyBackEdges` is gone;
  `buildSchemaFileGraph` (`declare-emit/file-cycle.ts:88-111`) now cuts
  every back edge `topologicalTableOrder`'s DFS reports, which is
  acyclic by construction. Re-measured the round-2 repro end to end (my
  own throwaway harness, emitted files written to a real directory and
  loaded with the production loader's own `jiti`): the chorded graph
  `a->b`/`a->c`/`b->c` FK + `c->a` enum now cuts `c -> a` (a local
  unexported `pgEnum` clone in `c.schema.ts`, imports `a->b`, `a->c`,
  `b->c`), and all three entry orders load. So do its mirror (enum on
  `a->b`, FKs elsewhere, `c->a` cut by an unexported `existingTable`
  handle), two overlapping two-cycles, and a four-schema mixed-kind
  cycle — every file as entry point, 13 loads, no failure. The property
  is also pinned in the suite with a traversal independent of the one
  under test (`declare-emit-file-cycle.test.ts:222-260`, `residualEdges`
  + a white/grey/black `hasCycle`, over four shapes), and the chorded
  graph is additionally emitted-and-loaded
  (`declare-emit-enum-cycle-load.test.ts:231`).
- **R2-B2 — the identifier reservation was one phase stale — CLOSED
  (code + observers).** One resolution pass per file
  (`emit.ts:1503-1516`), aliases chosen per importing file
  (`aliasNameFor`/`resolveAliasesFor`, `:1664-1710`). Re-measured the
  round-2 repro: three schemas each holding `users` chained
  `a -> b -> c` emits `import { users as bUsers } from "./b.schema";`
  in `a`, `users as cUsers` in `b`, every file declaring its own bare
  `users`; all three load. A fourth schema `d.users` referencing both
  `b` and `c` gets `bUsers` and `cUsers` and loads too, and the alias
  set is byte-identical with the table order reversed. Pinned by
  `declare-emit-enum-cycle-load.test.ts:361-490` and
  `declare-emit-emit.test.ts:318`.
- **R2-N1 — the skill claimed policy-derived role names — CLOSED.**
  `brownfield-adoption.md:213` now reads "plus any role name a grant
  names"; `inferRoleNames` (`infer/rest.ts:73-83`) still unions the
  three grant arrays only.
- **R2-N2 — the skill's cycle paragraph — CLOSED.**
  `brownfield-adoption.md:232-240` now names both severing mechanisms
  ("a handle (`existingTable`) for a foreign key, a local copy of the
  enum for an enum reference") and states the guarantee in the delta's
  own terms ("the starter files' imports form no cycle, and loading does
  not depend on which file the loader reaches first"). Still no
  automated observer for the skill's prose, as the disposition said.
- **R2-N3 — the header lost the empty-schema lines — CLOSED (code +
  observer).** `withEmptySchemaLines` (`commands/import.ts:141-149`)
  folds them into `result.lossReport` *before* `emitDeclarationFiles`,
  and stdout prints that same array (`:296-302`). Driven directly
  (`--schema app --schema empty_one`, one table in `app`): the written
  header and stdout carry the identical five lines, stdout differing
  only by its own `created …` line. Pinned by
  `import-command.test.ts:364`.

### Blocking

**R3-B1 — `cli-commands` › "a column the DSL cannot name is left out and
said so" (and the requirement's "Each file SHALL open with a header
carrying the loss report in full"): a loss-report line is interpolated
into a `/** … */` header with no escaping, so a catalog identifier
containing `*/` closes the comment early and the starter file does not
parse.**

`renderHeader` (`declare-emit/emit.ts:1039-1046`) prefixes each report
line with ` * ` and nothing else, and every per-instance line in
`buildLossReport` interpolates raw catalog text — a column's SQL name
(`undeclarableNameLineForImport`, `infer/loss-report.ts:180-185`), a
`format_type` type string, a sequence, constraint or role name
(`:129-176`, `:87-96`). A quoted Postgres identifier may contain `*` and
`/`.

Measured end to end (throwaway harness, deleted; `git status` clean): a
column `a*/b` guesses the key `aB`, which round-trips to `a_b ≠ a*/b`,
so it is excluded from the snapshot and named in the report by
`buildLossReport` verbatim:

```
Omitted: column "app.widgets.a*/b" -- its SQL name has no declaration key. …
```

`runImport` writes that line into the header, and the emitted
`app.schema.ts` reads ` * Omitted: column "app.widgets.a*/b" -- its …`,
which terminates the block comment at `*/`. Loaded with the production
loader's own `jiti`: `ParseError: Missing semicolon`. The command still
exits 0 and reports `created o/app.schema.ts`, so the failure surfaces
only at the next `hejbro generate` — which is precisely the sentence the
same requirement ends on ("A `generate` against an empty snapshot after
an `import` SHALL emit the DDL that creates what the database already
has"). The scenario's own WHEN is *the* class of exotic names, so this
is inside its stated shape, not beside it. Nothing in the suite feeds a
report line containing `*/`. The fix belongs at the header seam (rewrite
`*/` inside a report line before prefixing it), not at each raise site.

**R3-B2 — `catalog-inference` › "Two SQL names that collide on one key
are both described": a collision suffix is checked only against keys
already assigned, never against the base keys still to come, so an
exotic sibling *does* cost an ordinary column its own key — the
requirement's own "never" — and that ordinary column is then dropped
from the snapshot and mis-reported as undeclarable.**

`resolveIdentifierKeys` (`infer/column-keys.ts:120-147`) assigns keys in
physical order; `nextFreeSuffix` (`:54-66`) returns the smallest integer
whose result is free *in `assigned`* — the keys handed out so far — with
no knowledge of the base keys later columns will claim. Driven directly
on physical orders (`inferColumnKeys`, real output):

```
["user_id","USER_ID","user_id2"] -> ["userId","userId2","userId22"]
["user_id","user_id2","USER_ID"] -> ["userId","userId2","userId3"]
```

In the first order the exotic `USER_ID` takes `userId2`, and the
ordinary, perfectly declarable `user_id2` is pushed to `userId22`, which
does not round-trip (`toSnakeCase("userId22") = "user_id22"`). Downstream
(`infer/compose.ts:107-141`) that column is therefore excluded from the
snapshot — so it reaches neither the starter file nor `pull`'s contract
— and `buildLossReport` names it with a statement that is simply false:
`Omitted: column "app.widgets.user_id2" -- its SQL name has no
declaration key.` It has one; the collision rule gave it away. The
delta's rule is explicit that this must not happen ("appending … the
smallest integer from 2 upwards **that leaves it free**, so an exotic
sibling never costs an ordinary column its own key"), and the outcome
also depends on physical order, which the scenario's own THEN says it
must not for the winner. Nothing in the suite mixes a suffix-shaped
ordinary name with a colliding exotic one (`infer-keys.test.ts` stops at
two-column collisions).

**R3-B3 — `cli-commands` › "A database is imported into starter files":
a foreign key's own catalog name is dropped and re-derived, so on any
database hejbro did not create, `generate` after `import` emits
differently-named constraints and `check` reports every foreign key as
missing — and the loss report never names the approximation.**

The emitter renders a foreign key as `{ columns: […], references: { … } }`
with no name (`renderForeignKey`, `declare-emit/emit.ts:492-513`),
because the DSL has no slot for one: `table-kind.ts:443` sets
`name: deriveForeignKeyName(declaration.tableName, foreignKey.columns)`
unconditionally, i.e. `<table>_<cols>_fk`. Postgres's own default is
`<table>_<cols>_fkey` — the repo's own integration fixture creates
`cycle_b_a_id_fkey`/`item_a_id_fkey`
(`declare-emit.integration.test.ts:158`, `:171`). Measured (emitted the
starter for a snapshot whose FK is `ta_b_id_fkey`, loaded the files with
`jiti`, ran `generateMigration` against an empty snapshot):

```
alter table "a"."ta" add constraint "ta_b_id_fk" foreign key ("b_id") references "b"."tb" ("id");
```

`check` compares foreign keys **by name**
(`check/compare.ts:324-337`, `:455-459` — `compareConstraintsByName(…,
"f", table.foreignKeys.map(fk => fk.name), catalog)`), so after the
documented brownfield flow (`import` → `generate` → `baseline`, which
registers without executing) every foreign key is reported as missing,
permanently, on a database that in fact has it. Indexes and check
constraints keep their catalog names (`index(<name>)`, `check(<name>, …)`,
`emit.ts:441`, `:446-449`) and the primary key's derived `_pkey` matches
Postgres, so the foreign key is the one constraint kind that silently
diverges. The loss report names no such approximation
(`approximationLines`, `infer/loss-report.ts:156-176` covers the UNIQUE
index, the unowned `nextval`, and expression text only), contradicting
"a loss report naming … every approximation the reading made". The
round-trip witness cannot see it: it compares the emitted-and-generated
snapshot against `result.snapshot`, which `compose.ts:191-200` itself
produced through `generateMigration` — both sides carry the derived
name — and `examples/postgres`'s database was created by hejbro, so its
foreign keys are already `_fk`
(`declare-emit-roundtrip.integration.test.ts:224`).

### Non-blocking

**R3-N1 — the skill misquotes `pull`'s own way-out line.**
`brownfield-adoption.md:253-255` says the `pull` loss report ends "with
\"Link the schema repository to declare it by hand\"". That sentence is
the tail of the *undeclarable-column* line (`undeclarableNameLineForPull`,
`infer/loss-report.ts:188-190`), which appears only when such a column
exists; the report's actual last line is `wayOutLine("pull")` — "The
loss ends when you link the schema repository." (`:207-212`). The
delta's own scenario ("its output … says the loss ends when the consumer
links the schema repository") is met by the code, not by the doc.

**R3-N2 — `pull`'s destination refusal names a flag `pull` does not
have.** `assertVendorDestinationWritable`/
`assertContractDestinationWritable` (`vendor/write.ts:39-54`, `:70-88`)
end with "Next: remove it, or pass --force if overwriting it is what you
want." `runPull` parses only `--db-url`/`--schema`
(`commands/pull.ts:131-137`, always `force: false`), and the suite's own
test name says so ("no --force exists to override it",
`pull-command.test.ts:227`). A consumer hitting this under `pull` is
told to pass something that does nothing. The delta's "under the same
existing-file rules `vendor` itself applies" is satisfied by the guard;
only its remedy text is wrong for this caller.

**R3-N3 — two comments in `declare-emit/emit.ts` still describe the
two-phase identifier scheme R2-B2 removed.**
`resolveFileIdentifiers`'s doc (`:1149-1159`) still says "called twice
… once with only this file's own hejbro-vocabulary usage (phase 1, whose
result other files' imports are read from), once more with … every name
this file imports", and `buildFilePlan`'s own line (`:1408`) still reads
"Phase 1 (vocabulary-only) or phase 2 (vocabulary + imports)". There is
one call site now (`:1514`, `reserved` = identity), so the `reserved`
parameter is vestigial and both comments describe behavior that no
longer exists — the one place a later reader would go to understand why
`reserved` is there.

**R3-N4 — the file-level import-cycle assertion in
`declare-emit-emit.test.ts` can silently see no edges.** `hasImportCycle`
(`:522-542`) keys its adjacency map by `file.schema` but fills it with
the *file base names* parsed out of the import lines
(`importedSchemasFrom`, `:517-520`). For any schema whose name is not
already a safe file base name (`safeFileBaseName` folds `a.b`/`a b` to
`a_b` — the exact shape N6's own fixture uses), every lookup misses and
the graph reads as empty, so the assertion passes vacuously. Both
current fixtures use plain names, so nothing is wrong today; the
observer is weaker than it looks.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — OK. Snapshot/enum assembly `infer/compose.ts:177-200`, guessed-keys announcement `guessedLine` (`infer/loss-report.ts:87-96`) printed by both commands; `import-command.test.ts:117`, `infer-loss-report.test.ts:29`, `infer-adapter.test.ts`.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — BLOCKING (R3-B2). The two-column case is right under both physical orders (`inferColumnKeys(["user_id","USER_ID"]) -> ["userId","userId2"]` and the reverse gives `["userId2","userId"]`); a third, ordinary, suffix-shaped column is what breaks it.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredSummary`/`standaloneSequences` (`infer/rest.ts:99-130`) rendered by `notInferredLines` (`infer/loss-report.ts:120-153`), each kind counted and each column/sequence named; `infer-loss-report.test.ts:29`.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK for the scenario's own THEN (`wayOutLine`, `infer/loss-report.ts:207-212`, printed by `runPull`, `commands/pull.ts:184-187`; `infer-loss-report.test.ts:165`). The requirement's wider "every approximation" clause is where R3-B3 lands.
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — OK. Cut = every DFS back edge (`file-cycle.ts:88-111`); measured on the chorded three-schema graph and its enum-on-another-edge mirror, two overlapping two-cycles and a four-schema mixed cycle, emitting real files and loading each as entry point through the production `jiti` (13/13 load); handle and clone are both unexported; suite property test `declare-emit-file-cycle.test.ts:263-345`, load tests `declare-emit-enum-cycle-load.test.ts:91`, `:165`, `:231`.
- `cli-commands` › … › **A second import writes the same bytes** — OK. No clock/machine value in the header (`emit.ts:1029-1046`); every catalog query orders and every surviving array is sorted (round-2 N3, unchanged); alias assignment is ordered by (owner file, owner symbol) not traversal (`emit.ts:1646-1653`) — driven with the table order reversed, byte-identical. `declare-emit-emit.test.ts:128`, `:164`, `import-command.test.ts:364`. Cross-*reading* determinism remains Docker-only.
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R3-B3): the two files and the loss report are right, and generate-after-import runs, but the foreign keys it creates are named `_fk` where the database has `_fkey`.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — BLOCKING (R3-B1) for the `*/` sub-shape. The ordinary shape is correct: a quoted `"createdAt"` guesses `createdat`, fails the round trip, is excluded (`infer/compose.ts:107-127`) and named with the `check`-keeps-reporting consequence verbatim (`infer/loss-report.ts:180-185`); `import-command.test.ts:151`.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `throwMissingSchema` (`commands/import.ts:79-83`) names `--schema` and "most commonly --schema public", raised before any connection or write; `import-command.test.ts:278` (`--out` has its own code, `:292`).
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK. `schemasWithInferredObjects`/`throwNothingToInfer` (`:99-112`, `:296`) fire before `emitDeclarationFiles`, so no directory is created; `import-command.test.ts:306`. A partly-empty run now names each empty schema in both stdout and every header (R2-N3).
- `cli-commands` › … › **import never overwrites** — OK. `throwIfPlannedFilesCollide` then `throwIfAnyFileExists` (`:172-224`), both before the first write, the latter resolving against the real `outDir`; `import-command.test.ts:177`, `:221`, `:248`.
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — OK. `--schema` required (`commands/pull.ts:133-135`), `DATABASE_HEADER` says "inferred from a database catalog, not vendored from a schema repository" (`contract/emit.ts:102-107`), `Tables` from the description's guessed keys, loss report on stdout, destination not nameable; `pull-command.test.ts:109`, `:140`, `:214`.
- `schema-vendoring` › **pull writes where vendor writes** — OK. Same paths and the same two guards `vendor` applies, both `force: false` (`commands/pull.ts:136-137` vs `commands/vendor.ts:186`, `:272`); the lock carries `"generatedBy": "hejbro pull"`, which `isVendorLockText` (`vendor/write.ts:16-27`) recognizes, so a later `link` + `vendor` is not blocked; `pull-command.test.ts:169`, `:227`. (Remedy text nit: R3-N2.)
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. `renderOriginFields` (`contract/emit.ts:252-262`) writes `source: "database"`, the database name and sorted schemas, no commit and no connection string; `contract-origin.test.ts:111`, `:126`, `:142`. Re-type-checked the three metadata shapes against the reader outside the repo (`tsc --noEmit`, a scratch file under /private/tmp): legacy `{commit, exportHash}` with no `source`, `{source:"git",…}` and `{source:"database",…}` all satisfy `ContractMetadata` (`query/src/client/contract-types.ts:73-104`) and `createNameKeyedDb`.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK. `assertLockNamesACommit` at `commands/outdated.ts:42`, before the `commit === undefined` branch and before `readSourceFile` (`:49`); `vendor --check` refuses in `requireVendoredLock` before reading anything (`commands/vendor.ts:75`, `:100`); the diagnostic names `link` then `vendor` (`vendor/lock.ts:135-149`); `outdated-database-origin.test.ts:29`, `:74`.

### Method
- Read `openspec show add-catalog-inference --diff` in full, then the named surface: `packages/cli/src/{commands/{import,pull,outdated,vendor}.ts,infer/*,declare-emit/*,contract/emit.ts,vendor/{lock,write,state}.ts,check/{catalog,compare}.ts,loader.ts,main.ts}`, `packages/query/src/client/contract-types.ts`, `packages/core/src/{dsl/table.ts,kinds/table-kind.ts,kinds/table-snapshot.ts}`, `skills/hejbro/references/brownfield-adoption.md`.
- Ran the change's own unit suites green: 17 files / **128** tests (115 in round 2; the 13 new ones are the R2-B1 property/load tests, the R2-B2 alias/load tests and `import-command.test.ts:364`).
- Round-3 emission probes, in throwaway files under `packages/cli/test/` (all deleted; `git status` clean): the chorded three-schema graph and its enum-on-another-edge mirror, two overlapping two-cycles, a four-schema mixed cycle, the three-schema `users` chain and its four-schema variant — each emitted to a real directory and loaded from **every** file as entry point with the production loader's own `jiti` (13 loads, all clean), plus an alias-determinism comparison with the table order reversed.
- Drove `runImport` directly (fake driver + injected `inferCatalog`) for the header-vs-stdout question (one empty named schema: identical report), for a long/`*`-bearing report line, and for R3-B1's `*/` line built by the real `buildLossReport`.
- Drove `inferColumnKeys` + `toSnakeCase` on eight collision shapes, including the three that produce R3-B2.
- Loaded an emitted file set's exports and ran `generateMigration` against an empty snapshot in-process: one `create type` for a cloned enum (the clone is unexported, so `collectDeclarations` never sees it), every table and both foreign keys — and the `_fk`/`_fkey` divergence R3-B3 names.
- `node scripts/check-diagnostic-xref.mjs` and `node scripts/check-bans.mjs` both pass.
- Docker-gated `*.integration.test.ts` were not run (`live-witness`, `declare-emit.integration`, `declare-emit-roundtrip.integration`, `infer-catalog-read.integration`), so the live "generate against empty matches the database" claim is read, not executed — R3-B3 is what that reading found. `pnpm build`/`pnpm install`/full-workspace gates were not run.

## Round 3 disposition

All seven accepted; none rebutted. Three were code defects reachable by
exotic-but-legal names, one was a design gap the DSL had left open since
before this change, and three were documentation, a stale comment and a
test that could not see what it claimed to.

- **R3-B1 — a report line could end the header comment.** The escape
  lives at the header seam, where the reviewer said it belonged: a
  comment-ending pair inside any report line is written with a backslash
  between the two characters, and the header says so in a line that
  appears only when something was escaped. The first attempt inserted a
  zero-width space instead; that was rejected here — a file the
  repository now owns should not carry invisible characters.
- **R3-B2 — a suffix could take a base key still to come.** The
  collision resolver now knows every base key the run will claim before
  it hands out a suffix, so an exotic sibling can no longer cost an
  ordinary column its own key. Both physical orders the reviewer drove
  are pinned, and so is the report line that used to call that column
  undeclarable when it was nothing of the sort.
- **R3-B3 — a foreign key's catalog name was dropped.** The DSL now has
  the name slot an index and a check already had (`table-declaration`
  delta), the reading carries the real `conname` — it was being matched
  on and then discarded in `infer/adapter.ts`, one layer earlier than
  the report placed it — and the emitter writes the name only where it
  differs from the derived one, so a database hejbro created still emits
  byte-identical starters. A name the DSL cannot express falls back to
  the derived one and is reported as an approximation. `isSqlName` was
  *not* added to core's public surface for that check: the CLI catches
  `assertSqlName` instead, keeping the rule in one place without
  widening the surface. `deriveForeignKeyName` is exported, because the
  alternative was for the CLI to restate the `<table>_<columns>_fk`
  format as a string — public surface, but tooling's, not the user's
  vocabulary, which is why the skill's cheatsheet gains only `name?`.
- **A real regression, caught by the sweep rather than by a gate.**
  Adding `name` to `ForeignKeyDeclaration` broke `@hejbro/query`'s own
  `synthesizeForeignKey`, which builds that declaration itself — a
  compile error in a published package. It survived every check this
  round ran because those runs were filtered (`--filter=hejbro`,
  `--filter=@hejbro/core`) and `pnpm test` cannot see a type error at
  all. The earlier reading of the failed gate as "expectation debt, not
  a regression" was therefore only half right, and the whole-workspace
  `check-types` that found it is now the rule. A second reader was found
  the same way and is worth naming separately, because the sweep's own
  pattern could not have found it: `exports.test.ts` (#471) walks every
  runtime value `@hejbro/core` exports and fails unless each is
  classified as vocabulary or engine, so the two new exports failed on
  their *names*, not on their shape. Both are engine — a schema author
  never types them — which is the same answer the skill question got.
- **Where the gates ran.** The seven-step gate set ran green at
  `d13c35df` — build, the whole test run (84 files, 724 tests), CRAP,
  both Postgres majors of the integration suite with nothing skipped,
  an unfiltered `check-types`, the two `dist`-dependent vendor suites,
  and a container check. One documentation-only commit follows it,
  correcting stale claims in `proposal.md` (core is no longer
  unchanged; roles come from grants; sequences are the ones a column
  owns; the capability list gains `table-declaration`). No source or
  test file moves in that commit, which is why the gate result above
  still describes the pushed tree.
- **R3-N1, R3-N2, R3-N3, R3-N4 — closed.** The skill quotes `pull`'s
  actual last line; the destination refusal no longer offers `pull` a
  `--force` it does not have (the guard is unchanged, only its remedy
  text); the two comments describing the removed two-phase scheme are
  gone along with the vestigial `reserved` wrapper the second one
  explained; and the import-cycle assertion is keyed by file base name,
  so a schema whose name folds (`a.b` → `a_b`) no longer makes the graph
  read as empty. That last one had been passing vacuously.

## Round 4

### Verdict

BLOCKING 1 / NON-BLOCKING 2 / OK 17

(18 delta scenarios: `catalog-inference` 4, `cli-commands` 8,
`schema-vendoring` 3, and the `table-declaration` ADDED requirement's 3.
Every round-3 finding is closed, each with a code change *and* an
observer that fails without it — including the two the round-3
disposition described as "no code change" cases, which now carry real
pins. The one BLOCKING entry is the same exotic-name class rounds 1–3
kept finding, in the one place no round has probed: the identifiers of
objects other than columns and foreign keys.)

### Round-3 findings re-checked

- **R3-B1 — a `*/` in a report line closed the header comment — CLOSED
  (code + observer).** `escapeCommentTerminator` (`declare-emit/emit.ts:1084-1087`)
  rewrites `*/` to `*\/` at the header seam, and `ESCAPE_NOTE` (`:1070-1071`,
  emitted only when some line actually contains the pair, `:1091-1094`)
  says so in the intro. Re-measured round 3's own repro end to end
  (throwaway probe, emitted to a real directory, loaded with the
  production loader's own `jiti`): the header now reads
  ` * Omitted: column "app.widgets.a*\/b" -- …` above
  ` * A comment-ending pair inside a name below is escaped with a backslash.`,
  the file parses, and `jiti.import` returns `['app','widgets']`. The
  seam is the only place raw catalog text reaches a comment — the two
  other comments the emitter writes (`HANDLE_CONSTRAINT_COMMENT` `:738`,
  `ENUM_CLONE_CONSTRAINT_COMMENT` `:827`) are static literals, checked.
  Note (not a finding): stdout still prints the unescaped line
  (`commands/import.ts:311`), so header text and terminal text differ by
  exactly the escape for such a name — disclosed by `ESCAPE_NOTE`.
- **R3-B2 — a suffix could take a base key still to come — CLOSED
  (code + observers).** `keyFor` (`infer/column-keys.ts:107-119`) now
  passes `allBaseKeys` — every base key the run will hand out — into
  `nextFreeSuffix`, not just `assigned`. Re-drove `inferColumnKeys` on
  eleven shapes including round 3's own two:
  `["user_id","USER_ID","user_id2"] -> ["userId","userId3","userId2"]`
  (the ordinary `user_id2` keeps its own key; the exotic sibling is
  pushed to `userId3`) and
  `["user_id","user_id2","USER_ID"] -> ["userId","userId2","userId3"]`.
  All six permutations of that triple, both two-column orders
  (`["user_id","USER_ID"] -> ["userId","userId2"]`,
  reversed `-> ["userId2","userId"]`), and the four-column
  `["user_id","USER_ID","user_id2","USER_ID2"] ->
  ["userId","userId3","userId2","userId22"]` all keep every declarable
  column its own round-trippable key, and only the genuinely
  inexpressible names land on a key that fails `toSnakeCase`. Pinned in
  `infer-keys.test.ts` (suite green).
- **R3-B3 — a foreign key's catalog name was dropped — CLOSED (code +
  observers, end to end).** The slot exists
  (`ForeignKeyDeclaration.name: string | null`, `dsl/table.ts:104`;
  `resolveForeignKeyName`, `kinds/table-kind.ts:169-177`), the reading
  carries `conname` when it is expressible and falls back otherwise
  (`infer/table.ts:170-175`, `:368`), the emitter writes `name:` only
  where it differs from the derived name (`renderForeignKeyNameField`,
  `declare-emit/emit.ts:496-503`), and the loss report names the
  fallback as an approximation (`infer/loss-report.ts:219-225`).
  Measured, in-process from source: a snapshot whose FK is
  `comments_post_id_fkey` emits
  `references: { table: posts, columns: [posts.id] }, name: "comments_post_id_fkey" }`;
  a sibling table whose FK is already `notes_post_id_fk` emits the same
  line with no `name:` at all. Loading both files through the production
  `jiti` and running `generateMigration` against an empty snapshot
  yields `alter table "app"."comments" add constraint "comments_post_id_fkey" …`
  and `… add constraint "notes_post_id_fk" …` — the catalog name
  reaches the DDL `baseline` writes, and `check` compares by that name
  (`check/compare.ts`, unchanged). Pinned by
  `declare-emit-emit.test.ts:944` / `:958`, `infer-constraints.test.ts:158`
  / `:165`, `infer-loss-report.test.ts:350`, and a real live witness,
  `brownfield-foreign-key-names.integration.test.ts` (Docker-gated, read
  not run here: no Docker daemon on this machine — `docker info` fails).
- **R3-N1 — the skill misquoted `pull`'s way-out line — CLOSED.**
  `brownfield-adoption.md:268-269` now quotes "The loss ends when you
  link the schema repository", which is `wayOutLine("pull")`
  (`infer/loss-report.ts:256-261`) verbatim.
- **R3-N2 — the destination refusal named a flag `pull` lacks — CLOSED
  (code + two observers).** `destinationRemedy`
  (`vendor/write.ts:39-44`) branches on `DestinationWritableCommand`;
  a `pull` caller is told "remove it, then rerun `hejbro pull`".
  `pull-command.test.ts:227` and `:248` both assert the stderr does
  **not** contain `--force` and does contain `hejbro pull`.
- **R3-N3 — two comments described the removed two-phase scheme —
  CLOSED.** `resolveFileIdentifiers`'s doc (`emit.ts:1204-1214`) now
  states the single-pass rule and names `resolveAliasesFor` as where
  cross-file collisions are handled; `buildFilePlan`'s own phase line is
  gone. `reserved` is not vestigial — the one call site (`:1541-1548`)
  passes the file's real hejbro-vocabulary set.
- **R3-N4 — the import-cycle assertion could see no edges — CLOSED
  (code + observer).** `hasImportCycle`
  (`declare-emit-emit.test.ts:532-558`) is keyed by `file.fileBaseName`,
  matching what `importedSchemasFrom` parses; a fixture whose schema
  name folds (`a.b` → `a_b`) is pinned at `:621-626`, and the
  assertion's own can-see-a-cycle control is at `:613-618`.

### Blocking

**R4-B1 — `cli-commands` › "A database is imported into starter files"
(and, identically, `pull reads a database as the marked fallback` ›
"A contract is pulled from a database"): a table, schema, index or check
constraint whose catalog name is not lower snake_case aborts the entire
reading with a core `invalid-sql-name` error. No starter file is
written, no contract, no loss report — for a database class the change
exists to serve.**

The change carries the D36 identifier rule for exactly one catalog name:
a foreign key's (`isExpressibleForeignKeyName`, `infer/table.ts:155-162`,
which falls back to the derived name and reports the approximation).
Every other name the reading passes into the DSL is unguarded:

- `compose.ts:170` — `declareSchema(row.schema)` for every schema row.
- `infer/table.ts:349` — `table(facts.schema, facts.tableName, …)`.
- `infer/table.ts:374-375` — `check(c.name, sql.raw(c.expression))`.
- `infer/table.ts:377-390` — the index builder, whose
  `resolveIndexName` (`core/src/dsl/index-builder.ts:212`) asserts too.

Each of those calls `assertSqlName` (`core/src/sql/identifier-rules.ts:23-36`,
`^[a-z][a-z0-9_]*$`). Measured directly, driving the shipped `inferTable`
and `schema()` from source (throwaway probe, deleted):

```
schema("App")            -> schema name "App" is not a valid hejbro SQL identifier … Next: rename the schema to snake_case.
inferTable(… "Widgets")  -> table name "Widgets" is not a valid hejbro SQL identifier … Next: rename the table to snake_case.
check name "CK_Widgets"  -> check name "CK_Widgets" is not a valid hejbro SQL identifier …
index name "IX_Widgets"  -> index name "IX_Widgets" is not a valid hejbro SQL identifier …
```

`runImport` catches it (`commands/import.ts:66-77`, `:318`) and exits 1,
so the failure is loud — but the diagnostic is `invalid-sql-name`, it
names neither `import` nor the schema the object lives in, and its
remedy ("rename the table to snake_case") is addressed to a declaration
author, not to someone adopting a database they did not create. The
catalog queries apply no name filter (`check/catalog.ts:98-202`), and
`filterCatalogToSchemas` (`infer/compose.ts:67-89`) only narrows by
schema, so one quoted `"Widgets"` in a named schema is enough.

Why this is inside the delta's own text rather than beside it:

1. `catalog-inference` › "A catalog reading yields a snapshot and a
   marked description" states a **closed** list of what a reading omits
   — "no function, trigger, policy expression, view body, grant beyond
   its role name, column whose type no column builder expresses, or
   standalone sequence that no column owns — … and the loss report SHALL
   name each of them". An inexpressible table/schema/index/check name is
   not on that list, and shipped behavior is neither of the two outcomes
   the requirement allows (carried, or omitted-and-named): the whole
   reading dies.
2. `cli-commands` › "A database is imported into starter files" — WHEN
   `import … --schema app --schema billing` runs "against a database
   holding both" THEN "two declaration files are written, the loss
   report is printed". One CamelCase table in `app` satisfies the WHEN
   and produces zero files and no report.
3. The same requirement already establishes the pattern for exactly this
   problem one level down — "A column whose SQL name no declaration key
   can produce … SHALL be omitted from the starter files and named in
   the loss report together with its consequence" — and the
   `table-declaration` delta states the premise in as many words: "a
   database hejbro did not create names its constraints its own way".
   A quoted CamelCase table is at least as ordinary in such a database
   as a `_fkey` constraint name (an ORM-created schema is the standard
   source of both).

Corroborating evidence that this hole is unnoticed rather than decided:
`commands/import.ts:96-99` carries a comment reasoning about a schema
name that "can itself contain a `.` (D106 N6's own fixture, `\"a.b\"`)",
and `safeFileBaseName` folds `a.b` → `a_b` — machinery for a schema name
`declareSchema` rejects three call frames earlier, so it is reachable
only from tests that hand-build snapshots, never from a real reading.

Nothing in the suite feeds a non-D36 table, schema, index or check name
through `inferTable`/`inferFromCatalog`. The fix is a decision, not a
patch: either the reading omits such an object and names it in the loss
report (the column/FK pattern), or `import`/`pull` refuse up front with
their own coded diagnostic naming the object and the schema — and the
delta says which.

### Non-blocking

**R4-N1 — the skill's four-band loss-report enumeration is missing the
foreign-key-name approximation this round added.**
`brownfield-adoption.md:226-241` enumerates the report's bands and
spells the **Approximated** band out as a closed list — "a named UNIQUE
constraint as a same-named unique index, a `nextval(...)` default kept
as a raw expression, and every default/check/generated/index-predicate
expression as raw SQL text rather than a typed builder". Since the
round-3 correction there is a fourth kind
(`approximationLines`, `infer/loss-report.ts:219-225`: a foreign key
"declared under the derived name … because its own catalog name is not a
valid hejbro SQL identifier"), and the skill names it nowhere — `grep -n
"foreign key" skills/hejbro/references/brownfield-adoption.md` returns
only the pre-existing cycle and `check` sentences. `dsl-cheatsheet.md`
does document the new `name?` field (`:93`, `:111-120`), so the DSL half
of the surface is current; only the brownfield guide's loss-report
enumeration is stale, and it is the page a reader consults to know what
`import` did and did not preserve.

**R4-N2 — the round-3 correction's changeset promises a `@hejbro/core`
export that does not exist.** `.changeset/fix-catalog-inference-d106-r3.md`
ends: "`@hejbro/core` exports `deriveForeignKeyName` and `isSqlName` (the
same D36 rule `assertSqlName` enforces, as a boolean query) for callers
that need the same derivation/validation rule this feature uses
internally." `deriveForeignKeyName` is exported
(`core/src/index.ts:279`, classified in `cli/src/core-surface.ts:222`).
`isSqlName` is not: it is a module-private const
(`core/src/sql/identifier-rules.ts:14`) with no re-export anywhere —
`grep -rn "isSqlName" packages/*/src` returns only its own definition
and its one internal use. This contradicts the round-3 disposition's own
sentence ("`isSqlName` was *not* added to core's public surface for that
check: the CLI catches `assertSqlName` instead"), which is what the code
actually does. Changeset bodies become the published CHANGELOG, so this
ships a user-facing instruction to write an import that does not
compile. Fix the sentence, not the surface.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — OK for every name the DSL can express (assembly `infer/compose.ts:177-222`, `guessedLine` `infer/loss-report.ts:126-135`; `infer-adapter.test.ts`, `infer-loss-report.test.ts`). R4-B1 is the shape it cannot.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — OK (R3-B2 closed). Re-drove eleven collision shapes: every declarable column keeps a round-trippable key under every physical order, and only inexpressible names take a suffix; the bare key goes to the round-trippable member whichever comes first physically.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredLines` (`infer/loss-report.ts:172-205`) counts each kind and names each column-with-type and each unowned sequence; `infer-loss-report.test.ts`, `infer-rest.test.ts`.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. `wayOutLine` (`:256-261`) is the last line for both commands; the approximation band now also carries the FK-name kind (`:219-225`). `infer-loss-report.test.ts:350`. (Doc drift: R4-N1.)
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — OK. Re-measured after the emitter changed: the chorded three-schema graph (`a→b`, `a→c`, `b→c` FKs + `c→a` enum), its mirror with the enum on `a→b`, two overlapping two-cycles, and a four-schema mixed-kind cycle — emitted to real directories and loaded from **every** file as entry point with the production loader's own `jiti`: 13/13 clean. The cut carries an unexported `pgEnum` clone or an unexported `existingTable` handle, as the scenario's THEN requires.
- `cli-commands` › … › **A second import writes the same bytes** — OK. Emitting the same input twice is byte-identical, and so is emitting it with the table order reversed (measured). Header carries no clock/machine value (`emit.ts:1058-1100`); the escape note is content-derived and therefore stable.
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R4-B1). For a database whose object names are all D36-expressible the scenario holds end to end, foreign-key names included (see R3-B3 above); one quoted CamelCase table in a named schema produces zero files.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — OK (R3-B1 closed). Excluded at `infer/compose.ts:118-127`, named with the `check`-keeps-reporting consequence verbatim (`infer/loss-report.ts:229-233`), and a `*/` in that line no longer breaks the header.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `throwMissingSchema` (`commands/import.ts:79-83`) names `--schema` and "most commonly --schema public", raised before any connection; `import-command.test.ts:278`. `--out` has its own code (`:86-89`, test `:292`).
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK. `schemasWithInferredObjects`/`throwNothingToInfer` fire before `emitDeclarationFiles`; a partly-empty run folds its empty-schema lines into the report *before* emission (`withEmptySchemaLines`, `:144-150`), so header and stdout carry the same lines. `import-command.test.ts:306`, `:364`.
- `cli-commands` › … › **import never overwrites** — OK. `throwIfPlannedFilesCollide` then `throwIfAnyFileExists`, both before the first write; `import-command.test.ts:177`, `:221`, `:248`. (`import-destination-unwritable` `:238-241` is a separate, post-check path; nothing in the delta constrains it.)
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — OK for expressible names (`pull-command.test.ts:109`, `:140`, `:214`); `--schema` required, header says "inferred from a database catalog", destination not nameable. R4-B1 reaches this scenario identically.
- `schema-vendoring` › **pull writes where vendor writes** — OK. Same paths, both guards, `force: false`; the lock carries `"generatedBy": "hejbro pull"`, which `isVendorLockText` (`vendor/write.ts:16-27`) recognizes, so a later `link` + `vendor` is not blocked. `pull-command.test.ts:169`, `vendor-lock-origin.test.ts:38`.
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. `contract-origin.test.ts` green. Re-type-checked the three metadata shapes against the reader with the package's own `tsc` (a scratch file under `packages/query/test`, created/run/deleted): legacy `{commit, exportHash}` with no `source`, `{source:"git",…}` and `{source:"database",…}` all satisfy `ContractMetadata` (`query/src/client/contract-types.ts:89-104`) — with a negative control (a `database` shape missing `schemas`) confirming the harness fails when it should.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK. `assertLockNamesACommit` before any source read; `vendor --check` refuses in `requireVendoredLock`; the diagnostic names `link` then `vendor`. `outdated-database-origin.test.ts:28`, `:73`.
- `table-declaration` › **A named foreign key keeps its name** — OK. Measured: a hand-written `foreignKeys: [{ columns, references, name: "posts_legacy_fkey" }]` produces snapshot `{"name":"posts_legacy_fkey",…}` and `alter table "app"."posts" add constraint "posts_legacy_fkey" foreign key ("author_id") references "app"."users" ("id");` — no derived name anywhere in the SQL or the snapshot.
- `table-declaration` › **An unnamed foreign key is unchanged** — OK. The same declaration without `name` produces `{"name":"posts_author_id_fk",…}` and `… add constraint "posts_author_id_fk" …`; the starter emitter writes no `name:` field at all when the catalog name equals the derived one (`declare-emit-emit.test.ts:944` asserts `not.toContain("name:")`), so a hejbro-created database's starter bytes are unchanged.
- `table-declaration` › **Renaming the table leaves an explicit name alone** — OK, measured at the rendered-SQL level rather than only in the planner. Renaming `app.posts` → `app.articles` with an explicit `posts_legacy_fkey` yields exactly `['alter table "app"."posts" rename to "articles";', 'alter table "app"."articles" rename constraint "posts_pkey" to "articles_pkey";']` — no `rename constraint` for the foreign key. The same rename with a derived name yields a third statement, `alter table "app"."articles" rename constraint "posts_author_id_fk" to "articles_author_id_fk";`. The `wasDerived` guard (`core/src/engine/rename/retarget.ts:691-706`) is what separates them, and `rename-plan.test.ts:1831` pins the explicit case with a full statement-list equality plus `diffSnapshots(rewrittenPrevious, next) === []` — an observer a mutant that drops `wasDerived` fails.

### Method
- Read `openspec show add-catalog-inference --diff` in full, then the named surface: `packages/cli/src/{commands/{import,pull,generate,outdated,vendor,migrate}.ts,infer/*,declare-emit/*,contract/emit.ts,vendor/{write,lock}.ts,check/catalog.ts}`, `packages/query/src/client/{contract-types,synthesize}.ts`, `packages/core/src/{dsl/table.ts,kinds/table-kind.ts,sql/{identifier-rules,migration-file}.ts,engine/rename/retarget.ts}`, `skills/hejbro/references/{brownfield-adoption,dsl-cheatsheet}.md`, `.changeset/{add-catalog-inference,fix-catalog-inference-d106-r3}.md`. `openspec/specs/` checked for an existing identifier-rule requirement (none).
- Suites run green, in process from source: `packages/cli` in full — 84 files / **730** tests (128 in round 3, 163 across the change's own 19 files); `packages/core` in full — 99 files / 1506 tests; `packages/query` in full — 64 files / 857 tests.
- `npx tsc --noEmit` per package for all seven published packages and all four examples: clean. (Round 3's regression class — a type break invisible to filtered runs — is not present.)
- `node scripts/check-diagnostic-xref.mjs` (227 codes, ok) and `node scripts/check-bans.mjs` (235 files, ok).
- Round-4 probes, in throwaway files created, run and deleted in the same tool call (`packages/cli/test/_r4probe*.test.ts`, `packages/query/test/_r4probe-types*.ts`; `git status --porcelain` shows only `evaluation.md`): eleven column-collision shapes through `inferColumnKeys`; `renderHeader` plus a full emit-and-`jiti`-load for a `*/`-bearing report line; the `_fkey`/`_fk` starter pair emitted, loaded and run through `generateMigration`; the explicit-name and derived-name declarations through `generateMigration` and `planRenames`; six cycle/alias graphs emitted to real directories and loaded from every entry point (13 loads); a determinism comparison with the table order reversed; `schema()`/`inferTable` driven with non-D36 schema, table, check and index names (R4-B1); the three `ContractMetadata` origin shapes through the package's own `tsc`, with a negative control.
- Not run: `pnpm build`, `pnpm install`, full-workspace `pnpm test`/`check-types` (another team holds the gate slot). Docker-gated `*.integration.test.ts` were not run — `docker info` fails on this machine, so `brownfield-foreign-key-names.integration.test.ts`, `declare-emit-roundtrip.integration.test.ts`, `infer-catalog-read.integration.test.ts` and `live-witness.integration.test.ts` are read, not executed; every measurement above is in-process from `src`, and `packages/cli/dist` was neither read nor rebuilt (the repo's own `Read` deny rules cover it).

## Round 4 disposition

All three accepted; none rebutted. The blocking one was the last
unprobed corner of the exotic-name class rounds 1–3 kept finding: the
identifiers of objects other than columns and foreign keys.

- **R4-B1 — an unexpressible schema, table, index or check name stopped
  the whole reading.** Every such object is now left out and named in
  the loss report, and the reading continues: a schema takes what it
  holds with it, a table takes its own constraints, an index or a check
  costs only itself. **Approximation was never an option here**, which
  the measurement settled rather than taste: `check()` takes its name as
  a required argument with no derive path at all, and a table's or
  schema's name *is* its identity — only a foreign key's and an index's
  name is a label over an identity the columns already carry. Naming an
  index or check something else would also split the declaration from
  the database and leave `check` reporting one object as missing and
  another as unmanaged, forever — the shape R3-B3 existed to remove.
  The three consequence sentences differ because the facts differ: an
  omitted table keeps appearing in `check`'s unmanaged inventory, unless
  it was the only thing its schema would have declared; an omitted index
  or check never appears again, because nothing inventories those (#707).
  The report says which is which.
- **R4-N1, R4-N2 — closed.** The skill's Approximated band gained the
  fourth kind round 3 introduced, and the round-3 changeset stopped
  claiming an export (`isSqlName`) that its own disposition said was
  private.
- **Where the gates ran.** The seven-step set ran green at `e68647e3`,
  with the tip unmoved from before step 0 until after step 7. What
  follows it is this disposition and a changeset — no source or test
  file moves in either, which is why the numbers above still describe
  the pushed tree.
- **What the round cost, and why.** Three gate slots were spent: one to
  a full Docker data disk (1,418 anonymous volumes, 84 GB, left by this
  package's integration suites since round 1 — #709), and two to
  assertions in the new witness whose subject was wrong rather than to
  the code under test. Both assertion faults were the same shape as the
  findings this piece keeps making: the check was wider than what it
  meant to observe — a name matched inside the header's own prose, and
  then a whole-stdout comparison across two runs whose output paths
  differ by design. The rule that came out of it — a new Docker-gated
  witness is run alone, outside the slot, before it may enter one —
  closed it. A fourth fault was caught before it could cost anything:
  the report-line allowlist the fixed determinism check compares was
  missing `Guessed role names:`, so that comparison had been quietly
  half-blind; a line-by-line sweep of every literal `loss-report.ts`
  renders found it.

## Round 5

### Verdict

BLOCKING 3 / NON-BLOCKING 5 / OK 13

(18 delta scenarios: `catalog-inference` 4, `cli-commands` 8,
`schema-vendoring` 3, `table-declaration` 3. Five scenarios are blocked
by three findings. All three round-4 findings are closed as written —
but R4-B1's own class is not: the round-4 correction guards the four
object kinds it names by their *own* catalog name, and leaves unguarded
every other path by which a non-D36 name reaches the DSL — a foreign
key's *target*, and a column name the delta's own key rule is required
to produce. A third finding is older than any round: two tables in one
schema sharing a constraint name silently swap check expressions.)

### Round-4 findings re-checked

- **R4-B1 — an unexpressible schema, table, index or check name stopped
  the whole reading — CLOSED for those four kinds (code + observers),
  the class STILL OPEN on two other paths.** `partitionSchemas` /
  `partitionTables` (`infer/compose.ts:175-215`) filter ahead of
  `declareSchema`/`table()`, and `inferTable` filters checks and indexes
  ahead of `check()`/`index()` (`infer/table.ts:379-398`), each naming
  what it dropped. Measured against a real postgres:17 (one throwaway
  container, `docker rm -v`'d): a database holding schema `"App"`
  (with a table), `s4."Widgets"`, `"IX_Parts"`, `"CK_Parts"` and
  `"FK_Parts_Owner"` beside ordinary siblings of each kind reads to
  completion under both `import` and `pull` — starter file written,
  contract written, every ordinary object inferred, one report line per
  omission with its own consequence, and two runs byte-identical
  (`identicalBytes: true`). The remedy lines speak to someone adopting a
  database ("rename the schema in the database, then re-run `hejbro
  import`"), not to a declaration author. The `stillReportedInInventory`
  split is accurate: `buildInventory` returns `[]` for an omitted table
  whose schema kept nothing else, because a bare `schema:` snapshot node
  carries `name`, not `schema`, and `declaredSchemaNames`
  (`check/inventory.ts:46-59`) therefore never counts it — measured, not
  assumed. **But** the same `invalid-sql-name` abort survives wherever
  such a name reaches the DSL by a route other than the object's own
  declaration: `existingTable(fk.targetSchema, fk.targetTable, …)`
  (`infer/table.ts:273-300`) and `assertSqlName(toSnakeCase(columnKey))`
  (`core/src/dsl/table.ts:266`). See R5-B1 and R5-B2.
- **R4-N1 — the skill's Approximated band was missing the FK-name kind —
  CLOSED.** `brownfield-adoption.md:247-250` now names "a foreign key
  whose own catalog name is not a valid hejbro SQL identifier, declared
  under the derived name instead (D106 round 3)". The band is now exactly
  the four kinds `approximationLines` renders. (Its **Omitted** band is
  now the stale one — R5-N1.)
- **R4-N2 — the round-3 changeset promised a non-existent export —
  CLOSED.** `.changeset/fix-catalog-inference-d106-r3.md:19` now says
  `deriveForeignKeyName` and `assertSqlName`; both are exported
  (`core/src/index.ts:279`, `:386`) and `assertSqlName` is classified in
  `cli/src/core-surface.ts:218`. `isSqlName` stays module-private, as
  the round-3 disposition said.

### Blocking

**R5-B1 — a foreign key whose *target* table or schema carries a name no
declaration can carry still aborts the entire reading.** The round-4
correction filters the omitted object out of the declarations; it does
not filter the references *into* it. `partitionTables` drops
`app."Widgets"` but leaves untouched the foreign key that a surviving
`app.orders` holds against it, and `referencesFor`
(`infer/table.ts:264-292`) builds every non-self target as
`existingTable(fk.targetSchema, fk.targetTable, …)`, which asserts both
names (`core/src/dsl/existing-table.ts:24-25`). Measured against a real
postgres:17, in-process from `src`:

```sql
create schema s1;
create table s1."Widgets" (id uuid primary key);
create table s1.orders (id uuid primary key, widget_id uuid references s1."Widgets"(id));
```
```
inferFromCatalog({schemas:["s1"]}) -> THREW HejbroError:
  table name "Widgets" is not a valid hejbro SQL identifier … Next: rename the table to snake_case.
```

The schema-level mirror is the same one frame up (`create table
s5.orders (… references "App".orders(id))` → `schema name "App" is not a
valid hejbro SQL identifier`). Zero files, no contract, no loss report,
exit 1 — and the diagnostic's remedy is addressed to a declaration
author. A mixed-case database (one ORM-created table beside hand-written
ones) is the ordinary shape here, and it is the same shape the round-4
correction exists to serve. Contradicts `catalog-inference` › "A name no
declaration can carry costs that object, not the run" (shipped behavior
is neither of the two outcomes it allows), `cli-commands` › "A database
is imported into starter files", and `pull …` › "A contract is pulled
from a database". Nothing in the suite feeds a foreign key whose target
name is inexpressible: `infer-compose.test.ts`'s own `tableFacts` helper
builds tables with `foreignKeys: []`, and the live witness
(`infer-omitted-names.integration.test.ts:110-127`) gives its omitted
table no inbound reference at all.

**R5-B2 — a column whose SQL name begins with an underscore (`_id`)
aborts the entire reading.** The delta's own key rule requires the key
to keep a leading underscore ("keeping leading underscores and prefixing
`_` to a key that would otherwise start with a digit"), and
`baseTsKey` implements it (`infer/column-keys.ts:33-43`): `_id` → `_id`.
`isNameRoundTrippable` then passes it (`toSnakeCase("_id") === "_id"`,
`infer/compose.ts:122-124`), so it is *not* excluded as undeclarable —
and `table()` rejects it three frames later, because `assertSqlName`'s
pattern is `^[a-z][a-z0-9_]*$` (`core/src/dsl/table.ts:266`,
`core/src/sql/identifier-rules.ts:3`). Measured against a real
postgres:17:

```sql
create schema s2;
create table s2.legacy (_id uuid primary key, name text not null);
```
```
inferFromCatalog({schemas:["s2"]}) -> THREW HejbroError:
  column name "_id" is not a valid hejbro SQL identifier … Next: rename the column to snake_case.
```

The round-trip predicate and the DSL's acceptance rule are two different
rules, and this is the gap between them: every SQL name matching
`^_` (and no other) round-trips *and* fails the assertion. `_id`,
`_created_at`, `_metadata` are ordinary in a database hejbro did not
create. Contradicts `cli-commands` › "a column the DSL cannot name is
left out and said so" (the delta's prescribed outcome is omission plus a
named line; shipped behavior is a dead run), `catalog-inference` › "A
catalog reading yields a snapshot and a marked description" (the closed
list of what the snapshot omits, and "Leaving such an object out SHALL
never stop the reading"), and both commands' end-to-end scenarios.
Whichever way it is settled — exclude `^_` names from the snapshot and
name them, or loosen D36 — the two rules must become one, since a third
divergence is what produced both this finding and R4-B1.

**R5-B3 — two tables in one schema sharing a check-constraint name get
each other's expression, silently.** `checksFor`
(`infer/adapter.ts:186-193`) looks a check expression up by
`row.schema === constraint.schema && row.name === constraint.name` — the
table is not part of the match, although `CheckExpressionRow` carries it
and every sibling lookup (foreign keys `:140-145`, index details,
column details) uses it. Postgres only requires a constraint name to be
unique per table, so this is legal and measured:

```sql
create schema s3;
create table s3.a (x int, constraint pos check (x > 0));
create table s3.b (y int, constraint pos check (y < 0));
```
```
inferFromCatalog({schemas:["s3"]}).sql:
  create table "s3"."a" ( "x" integer, constraint "pos" check ((x > 0)) );
  create table "s3"."b" ( "y" integer, constraint "pos" check ((x > 0)) );   <-- s3.a's expression
```

`s3.b`'s own `(y < 0)` is gone and `s3.a`'s `(x > 0)` is asserted against
a column `s3.b` does not have. No loss-report line mentions it. Run
against the same server, the DDL `baseline` would emit is not merely
different from the database, it is rejected: `ERROR: column "x" does not
exist`. Contradicts `catalog-inference` › "Tables and enums are
inferred" ("the snapshot records each of them with its columns, keys and
constraints") and `cli-commands` › "A database is imported into starter
files" ("a following `baseline` emits a first migration whose objects
match the database's"). The fix is one clause — match on `row.table`
too, the way every neighbouring lookup already does — plus the pin no
suite has: `infer-constraints.test.ts` never gives two tables the same
constraint name.

### Non-blocking

**R5-N1 — the skill's **Omitted** band is now the stale one: it names
only the undeclarable column, not the four omission kinds the round-4
correction added.** `brownfield-adoption.md:251-259` still enumerates the
Omitted band as "a column whose SQL name no declaration key can
round-trip (a quoted `"createdAt"` …)" and nothing else, while
`buildLossReport` now renders four more kinds ahead of it —
`Omitted: schema …`, `Omitted: table …`, `Omitted: index …`,
`Omitted: check constraint …` (`infer/loss-report.ts:300-400`). `grep -n
"valid hejbro SQL identifier" skills/hejbro/references/brownfield-adoption.md`
returns one hit, the Approximated band's foreign-key sentence. This is
R4-N1 one round later, in the band next door: the page a reader consults
to know what `import` did and did not preserve does not mention that a
whole table or schema can be left behind.

**R5-N2 — the UNIQUE-constraint approximation is announced for tables
the reading did not infer.** `detectUniqueIndexApproximations` is passed
the schema-filtered catalog, not the surviving tables
(`infer/compose.ts:329`), while its three sibling detectors are passed
`mergedTables`. A UNIQUE constraint on an omitted table therefore yields
`Approximated: the UNIQUE constraint "app.Widgets.widgets_email_key" is
inferred as a unique index of the same name …` in the same report whose
next line says the whole table was omitted — measured. Two lines about
one object, one of them false.

**R5-N3 — when every named schema is omitted for its name, the reason is
never printed.** `runImport` refuses with `import-nothing-to-infer`
before assembling stdout (`commands/import.ts:311`; `errorReport`
returns `stdout: []`), so `hejbro import --schema App --out …` against a
database whose `"App"` schema is full of tables prints "found no table,
enum, or sequence to infer in schema(s) App. Next: confirm the schema
name(s) are correct and that the database holds objects in them" —
measured end to end through `runImport`. The `Omitted: schema "App" …`
line the reading produced is discarded. The round-4 correction handled
exactly this honesty problem for the *partial* case (`emptySchemaLines`
suppresses "nothing to infer" for an omitted schema, `:129-141`, "stating
both would tell the reader two different stories"); the all-omitted case
tells the one wrong story instead. `pull` has no such refusal and does
print the line.

**R5-N4 — `cli-commands` states the foreign-key-name rule without the
exception the code implements.** "A foreign key's own catalog name SHALL
survive into the starter declaration — written out where it differs from
the name the DSL would derive, left implicit where it does not" carries
no exception, but a name D36 cannot carry is dropped for the derived one
(`expressibleForeignKeyName`, `infer/table.ts:194-200`) and announced as
an approximation. Measured live: `"FK_Parts_Owner"` becomes
`parts_owner_id_fk` with an `Approximated:` line, while the expressible
`comments_post_id_fkey` is written out as `name: "comments_post_id_fkey"`
and `notes_post_id_fk` (equal to the derived name) is left implicit. The
behavior is the one rounds 3–4 settled; it is the requirement text that
never gained the clause, and the `catalog-inference` approximation
enumeration does not list this kind either.

**R5-N5 — an enum type's catalog name is the one identifier the D36 net
never touches.** `pgEnum` asserts nothing (`core/src/dsl/pg-enum.ts:27-33`),
so a `create type app."Status"` reaches the snapshot, the starter
(`pgEnum(app, "Status", …)`) and the emitted DDL unchanged — measured —
while a table, schema, index or check of exactly the same shape is
omitted and reported. Nothing in the delta's own closed list names an
enum, so no scenario is contradicted; but the requirement's stated reason
for omitting the others ("a declaration's identifiers are lower
snake_case (D36)") applies verbatim here, and the resulting starter file
declares an identifier `--rename`/`--confirm-drop` cannot address. Decide
it explicitly (carry, or omit-and-name) rather than by which DSL
constructor happens to assert.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — BLOCKING (R5-B2, R5-B3). Holds for a database of D36-expressible names with distinct constraint names; a `_`-leading column kills the run, and a duplicated check name silently rewrites a table's own constraint.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — OK. `keyFor`/`bareKeyWinnerIndex` (`infer/column-keys.ts:82-119`) unchanged since round 4's re-measurement of eleven shapes; `infer-keys.test.ts` green in this round's run.
- `catalog-inference` › … › **A name no declaration can carry costs that object, not the run** — BLOCKING (R5-B1). True for the four kinds named by their own catalog name (measured live, both commands, both orders, byte-identical); false for a reference into an omitted table or schema.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredLines` (`infer/loss-report.ts:213-237`) counts each kind and names each column-with-type and unowned sequence; `infer-loss-report.test.ts`, `infer-rest.test.ts` green.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. `wayOutLine` is the last line of every report measured this round, `pull`'s being "The loss ends when you link the schema repository". (Band honesty: R5-N2; doc drift: R5-N1.)
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — OK. Re-measured: the chorded three-schema graph (`a→b`, `a→c`, `b→c` foreign keys plus a `c→a` enum column) and its mirror with the enum on the `b→a` edge, emitted to a real directory and loaded from **every** file as entry point through the production `jiti` (6/6 clean). Import edges `{a:[b,c], b:[c], c:[]}`, acyclic under a traversal written independently of the one under test; the cut carries the unexported `pgEnum` clone with its own comment, and nothing is declared twice.
- `cli-commands` › … › **A second import writes the same bytes** — OK. Measured live against postgres:17: two readings of the same database emit identical files; header carries the full report and the repository-owns-it sentence, and no clock- or machine-derived value.
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R5-B1, R5-B2, R5-B3). Two schemas, files written, report printed, `baseline`-shaped DDL correct for a database of expressible names and distinct constraint names; each of the three findings breaks it for a database that is not.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — BLOCKING (R5-B2). A quoted `"createdAt"` is excluded and named with its consequence verbatim; a `_id` is neither — it stops the run.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `throwMissingSchema` (`commands/import.ts:79-83`) names `--schema` and "most commonly --schema public", before any connection; `--out` has its own code. `import-command.test.ts` green.
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK as written (the refusal fires before any write, `import-command.test.ts` green), with the diagnostic-honesty gap R5-N3 when the emptiness is really an omission.
- `cli-commands` › … › **import never overwrites** — OK. `throwIfPlannedFilesCollide` then `throwIfAnyFileExists`, both before the first write (`commands/import.ts:198-232`); `import-command.test.ts` green.
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — BLOCKING (R5-B1, R5-B2) by the same reading; otherwise OK, measured: the contract's header says "inferred from a database catalog", its `Tables` carry the guessed keys, an omitted table reaches neither `Database["Tables"]` nor `contractMetadata.tables`, and the report prints with `link` as the way out.
- `schema-vendoring` › **pull writes where vendor writes** — OK. `runPull` calls `assertLockWritable`/`assertContractDestinationWritable` with `force: false` and `"hejbro pull"` before any network work (`commands/pull.ts:138-143`), then writes the four vendor paths and a lock marked `generatedBy: "hejbro pull"`. `pull-command.test.ts`, `vendor-lock-origin.test.ts` green.
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. Measured contract text carries `source: "database"`, `database`, `schemas` and no `commit`; `ContractMetadata` (`query/src/client/contract-types.ts:90-104`) is a `source`-discriminated union whose git arm keeps `source` optional, so a pre-#604 contract still type-checks. `contract-origin.test.ts` green.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK. `assertLockNamesACommit` before any source read in both `outdated.ts:42` and `vendor.ts:75`; `outdated-database-origin.test.ts`, `vendor-check.test.ts` (the latter blocked only by the dist guard) as written.
- `table-declaration` › **A named foreign key keeps its name** — OK. Measured: a catalog `comments_post_id_fkey` reaches the starter as `name: "comments_post_id_fkey"` and the DDL as `alter table "app"."comments" add constraint "comments_post_id_fkey" …`.
- `table-declaration` › **An unnamed foreign key is unchanged** — OK. The sibling whose catalog name equals the derived one emits no `name:` field at all and `… add constraint "notes_post_id_fk" …`; `declare-emit-emit.test.ts` green.
- `table-declaration` › **Renaming the table leaves an explicit name alone** — OK. `rename-plan.test.ts:1831` (full statement-list equality plus `diffSnapshots(rewrittenPrevious, next) === []`) and the `wasDerived` guard (`core/src/engine/rename/retarget.ts:691-706`) unchanged; `packages/core` suite green (99 files / 1508 tests).

### Method

- Read `openspec show add-catalog-inference --diff` in full, then the named surface: `packages/cli/src/{commands/{import,pull}.ts,infer/*,declare-emit/emit.ts,contract/{emit,from-catalog}.ts,check/{catalog,inventory}.ts,vendor/{state,lock,write}.ts}`, `packages/core/src/{dsl/{table,existing-table,pg-enum}.ts,sql/identifier-rules.ts,index.ts}`, `packages/query/src/client/contract-types.ts`, `skills/hejbro/references/brownfield-adoption.md`, `.changeset/fix-catalog-inference-d106-r{3,4}.md`. Only rounds 1–4 of `evaluation.md` were read (findings + dispositions), as claims.
- Live witness, one throwaway postgres:17 container (`docker system df` first; `docker rm -v -f` after, container count back to its pre-run value): five isolated fixture schemas driven through the real `inferFromCatalog`/`emitDeclarationFiles` from `src` — the round-5 exotic set (`"App"` schema, `"Widgets"`, `"IX_Parts"`, `"CK_Parts"`, `"FK_Parts_Owner"` beside ordinary siblings, read twice, under `import` and `pull`), a foreign key into a CamelCase table, a foreign key into a CamelCase schema, a `_id` column, and two tables sharing a check name. The invalid `baseline` DDL from the last was executed against the same server to confirm `ERROR: column "x" does not exist`.
- In-process probes (created, run and deleted in the same tool call, `packages/cli/test/_r5probe*.test.ts`; `git status --porcelain` shows only `evaluation.md`): a fake `DriverSession` answering `CHECK_CATALOG_QUERIES` + `INFER_CATALOG_QUERIES` by exact text, driving `inferFromCatalog` for the omitted-object matrix, `emitContract`/`exportPayloadFromCatalog` for the contract, `runImport` end to end (fake connection, real inference) for the two refusal paths and header/stdout parity, `buildInventory` for the `stillReportedInInventory` claim, and two cycle graphs emitted to `/private/tmp` and loaded from every entry point with the production `jiti` (deleted afterwards).
- Suites: `packages/core` 99 files / 1508 tests green; `packages/query` 64 files / 857 tests green; `packages/cli` 564 passed, 189 skipped (docker-gated), **24 files failing only on the dist-freshness guard** — the single distinct error is "`@hejbro/core`'s dist/ is older than its src/ (stale build)", read not fixed per this round's brief. Every measurement above therefore runs from `src`; the only `dist` use is `jiti`'s own resolution of `"hejbro"` in the cycle-load probe, where the loaded surface (`schema`/`table`/`pgEnum`/`uuid`) predates this change.
- `node scripts/check-diagnostic-xref.mjs` (227 codes, ok) and `node scripts/check-bans.mjs` (235 files, ok). Not run: `pnpm build`, `pnpm install`, full-workspace `pnpm test`/`check-types` (another team holds the gate slot).

## Round 5 disposition

All three blocking findings and four of the five non-blocking ones are
fixed in this correction; N5 is split out as its own issue by an
explicit decision, not deferred by omission. Every fix carries a pin,
and every pin was mutant-verified — the mutant restored to the defect
under test, the suite run, and exactly the intended test(s) observed to
fail — so a pin that cannot fail is never counted as a pin.

Gate (lead close-out, 2026-09-03 23:57–00:03Z UTC, on 13b1440b = the correction's tip 63ddde97 with `upstream/dev` 8d096cab merged in and the ledger row): `pnpm build --force`, `check`, unfiltered `check-types` (16/16), full `pnpm test` (87 files, 766 tests), `check:bans`, `check:crap` (README unchanged), `smoke:pack-install`, `changeset status`, `check:tasktime`, `check:next-marker`, `check:fixed-group`, `check:diagnostic-xref` — all green. The `hejbro` integration suite on PG15 failed on one assertion in the new witness that was wider than the sentence it measured (`not.toContain("_id")` matched `widgets_name_idx`; the emitted declaration was correct); the assertion was narrowed to the `legacy` block in 600360d7 (test-only; the seven sibling assertions were checked and left as they were, mutant-verified), and the integration suites were re-run on that tip: PG15 11 files, 66 passed, 2 todo, PG17 11 files, 66 passed, 2 todo, with the four new witness cases (foreign key into an omitted table that also carries a UNIQUE, foreign key into an omitted schema, a leading-underscore column, the all-omitted refusal) executing for the first time. Dangling anonymous volumes: 0 before and after.

### R5-B1 — a foreign key into an omitted table or schema aborted the run

Fixed by taking the reference out with its target. The reading already
dropped an object whose catalog name no declaration can carry; it now
drops the foreign keys that point at such an object too, so a surviving
table is never declared against something the reading omitted, and
`referencesFor` never reaches `existingTable(...)` with a name D36
cannot carry. The omission is announced rather than silent:

```
Omitted: foreign key "<schema>.<table>.<name>" -- references <kind>
"<target>", which this reading left out. Next: <the target's own way out>
```

The remedy repeats the target's, so the line tells an adopter what to
change (rename in the database, then re-run `import`; for `pull`, rename
then link the schema repository) rather than what to declare.

Measured live from a fresh build against `dev`'s own source: importing
one schema whose surviving `orders` references an omitted `"Widgets"`
exits 1 with `invalid-sql-name`, the frame being `referencesFor`'s
`existingTable(...)` call. The reading stopped on the reference, not on
the object — which is the whole of this finding, and the reason a
correction that only filters declarations was not enough.

B1, N2 and N3 were treated as one defect rather than three symptoms:
each was a place where "which tables survived this reading" was decided
separately. The correction gives that fact a single owner,
`survivingTableIdentities`, computed once in `infer/compose.ts` and read
by the foreign-key partition and by the approximation detectors alike.
A narrower set, `tablesWithReachableForeignKeys`, feeds the detectors
that speak about foreign keys, so a key removed because its target was
omitted cannot also be announced as an approximation: one object, one
line.

Pins: `infer-compose.test.ts` — `tableFacts` gained a `foreignKeys`
parameter and a `foreignKeyTo` helper (the round-5 report noted the
helper could only build `foreignKeys: []`, which is why no suite could
have caught this), with four cases for `partitionForeignKeys`
(surviving target, omitted target table, omitted target schema,
self-reference). Live witness: `infer-omitted-names.integration.test.ts`
gained `app.line_items`, carrying one key into an omitted table and one
into an omitted schema.

### R5-B2 — a leading-underscore column name aborted the run

Fixed by removing the second judge. Declarability was decided by
`isNameRoundTrippable` while the DSL decided it again, three frames
later, with `assertSqlName`; `_id` is precisely the name the two
disagree about (it round-trips, and D36 rejects it). `isSqlName` is now
exported from `@hejbro/core` and consulted directly:
`isNameDeclarable = isNameRoundTrippable && isSqlName`. Round-tripping
is not discarded — it remains the second half of the question, since a
name the rule accepts is still undeclarable if no key produces it back
(`"createdAt"` fails both halves; `_id` fails only the rule).

This retracts the round-3 disposition's "`isSqlName` stays
module-private". That decision is what created the second judge, and
R4-B1 and R5-B2 are both its consequences. D36 itself is untouched: an
`^_` column is omitted and named, not admitted by loosening the rule.

The new export is classified in `exports.test.ts` and registered in
`cli/src/core-surface.ts`. `skills/hejbro` is **not** updated for it, by
decision: `isSqlName` is ENGINE-classified — it is not part of the
surface a schema author writes — and the same was done for
`assertSqlName` and `deriveForeignKeyName` in round 3. The skill is
still touched in this correction, for N1's own reason. Recorded here so
the decision is visible rather than inferred from a diff.

Pins: a unit pin for `isNameDeclarable` in `packages/cli/test/infer-compose.test.ts` (three shapes, mutant-verified);
live witness `infer-omitted-names.integration.test.ts` gained
`app.legacy(_id, label)`, where `_id` is omitted and named while `label`
is declared — the table is partly declared, not lost.

### R5-B3 — two tables sharing a check name swapped expressions

Fixed by matching the table as well: `checksFor` in `infer/adapter.ts`
looked a check expression up by schema and constraint name alone, and
Postgres only requires that name to be unique per table. The defect is
older than this change and silent — no loss-report line mentioned it,
and the DDL `baseline` would emit was rejected by the server the
declarations came from.

The class was swept, not just the instance. Every other lookup in
`infer/adapter.ts` was checked: `findColumnDetail`,
`findSequenceOwnership`, the constraint-detail lookup inside
`foreignKeysFor`, `indexesFor`, and `orderedColumnsWithKeys` — five
sites, all already matching on schema and table. `checksFor` was the
only one missing it. Recorded because "we looked and found nothing" is
otherwise indistinguishable from "we did not look".

Pin: `infer-constraints.test.ts` — two tables in one schema with a check
of the same name, each keeping its own expression.

### R5-N1 — the skill's Omitted band was stale

Fixed in `skills/hejbro/references/brownfield-adoption.md`. The band now
names all five omission kinds the loss report renders — schema, table,
index, check constraint, and (new in this correction) a foreign key into
an omitted object — and the column entry gained the `_id` shape beside
the `"createdAt"` one. The wording was written against what
`loss-report.ts` actually renders: a skill that claims more than the
code is a broken user contract, not a documentation nit. This is the
second consecutive round in which a band of this page went stale
(R4-N1 was the Approximated band next door).

### R5-N2 — the UNIQUE approximation spoke about omitted tables

Fixed by giving `detectUniqueIndexApproximations` the surviving-table
set its three sibling detectors already received; it was the only one
still reading the schema-filtered catalog.

An abort was reported through the lead during this correction (a built
CLI on `dev`, a UNIQUE constraint on a CamelCase table, exiting 1 with
`invalid-sql-name`) and was first read as this detector's. It is not:
measured again from a fresh build against `dev`'s own source, the frame
is `referencesFor`'s own `existingTable(fk.targetSchema,
fk.targetTable, …)`, reached because the fixture's surviving
`shop.orders` holds a foreign key into the omitted `shop."Widgets"`.
That is R5-B1's path, and B1's fix is what closes it. The two readings
never contradicted each other: the unit probe that failed to reproduce
the abort had no inbound foreign key, so it could not reach the frame
that throws — a fixture difference, not a disagreement about the code.

What this detector's own fix changes is narrower and remains its own:
an approximation announced about a table the reading omitted.

Pins: `infer-unique-on-omitted-table.test.ts` — one test asserting all
three of no abort, no approximation line, and the omission line present;
plus the existing R5-N2 case in `infer-loss-report.test.ts`. Removing
the surviving-table filter fails exactly those two. Live witness:
`app."Widgets"` gained `unique (sku)`, with the starter asserted not to
carry `Widgets_sku_key`.

### R5-N3 — an all-omitted run said "nothing to infer"

Fixed by refusing with a reason of its own. `import` now separates two
statements that were being made with one code: a named schema that is
genuinely empty still raises `import-nothing-to-infer`, while a run in
which every named schema was omitted for its own name raises the new
`import-nothing-declarable`, naming those schemas and the way out
(rename in the database, then rerun). The loss report's `Omitted: schema
…` lines are printed with the refusal — the refusal is built without
throwing, so the diagnostic and the report reach the user together
rather than the former discarding the latter.

The refusal happens before any write, and before the destination
directory is created: an earlier measurement of the exit-0 variant found
it left an empty `--out` directory behind, and a run that produced
nothing should leave nothing. The pin asserts all four of exit code 1,
the new code, the `Omitted: schema` line on stdout, and
`existsSync(out) === false`.

`pull` keeps its asymmetry deliberately: it has no such refusal and
prints the line, because its contract is to write a contract, not
starter files — there is no "produced nothing" state to refuse.

Pin: `import-command.test.ts` (replacing the earlier exit-0 case).

### R5-N4 — the foreign-key name rule was stated without its exception

Fixed in the delta text; no code change. `cli-commands` now states the
exception the code has implemented since round 3: a catalog name D36
cannot carry at all is declared under the derived name and announced as
an approximation, because a foreign key's name is a label on a
constraint the declaration still expresses, not the constraint's own
identity — which is why a table or schema of the same shape is omitted
instead. `catalog-inference`'s approximation enumeration gained that
kind. Cross-checked against `expressibleForeignKeyName` and
`detectForeignKeyNameApproximations`, which name both the catalog name
and the derived one.

### R5-N5 — an enum's catalog name is not held to D36

Split out as **#712**, by decision rather than by omission. It shares a
root with B2 (which identifier rule applies where), but its user-visible
consequence differs in kind: not one column or one table, but an entire
enum type reaching the starter file and the emitted DDL under a name
`--rename`/`--confirm-drop` cannot address. Settling "carry, or
omit-and-name" for enums inside this correction would have decided it
by proximity to a bug rather than on its own terms.

### Delta changes in this correction

`catalog-inference`: declarability defined as one rule — core's own
identifier rule, consulted, plus the key producing the name back —
rather than a prediction of it; omission extended to the foreign keys
that point at an omitted object, with no approximation announced for
anything omitted; the foreign-key-name approximation added to the
enumeration; two scenarios added (a reference into an omitted object,
two tables sharing a constraint name). `cli-commands`: the undeclarable
column clause extended to a name the rule rejects; the two refusal
reasons given separate codes and the destination left untouched; the
foreign-key-name exception stated; two scenarios added (a name the DSL
rejects, every named schema omitted).

## Round 6

### Verdict

BLOCKING 1 / NON-BLOCKING 5 / OK 21

(23 delta scenarios: `catalog-inference` 7, `cli-commands` 10,
`schema-vendoring` 3, `table-declaration` 3. Two scenarios are blocked
by one finding. All eight round-5 findings are closed as written — but
the round-5 correction for R5-B1 over-reaches: it decides "may this
foreign key be declared?" from *which tables this reading kept*, not
from *which names this reading could not carry*, so a foreign key into
any schema the run did not name — the ordinary `public.profiles →
auth.users` shape a hosted Postgres has, and the exact shape the
`--schema`-has-no-default rule pushes every adopter into — is now
silently dropped from the starter file and from the pulled contract,
under a report line whose remedy is false.)

### Round-5 findings re-checked

- **R5-B1 — a foreign key into an omitted table or schema aborted the
  run — CLOSED for its own inputs, the fix over-reaches (see R6-B1).**
  Measured live (one throwaway `postgres:17`): `s1.orders` holding one
  key into an omitted `s1."Widgets"` and one into a table under an
  omitted `"App"` reads to completion under both `import` and `pull`,
  `orders` is declared with its third (reachable) key only, and each
  dropped key gets its own line. With `"App"` *named* on `--schema`, the
  line correctly reads `references schema "App"` with the schema remedy
  (`partitionForeignKeys`, `compose.ts:301-330`; `targetKindFor`,
  `:266-274`). Two runs byte-identical (`identicalBytes: true`).
- **R5-B2 — a leading-underscore column name aborted the run — CLOSED.**
  `isNameDeclarable = isNameRoundTrippable && isSqlName`
  (`compose.ts:148-149`), `isSqlName` exported from core
  (`core/src/sql/identifier-rules.ts:17`, `core/src/index.ts:386`) and
  classified in `cli/src/core-surface.ts:225`. Measured on a real table
  holding `_id`, `_created_at`, `_9lives`, `a_` and `label`: the run
  completes, all four exotic columns are omitted and named, `label` is
  declared. (The lines' stated *reason* is wrong for three of them —
  R6-N1.)
- **R5-B3 — two tables sharing a check name swapped expressions —
  CLOSED.** `checksFor` (`infer/adapter.ts:182-199`) now matches
  `row.table` as well. Measured: `s3.a`/`s3.b` each keep their own
  expression, and the emitted DDL was executed against a fresh database
  on the same server without error (previously `ERROR: column "x" does
  not exist`).
- **R5-N1 — the skill's Omitted band was stale — CLOSED.**
  `brownfield-adoption.md:251-274` now names all six omission kinds
  `buildLossReport` renders (column, schema, table, index, check
  constraint, foreign key). Checked band-by-band against
  `loss-report.ts:498-517`'s own composition; the Approximated band still
  matches `approximationLines`'s four kinds exactly.
- **R5-N2 — the UNIQUE approximation spoke about omitted tables —
  CLOSED, and not over-filtered.** `s1."Widgets"` (omitted, carrying
  `unique (sku)`) produces no `Approximated:` line; `s10.u` (surviving,
  carrying `u_email_key`) still does. Both measured live.
- **R5-N3 — an all-omitted run said "nothing to infer" — CLOSED.**
  `runImport(--schema App)` against a database whose only named schema
  is `"App"` exits 1 with `import-nothing-declarable`, prints the
  `Omitted: schema "App" …` line with its way out on stdout, and leaves
  `--out` uncreated (`existsSync === false`) — all four measured end to
  end. `import-nothing-to-infer` still fires, unchanged, for a genuinely
  empty schema.
- **R5-N4 — the foreign-key-name rule was stated without its exception —
  CLOSED.** `cli-commands` now carries the D36 exception and
  `catalog-inference`'s approximation enumeration carries the kind;
  both read back exactly onto `expressibleForeignKeyName`
  (`infer/table.ts:194-200`) and `detectForeignKeyNameApproximations`.
  Measured: `comments_post_id_fkey` written out as `name:`,
  `notes_post_id_fk` left implicit, `"FK_…"` derived + announced.
- **R5-N5 — an enum's catalog name is not held to D36 — STILL OPEN by
  decision (#712).** Re-measured, reported below as R6-N5, not
  classified as blocking: no delta scenario speaks to an enum's name.

### Blocking

**R6-B1 — a foreign key into any schema the run did not name is dropped
from the starter file and from the pulled contract, under a report line
that tells the adopter to rename a table that has nothing wrong with
it.** `partitionForeignKeys` (`compose.ts:301-330`) keeps a foreign key
only when its target is in `survivingTableIdentities` (`:410-414`), and
that set is built from `mergedTables` — the tables inside the schemas
`--schema` named. A target outside those schemas is therefore treated
exactly like a target the reading omitted for its name. Measured live
against `postgres:17`, in-process from `src`:

```sql
create schema s5; create schema s6;
create table s6.users  (id uuid primary key);
create table s5.orders (id uuid primary key, user_id uuid references s6.users(id));
```
```
inferFromCatalog({schemas:["s5"], command:"import"}).sql
  create table "s5"."orders" ( "id" uuid not null, "user_id" uuid, … );
  -- no `alter table … add constraint "orders_user_id_fkey" …`
lossReport:
  Omitted: foreign key "s5.orders.orders_user_id_fkey" -- references table
  "s6.users", which this reading left out. Next: rename the table in the
  database, then re-run `hejbro import`.
```

`s6.users` is lower snake_case; renaming it changes nothing, and the
report offers no other way out (`--schema s6`, or an `existingTable`
handle, are never named). `pull --db-url --schema s5` writes the same
loss into the contract: `contractMetadata.tables.orders.foreignKeys` is
`[]` and `Relationships` is `readonly []`, where `--schema s5 --schema
s6` writes
`{ name: "orders_user_id_fkey", …, referencesSchema: "s6", referencesTable: "users", … }`
— measured, both contracts read off disk.

This is a regression introduced by the round-5 correction, not a
pre-existing gap: `partitionForeignKeys` does not exist in
`2146480c^`'s `infer/compose.ts` (`grep -c` → 0). Mutant-measured on the
shipped tree — restoring the pre-correction wiring
(`tablesWithReachableForeignKeys = mergedTables`, `compose.ts:433`) and
re-reading the same database emits
`alter table "s5"."orders" add constraint "orders_user_id_fkey" foreign
key ("user_id") references "s6"."users" ("id");` with no abort, because
`referencesFor`'s `existingTable(fk.targetSchema, fk.targetTable, …)`
(`infer/table.ts:297`) is D41's own mechanism for referencing a table
this repository does not declare, and both `s6` and `users` pass D36.
The file restored; `git status --porcelain` clean.

The emitter already knows how to do this: the three-schema cycle case
writes exactly such a handle
(`const caTCcAFkRef = existingTable("ca", "t", { id: uuid() });`,
measured in the emitted `cc.schema.ts`). The one guard the R5-B1 fix
actually needed — "is this target a name the reading could not carry?" —
is available (`isExpressibleName` on `fk.targetSchema`/`fk.targetTable`)
and is not the guard the code asks.

Contradicts:
- `cli-commands` › import writes starter declarations › **"A database is
  imported into starter files"** — "a following `baseline` emits a first
  migration whose objects match the database's". For any named schema
  holding a reference into an unnamed one, the emitted objects are
  missing that constraint. The same requirement makes `--schema`
  mandatory *because* a hosted Postgres's own `auth`/`storage` schemas
  are never what you meant to adopt — so the run that drops the
  reference is the run the requirement tells every adopter to make.
- `cli-commands` › pull reads a database as the marked fallback ›
  **"A contract is pulled from a database"** — the contract emitter
  carries per-table `foreignKeys` (`contract/emit.ts:198-212`), and this
  path empties them.
- `catalog-inference` › "A catalog reading yields a snapshot and a
  marked description" — "Leaving such an object out SHALL never stop the
  reading — **everything else in the named schemas is still inferred**".
  A foreign key held by a surviving table in a named schema is
  "everything else", and it is no longer inferred. The requirement's own
  closed list of what the snapshot omits does not contain "a reference
  into a schema this run did not read".
- The report's own claim. `omittedForeignKeyLineForImport`
  (`loss-report.ts:465-466`) states "which this reading left out" and
  `omittedForeignKeyRemedyForImport` (`:438-444`) states "rename the
  table in the database" for a target that was never omitted and needs
  no rename; `skills/hejbro/references/brownfield-adoption.md:265-269`
  describes this line as firing only for a target "itself omitted for
  one of the reasons above", which is not what the code does.

No suite covers it: `infer-compose.test.ts:200-268` pins four
`partitionForeignKeys` cases (surviving target, omitted target table,
omitted target schema, self-reference) and the omitted-target-table case
is byte-for-byte the shape of the out-of-scope case — the code cannot
tell them apart, so the pin passes on the defect.

### Non-blocking

**R6-N1 — the loss report gives a false reason, and an impossible
remedy, for a column omitted by the identifier rule rather than by the
round trip.** `undeclarableNameLineForImport` (`loss-report.ts:310-313`)
renders one sentence for both halves of `isNameDeclarable`: "its SQL
name has no declaration key. … until it is declared by hand or renamed
in the database". Measured key derivation (`inferColumnKeys`):

| SQL name | key | round-trips | `isSqlName` |
|---|---|---|---|
| `_id` | `_id` | yes | no |
| `_created_at` | `_createdAt` | yes | no |
| `_9lives` | `_9lives` | yes | no |
| `a_` | `a` | no | yes |
| `createdAt` | `createdat` | no | no |

Three of the five *do* have a declaration key; only `a_` and
`"createdAt"` do not. And "declared by hand" is not available for any of
the three: `table(schema("x"), "t", { _id: uuid() })` throws
`invalid-sql-name` (measured) — renaming in the database is the only
remedy. The delta itself carries the same wording (`cli-commands`
extended the clause to the rule-rejected case without touching the
consequence sentence), and the scenario "a column the DSL rejects by
name is left out the same way" is *matched* — text and code are wrong
together, which is why this is non-blocking rather than blocking.

**R6-N2 — a comment states a constraint the round-5 correction
retracted.** `infer/table.ts:155-169` reads "`@hejbro/core` exports only
the throwing assertion, not a boolean query — a boolean predicate is not
otherwise public surface this package needs, so every caller here wraps
`assertSqlName` in a `try`/`catch` rather than restating its pattern".
Core now exports `isSqlName` (`core/src/index.ts:386`) precisely because
that ruling was withdrawn, and `isNameDeclarable` calls it directly —
while `isExpressibleName` (`infer/table.ts:170-177`), the guard for
schemas, tables, indexes, checks and foreign-key names, still
`try`/`catch`es. One rule, two spellings, and the comment asserts the
reason for the older one as if it still held (AGENTS.md: a comment
records the constraint, and this one records a repealed decision).
`grep -rn '\^\[a-z\]' packages/cli/src packages/core/src` confirms the
substantive half is fine: no local regex, both guards reach core's own
`SQL_NAME_PATTERN`.

**R6-N3 — the way-out line is no longer the report's last line.**
`withEmptySchemaLines` (`commands/import.ts:204-210`) appends the
empty-schema lines after `buildLossReport` has already closed with
`wayOutLine` (`loss-report.ts:485-491`). Measured for
`--schema s8 --schema s11`, identically in stdout and in the written
file's header:

```
The loss ends when you hand-edit the starter declarations.
Not inferred: nothing to infer in schema "s11".
```

No delta clause fixes the order (the requirement lists the report's
contents, not their sequence), and header/stdout parity — the round-2
finding — still holds exactly. Drift, not contradiction.

**R6-N4 — the release notes never mention the check-expression swap.**
`.changeset/fix-catalog-inference-d106-r5.md` names the `_id` fix, the
foreign-key-target fix, the UNIQUE-on-omitted-table fix and the refusal
split, but not R5-B3 — the one defect in that correction that silently
produced a *wrong* declaration (a check asserted against another table's
columns, whose DDL the source server rejects). A user already running
`import` on a database with two same-named checks has a starter file
that is wrong today and no line in the notes telling them so. The
`.changeset` gate is satisfied (exactly one file, correct bump); this is
about what it says.

**R6-N5 — an enum type's catalog name is still the one identifier the
D36 net never touches (#712).** Re-measured on the shipped tree:
`create type s7."Status" as enum ('a','b')` reaches the snapshot, the
starter (`export const status = pgEnum(s7, "Status", ["a","b"]);`) and
the emitted DDL (`create type "s7"."Status" as enum ('a', 'b');`) with
no loss-report line, while a table, schema, index or check of exactly
that shape is omitted and named. `pgEnum` asserts nothing
(`core/src/dsl/pg-enum.ts`). No delta scenario speaks to an enum's own
name, so this is reported, not classified — as the round-5 disposition
decided.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — OK. Measured live on a two-schema fixture with cross-schema foreign keys, a check, an index and an enum: each is recorded with its columns, keys and constraints (`P4 both sql`, `P1 sql`); the duplicate-check-name defect that broke this in round 5 is closed and its DDL now executes against the source server.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — OK. `["user_id","USER_ID","user_id2"]` measured under three orders: `userId`/`userId3`/`userId2` in all three — the declarable columns keep their own bare keys, the exotic sibling takes the suffix, and `userId2` is never stolen. Both colliding columns appear in `description`.
- `catalog-inference` › … › **A name no declaration can carry costs that object, not the run** — OK. Schema `"App"`, table `s1."Widgets"`, index `"IX_Widgets"`, check `"CK_Parts"` measured through both commands: every ordinary sibling still inferred, starter and contract still written, one line per omission with its own consequence and an adopter-facing remedy ("rename … in the database, then re-run `hejbro import`").
- `catalog-inference` › … › **A reference into an omitted object is omitted with it** — OK for the inputs this scenario names. Measured: `s1.orders → s1."Widgets"` names the table and its remedy; with `"App"` on `--schema`, `s1.orders → "App".orders` names `references schema "App"` and the schema remedy; the surviving table keeps its other key; no approximation is announced for anything omitted; two runs byte-identical. (The same code path also fires for targets this reading did **not** omit — R6-B1.)
- `catalog-inference` › … › **Two tables sharing a constraint name keep their own expressions** — OK. `s3.a pos (x > 0)` / `s3.b pos (y < 0)` each keep their own expression, and the emitted DDL was executed against a fresh database on the same server without error.
- `catalog-inference` › … › **What is not inferred is named** — OK. `notInferredLines` (`loss-report.ts:248-276`) counts each kind and names each column-with-type and unowned sequence; `infer-rest.test.ts`, `infer-loss-report.test.ts` green.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. Every measured report carries Guessed / Not inferred / Approximated / Omitted and the way-out sentence, `pull`'s being "The loss ends when you link the schema repository". (Ordering nit: R6-N3.)
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — OK. A three-schema chorded graph (`ca→cb`, `cb→cc`, `cc→ca` foreign keys plus a `cc→ca` enum column) emitted to a real directory: import edges `{ca:[cb], cb:[cc], cc:[]}`, acyclic; the cut carries an unexported `existingTable` handle for the foreign key and an unexported local `pgEnum` clone for the enum, each with its own comment; loaded through the production `jiti` from all three entry points, 3/3 clean, nothing declared twice.
- `cli-commands` › … › **A second import writes the same bytes** — OK. Two readings of the same database (including its omissions) emit byte-identical files; each header carries the full report and the repository-owns-it sentence, with no clock- or machine-derived value.
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R6-B1). Two schemas, files written, report printed, `baseline`-shaped DDL correct — unless a named schema references an unnamed one, in which case the emitted objects no longer match the database's.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — OK. A quoted `"createdAt"` and an `a_` are excluded, named with table and consequence, and every other column of the table is declared.
- `cli-commands` › … › **a column the DSL rejects by name is left out the same way** — OK as written. `_id`, `_created_at`, `_9lives` are omitted, named with their table and the same consequence, and `label` is still declared — "exactly as it does for a name no key can produce", which is what the scenario asks. (The line's stated reason is false: R6-N1.)
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `import-schema-missing` names `--schema` and "most commonly --schema public" before any connection, writing nothing; `--out` has its own code (`import-destination-missing`).
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK. `import-nothing-to-infer` naming the schemas, exit 1, `stdout: []`, destination not created — measured end to end.
- `cli-commands` › … › **Every named schema was omitted for its name** — OK. `import-nothing-declarable` (a code of its own), the `Omitted: schema "App" …` line printed on stdout with the refusal, and `existsSync(out) === false`.
- `cli-commands` › … › **import never overwrites** — OK. `import-destination-exists` naming the file; the pre-existing file's bytes unchanged after the run. An unwritable destination raises `import-destination-unwritable` naming the path.
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — BLOCKING (R6-B1). Header, guessed keys, loss report and `link` way-out all correct; the contract's `foreignKeys`/`Relationships` lose every reference into an unnamed schema.
- `schema-vendoring` › **pull writes where vendor writes** — OK. `assertLockWritable`/`assertContractDestinationWritable` with `force: false` and `"hejbro pull"` before any network work (`commands/pull.ts:138-143`); the four vendor paths written under `.hejbro/vendor/` and a root `hejbro.lock` carrying `generatedBy: "hejbro pull"` — read off disk. A second `pull` into the same repository succeeds under vendor's own rules.
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. Measured contract text: header "inferred from a database catalog, not vendored from a schema repository", `source: "database"`, `database: "r6"`, `schemas: ["s5"]`, no `commit`. `ContractMetadata` (`query/src/client/contract-types.ts:81-104`) is a `source`-discriminated union whose git arm keeps `source` optional, so a pre-#604 contract still type-checks against `createNameKeyedDb`.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK. `assertLockNamesACommit` before any source read in `outdated.ts:42` and `vendor.ts:75`; `outdated-database-origin.test.ts`, `vendor-lock-origin.test.ts` green (`vendor-check.test.ts` blocked only by the dist guard).
- `table-declaration` › **A named foreign key keeps its name** — OK. A catalog `comments_post_id_fkey` reaches the starter as `name: "comments_post_id_fkey"` and the DDL as `add constraint "comments_post_id_fkey"`.
- `table-declaration` › **An unnamed foreign key is unchanged** — OK. A key whose catalog name equals the derived one emits no `name:` field; `declare-emit-emit.test.ts` green.
- `table-declaration` › **Renaming the table leaves an explicit name alone** — OK, and now mutant-verified. `rename-plan.test.ts:1832` asserts the full `renameStatements` list (table rename + pkey rename, no FK rename) plus `diffSnapshots(rewrittenPrevious, next) === []`; line 1822 pins the derived half (`rename constraint "posts_author_id_fk" to "articles_author_id_fk"`). Forcing `wasDerived = true` at `core/src/engine/rename/retarget.ts:691` fails exactly those two tests and no others; file restored, `git status` clean.

### Method

- Read `openspec show add-catalog-inference --diff` in full, then the named surface: `packages/cli/src/{commands/{import,pull}.ts,infer/{compose,table,adapter,column-keys,loss-report}.ts,declare-emit/emit.ts,contract/emit.ts,vendor/lock.ts,core-surface.ts}`, `packages/core/src/{sql/identifier-rules.ts,engine/rename/retarget.ts,index.ts}`, `packages/query/src/client/contract-types.ts`, `skills/hejbro/references/brownfield-adoption.md`, `.changeset/{add-catalog-inference,fix-catalog-inference-d106-r3,-r4,-r5}.md`. Only rounds 1–5 of `evaluation.md` were read (findings + dispositions), as claims.
- Live witness, one throwaway `postgres:17` container (`docker system df` first — 3 containers, 6 volumes, none running; `docker rm -v -f` after, volume list byte-identical to the pre-run list, and the three containers this session did not create left alone). Eleven fixture schemas driven through the real `inferFromCatalog`/`emitDeclarationFiles`/`runImport`/`runPull` from `src`: the round-5 exotic set (`"App"` schema, `s1."Widgets"` with a UNIQUE, `"IX_Widgets"`, `"CK_Parts"`, default `_fkey` names) read twice under both commands; foreign keys into an omitted table, into a table under an omitted schema, and into a schema simply not named; a table holding `_id`/`_created_at`/`_9lives`/`a_`/`label`; two tables sharing a check name; a CamelCase enum; a `*/`-bearing column and table name; a three-schema chorded cycle with an enum edge; an empty named schema. The emitted DDL for the duplicate-check case and for the cycle case was executed against, and loaded from, real servers respectively.
- Two mutants, each applied and reverted inside one tool call with `git status --porcelain` verified clean afterwards: `tablesWithReachableForeignKeys = mergedTables` (`compose.ts:433`) to measure the pre-correction behavior R6-B1 removes, and `wasDerived = true` (`core/src/engine/rename/retarget.ts:691`) to verify the round-3 rename pin can fail.
- In-process probes created, run and deleted in the same tool call (`packages/cli/test/_r6probe*.test.ts`, six batches); one throwaway loader project under `/private/tmp/_r6proj` (symlinked `hejbro`/`jiti`, deleted afterwards) for the `jiti` cycle load. `git status --porcelain` shows only `evaluation.md`.
- Suites run: `infer-compose`, `infer-constraints`, `infer-loss-report`, `infer-unique-on-omitted-table`, `infer-keys`, `infer-tables`, `infer-adapter`, `import-command`, `pull-command`, `contract-origin`, `outdated-database-origin`, `declare-emit-{emit,file-cycle,topo-order,enum-cycle-load}`, `exports`, `vendor-lock-origin` — 15 files / 158 tests + 2 files green; `packages/core` `identifier-rules`, `sql-identifier`, `rename-plan` — 3 files / 54 tests green. `link.test.ts`, `loader-cycle.test.ts`, `vendor-check.test.ts` fail only on the dist-freshness guard ("`@hejbro/core`'s dist/ is older than its src/"), read not fixed per this round's brief; every measurement above therefore runs from `src`, the one exception being `jiti`'s own resolution of `"hejbro"` in the cycle-load probe, where the loaded surface (`schema`/`table`/`pgEnum`/`uuid`/`existingTable`) predates this change.
- Not run: `pnpm build`, `pnpm install`, full-workspace `pnpm test`/`check-types`, Docker-gated `*.integration.test.ts` (another team holds the gate slot and was running PG15/PG17 containers concurrently).

## Round 6 disposition

The blocking finding and four of the five non-blocking ones are fixed
here; N5 stays with #712 by the same explicit decision round 5 made, not
by omission. Every fix that changes behaviour is pinned by a red
observed failing against the unfixed code; the one that does not — the
name-guard refactor — has no red by decision, since a manufactured red
for a behaviour-preserving change proves nothing, and is pinned instead
by an input table checked against core's own rule and by a mutant.

Of the eight reds, four are behavioural — an assertion on rendered text
or on line order failing against the old behaviour — and four are
signature failures, where a test written against a new, narrower
signature crashes against the old code before it can disagree with it.
A signature red proves that a test calls the new code, not that it can
tell right from wrong, so in those places the discriminating evidence is
the mutant rather than the red. Five mutants were run across three of
the five code commits, each with both halves stated before it ran: what
it must break, and what it must leave standing. In every case exactly
the predicted tests failed and the named siblings stayed green.

Gate (2026-09-03, on `03898587`, the correction's own tip before the
merge-in): `pnpm --filter hejbro test:integration` 12 files / 68 passed,
2 todo; `TURBO_FORCE=1 pnpm check` 723 files; unfiltered
`TURBO_FORCE=1 pnpm check-types` 17/17 tasks, 0 cached; `TURBO_FORCE=1
pnpm test` 17/17 tasks (`hejbro` 88 files / 773 tests, `cli-smoke` 2
files / 6 tests); `pnpm check:bans` 235 files; `pnpm check:crap` 0 of
1617 functions over CRAP 5, README unchanged; `changeset status` pending
minor across the fixed group; `check:tasktime` current. Docker residue
after every run of this round: 0 containers, 0 volumes of this suite's
own. `upstream/dev` `4cc85c43` was then merged in at `90b8c854` —
`check/compare.ts`, its two tests and a changeset, no file this round
touched — and the delta was re-validated after the merge (`validate
--strict` *and* `show --diff`, since the first does not check that a
delta's target exists) with the round's own files plus dev's
`check-compare` re-run file-scoped: 10 files / 133 tests. What follows
that tip is test-only or documentation — the emitter pin and the
witness's snapshot assertion (re-run after `pnpm build --force`: both
halves, 2/2) and this record. The one source change after `03898587`
arrived with `upstream/dev`'s own merge and was gated on `dev`.

One measurement in that gate was only possible after an environment
repair, recorded because it will recur: this worktree branched from a
`dev` that had added a new workspace package (`examples/brownfield`),
and `pnpm install` had never run in it. The missing `node_modules`
failed one turbo task, which canceled an in-flight `@hejbro/core:build`
*after* tsdown had deleted `dist` and before it wrote it back — so an
unrelated example's missing install surfaced as `Cannot find module
'@hejbro/core'` across the workspace. `pnpm install` plus
`pnpm build --force`, then re-measure.

One thing about this round's order is worth recording, because it
decided the outcome: the live witness was written before the gates and
run first inside the slot, and it failed. The blocking finding had two
halves, and the unit tests could only see one of them. A round that had
run the witness last would have shipped a correction that fixed
`import` and left `pull` exactly as the report found it.

### R6-B1 — a foreign key into a schema the run did not name was dropped

Fixed by asking the question the guard was supposed to ask.
`partitionForeignKeys` decided a reference's fate from
`survivingTableIdentities` — *which tables this reading kept* — so a
target outside the named schemas was indistinguishable from one the
reading omitted for its name. It now asks whether the target's own
schema and table names are ones a declaration can carry
(`isExpressibleName` on each), which is the only property the round-5
correction ever needed: the abort it fixed happened because
`existingTable(...)` was handed a name D36 rejects, never because the
target was out of scope. `targetKind` follows from which of the two
names failed, so the report's own `schema`/`table` wording keeps
matching the reason. `isSelfReference` was removed rather than kept: a
table that reaches this point has passed `partitionTables`, so its own
names are expressible and a self-reference is carried by the same rule
as everything else.

That alone would have replaced a silently missing constraint with a
starter file that does not parse. `mustDeferForeignKey` sent a target
the run never read down the ordinary path, where `identifierForTable`
falls back to the raw dotted identity — measured, as the red this
correction started from:

```
foreignKeys: [{ columns: [t.owner_id],
  references: { table: ext.users, columns: [ext.users.id] }, … }]
```

`ext.users` is not an identifier. The emitter now routes any target it
did not read through the same unexported `existingTable` handle it
already builds for a cycle cut — the renderer needed no change, since it
was already written to tolerate a target it cannot find.

The contract needed a third change, and the witness is what found it.
The two commands read **different artifacts of one reading**: `import`
writes declaration text, which carries the handle and therefore the
reference, while `pull` reads the snapshot alone — and the snapshot did
not carry the target, so `contract/tables.ts`'s `findTableInSnapshot`
dropped the relation. Loosening that rule (condition 5.9) was
considered and rejected — the main `schema-vendoring` spec already says
an `existingTable` target is carried as a relation, so 5.9 was right and
the two snapshots were the defect. The reading now carries the unread
target itself: one handle per target identity, built in `compose.ts`
from the union of the columns any foreign key references, handed to
`inferTable` so the object a key references *is* the object declared,
and appended to the declarations for targets outside the survivor set
only.

Three measurements were taken before that landed, and one of them
corrected a premise. The generated SQL is byte-identical with and
without the handles (the snapshot gains `table:ext.users`; the DDL does
not move), `generateMigration` accepts an `existingTable` whose schema
is not declared, and the handle contributes `text()` columns — the
referenced ones only — because a table this run never read has no
catalog facts to draw on. A fourth measurement settles what the first
three left open: the witness reads the `hejbro.snapshot.json` that
`hejbro generate` writes from the emitted starter files and asserts that
it holds **no** `table:ext.users` node — the emitted handle is
unexported, so no loader ever collects it as a declaration. The two
paths therefore do not converge on one snapshot; they converge on not
losing the reference, and the DDL is identical either way. That is what
the delta says, and it says nothing about node parity, which is not a
property this change needs.

For the same reason the contract names the target only through the
relation and the foreign-key metadata and gives it **no entry of its
own** among its tables (lead ruling, after this was measured): the
handle carries the referenced columns under fallback types, so a table
entry would be the contract asserting a column set and types for a
table it never read. A contract that guesses is worse than one that
says only what it knows.

One side effect had to be closed in the same commit: nothing had ever
filtered existing tables out of the emitted set — there was no need
before, because no reading produced one — so with a node in the
snapshot `emitDeclarationFiles` treated the target as a table to write,
`targetSchemaOf("ext.users")` resolved to `"ext"`, the deferral took the
back-edge branch instead of the unconditional one, and the emitter tried
to import a `./ext.schema` file that is never written. Existing tables
are now filtered out of the emitted set. The observer that caught it was
an assertion added while reviewing the witness draft — that no starter
file exists for the schema the run never named.

Pins: `infer-compose.test.ts` — the out-of-scope case, and the two
omitted-target cases rewritten so the target's *name* is what a
declaration cannot carry, which is what makes them tell the two
situations apart at all; `declare-emit-emit.test.ts` — the handle for an
unread target, asserted inside that table's own export block, throwing
if the block is not found, and — added after the fact, see below — that
an existing-marked table is written to no file and imported by none;
`contract-from-catalog.test.ts` — the relation and the foreign-key
metadata reaching the contract, built through the real pipeline after a
first draft that hand-built the snapshot and passed against the unfixed
code. Live witness: `infer-unnamed-schema-reference.integration.test.ts`,
both commands, a schema created and never named, through to the
generated DDL, the written snapshot, and a real `tsc` over the contract.

Both halves of this finding are places where the red was a signature
failure rather than a behaviour: three of the compose reds crashed on
the new one-argument `partitionForeignKeys` before they could disagree
with the old one, and the contract half's first red was a missing
function. The mutants are what show these pins discriminate, which is
why they were run here and why the count matters. Reading this
disposition back is what surfaced it, and it was answered rather than
argued away: the emitter
filter gained an in-process pin (it had no observer outside Docker), and
two mutants were run against the committed code — removing the handles
from the declarations failed only the contract pin, and removing the
`existing` filter failed only the new emitter pin, each leaving every
sibling in its file green.

### R6-N1 — one sentence for two causes, and a remedy that does not exist

`isNameDeclarable` has two halves and the report had one sentence, so a
column omitted because D36 rejects its name was told its name had no
declaration key — false for `_id`, `_created_at` and `_9lives`, which
all have one. The omission now carries a cause
(`noDeclarationKey` / `identifierRuleRejects`), set where both halves
are already in hand, and each command renders the reason that applies.

"Declared by hand" is gone from all four lines, including `pull`'s
"Link the schema repository to declare it by hand". This is wider than
the finding, on measurement: `buildColumnEntries` derives every column's
SQL name from its TypeScript key and accepts no explicit name beside it,
so no hand-written declaration — in this repository or in a linked one —
can carry either kind of name. Renaming in the database is the only
remedy that exists, and the report now offers no other. The delta and
the skill say the same.

Pins are input tables built from the round-6 report's own measurement
(`_id`, `_created_at`, `_9lives` against `"createdAt"`, `a_`), not one
example per branch. Corrected in passing, since the same comment block
was already open: `UndeclarableNameColumn`'s claim that `pull` "carries
every column regardless" was false — the contract emitter iterates the
snapshot's columns, so an excluded column never reaches it either.

### R6-N2 — a comment recording a repealed decision

`isExpressibleName` wrapped `assertSqlName` in `try`/`catch` and its
comment gave the reason: core exports only the throwing assertion. Core
has exported `isSqlName` since round 5, precisely because that decision
was withdrawn. The guard now calls it and the comment records what the
code cannot show — one D36 rule, asked of core, plus the foreign-key
name exception. Equivalence was measured rather than assumed
(`assertSqlName`'s branch condition *is* `isSqlName`; its other
arguments only build the message it throws) and pinned by an input table
that checks the guard against both the expected literal and a local
`try`/`catch`, with a mutant to prove the pin can fail.

### R6-N3 — the way out was no longer the last line

`import` appended its empty-schema lines after `buildLossReport` had
already closed the report. The way-out line is now placed by
`loss-report.ts` itself, which locates it by identity and re-appends it
after the extra lines, so no command has to know which index is last and
there is no throw path in a command. The test pins the order and the
round-2 parity property together — stdout and every file header carry
the same lines in the same order — so a future edit cannot fix one and
leave the other.

### R6-N4 — the release notes never mentioned the check-expression swap

The round-5 changeset gained a paragraph for R5-B3 in the file's own
voice: two tables sharing a check name swapped expressions, so `import`
wrote a starter file whose check asserts against another table's columns
and whose DDL the source server rejects. This round carries its own
`patch` changeset for what it changes for a user.

### R6-N5 — an enum type's catalog name

Untouched, as in round 5: no delta scenario speaks to an enum's own
name, and #712 holds it.

### What this record got wrong before it was committed

Four corrections, recorded because the corrections are evidence too.
The first draft of this disposition claimed **every** pin was
mutant-verified; two of five code commits had a mutant at the time, and
the claim was scoped to what was actually run — then three more mutants
and a unit pin were added, so the sentence above is now true rather than
trimmed. It also cited the byte-identity measurement's own control as
showing that a loaded starter gains no snapshot node; that control used
a fixture with no out-of-scope target at all and touched no file-loading
path, so it could show nothing of the kind — the witness now measures it
directly. And one instruction for a mutant named a line inside
`inferFromCatalog` that the test in question never calls, which would
have made the mutant vacuous — a mutant that cannot change the outcome
proves nothing, so it was aimed instead at the function the test does
call, with the same observable effect. Fourth, a recount: the claim
that all but one red was behavioural did not survive counting them —
four of eight were signature failures, and the fix that has no red at
all was being credited with one. The paragraph above now says which
evidence carries which place.

All four were found by the implementer reading the planner's own text
against its own measurements, which is the check this change has now
been saved by more than once. Three of the four were claims about
*evidence* rather than about the code — the easiest kind of sentence to
write loosely, because nothing in a green suite contradicts it.

## Round 7

### Verdict

BLOCKING 1 / NON-BLOCKING 5 / OK 22

(24 delta scenarios: `catalog-inference` 8 — the round-6 correction added
"A reference into a schema the run did not name is kept" — `cli-commands`
10, `schema-vendoring` 3, `table-declaration` 3. Two scenarios are
blocked by one finding. Every round-6 finding is closed in the code and
in the delta; R6-N1's own remedy correction never reached the skill,
which still offers the remedy that correction retracted. The blocking
finding is not in this round's own subject at all: the unnamed-schema
reference the round-6 correction added works end to end, live, through
`import` → `generate` → `check` and through `pull` → `tsc`. What fails
is older and much smaller — a starter file that names a table `t` cannot
be loaded by anything, because the emitter's own extras callback
parameter is also `t`.)

### Round-6 findings re-checked

- **R6-B1 — a foreign key into a schema the run did not name was
  dropped — CLOSED, measured end to end.** Live (one throwaway
  `postgres:17`): `app.orders/invoices/audit → ext.users`,
  `app.audit → ext2.accounts`, `--schema app` only. `import` writes
  `app.schema.ts` alone (no `ext.schema.ts`), declares every reference
  against an unexported `existingTable` handle, prints no `Omitted:`
  line, and two runs are byte-identical. The file loads through the
  production loader (`hejbro generate`: "loaded 5 declarations" — the
  handles are not collected), the migration carries
  `alter table "app"."orders" add constraint "orders_user_id_fkey"
  foreign key ("user_id") references "ext"."users" ("id");`, the written
  `hejbro.snapshot.json` holds no `table:ext.users` node, and `hejbro
  check --url` against the source database reports "no differences".
  `pull --db-url --schema app` puts `ext.users`/`ext2.accounts` in both
  `Relationships` and `contractMetadata.tables.*.foreignKeys`, gives
  neither an entry under `Tables`, says nothing about them in the loss
  report, and the emitted contract passes a real `tsc --strict` (exit 0).
- **R6-N1 — one sentence for two causes, and a remedy that does not
  exist — CLOSED in the code and the delta, STILL OPEN in the skill
  (R7-N1).** Measured on `s2.exotic`: `_id`, `_created_at`, `_9lives`
  now read "a key does produce this name back, but it is not a valid
  hejbro SQL identifier"; `a_` and `"createdAt"` read "no declaration
  key produces this SQL name back"; every line's only remedy is
  renaming in the database, for both commands
  (`undeclarableColumnReason`, `loss-report.ts:341-358`). No
  "declared by hand" survives on any of the four column lines.
- **R6-N2 — a comment recording a repealed decision — CLOSED.**
  `isExpressibleName = isSqlName` (`infer/table.ts:169`), with
  `isExpressibleForeignKeyName` delegating to it (`:178`); no
  `try`/`catch` and no local pattern —
  `grep -rn '\^\[a-z\]' packages/cli/src packages/core/src` returns one
  doc-comment citation in `compose.ts:141` and core's own
  `SQL_NAME_PATTERN`, nothing else.
- **R6-N3 — the way out was no longer the last line — CLOSED.**
  `withReportLinesBeforeWayOut` (`loss-report.ts:547-555`). Measured for
  `--schema s5 --schema s11`: `Not inferred: nothing to infer in schema
  "s11".` then `The loss ends when you hand-edit the starter
  declarations.` — identical in stdout and in `s5.schema.ts`'s header,
  the way-out line last in both. Also last in the `--schema App`
  refusal's own stdout, and in `pull`'s.
- **R6-N4 — the release notes never mentioned the check-expression
  swap — CLOSED.** `.changeset/fix-catalog-inference-d106-r5.md` now
  closes with a paragraph in the file's own voice ("Two tables in the
  same schema that each carry a check constraint of the same name no
  longer swap expressions … DDL the source database itself refused").
  `.changeset/fix-catalog-inference-d106-r6.md` (patch) covers this
  round's own three user-visible fixes.
- **R6-N5 — an enum type's catalog name — STILL OPEN by decision
  (#712).** Re-measured: `create type s7."Status" as enum ('a','b')`
  reaches the snapshot (`enum:s7.Status`) and the DDL
  (`create type "s7"."Status" as enum ('a', 'b');`) with no loss-report
  line, while a table/schema/index/check of that shape is omitted and
  named. Reported, not classified: no delta scenario speaks to an enum's
  own name.

### Blocking

**R7-B1 — a starter file that names a table `t` cannot be loaded by
anything: the emitted extras callback's own parameter shadows it.**
`renderExtrasBlock` (`declare-emit/emit.ts:733`) hardcodes the
parameter name `t` (`,\n\t(t) => ({…})`), and the file-level identifier
namespace that keeps a declaration from colliding —
`resolveFileIdentifiers`' own `reserved` set and `localNamespaceOf`
(`:1750-1759`), which together carry the schema, enum, table, handle and
enum-clone identifiers plus the hejbro barrel vocabulary — does not
contain `"t"`. So a table whose identifier is `t` keeps that name, and
every reference to it from inside an extras callback resolves to the
callback's own column proxy instead of the table.

Minimal input, measured live against `postgres:17` through the built
`dist/cli.js` (one schema, two tables, both ordinary lower snake_case,
nothing omitted, no cycle):

```sql
create schema m1;
create table m1.t      (id uuid primary key);
create table m1.orders (id uuid primary key, t_id uuid references m1.t(id));
```
```
$ hejbro import --url <db> --schema m1 --out src/schema
created src/schema/m1.schema.ts          # exit 0, loss report clean
```
```ts
export const t = table(m1, "t", { id: uuid().notNull().primaryKey() });

export const orders = table(m1, "orders", { id: …, tId: uuid() },
  (t) => ({
    foreignKeys: [{ columns: [t.tId], references: { table: t, columns: [t.id] }, name: "orders_t_id_fkey" }],
  }),
);
```
```
$ hejbro generate
error[declaration-load-failed]: src/schema/m1.schema.ts
  failed to load "src/schema/m1.schema.ts": Cannot read properties of
  undefined (reading 'schema'). Next: check that every import in this
  file resolves — …
```
The written file does not type-check either: `tsc --noEmit --strict`
over it fails with `TS2345 … Property '[tableMeta]' is missing in type
'TableColumns<…>'` — `references.table` is the proxy, not a `Table`.
The diagnostic's own remedy ("check that every import in this file
resolves") points at a cause that is not the cause.

The cross-file form needs no table of its own named `t`, only an
imported one: with `k1.t` and `k2.orders → k1.t` under
`--schema k1 --schema k2`, `k2.schema.ts` emits
`import { t } from "./k1.schema";` — unaliased, because `resolveAliasesFor`
only aliases against `localNamespaceOf`, and `k2`'s own identifiers are
`k2`/`orders` — and the same shadowing kills the file. The cyclic form
fails too (`h1.a`/`h1.b → h2.t`, `h2.t → h1.a`): the cut is placed in
`h2.schema.ts`, `h1.schema.ts` imports `t` bare, and loading fails in
every entry order.

Not a regression from the round-6 correction: none of the three failing
inputs produces an `existingTable` handle on the failing side (the `m1`
and `k1`/`k2` files contain no handle at all), so the path predates
commit 5.5 and belongs to the R2-B2 alias rule that has shipped since
`ecc533fb`.

Contradicts:
- `cli-commands` › import writes starter declarations › **"A database is
  imported into starter files"** — "a following `baseline` emits a first
  migration whose objects match the database's". `baseline` (and
  `generate`, and `check`) never reaches a migration: the file cannot be
  loaded. The requirement's own "The files SHALL declare what the
  reading inferred with the DSL's own builders" is what fails, on a
  table whose name D36 accepts and which no report line mentions.
- `cli-commands` › … › **"Declaration files never import each other in a
  cycle"** — "…and loading does not depend on which file the loader
  reaches first". For the `h1`/`h2` cycle the cut is correct and the
  import graph is acyclic, and loading still fails — in every order.

Scope: `import` only. `pull --db-url --schema m1` over the same database
is unaffected (the contract is emitted from the snapshot, never from the
declaration text) and carries `referencedRelation: "m1.t"` correctly.

No suite covers it: `declare-emit-emit.test.ts:235` pins the closest
shape (`import { b } from "./billing.schema";`) with a table named `b`;
no fixture anywhere in the suite names a table `t` and then references
it, and every cycle fixture that does name a table `t` references the
*other* file's table, where the alias rule fires for an unrelated reason
(the file's own table is also `t`).

### Non-blocking

**R7-N1 — the skill still offers the remedy the round-6 correction
retracted.** `skills/hejbro/references/brownfield-adoption.md:253-257`:
"`check` keeps reporting that column as undeclared until it's **added by
hand** or renamed in the database", and `:300-303` says `link` ends a
`pull`-sourced contract's loss "the same role it plays for `import`'s
undeclared column above". Both are the sentences R6-N1 removed from the
code and the delta on measurement (`buildColumnEntries` derives every
column's SQL name from its key and accepts no override, so no
hand-written declaration in this repository *or a linked one* can carry
either kind of name; `table(schema("x"), "t", { _id: uuid() })` throws
`invalid-sql-name`, re-measured). The round-6 disposition's own sentence
"The delta and the skill say the same" is true of the delta and false of
the skill. The skill's other bands are current: its Approximated four
match `approximationLines` exactly, its Omitted six match
`buildLossReport`'s six kinds, and its cycle paragraph and its new
"a foreign key into a schema `import`/`pull` simply never named is a
different case, not an omission" paragraph both match the shipped
behaviour.

**R7-N2 — two of the six `Omitted:` lines still say "declare it by
hand", which D36 makes impossible.** `omittedIndexLine`
(`loss-report.ts:455-456`) and `omittedCheckLine` (`:467-468`) both end
"…so declare it by hand or rename it in the database", one clause after
stating "no declaration can carry it under the same name `check` would
compare it by". Measured: `index("IX_Widgets")` and
`check("CK_Widgets", …)` both throw `invalid-sql-name`, so the only
thing a hand-written declaration can do is declare a *different* object
under a valid name — which `generate` then emits as a second index /
second constraint beside the one in the database. This is the same false
remedy R6-N1 removed from the column lines, left standing on the index
and check lines. No delta clause fixes these two lines' wording (the
requirement says only that the report "says what to do about it"), so
drift rather than contradiction.

**R7-N3 — the starter file tells the reader a cycle was closed when no
cycle exists.** Every handle-backed foreign key carries
`HANDLE_CONSTRAINT_COMMENT` (`declare-emit/emit.ts:741-742`):
"Closes a declaration-file cycle -- any live reference to the other
table … evaluates before that file finishes initializing …". Measured in
the written `app.schema.ts` for `app.orders → ext.users`, where `ext`
was simply never named: there is no cycle, no other file, and nothing to
initialize. The delta states the distinction explicitly — "A foreign key
into a table no starter file declares … SHALL be declared against such a
handle too, **for a different reason**: there is no file to import its
target from" — and `mustDeferForeignKey`'s own two branches keep them
apart in code while the emitted comment collapses them.

**R7-N4 — one handle per foreign key in the emitted text, one per target
in the snapshot.** `outOfScopeHandlesFor` (`compose.ts:377-410`) builds
exactly one `existingTable` per target identity, and its own comment
states why ("two keys into one target must resolve to the one object
that gets declared, never two objects sharing an identity"). The emitter
resolves a handle per `(owning table identity, FK name)`
(`handleIdentifierFor`, `emit.ts:705-708`), so the written
`app.schema.ts` carries three separate
`existingTable("ext", "users", { id: text() })` constants —
`extUsersOrdersUserIdFkeyRef`, `extUsersInvoicesUserIdFkeyRef`,
`extUsersAuditWhoFkeyRef` — for the one target. Nothing measurable
breaks (the handles are unexported, `generate` loads 5 declarations, the
DDL and `check` are correct, two runs are byte-identical), and the
cycle scenario's "nothing is declared twice" is satisfied in the loader's
sense; the two artifacts of one reading simply disagree about a rule one
of them states as load-bearing.

**R7-N5 — an enum type's catalog name is still the one identifier D36
never reaches (#712).** Re-measured this round (see the round-6 re-check
above); reported, not classified, since no delta scenario speaks to it —
the same decision rounds 5 and 6 recorded.

### Verified scenarios

- `catalog-inference` › A catalog reading yields a snapshot and a marked description › **Tables and enums are inferred** — OK. Live two-schema readings with cross-schema foreign keys, a check, an index and enums (`app`+`ext`, `s3`, `s7`, `s10`): every table, column, key and constraint is recorded, `enum:s7.kind`/`enum:s7.Status` carry their values, and the report's `Guessed:` line names the guessed keys.
- `catalog-inference` › … › **Two SQL names that collide on one key are both described** — OK. `s4.collide` (`user_id`, quoted `USER_ID`, `user_id2`): the description carries all three (`userId`/`userId3`/`userId2`), the two declarable columns keep their own bare keys, only `USER_ID` is named in the report, and `inferColumnKeys` gives the same assignment under four different physical orders.
- `catalog-inference` › … › **A name no declaration can carry costs that object, not the run** — OK. Schema `"App"`, table `s1."Widgets"` (carrying `"IX_Widgets"`, `"CK_Widgets"`, a UNIQUE and `"FK_Widgets_Owner"`): every ordinary sibling still inferred, starter and contract still written, one `Omitted:` line per object with its own consequence and an adopter-facing remedy, and no `Approximated:` line for the UNIQUE on the omitted table.
- `catalog-inference` › … › **A reference into an omitted object is omitted with it** — OK. `s1.orders → s1."Widgets"` names the table and the table remedy; `s1.orders → "App".orders` names `references schema "App"` and the schema remedy, identically whether or not `"App"` is on `--schema`; `orders_owner_id_fkey` survives; two runs byte-identical.
- `catalog-inference` › … › **A reference into a schema the run did not name is kept** — OK. See the R6-B1 re-check above: handle in the starter, relation and foreign-key metadata in the contract, no `Tables` entry for `ext.users`, no loss-report line, no `ext.schema.ts`, and `baseline`/`generate` emits `references "ext"."users" ("id")`.
- `catalog-inference` › … › **Two tables sharing a constraint name keep their own expressions** — OK. `s3.a pos (x > 0)` / `s3.b pos (y < 0)`: each snapshot carries its own expression, and the emitted DDL was executed against a fresh database on the same server, where `pg_get_constraintdef` reads back `CHECK ((x > 0))` and `CHECK ((y < 0))`.
- `catalog-inference` › … › **What is not inferred is named** — OK. `n1` holding two functions, a trigger, a view, a policy, a `point` column and an unowned sequence: five counted `Not inferred:` lines plus the blanket grants line, the column named with its type, the sequence named with the D66 reason; none reaches the snapshot.
- `catalog-inference` › The loss is announced, with the way out › **The report names the way out** — OK. Every measured report carries Guessed / Not inferred / Approximated / Omitted and closes with the way-out line — `pull`'s "The loss ends when you link the schema repository."
- `cli-commands` › import writes starter declarations › **Declaration files never import each other in a cycle** — BLOCKING (R7-B1). The cut itself is right in every graph measured (a three-schema chain with an enum edge, its mirror with the enum on another edge, two overlapping two-cycles, a four-schema mixed graph): imports are acyclic, the cut carries an unexported handle or enum clone, `generate` loads every declaration, and four entry orders over the four-schema graph produce byte-identical SQL and snapshot. It fails on the `h1`/`h2` cycle, where the file that imports the cut's other side imports a table named `t`.
- `cli-commands` › … › **A second import writes the same bytes** — OK. `--schema app` and `--schema s1 --schema App` each imported twice into empty directories: identical byte for byte, headers carrying the full report and the repository-owns-it sentence, no clock- or machine-derived value.
- `cli-commands` › … › **A database is imported into starter files** — BLOCKING (R7-B1). Two schemas, two files, report printed, and `baseline` right after `import` emits the database's own DDL with its own foreign-key names (`comments_post_id_fkey`, `notes_post_id_fk`), banner-marked, after which `hejbro check --url` against the source database reports "no differences" — unless a target table is named `t`, where nothing loads at all.
- `cli-commands` › … › **a column the DSL cannot name is left out and said so** — OK. `"createdAt"`, `a_` and `od*/d` are excluded, named with table, own reason and consequence; every other column of each table stays declared; the `*/`-bearing line is escaped in the file header (`od*\/d`) under its own header sentence, and the file parses and loads.
- `cli-commands` › … › **a column the DSL rejects by name is left out the same way** — OK, reason now correct. `_id`, `_created_at`, `_9lives` omitted and named with "a key does produce this name back, but it is not a valid hejbro SQL identifier"; `label` still declared.
- `cli-commands` › … › **import refuses to guess which schemas to read** — OK. `import-schema-missing` names `--schema` and "most commonly --schema public" before any connection; `--out` has its own `import-destination-missing`.
- `cli-commands` › … › **The named schemas hold nothing to infer** — OK. `--schema s11` (an empty schema): `import-nothing-to-infer` naming it, exit 1, empty stdout, destination not created.
- `cli-commands` › … › **Every named schema was omitted for its name** — OK. `--schema App`: `import-nothing-declarable` (its own code), the `Omitted: schema "App" …` line on stdout with its way out and the way-out line last, `existsSync(out) === false`.
- `cli-commands` › … › **import never overwrites** — OK. `import-destination-exists` naming the file, the pre-existing bytes unchanged; an unwritable destination raises `import-destination-unwritable` naming the path and the real `EACCES`.
- `cli-commands` › pull reads a database as the marked fallback › **A contract is pulled from a database** — OK. Header says inferred-from-a-database, `Tables` carry the guessed keys (`userId` from `user_id`), the loss report prints and ends with `link`; the contract type-checks under a real `tsc --strict` for both an ordinary schema and one referencing an unread schema.
- `schema-vendoring` › **pull writes where vendor writes** — OK. `.hejbro/vendor/{contract.ts,schema.json,snapshot.sql}` plus a root `hejbro.lock` carrying `generatedBy: "hejbro pull"`; a second `pull` into the same repository succeeds; a `contract.ts` that does not look vendored is refused with `vendor-destination-not-vendored` whose remedy names `hejbro pull`, not a flag it does not have.
- `schema-vendoring` › **A database-sourced contract says so and carries no commit** — OK. `source: "database"`, `database: "r7"`, `schemas: ["s5"]`, no `commit`; `ContractMetadata` (`query/src/client/contract-types.ts:81-104`) is a `source`-discriminated union whose git arm keeps `source` optional, so a pre-#604 contract still type-checks against `createNameKeyedDb`.
- `schema-vendoring` › **outdated refuses a database-sourced contract** — OK. `hejbro outdated` and `hejbro vendor --check` both exit 1 with `vendor-origin-not-a-commit`, naming the database and `hejbro link <repository>` as the way forward.
- `table-declaration` › **A named foreign key keeps its name** — OK. An explicit `name: "fk_custom_name"` reaches both the snapshot node and `add constraint "fk_custom_name"`; no derived name appears.
- `table-declaration` › **An unnamed foreign key is unchanged** — OK. The same declaration without a name emits `articles_author_id_fk`, and a catalog name equal to the derived one is never written into the starter (`s5.notes`).
- `table-declaration` › **Renaming the table leaves an explicit name alone** — OK. Renaming `blog.posts` → `blog.articles`: with an explicit name the rendered SQL is the table rename plus `rename constraint "posts_pkey" to "articles_pkey"` and nothing for the foreign key; with a derived name it additionally renders `rename constraint "posts_author_id_fk" to "articles_author_id_fk"`.

### Method

- Read `openspec show add-catalog-inference --diff` in full, then the named surface: `packages/cli/src/{commands/{import,pull}.ts,infer/{compose,table,loss-report}.ts,declare-emit/emit.ts,contract/{emit,tables,from-catalog,read-snapshot}.ts}`, `packages/core/src/{sql/identifier-rules.ts,dsl/*.ts,index.ts}`, `packages/query/src/client/contract-types.ts`, `skills/hejbro/references/brownfield-adoption.md`, `.changeset/{add-catalog-inference,fix-catalog-inference-d106-r3,-r4,-r5,-r6}.md`. Only rounds 1-6 of `evaluation.md` were read (findings + dispositions), as claims.
- Live witness, one throwaway `postgres:17` container (`docker system df` first: 3 stopped containers, 6 volumes, none this suite's; `docker rm -v` after, leaving the pre-existing containers and `supabase_*` volumes untouched). One database with 30 fixture schemas: the unnamed-schema set (`app`/`ext`/`ext2`, two tables into one unread target and one table into two), the omitted set (`"App"`, `s1."Widgets"` with `"IX_Widgets"`/`"CK_Widgets"`/UNIQUE/`"FK_Widgets_Owner"`), exotic columns (`_id`, `_created_at`, `_9lives`, `a_`, `"createdAt"`, `od*/d`), duplicate check names, a CamelCase enum, colliding keys, default `_fkey` names, an empty schema, five cycle graphs, and the not-inferred set. Driven both in-process from `src` (`inferFromCatalog`, `runImport`, `runPull`) and through the built `dist/cli.js` in throwaway projects under `/private/tmp` (`init`/`import`/`generate`/`baseline`/`check`/`pull`/`outdated`/`vendor --check`), all deleted afterwards.
- The emitted `s3` DDL was executed against a second, fresh database on the same server, and `pg_get_constraintdef` read back both `pos` checks with their own expressions.
- In-process probes created, run and deleted in the same tool call (`packages/cli/test/_r7probe*.test.ts`, eight batches). No repository file other than this one was modified; `git status --porcelain` shows only `evaluation.md`.
- Suites run: `infer-compose`, `infer-loss-report`, `infer-tables`, `infer-keys`, `infer-adapter`, `import-command`, `pull-command`, `declare-emit-{emit,file-cycle,topo-order}`, `contract-{from-catalog,origin}`, `outdated-database-origin`, `vendor-lock-origin`, `exports` — 15 files / 155 tests green; `packages/core` `rename-plan`, `identifier-rules` — 2 files / 50 tests green.
- Not run: `pnpm build`, `pnpm install`, full-workspace `pnpm test`/`check-types`, the Docker-gated `*.integration.test.ts` files (each starts its own container; this round used one container of its own instead, and re-measured what those witnesses assert directly).

## Round 7 disposition

The blocking finding and four of the five non-blocking ones are fixed
here; N5 stays with #712, the same decision rounds 5 and 6 recorded.
Six reds, every one behavioural — a file that fails to load, a count
that comes back two instead of one, an assertion on rendered text
failing against the old text — and four mutants, each with both halves
stated before it ran. There are no signature reds in this round, which
is the one measurable difference from round 6's evidence.

Gate (2026-09-03, on `2394bd16`): `pnpm build --force` 7/7 tasks, 0
cached; then, first and alone on that real build,
`declare-emit-callback-shadow.test.ts` — the blocking finding's own
observer — 3/3; `pnpm --filter hejbro test:integration` 12 files / 70
passed, 2 todo; `TURBO_FORCE=1 pnpm check` 724 files; unfiltered
`TURBO_FORCE=1 pnpm check-types` 17/17 tasks, 0 cached; `TURBO_FORCE=1
pnpm test` 17/17 tasks (`hejbro` 89 files / 787 tests, `cli-smoke` 2
files / 6); `pnpm check:bans` 235 files; `pnpm check:crap` ok, 0 of 1617
functions over CRAP 5, README unchanged; `changeset status` pending
minor across the fixed group; `check:tasktime` current. Docker residue
of this round's own runs: none. `upstream/dev` was re-fetched and is
unchanged at `310d2290`, so there is no merge-in and the gate's tip is
the branch's tip.

### R7-B1 — a starter file naming a table `t` could not be loaded

Fixed by giving the file's identifier namespace the one name it did not
know about. `renderExtrasBlock` binds a parameter in the text it emits;
nothing reserved that name, so a table whose identifier matched it kept
the identifier, and every reference to it from inside a callback
resolved to the callback's own column proxy. The file then failed to
load at all (`Cannot read properties of undefined (reading 'schema')`)
and failed `tsc` with `TS2345` — a whole starter file lost to a name,
with no report line mentioning it, on a table name D36 accepts.

The parameter is now a constant that `renderExtrasBlock` and the
namespace both read, so the emitter and the namespace cannot drift, and
it is reserved unconditionally. A conditional reservation was
considered and rejected: the correct condition is "any table *in this
file* emits a callback", not "this table does", because the shadowing
crosses tables — and a cross-table condition of that shape is what made
round 6's blocking finding wrong. The measured saving was zero (no
fixture or example anywhere names a table, schema or enum `t` in a file
the emitter renders), so the branch would have bought risk and nothing
else.

**The first attempt at this fix was wrong, and the way it was wrong is
worth recording.** The reservation was added to the set the plan named,
`vocabulary` — which is also, literally, the barrel import list: the
emitted `import { … } from "hejbro"` line is rendered by joining it. The
patch produced files importing a symbol `hejbro` does not export. That
is the same defect as round 6's blocking finding at a different scale:
**one value answering two questions.** There it was one set answering
both "which tables survived this reading" and "may this reference be
declared"; here it was one set answering both "what do we import from
the barrel" and "what names are taken in this file". Both times the
answer was to give each question its own value rather than to add a
condition — `vocabulary` kept its meaning and a derived
`reservedIdentifiers` took over the two readers that answer the
collision question, leaving the import line untouched.

Pins: `declare-emit-callback-shadow.test.ts`, three cases — the table
declared in the file that references it, the table imported from another
file, and the table on the declared side of a cut cycle, that last one
asserted in both entry orders, since the delta's claim is that loading
does not depend on which file the loader reaches first. Each emits the
files, loads them through the same loader `generate` uses, and
type-checks them. The mutant (namespace pointed back at the barrel
vocabulary) failed exactly those three and left every other emitter test
green.

### R7-N4 — one handle per foreign key in the text, one per target in the reading

The emitter keyed a handle by `(owning table, foreign key name)` while
the reading built one per target identity and said in its own comment
why that is the rule. Three `existingTable("ext","users",…)` constants
for one target were measured in a written file. Handles are now keyed by
target, named for the target rather than for whichever relation needed
one first, and their columns are the union of what every key into that
target references — the same rule, stated once on each side.

This was fixed before N3 deliberately: once a handle belongs to a
target, "why does this handle exist" is a property of the target rather
than of a relation, so two keys into one target can no longer imply two
different reasons. The ordering removed a state N3 would otherwise have
had to describe correctly.

Pins: one handle for a target two keys share, and — added after the
first version was found undiscriminating — a case where the two keys
reference *different* columns, so the union is load-bearing. That
second case matters: without it, a "first key wins" dedup passes every
test in the suite, and the mutant proving it drops a column
(`expected ' code: text() ' to contain 'id: text()'`) is what shows the
pin can fail.

### R7-N3 — the emitted comment claimed a cycle that did not exist

`commentForForeignKeyEntry` took a boolean, which flattened a three-way
distinction that `mustDeferForeignKey` still holds. Every handle
therefore told the reader a declaration-file cycle had been closed,
including handles that exist because the target's schema was never read
— where there is no cycle, no other file, and nothing to initialise. The
boolean is now the reason itself, and the two reasons render their own
sentences. No delta changed: the requirement already separates the two
cases in prose, which is exactly why the emitted comment collapsing them
was drift rather than contradiction.

### R7-N2 — a remedy the identifier rule makes impossible, still on two lines

The omitted-index and omitted-check lines offered "declare it by hand or
rename it in the database" one clause after saying no declaration can
carry that name. Renaming is the only remedy, and the lines now say so,
with one clause for the trap the reviewer measured: a hand-written
declaration *can* be added under a different, valid name, and `generate`
then emits a second index or constraint beside the one already in the
database. This is the same false remedy round 6 removed from the column
lines, and round 6 removed it only there.

### R7-N1 — the skill still offered the remedy the code had retracted

Round 6's disposition said "the delta and the skill say the same". It
was true of the delta. Two places in the brownfield reference still
offered a hand-written declaration, and one claimed `link` ends this
loss the way it ends the others. Both now say what the code says:
renaming in the database is the only way out for a name no declaration
can carry, in this repository or a linked one, because the DSL derives
every column's SQL name from its TypeScript key and accepts no override.
The general claim about `link` is kept — it is true of every other kind
of loss — and only the comparison is corrected.

### R7-N5 — an enum type's catalog name

Untouched, with #712, for the third round running.

### What this round corrected in itself

Three, recorded on the same principle as round 6's: how a round catches
its own mistakes is evidence about the round.

The **planner's approved mechanism was wrong**, and the instruction that
caught it was "if any existing emitted bytes move, stop and report".
They moved on the first run, the implementer stopped with the patch
uncommitted, and the cause — the reserved set being also the barrel
import list — was found before anything was built or committed. The fix
that shipped is a different mechanism from the one the plan named.

The **first version of the handle-union pin could not fail.** Both keys
in it referenced the same column, so a "first key wins" dedup would have
passed it; the implementer said so in its own report rather than
banking the green, and the case was rebuilt with two different columns
and mutant-verified. The finding this round is closing is itself about
two artifacts counting the same thing differently, so a pin that cannot
tell one count from two would have been a poor way to close it.

A **guard was stepped around once and then retired.** After a revert
bumped a source file's mtime past `dist`, the dist-freshness guard was
satisfied by touching `dist` rather than rebuilding — sound at the time
(the guard is about content staleness and the content was correct), but
once a later commit moved that file's content the same move would have
been false. The loader test was then left unrun rather than run
dishonestly, and it was the first thing measured on the gate's real
build. Reported as a judgement call, not as a procedure: the general
rule is that a guard stepped around needs the argument written down,
and the moment the argument stops holding, the run waits for the build.
