# D106 round 1 — harden-check-expressions

Context-free adversarial spec review (D110 input constructor). The reviewer
read only `openspec show harden-check-expressions --diff`, the public surface
(`skills/hejbro/`, `hejbro --help`, `hejbro check --help`, the rendered
diagnostics) and the `.changeset` entry. No proposal, design, tasks, blackbox,
git history, implementation source or test file was opened. Everything below
was produced by running the built CLI against real databases.

## Method

- Worktree `_tmp-d106-ck`, detached at `dev` 3437086a, built with
  `TURBO_FORCE=1 pnpm build --force`; CLI reported as `hejbro v0.2.0-pre.1`.
- Node v26.7.0.
- Database: own container `d106-ck-pg`, `postgres:17` on host port 15733,
  `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`. `log_statement='all'` was
  enabled partway through so the exact statements `check` issues could be
  read back from `docker logs`.
- Inputs: 26 scratch hejbro projects under `/private/tmp/d106-ck/` (real
  `hejbro.config.ts` + `src/*.schema.ts` declarations, several with the
  migration `hejbro generate` itself produced), and 60 databases built from
  hand-written catalog SQL so the catalog side differs in each neighbour
  class the scenarios span: expression vs plain key positions, key order,
  key counts in both directions, predicates on either side, `INCLUDE`
  columns, collations (none / `"C"` / `"POSIX"`), operator classes, sort
  direction, uniqueness, access method, quoting, expressions Postgres
  re-renders on write, generated-stored vs default vs identity, multiple
  schemas re-using one index name, a partitioned table, and a role with
  no privilege on the table.
- Every run is `node packages/cli/dist/cli.js check` with `DATABASE_URL`
  pointed at the database under test; stdout/stderr and exit code recorded.

## Summary

**BLOCKING 0 / NON-BLOCKING 4 / OK 17**

Every delta scenario is honoured by shipped behaviour, including the
prose claims that carry universal quantifiers (every declared index
reaches the comparison; existence takes precedence; one statement per
object; collation invisible through the rendering; uniqueness / access
method / sort direction / operator class existence-only). The four
non-blocking findings are all about *reporting*, not about comparison
correctness.

---

## OK 1 — A matching generated column is not reported

Declaration (`gen/src/app.schema.ts`):

```ts
export const widgets = table(app, "widgets", {
  id: integer().primaryKey(),
  price: integer().notNull(),
  qty: integer().notNull(),
  total: integer().generatedAlwaysAs(sql`${sql.raw('"widgets"."price"')} * ${sql.raw('"widgets"."qty"')}`),
});
```

Database: the migration `hejbro generate` wrote for it
(`"total" integer generated always as ("widgets"."price" * "widgets"."qty") stored`).

Command / output:

```
$ hejbro check
… coverage boundary …
installed extensions: plpgsql
check: no differences.
EXIT=0
```

Scenario: *"A matching generated column is not reported — … no finding names
that column — in particular none about a default — and, every other object
agreeing, the run exits zero."*

**Verdict: OK.** #781's permanent `has no default, but the database has one`
is gone; exit 0 reached with a generated column present.

## OK 2 — A column generated on one side only is reported on that axis

Four inputs, all against the same declaration pair.

a) declared generated, database plain, no default:

```sql
create table "app"."widgets" (…, "total" integer, …);
```
```
error[check-object-differs]: app.widgets.total
  declared column "app.widgets.total" is generated always as `"widgets"."price" * "widgets"."qty"` stored, but the database's column is not generated. Next: …
EXIT=1
```

b) declared generated, database plain **with** `default 7` — one finding, on
the generated axis, the default named only as context inside it:

```
  declared column "app.widgets.total" is generated always as `…` stored, but the database's column is not generated (the database's column instead has a default, `7`). Next: …
```

c) declared plain (no default), database generated `(price + qty)`:

```
  declared column "app.widgets.total" is a plain column, but the database's column is generated always as `(price + qty)` stored. Next: …
```

d) declared plain **with** `.default(7)`, database generated — same single
finding as (c); no default-axis finding although the declared side carries a
default the database cannot have.

Scenario: *"…`check` reports that column as differing, stating which side is
generated, and reports no finding on its default axis."*

**Verdict: OK**, both directions, with and without a default on the plain side.

## OK 3 — A partial index's predicate that differs only by rewriting passes

Declaration (`idx`): `index("tasks_open_idx").on(t.status).where(sql`${t.status} <> 'done'`)`.
Database:

```sql
create index "tasks_open_idx" on "app"."tasks" ("status") where (status <> 'done'::text);
```

```
check: no differences.
EXIT=0
```

Server log for the run:

```
statement: explain (format json, costs off, verbose) select ("app"."tasks"."status" <> 'done'), ((status <> 'done'::text)) from "app"."tasks"
```

**Verdict: OK** — one statement, both sides in it, agreement on the rendering.

## OK 4 — A partial index whose predicate genuinely differs is reported

Declaration: `.where(isNull(t.archivedAt))`. Database:
`… where (archived_at is not null)`.

```
error[check-object-differs]: app.tasks.tasks_live_idx
  declared index predicate "app.tasks.tasks_live_idx" renders as `(archived_at IS NULL)`, but the database's own index predicate renders as `(archived_at IS NOT NULL)`. Next: …
EXIT=1
```

Scenario asks it be named "by schema, table and name" — `app.tasks.tasks_live_idx`.
**Verdict: OK.**

## OK 5 / OK 6 — An expression index whose expression matches / differs

Declaration (`p1`): `index("users_email_lower_idx").on(sql`lower(${t.email})`)`.

- database `((lower(email)))` → `check: no differences.` EXIT=0.
- database `((upper(email)))` →

```
error[check-object-differs]: app.users.users_email_lower_idx
  declared index key 1 "app.users.users_email_lower_idx" renders as `lower(email)`, but the database's own index key 1 renders as `upper(email)`. Next: …
EXIT=1
```

**Verdict: OK.** (#778's "an index passes because only its existence was
checked" is closed.)

## OK 7 — A key that is an expression on one side only, either direction

- declared `lower(email)`, database plain `("email")` →
  `declared index key 1 … renders as \`lower(email)\`, but the database's own index key 1 renders as \`email\`` EXIT=1.
- declared plain `t.email`, database `((lower(email)))` →
  `declared index key 1 … renders as \`email\`, but the database's own index key 1 renders as \`lower(email)\`` EXIT=1.

Also probed the swapped-order case (declared `(lower(v), a)` vs database
`(a, lower(v))`): **both** positions reported, key 1 and key 2.

**Verdict: OK, in either direction.**

## OK 8 — An index whose key count differs is reported on the count

Declaration `index("t1_ab_idx").on(t.a, t.b)`.

- database `("a","b","c")` → `declared index "app.t1.t1_ab_idx" has 2 key(s), but the database's index has 3.`
- database `("a")` → `… has 2 key(s), but the database's index has 1.`

"…and no rendering is probed for it": the server log for both runs contains
**zero** `explain` statements (verified by marking the log offset before the
runs and grepping the tail).

**Verdict: OK, both directions.**

## OK 9 — A database index's INCLUDE columns are not keys

Database in both cases: `create index "t1_ab_idx" on "app"."t1" ("a") include ("b");`

- declaration `index("t1_ab_idx").on(t.a)` → `check: no differences.` EXIT=0.
- declaration `index("t1_ab_idx").on(t.a, t.b)` → `has 2 key(s), but the database's index has 1.` EXIT=1.

Extra neighbour: database `((abs(c))) include ("b")` against declared `a` →
reported as a key-1 expression difference, i.e. the INCLUDE column is not
mistaken for the key.

**Verdict: OK** — exactly the two outcomes the scenario names.

## OK 10 — A declared expression the server stores as a plain key is not a difference

Declaration (`plainkey`), all three forms the scenario names:

```ts
index("u_bare_idx").on(sql`${t.email}`),
index("u_paren_idx").on(sql`(${t.email})`),
index("u_coll_idx").on(sql`${t.email} collate "C"`),
```

hejbro's own migration emitted `(("users"."email"))`, `((("users"."email")))`,
`(("users"."email" collate "C"))`; Postgres stored all three as plain keys:

```
 u_bare_idx  | CREATE INDEX u_bare_idx ON app.users USING btree (email)
 u_paren_idx | CREATE INDEX u_paren_idx ON app.users USING btree (email)
 u_coll_idx  | CREATE INDEX u_coll_idx ON app.users USING btree (email COLLATE "C")
```

```
check: no differences.
EXIT=0
```

**Verdict: OK.**

## OK 11 — An index partial on one side only is reported in either direction

- declared partial, database total:
  `declared index "app.tasks.tasks_open_idx" has a partial predicate, but the database's index has none.`
- declared total, database `where archived_at is null`:
  `declared index "app.tasks.tasks_live_idx" has no partial predicate, but the database's index has one, \`(archived_at IS NULL)\`.`

No `explain` statement was issued in either run (log verified).

**Verdict: OK.** This also settles the prose claim *"Every declared index
reaches this comparison, whether or not the declaration itself carries a
predicate or an expression"*: a declaration with neither still catches a
database index that grew one.

## OK 12 / OK 13 — A generated column whose expression matches / differs

- matches: covered by OK 1, plus a harder input — `price numeric`,
  `qty integer`, catalog text `(price * (qty)::numeric)`, declared
  `"w"."price" * "w"."qty"` → `check: no differences.` EXIT=0 (the server's
  rendering absorbs the cast the catalog carries).
- differs: database `generated always as ("price" + "qty") stored` →

```
error[check-object-differs]: app.widgets.total
  declared generated column "app.widgets.total" renders as `(price * qty)`, but the database's own generated column renders as `(price + qty)`. Next: …
EXIT=1
```

**Verdict: OK.**

## OK 14 — A missing index is reported once, never as uncomparable

Database holds the table but neither declared partial index:

```
error[check-object-missing]: app.tasks.tasks_open_idx
error[check-object-missing]: app.tasks.tasks_live_idx
check: 2 finding(s)
EXIT=1
```

Same for a missing generated column (`check-object-missing: app.widgets.total`,
one finding). A missing schema/table likewise reports the schema and the table
and nothing about their columns or indexes.

**Verdict: OK.**

## OK 15 — Under a no-planning preset, equal normalized texts agree, and the boundary line names expressions

Config: `presets: [nilePreset]` (`@hejbro/nile`). Declarations: a check
constraint `length(btrim("projects"."name")) > 0`, a partial index predicate
`"tasks"."archived_at" is null`, a generated column
`"widgets"."price" * "widgets"."qty"` (price `numeric`, qty `integer`).
Database: hejbro's own migration applied, so the catalog holds
`(length(btrim(name)) > 0)`, `(archived_at IS NULL)`, `(price * (qty)::numeric)`.

```
$ hejbro check
…
expressions (check constraints, index predicates and keys, generated columns) were compared by normalized text on this run, because a registered preset declares this platform cannot plan a statement -- a spelling difference the server would treat as equal is reported as not compared.
installed extensions: plpgsql
error[check-not-compared]: app.widgets.total
  declared generated column "app.widgets.total" could not be compared: … Declared expression: `"widgets"."price" * "widgets"."qty"`. Catalog expression: `(price * (qty)::numeric)`. Next: restate the declaration to match the catalog's own spelling: (price * (qty)::numeric)
check: could not answer -- 1 declared object(s) could not be compared. …
EXIT=2
```

The boundary line says "expressions", not "check-constraint expressions"
(the delta's "What Changes" bullet). The check constraint and the index
predicate agree after normalization; the generated column is not compared.

**Verdict: OK.**

## OK 16 — Under a no-planning preset, an index predicate and a generated column follow the same text rule, and no EXPLAIN reaches the server

The run above is exactly the scenario's input. `docker logs d106-ck-pg |
grep -ci explain` → **0** for the whole logged lifetime of the container
before the first non-preset run. The `Next:` line names restating the
declaration and never mentions `EXPLAIN`.

Extra inputs, to check the *same rule* claim across all four surfaces under
this mode:

- check constraint `inArray(t.role, ["owner","admin"])` vs catalog
  `(role = ANY (ARRAY['owner'::text, 'admin'::text]))` → `check-not-compared`.
- index **key** ``sql`${t.role} between 'a' and 'z'` `` vs catalog
  `(role >= 'a'::text AND role <= 'z'::text)` → `check-not-compared`,
  named `declared index key 1`.
- index **predicate**, same expression → `check-not-compared`,
  named `declared index predicate`.
- key-count difference and a missing index under this mode → still
  `check-object-differs` on the count / `check-object-missing`, no
  `explain` issued.

**Verdict: OK** — one rule, four surfaces.

## OK 17 — A reported expression text is delimited apart from SQL's quotes

The scenario's own input: a declared expression that begins with a quoted
identifier, reported as not compared.

```
error[check-not-compared]: app.posts.posts_role_ck
  declared check constraint "app.posts.posts_role_ck" could not be compared: … Declared expression: `"posts"."role" in ('owner', 'admin')`. Catalog expression: `(role = ANY (ARRAY['owner'::text, 'admin'::text]))`. Next: restate the declaration to match the catalog's own spelling: …
```

And the differing-finding half, under a limited role and in normal mode
(OK 5/OK 13 above): every expression text is enclosed in backticks. Codes
(`check-not-compared`, `check-object-differs`, `check-constraint-not-enforced`)
and `Next:` lines are unchanged from the pre-change wording.

**Verdict: OK.** (See NON-BLOCKING 1 and 2 for what the delimiter does *not*
cover.)

---

## Additional prose claims verified (not separate scenarios)

- **One statement, and one object's predicate + keys may share it.**
  A declared index `on(t.a, sql\`lower(t.v)\`).where(sql\`t.v <> 'q'\`)` plus a
  check constraint on the same table produced exactly two statements:

  ```
  explain (…) select (length("app"."t1"."v") > 2), ((length(v) > 2)) from "app"."t1"
  explain (…) select ("app"."t1"."v" <> 'q'), ((v <> 'q'::text)), (lower("app"."t1"."v")), (lower(v)) from "app"."t1"
  ```

  Two objects never share one; one object's predicate and keys do.
- **Collation.** Declared ``sql`${t.email} collate "C"` `` against a database
  key with no collation and against `email COLLATE "POSIX"`: the probe carries
  the catalog collation (`select (… collate "C"), (email collate "POSIX") …`)
  and the rendering drops it from both sides, so no finding — precisely the
  spec's "a difference in collation alone is not visible through the rendering
  and is not reported".
- **Uniqueness, access method, sort direction, operator class.** Declared
  `unique()` vs a non-unique database index, declared `desc(t.a)` vs `asc`,
  declared `op(t.b, "text_pattern_ops")` vs no opclass, declared btree vs
  database `using hash` — all `check: no differences.` EXIT=0, matching the
  spec's "not compared beyond the index's existence".
- **A position where both sides are plain columns.** Declared `on(t.email)`
  against a database index of that name on `("id")` → no finding. The delta
  states this explicitly (#844 boundary) and `skills/hejbro` documents it.
- **Existence precedence.** Missing index / missing column / missing table
  each reported once, with no accompanying uncomparable finding.
- **Identity is not generation.** Declared `generatedAlwaysAsIdentity()` /
  `generatedByDefaultAsIdentity()` against a matching database → no finding;
  declared stored-generated against a database identity column → reported as
  "the database's column is not generated". No confusion between
  `attgenerated` and `attidentity`.
- **Robustness.** A partitioned parent table with partitioned partial indexes,
  a function in a non-default schema inside an index expression, two schemas
  re-using the index name `t_v_idx`, an index whose declared expression is
  wrapped in an operator class, a table under `FORCE ROW LEVEL SECURITY`
  checked by a limited role with a `SELECT` policy — all compared correctly,
  no crash, no spurious finding.
- **Exit codes.** 0 (agreement), 1 (differs / missing), 2 (not compared, and
  `check-declarations-empty` for an entry file exporting no declarations).

---

## NON-BLOCKING 1 — the column-default axis still collides with its own delimiter, and uses a different delimiter from the rest of `check`

Declaration (`dq`): `note: text().default(sql`'a"b'`)`.
Database:

```sql
create table "app"."posts" (…, "note" text default 'z''q"w');
```

```
$ hejbro check
error[check-object-differs]: app.posts.note
  declared column "app.posts.note" has default "'a"b'", but the database has "'z''q"w'::text". Next: change the declaration to match the database, or write a migration that alters the default.
EXIT=1
```

Judged against: *"Wherever a diagnostic carries an expression text — a declared
or a catalog expression in a not-compared finding, both renderings in a
differing finding — the text SHALL be delimited by a character that is not one
of SQL's own quote characters."*

A column default is a declared/catalog expression text carried by a differing
finding, and here it is delimited by `"` with `"` inside it — the exact shape
#779 was filed about. The requirement's own scope sentence lists four surfaces
and a default is not one of them (it is a separate axis in the comparison-surface
list), and its rationale is about *table-bound* expressions, which a default never
is — so this is a wording gap rather than a contradiction, and it is not blocking.
What makes it worth recording is that shipped `check` uses **both** delimiters for
default text in adjacent messages: the generated-vs-default finding writes
``(the database's column instead has a default, `7`)`` with backticks, while the
default-axis finding writes `has default "…"` with double quotes. Either narrow
the requirement's "Wherever a diagnostic carries an expression text" to the four
surfaces, or extend the delimiter to the default axis so one command has one rule.

## NON-BLOCKING 2 — the backtick delimiter collides with a backtick inside a string literal

Declaration: ``check("posts_bt_ck", sql`${t.role} <> '\`tick\`'`)``.
Database: the same constraint with `'`other`'`.

```
error[check-object-differs]: app.posts.posts_bt_ck
  declared check constraint "app.posts.posts_bt_ck" renders as `(role <> '`tick`'::text)`, but the database's own check constraint renders as `(role <> '`other`'::text)`. Next: …
```

Judged against: *"…delimited by a character that is not one of SQL's own quote
characters (`"`, `'`)… so the text's own leading quoted identifier is not
mistaken for the end of the delimited text."*

The letter of the requirement is met (a backtick is not a SQL quote character),
and the motivating case — a *leading* quoted identifier — is fixed. But a string
literal may legally contain a backtick, and then the delimited text is again
ambiguous. The delta could say so (escape, or state that a delimiter collision
inside a literal is accepted), or the reporting could escape the delimiter.

## NON-BLOCKING 3 — a not-compared `Next:` blames EXPLAIN privilege even when the server's reason is a missing column

Declaration (`p1`): `index("users_email_lower_idx").on(sql`lower(${t.email})`)`
on a table with `email`. Database:

```sql
create table "app"."users" ("id" uuid not null primary key, "mail" text not null);
create index "users_email_lower_idx" on "app"."users" ((lower(mail)));
```

```
error[check-object-missing]: app.users.email
  declared column "app.users.email" was not found in the database. …

error[check-not-compared]: app.users.users_email_lower_idx
  declared index key 1 "app.users.users_email_lower_idx" could not be compared: column users.email does not exist. Declared expression: `lower("app"."users"."email")`. Catalog expression: `lower(mail)`. Next: confirm the connected role can run EXPLAIN against this table, then rerun `hejbro check`.
```

The server's own reason (`column users.email does not exist`) is carried
faithfully, which is what the spec's normal-mode fallback requires ("reported
exactly as it does today"). The `Next:` line, however, is fixed text about
`EXPLAIN` privilege and is simply wrong for this cause — and the immediately
preceding finding already names the real one. This path is newly reachable for
index keys and generated columns because of this change (before it, an index
never reached this reporting at all), so the misdirection is new surface even
though the wording is not. Consider selecting the `Next:` from the server's
SQLSTATE, or naming the preceding missing-object finding.

## NON-BLOCKING 4 — the "Declared expression" text differs between the two comparison modes, and neither matches what the DSL emits

Same declaration (`all4`), two runs.

Normal mode, limited role (`grant usage on schema app` only):

```
error[check-not-compared]: app.posts.posts_role_ck
  declared check constraint … could not be compared: permission denied for table posts. Declared expression: `"app"."posts"."role" <> 'x'`. …
error[check-not-compared]: app.posts.posts_k_idx
  declared index key 1 … Declared expression: `upper("app"."posts"."role")`. …
error[check-not-compared]: app.posts.posts_p_idx
  declared index predicate … Declared expression: `"app"."posts"."role" <> 'y'`. …
error[check-not-compared]: app.posts.tag
  declared generated column … Declared expression: `lower("posts"."role")`. …
```

Text mode (nile preset), same shape of declaration:

```
  … Declared expression: `"posts"."role" in ('owner', 'admin')`. …
```

The four surfaces all reach the not-compared reporting by one rule, which is
what the delta requires — that part is OK (and counted under OK 16/17). The
gap is the text itself: in normal mode the declared expression is shown
**schema-qualified three-part** (`"app"."posts"."role"`), which is neither
what the user wrote nor what hejbro's own DDL emits — `skills/hejbro`'s
dsl-cheatsheet states a table-bound column reference renders `"table"."column"`
— while in text mode the same finding shows the two-part form, and a generated
column shows two-part even in normal mode. Since the `Next:` for the text-mode
case tells the user to *restate the declaration*, showing a spelling hejbro
never produces is a small trap. The delta does not constrain this text, so it
is not a contradiction; it is a reporting inconsistency the change makes more
visible by adding three more surfaces that print it.

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling `.blackbox/778/` R5).

- **NB1** — the column-default axis still delimits with double quotes and adjacent messages mix delimiters → #852 (a default is not one of the four surfaces the delta names; one delimiter for every expression text is its own contract change).
- **NB2** — a backtick inside a string literal defeats the delimiter's purpose → already #841.
- **NB3** — a not-compared `Next:` blames EXPLAIN privilege for a non-privilege reason → #853 (the remedy must follow the server's reason class; a diagnostics contract change).
- **NB4** — the declared expression is spelled differently by mode and surface → #854 (one rendering across modes, the D99 table-bound form).

No delta scenario contradicts shipped behaviour. Archived at this disposition.
