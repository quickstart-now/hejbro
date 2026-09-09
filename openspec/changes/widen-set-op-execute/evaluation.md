# D106 evaluation — widen-set-op-execute (round 1)

Context-free adversarial spec-only review of the delta
`openspec/changes/widen-set-op-execute/specs/query-type-inference/spec.md`
(REMOVED *Set-operation branches must be row-compatible, and the result
types honestly*; ADDED *Set-operation branches must be row-compatible,
and the result types the union of both on every surface*, 7 scenarios)
against the built public surface at dev `a1fb7e7c` (the squash that
shipped the change). Read: the delta; the REMOVED requirement's text and
*A CTE reference carries its query's row type* in the main spec;
`skills/hejbro/SKILL.md`, `references/query-layer.md` (handle, chain,
set-operation, CTE, recursive-CTE and type-inference sections),
`references/dsl-cheatsheet.md`, the first part of
`references/generate-verify-workflow.md`; `README.md`; the CLI's own
`--help`; the four packages' `package.json` and the root
`package.json`/`turbo.json`/`pnpm-workspace.yaml` (to build the parent
commit); the archived `add-vendored-related` evaluation for shape. Not
read: `proposal.md`/`design.md`/`tasks.md`, anything under `.blackbox/`,
`packages/*/src`, `packages/*/test`, `examples/*/test`, archived
proposals, issues, PRs, git log messages, changesets. A session hook
banner printed the numbers of open `.blackbox/` items twice; no content
was shown or used. The deny rule on `dist/` was honoured: every typing
below is what `tsc` 5.9.3 reported from the scratch project, never a
`.d.ts` read by hand.

## Method

One real project and a real `postgres:17-alpine` (17.11; container
`d106-wso-pg`, host port 55820, `log_statement=all`, removed
afterwards), driven only through the built CLI
(`packages/cli/dist/cli.js`, `hejbro v0.2.0-pre.1`) and the built
packages. Inputs are left under `/private/tmp/d106-wso/` (`README.txt`
maps them):

- `proj/` — the scratch project. `"file:<worktree>/packages/cli"` is
  refused by pnpm (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND In :
  "@hejbro/core@workspace:*" is in the dependencies but no package named
  "@hejbro/core" is present in the workspace`), so the four packages are
  `link:`-ed instead; Node's realpath resolution makes the scratch
  project and the linked `hejbro` share one `@hejbro/core` instance.
  `hejbro init` → `src/app.schema.ts` (below) → `hejbro generate` (19
  declarations, `20260909015525_add_app.sql`) → `hejbro migrate --url`
  → `seed.sql` through psql → a second `generate`/`migrate` for two
  `defineView`s over set operations (`20260909020955_add_v_note.sql`).
- The input table (`src/app.schema.ts`, schema `app`): the width pair
  `narrow { id integer pk, n integer notNull, tag text notNull }` beside
  `wide { …, n bigint notNull, … }`; `price_int { amount integer }`
  beside `price_num { amount numeric }`; `tagged_text { kind text }`
  beside `tagged_enum { kind: pgEnum("kind", ["alpha","beta"]) }`;
  `nn { note text notNull }` beside `nul { note text }`; two `jsonb`
  brands `doc_a { body: $type<{a:number}> }` / `doc_b { body:
  $type<{b:string}> }` (a union that does not collapse); `parents`
  joined from `children` (left) and `others` (inner), both with a
  nullable `parentId` FK; identical twins `twin_a`/`twin_b`; a key-set
  mismatch partner `mismatch { id, title }`; and `tree { id, parentId,
  name, depth }` for the recursive entry. Seeds put one row per branch
  on each side of every pair, a shared row for `intersect`/`except`, a
  `null` in every nullable column, and `9007199254740993` (2^53 + 1)
  in `wide.n`.
- `src/types/*.ts` — 99 `expectTypeOf(...).toEqualTypeOf<...>()`
  assertions and 10 `@ts-expect-error` negatives under `tsc -p .`
  (`--strict --exactOptionalPropertyTypes`, exit 0 on the shipped
  build, `evidence/after-types.txt`): `matrix-execute.ts` (core-built
  stages through `handle.execute`, 50 + 6), `matrix-chain.ts` (the
  chain, 33 + 2), `matrix-cte.ts` (`w.as` bodies read through the
  reference, on `handle.with` and through `SelectResult`, 12 + 2),
  `matrix-setopstage.ts` (a hand-written `SetOpStage<P>`, 4). Every
  differing pair is written with the narrower branch on the left and
  on the right. The same files compiled against the parent commit's
  build produce 60 assertion errors (`proj-before/evidence/
  before-types.txt`), all in the execute, CTE and inferred-`SetOpStage`
  cells and none in the chain cells: those 60 are the cells that
  discriminate, the chain being the unchanged control group.
- `src/neg/*.ts` — six isolated negatives compiled one file each so the
  exact diagnostic and position are observed. `src/probe/*.ts` with
  `hover.mjs` (a TypeScript compiler-API script printing the reported
  type of every `t_*` declaration) for the types no assertion could
  spell in advance. `src/witness/b1-with-body.ts` — the B1 witness,
  five delta-expected assertions, kept out of the clean compile.
- `src/run.ts` — 80 runtime cases (46 core-built through
  `handle.execute`, 19 chain, 15 through `handle.with`), each compiled
  (`compile(stmt)` / `.compile()`) and executed; every value is
  recorded with its JavaScript runtime shape
  (`evidence/after-run.json`). `src/run-rec.ts` — two recursive-term
  shapes. `proj-before/` runs the identical script against
  `before-src/` (a `git archive` of the parent commit `9ebeef84`,
  installed and `turbo run build --force`-built; never a worktree);
  `diff-runs.mjs` compares the two JSON files byte for byte: **80 of
  80 cases identical in SQL text, parameters, rows, value shapes and
  error codes**. The rendered SQL is unchanged by the change.
- Postgres was also asked directly (`pg_typeof`, `information_schema.
  columns`, a hand-written recursive query) where a sentence is about
  the server.

Execution rows: 109 matrix assertions + 5 witness assertions + 6
negative files + 7 probe files (both builds where noted); 5 CLI
invocations (init, generate ×2, migrate ×2); 80 cases × 2 builds + 2
recursive shapes + 5 psql statements against the server.

## Blocking findings

### B1 — A set operation in `handle.with`'s own body position still reads as its left branch: a nullable branch types non-null and `null` arrives

**Delta sentences contradicted** (ADDED requirement, paragraph 4;
scenarios *Nullability widens to the union* and *A left-joined branch
widens the core-built result, an inner-joined one does not*): "That
union SHALL hold on every surface that executes a set operation: the
chain, …, a set operation built from the core builder's own
combinators executed through a db handle, and one declared as a CTE
body"; "a column nullable in EITHER branch SHALL be nullable in the
result"; "a projection no branch left-joined is not widened to include
null".

**Input** (`src/witness/b1-with-body.ts`, `src/probe/withbody.ts`,
run cases `with.body.*`): a set operation built with the core
combinators returned as the body of `handle.with` — the reference's
own words for that position are "the callback's own return value is
the statement's body — the query actually run and returned":

```ts
const rows = await handle.with((w) => {
	void w.as("u", select(s.nn));
	return select(s.nn).union(select(s.nul));
});
```

**Observed** (identical on the shipped build and on the parent
commit's build):

- `rows` types as `readonly { readonly id: number; readonly note:
  string }[]` — the left branch alone. The server returns
  `select "id", "note" from "app"."nn" union select "id", "note" from
  "app"."nul"` → `(1,'one') (2,'two') (3,null)`: the third row's
  `note` is `null` under a type that excludes it (case
  `with.body.union.nn-nul`).
- `select(s.narrow).union(select(s.wide))` in the same position types
  `n: number` (not `number | bigint`) while every row's `n` arrives as
  the driver's raw `string` (case `with.body.union.narrow-wide`).
- `select({ id: s.nn.id, note: s.nn.note }, s.nn).union(<same>)` — no
  branch joins anything — types `{ id: number | null; note: string |
  null }`: the removed requirement's "widened to include null"
  fallback, which the ADDED text says no longer applies.
- `innerJoined().union(leftJoined())` types `pname: string | null`
  only because of that same fallback (an object projection widened
  regardless of joins), not because a branch left-joined.
- Branches over two CTE references (`select({ n: x.n }, x).union(
  select({ n: y.n }, y))`, `x` over `narrow`, `y` over `wide`) type
  `n: number | null` — the union is missing there too.
- The five delta-expected assertions in the witness file fail with
  `TS2344` on both builds (`evidence` in the file's own header); the
  hover of the same statements (`src/probe/withbody.ts`) prints
  identical types under both builds.

**Provenance**: the parent commit's build types every one of these the
same way, so the root predates this change: the `handle.with` body
position reads a set-op stage the way the REMOVED requirement described
(left projection, joins untracked, object projections widened), and
the change did not touch it. It is reported as blocking because the
ADDED requirement asserts the union "on every surface that executes a
set operation" and names "a set operation built from the core
builder's own combinators executed through a db handle" — which this
is, literally — and because the nullability scenario is stated without
a surface qualifier; a program written to the delta's sentence
receives `null` typed as `string`. If the lead rules the WITH body
position outside this change (it is a neighbour of the #942 boundary,
not #942 itself: the missing null is on the body's own columns, not on
a CTE key), the requirement should name that position as excluded the
way the CTE scenario already names the recursive pair.

## Non-blocking findings

- **N1 — The residue sentence holds in one branch order only.**
  "values still arrive converted per the left branch's declarations,
  so a column the branches declare at different widths, which Postgres
  promotes (`integer` ∪ `bigint` → `bigint`), arrives in the driver's
  raw shape from either branch (measured)". Measured on all three
  surfaces (`exec.union.*`, `chain.union.*`, `with.union.*`, plus
  `exec.with.*`): with `narrow` on the left every `n` — the narrow
  branch's own `10` and `20` included — arrives as the raw `string`
  (`"10"`, `"20"`, `"9007199254740993"`) under the type `number |
  bigint`; with `wide` on the left every `n` arrives as a JavaScript
  `bigint` (`10n`, `20n`, `9007199254740993n`) — converted by the left
  branch's own codec, not the driver's raw shape, and inside the
  declared union. The sentence's first clause is what holds in both
  orders; its consequent holds only when the left branch is the
  narrower one. The skill's "the left branch's codec is the wrong one
  for the value that actually arrives and the value is handed back
  unconverted" (query-layer.md, set-operation section) has the same
  one-directional truth. Second pair, `integer` ∪ `numeric`
  (`pg_typeof` → `numeric`): `amount` arrives as `string` in both
  orders, and the union type `number | string` contains it — the type
  is honest there by the coincidence that `numeric`'s declared read
  type is `string`. Disposition: spec/docs wording ("when the left
  branch is the narrower one").
- **N2 — A WITH statement through `handle.execute` is untyped.**
  `handle.execute(withCte((w) => { const x = w.as("x",
  select(s.narrow).union(select(s.wide))); return select({ n: x.n, tag:
  x.tag }, x); }))` types `readonly Readonly<Record<string,
  unknown>>[]` (`t_cteExec`, `t_recExec`); the same with a plain
  `select` body. Identical on the parent commit's build. The rows
  arrive (`exec.with.union.*`, three cases, same values as
  `handle.with`). So the delta's CTE surface is observable only through
  `handle.with` and `SelectResult`; "No key resolves to an untyped
  driver row's value" is literally false for a core-built WITH executed
  on a handle, but the root is the WITH statement's execute typing, not
  the set operation. Disposition: fix (separately) or state the
  boundary in the requirement.
- **N3 — The CTE scenario's nullability sentences cannot be falsified
  on the public surface.** "a column declared nullable in either branch
  reading nullable … a whole-table column at its declared
  nullability": through `handle.with` every column read from a CTE
  reference is nullable (`select(x)` over `select(s.nn)` alone reads
  `note: string | null`, `id: number | null` — `t_wholeRefPlain`;
  `select(s.nn).union(select(s.nn))` reads `note: string | null` —
  `chainNoteNN`), which the reference's recursive section attributes to
  #942; through `SelectResult<{ note: typeof x.note }>` every column is
  `| null` by that utility's own documented rule (`t_refNoteNN`,
  `t_refNoteObj`). The union-of-read-types half is observable and
  holds (`n: number | bigint | null`, `body: {a} | {b} | null`, `kind:
  string | null`, and the parent build reads `n: number | null` there,
  so the fold is new). The CTE section of query-layer.md states "a
  whole-table column keeps its declared nullability" without the #942
  caveat the recursive section carries. Disposition: docs (carry the
  caveat), and the scenario could say "at the type layer" for the
  nullability half.
- **N4 — "Migration: none for callers … which every existing consumer
  already accepts" is false for a consumer that narrowed.**
  `src/probe/consumer.ts`: `const n: number = rows[0]!.n` over
  `handle.execute(select(s.narrow).union(select(s.wide)))` and `const
  note: string = notes[0]!.note` over `select(s.nn).union(select(s.
  nul))` compile on the parent build and fail on the shipped one
  (`TS2322: Type 'number | bigint' is not assignable to type 'number'`,
  `TS2322: Type 'string | null' is not assignable to type 'string'`).
  Widening a read type is a source-breaking change for any consumer
  that assigned it to the old type. Disposition: spec wording.
- **N5 — A recursive term spelled as a set operation can carry
  `intersect` and `limit`, and can fail to terminate.** The reference
  says `intersect`/`except` and the whole-set clauses "can't even be
  spelled here … unrepresentable through this builder". `(self) =>
  select(…, self).innerJoin(…).intersect(select(…, s.narrow))` and
  `… .union(select(…, s.narrow)).limit(3)` both type-check
  (`src/neg/recursive-term-intersect.ts`, `recursive-term-limit.ts`,
  no diagnostic) and compile to `union all (… intersect …)` / `union
  all (… union … limit 3)`. Postgres 17 accepted the intersect shape
  (rows `[{ id: 1 }]`; confirmed with a hand-written statement in
  psql) and accepted the limit shape too — which then never
  terminated, as did the first `union` shape (a constant branch under
  `union all` re-yields every iteration; two backends had to be
  terminated). The reference's non-termination caveat covers only the
  `LEFT JOIN` shape. The delta's "keeps its separate rule" holds for
  what it claims (see scenario 7). Disposition: docs.
- **N6 — A recursive term's branch at a different width passes the
  family check and the server refuses it.** Term branch `{ …, depth:
  s.wide.n }` (`bigint`) against the anchor's `integer` `depth`
  type-checks and the server answers `recursive query "r" column 3 has
  type integer in non-recursive term but type bigint overall`
  (`with.recursive.setop-term` in the first run). The recursive
  section's "now fails to type-check, where the server used to be the
  one to refuse it (`42804`)" reads as if the type check now covers
  what the server refuses; it covers families only, the same
  granularity the set-operation section documents as #489/#977.
  Disposition: docs.
- **N7 — `[cteRowMeta]: never` leaks into a row type.** `handle.with(
  (w) => { const x = w.as(…); return select(x); })` types its rows as
  `{ readonly id: number | null; …; readonly [cteRowMeta]: never }`
  (`t_wholeRef`, `t_wholeRefPlain`). Cosmetic; a hover reader sees an
  internal symbol key. Disposition: fix (small) / won't fix.
- **N8 — The CTE scenario's literal snippet does not type-check.**
  `withCte((w) => w.as("x", select(a).union(select(b))))` — returning
  the reference — is `TS2345: … 'CteSetOpReference<…>' is not
  assignable to parameter of type '(w: CteBuilder) =>
  WithBody<SelectProjection>'` (`src/probe/basics.ts:24`). The
  scenario's THEN is testable once a body select is returned;
  illustrative, not wrong. Disposition: spec wording.
- **N9 — Observations with no finding.** (a) Same key set in a
  different literal order (`{ p, q }` against `{ q, p }`) is refused at
  `.compile()`, before the server: `HejbroError
  set-op-key-order-mismatch` naming position 1 — the case the
  requirement's first Postgres measurement warns about is closed by the
  compiler (both builds). (b) `orderBy(s.parents.pname)` after a union
  is refused at `.compile()` with `invalid-set-op-order` listing the
  output columns `("id", "n", "tag")` — the "fails loudly" claim,
  measured. (c) `enum` ∪ `text` type-checks (the union collapses to
  `string`) and the server refuses it (`UNION types app.kind and text
  cannot be matched`) in both orders — the documented #977 gap.
  (d) `defineView(app, "v_width", select(narrow).union(select(wide)))`
  generates `create or replace view … union …`, migrates, and the
  catalog names the view's columns from the left branch with `n` as
  `bigint` (promoted) and every column `is_nullable = YES`. (e) The
  chain's `.union()` refuses a core-built select and core's `.union()`
  refuses a chain select (parameter type `never`,
  `t_chainAcceptsCore`/`t_coreAcceptsChain`): the two surfaces do not
  mix, delta silent. (f) The whole-set `orderBy`/`limit` render bare
  output names (`order by "n" desc limit 2`) and keep the union type on
  execute and chain.

## Scenarios verified

Evidence: the matrix files (line numbers as of the corpus), the run
cases by name in `proj/evidence/after-run.json`, hover output quoted
above. "Both orders" means the narrower branch was placed left and
right in turn and the same type was asserted.

1. **Identical branch shapes pass through unchanged** —
   `select(s.twinA).union(select(s.twinB))` on execute and on the chain
   types `readonly { id: number; name: string; score: number | null
   }[]`, equal to `Awaited<ReturnType<…execute(select(s.twinA))>>`
   (`matrix-execute.ts` twins block); rows `(1,'A',1) (2,'same',null)
   (3,'B',3)` with `score` `null` where the type allows it
   (`exec.union.twins`, `chain.union.twins`).
2. **Mismatched keys are rejected at compile time** — `{ id, note }`
   against `{ id, title }`: `TS2345 … not assignable to parameter of
   type 'never'` at the `.union(` argument (`mismatch-first.ts:3:37`),
   at a chained `.except(` argument (`mismatch-chained.ts:3:59`), at a
   right-nested position, on the chain (`mismatch-chain-surface.ts`
   5:44 and 6:73), inside a `w.as` body, for an object projection with
   an extra key, a missing key, and a `text`-against-`jsonb` family
   mismatch (`matrix-execute.ts` `@ts-expect-error` ×6, `matrix-chain.
   ts` ×2, `matrix-cte.ts` ×1). The server accepting such SQL was not
   re-measured; the delta calls that already measured.
3. **Nullability widens to the union** — `nn ∪ nul` and `nul ∪ nn`,
   also `except`/`intersectAll`, type `note: string | null` on execute
   and chain; a `null` arrives for id 3 (`exec.union.nn-nul`,
   `chain.union.nn-nul`). Object projections `objNN ∪ objNul` likewise.
   Fails only in the WITH body position (B1).
4. **A core-built set operation executed on a handle reads back as the
   union of its branches** — all six combinators, both orders, whole
   table (`n: number | bigint`, `amount: number | string`, `kind:
   string` with the enum on the left, `body: {a} | {b}`) and object
   projection (`{ id: number; n: number | bigint }`, no `null` added);
   the same row type the chain reads (`matrix-chain.ts`, identical
   expectations, clean on both builds); no key typed `unknown`. Rows
   arrive with the left branch's keys in every case. The residue:
   measured literally on execute, chain and CTE, both orders — see N1
   (holds with the narrower branch on the left; the wide-left order
   arrives converted as `bigint`).
5. **A left-joined branch widens the core-built result, an inner-joined
   one does not** — `inner ∪ left` and `left ∪ inner` type `pname:
   string | null` and a `null` arrives for the child without a parent
   (`exec.union.inner-left`, `left-inner`); `inner ∪ inner` types
   `pname: string` and no `null` arrives (`exec.union.inner-inner`);
   `unionAll`/`except`/`intersect` variants and `left ∪ left` as
   expected; no-join object projections `objNN ∪ objNN` type `note:
   string` (the parent build widened these to `| null`; 60 before-build
   errors include them). Chain identical.
6. **A nested core-built set operation resolves through its inner
   stage** — `(narrow ∪ wide) except narrow`, `narrow except (narrow ∪
   wide)`, `narrow ∪ (narrow except (narrow ∩ wide))`, `((narrow ∪
   wide) except narrow) ∩ narrow`, the `All` forms, `nn ∩ (nn ∪ nul)`,
   `(nn ∪ nn) except (nn ∪ nul)`, `inner ∪ (inner except left)` and
   `(inner ∪ inner) except inner` — the widening branch never leftmost
   — all type the folded union on execute and chain; rendered SQL
   parenthesises the right-nested side (`narrow except (narrow union
   wide)`), rows as expected (`exec.nest.*`, `chain.nest.*`).
7. **A set operation declared as a CTE body reads back as the union of
   its branches** — `w.as("x", select(s.narrow).union(select(s.wide)))`
   read through `x.n` on `handle.with` types `number | bigint | null`
   (parent build: `number | null`), both orders, all six combinators
   (`chainSix`), the jsonb brands, enum/text, a right-nested body, a
   later entry unioning a reference of an earlier one, and a body over
   two references; `SelectResult<{ n: typeof x.n }>` agrees. Rows
   arrive through the CTE with the same values and shapes as on
   execute (`with.union.*`, `with.later-entry`). Nullability half:
   unfalsifiable on the public surface (N3). Recursive pair: anchor
   `{ id, name, depth: integer }`, term a set operation whose second
   branch projects `depth` from `narrow` — `r.depth` reads `number |
   null`, the anchor's type, not the term's union (`rec` in
   `matrix-cte.ts`); a term missing the anchor's `depth` is refused at
   the callback argument (`recursive-term-keys.ts:9:3`); the valid
   shape returns `(1,'root',0) (2,'kid',1) (3,'grandkid',2)`
   (`with.recursive.setop-term.valid`). Its "separate rule" holds;
   see N5/N6 for what the reference over-promises around it.

Universal sentences also checked: "each branch resolves to its own row
— with its own left-joined tracking" (scenario 5, both surfaces); "no
key resolves to an untyped driver row's value" (holds on execute and
chain for every case; false only for a WITH through `execute`, N2);
"a `SetOpStage<...>` written by hand … reads as the left branch's
declared row with joins untracked, so an object projection there
widens with `null`" (query-layer.md): `SetOpStage<typeof s.narrow>`
reads `{ id: number; n: number; tag: string }`, `SetOpStage<typeof
s.wide>` reads `n: bigint`, `SetOpStage<{ id; note }>` reads `{ id:
number | null; note: string | null }`, and the same statement inferred
reads the union (`matrix-setopstage.ts`); the rendered SQL and every
row value are byte-identical to the parent commit's build across all
80 cases.

## Verdict

**BLOCKED** — one blocking finding (B1: a core-built set operation in
`handle.with`'s body position still reads as its left branch on the
shipped build — `null` arrives typed `string`, no read-type union, the
removed fallback still widening object projections; root pre-existing,
reproduced identically on the parent commit's build, but the ADDED
requirement claims "every surface" and names this one), eight
non-blocking findings (N1–N8) and one block of observations (N9).
Every other delta sentence held on real inputs: 109 matrix assertions
clean on the shipped build with 60 of them failing on the parent build,
and 80 of 80 runtime cases byte-identical between the two builds.
