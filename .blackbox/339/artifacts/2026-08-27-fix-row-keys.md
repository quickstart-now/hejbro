Refs:
- packages/core/src/expr/ast.ts @ blob 1ee116203361297d61f8174fd33b7779deea9abf
- packages/core/src/query/select.ts @ blob 6c638ccbb521a800eed2cbd8c77340852a06df5d
- packages/core/src/query/mutate.ts @ blob d7ac47eb1a03a4f1a5128a44069d0ab9f2dac2dd
- packages/core/src/dsl/table.ts @ blob a0450e0ec3e0d7957ab5b88553d70431340eb40c
- packages/core/src/dsl/existing-table.ts @ blob c4f116083e25c40a92becb9e7abac0e9cd6b57de
- packages/query/src/db/convert.ts @ blob 686399fd41de77be0e92e6cccf9eae51631ffd0f
- packages/query/src/db/fn.ts @ blob 9f16911c1233ff8ce510cafe01906fcb30842fad
- packages/query/test/db/row-keys.test.ts @ blob 3b2cf3080905e4754195aaecb945eba379dedd1f
- packages/pg/test/integration.test.ts @ blob 90d5775a537a4dac9abd362f156b5c7444ae7458

# fix-row-keys — result rows arrive keyed by their declared keys (#339)

Plain-cycle bug fix (the type-inference spec keys row types by declared
keys and the execution spec hands values over "in the declared read
shape"; the runtime disagreed — no spec sentence moves), executed by
the lead session directly in worktree `fix-row-keys` off dev `fee1cc2`.
Last of the five-item post-harden defect queue.

## The defect

A camelCase-declared column produces a snake_case SQL column, and every
result surface delivered rows keyed by the SQL name while the inferred
row type promised the declared key — `row.amountsArray` read
`undefined` silently. Red (genuine, pre-fix): four new stub-driver
tests, one per surface — whole-table select, object projection,
whole-table `returning()`, setof-table function call — all red with
rows keyed `note_text`/`word_count` (and hg1's single-word-column
workaround in the integration harness stopped hiding it).

## The design reversal worth remembering

The first cut rendered projection/returning aliases verbatim
(`as "amountsArray"`) — and core's own suite refuted it: view column
derivation, the comments-single-depth golden, and the plpgsql function
renderer all consume the same projection aliases as **schema
identifiers**, where D57 mandates snake. The alias is medium-split:
a runtime result-set label wants the caller's TS key; a view column
materialized in DDL wants snake. One rendered form cannot serve both,
and flipping it would also have changed stored view query nodes —
spurious view diffs on every existing project.

Landed shape: the AST's projection/returning column entries carry an
optional `resultKey` (the caller's verbatim key) **beside** the
rendered snake `alias`. Rendered SQL is byte-identical to before — the
goldens, views, plpgsql bodies, and examples all pass unchanged — and
the expression codec's explicit `{alias, expr}` mapping means
`resultKey` never reaches a stored snapshot (verified by the untouched
goldens; codec-decoded nodes legitimately lack it, hence optional with
an alias fallback). `TableDeclaration.columns` gained `columnKey` (the
declared TS key; buildColumnEntries always had it and the meta assembly
dropped it), feeding the whole-table paths. `convert.ts`'s plan entries
split `alias` (the driver row's key) from `resultKey` (the converted
row's key); `convertRow` emits `resultKey`. The setof-table function
path and the scalar `"result"` plan ride the same entry shape.

## Fallout and gates

Two legacy tests had pinned the old behavior as documentation ("the
test's whole point is that alias") — their stubs stay snake (that IS
the driver's row), their expectations flip to the remapped keys. Core's
returning-AST pin gains the `resultKey` field. The CRAP gate caught
`columnPlanFromProjection` at 5.03 after the inline lookup — resolved
by extracting `allColumnsPlanEntry`, shared by the projection and
returning paths (the two blocks were near-identical anyway). The
integration harness gained a two-word column (`noteText`), so the remap
is real-server-proven, not stub-proven ('#341's file doing its job).

check-types 13/13 · test 14/14 (core 890 incl. goldens/views/plpgsql)
· CRAP 0/1184 (README block refreshed: +2 functions) · biome 410 clean
· pg integration 1/1 against postgres:17 — every turbo gate
`Cached: 0` on an isolated cache. No changeset (#344 precedent; the
pending minor×5 covers core/query/pg).
