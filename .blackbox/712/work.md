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

<a id="w4"></a>
## W4 — NB1/#1047: move the empty-schema line into the Not-inferred band

_2026-09-08T16:28Z · per R13, R14_

NB1 (#1047) correction after the narrow re-review: the empty-schema
"Not inferred: nothing to infer in schema ..." line landed after every
"Omitted" line (appended right before the way-out line), not inside the
Not-inferred band it belongs to.

Fix: `withReportLinesBeforeWayOut` replaced by
`withReportLinesInNotInferredBand` -- inserts right after the last
existing `Guessed:`/`Not inferred:` line (identity-based, not an
assumed index), used by both `import.ts` and `pull.ts`.

Live re-measurement, one combined input (a schema with real content
carrying its own generated-column "Not inferred"/"Omitted" lines, an
invalid-name schema, and a genuinely absent schema, `--schema app
--schema "Bad-Schema" --schema nope`), both commands, success and
refusal paths:
- import success: Guessed, Guessed role names, Not inferred (grants),
  Not inferred (column pt), Not inferred (nothing to infer "nope"),
  Approximated, Omitted (schema), Omitted (generated column) -- exit 0.
- pull success: same order -- exit 0.
- import refusal (`--schema "Bad-Schema" --schema nope`, nothing
  contributed): Guessed, Not inferred (grants), Not inferred (nothing
  to infer "nope"), Approximated, Omitted (schema), then
  `error[import-nothing-declarable]` -- exit 1.
- pull refusal, same input: same order, then
  `error[pull-nothing-declarable]` -- exit 1.

Existing Not-inferred lines keep their own relative order; the new
line only ever lands after the last of them. Fallback pinned by test
(not left undefined): when a report carries no Guessed/Not-inferred
line at all (a synthetic-only case, `buildLossReport` itself always
opens with a Guessed line), the insertion point is the very front of
the report -- still ahead of Approximated/Omitted.

Regression tests: `import-command.test.ts`/`pull-command.test.ts`,
existing tests extended with a four-band order array assertion over
the same three-case combined input; one new test pins the no-Guessed
fallback, confirmed red via a one-line sabotage (`insertAt` off by one)
before restoring.

Gates (this correction's own commit): `TURBO_FORCE=1 pnpm check` /
`check-types` / `test` (hejbro package 1621 tests) / `pnpm check:crap`
/ `pnpm check:modified-titles` / `openspec validate --strict` -- all
exit 0, repo-wide, serial.

<a id="w5"></a>
## W5 — cfr2 group 3 (3.1-3.3): D106 round 2 corrections -- an all-omitted schema is refused as nothing-declarable, pull's key lines name the way out they have, the brownfield reference states the refusal split

_2026-09-08T19:47Z · per R15, R16_

3.1 (R2-B2/R2-N3, 712/R15 then R16): `import`/`pull`'s all-empty
refusal used to classify by `result.omittedSchemaNames` alone (a
schema's own name unparseable) -- a schema holding a table or enum
omitted for *its own* name (e.g. `bad_only."Only"`) fell through to
`*-nothing-to-infer`, discarding the loss report (empty stdout) and
misreporting a real object as "nothing here". `schemaHeldAnUncarriableName`
(import.ts/pull.ts) now widens the union to `Omitted:` lines naming
that schema too -- checked against the raw `lossReport`, never a
report already folded with this check's own output, so no
circularity. R16 narrowed the evidence back to `Omitted:` lines only
(R15's own first draft briefly widened it to schema-qualified
`Not inferred:` lines too, live-measured to reclassify `seq_only`
into `nothing-declarable`, then reverted): `nothing-declarable` is a
name-cause-only code, so a schema holding only a standalone sequence
or a function (a *kind* cause, D66, no DSL builder) stays
`nothing-to-infer` -- and R16 additionally ruled both refusal paths
must print the loss report before exiting, so `nothing-to-infer`
changed from a throw (`throwHejbroError`, empty stdout) to a
`{exitCode, stdout, stderr}` return mirroring `nothingDeclarableResult`.
Live-verified (cfr2-pg, port 55810, three round trips): the six-cell
input table (bad table only / bad enum only / bad table + standalone
sequence, each alone and beside an absent/empty/healthy schema) x
{import, pull}, plus the boundary cells (`seq_only`/`fn_only` alone
and beside a healthy schema -- both keep `nothing-to-infer` with
their own `Not inferred:` line printed alongside, and beside a
healthy schema the redundant "nothing to infer" line for `seq_only`
now disappears since its own sequence line already names it,
verified live before *and* after the R16 revert to confirm the
dual-line case (`seq_only`+healthy) keeps both lines once evidence
narrowed back to `Omitted:` only). Text: `nothing-to-infer` dropped
"or sequence" (R2-N3: `sequencesInSnapshot` only ever counts an
*owned* sequence, never a standalone one) and its `Next:` clause
stopped promising "the database holds objects in them" (false for
`seq_only`/absent schemas alike) in favor of "the schema name(s) are
correct and that they hold a table or enum type to declare".
`nothing-declarable`'s own text went through three lead-approved
drafts before landing on "each one held something whose name no
declaration can carry (see the "Omitted" line(s) above). Next: follow
the way out that line names (a rename in the database)" -- generalized
away from "the schema's own catalog name" (false for `bad_only`,
whose *table* name is the problem, not the schema's).
Commit 75315049.

3.2 (R2-B1/R2-N1/R2-N2, 712/R16): `pull`'s primary-key approximation
line named no way out at all (`primaryKeyNameApproximationLineForPull`,
loss-report.ts) after the round-1 correction removed its whole
parenthetical -- requirement 2's own sentence stayed universal over
commands. Now names the rename (to the derived name), with no `check`
promise (`primaryKeyNameCollisionClauseForPull`, a sentence-ending
mirror of the import-side clause, no "until you do," continuation
since no `check` consequence follows); `import`'s own line is
untouched (regression-pinned in the same `it.each`). R2-N1: a foreign
key bound to a generated column whose own root cause is a type no
column builder expresses rendered under the name-cause wording
("whose own name no declaration can carry") instead of the type-cause
one -- `loss-report.ts`'s own `generatedExpressionRootClause` already
had the right branch; `compose.ts`'s `partitionForeignKeys` ->
`omissionEntryFor`'s own `"generatedExpression"` branch was dropping
`rootNotInferredSqlType` in transit (one field added,
`...rootNotInferredSqlTypeField(cause.rootNotInferredSqlType)`,
mirroring the sibling member family's own `firstOffendingColumn`).
Unit-tested at the `partitionForeignKeys` level directly (source end,
target end, both red before the fix) plus a first-order type-cause
regression (no generated column involved, already correct,
unaffected). Live-verified (cfr2-pg reused): `g.gen_type(pt point,
pt_txt generated always as (pt::text) stored, unique)` referenced by
`g.gen_type_ref.ref` -- both `import` and `pull` render "...which
this reading did not infer, because no column builder expresses its
type "point", so the key cannot be declared/carried either", no
`Next:` tail (R13: no exit for this cause). R2-N2: the omission band
was already several ordered lists, one per kind of object *and*
cause (a whole-object list, then a column-cascade list, per kind) --
witnessed with two new tests (FK kind, index kind) proving a
last-by-code-point whole-object entry still prints before a
first-by-code-point cascade entry; no production code changed, only
the requirement's own undercounting sentence. Rework folded into the
same commit: 3.1's own `nothing-declarable` text had landed in an
intermediate draft rather than the lead's final approved wording,
caught when the planner diffed the committed file directly against
the approved batch (a planner/implementer report race — the
implementer's own follow-up report crossed with the correction
before it was read) -- corrected here since both files were already
in this commit's own scope. Commit 3a6c6791.

3.3 (docs): `brownfield-adoption.md`'s pull-`--schema` paragraph
(507-524 pre-edit) still said "nothing to infer" and split the two
refusal codes on a since-narrowed condition ("none of them held
anything at all") — rewritten to lead its own two-code sentence with
the `nothing-declarable` discriminant first (a shared "no table or
enum survives" condition made the original ordering ambiguous between
the two codes) and to state neither refusal suppresses its own report.
Two new sentences: a domain/composite type earns no line of its own,
only through a column's own `Not inferred:` type name (R2-N6); the
re-import way out ends with a stale snapshot -- `check` clean but
`hejbro verify` exits `error[snapshot-stale]` until the next
`generate`, and the migration `generate` then emits describes objects
the database already holds, so registering it instead of running it
is #1037 (R2-N7, sharpened from "the gap in between is #1037" to name
the registration gap directly, per lead ruling). Live-verified
(DB-less, `hejbro verify` only reads files): a throwaway project
(init -> baseline -> migrate, then a declaration edit with no
`generate`) reproduces `error[snapshot-stale]: hejbro.snapshot.json`
verbatim, exit 1, "verify: 1 of 5 checks failed"; #1037 confirmed open
via `gh issue view` and its title matches the registration-gap
framing.

<a id="w6"></a>
## W6 — W5 correction: seq_only+healthy keeps both lines in the final (Omitted:-only) state

_2026-09-08T20:01Z_

W5's boundary-cell sentence stated both that the redundant "nothing to
infer" line for `seq_only` "now disappears" and that the dual-line
case "keeps both lines" -- self-contradictory. Correction: the
disappearance was measured under R15's own briefly-widened evidence
(schema-qualified `Not inferred:` lines counted too), an intermediate
state R16 retracted. Final, live-verified state (cfr2-pg, port 55810,
`import --schema seq_only --schema healthy`): both lines print --
`Not inferred: sequence "seq_only.s" -- ...` and `Not inferred: no
table or enum to declare in schema "seq_only".` -- once evidence
narrowed back to `Omitted:` lines only.

<a id="w7"></a>
## W7 — cfr2 reviewer rework: B2 content-first classification (712/R17, two revisions), B1 band-mix delta sentence, N4 pull filename

_2026-09-08T21:10Z · per R17_

B2 (712/R17, two rule revisions within one review response): a
constructor reviewer's counter-example, `create schema "EmptyBad"`
(inexpressibly named, held nothing) alone, still refused as
`import-nothing-declarable` -- the delta's own "held something" clause
was false for it. First fix widened the *evidence* for "held
something" to any table, enum, sequence or function anywhere in the
schema (a new `omittedSchemaNamesHoldingATableOrEnum` field on
`InferCatalogResult`, computed in `partitionSchemas`). The lead's
second ruling narrowed this to table/enum only (sequences and
functions are a *kind* cause, D66, never a name one) and, separately,
ruled that a D36-failing schema holding no table or enum should never
earn an `Omitted: schema …` line at all -- its own rename recovers
nothing. This collapsed the new field: `partitionSchemas`'s own
`omittedSchemas` now filters at the source (`.filter((row) =>
holdingATableOrEnum.has(row.schema))`), so `omittedSchemaNames` itself
carries the narrowed meaning and `import.ts`/`pull.ts`'s own
`schemasHoldingAnUncarriableName` reverted to reading it directly --
the wider field and its own doc comments were removed everywhere they
had been added (compose.ts, import.ts, pull.ts, three declare-emit
test fixtures, both command test files). A third schema state exists
now: D36-failing and holding nothing belongs to neither
`expressibleNames` nor `omittedSchemas` (`declareSchema` would still
refuse its name, so it is never added there either) -- silently
excluded, falling through to the same `Not inferred: no table or enum
to declare in schema "X".` line a genuinely empty schema earns.

Independent bug caught along the way (not requested, found while
writing the first version's own red tests): `schemaHeldAnUncarriableName`
(import.ts/pull.ts) scanned every `Omitted:` line for a quoted
identity equal to *or* prefixed by the schema name -- the bare-equal
branch let a schema's own `Omitted: schema "X"` line satisfy the
object-level check for schema X, reintroducing "any D36-failing schema
counts as uncarriable" through the back door the moment the
schema-level check itself was narrowed. Fixed by dropping the bare-equal
branch (`identity.startsWith(schemaName + "."))` alone remains) in both
files -- moot again once the schema-level Omitted line stopped
existing for the empty case, but the function's own contract is
correct regardless of which cases currently reach it.

Testing: two full revert/reapply cycles per rule version (git diff
saved to a patch, `git checkout --`, run, `git apply`) to keep
red-before-green honest across the widen-then-narrow rewrite --
command-level fixtures (import/pull) confirmed red then green under
the first rule, then rewritten and reconfirmed under the second;
`partitionSchemas`'s own structural unit tests (5-cell input table:
nothing/sequence-only/function-only/table/enum, plus a two-schema
sibling cell) confirmed red (4 failures) then green against the final
rule; two pre-existing `partitionSchemas / D106 R4-B1` baseline tests
needed a table added to their own "App" fixture to keep meaning what
they always meant (a bad name costs a schema) under the new content
requirement.

Live (cfr2-pg, port 55810, four round trips, each started/removed):
the reviewer's own literal repro (`EmptyBad` alone) now refuses
`import-nothing-to-infer` with no `Omitted:` line and its own
`Not inferred: no table or enum to declare` line; `SeqOnlyBad` alone
measured the same shape, and confirmed (as predicted, not forced) that
no `Not inferred: sequence …` line appears for it -- the schema never
reaches `expressibleNames`, so `filterCatalogToSchemas` excludes it
before standalone-sequence detection ever runs; `EmptyBad` beside
`BadWithContent` (a table) refuses `import-nothing-declarable` naming
only `BadWithContent`, with `EmptyBad`'s own `Not inferred:` line still
printed; the rename-then-reimport follow-through
(`BadWithContent` -> `bad_with_content`) confirmed the table is
actually declared afterward (`table(badWithContent, "t", ...)`),
not merely that the refusal changes code; `EmptyBad` beside a healthy
schema (regression) still writes the healthy file with no refusal.
`pull` mirrored the alone case.

B1 (lead-approved, no code change): the omission-band delta sentence
(spec.md ~245) replaced verbatim with the lead's own text -- two
ordered lists that never mix an object omitted for its own name with
one omitted because something it names was omitted, each list still
sorted by code points regardless of cause.

N4: the pull primary-key approximation line (`loss-report.ts`) named
"the bundle's own migration SQL" -- measured live (`ls
.hejbro/vendor/` after a real `pull`: `contract.ts`, `schema.json`,
`snapshot.sql`) that the file is `snapshot.sql` (`VENDOR_SQL_FILE`,
`vendor/lock.ts`), never "migration SQL" (that noun belongs to
`import`'s own baseline/generate output, a different file this
command never writes). Corrected in the line's own text, its doc
comment, and both pinned `infer-loss-report.test.ts` cases (free and
colliding).

Reference (brownfield-adoption.md): the `pull`'s-own-`--schema`
paragraph's `nothing-declarable` clause reworded to the lead's own
vocabulary ("lost a table or enum to a name no declaration can carry
-- its own or its schema's"). Found but not changed (reported instead,
per the "contract text needs approval" rule): the same paragraph's
preceding sentence ("a named schema whose own catalog name is not a
valid hejbro SQL identifier ... earns its own `Omitted: schema …` line
instead ... never the `Not inferred` one") is no longer universally
true under the extended B2 rule -- a D36-failing schema holding
nothing now earns the `Not inferred` line, not the `Omitted` one.

Gates (this rework's own commit): `TURBO_FORCE=1 pnpm check` /
`check-types` / `test` (hejbro package 1681 tests) / `pnpm check:crap`
/ `pnpm check:modified-titles` -- all exit 0, repo-wide, serial.

<a id="w8"></a>
## W8 — B2 rework, iteration 3: revert the withdrawn Omitted-line-removal extension

_2026-09-08T21:39Z_

712/R17 (D106 round 2 constructor review, B2) went through three
design iterations in this one review response before the lead's final
ruling. Iteration 1 (this session's original build): `omittedSchemas`
stays wide -- every D36-failing schema keeps its own `Omitted: schema
...` line (D106 R4-B4) -- while a new `omittedSchemaNamesHoldingATableOrEnum`
field carries the narrow table/enum-only subset that
`import.ts`/`pull.ts`'s own `nothing-declarable` classification reads.
Iteration 2 (committed e90bd7e7): the lead extended the rule to drop
the `Omitted:` line entirely for a content-less bad-name schema,
narrowing `partitionSchemas`'s own `omittedSchemas` at the source and
adding a third, silent branch. Iteration 3 (this entry): the lead
withdrew that extension outright ("정보 삭제만 있고 얻는 것이 없음") and
adopted the original Iteration 1 shape verbatim -- reverted here.

Reverted in compose.ts: `SchemaPartition`/`InferCatalogResult` both
carry `omittedSchemas`/`omittedSchemaNames` (wide, every D36-failing
schema) again, alongside the still-new `omittedSchemaNamesHoldingATableOrEnum`
(narrow). import.ts/pull.ts's own `schemasHoldingAnUncarriableName`
reads the narrow field; `emptySchemaLines` (both commands) is
unchanged, since it always read the wide field.

Rewrote three test files to match: import-command.test.ts and
pull-command.test.ts's own B2 describe blocks now assert that
EmptyBad/SeqOnlyBad print their own `Omitted:` line and refuse
`nothing-to-infer`, never `nothing-declarable`, alone; that a sibling
holding a table (`BadWithContent`) refuses `nothing-declarable` naming
only itself while both schemas' own `Omitted:` lines still print; and
that the regression-beside-healthy case writes the healthy file with
no refusal, the bad schema's own `Omitted:` line intact. infer-
compose.test.ts's own `partitionSchemas` structural block now asserts
`omittedSchemas` unconditionally (all five held-what cells) plus
`omittedSchemaNamesHoldingATableOrEnum` as a second, narrower
assertion (table/enum only); the two pre-existing `D106 R4-B1`
baseline tests reverted their own fixture back to content-less (the
table was only needed under Iteration 2's narrower `omittedSchemas`
rule, confirmed against a3c3d802's own original fixture). Three
declare-emit-*.test.ts fixture builders got the field back to satisfy
TypeScript (removed during Iteration 2's own cleanup, now needed
again).

Not re-claimed here, only carried forward: `schemaHeldAnUncarriableName`'s
bare-identity false-positive fix (`identity === schemaName` removed,
both import.ts/pull.ts) was found and recorded once already (W7,
Iteration 2) and needed no further change in this iteration -- still
in place, unaffected by the Iteration 2->3 revert.

Applied the lead's exact final text to spec.md's Requirement 1 delta
last clause ("a schema holding only a standalone sequence or a
function earns it too; the report still names that schema, on its own
`Not inferred:` line or, where the schema's own name kept the reading
out, on its `Omitted: schema` line.") and realigned brownfield-
adoption.md's own `pull --schema` paragraph to the same wording.
Checked, not changed: that paragraph's preceding sentence ("a named
schema whose own catalog name is not a valid hejbro SQL identifier ...
earns its own `Omitted: schema …` line instead ... never the `Not
inferred` one") was flagged during Iteration 2 as no longer
universally true; confirmed true again now that Iteration 2 is
withdrawn, so it needed no correction.

Live (cfr2-pg, port 55810, one round trip, five cells against the same
container, started/removed): `EmptyBad` alone and `SeqOnlyBad` alone
each refuse `import-nothing-to-infer`, printing only their own
`Omitted: schema "..."` line -- no `Not inferred: sequence ...` line
for `SeqOnlyBad`, confirming the exclusion-from-`expressibleNames`
finding (W7) still holds under the restored design; `BadWithContent`
alone refuses `import-nothing-declarable`; `EmptyBad` beside
`BadWithContent` refuses `import-nothing-declarable` naming only
`BadWithContent`, with both schemas' own `Omitted:` lines printed;
`EmptyBad` beside `healthy` writes the healthy file with no refusal,
`EmptyBad`'s own `Omitted:` line still printed.

Gates (this rework's own commit): `TURBO_FORCE=1 pnpm check` /
`check-types` / `test` (19+2 turbo tasks) / `pnpm check:crap` /
`pnpm check:modified-titles` -- all exit 0, repo-wide.

<a id="w9"></a>
## W9 — B2 rework, iteration 4: restore e90bd7e7's content-first Omitted rule

_2026-09-08T22:06Z_

712/R17 (D106 round 2 constructor review, B2): iteration 3 (`d224c4e6`)
reverted iteration 2's extension (`e90bd7e7`) on a cross-message ruling
that was itself superseded before it reached this worktree -- the
lead's actual final ruling keeps the extension. Iteration 4 (this
entry) reverts `d224c4e6` back to `e90bd7e7`'s design: a D36-failing
schema earns its own `Omitted: schema …` line only when it lost a
table or enum to that name; one that is genuinely empty or holds only
a standalone sequence or a function earns no `Omitted:` line at all
and falls through to the same generic `Not inferred: no table or enum
to declare in schema "X".` line a truly empty schema gets.

Deciding measurement (this worktree, live, cfr2-pg 55810/55811-taken-
by-another-agent/55812/55813, each container started/removed):
iteration 3's own `Omitted: schema "EmptyBad" ...` line, printed for a
schema holding nothing at all, carries a `Next:` clause promising
"re-run `hejbro import` ... and merge the declaration" -- a genuinely
empty schema produces no declaration to merge even after the rename,
so that `Next:` is an unkeepable promise, and requirement 2's "a line
that names the way out SHALL name the whole of it" is not met.
Iteration 2/4's rule closes this by never printing that line for a
schema with nothing to name a way out *of*.

compose.ts/import.ts/pull.ts/the six test files this touches
(import-command.test.ts, pull-command.test.ts, infer-compose.test.ts,
declare-emit-emit.test.ts, declare-emit-enum-cycle-load.test.ts,
declare-emit-callback-shadow.types.test.ts) are now byte-identical to
their own `e90bd7e7` blobs (diffed, confirmed). `omittedSchemaNamesHoldingATableOrEnum`
(iteration 3's own field) is gone; `schemaHeldAnUncarriableName`'s
bare-identity fix stays, since it was already part of `e90bd7e7`.

Two contract-text spots needed correcting, not just reverting to
`e90bd7e7`'s own original wording -- that original text ("alongside
its own `Not inferred:` line naming what was found") is itself false
under this rule: `SeqOnlyBad` alone measures no `Not inferred: sequence
...` line (the schema never reaches `expressibleNames`, so standalone-
sequence detection never runs for it), only the generic no-table-or-
enum line. spec.md's Requirement 1 delta and brownfield-adoption.md's
`pull --schema` paragraph both settled on: "the report still names
that schema on its own `Not inferred:` line" -- no claim about *what*
that line names, since it varies (a specific sequence/function count
when the schema's own name is fine, the generic line when it is not).
An intermediate draft of both sentences (this session) added an
Omitted-line branch gated on "where the schema's own name kept the
reading out"; live-measured false under this rule (see below) and
dropped before commit. The reference's own preceding sentence (the
`Omitted` vs `Not inferred` split, "wherever that name costs it
something" / "where it costs nothing") absorbs that distinction
instead, so the later sentence does not need to repeat it.

Live (cfr2-pg, one round trip, five cells against the same container,
started/removed): `EmptyBad` alone and `SeqOnlyBad` alone each print
only the generic `Not inferred: no table or enum to declare in schema
"X".` line (no `Omitted:` line at all) and refuse `import-nothing-to-
infer`; `BadWithContent` alone refuses `import-nothing-declarable`
with its own `Omitted:` line; `EmptyBad` beside `BadWithContent`
refuses `import-nothing-declarable` naming only `BadWithContent`,
`EmptyBad`'s own line stays the generic `Not inferred:` one (never
`Omitted:`, never a false merge promise); `EmptyBad` beside `healthy`
writes the healthy file with no refusal, `EmptyBad`'s own line stays
generic `Not inferred:`.

Gates: `TURBO_FORCE=1 pnpm check` / `check-types` / `test` all exit 0.
`pnpm check:crap` (turbo coverage across every package) failed twice
under measured system load (`uptime` load average 98, multiple other
agents' own Docker containers visible) with a different, unrelated
failing test file each time (`@hejbro/core` cross-instance-symbols
once, `generate-command.test.ts`/`verify.test.ts` once) -- neither run
touched this rework's own files; a third run, unchanged code, passed
clean ("no violations, 53 at the threshold"). Recorded as measured
flakiness under load, not a regression from this rework.
`check:modified-titles` exits 0.

<a id="w10"></a>
## W10 — cfr2 constructor review round: PASS, NB1 fixed here, NB2 filed #1058, NB3 won't-fix

_2026-09-08T22:29Z_

712/R17 (D106 round 2 constructor review): the reviewer's second pass,
constructed independently against SHA 79302049, closed B1, B2 and N4
-- no new blocking finding. Three non-blocking findings (NB1-NB3)
followed.

NB1 (this rework's own regression, fixed in 51ad8a36): the B2 rework's
own `schemaHeldAnUncarriableName` (import.ts/pull.ts) reintroduced an
`identity !== undefined && identity.startsWith(...)` guard Biome flags
as `lint/complexity/useOptionalChain`. `pnpm check` warning count rose
3 -> 5 against 5e9f9b6d's own baseline (all 3 of that baseline's
warnings are `scripts/check-modified-titles.mjs`, unrelated to this
change). Fixed by rewriting both call sites as
`identity?.startsWith(...)` -- no behavior change (`.some()` treats
`undefined` the same as `false`); confirmed live: `pnpm check` warning
count back to 3, all `scripts/`. Gates (`check`/`check-types`/`test`/
`check:crap`/`check:modified-titles`) all exit 0 after the fix.

NB2 (lead-triaged, filed #1058, out of this change's scope): an index,
check or unique constraint whose own name fails D36 *and* whose only
carried column was itself already omitted currently gets one chain
line with a `Next:` naming only the column's own rename -- following
that rename alone re-imports into the same member being omitted again,
this time for its own name. Requirement 2's "a line that names the way
out SHALL name the whole of it" reads strictly (the lead's ruling, and
the reviewer's own repro follows the stated way out and finds it
false) -- a genuine gap, but this change's own scope is schema-level
classification, not member-level `Next:` composition, so it is a
follow-up rather than a fold-in.

NB3 (won't-fix, lead-triaged): a schema whose own name fails D36 and
holds only a standalone sequence has no line anywhere naming the
sequence itself (only the schema's generic `Not inferred:` line, this
rework's own W9 finding). Not a gap under the content-first rule: the
schema is named on its own `Not inferred:` line as this change's delta
requires: a standalone sequence is a *kind* cause (D66, no DSL
builder) with no rename that would ever recover it, so a further,
sequence-specific line would give the reader no action to take --
recorded as an intentional asymmetry, not fixed.

