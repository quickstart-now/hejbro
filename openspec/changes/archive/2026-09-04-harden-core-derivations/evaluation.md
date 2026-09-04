# Evaluation — harden-core-derivations (D106 adversarial spec review)

## Round 1

Context-free reviewer. Inputs: `openspec show harden-core-derivations --diff`,
and the public surface its scenarios name (`packages/core/src/plpgsql/reserved.ts`,
`packages/core/src/dsl/define-function.ts`, `packages/core/src/engine/diff-engine.ts`,
`@hejbro/core`'s exports, `skills/hejbro/`). Reviewed at `dev` = `419c8faa` in a
detached worktree. `proposal.md`, `design.md`, `tasks.md`, the PR body and
`.blackbox/` were not read as reasoning (the `--diff` command prints `proposal.md`
ahead of the deltas; nothing below is derived from it).

### Verdict

**BLOCKING 0 / NON-BLOCKING 4 / OK 13**

All 13 delta scenarios' `THEN` clauses hold exactly as written, verified by
constructed input tables (unit-level) and against PostgreSQL 17.11 where the
scenario asserts server behavior. The four non-blocking findings are all in
requirement *prose* that will be archived into `openspec/specs/`: one class
definition that does not reconstruct the shipped list and leaves a live
apply-time failure uncovered, one mechanism claim that is backwards on the
axis its own first scenario names, and one scenario whose input table omits
the ordering a reader would most likely guess wrong.

### Blocking

None.

### Non-blocking

**N1 — `plpgsql-function-bodies`: the refused class is narrower than the failure
it is justified by; 61 keyword names still reach the server and break there.**

The requirement defines the class as "a name Postgres reserves — its own keyword
table's categories `R` (reserved) and `T` (reserved, usable as a function or type
name) — or plpgsql reserves for its own statements" plus the variables plpgsql
declares itself, and justifies it as "A local by such a name either fails
somewhere in the body or silently changes what the name means, so hejbro refuses
it before the body reaches the server… The declaration is the only place every
one of these is visible."

Category `C` (`col_name_keyword`) is outside that class, and 61 category-`C`
names fail at `CREATE FUNCTION` in exactly the way the requirement is written to
prevent. hejbro accepts them and emits a migration Postgres rejects at apply.

Reproduction (`packages/core/src/plpgsql/reserved.ts:19-154`, the set that
`assertValidLocalName` at `:167` tests against; entry point
`packages/core/src/dsl/define-function.ts:295`):

```ts
defineFunction(app, "c_int", { args: { int: text() }, returns: text() },
  (ctx, a) => { ctx.return(a.int); });
```

accepted; `generateMigration` renders

```sql
create or replace function "app"."c_int"(int text)
returns text language plpgsql as $function$
begin
	return int;
end;
$function$;
```

applied to PostgreSQL 17.11:

```
ERROR:  syntax error at or near "text"
LINE 1: create or replace function "app"."c_int"(int text)
                                                     ^
```

Same for `row`, `values`, `trim` (all `syntax error`). `out` is worse — it is
accepted by the grammar as an **OUT-mode parameter** named by the following
type, a silent mode change that only surfaced here because the body returns:

```
ERROR:  RETURN cannot have a parameter in function with OUT parameters
```

Full measured set (arg name breaks at `CREATE`, not in hejbro's list; 61 names):
`bigint bit boolean char character coalesce dec decimal extract float greatest
grouping inout int integer interval json json_array json_arrayagg json_exists
json_object json_objectagg json_query json_scalar json_serialize json_table
json_value least merge_action national nchar none normalize nullif numeric out
overlay position precision real row setof smallint substring time timestamp
treat trim values varchar xmlattributes xmlconcat xmlelement xmlexists xmlforest
xmlnamespaces xmlparse xmlpi xmlroot xmlserialize xmltable`.

Several of these (`row`, `time`, `timestamp`, `json`, `value`-adjacent names,
`position`, `interval`) are plausible argument keys. A reader of the archived
requirement will conclude that argument names can no longer produce an
apply-time failure; they still can.

Non-blocking because no delta scenario asserts these names are refused — the
class as literally written excludes them, so shipped behavior does not
contradict any scenario. It is an over-claim in the rationale, and the
neighbour input the requirement should have measured.

**N2 — `plpgsql-function-bodies`: the stated class does not reconstruct the
shipped list — `between` and `exists` are in it and belong to neither bullet.**

`packages/core/src/plpgsql/reserved.ts:33` (`"between"`) and `:63` (`"exists"`).
Measured on PostgreSQL 17.11: `select word, catcode from pg_get_keywords() where
word in ('between','exists')` → both `C`, i.e. neither category `R` nor `T`; and
neither appears in plpgsql's own reserved-keyword list (`exit` and `elsif`, which
*are* plpgsql-reserved, are absent from hejbro's list — correctly, see below).
They do fail on the server:

```
ERROR:  syntax error at or near "between"
LINE 1: create function app.f_between(between int) returns int langu...
```

So the two names are right to be there and wrong per the stated class. An auditor
regenerating the list from the requirement produces a list two entries short;
one extending it by the requirement's own rule stops at `R ∪ T` and re-opens N1.
Distinct from N1 in that this one is visible without a server: the spec and the
shipped constant disagree on their face.

(Counter-check, for the record: `exit` and `elsif` *are* in plpgsql's
`pl_reserved_kwlist.h`, so the phrase "or plpgsql reserves for its own
statements" reads as covering them, yet they are not in the list. Measured — they
are harmless in every position hejbro renders: as an argument name, as a
`declare … record`, and with the statement they name in scope
(`app.f_exit2(3)` → `4`; `app.f_elsif2(1)` → `one`). Their absence is correct
behavior and one more place the class wording over-reaches.)

**N3 — `plpgsql-function-bodies`: the shadowing mechanism is stated backwards for
arguments — the axis the requirement's own first scenario names.**

The requirement says: "a variable plpgsql declares is created without complaint
and read as the user's local instead of plpgsql's own, so a body that tests
`found` after a statement reads a variable the statement never set."

Measured on PostgreSQL 17.11 — the opposite holds for an **argument**:

```sql
create function app.echo_found3(found boolean) returns boolean language plpgsql
as $$ begin return found; end $$;
select app.echo_found3(true);   -- f
```

The argument's value is unreachable; plpgsql's own `FOUND` (initialised false)
wins. With a statement in between it tracks plpgsql, not the caller:

```sql
create function app.echo_found2(found boolean) returns boolean language plpgsql
as $$ begin perform 1 from app.t where id = 1; return found; end $$;
select app.echo_found2(false);  -- t   (the PERFORM set plpgsql's FOUND)
```

Same for `sqlstate`: an argument named `sqlstate`, read inside an exception
handler, yields `22012`, not the argument.

The stated direction *is* correct for a **declared** local — the row-scalar and
loop-name axis:

```sql
create function app.decl_found() returns boolean language plpgsql
as $$ declare found boolean := true;
      begin perform 1 from app.t where id = 999; return found; end $$;
select app.decl_found();        -- t   (the user's local; the PERFORM never set it)
```

So the sentence is right for one of the three name positions the requirement
enumerates and inverted for the one its first scenario is about. The refusal is
identical either way, so nothing shipped contradicts a scenario — but the
archived spec would teach the wrong mechanism, and a future reader deciding
whether some *other* name is dangerous will apply the wrong test. The same
wording is in `.changeset/harden-core-derivations.md` ("shadowed plpgsql's own
with no error at all") and in `skills/hejbro/references/function-builder-pitfalls.md:58-62`
("resolves to the argument instead of plpgsql's own value").

**N4 — `function-declaration`: "A key's own refusal precedes the pair refusal"
only shows the offending key first; the interesting order is the other one.**

Scenario input: `{ order, userId, user_id }` and `{ "my-arg", userId, user_id }`
— in both, the offending key is in position 1, ahead of the colliding pair, so
the outcome is consistent with either reading ("per-key checks run first" or
"whichever problem appears first in declaration order wins"). The requirement
prose settles it ("after every key's own refusals … and over the whole argument
list at once"), but the scenario's own input table never exercises it.

Measured (`packages/core/src/dsl/define-function.ts:288-305`: the per-key
`assertSqlName`/`assertValidLocalName` run inside the eager `.map`, so the whole
list's per-key checks precede `assertNoDuplicateArgName` at `:305`):

| args | code |
|---|---|
| `{ order, userId, user_id }` | `reserved-local-name` |
| `{ "my-arg", userId, user_id }` | `invalid-sql-name` |
| `{ userId, user_id, order }` *(offender last)* | `reserved-local-name` |
| `{ userId, user_id, "my-arg" }` *(offender last)* | `invalid-sql-name` |
| `{ userId, user_id, found }` *(owned key last)* | `reserved-local-name` |

Adding one offender-last row to the scenario would pin the behavior the prose
already claims.

### Verified scenarios

`plpgsql-function-bodies`

1. **A variable plpgsql declares itself is refused as an argument name** — OK.
   Input table of all 15 owned variables (`found`, `sqlstate`, `sqlerrm` + the
   twelve `tg_*`) as `args` keys: all 15 → `reserved-local-name`. camelCase keys
   deriving to one (`tgOp` → `tg_op`, `tgTableName` → `tg_table_name`) → same.
   Message names function and name: `local name "found" in app.echo_found
   collides with a name Postgres reserves or plpgsql declares itself …`. The
   twelve `tg_*` in the delta are exactly the twelve plpgsql declares
   (10 DML + `tg_event`/`tg_tag` for event triggers) — no omission.
2. **… as a loop name, in any letter case** — OK. `ctx.forEach(…, name)` over
   `found FOUND Found tg_op TG_OP Tg_Op sqlstate sqlerrm SQLERRM` → all 9
   `reserved-local-name` (`assertValidLocalName` lower-cases before the lookup,
   `reserved.ts:167`). Note the case axis is only reachable on this axis and the
   row axis: an `args` key `FOUND` derives to `_f_o_u_n_d` and is caught earlier
   by `invalid-sql-name`, so the scenario is right to scope "any letter case" to
   loop names.
3. **A row name is judged by the locals it declares** — OK.
   `ctx.row(select({id, status}, t).limit(1), "found")` succeeds; the recorded
   declarations are exactly `["found_id","found_status"]` — no variable under
   the row name itself (`body-context.ts:284-293` registers only `${rowName}_${col}`).
4. **A keyword Postgres fully reserves is refused the same way** — OK.
   `analyse analyze current_catalog except lateral system_user` → all
   `reserved-local-name`, identical to `select` and `order`. Completeness checked
   against the server, not by eye: the shipped set contains **all 101** of
   PostgreSQL 17.11's `catcode in ('R','T')` keywords, with zero missing.
5. **A keyword reserved for function and type names is refused** — OK, including
   its universal sub-claim. All 23 named category-`T` keywords →
   `reserved-local-name`. The scenario's *reason* was verified name by name on
   the server: for 22 of 23, a body that reads (`raise exception 'value %', <n>;`)
   or assigns (`v := <n>;`) the rendered name fails at creation; `current_schema`
   is the single exception in both columns — created cleanly, and then
   `where "status" = current_schema` returned 0 rows against a matching argument
   (the builtin won) while `return current_schema` returned the argument value.
   That is precisely what the scenario claims, exception included.
6. **A name that merely contains an owned name is accepted** — OK.
   `found_at row_found tg tg_ops sqlstate_code state` all accepted as argument
   names *and* as loop names (6 × 2 = 12 inputs, all `OK`). Row named `tg` with
   a projected column `id` → accepted (`tg_id`); the same row name with column
   `op` → `reserved-local-name` (`tg_op`), exactly as the scenario's closing
   clause says.

`function-declaration`

7. **Two keys deriving to one SQL name are refused** — OK, whole input table.
   `{userId,user_id}`, the reversed `{user_id,userId}`, `{v2Id,v2_id}`,
   `{aB,a_b}`, `{userId_,user_id_}`, the three-key `{userId,userID,user_id}`,
   and the four-key `{aB,xY,x_y,a_b}` → all `duplicate-argument`, each message
   naming the function, both keys and the shared name, e.g.
   `defineFunction() "app.dup_fn" declares arguments "userId" and "user_id" that
   both derive to the SQL name "user_id".` Neighbours also checked:
   `{v2ID,v2_i_d}` and `{aBC,a_b_c}` collide as expected; `{_userId,_user_id}`
   is unreachable for this check — a leading underscore is already
   `invalid-sql-name`; single-key and empty `args` pass.
   Server premise confirmed: `create function app.dup(user_id uuid, user_id uuid)`
   → `ERROR: parameter name "user_id" used more than once`.
8. **The four-key list reports `xY` and `x_y`, not `aB` and `a_b`** — OK,
   verbatim: message contains `"xY"` and `"x_y"` and does not contain `"aB"`
   (`findDuplicateArgName`, `define-function.ts:228-256`, takes the first index
   whose name repeats an earlier one, then that earlier one).
9. **Keys that only look alike keep their own names** — OK.
   `{postID, postId}` → `["post_i_d","post_id"]`; `{id, id_}` → `["id","id_"]`.
   Both declarations succeed and argument order is unchanged.
10. **A key's own refusal precedes the pair refusal** — OK as written
    (`reserved-local-name` / `invalid-sql-name`, never `duplicate-argument`).
    See N4 for the order the scenario does not exercise.

`snapshot-diff`

Verified with a purpose-built preset kind (`co-widget`) implementing the public
`ObjectKind` surface, whose `diff` returns an arbitrary list of changes for one
identity, registered via `createKindRegistry`; snapshots hand-built as
`{formatVersion: 8, dialect: "postgres", objects: {"co-widget:<id>": node}}`.
Traces below are `identity/operation/#reportedIndex`.

11. **Two same-direction changes for one identity both survive** — OK, over a
    multiplicity table: 2 creates → `[a/create/#0, a/create/#1]`; 3 alters →
    `[a/alter/#0, a/alter/#1, a/alter/#2]`; 2 drops →
    `[a/drop/#0, a/drop/#1]`; 4 creates → 4 entries. Each exactly once, in
    reported order.
12. **Same-identity changes move together where their identity belongs** — OK.
    `a` (2 creates) depends on `z` (1 create), `z` sorting after `a` by identity:
    `[z/create/#0, a/create/#0, a/create/#1]` — dependency first, both creates of
    the dependent adjacent and in reported order.
    Neighbours: a 3-chain with mixed multiplicities
    (`a→b→c`, 2/2/3 changes) → `[c#0, c#1, c#2, b#0, b#1, a#0, a#1]`;
    a self-edge (`a` depends on `a`) → `[a#0, a#1, b#0]`, unaffected as
    `dependsOnIdentities` drops self-references; a genuine 2-cycle with 2 changes
    each → all 4 flushed, none lost; the drop direction reverses correctly →
    `[a/drop/#0, a/drop/#1, z/drop/#0]`.
13. **A create and a drop for one identity keep their own partitions** — OK.
    `["create","drop"]` → `[a/create/#0, a/drop/#1]`. Neighbour:
    `["create","drop","alter","drop"]` →
    `[a/create/#0, a/alter/#2, a/drop/#1, a/drop/#3]` — the create/alter
    partition keeps reported order among itself, the drop partition likewise.
14. **A kind outside the refinement is unaffected** — OK. The same kind without
    `dependsOnIdentities`, `a` reporting 2 creates and `b` 2 alters →
    `[a/create/#0, a/create/#1, b/alter/#0, b/alter/#1]`.

Documentation surface (not a scenario, checked because the deltas name it):
`skills/hejbro/references/function-builder-pitfalls.md:58-68` names
`reserved-local-name` over the widened set (including `current_schema` and the
function/type-name keywords) and `duplicate-argument` naming both keys and the
shared name — accurate, except that it repeats N3's inverted mechanism.
`.changeset/harden-core-derivations.md` is present and `patch`.

### Method

**Worktree.** `/Users/momo/Documents/workspace/@quickstart/hejbro-worktrees/_tmp-d106-co`,
detached, `dev` at `419c8faa`. All gates run with `TURBO_FORCE=1`.

**Gates (raw results).**

```
$ TURBO_FORCE=1 pnpm build --force
 Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
  Time:    13.76s

$ TURBO_FORCE=1 pnpm check
Checked 736 files in 494ms. No fixes applied.

$ TURBO_FORCE=1 pnpm check-types
 Tasks:    18 successful, 18 total
Cached:    0 cached, 18 total
  Time:    16.236s

$ TURBO_FORCE=1 pnpm test
 Tasks:    2 successful, 2 total      (test:types phase)
Cached:    0 cached, 2 total
  Time:    19.344s
[exited with code 0]

$ pnpm check:bans
check-bans: ok — no `let`/`var`/loop statements, and no copy of the
missing-capability message text, in 235 package source files

$ pnpm exec openspec validate harden-core-derivations --strict
Change 'harden-core-derivations' is valid
```

**Container.** `docker run -d --name d106-co-pg -e POSTGRES_HOST_AUTH_METHOD=trust
-p 127.0.0.1::5432 postgres:17-alpine` → `PostgreSQL 17.11 on x86_64-pc-linux-musl`.
Removed at the end of the round.

**Unit-level inputs.** Four scratch vitest files under `packages/core/test/`
(source-aliased, run with `pnpm exec vitest run … --reporter=verbose --silent=false`),
deleted after the round; nothing was committed. 22 + 1 + 1 + 3 assertions across
the input tables quoted above.

**Server-side inputs.**

- Keyword-set completeness: `select word from pg_get_keywords() where catcode in
  ('R','T')` (101 rows) diffed against the 134 string literals in
  `reserved.ts` — 0 missing; the 33 extras are the plpgsql statement words plus
  the 12 `tg_*` plus `found`/`sqlstate`/`sqlerrm` plus `between`/`exists` (N2).
- Failure sweep: every one of PostgreSQL 17.11's 490 keywords tried twice, once
  as `create function pg_temp.a<n>(<word> int) …` and once as
  `… as $$ declare <word> record; begin return 1; end $$`, identifiers rendered
  **unquoted** (the way hejbro renders them) and each probe under a unique
  function name (a `create or replace` reuse produces a spurious
  `cannot change name of input parameter` and was discarded). 147 keywords fail
  at least one probe; the 61 not covered by `reserved.ts` are N1.
- Category-`T` reason check: all 23 names, once with a reading body
  (`raise exception 'value %', <n>;`) and once with an assigning body
  (`v := <n>;`) — 22/23 fail both, `current_schema` fails neither, then probed
  separately for the `where` vs. `return` split.
- Shadowing direction: `echo_found2/3`, `decl_found`, `f_sqlstate` as quoted in N3.
- Apply check: the migration text `generateMigration` produced for
  `{int,row,out,values,trim}` piped straight into `psql`.
- Incidental: `create function app.trg(tg_op text) returns trigger` →
  `ERROR: trigger functions cannot have declared arguments`, so the `tg_*`
  argument case can only arise in a plain function — which the requirement
  already covers explicitly under "The refusal is uniform".

## Round 1 disposition

Lead-run under the owner's delegation (`.blackbox/412/` D12/D13; ruling in `.blackbox/748/`).

- **N1 / N2** — tracked as #832 (category-C keywords fail identically as argument names but are not refused; `between`/`exists` are outside the stated class). Measured, real, and inside hejbro's purpose — a declared function must create — but a list extension of 61 names with its own input table is a piece of its own, not an archive-time edit; the class statement is reconciled with the list when that lands.
- **N3** — fixed here: the requirement, the changeset and `function-builder-pitfalls.md` now state the measured direction — an argument named `found` is unreachable behind plpgsql's own variable (`return found` yields `FOUND`), a declared local hides it.
- **N4** — fixed here: the precedence scenario also names the offender-last inputs, pinned by two `it.each` rows in `define-function.test.ts`.

Archived at this disposition.
