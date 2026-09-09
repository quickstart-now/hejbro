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

## Round 2 (after the round-1 correction)

Context-free re-review of the same delta
(`openspec/changes/widen-set-op-execute/specs/query-type-inference/spec.md`,
REMOVED *Set-operation branches must be row-compatible, and the result
types honestly*; ADDED *Set-operation branches must be row-compatible,
and the result types the union of both on every surface*, 7 scenarios)
against the built public surface at dev `35af6b16` (the change, #1062,
plus its round-1 correction, #1069). Read: the delta; the REMOVED
requirement's text and *A CTE reference carries its query's row type*
in the main spec (the CTE scenario names it); `skills/hejbro/SKILL.md`;
`references/query-layer.md` (set-operation, CTE, recursive-CTE and
type-inference sections); `README.md` (no set-operation text); the
CLI's `--help`; the round-1 report above as a measured document; the
archived `add-vendored-related` evaluation for shape; round 1's corpus
under `/private/tmp/d106-wso/` read-only (`README.txt`, the schema,
seed, matrices, probes, `run.ts`, the recorded `after-run.json`, and
the parent-commit build under `before-src/`). Not read:
`proposal.md`/`design.md`/`tasks.md`, anything under `.blackbox/`,
`packages/*/src`, `packages/*/test`, `examples/*/test`, archived
proposals, issues, PRs, git log messages, changesets. `npx openspec
show --diff` was not used. No forbidden material reached a tool result.
Every typing quoted below is what `tsc` 5.9.3 reported from the scratch
project through a compiler-API hover script, never a `.d.ts` read by
hand.

### Method

One real project and a real `postgres:17-alpine` (17.11; container
`d106-wso-r2-pg`, host port 55825, `log_statement=all`, removed
afterwards), driven through the built CLI (`hejbro v0.2.0-pre.1`) and
the built packages, plus the parent-commit build round 1 left under
`/private/tmp/d106-wso/before-src` (`9ebeef84`, the commit before
`a1fb7e7c`) linked from a second project. Inputs are left under
`/private/tmp/d106-wso-r2/` (`README.txt` maps them):

- `proj/` is round 1's scratch project copied without `node_modules`
  and `evidence/`, its four `link:` entries repointed at this
  worktree's `packages/{cli,core,query,pg}`, `pnpm install`, then
  `hejbro migrate --url` applied round 1's two migrations
  (`20260909015525_add_app.sql`, `20260909020955_add_v_note.sql`) to
  the fresh server and `seed.sql` went in through psql (19 tables in
  `app`). Round 2 added `src/snippet.schema.ts`, the CTE scenario's own
  letters: `a { id integer pk, k integer notNull }` beside
  `b { id integer pk, k bigint }` (nullable), `hejbro generate` →
  `20260909045419_add_a.sql` → `hejbro migrate --url`, rows `a (1,5)
  (2,7)`, `b (2,7) (3,null) (4,9007199254740993)`.
- `proj-before/` links the parent-commit build and carries the same
  probes, so every with-body cell is read on both builds.
- **Regression.** Round 1's four matrices (`src/types/matrix-*.ts`,
  109 assertions, 10 negatives) compile clean, `tsc -p .` exit 0
  (`evidence/after-types.txt`). Round 1's 80 runtime cases (`src/run.ts`)
  re-run against the corrected build and the new server are identical
  to round 1's recorded `after-run.json` in SQL text, parameters, rows,
  value shapes and error codes: `same=80 diffs=0 total=80`
  (`evidence/diff-vs-round1.txt`). Since round 1 had already measured
  `a1fb7e7c` identical to the parent commit on those 80, the rendered
  SQL is unchanged by the correction too.
- **Round 1's B1 witnesses.** `src/probe/withbody.ts` hovered on both
  builds (`evidence/hover-r1-probes.txt`,
  `proj-before/evidence/hover-r1-probes-before.txt`);
  `src/witness/b1-with-body.ts` compiled alone
  (`evidence/witness-b1.txt`).
- **Own construction, the with body.** `src/probe/withbody2.ts`, 53
  `t_*` cells hovered on both builds and diffed
  (`evidence/hover-withbody2-{after,before}.txt`,
  `hover-withbody2-diff.txt`, `hover-withbody2-changed-cells.txt`): six
  plain bodies (whole-table `nn`/`nul`/`wide`, object projections with
  no join, an inner join, a left join); `nn ∪ nul` and `nul ∪ nn`,
  `nn ∪ nn`, `except`/`intersectAll` of the pair; the width pair in
  both orders across all six combinators, `integer`/`numeric` both
  orders, the two `jsonb` brands, `enum`/`text`, the twins; nesting
  left, right, three deep, and with the nullable pair; object
  projections with no join in both orders; `inner ∪ left`, `left ∪
  inner`, `inner ∪ inner`, `left ∪ left`; four hand-written
  `SetOpStage<P>` bodies; whole-set `orderBy`/`limit`; branches over
  the statement's own references; `select(ref)` bodies; and the
  `handle.execute` twin of each whole-table cell. `src/types/
  matrix-withbody.ts` asserts 43 of those cells with `expectTypeOf`
  plus one `@ts-expect-error` (a key-set mismatch in the body position)
  and is part of the clean `tsc -p .` (`evidence/after-types-r2.txt`).
  `src/run-withbody.ts` executes 44 of the same statements through
  `handle.with` on both builds: `same=44 diffs=0`
  (`evidence/withbody-run-{after,before}.json`,
  `withbody-diff-before-after.txt`, per-cell shapes in
  `withbody-run-after-summary.txt`). The server log confirms each
  statement arrived as compiled (`with "u" as (select "id", "note" from
  "app"."nn") select "id", "note" from "app"."nn" union select "id",
  "note" from "app"."nul" order by "id" asc`).
- **The corrected sentences.** `src/probe/snippet.ts` (the CTE
  scenario's snippet as written over `a`/`b`/`k`, the reference
  column's own type for `nn`, `nul`, `nn ∪ nn`, `nn ∪ nul` and an
  object-projected entry, `evidence/hover-snippet-after.txt`);
  `src/run-snippet.ts` (the snippet's rows on the CTE reference in both
  orders, on `execute`, on the with body, on the chain, and through
  `handle.execute(withCte(...))`, `evidence/snippet-run-after.txt`);
  `src/consumer/*.ts` (the migration note: four consumer programs
  compiled one file each on both builds,
  `evidence/consumer-{after,before}.txt`); `src/run-rec2.ts` (the
  reference's recursive-term sentences under a 4 s server-side
  `statement_timeout`, `evidence/rec2-after.txt`);
  `src/neg/whole-vs-obj-*.ts` and `src/probe/whole-vs-obj-chain.ts`,
  `src/run-whole-vs-obj.ts` (a pair the delta is silent about, N3).

Execution rows: 153 matrix assertions and 11 negatives in the clean
compile; 5 round-1 witness assertions; 53 + 7 + 14 + 2 hovered cells
on the corrected build and 53 + 14 on the parent build; 4 consumer
files and 2 negative files compiled on both builds; 4 CLI invocations
(migrate ×2, generate, migrate); 80 + 44 + 7 + 6 + 2 statements
against the server on the corrected build, 44 on the parent build.

### Blocking findings

None. Round 1's B1 is closed on the corrected build: see scenarios 3,
4 and 5 and the universal sentences below for the cells.

### Non-blocking findings

- **N1 — The left-join scenario's THEN, applied to the with body, is
  contradicted by the behavior the requirement paragraph itself
  prescribes for that position.** Scenario *A left-joined branch widens
  the core-built result, an inner-joined one does not*: "a projection
  no branch left-joined is not widened to include null", with no
  surface named in its WHEN. Input: `select({ id: s.nn.id, note:
  s.nn.note }, s.nn).union(<same>)` returned as the body of
  `handle.with` (`t_wb_obj_nn_nn`), and `innerJoined().union(
  innerJoined2())` in the same position (`t_wb_inner_inner`). Observed:
  `{ id: number | null; note: string | null }` and `{ id: number |
  null; pname: string | null }` — widened, no branch left-joined; the
  same statements through `handle.execute` read `{ id: number; note:
  string }` and `{ id: number; pname: string }` (`t_ex_obj_nn_nn`,
  `t_ex_inner_inner`). The requirement's fourth paragraph states
  exactly this for the body position ("folding each branch's own
  untracked read (an object-projected column widened ...)"), and the
  plain-body control confirms it is that position's existing rule
  (`t_plain_obj_nn` reads `{ id: number | null; note: string | null }`,
  `t_plain_obj_inner` likewise; both identical on the parent build).
  No value arrives outside its type in any of these cells (no `null`
  in `wb.obj.nn-nn`, `wb.join.inner-inner`). So the build follows the
  requirement text and the scenario sentence is the one that needs a
  qualifier ("through `handle.execute` or the chain"), which is why
  this is not reported as blocking. Disposition: spec wording.
- **N2 — The migration note's "every other caller is unaffected" is
  false for a CTE-reference consumer.** REMOVED block: "a consumer that
  assigned that row to the left branch's narrower type ... must widen
  its own annotation, and every other caller is unaffected".
  `src/consumer/cteref-narrowed.ts`: `const n: number | null =
  rows[0]!.n` over `handle.with((w) => { const x = w.as("x",
  select(s.narrow).union(select(s.wide))); return select({ n: x.n },
  x); })` compiles on the parent build and fails on the corrected one
  (`TS2322 ... is not assignable to type 'number | null'. Type 'bigint'
  is not assignable to type 'number'`). That consumer never assigned
  "the left branch's row" — it read a CTE reference, whose column
  widened from `number | null` to `number | bigint | null`. A with-body
  consumer (`withbody-narrowed.ts`, `const n: number`, `const note:
  string`) breaks the same way and does fit the note's first clause;
  the four callers in `unaffected.ts` (chain `number | bigint`, a plain
  select, a plain CTE entry `number | null`, the twins, an object
  projection on the chain) compile on both builds. The
  `handle.execute` consumer the note names fails as stated
  (`exec-narrowed.ts`, two `TS2322`). Disposition: spec wording (name
  the CTE reference beside the awaited row).
- **N3 — Core's combinators refuse a whole-table branch beside an
  object-projection branch with the same key set; the chain accepts
  it.** `select(s.nn).union(select({ id: s.nul.id, note: s.nul.note },
  s.nul))`, the reverse, and `select(s.nn).union(select({ id: s.nn.id,
  note: s.nn.note }, s.nn))` are each `TS2345 ... is not assignable to
  parameter of type 'never'` (`src/neg/whole-vs-obj-core.ts`, three
  errors, identical on the parent build). `handle.select(s.nn).union(
  handle.select({ id: s.nul.id, note: s.nul.note }, s.nul))`
  type-checks, reads `{ id: number; note: string | null }`, and
  executes: `select "id", "note" from "app"."nn" union select
  "app"."nul"."id" as "id", "app"."nul"."note" as "note" from
  "app"."nul"` → `(1,'one') (2,'two') (3,null)`
  (`evidence/whole-vs-obj-chain-run.txt`). The requirement states one
  refusal (different key sets) and the reference two (key sets,
  families); this pair matches on both and is refused on one surface
  only. Pre-existing, delta silent. Disposition: fix (accept the pair
  on core as the chain does) or docs.
- **N4 — `select(ref)` over a CTE reference is typed as rows and fails
  at compile time.** `handle.with((w) => { const x = w.as("x",
  select(s.nn)); return select(x); })` reads `readonly { readonly id:
  number | null; readonly note: string | null }[]` (`t_wb_whole_ref_
  plain`; the set-op entry likewise, `t_wb_whole_ref_setop`), and
  `.compile()` throws `HejbroError missing-from-table: select() with an
  object projection can't infer the from table. Next: pass it as the
  second argument: select({ … }, posts).` (`wb.whole-ref.plain`,
  `wb.whole-ref.setop`, identical on the parent build). The delta's
  CTE scenario reads the reference as `select({ k: x.k }, x)` and the
  reference documents `select(projection, ref)`, so nothing promises
  the whole-reference form; but the type layer accepts it and reports a
  row type the runtime never delivers. Pre-existing. Disposition: fix
  (refuse at the type level, or infer the from source from the
  reference).
- **N5 — A hand-written `SetOpStage<P>` body hides a `null` and a raw
  string that the inferred type shows.** `const st: SetOpStage<typeof
  s.nn> = select(s.nn).union(select(s.nul)); return st;` as the with
  body reads `{ id: number; note: string }` (`t_wb_stage_whole_nn`)
  while the rows are `(1,'one') (2,'two') (3,null)`
  (`wb.stage.whole.nn`); `SetOpStage<typeof s.narrow>` reads `n:
  number` (`t_wb_stage_whole_narrow`) while every `n` arrives as a
  string (`"10"`, `"20"`, `"9007199254740993"`). The same statements
  inferred read `note: string | null` and `n: number | bigint`. The
  reference states the rule ("carries no branches to resolve: it still
  reads as the left branch's declared row"); round 1 measured the same
  on `handle.execute`; both builds identical. Disposition: by design
  per the reference, with a docs note that the annotation can hide a
  `null` the inferred type shows.
- **N6 — Observations with no finding.** (a) The reference's "the
  declared nullability half is visible only at the type layer" is
  visible in the reference column's own type: `nnRef.note` carries
  `ColumnBuilder<"text", { typeName: "text" } & { notNull: true }>` in
  its origin brand, `nulRef.note` carries it without `notNull`, and the
  set-op entry's `nnNul.note` is the union of both origins
  (`t_nnRefNote`, `t_nulRefNote`, `t_nnNulNote`); `SelectResult` over
  any of them still reads `string | null` (round 1's N3 evidence,
  unchanged: `t_refNoteNN`). (b) `enum ∪ text` as the with body
  type-checks (`kind: string`) and the server refuses it (`UNION types
  app.kind and text cannot be matched`, `wb.union.enum-text`), the #977
  gap the reference documents, same as the other surfaces. (c) The
  `orderBy(...).limit(...)` whole-set clauses work in the body position
  (`wb.orderBy.limit` → `(3,null) (2,'two')` under `note: string |
  null`). (d) A recursive term written as `select(..., self).leftJoin(
  s.tree, ...)` with a `where self.depth < 3` guard terminates and
  yields a trailing `(null, null)` row under `id: number | null`
  (`leftJoinGuarded`), the reference's LEFT JOIN caveat with its own
  remedy applied.

### Scenarios verified

Evidence: hover output by `t_*` name (`evidence/hover-*.txt`), run
cases by name (`evidence/withbody-run-after.json`,
`snippet-run-after.txt`, `rec2-after.txt`), matrix cells in
`src/types/matrix-withbody.ts`. "Both orders" means the widening branch
was placed left and right in turn.

1. **Identical branch shapes pass through unchanged** — round 1's
   execute and chain cells stay clean (regression). Added: `select(
   s.twinA).union(select(s.twinB))` as the with body equals
   `Awaited<ReturnType<...handle.with(... select(s.twinA))>>`
   (`matrix-withbody.ts`, twins cell; `t_wb_twins`), rows `(1,'A',1)
   (2,'same',null) (3,'B',3)` (`wb.union.twins`).
2. **Mismatched keys are rejected at compile time** — round 1's ten
   negatives stay in place; added `select(s.nn).union(select(
   s.mismatch))` returned as the with body: refused at the `.union(`
   argument (`@ts-expect-error` in `matrix-withbody.ts`, the compile is
   clean only because the error is present). See N3 for a matching key
   set core refuses anyway.
3. **Nullability widens to the union** — on the with body now: `nn ∪
   nul` and `nul ∪ nn` read `note: string | null` (`t_wb_nn_nul`,
   `t_wb_nul_nn`; parent build `string` for the first), `except` and
   `intersectAll` of the pair likewise, `nn ∪ nn` reads `note: string`
   (declared nullability kept, `t_wb_nn_nn`); `null` arrives for id 3
   under the nullable type (`wb.union.nn-nul`, `wb.union.nul-nn`) and
   no `null` arrives where the type excludes it (`wb.union.nn-nn`).
   Round 1's execute/chain cells unchanged. The a/b snippet: `k:
   number | bigint | null` on every typed surface with `null` arriving
   for id 3 (`snippet.exec`, `snippet.body`, `snippet.chain`,
   `snippet.ref`).
4. **A core-built set operation executed on a handle reads back as the
   union of its branches** — round 1's 50 execute cells unchanged; the
   with body now agrees for whole tables: `n: number | bigint` in both
   orders across all six combinators (`t_wb_narrow_wide` ...
   `t_wb_exceptAll_wn`; parent build `number` or `bigint` by the left
   branch), `amount: string | number` both orders, `body: {a} | {b}`,
   `kind: string`, and each whole-table cell equals its
   `handle.execute` twin (`matrix-withbody.ts`, "alike" block). No key
   types `unknown` in any of the 53 cells. **The residue, both
   orders:** with `narrow` on the left every `n` arrives as a string
   (`"10"`, `"20"`, `"9007199254740993"`; `wb.union.narrow-wide`,
   `wb.intersect.narrow-wide`, `wb.except.narrow-wide`,
   `wb.obj.narrow-wide`, `wb.refs.narrow-wide`, `snippet.ref`); with
   `wide` on the left every `n` arrives as a JavaScript bigint (`10n`,
   `20n`, `9007199254740993n`; `wb.union.wide-narrow`,
   `wb.unionAll.wide-narrow`, `wb.intersectAll.wide-narrow`,
   `wb.exceptAll.wide-narrow`, `wb.obj.wide-narrow`,
   `snippet.ref.swapped`, `snippet.exec.swapped`) — exactly the
   corrected sentence's two clauses. `integer ∪ numeric` arrives as a
   string in both orders inside `string | number` (`wb.union.int-num`,
   `wb.union.num-int`).
5. **A left-joined branch widens the core-built result, an inner-joined
   one does not** — on `handle.execute`: `inner ∪ left` and `left ∪
   inner` read `pname: string | null`, `inner ∪ inner` reads `pname:
   string`, `objNN ∪ objNN` reads `note: string` (`t_ex_inner_left`,
   `t_ex_inner_inner`, `t_ex_obj_nn_nn`; parent build widened all
   three); round 1's rows unchanged. On the with body every object
   projection is widened regardless of joins (`t_wb_inner_left`,
   `t_wb_left_inner`, `t_wb_inner_inner`, `t_wb_left_left`,
   `t_wb_obj_nn_nn`), the rule the requirement paragraph states for
   that position; `null` arrives only in the left-joined cells
   (`wb.join.inner-left`, `wb.join.left-inner`, `wb.join.left-left`:
   id 2's `pname`), never in `wb.join.inner-inner` or `wb.obj.nn-nn`.
   The scenario's own sentence on this position: N1.
6. **A nested core-built set operation resolves through its inner
   stage** — on the with body: `(narrow ∪ wide) except narrow`, `narrow
   except (narrow ∪ wide)`, `narrow ∪ (narrow except (narrow ∩ wide))`
   read `n: number | bigint` (`t_wb_nest_left`, `t_wb_nest_right`,
   `t_wb_nest_three`; parent build `number`), `nn ∩ (nn ∪ nul)` and
   `(nn ∪ nul) except nn` read `note: string | null`; rendered SQL
   parenthesises the right-nested side and the rows match
   (`wb.nest.*`; `wb.nest.left.nul` → `(3,null)`). Round 1's execute
   and chain cells unchanged.
7. **A set operation declared as a CTE body reads back as the union of
   its branches** — the snippet as written, `withCte((w) => { const x =
   w.as("x", select(a).union(select(b))); return select({ k: x.k }, x);
   })`, type-checks with no diagnostic (`t_snippetStmt`, round 1's N8
   closed) and through `handle.with` reads `k: number | bigint | null`
   in both orders (`t_snippetRows`, `t_snippetRowsSwapped`), rows `5, 7,
   null, 9007199254740993` with the residue's shapes (`snippet.ref`,
   `snippet.ref.swapped`); round 1's 18 CTE cells unchanged. The
   reference's columns carry both branches' origins at the type layer
   (N6a). `handle.execute(withCte(...))` stays the untyped surface the
   requirement excludes (`t_cteExec`: `readonly Readonly<Record<string,
   unknown>>[]`, rows still arrive: `snippet.withCte.execute`).
   Recursive pair: `r.depth` reads the anchor's `number | null` with a
   set-op term whose branch projects `bigint` (round 1's `rec` cell,
   unchanged); see below for the reference's sentences.

Universal sentences also checked:

- "`handle.execute(...)` and the body `handle.with(...)` returns alike,
  the latter folding each branch's own untracked read (an
  object-projected column widened, a whole-table column at its
  declared nullability, the rule that position already has for a plain
  body)" — plain bodies: `select(s.nn)` reads `{ id: number; note:
  string }`, `select(s.nul)` `{ id: number; note: string | null }`,
  `select({ id, note }, s.nn)` `{ id: number | null; note: string |
  null }`, a left- or inner-joined object projection likewise
  (`t_plain_*`, identical on the parent build); the set-op cells fold
  those per key (scenarios 3–6); whole-table cells equal their
  `execute` twins, object-projection cells differ from theirs by
  exactly the widening (`t_wb_obj_nn_nn` vs `t_ex_obj_nn_nn`).
- "No key resolves to an untyped driver row's value" — no `unknown` in
  any with-body, execute or chain cell (53 + round 1's cells); false
  only for `handle.execute(withCte(...))`, which the requirement now
  names as outside itself (N2 of round 1 → #1055).
- REMOVED block, **Migration** — measured on both builds; the named
  consumer breaks as stated, one unnamed consumer breaks too (N2).
- The reference's CTE caveat — "Through `handle.with`, though, every
  column read from a CTE reference arrives nullable": `select(x)` over
  a plain `nn` entry reads `id: number | null; note: string | null`
  (`t_wb_whole_ref_plain`), `select({ n: x.n }, x)` over a plain
  `narrow` entry reads `number | null` (`unaffected.ts` compiles with
  that annotation on both builds). "A set operation returned as the
  with statement's own body folds too: each branch is read the way that
  position reads a plain body ... and the two fold per key" — the
  with-body cells above, plain-body controls included.
- The reference's recursive-term sentences — `(self) => ...
  .intersect(select(..., s.narrow))` compiles to `union all (... from
  "r" inner join ... intersect select ... from "app"."narrow")` and
  returns `[{ id: 1 }]` in 36 ms (`intersectTerm`); `... .union(...)
  .limit(3)` compiles to `union all (... union select ... from
  "app"."narrow" limit 3)` and is cancelled at the 4 s
  `statement_timeout` (`57014`, `limitTerm`), as is the constant
  `union` branch without `limit` (`unionConstTerm`, 4003 ms) — "never
  terminates (measured)"; the same branch guarded by `where
  "app"."narrow"."id" = $2` returns `(1,'root',0) (2,'kid',1)
  (3,'grandkid',2)` in 6 ms. An `integer` anchor against a `bigint`
  term branch type-checks and the server answers `42804 recursive query
  "r" column 3 has type integer in non-recursive term but type bigint
  overall` (`widthTerm`), the sentence verbatim. No backend was left
  running (`pg_stat_activity` count 0 after the run).
- "a row read over a CTE reference no longer shows a symbol-keyed
  member" — `t_wholeRef`/`t_wholeRefPlain` (round 1's probe) and
  `t_wb_whole_ref_setop`/`t_wb_whole_ref_plain` read plain object
  types on the corrected build; the parent build prints `readonly
  [cteRowMeta]: never` on each (round 1's N7 closed). The statement
  itself does not compile at run time (N4).
- The reference's set-operation section, execute paragraph — round 1's
  cells unchanged; "A `SetOpStage<...>` written by hand ... still reads
  as the left branch's declared row with joins untracked, so an object
  projection there widens with `null`": `SetOpStage<typeof s.narrow>`,
  `SetOpStage<typeof s.wide>`, `SetOpStage<typeof s.nn>` and
  `SetOpStage<{ id; note }>` bodies read `n: number`, `n: bigint`,
  `note: string`, `{ id: number | null; note: string | null }`
  (`t_wb_stage_*`), the documented rule; what it costs at run time is
  N5.

### Verdict

**ARCHIVE** — no blocking finding. Round 1's B1 is closed: on the
corrected build a core-built set operation returned as the body of
`handle.with` reads the union of both branches (30 of the 53 with-body
cells changed against the parent build, every change a widening from
the left branch's own type to the fold; the 23 unchanged cells are the
plain bodies, the cells already widened by the position's own rule, and
the hand-written annotations), and `null` arrives only under a type
that allows it in every with-body cell except the hand-written
`SetOpStage` annotations the reference documents. Six non-blocking
findings (N1–N5 and the N6 observations): one scenario sentence that
needs a surface qualifier (N1), one migration-note gap (N2), two
pre-existing surface gaps the delta is silent about (N3, N4), one
documented annotation cost (N5). Round 1's matrices (109 assertions) and
80 runtime cases are unchanged by the correction; 43 new assertions and
44 new runtime cases are clean, with the rendered SQL and every row
value byte-identical between the corrected build and the parent
commit's build.
