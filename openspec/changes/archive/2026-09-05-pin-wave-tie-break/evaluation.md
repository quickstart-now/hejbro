# D106 round 1 — pin-wave-tie-break

## Method

- Worktree: `/private/tmp/d106-pw/wt`, detached at `upstream/dev` tip
  `0ecee28c3ce45c08cd47d6e07874bb891d394ead` (confirmed `895309c5`, the
  squash commit for `pin-wave-tie-break`, is an ancestor).
- `pnpm install --frozen-lockfile` then `TURBO_FORCE=1 pnpm build --force`
  — 7/7 tasks built clean, 0 cached (forced).
- CLI under test: `packages/cli/dist/cli.js`, `hejbro v0.2.0-pre.1`.
- Scratch project: `/private/tmp/d106-pw/scratch` — a bare package with
  `node_modules/hejbro` and `node_modules/@hejbro/core` symlinked
  straight at the built worktree packages (no publish/pack needed since
  the CLI resolves `hejbro`'s own `exports["."]` → `dist/index.js`).
  `hejbro init` scaffolded `hejbro.config.ts` / empty snapshot; every
  scenario below is one `hejbro generate` run read from the produced
  `migrations/*.sql` (banner + statement order), no database involved.
- Read only: `openspec/changes/pin-wave-tie-break/specs/cli-commands/spec.md`,
  the same requirement in `openspec/specs/cli-commands/spec.md` (identical
  text — this MODIFIED delta is already synced into the base spec),
  and `skills/hejbro/references/generate-verify-workflow.md` for the
  public-surface description of ordering. Implementation source, tests,
  `tasks.md`, `design.md`, `proposal.md`, and git history were not read.

## Findings

### OK-1 — The delta's own worked example, verbatim

**Scenario measured**: "An unconstrained object lands in the earliest
wave, in identity order" — `p_parent, q_child (→ p_parent), self_ref`
emits creates `p_parent, self_ref, q_child` and drops
`q_child, self_ref, p_parent`.

**Input**: three tables in `app` — `p_parent` (no FK), `q_child` (FK →
`p_parent.id`), `self_ref` (FK → its own `id`) — generated from an empty
snapshot, then a second run declaring the schema empty again (drop all
three).

**Observed**: create migration's `create table` statements, in order:
`app.p_parent`, `app.self_ref`, `app.q_child`. Drop migration's
`drop table` statements, in order: `app.q_child`, `app.self_ref`,
`app.p_parent`. Both banners list the same order. Exact match to the
scenario sentence.

### OK-2 — Diamond dependency, identity order breaks the fan-out tie

**Scenario measured**: same requirement paragraph — "the order among
objects whose references are all satisfied is identity order... in
waves."

**Input**: `z_top` (no FK), `b_left` and `y_right` (both FK → `z_top`),
`a_bottom` (FK → both `b_left` and `y_right`) — a diamond, declared in
source order `z_top, b_left, y_right, a_bottom` (already identity order,
so this run isolates wave computation from the naming check below).

**Observed**: creates emitted `z_top, b_left, y_right, a_bottom` (wave 1
= `{z_top}`, wave 2 = `{b_left, y_right}` in identity order, wave 3 =
`{a_bottom}`); a follow-up drop-all run emitted
`a_bottom, b_left, y_right, z_top` (reverse waves, same identity
tie-break within wave 2). Matches the requirement's wave definition.

### OK-3 — Referencing table sorts first by identity, still created second

**Scenario measured**: "A referencing table is created after the table
it references" — "the referencing table's identity sorts first."

**Input**: `z_parent` (no FK) and `a_child` (FK → `z_parent.id`) —
`a_child` sorts first alphabetically.

**Observed**: `create table "app"."z_parent"` precedes
`create table "app"."a_child"`; the later drop-all run emits
`drop table "app"."a_child"` before `drop table "app"."z_parent"`.
Matches the scenario exactly, in both directions (create emits the
referenced-first order the identity sort would not give; drop emits the
dependent-first order the identity sort also would not give).

### OK-4 — Migration naming is pinned to pre-refinement (identity) order, not emission order

**Scenario measured**: "The migration's own name SHALL NOT follow
[wave refinement]: the name is derived from the change list as it stands
before this dependency refinement — kind order, then identity — so that
refining the order a run emits never renames the file a run writes."

**Input**: reused OK-3's `z_parent`/`a_child` pair (and, independently,
OK-1's `p_parent`/`q_child`/`self_ref` set) — in both, the *first table
created by wave order* is not the *first table by identity order*.

**Observed**: the migration filename was `..._add_a_child.sql` (from
`a_child`, the identity-first table) even though the SQL body creates
`z_parent` first; symmetrically `..._add_p_parent.sql` for OK-1 (there
`p_parent` happens to be both identity-first and wave-first, so this
pairing alone doesn't isolate the claim — the `a_child`/`z_parent` case
does, and confirms it directly). No case observed where the emitted
wave order changed a migration's derived name.

### OK-5 — Mutually referencing pair (2-cycle) keeps existing identity order, both sides

**Scenario measured**: "a mutually referencing pair — which no order
satisfies — keeps its existing identity order."

**Input**: `m_alpha` (FK → `n_beta.id`, via the deferred
`.references(() => …)` thunk for import-order safety) and `n_beta`
(FK → `m_alpha.id`) — declared together with two unrelated table drops in
the same run (exercises "creates and drops together" as one migration).

**Observed**: creates emitted `m_alpha, n_beta` — identity order, since
neither topological order satisfies the cycle. A follow-up drop-only run
for the same pair also emitted `m_alpha, n_beta` (identity order, not
reversed) — the cycle blocks reversal on the drop side the same way it
blocks ordering on the create side. Matches the scenario sentence; the
sentence itself doesn't specify the drop-side sub-case, but the observed
behavior is the natural (and only consistent) reading of "keeps its
existing identity order."

### OK-6 — Several independent (unconstrained) tables, sorted by identity regardless of declaration order

**Scenario measured**: same wave paragraph, the general "identity order
within the wave" claim, stress-tested against declaration order as a
possible confound.

**Input**: three tables with no foreign keys at all, declared in source
order `zeta, alpha, mu`.

**Observed**: creates emitted `alpha, mu, zeta` — identity order, not
declaration order.

### N-1 — Spec text names only a 2-element cycle; a longer cycle's tie-break is unaddressed (not contradicted)

**Scenario measured**: "a mutually referencing pair — which no order
satisfies — keeps its existing identity order." The requirement's prose
only describes a pair; a cycle of three or more declared objects is a
natural neighbour of that sentence but isn't itself covered by any
scenario or by the requirement prose (which says "pair," not "cycle").

**Input**: a 3-cycle — `c_x` (FK → `c_y.id`), `c_y` (FK → `c_z.id`),
`c_z` (FK → `c_x.id`), all via the deferred `.references()` thunk.

**Observed**: creates emitted `c_x, c_y, c_z` — plain identity order for
the whole cycle, i.e. the same "keeps its existing identity order"
behavior the pair scenario describes, generalized. This does not
contradict shipped behaviour or the spec — it's a consistent
generalization — but the spec's own sentence doesn't commit to it by its
literal wording ("pair"), so a reader can't derive this case from the
text alone. Filed as a gap, not a defect: a scenario or a prose tweak
("a mutually referencing group" instead of "pair") would close it.

## Summary

- **B (blocks archive)**: 0
- **N (gap/ambiguity, file as sub-issue)**: 1 — N-1 (spec prose says
  "pair," shipped behavior (correctly, consistently) also handles longer
  cycles; the sentence doesn't say so)
- **OK (verified)**: 6 — OK-1 through OK-6, covering the delta's own
  worked example verbatim, a diamond, single-edge referencing/referenced
  in both directions, migration-naming stability under wave refinement,
  a 2-cycle on both the create and drop sides, and pure identity order
  for unconstrained tables regardless of declaration order.
