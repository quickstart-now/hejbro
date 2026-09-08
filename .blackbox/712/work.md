# Work — quickstart-now/hejbro#712

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — catalog inference hardened: policy roles, enum names, the dropped primary-key name, foreign keys at omitted columns, one comparator

_2026-09-06T05:26Z_

Five gaps in the catalog reading and its loss report closed in one change: role names are unioned from `pg_policies.roles` as well as the three grant sources, and `public` is never reported; an enum type whose catalog name D36 rejects is omitted with every column typed by it and named on one line; a primary key whose catalog name is not the derived one is announced as an approximation with the only way out there is; a foreign key at a column the reading left out -- for its own name or for the enum type that typed it -- is omitted with it and announced once, its reason naming the end that failed; and every list `import` and `pull` print, the starter declarations' own handle and column order included, sorts by code points through one shared comparator.

Measured rather than assumed. (1) #873's symptom is one step earlier than the issue stated: the reading dies in core's `findForeignColumnRef` before any file is written, so `import` produces neither declarations nor a loss report. (2) `check`'s inventory has no enum axis, so the omitted-enum line names the column and states explicitly that the type is not named. (3) A dropped primary-key name costs two signals, an unmanaged-index line on stdout and a `check-object-missing` finding on stderr, so keeping the catalog name is not a way out. (4) The live witness on postgres:17-alpine printed one foreign key twice: Postgres allows an enum-to-enum foreign key only over one type, so losing the type loses both ends at once -- a shape no unit fixture had built.

Falsification. Every task predicted its mutations' red cells before running them and compared after: the shared comparator (back to `localeCompare`; always 0), role inference (`public` filter; policy source; first role only), the foreign-key column axis (source end only; target end only; whole table), the primary-key name (both gates; swapped names; first table only; name comparison alone), the enum rule (same schema only; columns dropped from the line; a column already omitted for its name; the enum alone; the enum-cause column removed from the foreign-key set), the cause-specific lines (name-cause sentence reused; dedup removed; dedup inverted), and the live witness (`roles` column removed; enum partition disabled; `roles` transported as an empty array). Three predictions were wider or narrower than the run: each was recorded as measured, and two of them corrected the tests instead of the code -- an assertion that read the whole report where it meant one line, and an assertion that sat in the cell of a cause it did not test.

<a id="w2"></a>
## W2 — three constructor-mode review rounds: the omission family widened to indexes, checks and unique constraints, and the record corrected on what a catalog can tell

_2026-09-06T08:50Z_

Three constructor-mode review rounds on postgres:17, twenty-two databases built and every way out executed against the server.

Round 1 (REWORK, three blocking, six non-blocking) measured base and branch side by side: base crashed on a foreign key at an omitted column, declared an enum whose name D36 rejects, and dropped a non-derived primary-key name in silence; this change closed all three. What it had left: an index, check or unique constraint over an omitted column stayed in the declarations, so `baseline`'s SQL and `pull`'s vendored snapshot failed to apply; a column omitted for two causes stated only one, with a remedy that merely moved it to the other line; the new primary-key line could print a rename Postgres refuses.

Round 2 (REWORK) closed five of seven. The two left were narrow: the index scan read keys only, so a partial index's predicate and an expression index's expression still named omitted columns, and the collision check looked at indexes alone, so a table, sequence or view holding the derived name left the line silent while the rename still failed.

Round 3 (PASS) confirmed both closed, over an eighteen-index table crossed against three omission causes and a nine-way collision table, with five false-positive controls surviving.

Two corrections the rounds forced on the record. `pg_depend` alone is not the authoritative list of the columns an index reads: an index a constraint backs depends on `pg_constraint`, not on its columns, so the rule is the union of the key list and the dependency rows -- the live witness caught the single-source implementation as `column "value" does not exist`. And because those rows do not separate an expression's columns from a predicate's, an index holding both names the column as "its expression or predicate names column" rather than guessing.

Process, recorded rather than smoothed over. Task 1.2's wording (KK5) went in from the approved text without a failing test first: a D88 red-first deviation, reported by the implementer; falsification rests on the mutations, which redden all twelve of those cells. Both the team and the reviewer measured the same interference twice -- gates run in parallel inside one worktree fail each other (#102's pattern) -- so every later run was serial.

Rounds four and five. Round 4 found the primary-key family closed on behaviour but `pnpm check` broken by a ternary the fix introduced -- a hard rule Biome enforces and `check:bans` does not. Reported gates and run gates had diverged: every rework batch's commit condition listed `pnpm biome check <changed files>` in place of `pnpm check` (the planner's instruction), and that round's file list did not name the file the ternary landed in. Established by re-running rather than argued: the same file-scoped command, on that commit's own copy of the file, exits 1 -- the tooling was never the cause. The first gate of every commit condition is `pnpm check` again, and gate reports carry each command's exit code and the SHA it ran at. The recurring "module not found" diagnostics several reports mention were never a gate command's output: they are the editor's background diagnostics overlapping turbo's own rebuild inside a single command, not the parallel-gate interference measured three times elsewhere.

Round 4 also found a key with several omitted members stating a way out that does not complete -- the shape closed in round 2 for a column with two causes. Requirement 2 already forbade it ("A line that names the way out SHALL name the whole of it"), so the spec was right and the implementation was short: the line now reads "until every column the key names can be declared and the key with them". Round 5 measured both directions -- renaming one member of a multi-member key does not bring the key back, and the line no longer promises it would, while renaming the only member of a single-member key does bring it back. The delta is unchanged.

One stop is worth recording. The implementer declined the planner's relaxation of a stop condition and measured instead, finding that the contract carries no primary key, index or check at all, by design -- so "cannot be carried in the contract" mislocates the loss, which lives in the schema `pull` vendors. The family keeps its wording here and #1024 carries the correction for all of those lines together.

<a id="w3"></a>
## W3 — R13/R14 rework: no-builder-type member exclusion, pull mirrors import's schema handling

_2026-09-08T15:49Z · per R11, R12, R13, R14_

Rework of the D106 round-1 correction after re-review. Lead rulings: R13
(a column whose type no builder expresses is a third root cause, general
rule across every member kind, no rename remedy exists for it) and R14
(pull mirrors import's own schema handling exactly, two new refusal
codes).

1. B1 root-cause reproduction, before the fix (live, postgres:17-alpine,
cfr1-pg, port 55770). Generated column input:
```sql
create table ex.gen_over_untyped (
  id integer primary key,
  pt point,
  px boolean generated always as ((pt is null)) stored
);
```
`hejbro import` -> exit 0, starter carries
`px: boolean().generatedAlwaysAs(sql.raw("(pt IS NULL)"))`. `hejbro
baseline`'s own migration SQL applied to an empty database via
`psql -v ON_ERROR_STOP=1 -1`: exit 3, `ERROR: column "pt" does not
exist`. The CHECK-constraint sibling (`constraint t_pt_chk check (pt is
not null or n is null)`) failed identically, same error, same exit
code.

2. B1, after the fix. Same live witness
(`infer-generated-column.integration.test.ts`'s own isolated `b1two`
describe block), 18/18 tests green, including:
`baseline`'s own migration SQL now applies clean to an empty database,
exit 0. Rendered lines (fake-session witness, `point`-typed column,
five member kinds, both commands):
import: 'Omitted: index "app.t.t_pt_idx" -- it is declared on column
"app.t.pt", which this reading did not infer, because no column
builder expresses its type "point", so the index cannot be declared
either. `check` keeps listing the index as unmanaged until that column
and the index are both declared.' (no `Next:`/`Rename …` tail); the
same shape for unique constraint, generated column, primary key
(adds "; the table is declared without a primary key. `check` keeps
listing the index that backs it as unmanaged..." per the pre-existing
PK sentence, still no tail), and foreign key (ends after "...cannot be
declared either.", no `check` sentence, no tail). pull: the same lines
with "cannot be carried in the contract either"/"cannot be carried
either" in place of "cannot be declared either", no tail either.

3. Structural fact backing R13's "no exit" ruling: full scan of
`packages/core/src/types/column-builder-factories.ts` (all 26+ exported
builders, none named `custom`/`raw`/generic) and
`skills/hejbro/references/dsl-cheatsheet.md` (the one "raw type node"
mechanism it documents is `defineFunction`/`defineTrigger`'s own
`returns`/`args`, never a table column) -- no general-purpose column
builder exists anywhere in the public DSL surface for a type like
`point`/`int4range`/`money`.

4. import's own schema handling, live (three real outputs, postgres
db holding schema `app` with one table, schema `Bad-Schema` (invalid
name) with one table, and no schema named `nope`):
- `--schema app --schema nope`: `Not inferred: nothing to infer in
  schema "nope".`, exit 0.
- `--schema nope --schema alsonope` (all absent): `error[import-nothing-to-infer]: hejbro import found no table, enum, or sequence to infer in schema(s) nope, alsonope. Next: confirm the schema name(s) are correct and that the database holds objects in them, then rerun `hejbro import`.`, exit 1.
- `--schema Bad-Schema` (invalid name, alone): `Omitted: schema "Bad-Schema" -- its catalog name is not a valid hejbro SQL identifier, ...` on stdout, then `error[import-nothing-declarable]: hejbro import found nothing it could declare in schema(s) Bad-Schema: each one held something, but its own catalog name is not a valid hejbro SQL identifier (see the "Omitted" line(s) above). Next: rename the schema(s) named above in the database, then rerun `hejbro import`.`, exit 1.

5. Gap found by measuring pull against the same three inputs before
the fix: `--schema app --schema Bad-Schema` correctly kept
`Bad-Schema`'s own `Omitted: schema …` line (pull already shared
`result.lossReport` with import). But `--schema app --schema nope`
silently dropped `nope` with no line at all -- pull had no equivalent
of import's own `emptySchemaLines`/`schemaHasNamedOmission`
mechanism.

6. Fix: `schemaHasNamedOmission`/`emptySchemaLines` mirrored into
pull.ts from import.ts (same logic, `withReportLinesBeforeWayOut`
reused directly, already exported). Live re-measurement after the fix,
one pull run, `--schema app --schema "Bad-Schema" --schema nope`:
```
pulled n4test2 (app)
...
Omitted: schema "Bad-Schema" -- its catalog name is not a valid hejbro SQL identifier, so nothing it holds (tables, enums, sequences) can be carried in the contract. Rename the schema in the database, then link the schema repository.
Not inferred: nothing to infer in schema "nope".
The loss ends when you link the schema repository.
```
exit 0. The two causes land in their own bands, matching import.

7. pull's two new refusal codes, live: all-absent schemas ->
`error[pull-nothing-to-infer]` (`hejbro pull found no table, enum, or
sequence to infer in schema(s) …`, command name swapped from import's
own text, otherwise identical); all-invalid-name schemas ->
`error[pull-nothing-declarable]` ("declare" swapped for "carry into
the contract", command name swapped, otherwise identical structure).
Both pinned in `pull-command.test.ts`.

8. Doc correction (band confusion, caught by review before landing):
the reference's own first draft called all three column-omission
causes "Omitted", which is false for the third -- that column's own
line is `Not inferred: column "…" (type "…") -- no column builder
expresses it.`, a different band; only a *member naming* that column
(index/check/UNIQUE/generated column/PK/FK) gets an `Omitted:` line.
Corrected before commit; `packages/skills`'s own link/snippet-compile
tests re-verified green after each correction pass.

9. Gates, this round's own commit (75144a80): `TURBO_FORCE=1 pnpm
check` / `check-types` / `test` (1620 hejbro package tests + every
other package, all green) / `pnpm check:crap` ("no violations, 52 at
the threshold") / `pnpm check:modified-titles` ("2 active change(s),
every delta title matches its base spec") / `openspec validate
--strict harden-catalog-inference-2` ("valid") -- all exit 0, repo-wide,
serial, no `--filter`.

