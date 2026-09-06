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

