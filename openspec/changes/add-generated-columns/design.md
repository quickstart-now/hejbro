# Design — add-generated-columns

## Context

The column builder chain records type-only state in `TMeta` and
runtime state in `columnState` (both extended by add-array-ergonomics'
`notNullElements` precedent: conditional method typing plus `table()`
runtime validation, since a type-level guard cannot block a call).
Snapshots are formatVersion 5, compact optional column fields,
expression content stored as codec nodes with `raw-sql` as the proven
fragment path (RLS predicates). The serial family already implies
`hasDefault` (D66) and pairs with sequence-kind (#23). Insert-input
classification lives in `packages/query`'s `insert-input.ts`
(required/optional keys), wired to every chain surface by #351. All
seven surface decisions were settled with the owner on 2026-08-28
(D100): full trio + sequence options; Drizzle-parity method names;
`sql`-fragment expression; formatVersion 6; precise alters with
drop+add for the two impossible transitions; ALWAYS-family key
exclusion; create+runtime real-server witness.

## Goals / Non-Goals

**Goals:**

- The full `GENERATED` family declarable, emitted, diffed, and typed —
  ALWAYS-family writes inexpressible at compile time because Postgres
  rejects them at runtime.
- Precise alters wherever Postgres has in-place grammar; no new
  minimum-Postgres commitment (universal grammar for the rest).
- Older readers refuse v6 snapshots loudly (the D73 diagnostic pays
  off), never silently mis-diff.

**Non-Goals:**

- `OVERRIDING SYSTEM VALUE` (writing an ALWAYS column deliberately) —
  out of scope, documented here, not parked as an issue.
- Virtual generated columns (PG18) — the harness targets postgres:17;
  STORED only.
- Migrating `examples/` from serial to identity — serial remains their
  idiom; regenerating the chains is not part of this change.
- Structured expression nodes for the generated expression — sibling
  refs do not exist inside the column map (the TS7022 thunk rejection
  precedent), and extras-side declaration would hide generated-ness
  from the type layer entirely, defeating #308's purpose.

## Decisions

1. **State shape.** `TMeta` gains `generated: true` /
   `identity: "always" | "byDefault"` (type-only, camelCase per D57);
   `columnState` gains optional `generated` (the fragment's ExprNode)
   and `identity` ({ kind, options }) — optional fields so no
   constructor outside the setters is touched (the g1 lesson).
   `.generatedAlwaysAsIdentity()` implies notNull the way serial does
   (D66 mirror: identity columns are NOT NULL by Postgres rule) and
   both identity kinds imply `hasDefault` for the optionality math —
   but ALWAYS-family classification supersedes it on the write side.
2. **Validation at `table()`** (the column name exists there):
   identity on a non-integer type, generated combined with
   `.default()`, generated combined with identity — each throws a
   coded error naming the column, with a literal `Next:` clause. New
   codes ride the expanded diagnostic gates (#361 landed — query/pg
   and these scripts now see each other).
3. **Snapshot.** Column node gains `generated?: JsonValue` (the
   encoded fragment via the existing expression codec — `raw-sql` is
   a verified path) and `identity?: { kind: "always" | "by-default",
   startWith?, increment?, minValue?, maxValue?, cache?, cycle? }`
   (kebab kind token — it materializes in an artifact, D57).
   `HEJBRO_SNAPSHOT_VERSION` 5 → 6; every snapshot-bearing fixture
   updates mechanically in the same task.
4. **Emit and diff.** Create renders the grammar inline in
   `renderColumnDefinition`'s path. Diff decision table: identity
   absent↔present → `add generated … as identity` / `drop identity`;
   kind change → `set generated always | by default`; option change →
   one `set <option>` statement per changed option (restart is out of
   scope — declarative snapshots carry no live sequence position);
   generated absent→present on an existing column → drop+add WITH the
   D32 confirmation (stored data destroyed); expression change →
   drop+add WITHOUT it (data derivable); generated present→absent →
   `drop expression` (in-place, PG13+ grammar).
5. **Typing.** `insert-input.ts` gains an excluded-keys arm: ALWAYS
   family keys are `Exclude`d from both key unions (absent, not
   `never`-valued — the owner rejected the noisy alternative);
   by-default identity flows through the existing `hasDefault`
   optionality. Read types are untouched (an identity column reads as
   its integer mode; a generated column as its declared type).
6. **Witness.** The pg integration harness gains one identity and one
   generated column: create-path grammar acceptance, identity
   assignment observed, generated computation observed, and an ALWAYS
   write rejected BY THE DATABASE (deliberate cast, reason commented —
   the type layer already forbids it, proven by `@ts-expect-error`).
   Alter paths are golden-covered (the g4-precedent witness level).

## Risks / Trade-offs

- The `sql`-fragment expression does not compile-break when a sibling
  column is renamed — the user updates the fragment; a stale fragment
  surfaces as an expression-change diff (drop+add, data recomputed),
  never silent corruption. Reference typos surface when the migration
  applies (create fails) — the real-server gate.
- Postgres normalizes stored expressions internally; hejbro never
  introspects (measured: no `pg_get_constraintdef`-class calls
  anywhere), so snapshot-vs-snapshot comparison keeps text pins
  stable. The declaration's own fragment text is the identity.
- The v6 bump forces a one-time snapshot rewrite for every project on
  next generate; migration files are untouched, so the blast radius is
  a version-field diff.
- Identity option diffs compare declared options only: an option the
  declaration never set is not diffed against Postgres defaults
  (declaration-is-truth, consistent with how column defaults diff).
