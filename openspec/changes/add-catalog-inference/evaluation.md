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

### Method

- Read `openspec show add-catalog-inference --diff` for the three capabilities' deltas (the command prints `proposal.md` first; that prose was not used as evidence). `openspec validate add-catalog-inference --strict` passes.
- Read the named surface: `packages/cli/src/{commands/{import,pull,outdated,vendor}.ts,infer/*,declare-emit/*,contract/emit.ts,contract/from-catalog.ts,vendor/{lock,write}.ts,check/catalog.ts}`, `packages/query/src/client/{contract-types,name-keyed-db}.ts`, plus `skills/hejbro/`.
- Ran the change's own unit suites green: 17 files / 115 tests (`import-command`, `pull-command`, `contract-origin`, `contract-from-catalog`, `outdated-database-origin`, `declare-emit-{emit,file-cycle,topo-order,enum-cycle-load}`, `infer-{keys,description,loss-report,tables,rest,adapter,constraints,catalog-read}`).
- Constructed R2-B1 in a throwaway `packages/cli/test/*.test.ts`: first against `buildSchemaFileGraph` alone (back-edge report above), then through `emitDeclarationFiles`, writing the emitted files into a real directory inside the package and loading each as an entry point with the same `jiti` the production loader uses. Three entry orders, three crashes.
- Constructed R2-B2 in the same harness with no cycle at all (linear FK chain over three same-named tables); `a.schema.ts` fails to parse.
- Drove `inferColumnKeys` + `toSnakeCase` directly on both physical orders of the N2 fixture and on three further collision shapes.
- Type-checked the three `contractMetadata` shapes against `createNameKeyedDb` with `tsc` (see the origin scenario above).
- Docker-gated `*.integration.test.ts` were not run (`live-witness`, `declare-emit.integration`, `declare-emit-roundtrip.integration`, `infer-catalog-read.integration`), so "generate against empty matches the database" and cross-reading determinism are read, not executed. `pnpm build`/`pnpm install` were not run; the `dist`-freshness CLI subprocess suites were not exercised.
- Every throwaway file was deleted; `git status` is clean apart from this report.
