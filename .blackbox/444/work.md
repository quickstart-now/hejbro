# Work — quickstart-now/hejbro#444

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — fix-select-traversal — a SelectNode field grows, every traversal site must too (#444)

_2026-08-29T00:00Z_

Re-pin note (lead, 2026-08-29): the proposal.md and tasks.md pins above originally pointed at a pre-8.3 revision — the piece's late additions (task 8.3 and the second query-execution delta) were committed without re-pinning, the same omission family as the 8.3 ledger row this archive commit also restores. Re-pinned to the merged final blobs; the original SHAs (42cfc10, 9fadd52) remain resolvable in history for provenance.



Small piece team (planner opus, implementer sonnet), worktree
`fix-select-traversal` off dev `ad0d3f0`. No new owner exchange:
authorized under the owner's 2026-08-29 blanket delegation ("every
decision, merges and planning alike, judged against ORM and Postgres
norms") relayed by the lead — this entry records that the decisions
below came through that delegation, not a direct owner ruling.

### The finding (issue #444, filed from an adversarial review of the day's own merges)

`SelectNode` grew four fields in two days — `offset`/`distinct` (#438),
`groupBy`/`having` (#443) — and every site that traverses one was a
hand-written field list. All four were missed at once, at four sites,
because nothing forced a traversal to keep up with the node it
traverses:

- **F1** (query-builder injection-safety violation): `liftSelectNode`
  spliced a literal inside `groupBy`/`having`/`distinct on` into the
  SQL text instead of lifting it to a bind parameter.
- **F2**: a foreign reference in those same clauses rendered wrong SQL
  instead of throwing `foreign-column-ref`.
- **F3** (D67's no-leftover-diff invariant): a rename left a stale
  identifier behind in a stored view's `group by`/`having`/`distinct
  on`.
- **F5**: RLS declaration-time scope checks and
  `@hejbro/supabase`'s `rls-uncached-auth-call` validator could not see
  `auth.uid()` inside those clauses.
- **F7**: a pre-#443 v8 snapshot raw-`TypeError`ed in `decodeSelectNode`
  instead of decoding leniently.
- **F9**: `min`/`max` spread the argument's whole shape, including
  `sqlName`/`exprNode: ColumnRefNode`, so an aggregate reported itself
  as a real column reference to any declaration API checking that shape
  — type-checked, then failed wrong at apply time.
- **F4** (the one true semantic change, not a restored spec): a written
  `null` reached a `json`/`jsonb` column as the JSON document `'null'`,
  not SQL NULL.
- **F6**: the D102 at-risk JSON-transport cast covered only `columnRef`,
  so `max(bigintColumn)`/`count()` inside a nested read lost precision
  past `2^53` before `@hejbro/query`'s own (already-correct) bigint
  revive ever ran on it.

### The fix and its shape

One `SELECT_CLAUSE_TRAVERSALS` table in `packages/core/src/expr/
select-children.ts`, typed `{ readonly [K in keyof SelectNode]:
ClauseTraversal }` — a field added to `SelectNode` without an entry is
now a `tsc` error at this one place, and every consumer (`walk.ts`,
`render-sql.ts`, `retarget.ts`, `@hejbro/query`'s `params.ts`, the
supabase validator) inherits the fix by construction instead of by a
second manual sweep. Entry order is render order, load-bearing for
F1's `$n` numbering.

### Decisions made under the delegation (not owner-direct)

1. **F7 supersedes #437's own guard, deliberately.** #437 made a
   missing `distinct` key fail loudly so a hand-edited snapshot
   couldn't silently lose it. That guard is the wrong layer: `hejbro
   verify`'s hash chain already catches an edited snapshot
   (`snapshot-stale`/`chain-tip-mismatch`), which can tell "edited"
   from "written by an older version" — the decoder cannot, both look
   like an absent key to it. What the decoder owns is shape drift
   *within* a version: absence is history, malformation is corruption.
   Found live by the implementer mid-task (an existing test asserted
   the opposite policy), flagged rather than silently overridden, then
   the proposal recorded the supersession reasoning explicitly.
2. **F9 drops `sqlName` at runtime, not just in the type.** A
   type-only `Omit<TExpr, "exprNode" | "sqlName">` would still leave
   the spread object carrying `sqlName` at runtime, so
   `dsl/index-builder.ts`'s `"sqlName" in x` check would still be
   fooled by a bypassed cast. `min`/`max` now destructure `sqlName`
   out for real.
3. **F6 did not need the coded-rejection fallback.** The task's own
   ruling: prefer covering the at-risk aggregate cells; fall back to a
   coded rejection only if the rule can't be expressed without
   spreading into unrelated shapes, and report before taking that
   fallback. `count()` (unconditional, no `typeNode` to check, mirrors
   `convert.ts`'s own `COUNT_STATE`) and `min`/`max` (via the same
   `typeNode` path a bare column already used, kept available by the
   F9 fix) both covered cleanly; `sum`/`avg` stay uncast on purpose —
   `convert.ts` never attempts to revive them as a fixed type either,
   so casting them would be a regression (a string arriving where a
   number was promised), not a fix.

### What the live witness caught that the mock-driver characterization could not

Group 6's own characterization (`nested-revive.test.ts`) could only
measure through a proxy: a mocked driver cannot lose real precision, so
it asserted the presence of the `::text` cast rather than the
surviving value. The planner added a live-witness task for exactly
this reason (7.3, against a real postgres:17) — and it found a real,
separate gap the cast alone didn't close: `@hejbro/query`'s own
`convert.ts`'s `uncast()` only recognized a cast-wrapped `columnRef`
when unwrapping the JSON-transport cast to resolve the cell's declared
state; a cast-wrapped aggregate (`functionCall`) fell through
unresolved, so the now-correctly-cast value arrived as a string, not a
bigint. `uncast()` now sees through any cast-wrapped expr — safe by
the same reasoning a user's own `` sql`${max(t.a)}::text` `` escape
hatch already relied on structurally. Fixed immediately (not a new
design decision, restoring what F6 already specified), reported to the
planner after, with a mocked-driver regression test added alongside
the live one.

### Another real finding from the live witness, not a defect

Pairing the *same* authored literal in `distinct on` and the leading
`order by` — the naive way to prove F1's parameterization for `distinct
on` — lifts to two *different* `$n` placeholders (each literal is
lifted independently), which Postgres's own `DISTINCT ON expressions
must match initial ORDER BY expressions` rule rejects, regardless of
whether the value is correct. Not a hejbro defect: before F1, the same
two clauses held identical spliced *text*, so they matched
syntactically; after F1, they are semantically equal but syntactically
different parameters. The witness was restructured (two independent
queries) rather than treated as a regression.

### Gates

`pnpm check` (biome) clean · `pnpm check-types` 13/13 packages clean
(dist rebuilt for core/query/pg mid-piece) · `pnpm test` — core 78/78
files 1052 passed, query 622, supabase 109, pg (unit) 24, all clean ·
`pnpm --filter @hejbro/pg test:integration` 11/11 against a real
postgres:17 (Docker; one all-tests-failed batch mid-session was a
Docker container-startup flake, not reproducible, resolved by retry —
every test failed identically, including ones untouched by this piece,
which is what marked it infra rather than product) · `pnpm check:crap`
0/1364 (two functions initially landed over the CRAP-5 threshold —
`isSelectNodeUnchanged`'s five-field comparison and
`atRiskCastSuffix`'s combined guard — both split into smaller,
independently-scored functions per the repo's existing D71/#154
ratchet-5 discipline, not a design change) · `pnpm check:tasktime`
README badges synced. One `.changeset` (`patch`, `@hejbro/core`, fixed
group moves all five packages) — not `major` despite the proposal
calling F9 breaking: a type *narrowing* on an unreleased surface (code
that compiled and failed wrong at apply time now fails to compile),
and F4's null semantics ride on `write-json-and-bytea`, unreleased —
no released contract moves.

Migrated from the single-file entry `.blackbox/2026-08-29-fix-select-traversal.md`, kept verbatim at `.blackbox/444/artifacts/2026-08-29-fix-select-traversal.md`.

