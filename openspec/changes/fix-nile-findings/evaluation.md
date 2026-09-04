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

