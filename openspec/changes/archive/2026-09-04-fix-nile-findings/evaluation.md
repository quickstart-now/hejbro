# Evaluation: fix-nile-findings (D106 adversarial spec review)

## Round 1

Reviewed at dev `333dae88` (PR #780 merged). Context-free: only the delta
specs (`openspec show fix-nile-findings --diff`), the public surface the
scenarios name, the test suite, and live measurement on `postgres:17-alpine`.

### Verdict

BLOCKING 1 / NON-BLOCKING 5 / OK 13

### Blocking

- **R1-B1 — text-mode normalization rewrites string-literal content, so a
  genuine catalog drift is reported as agreement.** The delta requirement
  enumerates six normalization steps "and nothing else", and step 4 is
  "identifier quoting where the identifier would render unquoted anyway".
  Shipped `unquotePlainIdentifiers` (`packages/cli/src/check/expression.ts`,
  `text.replace(/"([^"]+)"/g, unquoteIfPlain)`) runs over the whole text,
  not outside string literals (unlike steps 1 and 6, which use
  `transformOutsideSpans`); `stripTableQualifier` (step 3) has the same
  reach. Measured live: declared `check("projects_format_quoted",
  ne(t.format, '"json"'))` renders `"projects"."format" <> '"json"'`; the
  catalog was hand-altered to `check (format <> 'json')`, which
  `pg_get_expr` returns as `(format <> 'json'::text)`. Both normalize to
  `format <> 'json'` — under `explainUnavailable: true` **no finding is
  emitted for that constraint** (the run's only findings were the others
  listed below), while the same catalog under a silent preset reports
  `check-object-differs: … renders as "(format <> '"json"'::text)", but the
  database's own constraint renders as "(format <> 'json'::text)"`. A
  literal containing a double-quoted word is ordinary (JSON-ish text,
  regex patterns), and the outcome is the one the requirement forbids
  twice over: texts that are not equal after the *specified*
  normalization "SHALL be reported as not compared", and the text mode
  exists so that a textual difference is never mistaken for agreement in
  the other direction either. Fix shape: run step 4 (and step 3) through
  `transformOutsideSpans(text, STRING_LITERAL, …)` like steps 1 and 6.

### Non-blocking

- **R1-N1 — a `Next:` asking for EXPLAIN is still reachable under a
  declaring preset.** `compareCheckConstraint` returns
  `notComparedFinding(identity, metadata.reason, null)` when the `conbin`
  lookup itself errors (`expression.ts:499-500`) *before* branching on
  `mode`, and that finding's `Next:` is "confirm the connected role can run
  EXPLAIN against this table". Probed with a session whose `execute`
  throws under `mode: "text"`: `check-not-compared … permission denied for
  function pg_get_expr. Next: confirm the connected role can run EXPLAIN
  against this table, then rerun \`hejbro check\`.` The requirement says the
  `Next:` "SHALL NOT ask the user to run or be granted `EXPLAIN` on such a
  platform"; no delta scenario covers this path (rare: a catalog read
  failing after `readCatalog` succeeded).
- **R1-N2 — the MODIFIED requirement over-claims how a generated column is
  compared.** New text: "an index is compared by its existence and a
  generated column by its default text, so neither reaches this
  requirement's comparison". Shipped `check` (`compare.ts`, unchanged in
  `333dae88`) reports every declared generated column as
  `check-object-differs: declared column "app.users.email_lower" has no
  default, but the database has one ("lower(email)")` — measured in both
  modes, exit `1`. Pre-existing, but the delta now records a comparison
  that does not happen as the reason generated columns are out of scope.
  Needs a follow-up issue (generated columns are `catalogDefault` on the
  catalog side and `generated` on the declared side; the two never meet).
- **R1-N3 — `.notNullElements()`'s derived check can never agree under a
  declaring preset.** The catalog stores `(array_position(tags, NULL::text)
  IS NULL)`; step 5 strips a cast only from a *string* literal, so the
  declared `array_position("posts"."tags", null) is null` is
  `check-not-compared` on every run (measured on `app.posts` and, after a
  table rename, `app.articles`), and its `Next:` — "restate the
  declaration to match the catalog's own spelling" — names a restatement
  the DSL cannot make for a derived check. Spec-consistent as written, but
  every array column narrowed this way keeps `check` at exit `2` on Nile.
  Either widening step 5 to `NULL::type` (an owner call — it is a change to
  the enumerated list) or a documented exemption; follow-up.
- **R1-N4 — step 4 unquotes any `^[a-z_][a-z0-9_]*$` identifier, not only
  one "the server would render unquoted anyway".** A reserved word
  (`"order"`, `"user"`) is unquoted too, though `pg_get_expr` keeps it
  quoted. Harmless today (both sides get the same treatment and the DSL only
  admits `^[a-z][a-z0-9_]*$` names), but the prose and the predicate
  differ; note for the archive.
- **R1-N5 — `skills/hejbro/references/nile-preset.md` links
  `openspec/changes/fix-nile-findings/design.md`**, a path the archive step
  relocates; the published skill will point at a missing file. Its claim
  "Two spellings that normalize to the same text agree, silently, exactly
  as on a platform that can plan" is also the sentence R1-B1 falsifies.

### Verified scenarios

`table-declaration` — ADDED "A table-bound expression names columns by
table and column":

- *A check constraint names its own columns* — OK. Generated live:
  `constraint "projects_name_not_blank" check (length(btrim("projects"."name")) > 0)`;
  applied on `postgres:17-alpine` without error. Also
  `check ("app"."n" > 0)` on a table named like its schema (`app.app`),
  applied and resolved (`(n > 0)`).
- *A partial-index predicate names its own columns* — OK.
  `create index "projects_name_idx" on "lab"."projects" ("name") where "projects"."archived_at" is null;`
  applied; `pg_get_indexdef` → `WHERE (archived_at IS NULL)`.
- *An index expression names its own columns* — OK.
  `((lower("users"."email")))`, and `((lower("items"."code")))` on a table in
  schema `tasks` (a schema named like table `app.tasks`); both applied.
- *A generated column's expression names its sibling* — OK by test
  (`packages/core/test/generated-columns-emit.test.ts:49`,
  `generated always as ("widgets"."price" * "widgets"."qty") stored`); a
  raw fragment without interpolation (`sql\`lower(email)\``) renders
  unchanged, as the scenario's "interpolates" wording implies.
- *A policy names columns by table and column inside a correlated subquery*
  — OK. Generated text is byte-identical to the scenario:
  `exists (select 1 from "app"."projects" where ("projects"."id" = "tasks"."project_id") and ("projects"."archived_at" is null))`;
  applied; `pg_policy` resolves it to `(projects.id = tasks.project_id)`.
- *A same-named row source keeps the reference schema-qualified* — OK.
  `where "audit"."tasks"."task_id" = "app"."tasks"."id"` (subquery `from
  audit.tasks`), and with `app.projects inner join audit.projects` both
  `projects` references render three-part while `"tasks"."project_id"`
  stays two-part; applied, Postgres aliases them `tasks_1`/`projects_1`.
- *A view body is unchanged* — OK. Generated
  `create or replace view "app"."open_tasks" as select "app"."tasks"."id" as "id", … where "app"."tasks"."title" is null;`
  (three-part); a function body in `examples/postgres/migrations/0001_add_app.sql:89`
  and the query builder (`examples/postgres/test/query.test.ts`, passes)
  stay three-part.

`table-declaration` — MODIFIED "Non-null array elements…":

- *Declaring `.notNullElements()` adds the check* — OK.
  `constraint "tags_no_null_elements" check (array_position("posts"."tags", null) is null)`.
  Rename tracking: `--rename app.posts.tags=labels` re-emits
  `array_position("posts"."labels", null)`; `--rename app.posts=articles`
  then renders the declared side as `"articles"."labels"` (measured through
  `check`'s "Declared expression:" text against a live `r1c` database).

`cli-commands` — ADDED "A preset declares whether its platform can plan a
statement":

- *The declaration is readable as data* — OK. `packages/nile/src/preset.ts:65`
  is a literal `explainUnavailable: true`; `packages/nile/test/preset.test.ts`
  reads it with no connection.
- *Silence means the platform can plan* — OK. Silent preset: 9 `explain
  (format json, costs off, verbose) select …` statements for 9 check
  constraints (`log_statement = 'all'`), and drifts reported as
  `check-object-differs`. A JS config passing `explainUnavailable: false`
  (not a legal TS value) behaves the same (9 EXPLAINs).
- *The Nile preset declares it* — OK. A project registering the real
  `nilePreset` (`@hejbro/nile`) ran `check` with 0 EXPLAIN statements and
  the text-mode boundary line.

`cli-commands` — MODIFIED "An expression is compared through the server's
own rendering":

- *Under a preset that declares no planning, equal normalized texts agree*
  — OK for the scenario's own input (`length(btrim("projects"."name")) > 0`
  vs `(length(btrim(name)) > 0)`: no finding; also after the catalog was
  restated as `CHECK ((LENGTH(BTRIM(name)) > 0))` and `check ( app.n   >   0 )`).
  Boundary line printed on every text-mode run, pass or fail:
  "check-constraint expressions were compared by normalized text on this
  run, because a registered preset declares this platform cannot plan a
  statement …". **But see R1-B1**: a literal-content difference also
  "agrees".
- *Under a preset that declares no planning, a rewritten expression is not
  compared* — OK. `"projects"."role" in ('owner', 'admin')` vs
  `(role = ANY (ARRAY['owner'::text, 'admin'::text]))` and
  `"projects"."priority" between 1 and 5` vs `((priority >= 1) AND (priority <= 5))`
  → `check-not-compared`, both texts, `Next: restate the declaration to
  match the catalog's own spelling: …`; stderr contains no "explain"; exit
  `2` alone, `1` alongside a genuine disagreement (with the "(n more could
  not be compared)" note). A genuinely different constraint (declared
  `> 0`, catalog `> 1`), a literal whose internal whitespace differs
  (`'a  b'` vs `'a b'`) and a column cast (`((code)::character varying)::text`)
  are all `check-not-compared`, never `differs`. Two presets with only the
  second declaring → text mode (0 EXPLAINs).
- *Without such a declaration, a failed rendering is reported as before* —
  OK. Silent preset, role without `select` on the tables: 9 ×
  `check-not-compared … permission denied for table projects. Declared
  expression: "…". Catalog expression: "…". Next: confirm the connected
  role can run EXPLAIN against this table` — the pre-existing text — and
  never a text comparison. (The same role under a declaring preset is
  compared by text with no privilege needed.)

Not re-measured (unchanged by the delta, unit suites green): "A matching
expression is not reported", "A differing expression is reported", "A
constraint the database does not enforce is reported", "Removing the
declaration drops the check".

Test suites run as evidence: `packages/core` `test/expr/render-table-bound.test.ts`,
`test/dsl/check.test.ts`, `test/generated-columns-emit.test.ts`,
`test/policy-kind.test.ts` (38 passed); `packages/cli`
`test/check-expression.test.ts`, `test/check-command.test.ts`,
`test/config.test.ts` (69 passed); `packages/nile` `test/preset.test.ts`
(4 passed); `examples/postgres` `test/query.test.ts` (1 passed).

### Method

- Read: `openspec show fix-nile-findings --diff` (the command also prints
  the proposal header; its text was disregarded), `packages/core/src/expr/render-sql.ts`
  (`TableBoundMarker`, `hasAmbiguousBareName`, `renderColumnRefNode`,
  `renderTableBoundExpr`), `packages/core/src/kinds/{table-snapshot,policy-kind}.ts`,
  `packages/core/src/engine/preset.ts`, `packages/nile/src/preset.ts`,
  `packages/cli/src/check/{expression,catalog,driver}.ts`,
  `packages/cli/src/commands/check.ts`, `packages/cli/src/config.ts`,
  `skills/hejbro/references/{dsl-cheatsheet,nile-preset,brownfield-adoption}.md`,
  `examples/*/migrations/*.sql`, and the tests named above. No
  proposal/design/tasks/PR/git-message/blackbox content was read beyond the
  header `openspec show --diff` itself emits.
- Live: one container `r1-nile-review` (`postgres:17-alpine`,
  `-c log_statement=all`), databases `r1a`/`r1b`/`r1c`, roles `r1_reader`
  (policy target) and `r1_limited` (login, no table privileges). A
  throwaway project under `/private/tmp/r1nile/{a,b,c}` with `hejbro`,
  `@hejbro/nile` and `jiti` symlinked; the CLI was driven **from source**
  (`node --import jiti/register packages/cli/src/cli.ts <cmd>`), never
  `dist` and never `pnpm build`. Project A: 9 tables across `app`/`audit`/
  `lab`/`tasks` covering every table-bound site plus three policies
  (correlated, same-bare-name, joined bare names) and a view; project B:
  the real `nilePreset`; project C: `notNullElements` across a column and a
  table rename. Catalog constraints were then hand-restated (`alter table …
  drop constraint … add constraint …`) with uppercase keywords, doubled
  outer parentheses, extra whitespace, a changed literal (`'"json"'` →
  `'json'`), a literal with collapsed internal whitespace, a genuinely
  different bound, and a column cast; `check --url` ran under six configs
  (declaring preset ×2 roles, silent preset ×2 roles, `explainUnavailable:
  false`, two presets with only the second declaring), counting `explain`
  in the server-log delta each time.
- The one path no live run reaches (a `conbin` lookup error under text
  mode) was probed with an in-package `_r1probe-text-mode.test.ts` (a fake
  `DriverSession` whose `execute` throws), created, run and deleted in the
  same command; `git status` was clean after each probe.
- Cleanup: `docker rm -v -f r1-nile-review`, `/private/tmp/r1nile` removed;
  the other team's `hejbro-rc-review` container was not touched.

## Round 1 disposition

Correction round in `fix-nile-d106-r1` (tasks.md group 3), lead-run under
the owner's delegation (recorded as a ruling in `.blackbox/755/`).

- **R1-B1** — fixed: normalization steps 3 (table qualifier) and 4
  (identifier unquoting) now run through `transformOutsideSpans(text,
  STRING_LITERAL, …)` like steps 1 and 6, so a string literal's content is
  never rewritten. Pinned by `check-expression.test.ts` "3.6 literal
  content is never normalized" (four rows: quoted word in a literal,
  same literal both sides, qualifier-like text in a literal, the same
  text outside a literal). The delta gains the scenario "a string
  literal's content is never normalized".
- **R1-N1** — fixed: a failed `pg_constraint` read under `mode: "text"`
  is reported with a `Next:` that names the catalog read and never
  `EXPLAIN` (`notComparedCatalogReadFinding`); server mode keeps its
  `EXPLAIN` remedy. Pinned by "3.7 a failed catalog read under text
  mode"; the delta gains the scenario "a failed catalog read is not
  compared without asking for EXPLAIN".
- **R1-N2** — tracked as #781 (a matching generated column is always
  reported as a default difference).
- **R1-N3** — tracked as #782 (`.notNullElements()` under an
  `explainUnavailable` preset); widening step 5 is an owner call.
- **R1-N4** — fixed: step 4's predicate now excludes Postgres's reserved
  keywords, matching "would render unquoted anyway"; `normalizeCheckText`
  is exported and pinned by a five-row table.
- **R1-N5** — fixed: `nile-preset.md` links the main `cli-commands` spec
  instead of the change's `design.md`, and states the literal rule in
  place of "silently, exactly as on a platform that can plan"; pinned by
  `nile-preset-doc.test.ts`.


## Round 2

Reviewed at dev `adb916c4` (PR #795 merged on top of #780). Context-free:
only the delta specs (`openspec show fix-nile-findings --diff`, `openspec
validate --strict` passes), the public surface the scenarios name, the
test suite, Round 1 above (every claim re-verified, none taken as given),
and live measurement on `postgres:17-alpine` through the built
`packages/cli/dist/cli.js` (no `src` file newer than `dist`).

### Verdict

BLOCKING 0 / NON-BLOCKING 4 / OK 20

### Blocking

None.

### Non-blocking

- **R2-N1 — step 5 strips only a single-word type name, so an appended
  cast the server spells in more than one token survives normalization.**
  `stripStringLiteralCast` (`packages/cli/src/check/expression.ts:314`)
  matches `'…'::[a-zA-Z_][a-zA-Z0-9_]*`; `'{}'::text[]` becomes `'{}'[]`,
  `'x'::character varying` becomes `'x' varying`, `'…'::timestamp with
  time zone` becomes `'…' with time zone`. Measured live: declared
  `"projects"."tags" <> '{}'` (a `text[]` column) against the catalog's
  `(tags <> '{}'::text[])` is `check-not-compared` under text mode, though
  the only difference is "a type cast the server appended to a string
  literal" — the requirement's own step 5. Direction is the safe one
  (not compared, never differs), and restating with the cast makes both
  sides carry the same residue, so this is an over-claim of step 5's
  reach, not a wrong answer. (`timestamptz` literals also have their
  *value* rewritten — `'2020-01-01 00:00:00+00'` — so those can never
  agree by text regardless.) Archive note or a widened step 5 (owner
  call — it changes the enumerated list).
- **R2-N2 — the text-mode catalog-read `Next:` names a function `check`
  does not call.** `notComparedCatalogReadFinding` (`expression.ts:89`)
  says "confirm the connected role can read this table's constraint from
  pg_constraint (pg_get_constraintdef)"; the read that failed is
  `pg_get_expr(con.conbin, con.conrelid)` (`expression.ts:395`), and the
  server's own reason in the same message says so ("permission denied for
  function pg_get_expr"). The delta scenario ("names the catalog read to
  confirm") is met — `pg_constraint` is named — but a reader who grants
  or checks `pg_get_constraintdef` fixes nothing. Wording fix.
- **R2-N3 — `skills/hejbro/references/nile-preset.md` links a
  `cli-commands` requirement that does not exist.** The R1-N5 correction
  replaced the `openspec/changes/…/design.md` link with
  "`openspec/specs/cli-commands/spec.md`'s 'compares by text where the
  preset declares no planning' requirement" (line ~129). No requirement
  carries that name in the main spec's headings or in the delta; the text
  lives inside the MODIFIED requirement "An expression is compared through
  the server's own rendering", which keeps that heading after archive.
  `nile-preset-doc.test.ts` only asserts the absence of an
  `openspec/changes/` path, so it cannot catch this.
- **R2-N4 — decision log D99 now contradicts the shipped `notNullElements`
  rendering.** `docs/specs/2026-08-19-hejbro-design.md:302` still records
  the derived check's column reference as "rendered fully qualified (as
  every emitted check renders one; amended at group 1 close — the shared
  renderer has no bare-column mode)". The delta's MODIFIED requirement and
  the generated `array_position("projects"."tags", null) is null` (measured
  live) are the opposite. The decision log is owner-gated, so this is an
  owner amendment note at archive, not an agent edit.

Tracked, still open, re-measured for the record: #781 (`app.widgets.total`
reported `check-object-differs … has no default, but the database has one
("(price * (qty)::numeric)")` on every run, both modes — it alone held the
text-mode runs at exit `1`), #782 (`tags_no_null_elements` is
`check-not-compared` under text mode: `array_position("projects"."tags",
null) is null` vs `(array_position(tags, NULL::text) IS NULL)`).

### Round 1 re-check

- **R1-B1 — closed.** Live: `"projects"."format" <> '"json"'` vs catalog
  `(format <> 'json'::text)` → `check-not-compared` under text mode (was
  silent agreement in Round 1); `'see "lab"."projects"."name"'` inside a
  literal vs the catalog restated `'see name'` → not compared; the same
  literal on both sides agrees (unit probe: `'see "lab"."projects"."name"'`
  both sides, `'it''s "q"'`, `'a::text'`, `'('`, `')'`, `'"'` all agree;
  `'Done'` vs `'done'` not compared). Steps 3 and 4 run through
  `transformOutsideSpans(text, STRING_LITERAL, …)` (`expression.ts:308-311,
  352-356`); pinned by "3.6 literal content is never normalized" (4 rows).
- **R1-N1 — closed** (wording: R2-N2). Live, role `r2_nocat` whose
  `pg_get_expr` fails for `lab.projects` only: text mode reports 12 ×
  `check-not-compared … permission denied for function pg_get_expr. Next:
  confirm the connected role can read this table's constraint from
  pg_constraint (pg_get_constraintdef)`, zero occurrences of "explain" in
  the whole run; server mode with the same role keeps "Next: confirm the
  connected role can run EXPLAIN against this table" (24 ×, i.e. the
  pre-existing text). Pinned by "3.7 a failed catalog read under text mode".
- **R1-N2 — still open, tracked #781** (measured again, above).
- **R1-N3 — still open, tracked #782** (measured again, above).
- **R1-N4 — closed.** `RESERVED_KEYWORDS` (`expression.ts:219-298`) gates
  `unquoteIfPlain`; unit probe: `"order"`, `"user"`, `"select"`, `"Name"`
  stay quoted, `"name"` unquotes; live `"projects"."order" > 0` vs
  `("order" > 0)` agrees with no finding.
- **R1-N5 — partially.** No `openspec/changes/` path remains and the
  "silently, exactly as" sentence is replaced by the literal rule (both
  pinned by `packages/skills/test/nile-preset-doc.test.ts`); the
  replacement link names a requirement that does not exist (R2-N3).

### Verified scenarios

`table-declaration` — ADDED "A table-bound expression names columns by
table and column" (generated with `dist/cli.js generate`, applied to
`postgres:17-alpine` without error):

- *A check constraint names its own columns* — OK.
  `constraint "projects_name_not_blank" check (length(btrim("projects"."name")) > 0)`
  on `lab.projects`; catalog resolves it to `(length(btrim(name)) > 0)`. A
  check interpolating another table's column never reaches rendering:
  `check-foreign-column-ref` at declaration (`packages/core/src/dsl/table.ts:943`,
  `test/dsl/check.test.ts:53`).
- *A partial-index predicate names its own columns* — OK.
  `create index "projects_name_idx" on "lab"."projects" ("name") where "projects"."archived_at" is null;`
  → `pg_get_indexdef`: `WHERE (archived_at IS NULL)`.
- *An index expression names its own columns* — OK.
  `create index "projects_lower_name_idx" on "lab"."projects" ((lower("projects"."name")));`
  → `USING btree (lower(name))`.
- *A generated column's expression names its sibling* — OK by test
  (`packages/core/test/generated-columns-emit.test.ts` "renders an
  interpolated sibling column reference table-bound, two-part":
  `("widgets"."price" * "widgets"."qty")`); `columnRef` is not on the
  `hejbro` surface, so the live probe used a raw fragment, which renders
  unchanged (`generated always as (price * qty) stored`, applied).
- *A policy names columns by table and column inside a correlated
  subquery* — OK. Live text byte-identical to the scenario:
  `using (exists (select 1 from "app"."projects" where ("projects"."id" = "tasks"."project_id") and ("projects"."archived_at" is null)))`;
  `pg_policy` resolves it to `(projects.id = tasks.project_id)`.
- *A same-named row source keeps the reference schema-qualified* — OK.
  `exists (select 1 from "audit"."tasks" where "audit"."tasks"."task_id" = "app"."tasks"."id")`
  (Postgres aliases the inner one `tasks_1`), and with
  `app.projects inner join audit.projects` both `projects` references are
  three-part on both sides of the `on` and `where` while
  `"tasks"."project_id"` stays two-part. `hasAmbiguousBareName`
  (`render-sql.ts:993`) compares bare name + schema of every real
  `FromNode` in scope. A CTE in a policy subquery is unreachable through
  the typed DSL (`exists` takes `SelectLimited`, `query/select.ts:870`),
  so a CTE named like the table cannot shadow the two-part form.
- *A view body is unchanged* — OK.
  `create or replace view "app"."open_tasks" as select "id", "project_id", "title" from "app"."tasks" where "app"."tasks"."title" is null;`
  (three-part); a function body stays three-part
  (`examples/postgres/migrations/0001_add_app.sql:89`:
  `select "app"."comments"."parent_id" … where "app"."comments"."id" = new.parent_id`);
  `renderExpr` without the marker is pinned by `render-table-bound.test.ts`'s
  second describe. Example migrations: 29 two-part and 0 three-part
  column references inside `check (…)` / `where` / `using (exists …)` lines.

`table-declaration` — MODIFIED "Non-null array elements…":

- *Declaring `.notNullElements()` adds the check* — OK.
  `alter table "lab"."projects" add constraint "tags_no_null_elements" check (array_position("projects"."tags", null) is null);`
  applied. *Removing the declaration drops the check* — not re-measured
  (unchanged by the delta; `test/dsl/check.test.ts` green).

`cli-commands` — ADDED "A preset declares whether its platform can plan a
statement":

- *The declaration is readable as data* — OK. `packages/nile/src/preset.ts:65`
  literal `explainUnavailable: true`; `Preset.explainUnavailable?: true`
  (`packages/core/src/engine/preset.ts:28`); `nile/test/preset.test.ts`
  reads it with no connection. `checkComparisonMode(config.presets)`
  (`commands/check.ts:91-98`) takes presets only; `isPreset`
  (`cli/src/config.ts`) passes the field through untouched.
- *Silence means the platform can plan* — OK. `presets: []`: 12 `explain
  (format json, costs off, verbose) select …` for 12 constraints
  (`log_statement=all`), drifts as `check-object-differs`.
- *The Nile preset declares it* — OK. A project registering the real
  `nilePreset` from `@hejbro/nile`: 0 EXPLAINs, the text-mode boundary
  line, exit `2` with three `check-not-compared` and nothing else.

`cli-commands` — MODIFIED "An expression is compared through the server's
own rendering":

- *Equal normalized texts agree* — OK. Under the declaring preset, no
  finding for: `length(btrim("projects"."name")) > 0` vs the catalog
  restated `CHECK ((LENGTH(BTRIM(name)) > 0))`; `("projects"."priority" + 1) > 2`
  vs `((priority + 1) > 2)` (inner pair kept, outer stripped);
  `"projects"."order" > 0` vs `("order" > 0)`; `"projects"."note" = 'it''s'`
  vs `(note = 'it''s'::text)`. Boundary line printed on every text-mode
  run: "check-constraint expressions were compared by normalized text on
  this run, because a registered preset declares this platform cannot
  plan a statement -- a spelling difference the server would treat as
  equal is reported as not compared." (`commands/check.ts:78`).
- *A rewritten expression is not compared* — OK. `in ('owner', 'admin')`
  vs `(role = ANY (ARRAY['owner'::text, 'admin'::text]))`, `between 1 and 5`
  vs `((priority >= 1) AND (priority <= 5))`, `> 1::numeric` vs
  `((priority)::numeric > (1)::numeric)`, `'a  b'` vs `'a b'`, `'Done'` vs
  `'done'`, and a genuinely different meaning (`"user" <> ''` vs the
  catalog's `(USER <> ''::name)`) — all `check-not-compared`, both texts,
  `Next: restate the declaration to match the catalog's own spelling: …`,
  never `differs`; 0 "explain" in stdout+stderr; exit `2` when alone
  (nile project), `1` alongside #781's finding with "(8 more could not be
  compared -- see above)". A role with no `select` on the tables is
  compared by text identically (no privilege needed).
- *A string literal's content is never normalized* — OK (R1-B1 above).
- *A failed catalog read is not compared without asking for EXPLAIN* — OK
  live (R1-N1 above; wording R2-N2).
- *Without such a declaration, a failed rendering is reported as before*
  — OK. Silent preset, role `r2_limited` (no table privileges): 12 ×
  `check-not-compared … permission denied for table projects. Declared
  expression: "…". Catalog expression: "…". Next: confirm the connected
  role can run EXPLAIN against this table` (`expression.ts:42`), 12 EXPLAIN
  statements issued (24 log lines: each error echoes its `STATEMENT:`),
  never a text comparison.
- Not re-measured (unchanged, unit suites green): "A matching expression
  is not reported", "A differing expression is reported" (observed
  incidentally: `'"json"'` vs `'json'` → `check-object-differs` in server
  mode), "A constraint the database does not enforce is reported".

Test suites run as evidence: `packages/core` `test/expr/render-table-bound.test.ts`,
`test/dsl/check.test.ts`, `test/generated-columns-emit.test.ts`,
`test/policy-kind.test.ts` (38 passed); `packages/cli`
`test/check-expression.test.ts`, `test/check-command.test.ts` (71 passed);
`packages/nile` `test/preset.test.ts` (4 passed); `packages/skills`
`test/nile-preset-doc.test.ts` (8 passed).

### Method

- Read: the `--diff` output (its proposal header disregarded),
  `packages/core/src/expr/render-sql.ts` (`TableBoundMarker`,
  `hasAmbiguousBareName`, `renderColumnRefNode`, `renderSelectClauses`,
  `renderTableBoundExpr`), `packages/core/src/kinds/{table-snapshot,policy-kind}.ts`,
  `packages/core/src/dsl/{table,rls}.ts` (foreign-column guards),
  `packages/core/src/query/select.ts` (`exists`),
  `packages/core/src/engine/preset.ts`, `packages/nile/src/preset.ts`,
  `packages/cli/src/check/{expression,catalog}.ts`,
  `packages/cli/src/commands/check.ts`, `packages/cli/src/config.ts`,
  `packages/cli/src/core-surface.ts`, the three skill references,
  `examples/*/migrations/*.sql`, `docs/specs/…-design.md` D99, and the
  tests named above. No proposal/design/tasks/PR/git-message/blackbox
  content was read.
- Live: one container `r2-nile-review` (`postgres:17-alpine`,
  `-c log_statement=all`), databases `r2a` (full project) and `r2c` (nile
  project), roles `r2_reader` (policy target), `r2_limited` (login, no
  table privileges), `r2_nocat` (login, `select` granted, `search_path =
  shim, pg_catalog, public` with a `shim.pg_get_expr(pg_node_tree, oid)`
  that raises `insufficient_privilege` for `lab.projects` and delegates
  otherwise — the only way to fail the constraint read while
  `readCatalog`'s own `pg_get_expr` on `pg_attrdef` still succeeds).
  Throwaway projects under `/private/tmp/r2nile/{a,b,c,a2}` with
  `hejbro`, `@hejbro/{core,pg,query,nile}` symlinked; the CLI was
  `packages/cli/dist/cli.js` throughout (`init`, `generate` ×3, `check
  --url` ×8). Project A: `lab.projects` with 14 checks covering every
  adversarial input the brief names, a partial and an expression index,
  `app.widgets` (generated column), `app.tasks` with a correlated, a
  same-bare-name and a trivial policy, `audit.tasks`, and a view; B = the
  same declarations under a local `{ explainUnavailable: true }` preset;
  C = `lab.projects` only under the real `nilePreset`; A2 = the joined
  same-bare-name policy and the `exists(withCte(…))` probe (the latter
  fails at load with "Cannot read properties of undefined (reading
  'map')" when the type layer is bypassed by jiti — outside this delta's
  surface; `exists` is typed `SelectLimited`, so a CTE never reaches a
  policy through TypeScript). Catalog constraints were hand-restated
  (`drop constraint … add constraint …`) with uppercase keywords and
  doubled parentheses, a changed literal (`'"json"'` → `'json'`), a
  qualifier-like literal collapsed (`'see "lab"."projects"."name"'` →
  `'see name'`), collapsed literal whitespace, a case-changed literal, and
  `user <> ''` (the `CURRENT_USER` reading). EXPLAIN counts are
  `docker logs` deltas of `explain (format json` per run.
- The 26-row normalization table (mixed case quoted/unquoted, reserved
  words, escaped quotes carrying a double quote, `::` inside a literal,
  parentheses and a lone `"` inside literals, multi-word and array casts,
  a sibling-pair `(a) and (b)`, a different table's qualifier) was run
  through the exported `normalizeCheckText` by an in-package
  `_r2probe-normalize.test.ts`, created, run and deleted in one command;
  `git status` showed only `evaluation.md` afterwards.
- Cleanup: `docker rm -v -f r2-nile-review`, `/private/tmp/r2nile`
  removed; the pre-existing exited containers (`pgrx-builder`,
  `ne-wsproxy`, `ne-pg`) were not touched.

## Round 2 disposition

Correction in the archive PR (tasks.md group 4), lead-run under the
owner's delegation (ruling recorded in `.blackbox/750/`).

- **R2-N1** — fixed as an interpretation of step 5, not a widening of the
  enumerated list: "a type cast the server appended to a string literal"
  is the cast the server actually spells (`format_type` output), so
  `stripStringLiteralCast` now takes a schema-qualified or quoted name,
  the two-word spellings (`character varying`, `double precision`), a
  typmod, `with[out] time zone`, and array brackets — and no other word.
  Pinned by `check-expression.test.ts` "step 5 strips the whole cast the
  server appends to a literal" (twelve rows, including `'a'::text and b`
  keeping its `and b` and `null::text[]` untouched). A `timestamptz`
  literal whose *value* the server rewrites still cannot agree by text,
  as the finding notes.
- **R2-N2** — fixed: the text-mode catalog-read `Next:` names
  `pg_get_expr over conbin`, the read that fails; "3.7 a failed catalog
  read under text mode" now asserts `pg_get_expr` and the absence of
  `pg_get_constraintdef`.
- **R2-N3** — fixed: `nile-preset.md` cites the requirement by its heading
  "An expression is compared through the server's own rendering";
  `nile-preset-doc.test.ts` now reads the cited heading back out of the
  reference and asserts the main `cli-commands` spec carries it.
- **R2-N4** — tracked as #800 (owner-gated amendment of decision log D99;
  the archive proceeds with this as its archive note).

Archived at this disposition.
