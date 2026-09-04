# 2026-08-26 — add-query-layer group 3: type inference (piece team g3)

Refs:
- packages/core/src/types/column-builder.ts @ blob a09150fc6ae6fc708bc39a96f2459e9ac5adae16
- packages/core/src/types/column-builder-factories.ts @ blob ab213f38c6ad7b0d5eb8a373115f521faa2e7171
- packages/core/src/types/ts-type-map.ts @ blob a54ff096705aac24164b6d82d79ff14b0064e162
- packages/core/src/index.ts @ blob 1332250c6360f923f3e6bccd6d2ba87257062be1
- packages/query/src/types/select-result.ts @ blob ab2b3939f7f932ec8fe0c1cca2a6a55bb564054e
- packages/query/src/types/numeric-mode.ts @ blob a596083998fc59b8ba7404939f7bfa9d456215b4
- packages/query/src/types/interval.ts @ blob 49f27411719cf6f29c32bf9bc7cbb918ad7235e0
- openspec/changes/add-query-layer/specs/query-type-inference/spec.md @ blob 54650fcb0427cde3cb4e6ca22dafbbd8813a70fe
- openspec/changes/add-query-layer/tasks.md @ blob 5ace98e870a65b394a0e7bb19d8ee9b765d5e5a0
- openspec/task-times.csv @ blob 187da6586038d96f8bf83be9fa8d626a9b5c315f
- openspec/task-tokens.csv @ blob f40700d15c9ed1fa8d7682648a23a479008f8267
- docs/specs/2026-08-19-hejbro-design.md @ blob c40345d29d757a8d506cb60496382ecb8035c4a7

Session: Claude Code (Fable 5) as lead; piece team g3 (planner: Opus,
implementer: Sonnet, reviewer: Opus). Owner inputs are English rewrites
of Korean originals; team decisions reached the owner only through the
lead.

---

## Owner inputs and decisions in this piece

**The eight-decision round (before code).** ① `ColumnBuilder` gains a
defaulted `TMeta` type parameter (runtime unchanged, existing call
sites compile unchanged). ② Left-join nullability (3.3) is parked as
#307 with its SHALL clause removed from the delta (D87: specs describe
what the product does now). ③ The planner recommended plain `string`
for bigint/numeric; the owner asked how Drizzle handles it, and after
the comparison (Drizzle converts at a result-mapping layer, forces a
mode choice) chose the **larger** scope: mode options plus a result
conversion layer in this change — with the house difference that
`'number'`-mode conversion throws on the unsafe range instead of
silently losing precision. ④ For interval the owner rejected
`unknown`/`string` as irresponsible ("we should define the category")
→ structural `IntervalValue`. ⑤ `.$type<T>()` as an identity method.
⑥ Generated columns start as their own change (#308) rather than
widening this one. ⑦ Test-file naming (lead call, repo precedent).
⑧ Insert optionals as `col?: T` under `exactOptionalPropertyTypes`.

**The `$type` saga (three rounds).** First: brand jsonb-only → owner
asked whether json and jsonb are really different types; given the
Postgres storage/semantics differences and Drizzle's tag-anywhere
behavior, chose **json and jsonb both**. Then the planner corrected the
premise — `$type` already exists on every builder, so a json/jsonb-only
*read* just relocates the silent ignore to twenty other column types.
The owner asked to be convinced before widening ("정한 건 아닌데 날
이해시켜봐"); the honest case included the risk their skepticism
pointed at (Drizzle's unconstrained override is a user-operated lying
device) and the middle form: **all columns, narrowing-only** —
`T extends` the column's base mapped type, so `uuid().$type<UserId>()`
and CHECK-backed unions work while `integer().$type<string>()` is a
compile error; json/jsonb stay fully free because their base is
`unknown`. Chosen. Contract sentence: "the brand can narrow, never
lie." Implementing it exposed a dependency-direction fact — the base
mapping must live where `$type` lives — so the type-level map and
`IntervalValue` moved to core (`ts-type-map.ts`) under a lead-set
boundary: **types only, zero runtime symbols in core** (proven in
review by `Object.keys(module)` being empty); parsers and conversion
functions stay in `@hejbro/query`.

**Interval details.** Fields: the implementer deliberately deviated
from the planned `milliseconds` to `microseconds` (Postgres outputs
six fractional digits; stopping at milliseconds silently drops three) —
owner accepted the deviation. Shape: all seven fields required, parser
returns the canonical form (absent axes zero) so equal intervals are
structurally equal. The 7-field set maps each field to exactly one of
Postgres's three internal axes (months/days/microseconds), hiding no
cross-axis conversion.

**Measurement standard (owner, mid-piece).** "The ledger should record
actual processing time — agent waits and user-decision waits don't
count." Re-derived from git/commit timestamps and session event logs,
the reported "3.6×" collapsed to **0.81×**: the estimates were fine;
the cost was process. That reversal flipped the group-4 prescription
from "split tasks smaller" to "settle [design] decisions before
summoning" — splitting would multiply exactly the coordination that
cost the time. Process costs got their own named ledger rows
(`3.pivot` 20m for a decision arriving mid-implementation;
`3.9-rework` 18m for a red-first lapse; `3.9-crap` 12m for the gate
itself widening between bases). The owner also directed recording
**token usage** per piece; this piece: 2,506 requests, 2,178,887
output tokens across the three role sessions (~2.5× group 2 — the
piece with more decisions and rework).

**Conflict-free ledgers (owner, after watching the rebase conflict).**
"Order the measurements or merge the procedure so they don't
conflict." Merged: both CSV ledgers and the README metric block are
written only by the lead's close-out commit, from team-reported
figures — one writer, no piece-branch conflicts. D88's row now carries
the full ledger discipline.

## What the piece built

Tasks 3.1–3.16 plus a design pivot and three reworks; four review
batches, all PASS; goldens and `examples/**` byte-identical throughout
(the type-level extension provably never leaked into runtime output).
User-visible: types flow from declarations —
`uuid().primaryKey().defaultRandom()` infers `string` (it would have
been `string | null` without the F7 fix mirroring
`materializeNotNull`), `serial().primaryKey()` is optional on insert,
`bigint({mode})` chooses precision, `$type` narrows only, interval is
a canonical structural value, unbranded json/jsonb are `unknown`, no
codegen. Parked with reasons pinned in code and spec: #307 (left-join
nullability), #308 (generated columns), #310 (mode-default constant
derivation — with an explicit "do not weaken the exhaustiveness
assertion" trap note), #311 (`ColumnRef` carrying meta/source — same
root as #307).

## Internal processing (what the verification machinery caught)

The piece's stance: "a test exists" is not evidence. The catches:
**phantom TMeta** (a type parameter that never bottoms out in a
property is structurally unobservable — deliberately-wrong assertions
passed `check-types`; fixed with a unique-symbol anchor, after which
every task carried a break-it-on-purpose probe run against the gate
that actually judges it); **`.array()` meta loss** and **implicit
PK/serial notNull** (found before they could silently mistype every
example primary key); **silent `'bigint'` truncation and
empty-string→0** (caught by requirements back-derivation — a class
mutation checks cannot catch, since an unimplemented requirement has
nothing to break); **name-matching inference rejected** with the
`select({ id: posts.title })` counterexample (the no-lying rule applied
to inference itself; object-form narrowed honestly to family-based
`T | null`). The final CRAP failure appeared only after the lead's
rebase — the gate's own definition had widened between bases (group 2
added `packages/query` to the scan), caught because the reviewer runs
all gates every batch regardless of the agreed tripwire scope; the
split was verified as purely structural by differential execution (75
input×mode combinations against the pre-split implementation, zero
mismatches). Lessons kept: a rebase changes the judging environment
even when it changes no code; a gate report must list what was not run;
the lead owes in-flight pieces notice when a merged piece widens a
gate.
