# 2026-08-26 — add-query-layer group 2: the compiler (piece team g2)

Refs:
- packages/query/src/compile/compile.ts @ blob 6316a61ff7491bd5b139320768c72c2f1a39fec2
- packages/query/src/compile/select.ts @ blob cc9e2ec3755481ba0e91d66994401775c7e176d6
- packages/query/src/compile/mutation.ts @ blob 51e2887442530b64e9ea59d73485e07a5b61a2d0
- packages/query/src/compile/params.ts @ blob e2bd6ea06f9cb9b7bf756a30b5d04b011f33d590
- packages/query/src/sql.ts @ blob fe34a8ff57c68daf6b1c2c3516d71e6236002c58
- openspec/changes/add-query-layer/specs/query-builder/spec.md @ blob a26a896f9c0dcc2484a1c177adc74dd868b85696
- openspec/changes/add-query-layer/design.md @ blob ca53b3e990990b088932f321325337e163266855
- openspec/changes/add-query-layer/tasks.md @ blob a9ffbeecfd34ce0417fe1b3a73c546e9b56e6120
- openspec/task-times.csv @ blob 6c64d12dbc2b9e4824ee621d9984b4861d1cc2e0
- openspec/task-tokens.csv @ blob e04d2e50b6d7532b8477aaf72884f4be91b40dd6
- docs/specs/2026-08-19-hejbro-design.md @ blob 72ef77497abc79fb4df695d2670ffde97a88f1fa
- README.md @ blob 0758388cb26c13a258f8b49dccb14d3faeb381cc
- scripts/crap-report.mjs @ blob d3837bea3ec562f9e7f51f478876b4f90319246d
- scripts/update-crap-readme.mjs @ blob 8c5f89104a46bcea4e1970202fdce74faf0c7db5

Session: Claude Code (Fable 5) as lead; piece team g2 (planner: Opus,
implementer: Sonnet, reviewer: Opus) under team-up v2 (D5/D88) — the
first piece-team run. Owner inputs are English rewrites of Korean
originals; team decisions reached the owner only through the lead.

---

## Owner inputs and decisions in this piece

**Compiler contract (task 2.1, six decisions).** The owner reviewed each
item with full background (after asking that the items be spelled out
one by one rather than batch-approved): ① result shape — the owner chose
`{ sql, params, kind }` over the recommended `{ sql, params }`, adding
the `kind` metadata; ② placeholders in render order `$1..$n`, no
dedup; ③ parameterization boundary — all literals bound, with `limit`
inline (validated integer), `sql.raw()`/internal `default` marker
verbatim, timestamps as `$n::timestamptz` with ISO string values,
null/boolean uniformly parameterized; ④ renderer — lift-preprocessing
plus core `renderQuery` reuse (same renderer as declarations, so "same
SQL text, literals lifted" holds by construction); ⑤ input — structural
union of the builder products plus raw `QueryNode`; ⑥ single
option-free `compile(statement)`.

**sql tagged-template contract (task 2.6, S1–S6).** Owner-settled: thin
wrapper delegating to core's `sql` tag (one tag, one meaning; extra
members live in the query package); single tag dual-use (fragment AND
statement — the `Compilable` union gains a `{ statementExpr }` branch);
`sql.identifier(...names)` added (each part quoted by core's rule);
nested fragments rely on core's structural insertion with a
render-order numbering proof test; the medium-dependent literal
behavior (inline in migrations, bound parameter in queries) is a
spec-stated property; core's `ambiguous-literal` rejection stays
(`param()` and jsonb-brand interplay parked); an empty statement
compiles to an `empty-sql-statement` error.

**Security directive.** Mid-piece the owner directed: "ORM injection
and ORM security issues must be considered." Landed as the spec delta's
"Injection safety" requirement (three SHALLs: values never in text —
params only; identifiers always quoted; `sql.raw()` the sole verbatim
path) with six adversarial scenarios, plus adversarial red tests folded
into each task (not a separate task — D88). Two exceptions are
explicitly written into the requirement because the owner had already
decided them (③): `limit` (validated integer, not caller text) and the
internal `default` marker.

**`kind: "sql"` (follow-up decision).** The implementer stopped before
code on a genuine gap at the intersection of two owner decisions: a
`sql` statement has no `queryKind` to classify. The owner chose adding
a fifth value `"sql"` ("an unclassified statement from the sql tag")
over `"unknown"` (different axis than core's type-family vocabulary)
and over making `kind` optional.

**Token ledger (owner-directed, rides this PR).** "Record token usage
alongside time — how efficiently it was done." D88's row gains the
`openspec/task-tokens.csv` clause (per-piece grain; exact because a
piece is one session per role; lead-session work is interleaved and
excluded; `waited_user_min` keeps the owner-wait exclusion structural).
This piece's row: 898 requests, 881,848 output tokens across
planner+implementer+reviewer at PR-open time.

## What the piece built

Tasks 2.1–2.6, 17 commits, strict TDD (red watched per task; the two
tasks subsumed by shared implementation — 2.3, 2.4 — are recorded as
such in tasks.md rather than given fake reds). The compiler renders by
lifting literals to `$n` `RawSqlNode`s in render order and delegating
to core `renderQuery`; `sql` is a thin wrapper over core's tag. Also:
the CRAP gate now measures `packages/query` (lead-approved scope
extension: `TARGET_PACKAGES` entry + README block derived from it
instead of a hardcoded string that would have silently stayed wrong).

## Internal processing (what review actually caught)

The reviewer worked artifact-only in `/tmp` detached worktrees. Caught
before merge: a runtime crash in code not yet written (adding the
`{statementExpr}` union branch would pass tsc but crash at dispatch —
restructured so a missing branch is a `TS2345`, proven by deleting the
check in a scratch tree); a `pnpm check` failure from package-scoped
linting missing `scripts/` (rule changed: verify from the repo root);
three tests that passed without verifying their contract (culminating
in the team rule "the numbering contract is only verifiable in SQL
text"); and the README hardcoding. `waited_user_min` stays 0 in the
ledger: owner-decision waits overlapped parallel work and were not
wall-clock measured — the team chose unmeasured-over-estimated, and the
lead agrees. Handoff note for group 4: `const f = (): never => …` does
not narrow control flow after the call (use a `function` declaration or
`return throwX(...)`), measured in scratch by the reviewer.
